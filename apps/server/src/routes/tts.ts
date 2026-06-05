/**
 * TTS routes — C5 implementation.
 *
 * POST /api/tts         — REST streaming (returns audio/mpeg stream)
 * POST /api/tts/visemes — SDK synthesis + viseme capture (returns JSON)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sanitize } from '../lib/ttsSanitizer.js';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

// ── Schema ────────────────────────────────────────────────────────────────────

const TtsBodySchema = z.object({
  text: z.string().min(1).max(3000),
  voice: z.string().optional(),
  style: z.string().optional(),
  rate: z.string().optional(),
  pitch: z.string().optional(),
});

type TtsBody = z.infer<typeof TtsBodySchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCredentials(): { key: string; region: string } {
  const key = process.env['AZURE_SPEECH_KEY'] ?? '';
  const region = process.env['AZURE_SPEECH_REGION'] ?? 'southeastasia';
  return { key, region };
}

function resolveVoice(bodyVoice?: string): string {
  return (
    bodyVoice ??
    process.env['AZURE_SPEECH_DEFAULT_VOICE'] ??
    'zh-CN-XiaoxiaoMultilingualNeural'
  );
}

function resolveStyle(bodyStyle?: string): string {
  return (
    bodyStyle ??
    process.env['AZURE_SPEECH_DEFAULT_STYLE'] ??
    'cheerful'
  );
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerTtsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/tts
   * Streams MP3 audio directly from Azure TTS REST endpoint.
   */
  app.post<{ Body: TtsBody }>('/api/tts', async (request, reply) => {
    const parsed = TtsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    const body = parsed.data;
    const { key, region } = getCredentials();
    const voice = resolveVoice(body.voice);
    const style = resolveStyle(body.style);

    const ssml = sanitize(body.text, {
      voice,
      style,
      ...(body.rate !== undefined ? { rate: body.rate } : {}),
      ...(body.pitch !== undefined ? { pitch: body.pitch } : {}),
    });

    const ttsUrl = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    let ttsResponse: Response;
    try {
      ttsResponse = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        },
        body: ssml,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: 'TTS fetch failed', details: msg });
    }

    if (!ttsResponse.ok) {
      const text = await ttsResponse.text().catch(() => '');
      return reply.status(502).send({ error: 'TTS service error', status: ttsResponse.status, details: text });
    }

    if (!ttsResponse.body) {
      return reply.status(502).send({ error: 'TTS returned empty body' });
    }

    // Stream response directly to client
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    });

    const reader = ttsResponse.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw.write(Buffer.from(value));
      }
    } finally {
      raw.end();
    }
  });

  /**
   * POST /api/tts/visemes
   * Uses the Speech SDK to synthesize audio and capture viseme events.
   * Returns JSON: { audio: base64, visemes: VisemeEvent[], ssml: string }
   */
  app.post<{ Body: TtsBody }>('/api/tts/visemes', async (request, reply) => {
    const parsed = TtsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    const body = parsed.data;
    const { key, region } = getCredentials();
    const voice = resolveVoice(body.voice);
    const style = resolveStyle(body.style);

    const ssml = sanitize(body.text, {
      voice,
      style,
      ...(body.rate !== undefined ? { rate: body.rate } : {}),
      ...(body.pitch !== undefined ? { pitch: body.pitch } : {}),
    });

    const visemes: Array<{ audioOffsetMs: number; visemeId: number }> = [];

    try {
      const pullStream = sdk.AudioOutputStream.createPullStream();
      const audioConfig = sdk.AudioConfig.fromStreamOutput(pullStream);
      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
      speechConfig.speechSynthesisVoiceName = voice;
      speechConfig.speechSynthesisOutputFormat =
        sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;

      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

      synthesizer.visemeReceived = (_sender, e) => {
        visemes.push({
          audioOffsetMs: Math.round(e.audioOffset / 10000),
          visemeId: e.visemeId,
        });
      };

      await new Promise<void>((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            synthesizer.close();
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              resolve();
            } else if (result.reason === sdk.ResultReason.Canceled) {
              const cancellation = sdk.CancellationDetails.fromResult(result);
              reject(new Error(`TTS canceled: ${cancellation.errorDetails ?? cancellation.reason}`));
            } else {
              reject(new Error(`TTS failed with reason: ${result.reason}`));
            }
          },
          (err) => {
            synthesizer.close();
            reject(new Error(String(err)));
          },
        );
      });

      // Drain the pull stream into chunks
      const chunks: Buffer[] = [];
      const buf = new ArrayBuffer(16384);
      let n: number;
      while ((n = await pullStream.read(buf)) > 0) {
        chunks.push(Buffer.from(new Uint8Array(buf, 0, n)));
      }
      pullStream.close();

      const audio = Buffer.concat(chunks).toString('base64');
      const sortedVisemes = visemes.sort((a, b) => a.audioOffsetMs - b.audioOffsetMs);

      return reply.send({ audio, visemes: sortedVisemes, ssml });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: 'TTS viseme synthesis failed', details: msg });
    }
  });
}
