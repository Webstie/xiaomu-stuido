"""Display backends — push a rendered PIL face to the robot's screen, or a file.

The face is designed at 320x200; the XGO LCD is 320x240, so faces are centered
onto the panel with fit_to_panel(). LcdDisplay is the real device (Pi only);
FileDisplay is for development on any machine.

LcdDisplay also (a) turns the LCD backlight ON — the xgoscreen lib leaves GPIO 0
(BL) low, and only the (now-disabled) Yahboom demo used to drive it high — and
(b) overlays a 4-corner button legend so the operator can see what each key does.
"""
from __future__ import annotations

import os
import socket
import subprocess
import time

from PIL import Image, ImageDraw, ImageFont

LCD_W, LCD_H = 320, 240
FACE_Y = 20  # vertical offset to center the 320x200 face on the 320x240 panel
PANEL_BG = (0x1A, 0x14, 0x20)

CJK_FONT = os.environ.get("XIAOMU_CJK_FONT", "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf")
ASCII_FONT = os.environ.get("XIAOMU_ASCII_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
SHOW_LABELS = os.environ.get("XIAOMU_SHOW_LABELS", "1") != "0"

# (corner, label) — matches the physical corner buttons (TL=start, TR=talk,
# BL=wifi/continue, BR=repeat); GPIO mapping is in hw/buttons.py PIN_MAP.
BUTTON_LABELS = [
    ("tl", "开始/停止"),
    ("tr", "按住说话"),
    ("bl", "网络"),
    ("br", "重复"),
]

_legend_cache = None
_ip_font = None
_ip_cache = {"value": "", "until": 0.0}
_volume_overlay: int | None = None


def _build_legend():
    """A cached 320x240 RGBA overlay with the 4 button labels in the corners."""
    global _legend_cache
    if _legend_cache is not None:
        return _legend_cache
    overlay = Image.new("RGBA", (LCD_W, LCD_H), (0, 0, 0, 0))
    try:
        font = ImageFont.truetype(CJK_FONT, 15)
    except Exception:
        _legend_cache = overlay
        return overlay
    d = ImageDraw.Draw(overlay)
    pad = 3
    for corner, text in BUTTON_LABELS:
        bbox = d.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if corner == "tl":
            x, y = pad, 1
        elif corner == "tr":
            x, y = LCD_W - tw - pad, 1
        elif corner == "bl":
            x, y = pad, LCD_H - th - 5
        else:  # br
            x, y = LCD_W - tw - pad, LCD_H - th - 5
        d.rectangle((x - 2, y - 1, x + tw + 2, y + th + 3), fill=(0, 0, 0, 130))
        d.text((x, y), text, font=font, fill=(170, 170, 185, 235))
    _legend_cache = overlay
    return overlay


def _font(size: int):
    try:
        return ImageFont.truetype(CJK_FONT, size)
    except Exception:
        return None


def _current_ip() -> str:
    """Return the first non-loopback IPv4 address, cached to avoid per-frame shelling."""
    now = time.monotonic()
    if now < _ip_cache["until"]:
        return _ip_cache["value"]
    ip = ""
    try:
        out = subprocess.check_output(
            ["hostname", "-I"], text=True, timeout=0.4, stderr=subprocess.DEVNULL
        )
        for part in out.split():
            if "." in part and not part.startswith("127."):
                ip = part
                break
    except Exception:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                ip = s.getsockname()[0]
        except Exception:
            ip = ""
    _ip_cache["value"] = ip
    _ip_cache["until"] = now + 5.0
    return ip


def _draw_ip(panel: Image.Image) -> None:
    global _ip_font
    ip = _current_ip()
    if not ip:
        return
    if _ip_font is None:
        try:
            _ip_font = ImageFont.truetype(ASCII_FONT, 12)
        except Exception:
            _ip_font = ImageFont.load_default()
    if _ip_font is None:
        return
    text = f"IP {ip}"
    d = ImageDraw.Draw(panel)
    bbox = d.textbbox((0, 0), text, font=_ip_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (LCD_W - tw) // 2
    y = LCD_H - th - 5
    d.rectangle((x - 3, y - 1, x + tw + 3, y + th + 2), fill=(0, 0, 0, 120))
    d.text((x, y), text, font=_ip_font, fill=(150, 150, 165, 230))


def _draw_volume(panel: Image.Image) -> None:
    if _volume_overlay is None:
        return
    level = max(0, min(100, int(_volume_overlay)))
    d = ImageDraw.Draw(panel)
    box = (42, 92, LCD_W - 42, 150)
    d.rounded_rectangle(box, radius=8, fill=(0, 0, 0, 185), outline=(90, 82, 110, 230), width=1)
    cjk = _font(16)
    try:
        ascii_font = ImageFont.truetype(ASCII_FONT, 16)
    except Exception:
        ascii_font = ImageFont.load_default()
    if cjk:
        label, val = "音量", f" {level}%"
        lb = d.textbbox((0, 0), label, font=cjk)
        vb = d.textbbox((0, 0), val, font=ascii_font)
        lw, lh = lb[2] - lb[0], lb[3] - lb[1]
        vw, vh = vb[2] - vb[0], vb[3] - vb[1]
        x = (LCD_W - lw - vw) // 2
        y = 100
        d.text((x, y), label, font=cjk, fill=(220, 220, 235, 245))
        d.text((x + lw, y + max(0, (lh - vh) // 2)), val, font=ascii_font, fill=(220, 220, 235, 245))
    x0, y0, x1, y1 = 62, 128, LCD_W - 62, 138
    d.rounded_rectangle((x0, y0, x1, y1), radius=5, fill=(45, 42, 56, 255))
    fill_x = x0 + int((x1 - x0) * (level / 100))
    if fill_x > x0:
        d.rounded_rectangle((x0, y0, fill_x, y1), radius=5, fill=(124, 92, 210, 255))


def set_volume_overlay(level: int | None) -> None:
    global _volume_overlay
    _volume_overlay = None if level is None else max(0, min(100, int(level)))


def fit_to_panel(face: Image.Image) -> Image.Image:
    """Center a 320x200 face onto the 320x240 LCD panel (no-op if already sized)."""
    if face.size == (LCD_W, LCD_H):
        return face
    canvas = Image.new("RGB", (LCD_W, LCD_H), PANEL_BG)
    x = (LCD_W - face.width) // 2
    canvas.paste(face, (x, FACE_Y))
    return canvas


class Display:
    size = (LCD_W, LCD_H)

    def show(self, img: Image.Image) -> None:
        raise NotImplementedError

    def clear(self) -> None:
        pass


class LcdDisplay(Display):
    """XGO 2-inch SPI LCD via xgoscreen (imports only work on the Pi)."""

    def __init__(self) -> None:
        import xgoscreen.LCD_2inch as LCD_2inch  # noqa: WPS433 (device-only import)
        self._d = LCD_2inch.LCD_2inch()
        # CRITICAL: LCD_2inch.__init__ does NOT run the ST7789 reset+init — only
        # Init() does (and only its reset arm when /tmp/screen_initialized is
        # absent, i.e. after a reboot). The Yahboom demo used to call it; with the
        # demo gone, WE must, or the panel is never initialized → black screen.
        self._d.Init()
        self._d.clear()
        os.system("pinctrl set 0 op dh")  # belt-and-suspenders backlight high

    def show(self, img: Image.Image) -> None:
        panel = fit_to_panel(img)
        if SHOW_LABELS:
            legend = _build_legend()
            panel.paste(legend, (0, 0), legend)  # alpha-composite the labels
            _draw_ip(panel)
            _draw_volume(panel)
        self._d.ShowImage(panel)

    def clear(self) -> None:
        self._d.clear()


class FileDisplay(Display):
    """Dev backend: overwrite a PNG with the latest frame (open it to watch)."""

    def __init__(self, path: str = "preview/_live.png") -> None:
        self.path = path

    def show(self, img: Image.Image) -> None:
        panel = fit_to_panel(img)
        if SHOW_LABELS:
            legend = _build_legend()
            panel.paste(legend, (0, 0), legend)
            _draw_ip(panel)
            _draw_volume(panel)
        panel.save(self.path)
