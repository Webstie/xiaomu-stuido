"""Live face loop — a continuously 'alive' idle face (blink/breath/drift).

On the Pi (real LCD):
    ~/RaspberryPi-CM5/xgovenv/bin/python run_face.py            # calm, on the LCD
    ~/RaspberryPi-CM5/xgovenv/bin/python run_face.py excited
Dev (writes preview/_live.png each frame — open it to watch):
    python run_face.py calm --file

This is the R2 baseline the activity runtime (R3) drives by swapping the active
expression in response to buttons / chat / emotion.
"""
import sys
import time

from face.expressions import EXPRESSIONS
from face.renderer import render, state_with_idle
from face.idle import IdleBehavior

FPS = 20
SUPERSAMPLE = 2  # 1 = fastest (LCD), 2 = smoother; tune to the Pi's frame budget


def _now_ms() -> float:
    return time.monotonic() * 1000.0


def main() -> None:
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    expr_id = args[0] if args else "calm"
    expr = EXPRESSIONS[expr_id]

    if "--file" in flags:
        from face.display import FileDisplay
        disp = FileDisplay()
    else:
        from face.display import LcdDisplay
        disp = LcdDisplay()

    idle = IdleBehavior(_now_ms())
    frame_budget = 1.0 / FPS
    try:
        while True:
            t0 = _now_ms()
            mods = idle.update(t0)
            disp.show(render(state_with_idle(expr, mods), 320, 200, supersample=SUPERSAMPLE))
            spent = (_now_ms() - t0) / 1000.0
            if spent < frame_budget:
                time.sleep(frame_budget - spent)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
