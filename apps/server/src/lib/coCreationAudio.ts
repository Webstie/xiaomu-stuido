/**
 * Co-Creation audio resolver.
 *
 * Given an unordered set of 3 notes (e.g. ['Do','Mi','Sol']) and a variant
 * ('original'|'revised'|'background'), find a matching file in data/audio/.
 *
 * The library uses an inconsistent set of filename conventions accumulated
 * over time:
 *   - "Do, Mi, Sol (original).m4a"      ← comma-separated
 *   - "Do Mi Sol (revised).m4a"         ← no commas
 *   - "Re, Mi, So (orginal).m4a"        ← "So" not "Sol", typo "orginal"
 *   - "Re, Fa, Ti, (background).m4a"    ← trailing comma
 *   - "CDB  revised.m4a"                ← double space (handled at rename time)
 *
 * Strategy: read the audio dir, normalise each filename to a comparable form
 * (canonical note set + variant), then pick the first match.
 */
import fs from 'fs/promises';
import { getDataPath, ensureDir } from './fileStore.js';

export type CoCreationVariant = 'original' | 'revised' | 'background';

const NOTE_TOKEN = /\b(Do|Re|Mi|Fa|Sol|So|La|Ti|Si)\b/gi;

/** Canonicalise a note string for set comparison. Sol ≡ So, Ti ≡ Si, case-insensitive. */
function canonicalNote(note: string): string {
  const lower = note.toLowerCase();
  if (lower === 'so') return 'sol';
  if (lower === 'si') return 'ti';
  return lower;
}

function normalisedNoteSet(notes: string[]): string {
  return notes.map(canonicalNote).sort().join('|');
}

function detectVariant(basename: string): CoCreationVariant | null {
  const lower = basename.toLowerCase();
  if (lower.includes('background')) return 'background';
  if (lower.includes('revised')) return 'revised';
  // accept both "original" and the typo "orginal"
  if (lower.includes('original') || lower.includes('orginal')) return 'original';
  // bare name (no variant marker) — treat as original
  return 'original';
}

interface AudioIndex {
  /** key = `${variant}::${canonical_note_set}` → filename */
  byKey: Map<string, string>;
  /** all filenames with no extractable notes — kept for debug only */
  unmatched: string[];
}

async function buildIndex(): Promise<AudioIndex> {
  await ensureDir('audio');
  const dir = getDataPath('audio');
  const files = await fs.readdir(dir);
  const byKey = new Map<string, string>();
  const unmatched: string[] = [];

  for (const file of files) {
    if (!file.toLowerCase().endsWith('.m4a') && !file.toLowerCase().endsWith('.mp3')) continue;
    const base = file.replace(/\.(m4a|mp3)$/i, '');
    const noteMatches = base.match(NOTE_TOKEN);
    if (!noteMatches || noteMatches.length !== 3) {
      unmatched.push(file);
      continue;
    }
    const variant = detectVariant(base);
    if (!variant) continue;
    const key = `${variant}::${normalisedNoteSet(noteMatches)}`;
    // First write wins so a stable, consistent variant gets picked when there
    // are multiple matches (e.g. both "Do Mi Sol (revised)" and "Do, Mi, Sol (revised)").
    if (!byKey.has(key)) byKey.set(key, file);
  }

  return { byKey, unmatched };
}

export interface CoCreationOverride {
  notes: string[];
  variant: CoCreationVariant;
  filename: string;
}

/**
 * Look up the audio filename for a note triple + variant.
 *
 * Resolution order:
 *   1. Studio-configured overrides (audioMappings on the activity) — if a
 *      mapping matches by canonical note set + variant, use its filename.
 *   2. Filename-based auto-discovery from /data/audio/.
 *
 * Returns null if neither yields a match.
 */
export async function findCoCreationAudio(
  notes: string[],
  variant: CoCreationVariant,
  overrides?: readonly CoCreationOverride[],
): Promise<string | null> {
  if (notes.length !== 3) return null;
  const targetSet = normalisedNoteSet(notes);

  if (overrides && overrides.length > 0) {
    for (const o of overrides) {
      if (o.variant === variant && normalisedNoteSet(o.notes) === targetSet) {
        return o.filename;
      }
    }
  }

  const idx = await buildIndex();
  const key = `${variant}::${targetSet}`;
  return idx.byKey.get(key) ?? null;
}
