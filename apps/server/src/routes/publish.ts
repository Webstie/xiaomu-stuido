/**
 * Publish routes — snapshot the active config into a versioned StudioBundle
 * and manage rollback.
 *
 *   POST /api/publish              → publish current draft → data/published/v{N}.json
 *   GET  /api/publish              → list versions + which is active
 *   GET  /api/publish/active       → active pointer (what the robot loads)
 *   POST /api/publish/rollback     → { version } → repoint active at an older N
 */
import type { FastifyInstance } from 'fastify';
import { StudioConfigSchema, type StudioConfig } from '@xiaomu/contracts';
import { readJson } from '../lib/fileStore.js';
import {
  buildBundle,
  persistBundle,
  listVersions,
  rollbackTo,
  getActive,
  resolvePublishedBy,
} from '../lib/publishBundle.js';

const DEFAULT_CONFIG_ID = 'default';

export async function registerPublishRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/publish', async (request, reply) => {
    const { configId } = (request.body ?? {}) as { configId?: string };
    const id = configId ?? DEFAULT_CONFIG_ID;

    const raw = await readJson<StudioConfig>(`configs/${id}.json`);
    if (!raw) return reply.status(404).send({ error: `Config not found: ${id}` });

    // Validate the draft before freezing it — a bad bundle must never ship.
    const parsed = StudioConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Config is invalid; fix it before publishing', details: parsed.error.flatten() });
    }

    try {
      const bundle = await buildBundle(parsed.data, new Date().toISOString(), resolvePublishedBy());
      await persistBundle(bundle);
      return {
        version: bundle.version,
        publishedAt: bundle.publishedAt,
        publishedBy: bundle.publishedBy,
        audioCount: bundle.audioManifest.length,
      };
    } catch (err) {
      app.log.error({ err }, 'publish failed');
      return reply.status(500).send({ error: 'Publish failed', message: String(err) });
    }
  });

  app.get('/api/publish', async () => {
    return { active: await getActive(), versions: await listVersions() };
  });

  app.get('/api/publish/active', async () => {
    return getActive();
  });

  app.post('/api/publish/rollback', async (request, reply) => {
    const { version } = (request.body ?? {}) as { version?: number };
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return reply.status(400).send({ error: 'Body must include integer `version` >= 1' });
    }
    try {
      return await rollbackTo(version);
    } catch (err) {
      return reply.status(404).send({ error: String(err) });
    }
  });
}
