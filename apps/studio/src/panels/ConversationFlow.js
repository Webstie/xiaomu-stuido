import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { Save, RotateCcw, Plus, X, ChevronDown, ChevronUp, } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchConfig, saveConfig } from '../api/client.js';
function Field({ label, hint, children }) {
    return (_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { children: [_jsx("label", { className: "text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: label }), hint && _jsx("p", { className: "mt-0.5 text-[10px] text-led-muted/70", children: hint })] }), children] }));
}
function TextInput({ value, onChange, placeholder }) {
    return (_jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, className: "w-full bg-led-panel border border-led-border rounded-md px-2.5 py-1.5 text-[12px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500" }));
}
function TextArea({ value, onChange, rows = 4, placeholder }) {
    return (_jsx("textarea", { value: value, onChange: (e) => onChange(e.target.value), rows: rows, placeholder: placeholder, className: "w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono" }));
}
function NumberInput({ value, onChange, min = 1, max = 99 }) {
    return (_jsx("input", { type: "number", value: Number.isFinite(value) ? value : '', min: min, max: max, onChange: (e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n >= min && n <= max)
                onChange(n);
        }, className: "w-20 bg-led-panel border border-led-border rounded-md px-2.5 py-1.5 text-[12px] text-slate-200 focus:outline-none focus:border-purple-500" }));
}
function StringList({ label, hint, items, onChange, rows = 2, itemLabel = 'Item', defaultOpen = false, }) {
    const [open, setOpen] = useState(defaultOpen);
    const update = (idx, next) => {
        onChange(items.map((s, i) => (i === idx ? next : s)));
    };
    const add = () => onChange([...items, '']);
    const remove = (idx) => onChange(items.filter((_, i) => i !== idx));
    return (_jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3", children: [_jsx("button", { onClick: () => setOpen(!open), className: "flex w-full items-center justify-between text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors", children: _jsxs("span", { className: "flex items-center gap-1.5", children: [open ? _jsx(ChevronUp, { size: 11 }) : _jsx(ChevronDown, { size: 11 }), label, _jsxs("span", { className: "text-[10px] text-led-muted font-normal", children: ["\u00B7 ", items.length, " ", items.length === 1 ? 'entry' : 'entries'] })] }) }), hint && _jsx("p", { className: "mt-1 text-[10px] text-led-muted/70", children: hint }), open && (_jsxs("div", { className: "mt-2 space-y-2", children: [items.map((value, idx) => (_jsxs("div", { className: "rounded border border-led-border bg-led-panel p-2", children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsxs("span", { className: "text-[10px] text-led-muted", children: [itemLabel, " ", idx + 1] }), _jsx("button", { onClick: () => remove(idx), className: "text-led-muted hover:text-rose-300 transition-colors", title: `Remove ${itemLabel.toLowerCase()}`, children: _jsx(X, { size: 11 }) })] }), _jsx("textarea", { value: value, onChange: (e) => update(idx, e.target.value), rows: rows, className: "w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono" })] }, idx))), _jsxs("button", { onClick: add, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors", children: [_jsx(Plus, { size: 11 }), "Add ", itemLabel.toLowerCase()] })] }))] }));
}
function Section({ title, description, children }) {
    return (_jsxs("div", { className: "rounded-lg border border-led-border bg-led-panel p-4 space-y-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-slate-100", children: title }), description && (_jsx("p", { className: "mt-0.5 text-[11px] text-led-muted leading-relaxed", children: description }))] }), _jsx("div", { className: "space-y-3", children: children })] }));
}
// ── Component ─────────────────────────────────────────────────────────────────
export default function ConversationFlow() {
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
    const flow = config?.conversationFlow;
    const updateFlow = (patch) => {
        if (!config)
            return;
        setConfig({ ...config, conversationFlow: { ...config.conversationFlow, ...patch } });
        setSaved(false);
    };
    const dirty = config !== null && original !== null
        && JSON.stringify(config.conversationFlow) !== JSON.stringify(original.conversationFlow);
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
    return (_jsxs(PanelShell, { title: "Conversation Flow", description: "Scripted intro phrases, transition lines, and break behavior. Edits take effect on the next chat session.", children: [(dirty || saved) && (_jsxs("div", { className: "mb-3 flex items-center justify-between rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs", children: [_jsx("span", { className: "text-purple-200", children: saved ? 'Saved.' : 'Unsaved changes' }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: handleReset, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded border border-led-border px-2 py-1 text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-30", children: [_jsx(RotateCcw, { size: 11 }), "Reset"] }), _jsxs("button", { onClick: handleSave, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed", children: [_jsx(Save, { size: 11 }), saving ? 'Saving…' : 'Save'] })] })] })), error && (_jsx("div", { className: "mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300", children: error })), loading && !error && _jsx("div", { className: "text-sm text-led-muted", children: "Loading\u2026" }), flow && (_jsxs("div", { className: "space-y-4", children: [_jsxs(Section, { title: "Session opening & closing", description: "Hints fed to the LLM in the system prompt. The model uses these as guidance, not verbatim lines.", children: [_jsx(Field, { label: "Opening hint", children: _jsx(TextArea, { value: flow.sessionOpeningScript, onChange: (v) => updateFlow({ sessionOpeningScript: v }), rows: 2 }) }), _jsx(Field, { label: "Closing options", hint: 'Separate alternatives with " / ". The model picks one that fits the moment.', children: _jsx(TextArea, { value: flow.sessionClosingScript, onChange: (v) => updateFlow({ sessionClosingScript: v }), rows: 3 }) })] }), _jsxs(Section, { title: "Session start (scripted intro)", description: "Spoken verbatim by TestChat before the LLM takes over. The first-meeting question routes the child into one of two paths.", children: [_jsx(Field, { label: "First-meeting question", hint: "Asked first on Start Chatting. The child's yes / no picks the path below.", children: _jsx(TextInput, { value: flow.firstMeetingQuestion ?? '', onChange: (v) => updateFlow({ firstMeetingQuestion: v }) }) }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3 space-y-3", children: [_jsx("h3", { className: "text-[11px] font-semibold uppercase tracking-widest text-purple-300", children: "First-time visitor path" }), _jsx(Field, { label: "Long welcome", hint: "Shown when the child confirms it's their first meeting.", children: _jsx(TextArea, { value: flow.startChattingIntro ?? '', onChange: (v) => updateFlow({ startChattingIntro: v }), rows: 8 }) }), _jsx(Field, { label: "Age prompt", children: _jsx(TextInput, { value: flow.agePrompt ?? '', onChange: (v) => updateFlow({ agePrompt: v }) }) }), _jsx(Field, { label: "Full weather prompt", hint: "The five-weather picker.", children: _jsx(TextArea, { value: flow.weatherPrompt ?? '', onChange: (v) => updateFlow({ weatherPrompt: v }), rows: 10 }) })] }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3 space-y-3", children: [_jsx("h3", { className: "text-[11px] font-semibold uppercase tracking-widest text-purple-300", children: "Returning visitor path" }), _jsx(Field, { label: "Old-friend intro prefix", hint: "Prepended to one of the random daily stories below.", children: _jsx(TextInput, { value: flow.oldFriendIntroPrefix ?? '', onChange: (v) => updateFlow({ oldFriendIntroPrefix: v }) }) }), _jsx(StringList, { label: "Random daily stories", hint: "The robot's \u201Cwhat I did today\u201D opener. One is picked at random and appended to the old-friend prefix above; each ends with a question for the child.", items: flow.returningSessionIntros ?? [], onChange: (v) => updateFlow({ returningSessionIntros: v }), rows: 4, itemLabel: "Daily story", defaultOpen: true }), _jsx(Field, { label: "Short weather prompt", hint: "Appended to the mood mirror after the child answers \u2014 sent in the same bubble. Returning visitors skip the age question.", children: _jsx(TextInput, { value: flow.shortWeatherPrompt ?? '', onChange: (v) => updateFlow({ shortWeatherPrompt: v }) }) })] })] }), _jsx(Section, { title: "Transition phrases", description: "Available to the model when shifting between topics or activities.", children: _jsx(StringList, { label: "Transitions", items: flow.transitionPhrases, onChange: (v) => updateFlow({ transitionPhrases: v }), rows: 2, itemLabel: "Phrase", defaultOpen: true }) }), _jsxs(Section, { title: "Breaks", description: "After this many free-form turns (an activity or game counts as one), TestChat injects a break suggestion. The child can keep going.", children: [_jsx(Field, { label: "Max turns before break", children: _jsx(NumberInput, { value: flow.maxTurnsBeforeBreak, onChange: (v) => updateFlow({ maxTurnsBeforeBreak: v }), min: 1, max: 50 }) }), _jsx(StringList, { label: "Break suggestion phrases", hint: "One is picked at random when the threshold is reached. They should sound optional, not demanding.", items: flow.breakSuggestionPhrases ?? [], onChange: (v) => updateFlow({ breakSuggestionPhrases: v }), rows: 3, itemLabel: "Phrase", defaultOpen: true })] })] }))] }));
}
