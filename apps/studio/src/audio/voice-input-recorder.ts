/**
 * VoiceInputRecorder — one-shot click-to-talk recorder with VAD auto-stop.
 *
 * Lifecycle:
 *   1. start(cb) → requests mic permission, opens AudioContext at 16 kHz,
 *      loads mic-worklet (shared with VoiceLiveClient), starts capturing PCM16
 *   2. VAD watchdog runs every 100ms:
 *        - SPEECH detected when worklet RMS > SPEECH_RMS_THRESHOLD
 *        - finishes on:
 *            • SILENCE_END_MS of silence AFTER speech started → onStopped(wav)
 *            • NO_SPEECH_TIMEOUT_MS with no speech ever       → onCancelled('no-speech')
 *            • MAX_LENGTH_MS hard cap                          → onStopped(wav) (whatever we have)
 *   3. cancel() can be called by the UI to abort without sending.
 *
 * Audio output is a WAV blob (RIFF, 16-bit PCM mono @ 16 kHz) — Azure Speech
 * REST short-audio endpoint accepts this directly.
 */
import micWorkletUrl from './mic-worklet.js?url';

export interface VoiceInputCallbacks {
  onStart: () => void;
  onRms: (level: number) => void;
  onStopped: (wavBlob: Blob) => void;
  onCancelled: (reason: 'no-speech' | 'manual' | 'error') => void;
}

const SAMPLE_RATE = 16000;
const SPEECH_RMS_THRESHOLD = 0.02;   // tuned for typical close-talk mic
const SILENCE_END_MS = 800;          // pause length that signals end-of-utterance
const NO_SPEECH_TIMEOUT_MS = 4000;   // cancel if user clicked but stayed silent
const MAX_LENGTH_MS = 15000;         // hard cap on a single utterance

export class VoiceInputRecorder {
  private ctx: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private workletNode: AudioWorkletNode | undefined;
  private chunks: Int16Array[] = [];
  private callbacks: VoiceInputCallbacks | undefined;
  private startTs = 0;
  private lastSpeechTs = 0;
  private hasSpoken = false;
  private finished = false;
  private watchdog: number | undefined;

  async start(callbacks: VoiceInputCallbacks): Promise<void> {
    if (this.ctx) throw new Error('VoiceInputRecorder already started');
    this.callbacks = callbacks;
    this.chunks = [];
    this.hasSpoken = false;
    this.finished = false;
    this.startTs = Date.now();
    this.lastSpeechTs = this.startTs;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      this.cleanup();
      callbacks.onCancelled('error');
      throw e;
    }

    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule(micWorkletUrl);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.ctx, 'mic-processor');

    this.workletNode.port.onmessage = (e) => {
      if (this.finished) return;
      const msg = e.data as { type: 'pcm16'; buffer: ArrayBuffer; rms: number };
      if (msg.type !== 'pcm16') return;
      // Copy the transferred buffer into our chunk list (it's already ours after transfer).
      this.chunks.push(new Int16Array(msg.buffer));
      this.callbacks?.onRms(msg.rms);
      if (msg.rms > SPEECH_RMS_THRESHOLD) {
        this.hasSpoken = true;
        this.lastSpeechTs = Date.now();
      }
    };

    this.source.connect(this.workletNode);
    callbacks.onStart();

    this.watchdog = window.setInterval(() => this.tick(), 100);
  }

  private tick(): void {
    if (this.finished) return;
    const now = Date.now();
    const elapsed = now - this.startTs;

    if (elapsed > MAX_LENGTH_MS) {
      this.finish('max');
      return;
    }
    if (!this.hasSpoken && elapsed > NO_SPEECH_TIMEOUT_MS) {
      this.finish('no-speech');
      return;
    }
    if (this.hasSpoken && now - this.lastSpeechTs > SILENCE_END_MS) {
      this.finish('vad');
    }
  }

  /** UI-triggered abort. Mic released, no transcript will fire. */
  cancel(): void {
    if (this.finished) return;
    this.finished = true;
    const cb = this.callbacks;
    this.cleanup();
    cb?.onCancelled('manual');
  }

  private finish(reason: 'vad' | 'max' | 'no-speech'): void {
    if (this.finished) return;
    this.finished = true;
    const cb = this.callbacks;
    const chunks = this.chunks;
    const hasSpoken = this.hasSpoken;
    this.cleanup();

    if (!hasSpoken || reason === 'no-speech') {
      cb?.onCancelled('no-speech');
      return;
    }
    cb?.onStopped(encodeWav(chunks, SAMPLE_RATE));
  }

  private cleanup(): void {
    if (this.watchdog !== undefined) {
      window.clearInterval(this.watchdog);
      this.watchdog = undefined;
    }
    try { this.workletNode?.port.close(); } catch { /* ignore */ }
    try { this.workletNode?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = undefined;
    this.stream = undefined;
    this.workletNode = undefined;
    this.source = undefined;
  }
}

function encodeWav(chunks: Int16Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((s, c) => s + c.length, 0);
  const dataBytes = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      view.setInt16(offset, c[i]!, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
