import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Eye, EyeOff } from 'lucide-react';
import type { ExpressionId } from '@xiaomu/contracts';
import { EXPRESSION_IDS } from '@xiaomu/contracts';
import FaceRenderer from '../face/FaceRenderer.js';
import { EXPRESSIONS } from '../face/expressions.js';
import {
  MOCK_VISEME_SEQUENCE,
  MOCK_EXPRESSION_TIMELINE,
  MOCK_UTTERANCE_DURATION_MS,
} from '../face/visemeMap.js';

export default function Face() {
  const [selectedExpr, setSelectedExpr] = useState<ExpressionId>('calm');
  const [idleEnabled, setIdleEnabled] = useState(true);
  const [scrubMs, setScrubMs] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  const playStartRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  // ── Playback ──────────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setScrubMs(undefined);
  }, []);

  const startPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playStartRef.current = performance.now();
    setPlaying(true);

    function tick() {
      const elapsed = performance.now() - playStartRef.current;
      setScrubMs(elapsed);
      if (elapsed < MOCK_UTTERANCE_DURATION_MS + 400) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
        setScrubMs(undefined);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Active expression: timeline overrides manual selection during playback
  const displayExpr = selectedExpr;

  // ── Color badge ───────────────────────────────────────────────────────────
  const expr = EXPRESSIONS[selectedExpr];

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Face</h1>
        <p className="mt-1 text-sm text-slate-400">
          SVG2D LED face renderer — 16 expressions, idle daydream, viseme lip-sync.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-start">

        {/* ── Face preview ─────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-4">
          <div
            className="rounded-2xl overflow-hidden shadow-2xl"
            style={{ boxShadow: `0 0 40px ${expr.color}30, 0 8px 32px rgba(0,0,0,0.6)` }}
          >
            <FaceRenderer
              renderer="svg2d"
              expressionId={displayExpr}
              idleEnabled={idleEnabled}
              width={320}
              height={200}
              {...(scrubMs !== undefined
                ? {
                    visemeStream: MOCK_VISEME_SEQUENCE,
                    visemePlaybackMs: scrubMs,
                    expressionTimeline: MOCK_EXPRESSION_TIMELINE,
                  }
                : {})}
            />
          </div>

          {/* Current expression badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: `${expr.color}20`, color: expr.color, border: `1px solid ${expr.color}50` }}>
            <span className="w-2 h-2 rounded-full" style={{ background: expr.color }} />
            {expr.label} · {expr.id}
          </div>
        </div>

        {/* ── Controls ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">

          {/* Expression grid */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
              Expression
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {EXPRESSION_IDS.map((id) => {
                const e = EXPRESSIONS[id];
                const isActive = selectedExpr === id && !playing;
                return (
                  <button
                    key={id}
                    onClick={() => { if (!playing) setSelectedExpr(id); }}
                    disabled={playing}
                    title={e.label}
                    className={[
                      'rounded-lg px-2 py-2 text-xs font-medium transition-all border',
                      isActive
                        ? 'text-white border-opacity-60'
                        : 'text-slate-400 border-led-border hover:text-slate-200 hover:border-slate-600',
                      playing ? 'opacity-40 cursor-not-allowed' : '',
                    ].join(' ')}
                    style={isActive ? {
                      background: `${e.color}25`,
                      borderColor: `${e.color}80`,
                      color: e.color,
                    } : {}}
                  >
                    {id}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Idle toggle */}
          <div className="flex items-center justify-between rounded-lg border border-led-border bg-led-panel px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-200">Idle daydream</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Blink · breathing sway · eye drift
              </div>
            </div>
            <button
              onClick={() => setIdleEnabled((v) => !v)}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                idleEnabled
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'bg-led-border/50 text-slate-500 border border-led-border',
              ].join(' ')}
            >
              {idleEnabled ? <Eye size={13} /> : <EyeOff size={13} />}
              {idleEnabled ? 'On' : 'Off'}
            </button>
          </div>

          {/* Mock utterance player */}
          <div className="rounded-lg border border-led-border bg-led-panel px-4 py-4 flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Mock utterance — 你好，我是小沐
            </div>

            {/* Timeline bar */}
            <div className="relative h-6 rounded bg-led-border/60 overflow-hidden">
              {/* Expression cue markers */}
              {MOCK_EXPRESSION_TIMELINE.map((cue) => {
                const e = EXPRESSIONS[cue.expressionId as ExpressionId];
                const pct = (cue.audioOffsetMs / MOCK_UTTERANCE_DURATION_MS) * 100;
                return (
                  <div
                    key={`${cue.expressionId}-${cue.audioOffsetMs}`}
                    className="absolute top-0 bottom-0 w-0.5 opacity-70"
                    style={{ left: `${pct}%`, background: e.color }}
                    title={`${cue.expressionId} @ ${cue.audioOffsetMs}ms`}
                  />
                );
              })}
              {/* Playhead */}
              {scrubMs !== undefined && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white opacity-90"
                  style={{ left: `${Math.min(100, (scrubMs / MOCK_UTTERANCE_DURATION_MS) * 100)}%` }}
                />
              )}
              {/* Progress fill */}
              {scrubMs !== undefined && (
                <div
                  className="absolute top-0 left-0 bottom-0 bg-white/10"
                  style={{ width: `${Math.min(100, (scrubMs / MOCK_UTTERANCE_DURATION_MS) * 100)}%` }}
                />
              )}
            </div>

            {/* Scrubber */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">
                Scrub viseme stream
                {scrubMs !== undefined && (
                  <span className="ml-2 text-slate-400">{Math.round(scrubMs)}ms</span>
                )}
              </label>
              <input
                type="range"
                min={0}
                max={MOCK_UTTERANCE_DURATION_MS}
                step={10}
                value={scrubMs ?? 0}
                disabled={playing}
                onChange={(e) => {
                  if (!playing) setScrubMs(Number(e.target.value));
                }}
                onMouseUp={() => {
                  // Auto-clear after 2s of inactivity
                }}
                className="w-full accent-purple-500 disabled:opacity-40"
              />
            </div>

            {/* Expression cue legend */}
            <div className="flex flex-wrap gap-1.5">
              {MOCK_EXPRESSION_TIMELINE.map((cue) => {
                const e = EXPRESSIONS[cue.expressionId as ExpressionId];
                return (
                  <span
                    key={`${cue.expressionId}-${cue.audioOffsetMs}`}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: `${e.color}20`, color: e.color }}
                  >
                    {cue.expressionId} @{cue.audioOffsetMs}ms
                  </span>
                );
              })}
            </div>

            {/* Play/stop button */}
            <div className="flex gap-2">
              <button
                onClick={playing ? stopPlayback : startPlayback}
                className={[
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  playing
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30',
                ].join(' ')}
              >
                {playing ? <Square size={14} /> : <Play size={14} />}
                {playing ? 'Stop' : 'Play mock utterance'}
              </button>
              {scrubMs !== undefined && !playing && (
                <button
                  onClick={() => setScrubMs(undefined)}
                  className="px-3 py-2 rounded-lg text-xs text-slate-500 border border-led-border hover:text-slate-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Viseme stream debug */}
          <details className="rounded-lg border border-led-border">
            <summary className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-slate-500 cursor-pointer select-none hover:text-slate-400 transition-colors">
              Viseme stream ({MOCK_VISEME_SEQUENCE.length} events)
            </summary>
            <div className="px-4 pb-3 flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {MOCK_VISEME_SEQUENCE.map((ev, i) => {
                const isActive = scrubMs !== undefined &&
                  scrubMs >= ev.audioOffsetMs &&
                  (i === MOCK_VISEME_SEQUENCE.length - 1 || scrubMs < (MOCK_VISEME_SEQUENCE[i + 1]?.audioOffsetMs ?? Infinity));
                return (
                  <span
                    key={i}
                    className={[
                      'text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors',
                      isActive
                        ? 'bg-purple-500/30 text-purple-200'
                        : 'bg-led-border/50 text-slate-500',
                    ].join(' ')}
                  >
                    v{ev.visemeId}@{ev.audioOffsetMs}
                  </span>
                );
              })}
            </div>
          </details>

        </div>
      </div>
    </div>
  );
}
