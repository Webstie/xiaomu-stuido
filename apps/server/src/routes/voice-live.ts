/**
 * /api/voice-live — WebSocket proxy between browser and Azure Voice Live.
 *
 * Browser connects to ws://localhost:5173/api/voice-live?configId=default&personaId=<uuid>
 * (Vite proxies the upgrade to ws://localhost:8787/api/voice-live)
 *
 * Server opens Azure Voice Live WS with api-key, initialises session with assembled system prompt,
 * then bidirectionally pipes messages.
 *
 * The server also:
 *  - Intercepts response.audio_transcript.delta to run clause classifier and inject
 *    {"type":"xi.expression","events":[...]} events for expression timeline.
 *  - Sends {"type":"xi.ready"} to browser once the session is initialised.
 *  - Sends {"type":"xi.error","message":"..."} to browser on any server-side error.
 */

import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import type { StudioConfig, Persona } from '@xiaomu/contracts';
import { assembleSystemPrompt } from '../lib/assembleSystemPrompt.js';
import { createClauseClassifier } from '../lib/clauseSentiment.js';
import { readJson } from '../lib/fileStore.js';

export async function registerVoiceLiveRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/voice-live', { websocket: true }, async (browserSocket, request) => {
    const query = request.query as Record<string, string | undefined>;
    const configId = query['configId'] ?? 'default';
    const personaId = query['personaId'];

    if (!personaId) {
      browserSocket.send(JSON.stringify({ type: 'xi.error', message: 'personaId query param is required' }));
      browserSocket.close(1008, 'Missing personaId');
      return;
    }

    // Load config
    const config = await readJson<StudioConfig>(`configs/${configId}.json`);
    if (!config) {
      browserSocket.send(JSON.stringify({ type: 'xi.error', message: `Config '${configId}' not found` }));
      browserSocket.close(1008, 'Config not found');
      return;
    }

    // Load persona
    const persona = await readJson<Persona>(`personas/${personaId}.json`);
    if (!persona) {
      browserSocket.send(JSON.stringify({ type: 'xi.error', message: `Persona '${personaId}' not found` }));
      browserSocket.close(1008, 'Persona not found');
      return;
    }

    // Assemble system prompt
    const systemPrompt = assembleSystemPrompt(config, persona);

    // Build Azure OpenAI Realtime API URL
    // Voice Live uses the Foundry (Azure OpenAI) endpoint, not the Speech endpoint.
    // URL format: wss://{resource}.openai.azure.com/openai/realtime?api-version={ver}&deployment={dep}
    const foundryEndpoint = (process.env['AZURE_FOUNDRY_ENDPOINT'] ?? '').replace(/\/$/, '');
    const key = process.env['AZURE_FOUNDRY_KEY'] ?? '';
    const deployment = process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? 'gpt-5-chat';
    const apiVersion = process.env['AZURE_FOUNDRY_API_VERSION'] ?? '2025-04-01-preview';

    if (!foundryEndpoint || !key) {
      browserSocket.send(JSON.stringify({ type: 'xi.error', message: 'AZURE_FOUNDRY_ENDPOINT or AZURE_FOUNDRY_KEY is not set' }));
      browserSocket.close(1011, 'Missing Azure config');
      return;
    }

    const wsBase = foundryEndpoint.replace(/^https?:\/\//, '');
    const azureUrl = `wss://${wsBase}/openai/realtime?api-version=${encodeURIComponent(apiVersion)}&deployment=${encodeURIComponent(deployment)}`;

    request.log.info({ personaId, configId, deployment, apiVersion, wsBase }, 'Opening Azure Voice Live connection');

    const azureWs = new WebSocket(azureUrl, { headers: { 'api-key': key } });
    let sessionInitialized = false;
    const classifier = createClauseClassifier();

    azureWs.on('message', (rawMsg: Buffer | string) => {
      const msgStr = Buffer.isBuffer(rawMsg) ? rawMsg.toString('utf-8') : rawMsg;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(msgStr) as Record<string, unknown>;
      } catch {
        // Non-JSON message — forward as-is
        try { browserSocket.send(msgStr); } catch { /* browser may be closed */ }
        return;
      }

      const type = event['type'] as string;

      // On session.created: send our session.update, notify browser with xi.ready
      if (type === 'session.created' && !sessionInitialized) {
        sessionInitialized = true;
        const update = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: systemPrompt,
            voice: process.env['AZURE_SPEECH_DEFAULT_VOICE'] ?? 'zh-CN-XiaoxiaoMultilingualNeural',
            input_audio_format: 'pcm16',
            input_audio_sampling_rate: 24000,
            output_audio_format: 'pcm16',
            output_audio_sampling_rate: 24000,
            input_audio_transcription: { type: 'azure_default' },
            turn_detection: {
              type: 'azure_semantic_vad_multilingual',
              silence_duration_ms: 600,
              prefix_padding_ms: 200,
              create_response: true,
              languages: ['zh-CN', 'en-US'],
            },
            animation: { outputs: ['viseme_id'] },
            temperature: (config.personality as Record<string, unknown> | undefined)?.['defaultTemperature'] as number ?? 0.85,
          },
        };
        azureWs.send(JSON.stringify(update));
        // Notify browser that the session is ready
        try { browserSocket.send(JSON.stringify({ type: 'xi.ready' })); } catch { /* browser may be closed */ }
        return;
      }

      // Intercept response.audio_transcript.delta: run clause classifier, inject expression events
      if (type === 'response.audio_transcript.delta') {
        const delta = (event['delta'] as string | undefined) ?? '';
        if (delta) {
          const exprEvents = classifier.feed(delta);
          if (exprEvents.length > 0) {
            try {
              browserSocket.send(JSON.stringify({ type: 'xi.expression', events: exprEvents }));
            } catch { /* browser may be closed */ }
          }
        }
        // Still forward the transcript delta
        try { browserSocket.send(msgStr); } catch { /* browser may be closed */ }
        return;
      }

      // Flush classifier on response.done
      if (type === 'response.done') {
        const finalEvents = classifier.flush();
        if (finalEvents.length > 0) {
          try {
            browserSocket.send(JSON.stringify({ type: 'xi.expression', events: finalEvents }));
          } catch { /* browser may be closed */ }
        }
        classifier.reset();
      }

      // Forward everything else to browser
      try { browserSocket.send(msgStr); } catch { /* browser may be closed */ }
    });

    azureWs.on('error', (err) => {
      // Log enough detail to diagnose auth / URL / region failures
      const extra = (err as NodeJS.ErrnoException & { statusCode?: number; body?: string });
      request.log.error(
        { message: err.message, statusCode: extra.statusCode, body: extra.body, azureUrl: wsBase },
        'Azure Voice Live WebSocket error',
      );
      const errMsg = JSON.stringify({ type: 'xi.error', message: `Azure Voice Live error: ${err.message}` });
      try { browserSocket.send(errMsg); } catch { /* browser may be closed */ }
      try { browserSocket.close(1011, 'Azure connection error'); } catch { /* already closing */ }
    });

    azureWs.on('close', (code, reason) => {
      request.log.info({ code, reason: reason.toString() }, 'Azure Voice Live connection closed');
      try { browserSocket.close(1000, 'Azure closed'); } catch { /* already closed */ }
    });

    // Browser → Azure
    browserSocket.on('message', (rawMsg) => {
      if (azureWs.readyState === WebSocket.OPEN) {
        azureWs.send(rawMsg as Buffer);
      }
    });

    browserSocket.on('close', (code, reason) => {
      request.log.info({ code, reason: reason?.toString() }, 'Browser Voice Live connection closed');
      if (azureWs.readyState === WebSocket.OPEN || azureWs.readyState === WebSocket.CONNECTING) {
        azureWs.close(1000, 'Browser disconnected');
      }
    });

    browserSocket.on('error', (err) => {
      request.log.error({ err }, 'Browser WebSocket error in voice-live');
      if (azureWs.readyState === WebSocket.OPEN || azureWs.readyState === WebSocket.CONNECTING) {
        azureWs.close(1011, 'Browser error');
      }
    });
  });
}
