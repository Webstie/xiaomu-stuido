import net.brain as brain
msgs = []


def turn(text, ctx=None):
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


r, t = turn("我想做身体节奏练习")
res = (t.result or {}) if t else {}
print("START len=%d tool=%s sec=%s/%s" % (len(r), t.name if t else None,
                                          res.get("sectionNumber"), res.get("totalSections")), flush=True)
print("  START full:", repr(r[:200]), flush=True)
for i in (1, 2, 3):
    r, t = turn("继续", {"activityId": "body-rhythm", "type": "body-rhythm",
                         "sectionIndex": i, "therapyMode": True})
    print("继续 idx=%d len=%d tool=%s reply=%r" % (i, len(r), t.name if t else None, r[:90]), flush=True)
print("DONE", flush=True)
