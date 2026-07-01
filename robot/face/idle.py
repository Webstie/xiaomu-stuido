"""Daydream idle behavior — a faithful Python port of
apps/studio/src/face/idleBehavior.ts.

Three independent streams, evaluated per frame from a millisecond clock:
  1. Blink — random 3-5s interval, close ~90ms / open ~110ms
  2. Breathing sway — sine on Y, period ~4.2s, amplitude 1.5px (eyes)
  3. Eye drift — occasional slow drift to a random gaze point, hold, return

Suppressed while speech/visemes are active; resumes after a delay.
Randomness uses the stdlib `random` module (varies per run, like Math.random()).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass


@dataclass
class IdleModifiers:
    blink: float = 0.0       # 0 = eyes open, 1 = fully closed
    breath_y: float = 0.0    # px, applied to eyes
    drift_x: float = 0.0     # px
    drift_y: float = 0.0     # px


_ZERO = IdleModifiers()

_CLOSE_MS = 90
_OPEN_MS = 110
_BREATH_PERIOD_MS = 4200
_BREATH_AMP = 1.5
_DRIFT_AMP_X = 7
_DRIFT_AMP_Y = 5
_DRIFT_MOVE_MS = 900


def _rand(a: float, b: float) -> float:
    return a + random.random() * (b - a)


def _ease_in_out(t: float) -> float:
    return 2 * t * t if t < 0.5 else -1 + (4 - 2 * t) * t


class IdleBehavior:
    def __init__(self, now_ms: float) -> None:
        # blink
        self.next_blink_at = now_ms + _rand(2000, 4000)
        self.blink_phase = "open"  # open | closing | opening
        self.blink_start = 0.0
        # breath
        self.breath_start = now_ms
        # drift
        self.drift_phase = "idle"  # idle | moving | holding | returning
        self.next_drift_at = now_ms + _rand(5000, 10000)
        self.drift_start = 0.0
        self.from_x = self.from_y = 0.0
        self.to_x = self.to_y = 0.0
        self.hold_until = 0.0
        # suppression
        self.suppressed_until = 0.0

    def suppress(self, now_ms: float, duration_ms: float) -> None:
        """Pause idle (e.g. while speaking); resumes after duration_ms."""
        self.suppressed_until = now_ms + duration_ms

    def update(self, now_ms: float) -> IdleModifiers:
        if now_ms < self.suppressed_until:
            return _ZERO

        # ── Blink ──────────────────────────────────────────────────────────────
        blink = 0.0
        if self.blink_phase == "open" and now_ms >= self.next_blink_at:
            self.blink_phase = "closing"
            self.blink_start = now_ms
        if self.blink_phase == "closing":
            t = min(1.0, (now_ms - self.blink_start) / _CLOSE_MS)
            blink = t
            if t >= 1:
                self.blink_phase = "opening"
                self.blink_start = now_ms
        elif self.blink_phase == "opening":
            t = min(1.0, (now_ms - self.blink_start) / _OPEN_MS)
            blink = 1 - t
            if t >= 1:
                self.blink_phase = "open"
                self.next_blink_at = now_ms + _rand(3000, 5000)

        # ── Breath ─────────────────────────────────────────────────────────────
        bt = ((now_ms - self.breath_start) % _BREATH_PERIOD_MS) / _BREATH_PERIOD_MS
        breath_y = -math.sin(bt * 2 * math.pi) * _BREATH_AMP

        # ── Eye drift ──────────────────────────────────────────────────────────
        drift_x = 0.0
        drift_y = 0.0
        if self.drift_phase == "idle" and now_ms >= self.next_drift_at:
            self.drift_phase = "moving"
            self.drift_start = now_ms
            self.from_x, self.from_y = self.to_x, self.to_y
            self.to_x = _rand(-_DRIFT_AMP_X, _DRIFT_AMP_X)
            self.to_y = _rand(-_DRIFT_AMP_Y, _DRIFT_AMP_Y)
            self.hold_until = now_ms + _DRIFT_MOVE_MS + _rand(800, 2000)

        if self.drift_phase == "moving":
            t = min(1.0, (now_ms - self.drift_start) / _DRIFT_MOVE_MS)
            et = _ease_in_out(t)
            drift_x = self.from_x + (self.to_x - self.from_x) * et
            drift_y = self.from_y + (self.to_y - self.from_y) * et
            if t >= 1:
                self.drift_phase = "holding"
        elif self.drift_phase == "holding":
            drift_x, drift_y = self.to_x, self.to_y
            if now_ms >= self.hold_until:
                self.drift_phase = "returning"
                self.drift_start = now_ms
                self.from_x, self.from_y = self.to_x, self.to_y
                self.to_x = self.to_y = 0.0
        elif self.drift_phase == "returning":
            t = min(1.0, (now_ms - self.drift_start) / _DRIFT_MOVE_MS)
            et = _ease_in_out(t)
            drift_x = self.from_x * (1 - et)
            drift_y = self.from_y * (1 - et)
            if t >= 1:
                self.drift_phase = "idle"
                self.next_drift_at = now_ms + _rand(6000, 12000)
                self.to_x = self.to_y = 0.0

        return IdleModifiers(blink, breath_y, drift_x, drift_y)
