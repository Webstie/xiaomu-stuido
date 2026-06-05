/**
 * PCM16 audio playback for Azure Voice Live responses.
 *
 * Receives base64-encoded PCM16 chunks at 24kHz mono and schedules them as
 * AudioBufferSourceNodes for gapless sequential playback. Maintains
 * currentPlaybackTimeMs (derived from AudioContext.currentTime) for viseme sync.
 */

export class VoiceLivePlayback {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private started = false;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
  }

  /**
   * Decode base64 PCM16 and queue for gapless playback.
   * Returns the scheduled playback start time in ms (for viseme offset tracking).
   */
  enqueue(base64Audio: string): number {
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Convert Int16 PCM → Float32
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    // reason: noUncheckedIndexedAccess — Int16Array element access is always defined within bounds
    for (let i = 0; i < int16.length; i++) float32[i] = (int16[i] as number) / 32768;

    const audioBuffer = this.ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    if (!this.started || this.nextStartTime < now) {
      // Start slightly in the future to allow buffering
      this.nextStartTime = now + 0.01;
      this.started = true;
    }

    const startAt = this.nextStartTime;
    source.start(startAt);
    this.nextStartTime += audioBuffer.duration;

    return Math.round(startAt * 1000);
  }

  /** Current AudioContext time in ms — used for viseme sync. */
  get currentPlaybackTimeMs(): number {
    return Math.round(this.ctx.currentTime * 1000);
  }

  /** Stop all playback and reset to a fresh AudioContext. */
  stop(): void {
    this.ctx.close().catch(() => {});
    this.ctx = new AudioContext({ sampleRate: 24000 });
    this.nextStartTime = 0;
    this.started = false;
  }

  /** Resume a suspended AudioContext (browsers may suspend on first user gesture). */
  resume(): void {
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }
}
