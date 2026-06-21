/**
 * POST /api/transcribe — short-utterance speech-to-text via Azure Speech REST.
 *
 * Accepts a single multipart "audio" field containing WAV-encoded PCM
 * (16-bit mono, 16 kHz) produced by the studio's VoiceInputRecorder.
 * Returns { text, status }. Empty text + status='NoMatch' means the audio
 * was silent or unintelligible — caller should surface a gentle re-prompt.
 *
 * The browser never sees AZURE_SPEECH_KEY; this route is the broker.
 */
import type { FastifyInstance } from 'fastify';

interface AzureRecognitionResponse {
  RecognitionStatus: string;           // 'Success' | 'NoMatch' | 'InitialSilenceTimeout' | 'BabbleTimeout' | 'Error'
  DisplayText?: string;
  NBest?: Array<{ Display?: string; Lexical?: string }>;
}

export async function registerTranscribeRoute(app: FastifyInstance) {
  app.post('/api/transcribe', async (req, reply) => {
    const key = process.env['AZURE_SPEECH_KEY'] ?? '';
    const region = process.env['AZURE_SPEECH_REGION'] ?? 'southeastasia';
    if (!key) {
      reply.code(503);
      return { error: 'AZURE_SPEECH_KEY not configured' };
    }

    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: 'Expected multipart field "audio".' };
    }
    const buffer = await file.toBuffer();
    const contentType = file.mimetype || 'audio/wav';

    const q = req.query as Record<string, unknown>;
    const language = (typeof q.language === 'string' && q.language) || 'zh-CN';

    const url =
      `https://${region}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(language)}&format=detailed`;

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': contentType,
          'Accept': 'application/json',
        },
        // BodyInit accepts ArrayBufferView at runtime, but undici's typings
        // don't expose that overload — cast through unknown.
        body: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as unknown as BodyInit,
      });
      if (!r.ok) {
        const errText = await r.text();
        req.log.error({ status: r.status, errText }, 'xiaomu:transcribe Azure error');
        reply.code(502);
        return { error: `Azure Speech ${r.status}`, detail: errText };
      }
      const json = (await r.json()) as AzureRecognitionResponse;
      const text =
        (json.DisplayText && json.DisplayText.trim()) ||
        (json.NBest?.[0]?.Display && json.NBest[0]!.Display!.trim()) ||
        '';
      return { text, status: json.RecognitionStatus };
    } catch (e) {
      req.log.error({ err: e }, 'xiaomu:transcribe failure');
      reply.code(500);
      return { error: (e as Error).message };
    }
  });
}
