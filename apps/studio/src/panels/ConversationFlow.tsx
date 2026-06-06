import React, { useCallback, useEffect, useState } from 'react';
import {
  Save, RotateCcw, Plus, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchConfig, saveConfig } from '../api/client.js';
import type { ConversationFlow as ConversationFlowConfig, StudioConfig } from '@xiaomu/contracts';

// ── Field wrappers ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-widest text-led-muted">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[10px] text-led-muted/70">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

function TextInput({ value, onChange, placeholder }: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-led-panel border border-led-border rounded-md px-2.5 py-1.5 text-[12px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
    />
  );
}

interface TextAreaProps {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}

function TextArea({ value, onChange, rows = 4, placeholder }: TextAreaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-y bg-led-panel border border-led-border rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
    />
  );
}

interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}

function NumberInput({ value, onChange, min = 1, max = 99 }: NumberInputProps) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      className="w-20 bg-led-panel border border-led-border rounded-md px-2.5 py-1.5 text-[12px] text-slate-200 focus:outline-none focus:border-purple-500"
    />
  );
}

// ── String list editor (collapsible) ─────────────────────────────────────────

interface StringListProps {
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
  rows?: number;
  itemLabel?: string;
  defaultOpen?: boolean;
}

function StringList({
  label, hint, items, onChange, rows = 2, itemLabel = 'Item', defaultOpen = false,
}: StringListProps) {
  const [open, setOpen] = useState(defaultOpen);

  const update = (idx: number, next: string) => {
    onChange(items.map((s, i) => (i === idx ? next : s)));
  };
  const add = () => onChange([...items, '']);
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div className="rounded-md border border-led-border bg-led-bg/40 p-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {label}
          <span className="text-[10px] text-led-muted font-normal">
            · {items.length} {items.length === 1 ? 'entry' : 'entries'}
          </span>
        </span>
      </button>
      {hint && <p className="mt-1 text-[10px] text-led-muted/70">{hint}</p>}
      {open && (
        <div className="mt-2 space-y-2">
          {items.map((value, idx) => (
            <div key={idx} className="rounded border border-led-border bg-led-panel p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-led-muted">{itemLabel} {idx + 1}</span>
                <button
                  onClick={() => remove(idx)}
                  className="text-led-muted hover:text-rose-300 transition-colors"
                  title={`Remove ${itemLabel.toLowerCase()}`}
                >
                  <X size={11} />
                </button>
              </div>
              <textarea
                value={value}
                onChange={(e) => update(idx, e.target.value)}
                rows={rows}
                className="w-full resize-y bg-led-bg border border-led-border rounded px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
              />
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

// ── Section wrapper ───────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <div className="rounded-lg border border-led-border bg-led-panel p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[11px] text-led-muted leading-relaxed">{description}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConversationFlow() {
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

  const flow = config?.conversationFlow;

  const updateFlow = (patch: Partial<ConversationFlowConfig>) => {
    if (!config) return;
    setConfig({ ...config, conversationFlow: { ...config.conversationFlow, ...patch } });
    setSaved(false);
  };

  const dirty = config !== null && original !== null
    && JSON.stringify(config.conversationFlow) !== JSON.stringify(original.conversationFlow);

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
      title="Conversation Flow"
      description="Scripted intro phrases, transition lines, and break behavior. Edits take effect on the next chat session."
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

      {flow && (
        <div className="space-y-4">
          {/* ── Session opening / closing (LLM hints) ──────────────────────── */}
          <Section
            title="Session opening & closing"
            description="Hints fed to the LLM in the system prompt. The model uses these as guidance, not verbatim lines."
          >
            <Field label="Opening hint">
              <TextArea
                value={flow.sessionOpeningScript}
                onChange={(v) => updateFlow({ sessionOpeningScript: v })}
                rows={2}
              />
            </Field>
            <Field
              label="Closing options"
              hint='Separate alternatives with " / ". The model picks one that fits the moment.'
            >
              <TextArea
                value={flow.sessionClosingScript}
                onChange={(v) => updateFlow({ sessionClosingScript: v })}
                rows={3}
              />
            </Field>
          </Section>

          {/* ── Session start (scripted intro, spoken verbatim) ────────────── */}
          <Section
            title="Session start (scripted intro)"
            description="Spoken verbatim by TestChat before the LLM takes over. The first-meeting question routes the child into one of two paths."
          >
            <Field
              label="First-meeting question"
              hint="Asked first on Start Chatting. The child's yes / no picks the path below."
            >
              <TextInput
                value={flow.firstMeetingQuestion ?? ''}
                onChange={(v) => updateFlow({ firstMeetingQuestion: v })}
              />
            </Field>

            {/* First-time visitor path */}
            <div className="rounded-md border border-led-border bg-led-bg/40 p-3 space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-purple-300">
                First-time visitor path
              </h3>
              <Field label="Long welcome" hint="Shown when the child confirms it's their first meeting.">
                <TextArea
                  value={flow.startChattingIntro ?? ''}
                  onChange={(v) => updateFlow({ startChattingIntro: v })}
                  rows={8}
                />
              </Field>
              <Field label="Age prompt">
                <TextInput
                  value={flow.agePrompt ?? ''}
                  onChange={(v) => updateFlow({ agePrompt: v })}
                />
              </Field>
              <Field label="Full weather prompt" hint="The five-weather picker.">
                <TextArea
                  value={flow.weatherPrompt ?? ''}
                  onChange={(v) => updateFlow({ weatherPrompt: v })}
                  rows={10}
                />
              </Field>
            </div>

            {/* Returning visitor path */}
            <div className="rounded-md border border-led-border bg-led-bg/40 p-3 space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-purple-300">
                Returning visitor path
              </h3>
              <Field
                label="Old-friend intro prefix"
                hint="Prepended to one of the random daily stories below."
              >
                <TextInput
                  value={flow.oldFriendIntroPrefix ?? ''}
                  onChange={(v) => updateFlow({ oldFriendIntroPrefix: v })}
                />
              </Field>
              <StringList
                label="Random daily stories"
                hint="The robot's “what I did today” opener. One is picked at random and appended to the old-friend prefix above; each ends with a question for the child."
                items={flow.returningSessionIntros ?? []}
                onChange={(v) => updateFlow({ returningSessionIntros: v })}
                rows={4}
                itemLabel="Daily story"
                defaultOpen
              />
              <Field
                label="Short weather prompt"
                hint="Appended to the mood mirror after the child answers — sent in the same bubble. Returning visitors skip the age question."
              >
                <TextInput
                  value={flow.shortWeatherPrompt ?? ''}
                  onChange={(v) => updateFlow({ shortWeatherPrompt: v })}
                />
              </Field>
            </div>
          </Section>

          {/* ── Transition phrases ───────────────────────────────────────── */}
          <Section
            title="Transition phrases"
            description="Available to the model when shifting between topics or activities."
          >
            <StringList
              label="Transitions"
              items={flow.transitionPhrases}
              onChange={(v) => updateFlow({ transitionPhrases: v })}
              rows={2}
              itemLabel="Phrase"
              defaultOpen
            />
          </Section>

          {/* ── Breaks ────────────────────────────────────────────────────── */}
          <Section
            title="Breaks"
            description="After this many free-form turns (an activity or game counts as one), TestChat injects a break suggestion. The child can keep going."
          >
            <Field label="Max turns before break">
              <NumberInput
                value={flow.maxTurnsBeforeBreak}
                onChange={(v) => updateFlow({ maxTurnsBeforeBreak: v })}
                min={1}
                max={50}
              />
            </Field>

            <StringList
              label="Break suggestion phrases"
              hint="One is picked at random when the threshold is reached. They should sound optional, not demanding."
              items={flow.breakSuggestionPhrases ?? []}
              onChange={(v) => updateFlow({ breakSuggestionPhrases: v })}
              rows={3}
              itemLabel="Phrase"
              defaultOpen
            />
          </Section>
        </div>
      )}
    </PanelShell>
  );
}
