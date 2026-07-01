"""End-to-end smoke test of the robot capability layer (run ON THE PI in xgo venv).

Verifies: face on LCD + expression tween, TTS playback through the speaker,
and a streaming chat round (text + expression timeline) — the heart of the
web experience, on the robot. Stop the demo first to free the LCD.
"""
import sys
import time

from face.display import LcdDisplay
from face.controller import FaceController
import net.brain as brain
import hw.audio as audio


def speak(fc: FaceController, text: str, timeline=None) -> None:
    data = brain.tts(text)
    player = audio.play_bytes(data, ".mp3")
    fc.set_speaking(True)
    if timeline:
        fc.apply_timeline(timeline, total_ms=max(2000, len(text) * 230), char_total=len(text))
    while player.is_playing():
        time.sleep(0.05)
    fc.set_speaking(False)
    fc.clear_timeline()


def main() -> None:
    print("brain health:", brain.health(), flush=True)
    fc = FaceController(LcdDisplay(), supersample=2, default_expression="calm")
    fc.start()
    time.sleep(0.4)

    print("== TTS greeting (listen for the speaker) ==", flush=True)
    fc.set_expression("happy")
    speak(fc, "你好，我是小沐，今天我们一起玩，好不好？")
    fc.set_expression("calm")
    time.sleep(0.4)

    print("== chat round ==", flush=True)
    text, timeline = "", []
    for ev in brain.chat_stream([{"role": "user", "content": "你好呀，你是谁？"}], child_age=7):
        kind = type(ev).__name__
        if kind == "TextDelta":
            text += ev.delta
        elif kind == "ExpressionTimeline":
            timeline = ev.events
        elif kind == "ToolCall":
            print("  tool_call:", ev.name, "->", {k: ev.result.get(k) for k in ("activityId", "currentSectionText", "audioPlaylist")}, flush=True)
        elif kind == "Done":
            pass
    print("  reply:", text, flush=True)
    print("  timeline:", timeline, flush=True)
    if text:
        speak(fc, text, timeline)

    fc.set_expression("calm")
    time.sleep(2)
    fc.stop()
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
