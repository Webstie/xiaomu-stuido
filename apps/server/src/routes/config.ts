import type { FastifyInstance } from 'fastify';
import { StudioConfigSchema } from '@xiaomu/contracts';
import type { StudioConfig } from '@xiaomu/contracts';
import { readJson, writeJson } from '../lib/fileStore.js';

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/config/:id
  app.get('/api/config/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const config = await readJson<StudioConfig>(`configs/${id}.json`);
    if (!config) return reply.status(404).send({ error: `Config not found: ${id}` });
    return config;
  });

  // PUT /api/config/:id — replace full config. Server stamps updatedAt.
  app.put('/api/config/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = StudioConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Invalid config', details: parsed.error.flatten() });
    }
    const config: StudioConfig = {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(`configs/${id}.json`, config);
    return config;
  });
}
