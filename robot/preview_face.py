"""Render all 16 expressions to a contact sheet (dev tool, runs on any machine).

Usage:  python preview_face.py [out.png]
Run from the robot/ directory so `face` is importable.
"""
import sys

from PIL import Image, ImageDraw

from face.expressions import EXPRESSIONS
from face.renderer import render_expression

CELL_W, CELL_H = 320, 200
LABEL_H = 26
PAD = 14
COLS = 4
BG = (12, 10, 16)


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "preview_expressions.png"
    items = list(EXPRESSIONS.values())
    rows = (len(items) + COLS - 1) // COLS

    sheet_w = COLS * CELL_W + (COLS + 1) * PAD
    sheet_h = rows * (CELL_H + LABEL_H) + (rows + 1) * PAD
    sheet = Image.new("RGB", (sheet_w, sheet_h), BG)
    draw = ImageDraw.Draw(sheet)

    for i, expr in enumerate(items):
        r, c = divmod(i, COLS)
        x = PAD + c * (CELL_W + PAD)
        y = PAD + r * (CELL_H + LABEL_H + PAD)
        face = render_expression(expr, CELL_W, CELL_H, supersample=3)
        sheet.paste(face, (x, y))
        draw.text((x + 6, y + CELL_H + 6), f"{expr.id}  {expr.color}", fill=(200, 200, 210))

    sheet.save(out)
    print(f"wrote {out}  ({sheet_w}x{sheet_h}, {len(items)} expressions)")


if __name__ == "__main__":
    main()
