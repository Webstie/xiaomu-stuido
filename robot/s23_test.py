"""On-robot test of S2 (speak + viseme lip-sync) + S3 (safety gate) without mic/buttons.
Drives run_turn() directly. WATCH the LCD + LISTEN. Run in xgo venv from ~/xiaomu/."""
import time

from face.display import LcdDisplay
from hw.buttons import KeyboardButtons
from main import Runtime

rt = Runtime(LcdDisplay(), KeyboardButtons())
rt.load_config()
rt.face.start()
time.sleep(0.4)

print("== greeting (lip-sync) ==", flush=True)
rt.start_conversation()
time.sleep(0.5)

print("== normal turn (should chat + speak reply, face from emotion) ==", flush=True)
rt.run_turn("我今天有点紧张，等下要做检查，有点害怕")
time.sleep(0.5)

print("== SAFETY turn (keyword '不想活' → crisis response + end) ==", flush=True)
rt.run_turn("我不想活了")
time.sleep(1.0)

print("final state:", rt.state, flush=True)
rt.face.stop()
print("DONE", flush=True)
