"""Verify Bug A: with the scripted intro now in the chat history, does the LLM
acknowledge the weather + offer the activity menu (vs a generic '你想做什么')?"""
import net.brain as brain

cfg = brain.get_config()
flow = cfg.get("conversationFlow", {})
msgs = [
    {"role": "assistant", "content": flow.get("firstMeetingQuestion", "我们是第一次见面吗？")},
    {"role": "user", "content": "是的"},
    {"role": "assistant", "content": flow.get("startChattingIntro", "你好呀，你几岁啦？")},
    {"role": "user", "content": "我八岁了"},
    {"role": "assistant", "content": flow.get("weatherPrompt", "你今天心情像什么天气？")},
    {"role": "user", "content": "我觉得像晴天，今天挺开心的"},
]
reply = ""
for ev in brain.chat_stream(msgs, 8):
    if type(ev).__name__ == "TextDelta":
        reply += ev.delta
print("REPLY:", reply, flush=True)
acts = [w for w in ["呼吸", "身体", "节奏", "情绪", "音乐", "魔法", "猜", "游戏"] if w in reply]
print("mentions activities:", acts or "NONE — still generic", flush=True)
print("DONE", flush=True)
