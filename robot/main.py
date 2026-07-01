"""Xiaomu robot runtime — the on-device session loop (R3).

A background face-render thread (FaceController) + a button-poll main loop + a
session FSM. Built incrementally per robot/HANDOFF.md:
  S1 (this file): key1 starts/stops a LOCAL breathing exercise (prerecorded audio
  from the brain's /api/audio/file + a calm/gentle breathing face). No Azure.
  S2+ will add push-to-talk, the scripted intro, games, and the LLM activity FSM.

Run ON THE PI in the xgo venv, from ~/xiaomu/ (stop the Yahboom demo first):
  sudo systemctl stop xgo_script.service; sudo pkill -f "[m]ain.py"
  ~/RaspberryPi-CM5/xgovenv/bin/python main.py            # real buttons
  ~/RaspberryPi-CM5/xgovenv/bin/python main.py --demo     # auto-run breathing once
"""
import os
import random
import re
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import quote

import net.brain as brain
import debug_server as dbg
from face.display import set_volume_overlay
from hw.audio import Player, get_output_volume, play_bytes, record_wav, read_wav, set_output_volume

BRAIN_URL = os.environ.get("XIAOMU_BRAIN_URL", "http://127.0.0.1:8787")
DEFAULT_AGE = int(os.environ.get("XIAOMU_DEFAULT_AGE", "6"))
DEFAULT_VOLUME = int(os.environ.get("XIAOMU_DEFAULT_VOLUME", "60"))
AUDIO_DIR = os.environ.get("XIAOMU_AUDIO_DIR", os.path.expanduser("~/xiaomu-studio/data/audio"))
YAHBOOM_DIR = os.environ.get("XIAOMU_YAHBOOM_DIR", "/home/pi/RaspberryPi-CM5")
YAHBOOM_PYTHON = os.environ.get(
    "XIAOMU_YAHBOOM_PYTHON",
    "/home/pi/RaspberryPi-CM5/xgovenv/bin/python",
)

# Fixed crisis-redirect spoken when the safety gate trips (high_risk OR keyword),
# verbatim from apps/studio/src/panels/TestChat.tsx HIGH_RISK_RESPONSE.
HIGH_RISK_RESPONSE = (
    "如果你有时候心里特别难受,或者想伤害自己,请一定记住:这不是你的错。"
    "你可以马上跑到爸爸妈妈、老师,或者任何一个你信任的大人身边,拉住他们的手,"
    '说:"我需要帮助。"他们会抱住你,听你说话。\n\n'
    "你也可以随时打电话:\n\n"
    "12355——青少年心理咨询热线,专门帮助小朋友和大孩子\n"
    "400-161-9995——希望24热线,24小时危机干预热线"
)

# Azure risk-assess emotion → face expression (mirrors TestChat).
EMOTION_TO_EXPR = {
    "happy": "happy", "excited": "excited", "calm": "calm", "curious": "curious",
    "confused": "confused", "sad": "sad",
    "anxious": "anxious", "scared": "anxious", "angry": "anxious",
}

# Audio mixing: keep the music channel UNDER the TTS voice (0-100).
BG_VOLUME = 45    # body-rhythm / breathing shared backdrop
EMO_VOLUME = 70   # emotion-mapping 1:1 tracks + co-creation melodies
# Spoken locally after the 7th emotion section (verbatim from TestChat.tsx).
EMOTION_MAPPING_CLOSING = "七种心情都听完啦！你想歇一歇，还是换一个小游戏呢？"
NOTE_BY_NUMBER = {
    "1": "Do", "2": "Re", "3": "Mi", "4": "Fa", "5": "Sol", "6": "La", "7": "Ti",
    "一": "Do", "二": "Re", "两": "Re", "三": "Mi", "四": "Fa", "五": "Sol", "六": "La", "七": "Ti",
}
NOTE_NAMES = {"do": "Do", "re": "Re", "mi": "Mi", "fa": "Fa", "sol": "Sol", "la": "La", "ti": "Ti"}


def audio_source(filename: str) -> str:
    """Local file path if present (reliable on-device), else the brain's HTTP URL."""
    local = os.path.join(AUDIO_DIR, filename)
    return local if os.path.exists(local) else f"{BRAIN_URL}/api/audio/file/{quote(filename)}"


def parse_three_notes(text: str) -> list[str] | None:
    """Parse the child's co-creation note pick. Return exactly three notes or None."""
    notes: list[str] = []
    for ch in text:
        if ch in NOTE_BY_NUMBER:
            notes.append(NOTE_BY_NUMBER[ch])
    for match in re.finditer(r"\b(do|re|mi|fa|sol|la|ti)\b", text.lower()):
        notes.append(NOTE_NAMES[match.group(1)])
    if len(notes) != 3:
        return None
    return notes


# Age parsing — port of TestChat.parseAgeFromText (ASCII wins; else Chinese numerals).
_CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "俩": 2, "三": 3, "四": 4,
              "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_CN_UNITS = {"十": 10, "百": 100}


def parse_age(text: str):
    m = re.search(r"\d+", text)
    if m:
        try:
            return int(m.group())
        except ValueError:
            return None
    section = current = 0
    saw = False
    for ch in text:
        if ch in _CN_DIGITS:
            current = _CN_DIGITS[ch]
            saw = True
        elif ch in _CN_UNITS:
            section += (1 if current == 0 else current) * _CN_UNITS[ch]
            current = 0
            saw = True
    return (section + current) if saw else None


def classify_first_meeting_answer(text: str):
    """Deterministic guard for the opening question.

    The model yes/no classifier can treat "这不是我们第一次见面" as ambiguous.
    For the first-meeting gate, these common Chinese phrases are unambiguous
    and should not depend on a cloud classifier.
    """
    compact = re.sub(r"\s+", "", text).lower()
    if not compact:
        return None
    if "没见过" in compact or "没有见过" in compact or "不认识" in compact:
        return "yes"
    negative = (
        bool(re.search(r"不是.*第[一1]次", compact))
        or "不是第一次" in compact
        or "不是第1次" in compact
        or "以前见过" in compact
        or "之前见过" in compact
        or "上次见过" in compact
        or "见过你" in compact
        or "认识你" in compact
        or "老朋友" in compact
    )
    if negative:
        return "no"
    positive = (
        "是第一次" in compact
        or "第1次" in compact
        or "第一次" in compact
        or "新朋友" in compact
    )
    if positive:
        return "yes"
    return None


class Runtime:
    def __init__(self, display, buttons, supersample: int = 2) -> None:
        from face.controller import FaceController
        self.display = display
        self.face = FaceController(display, supersample=supersample, default_expression="calm")
        self.buttons = buttons
        self.player = Player()        # Channel A: TTS voice + sound-fx (sequential)
        self.bg_player = Player()     # Channel B: background music, concurrent with TTS
        self.config: dict = {}
        self.voice = None       # config.voice.defaultVoice (the studio's chosen TTS voice)
        self.child_age = DEFAULT_AGE
        self.state = "IDLE"
        self.step = "none"      # scripted intro step (none = LLM free chat)
        self.messages: list = []
        self.active_activity = None   # {id, type} while an activity runs (S6)
        self.atype = None
        self.total_sections = None
        self.section_index = 0
        self.cc_last_variant = "none"  # co-creation stage tracking
        self.cc_notes = None
        self.game2_sound = None        # sound-detective: the chosen sound for this round
        self._activity_thread = None
        self._activity_stop = threading.Event()
        self.ui_mode = "normal"
        self.volume_level = set_output_volume(DEFAULT_VOLUME)
        self._pending_network_click_at = 0.0

    def load_config(self) -> None:
        # Wait for the brain's HTTP at boot (it starts alongside us; tsx/Fastify
        # needs >6s to listen). Retry rather than boot with an empty config.
        for attempt in range(45):
            try:
                self.config = brain.get_config()
                self.voice = (self.config.get("voice") or {}).get("defaultVoice")
                print("config loaded:", self.config.get("identity", {}).get("robotName"),
                      "| voice:", self.voice, flush=True)
                return
            except Exception:
                if attempt == 0:
                    print("waiting for brain to come up...", flush=True)
                time.sleep(1)
        print("config load failed after 45s, using empty config", flush=True)
        self.config = {}

    # ── breathing exercise (S1) ──────────────────────────────────────────────
    def _breathing(self):
        acts = self.config.get("activities", [])
        br = next((a for a in acts if a.get("type") == "breathing"), None)
        if not br:
            return None, None
        buckets = (br.get("scripted") or {}).get("ageBuckets", [])
        bucket = next((b for b in buckets if b["minAge"] <= self.child_age <= b["maxAge"]), None)
        if bucket is None and buckets:
            bucket = buckets[0]
        return br, bucket

    def start_breathing(self) -> None:
        br, bucket = self._breathing()
        if not bucket or not bucket.get("audioFilenames"):
            print("no breathing audio for age", self.child_age, flush=True)
            return
        self.state = "BREATHING"
        self._activity_stop.clear()
        self._activity_thread = threading.Thread(
            target=self._run_breathing, args=(br, bucket), daemon=True)
        self._activity_thread.start()
        print("breathing started:", bucket["audioFilenames"], flush=True)

    def _run_breathing(self, br, bucket) -> None:
        self.face.set_expression(br.get("defaultExpression", "calm"))
        phase = 0
        for fn in bucket["audioFilenames"]:
            if self._activity_stop.is_set():
                break
            src = audio_source(fn)
            self.player.play(src)
            time.sleep(0.4)  # let mplayer spin up before polling is_playing
            print(f"playing {fn} via {'LOCAL' if src.startswith('/') else 'HTTP'}; "
                  f"is_playing={self.player.is_playing()}", flush=True)
            t0 = time.monotonic()
            while self.player.is_playing():
                if self._activity_stop.is_set():
                    break
                # gentle calm<->gentle breathing pulse (~6s each)
                self.face.set_expression("gentle" if phase % 2 else "calm")
                phase += 1
                print(f"  breathing... t={int(time.monotonic() - t0)}s", flush=True)
                for _ in range(120):  # ~6s, but bail fast on stop/end
                    if self._activity_stop.is_set() or not self.player.is_playing():
                        break
                    time.sleep(0.05)
        self.player.stop()
        self.face.set_expression("calm")
        self.state = "IDLE"
        print("breathing ended", flush=True)

    def stop_activity(self) -> None:
        prev = self.state
        self._activity_stop.set()
        self.player.stop()
        self.bg_player.stop()
        if self._activity_thread:
            self._activity_thread.join(timeout=3)
        self.active_activity = None
        self.section_index = 0
        if prev == "ACTIVITY":
            self.state = "CONVO"
            self.face.set_expression("listening")
        else:
            self.state = "IDLE"
            self.face.set_expression("calm")

    # ── speech out (TTS + viseme lip-sync) ───────────────────────────────────
    def speak(self, text: str, expression_timeline=None) -> None:
        if not text.strip():
            return
        dbg.emit("robot", text=text)
        audio, visemes = b"", []
        for attempt in range(3):
            try:
                audio, visemes = brain.tts_visemes(text, voice=self.voice)
                break
            except Exception as e:
                if attempt == 2:
                    print("tts failed:", e, flush=True)
                    return
                print("tts retry:", e, flush=True)
                time.sleep(0.8)
        if not audio:
            return
        self.player = play_bytes(audio, ".mp3", self.player)
        self.face.speak_visemes(visemes)
        if expression_timeline:
            self.face.apply_timeline(expression_timeline,
                                     total_ms=max(2000, len(text) * 230), char_total=len(text))
        while self.player.is_playing():
            time.sleep(0.05)
        self.face.stop_speaking()
        self.face.clear_timeline()

    def _say(self, text: str, expression_timeline=None) -> None:
        """Speak AND record as an assistant turn, so when the LLM takes over after the
        scripted intro it has the full conversation (otherwise it greets with no context
        and skips the warm weather ack + the activity menu)."""
        self.speak(text, expression_timeline)
        if text.strip():
            self.messages.append({"role": "assistant", "content": text})

    # ── safety gate (S3) ─────────────────────────────────────────────────────
    def _keyword_blocked(self, text: str) -> bool:
        kws = (self.config.get("safety") or {}).get("distressKeywords", [])
        low = text.lower()
        for kw in kws:
            k = kw.strip().lower()
            if len(k) < 2:
                continue
            if k in low:
                return True
            if len(low) >= 2 and low in k:
                return True
        return False

    def _cf(self, key: str, default: str = "") -> str:
        return (self.config.get("conversationFlow") or {}).get(key) or default

    def _safety_check(self, text: str):
        """Returns 'block' | 'concerning' | None; drives face from emotion on safe turns."""
        blocked = concerning = False
        last_robot = next((m["content"] for m in reversed(self.messages) if m["role"] == "assistant"), None)
        try:
            r = brain.risk(text, context=(last_robot[-300:] if last_robot else None))
            level = r.get("risk_level", "safe")
            if level == "high_risk":
                blocked = True
            elif level == "concerning":
                concerning = True
            if not blocked:
                expr = EMOTION_TO_EXPR.get(r.get("emotion", ""))
                if expr:
                    self.face.set_expression(expr)
        except Exception:
            pass  # classifier hiccup must not block; keyword net still runs
        if not blocked and self._keyword_blocked(text):
            blocked = True
        return "block" if blocked else ("concerning" if concerning else None)

    def _crisis_end(self, text: str) -> None:
        print("SAFETY BLOCK on:", repr(text), flush=True)
        dbg.emit("safety", text=f"⚠ distress 触发 → 危机话术 + 结束会话  «{text}»")
        self.player.stop()
        self.face.set_expression("anxious")
        self.speak(HIGH_RISK_RESPONSE)
        self.face.set_expression("calm")
        self.step = "none"
        self.state = "IDLE"
        print("[caregiver] distress detected — flow bypassed, session ended", flush=True)

    def _stream_chat(self, text: str, concerning: bool = False, activity_context=None):
        """One /api/chat round → (reply_text, expression_timeline, tool_call|None)."""
        self.messages.append({"role": "user", "content": text})
        reply, timeline, tool = "", [], None
        try:
            for ev in brain.chat_stream(self.messages, self.child_age,
                                        activity_context=activity_context, concerning=concerning):
                kind = type(ev).__name__
                if kind == "TextDelta":
                    reply += ev.delta
                elif kind == "ExpressionTimeline":
                    timeline = ev.events
                elif kind == "ToolCall":
                    tool = ev
        except Exception as e:
            print("chat failed:", e, flush=True)
            dbg.emit("debug", msg=f"chat ERROR: {e}")
            return "", [], None
        actx = f" actx.sectionIndex={activity_context.get('sectionIndex')}" if activity_context else ""
        dbg.emit("debug", msg=f"/api/chat «{text[:18]}»{actx} → reply_len={len(reply)} "
                              f"tool={tool.name if tool else None}")
        if reply.strip():
            self.messages.append({"role": "assistant", "content": reply})
        return reply, timeline, tool

    def _chat_and_handle(self, text: str, concerning: bool = False) -> None:
        reply, timeline, tool = self._stream_chat(text, concerning)
        print("reply:", reply[:80].replace("\n", " "), "| tool:", tool.name if tool else None, flush=True)
        if tool is not None and tool.name == "start_activity":
            self._start_activity(reply, timeline, tool)
        else:
            if reply.strip():
                self.speak(reply, expression_timeline=timeline)
            if self.state == "CONVO":
                self.face.set_expression("listening")

    # ── activity sub-FSM (S6): play audio + advance sections via silent "继续" ──
    def _sleep_interruptible(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while time.monotonic() < end and not self._activity_stop.is_set():
            time.sleep(0.05)

    def _start_activity(self, section_text, timeline, tool) -> None:
        res = tool.result or {}
        aid = res.get("activityId")
        self.atype = res.get("activityType")
        self.active_activity = {"id": aid, "type": self.atype}
        self.total_sections = res.get("totalSections")
        interactive = bool(res.get("interactive"))
        # turn 1 spoke section 1 → the NEXT request asks for sectionIndex 1 (section 2)
        self.section_index = 0 if interactive else 1
        self.state = "ACTIVITY"
        self._activity_stop.clear()
        act = next((a for a in self.config.get("activities", []) if a.get("id") == aid), None)
        if act and act.get("defaultExpression"):
            self.face.set_expression(act["defaultExpression"])
        print(f"activity started: {aid} ({self.atype}) sections={self.total_sections}", flush=True)
        dbg.emit("activity", msg=f"开始 {aid} ({self.atype}) · {self.total_sections} 段")
        dbg.set_state(state="ACTIVITY", activity=self.active_activity)

        if self.atype == "emotion-music-mapping":
            target = self._emotion_mapping_loop
        elif self.atype == "co-creation":
            self._start_co_creation(section_text, timeline)
            return
        else:
            # body-rhythm / breathing: shared backdrop loops UNDER the TTS on bg_player
            playlist = res.get("audioPlaylist") or []
            if playlist:
                self.bg_player.play(audio_source(playlist[0]), loop=True, volume=BG_VOLUME)
            target = self._activity_loop
        self._activity_thread = threading.Thread(
            target=target, args=(section_text, timeline, res), daemon=True)
        self._activity_thread.start()

    def _resolve_sections(self, activity_id: str) -> list:
        """Split a scripted activity's age-bucket narrationScript into sections
        (mirrors the server's activityResolver — blank-line separated)."""
        act = next((a for a in self.config.get("activities", []) if a.get("id") == activity_id), None)
        sc = (act or {}).get("scripted") or {}
        buckets = sc.get("ageBuckets") or []
        bucket = next((b for b in buckets if b["minAge"] <= self.child_age <= b["maxAge"]), None)
        if bucket is None and buckets:
            bucket = buckets[0]
        ns = (bucket or {}).get("narrationScript", "")
        return [s.strip() for s in re.split(r"\n\s*\n", ns) if s.strip()]

    def _activity_loop(self, section_text, timeline, res) -> None:
        """Scripted body-rhythm/breathing: speak EVERY narration section straight from the
        config over the backdrop music, with a movement pause between sections. We do NOT
        rely on the LLM's silent-'继续' to re-emit sections (it returns empty for mid-sections),
        so this is deterministic and reproduces the full guided exercise."""
        aid = self.active_activity["id"]
        sections = self._resolve_sections(aid)
        if not sections:                       # config has no script → fall back to the LLM's text
            if section_text and section_text.strip():
                self.speak(section_text, expression_timeline=timeline)
            self._end_activity()
            return
        for i, sec in enumerate(sections):
            if self._activity_stop.is_set():
                break
            if i > 0:
                self._sleep_interruptible(3.0)  # pause so the child can do the movement
            if self._activity_stop.is_set():
                break
            self.speak(sec)                     # spoken over the looping backdrop
        self._end_activity()

    def _emotion_mapping_loop(self, section_text, timeline, res) -> None:
        """7 emotion sections: speak the narration over that emotion's 1:1 track for a fixed
        ~20s window, advance playlist + sectionIndex in lockstep; after the 7th, end LOCALLY
        and speak the fixed closing (no 继续, no model call)."""
        aid = "emotion-music-mapping"
        total = self.total_sections or 7
        playlist = res.get("audioPlaylist") or []
        idx = 0
        while not self._activity_stop.is_set():
            t0 = time.monotonic()
            if idx < len(playlist):
                self.bg_player.play(audio_source(playlist[idx]), loop=False, volume=EMO_VOLUME)
            if section_text and section_text.strip():
                self.speak(section_text, expression_timeline=timeline)
            self._sleep_interruptible(max(0.0, 20.0 - (time.monotonic() - t0)))  # ~20s window
            self.bg_player.stop()
            if self._activity_stop.is_set():
                break
            idx += 1
            self.section_index = idx
            if idx >= total:
                break
            section_text, timeline, _ = self._stream_chat(
                "继续", activity_context={"activityId": aid, "type": aid,
                                          "sectionIndex": idx, "therapyMode": True})
        if not self._activity_stop.is_set():
            self.speak(EMOTION_MAPPING_CLOSING)
        self._end_activity()

    # ── co-creation (interactive, play_melody-driven) ────────────────────────
    def _start_co_creation(self, section_text, timeline) -> None:
        self.cc_last_variant = "none"
        self.cc_notes = None
        if section_text and section_text.strip():
            self.speak(section_text, expression_timeline=timeline)
        self.face.set_expression("listening")  # wait for the child's note picks (handled in run_turn)

    def _co_creation_turn(self, text: str) -> None:
        if self.cc_last_variant == "none" and not self.cc_notes:
            notes = parse_three_notes(text)
            if notes is None:
                self.speak("嗯，我没有听清你选的三个音符。请再说一次，比如一、三、五，或者 Do、Mi、Sol。")
                self.face.set_expression("listening")
                return
            self.cc_notes = notes
            text = " ".join(notes)
        ctx = {"activityId": "co-creation", "type": "co-creation", "therapyMode": True,
               "coCreationLastVariant": self.cc_last_variant}
        if self.cc_notes:
            ctx["coCreationNotes"] = self.cc_notes
        reply, timeline, tool = self._stream_chat(text, activity_context=ctx)
        if reply.strip():
            self.speak(reply, expression_timeline=timeline)
        if tool is None:
            self.face.set_expression("listening")
            return
        if tool.name == "end_activity":
            self._end_activity()
            return
        if tool.name == "play_melody":
            r = tool.result or {}
            self.cc_last_variant = r.get("variant", self.cc_last_variant)
            if r.get("notes"):
                self.cc_notes = r.get("notes")
            fn = r.get("filename")
            plays = int(r.get("playCount") or 1)
            if fn:
                for _ in range(plays):
                    if self._activity_stop.is_set():
                        break
                    src = audio_source(fn)
                    dbg.emit("debug", msg=f"play_melody: {fn}")
                    self.bg_player.play(src, loop=False, volume=EMO_VOLUME)
                    while self.bg_player.is_playing() and not self._activity_stop.is_set():
                        time.sleep(0.1)
            # after background (variant) plays out → silent 继续 drives the closing
            if r.get("variant") == "background":
                self._co_creation_turn("继续")
            else:
                self.face.set_expression("listening")

    def _end_activity(self) -> None:
        self.active_activity = None
        self.section_index = 0
        self.total_sections = None
        self.player.stop()
        self.bg_player.stop()
        if self.state == "ACTIVITY":
            self.state = "CONVO"
            self.face.set_expression("listening")
        print("activity ended", flush=True)
        dbg.emit("activity", msg="活动结束")
        dbg.set_state(state=self.state, step=self.step, activity=None, age=self.child_age)

    # ── input dispatcher: safety → activity-intent bypass → scripted step (S4) ──
    def run_turn(self, text: str) -> None:
        text = text.strip()
        if not text:
            self.speak("嗯?我没太听清,可以再说一次吗?")
            return
        sc = self._safety_check(text)
        if sc == "block":
            self._crisis_end(text)
            return
        concerning = sc == "concerning"
        # Activity-intent bypass — a direct "我想做呼吸练习" jumps straight to the LLM,
        # never swallowed by the scripted yes/no classifier (project rule).
        if self.step != "none":
            try:
                if brain.classify(text, "activity-intent") == "yes":
                    print("activity-intent bypass -> LLM", flush=True)
                    self.step = "none"
                    self._chat_and_handle(text, concerning)
                    return
            except Exception:
                pass
        if self.step == "first-meeting":
            self._step_first_meeting(text)
        elif self.step == "age":
            self._step_age(text)
        elif self.step == "returning-age":
            self._step_returning_age(text)
        elif self.step == "returning-intro-answer":
            self._warmup_entry(text, concerning)          # → a warmup game (S5)
        elif self.step == "game-1-completion":
            self._step_game1_completion(text, concerning)
        elif self.step == "game-2-answer":
            self._step_game2_answer(text, concerning)
        elif self.step == "weather-game-choice":
            self._chat_and_handle(text, concerning)        # weather answer → LLM takes over
            self.step = "none"
        else:
            self._chat_and_handle(text, concerning)

    # ── warmup games (S5): returning-friend path, scripted (not LLM) ──────────
    def _rhythm_cfg(self):
        return next((g for g in self.config.get("games", []) if g.get("kind") == "rhythm-story"), None)

    def _sound_cfg(self):
        return next((g for g in self.config.get("games", []) if g.get("kind") == "sound-detective"), None)

    def _weather_after_game(self) -> None:
        """Hand a warmup game back into the flow via the weather prompt."""
        self._say(self._weather_prompt())
        self.step = "weather-game-choice"

    def _warmup_entry(self, text: str, concerning: bool) -> None:
        self.messages.append({"role": "user", "content": text})
        # mood-mirror the daily-story answer, then a coin-flip warmup game
        try:
            mood = brain.classify(text, "mood")
        except Exception:
            mood = "unclear"
        mirror = {
            "positive": "听起来你今天过得不错呀！",
            "negative": "嗯,听起来今天有点不容易,谢谢你告诉我。",
            "neutral": "嗯,平平淡淡也挺好的。",
        }.get(mood, "嗯,谢谢你跟我分享。")
        self._say(mirror)
        if random.random() < 0.5:
            self._launch_sound_detective()
        else:
            self._launch_rhythm_story()

    def _launch_rhythm_story(self) -> None:
        cfg = self._rhythm_cfg()
        prefix = (cfg or {}).get("prefix") or "我们先来玩一个小游戏。"
        stories = (cfg or {}).get("stories") or []
        if not stories:
            self._weather_after_game()
            return
        self._say(prefix + "\n\n" + random.choice(stories))
        self.step = "game-1-completion"

    def _step_game1_completion(self, text: str, concerning: bool) -> None:
        try:
            done = brain.classify(text, "task-completed")
        except Exception:
            done = "yes"
        if done == "no":
            self._chat_and_handle(text, concerning)  # not finished → let the model engage
            return
        self.messages.append({"role": "user", "content": text})
        cfg = self._rhythm_cfg()
        responses = (cfg or {}).get("completionResponses") or ["拍得真好！"]
        self._say(random.choice(responses))
        self._weather_after_game()

    def _launch_sound_detective(self) -> None:
        cfg = self._sound_cfg()
        sounds = (cfg or {}).get("sounds") or []
        if not sounds:
            self._launch_rhythm_story()
            return
        s = random.choice(sounds)
        self.game2_sound = s
        intro = (cfg or {}).get("intro") or "我们来玩声音侦探,听一听这是什么声音?"
        self._say(intro)                                    # 1. intro (blocks)
        fn = s.get("audioFilename") or ""
        if fn:
            self._play_sound_effect(fn)                     # 2. the sound clip (blocks)
        self._say(s.get("question") or "你猜这是什么声音呀?")  # 3. the question
        self.step = "game-2-answer"

    def _step_game2_answer(self, text: str, concerning: bool) -> None:
        self.messages.append({"role": "user", "content": text})
        s = self.game2_sound or {}
        try:
            verdict = brain.classify(text, "sound-match", context=s.get("label"))
        except Exception:
            verdict = "no"
        if verdict == "yes":
            self._say(s.get("correctResponse") or "答对啦,你的耳朵真灵！")
        else:
            self._say(s.get("wrongResponse") or "不是哦,不过你猜得很认真！")
        self.game2_sound = None
        self._weather_after_game()

    def _play_sound_effect(self, filename: str) -> None:
        """Play a short sound clip on the TTS channel (blocks until done)."""
        self.player.play(audio_source(filename))
        time.sleep(0.3)
        while self.player.is_playing():
            time.sleep(0.05)

    # ── scripted intro steps (S4) ────────────────────────────────────────────
    def _step_first_meeting(self, text: str) -> None:
        self.messages.append({"role": "user", "content": text})
        ans = classify_first_meeting_answer(text)
        if ans is None:
            try:
                ans = brain.classify(text, "yesno")
            except Exception:
                ans = "unclear"
        if ans == "yes":  # genuinely first meeting → tell the origin story (asks age)
            self._say(self._cf("startChattingIntro", "你好呀!你几岁啦?"))
            self.step = "age"
        elif ans == "no":  # returning friend
            self._say("原来我们是老朋友啊!\n\n" + self._cf("agePrompt", "你今年几岁呀?"))
            self.step = "returning-age"
        else:
            self.speak("嗯,我没太听明白。这是我们第一次见面吗?")

    def _step_age(self, text: str) -> None:
        self.messages.append({"role": "user", "content": text})
        age = parse_age(text)
        if age and 1 <= age <= 120:
            self.child_age = age
        # New-friend asymmetry (verified): after the weather prompt, the LLM takes over.
        self._say(self._weather_prompt())
        self.step = "none"

    def _step_returning_age(self, text: str) -> None:
        self.messages.append({"role": "user", "content": text})
        age = parse_age(text)
        if age and 1 <= age <= 120:
            self.child_age = age
        intros = (self.config.get("conversationFlow") or {}).get("returningSessionIntros") or []
        story = random.choice(intros) if intros else "我今天过得挺好的。你今天过得怎么样呢?"
        prefix = self._cf("oldFriendIntroPrefix", "")
        self._say((prefix + "\n\n" + story) if prefix else story)
        self.step = "returning-intro-answer"

    def _weather_prompt(self) -> str:
        # Young children (<=7): use the short prompt (drops the thunder/snow fear framing).
        if self.child_age <= 7:
            return self._cf("shortWeatherPrompt", self._cf("weatherPrompt", "你今天心情像什么天气呀?"))
        return self._cf("weatherPrompt", "你今天心情像什么天气呀?")

    # ── push-to-talk (S2) ────────────────────────────────────────────────────
    def listen(self) -> str:
        from hw.buttons import Btn
        self.face.set_expression("listening")
        path = "/tmp/xiaomu_speech.wav"
        t0 = time.monotonic()
        record_wav(
            path,
            max_seconds=22,
            min_seconds=3.0,
            release_grace_seconds=0.9,
            is_held=lambda: self.buttons.is_held(Btn.TALK),
        )
        recorded_seconds = time.monotonic() - t0
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        try:
            text = brain.transcribe(read_wav(path))
        except Exception as e:
            print("transcribe error:", e, flush=True)
            text = ""
        print(f"heard: {text!r}  (wav={size}B {recorded_seconds:.1f}s)", flush=True)
        dbg.emit("user", text=(text or "(没听清)") + f"   ·{size // 1000}KB {recorded_seconds:.1f}s")
        return text

    def start_conversation(self) -> None:
        self.state = "CONVO"
        self.messages = []
        self.step = "first-meeting"
        # Begin the scripted intro exactly like the web: "我们是第一次见面吗?"
        self._say(self._cf("firstMeetingQuestion", "我们是第一次见面吗?"))
        self.face.set_expression("listening")
        print("conversation started (intro: first-meeting)", flush=True)

    def end_conversation(self) -> None:
        # hard-stop any running activity first
        self._activity_stop.set()
        self.player.stop()
        self.bg_player.stop()
        if self._activity_thread:
            self._activity_thread.join(timeout=3)
        self.active_activity = None
        self.section_index = 0
        self.state = "IDLE"
        self.step = "none"
        self.messages = []
        cf = self.config.get("conversationFlow") or {}
        closing = cf.get("sessionClosingScript") or ""
        if closing:
            # closing script may be a "/"-separated set of variants; pick the first
            self.speak(closing.split("/")[0].strip())
        self.face.set_expression("calm")
        print("conversation ended", flush=True)

    def launch_wifi_setup(self) -> None:
        """Temporarily hand LCD/camera/buttons to the motion-safe QR Wi-Fi scanner.

        It owns the camera and LCD until the user exits, so this process stops
        the face render thread first, runs the scanner, then execs itself to
        resume Xiaomu.
        """
        print("launching Yahboom QR Wi-Fi setup...", flush=True)
        dbg.emit("info", msg="Opening QR Wi-Fi setup")
        self._activity_stop.set()
        self.player.stop()
        self.bg_player.stop()
        if self._activity_thread:
            self._activity_thread.join(timeout=3)
        self.face.stop()
        script = os.path.join(os.path.dirname(__file__), "wifi_setup_safe.py")
        try:
            subprocess.run([sys.executable, script], cwd=os.path.dirname(__file__), check=False)
        finally:
            os.execv(sys.executable, [sys.executable, *sys.argv])

    def _enter_volume_mode(self) -> None:
        self.ui_mode = "volume"
        self.volume_level = get_output_volume(self.volume_level)
        set_volume_overlay(self.volume_level)
        dbg.emit("info", msg=f"volume mode on: {self.volume_level}%")

    def _exit_volume_mode(self) -> None:
        self.ui_mode = "normal"
        set_volume_overlay(None)
        dbg.emit("info", msg="volume mode off")

    def _adjust_volume(self, delta: int) -> None:
        self.volume_level = set_output_volume(self.volume_level + delta)
        set_volume_overlay(self.volume_level)
        dbg.emit("info", msg=f"volume: {self.volume_level}%")
        self.speak("你好呀我是小沐")

    def _network_click_due(self) -> None:
        if self._pending_network_click_at and time.monotonic() >= self._pending_network_click_at:
            self._pending_network_click_at = 0.0
            self.launch_wifi_setup()

    def _handle_network_button(self) -> None:
        if self.ui_mode == "volume":
            self._pending_network_click_at = 0.0
            self._exit_volume_mode()
            return
        now = time.monotonic()
        if self._pending_network_click_at and now < self._pending_network_click_at:
            self._pending_network_click_at = 0.0
            self._enter_volume_mode()
            return
        self._pending_network_click_at = now + 0.35

    def handle_remote_command(self, cmd: dict) -> None:
        """Handle commands from the remote debug dashboard."""
        action = cmd.get("action")
        text = (cmd.get("text") or "").strip()
        if action == "start":
            if self.state == "IDLE":
                self.start_conversation()
            return
        if action == "end":
            if self.state != "IDLE":
                self.end_conversation()
            return
        if action != "message" or not text:
            return
        dbg.emit("user", text=f"[远程] {text}")
        if self.state == "IDLE":
            self.start_conversation()
        if (self.state == "ACTIVITY"
                and (self.active_activity or {}).get("id") == "co-creation"):
            self._co_creation_turn(text)
        elif self.state == "CONVO":
            self.run_turn(text)
        else:
            dbg.emit("debug", msg=f"remote message ignored in state={self.state}")

    # ── main loop ────────────────────────────────────────────────────────────
    def run(self, demo: str = "") -> None:
        from hw.buttons import Btn
        from hw.audio import set_mic_gain
        import debug_server as dbg
        dbg.start()                  # live dashboard on http://<pi>:8788/
        set_mic_gain()  # pull the WM8960 capture gain down so STT audio doesn't clip
        self.load_config()
        dbg.set_state(state="IDLE", step="none", age=self.child_age, voice=self.voice)
        self.face.start()
        print("runtime up. key1=start/stop · key2=hold-to-talk · key3=wifi/continue · key4=repeat.", flush=True)
        if demo == "breathing":
            threading.Timer(2.0, self.start_breathing).start()
        elif demo == "convo":
            threading.Timer(2.0, self.start_conversation).start()
        try:
            while True:
                self._network_click_due()
                for cmd in dbg.poll_commands():
                    self.handle_remote_command(cmd)
                    dbg.set_state(state=self.state, step=self.step,
                                  activity=self.active_activity, age=self.child_age)
                for btn in self.buttons.poll():
                    print(f"[BTN] pressed: {btn.value}", flush=True)
                    dbg.emit("button", key=btn.value)
                    if self.ui_mode == "volume":
                        if btn == Btn.START_STOP:
                            self._adjust_volume(-10)
                        elif btn == Btn.TALK:
                            self._adjust_volume(10)
                        elif btn == Btn.NEXT:
                            self._handle_network_button()
                        dbg.set_state(state=self.state, step=self.step,
                                      activity=self.active_activity, age=self.child_age)
                        continue
                    if btn == Btn.START_STOP:
                        if self.state == "IDLE":
                            self.start_conversation()
                        elif self.state == "BREATHING":
                            self.stop_activity()
                        else:  # CONVO or ACTIVITY → end the whole session
                            self.end_conversation()
                    elif btn == Btn.TALK:
                        if self.state == "CONVO":
                            self.run_turn(self.listen())
                        elif (self.state == "ACTIVITY"
                              and (self.active_activity or {}).get("id") == "co-creation"):
                            self._co_creation_turn(self.listen())  # interactive note picks
                    elif btn == Btn.NEXT:
                        self._handle_network_button()
                    dbg.set_state(state=self.state, step=self.step,
                                  activity=self.active_activity, age=self.child_age)
                time.sleep(0.03)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop_activity()
            self.face.stop()


def main() -> None:
    use_kbd = "--kbd" in sys.argv
    use_file = "--file" in sys.argv
    demo = "breathing" if "--demo" in sys.argv else ("convo" if "--demo-convo" in sys.argv else "")

    if use_file:
        from face.display import FileDisplay
        display = FileDisplay()
    else:
        from face.display import LcdDisplay
        display = LcdDisplay()

    if use_kbd:
        from hw.buttons import KeyboardButtons
        buttons = KeyboardButtons()
    else:
        from hw.buttons import GpioButtons
        buttons = GpioButtons()

    # On `systemctl stop/restart` (SIGTERM) raise KeyboardInterrupt so run()'s
    # finally block stops the render thread + audio and releases the SPI LCD
    # cleanly — otherwise the next instance's LcdDisplay() init can hang.
    def _on_term(_sig, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, _on_term)

    Runtime(display, buttons).run(demo=demo)


if __name__ == "__main__":
    main()
