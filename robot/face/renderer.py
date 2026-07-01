"""PythonLCD face renderer — a faithful PIL port of
apps/studio/src/face/SVG2DRenderer.tsx.

Renders the abstract Cozmo/EMO-style LED face (dark panel, glowing eyes with
inner-shadow + highlight, quadratic-bezier mouth, head tilt, vignette) into a
PIL image sized for the robot's LCD. The studio renders the same poses in SVG;
this renders them with Pillow so they can be pushed to the SPI LCD.

Coordinate system is the design space (320x200); render() supersamples then
downscales to the requested LCD size for anti-aliasing.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .expressions import (
    Expression, VIEW_W, VIEW_H, L_EYE, R_EYE, MOUTH, PANEL_BG,
)


# ── Resolved per-frame render state (expression + idle + viseme combined) ──────

@dataclass
class EyeState:
    rx: float
    ry: float          # already includes blink (0 = fully closed)
    squint_top: float
    dx: float = 0.0    # drift + tilt parallax
    dy: float = 0.0    # breath sway + drift


@dataclass
class MouthState:
    width: float
    curve: float
    open: float
    round: bool


@dataclass
class FaceState:
    left: EyeState
    right: EyeState
    mouth: MouthState
    color: str         # hex
    glow: float
    tilt: float        # degrees


def state_from_expression(expr: Expression) -> FaceState:
    """Static pose for one expression (no idle, no viseme) — used for previews."""
    return FaceState(
        left=EyeState(expr.left_eye.rx, expr.left_eye.ry, expr.left_eye.squint_top),
        right=EyeState(expr.right_eye.rx, expr.right_eye.ry, expr.right_eye.squint_top),
        mouth=MouthState(expr.mouth.width, expr.mouth.curve, expr.mouth.open, expr.mouth.round),
        color=expr.color,
        glow=expr.glow_strength,
        tilt=expr.head_tilt,
    )


def state_with_idle(expr: Expression, idle) -> FaceState:
    """Combine an expression with per-frame idle modifiers (blink/breath/drift),
    mirroring SVG2DRenderer's combine step. `idle` is a face.idle.IdleModifiers.
    """
    eye_open = max(0.0, 1.0 - idle.blink)
    parallax = math.sin(math.radians(expr.head_tilt)) * 8
    dy = idle.breath_y + idle.drift_y
    return FaceState(
        left=EyeState(expr.left_eye.rx, expr.left_eye.ry * eye_open,
                      expr.left_eye.squint_top, idle.drift_x - parallax, dy),
        right=EyeState(expr.right_eye.rx, expr.right_eye.ry * eye_open,
                       expr.right_eye.squint_top, idle.drift_x + parallax, dy),
        mouth=MouthState(expr.mouth.width, expr.mouth.curve, expr.mouth.open, expr.mouth.round),
        color=expr.color,
        glow=expr.glow_strength,
        tilt=expr.head_tilt,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def _bbox(cx: float, cy: float, rx: float, ry: float) -> tuple[float, float, float, float]:
    return (cx - rx, cy - ry, cx + rx, cy + ry)


def _quad_points(p0, p1, p2, n=28):
    """Sample a quadratic bezier into n+1 points."""
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


# ── Vignette (built once per size, cached) ─────────────────────────────────────

_vignette_cache: dict[tuple[int, int], Image.Image] = {}


def _vignette(w: int, h: int) -> Image.Image:
    key = (w, h)
    cached = _vignette_cache.get(key)
    if cached is not None:
        return cached
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    # radial gradient: transparent center → alpha 0.5 at the r=70% ring and beyond
    dist = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy) / cy) ** 2)
    a = np.clip(dist / 0.7, 0, 1) ** 1.5 * 0.5
    alpha = (a * 255).astype(np.uint8)
    img = np.zeros((h, w, 4), dtype=np.uint8)
    img[..., 3] = alpha  # black with radial alpha
    out = Image.fromarray(img, "RGBA")
    _vignette_cache[key] = out
    return out


# ── Eye ─────────────────────────────────────────────────────────────────────--

def _draw_eye(face_layer: Image.Image, glow_layer: Image.Image,
              cx: float, cy: float, eye: EyeState, color: tuple[int, int, int],
              glow_strength: float, s: float) -> None:
    """Draw one eye (crisp shapes + glow silhouette) onto the shared layers.

    Each eye is built on its own temp layer so squint can cleanly erase the
    flat-topped region without touching the other eye / mouth.
    """
    ecx = (cx + eye.dx) * s
    ecy = (cy + eye.dy) * s
    rx = eye.rx * s
    ry = max(0.5, eye.ry) * s

    eye_layer = Image.new("RGBA", face_layer.size, (0, 0, 0, 0))
    glow_eye = Image.new("RGBA", face_layer.size, (0, 0, 0, 0))
    _eye_shapes(ImageDraw.Draw(eye_layer), ecx, ecy, rx, ry, color, glow_strength)
    ImageDraw.Draw(glow_eye).ellipse(_bbox(ecx, ecy, rx, ry), fill=(*color, 230))

    if eye.squint_top > 0.02:
        flat_y = max(0, int(ecy - ry * (1 - eye.squint_top)))
        box = (0, 0, face_layer.width, flat_y)
        eye_layer.paste((0, 0, 0, 0), box)
        glow_eye.paste((0, 0, 0, 0), box)

    face_layer.alpha_composite(eye_layer)
    glow_layer.alpha_composite(glow_eye)


def _eye_shapes(d: ImageDraw.ImageDraw, ecx, ecy, rx, ry, color, glow_strength):
    # soft halo
    halo_a = int(min(1.0, 0.18 * glow_strength) * 255)
    d.ellipse(_bbox(ecx, ecy, rx + 3, ry + 3), fill=(*color, halo_a))
    # main eye
    d.ellipse(_bbox(ecx, ecy, rx, ry), fill=(*color, 255))
    # inner shadow / depth
    d.ellipse(_bbox(ecx, ecy + ry * 0.1, rx * 0.55, ry * 0.55), fill=(0, 0, 0, 90))
    # highlight
    hr = max(1.5, ry * 0.22)
    hx = ecx + rx * 0.32
    hy = ecy - ry * 0.32
    d.ellipse(_bbox(hx, hy, hr, hr), fill=(255, 255, 255, 191))


# ── Mouth ──────────────────────────────────────────────────────────────────---

def _draw_mouth(face: ImageDraw.ImageDraw, glow: ImageDraw.ImageDraw,
                m: MouthState, color: tuple[int, int, int], glow_strength: float, s: float) -> None:
    cx, cy = MOUTH[0] * s, MOUTH[1] * s
    w = m.width * s
    curve = m.curve * s
    open_ = m.open * s

    if m.round:
        rx = max(3, m.open * 0.55 + 4) * s
        ry = max(3, m.open + 5) * s
        cyo = cy + m.open * 0.3 * s
        face.ellipse(_bbox(cx, cyo, rx, ry), fill=(*color, 48), outline=(*color, 255), width=max(2, int(2.5 * s)))
        glow.ellipse(_bbox(cx, cyo, rx, ry), fill=(*color, 200))
        return

    lx, rx_ = cx - w, cx + w
    upper = _quad_points((lx, cy), (cx, cy + curve), (rx_, cy))
    stroke = max(2, int((2.5 + m.open * 0.05) * s))

    if open_ > 0.5 * s:
        jaw_y = cy + m.open * 0.7 * s
        jaw_curve = (m.curve * 0.6 + m.open * 0.3) * s
        lower = _quad_points((rx_, cy), (cx, jaw_y + jaw_curve), (lx, cy))
        poly = upper + lower
        face.polygon(poly, fill=(*color, 34))
        _thick_curve(face, upper, color, stroke)
        _thick_curve(face, lower, color, stroke)
        _thick_curve(glow, upper, color, stroke, a=200)
        _thick_curve(glow, lower, color, stroke, a=200)
    else:
        _thick_curve(face, upper, color, stroke)
        _thick_curve(glow, upper, color, stroke, a=200)


def _thick_curve(d: ImageDraw.ImageDraw, pts, color, width, a=255):
    d.line(pts, fill=(*color, a), width=width, joint="curve")
    # rounded caps
    r = width / 2
    for (x, y) in (pts[0], pts[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=(*color, a))


# ── Main render ────────────────────────────────────────────────────────────---

def render(state: FaceState, width: int = VIEW_W, height: int = VIEW_H,
           supersample: int = 3) -> Image.Image:
    """Render a FaceState to an RGB image of (width, height)."""
    s = supersample
    W, H = VIEW_W * s, VIEW_H * s
    color = _hex(state.color)

    base = Image.new("RGB", (W, H), PANEL_BG)

    # Face group (gets tilted): vignette + glow + crisp shapes
    face_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    glow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    _draw_eye(face_layer, glow_layer, L_EYE[0], L_EYE[1], state.left, color, state.glow, s)
    _draw_eye(face_layer, glow_layer, R_EYE[0], R_EYE[1], state.right, color, state.glow, s)
    _draw_mouth(ImageDraw.Draw(face_layer), ImageDraw.Draw(glow_layer), state.mouth, color, state.glow, s)

    # Blur the glow silhouettes into a soft halo.
    blur_radius = max(2.0, state.glow * 4.0) * s
    glow_blurred = glow_layer.filter(ImageFilter.GaussianBlur(blur_radius))

    group = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    group.alpha_composite(_vignette(W, H))
    group.alpha_composite(glow_blurred)
    group.alpha_composite(face_layer)

    # Head tilt: SVG rotate(tilt*0.4) is clockwise; PIL positive is CCW → negate.
    angle = -state.tilt * 0.4
    if abs(angle) > 0.01:
        group = group.rotate(angle, resample=Image.Resampling.BICUBIC, center=(W / 2, H / 2))

    base.paste(group, (0, 0), group)

    # Subtle scanline texture (not tilted), like the SVG overlay.
    scan = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(scan)
    for y in range(0, H, 2 * s):
        sd.line([(0, y), (W, y)], fill=(0, 0, 0, 12), width=s)
    base.paste(scan, (0, 0), scan)

    if (width, height) != (W, H):
        base = base.resize((width, height), Image.Resampling.LANCZOS)
    return base


def render_expression(expr: Expression, width: int = VIEW_W, height: int = VIEW_H,
                      supersample: int = 3) -> Image.Image:
    return render(state_from_expression(expr), width, height, supersample)
