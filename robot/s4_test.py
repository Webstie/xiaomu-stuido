"""On-robot test of S4 scripted intro FSM (no buttons). WATCH + LISTEN.
Drives run_turn through the intro: first-meeting -> age -> weather -> LLM,
plus the activity-intent bypass. Run in xgo venv from ~/xiaomu/."""
import time

from face.display import LcdDisplay
from hw.buttons import KeyboardButtons
from main import Runtime

rt = Runtime(LcdDisplay(), KeyboardButtons())
rt.load_config()
rt.face.start()
time.sleep(0.3)

print("== start_conversation -> first-meeting ==", flush=True)
rt.start_conversation()
print("step:", rt.step, flush=True)

print("== reply 'yes, first time' -> should tell origin story, step=age ==", flush=True)
rt.run_turn("对呀，第一次见面")
print("step:", rt.step, flush=True)

print("== reply '六岁' -> store age, speak weather prompt, step=none ==", flush=True)
rt.run_turn("我六岁啦")
print("step:", rt.step, "age:", rt.child_age, flush=True)

print("== free-chat weather answer (LLM) ==", flush=True)
rt.run_turn("我觉得像晴天，今天挺开心的")
print("step:", rt.step, flush=True)

time.sleep(0.4)
print("== activity-intent bypass: restart + '我想做呼吸练习' ==", flush=True)
rt.start_conversation()      # back to first-meeting
rt.run_turn("我想做呼吸练习")  # should bypass -> LLM, step=none
print("step after bypass:", rt.step, flush=True)

rt.face.stop()
print("DONE", flush=True)
