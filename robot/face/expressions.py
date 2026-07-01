"""The 16 expression poses — a faithful Python port of
apps/studio/src/face/expressions.ts.

These are the SAME poses the studio's SVG2DRenderer draws, in the SAME
320x200 design space (eye centers L(105,85) R(215,85), mouth (160,148)).
The robot's PythonLCD renderer (face/renderer.py) is a second implementation
of the project's pluggable FaceRenderer (CLAUDE.md §12), driven by this data.

Colors here match the studio defaults; at runtime a published StudioBundle's
config.face.expressionLibrary[id].colorHex overrides them (see face/bundle hook).
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Dict, List

# Design-space landmarks (viewBox 0 0 320 200) — keep in sync with the SVG renderer.
VIEW_W, VIEW_H = 320, 200
L_EYE = (105, 85)
R_EYE = (215, 85)
MOUTH = (160, 148)
PANEL_BG = (0x1A, 0x14, 0x20)  # #1a1420


@dataclass(frozen=True)
class Eye:
    rx: float          # horizontal radius
    ry: float          # vertical radius (open state)
    squint_top: float = 0.0  # 0=normal, 1=fully flat top (sleepy)


@dataclass(frozen=True)
class Mouth:
    width: float       # half-width of the mouth arc
    curve: float       # control-point y offset: >0 smile, <0 frown
    open: float = 0.0  # jaw opening height (0 = closed lips)
    round: bool = False  # O-shape for surprised / singing


@dataclass(frozen=True)
class Expression:
    id: str
    label: str
    color: str         # hex "#rrggbb"
    left_eye: Eye
    right_eye: Eye
    mouth: Mouth
    head_tilt: float   # degrees (positive = right lean)
    glow_strength: float  # 1-3 multiplier on the glow
    idle_bias: float   # 0-1: how much idle modulation applies
    ssml_style_hint: str


def _e(rx: float, ry: float, squint: float = 0.0) -> Eye:
    return Eye(rx, ry, squint)


def _m(width: float, curve: float, open_: float = 0.0, round_: bool = False) -> Mouth:
    return Mouth(width, curve, open_, round_)


EXPRESSIONS: Dict[str, Expression] = {
    "happy":       Expression("happy", "开心", "#f59e0b", _e(22, 7), _e(22, 7), _m(34, 22, 2), 2, 2.5, 0.6, "cheerful"),
    "excited":     Expression("excited", "兴奋", "#f97316", _e(19, 19), _e(19, 19), _m(36, 22, 10), -3, 3, 0.3, "excited"),
    "calm":        Expression("calm", "平静", "#38bdf8", _e(20, 13), _e(20, 13), _m(28, 8, 0), 0, 1.2, 1, "calm"),
    "gentle":      Expression("gentle", "温柔", "#6ee7b7", _e(18, 11), _e(18, 11), _m(24, 10, 0), 1, 1, 1, "gentle"),
    "listening":   Expression("listening", "倾听", "#818cf8", _e(20, 15), _e(20, 15), _m(22, 4, 0), 3, 1.5, 0.8, "gentle"),
    "curious":     Expression("curious", "好奇", "#a3e635", _e(20, 18), _e(18, 14), _m(24, 7, 0), -4, 1.8, 0.7, "curious"),
    "thinking":    Expression("thinking", "思考", "#94a3b8", _e(19, 11), _e(19, 11), _m(20, 1, 0), -5, 1, 0.5, "calm"),
    "sad":         Expression("sad", "难过", "#6366f1", _e(20, 9, 0.3), _e(20, 9, 0.3), _m(28, -14, 0), 1, 1, 0.9, "sad"),
    "anxious":     Expression("anxious", "紧张", "#f43f5e", _e(17, 16), _e(17, 16), _m(22, -5, 0), -2, 2, 0.4, "calm"),
    "sleepy":      Expression("sleepy", "困倦", "#c084fc", _e(22, 6, 0.65), _e(22, 6, 0.65), _m(26, 3, 0), 2, 0.8, 1, "calm"),
    "surprised":   Expression("surprised", "惊讶", "#fbbf24", _e(18, 20), _e(18, 20), _m(14, 0, 14, True), 0, 3, 0.2, "excited"),
    "celebrating": Expression("celebrating", "庆祝", "#ec4899", _e(18, 17), _e(18, 17), _m(34, 22, 8), -4, 3, 0.2, "excited"),
    "proud":       Expression("proud", "自豪", "#a78bfa", _e(22, 12), _e(22, 12), _m(30, 11, 0), -2, 1.8, 0.7, "gentle"),
    "confused":    Expression("confused", "困惑", "#fb923c", _e(20, 14), _e(16, 11, 0.2), _m(20, -2, 0), 5, 1.5, 0.6, "calm"),
    "playful":     Expression("playful", "俏皮", "#34d399", _e(22, 8), _e(22, 14), _m(30, 17, 2), -3, 2, 0.5, "cheerful"),
    "encouraging": Expression("encouraging", "鼓励", "#60a5fa", _e(20, 13), _e(20, 13), _m(30, 15, 0), 1, 1.8, 0.9, "cheerful"),
}

EXPRESSION_IDS: List[str] = list(EXPRESSIONS.keys())


def with_color(expr: Expression, color_hex: str) -> Expression:
    """Return a copy of expr with its color overridden (from a StudioBundle)."""
    return replace(expr, color=color_hex)
