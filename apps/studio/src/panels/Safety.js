import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, RotateCcw, Plus, X, ChevronDown, ChevronUp, ShieldAlert, Play, Pause, Music, } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchAudioLibrary, fetchConfig, saveConfig } from '../api/client.js';
function Section({ title, description, children, tone = 'default' }) {
    const border = tone === 'danger' ? 'border-rose-500/40' : 'border-led-border';
    return (_jsxs("div", { className: `rounded-lg border ${border} bg-led-panel p-4 space-y-3`, children: [_jsxs("div", { children: [_jsxs("h2", { className: "text-sm font-semibold text-slate-100 flex items-center gap-1.5", children: [tone === 'danger' && _jsx(ShieldAlert, { size: 13, className: "text-rose-300" }), title] }), description && (_jsx("p", { className: "mt-0.5 text-[11px] text-led-muted leading-relaxed", children: description }))] }), _jsx("div", { className: "space-y-2", children: children })] }));
}
function StringList({ items, onChange, rows = 2, itemLabel = 'Entry', defaultOpen = true, emptyHint, }) {
    const [open, setOpen] = useState(defaultOpen);
    const update = (idx, next) => {
        onChange(items.map((s, i) => (i === idx ? next : s)));
    };
    const add = () => onChange([...items, '']);
    const remove = (idx) => onChange(items.filter((_, i) => i !== idx));
    return (_jsxs("div", { children: [_jsxs("button", { onClick: () => setOpen(!open), className: "flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors", children: [open ? _jsx(ChevronUp, { size: 11 }) : _jsx(ChevronDown, { size: 11 }), items.length, " ", items.length === 1 ? itemLabel.toLowerCase() : itemLabel.toLowerCase() + 's'] }), open && (_jsxs("div", { className: "mt-2 space-y-2", children: [items.length === 0 && emptyHint && (_jsx("p", { className: "text-[10px] italic text-led-muted/70", children: emptyHint })), items.map((value, idx) => (_jsxs("div", { className: "flex items-start gap-2", children: [_jsxs("span", { className: "text-[10px] text-led-muted pt-2 w-5 text-right", children: [idx + 1, "."] }), _jsx("textarea", { value: value, onChange: (e) => update(idx, e.target.value), rows: rows, className: "flex-1 resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono" }), _jsx("button", { onClick: () => remove(idx), className: "mt-1.5 text-led-muted hover:text-rose-300 transition-colors", title: `Remove ${itemLabel.toLowerCase()}`, children: _jsx(X, { size: 12 }) })] }, idx))), _jsxs("button", { onClick: add, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors", children: [_jsx(Plus, { size: 11 }), "Add ", itemLabel.toLowerCase()] })] }))] }));
}
function ComfortMusicList({ files, onChange }) {
    const [library, setLibrary] = useState(null);
    const [libraryError, setLibraryError] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [playingFile, setPlayingFile] = useState(null);
    const audioRef = useRef(null);
    // Lazy-load the audio library the first time the picker opens.
    const loadLibrary = useCallback(async () => {
        if (library !== null)
            return;
        try {
            const entries = await fetchAudioLibrary();
            setLibrary(entries.map((e) => e.filename));
        }
        catch (e) {
            setLibraryError(e.message);
            setLibrary([]);
        }
    }, [library]);
    const togglePreview = (filename) => {
        if (playingFile === filename) {
            audioRef.current?.pause();
            audioRef.current = null;
            setPlayingFile(null);
            return;
        }
        audioRef.current?.pause();
        const audio = new Audio(`/api/audio/file/${encodeURIComponent(filename)}`);
        audio.volume = 0.7;
        audioRef.current = audio;
        setPlayingFile(filename);
        audio.addEventListener('ended', () => {
            if (audioRef.current === audio)
                audioRef.current = null;
            setPlayingFile((p) => (p === filename ? null : p));
        });
        audio.addEventListener('error', () => {
            if (audioRef.current === audio)
                audioRef.current = null;
            setPlayingFile((p) => (p === filename ? null : p));
        });
        void audio.play().catch(() => {
            setPlayingFile((p) => (p === filename ? null : p));
        });
    };
    // Stop any preview when this component unmounts (panel switch / save reload).
    useEffect(() => () => { audioRef.current?.pause(); }, []);
    const available = (library ?? []).filter((f) => !files.includes(f));
    return (_jsxs("div", { className: "space-y-2", children: [files.length === 0 && (_jsx("p", { className: "text-[10px] italic text-led-muted/70", children: "No tracks configured \u2014 the concerning music offer will silently no-op when the child says yes." })), files.map((filename, idx) => (_jsxs("div", { className: "flex items-center gap-2 bg-led-bg rounded border border-led-border px-2 py-1.5", children: [_jsx("button", { onClick: () => togglePreview(filename), className: "flex-shrink-0 w-6 h-6 rounded-full bg-purple-600/30 hover:bg-purple-600/50 flex items-center justify-center text-purple-100 transition-colors", title: playingFile === filename ? 'Pause preview' : 'Preview', children: playingFile === filename ? _jsx(Pause, { size: 11 }) : _jsx(Play, { size: 11 }) }), _jsx(Music, { size: 11, className: "text-slate-500 flex-shrink-0" }), _jsx("span", { className: "flex-1 text-[11px] text-slate-200 truncate font-mono", children: filename }), _jsx("button", { onClick: () => onChange(files.filter((_, i) => i !== idx)), className: "text-led-muted hover:text-rose-300 transition-colors flex-shrink-0", title: "Remove from list", children: _jsx(X, { size: 12 }) })] }, filename + idx))), _jsx("div", { children: _jsxs("button", { onClick: () => {
                        void loadLibrary();
                        setPickerOpen((v) => !v);
                    }, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors", children: [_jsx(Plus, { size: 11 }), "Add track"] }) }), pickerOpen && (_jsxs("div", { className: "mt-1 rounded border border-led-border bg-led-bg p-2 space-y-1 max-h-56 overflow-y-auto", children: [library === null && _jsx("div", { className: "text-[10px] text-led-muted", children: "Loading audio library\u2026" }), libraryError && _jsx("div", { className: "text-[10px] text-rose-400", children: libraryError }), library !== null && available.length === 0 && (_jsx("div", { className: "text-[10px] italic text-led-muted/70", children: "No more files available \u2014 every track in the audio library is already on the list. Upload more in the Audio Library panel." })), available.map((filename) => (_jsxs("div", { className: "flex items-center gap-2 px-1 py-1 hover:bg-led-panel rounded", children: [_jsx("button", { onClick: () => togglePreview(filename), className: "flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-200 transition-colors", title: playingFile === filename ? 'Pause preview' : 'Preview', children: playingFile === filename ? _jsx(Pause, { size: 9 }) : _jsx(Play, { size: 9 }) }), _jsx("span", { className: "flex-1 text-[11px] text-slate-300 truncate font-mono", children: filename }), _jsxs("button", { onClick: () => {
                                    onChange([...files, filename]);
                                    if (playingFile === filename) {
                                        audioRef.current?.pause();
                                        audioRef.current = null;
                                        setPlayingFile(null);
                                    }
                                }, className: "inline-flex items-center gap-0.5 rounded bg-purple-600/40 hover:bg-purple-600/60 px-1.5 py-0.5 text-[10px] text-purple-100 transition-colors", children: [_jsx(Plus, { size: 10 }), "Add"] })] }, filename)))] }))] }));
}
// ── Component ─────────────────────────────────────────────────────────────────
export default function Safety() {
    const [config, setConfig] = useState(null);
    const [original, setOriginal] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const c = await fetchConfig();
            setConfig(c);
            setOriginal(c);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const safety = config?.safety;
    const updateSafety = (patch) => {
        if (!config)
            return;
        setConfig({ ...config, safety: { ...config.safety, ...patch } });
        setSaved(false);
    };
    const dirty = config !== null && original !== null
        && JSON.stringify(config.safety) !== JSON.stringify(original.safety);
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
    return (_jsxs(PanelShell, { title: "Safety", description: "Rules injected into the system prompt under ## Safety. Each list goes to the model as a bullet point; edits apply on the next chat session.", children: [(dirty || saved) && (_jsxs("div", { className: "mb-3 flex items-center justify-between rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs", children: [_jsx("span", { className: "text-purple-200", children: saved ? 'Saved.' : 'Unsaved changes' }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: handleReset, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded border border-led-border px-2 py-1 text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-30", children: [_jsx(RotateCcw, { size: 11 }), "Reset"] }), _jsxs("button", { onClick: handleSave, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed", children: [_jsx(Save, { size: 11 }), saving ? 'Saving…' : 'Save'] })] })] })), error && (_jsx("div", { className: "mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300", children: error })), loading && !error && _jsx("div", { className: "text-sm text-led-muted", children: "Loading\u2026" }), safety && (_jsxs("div", { className: "space-y-4", children: [_jsx(Section, { title: "Topics to avoid", description: "Subjects the model should not bring up or follow into. Rendered in the system prompt as \u201CTopics to avoid: \u2026\u201D.", children: _jsx(StringList, { items: safety.avoidTopics, onChange: (v) => updateSafety({ avoidTopics: v }), rows: 1, itemLabel: "Topic", emptyHint: "No topics listed \u2014 the model will treat all subjects as allowed." }) }), _jsx(Section, { title: "Hard prohibitions", description: "Never-under-any-circumstances rules. The strongest line the model sees in the safety block.", tone: "danger", children: _jsx(StringList, { items: safety.hardProhibitions, onChange: (v) => updateSafety({ hardProhibitions: v }), rows: 2, itemLabel: "Prohibition", emptyHint: "No hard prohibitions defined." }) }), _jsx(Section, { title: "Distress keywords", description: "Highest-priority intercept. TestChat substring-matches every real user message against this list BEFORE the scripted intro, the active activity, or any LLM call. A match short-circuits the turn \u2014 the message never reaches the cloud model.", tone: "danger", children: _jsx(StringList, { items: safety.distressKeywords, onChange: (v) => updateSafety({ distressKeywords: v }), rows: 1, itemLabel: "Keyword", emptyHint: "No keywords defined \u2014 distress detection is disabled until you add at least one." }) }), _jsx(Section, { title: "Model-judged distress detection", description: "After every model reply, the runtime sends the reply back to the classifier model and asks: \u201Cis this a distress-handling response?\u201D. If yes, the session ends with the caregiver banner. No keyword list \u2014 the model judges semantically so \u5988\u5988\u5728\u5916\u9762\u7B49\u4F60 doesn't false-fire while \u8BF7\u9A6C\u4E0A\u544A\u8BC9\u62A4\u58EB does.", tone: "danger", children: _jsxs("p", { className: "text-[11px] text-led-muted leading-relaxed", children: ["Edit the judging prompt in ", _jsx("code", { className: "text-slate-300", children: "apps/server/src/routes/classify.ts" }), " under the ", _jsx("code", { className: "text-slate-300", children: "'assistant-distress'" }), " schema."] }) }), _jsx(Section, { title: "Caregiver banner", description: "Shown in a sticky red banner above TestChat after ANY distress signal (local keyword, Azure 400 filter, or model-judged). Persists across End Session and clears on Start Chatting.", tone: "danger", children: _jsx("textarea", { value: safety.distressCaregiverNote ?? '', onChange: (e) => updateSafety({ distressCaregiverNote: e.target.value }), rows: 4, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-rose-500 font-mono", placeholder: "Operator-facing text shown in the banner after a distress event\u2026" }) }), _jsx(Section, { title: "Comfort music", description: "After the concerning-level safety response, TestChat asks the child if they want to hear a soft track. Yes \u2192 rotates through this list (next file each time, in order). Files live in data/audio/.", children: _jsx(ComfortMusicList, { files: safety.comfortMusicFiles ?? [], onChange: (v) => updateSafety({ comfortMusicFiles: v }) }) })] }))] }));
}
