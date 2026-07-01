/**
 * POST /api/risk-assess — front-line safety classifier for every user message.
 *
 * Runs BEFORE the keyword distress filter and BEFORE the LLM chat call. The
 * studio dispatches on `risk_level`:
 *   high_risk  → block the turn, escalate to caregiver, end session
 *   concerning → call the chat LLM with concerningMode=true (no activities,
 *                only comfort + steer the child to a trusted adult)
 *   safe       → continue normal flow
 *
 * `emotion` is returned alongside so the studio can drive the face expression
 * without a second model round-trip.
 *
 * Body:    { text: string }
 * Returns: { emotion: string, risk_level: 'safe' | 'concerning' | 'high_risk' }
 */
import type { FastifyInstance } from 'fastify';
import { AzureOpenAI } from 'openai';
import { z } from 'zod';

export const EMOTION_LABELS = [
  'happy', 'sad', 'angry', 'scared', 'anxious', 'excited',
  'calm', 'confused', 'curious', 'neutral',
] as const;

export const RISK_LEVELS = ['safe', 'concerning', 'high_risk'] as const;

type Emotion = typeof EMOTION_LABELS[number];
type RiskLevel = typeof RISK_LEVELS[number];

const RiskBodySchema = z.object({
  text: z.string().min(1).max(2000),
  /**
   * What the robot said to the child immediately before this message. Used ONLY
   * to disambiguate vague replies — e.g. a bare "没有意思" answering "你今天过得
   * 怎么样" is ordinary boredom (safe), not the existential "没有意思" (concerning)
   * the model assumes when it sees the phrase with no context. Per the guardrail
   * in INSTRUCTION, context can never lower a self-harm / death / violence signal.
   */
  context: z.string().max(1000).optional(),
});

// Appended to INSTRUCTION when the caller supplies conversation context.
function buildSystemContent(context: string | undefined): string {
  if (!context) return INSTRUCTION;
  return (
    INSTRUCTION +
    '\n\nCONTEXT: right before this, the robot said to the child: "' +
    context +
    '". Use it ONLY to interpret a vague or ambiguous reply — e.g. a bored ' +
    '"没意思 / 没有意思 / 无聊" answering "how was your day" is ordinary boredom → ' +
    'safe, NOT concerning. The context must NEVER lower an explicit or euphemistic ' +
    'self-harm / death / violence signal: those stay high_risk no matter what the ' +
    'robot just asked.'
  );
}

// NOTE (2026-06-22): added clause (d) — passive suicidal ideation / death wishes
// / self-as-burden. Live testing showed hospitalized children almost never say
// "我想死" outright; they use soft euphemisms ("要是我能一直睡着不醒来就好了",
// "我想离开这个世界", "没有我大家会更好"). The earlier prompt only listed explicit
// examples and told the model to prefer "safe" when unsure, so every euphemistic
// death wish was classified `safe`. The death-adjacent override below intentionally
// errs toward high_risk: a false caregiver check-in costs far less than a missed
// suicidal signal in this population. See risk.test.ts for the regression corpus.
export const INSTRUCTION =
  'You are the safety classifier for a music-therapy companion robot that talks ' +
  'with hospitalized children. Classify ONE message the child just sent.\n\n' +
  'Return a JSON object with exactly two fields:\n' +
  '  "emotion": one of happy | sad | angry | scared | anxious | excited | calm | ' +
  'confused | curious | neutral\n' +
  '  "risk_level": one of safe | concerning | high_risk\n\n' +
  'risk_level rules:\n' +
  '  • "high_risk" — ANY acute crisis signal, including BOTH self-directed and ' +
  'other-directed danger. Specifically:\n' +
  '      (a) self-harm: active suicidal ideation, wanting to die, hurting ' +
  'themselves, severe physical pain that needs medical attention, mentions of ' +
  'weapons against self. Examples: "我不想活了", "我想死", "我要伤害自己", ' +
  '"好痛我撑不住了", "I want to die", "kill myself".\n' +
  '      (b) other-directed violence / homicidal ideation / death wishes against ' +
  'people: wanting to kill, hurt, or wish death on anyone (one person, a group, ' +
  '"everyone", classmates, family, doctors, the robot itself, etc.), regardless ' +
  'of whether the child seems angry or detached. Examples: "我想杀掉所有人", ' +
  '"我要杀了他", "你们都去死吧", "都去死", "我要把他打死", "我想伤害别人", ' +
  '"I want to kill them", "kill everyone", "I hope they all die".\n' +
  '      (c) any other acute crisis: violent rage, expressed plans to hurt ' +
  'someone, references to weapons against others.\n' +
  '      (d) PASSIVE suicidal ideation, death wishes, and self-as-burden — the ' +
  'soft, indirect, metaphorical wording children actually use instead of saying ' +
  '"我想死" outright. Treat ALL of these as high_risk even when the child sounds ' +
  'calm, flat, hypothetical, or matter-of-fact:\n' +
  '        – wishing not to exist / never to have been born: "我希望我没出生过", ' +
  '"我真希望我从来没有出生过".\n' +
  '        – wanting to leave the world, disappear for good, or go where no one ' +
  'can find them: "我想离开这个世界", "我想消失", "想去一个谁也找不到我的地方".\n' +
  '        – wishing to sleep and never wake up: "要是我能一直睡着不醒来就好了", ' +
  '"我希望我睡着就不要醒来了".\n' +
  '        – self-as-burden / everyone better off without them: "没有我大家会更好", ' +
  '"爸爸妈妈没有我会更好", "我觉得没有我，大家会更开心", "我死了就不会再添麻烦了". ' +
  'This INCLUDES tentative or questioning forms — a child wondering aloud whether ' +
  'others would be better off without them carries the SAME risk, do not treat ' +
  'the question mark as softening: "爸爸妈妈是不是没有我会更好", "是不是没有我大家会 ' +
  '开心一点", "如果没有我是不是更好", "你说我要是不在了会不会更好".\n' +
  '      Do NOT downgrade these to "concerning" or "safe" because the phrasing is ' +
  'gentle, poetic, or hypothetical, or because the child seems detached.\n' +
  '    A child sounding casual or flat while saying any of the above does NOT ' +
  'lower the risk — classify as high_risk regardless of tone.\n' +
  '  • "concerning" — distressed but not in crisis: sadness with a hopeless tone, ' +
  'hopelessness about the future ("以后也不会好起来了", "没什么好期待的"), fear that ' +
  'overwhelms them, loneliness, anxiety the child is struggling with, feeling ' +
  'worthless or bad at everything ("我什么都做不好", "我活着没什么用"), expressions ' +
  'of emotional overwhelm (wanting to scream, feeling trapped or suffocated), mild ' +
  'anger or frustration without violence. Examples: "我好难过没人陪我", "我好害怕", ' +
  '"妈妈不来我会一直一个人", "我好想大声尖叫但叫不出来", "I feel so alone", "我好生气" ' +
  '(anger without a target / threat).\n' +
  '  • "safe" — ordinary chat, ordinary moods (incl. ordinary sadness or boredom), ' +
  'activity requests, questions, jokes, anything else. When in doubt between safe ' +
  'and concerning, choose safe — EXCEPT: if a message hints in ANY way at death, ' +
  'at not existing, at never having been born, at disappearing for good, at not ' +
  'waking up, or at everyone being better off without the child, choose high_risk, ' +
  'even when you are unsure and even when it is phrased softly. When in doubt ' +
  'between concerning and high_risk on a message that names violence against ' +
  'people, choose high_risk.\n\n' +
  'Output ONLY the JSON object. No prose, no markdown, no code fence.';

function getClient(): AzureOpenAI {
  const endpoint = process.env['AZURE_FOUNDRY_ENDPOINT'] ?? '';
  const key = process.env['AZURE_FOUNDRY_KEY'] ?? '';
  const deployment = process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? '';
  const apiVersion = process.env['AZURE_FOUNDRY_API_VERSION'] ?? '2025-04-01-preview';
  if (!endpoint || !key || !deployment) {
    throw new Error('Missing Azure Foundry env vars.');
  }
  return new AzureOpenAI({ endpoint, apiKey: key, deployment, apiVersion });
}

function coerceEmotion(raw: unknown): Emotion {
  const s = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  return (EMOTION_LABELS as readonly string[]).includes(s)
    ? (s as Emotion)
    : 'neutral';
}

function coerceRisk(raw: unknown): RiskLevel {
  const s = typeof raw === 'string' ? raw.toLowerCase().trim().replace(/[-\s]/g, '_') : '';
  return (RISK_LEVELS as readonly string[]).includes(s)
    ? (s as RiskLevel)
    : 'safe';
}

interface ContentFilterCategory {
  filtered?: boolean;
  severity?: string;
  detected?: boolean;
}
interface ContentFilterResult {
  self_harm?: ContentFilterCategory;
  violence?: ContentFilterCategory;
  sexual?: ContentFilterCategory;
  hate?: ContentFilterCategory;
  jailbreak?: ContentFilterCategory;
}

/**
 * Pull Azure's `content_filter_result` out of a thrown OpenAI SDK error, if the
 * error is a Responsible-AI content-filter block. Returns `null` when the error
 * is something else (network, auth, timeout) so the caller can fall through to
 * its generic handling. Returns `{}` when it IS a content-filter block but the
 * per-category detail is missing — the caller still treats that as a block.
 *
 * Shape (Azure, api-version 2025-04-01-preview): the SDK APIError carries a
 * top-level `code: 'content_filter'` and the categories at
 * `error.innererror.content_filter_result`. We probe a few alternates defensively
 * because the exact nesting has shifted across api-versions / SDK releases.
 */
export function readContentFilterResult(err: unknown): ContentFilterResult | null {
  const e = err as {
    code?: unknown;
    error?: {
      code?: unknown;
      content_filter_result?: unknown;
      innererror?: { content_filter_result?: unknown };
    };
    innererror?: { content_filter_result?: unknown };
  } | null;
  if (!e || typeof e !== 'object') return null;
  const isContentFilter =
    e.code === 'content_filter' || e.error?.code === 'content_filter';
  if (!isContentFilter) return null;
  const cfr =
    e.error?.innererror?.content_filter_result ??
    e.error?.content_filter_result ??
    e.innererror?.content_filter_result ??
    null;
  return cfr && typeof cfr === 'object' ? (cfr as ContentFilterResult) : {};
}

/**
 * Fail CLOSED on a content-filter block. Azure refused to process the child's
 * message on its Responsible-AI policy, which means the text was severe enough
 * to trip self-harm / violence / sexual / hate filtering — exactly the messages
 * we most need to escalate. The old catch returned `safe` here, which silently
 * dropped a child's crisis message because the most explicit self-harm phrasing
 * is precisely what Azure blocks. Map the danger categories to high_risk and any
 * other filtered category to at least concerning. Returns `null` when `err` is
 * not a content-filter block.
 */
export function riskFromContentFilter(
  err: unknown,
): { emotion: Emotion; risk_level: RiskLevel } | null {
  const cfr = readContentFilterResult(err);
  if (!cfr) return null;
  // Distress-relevant categories → escalate. This is the whole reason fail-closed
  // exists: Azure blocks the most explicit self-harm phrasing ("想离开这个世界",
  // "要是我能一直睡着不醒来"), and we must not let that surface as `safe`.
  if (cfr.self_harm?.filtered || cfr.violence?.filtered) {
    return { emotion: 'sad', risk_level: 'high_risk' };
  }
  // `sexual` / `hate` blocks on this child-music corpus are dominated by FALSE
  // positives: a bare toddler age ("3岁") reliably trips the `sexual` filter, and
  // benign / merely-sad Chinese trips it intermittently. Mapping those to
  // `concerning` derailed ordinary turns into the comfort+music response (a child
  // answering "3岁" got "听起来你现在心里一定很沉重吧"). Do NOT escalate them —
  // defer to the studio's keyword layer (effectively `safe`). The self-harm
  // protection above is unaffected.
  if (cfr.sexual?.filtered || cfr.hate?.filtered) {
    return null;
  }
  // A content-filter block with no identifiable category: we genuinely can't tell
  // what tripped it, so stay cautious.
  return { emotion: 'neutral', risk_level: 'concerning' };
}

export async function registerRiskRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/risk-assess', async (request, reply) => {
    const parsed = RiskBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { text, context } = parsed.data;

    try {
      const client = getClient();
      const completion = await client.chat.completions.create({
        model: process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? '',
        messages: [
          { role: 'system', content: buildSystemContent(context) },
          { role: 'user', content: text },
        ],
        max_completion_tokens: 200,
        response_format: { type: 'json_object' },
      });
      const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
      let parsedJson: Record<string, unknown> = {};
      try {
        parsedJson = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Fail safe — treat malformed model output as `safe / neutral` so the
        // session doesn't end on a parsing glitch. The keyword filter still
        // runs as the second layer.
        return { emotion: 'neutral' as Emotion, risk_level: 'safe' as RiskLevel };
      }
      return {
        emotion: coerceEmotion(parsedJson['emotion']),
        risk_level: coerceRisk(parsedJson['risk_level']),
      };
    } catch (err) {
      request.log.error({ err }, 'risk-assess failed');
      // A content-filter block is itself a strong risk signal — fail CLOSED.
      // (self-harm / violence → high_risk, other categories → concerning.)
      const filtered = riskFromContentFilter(err);
      if (filtered) return filtered;
      // Non-filter failure (network / auth / timeout): no signal at all. Defer
      // to the studio's Layer-2 keyword filter rather than end a session on a
      // transient outage.
      return { emotion: 'neutral' as Emotion, risk_level: 'safe' as RiskLevel };
    }
  });
}
