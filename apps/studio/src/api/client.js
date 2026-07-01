// ── REST ──────────────────────────────────────────────────────────────────────
export async function fetchConfig(id = 'default') {
    const res = await fetch(`/api/config/${id}`);
    if (!res.ok)
        throw new Error(`GET /api/config/${id}: ${res.status}`);
    return res.json();
}
export async function saveConfig(config, id = 'default') {
    const res = await fetch(`/api/config/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    if (!res.ok)
        throw new Error(`PUT /api/config/${id}: ${res.status}`);
    return res.json();
}
export async function fetchAudioLibrary() {
    const res = await fetch('/api/audio');
    if (!res.ok)
        throw new Error(`GET /api/audio: ${res.status}`);
    return res.json();
}
export async function classifyIntent(text, schema, context) {
    const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, schema, ...(context ? { context } : {}) }),
    });
    if (!res.ok)
        throw new Error(`POST /api/classify: ${res.status}`);
    const data = (await res.json());
    return data.label;
}
export async function assessUserRisk(text, context) {
    const res = await fetch('/api/risk-assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(context ? { context } : {}) }),
    });
    if (!res.ok) {
        // Fail safe — never block a turn because the classifier endpoint hiccuped.
        // The keyword filter still runs as the second layer.
        return { emotion: 'neutral', risk_level: 'safe' };
    }
    return res.json();
}
export async function fetchSystemPrompt(childAge, configId = 'default') {
    const url = `/api/system-prompt?configId=${encodeURIComponent(configId)}&childAge=${childAge}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`GET /api/system-prompt: ${res.status}`);
    const data = (await res.json());
    return data.systemPrompt;
}
export async function fetchTtsVisemes(text, style = 'cheerful', voice) {
    const res = await fetch('/api/tts/visemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style, ...(voice ? { voice } : {}) }),
    });
    if (!res.ok)
        throw new Error(`POST /api/tts/visemes: ${res.status}`);
    return res.json();
}
export async function transcribeAudio(blob, language = 'zh-CN') {
    const form = new FormData();
    form.append('audio', blob, 'utterance.wav');
    const res = await fetch(`/api/transcribe?language=${encodeURIComponent(language)}`, {
        method: 'POST',
        body: form,
    });
    const data = (await res.json());
    if (!res.ok || data.error) {
        throw new Error(data.error || `POST /api/transcribe: ${res.status}`);
    }
    return { text: (data.text || '').trim(), status: data.status || 'Unknown' };
}
