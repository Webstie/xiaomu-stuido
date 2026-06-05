import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Music as MusicIcon, RefreshCw } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';

interface AudioFileEntry {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  modifiedMs: number;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export default function AudioLibrary() {
  const [files, setFiles] = useState<AudioFileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/audio')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setFiles(data as AudioFileEntry[]))
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const togglePlay = useCallback((filename: string) => {
    // Same file — pause/resume
    if (activeFilename === filename && audioRef.current) {
      if (audioRef.current.paused) {
        void audioRef.current.play();
      } else {
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
  const onSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audio.currentTime = ratio * duration;
    },
    [duration],
  );

  return (
    <PanelShell
      title="Audio Library"
      description="Drop .mp3 / .wav / .m4a / .ogg files into ./data/audio/. Sorted alphabetically. Click play to listen."
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-led-muted">
          {loading
            ? 'Loading…'
            : `${files.length} file${files.length === 1 ? '' : 's'}`}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-led-border px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="rounded-lg border border-dashed border-led-border bg-led-panel p-8 text-center text-sm text-led-muted">
          <MusicIcon size={24} className="mx-auto mb-2 opacity-60" />
          <p>No audio files yet.</p>
          <p className="mt-1 text-[11px]">
            Drop <code className="text-slate-400">.mp3</code> files into{' '}
            <code className="text-slate-400">./data/audio/</code> and click Refresh.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {files.map((f) => {
          const isActive = activeFilename === f.filename;
          const playing = isActive && isPlaying;
          return (
            <div
              key={f.filename}
              className={[
                'rounded-lg border bg-led-panel p-3 flex items-center gap-3 transition-colors',
                isActive ? 'border-purple-500/40' : 'border-led-border',
              ].join(' ')}
            >
              <button
                onClick={() => togglePlay(f.filename)}
                className={[
                  'flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 transition-colors',
                  playing
                    ? 'bg-purple-600 text-white hover:bg-purple-500'
                    : 'bg-led-bg text-purple-400 border border-led-border hover:bg-purple-500/20',
                ].join(' ')}
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 truncate" title={f.filename}>
                  {f.filename}
                </div>
                <div className="text-[10px] text-led-muted mt-0.5">
                  {formatBytes(f.sizeBytes)}
                  {' · '}
                  {f.mimeType.replace('audio/', '')}
                  {isActive && duration > 0 && (
                    <>
                      {' · '}
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </>
                  )}
                </div>
                {isActive && duration > 0 && (
                  <div
                    onClick={onSeek}
                    className="mt-1.5 h-1.5 rounded-full bg-led-bg overflow-hidden cursor-pointer group"
                  >
                    <div
                      className="h-full bg-purple-500 group-hover:bg-purple-400 transition-colors"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}
