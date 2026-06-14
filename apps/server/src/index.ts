import { config as dotenvLoad } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
// pnpm runs scripts from apps/server/, not repo root — load .env explicitly
dotenvLoad({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ensureDir, fileExists, writeJson } from './lib/fileStore.js';
import { DEFAULT_CONFIG } from './lib/seeds.js';
import { registerChatRoute } from './routes/chat.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerTtsRoutes } from './routes/tts.js';
import { registerVoiceLiveRoute } from './routes/voice-live.js';
import { registerAudioRoutes } from './routes/audio.js';
import { registerClassifyRoute } from './routes/classify.js';
import { registerRiskRoute } from './routes/risk.js';

const PORT = parseInt(process.env['PORT'] ?? '8787', 10);

// ── Bootstrap data dir on startup ─────────────────────────────────────────────
async function bootstrapData(): Promise<void> {
  await ensureDir('configs');
  await ensureDir('audio');
  await ensureDir('published');

  if (!(await fileExists('configs/default.json'))) {
    await writeJson('configs/default.json', DEFAULT_CONFIG);
  }
}

// ── Fastify ───────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  },
});

await app.register(cors, {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
});
await app.register(websocket);

// ── Auth middleware stub (swap for Entra later) ───────────────────────────────
app.addHook('onRequest', async (req) => {
  // reason: req.user typed as any to allow future Entra swap without route changes
  (req as any).user = { id: 'local-dev' };
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

await registerChatRoute(app);
await registerConfigRoutes(app);
await registerTtsRoutes(app);
await registerRiskRoute(app);
await registerVoiceLiveRoute(app);
await registerAudioRoutes(app);
await registerClassifyRoute(app);

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await bootstrapData();
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
