/**
 * Publish-bundle assembly.
 *
 * Turns the active StudioConfig draft + the local audio library into a
 * frozen `StudioBundle` (the studio→robot contract). Pure-ish: all disk
 * access is funnelled through fileStore so the builder stays unit-testable.
 *
 * Version scheme: data/published/v{N}.json holds each published bundle;
 * data/published/active.json is the rollback pointer the robot reads to know
 * which version is live. Publishing writes the next N and points active at it;
 * rollback just repoints active at an older, already-published N.
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import {
  StudioBundleSchema,
  type StudioBundle,
  type AudioManifestEntry,
  type StudioConfig,
} from '@xiaomu/contracts';
import { getDataPath, readJson, ensureDir } from './fileStore.js';

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};
const AUDIO_EXTS = new Set(Object.keys(AUDIO_MIME));

const PUBLISHED_DIR = 'published';
const ACTIVE_POINTER = `${PUBLISHED_DIR}/active.json`;
const VERSION_RE = /^v(\d+)\.json$/;

export interface ActivePointer {
  version: number;
  publishedAt: string;
}

export interface PublishedVersion {
  version: number;
  publishedAt: string;
  publishedBy: string;
  active: boolean;
}

/** git user.email, falling back to the OS username, for `publishedBy`. */
export function resolvePublishedBy(): string {
  try {
    const email = execFileSync('git', ['config', 'user.email'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (email) return email;
  } catch {
    // not a git repo / git absent — fall through to OS username
  }
  return os.userInfo().username;
}

/**
 * Hash every file in data/audio/ into an AudioManifestEntry. We include the
 * WHOLE library, not just config-referenced files, because references are
 * scattered across many config fields (allowlists, activity audioFilenames,
 * comfortMusicFiles, co-creation mappings, …) and a missing clip is a silent
 * robot failure. The robot resolves each entry by sha256 against its local
 * cache; durationMs is read at play time, so it is left 0 here.
 */
export async function buildAudioManifest(): Promise<AudioManifestEntry[]> {
  await ensureDir('audio');
  const dir = getDataPath('audio');
  const names = await fs.readdir(dir);
  const audioNames = names
    .filter((n) => AUDIO_EXTS.has(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));

  return Promise.all(
    audioNames.map(async (filename): Promise<AudioManifestEntry> => {
      const buf = await fs.readFile(path.join(dir, filename));
      const ext = path.extname(filename).toLowerCase();
      return {
        id: filename,
        filename,
        sha256: createHash('sha256').update(buf).digest('hex'),
        mimeType: AUDIO_MIME[ext] ?? 'application/octet-stream',
        durationMs: 0, // reason: resolved at play time by the robot's audio element
        tags: [],
      };
    }),
  );
}

/** Highest published version N (0 if none published yet). */
export async function latestVersion(): Promise<number> {
  let max = 0;
  try {
    for (const name of await fs.readdir(getDataPath(PUBLISHED_DIR))) {
      const m = VERSION_RE.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    // published dir doesn't exist yet → 0
  }
  return max;
}

/** List every published version with its active flag, newest first. */
export async function listVersions(): Promise<PublishedVersion[]> {
  const active = await readJson<ActivePointer>(ACTIVE_POINTER);
  const out: PublishedVersion[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(getDataPath(PUBLISHED_DIR));
  } catch {
    return out;
  }
  for (const name of names) {
    if (!VERSION_RE.test(name)) continue;
    const bundle = await readJson<StudioBundle>(`${PUBLISHED_DIR}/${name}`);
    if (!bundle) continue;
    out.push({
      version: bundle.version,
      publishedAt: bundle.publishedAt,
      publishedBy: bundle.publishedBy,
      active: active?.version === bundle.version,
    });
  }
  return out.sort((a, b) => b.version - a.version);
}

/**
 * Assemble (but do not persist) the next StudioBundle from a config. Stamped
 * with `nowIso` rather than calling Date inside so the builder is deterministic
 * under test. Throws if the result fails StudioBundleSchema — a bad bundle must
 * never reach the robot.
 */
export async function buildBundle(
  config: StudioConfig,
  nowIso: string,
  publishedBy: string,
): Promise<StudioBundle> {
  const version = (await latestVersion()) + 1;
  const bundle: StudioBundle = {
    schemaVersion: 1,
    version,
    publishedAt: nowIso,
    publishedBy,
    config,
    audioManifest: await buildAudioManifest(),
  };
  return StudioBundleSchema.parse(bundle);
}

/** Persist a bundle as v{N}.json and repoint `active` at it. */
export async function persistBundle(bundle: StudioBundle): Promise<void> {
  await ensureDir(PUBLISHED_DIR);
  const file = getDataPath(`${PUBLISHED_DIR}/v${bundle.version}.json`);
  await fs.writeFile(file, JSON.stringify(bundle, null, 2), 'utf-8');
  await writeActive({ version: bundle.version, publishedAt: bundle.publishedAt });
}

async function writeActive(p: ActivePointer): Promise<void> {
  await ensureDir(PUBLISHED_DIR);
  await fs.writeFile(getDataPath(ACTIVE_POINTER), JSON.stringify(p, null, 2), 'utf-8');
}

/** Repoint `active` at an already-published version (one-click rollback). */
export async function rollbackTo(version: number): Promise<ActivePointer> {
  const bundle = await readJson<StudioBundle>(`${PUBLISHED_DIR}/v${version}.json`);
  if (!bundle) throw new Error(`Cannot roll back: v${version} does not exist`);
  const pointer: ActivePointer = { version, publishedAt: bundle.publishedAt };
  await writeActive(pointer);
  return pointer;
}

export async function getActive(): Promise<ActivePointer | null> {
  return readJson<ActivePointer>(ACTIVE_POINTER);
}
