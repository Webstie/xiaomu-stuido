/**
 * mic-worklet.js — AudioWorklet processor for microphone capture.
 *
 * Receives Float32 samples at the AudioContext's sample rate (we request 24kHz,
 * so no resampling is needed). Converts to Int16 PCM, buffers 40ms chunks
 * (960 samples at 24kHz), posts each chunk as {type:'pcm16',buffer:ArrayBuffer,rms:number}.
 *
 * 40ms * 24000 = 960 samples → 1920 bytes per chunk.
 *
 * NOTE: This file MUST be plain .js — AudioWorklet processors run in a separate
 * global scope that cannot load TypeScript. Vite serves it as-is via ?url import.
 */

const CHUNK_SAMPLES = 960; // 40ms at 24kHz

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(CHUNK_SAMPLES);
    this._bufferFill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array, one channel
    let rmsSum = 0;

    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      rmsSum += s * s;

      // Float32 [-1,1] → Int16 [-32768, 32767]
      this._buffer[this._bufferFill++] = Math.round(s * 32767);

      if (this._bufferFill >= CHUNK_SAMPLES) {
        const rms = Math.sqrt(rmsSum / CHUNK_SAMPLES);
        // Copy and post — transfer ownership of the ArrayBuffer
        const out = new Int16Array(CHUNK_SAMPLES);
        out.set(this._buffer);
        this.port.postMessage({ type: 'pcm16', buffer: out.buffer, rms }, [out.buffer]);
        this._bufferFill = 0;
        rmsSum = 0;
      }
    }

    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
