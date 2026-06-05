/**
 * POST /api/chat — SSE streaming chat via Azure AI Foundry (OpenAI-compatible).
 *
 * Body:  { configId, personaId, messages, activityContext? }
 * Stream:
 *   data: { type: 'text',       delta: string }
 *   data: { type: 'expression', timeline: ExpressionEvent[] }
 *   data: { type: 'tool_call',  name: string, args: object, result: object }
 *   data: { type: 'done',       usage: { promptTokens, completionTokens } }
 *   data: { type: 'error',      message: string }
 *
 * Tools:
 *   start_activity(activity_id) — server resolves age-appropriate audio for
 *   body-rhythm; returns tool result inline; model continues streaming.
 *
 * Temperature: 0.85 default, 0.6 when activityContext.therapyMode === true.
 */

import type { FastifyInstance } from 'fastify';
import { AzureOpenAI } from 'openai';
import { z } from 'zod';
import { ActivityContextSchema } from '@xiaomu/contracts';
import type { StudioConfig, Persona } from '@xiaomu/contracts';
import { assembleSystemPrompt } from '../lib/assembleSystemPrompt.js';
import { createClauseClassifier } from '../lib/clauseSentiment.js';
import { readJson } from '../lib/fileStore.js';
import { resolveActivityScript } from '../lib/activityResolver.js';
import { findCoCreationAudio } from '../lib/coCreationAudio.js';
import type { CoCreationVariant } from '../lib/coCreationAudio.js';

// ── OpenAI client ─────────────────────────────────────────────────────────────

function getClient(): AzureOpenAI {
  const endpoint   = process.env['AZURE_FOUNDRY_ENDPOINT']   ?? '';
  const key        = process.env['AZURE_FOUNDRY_KEY']        ?? '';
  const deployment = process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? '';
  const apiVersion = process.env['AZURE_FOUNDRY_API_VERSION'] ?? '2025-04-01-preview';

  if (!endpoint || !key || !deployment) {
    throw new Error(
      'Missing Azure Foundry env vars. Run ./scripts/setup.sh to populate .env.',
    );
  }

  return new AzureOpenAI({ endpoint, apiKey: key, deployment, apiVersion });
}

// ── Request schema ────────────────────────────────────────────────────────────

const MessageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string(),
});

const ChatBodySchema = z.object({
  configId:        z.string().default('default'),
  personaId:       z.string(),
  messages:        z.array(MessageSchema).min(1),
  activityContext: ActivityContextSchema.optional(),
});

// ── Tool definitions ──────────────────────────────────────────────────────────

const ACTIVITY_IDS = ['breathing', 'body-rhythm', 'emotion-music-mapping', 'co-creation'] as const;

const START_ACTIVITY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'start_activity',
    description:
      'Begin one of the four music-therapy activities. You MUST call this BEFORE you narrate any activity. ' +
      'The tool returns the age-appropriate narration script you should speak verbatim, plus the audio playlist. ' +
      'Skipping the tool means no audio plays and the studio UI does not surface the activity. ' +
      'You may briefly confirm the choice in chat first, but do not begin the activity narration in text until you have called this.',
    parameters: {
      type: 'object',
      properties: {
        activity_id: {
          type: 'string',
          enum: ACTIVITY_IDS,
          description: 'Which of the four activities to begin.',
        },
        reason: {
          type: 'string',
          description: 'One short sentence explaining why this activity, now.',
        },
      },
      required: ['activity_id'],
    },
  },
};

const PLAY_MELODY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'play_melody',
    description:
      'Play a 3-note melody for the Co-Creation activity. The platform resolves an ' +
      'audio file from data/audio/ based on the notes + variant and plays it in the studio. ' +
      'Call this at exactly three moments during the script: (1) after the child picks 3 ' +
      'notes — variant "original", (2) after introducing the three magics — variant ' +
      '"revised", (3) when starting the menu prompt — variant "background" (this one loops ' +
      'under the chat until end_activity is called).',
    parameters: {
      type: 'object',
      properties: {
        notes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'],
          },
          minItems: 3,
          maxItems: 3,
          description: 'The three solfège notes the child picked, in any order.',
        },
        variant: {
          type: 'string',
          enum: ['original', 'revised', 'background'],
          description: 'Which recording to play.',
        },
      },
      required: ['notes', 'variant'],
    },
  },
};

const END_ACTIVITY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'end_activity',
    description:
      'End the current activity. The studio stops any looping audio and clears the activity ' +
      'badge. Call this AFTER you have spoken the closing line. Do not call before — the ' +
      'platform expects the closing to play first.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

// ── Tool resolver ─────────────────────────────────────────────────────────────

interface StartActivityResult {
  ok: boolean;
  activityId?: string;
  activityName?: string;
  activityType?: string;
  audioPlaylist?: string[];
  /** Section the assistant should speak immediately in the current streaming turn. */
  currentSectionText?: string;
  sectionNumber?: number;
  totalSections?: number;
  speakingInstruction?: string;
  personaAge?: number;
  matchedBucket?: { minAge: number; maxAge: number } | null;
  /** Set to true when the activity is interactive and not section-driven (co-creation). */
  interactive?: boolean;
  error?: string;
}

interface PlayMelodyResult {
  ok: boolean;
  notes?: string[];
  variant?: CoCreationVariant;
  filename?: string;
  /** How many times the studio should play this track before auto-advancing. */
  playCount?: number;
  /** Text the model must speak immediately as its response to this tool call. */
  speakingInstruction?: string;
  /** Authoritative text the server emits directly when the model goes silent. */
  speakText?: string;
  error?: string;
}

interface EndActivityResult {
  ok: boolean;
  /** Closing text the server emits directly when the model goes silent on forced end_activity. */
  speakText?: string;
}

const CO_CREATION_CLOSING_TEXT =
  '谢谢你今天和我一起创作音乐。🎵 你的音乐跟别人的不一样，因为它来自你心里。' +
  '我会记住我们的音乐大冒险，下次我们可以一起创作新的东西！下次再来彩虹缤纷镇找我玩哦！🌈✨';

/**
 * Infer which co-creation stage we're on by scanning the assistant's prior
 * messages for the canonical `speakText` markers the server emitted on each
 * tool call. Latest-stage match wins. Used as a fallback when the studio
 * doesn't send `coCreationLastVariant` (stale client, race, etc.).
 */
function inferCoCreationVariant(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): 'none' | 'original' | 'revised' | 'background' {
  // Scan assistant messages newest → oldest; first match wins.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const c = m.content;
    // Stage 5 spoken → variant=background last played
    if (c.includes('音乐探险家') || c.includes('1️⃣ 换一个音符') || c.includes('1️⃣ 换一个')) return 'background';
    // Stage 4 spoken → variant=revised last played
    if (c.includes('音乐魔法') || c.includes('🦋 魔法一') || c.includes('魔法一：换一个音符')) return 'revised';
    // Stage 3 spoken → variant=original last played
    if (c.includes('选得真好') && c.includes('听听你的音乐')) return 'original';
  }
  return 'none';
}

async function resolvePlayMelody(
  args: { notes?: string[]; variant?: string },
  config: StudioConfig,
  /** Server-authoritative variant for the current stage. If provided, OVERRIDES the model's choice. */
  expectedVariant?: CoCreationVariant,
  /** Server-authoritative notes (the Stage-2 user pick). If provided, OVERRIDES the model's notes for Stages 4/5. */
  pinnedNotes?: string[],
): Promise<PlayMelodyResult> {
  // Apply server-authoritative overrides: the model frequently calls play_melody
  // with the wrong variant on later stages (it copy-pastes 'original' from
  // history). Stage is the source of truth — trust it over the model's args.
  const notes = pinnedNotes && pinnedNotes.length === 3 ? pinnedNotes : args.notes;
  const variant = (expectedVariant ?? args.variant) as CoCreationVariant | undefined;
  if (!notes || notes.length !== 3) return { ok: false, error: 'notes must be an array of 3 solfège names' };
  if (!variant || !['original', 'revised', 'background'].includes(variant)) {
    return { ok: false, error: 'variant must be original | revised | background' };
  }
  const ccActivity = config.activities.find((a) => a.id === 'co-creation');
  const overrides = ccActivity?.coCreation?.audioMappings;
  const filename = await findCoCreationAudio(notes, variant, overrides);
  if (!filename) {
    return { ok: false, notes, variant, error: `No audio for ${notes.join(',')} (${variant}). Tell the child kindly and offer them to pick a different combination.` };
  }
  // The canonical text the model is supposed to speak at this stage. When the
  // model falls silent after a forced tool call (a real bug we've seen with
  // tool_choice + specific function), the server emits this directly so the
  // user always sees the narration.
  let speakText: string;
  if (variant === 'original') {
    speakText = '选得真好！我们来听听你的音乐听起来是什么样子的。';
  } else if (variant === 'revised') {
    speakText =
      '哇！我们一起创造了一个音乐点子！🎉 但是音乐家们常常喜欢跟自己的音乐玩游戏，用不同的方式去改变它。' +
      '🦋 魔法一：换一个音符 — 换掉其中一个音符，听听看音乐会变得不一样。' +
      '🐢🐇 魔法二：改变速度 — 速度就是音乐的快慢。' +
      '⭐ 魔法三：加入一个新音符。现在，我们来听一听，这段音乐可以变出什么不一样的样子吧。';
  } else /* background */ {
    speakText =
      '现在轮到你当音乐探险家啦！1️⃣ 换一个音符  2️⃣ 改变速度  3️⃣ 加入一个新音符。慢慢来，没有标准答案。我好期待听到你创作的音乐！🌈';
  }

  return {
    ok: true,
    notes,
    variant,
    filename,
    // background plays twice — gives the child a beat to think — then the
    // studio auto-advances to the closing turn. original / revised play once.
    playCount: variant === 'background' ? 2 : 1,
    speakingInstruction: `Speak this verbatim, then end your turn: "${speakText}"`,
    speakText,
  };
}

function resolveStartActivity(
  args: { activity_id?: string },
  config: StudioConfig,
  persona: Persona,
): StartActivityResult {
  const id = args.activity_id;
  if (!id) return { ok: false, error: 'activity_id missing' };
  const activity = config.activities.find((a) => a.id === id);
  if (!activity) return { ok: false, error: `Unknown activity: ${id}` };

  let audioPlaylist: string[] = [];
  let matchedBucket: { minAge: number; maxAge: number } | null = null;
  let sectionBlock: {
    currentSectionText: string;
    sectionNumber: number;
    totalSections: number;
    speakingInstruction: string;
  } | undefined;

  // Co-creation is interactive — no fixed sections, no pre-loaded audio playlist.
  // The model drives the flow via play_melody / end_activity tool calls.
  // The model wouldn't see the dialogue guide on turn 1 (activityContext isn't
  // set yet), so feed the Stage 1 opening through the tool result.
  if (activity.coCreation) {
    const notesList = activity.coCreation.notes.join(' / ');
    const stage1 =
      `哇！现在轮到你来当一个小小音乐创作者啦！🌟 ` +
      `你知道吗？有些音乐家在演奏的时候，会一边弹一边编出新的音乐。这叫做"即兴创作"。` +
      `即兴创作就是去探索新的音乐点子，看看它们会带你到哪里去。没有对错，也没有"弹错"的说法。` +
      `你发出的每一个声音，都可以成为你音乐的一部分！\n\n` +
      `今天，我们要一起来创作一首小小的歌。\n\n` +
      `首先，我们来收集一些音乐宝藏吧！请选出三个音符：\n` +
      `🎵 1 = Do\n🎵 2 = Re\n🎵 3 = Mi\n🎵 4 = Fa\n🎵 5 = Sol\n🎵 6 = La\n🎵 7 = Ti\n\n` +
      `你想要哪三个音符呢？`;
    return {
      ok: true,
      activityId: id,
      activityName: activity.name,
      activityType: activity.type,
      audioPlaylist: [],
      personaAge: persona.ageYears,
      matchedBucket: null,
      interactive: true,
      currentSectionText: stage1,
      speakingInstruction:
        `Open with this exact Stage 1 message (verbatim), then STOP and wait for the child to ` +
        `name three notes. Do NOT add a preamble before "哇！现在轮到你…" — your response begins ` +
        `with those characters. Available notes: ${notesList}. After the child names 3 notes ` +
        `(words or numbers 1-6), call play_melody({ notes, variant: "original" }).`,
    };
  }

  const resolved = resolveActivityScript(activity, persona);
  if (resolved) {
    audioPlaylist = resolved.audioPlaylist;
    if (resolved.kind === 'age' && activity.scripted) {
      const bucket = activity.scripted.ageBuckets.find(
        (b) => persona.ageYears >= b.minAge && persona.ageYears <= b.maxAge,
      );
      if (bucket) matchedBucket = { minAge: bucket.minAge, maxAge: bucket.maxAge };
    }
    if (resolved.sections.length > 0) {
      const first = resolved.sections[0]!;
      sectionBlock = {
        currentSectionText: first,
        sectionNumber: 1,
        totalSections: resolved.sections.length,
        speakingInstruction:
          `Speak section 1 of ${resolved.sections.length} verbatim, then STOP your response. ` +
          `**Your response MUST begin with the first character of the section text** ` +
          `("${first.slice(0, 12)}…"). Do NOT add a preamble, acknowledgement, ` +
          `or transition phrase before it. Do NOT include any preview of section 2 — ` +
          `your turn ends after section 1. The platform will advance to section 2 only ` +
          `after the child's next message.`,
      };
    }
  }

  return {
    ok: true,
    activityId: id,
    activityName: activity.name,
    activityType: activity.type,
    audioPlaylist,
    personaAge: persona.ageYears,
    matchedBucket,
    ...(sectionBlock ?? {}),
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

// Local message shape that accommodates assistant tool_calls and tool replies.
// Using a permissive shape because the SDK's strict union types make the
// streaming-with-tools loop verbose. Validated by the SDK at send time.
type OAIMessage = Record<string, unknown>;

interface ToolCallAccum {
  id: string;
  name: string;
  argsBuf: string;
}

const MAX_TOOL_ITERATIONS = 4;

export async function registerChatRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/chat', async (request, reply) => {
    const parseResult = ChatBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parseResult.error.flatten() });
    }
    const { configId, personaId, messages, activityContext: rawActivityContext } = parseResult.data;

    const config = await readJson<StudioConfig>(`configs/${configId}.json`);
    if (!config) {
      return reply.status(404).send({ error: `Config not found: ${configId}` });
    }
    const persona = await readJson<Persona>(`personas/${personaId}.json`);
    if (!persona) {
      return reply.status(404).send({ error: `Persona not found: ${personaId}` });
    }

    // Patch the activityContext for co-creation: trust whichever of the
    // studio-provided variant and the history-inferred variant is FURTHER
    // along. The studio's ref has been racy with React state batching and
    // sometimes ships 'none' even after multiple play_melody calls — but the
    // assistant's prior messages contain the canonical Stage 3/4/5 speakText
    // markers, so history is a reliable secondary source of truth.
    let activityContext = rawActivityContext;
    if (activityContext?.activityId === 'co-creation') {
      const provided = activityContext.coCreationLastVariant ?? 'none';
      const inferred = inferCoCreationVariant(messages);
      const stageOrder: Record<'none' | 'original' | 'revised' | 'background', number> = {
        none: 0, original: 1, revised: 2, background: 3,
      };
      const chosen = stageOrder[inferred] > stageOrder[provided] ? inferred : provided;
      activityContext = { ...activityContext, coCreationLastVariant: chosen };
    }

    const systemPrompt = assembleSystemPrompt(config, persona, activityContext);
    const temperature = activityContext?.therapyMode
      ? config.personality.therapyTemperature
      : config.personality.defaultTemperature;

    const oaiMessages: OAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // ── SSE setup ────────────────────────────────────────────────────────────
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type':  'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (data: Record<string, unknown>): void => {
      raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const log = request.log.child({ route: 'chat', configId, personaId });

    try {
      const client = getClient();
      const classifier = createClauseClassifier();
      let promptTokens = 0;
      let completionTokens = 0;

      // Tool exposure:
      //   • start_activity → only when no activity is running yet
      //   • play_melody / end_activity → only when co-creation is the active activity
      //     (other scripted activities don't need these and we don't want the model
      //     to call them accidentally)
      const activityAlreadyActive = Boolean(activityContext?.activityId);
      const inCoCreation = activityContext?.activityId === 'co-creation';
      const turnTools: Array<typeof START_ACTIVITY_TOOL | typeof PLAY_MELODY_TOOL | typeof END_ACTIVITY_TOOL> = [];
      if (!activityAlreadyActive) turnTools.push(START_ACTIVITY_TOOL);
      if (inCoCreation) turnTools.push(PLAY_MELODY_TOOL, END_ACTIVITY_TOOL);

      // Co-creation: force the right tool on iter 0 based on the explicit stage.
      // The model has a habit of speaking the stage text but skipping the tool
      // call; tool_choice with a specific function name removes that option.
      //
      // Source of truth for the stage: the studio sends `coCreationLastVariant`
      // in activityContext. If it's missing (stale studio bundle, race, etc.),
      // we infer the stage from the assistant's recent speakText markers in the
      // chat history — every stage emits a uniquely-worded line, so this is
      // robust without keyword classifiers.
      const ccVariant = activityContext?.coCreationLastVariant;
      let firstIterForcedTool: string | null = null;
      if (inCoCreation) {
        if (ccVariant === 'none' || ccVariant === undefined) firstIterForcedTool = 'play_melody'; // Stage 2 — first note pick
        else if (ccVariant === 'original') firstIterForcedTool = 'play_melody';   // Stage 4
        else if (ccVariant === 'revised') firstIterForcedTool = 'play_melody';    // Stage 5
        else if (ccVariant === 'background') firstIterForcedTool = 'end_activity'; // Stage 6
      }
      log.info({ inCoCreation, ccVariantFromCtx: activityContext?.coCreationLastVariant, ccVariantUsed: ccVariant, firstIterForcedTool }, 'cc stage');

      // ── Preamble stripping ───────────────────────────────────────────────
      // The model loves to add "好呀~我们来做身体律动吧。" before the section text.
      // We buffer until we see the section's first chars, then forward from there.
      // expectedScriptStart is null when no script-driven section is expected.
      const PREAMBLE_PROBE_LEN = 8;
      const PREAMBLE_MAX_BUFFER = 200;

      function computeExpectedStart(): string | null {
        if (!activityContext?.activityId) return null;
        const activity = config!.activities.find((a) => a.id === activityContext.activityId);
        if (!activity) return null;
        const resolved = resolveActivityScript(activity, persona!);
        if (!resolved) return null;
        const idx = activityContext.sectionIndex ?? 0;
        if (idx >= resolved.sections.length) return null;
        return resolved.sections[idx]!.slice(0, PREAMBLE_PROBE_LEN);
      }

      let expectedScriptStart: string | null = computeExpectedStart();

      // Tool-call loop: stream → if tool calls, resolve → re-stream → repeat.
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        // reason: openai SDK's typed messages array is a discriminated union
        // that the loop's accumulator can't satisfy without verbose casting
        const stream = await client.chat.completions.create({
          model:       process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? '',
          messages:    oaiMessages as never,
          stream:      true,
          temperature,
          max_tokens:  800,
          ...(turnTools.length > 0
            ? {
                tools: turnTools,
                tool_choice:
                  iter === 0 && firstIterForcedTool
                    ? { type: 'function' as const, function: { name: firstIterForcedTool } }
                    : iter > 0 && firstIterForcedTool
                    // Iter 1+ after a forced tool call: ban further tool calls
                    // so the model produces the spoken text from speakingInstruction.
                    ? ('none' as const)
                    : ('auto' as const),
              }
            : {}),
        });

        const toolCalls: ToolCallAccum[] = [];
        let assistantContent = '';
        let finishReason: string | null = null;

        // Per-iteration preamble buffer (script-section alignment)
        let preambleBuffer = '';
        let preambleAligned = expectedScriptStart === null;

        // In iter 0 with a tool available, hold ALL text until the iter ends.
        // If a tool call fires, the held text was just a pre-tool lead-in and
        // gets discarded. If no tool call, we flush the held text out.
        const iter0WithTool = iter === 0 && !activityAlreadyActive;
        let iter0HeldText = '';

        const emitText = (chunkText: string): void => {
          assistantContent += chunkText;
          sendEvent({ type: 'text', delta: chunkText });
          const events = classifier.feed(chunkText);
          if (events.length > 0) {
            sendEvent({ type: 'expression', timeline: events });
          }
        };

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta;
          const usage = chunk.usage;

          if (usage) {
            promptTokens     = usage.prompt_tokens;
            completionTokens = usage.completion_tokens;
          }

          if (delta?.content) {
            if (iter0WithTool) {
              // Hold; flush or discard at end of iter 0
              iter0HeldText += delta.content;
            } else if (preambleAligned) {
              emitText(delta.content);
            } else {
              preambleBuffer += delta.content;
              const i = preambleBuffer.indexOf(expectedScriptStart!);
              if (i >= 0) {
                // Found section start — drop everything before, emit from here
                const aligned = preambleBuffer.slice(i);
                if (i > 0) {
                  log.info({ stripped: preambleBuffer.slice(0, i), sectionStart: expectedScriptStart }, 'preamble stripped');
                }
                emitText(aligned);
                preambleBuffer = '';
                preambleAligned = true;
              } else if (preambleBuffer.length > PREAMBLE_MAX_BUFFER) {
                // Bail — flush what we have, model isn't going to produce the section
                log.warn({ buffered: preambleBuffer.slice(0, 80), expected: expectedScriptStart }, 'preamble probe gave up — flushing');
                emitText(preambleBuffer);
                preambleBuffer = '';
                preambleAligned = true;
              }
            }
          }

          if (delta?.tool_calls) {
            for (const tcd of delta.tool_calls) {
              const idx = tcd.index ?? 0;
              if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', argsBuf: '' };
              const slot = toolCalls[idx]!;
              if (tcd.id) slot.id = tcd.id;
              if (tcd.function?.name) slot.name = tcd.function.name;
              if (tcd.function?.arguments) slot.argsBuf += tcd.function.arguments;
            }
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        // Iter 0 held-text resolution: tool fired → discard, no tool → flush
        if (iter0WithTool && iter0HeldText.length > 0) {
          if (toolCalls.length > 0) {
            log.info({ suppressed: iter0HeldText.slice(0, 80) }, 'pre-tool text suppressed');
            iter0HeldText = '';
          } else {
            sendEvent({ type: 'text', delta: iter0HeldText });
            assistantContent += iter0HeldText;
            const events = classifier.feed(iter0HeldText);
            if (events.length > 0) sendEvent({ type: 'expression', timeline: events });
            iter0HeldText = '';
          }
        }

        // No tool calls → flush, exit loop
        if (toolCalls.length === 0) {
          const finalEvents = classifier.flush();
          if (finalEvents.length > 0) {
            sendEvent({ type: 'expression', timeline: finalEvents });
          }
          break;
        }

        // Append the assistant turn that contained the tool calls
        oaiMessages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.argsBuf },
          })),
        });

        // Resolve each tool call, emit event, append tool reply
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.argsBuf) as Record<string, unknown>;
          } catch {
            // malformed args — pass empty; model will see error in result
          }

          let result: StartActivityResult | PlayMelodyResult | EndActivityResult;
          if (tc.name === 'start_activity') {
            result = resolveStartActivity(args as { activity_id?: string }, config, persona);
          } else if (tc.name === 'play_melody') {
            // Server-authoritative variant override: stage > model.
            // ccVariant tells us what was JUST played; the next play call is the next variant.
            const expectedVariant: CoCreationVariant | undefined =
              ccVariant === 'none' || ccVariant === undefined ? 'original'
              : ccVariant === 'original' ? 'revised'
              : ccVariant === 'revised' ? 'background'
              : undefined; // 'background' → should be end_activity, not play_melody
            const pinnedNotes = activityContext?.coCreationNotes;
            result = await resolvePlayMelody(
              args as { notes?: string[]; variant?: string },
              config,
              inCoCreation ? expectedVariant : undefined,
              inCoCreation ? pinnedNotes : undefined,
            );
          } else if (tc.name === 'end_activity') {
            // Co-creation: emit the closing line so the activity doesn't end silently.
            result = inCoCreation
              ? { ok: true, speakText: CO_CREATION_CLOSING_TEXT }
              : { ok: true };
          } else {
            result = { ok: false, error: `Unknown tool: ${tc.name}` };
          }

          sendEvent({ type: 'tool_call', name: tc.name, args, result });
          log.info({ tool: tc.name, args, result }, 'tool call resolved');

          // If the tool returned a scripted section to speak, prime the
          // preamble stripper so the model's next iteration is aligned.
          if (tc.name === 'start_activity') {
            const sectionText = (result as StartActivityResult).currentSectionText;
            if (sectionText) {
              expectedScriptStart = sectionText.slice(0, PREAMBLE_PROBE_LEN);
            }
          }

          // play_melody / end_activity — emit the canonical text directly.
          // The model often falls silent on iter 1 after a forced tool call,
          // leaving the chat with an empty assistant message. Emitting
          // server-side here ensures the user always sees the narration (or
          // the closing line) that goes with the tool.
          let serverHandledThisTurn = false;
          let speakTextForTool: string | undefined;
          if (tc.name === 'play_melody') speakTextForTool = (result as PlayMelodyResult).speakText;
          else if (tc.name === 'end_activity') speakTextForTool = (result as EndActivityResult).speakText;
          if (speakTextForTool) {
            const text = speakTextForTool;
            {
              sendEvent({ type: 'text', delta: text });
              assistantContent += text;
              const exprEvents = classifier.feed(text);
              if (exprEvents.length > 0) sendEvent({ type: 'expression', timeline: exprEvents });
              serverHandledThisTurn = true;
            }
          }

          oaiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });

          // Server already produced the narration for this turn — break out
          // of the tool-call loop so the model doesn't speak the same line
          // again on iter 1.
          if (serverHandledThisTurn) {
            const finalEvents = classifier.flush();
            if (finalEvents.length > 0) sendEvent({ type: 'expression', timeline: finalEvents });
            // exit BOTH the for-of tool loop and the outer iteration loop
            finishReason = 'stop';
            break;
          }
        }

        // If model is finished, exit
        if (finishReason && finishReason !== 'tool_calls') {
          const finalEvents = classifier.flush();
          if (finalEvents.length > 0) {
            sendEvent({ type: 'expression', timeline: finalEvents });
          }
          break;
        }
      }

      log.info({ promptTokens, completionTokens, temperature }, 'chat completed');
      sendEvent({ type: 'done', usage: { promptTokens, completionTokens } });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'chat stream error');
      sendEvent({ type: 'error', message: msg });
    } finally {
      raw.end();
    }
  });

  // ── GET /api/system-prompt — for TestChat disclosure widget ──────────────
  app.get('/api/system-prompt', async (request, reply) => {
    const { configId = 'default', personaId } = request.query as Record<string, string>;
    if (!personaId) return reply.status(400).send({ error: 'personaId required' });

    const config = await readJson<StudioConfig>(`configs/${configId}.json`);
    if (!config) return reply.status(404).send({ error: `Config not found: ${configId}` });

    const persona = await readJson<Persona>(`personas/${personaId}.json`);
    if (!persona) return reply.status(404).send({ error: `Persona not found: ${personaId}` });

    return { systemPrompt: assembleSystemPrompt(config, persona) };
  });
}
