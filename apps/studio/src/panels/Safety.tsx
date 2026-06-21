import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Save, RotateCcw, Plus, X, ChevronDown, ChevronUp, ShieldAlert,
  Play, Pause, Music,
} from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchAudioLibrary, fetchConfig, saveConfig } from '../api/client.js';
import type { Safety as SafetyConfig, StudioConfig } from '@xiaomu/contracts';

// ── Section wrapper ───────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: 'default' | 'danger';
}

function Section({ title, description, children, tone = 'default' }: SectionProps) {
  const border = tone === 'danger' ? 'border-rose-500/40' : 'border-led-border';
  return (
    <div className={`rounded-lg border ${border} bg-led-panel p-4 space-y-3`}>
      <div>
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
          {tone === 'danger' && <ShieldAlert size={13} className="text-rose-300" />}
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[11px] text-led-muted leading-relaxed">{description}</p>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ── String list editor (collapsible) ─────────────────────────────────────────

interface StringListProps {
  items: string[];
  onChange: (next: string[]) => void;
  rows?: number;
  itemLabel?: string;
  defaultOpen?: boolean;
  emptyHint?: string;
}

function StringList({
  items, onChange, rows = 2, itemLabel = 'Entry', defaultOpen = true, emptyHint,
}: StringListProps) {
  const [open, setOpen] = useState(defaultOpen);

  const update = (idx: number, next: string) => {
    onChange(items.map((s, i) => (i === idx ? next : s)));
  };
  const add = () => onChange([...items, '']);
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {items.length} {items.length === 1 ? itemLabel.toLowerCase() : itemLabel.toLowerCase() + 's'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {items.length === 0 && emptyHint && (
            <p className="text-[10px] italic text-led-muted/70">{emptyHint}</p>
          )}
          {items.map((value, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-[10px] text-led-muted pt-2 w-5 text-right">{idx + 1}.</span>
              <textarea
                value={value}
                onChange={(e) => update(idx, e.target.value)}
                rows={rows}
                className="flex-1 resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
              />
              <button
                onClick={() => remove(idx)}
                className="mt-1.5 text-led-muted hover:text-rose-300 transition-colors"
                title={`Remove ${itemLabel.toLowerCase()}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={add}
            className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            <Plus size={11} />
            Add {itemLabel.toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Comfort-music list ────────────────────────────────────────────────────────
// Manages safety.comfortMusicFiles. Each row has a play/pause preview that
// streams from /api/audio/file/:filename; an add-control lets the operator
// pick any audio in the library that isn't already on the list.

interface ComfortMusicListProps {
  files: string[];
  onChange: (next: string[]) => void;
}

function ComfortMusicList({ files, onChange }: ComfortMusicListProps) {
  const [library, setLibrary] = useState<string[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Lazy-load the audio library the first time the picker opens.
  const loadLibrary = useCallback(async () => {
    if (library !== null) return;
    try {
      const entries = await fetchAudioLibrary();
      setLibrary(entries.map((e) => e.filename));
    } catch (e) {
      setLibraryError((e as Error).message);
      setLibrary([]);
    }
  }, [library]);

  const togglePreview = (filename: string) => {
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
      if (audioRef.current === audio) audioRef.current = null;
      setPlayingFile((p) => (p === filename ? null : p));
    });
    audio.addEventListener('error', () => {
      if (audioRef.current === audio) audioRef.current = null;
      setPlayingFile((p) => (p === filename ? null : p));
    });
    void audio.play().catch(() => {
      setPlayingFile((p) => (p === filename ? null : p));
    });
  };

  // Stop any preview when this component unmounts (panel switch / save reload).
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const available = (library ?? []).filter((f) => !files.includes(f));

  return (
    <div className="space-y-2">
      {files.length === 0 && (
        <p className="text-[10px] italic text-led-muted/70">
          No tracks configured — the concerning music offer will silently no-op when the child says yes.
        </p>
      )}
      {files.map((filename, idx) => (
        <div key={filename + idx} className="flex items-center gap-2 bg-led-bg rounded border border-led-border px-2 py-1.5">
          <button
            onClick={() => togglePreview(filename)}
            className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600/30 hover:bg-purple-600/50 flex items-center justify-center text-purple-100 transition-colors"
            title={playingFile === filename ? 'Pause preview' : 'Preview'}
          >
            {playingFile === filename ? <Pause size={11} /> : <Play size={11} />}
          </button>
          <Music size={11} className="text-slate-500 flex-shrink-0" />
          <span className="flex-1 text-[11px] text-slate-200 truncate font-mono">{filename}</span>
          <button
            onClick={() => onChange(files.filter((_, i) => i !== idx))}
            className="text-led-muted hover:text-rose-300 transition-colors flex-shrink-0"
            title="Remove from list"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      <div>
        <button
          onClick={() => {
            void loadLibrary();
            setPickerOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-led-border bg-led-panel px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
        >
          <Plus size={11} />
          Add track
        </button>
      </div>

      {pickerOpen && (
        <div className="mt-1 rounded border border-led-border bg-led-bg p-2 space-y-1 max-h-56 overflow-y-auto">
          {library === null && <div className="text-[10px] text-led-muted">Loading audio library…</div>}
          {libraryError && <div className="text-[10px] text-rose-400">{libraryError}</div>}
          {library !== null && available.length === 0 && (
            <div className="text-[10px] italic text-led-muted/70">
              No more files available — every track in the audio library is already on the list. Upload more in the Audio Library panel.
            </div>
          )}
          {available.map((filename) => (
            <div key={filename} className="flex items-center gap-2 px-1 py-1 hover:bg-led-panel rounded">
              <button
                onClick={() => togglePreview(filename)}
                className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-200 transition-colors"
                title={playingFile === filename ? 'Pause preview' : 'Preview'}
              >
                {playingFile === filename ? <Pause size={9} /> : <Play size={9} />}
              </button>
              <span className="flex-1 text-[11px] text-slate-300 truncate font-mono">{filename}</span>
              <button
                onClick={() => {
                  onChange([...files, filename]);
                  if (playingFile === filename) {
                    audioRef.current?.pause();
                    audioRef.current = null;
                    setPlayingFile(null);
                  }
                }}
                className="inline-flex items-center gap-0.5 rounded bg-purple-600/40 hover:bg-purple-600/60 px-1.5 py-0.5 text-[10px] text-purple-100 transition-colors"
              >
                <Plus size={10} />
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Safety() {
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [original, setOriginal] = useState<StudioConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const safety = config?.safety;

  const updateSafety = (patch: Partial<SafetyConfig>) => {
    if (!config) return;
    setConfig({ ...config, safety: { ...config.safety, ...patch } });
    setSaved(false);
  };

  const dirty = config !== null && original !== null
    && JSON.stringify(config.safety) !== JSON.stringify(original.safety);

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
      title="Safety"
      description="Rules injected into the system prompt under ## Safety. Each list goes to the model as a bullet point; edits apply on the next chat session."
    >
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

      {loading && !error && <div className="text-sm text-led-muted">Loading…</div>}

      {safety && (
        <div className="space-y-4">
          <Section
            title="Topics to avoid"
            description="Subjects the model should not bring up or follow into. Rendered in the system prompt as “Topics to avoid: …”."
          >
            <StringList
              items={safety.avoidTopics}
              onChange={(v) => updateSafety({ avoidTopics: v })}
              rows={1}
              itemLabel="Topic"
              emptyHint="No topics listed — the model will treat all subjects as allowed."
            />
          </Section>

          <Section
            title="Hard prohibitions"
            description="Never-under-any-circumstances rules. The strongest line the model sees in the safety block."
            tone="danger"
          >
            <StringList
              items={safety.hardProhibitions}
              onChange={(v) => updateSafety({ hardProhibitions: v })}
              rows={2}
              itemLabel="Prohibition"
              emptyHint="No hard prohibitions defined."
            />
          </Section>

          <Section
            title="Distress keywords"
            description="Highest-priority intercept. TestChat substring-matches every real user message against this list BEFORE the scripted intro, the active activity, or any LLM call. A match short-circuits the turn — the message never reaches the cloud model."
            tone="danger"
          >
            <StringList
              items={safety.distressKeywords}
              onChange={(v) => updateSafety({ distressKeywords: v })}
              rows={1}
              itemLabel="Keyword"
              emptyHint="No keywords defined — distress detection is disabled until you add at least one."
            />
          </Section>

          <Section
            title="Model-judged distress detection"
            description="After every model reply, the runtime sends the reply back to the classifier model and asks: “is this a distress-handling response?”. If yes, the session ends with the caregiver banner. No keyword list — the model judges semantically so 妈妈在外面等你 doesn't false-fire while 请马上告诉护士 does."
            tone="danger"
          >
            <p className="text-[11px] text-led-muted leading-relaxed">
              Edit the judging prompt in <code className="text-slate-300">apps/server/src/routes/classify.ts</code> under the <code className="text-slate-300">'assistant-distress'</code> schema.
            </p>
          </Section>

          <Section
            title="Caregiver banner"
            description="Shown in a sticky red banner above TestChat after ANY distress signal (local keyword, Azure 400 filter, or model-judged). Persists across End Session and clears on Start Chatting."
            tone="danger"
          >
            <textarea
              value={safety.distressCaregiverNote ?? ''}
              onChange={(e) => updateSafety({ distressCaregiverNote: e.target.value })}
              rows={4}
              className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-rose-500 font-mono"
              placeholder="Operator-facing text shown in the banner after a distress event…"
            />
          </Section>

          <Section
            title="Comfort music"
            description="After the concerning-level safety response, TestChat asks the child if they want to hear a soft track. Yes → rotates through this list (next file each time, in order). Files live in data/audio/."
          >
            <ComfortMusicList
              files={safety.comfortMusicFiles ?? []}
              onChange={(v) => updateSafety({ comfortMusicFiles: v })}
            />
          </Section>
        </div>
      )}
    </PanelShell>
  );
}
