import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { Save, RotateCcw, Bot, Languages } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchConfig, saveConfig } from '../api/client.js';
const LANG_LABEL = {
    'zh-CN': '中文 (Mandarin)',
    'en-US': 'English',
};
export default function Identity() {
    const [config, setConfig] = useState(null);
    const [original, setOriginal] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        fetchConfig()
            .then((c) => {
            setConfig(c);
            setOriginal(c);
        })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => { load(); }, [load]);
    const updateIdentity = (patch) => {
        if (!config)
            return;
        setConfig({ ...config, identity: { ...config.identity, ...patch } });
        setSaved(false);
    };
    const dirty = config !== null &&
        original !== null &&
        JSON.stringify(config.identity) !== JSON.stringify(original.identity);
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
    return (_jsxs(PanelShell, { title: "Identity", description: "Robot name, tagline, and language. These appear in every system prompt and TTS call.", children: [(dirty || saved) && (_jsxs("div", { className: "mb-3 flex items-center justify-between rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs", children: [_jsx("span", { className: "text-purple-200", children: saved ? 'Saved.' : 'Unsaved changes' }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: handleReset, disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded border border-led-border px-2 py-1 text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-30", children: [_jsx(RotateCcw, { size: 11 }), "Reset"] }), _jsxs("button", { onClick: () => void handleSave(), disabled: !dirty || saving, className: "inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed", children: [_jsx(Save, { size: 11 }), saving ? 'Saving…' : 'Save'] })] })] })), error && (_jsx("div", { className: "mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300", children: error })), loading && !error && (_jsx("div", { className: "text-sm text-led-muted", children: "Loading\u2026" })), config && (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { children: [_jsxs("label", { className: "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: [_jsx(Bot, { size: 11 }), "Robot name"] }), _jsx("input", { type: "text", value: config.identity.robotName, onChange: (e) => updateIdentity({ robotName: e.target.value }), maxLength: 40, className: "mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-base text-slate-100 focus:outline-none focus:border-purple-500" }), _jsxs("p", { className: "mt-1 text-[10px] text-led-muted", children: ["The name the robot uses to refer to itself. Appears as \u201CYou are ", config.identity.robotName, "\u2026\u201D in the system prompt."] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: "Tagline" }), _jsx("input", { type: "text", value: config.identity.tagline, onChange: (e) => updateIdentity({ tagline: e.target.value }), maxLength: 120, className: "mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500" }), _jsxs("div", { className: "mt-1 flex items-center justify-between text-[10px] text-led-muted", children: [_jsx("span", { children: "One-line self-description shown below the name in the prompt." }), _jsxs("span", { children: [config.identity.tagline.length, " / 120"] })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsxs("label", { className: "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: [_jsx(Languages, { size: 11 }), "Primary language"] }), _jsx("select", { value: config.identity.primaryLanguage, onChange: (e) => updateIdentity({
                                            primaryLanguage: e.target.value,
                                        }), className: "mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500", children: Object.entries(LANG_LABEL).map(([id, label]) => (_jsx("option", { value: id, children: label }, id))) }), _jsx("p", { className: "mt-1 text-[10px] text-led-muted", children: "The robot\u2019s first-choice language in every reply." })] }), _jsxs("div", { children: [_jsx("label", { className: "text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: "Secondary language" }), _jsxs("select", { value: config.identity.secondaryLanguage ?? '', onChange: (e) => {
                                            const v = e.target.value;
                                            if (v === '') {
                                                if (!config)
                                                    return;
                                                const { secondaryLanguage: _drop, ...rest } = config.identity;
                                                setConfig({ ...config, identity: rest });
                                                setSaved(false);
                                            }
                                            else {
                                                updateIdentity({ secondaryLanguage: v });
                                            }
                                        }, className: "mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500", children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), Object.entries(LANG_LABEL).map(([id, label]) => (_jsx("option", { value: id, children: label }, id)))] }), _jsx("p", { className: "mt-1 text-[10px] text-led-muted", children: "A fallback used when natural; leave empty for monolingual." })] })] }), _jsxs("div", { className: "rounded-md border border-led-border bg-led-bg/40 p-3 text-[11px] leading-relaxed text-slate-400", children: [_jsx("div", { className: "font-semibold uppercase tracking-widest text-[9px] text-led-muted mb-1.5", children: "Project context (read-only)" }), _jsxs("div", { className: "space-y-0.5", children: [_jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "Target users:" }), " hospitalized children aged 3\u201312 at \u5C0F\u6C34\u6EF4 (Beijing)."] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "Persona on robot side:" }), " picked at runtime from the Personas panel (currently ", LANG_LABEL[config.identity.primaryLanguage], " primary)."] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "Voice:" }), " set in the Voice panel \u2014 current default ", _jsx("code", { className: "text-slate-300", children: config.voice.defaultVoice }), "."] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-500", children: "Backstory:" }), " Rainbow Diverse town \u2014 every heart has a song. Used as the first-time self-introduction."] })] })] })] }))] }));
}
