"""FaceController — the robot's live face, driven like the studio's SVG renderer.

Runs a render thread (~20 fps) that combines three streams onto the LCD:
  1. Expression — current pose, tweened over ~300 ms on change (like SVG2DRenderer).
  2. Idle — daydream blink/breath/drift when not speaking.
  3. Speaking — a talking-mouth flap while audio plays (LCD stand-in for visemes).

The session calls set_expression() / set_speaking() / apply_timeline(); the thread
renders. Expression timelines from /api/chat are scheduled across the speech duration.
"""
from __future__ import annotations

import math
import threading
import time
from typing import Optional

from .expressions import EXPRESSIONS, Expression, Eye, Mouth
from .idle import IdleBehavior
from .renderer import render, state_with_idle
from .display import Display
from .viseme import get_mouth_for_viseme

EXPR_TWEEN_MS = 300.0
FPS = 20
TALK_AMP = 9.0       # extra mouth-open while speaking
TALK_SPEED = 0.018   # rad per ms


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _ease_out(t: float) -> float:
    return 1 - (1 - t) * (1 - t)


def _hex_to_rgb(c: str):
    c = c.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def _lerp_color(c1: str, c2: str, t: float) -> str:
    a, b = _hex_to_rgb(c1), _hex_to_rgb(c2)
    return "#%02x%02x%02x" % tuple(round(_lerp(a[i], b[i], t)) for i in range(3))


def _lerp_eye(a: Eye, b: Eye, t: float) -> Eye:
    return Eye(_lerp(a.rx, b.rx, t), _lerp(a.ry, b.ry, t), _lerp(a.squint_top, b.squint_top, t))


def _lerp_expr(a: Expression, b: Expression, t: float) -> Expression:
    return Expression(
        id=b.id, label=b.label, color=_lerp_color(a.color, b.color, t),
        left_eye=_lerp_eye(a.left_eye, b.left_eye, t),
        right_eye=_lerp_eye(a.right_eye, b.right_eye, t),
        mouth=Mouth(_lerp(a.mouth.width, b.mouth.width, t),
                    _lerp(a.mouth.curve, b.mouth.curve, t),
                    _lerp(a.mouth.open, b.mouth.open, t),
                    b.mouth.round),
        head_tilt=_lerp(a.head_tilt, b.head_tilt, t),
        glow_strength=_lerp(a.glow_strength, b.glow_strength, t),
        idle_bias=b.idle_bias, ssml_style_hint=b.ssml_style_hint,
    )


class FaceController:
    def __init__(self, display: Display, supersample: int = 2,
                 default_expression: str = "calm") -> None:
        self._display = display
        self._ss = supersample
        self._lock = threading.Lock()
        self._from = EXPRESSIONS[default_expression]
        self._to = EXPRESSIONS[default_expression]
        self._tween_start = 0.0
        self._speaking = False
        self._visemes: list = []
        self._viseme_start = 0.0
        self._viseme_active = False
        self._idle = IdleBehavior(self._now())
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        # scheduled timeline: list of (fire_at_ms, expression_id)
        self._timeline: list[tuple[float, str]] = []
        # diagnostics
        self.frames = 0
        self.last_error: Optional[str] = None

    @staticmethod
    def _now() -> float:
        return time.monotonic() * 1000.0

    # ── public API ───────────────────────────────────────────────────────────
    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)

    def set_expression(self, expr_id: str) -> None:
        if expr_id not in EXPRESSIONS:
            return
        with self._lock:
            # snapshot current rendered pose as the tween origin
            self._from = self._current_expr()
            self._to = EXPRESSIONS[expr_id]
            self._tween_start = self._now()

    def set_speaking(self, speaking: bool) -> None:
        with self._lock:
            self._speaking = speaking
            if not speaking:
                self._viseme_active = False
            if speaking:
                self._idle.suppress(self._now(), 10_000)

    def speak_visemes(self, visemes: list) -> None:
        """Begin lip-sync: drive the mouth from Azure viseme events (audioOffsetMs)
        aligned to now. Call when TTS audio playback starts."""
        with self._lock:
            self._visemes = sorted(visemes, key=lambda v: v.get("audioOffsetMs", 0))
            self._viseme_start = self._now()
            self._viseme_active = bool(self._visemes)
            self._speaking = True
            self._idle.suppress(self._now(), 10_000)

    def stop_speaking(self) -> None:
        with self._lock:
            self._speaking = False
            self._viseme_active = False

    def apply_timeline(self, events: list, total_ms: float, char_total: int) -> None:
        """Schedule expression changes across a speech of total_ms, mapping each
        event's atCharOffset onto the timeline (mirrors the web's offset scheduling)."""
        now = self._now()
        sched: list[tuple[float, str]] = []
        denom = max(1, char_total)
        for ev in events:
            off = ev.get("atCharOffset", 0)
            expr = ev.get("expressionId")
            if expr in EXPRESSIONS:
                sched.append((now + total_ms * (off / denom), expr))
        with self._lock:
            self._timeline = sorted(sched)

    def clear_timeline(self) -> None:
        with self._lock:
            self._timeline = []

    # ── internals ────────────────────────────────────────────────────────────
    def _tween_t(self, now: float) -> float:
        return _ease_out(min(1.0, (now - self._tween_start) / EXPR_TWEEN_MS))

    def _current_expr(self) -> Expression:
        return _lerp_expr(self._from, self._to, self._tween_t(self._now()))

    def _run(self) -> None:
        import traceback
        frame = 1.0 / FPS
        while not self._stop.is_set():
            t0 = self._now()
            try:
                with self._lock:
                    # fire any due timeline events
                    if self._timeline and t0 >= self._timeline[0][0]:
                        due = [e for e in self._timeline if t0 >= e[0]]
                        self._timeline = [e for e in self._timeline if t0 < e[0]]
                        last = due[-1][1]
                        self._from = _lerp_expr(self._from, self._to, self._tween_t(t0))
                        self._to = EXPRESSIONS[last]
                        self._tween_start = t0
                    expr = _lerp_expr(self._from, self._to, self._tween_t(t0))
                    speaking = self._speaking
                    viseme_active = self._viseme_active
                    visemes = self._visemes
                    viseme_start = self._viseme_start
                    if speaking:
                        self._idle.suppress(t0, 600)
                    mods = self._idle.update(t0)
                state = state_with_idle(expr, mods)
                if speaking and viseme_active and visemes:
                    elapsed = t0 - viseme_start
                    cur = None
                    for v in visemes:
                        if v.get("audioOffsetMs", 0) <= elapsed:
                            cur = v
                        else:
                            break
                    if cur is not None:
                        mo = get_mouth_for_viseme(cur.get("visemeId", 0))
                        state.mouth.width, state.mouth.curve = mo.width, mo.curve
                        state.mouth.open, state.mouth.round = mo.open, mo.round
                    if elapsed > visemes[-1].get("audioOffsetMs", 0) + 400:
                        with self._lock:
                            self._viseme_active = False
                elif speaking:
                    flap = (math.sin(t0 * TALK_SPEED) * 0.5 + 0.5) * TALK_AMP
                    state.mouth.open = state.mouth.open + flap
                self._display.show(render(state, 320, 200, supersample=self._ss))
                self.frames += 1
            except Exception:
                if self.last_error is None:
                    self.last_error = traceback.format_exc()
            dt = (self._now() - t0) / 1000.0
            if dt < frame:
                time.sleep(frame - dt)
