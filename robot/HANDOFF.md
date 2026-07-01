# Xiaomu Robot — Handoff / Continue-Here (2026-06-25)

Where the robot build stands and how to pick it up. Companion memory:
`robot-runtime-plan`, `rider-pi-hardware`.

## TL;DR
The robot runs a **safe conversational session** on real hardware. Verified end-to-end:
the Node brain (systemd) + face on LCD (expressions/idle/lip-sync) + speaker (TTS) +
push-to-talk plumbing + the safety gate + the scripted intro FSM. A child can press key1,
go through the intro (first-meeting → age → weather), then free-chat — with distress
short-circuit, emotion-driven face, and viseme lip-sync. **Built + verified: S1 breathing,
S2 voice/lip-sync, S3 safety, S4 intro FSM.** **Remaining: S5 warmup games, S6 activity
playback (the start_activity/play_melody tool-calls — the music-therapy core), S7
hardening + face-runtime autostart.**

The runtime is `robot/main.py` (Runtime class): face thread + button loop + `run_turn`
dispatcher (safety → activity-intent bypass → scripted step | free chat). Verified by
`s23_test.py` (safety+chat) and `s4_test.py` (intro). Physical GPIO buttons + mic work in
the venv but a full press-and-speak test by a human is still pending.

## Status
| Step | State |
|---|---|
| R1 publish/export pipeline | ✅ `apps/server/.../publish.ts` + `publishBundle.ts`; `data/published/v1.json` |
| R2 face renderer + idle + buttons + bundle | ✅ live on the 320×240 LCD |
| R7 Node brain on the Pi | ✅ systemd `xiaomu-brain.service`; chat/tts/classify/risk verified |
| R3 activity runtime | ✅ S1 breathing · S2 voice/lip-sync · S3 safety · S4 intro FSM · S6 activity playback — all verified. (S5 warmup games = follow-up, task #8) |
| R4 emotion detection (camera) | ⬜ |
| R5 deploy + autostart | ✅ **LIVE — robot boots into Xiaomu** (`xiaomu-robot.service` + `xiaomu-brain.service` enabled; demo retired, reversible via `deploy/restore-demo.sh`) |

## Connection & ops
- **SSH**: `ssh pi@<ip>` (key installed, passwordless). IP is **DHCP — it changes**;
  last seen `192.168.0.126` (was `192.168.137.136` on the hotspot). Find it with the
  router or `ping pi.local`. Passwordless `sudo`. Password (fallback) `yahboom`.
- **Brain**: `xiaomu-brain.service` (systemd, enabled) runs `pnpm exec tsx src/index.ts`
  in `~/xiaomu-studio/apps/server`, listening `127.0.0.1:8787`. Survives reboot.
  - `systemctl status/restart xiaomu-brain`, logs `journalctl -u xiaomu-brain -f`.
  - Verify: `curl localhost:8787/api/health` → `{"ok":true}`.
- **Embodiment code** lives at `~/xiaomu/` on the Pi. Deploy from the Mac:
  `rsync -az --exclude __pycache__ net hw face bundle.py *.py pi@<ip>:~/xiaomu/`
- **Run on the Pi** (needs the Yahboom xgo venv for Pillow/numpy/xgoscreen):
  `~/RaspberryPi-CM5/xgovenv/bin/python <script>.py` from `~/xiaomu/`.
- **Free the LCD from the Yahboom demo** before showing our face:
  `sudo systemctl stop xgo_script.service; sudo pkill -f "[m]ain.py"`
  (use the `[m]` bracket trick — a plain `pkill -f main.py` self-matches the remote
  shell; the demo runs as root so `sudo`). Reboot restores the demo.
- **2 GB RAM is tight** (disk ~95% full). Heavy load wedges sshd (handshake resets) —
  a reboot recovers. Run long ops detached (`setsid … >log 2>&1 </dev/null &`) + poll;
  single-file downloads survive, multi-request installs need retries.

## What's built in `robot/`
```
face/expressions.py   16 poses (port of studio expressions.ts)
face/renderer.py       PIL face → 320×240 LCD image
face/idle.py           daydream blink/breath/drift
face/controller.py     threaded render loop: expression tween + idle + talking mouth
                       (instrumented: .frames, .last_error)
face/display.py        LcdDisplay (xgoscreen) | FileDisplay (dev)
hw/buttons.py          GpioButtons (BCM 24/23/17/22) | KeyboardButtons (dev)
hw/audio.py            Player (mplayer, non-blocking) + record_wav (arecord 16k mono)
net/brain.py           HTTP/SSE client (stdlib urllib): chat_stream, tts, classify,
                       risk(/api/risk-assess), transcribe, get_config, health
bundle.py              loads data/published/vN.json (+ color overrides)
run_face.py            live idle face (R2 baseline)
smoke_embodiment.py    VERIFIED: face + TTS speaker + chat round
face_diag.py           expression-cycle diagnostic (133 frames/12 s, ~11 fps)
lcd_show.py            cycle/hold expressions on the LCD
docs/r3-design-and-maps.json   ← FULL R3 design + 5 source maps (228 KB)
```

## Verified facts (don't re-derive)
- LCD = XGO 2-inch, **320×240 landscape**, `display.ShowImage(pil_image)`. Our face is
  320×200 centered on it (`face/display.fit_to_panel`, 20 px top/bottom).
- Speaker = **WM8960 (card 2)**; mplayer default reaches it (user confirmed audio).
  Mic = WM8960 capture, `plughw:2,0` (set `XIAOMU_AUDIO_IN`).
- `/api/chat` SSE events: `{type:text,delta}`, `{type:expression,timeline:[{atCharOffset,
  expressionId,confidence}]}`, `{type:tool_call,name,args,result}` (start_activity →
  `audioPlaylist`,`currentSectionText`,`sectionNumber`…; play_melody), `{type:done}`.
  → **The server already orchestrates activities via tool-calls; Python mostly reacts.**

## Next steps — R3 build order (from the design workflow, architecture = python-reimplement-fsm)
Full detail + the 5 source maps in `docs/r3-design-and-maps.json`. **S1–S4 are DONE +
verified on the robot** (see Status). Resume at S5/S6. Build incrementally, deploy+test
each on the robot.

**S6 activity advancement (the mechanic to implement)**: on a `start_activity` tool-call,
play `result.audioPlaylist` (local files) + speak `result.currentSectionText` (TTS) + set
the activity's expression. To advance, send a **silent `继续` turn** (with `activityContext`
= {activityId, type, sectionIndex+1, therapyMode}) back through `/api/chat`; the model
returns the next section's text+audio. Loop until `end_activity` (or sectionNumber ==
totalSections). Drivers: scripted (breathing/body-rhythm) advance on **audio-ended**;
emotion-mapping on a **20 s/section timer**; co-creation on **audio-ended → silent 继续**
(play_melody result is queued and flushed after the current TTS). Watchdog (~longest
audio × 2) force-advances if stalled. `run_turn`/`_chat_turn` already receive the
`tool_call` events — currently logged as "S6 todo"; wire them here.

1. **S1** — key1 → one **local breathing exercise** (bundled audio + face sequence), no
   cloud. Smallest visible milestone. Generalize `run_face.py` into `robot/main.py` with
   the render thread + button poll.
2. **S2** — key2 push-to-talk → `record_wav` (RMS VAD) → `brain.transcribe` →
   `brain.tts` speak, with **viseme lip-sync** (add `tts_visemes()` → `/api/tts/visemes`;
   the renderer already has mouth params + `visemeMap` to port).
3. **S3** — safety gate + `run_turn` pipeline: `brain.risk` (already fixed to
   `/api/risk-assess`, `{emotion,risk_level}`) + local `safety.distressKeywords` filter;
   high_risk/keyword → fixed crisis line + end; concerning → fixed line + comfort music.
4. **S4** — scripted intro FSM (`robot/session/fsm.py`): first-meeting → age (`parseAge`,
   ASCII+Chinese numerals) → weather, with the **verified asymmetry** (new friend → LLM
   after weather; returning → warmup funnel). Keep the **activity-intent bypass** (project
   memory rule) wrapping every step.
5. **S5** — 2 warmup games (rhythm-story, sound-detective) + weather→recommend→game funnel.
6. **S6** — LLM free-chat + **activity sub-FSM** (4 activities): speak text events, set
   face from expression timeline, handle start_activity/play_melody/end_activity with
   runtime-owned `activityContext` (sectionIndex, coCreation variant/notes); autonomous
   advance (emotion-mapping 20 s/section; co-creation audio-ended → silent `继续`).
7. **S7** — hardening: break suggestion, content-filter end, watchdogs, key4 REPEAT, and
   **systemd autostart for the face runtime** (replace the Yahboom demo) → R5.

## Known issues / watch-list (from the design critique, score 78/100)
- `brain.py` risk endpoint + classify `context` param — **FIXED**.
- `concerningMode` flag should be sent to `/api/chat` on concerning turns (not yet wired).
- `play_melody` should flush **after** the current TTS ends (queue it).
- Activity auto-advance is timer/audio-ended driven (runs without a button) — design for it.
- Brain is on `127.0.0.1` (good); keys live in `~/xiaomu-studio/.env` on the Pi.
- **TTS voice is config-driven**: `main.py` passes `config.voice.defaultVoice` (set in the
  studio; currently `zh-CN-XiaomengNeural` 小梦) to `/api/tts` — the server otherwise falls
  back to the env voice. Change the voice in the studio + re-sync `data/configs/default.json`
  to the Pi + restart the runtime. (The env `AZURE_SPEECH_DEFAULT_VOICE` is the fallback only.)
- **SPI/LCD restart gotcha**: `systemctl restart xiaomu-robot` can wedge a process in `D`
  state on `spidev_ioctl` (LCD init contention with the outgoing instance) → unkillable →
  **only a reboot clears it**. Mitigation in place: a SIGTERM handler in `main.py` (clean
  render-thread shutdown on stop) + `ExecStartPre=sleep 6`. If a restart ever hangs
  (`systemctl is-active` = `deactivating`, `wchan=spidev_ioctl`), `sudo reboot`.
