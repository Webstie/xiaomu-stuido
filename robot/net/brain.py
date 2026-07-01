"""HTTP/SSE client for the Node brain (apps/server) on the Pi.

Uses only the stdlib (urllib/http.client) — no pip installs (the Pi disk is tight).
Mirrors the studio's api/client.ts + chatStream.ts so the robot reproduces the
web behavior: streaming chat with text + expression timeline + activity tool-calls,
TTS, intent classification, risk assessment, and push-to-talk transcription.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Iterator, Optional

BRAIN_URL = os.environ.get("XIAOMU_BRAIN_URL", "http://127.0.0.1:8787")
DEFAULT_TIMEOUT = 60


# ── Streaming chat events (mirror chatStream.ts) ──────────────────────────────

@dataclass
class TextDelta:
    delta: str


@dataclass
class ExpressionTimeline:
    # list of {atCharOffset, expressionId, confidence}
    events: list = field(default_factory=list)


@dataclass
class ToolCall:
    name: str
    args: dict
    result: dict  # start_activity → {audioPlaylist, currentSectionText, sectionNumber, totalSections, ...}


@dataclass
class Done:
    usage: dict


def _post_json(path: str, body: dict, timeout: int = DEFAULT_TIMEOUT):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BRAIN_URL + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    return urllib.request.urlopen(req, timeout=timeout)


def chat_stream(
    messages: list[dict],
    child_age: int,
    activity_context: Optional[dict] = None,
    concerning: bool = False,
    config_id: str = "default",
    timeout: int = 90,
) -> Iterator[object]:
    """Yield TextDelta | ExpressionTimeline | ToolCall | Done from POST /api/chat (SSE)."""
    body = {"configId": config_id, "childAge": child_age, "messages": messages}
    if activity_context is not None:
        body["activityContext"] = activity_context
    if concerning:
        body["concerningMode"] = True

    resp = _post_json("/api/chat", body, timeout=timeout)
    buf: list[str] = []
    for raw in resp:
        line = raw.decode("utf-8", "replace").rstrip("\n").rstrip("\r")
        if line.startswith("data:"):
            buf.append(line[5:].lstrip())
            continue
        if line == "":  # event boundary
            if not buf:
                continue
            payload = "".join(buf)
            buf = []
            try:
                ev = json.loads(payload)
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "text":
                yield TextDelta(ev.get("delta", ""))
            elif t == "expression":
                yield ExpressionTimeline(ev.get("timeline", []))
            elif t == "tool_call":
                yield ToolCall(ev.get("name", ""), ev.get("args", {}), ev.get("result", {}))
            elif t == "done":
                yield Done(ev.get("usage", {}))
            elif t == "error":
                raise RuntimeError(f"chat error: {ev.get('message') or ev.get('error')}")
    # flush trailing event without a final blank line
    if buf:
        try:
            ev = json.loads("".join(buf))
            if ev.get("type") == "done":
                yield Done(ev.get("usage", {}))
        except json.JSONDecodeError:
            pass


def tts(text: str, voice: Optional[str] = None, timeout: int = 30) -> bytes:
    """POST /api/tts → mp3 bytes (Azure Speech via the brain's sanitizer)."""
    body: dict = {"text": text}
    if voice:
        body["voice"] = voice
    resp = _post_json("/api/tts", body, timeout=timeout)
    return resp.read()


def tts_visemes(text: str, voice: Optional[str] = None, timeout: int = 30):
    """POST /api/tts/visemes → (mp3_bytes, visemes) where visemes is a list of
    {visemeId, audioOffsetMs}. Drives LCD lip-sync (S2)."""
    body: dict = {"text": text}
    if voice:
        body["voice"] = voice
    resp = _post_json("/api/tts/visemes", body, timeout=timeout)
    j = json.loads(resp.read())
    audio = base64.b64decode(j["audio"]) if j.get("audio") else b""
    return audio, j.get("visemes", [])


def classify(text: str, schema: str, context: Optional[str] = None, timeout: int = 30) -> str:
    """POST /api/classify → label. `context` is required by the 'sound-match' schema
    (the expected sound label) and used to disambiguate vague replies elsewhere."""
    body: dict = {"text": text, "schema": schema}
    if context:
        body["context"] = context
    resp = _post_json("/api/classify", body, timeout=timeout)
    return json.loads(resp.read()).get("label", "unclear")


def risk(text: str, context: Optional[str] = None, timeout: int = 30) -> dict:
    """POST /api/risk-assess → {emotion, risk_level: 'safe'|'concerning'|'high_risk'}.
    Runs on every child turn; risk_level gates the deterministic safety response and
    `emotion` drives the face. Falls back to safe on any error (never block a child)."""
    body: dict = {"text": text}
    if context:
        body["context"] = context
    try:
        resp = _post_json("/api/risk-assess", body, timeout=timeout)
        return json.loads(resp.read())
    except Exception:
        return {"emotion": "neutral", "risk_level": "safe"}


def transcribe(wav_bytes: bytes, language: str = "zh-CN", timeout: int = 30) -> str:
    """POST /api/transcribe (multipart 'audio', WAV PCM) → recognized text."""
    boundary = "----xiaomuBoundary7MA4YWxkTrZu0gW"
    pre = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="audio"; filename="speech.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n"
    ).encode("utf-8")
    post = f"\r\n--{boundary}--\r\n".encode("utf-8")
    payload = pre + wav_bytes + post
    req = urllib.request.Request(
        f"{BRAIN_URL}/api/transcribe?language={language}",
        data=payload,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return ""
    return json.loads(resp.read()).get("text", "")


def get_config(config_id: str = "default", timeout: int = 15) -> dict:
    """GET /api/config/:id → the live StudioConfig."""
    resp = urllib.request.urlopen(f"{BRAIN_URL}/api/config/{config_id}", timeout=timeout)
    return json.loads(resp.read())


def health(timeout: int = 5) -> bool:
    try:
        resp = urllib.request.urlopen(f"{BRAIN_URL}/api/health", timeout=timeout)
        return json.loads(resp.read()).get("ok", False)
    except Exception:
        return False
