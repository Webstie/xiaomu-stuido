import React, { useCallback, useEffect, useState } from 'react';
import { Save, RotateCcw, Bot, Languages } from 'lucide-react';
import { PanelShell } from './_PanelShell.js';
import { fetchConfig, saveConfig } from '../api/client.js';
import type { StudioConfig, Identity as IdentityT } from '@xiaomu/contracts';

const LANG_LABEL: Record<string, string> = {
  'zh-CN': '中文 (Mandarin)',
  'en-US': 'English',
};

export default function Identity() {
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [original, setOriginal] = useState<StudioConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateIdentity = (patch: Partial<IdentityT>) => {
    if (!config) return;
    setConfig({ ...config, identity: { ...config.identity, ...patch } });
    setSaved(false);
  };

  const dirty =
    config !== null &&
    original !== null &&
    JSON.stringify(config.identity) !== JSON.stringify(original.identity);

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
      title="Identity"
      description="Robot name, tagline, and language. These appear in every system prompt and TTS call."
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
              onClick={() => void handleSave()}
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

      {config && (
        <div className="space-y-5">
          {/* Robot name */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-led-muted">
              <Bot size={11} />
              Robot name
            </label>
            <input
              type="text"
              value={config.identity.robotName}
              onChange={(e) => updateIdentity({ robotName: e.target.value })}
              maxLength={40}
              className="mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-base text-slate-100 focus:outline-none focus:border-purple-500"
            />
            <p className="mt-1 text-[10px] text-led-muted">
              The name the robot uses to refer to itself. Appears as &ldquo;You are {config.identity.robotName}…&rdquo; in the system prompt.
            </p>
          </div>

          {/* Tagline */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-led-muted">
              Tagline
            </label>
            <input
              type="text"
              value={config.identity.tagline}
              onChange={(e) => updateIdentity({ tagline: e.target.value })}
              maxLength={120}
              className="mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-led-muted">
              <span>One-line self-description shown below the name in the prompt.</span>
              <span>{config.identity.tagline.length} / 120</span>
            </div>
          </div>

          {/* Languages */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-led-muted">
                <Languages size={11} />
                Primary language
              </label>
              <select
                value={config.identity.primaryLanguage}
                onChange={(e) =>
                  updateIdentity({
                    primaryLanguage: e.target.value as 'zh-CN' | 'en-US',
                  })
                }
                className="mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
              >
                {Object.entries(LANG_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-led-muted">
                The robot&rsquo;s first-choice language in every reply.
              </p>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-led-muted">
                Secondary language
              </label>
              <select
                value={config.identity.secondaryLanguage ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    if (!config) return;
                    const { secondaryLanguage: _drop, ...rest } = config.identity;
                    setConfig({ ...config, identity: rest });
                    setSaved(false);
                  } else {
                    updateIdentity({ secondaryLanguage: v as 'zh-CN' | 'en-US' });
                  }
                }}
                className="mt-1.5 w-full bg-led-panel border border-led-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="">— None —</option>
                {Object.entries(LANG_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-led-muted">
                A fallback used when natural; leave empty for monolingual.
              </p>
            </div>
          </div>

          {/* Context (read-only) */}
          <div className="rounded-md border border-led-border bg-led-bg/40 p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="font-semibold uppercase tracking-widest text-[9px] text-led-muted mb-1.5">
              Project context (read-only)
            </div>
            <div className="space-y-0.5">
              <div><span className="text-slate-500">Target users:</span> hospitalized children aged 3–12 at 小水滴 (Beijing).</div>
              <div><span className="text-slate-500">Persona on robot side:</span> picked at runtime from the Personas panel (currently {LANG_LABEL[config.identity.primaryLanguage]} primary).</div>
              <div><span className="text-slate-500">Voice:</span> set in the Voice panel — current default <code className="text-slate-300">{config.voice.defaultVoice}</code>.</div>
              <div><span className="text-slate-500">Backstory:</span> Rainbow Diverse town — every heart has a song. Used as the first-time self-introduction.</div>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
