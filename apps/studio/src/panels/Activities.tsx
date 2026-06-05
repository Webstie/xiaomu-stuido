import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, Plus, X, Play, Pause, Save, RotateCcw,
  FileText,
} from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import {
  fetchConfig, saveConfig, fetchAudioLibrary,
} from '../api/client.js';
import type { AudioFileEntry } from '../api/client.js';
import type {
  StudioConfig, Activity, ScriptedActivityConfig, AgeMusicBucket,
  EmotionScriptedConfig, EmotionMusicBucket,
  CoCreationConfig, CoCreationAudioMapping,
  GameConfig, RhythmStoryGameConfig, SoundDetectiveGameConfig,
  SoundDetectiveSound, PlaceholderGameConfig,
} from '@xiaomu/contracts';

const LEVEL: Record<string, number> = {
  'breathing': 1,
  'body-rhythm': 2,
  'emotion-music-mapping': 3,
  'co-creation': 4,
};

const DEFAULT_BUCKETS: AgeMusicBucket[] = [
  { minAge: 3, maxAge: 7,  audioFilenames: [] },
  { minAge: 8, maxAge: 12, audioFilenames: [] },
];

// ── Inline preview player (shared singleton ref across the panel) ───────────

function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const toggle = useCallback((filename: string) => {
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
      if (audioRef.current === a) setPlaying(null);
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

// ── Scripted activity editor (age buckets + audio + narration) ──────────────

interface ScriptedActivityEditorProps {
  value: ScriptedActivityConfig;
  library: AudioFileEntry[];
  onChange: (next: ScriptedActivityConfig) => void;
  preview: ReturnType<typeof usePreviewPlayer>;
}

function ScriptedActivityEditor({ value, library, onChange, preview }: ScriptedActivityEditorProps) {
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  const [openScript, setOpenScript] = useState<number | null>(null);

  const updateBucket = (idx: number, patch: Partial<AgeMusicBucket>) => {
    const buckets = value.ageBuckets.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    onChange({ ageBuckets: buckets });
  };

  const addAudio = (idx: number, filename: string) => {
    const bucket = value.ageBuckets[idx]!;
    if (bucket.audioFilenames.includes(filename)) return;
    updateBucket(idx, { audioFilenames: [...bucket.audioFilenames, filename] });
    setOpenPicker(null);
  };

  const removeAudio = (idx: number, filename: string) => {
    const bucket = value.ageBuckets[idx]!;
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

  const removeBucket = (idx: number) => {
    onChange({
      ageBuckets: value.ageBuckets.filter((_, i) => i !== idx),
    });
    if (openPicker === idx) setOpenPicker(null);
    if (openScript === idx) setOpenScript(null);
  };

  return (
    <div className="mt-4 space-y-3">
      {value.ageBuckets.map((bucket, idx) => {
        const available = library.filter(
          (f) => !bucket.audioFilenames.includes(f.filename),
        );
        return (
          <div
            key={idx}
            className="rounded-md border border-led-border bg-led-bg/40 p-3"
          >
            {/* Age range + remove */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-slate-300">Ages</span>
              <input
                type="number" min={0} max={99}
                value={bucket.minAge}
                onChange={(e) => updateBucket(idx, { minAge: parseInt(e.target.value, 10) || 0 })}
                className="w-12 rounded bg-led-panel border border-led-border px-1.5 py-0.5 text-center text-slate-200 focus:outline-none focus:border-purple-500"
              />
              <span>–</span>
              <input
                type="number" min={0} max={99}
                value={bucket.maxAge}
                onChange={(e) => updateBucket(idx, { maxAge: parseInt(e.target.value, 10) || 0 })}
                className="w-12 rounded bg-led-panel border border-led-border px-1.5 py-0.5 text-center text-slate-200 focus:outline-none focus:border-purple-500"
              />
              <span className="text-led-muted">
                · {bucket.audioFilenames.length} track
                {bucket.audioFilenames.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => removeBucket(idx)}
                title="Remove this age bucket"
                className="ml-auto flex items-center justify-center w-6 h-6 rounded text-slate-600 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <X size={12} />
              </button>
            </div>

            {/* Selected chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bucket.audioFilenames.length === 0 && (
                <span className="text-[11px] italic text-led-muted">
                  No tracks yet — add some below.
                </span>
              )}
              {bucket.audioFilenames.map((fn) => {
                const isPlaying = preview.playing === fn;
                const missing = !library.find((f) => f.filename === fn);
                return (
                  <span
                    key={fn}
                    className={[
                      'inline-flex items-center gap-1 rounded-full border pl-1 pr-1.5 py-0.5 text-[11px]',
                      missing
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : 'border-purple-500/30 bg-purple-500/10 text-purple-200',
                    ].join(' ')}
                    title={missing ? 'File no longer in ./data/audio/' : fn}
                  >
                    <button
                      onClick={() => preview.toggle(fn)}
                      disabled={missing}
                      className="rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40"
                    >
                      {isPlaying ? <Pause size={9} /> : <Play size={9} className="ml-0.5" />}
                    </button>
                    <span className="max-w-[12rem] truncate">{fn}</span>
                    <button
                      onClick={() => removeAudio(idx, fn)}
                      className="rounded-full p-0.5 hover:bg-white/10"
                      title="Remove"
                    >
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
            </div>

            {/* Picker */}
            <div className="mt-2">
              <button
                onClick={() => setOpenPicker(openPicker === idx ? null : idx)}
                disabled={available.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={11} />
                {available.length === 0
                  ? 'All library tracks added'
                  : openPicker === idx ? 'Close picker' : 'Add audio'}
              </button>

              {openPicker === idx && (
                <div className="mt-1.5 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto">
                  {available.length === 0 ? (
                    <div className="p-2 text-[11px] text-led-muted">
                      No more tracks. Drop more files in <code>./data/audio/</code>.
                    </div>
                  ) : (
                    available.map((f) => (
                      <button
                        key={f.filename}
                        onClick={() => addAudio(idx, f.filename)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0"
                      >
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); preview.toggle(f.filename); }}
                          className="flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20"
                        >
                          {preview.playing === f.filename
                            ? <Pause size={9} />
                            : <Play size={9} className="ml-0.5" />}
                        </span>
                        <span className="flex-1 truncate">{f.filename}</span>
                        <span className="text-[10px] text-led-muted flex-shrink-0">
                          {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Narration script */}
            <div className="mt-2 border-t border-led-border pt-2">
              <button
                onClick={() => setOpenScript(openScript === idx ? null : idx)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
              >
                <FileText size={11} />
                {openScript === idx ? 'Hide narration script' : 'Narration script'}
                {bucket.narrationScript && bucket.narrationScript.length > 0 && (
                  <span className="text-[10px] text-led-muted">
                    · {bucket.narrationScript.length} chars
                  </span>
                )}
              </button>
              {openScript === idx && (
                <textarea
                  value={bucket.narrationScript ?? ''}
                  onChange={(e) =>
                    updateBucket(idx, {
                      narrationScript: e.target.value.length === 0 ? undefined : e.target.value,
                    })
                  }
                  placeholder="Optional. The model uses this as a structural guide when running this activity for a child in this age range. Adapt phrasing naturally per turn."
                  rows={6}
                  className="mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
                />
              )}
            </div>
          </div>
        );
      })}

      {value.ageBuckets.length === 0 && (
        <div className="rounded-md border border-dashed border-led-border bg-led-bg/40 p-4 text-center text-[11px] text-led-muted">
          No age buckets yet. Add one below.
        </div>
      )}

      <button
        onClick={addBucket}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-led-border bg-led-panel px-3 py-2 text-xs text-slate-400 hover:text-purple-300 hover:border-purple-500/50 transition-colors"
      >
        <Plus size={12} />
        Add age bucket
      </button>
    </div>
  );
}

// ── Emotion-bucketed editor (emotion-music-mapping) ─────────────────────────

interface EmotionActivityEditorProps {
  value: EmotionScriptedConfig;
  library: AudioFileEntry[];
  onChange: (next: EmotionScriptedConfig) => void;
  preview: ReturnType<typeof usePreviewPlayer>;
}

function EmotionActivityEditor({ value, library, onChange, preview }: EmotionActivityEditorProps) {
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [openScript, setOpenScript] = useState<string | null>(null);
  const [openClosing, setOpenClosing] = useState(false);

  const updateBucket = (id: string, patch: Partial<EmotionMusicBucket>) => {
    const buckets = value.emotionBuckets.map((b) =>
      b.emotionId === id ? { ...b, ...patch } : b,
    );
    onChange({ ...value, emotionBuckets: buckets });
  };

  const moveBucket = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= value.emotionBuckets.length) return;
    const next = [...value.emotionBuckets];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange({ ...value, emotionBuckets: next });
  };

  const addAudio = (id: string, filename: string) => {
    const bucket = value.emotionBuckets.find((b) => b.emotionId === id);
    if (!bucket || bucket.audioFilenames.includes(filename)) return;
    updateBucket(id, { audioFilenames: [...bucket.audioFilenames, filename] });
    setOpenPicker(null);
  };

  const removeAudio = (id: string, filename: string) => {
    const bucket = value.emotionBuckets.find((b) => b.emotionId === id);
    if (!bucket) return;
    updateBucket(id, {
      audioFilenames: bucket.audioFilenames.filter((f) => f !== filename),
    });
  };

  // Compute total section count for the run-time hint.
  const totalSections = value.emotionBuckets.reduce(
    (sum, b) => sum + (b.narrationScript.trim().length === 0 ? 0 : Math.max(1, b.repeatCount ?? 1)),
    0,
  ) + (value.closingScript && value.closingScript.trim().length > 0 ? 1 : 0);

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[10px] leading-relaxed text-led-muted">
        Buckets play in the order shown ({totalSections} sections total). Use ↑/↓ to reorder.
        Each bucket can play multiple consecutive sections via <em>Plays N</em>.
      </p>

      <div className="space-y-2">
        {value.emotionBuckets.map((bucket, idx) => {
          const available = library.filter(
            (f) => !bucket.audioFilenames.includes(f.filename),
          );
          const isPickerOpen = openPicker === bucket.emotionId;
          const isScriptOpen = openScript === bucket.emotionId;
          const repeat = Math.max(1, bucket.repeatCount ?? 1);
          return (
            <div
              key={bucket.emotionId}
              className="rounded-md border border-led-border bg-led-bg/40 p-3"
            >
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveBucket(idx, -1)}
                        disabled={idx === 0}
                        className="rounded p-0.5 text-led-muted hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        onClick={() => moveBucket(idx, 1)}
                        disabled={idx === value.emotionBuckets.length - 1}
                        className="rounded p-0.5 text-led-muted hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDown size={11} />
                      </button>
                    </div>
                    <span className="text-[10px] font-mono text-slate-600 w-5 text-right">{idx + 1}</span>
                    <span className="text-xl">{bucket.emoji}</span>
                    <span className="text-sm font-medium text-slate-200">{bucket.label}</span>
                    <code className="text-[10px] text-slate-600">L{bucket.level}</code>
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="text-[10px] text-led-muted">Plays</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={repeat}
                        onChange={(e) =>
                          updateBucket(bucket.emotionId, {
                            repeatCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                          })
                        }
                        className="w-12 bg-led-panel border border-led-border rounded px-1 py-0.5 text-[11px] text-center text-slate-200 focus:outline-none focus:border-purple-500"
                      />
                      <span className="text-[10px] text-led-muted">
                        · {bucket.audioFilenames.length} track
                        {bucket.audioFilenames.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  {/* Selected audio chips */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {bucket.audioFilenames.length === 0 && (
                      <span className="text-[11px] italic text-led-muted">
                        No tracks yet — add some below.
                      </span>
                    )}
                    {bucket.audioFilenames.map((fn) => {
                      const isPlaying = preview.playing === fn;
                      const missing = !library.find((f) => f.filename === fn);
                      return (
                        <span
                          key={fn}
                          className={[
                            'inline-flex items-center gap-1 rounded-full border pl-1 pr-1.5 py-0.5 text-[11px]',
                            missing
                              ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                              : 'border-purple-500/30 bg-purple-500/10 text-purple-200',
                          ].join(' ')}
                          title={missing ? 'File no longer in ./data/audio/' : fn}
                        >
                          <button
                            onClick={() => preview.toggle(fn)}
                            disabled={missing}
                            className="rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40"
                          >
                            {isPlaying ? <Pause size={9} /> : <Play size={9} className="ml-0.5" />}
                          </button>
                          <span className="max-w-[12rem] truncate">{fn}</span>
                          <button
                            onClick={() => removeAudio(bucket.emotionId, fn)}
                            className="rounded-full p-0.5 hover:bg-white/10"
                            title="Remove"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      );
                    })}
                  </div>

                  {/* Audio picker */}
                  <div className="mt-2">
                    <button
                      onClick={() => setOpenPicker(isPickerOpen ? null : bucket.emotionId)}
                      disabled={available.length === 0}
                      className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus size={11} />
                      {available.length === 0
                        ? 'All library tracks added'
                        : isPickerOpen ? 'Close picker' : 'Add audio'}
                    </button>

                    {isPickerOpen && (
                      <div className="mt-1.5 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto">
                        {available.length === 0 ? (
                          <div className="p-2 text-[11px] text-led-muted">
                            No more tracks. Drop more files in <code>./data/audio/</code>.
                          </div>
                        ) : (
                          available.map((f) => (
                            <button
                              key={f.filename}
                              onClick={() => addAudio(bucket.emotionId, f.filename)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0"
                            >
                              <span
                                role="button"
                                onClick={(e) => { e.stopPropagation(); preview.toggle(f.filename); }}
                                className="flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20"
                              >
                                {preview.playing === f.filename
                                  ? <Pause size={9} />
                                  : <Play size={9} className="ml-0.5" />}
                              </span>
                              <span className="flex-1 truncate">{f.filename}</span>
                              <span className="text-[10px] text-led-muted flex-shrink-0">
                                {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Narration script */}
                  <div className="mt-2 border-t border-led-border pt-2">
                    <button
                      onClick={() => setOpenScript(isScriptOpen ? null : bucket.emotionId)}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      <FileText size={11} />
                      {isScriptOpen ? 'Hide narration script' : 'Narration script'}
                      <span className="text-[10px] text-led-muted">
                        · {bucket.narrationScript.length} chars
                      </span>
                    </button>
                    {isScriptOpen && (
                      <textarea
                        value={bucket.narrationScript}
                        onChange={(e) =>
                          updateBucket(bucket.emotionId, { narrationScript: e.target.value })
                        }
                        rows={4}
                        className="mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    )}
                  </div>
                </div>
              );
            })}
      </div>

      {/* Closing script — spoken once after all emotion sections, no audio. */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <button
          onClick={() => setOpenClosing(!openClosing)}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
        >
          <FileText size={11} />
          {openClosing ? 'Hide' : 'Show'} closing script
          <span className="text-[10px] text-led-muted ml-1">
            · spoken once at the end · {(value.closingScript ?? '').length} chars
          </span>
        </button>
        {openClosing && (
          <textarea
            value={value.closingScript ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                closingScript: e.target.value.length === 0 ? undefined : e.target.value,
              })
            }
            rows={4}
            placeholder="Optional. Delivered as a single section after all emotion sections. No audio."
            className="mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
          />
        )}
      </div>
    </div>
  );
}

// ── Co-Creation editor (per note-triple + variant overrides) ────────────────

const CC_VARIANTS = ['original', 'revised', 'background'] as const;
type CCVariant = typeof CC_VARIANTS[number];

const VARIANT_LABEL: Record<CCVariant, string> = {
  original: 'Original',
  revised: 'Revised',
  background: 'Background',
};

const VARIANT_COLOR: Record<CCVariant, string> = {
  original: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  revised: 'text-purple-300 border-purple-500/40 bg-purple-500/10',
  background: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
};

/** Sol ≡ So, Ti ≡ Si, case-insensitive. Matches coCreationAudio.ts canonicalNote. */
function canonicalNote(note: string): string {
  const lower = note.toLowerCase();
  if (lower === 'so') return 'sol';
  if (lower === 'si') return 'ti';
  return lower;
}

function noteSetKey(notes: string[]): string {
  return notes.map(canonicalNote).sort().join('|');
}

const NOTE_TOKEN_RE = /\b(Do|Re|Mi|Fa|Sol|So|La|Ti|Si)\b/gi;

function detectVariantFromFilename(filename: string): CCVariant | null {
  const lower = filename.toLowerCase();
  if (lower.includes('background')) return 'background';
  if (lower.includes('revised')) return 'revised';
  // accept both "original" and the typo "orginal"
  if (lower.includes('original') || lower.includes('orginal')) return 'original';
  // bare names with notes → treat as original (matches server resolver)
  return 'original';
}

/**
 * Replica of coCreationAudio.ts's buildIndex, computed from the audio library
 * client-side so the panel can show what the server would auto-discover.
 */
function buildDiscoveryIndex(library: AudioFileEntry[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const f of library) {
    if (!/\.(m4a|mp3|wav|ogg)$/i.test(f.filename)) continue;
    const base = f.filename.replace(/\.[^.]+$/, '');
    const noteMatches = base.match(NOTE_TOKEN_RE);
    if (!noteMatches || noteMatches.length !== 3) continue;
    const variant = detectVariantFromFilename(base);
    if (!variant) continue;
    const key = `${variant}::${noteSetKey(noteMatches)}`;
    if (!idx.has(key)) idx.set(key, f.filename);
  }
  return idx;
}

/** All C(notes.length, 3) combinations, preserving the order the user defined notes in. */
function pickThreeCombinations(notes: string[]): string[][] {
  const out: string[][] = [];
  const n = notes.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        out.push([notes[i]!, notes[j]!, notes[k]!]);
      }
    }
  }
  return out;
}

interface CoCreationEditorProps {
  value: CoCreationConfig;
  library: AudioFileEntry[];
  onChange: (next: CoCreationConfig) => void;
  preview: ReturnType<typeof usePreviewPlayer>;
}

function CoCreationEditor({ value, library, onChange, preview }: CoCreationEditorProps) {
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [openScript, setOpenScript] = useState(false);
  const [newNote, setNewNote] = useState('');

  const notes = value.notes;
  const mappings = value.audioMappings ?? [];
  const combinations = pickThreeCombinations(notes);

  // Index explicit mappings by (canonical note-set, variant) for O(1) lookup
  const mappingByKey = new Map<string, string>();
  for (const m of mappings) {
    mappingByKey.set(`${m.variant}::${noteSetKey(m.notes)}`, m.filename);
  }
  // Filename-based auto-discovery (mirrors server's coCreationAudio.ts)
  const discoveryByKey = buildDiscoveryIndex(library);

  const slotKey = (notesTriple: string[], variant: CCVariant): string =>
    `${variant}::${noteSetKey(notesTriple)}`;

  const setMapping = (notesTriple: string[], variant: CCVariant, filename: string | null) => {
    const key = slotKey(notesTriple, variant);
    const targetSet = noteSetKey(notesTriple);
    const filtered = mappings.filter(
      (m) => !(m.variant === variant && noteSetKey(m.notes) === targetSet),
    );
    const next: CoCreationAudioMapping[] = filename
      ? [...filtered, { notes: [...notesTriple], variant, filename }]
      : filtered;
    onChange({ ...value, audioMappings: next });
    setOpenPicker(null);
  };

  const updateNotes = (nextNotes: string[]) => {
    onChange({ ...value, notes: nextNotes });
  };

  const addNote = () => {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    if (notes.includes(trimmed)) {
      setNewNote('');
      return;
    }
    updateNotes([...notes, trimmed]);
    setNewNote('');
  };

  const removeNote = (note: string) => {
    updateNotes(notes.filter((n) => n !== note));
    // Also drop any mappings that reference the removed note
    const filtered = mappings.filter((m) => !m.notes.some((mn) => canonicalNote(mn) === canonicalNote(note)));
    if (filtered.length !== mappings.length) {
      onChange({ ...value, notes: notes.filter((n) => n !== note), audioMappings: filtered });
    }
  };

  // Coverage stats — explicit + auto-discovered both count as "resolved"
  const totalSlots = combinations.length * CC_VARIANTS.length;
  const filledSlots = combinations.reduce((sum, c) =>
    sum + CC_VARIANTS.filter((v) => {
      const k = slotKey(c, v);
      return mappingByKey.has(k) || discoveryByKey.has(k);
    }).length, 0,
  );

  return (
    <div className="mt-4 space-y-4">
      {/* Notes editor */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-300">Selectable notes</span>
          <span className="text-[10px] text-led-muted">
            {notes.length} note{notes.length === 1 ? '' : 's'} · {combinations.length} combination{combinations.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {notes.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-200 pl-2 pr-1 py-0.5 text-[11px]"
            >
              {n}
              <button
                onClick={() => removeNote(n)}
                className="rounded-full p-0.5 hover:bg-white/10"
                title={`Remove ${n}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } }}
              placeholder="Add note…"
              className="w-20 rounded bg-led-panel border border-led-border px-1.5 py-0.5 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={addNote}
              disabled={!newNote.trim()}
              className="inline-flex items-center justify-center rounded-md border border-led-border bg-led-panel w-5 h-5 text-purple-400 hover:bg-purple-500/20 disabled:opacity-30"
              title="Add note"
            >
              <Plus size={10} />
            </button>
          </span>
        </div>
      </div>

      {/* Narration script */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <button
          onClick={() => setOpenScript(!openScript)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          <FileText size={11} />
          {openScript ? 'Hide narration script' : 'Narration script'}
          <span className="text-[10px] text-led-muted">· {value.narrationScript.length} chars</span>
        </button>
        {openScript && (
          <textarea
            value={value.narrationScript}
            onChange={(e) => onChange({ ...value, narrationScript: e.target.value })}
            rows={8}
            className="mt-1.5 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
          />
        )}
      </div>

      {/* Audio mappings grid */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">Audio mappings</span>
          <span className="text-[10px] text-led-muted">
            {filledSlots} / {totalSlots} slots resolved · solid = explicit override, dashed = filename auto-discovery
          </span>
        </div>
        {combinations.length === 0 ? (
          <div className="rounded-md border border-dashed border-led-border bg-led-bg/40 p-4 text-center text-[11px] text-led-muted">
            Add at least 3 notes above to generate combinations.
          </div>
        ) : (
          <div className="space-y-1.5">
            {combinations.map((triple) => (
              <div
                key={noteSetKey(triple)}
                className="rounded-md border border-led-border bg-led-bg/40 p-2.5"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  {triple.map((n, i) => (
                    <React.Fragment key={n}>
                      <span className="text-sm font-medium text-slate-200">{n}</span>
                      {i < triple.length - 1 && <span className="text-led-muted text-xs">·</span>}
                    </React.Fragment>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {CC_VARIANTS.map((variant) => {
                    const key = slotKey(triple, variant);
                    const explicit = mappingByKey.get(key);
                    const discovered = !explicit ? discoveryByKey.get(key) : undefined;
                    const resolved = explicit ?? discovered;
                    const isAuto = !explicit && Boolean(discovered);
                    const isPickerOpen = openPicker === key;
                    const isPlaying = resolved && preview.playing === resolved;
                    const fileMissingFromLibrary =
                      explicit && !library.find((f) => f.filename === explicit);

                    return (
                      <div key={variant} className="relative">
                        <div className={[
                          'rounded border px-2 py-1.5 transition-colors',
                          resolved
                            ? VARIANT_COLOR[variant] + (isAuto ? ' border-dashed' : '')
                            : 'border-led-border bg-led-panel text-led-muted',
                        ].join(' ')}>
                          <div className="text-[9px] uppercase tracking-widest opacity-70 mb-0.5 flex items-center gap-1">
                            <span>{VARIANT_LABEL[variant]}</span>
                            {isAuto && (
                              <span className="px-1 py-px rounded bg-white/10 text-[8px] tracking-normal normal-case">
                                auto
                              </span>
                            )}
                          </div>
                          {resolved ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => preview.toggle(resolved)}
                                disabled={Boolean(fileMissingFromLibrary)}
                                className="rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40 flex-shrink-0"
                                title={fileMissingFromLibrary ? 'File missing from audio library' : 'Preview'}
                              >
                                {isPlaying ? <Pause size={10} /> : <Play size={10} className="ml-0.5" />}
                              </button>
                              <button
                                onClick={() => setOpenPicker(isPickerOpen ? null : key)}
                                className="flex-1 truncate text-left text-[10px] hover:underline min-w-0"
                                title={isAuto
                                  ? `Auto-discovered: ${resolved} (click to override)`
                                  : resolved}
                              >
                                {resolved}
                              </button>
                              {explicit && (
                                <button
                                  onClick={() => setMapping(triple, variant, null)}
                                  className="rounded-full p-0.5 hover:bg-white/10 flex-shrink-0"
                                  title="Clear override (revert to auto-discovery)"
                                >
                                  <X size={9} />
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => setOpenPicker(isPickerOpen ? null : key)}
                              className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-200 transition-colors"
                            >
                              <Plus size={9} />
                              Pick file
                            </button>
                          )}
                        </div>

                        {isPickerOpen && (
                          <div className="absolute z-10 mt-1 left-0 right-0 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto shadow-xl">
                            {library.length === 0 ? (
                              <div className="p-2 text-[11px] text-led-muted">
                                No audio files. Drop mp3 / m4a into <code>./data/audio/</code>.
                              </div>
                            ) : (
                              library.map((f) => (
                                <button
                                  key={f.filename}
                                  onClick={() => setMapping(triple, variant, f.filename)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0"
                                >
                                  <span
                                    role="button"
                                    onClick={(e) => { e.stopPropagation(); preview.toggle(f.filename); }}
                                    className="flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20 flex-shrink-0"
                                  >
                                    {preview.playing === f.filename
                                      ? <Pause size={9} />
                                      : <Play size={9} className="ml-0.5" />}
                                  </span>
                                  <span className="flex-1 truncate">{f.filename}</span>
                                  <span className="text-[10px] text-led-muted flex-shrink-0">
                                    {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Game editors ────────────────────────────────────────────────────────────

interface RhythmStoryEditorProps {
  value: RhythmStoryGameConfig;
  onChange: (next: RhythmStoryGameConfig) => void;
}

function RhythmStoryEditor({ value, onChange }: RhythmStoryEditorProps) {
  const [openStories, setOpenStories] = useState(false);
  const [openCompletions, setOpenCompletions] = useState(false);

  const updateList = (key: 'stories' | 'completionResponses', idx: number, content: string) => {
    const next = value[key].map((s, i) => (i === idx ? content : s));
    onChange({ ...value, [key]: next });
  };

  const addItem = (key: 'stories' | 'completionResponses') => {
    onChange({ ...value, [key]: [...value[key], ''] });
  };

  const removeItem = (key: 'stories' | 'completionResponses', idx: number) => {
    onChange({ ...value, [key]: value[key].filter((_, i) => i !== idx) });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <div className="text-xs font-medium text-slate-300 mb-1.5">
          Intro line (prefix)
        </div>
        <textarea
          value={value.prefix}
          onChange={(e) => onChange({ ...value, prefix: e.target.value })}
          rows={2}
          className="w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
        />
      </div>

      {/* Stories */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <button
          onClick={() => setOpenStories(!openStories)}
          className="flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
        >
          <FileText size={11} />
          {openStories ? 'Hide' : 'Show'} stories
          <span className="text-[10px] text-led-muted ml-1">
            · {value.stories.length} {value.stories.length === 1 ? 'story' : 'stories'} (random pick)
          </span>
        </button>
        {openStories && (
          <div className="mt-2 space-y-2">
            {value.stories.map((story, idx) => (
              <div key={idx} className="rounded border border-led-border bg-led-panel p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-led-muted">Story {idx + 1}</span>
                  <button
                    onClick={() => removeItem('stories', idx)}
                    className="text-led-muted hover:text-rose-300 transition-colors"
                    title="Remove story"
                  >
                    <X size={11} />
                  </button>
                </div>
                <textarea
                  value={story}
                  onChange={(e) => updateList('stories', idx, e.target.value)}
                  rows={4}
                  className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>
            ))}
            <button
              onClick={() => addItem('stories')}
              className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            >
              <Plus size={11} />
              Add story
            </button>
          </div>
        )}
      </div>

      {/* Completion responses */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <button
          onClick={() => setOpenCompletions(!openCompletions)}
          className="flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
        >
          <FileText size={11} />
          {openCompletions ? 'Hide' : 'Show'} completion responses
          <span className="text-[10px] text-led-muted ml-1">
            · {value.completionResponses.length} (random pick after "我拍完啦")
          </span>
        </button>
        {openCompletions && (
          <div className="mt-2 space-y-2">
            {value.completionResponses.map((resp, idx) => (
              <div key={idx} className="rounded border border-led-border bg-led-panel p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-led-muted">Response {idx + 1}</span>
                  <button
                    onClick={() => removeItem('completionResponses', idx)}
                    className="text-led-muted hover:text-rose-300 transition-colors"
                    title="Remove response"
                  >
                    <X size={11} />
                  </button>
                </div>
                <textarea
                  value={resp}
                  onChange={(e) => updateList('completionResponses', idx, e.target.value)}
                  rows={2}
                  className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>
            ))}
            <button
              onClick={() => addItem('completionResponses')}
              className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            >
              <Plus size={11} />
              Add response
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SoundDetectiveEditorProps {
  value: SoundDetectiveGameConfig;
  library: AudioFileEntry[];
  onChange: (next: SoundDetectiveGameConfig) => void;
  preview: ReturnType<typeof usePreviewPlayer>;
}

function SoundDetectiveEditor({ value, library, onChange, preview }: SoundDetectiveEditorProps) {
  const [openIntro, setOpenIntro] = useState(false);
  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null);
  const [openSoundId, setOpenSoundId] = useState<string | null>(null);

  const updateSound = (id: string, patch: Partial<SoundDetectiveSound>) => {
    const next = value.sounds.map((s) => (s.id === id ? { ...s, ...patch } : s));
    onChange({ ...value, sounds: next });
  };

  const removeSound = (id: string) => {
    onChange({ ...value, sounds: value.sounds.filter((s) => s.id !== id) });
  };

  const addSound = () => {
    const id = `sound-${Date.now()}`;
    const next: SoundDetectiveSound = {
      id, label: 'New sound', audioFilename: '',
      question: '仔细听……\n\n你觉得是什么东西发出的声音？',
      correctKeywords: [], correctResponse: '', wrongResponse: '',
    };
    onChange({ ...value, sounds: [...value.sounds, next] });
    setOpenSoundId(id);
  };

  return (
    <div className="mt-4 space-y-3">
      {/* Intro */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <button
          onClick={() => setOpenIntro(!openIntro)}
          className="flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
        >
          <FileText size={11} />
          {openIntro ? 'Hide' : 'Show'} intro
          <span className="text-[10px] text-led-muted ml-1">· {value.intro.length} chars</span>
        </button>
        {openIntro && (
          <textarea
            value={value.intro}
            onChange={(e) => onChange({ ...value, intro: e.target.value })}
            rows={6}
            className="mt-2 w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
          />
        )}
      </div>

      {/* Sounds */}
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">Sounds</span>
          <span className="text-[10px] text-led-muted">
            {value.sounds.length} · random pick at runtime
          </span>
        </div>
        <p className="mb-2 text-[10px] text-led-muted leading-relaxed">
          The AI compares the child's guess against the sound's <em>label</em> — there's no
          keyword list to maintain. Make sure the label is descriptive (e.g. "鸡 Chicken").
        </p>

        <div className="space-y-2">
          {value.sounds.map((sound) => {
            const isOpen = openSoundId === sound.id;
            const isPickerOpen = openPickerFor === sound.id;
            const fileMissing = sound.audioFilename
              && !library.find((f) => f.filename === sound.audioFilename);
            return (
              <div key={sound.id} className="rounded-md border border-led-border bg-led-panel p-2.5">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOpenSoundId(isOpen ? null : sound.id)}
                    className="text-led-muted hover:text-slate-200 flex-shrink-0"
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <input
                    type="text"
                    value={sound.label}
                    onChange={(e) => updateSound(sound.id, { label: e.target.value })}
                    className="flex-1 bg-led-bg border border-led-border rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                  {sound.audioFilename && (
                    <button
                      onClick={() => preview.toggle(sound.audioFilename)}
                      disabled={Boolean(fileMissing)}
                      className="rounded-full p-1 text-purple-400 hover:bg-white/10 disabled:opacity-40 flex-shrink-0"
                      title={fileMissing ? 'File missing from audio library' : 'Preview'}
                    >
                      {preview.playing === sound.audioFilename
                        ? <Pause size={10} />
                        : <Play size={10} className="ml-0.5" />}
                    </button>
                  )}
                  <button
                    onClick={() => removeSound(sound.id)}
                    className="rounded p-0.5 text-led-muted hover:text-rose-300"
                    title="Remove sound"
                  >
                    <X size={11} />
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-2">
                    {/* Audio file picker */}
                    <div>
                      <div className="text-[10px] text-led-muted mb-0.5">Audio file</div>
                      <div className="relative">
                        <button
                          onClick={() => setOpenPickerFor(isPickerOpen ? null : sound.id)}
                          className={[
                            'w-full text-left rounded border px-2 py-1.5 text-[11px] transition-colors',
                            sound.audioFilename
                              ? (fileMissing
                                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                : 'border-purple-500/30 bg-purple-500/10 text-purple-200')
                              : 'border-dashed border-led-border bg-led-bg text-led-muted',
                          ].join(' ')}
                        >
                          {sound.audioFilename || 'Click to pick a file…'}
                        </button>
                        {isPickerOpen && (
                          <div className="absolute z-10 mt-1 left-0 right-0 rounded-md border border-led-border bg-led-panel max-h-44 overflow-y-auto shadow-xl">
                            {library.length === 0 ? (
                              <div className="p-2 text-[11px] text-led-muted">
                                No files. Drop mp3/m4a into <code>./data/audio/</code>.
                              </div>
                            ) : (
                              library.map((f) => (
                                <button
                                  key={f.filename}
                                  onClick={() => {
                                    updateSound(sound.id, { audioFilename: f.filename });
                                    setOpenPickerFor(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-left text-slate-300 hover:bg-purple-500/10 hover:text-purple-200 border-b border-led-border last:border-b-0"
                                >
                                  <span
                                    role="button"
                                    onClick={(e) => { e.stopPropagation(); preview.toggle(f.filename); }}
                                    className="flex items-center justify-center rounded-full bg-led-bg w-5 h-5 text-purple-400 hover:bg-purple-500/20 flex-shrink-0"
                                  >
                                    {preview.playing === f.filename
                                      ? <Pause size={9} />
                                      : <Play size={9} className="ml-0.5" />}
                                  </span>
                                  <span className="flex-1 truncate">{f.filename}</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Question */}
                    <div>
                      <div className="text-[10px] text-led-muted mb-0.5">Question (after sound plays)</div>
                      <textarea
                        value={sound.question}
                        onChange={(e) => updateSound(sound.id, { question: e.target.value })}
                        rows={2}
                        className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>

                    {/* Correctness is decided by the AI classifier — the
                        sound's label is passed as context to the model. */}

                    {/* Correct response */}
                    <div>
                      <div className="text-[10px] text-led-muted mb-0.5">When the child guesses correctly</div>
                      <textarea
                        value={sound.correctResponse}
                        onChange={(e) => updateSound(sound.id, { correctResponse: e.target.value })}
                        rows={3}
                        className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>

                    {/* Wrong response */}
                    <div>
                      <div className="text-[10px] text-led-muted mb-0.5">When the child guesses wrong</div>
                      <textarea
                        value={sound.wrongResponse}
                        onChange={(e) => updateSound(sound.id, { wrongResponse: e.target.value })}
                        rows={3}
                        className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={addSound}
            className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            <Plus size={11} />
            Add sound
          </button>
        </div>
      </div>
    </div>
  );
}

interface PlaceholderGameEditorProps {
  value: PlaceholderGameConfig;
  onChange: (next: PlaceholderGameConfig) => void;
}

function PlaceholderGameEditor({ value, onChange }: PlaceholderGameEditorProps) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
        <div className="text-xs font-medium text-slate-300 mb-1.5">Notes</div>
        <textarea
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          rows={4}
          placeholder="Game 3 isn't designed yet — jot down any ideas here."
          className="w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
        />
      </div>
    </div>
  );
}

// ── Activities panel ────────────────────────────────────────────────────────

export default function Activities() {
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [original, setOriginal] = useState<StudioConfig | null>(null);
  const [library, setLibrary] = useState<AudioFileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const preview = usePreviewPlayer();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, lib] = await Promise.all([fetchConfig(), fetchAudioLibrary()]);
      setConfig(c);
      setOriginal(c);
      setLibrary(lib);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateActivity = (idx: number, patch: Partial<Activity>) => {
    if (!config) return;
    const activities = config.activities.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    setConfig({ ...config, activities });
    setSaved(false);
  };

  const updateGame = (idx: number, next: GameConfig) => {
    if (!config) return;
    const games = (config.games ?? []).map((g, i) => (i === idx ? next : g));
    setConfig({ ...config, games });
    setSaved(false);
  };

  const dirty = config !== null && original !== null && JSON.stringify(config) !== JSON.stringify(original);

  const handleSave = async () => {
    if (!config || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveConfig(config);
      setConfig(next);
      setOriginal(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (original) setConfig(original);
    setSaved(false);
  };

  return (
    <PanelShell
      title="Activities"
      description="The four core activity levels. Breathing and Body Rhythm support age-bucketed audio + narration scripts. Mapping / Co-Creation editors come later."
    >
      {/* Save bar */}
      {(dirty || saved) && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs">
          <span className="text-purple-200">
            {saved ? 'Saved.' : 'Unsaved changes'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1 rounded border border-led-border px-2 py-1 text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-30"
            >
              <RotateCcw size={11} />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Save size={11} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && !error && (
        <div className="text-sm text-led-muted">Loading…</div>
      )}

      <div className="space-y-3">
        {config?.activities.map((a, idx) => {
          const isOpen = expanded === a.id;
          const isScripted = a.id === 'body-rhythm' || a.id === 'breathing';
          const isEmotion = a.id === 'emotion-music-mapping';
          const isCoCreation = a.id === 'co-creation';
          const scripted: ScriptedActivityConfig =
            a.scripted ?? { ageBuckets: DEFAULT_BUCKETS };
          const emotionScripted: EmotionScriptedConfig =
            a.emotionScripted ?? { emotionBuckets: [] };
          const coCreation: CoCreationConfig =
            a.coCreation ?? { notes: [], narrationScript: '', audioMappings: [] };
          return (
            <div
              key={a.id}
              className="rounded-lg border border-led-border bg-led-panel"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : a.id)}
                className="w-full p-4 text-left"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-led-muted">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-baseline gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-purple-400">
                        Level {LEVEL[a.id] ?? '·'}
                      </span>
                      <h3 className="text-base font-medium text-slate-200">{a.name}</h3>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                      {a.description}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
                      <code className="rounded bg-led-bg px-1.5 py-0.5">{a.id}</code>
                      <span>·</span>
                      <span>default expression: {a.defaultExpression}</span>
                      {a.ssmlStyleOverride && (
                        <>
                          <span>·</span>
                          <span>SSML style: {a.ssmlStyleOverride}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-led-border px-4 pb-4">
                  {isScripted ? (
                    <ScriptedActivityEditor
                      value={scripted}
                      library={library}
                      preview={preview}
                      onChange={(next) =>
                        updateActivity(idx, { scripted: next })
                      }
                    />
                  ) : isEmotion ? (
                    <EmotionActivityEditor
                      value={emotionScripted}
                      library={library}
                      preview={preview}
                      onChange={(next) =>
                        updateActivity(idx, { emotionScripted: next })
                      }
                    />
                  ) : isCoCreation ? (
                    <CoCreationEditor
                      value={coCreation}
                      library={library}
                      preview={preview}
                      onChange={(next) =>
                        updateActivity(idx, { coCreation: next })
                      }
                    />
                  ) : (
                    <div className="mt-3 rounded-md border border-dashed border-led-border bg-led-bg/40 p-4 text-center text-[11px] text-led-muted">
                      Per-activity editor for <code>{a.id}</code> comes in a later checkpoint.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Games section (separate from the four levels) ────────────────── */}
      {(config?.games?.length ?? 0) > 0 && (
        <>
          <div className="mt-10 mb-3 flex items-baseline gap-3">
            <h2 className="text-lg font-semibold text-slate-100">Games</h2>
            <span className="text-[10px] text-led-muted">
              Mini-games triggered randomly during the old-friend session intro
            </span>
          </div>
          <div className="space-y-3">
            {(config?.games ?? []).map((g, idx) => {
              const isOpen = expanded === `game:${g.id}`;
              return (
                <div key={g.id} className="rounded-lg border border-led-border bg-led-panel">
                  <button
                    onClick={() => setExpanded(isOpen ? null : `game:${g.id}`)}
                    className="w-full p-4 text-left"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-led-muted">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-3">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                            Game {idx + 1}
                          </span>
                          <h3 className="text-base font-medium text-slate-200">{g.name}</h3>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
                          <code className="rounded bg-led-bg px-1.5 py-0.5">{g.id}</code>
                          <span>·</span>
                          <span>kind: {g.kind}</span>
                          {g.kind === 'rhythm-story' && (
                            <>
                              <span>·</span>
                              <span>{g.stories.length} stories / {g.completionResponses.length} responses</span>
                            </>
                          )}
                          {g.kind === 'sound-detective' && (
                            <>
                              <span>·</span>
                              <span>{g.sounds.length} sounds</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-led-border px-4 pb-4">
                      {g.kind === 'rhythm-story' && (
                        <RhythmStoryEditor
                          value={g}
                          onChange={(next) => updateGame(idx, next)}
                        />
                      )}
                      {g.kind === 'sound-detective' && (
                        <SoundDetectiveEditor
                          value={g}
                          library={library}
                          preview={preview}
                          onChange={(next) => updateGame(idx, next)}
                        />
                      )}
                      {g.kind === 'placeholder' && (
                        <PlaceholderGameEditor
                          value={g}
                          onChange={(next) => updateGame(idx, next)}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </PanelShell>
  );
}
