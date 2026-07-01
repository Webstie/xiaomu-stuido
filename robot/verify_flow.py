"""Verify the activity fix: trigger body-rhythm and confirm it advances sections
AND plays the backdrop concurrently. FileDisplay (no LCD conflict with the live svc)."""
import time

from face.display import FileDisplay
from hw.buttons import KeyboardButtons
from main import Runtime

rt = Runtime(FileDisplay(), KeyboardButtons())
rt.load_config()
rt.face.start()
time.sleep(0.3)
rt.state = "CONVO"
rt.step = "none"

print("== trigger body-rhythm ==", flush=True)
rt.run_turn("我想做身体节奏练习")  # → start_activity → backdrop + _activity_loop thread

for i in range(20):
    time.sleep(5)
    print(f"  t={5*(i+1)}s state={rt.state} section_index={rt.section_index} "
          f"bg_playing={rt.bg_player.is_playing()} tts_playing={rt.player.is_playing()}", flush=True)
    if rt.section_index >= 3:
        print("  -> advanced past section 2, fix CONFIRMED", flush=True)
        break

print("== stop ==", flush=True)
rt.stop_activity()
time.sleep(0.5)
rt.face.stop()
print("DONE", flush=True)
