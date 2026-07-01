"""Load a published StudioBundle (data/published/vN.json) for the robot.

The robot consumes the same bundle the studio publishes (config + audioManifest).
This exposes the bits the embodiment needs now — expression color overrides from
config.face.expressionLibrary — and keeps the rest available via .config / .raw
for the activity runtime (R3) and audio (R3/R4).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

from face.expressions import EXPRESSIONS, Expression, with_color


@dataclass
class Bundle:
    version: int
    published_at: str
    config: dict
    audio_manifest: list = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    def expression(self, expr_id: str) -> Expression:
        """Base pose with the published color override (if any) applied."""
        base = EXPRESSIONS[expr_id]
        lib = (self.config.get("face") or {}).get("expressionLibrary") or {}
        pose = lib.get(expr_id) or {}
        color = pose.get("colorHex")
        return with_color(base, color) if color else base


def load_version(published_dir: str, version: int) -> Optional[Bundle]:
    path = os.path.join(published_dir, f"v{version}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return Bundle(
        version=raw["version"],
        published_at=raw.get("publishedAt", ""),
        config=raw.get("config", {}),
        audio_manifest=raw.get("audioManifest", []),
        raw=raw,
    )


def load_active(published_dir: str) -> Optional[Bundle]:
    """Load whichever version active.json points at (what the robot runs)."""
    active_path = os.path.join(published_dir, "active.json")
    if not os.path.exists(active_path):
        return None
    with open(active_path, encoding="utf-8") as f:
        active = json.load(f)
    return load_version(published_dir, active["version"])
