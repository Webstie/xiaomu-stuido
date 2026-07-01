import time
print("start", flush=True)
from face.display import LcdDisplay
print("display imported", flush=True)
d = LcdDisplay()
print("lcd ok", flush=True)
import net.brain as brain
print("health", brain.health(), flush=True)
c = brain.get_config()
print("config", c.get("identity", {}).get("robotName"), flush=True)
from hw.buttons import KeyboardButtons
from main import Runtime
rt = Runtime(d, KeyboardButtons())
print("runtime built", flush=True)
rt.face.start()
time.sleep(0.5)
print("face started", flush=True)
rt.state = "CONVO"
rt.step = "none"
print("calling _stream_chat (this calls /api/chat)...", flush=True)
reply, tl, tool = rt._stream_chat("我想做身体节奏练习")
print("stream done. tool:", tool.name if tool else None, "| reply:", reply[:50].replace("\n", " "), flush=True)
if tool:
    res = tool.result or {}
    print("result keys:", list(res.keys()), "| playlist:", res.get("audioPlaylist"), flush=True)
print("DONE", flush=True)
