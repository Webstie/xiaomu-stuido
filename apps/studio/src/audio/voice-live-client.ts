/**
 * VoiceLiveClient — manages the browser side of a Voice Live session.
 *
 * Flow:
 *  1. connect(childAge, configId) → opens WS through Vite proxy → server → Azure Voice Live
 *  2. startRecording() → requests mic permission, loads AudioWorklet, streams PCM16 to server
 *  3. stopRecording() → sends input_audio_buffer.commit; server/Azure VAD handles turn end
 *  4. Incoming audio played via VoiceLivePlayback (gapless PCM16 scheduling)
 *  5. Viseme events forwarded to onViseme callback for face sync
 *  6. Expression events (injected by server clause classifier) forwarded to onExpressionEvents
 *  7. Text deltas forwarded to onTextDelta / onUserTranscript callbacks
 *
 * AudioWorklet note: mic-worklet.js must be loaded via its static URL. Vite resolves
 * `import micWorkletUrl from './mic-worklet.js?url'` to the hashed asset URL.
 */

import micWorkletUrl from './mic-worklet.js?url';
import { VoiceLivePlayback } from './playback.js';
import type { VisemeEvent } from '../face/visemeMap.js';

export interface ExpressionEventPayload {
  atCharOffset: number;
  expressionId: string;
  confidence: number;
}

export interface VoiceLiveCallbacks {
  onReady: () => void;
  onAudioFrame: (playbackTimeMs: number) => void;
  onViseme: (event: VisemeEvent) => void;
  onTextDelta: (delta: string) => void;
  onUserTranscript: (text: string, isFinal: boolean) => void;
  onExpressionEvents: (events: ExpressionEventPayload[]) => void;
  onTurnEnd: () => void;
  onSpeechStart: () => void;
  onSpeechStop: () => void;
  onError: (message: string) => void;
  onRms?: (level: number) => void;
}

export class VoiceLiveClient {
  private ws: WebSocket | null = null;
  private playback: VoiceLivePlayback;
  private micCtx: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micNode: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private recording = false;
  private callbacks: VoiceLiveCallbacks;

  constructor(callbacks: VoiceLiveCallbacks) {
    this.callbacks = callbacks;
    this.playback = new VoiceLivePlayback();
  }

  connect(childAge: number, configId = 'default'): void {
    // Use the Vite dev proxy (ws: true) so the browser connects to :5173 which
    // proxies the WebSocket upgrade to the Fastify server at :8787.
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProtocol}//${window.location.host}/api/voice-live?childAge=${childAge}&configId=${encodeURIComponent(configId)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // Wait for xi.ready from server (after session is initialized with Azure)
    };

    this.ws.onmessage = (evt) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(evt.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = event['type'] as string;

      switch (type) {
        case 'xi.ready':
          this.callbacks.onReady();
          break;

        case 'response.audio.delta': {
          const delta = event['delta'] as string | undefined;
          if (delta) {
            const playbackMs = this.playback.enqueue(delta);
            this.callbacks.onAudioFrame(playbackMs);
          }
          break;
        }

        case 'response.animation_viseme.delta': {
          const offsetMs = (event['audio_offset_ms'] as number | undefined) ?? 0;
          const visemeId = (event['viseme_id'] as number | undefined) ?? 0;
          this.callbacks.onViseme({ visemeId, audioOffsetMs: offsetMs });
          break;
        }

        case 'response.audio_transcript.delta': {
          const delta = event['delta'] as string | undefined;
          if (delta) this.callbacks.onTextDelta(delta);
          break;
        }

        case 'response.text.delta': {
          const delta = event['delta'] as string | undefined;
          if (delta) this.callbacks.onTextDelta(delta);
          break;
        }

        case 'xi.expression': {
          const events = event['events'] as ExpressionEventPayload[] | undefined;
          if (events && events.length > 0) this.callbacks.onExpressionEvents(events);
          break;
        }

        case 'conversation.item.input_audio_transcription.delta': {
          const delta = event['delta'] as string | undefined;
          if (delta) this.callbacks.onUserTranscript(delta, false);
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = event['transcript'] as string | undefined;
          if (transcript) this.callbacks.onUserTranscript(transcript, true);
          break;
        }

        case 'input_audio_buffer.speech_started':
          this.callbacks.onSpeechStart();
          break;

        case 'input_audio_buffer.speech_stopped':
          this.callbacks.onSpeechStop();
          break;

        case 'response.done':
          this.callbacks.onTurnEnd();
          break;

        case 'xi.error':
        case 'error': {
          const errObj = event['error'] as { message?: string } | undefined;
          const msg = errObj?.message ?? (event['message'] as string | undefined) ?? 'Unknown error';
          this.callbacks.onError(msg);
          break;
        }
      }
    };

    this.ws.onerror = () => {
      this.callbacks.onError('WebSocket connection failed. Is the server running?');
    };

    this.ws.onclose = (evt) => {
      if (evt.code !== 1000) {
        this.callbacks.onError(`Connection closed: ${evt.reason || String(evt.code)}`);
      }
    };
  }

  async startRecording(): Promise<void> {
    if (this.recording) return;
    this.playback.resume();

    // Request mic — triggers browser permission dialog on first use
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 24000 },
      video: false,
    });

    // Create AudioContext at 24kHz — the constraint above requests 24kHz from the device,
    // so the worklet receives already-correct samples without resampling.
    this.micCtx = new AudioContext({ sampleRate: 24000 });
    await this.micCtx.audioWorklet.addModule(micWorkletUrl);

    this.micSource = this.micCtx.createMediaStreamSource(this.micStream);
    this.micNode = new AudioWorkletNode(this.micCtx, 'mic-processor');

    this.micNode.port.onmessage = (
      evt: MessageEvent<{ type: string; buffer: ArrayBuffer; rms: number }>,
    ) => {
      if (evt.data.type !== 'pcm16' || !this.recording) return;
      if (this.ws?.readyState !== WebSocket.OPEN) return;

      // Notify caller of current RMS level for waveform meter
      if (this.callbacks.onRms) this.callbacks.onRms(evt.data.rms);

      // Convert ArrayBuffer → base64
      const int16 = new Int16Array(evt.data.buffer);
      const bytes = new Uint8Array(int16.buffer);
      let binary = '';
      // reason: noUncheckedIndexedAccess — Uint8Array element access is always defined within bounds
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
      const base64 = btoa(binary);

      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    };

    this.micSource.connect(this.micNode);
    // Connect to destination to ensure the graph runs (output is silent — mic audio is not played back)
    this.micNode.connect(this.micCtx.destination);
    this.recording = true;
  }

  stopRecording(): void {
    if (!this.recording) return;
    this.recording = false;

    // Explicitly commit the audio buffer (server-side VAD will also fire, but belt-and-suspenders)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }

    // Release mic hardware tracks
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.micSource?.disconnect();
    this.micNode?.disconnect();
    this.micSource = null;
    this.micNode = null;
    // Keep micCtx alive for the next PTT press (addModule is idempotent on same worklet name)
  }

  get playbackTimeMs(): number {
    return this.playback.currentPlaybackTimeMs;
  }

  disconnect(): void {
    this.stopRecording();
    this.micCtx?.close().catch(() => {});
    this.micCtx = null;
    this.playback.stop();
    if (this.ws) {
      this.ws.close(1000, 'Voice mode disabled');
      this.ws = null;
    }
  }
}
