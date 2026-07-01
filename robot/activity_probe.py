"""Probe the server's body-rhythm activity flow: start + advance via 继续,
printing each section's text + audioPlaylist + tool. Pure HTTP (no LCD/audio)."""
import net.brain as brain

msgs = []


def chat(text, ctx=None):
    msgs.append({"role": "user", "content": text})
    reply, tool = "", None
    for ev in brain.chat_stream(msgs, 8, activity_context=ctx):
        k = type(ev).__name__
        if k == "TextDelta":
            reply += ev.delta
        elif k == "ToolCall":
            tool = ev
    if reply.strip():
        msgs.append({"role": "assistant", "content": reply})
    return reply, tool


print("== START body-rhythm ==", flush=True)
r, t = chat("我想做身体节奏练习")
print("reply:", r[:70].replace("\n", " "), flush=True)
if t:
    res = t.result
    print(f"  tool={t.name} section {res.get('sectionNumber')}/{res.get('totalSections')} "
          f"audio={res.get('audioPlaylist')} interactive={res.get('interactive')}", flush=True)
    aid, atype = res.get("activityId"), res.get("activityType")
else:
    print("  NO start_activity tool!", flush=True)
    aid = atype = None

for i in range(1, 7):
    ctx = {"activityId": aid, "type": atype, "sectionIndex": i, "therapyMode": True}
    r, t = chat("继续", ctx)
    line = f"继续 #{i}: tool={t.name if t else None}"
    if t and t.result:
        res = t.result
        line += f" section {res.get('sectionNumber')}/{res.get('totalSections')} audio={res.get('audioPlaylist')}"
    line += f" | reply={r[:45]!r}"
    print(line, flush=True)
    if t and t.name == "end_activity":
        print("  -> end_activity, stopping", flush=True)
        break
print("DONE", flush=True)
