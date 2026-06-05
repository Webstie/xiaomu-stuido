import { z } from 'zod';
import { StudioConfigSchema } from './config.js';
export const AudioManifestEntrySchema = z.object({
    id: z.string(),
    filename: z.string(),
    sha256: z.string(),
    mimeType: z.string(),
    durationMs: z.number().int().nonnegative(),
    tags: z.array(z.string()),
});
export const StudioBundleSchema = z.object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    publishedBy: z.string(),
    config: StudioConfigSchema,
    audioManifest: z.array(AudioManifestEntrySchema),
});
