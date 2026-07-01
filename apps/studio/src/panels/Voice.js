import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Check, Save, Loader2, Volume2, Globe, } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchConfig, saveConfig, fetchTtsVisemes, } from '../api/client.js';
const VOICE_CATALOG = [
    {
        id: 'zh-CN-XiaoxiaoMultilingualNeural',
        nameZh: '小晓 · 多语言',
        nameEn: 'Xiaoxiao Multilingual',
        gender: 'female',
        description: '默认。年轻女声,自然温暖,支持中英文同句混读。',
        multilingual: true,
        styles: ['cheerful', 'gentle', 'whispering', 'excited', 'empathetic'],
    },
    {
        id: 'zh-CN-XiaoxiaoNeural',
        nameZh: '小晓',
        nameEn: 'Xiaoxiao',
        gender: 'female',
        description: '标准女声,情感丰富,支持多种风格(cheerful / gentle / sad 等)。',
        multilingual: false,
        styles: ['cheerful', 'gentle', 'sad', 'angry', 'fearful', 'disgruntled', 'serious', 'affectionate'],
    },
    {
        id: 'zh-CN-XiaoyiNeural',
        nameZh: '小怡',
        nameEn: 'Xiaoyi',
        gender: 'female',
        description: '年轻女声,清亮活泼,适合做朋友式陪伴对话。',
        multilingual: false,
        styles: ['cheerful', 'embarrassed', 'fearful', 'sad', 'serious'],
    },
    {
        id: 'zh-CN-XiaomengNeural',
        nameZh: '小梦',
        nameEn: 'Xiaomeng',
        gender: 'female',
        description: '温柔女声,语速偏慢,适合呼吸练习等舒缓场景。',
        multilingual: false,
        styles: ['chat'],
    },
    {
        id: 'zh-CN-XiaoshuangNeural',
        nameZh: '小双',
        nameEn: 'Xiaoshuang',
        gender: 'female',
        description: '童声(女)。和小朋友说话不会有"大人在哄孩子"的感觉。',
        multilingual: false,
    },
    {
        id: 'zh-CN-YunxiNeural',
        nameZh: '云希',
        nameEn: 'Yunxi',
        gender: 'male',
        description: '标准男声,稳重亲切,适合"哥哥型"陪伴。',
        multilingual: false,
        styles: ['narration-relaxed', 'embarrassed', 'fearful', 'cheerful', 'disgruntled', 'serious', 'angry', 'sad', 'depressed'],
    },
    {
        id: 'zh-CN-YunxiaNeural',
        nameZh: '云夏',
        nameEn: 'Yunxia',
        gender: 'male',
        description: '童声(男)。轻快俏皮,适合活泼互动。',
        multilingual: false,
        styles: ['calm', 'fearful', 'cheerful', 'angry', 'sad'],
    },
    {
        id: 'zh-CN-YunjianNeural',
        nameZh: '云健',
        nameEn: 'Yunjian',
        gender: 'male',
        description: '浑厚男声,适合讲故事场景。',
        multilingual: false,
        styles: ['narration-relaxed', 'sports-commentary', 'sports-commentary-excited'],
    },
    {
        id: 'zh-CN-XiaochenMultilingualNeural',
        nameZh: '小辰 · 多语言',
        nameEn: 'Xiaochen Multilingual',
        gender: 'female',
        description: '多语言女声,声线偏温润,中英文都自然。',
        multilingual: true,
    },
    {
        id: 'zh-CN-YunyiMultilingualNeural',
        nameZh: '云逸 · 多语言',
        nameEn: 'Yunyi Multilingual',
        gender: 'male',
        description: '多语言男声,清亮稳定,中英文同句混读。',
        multilingual: true,
    },
];
const DEFAULT_PREVIEW_TEXT = '你好呀,我是小沐。今天我们一起来做一些好玩的事情,好不好?';
// ── Component ────────────────────────────────────────────────────────────────
export default function Voice() {
    const [config, setConfig] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT);
    const [previewing, setPreviewing] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(null);
    const [savingVoiceId, setSavingVoiceId] = useState(null);
    const [savedFlash, setSavedFlash] = useState(null);
    const audioRef = useRef(null);
    useEffect(() => {
        fetchConfig()
            .then(setConfig)
            .catch((e) => setLoadError(e.message));
    }, []);
    // Cleanup audio on unmount
    useEffect(() => () => {
        audioRef.current?.pause();
        audioRef.current = null;
    }, []);
    const stopPreview = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        setPreviewing(null);
    }, []);
    const playPreview = useCallback(async (voiceId) => {
        if (previewing === voiceId) {
            stopPreview();
            return;
        }
        stopPreview();
        setLoadingPreview(voiceId);
        try {
            const data = await fetchTtsVisemes(previewText, 'cheerful', voiceId);
            const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
            audioRef.current = audio;
            audio.addEventListener('ended', () => {
                if (audioRef.current === audio) {
                    audioRef.current = null;
                    setPreviewing(null);
                }
            });
            setPreviewing(voiceId);
            await audio.play();
        }
        catch (e) {
            setLoadError(`Preview failed: ${e.message}`);
            setPreviewing(null);
        }
        finally {
            setLoadingPreview(null);
        }
    }, [previewing, previewText, stopPreview]);
    const setAsDefault = useCallback(async (voiceId) => {
        if (!config)
            return;
        setSavingVoiceId(voiceId);
        setLoadError(null);
        try {
            const next = await saveConfig({
                ...config,
                voice: { ...config.voice, defaultVoice: voiceId },
            });
            setConfig(next);
            setSavedFlash(voiceId);
            setTimeout(() => setSavedFlash(null), 1600);
        }
        catch (e) {
            setLoadError(`Save failed: ${e.message}`);
        }
        finally {
            setSavingVoiceId(null);
        }
    }, [config]);
    const currentDefault = config?.voice.defaultVoice;
    return (_jsxs(PanelShell, { title: "Voice", description: "Default TTS voice for chat playback. Click \u25B6 to preview; click Set as default to apply.", children: [loadError && (_jsx("div", { className: "mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300", children: loadError })), _jsxs("div", { className: "mb-4", children: [_jsx("label", { className: "text-[10px] font-semibold uppercase tracking-widest text-led-muted", children: "Preview text" }), _jsx("textarea", { value: previewText, onChange: (e) => setPreviewText(e.target.value), rows: 2, maxLength: 300, className: "mt-1 w-full resize-none bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500" }), _jsxs("div", { className: "mt-1 flex items-center justify-between text-[10px] text-led-muted", children: [_jsxs("span", { children: [previewText.length, " / 300 chars"] }), _jsx("button", { onClick: () => setPreviewText(DEFAULT_PREVIEW_TEXT), className: "hover:text-slate-300 transition-colors", children: "Reset to default sample" })] })] }), _jsx("div", { className: "space-y-2.5", children: VOICE_CATALOG.map((v) => {
                    const isCurrent = currentDefault === v.id;
                    const isPlaying = previewing === v.id;
                    const isLoading = loadingPreview === v.id;
                    const isSaving = savingVoiceId === v.id;
                    const justSaved = savedFlash === v.id;
                    return (_jsx("div", { className: [
                            'rounded-lg border p-3 transition-colors',
                            isCurrent
                                ? 'border-purple-500/60 bg-purple-500/10'
                                : 'border-led-border bg-led-panel hover:border-slate-600',
                        ].join(' '), children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("button", { onClick: () => void playPreview(v.id), disabled: isLoading || !previewText.trim(), className: [
                                        'flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 transition-colors',
                                        isPlaying
                                            ? 'bg-purple-600 text-white hover:bg-purple-500'
                                            : 'bg-led-bg border border-led-border text-purple-400 hover:bg-purple-500/20',
                                        isLoading ? 'opacity-60 cursor-wait' : '',
                                    ].join(' '), title: isPlaying ? 'Stop preview' : 'Preview this voice', children: isLoading
                                        ? _jsx(Loader2, { size: 14, className: "animate-spin" })
                                        : isPlaying
                                            ? _jsx(Pause, { size: 14 })
                                            : _jsx(Play, { size: 14, className: "ml-0.5" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-baseline gap-2 flex-wrap", children: [_jsx("h3", { className: "text-sm font-medium text-slate-200", children: v.nameZh }), _jsxs("span", { className: "text-[11px] text-led-muted", children: ["\u00B7 ", v.nameEn] }), isCurrent && (_jsxs("span", { className: "inline-flex items-center gap-1 text-[10px] font-medium text-purple-300", children: [_jsx(Check, { size: 10 }), "Current default"] }))] }), _jsxs("div", { className: "mt-0.5 flex items-center gap-2 text-[10px] text-led-muted", children: [_jsx("span", { className: v.gender === 'female' ? 'text-pink-400/70' : 'text-sky-400/70', children: v.gender === 'female' ? '女声' : '男声' }), v.multilingual && (_jsxs(_Fragment, { children: [_jsx("span", { children: "\u00B7" }), _jsxs("span", { className: "inline-flex items-center gap-0.5 text-emerald-400/70", children: [_jsx(Globe, { size: 9 }), "\u591A\u8BED\u8A00"] })] })), _jsx("span", { children: "\u00B7" }), _jsx("code", { className: "text-slate-500", children: v.id })] }), _jsx("p", { className: "mt-1.5 text-xs text-slate-400 leading-relaxed", children: v.description }), v.styles && v.styles.length > 0 && (_jsxs("div", { className: "mt-1.5 flex flex-wrap gap-1", children: [v.styles.slice(0, 6).map((s) => (_jsx("span", { className: "inline-block rounded-full bg-led-bg px-1.5 py-0.5 text-[9px] text-slate-500 border border-led-border", children: s }, s))), v.styles.length > 6 && (_jsxs("span", { className: "text-[9px] text-led-muted", children: ["+", v.styles.length - 6] }))] }))] }), _jsx("div", { className: "flex-shrink-0", children: isCurrent ? (_jsxs("span", { className: "inline-flex items-center gap-1 text-[10px] text-purple-300/70 px-2 py-1", children: [_jsx(Volume2, { size: 10 }), "Active"] })) : (_jsxs("button", { onClick: () => void setAsDefault(v.id), disabled: isSaving || !config, className: "inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-100 hover:border-purple-500/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed", children: [isSaving
                                                ? _jsx(Loader2, { size: 10, className: "animate-spin" })
                                                : justSaved
                                                    ? _jsx(Check, { size: 10 })
                                                    : _jsx(Save, { size: 10 }), isSaving ? 'Saving…' : justSaved ? 'Saved' : 'Set as default'] })) })] }) }, v.id));
                }) }), _jsxs("p", { className: "mt-4 text-[10px] text-led-muted leading-relaxed", children: ["Voices are Azure Speech neural voices. Switching the default re-saves ", _jsx("code", { children: "config.voice.defaultVoice" }), ". TestChat reads the value on mount \u2014 switch to TestChat (or refresh) for the change to take effect there."] })] }));
}
