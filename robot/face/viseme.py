"""Azure viseme ID (0-21) -> mouth shape — port of apps/studio/src/face/visemeMap.ts.

zh-CN visemes were verified working (C3 spike, 2026-05-27) for
zh-CN-XiaoxiaoMultilingualNeural, so the LCD lip-syncs from real viseme events
(no audio-envelope fallback). Used by FaceController during TTS playback (S2).
"""
from __future__ import annotations

from .expressions import Mouth


def _m(width: float, curve: float, open_: float = 0.0, round_: bool = False) -> Mouth:
    return Mouth(width, curve, open_, round_)


VISEME_MOUTH = {
    0:  _m(26, 8, 0),          # silence — baseline slight smile
    1:  _m(26, 4, 10),         # ae/ah
    2:  _m(28, 2, 16),         # aa — wide open
    3:  _m(16, 4, 8, True),    # ao — rounded
    4:  _m(24, 5, 7),          # ey/eh
    5:  _m(22, 3, 6),          # er
    6:  _m(18, 6, 4),          # iy/ih
    7:  _m(12, 3, 6, True),    # w/uw — pucker
    8:  _m(14, 3, 8, True),    # ow
    9:  _m(20, 2, 14),         # aw
    10: _m(14, 3, 9, True),    # oy
    11: _m(28, 2, 13),         # ah/at
    12: _m(22, 4, 5),          # h
    13: _m(22, 4, 5),          # r
    14: _m(24, 5, 4),          # l
    15: _m(20, 3, 1),          # s/z
    16: _m(18, 3, 5),          # sh/ch
    17: _m(22, 2, 3),          # th
    18: _m(20, 2, 2),          # f/v
    19: _m(22, 3, 0),          # d/t/n
    20: _m(22, 4, 4),          # k/g/ng
    21: _m(18, 2, 0),          # p/b/m — bilabial closure
}


def get_mouth_for_viseme(viseme_id: int) -> Mouth:
    return VISEME_MOUTH.get(viseme_id, VISEME_MOUTH[0])
