/**
 * Daydream idle behavior loop.
 *
 * Three independent streams:
 *   1. Blink — random interval 3–5s, close+reopen over ~200ms
 *   2. Breathing sway — sine wave on Y, period ~4s, amplitude 1.5px
 *   3. Eye drift — occasional slow drift to a random gaze point, hold, return
 *
 * Returns a ref-based state object (updated every rAF tick).
 * Suppressed when `active = false`; resumes 500ms after last suppression.
 */

import { useEffect, useRef, useCallback } from 'react';

export interface IdleModifiers {
  blinkProgress: number;  // 0 = eyes fully open, 1 = fully closed
  breathOffsetY: number;  // px, applied to both eyes and mouth
  driftX: number;         // px, applied to both eyes
  driftY: number;         // px, applied to both eyes
}

const IDLE_ZERO: IdleModifiers = {
  blinkProgress: 0,
  breathOffsetY: 0,
  driftX: 0,
  driftY: 0,
};

interface IdleHookOptions {
  enabled: boolean;
  /** Time in ms after suppression ends before idle resumes. Default 500. */
  resumeDelayMs?: number;
  onFrame: (mods: IdleModifiers) => void;
}

export function useIdleBehavior({ enabled, resumeDelayMs = 500, onFrame }: IdleHookOptions): void {
  const stateRef = useRef({
    // blink
    nextBlinkAt: performance.now() + randomBetween(2000, 4000),
    blinkPhase: 'open' as 'open' | 'closing' | 'opening',
    blinkStartAt: 0,

    // breath
    breathStart: performance.now(),

    // drift
    driftStartAt: 0,
    driftDuration: 0,
    driftFromX: 0,
    driftFromY: 0,
    driftToX: 0,
    driftToY: 0,
    driftHoldUntil: 0,
    driftPhase: 'idle' as 'idle' | 'moving' | 'holding' | 'returning',
    nextDriftAt: performance.now() + randomBetween(5000, 10000),

    // suppression
    suppressedUntil: 0,
  });

  const rafRef = useRef<number>(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const tick = useCallback(() => {
    rafRef.current = requestAnimationFrame(tick);
    const now = performance.now();
    const s = stateRef.current;

    if (!enabled || now < s.suppressedUntil) {
      onFrameRef.current(IDLE_ZERO);
      return;
    }

    // ── Blink ────────────────────────────────────────────────────────────────
    let blinkProgress = 0;
    const CLOSE_MS = 90;
    const OPEN_MS = 110;

    if (s.blinkPhase === 'open' && now >= s.nextBlinkAt) {
      s.blinkPhase = 'closing';
      s.blinkStartAt = now;
    }

    if (s.blinkPhase === 'closing') {
      const t = Math.min(1, (now - s.blinkStartAt) / CLOSE_MS);
      blinkProgress = t;
      if (t >= 1) {
        s.blinkPhase = 'opening';
        s.blinkStartAt = now;
      }
    } else if (s.blinkPhase === 'opening') {
      const t = Math.min(1, (now - s.blinkStartAt) / OPEN_MS);
      blinkProgress = 1 - t;
      if (t >= 1) {
        s.blinkPhase = 'open';
        s.nextBlinkAt = now + randomBetween(3000, 5000);
      }
    }

    // ── Breath ───────────────────────────────────────────────────────────────
    const breathPeriodMs = 4200;
    const breathAmp = 1.5;
    const breathT = ((now - s.breathStart) % breathPeriodMs) / breathPeriodMs;
    const breathOffsetY = -Math.sin(breathT * 2 * Math.PI) * breathAmp; // negative = up

    // ── Eye drift ────────────────────────────────────────────────────────────
    let driftX = 0;
    let driftY = 0;
    const DRIFT_AMP_X = 7;
    const DRIFT_AMP_Y = 5;
    const DRIFT_MOVE_MS = 900;

    if (s.driftPhase === 'idle' && now >= s.nextDriftAt) {
      s.driftPhase = 'moving';
      s.driftStartAt = now;
      s.driftDuration = DRIFT_MOVE_MS;
      s.driftFromX = s.driftToX;
      s.driftFromY = s.driftToY;
      s.driftToX = randomBetween(-DRIFT_AMP_X, DRIFT_AMP_X);
      s.driftToY = randomBetween(-DRIFT_AMP_Y, DRIFT_AMP_Y);
      s.driftHoldUntil = now + DRIFT_MOVE_MS + randomBetween(800, 2000);
    }

    if (s.driftPhase === 'moving') {
      const t = Math.min(1, (now - s.driftStartAt) / s.driftDuration);
      const et = easeInOut(t);
      driftX = s.driftFromX + (s.driftToX - s.driftFromX) * et;
      driftY = s.driftFromY + (s.driftToY - s.driftFromY) * et;
      if (t >= 1) s.driftPhase = 'holding';
    } else if (s.driftPhase === 'holding') {
      driftX = s.driftToX;
      driftY = s.driftToY;
      if (now >= s.driftHoldUntil) {
        s.driftPhase = 'returning';
        s.driftStartAt = now;
        s.driftFromX = s.driftToX;
        s.driftFromY = s.driftToY;
        s.driftToX = 0;
        s.driftToY = 0;
      }
    } else if (s.driftPhase === 'returning') {
      const t = Math.min(1, (now - s.driftStartAt) / DRIFT_MOVE_MS);
      const et = easeInOut(t);
      driftX = s.driftFromX * (1 - et);
      driftY = s.driftFromY * (1 - et);
      if (t >= 1) {
        s.driftPhase = 'idle';
        s.nextDriftAt = now + randomBetween(6000, 12000);
        s.driftToX = 0;
        s.driftToY = 0;
      }
    }

    onFrameRef.current({ blinkProgress, breathOffsetY, driftX, driftY });
  }, [enabled]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);
}

/** Suppress idle for `durationMs` (called when speech starts) */
export function suppressIdle(stateRef: React.MutableRefObject<{ suppressedUntil: number }>, durationMs: number) {
  stateRef.current.suppressedUntil = performance.now() + durationMs;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
