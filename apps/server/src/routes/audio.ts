/**
 * Audio library routes.
 *
 *   GET /api/audio                 → list audio files in ./data/audio/
 *   GET /api/audio/file/:filename  → stream a single file (HTTP Range supported)
 *
 * Filenames are validated with path.basename to block path traversal.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { getDataPath, ensureDir } from '../lib/fileStore.js';

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac']);

const MIME: Record<string, string> = {
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.m4a':  'audio/mp4',
  '.ogg':  'audio/ogg',
  '.aac':  'audio/aac',
  '.flac': 'audio/flac',
};

export interface AudioFileEntry {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  modifiedMs: number;
}

export async function registerAudioRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audio', async () => {
    await ensureDir('audio');
    const dir = getDataPath('audio');
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()))
        .map(async (e): Promise<AudioFileEntry> => {
          const stat = await fs.stat(path.join(dir, e.name));
          const ext = path.extname(e.name).toLowerCase();
          return {
            filename: e.name,
            sizeBytes: stat.size,
            mimeType: MIME[ext] ?? 'application/octet-stream',
            modifiedMs: stat.mtimeMs,
          };
        }),
    );

    return files.sort((a, b) =>
      a.filename.localeCompare(b.filename, 'en', { numeric: true, sensitivity: 'base' }),
    );
  });

  app.get<{ Params: { filename: string } }>(
    '/api/audio/file/:filename',
    async (request, reply) => {
      const requested = request.params.filename;
      const safeName = path.basename(requested);
      if (safeName !== requested) {
        return reply.status(400).send({ error: 'Invalid filename' });
      }

      const ext = path.extname(safeName).toLowerCase();
      if (!AUDIO_EXTS.has(ext)) {
        return reply.status(404).send({ error: 'Not an audio file' });
      }

      const fullPath = getDataPath(path.join('audio', safeName));
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        return reply.status(404).send({ error: 'File not found' });
      }

      const mimeType = MIME[ext] ?? 'application/octet-stream';
      const totalSize = stat.size;
      const range = request.headers.range;

      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (match) {
          const start = parseInt(match[1]!, 10);
          const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
          if (start >= totalSize || end >= totalSize || start > end) {
            return reply
              .status(416)
              .header('Content-Range', `bytes */${totalSize}`)
              .send({ error: 'Range not satisfiable' });
          }
          reply
            .status(206)
            .header('Content-Type', mimeType)
            .header('Content-Length', end - start + 1)
            .header('Content-Range', `bytes ${start}-${end}/${totalSize}`)
            .header('Accept-Ranges', 'bytes');
          return reply.send(createReadStream(fullPath, { start, end }));
        }
      }

      reply
        .header('Content-Type', mimeType)
        .header('Content-Length', totalSize)
        .header('Accept-Ranges', 'bytes');
      return reply.send(createReadStream(fullPath));
    },
  );
}
