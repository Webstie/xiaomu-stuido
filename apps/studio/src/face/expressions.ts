import type { ExpressionId } from '@xiaomu/contracts';

/**
 * Parameters that drive the SVG2D face for a given expression.
 *
 * Coordinate system: viewBox 0 0 320 200.
 * Eye centers: L(105,85) R(215,85). Mouth center: (160,148).
 *
 * eyeRy is the "target" open ry; blink multiplies this to 0.
 * mouthCurve > 0 = smile (control point pulled down in SVG y).
 * mouthCurve < 0 = frown.
 * mouthOpen > 0 adds a filled jaw arc below the lip line.
 */
export interface EyeParams {
  rx: number;           // horizontal radius
  ry: number;           // vertical radius (open state)
  squintTop: number;    // 0=normal arc, 1=completely flat top (sleepy)
}

export interface MouthParams {
  width: number;        // half-width of mouth arc
  curve: number;        // control-point y offset: >0=smile, <0=frown
  open: number;         // jaw opening height (0=closed lips)
  round: boolean;       // O-shape for surprised/singing
}

export interface ExpressionDef {
  id: ExpressionId;
  label: string;
  color: string;         // glow + accent hex
  leftEye: EyeParams;
  rightEye: EyeParams;
  mouth: MouthParams;
  headTilt: number;      // degrees (positive = right lean)
  glowStrength: number;  // 1–3 multiplier on the drop-shadow
  idleBias: number;      // 0–1: how much idle modulation applies (0 = frozen intense)
  ssmlStyleHint: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const eye = (rx: number, ry: number, squintTop = 0): EyeParams => ({ rx, ry, squintTop });
const mouth = (width: number, curve: number, open = 0, round = false): MouthParams => ({ width, curve, open, round });

// ── 16 expressions ───────────────────────────────────────────────────────────

export const EXPRESSIONS: Record<ExpressionId, ExpressionDef> = {
  happy: {
    id: 'happy',
    label: '开心',
    color: '#f59e0b',
    leftEye:  eye(22, 7),          // squinted from joy
    rightEye: eye(22, 7),
    mouth: mouth(34, 22, 2),       // wide smile, slightly open
    headTilt: 2,
    glowStrength: 2.5,
    idleBias: 0.6,
    ssmlStyleHint: 'cheerful',
  },

  excited: {
    id: 'excited',
    label: '兴奋',
    color: '#f97316',
    leftEye:  eye(19, 19),         // wide circular eyes
    rightEye: eye(19, 19),
    mouth: mouth(36, 22, 10),      // big open smile
    headTilt: -3,
    glowStrength: 3,
    idleBias: 0.3,
    ssmlStyleHint: 'excited',
  },

  calm: {
    id: 'calm',
    label: '平静',
    color: '#38bdf8',
    leftEye:  eye(20, 13),
    rightEye: eye(20, 13),
    mouth: mouth(28, 8, 0),        // gentle smile
    headTilt: 0,
    glowStrength: 1.2,
    idleBias: 1,
    ssmlStyleHint: 'calm',
  },

  gentle: {
    id: 'gentle',
    label: '温柔',
    color: '#6ee7b7',
    leftEye:  eye(18, 11),
    rightEye: eye(18, 11),
    mouth: mouth(24, 10, 0),       // soft small smile
    headTilt: 1,
    glowStrength: 1,
    idleBias: 1,
    ssmlStyleHint: 'gentle',
  },

  listening: {
    id: 'listening',
    label: '倾听',
    color: '#818cf8',
    leftEye:  eye(20, 15),
    rightEye: eye(20, 15),
    mouth: mouth(22, 4, 0),        // attentive neutral
    headTilt: 3,                   // slight lean-in tilt
    glowStrength: 1.5,
    idleBias: 0.8,
    ssmlStyleHint: 'gentle',
  },

  curious: {
    id: 'curious',
    label: '好奇',
    color: '#a3e635',
    leftEye:  eye(20, 18),         // left eye slightly bigger
    rightEye: eye(18, 14),         // asymmetric
    mouth: mouth(24, 7, 0),
    headTilt: -4,                  // quizzical tilt
    glowStrength: 1.8,
    idleBias: 0.7,
    ssmlStyleHint: 'curious',
  },

  thinking: {
    id: 'thinking',
    label: '思考',
    color: '#94a3b8',
    leftEye:  eye(19, 11),
    rightEye: eye(19, 11),
    mouth: mouth(20, 1, 0),        // pursed, nearly flat
    headTilt: -5,                  // looking away
    glowStrength: 1,
    idleBias: 0.5,
    ssmlStyleHint: 'calm',
  },

  sad: {
    id: 'sad',
    label: '难过',
    color: '#6366f1',
    leftEye:  eye(20, 9, 0.3),     // drooped tops
    rightEye: eye(20, 9, 0.3),
    mouth: mouth(28, -14, 0),      // frown
    headTilt: 1,
    glowStrength: 1,
    idleBias: 0.9,
    ssmlStyleHint: 'sad',
  },

  anxious: {
    id: 'anxious',
    label: '紧张',
    color: '#f43f5e',
    leftEye:  eye(17, 16),         // wide, slightly narrow
    rightEye: eye(17, 16),
    mouth: mouth(22, -5, 0),       // slight frown, tense
    headTilt: -2,
    glowStrength: 2,
    idleBias: 0.4,
    ssmlStyleHint: 'calm',
  },

  sleepy: {
    id: 'sleepy',
    label: '困倦',
    color: '#c084fc',
    leftEye:  eye(22, 6, 0.65),    // half-closed with flat top
    rightEye: eye(22, 6, 0.65),
    mouth: mouth(26, 3, 0),        // barely-there smile
    headTilt: 2,
    glowStrength: 0.8,
    idleBias: 1,
    ssmlStyleHint: 'calm',
  },

  surprised: {
    id: 'surprised',
    label: '惊讶',
    color: '#fbbf24',
    leftEye:  eye(18, 20),         // maximum vertical
    rightEye: eye(18, 20),
    mouth: mouth(14, 0, 14, true), // O-shape
    headTilt: 0,
    glowStrength: 3,
    idleBias: 0.2,
    ssmlStyleHint: 'excited',
  },

  celebrating: {
    id: 'celebrating',
    label: '庆祝',
    color: '#ec4899',
    leftEye:  eye(18, 17),
    rightEye: eye(18, 17),
    mouth: mouth(34, 22, 8),       // big open smile, similar to excited
    headTilt: -4,
    glowStrength: 3,
    idleBias: 0.2,
    ssmlStyleHint: 'excited',
  },

  proud: {
    id: 'proud',
    label: '自豪',
    color: '#a78bfa',
    leftEye:  eye(22, 12),         // wide, confident
    rightEye: eye(22, 12),
    mouth: mouth(30, 11, 0),       // composed smile
    headTilt: -2,                  // slight upward tilt
    glowStrength: 1.8,
    idleBias: 0.7,
    ssmlStyleHint: 'gentle',
  },

  confused: {
    id: 'confused',
    label: '困惑',
    color: '#fb923c',
    leftEye:  eye(20, 14),
    rightEye: eye(16, 11, 0.2),    // right eye squinted/raised
    mouth: mouth(20, -2, 0),       // crooked, slight downward
    headTilt: 5,
    glowStrength: 1.5,
    idleBias: 0.6,
    ssmlStyleHint: 'calm',
  },

  playful: {
    id: 'playful',
    label: '俏皮',
    color: '#34d399',
    leftEye:  eye(22, 8),          // squinted wink-like
    rightEye: eye(22, 14),         // one more open
    mouth: mouth(30, 17, 2),       // big grin
    headTilt: -3,
    glowStrength: 2,
    idleBias: 0.5,
    ssmlStyleHint: 'cheerful',
  },

  encouraging: {
    id: 'encouraging',
    label: '鼓励',
    color: '#60a5fa',
    leftEye:  eye(20, 13),
    rightEye: eye(20, 13),
    mouth: mouth(30, 15, 0),       // warm confident smile
    headTilt: 1,
    glowStrength: 1.8,
    idleBias: 0.9,
    ssmlStyleHint: 'cheerful',
  },
};

export const EXPRESSION_LIST = Object.values(EXPRESSIONS);
