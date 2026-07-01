#!/usr/bin/env python3
"""Show the robot face on the Rider-Pi's XGO 2-inch LCD (320x240 landscape).

Run ON THE PI inside the xgo venv, from the dir containing the `face/` package:
    ~/RaspberryPi-CM5/xgovenv/bin/python lcd_show.py            # cycle 16 once
    ~/RaspberryPi-CM5/xgovenv/bin/python lcd_show.py calm       # hold one
    ...                                  lcd_show.py happy --save out.png  # NO LCD

--save renders to a PNG and never imports xgoscreen, so it's safe to run while
the demo UI still owns the screen (used to verify rendering before takeover).
"""
import sys
import time

from PIL import Image

from face.expressions import EXPRESSIONS, EXPRESSION_IDS
from face.renderer import render_expression

LCD_W, LCD_H = 320, 240
FACE_Y = 20  # center the 320x200 design face vertically on the 320x240 panel
PANEL_BG = (0x1A, 0x14, 0x20)


def compose(expr_id: str, supersample: int = 2) -> Image.Image:
    face = render_expression(EXPRESSIONS[expr_id], 320, 200, supersample=supersample)
    canvas = Image.new("RGB", (LCD_W, LCD_H), PANEL_BG)
    canvas.paste(face, (0, FACE_Y))
    return canvas


def main() -> None:
    args = list(sys.argv[1:])
    save = None
    if "--save" in args:
        i = args.index("--save")
        save = args[i + 1]
        del args[i:i + 2]

    if save:
        compose(args[0] if args else "happy").save(save)
        print("saved", save)
        return

    import xgoscreen.LCD_2inch as LCD_2inch
    display = LCD_2inch.LCD_2inch()
    display.clear()

    ids = args if args else EXPRESSION_IDS
    for k in ids:
        display.ShowImage(compose(k))
        print("showing", k, flush=True)
        time.sleep(0.8)
    # last frame stays on the LCD after exit


if __name__ == "__main__":
    main()
