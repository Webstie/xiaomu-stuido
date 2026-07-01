"""Diagnose the FaceController on the LCD: cycle expressions, report frames + errors."""
import time
from face.display import LcdDisplay
from face.controller import FaceController

fc = FaceController(LcdDisplay(), supersample=2)
fc.start()
print("12s expression cycle — WATCH THE LCD", flush=True)
for e in ["happy", "excited", "sad", "surprised", "playful", "curious", "calm"]:
    fc.set_expression(e)
    print(f"  -> {e}  (frames so far: {fc.frames})", flush=True)
    time.sleep(1.6)
time.sleep(0.5)
print("TOTAL frames:", fc.frames, flush=True)
print("last_error:", fc.last_error, flush=True)
fc.stop()
