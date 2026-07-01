import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Music as MusicIcon, RefreshCw } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
function formatBytes(b) {
    if (b < 1024)
        return `${b} B`;
    if (b < 1024 * 1024)
        return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function formatTime(s) {
    if (!isFinite(s) || s < 0)
        return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}
export default function AudioLibrary() {
    const [files, setFiles] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeFilename, setActiveFilename] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const audioRef = useRef(null);
    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        fetch('/api/audio')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((data) => setFiles(data))
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => {
        load();
    }, [load]);
    // Cleanup on unmount
    useEffect(() => () => {
        audioRef.current?.pause();
        audioRef.current = null;
    }, []);
    const togglePlay = useCallback((filename) => {
        // Same file — pause/resume
        if (activeFilename === filename && audioRef.current) {
            if (audioRef.current.paused) {
                void audioRef.current.play();
            }
            else {
                audioRef.current.pause();
            }
            return;
        }
        // Different file — tear down the old, create new
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        const audio = new Audio(`/api/audio/file/${encodeURIComponent(filename)}`);
        audioRef.current = audio;
        audio.addEventListener('play', () => setIsPlaying(true));
        audio.addEventListener('pause', () => setIsPlaying(false));
        audio.addEventListener('ended', () => {
            setIsPlaying(false);
            setCurrentTime(0);
        });
        audio.addEventListener('timeupdate', () => {
            setCurrentTime(audio.currentTime);
        });
        audio.addEventListener('loadedmetadata', () => {
            setDuration(audio.duration);
        });
        audio.addEventListener('error', () => {
            setError(`Playback error: ${filename}`);
            setIsPlaying(false);
        });
        setActiveFilename(filename);
        setDuration(0);
        setCurrentTime(0);
        void audio.play();
    }, [activeFilename]);
    // Click on progress bar to seek
    const onSeek = useCallback((e) => {
        const audio = audioRef.current;
        if (!audio || !duration)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * duration;
    }, [duration]);
    return (_jsxs(PanelShell, { title: "Audio Library", description: "Drop .mp3 / .wav / .m4a / .ogg files into ./data/audio/. Sorted alphabetically. Click play to listen.", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsx("div", { className: "text-xs text-led-muted", children: loading
                            ? 'Loading…'
                            : `${files.length} file${files.length === 1 ? '' : 's'}` }), _jsxs("button", { onClick: load, disabled: loading, className: "flex items-center gap-1.5 rounded-md border border-led-border px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40", children: [_jsx(RefreshCw, { size: 11, className: loading ? 'animate-spin' : '' }), "Refresh"] })] }), error && (_jsx("div", { className: "mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300", children: error })), !loading && !error && files.length === 0 && (_jsxs("div", { className: "rounded-lg border border-dashed border-led-border bg-led-panel p-8 text-center text-sm text-led-muted", children: [_jsx(MusicIcon, { size: 24, className: "mx-auto mb-2 opacity-60" }), _jsx("p", { children: "No audio files yet." }), _jsxs("p", { className: "mt-1 text-[11px]", children: ["Drop ", _jsx("code", { className: "text-slate-400", children: ".mp3" }), " files into", ' ', _jsx("code", { className: "text-slate-400", children: "./data/audio/" }), " and click Refresh."] })] })), _jsx("div", { className: "space-y-1.5", children: files.map((f) => {
                    const isActive = activeFilename === f.filename;
                    const playing = isActive && isPlaying;
                    return (_jsxs("div", { className: [
                            'rounded-lg border bg-led-panel p-3 flex items-center gap-3 transition-colors',
                            isActive ? 'border-purple-500/40' : 'border-led-border',
                        ].join(' '), children: [_jsx("button", { onClick: () => togglePlay(f.filename), className: [
                                    'flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 transition-colors',
                                    playing
                                        ? 'bg-purple-600 text-white hover:bg-purple-500'
                                        : 'bg-led-bg text-purple-400 border border-led-border hover:bg-purple-500/20',
                                ].join(' '), title: playing ? 'Pause' : 'Play', children: playing ? _jsx(Pause, { size: 14 }) : _jsx(Play, { size: 14, className: "ml-0.5" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-sm text-slate-200 truncate", title: f.filename, children: f.filename }), _jsxs("div", { className: "text-[10px] text-led-muted mt-0.5", children: [formatBytes(f.sizeBytes), ' · ', f.mimeType.replace('audio/', ''), isActive && duration > 0 && (_jsxs(_Fragment, { children: [' · ', formatTime(currentTime), " / ", formatTime(duration)] }))] }), isActive && duration > 0 && (_jsx("div", { onClick: onSeek, className: "mt-1.5 h-1.5 rounded-full bg-led-bg overflow-hidden cursor-pointer group", children: _jsx("div", { className: "h-full bg-purple-500 group-hover:bg-purple-400 transition-colors", style: { width: `${(currentTime / duration) * 100}%` } }) }))] })] }, f.filename));
                }) })] }));
}
