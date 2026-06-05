# CLAUDE.md — Xiaomu Studio

> Read this file at the start of every session. It's the source of truth for project context, decisions, and conventions. Update it when decisions change.

## 1. What this is

**小沐 (Xiaomu) Studio** — a local-first web app that lets the project team tune a music-therapy companion robot for hospitalized children (ages 3–12+). The studio configures persona, activities, expressions, safety rules, emotion routing, and voice/face fidelity. The studio is the **configuration & simulation layer**. The robot (Jetson Orin Nano + LED face display) is a separate future build that consumes the studio's exported `StudioBundle`.

**Primary users of the studio**: 1–3 people (designer / therapist / engineer mix).
**End users of the robot**: hospitalized children. **No patient data flows through this system.**

## 2. Decisions (frozen — do not re-litigate without user confirmation)

| Topic | Decision |
|---|---|
| Deployment | **Local-only.** Single dev's machine. No Azure-hosted UI. No SWA, no Cosmos, no Entra. Persistence is JSON files in `./data/`. |
| Azure region | **Southeast Asia** (Singapore proximity, supports Voice Live + TTS Avatar for future swap) |
| Cloud resources | Foundry (`xiaomu-foundry`) + Speech (`xiaomu-speech`) only, in `rg-xiaomu-studio`. Provisioned manually by user. Keys in `.env`. |
| Chat model | `gpt-5-chat` via Global Standard deployment. Emotional-intelligence-tuned. Surface model picker in studio for future swaps. |
| TTS voice (default) | `zh-CN-XiaoxiaoMultilingualNeural` |
| Voice Live | Yes, for real-time voice mode in test chat. PCM16 @ 24kHz mono, server-side VAD, `AudioWorklet` only (no `ScriptProcessorNode`). |
| Languages | Mandarin (primary), English (secondary). Studio UI in English. |
| Face renderer | Enhanced 2D SVG. Pluggable interface so 3D / Avatar can swap later. |
| Face style | Cozmo/EMO/Vector-style abstract eyes on a dark LED panel + minimalist emoji mouth. Color encodes emotion family. |
| Expression library | 16 expressions: happy, excited, calm, gentle, listening, curious, thinking, sad, anxious, sleepy, surprised, celebrating, proud, confused, playful, encouraging |
| Idle behavior | "Daydream" — natural blink 3–5s, breathing sway, occasional eye drift up/around, baseline modest smile. Toggleable. |
| Personas | Zi (3, butterfly, soft classical), Yuhan (12, wheelchair, rock/emotional), Zaiwa (7, hand mobility issue, pop/sings) preloaded. Studio supports CRUD. |
| Robot-side persona selection | Robot has a toggle UI. Studio publishes full persona library; robot picks active locally. |
| Music preferences | Per-persona allowlist/blocklist, max volume, free-text "avoid" notes. Local audio library only in v1. |
| Audio library | Upload to local `./data/audio/`, bundled starter set included, referenced by SHA256. |
| Publishing | Single publish button, writes `./data/published/v{N}.json`. One-click rollback. Audit data captured silently, UI deferred. |
| Voice styles | Per-activity SSML style overrides. Data-driven — studio can add new styles without code changes. |
| Therapist monitoring | **Cut from v1.** |
| Patient data | **None.** No PHI, no PII beyond persona configs. |
| Distress escalation | Cut from v1 — revisit later. |
| Budget | Cost Management alerts at $50 / $100, soft cap $200 via Action Group disabling deployments. |

## 3. Tech stack

```
Monorepo (pnpm workspaces, Node 20)
├── apps/studio        Vite + React 18 + TS + Tailwind + lucide-react + zustand
├── apps/server        Fastify + TS (single process, brokers Azure AI, JSON file persistence)
└── packages/contracts TypeScript types — single source of truth for studio↔server↔future-robot
```

**One command to run everything**: `pnpm dev` → studio on `:5173`, server on `:8787`.

## 4. Repo structure

```
xiaomu-studio/
├── CLAUDE.md                       ← this file
├── README.md                       ← user-facing setup
├── package.json                    ← workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example                    ← AZURE_FOUNDRY_*, AZURE_SPEECH_*
├── .gitignore                      ← node_modules, .env, data/, .idea/, .vscode/
├── scripts/
│   └── setup.sh                    ← idempotent az resource provisioning + .env write
├── data/                           ← gitignored; created at runtime
│   ├── configs/                    ← per-draft config JSON
│   ├── personas/                   ← persona JSONs
│   ├── audio/                      ← uploaded audio files
│   ├── published/                  ← v1.json, v2.json, ...
│   └── audit.jsonl                 ← append-only log
├── packages/
│   └── contracts/
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── studio-bundle.ts    ← the studio→robot contract
│           ├── config.ts           ← StudioConfig type
│           ├── expression.ts       ← Expression, ExpressionTimeline
│           ├── viseme.ts           ← VisemeEvent
│           └── persona.ts
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            ← Fastify bootstrap
│   │       ├── routes/
│   │       │   ├── chat.ts         ← POST /api/chat → Foundry
│   │       │   ├── tts.ts          ← POST /api/tts → Speech SSML
│   │       │   ├── voice-live.ts   ← WS bridge to Azure Voice Live
│   │       │   ├── config.ts       ← CRUD on configs
│   │       │   ├── personas.ts     ← CRUD on personas
│   │       │   ├── audio.ts        ← upload/list audio files
│   │       │   ├── publish.ts      ← create published version
│   │       │   └── export.ts       ← produce StudioBundle.zip
│   │       └── lib/
│   │           ├── assembleSystemPrompt.ts
│   │           ├── ttsSanitizer.ts
│   │           ├── clauseSentiment.ts
│   │           └── audit.ts
│   └── studio/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── app.tsx
│           ├── store/              ← zustand slices
│           ├── api/                ← typed client; reads packages/contracts
│           ├── panels/
│           │   ├── Identity.tsx
│           │   ├── Personality.tsx
│           │   ├── Voice.tsx
│           │   ├── VoiceSamples.tsx
│           │   ├── Face.tsx
│           │   ├── Expressions.tsx
│           │   ├── Personas.tsx
│           │   ├── Activities.tsx
│           │   ├── EmotionRouting.tsx
│           │   ├── AgeRouting.tsx
│           │   ├── MusicPreferences.tsx
│           │   ├── ConversationFlow.tsx
│           │   ├── Safety.tsx
│           │   ├── AudioLibrary.tsx
│           │   ├── TestChat.tsx
│           │   ├── Publish.tsx
│           │   └── Export.tsx
│           └── face/
│               ├── FaceRenderer.tsx        ← pluggable interface
│               ├── SVG2DRenderer.tsx       ← v1 implementation
│               ├── expressions.ts          ← the 16 expression poses
│               ├── visemeMap.ts            ← viseme ID → mouth shape
│               ├── idleBehavior.ts         ← daydream loop
│               └── interpolate.ts          ← cubic-bezier eased transitions
```

## 5. The contract: `StudioBundle v1`

This is what gets exported and what the Jetson robot will eventually consume. **Freeze the shape now.** Audio referenced by SHA256, never embedded.

```ts
// packages/contracts/src/studio-bundle.ts
export interface StudioBundle {
  schemaVersion: 1;
  version: number;              // monotonic per publish
  publishedAt: string;          // ISO 8601
  publishedBy: string;          // git user.email or os.userInfo().username

  config: StudioConfig;
  audioManifest: AudioManifestEntry[];
}

export interface AudioManifestEntry {
  id: string;
  filename: string;
  sha256: string;
  mimeType: string;
  durationMs: number;
  tags: string[];               // e.g. ["breathing", "soft-classical"]
  // robot resolves this against its local cache or fetches from a synced location
}
```

`StudioConfig` includes identity, personality, voice, voiceSamples, face (renderer + expressionLibrary + idle), personas[], activities[], emotionRouting, ageRouting, conversationFlow, safety, musicPreferences. Full type in `packages/contracts/src/config.ts`.

## 6. Critical implementation rules

### 6.1 TTS sanitizer (the "quote" fix)

`apps/server/src/lib/ttsSanitizer.ts` — runs before every TTS call. Required behaviors:

- Strip `" ' " " ' ' « » 「 」 『 』` → wrap quoted spans in `<emphasis level="moderate">`
- Strip markdown `*` `**` `_` `__` `` ` `` → no readout
- Strip emoji or expand to Mandarin label (configurable)
- Wrap bare digits in `<say-as interpret-as="cardinal" detail="0">N</say-as>` for correct Mandarin reading
- Output is valid SSML wrapped in `<speak version="1.0" xmlns:mstts="..." xml:lang="zh-CN"><voice name="...">`

**Must have unit tests.** This is small but it's the difference between sounding alive and sounding broken.

### 6.2 Face renderer pipeline

Three independent streams converge on the SVG:

1. **Viseme stream** drives mouth shape. Audio offset aligned. Source: Azure Speech viseme events, or audio-envelope fallback if zh-CN visemes are unreliable (see §6.4).
2. **Expression timeline** drives eyes/eyebrows/head tilt/color. Source: clause-level sentiment classifier (rule-based v1) on streaming assistant text, scheduled to audio offsets.
3. **Idle behavior** runs always; suppressed when speech is active, resumes 500ms after last viseme.

Smooth interpolation between all pose changes (cubic-bezier, 150–400ms). No teleporting.

### 6.3 System prompt assembly

`assembleSystemPrompt(config, persona)` — single deterministic function. Snapshot-tested. Output goes to Foundry chat as the `system` message. Embeds:
- Identity, personality, do/don't list
- Active persona's profile (age, communication ability, mobility, sensory profile, likes/dislikes)
- 5–15 voice samples as few-shot guidance
- Safety rules (avoid topics, distress patterns, hard prohibitions)
- Current activity context if mid-session

Default chat `temperature: 0.85`, `temperature: 0.6` for therapy moments (breathing exercise, distress response).

### 6.4 Viseme support for zh-CN (risk to verify Day 1)

Microsoft's TTS overview page says viseme is en-US only. The language-support reference lists a separate viseme locale table that includes zh-CN. Community reports confirm zh-CN works in practice. **Don't trust the docs — verify with a 30-line spike script on Day 1**:

```ts
// scripts/spike-viseme-zhcn.ts
// SDK call against zh-CN-XiaoxiaoMultilingualNeural with a short Mandarin string.
// Log: count of VisemeReceived events, viseme IDs returned, audio offsets.
// If 0 events → fall back to audio-envelope mouth drive (works on raw PCM).
```

Mark this finding clearly in code comments. The audio-envelope fallback ships regardless as the lip-sync source for Voice Live (which streams audio without viseme events).

## 7. Build sequencing — checkpoints, not one dump

Do not dump 40 files at once. Stop at each checkpoint, verify with user, continue.

| # | Checkpoint | Sign-off gate |
|---|---|---|
| C1 | Repo skeleton + `pnpm dev` works + blank panels render | Structure feels right |
| C2 | Face renderer with mocked viseme + all 16 expressions + idle | Face feels alive |
| C3 | `scripts/setup.sh` clean run + viseme spike (§6.4) | Azure side works |
| C4 | Real Foundry chat in test panel with assembled prompt | Chat sounds non-robotic |
| C5 | TTS with SSML + sanitizer; voice plays in browser | Quote bug gone, voice good |
| C6 | Voice Live streaming + face syncs to real audio | End-to-end works |
| C7 | All other panels wired (personas, music, activities, etc.) + export + publish | Ship |

## 8. Anti-patterns — do not repeat the previous build's mistakes

1. **Do not commit `.idea/` or `.vscode/`.** They go in `.gitignore` Day 1.
2. **No `python3` in setup scripts.** Pure `az ... -o tsv` queries. No `jq` required either (extract via `az` directly).
3. **No `ScriptProcessorNode`.** `AudioWorklet` from day one.
4. **No Web Speech API** for STT — use Azure Voice Live.
5. **No Next.js, no MSAL, no Redux.** Vite + React + zustand only.
6. **Do not write `"` to TTS.** Run `ttsSanitizer` on every utterance.
7. **Do not bolt the face renderer on at the end.** It's Checkpoint 2. The viseme + clause-sentiment + idle pipeline is the highest-risk piece.
8. **Do not document features that aren't built yet.**
9. **Do not invent Azure facts.** If a model name, region availability, SDK version, or pricing matters — web search, don't recall.
10. **Do not ship one giant tarball.** Honor the checkpoint cadence.
11. **No silent assumptions.** If a schema decision isn't in this file, ask before deciding.

## 9. Coding conventions

- TypeScript strict mode, all packages
- No `any` without a `// reason:` comment
- Path aliases: `@xiaomu/contracts`, `@studio/*`, `@server/*`
- Validation: `zod` schemas in `packages/contracts` mirror every TS type; server validates on input
- Errors: `Result<T, E>` pattern in shared lib; never `throw` across the network boundary
- Logging: `pino` on the server, namespaced (`xiaomu:chat`, `xiaomu:tts`, etc.)
- Tests: `vitest` for both apps. Required for `ttsSanitizer`, `assembleSystemPrompt`, `clauseSentiment`, viseme map.
- Tailwind only; no separate CSS files except `index.css` for the dark LED panel background.

## 10. `.env` (server-side only — browser never sees these)

```
AZURE_FOUNDRY_ENDPOINT=https://xiaomu-foundry.openai.azure.com/
AZURE_FOUNDRY_KEY=...
AZURE_FOUNDRY_DEPLOYMENT=gpt-5-chat
AZURE_FOUNDRY_API_VERSION=2025-04-01-preview

AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=southeastasia
AZURE_SPEECH_DEFAULT_VOICE=zh-CN-XiaoxiaoMultilingualNeural

PORT=8787
DATA_DIR=./data
```

Studio reads its config from `/api/config` — no Azure keys ever ship to the browser. Voice Live uses the server as a WebSocket relay (api-key in query string, brokered).

## 11. Voice samples — 10 placeholders to seed

The user asked for 10 placeholder voice samples to edit later. Generate these in `data/configs/default.json` under `voiceSamples`. Vary across: greeting, breathing-exercise opener, encouragement, celebration, gentle redirect, curiosity-prompt, sadness-mirror, sleepy-wind-down, body-rhythm-prompt, end-of-session ritual. Mandarin first, English fallback. Keep each 1–3 sentences. Avoid AI-tells ("I'm here to help", "as an AI"). Use child-friendly discourse markers ("欸", "哇", "嗯…", "我们一起…").

## 12. Future-proofing (do not implement, just don't block)

- Cloud deployment path: local server → Azure Functions is a port, not a rewrite. Keep route handlers thin.
- Cosmos migration: file-based store has the same key shape as a Cosmos document. `id` + `partitionKey` already in every record.
- Auth: `req.user` exists in middleware as `{ id: 'local-dev' }`. Swap for Entra later without touching route logic.
- 3D face: `FaceRenderer` interface accepts the same `{ expressionTimeline, visemeStream, idle }` triple. SVG2D, Three3D, AzureAvatar all satisfy it.
- Robot publish: today writes to disk; tomorrow add a `/api/robot/active-config` endpoint that returns the same `StudioBundle`.

## 13. What to ask the user before deciding

If any of these come up and aren't already in this file:
- Schema shape changes (new field on `StudioConfig`)
- New expression or removal of one of the 16
- New activity type beyond the 5 named
- Adding a dependency not in the locked stack
- Changing the publish flow
- Anything touching the studio↔robot contract

For everything else, decide and document the decision back into this file.
