"""Render an animated GIF of the idle 'daydream' (blink + breath + drift).

Usage:  python preview_idle.py [expression] [out.gif] [seconds]
Run from robot/.  Default: calm, preview/idle.gif, 6s.
"""
import sys

from PIL import Image

from face.expressions import EXPRESSIONS
from face.renderer import render, state_with_idle
from face.idle import IdleBehavior

FPS = 20


def main() -> None:
    expr_id = sys.argv[1] if len(sys.argv) > 1 else "calm"
    out = sys.argv[2] if len(sys.argv) > 2 else "preview/idle.gif"
    seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0

    expr = EXPRESSIONS[expr_id]
    n = int(FPS * seconds)
    dt = 1000.0 / FPS
    idle = IdleBehavior(0.0)

    frames = []
    for i in range(n):
        mods = idle.update(i * dt)
        img = render(state_with_idle(expr, mods), 320, 200, supersample=2)
        frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))

    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=int(dt), loop=0, optimize=True)
    print(f"wrote {out}  ({n} frames @ {FPS}fps, {expr_id})")


if __name__ == "__main__":
    main()
