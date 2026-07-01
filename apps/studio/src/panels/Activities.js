import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Plus, X, Play, Pause, Save, RotateCcw, FileText, } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchConfig, saveConfig, fetchAudioLibrary, } from '../api/client.js';
const LEVEL = {
    'breathing': 1,
    'body-rhythm': 2,
    'emotion-music-mapping': 3,
    'co-creation': 4,
};
const DEFAULT_BUCKETS = [
    { minAge: 3, maxAge: 7, audioFilenames: [] },
    { minAge: 8, maxAge: 12, audioFilenames: [] },
];
// ── Inline preview player (shared singleton ref across the panel) ───────────
function usePreviewPlayer() {
    const audioRef = useRef(null);
    const [playing, setPlaying] = useState(null);
    const toggle = useCallback((filename) => {
        if (audioRef.current && playing === filename) {
            audioRef.current.pause();
            audioRef.current = null;
            setPlaying(null);
            return;
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        const a = new Audio(`/api/audio/file/${encodeURIComponent(filename)}`);
        a.addEventListener('ended', () => setPlaying(null));
        a.addEventListener('pause', () => {
            if (audioRef.current === a)
                setPlaying(null);
        });
        audioRef.current = a;
        setPlaying(filename);
        void a.play();
    }, [playing]);
    useEffect(() => () => {
        audioRef.current?.pause();
        audioRef.current = null;
    }, []);
    return { playing, toggle };
}
function ScriptedActivityEditor({ value, library, onChange, preview }) {
    const [openPicker, setOpenPicker] = useState(null);
    const [openScript, setOpenScript] = useState(null);
    const updateBucket = (idx, patch) => {
        const buckets = value.ageBuckets.map((b, i) => (i === idx ? { ...b, ...patch } : b));
        onChange({ ageBuckets: buckets });
    };
    const addAudio = (idx, filename) => {
        const bucket = value.ageBuckets[idx];
        if (bucket.audioFilenames.includes(filename))
            return;
        updateBucket(idx, { audioFilenames: [...bucket.audioFilenames, filename] });
        setOpenPicker(null);
    };
    const removeAudio = (idx, filename) => {
        const bucket = value.ageBuckets[idx];
        updateBucket(idx, {
            audioFilenames: bucket.audioFilenames.filter((f) => f !== filename),
        });
    };
    const addBucket = () => {
        const last = value.ageBuckets[value.ageBuckets.length - 1];
        const newMin = last ? Math.min(99, last.maxAge + 1) : 3;
        const newMax = Math.min(99, newMin + 5);
        onChange({
            ageBuckets: [
                ...value.ageBuckets,
                { minAge: newMin, maxAge: newMax, audioFilenames: [] },
            ],
        });
    };
    const removeBucket = (idx) => {
        onChange({
            ageBuckets: value.ageBuckets.filter((_, i) => i !== idx),
        });
        if (openPicker === idx)
            setOpenPicker(null);
        if (openScript === idx)
            setOpenScript(null);
    };
    return (_jsxs("div", { className: "mt-4 space-y-3", children: [value.ageBuckets.map((bucket, idx) => {
                const available = library.filter((f) => !bucket.audioFilenames.includes(f.filename));
                return (_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-xs text-slate-400", children: [_jsx("span", { className: "font-medium text-slate-300", children: "Ages" }), _jsx("input", { type: "number", min: 0, max: 99, value: bucket.minAge, onChange: (e) => updateBucket(idx, { minAge: parseInt(e.target.value, 10) || 0 }), className: "w-12 rounded bg-led-panel border border-led-border px-1.5 py-0.5 text-center text-slate-200 focus:outline-none focus:border-purple-500" }), _jsx("span", { children: "\u2013" }), _jsx("input", { type: "number", min: 0, max: 99, value: bucket.maxAge, onChange: (e) => updateBucket(idx, { maxAge: parseInt(e.target.value, 10) || 0 }), className: "w-12 rounded bg-led-panel border border-led-border px-1.5 py-0.5 text-center text-slate-200 focus:outline-none focus:border-purple-500" }), _jsxs("span", { className: "text-led-muted", children: ["\u00B7 ", bucket.audioFilenames.length, " track", bucket.audioFilenames.length === 1 ? '' : 's'] }), _jsx("button", { onClick: () => removeBucket(idx), title: "Remove this age bucket", className: "ml-auto flex items-center justify-center w-6 h-6 rounded text-slate-600 hover:text-rose-300 hover:bg-rose-500/10 transition-colors", children: _jsx(X, { size: 12 }) })] }), _jsxs("div", { className: "mt-2 flex flex-wrap gap-1.5", children: [bucket.audioFilenames.length === 0 && (_jsx("span", { className: "text-[11px] italic text-led-muted", children: "No tracks yet \u2014 add some below." })), bucket.audioFilenames.map((fn) => {
                                    const isPlaying = preview.playing === fn;
                                    const missing = !library.find((f) => f.filename === fn);
                                    return (_jsxs("span", { className: [
                                            'inline-flex items-center gap-1 rounded-full border pl-1 pr-1.5 py-0.5 text-[11px]',
                                            missing
                                                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                                : 'border-purple-500/30 bg-purple-500/10 text-purple-200',
                                        ].join(' '), title: missing ? 'File no longer in ./data/audio/' : fn, children: [_jsx("button", { onClick: () => preview.toggle(fn), disabled: missing, className: "rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40", children: isPlaying ? _jsx(Pause, { size: 9 }) : _jsx(Play, { size: 9, className: "ml-0.5" }) }), _jsx("span", { className: "max-w-[12rem] truncate", children: fn }), _jsx("button", { onClick: () => removeAudio(idx, fn), className: "rounded-full p-0.5 hover:bg-white/10", title: "Remove", children: _jsx(X, { size: 10 }) })] }, fn));
                                })] }), _jsxs("div", { className: "mt-2", children: [_jsxs("button", { onClick: () => setOpenPicker(openPicker === idx ? null : idx), disabled: available.length === 0, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed", children: [_jsx(Plus, { size: 11 }), available.length === 0
                                            ? 'All library tracks added'
                                            : openPicker === idx ? 'Close picker' : 'Add audio'] }), openPicker === idx && (_jsx("div", { className: "mt-1.5 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto", children: available.length === 0 ? (_jsxs("div", { className: "p-2 text-[11px] text-led-muted", children: ["No more tracks. Drop more files in ", _jsx("code", { children: "./data/audio/" }), "."] })) : (available.map((f) => (_jsxs("button", { onClick: () => addAudio(idx, f.filename), className: "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0", children: [_jsx("span", { role: "button", onClick: (e) => { e.stopPropagation(); preview.toggle(f.filename); }, className: "flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20", children: preview.playing === f.filename
                                                    ? _jsx(Pause, { size: 9 })
                                                    : _jsx(Play, { size: 9, className: "ml-0.5" }) }), _jsx("span", { className: "flex-1 truncate", children: f.filename }), _jsxs("span", { className: "text-[10px] text-led-muted flex-shrink-0", children: [(f.sizeBytes / 1024 / 1024).toFixed(1), " MB"] })] }, f.filename)))) }))] }), _jsxs("div", { className: "mt-2 border-t border-led-border pt-2", children: [_jsxs("button", { onClick: () => setOpenScript(openScript === idx ? null : idx), className: "inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors", children: [_jsx(FileText, { size: 11 }), openScript === idx ? 'Hide narration script' : 'Narration script', bucket.narrationScript && bucket.narrationScript.length > 0 && (_jsxs("span", { className: "text-[10px] text-led-muted", children: ["\u00B7 ", bucket.narrationScript.length, " chars"] }))] }), openScript === idx && (_jsx("textarea", { value: bucket.narrationScript ?? '', onChange: (e) => updateBucket(idx, {
                                        narrationScript: e.target.value.length === 0 ? undefined : e.target.value,
                                    }), placeholder: "Optional. The model uses this as a structural guide when running this activity for a child in this age range. Adapt phrasing naturally per turn.", rows: 6, className: "mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" }))] })] }, idx));
            }), value.ageBuckets.length === 0 && (_jsx("div", { className: "rounded-md border border-dashed border-led-border bg-led-bg/40 p-4 text-center text-[11px] text-led-muted", children: "No age buckets yet. Add one below." })), _jsxs("button", { onClick: addBucket, className: "w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-led-border bg-led-panel px-3 py-2 text-xs text-slate-400 hover:text-purple-300 hover:border-purple-500/50 transition-colors", children: [_jsx(Plus, { size: 12 }), "Add age bucket"] })] }));
}
function EmotionActivityEditor({ value, library, onChange, preview }) {
    const [openPicker, setOpenPicker] = useState(null);
    const [openScript, setOpenScript] = useState(null);
    const [openClosing, setOpenClosing] = useState(false);
    const updateBucket = (id, patch) => {
        const buckets = value.emotionBuckets.map((b) => b.emotionId === id ? { ...b, ...patch } : b);
        onChange({ ...value, emotionBuckets: buckets });
    };
    const moveBucket = (idx, dir) => {
        const target = idx + dir;
        if (target < 0 || target >= value.emotionBuckets.length)
            return;
        const next = [...value.emotionBuckets];
        [next[idx], next[target]] = [next[target], next[idx]];
        onChange({ ...value, emotionBuckets: next });
    };
    const addAudio = (id, filename) => {
        const bucket = value.emotionBuckets.find((b) => b.emotionId === id);
        if (!bucket || bucket.audioFilenames.includes(filename))
            return;
        updateBucket(id, { audioFilenames: [...bucket.audioFilenames, filename] });
        setOpenPicker(null);
    };
    const removeAudio = (id, filename) => {
        const bucket = value.emotionBuckets.find((b) => b.emotionId === id);
        if (!bucket)
            return;
        updateBucket(id, {
            audioFilenames: bucket.audioFilenames.filter((f) => f !== filename),
        });
    };
    // Compute total section count for the run-time hint.
    const totalSections = value.emotionBuckets.reduce((sum, b) => sum + (b.narrationScript.trim().length === 0 ? 0 : Math.max(1, b.repeatCount ?? 1)), 0) + (value.closingScript && value.closingScript.trim().length > 0 ? 1 : 0);
    return (_jsxs("div", { className: "mt-4 space-y-4", children: [_jsxs("p", { className: "text-[10px] leading-relaxed text-led-muted", children: ["Buckets play in the order shown (", totalSections, " sections total). Use \u2191/\u2193 to reorder. Each bucket can play multiple consecutive sections via ", _jsx("em", { children: "Plays N" }), "."] }), _jsx("div", { className: "space-y-2", children: value.emotionBuckets.map((bucket, idx) => {
                    const available = library.filter((f) => !bucket.audioFilenames.includes(f.filename));
                    const isPickerOpen = openPicker === bucket.emotionId;
                    const isScriptOpen = openScript === bucket.emotionId;
                    const repeat = Math.max(1, bucket.repeatCount ?? 1);
                    return (_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("button", { onClick: () => moveBucket(idx, -1), disabled: idx === 0, className: "rounded p-0.5 text-led-muted hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed", title: "Move up", children: _jsx(ChevronUp, { size: 11 }) }), _jsx("button", { onClick: () => moveBucket(idx, 1), disabled: idx === value.emotionBuckets.length - 1, className: "rounded p-0.5 text-led-muted hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed", title: "Move down", children: _jsx(ChevronDown, { size: 11 }) })] }), _jsx("span", { className: "text-[10px] font-mono text-slate-600 w-5 text-right", children: idx + 1 }), _jsx("span", { className: "text-xl", children: bucket.emoji }), _jsx("span", { className: "text-sm font-medium text-slate-200", children: bucket.label }), _jsxs("code", { className: "text-[10px] text-slate-600", children: ["L", bucket.level] }), _jsxs("div", { className: "ml-auto flex items-center gap-1.5", children: [_jsx("span", { className: "text-[10px] text-led-muted", children: "Plays" }), _jsx("input", { type: "number", min: 1, max: 20, value: repeat, onChange: (e) => updateBucket(bucket.emotionId, {
                                                    repeatCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                                                }), className: "w-12 bg-led-panel border border-led-border rounded px-1 py-0.5 text-[11px] text-center text-slate-200 focus:outline-none focus:border-purple-500" }), _jsxs("span", { className: "text-[10px] text-led-muted", children: ["\u00B7 ", bucket.audioFilenames.length, " track", bucket.audioFilenames.length === 1 ? '' : 's'] })] })] }), _jsxs("div", { className: "mt-2 flex flex-wrap gap-1.5", children: [bucket.audioFilenames.length === 0 && (_jsx("span", { className: "text-[11px] italic text-led-muted", children: "No tracks yet \u2014 add some below." })), bucket.audioFilenames.map((fn) => {
                                        const isPlaying = preview.playing === fn;
                                        const missing = !library.find((f) => f.filename === fn);
                                        return (_jsxs("span", { className: [
                                                'inline-flex items-center gap-1 rounded-full border pl-1 pr-1.5 py-0.5 text-[11px]',
                                                missing
                                                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                                    : 'border-purple-500/30 bg-purple-500/10 text-purple-200',
                                            ].join(' '), title: missing ? 'File no longer in ./data/audio/' : fn, children: [_jsx("button", { onClick: () => preview.toggle(fn), disabled: missing, className: "rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40", children: isPlaying ? _jsx(Pause, { size: 9 }) : _jsx(Play, { size: 9, className: "ml-0.5" }) }), _jsx("span", { className: "max-w-[12rem] truncate", children: fn }), _jsx("button", { onClick: () => removeAudio(bucket.emotionId, fn), className: "rounded-full p-0.5 hover:bg-white/10", title: "Remove", children: _jsx(X, { size: 10 }) })] }, fn));
                                    })] }), _jsxs("div", { className: "mt-2", children: [_jsxs("button", { onClick: () => setOpenPicker(isPickerOpen ? null : bucket.emotionId), disabled: available.length === 0, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed", children: [_jsx(Plus, { size: 11 }), available.length === 0
                                                ? 'All library tracks added'
                                                : isPickerOpen ? 'Close picker' : 'Add audio'] }), isPickerOpen && (_jsx("div", { className: "mt-1.5 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto", children: available.length === 0 ? (_jsxs("div", { className: "p-2 text-[11px] text-led-muted", children: ["No more tracks. Drop more files in ", _jsx("code", { children: "./data/audio/" }), "."] })) : (available.map((f) => (_jsxs("button", { onClick: () => addAudio(bucket.emotionId, f.filename), className: "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0", children: [_jsx("span", { role: "button", onClick: (e) => { e.stopPropagation(); preview.toggle(f.filename); }, className: "flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20", children: preview.playing === f.filename
                                                        ? _jsx(Pause, { size: 9 })
                                                        : _jsx(Play, { size: 9, className: "ml-0.5" }) }), _jsx("span", { className: "flex-1 truncate", children: f.filename }), _jsxs("span", { className: "text-[10px] text-led-muted flex-shrink-0", children: [(f.sizeBytes / 1024 / 1024).toFixed(1), " MB"] })] }, f.filename)))) }))] }), _jsxs("div", { className: "mt-2 border-t border-led-border pt-2", children: [_jsxs("button", { onClick: () => setOpenScript(isScriptOpen ? null : bucket.emotionId), className: "inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors", children: [_jsx(FileText, { size: 11 }), isScriptOpen ? 'Hide narration script' : 'Narration script', _jsxs("span", { className: "text-[10px] text-led-muted", children: ["\u00B7 ", bucket.narrationScript.length, " chars"] })] }), isScriptOpen && (_jsx("textarea", { value: bucket.narrationScript, onChange: (e) => updateBucket(bucket.emotionId, { narrationScript: e.target.value }), rows: 4, className: "mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" }))] })] }, bucket.emotionId));
                }) }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("button", { onClick: () => setOpenClosing(!openClosing), className: "inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors", children: [_jsx(FileText, { size: 11 }), openClosing ? 'Hide' : 'Show', " closing script", _jsxs("span", { className: "text-[10px] text-led-muted ml-1", children: ["\u00B7 spoken once at the end \u00B7 ", (value.closingScript ?? '').length, " chars"] })] }), openClosing && (_jsx("textarea", { value: value.closingScript ?? '', onChange: (e) => onChange({
                            ...value,
                            closingScript: e.target.value.length === 0 ? undefined : e.target.value,
                        }), rows: 4, placeholder: "Optional. Delivered as a single section after all emotion sections. No audio.", className: "mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" }))] })] }));
}
// ── Co-Creation editor (per note-triple + variant overrides) ────────────────
const CC_VARIANTS = ['original', 'revised', 'background'];
const VARIANT_LABEL = {
    original: 'Original',
    revised: 'Revised',
    background: 'Background',
};
const VARIANT_COLOR = {
    original: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
    revised: 'text-purple-300 border-purple-500/40 bg-purple-500/10',
    background: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
};
/** Sol ≡ So, Ti ≡ Si, case-insensitive. Matches coCreationAudio.ts canonicalNote. */
function canonicalNote(note) {
    const lower = note.toLowerCase();
    if (lower === 'so')
        return 'sol';
    if (lower === 'si')
        return 'ti';
    return lower;
}
function noteSetKey(notes) {
    return notes.map(canonicalNote).sort().join('|');
}
const NOTE_TOKEN_RE = /\b(Do|Re|Mi|Fa|Sol|So|La|Ti|Si)\b/gi;
function detectVariantFromFilename(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('background'))
        return 'background';
    if (lower.includes('revised'))
        return 'revised';
    // accept both "original" and the typo "orginal"
    if (lower.includes('original') || lower.includes('orginal'))
        return 'original';
    // bare names with notes → treat as original (matches server resolver)
    return 'original';
}
/**
 * Replica of coCreationAudio.ts's buildIndex, computed from the audio library
 * client-side so the panel can show what the server would auto-discover.
 */
function buildDiscoveryIndex(library) {
    const idx = new Map();
    for (const f of library) {
        if (!/\.(m4a|mp3|wav|ogg)$/i.test(f.filename))
            continue;
        const base = f.filename.replace(/\.[^.]+$/, '');
        const noteMatches = base.match(NOTE_TOKEN_RE);
        if (!noteMatches || noteMatches.length !== 3)
            continue;
        const variant = detectVariantFromFilename(base);
        if (!variant)
            continue;
        const key = `${variant}::${noteSetKey(noteMatches)}`;
        if (!idx.has(key))
            idx.set(key, f.filename);
    }
    return idx;
}
/** All C(notes.length, 3) combinations, preserving the order the user defined notes in. */
function pickThreeCombinations(notes) {
    const out = [];
    const n = notes.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            for (let k = j + 1; k < n; k++) {
                out.push([notes[i], notes[j], notes[k]]);
            }
        }
    }
    return out;
}
function CoCreationEditor({ value, library, onChange, preview }) {
    const [openPicker, setOpenPicker] = useState(null);
    const [openScript, setOpenScript] = useState(false);
    const [newNote, setNewNote] = useState('');
    const notes = value.notes;
    const mappings = value.audioMappings ?? [];
    const combinations = pickThreeCombinations(notes);
    // Index explicit mappings by (canonical note-set, variant) for O(1) lookup
    const mappingByKey = new Map();
    for (const m of mappings) {
        mappingByKey.set(`${m.variant}::${noteSetKey(m.notes)}`, m.filename);
    }
    // Filename-based auto-discovery (mirrors server's coCreationAudio.ts)
    const discoveryByKey = buildDiscoveryIndex(library);
    const slotKey = (notesTriple, variant) => `${variant}::${noteSetKey(notesTriple)}`;
    const setMapping = (notesTriple, variant, filename) => {
        const key = slotKey(notesTriple, variant);
        const targetSet = noteSetKey(notesTriple);
        const filtered = mappings.filter((m) => !(m.variant === variant && noteSetKey(m.notes) === targetSet));
        const next = filename
            ? [...filtered, { notes: [...notesTriple], variant, filename }]
            : filtered;
        onChange({ ...value, audioMappings: next });
        setOpenPicker(null);
    };
    const updateNotes = (nextNotes) => {
        onChange({ ...value, notes: nextNotes });
    };
    const addNote = () => {
        const trimmed = newNote.trim();
        if (!trimmed)
            return;
        if (notes.includes(trimmed)) {
            setNewNote('');
            return;
        }
        updateNotes([...notes, trimmed]);
        setNewNote('');
    };
    const removeNote = (note) => {
        updateNotes(notes.filter((n) => n !== note));
        // Also drop any mappings that reference the removed note
        const filtered = mappings.filter((m) => !m.notes.some((mn) => canonicalNote(mn) === canonicalNote(note)));
        if (filtered.length !== mappings.length) {
            onChange({ ...value, notes: notes.filter((n) => n !== note), audioMappings: filtered });
        }
    };
    // Coverage stats — explicit + auto-discovered both count as "resolved"
    const totalSlots = combinations.length * CC_VARIANTS.length;
    const filledSlots = combinations.reduce((sum, c) => sum + CC_VARIANTS.filter((v) => {
        const k = slotKey(c, v);
        return mappingByKey.has(k) || discoveryByKey.has(k);
    }).length, 0);
    return (_jsxs("div", { className: "mt-4 space-y-4", children: [_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-xs font-medium text-slate-300", children: "Selectable notes" }), _jsxs("span", { className: "text-[10px] text-led-muted", children: [notes.length, " note", notes.length === 1 ? '' : 's', " \u00B7 ", combinations.length, " combination", combinations.length === 1 ? '' : 's'] })] }), _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [notes.map((n) => (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-200 pl-2 pr-1 py-0.5 text-[11px]", children: [n, _jsx("button", { onClick: () => removeNote(n), className: "rounded-full p-0.5 hover:bg-white/10", title: `Remove ${n}`, children: _jsx(X, { size: 10 }) })] }, n))), _jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx("input", { type: "text", value: newNote, onChange: (e) => setNewNote(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addNote();
                                        } }, placeholder: "Add note\u2026", className: "w-20 rounded bg-led-panel border border-led-border px-1.5 py-0.5 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500" }), _jsx("button", { onClick: addNote, disabled: !newNote.trim(), className: "inline-flex items-center justify-center rounded-md border border-led-border bg-led-panel w-5 h-5 text-purple-400 hover:bg-purple-500/20 disabled:opacity-30", title: "Add note", children: _jsx(Plus, { size: 10 }) })] })] })] }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("button", { onClick: () => setOpenScript(!openScript), className: "inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors", children: [_jsx(FileText, { size: 11 }), openScript ? 'Hide narration script' : 'Narration script', _jsxs("span", { className: "text-[10px] text-led-muted", children: ["\u00B7 ", value.narrationScript.length, " chars"] })] }), openScript && (_jsx("textarea", { value: value.narrationScript, onChange: (e) => onChange({ ...value, narrationScript: e.target.value }), rows: 8, className: "mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" }))] }), _jsxs("div", { children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-medium text-slate-300", children: "Audio mappings" }), _jsxs("span", { className: "text-[10px] text-led-muted", children: [filledSlots, " / ", totalSlots, " slots resolved \u00B7 solid = explicit override, dashed = filename auto-discovery"] })] }), combinations.length === 0 ? (_jsx("div", { className: "rounded-md border border-dashed border-led-border bg-led-bg/40 p-4 text-center text-[11px] text-led-muted", children: "Add at least 3 notes above to generate combinations." })) : (_jsx("div", { className: "space-y-1.5", children: combinations.map((triple) => (_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-2.5", children: [_jsx("div", { className: "flex items-center gap-1.5 mb-2", children: triple.map((n, i) => (_jsxs(React.Fragment, { children: [_jsx("span", { className: "text-sm font-medium text-slate-200", children: n }), i < triple.length - 1 && _jsx("span", { className: "text-led-muted text-xs", children: "\u00B7" })] }, n))) }), _jsx("div", { className: "grid grid-cols-3 gap-1.5", children: CC_VARIANTS.map((variant) => {
                                        const key = slotKey(triple, variant);
                                        const explicit = mappingByKey.get(key);
                                        const discovered = !explicit ? discoveryByKey.get(key) : undefined;
                                        const resolved = explicit ?? discovered;
                                        const isAuto = !explicit && Boolean(discovered);
                                        const isPickerOpen = openPicker === key;
                                        const isPlaying = resolved && preview.playing === resolved;
                                        const fileMissingFromLibrary = explicit && !library.find((f) => f.filename === explicit);
                                        return (_jsxs("div", { className: "relative", children: [_jsxs("div", { className: [
                                                        'rounded border px-2 py-1.5 transition-colors',
                                                        resolved
                                                            ? VARIANT_COLOR[variant] + (isAuto ? ' border-dashed' : '')
                                                            : 'border-led-border bg-led-panel text-led-muted',
                                                    ].join(' '), children: [_jsxs("div", { className: "text-[9px] uppercase tracking-widest opacity-70 mb-0.5 flex items-center gap-1", children: [_jsx("span", { children: VARIANT_LABEL[variant] }), isAuto && (_jsx("span", { className: "px-1 py-px rounded bg-white/10 text-[8px] tracking-normal normal-case", children: "auto" }))] }), resolved ? (_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("button", { onClick: () => preview.toggle(resolved), disabled: Boolean(fileMissingFromLibrary), className: "rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40 flex-shrink-0", title: fileMissingFromLibrary ? 'File missing from audio library' : 'Preview', children: isPlaying ? _jsx(Pause, { size: 10 }) : _jsx(Play, { size: 10, className: "ml-0.5" }) }), _jsx("button", { onClick: () => setOpenPicker(isPickerOpen ? null : key), className: "flex-1 truncate text-left text-[10px] hover:underline min-w-0", title: isAuto
                                                                        ? `Auto-discovered: ${resolved} (click to override)`
                                                                        : resolved, children: resolved }), explicit && (_jsx("button", { onClick: () => setMapping(triple, variant, null), className: "rounded-full p-0.5 hover:bg-white/10 flex-shrink-0", title: "Clear override (revert to auto-discovery)", children: _jsx(X, { size: 9 }) }))] })) : (_jsxs("button", { onClick: () => setOpenPicker(isPickerOpen ? null : key), className: "inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-200 transition-colors", children: [_jsx(Plus, { size: 9 }), "Pick file"] }))] }), isPickerOpen && (_jsx("div", { className: "absolute z-10 mt-1 left-0 right-0 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto shadow-xl", children: library.length === 0 ? (_jsxs("div", { className: "p-2 text-[11px] text-led-muted", children: ["No audio files. Drop mp3 / m4a into ", _jsx("code", { children: "./data/audio/" }), "."] })) : (library.map((f) => (_jsxs("button", { onClick: () => setMapping(triple, variant, f.filename), className: "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0", children: [_jsx("span", { role: "button", onClick: (e) => { e.stopPropagation(); preview.toggle(f.filename); }, className: "flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20 flex-shrink-0", children: preview.playing === f.filename
                                                                    ? _jsx(Pause, { size: 9 })
                                                                    : _jsx(Play, { size: 9, className: "ml-0.5" }) }), _jsx("span", { className: "flex-1 truncate", children: f.filename }), _jsxs("span", { className: "text-[10px] text-led-muted flex-shrink-0", children: [(f.sizeBytes / 1024 / 1024).toFixed(1), " MB"] })] }, f.filename)))) }))] }, variant));
                                    }) })] }, noteSetKey(triple)))) }))] })] }));
}
function RhythmStoryEditor({ value, onChange }) {
    const [openStories, setOpenStories] = useState(false);
    const [openCompletions, setOpenCompletions] = useState(false);
    const updateList = (key, idx, content) => {
        const next = value[key].map((s, i) => (i === idx ? content : s));
        onChange({ ...value, [key]: next });
    };
    const addItem = (key) => {
        onChange({ ...value, [key]: [...value[key], ''] });
    };
    const removeItem = (key, idx) => {
        onChange({ ...value, [key]: value[key].filter((_, i) => i !== idx) });
    };
    return (_jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsx("div", { className: "text-xs font-medium text-slate-300 mb-1.5", children: "Intro line (prefix)" }), _jsx("textarea", { value: value.prefix, onChange: (e) => onChange({ ...value, prefix: e.target.value }), rows: 2, className: "w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" })] }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("button", { onClick: () => setOpenStories(!openStories), className: "flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors", children: [_jsx(FileText, { size: 11 }), openStories ? 'Hide' : 'Show', " stories", _jsxs("span", { className: "text-[10px] text-led-muted ml-1", children: ["\u00B7 ", value.stories.length, " ", value.stories.length === 1 ? 'story' : 'stories', " (random pick)"] })] }), openStories && (_jsxs("div", { className: "mt-2 space-y-2", children: [value.stories.map((story, idx) => (_jsxs("div", { className: "rounded border border-led-border bg-led-panel p-2", children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsxs("span", { className: "text-[10px] text-led-muted", children: ["Story ", idx + 1] }), _jsx("button", { onClick: () => removeItem('stories', idx), className: "text-led-muted hover:text-rose-300 transition-colors", title: "Remove story", children: _jsx(X, { size: 11 }) })] }), _jsx("textarea", { value: story, onChange: (e) => updateList('stories', idx, e.target.value), rows: 4, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono" })] }, idx))), _jsxs("button", { onClick: () => addItem('stories'), className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors", children: [_jsx(Plus, { size: 11 }), "Add story"] })] }))] }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("button", { onClick: () => setOpenCompletions(!openCompletions), className: "flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors", children: [_jsx(FileText, { size: 11 }), openCompletions ? 'Hide' : 'Show', " completion responses", _jsxs("span", { className: "text-[10px] text-led-muted ml-1", children: ["\u00B7 ", value.completionResponses.length, " (random pick after \"\u6211\u62CD\u5B8C\u5566\")"] })] }), openCompletions && (_jsxs("div", { className: "mt-2 space-y-2", children: [value.completionResponses.map((resp, idx) => (_jsxs("div", { className: "rounded border border-led-border bg-led-panel p-2", children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsxs("span", { className: "text-[10px] text-led-muted", children: ["Response ", idx + 1] }), _jsx("button", { onClick: () => removeItem('completionResponses', idx), className: "text-led-muted hover:text-rose-300 transition-colors", title: "Remove response", children: _jsx(X, { size: 11 }) })] }), _jsx("textarea", { value: resp, onChange: (e) => updateList('completionResponses', idx, e.target.value), rows: 2, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono" })] }, idx))), _jsxs("button", { onClick: () => addItem('completionResponses'), className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors", children: [_jsx(Plus, { size: 11 }), "Add response"] })] }))] })] }));
}
function SoundDetectiveEditor({ value, library, onChange, preview }) {
    const [openIntro, setOpenIntro] = useState(false);
    const [openPickerFor, setOpenPickerFor] = useState(null);
    const [openSoundId, setOpenSoundId] = useState(null);
    const updateSound = (id, patch) => {
        const next = value.sounds.map((s) => (s.id === id ? { ...s, ...patch } : s));
        onChange({ ...value, sounds: next });
    };
    const removeSound = (id) => {
        onChange({ ...value, sounds: value.sounds.filter((s) => s.id !== id) });
    };
    const addSound = () => {
        const id = `sound-${Date.now()}`;
        const next = {
            id, label: 'New sound', audioFilename: '',
            question: '仔细听……\n\n你觉得是什么东西发出的声音？',
            correctKeywords: [], correctResponse: '', wrongResponse: '',
        };
        onChange({ ...value, sounds: [...value.sounds, next] });
        setOpenSoundId(id);
    };
    return (_jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("button", { onClick: () => setOpenIntro(!openIntro), className: "flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors", children: [_jsx(FileText, { size: 11 }), openIntro ? 'Hide' : 'Show', " intro", _jsxs("span", { className: "text-[10px] text-led-muted ml-1", children: ["\u00B7 ", value.intro.length, " chars"] })] }), openIntro && (_jsx("textarea", { value: value.intro, onChange: (e) => onChange({ ...value, intro: e.target.value }), rows: 6, className: "mt-2 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono" }))] }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-medium text-slate-300", children: "Sounds" }), _jsxs("span", { className: "text-[10px] text-led-muted", children: [value.sounds.length, " \u00B7 random pick at runtime"] })] }), _jsxs("p", { className: "mb-2 text-[10px] text-led-muted leading-relaxed", children: ["The AI compares the child's guess against the sound's ", _jsx("em", { children: "label" }), " \u2014 there's no keyword list to maintain. Make sure the label is descriptive (e.g. \"\u9E21 Chicken\")."] }), _jsxs("div", { className: "space-y-2", children: [value.sounds.map((sound) => {
                                const isOpen = openSoundId === sound.id;
                                const isPickerOpen = openPickerFor === sound.id;
                                const fileMissing = sound.audioFilename
                                    && !library.find((f) => f.filename === sound.audioFilename);
                                return (_jsxs("div", { className: "rounded-md border border-led-border bg-led-panel p-2.5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => setOpenSoundId(isOpen ? null : sound.id), className: "text-led-muted hover:text-slate-200 flex-shrink-0", children: isOpen ? _jsx(ChevronDown, { size: 12 }) : _jsx(ChevronRight, { size: 12 }) }), _jsx("input", { type: "text", value: sound.label, onChange: (e) => updateSound(sound.id, { label: e.target.value }), className: "flex-1 bg-led-bg border border-led-border rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500" }), sound.audioFilename && (_jsx("button", { onClick: () => preview.toggle(sound.audioFilename), disabled: Boolean(fileMissing), className: "rounded-full p-1 text-purple-400 hover:bg-white/10 disabled:opacity-40 flex-shrink-0", title: fileMissing ? 'File missing from audio library' : 'Preview', children: preview.playing === sound.audioFilename
                                                        ? _jsx(Pause, { size: 10 })
                                                        : _jsx(Play, { size: 10, className: "ml-0.5" }) })), _jsx("button", { onClick: () => removeSound(sound.id), className: "rounded p-0.5 text-led-muted hover:text-rose-300", title: "Remove sound", children: _jsx(X, { size: 11 }) })] }), isOpen && (_jsxs("div", { className: "mt-2 space-y-2", children: [_jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-led-muted mb-0.5", children: "Audio file" }), _jsxs("div", { className: "relative", children: [_jsx("button", { onClick: () => setOpenPickerFor(isPickerOpen ? null : sound.id), className: [
                                                                        'w-full text-left rounded border px-2 py-1.5 text-[11px] transition-colors',
                                                                        sound.audioFilename
                                                                            ? (fileMissing
                                                                                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                                                                : 'border-purple-500/30 bg-purple-500/10 text-purple-200')
                                                                            : 'border-dashed border-led-border bg-led-bg text-led-muted',
                                                                    ].join(' '), children: sound.audioFilename || 'Click to pick a file…' }), isPickerOpen && (_jsx("div", { className: "absolute z-10 mt-1 left-0 right-0 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto shadow-xl", children: library.length === 0 ? (_jsxs("div", { className: "p-2 text-[11px] text-led-muted", children: ["No files. Drop mp3/m4a into ", _jsx("code", { children: "./data/audio/" }), "."] })) : (library.map((f) => (_jsxs("button", { onClick: () => {
                                                                            updateSound(sound.id, { audioFilename: f.filename });
                                                                            setOpenPickerFor(null);
                                                                        }, className: "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0", children: [_jsx("span", { role: "button", onClick: (e) => { e.stopPropagation(); preview.toggle(f.filename); }, className: "flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20 flex-shrink-0", children: preview.playing === f.filename
                                                                                    ? _jsx(Pause, { size: 9 })
                                                                                    : _jsx(Play, { size: 9, className: "ml-0.5" }) }), _jsx("span", { className: "flex-1 truncate", children: f.filename })] }, f.filename)))) }))] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-led-muted mb-0.5", children: "Question (after sound plays)" }), _jsx("textarea", { value: sound.question, onChange: (e) => updateSound(sound.id, { question: e.target.value }), rows: 2, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-led-muted mb-0.5", children: "When the child guesses correctly" }), _jsx("textarea", { value: sound.correctResponse, onChange: (e) => updateSound(sound.id, { correctResponse: e.target.value }), rows: 3, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[10px] text-led-muted mb-0.5", children: "When the child guesses wrong" }), _jsx("textarea", { value: sound.wrongResponse, onChange: (e) => updateSound(sound.id, { wrongResponse: e.target.value }), rows: 3, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono" })] })] }))] }, sound.id));
                            }), _jsxs("button", { onClick: addSound, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors", children: [_jsx(Plus, { size: 11 }), "Add sound"] })] })] })] }));
}
function PlaceholderGameEditor({ value, onChange }) {
    return (_jsx("div", { className: "mt-4 space-y-3", children: _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsx("div", { className: "text-xs font-medium text-slate-300 mb-1.5", children: "Notes" }), _jsx("textarea", { value: value.notes ?? '', onChange: (e) => onChange({ ...value, notes: e.target.value }), rows: 4, placeholder: "Game 3 isn't designed yet \u2014 jot down any ideas here.", className: "w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" })] }) }));
}
// ── Activities panel ────────────────────────────────────────────────────────
export default function Activities() {
    const [config, setConfig] = useState(null);
    const [original, setOriginal] = useState(null);
    const [library, setLibrary] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [expanded, setExpanded] = useState(null);
    const preview = usePreviewPlayer();
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [c, lib] = await Promise.all([fetchConfig(), fetchAudioLibrary()]);
            setConfig(c);
            setOriginal(c);
            setLibrary(lib);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const updateActivity = (idx, patch) => {
        if (!config)
            return;
        const activities = config.activities.map((a, i) => (i === idx ? { ...a, ...patch } : a));
        setConfig({ ...config, activities });
        setSaved(false);
    };
    const updateGame = (idx, next) => {
        if (!config)
            return;
        const games = (config.games ?? []).map((g, i) => (i === idx ? next : g));
        setConfig({ ...config, games });
        setSaved(false);
    };
    const dirty = config !== null && original !== null && JSON.stringify(config) !== JSON.stringify(original);
    const handleSave = async () => {
        if (!config || saving)
            return;
        setSaving(true);
        setError(null);
        try {
            const next = await saveConfig(config);
            setConfig(next);
            setOriginal(next);
            setSaved(true);
            setTimeout(() => setSaved(false), 1800);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setSaving(false);
        }
    };
    const handleReset = () => {
        if (original)
            setConfig(original);
        setSaved(false);
    };
    return (_jsxs(PanelShell, { title: "Activities", description: "The four core activity levels. Breathing and Body Rhythm support age-bucketed audio + narration scripts. Mapping / Co-Creation editors come later.", children: [(dirty || saved) && (_jsxs("div", { className: "mb-3 flex items-center justify-between rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs", children: [_jsx("span", { className: "text-purple-200", children: saved ? 'Saved.' : 'Unsaved changes' }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: handleReset, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded border border-led-border px-2 py-1 text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-30", children: [_jsx(RotateCcw, { size: 11 }), "Reset"] }), _jsxs("button", { onClick: handleSave, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed", children: [_jsx(Save, { size: 11 }), saving ? 'Saving…' : 'Save'] })] })] })), error && (_jsx("div", { className: "mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300", children: error })), loading && !error && (_jsx("div", { className: "text-sm text-led-muted", children: "Loading\u2026" })), _jsx("div", { className: "space-y-3", children: config?.activities.map((a, idx) => {
                    const isOpen = expanded === a.id;
                    const isScripted = a.id === 'body-rhythm' || a.id === 'breathing';
                    const isEmotion = a.id === 'emotion-music-mapping';
                    const isCoCreation = a.id === 'co-creation';
                    const scripted = a.scripted ?? { ageBuckets: DEFAULT_BUCKETS };
                    const emotionScripted = a.emotionScripted ?? { emotionBuckets: [] };
                    const coCreation = a.coCreation ?? { notes: [], narrationScript: '', audioMappings: [] };
                    return (_jsxs("div", { className: "rounded-lg border border-led-border bg-led-panel", children: [_jsx("button", { onClick: () => setExpanded(isOpen ? null : a.id), className: "w-full p-4 text-left", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-0.5 text-led-muted", children: isOpen ? _jsx(ChevronDown, { size: 14 }) : _jsx(ChevronRight, { size: 14 }) }), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsxs("span", { className: "text-[10px] font-semibold uppercase tracking-widest text-purple-400", children: ["Level ", LEVEL[a.id] ?? '·'] }), _jsx("h3", { className: "text-base font-medium text-slate-200", children: a.name })] }), _jsx("p", { className: "mt-1.5 text-sm leading-relaxed text-slate-400", children: a.description }), _jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600", children: [_jsx("code", { className: "rounded bg-led-bg px-1.5 py-0.5", children: a.id }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["default expression: ", a.defaultExpression] }), a.ssmlStyleOverride && (_jsxs(_Fragment, { children: [_jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["SSML style: ", a.ssmlStyleOverride] })] }))] })] })] }) }), isOpen && (_jsx("div", { className: "border-t border-led-border px-4 pb-4", children: isScripted ? (_jsx(ScriptedActivityEditor, { value: scripted, library: library, preview: preview, onChange: (next) => updateActivity(idx, { scripted: next }) })) : isEmotion ? (_jsx(EmotionActivityEditor, { value: emotionScripted, library: library, preview: preview, onChange: (next) => updateActivity(idx, { emotionScripted: next }) })) : isCoCreation ? (_jsx(CoCreationEditor, { value: coCreation, library: library, preview: preview, onChange: (next) => updateActivity(idx, { coCreation: next }) })) : (_jsxs("div", { className: "mt-3 rounded-md border border-dashed border-led-border bg-led-bg/40 p-4 text-center text-[11px] text-led-muted", children: ["Per-activity editor for ", _jsx("code", { children: a.id }), " comes in a later checkpoint."] })) }))] }, a.id));
                }) }), (config?.games?.length ?? 0) > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mt-10 mb-3 flex items-baseline gap-3", children: [_jsx("h2", { className: "text-lg font-semibold text-slate-100", children: "Games" }), _jsx("span", { className: "text-[10px] text-led-muted", children: "Mini-games triggered randomly during the old-friend session intro" })] }), _jsx("div", { className: "space-y-3", children: (config?.games ?? []).map((g, idx) => {
                            const isOpen = expanded === `game:${g.id}`;
                            return (_jsxs("div", { className: "rounded-lg border border-led-border bg-led-panel", children: [_jsx("button", { onClick: () => setExpanded(isOpen ? null : `game:${g.id}`), className: "w-full p-4 text-left", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-0.5 text-led-muted", children: isOpen ? _jsx(ChevronDown, { size: 14 }) : _jsx(ChevronRight, { size: 14 }) }), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsxs("span", { className: "text-[10px] font-semibold uppercase tracking-widest text-emerald-400", children: ["Game ", idx + 1] }), _jsx("h3", { className: "text-base font-medium text-slate-200", children: g.name })] }), _jsxs("div", { className: "mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-600", children: [_jsx("code", { className: "rounded bg-led-bg px-1.5 py-0.5", children: g.id }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["kind: ", g.kind] }), g.kind === 'rhythm-story' && (_jsxs(_Fragment, { children: [_jsx("span", { children: "\u00B7" }), _jsxs("span", { children: [g.stories.length, " stories / ", g.completionResponses.length, " responses"] })] })), g.kind === 'sound-detective' && (_jsxs(_Fragment, { children: [_jsx("span", { children: "\u00B7" }), _jsxs("span", { children: [g.sounds.length, " sounds"] })] }))] })] })] }) }), isOpen && (_jsxs("div", { className: "border-t border-led-border px-4 pb-4", children: [g.kind === 'rhythm-story' && (_jsx(RhythmStoryEditor, { value: g, onChange: (next) => updateGame(idx, next) })), g.kind === 'sound-detective' && (_jsx(SoundDetectiveEditor, { value: g, library: library, preview: preview, onChange: (next) => updateGame(idx, next) })), g.kind === 'placeholder' && (_jsx(PlaceholderGameEditor, { value: g, onChange: (next) => updateGame(idx, next) }))] }))] }, g.id));
                        }) })] }))] }));
}
