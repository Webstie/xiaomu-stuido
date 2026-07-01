"""On-robot test of S6 activity playback (no buttons). LISTEN — a real activity
should start, play audio + narration, and advance sections. Run in xgo venv."""
import time

from face.display import LcdDisplay
from hw.buttons import KeyboardButtons
from main import Runtime

rt = Runtime(LcdDisplay(), KeyboardButtons())
rt.load_config()
rt.face.start()
time.sleep(0.3)
rt.state = "CONVO"
rt.step = "none"

print("== request a body-rhythm activity ==", flush=True)
rt.run_turn("我想做身体节奏练习")  # → start_activity → background activity thread

for i in range(9):
    time.sleep(5)
    print(f"  t={(i+1)*5}s state={rt.state} act={rt.active_activity} "
          f"section={rt.section_index} playing={rt.player.is_playing()}", flush=True)

print("== stop activity (simulate key1) ==", flush=True)
rt.stop_activity()
time.sleep(1)
print("final state:", rt.state, "active:", rt.active_activity, flush=True)
rt.face.stop()
print("DONE", flush=True)
