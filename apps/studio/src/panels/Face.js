import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Eye, EyeOff } from 'lucide-react';
import { EXPRESSION_IDS } from '@xiaomu/contracts';
import FaceRenderer from '../face/FaceRenderer.js';
import { EXPRESSIONS } from '../face/expressions.js';
import { MOCK_VISEME_SEQUENCE, MOCK_EXPRESSION_TIMELINE, MOCK_UTTERANCE_DURATION_MS, } from '../face/visemeMap.js';
export default function Face() {
    const [selectedExpr, setSelectedExpr] = useState('calm');
    const [idleEnabled, setIdleEnabled] = useState(true);
    const [scrubMs, setScrubMs] = useState(undefined);
    const [playing, setPlaying] = useState(false);
    const playStartRef = useRef(0);
    const rafRef = useRef(0);
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
            }
            else {
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
    return (_jsxs("div", { className: "max-w-4xl", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-semibold text-slate-100", children: "Face" }), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: "SVG2D LED face renderer \u2014 16 expressions, idle daydream, viseme lip-sync." })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-start", children: [_jsxs("div", { className: "flex flex-col items-center gap-4", children: [_jsx("div", { className: "rounded-2xl overflow-hidden shadow-2xl", style: { boxShadow: `0 0 40px ${expr.color}30, 0 8px 32px rgba(0,0,0,0.6)` }, children: _jsx(FaceRenderer, { renderer: "svg2d", expressionId: displayExpr, idleEnabled: idleEnabled, width: 320, height: 200, ...(scrubMs !== undefined
                                        ? {
                                            visemeStream: MOCK_VISEME_SEQUENCE,
                                            visemePlaybackMs: scrubMs,
                                            expressionTimeline: MOCK_EXPRESSION_TIMELINE,
                                        }
                                        : {}) }) }), _jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium", style: { background: `${expr.color}20`, color: expr.color, border: `1px solid ${expr.color}50` }, children: [_jsx("span", { className: "w-2 h-2 rounded-full", style: { background: expr.color } }), expr.label, " \u00B7 ", expr.id] })] }), _jsxs("div", { className: "flex flex-col gap-6", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2", children: "Expression" }), _jsx("div", { className: "grid grid-cols-4 gap-1.5", children: EXPRESSION_IDS.map((id) => {
                                            const e = EXPRESSIONS[id];
                                            const isActive = selectedExpr === id && !playing;
                                            return (_jsx("button", { onClick: () => { if (!playing)
                                                    setSelectedExpr(id); }, disabled: playing, title: e.label, className: [
                                                    'rounded-lg px-2 py-2 text-xs font-medium transition-all border',
                                                    isActive
                                                        ? 'text-white border-opacity-60'
                                                        : 'text-slate-400 border-led-border hover:text-slate-200 hover:border-slate-600',
                                                    playing ? 'opacity-40 cursor-not-allowed' : '',
                                                ].join(' '), style: isActive ? {
                                                    background: `${e.color}25`,
                                                    borderColor: `${e.color}80`,
                                                    color: e.color,
                                                } : {}, children: id }, id));
                                        }) })] }), _jsxs("div", { className: "flex items-center justify-between rounded-lg border border-led-border bg-led-panel px-4 py-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-slate-200", children: "Idle daydream" }), _jsx("div", { className: "text-xs text-slate-500 mt-0.5", children: "Blink \u00B7 breathing sway \u00B7 eye drift" })] }), _jsxs("button", { onClick: () => setIdleEnabled((v) => !v), className: [
                                            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                                            idleEnabled
                                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                                : 'bg-led-border/50 text-slate-500 border border-led-border',
                                        ].join(' '), children: [idleEnabled ? _jsx(Eye, { size: 13 }) : _jsx(EyeOff, { size: 13 }), idleEnabled ? 'On' : 'Off'] })] }), _jsxs("div", { className: "rounded-lg border border-led-border bg-led-panel px-4 py-4 flex flex-col gap-3", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-widest text-slate-500", children: "Mock utterance \u2014 \u4F60\u597D\uFF0C\u6211\u662F\u5C0F\u6C90" }), _jsxs("div", { className: "relative h-6 rounded bg-led-border/60 overflow-hidden", children: [MOCK_EXPRESSION_TIMELINE.map((cue) => {
                                                const e = EXPRESSIONS[cue.expressionId];
                                                const pct = (cue.audioOffsetMs / MOCK_UTTERANCE_DURATION_MS) * 100;
                                                return (_jsx("div", { className: "absolute top-0 bottom-0 w-0.5 opacity-70", style: { left: `${pct}%`, background: e.color }, title: `${cue.expressionId} @ ${cue.audioOffsetMs}ms` }, `${cue.expressionId}-${cue.audioOffsetMs}`));
                                            }), scrubMs !== undefined && (_jsx("div", { className: "absolute top-0 bottom-0 w-0.5 bg-white opacity-90", style: { left: `${Math.min(100, (scrubMs / MOCK_UTTERANCE_DURATION_MS) * 100)}%` } })), scrubMs !== undefined && (_jsx("div", { className: "absolute top-0 left-0 bottom-0 bg-white/10", style: { width: `${Math.min(100, (scrubMs / MOCK_UTTERANCE_DURATION_MS) * 100)}%` } }))] }), _jsxs("div", { children: [_jsxs("label", { className: "text-xs text-slate-500 mb-1 block", children: ["Scrub viseme stream", scrubMs !== undefined && (_jsxs("span", { className: "ml-2 text-slate-400", children: [Math.round(scrubMs), "ms"] }))] }), _jsx("input", { type: "range", min: 0, max: MOCK_UTTERANCE_DURATION_MS, step: 10, value: scrubMs ?? 0, disabled: playing, onChange: (e) => {
                                                    if (!playing)
                                                        setScrubMs(Number(e.target.value));
                                                }, onMouseUp: () => {
                                                    // Auto-clear after 2s of inactivity
                                                }, className: "w-full accent-purple-500 disabled:opacity-40" })] }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: MOCK_EXPRESSION_TIMELINE.map((cue) => {
                                            const e = EXPRESSIONS[cue.expressionId];
                                            return (_jsxs("span", { className: "text-[10px] px-1.5 py-0.5 rounded", style: { background: `${e.color}20`, color: e.color }, children: [cue.expressionId, " @", cue.audioOffsetMs, "ms"] }, `${cue.expressionId}-${cue.audioOffsetMs}`));
                                        }) }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: playing ? stopPlayback : startPlayback, className: [
                                                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                                                    playing
                                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                                                        : 'bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30',
                                                ].join(' '), children: [playing ? _jsx(Square, { size: 14 }) : _jsx(Play, { size: 14 }), playing ? 'Stop' : 'Play mock utterance'] }), scrubMs !== undefined && !playing && (_jsx("button", { onClick: () => setScrubMs(undefined), className: "px-3 py-2 rounded-lg text-xs text-slate-500 border border-led-border hover:text-slate-300 transition-colors", children: "Clear" }))] })] }), _jsxs("details", { className: "rounded-lg border border-led-border", children: [_jsxs("summary", { className: "px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-slate-500 cursor-pointer select-none hover:text-slate-400 transition-colors", children: ["Viseme stream (", MOCK_VISEME_SEQUENCE.length, " events)"] }), _jsx("div", { className: "px-4 pb-3 flex flex-wrap gap-1 max-h-32 overflow-y-auto", children: MOCK_VISEME_SEQUENCE.map((ev, i) => {
                                            const isActive = scrubMs !== undefined &&
                                                scrubMs >= ev.audioOffsetMs &&
                                                (i === MOCK_VISEME_SEQUENCE.length - 1 || scrubMs < (MOCK_VISEME_SEQUENCE[i + 1]?.audioOffsetMs ?? Infinity));
                                            return (_jsxs("span", { className: [
                                                    'text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors',
                                                    isActive
                                                        ? 'bg-purple-500/30 text-purple-200'
                                                        : 'bg-led-border/50 text-slate-500',
                                                ].join(' '), children: ["v", ev.visemeId, "@", ev.audioOffsetMs] }, i));
                                        }) })] })] })] })] }));
}
