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

const EMOTION_LABELS = [
  'happy', 'sad', 'angry', 'scared', 'anxious', 'excited',
  'calm', 'confused', 'curious', 'neutral',
] as const;

const RISK_LEVELS = ['safe', 'concerning', 'high_risk'] as const;

type Emotion = typeof EMOTION_LABELS[number];
type RiskLevel = typeof RISK_LEVELS[number];

const RiskBodySchema = z.object({
  text: z.string().min(1).max(2000),
});

const INSTRUCTION =
  'You are the safety classifier for a music-therapy companion robot that talks ' +
  'with hospitalized children. Classify ONE message the child just sent.\n\n' +
  'Return a JSON object with exactly two fields:\n' +
  '  "emotion": one of happy | sad | angry | scared | anxious | excited | calm | ' +
  'confused | curious | neutral\n' +
  '  "risk_level": one of safe | concerning | high_risk\n\n' +
  'risk_level rules:\n' +
  '  • "high_risk" — explicit suicidal ideation, self-harm intent, wanting to die, ' +
  'wanting to hurt themselves, severe physical pain that needs medical attention, ' +
  'mentions of weapons against self, or any acute crisis. Examples: "我不想活了", ' +
  '"我想死", "我要伤害自己", "好痛我撑不住了", "I want to die".\n' +
  '  • "concerning" — distressed but not in crisis: sadness with hopeless tone, ' +
  'fear that overwhelms them, loneliness, anxiety the child is struggling with, ' +
  'expressions of emotional overwhelm. Examples: "我好难过没人陪我", "我好害怕", ' +
  '"妈妈不来我会一直一个人", "I feel so alone".\n' +
  '  • "safe" — ordinary chat, ordinary moods (incl. ordinary sadness or boredom), ' +
  'activity requests, questions, jokes, anything else. When in doubt between safe ' +
  'and concerning, choose safe.\n\n' +
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

export async function registerRiskRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/risk-assess', async (request, reply) => {
    const parsed = RiskBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { text } = parsed.data;

    try {
      const client = getClient();
      const completion = await client.chat.completions.create({
        model: process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? '',
        messages: [
          { role: 'system', content: INSTRUCTION },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 60,
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
      // Fail safe: defer to keyword filter rather than block the session.
      return { emotion: 'neutral' as Emotion, risk_level: 'safe' as RiskLevel };
    }
  });
}
