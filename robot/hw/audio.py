"""Audio I/O on the Rider-Pi.

Playback via mplayer (already on the Pi; the Yahboom demo uses it too) — non-blocking
so the face can animate while audio plays. Recording via arecord in the WAV/PCM format
Azure STT expects (16 kHz, 16-bit, mono). Device names are overridable via env because
the Rider-Pi's WM8960 codec enumerates as a non-default ALSA card.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import time
from typing import Callable, Optional

AUDIO_OUT_DEVICE = os.environ.get("XIAOMU_AUDIO_OUT", "")          # "" = mplayer default
AUDIO_IN_DEVICE = os.environ.get("XIAOMU_AUDIO_IN", "plughw:2,0")  # WM8960 capture = card 2
# WM8960 Capture PGA defaults to 30 dB (max) → severe clipping → bad STT. Pull it down.
MIC_GAIN_PERCENT = os.environ.get("XIAOMU_MIC_GAIN", "50")
MIC_CARD = os.environ.get("XIAOMU_MIC_CARD", "wm8960soundcard")
VOLUME_CARD = os.environ.get("XIAOMU_VOLUME_CARD", MIC_CARD)
VOLUME_CONTROL = os.environ.get("XIAOMU_VOLUME_CONTROL", "Speaker")
VOLUME_KEEP_FULL = [
    c.strip() for c in os.environ.get("XIAOMU_VOLUME_KEEP_FULL", "Playback").split(",") if c.strip()
]
# WM8960's ALSA "percent" is register-linear, not loudness-linear: Speaker 70%
# is about -32 dB. Expose a practical UI range where 1..100 maps to 70..100.
VOLUME_HW_MIN = int(os.environ.get("XIAOMU_VOLUME_HW_MIN", "70"))
VOLUME_HW_MAX = int(os.environ.get("XIAOMU_VOLUME_HW_MAX", "100"))


def set_mic_gain(percent: str = MIC_GAIN_PERCENT) -> None:
    """Set the WM8960 capture gain (persists only until reboot, so call at startup)."""
    try:
        subprocess.run(["amixer", "-c", MIC_CARD, "sset", "Capture", f"{percent}%"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        print(f"mic gain set to {percent}%", flush=True)
    except Exception as e:
        print("mic gain set failed:", e, flush=True)


def _amixer_base() -> list[str]:
    cmd = ["amixer"]
    if VOLUME_CARD:
        cmd += ["-c", VOLUME_CARD]
    return cmd


def _amixer_get(control: str) -> str:
    return subprocess.check_output(
        _amixer_base() + ["get", control],
        text=True,
        stderr=subprocess.DEVNULL,
        timeout=1.5,
    )


def _amixer_set(control: str, percent: int) -> None:
    subprocess.run(
        _amixer_base() + ["sset", control, f"{max(0, min(100, percent))}%"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=1.5,
        check=False,
    )


def _parse_percent(text: str) -> int | None:
    import re
    vals = [int(m.group(1)) for m in re.finditer(r"\[(\d{1,3})%\]", text)]
    return vals[-1] if vals else None


def _ui_to_hw(percent: int) -> int:
    percent = max(0, min(100, int(percent)))
    if percent <= 0:
        return 0
    lo, hi = sorted((max(0, min(100, VOLUME_HW_MIN)), max(0, min(100, VOLUME_HW_MAX))))
    return round(lo + (hi - lo) * (percent / 100))


def _hw_to_ui(percent: int) -> int:
    percent = max(0, min(100, int(percent)))
    if percent <= 0:
        return 0
    lo, hi = sorted((max(0, min(100, VOLUME_HW_MIN)), max(0, min(100, VOLUME_HW_MAX))))
    if percent <= lo:
        return 1
    if percent >= hi:
        return 100
    return round((percent - lo) * 100 / max(1, hi - lo))


def get_output_volume(default: int = 70) -> int:
    try:
        val = _parse_percent(_amixer_get(VOLUME_CONTROL))
        if val is not None:
            return _hw_to_ui(val)
    except Exception:
        pass
    return default


def set_output_volume(percent: int) -> int:
    percent = max(0, min(100, int(percent)))
    for control in VOLUME_KEEP_FULL:
        try:
            _amixer_set(control, 100)
        except Exception:
            continue
    try:
        _amixer_set(VOLUME_CONTROL, _ui_to_hw(percent))
    except Exception:
        return percent
    return get_output_volume(percent)


class Player:
    """One audio stream at a time (like the robot's single speaker)."""

    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None

    def play(self, path: str, loop: bool = False, volume: Optional[int] = None) -> None:
        """Play a file. loop=True repeats forever (mplayer -loop 0); volume is 0-100
        (used to keep the background-music channel UNDER the TTS voice)."""
        self.stop()
        # -noconsolecontrols + DEVNULL stdin so mplayer runs headless/detached
        # (no controlling tty → otherwise it bails with "Terminal type unknown").
        cmd = ["mplayer", "-really-quiet", "-nolirc", "-noconsolecontrols", "-novideo"]
        if AUDIO_OUT_DEVICE:
            cmd += ["-ao", AUDIO_OUT_DEVICE]
        if loop:
            cmd += ["-loop", "0"]
        if volume is not None:
            cmd += ["-volume", str(int(volume))]
        cmd.append(path)
        env = dict(os.environ, TERM="dumb")
        self._proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)

    def is_playing(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def wait(self) -> None:
        if self._proc is not None:
            self._proc.wait()

    def stop(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None


def play_bytes(data: bytes, suffix: str = ".mp3", player: Optional[Player] = None) -> Player:
    p = player or Player()
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="xiaomu_")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    p.play(path)
    return p


def record_wav(path: str, max_seconds: float = 22.0, min_seconds: float = 3.0,
               release_grace_seconds: float = 0.9,
               is_held: Optional[Callable[[], bool]] = None) -> str:
    """Record mic → WAV (16 kHz mono S16_LE). Records until release (is_held False)
    but for AT LEAST min_seconds, then requires release to stay stable for a short
    grace window. This avoids button bounce / accidental early release truncating
    a child's sentence; caps at max_seconds."""
    cmd = ["arecord", "-q", "-D", AUDIO_IN_DEVICE,
           "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav", path]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    start = time.monotonic()
    released_at: float | None = None
    try:
        while True:
            if proc.poll() is not None:
                break
            elapsed = time.monotonic() - start
            if elapsed >= max_seconds:
                break
            if is_held is not None and elapsed >= min_seconds:
                if is_held():
                    released_at = None
                else:
                    released_at = released_at or time.monotonic()
                    if time.monotonic() - released_at >= release_grace_seconds:
                        break
            time.sleep(0.03)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
    return path


def read_wav(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()
