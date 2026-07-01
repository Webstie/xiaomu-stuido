"""Motion guardrails.

Do not import or instantiate xgolib here. On this robot, touching the XGO motion
stack can make the body stand up during initialization.
"""
from __future__ import annotations

import os

MOTION_DISABLED = os.environ.get("XIAOMU_DISABLE_MOTION", "1") != "0"


def disable_motion() -> bool:
    """Keep Xiaomu's runtime from touching the motion stack.

    Returning True means "motion is disabled by policy"; it intentionally sends
    no serial commands.
    """
    return MOTION_DISABLED
