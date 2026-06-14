/**
 * Typed API client for the Xiaomu server.
 * All requests go through Vite's proxy (/api → http://localhost:8787).
 */
import type { Persona, StudioConfig } from '@xiaomu/contracts';
import type { ExpressionEvent } from './chatStream.js';

export type { ExpressionEvent };

// ── REST ──────────────────────────────────────────────────────────────────────

export async function fetchPersonas(): Promise<Persona[]> {
  const res = await fetch('/api/personas');
  if (!res.ok) throw new Error(`GET /api/personas: ${res.status}`);
  return res.json() as Promise<Persona[]>;
}

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

export async function fetchSystemPrompt(personaId: string, configId = 'default'): Promise<string> {
  const url = `/api/system-prompt?configId=${encodeURIComponent(configId)}&personaId=${encodeURIComponent(personaId)}`;
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
