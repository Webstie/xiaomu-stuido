import type { FastifyInstance } from 'fastify';
import { readJson, listJsonDir } from '../lib/fileStore.js';
import type { Persona } from '@xiaomu/contracts';

export async function registerPersonaRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/personas — list all
  app.get('/api/personas', async () => {
    const ids = await listJsonDir('personas');
    const personas = await Promise.all(
      ids.map((id) => readJson<Persona>(`personas/${id}.json`)),
    );
    return personas.filter((p): p is Persona => p !== null);
  });

  // GET /api/personas/:id
  app.get('/api/personas/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const persona = await readJson<Persona>(`personas/${id}.json`);
    if (!persona) return reply.status(404).send({ error: `Persona not found: ${id}` });
    return persona;
  });
}
