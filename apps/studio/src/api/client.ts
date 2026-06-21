/**
 * Typed API client for the Xiaomu server.
 * All requests go through Vite's proxy (/api → http://localhost:8787).
 */
import type { StudioConfig } from '@xiaomu/contracts';
import type { ExpressionEvent } from './chatStream.js';

export type { ExpressionEvent };

// ── REST ──────────────────────────────────────────────────────────────────────

export async function fetchConfig(id = 'default'): Promise<StudioConfig> {
  const res = await fetch(`/api/config/${id}`);
  if (!res.ok) throw new Error(`GET /api/config/${id}: ${res.status}`);
  return res.json() as Promise<StudioConfig>;
}

export async function saveConfig(config: StudioConfig, id = 'default'): Promise<StudioConfig> {
  const res = await fetch(`/api/config/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`PUT /api/config/${id}: ${res.status}`);
  return res.json() as Promise<StudioConfig>;
}

export interface AudioFileEntry {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  modifiedMs: number;
}

export async function fetchAudioLibrary(): Promise<AudioFileEntry[]> {
  const res = await fetch('/api/audio');
  if (!res.ok) throw new Error(`GET /api/audio: ${res.status}`);
  return res.json() as Promise<AudioFileEntry[]>;
}

export type ClassifySchema =
  | 'yesno' | 'mood' | 'goodbye' | 'activity-intent'
  | 'task-completed' | 'sound-match' | 'quit-activity'
  | 'weather-mood' | 'game-name'
  | 'assistant-distress';

export async function classifyIntent(
  text: string,
  schema: ClassifySchema,
  context?: string,
): Promise<string> {
  const res = await fetch('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, schema, ...(context ? { context } : {}) }),
  });
  if (!res.ok) throw new Error(`POST /api/classify: ${res.status}`);
  const data = (await res.json()) as { label: string };
  return data.label;
}

// ── Front-line risk classifier (runs on every user turn) ─────────────────────

export type RiskLevel = 'safe' | 'concerning' | 'high_risk';

export interface RiskAssessment {
  emotion: string;
  risk_level: RiskLevel;
}

export async function assessUserRisk(text: string): Promise<RiskAssessment> {
  const res = await fetch('/api/risk-assess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    // Fail safe — never block a turn because the classifier endpoint hiccuped.
    // The keyword filter still runs as the second layer.
    return { emotion: 'neutral', risk_level: 'safe' };
  }
  return res.json() as Promise<RiskAssessment>;
}

export async function fetchSystemPrompt(childAge: number, configId = 'default'): Promise<string> {
  const url = `/api/system-prompt?configId=${encodeURIComponent(configId)}&childAge=${childAge}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET /api/system-prompt: ${res.status}`);
  const data = (await res.json()) as { systemPrompt: string };
  return data.systemPrompt;
}

export interface TtsVisemesResponse {
  audio: string;        // base64 mp3
  visemes: Array<{ audioOffsetMs: number; visemeId: number }>;
  ssml: string;
}

export async function fetchTtsVisemes(
  text: string,
  style = 'cheerful',
  voice?: string,
): Promise<TtsVisemesResponse> {
  const res = await fetch('/api/tts/visemes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, style, ...(voice ? { voice } : {}) }),
  });
  if (!res.ok) throw new Error(`POST /api/tts/visemes: ${res.status}`);
  return res.json() as Promise<TtsVisemesResponse>;
}

export async function transcribeAudio(
  blob: Blob,
  language = 'zh-CN',
): Promise<{ text: string; status: string }> {
  const form = new FormData();
  form.append('audio', blob, 'utterance.wav');
  const res = await fetch(`/api/transcribe?language=${encodeURIComponent(language)}`, {
    method: 'POST',
    body: form,
  });
  const data = (await res.json()) as {
    text?: string;
    status?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok || data.error) {
    throw new Error(data.error || `POST /api/transcribe: ${res.status}`);
  }
  return { text: (data.text || '').trim(), status: data.status || 'Unknown' };
}
