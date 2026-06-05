/**
 * SVG2DRenderer — Cozmo/EMO/Vector-style abstract LED face.
 *
 * ViewBox: 320 × 200
 * Eye centers: L(105, 85)  R(215, 85)
 * Mouth center: (160, 148)
 *
 * Three streams converge:
 *   1. Expression interpolation (cubic-bezier, 300ms)
 *   2. Idle: blink, breath sway, eye drift (always on unless suppressed)
 *   3. Viseme: mouth snap to phoneme shape (immediate, follows audio offset)
 *
 * All animation runs in a single rAF loop; React state is updated once per frame.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ExpressionId } from '@xiaomu/contracts';
import { EXPRESSIONS } from './expressions.js';
import type { EyeParams, MouthParams } from './expressions.js';
import { getMouthForViseme } from './visemeMap.js';
import type { VisemeEvent, ExpressionCue } from './visemeMap.js';
import { useIdleBehavior } from './idleBehavior.js';
import type { IdleModifiers } from './idleBehavior.js';
import {
  makeTween, sampleTween, makeColorTween, sampleColorTween,
  lerp, EASE_OUT,
} from './interpolate.js';
import type { Tween, ColorTween } from './interpolate.js';

// ── Render state ──────────────────────────────────────────────────────────────

interface EyeRenderState {
  rx: number;
  ry: number;          // already includes blink (0 = fully closed)
  squintTop: number;
  dx: number;          // drift + tilt
  dy: number;          // breath sway + drift
}

interface MouthRenderState {
  width: number;
  curve: number;
  open: number;
  round: boolean;
}

interface RenderState {
  leftEye: EyeRenderState;
  rightEye: EyeRenderState;
  mouth: MouthRenderState;
  color: string;
  glowStrength: number;
  tilt: number;
}

// ── Tween group for one expression ───────────────────────────────────────────

interface ExprTweens {
  lEyeRx: Tween; lEyeRy: Tween; lEyeSquint: Tween;
  rEyeRx: Tween; rEyeRy: Tween; rEyeSquint: Tween;
  mWidth: Tween; mCurve: Tween; mOpen: Tween;
  glowStrength: Tween;
  tilt: Tween;
  color: ColorTween;
}

const EXPR_TRANSITION_MS = 300;

function buildTweens(
  fromId: ExpressionId,
  toId: ExpressionId,
  now: number,
): ExprTweens {
  const f = EXPRESSIONS[fromId];
  const t = EXPRESSIONS[toId];
  const mt = (a: number, b: number) =>
    makeTween(a, b, EXPR_TRANSITION_MS, EASE_OUT, now);

  return {
    lEyeRx:     mt(f.leftEye.rx,     t.leftEye.rx),
    lEyeRy:     mt(f.leftEye.ry,     t.leftEye.ry),
    lEyeSquint: mt(f.leftEye.squintTop, t.leftEye.squintTop),
    rEyeRx:     mt(f.rightEye.rx,    t.rightEye.rx),
    rEyeRy:     mt(f.rightEye.ry,    t.rightEye.ry),
    rEyeSquint: mt(f.rightEye.squintTop, t.rightEye.squintTop),
    mWidth:     mt(f.mouth.width,    t.mouth.width),
    mCurve:     mt(f.mouth.curve,    t.mouth.curve),
    mOpen:      mt(f.mouth.open,     t.mouth.open),
    glowStrength: mt(f.glowStrength, t.glowStrength),
    tilt:       mt(f.headTilt,       t.headTilt),
    color: makeColorTween(f.color, t.color, EXPR_TRANSITION_MS),
  };
}

function sampleTweens(tw: ExprTweens, now: number) {
  return {
    lEyeRx:     sampleTween(tw.lEyeRx, now),
    lEyeRy:     sampleTween(tw.lEyeRy, now),
    lEyeSquint: sampleTween(tw.lEyeSquint, now),
    rEyeRx:     sampleTween(tw.rEyeRx, now),
    rEyeRy:     sampleTween(tw.rEyeRy, now),
    rEyeSquint: sampleTween(tw.rEyeSquint, now),
    mWidth:     sampleTween(tw.mWidth, now),
    mCurve:     sampleTween(tw.mCurve, now),
    mOpen:      sampleTween(tw.mOpen, now),
    glowStrength: sampleTween(tw.glowStrength, now),
    tilt:       sampleTween(tw.tilt, now),
    color: sampleColorTween(tw.color, now),
  };
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

/** Build the SVG eye clip path d-string with optional flat top (squintTop 0–1) */
function eyeClipPath(cx: number, cy: number, rx: number, ry: number, squintTop: number): string {
  // Full ellipse by default. When squintTop>0, flatten the upper half.
  if (squintTop <= 0.01) return ''; // use ellipse element directly
  // Clip by drawing a rect over the top portion
  const flatY = cy - ry * (1 - squintTop);
  return `M ${cx - rx - 4} ${flatY} L ${cx + rx + 4} ${flatY} L ${cx + rx + 4} ${cy + ry + 4} L ${cx - rx - 4} ${cy + ry + 4} Z`;
}

/** Build mouth arc path. curve>0 = smile */
function mouthPath(cx: number, cy: number, w: number, curve: number, open: number, round: boolean): string {
  if (round) {
    // O-shape — use SVG arc instead of path
    const ow = Math.max(4, open * 0.6 + 5);
    const oh = Math.max(4, open + 5);
    return `M ${cx - ow} ${cy} A ${ow} ${oh} 0 1 1 ${cx + ow} ${cy} A ${ow} ${oh} 0 1 1 ${cx - ow} ${cy} Z`;
  }

  // Upper lip arc
  const lx = cx - w;
  const rx = cx + w;
  const upper = `M ${lx} ${cy} Q ${cx} ${cy + curve} ${rx} ${cy}`;

  if (open <= 0.5) return upper;

  // Lower jaw arc to close the open-mouth shape
  const jawY = cy + open * 0.7;
  const jawCurve = curve * 0.6 + open * 0.3;
  const lower = ` Q ${cx} ${jawY + jawCurve} ${lx} ${cy} Z`;
  return upper + lower;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SVG2DRendererProps {
  expressionId: ExpressionId;
  visemeStream?: VisemeEvent[];
  visemePlaybackMs?: number;
  expressionTimeline?: ExpressionCue[];
  idleEnabled?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

// Eye center constants
const L_EYE = { cx: 105, cy: 85 };
const R_EYE = { cx: 215, cy: 85 };
const MOUTH = { cx: 160, cy: 148 };

// Initial render state (calm)
function initialState(): RenderState {
  const expr = EXPRESSIONS['calm'];
  return {
    leftEye:  { rx: expr.leftEye.rx,  ry: expr.leftEye.ry,  squintTop: 0, dx: 0, dy: 0 },
    rightEye: { rx: expr.rightEye.rx, ry: expr.rightEye.ry, squintTop: 0, dx: 0, dy: 0 },
    mouth: { ...expr.mouth },
    color: expr.color,
    glowStrength: expr.glowStrength,
    tilt: expr.headTilt,
  };
}

export default function SVG2DRenderer({
  expressionId,
  visemeStream,
  visemePlaybackMs,
  expressionTimeline,
  idleEnabled = true,
  width = 320,
  height = 200,
  className = '',
}: SVG2DRendererProps) {
  const [renderState, setRenderState] = useState<RenderState>(initialState);

  // Tween state (all in refs — not React state)
  const tweensRef = useRef<ExprTweens>(
    buildTweens('calm', 'calm', performance.now()),
  );
  const prevExprRef = useRef<ExpressionId>(expressionId);

  // Idle modifiers (written by useIdleBehavior callback)
  const idleRef = useRef<IdleModifiers>({
    blinkProgress: 0, breathOffsetY: 0, driftX: 0, driftY: 0,
  });

  // Viseme mouth (latest active viseme)
  const visemeMouthRef = useRef<MouthParams | null>(null);

  // Latest props in refs (avoid stale closures in rAF)
  const propsRef = useRef({ expressionId, visemeStream, visemePlaybackMs, expressionTimeline, idleEnabled });
  propsRef.current = { expressionId, visemeStream, visemePlaybackMs, expressionTimeline, idleEnabled };

  // ── Idle callback ───────────────────────────────────────────────────────────
  const onIdleFrame = useCallback((mods: IdleModifiers) => {
    idleRef.current = mods;
  }, []);

  useIdleBehavior({ enabled: idleEnabled ?? true, onFrame: onIdleFrame });

  // ── Main rAF loop ───────────────────────────────────────────────────────────
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const now = performance.now();
      const p = propsRef.current;

      // 1. Resolve active expression (may be overridden by timeline)
      let activeExpr: ExpressionId = p.expressionId;
      if (p.expressionTimeline && p.visemePlaybackMs !== undefined) {
        for (let i = p.expressionTimeline.length - 1; i >= 0; i--) {
          const cue = p.expressionTimeline[i]!;
          if (p.visemePlaybackMs >= cue.audioOffsetMs) {
            activeExpr = cue.expressionId as ExpressionId;
            break;
          }
        }
      }

      // 2. Start new tween if expression changed
      if (activeExpr !== prevExprRef.current) {
        tweensRef.current = buildTweens(prevExprRef.current, activeExpr, now);
        prevExprRef.current = activeExpr;
      }

      // 3. Sample expression tweens
      const tw = sampleTweens(tweensRef.current, now);

      // 4. Resolve viseme mouth override
      let activeMouth: MouthParams | null = null;
      if (p.visemeStream && p.visemePlaybackMs !== undefined && p.visemePlaybackMs >= 0) {
        let lastEvent: VisemeEvent | null = null;
        for (const ev of p.visemeStream) {
          if (ev.audioOffsetMs <= p.visemePlaybackMs) lastEvent = ev;
          else break;
        }
        if (lastEvent) {
          activeMouth = getMouthForViseme(lastEvent.visemeId);
        }
      }

      // 5. Suppress idle when visemes are active
      const idleSuppressed = activeMouth !== null;
      const idle = idleSuppressed ? { blinkProgress: 0, breathOffsetY: 0, driftX: 0, driftY: 0 } : idleRef.current;

      // 6. Combine expression tweens + idle + viseme
      const mouthBase = activeMouth ?? {
        width: tw.mWidth,
        curve: tw.mCurve,
        open: tw.mOpen,
        round: EXPRESSIONS[activeExpr].mouth.round,
      };

      // Blend mouth: viseme takes over open/width but preserves expression curve direction
      const finalMouth: MouthRenderState = activeMouth
        ? {
            width:  lerp(tw.mWidth, activeMouth.width,  0.7),
            curve:  lerp(tw.mCurve, activeMouth.curve,  0.5),
            open:   activeMouth.open,
            round:  activeMouth.round,
          }
        : { width: tw.mWidth, curve: tw.mCurve, open: tw.mOpen, round: mouthBase.round };

      const eyeOpenness = Math.max(0, 1 - idle.blinkProgress);
      const tiltRad = (tw.tilt * Math.PI) / 180;
      const eyeParallax = Math.sin(tiltRad) * 8;

      setRenderState({
        leftEye: {
          rx: tw.lEyeRx,
          ry: tw.lEyeRy * eyeOpenness,
          squintTop: tw.lEyeSquint,
          dx: idle.driftX - eyeParallax,
          dy: idle.breathOffsetY + idle.driftY,
        },
        rightEye: {
          rx: tw.rEyeRx,
          ry: tw.rEyeRy * eyeOpenness,
          squintTop: tw.rEyeSquint,
          dx: idle.driftX + eyeParallax,
          dy: idle.breathOffsetY + idle.driftY,
        },
        mouth: finalMouth,
        color: tw.color,
        glowStrength: tw.glowStrength,
        tilt: tw.tilt,
      });
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // runs once; reads latest props via refs

  // ── Render ──────────────────────────────────────────────────────────────────
  const { leftEye: le, rightEye: re, mouth: mo, color, glowStrength, tilt } = renderState;

  const glow = `drop-shadow(0 0 ${5 * glowStrength}px ${color}) drop-shadow(0 0 ${10 * glowStrength}px ${color}60)`;

  function Eye({ cfg, cx, cy }: { cfg: EyeRenderState; cx: number; cy: number }) {
    const ecx = cx + cfg.dx;
    const ecy = cy + cfg.dy;
    const ry = Math.max(0.5, cfg.ry);
    const clipId = `squint-${cx}`;

    return (
      <g>
        {cfg.squintTop > 0.02 && (
          <clipPath id={clipId}>
            {/* show only bottom portion of the eye ellipse */}
            <rect
              x={ecx - cfg.rx - 4}
              y={ecy - ry * (1 - cfg.squintTop)}
              width={cfg.rx * 2 + 8}
              height={ry * (1 + cfg.squintTop) + 4}
            />
          </clipPath>
        )}
        {/* Glow halo */}
        <ellipse
          cx={ecx} cy={ecy}
          rx={cfg.rx + 3} ry={ry + 3}
          fill={color}
          opacity={0.18 * glowStrength}
          clipPath={cfg.squintTop > 0.02 ? `url(#${clipId})` : undefined}
        />
        {/* Main eye */}
        <ellipse
          cx={ecx} cy={ecy}
          rx={cfg.rx} ry={ry}
          fill={color}
          style={{ filter: glow }}
          clipPath={cfg.squintTop > 0.02 ? `url(#${clipId})` : undefined}
        />
        {/* Inner shadow / depth */}
        <ellipse
          cx={ecx} cy={ecy + ry * 0.1}
          rx={cfg.rx * 0.55} ry={ry * 0.55}
          fill="rgba(0,0,0,0.35)"
          clipPath={cfg.squintTop > 0.02 ? `url(#${clipId})` : undefined}
        />
        {/* Highlight */}
        <circle cx={ecx + cfg.rx * 0.32} cy={ecy - ry * 0.32} r={Math.max(1.5, ry * 0.22)} fill="white" opacity={0.75} />
      </g>
    );
  }

  const mPath = mouthPath(MOUTH.cx, MOUTH.cy, mo.width, mo.curve, mo.open, mo.round);
  const mFill = mo.open > 2 ? `${color}22` : 'none';
  const strokeW = mo.round ? 0 : Math.max(2, 2.5 + mo.open * 0.05);

  return (
    <svg
      viewBox="0 0 320 200"
      width={width}
      height={height}
      className={className}
      style={{ background: '#1a1420', borderRadius: 16, display: 'block' }}
    >
      <defs>
        {/* Scanline texture overlay */}
        <pattern id="scanlines" x="0" y="0" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="2" height="1" fill="rgba(0,0,0,0.12)" />
        </pattern>
      </defs>

      {/* Face group — subtle tilt */}
      <g transform={`rotate(${tilt * 0.4}, 160, 100)`}>
        {/* Panel vignette */}
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
        </radialGradient>
        <rect x="0" y="0" width="320" height="200" fill="url(#vignette)" />

        {/* Eyes */}
        <Eye cfg={le} cx={L_EYE.cx} cy={L_EYE.cy} />
        <Eye cfg={re} cx={R_EYE.cx} cy={R_EYE.cy} />

        {/* Mouth */}
        {mo.round ? (
          <ellipse
            cx={MOUTH.cx}
            cy={MOUTH.cy + mo.open * 0.3}
            rx={Math.max(3, mo.open * 0.55 + 4)}
            ry={Math.max(3, mo.open + 5)}
            fill={`${color}30`}
            stroke={color}
            strokeWidth={2.5}
            style={{ filter: `drop-shadow(0 0 ${4 * glowStrength}px ${color})` }}
          />
        ) : (
          <path
            d={mPath}
            stroke={color}
            strokeWidth={strokeW}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={mFill}
            style={{ filter: `drop-shadow(0 0 ${4 * glowStrength}px ${color})` }}
          />
        )}
      </g>

      {/* Scanline overlay (subtle LED texture) */}
      <rect x="0" y="0" width="320" height="200" fill="url(#scanlines)" opacity={0.4} rx={16} />
    </svg>
  );
}
