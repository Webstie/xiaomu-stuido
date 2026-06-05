/**
 * Cubic-bezier eased interpolation for face pose transitions.
 * Durations: 150ms (viseme snap) to 400ms (expression change).
 */

// Standard CSS ease-out — quick start, smooth deceleration (good for expression shifts)
export const EASE_OUT: [number, number, number, number] = [0.0, 0.0, 0.2, 1.0];
// Ease-in-out — symmetric (good for idle drift)
export const EASE_IN_OUT: [number, number, number, number] = [0.42, 0.0, 0.58, 1.0];
// Linear (blink snap)
export const LINEAR: [number, number, number, number] = [0.0, 0.0, 1.0, 1.0];

/**
 * Solve cubic bezier for eased t given raw progress t ∈ [0,1].
 * Uses Newton-Raphson iteration on the parametric form.
 */
export function cubicBezier(
  t: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Binary search for parametric u where Bx(u) ≈ t
  let u = t;
  for (let i = 0; i < 8; i++) {
    const bx = calcBezier(u, p1x, p2x) - t;
    const dbx = calcBezierDerivative(u, p1x, p2x);
    if (Math.abs(dbx) < 1e-6) break;
    u -= bx / dbx;
    u = Math.max(0, Math.min(1, u));
  }
  return calcBezier(u, p1y, p2y);
}

// B(t) = 3*(1-t)^2*t*p1 + 3*(1-t)*t^2*p2 + t^3
// Horner form: ((A*t + B)*t + C)*t  where A=1-3p2+3p1, B=3p2-6p1, C=3p1
function calcBezier(t: number, p1: number, p2: number): number {
  return ((1 - 3 * p2 + 3 * p1) * t * t + (3 * p2 - 6 * p1) * t + 3 * p1) * t;
}

function calcBezierDerivative(t: number, p1: number, p2: number): number {
  return 3 * (1 - 3 * p2 + 3 * p1) * t * t + 2 * (3 * p2 - 6 * p1) * t + 3 * p1;
}

/** Lerp between two values */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp between two hex color strings via RGB */
export function lerpColor(a: string, b: string, t: number): string {
  const ra = parseInt(a.slice(1, 3), 16);
  const ga = parseInt(a.slice(3, 5), 16);
  const ba = parseInt(a.slice(5, 7), 16);
  const rb = parseInt(b.slice(1, 3), 16);
  const gb = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(lerp(ra, rb, t));
  const g = Math.round(lerp(ga, gb, t));
  const bl = Math.round(lerp(ba, bb, t));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

/** A single in-flight tween from one value to another */
export interface Tween {
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
  bezier: [number, number, number, number];
}

export function makeTween(
  from: number,
  to: number,
  durationMs: number,
  bezier: [number, number, number, number] = EASE_OUT,
  nowMs: number = performance.now(),
): Tween {
  return { from, to, startMs: nowMs, durationMs, bezier };
}

export function sampleTween(tween: Tween, nowMs: number = performance.now()): number {
  const rawT = Math.min(1, (nowMs - tween.startMs) / tween.durationMs);
  const easedT = cubicBezier(rawT, ...tween.bezier);
  return lerp(tween.from, tween.to, easedT);
}

export function tweenDone(tween: Tween, nowMs: number = performance.now()): boolean {
  return nowMs >= tween.startMs + tween.durationMs;
}

/** Color tween */
export interface ColorTween {
  from: string;
  to: string;
  startMs: number;
  durationMs: number;
}

export function makeColorTween(from: string, to: string, durationMs: number): ColorTween {
  return { from, to, startMs: performance.now(), durationMs };
}

export function sampleColorTween(tween: ColorTween, nowMs: number = performance.now()): string {
  const t = Math.min(1, (nowMs - tween.startMs) / tween.durationMs);
  return lerpColor(tween.from, tween.to, t);
}
