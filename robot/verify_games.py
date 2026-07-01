"""Verify the warmup games + emotion-mapping + co-creation TRIGGER correctly on the
runtime (logic check; stops each early). FileDisplay (no LCD conflict)."""
import time

from face.display import FileDisplay
from hw.buttons import KeyboardButtons
from main import Runtime

rt = Runtime(FileDisplay(), KeyboardButtons())
rt.load_config()
rt.face.start()
time.sleep(0.3)

print("== WARMUP GAME (returning path) ==", flush=True)
rt.state = "CONVO"
rt.step = "returning-intro-answer"
rt._warmup_entry("今天挺无聊的", False)
print(f"  after warmup_entry: step={rt.step}  game2_sound={(rt.game2_sound or {}).get('label')}", flush=True)
# answer the game (works for either rhythm-story 'game-1-completion' or sound 'game-2-answer')
if rt.step == "game-2-answer":
    rt._step_game2_answer("是小鸡", False)
elif rt.step == "game-1-completion":
    rt._step_game1_completion("我拍完啦", False)
print(f"  after answer: step={rt.step} (expect weather-game-choice)", flush=True)

print("== EMOTION-MAPPING trigger ==", flush=True)
rt.state = "CONVO"; rt.step = "none"; rt.messages = []
_r, _t, tool = rt._stream_chat("我想做情绪音乐配对")
print(f"  tool={tool.name if tool else None} type={(tool.result or {}).get('activityType') if tool else None} "
      f"audio={(tool.result or {}).get('audioPlaylist') if tool else None}", flush=True)
rt._activity_stop.set()  # don't actually run the 140s loop

print("== CO-CREATION trigger ==", flush=True)
rt.state = "CONVO"; rt.step = "none"; rt.messages = []
_r, _t, tool = rt._stream_chat("我想自己创作音乐")
print(f"  tool={tool.name if tool else None} type={(tool.result or {}).get('activityType') if tool else None} "
      f"interactive={(tool.result or {}).get('interactive') if tool else None}", flush=True)

rt.face.stop()
print("DONE", flush=True)
