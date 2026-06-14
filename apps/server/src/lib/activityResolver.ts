/**
 * Resolves an activity's scripted content for the current child's age.
 *
 * Supports both:
 *  - `activity.scripted`        — age-bucketed sections (body-rhythm, breathing)
 *  - `activity.emotionScripted` — one section per emotion (emotion-music-mapping)
 *
 * Returns `null` when the activity has no scripted content (e.g. co-creation).
 */
import type { Activity } from '@xiaomu/contracts';

export interface ResolvedActivityScript {
  /** Ordered narration sections — one per chat turn. */
  sections: string[];
  /** Audio files to play during the activity. Aligned 1:1 with sections when emotion-bucketed; shared backdrop when age-bucketed. */
  audioPlaylist: string[];
  /** Human-readable label for the matched bucket, used in logs and prompt. */
  bucketLabel: string;
  /** Discriminator so callers can render differently if needed. */
  kind: 'age' | 'emotion';
}

export function resolveActivityScript(
  activity: Activity,
  childAge: number,
): ResolvedActivityScript | null {
  if (activity.scripted) {
    const bucket = activity.scripted.ageBuckets.find(
      (b) => childAge >= b.minAge && childAge <= b.maxAge,
    );
    if (!bucket) return null;
    const sections = bucket.narrationScript
      ? bucket.narrationScript
          .split(/\n\s*\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
    return {
      sections,
      audioPlaylist: bucket.audioFilenames,
      bucketLabel: `ages ${bucket.minAge}–${bucket.maxAge}`,
      kind: 'age',
    };
  }

  if (activity.emotionScripted) {
    const { emotionBuckets: buckets, closingScript } = activity.emotionScripted;
    const sections: string[] = [];
    const audioPlaylist: string[] = [];
    // STRICT 1:1 — each iteration pushes one section + one audio. A bucket
    // expands into `repeatCount` consecutive sections (same narration, same
    // first audio) so the child can sit with that emotion longer.
    // Buckets are processed in array order; the panel reorders to control
    // the activity's flow.
    for (const b of buckets) {
      if (b.narrationScript.trim().length === 0) continue;
      const count = Math.max(1, b.repeatCount ?? 1);
      const audio = b.audioFilenames[0] ?? '';
      for (let i = 0; i < count; i++) {
        sections.push(b.narrationScript);
        audioPlaylist.push(audio);
      }
    }
    // Optional closing line — spoken once, no audio.
    if (closingScript && closingScript.trim().length > 0) {
      sections.push(closingScript.trim());
      audioPlaylist.push('');
    }
    return {
      sections,
      audioPlaylist,
      bucketLabel: `${buckets.length} emotion${buckets.length === 1 ? '' : 's'}`,
      kind: 'emotion',
    };
  }

  return null;
}
