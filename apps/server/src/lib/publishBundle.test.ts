import { describe, it, expect } from 'vitest';
import { StudioBundleSchema } from '@xiaomu/contracts';
import { DEFAULT_CONFIG } from './seeds.js';
import { buildBundle, resolvePublishedBy } from './publishBundle.js';

const NOW = '2026-06-25T00:00:00.000Z';

describe('publishBundle', () => {
  it('builds a schema-valid StudioBundle from the seed config', async () => {
    const bundle = await buildBundle(DEFAULT_CONFIG, NOW, 'tester@example.com');
    expect(() => StudioBundleSchema.parse(bundle)).not.toThrow();
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.version).toBeGreaterThanOrEqual(1);
    expect(bundle.publishedAt).toBe(NOW);
    expect(bundle.publishedBy).toBe('tester@example.com');
  });

  it('hashes the local audio library into sha256 manifest entries', async () => {
    const bundle = await buildBundle(DEFAULT_CONFIG, NOW, 'x');
    expect(bundle.audioManifest.length).toBeGreaterThan(0);
    for (const e of bundle.audioManifest) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.id).toBe(e.filename);
      expect(e.mimeType).toMatch(/^audio\//);
      expect(e.durationMs).toBe(0);
    }
  });

  it('resolvePublishedBy returns a non-empty identity', () => {
    expect(resolvePublishedBy().length).toBeGreaterThan(0);
  });
});
