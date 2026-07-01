# Xiaomu Robot Runtime (Rider-Pi embodiment)

The Python layer that runs on the **Yahboom Rider-Pi** (Raspberry Pi CM5) and
turns a published `StudioBundle` into the child-facing experience: the face on
the 2-inch LCD, the 4 buttons, audio, and (later) camera emotion detection.

It is the **embodiment**, not the brain. The brain (chat / TTS / voice-live /
safety / activity logic) is the existing TS server in `apps/server`, reused on
the Pi; this layer does hardware I/O and talks to it over localhost. See the
project memory `robot-runtime-plan` for the agreed architecture.

## Layout
```
robot/
├── face/
│   ├── expressions.py   16 expression poses (port of studio expressions.ts)
│   ├── renderer.py      PIL renderer of the Cozmo/EMO face → LCD-ready image
│   ├── idle.py          daydream idle (blink / breath / eye-drift)
│   └── display.py       LcdDisplay (XGO 2-inch) | FileDisplay (dev)
├── hw/
│   └── buttons.py       GpioButtons (GPIO 24/23/17/22) | KeyboardButtons (dev)
├── bundle.py            load data/published/vN.json (StudioBundle)
├── run_face.py          live idle face loop (the autostart baseline)
├── lcd_show.py          quick LCD test: cycle / hold one expression
├── preview_face.py      dev: contact sheet of all 16 expressions
└── preview_idle.py      dev: animated GIF of the idle loop
```

## Hardware (recon)
- **CM5**, Debian 12, aarch64, 2 GB RAM. Screen: **XGO 2-inch LCD, 320×240**,
  driven via `xgoscreen.LCD_2inch` → `display.ShowImage(img)`.
- Buttons: GPIO BCM **24/23/17/22** = start-stop / talk / next / repeat.
- Mic: WM8960 sound card. Camera: libcamera + `/dev/video*`.
- The Yahboom demo (`~/RaspberryPi-CM5/main.py`) owns the LCD by default; our
  runtime replaces it as the autostart (R5). Balancing is firmware — untouched.

## Dev (any machine)
```bash
pip install -r requirements.txt
python preview_face.py            # → preview/expressions.png (all 16)
python preview_idle.py            # → preview/idle.gif (daydream)
python run_face.py calm --file    # writes preview/_live.png each frame
```

## On the Pi
```bash
# deploy: rsync face/ hw/ *.py to ~/xiaomu/ ; run inside the xgo venv
~/RaspberryPi-CM5/xgovenv/bin/python lcd_show.py        # cycle 16 on the LCD
~/RaspberryPi-CM5/xgovenv/bin/python run_face.py calm   # live idle face
```

## Status
- ✅ R2 face renderer + idle + display/buttons/bundle skeleton. Renderer verified
  rendering headless **on the Pi** (numpy 1.24 / Pillow 11).
- ⏳ Live face on the physical LCD — pending a Pi reboot (sshd was wedged).
- ⬜ R3 activity runtime, R4 Azure broker + emotion, R5 deploy + autostart.
