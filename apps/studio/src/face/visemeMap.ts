/**
 * Azure TTS viseme IDs (0–21) → mouth shape parameters.
 * Reference: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 *
 * VERIFIED (C3 spike, 2026-05-27): zh-CN-XiaoxiaoMultilingualNeural returns
 * VisemeReceived events for zh-CN text. Result: PASS — 58 events, 12 distinct
 * IDs, 85.7% audio coverage, 538ms trailing gap at end.
 * Distinct IDs observed: [0,1,2,6,7,8,12,15,16,19,20,21]
 * No audio-envelope fallback needed for zh-CN in this region/voice.
 * See scripts/viseme-spike-result.json for the full event log.
 */

import type { MouthParams } from './expressions.js';

const m = (width: number, curve: number, open = 0, round = false): MouthParams => ({
  width, curve, open, round,
});

/**
 * Viseme ID → mouth shape.
 * Shapes chosen to be visually distinct at small SVG scale.
 *
 * Groups:
 *   0         = silence / rest
 *   1,2,11    = open vowels (ah, aa, at)
 *   3,7,8,9,10= rounded lips (ao, w, ow, aw, oy)
 *   4,5,6     = mid vowels (ey, er, iy)
 *   12,13     = aspirated/rhotic (h, r)
 *   14        = lateral (l)
 *   15        = sibilant (s, z)
 *   16        = palato-alveolar (sh, ch)
 *   17        = dental (th)
 *   18        = labiodental (f, v)
 *   19        = alveolar stop (d, t, n)
 *   20        = velar (k, g, ng)
 *   21        = bilabial (p, b, m)
 */
export const VISEME_MOUTH: Record<number, MouthParams> = {
  0:  m(26, 8, 0),          // silence — baseline slight smile
  1:  m(26, 4, 10),         // ae/ah — open, slight smile
  2:  m(28, 2, 16),         // aa — wide open
  3:  m(16, 4, 8, true),    // ao — rounded
  4:  m(24, 5, 7),          // ey/eh — mid open
  5:  m(22, 3, 6),          // er — mid, slightly rounded
  6:  m(18, 6, 4),          // iy/ih — narrow horizontal
  7:  m(12, 3, 6, true),    // w/uw — pucker/round
  8:  m(14, 3, 8, true),    // ow — round moderate
  9:  m(20, 2, 14),         // aw — open round
  10: m(14, 3, 9, true),    // oy — round
  11: m(28, 2, 13),         // ah/at — open
  12: m(22, 4, 5),          // h — lightly open
  13: m(22, 4, 5),          // r — lightly open
  14: m(24, 5, 4),          // l — slight open, tongue implied
  15: m(20, 3, 1),          // s/z — near-closed, teeth
  16: m(18, 3, 5),          // sh/ch — slightly open, rounded
  17: m(22, 2, 3),          // th — slight open, dental
  18: m(20, 2, 2),          // f/v — barely open, lower lip up
  19: m(22, 3, 0),          // d/t/n — closed-ish stop
  20: m(22, 4, 4),          // k/g/ng — slight open, back
  21: m(18, 2, 0),          // p/b/m — bilabial closure → appears closed
};

/** Fall back to silence shape for unknown IDs */
export function getMouthForViseme(visemeId: number): MouthParams {
  return VISEME_MOUTH[visemeId] ?? VISEME_MOUTH[0]!;
}

// ── Mock viseme sequence ──────────────────────────────────────────────────────

export interface VisemeEvent {
  visemeId: number;
  audioOffsetMs: number;
}

/**
 * Mock viseme sequence approximating "你好，我是小沐" (Nǐ hǎo, wǒ shì Xiǎo Mù).
 * Timing based on ~450–500ms per syllable at relaxed speech rate.
 *
 * Phoneme map (approximate zh-CN → closest Azure viseme ID):
 *   n  → 19   i  → 6    h  → 12   ao → 9
 *   w  → 7    o  → 8    sh → 16   i  → 6
 *   x  → 15   iao→ 9    m  → 21   u  → 7
 */
export const MOCK_VISEME_SEQUENCE: VisemeEvent[] = [
  // 你 (nǐ)
  { visemeId: 19, audioOffsetMs: 0 },     // n
  { visemeId: 6,  audioOffsetMs: 80 },    // i
  // 好 (hǎo)
  { visemeId: 0,  audioOffsetMs: 210 },   // pause
  { visemeId: 12, audioOffsetMs: 300 },   // h
  { visemeId: 9,  audioOffsetMs: 390 },   // ao
  // ，pause
  { visemeId: 0,  audioOffsetMs: 560 },
  // 我 (wǒ)
  { visemeId: 7,  audioOffsetMs: 700 },   // w
  { visemeId: 8,  audioOffsetMs: 790 },   // o
  // 是 (shì)
  { visemeId: 0,  audioOffsetMs: 940 },
  { visemeId: 16, audioOffsetMs: 1050 },  // sh
  { visemeId: 6,  audioOffsetMs: 1140 },  // i
  // 小 (xiǎo)
  { visemeId: 0,  audioOffsetMs: 1290 },
  { visemeId: 15, audioOffsetMs: 1400 },  // x (sibilant)
  { visemeId: 6,  audioOffsetMs: 1460 },  // i
  { visemeId: 9,  audioOffsetMs: 1530 },  // ao
  // 沐 (mù)
  { visemeId: 0,  audioOffsetMs: 1680 },
  { visemeId: 21, audioOffsetMs: 1780 },  // m (bilabial close)
  { visemeId: 7,  audioOffsetMs: 1850 },  // u
  // end
  { visemeId: 0,  audioOffsetMs: 2050 },
];

export const MOCK_UTTERANCE_DURATION_MS = 2400;

/**
 * Expression timeline that accompanies the mock utterance.
 * expression id + offset into the utterance in ms.
 */
export interface ExpressionCue {
  expressionId: string;
  audioOffsetMs: number;
}

export const MOCK_EXPRESSION_TIMELINE: ExpressionCue[] = [
  { expressionId: 'calm',      audioOffsetMs: 0 },
  { expressionId: 'listening', audioOffsetMs: 500 },
  { expressionId: 'gentle',    audioOffsetMs: 1100 },
  { expressionId: 'happy',     audioOffsetMs: 1700 },   // says own name "小沐"
  { expressionId: 'calm',      audioOffsetMs: 2100 },
];
