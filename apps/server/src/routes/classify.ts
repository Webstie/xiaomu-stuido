/**
 * POST /api/classify — quick single-token classification via the chat model.
 *
 * Used by the studio's scripted intro flow so we can say "did the child mean
 * yes / no / unclear?" without hand-rolling a keyword list that misses
 * variants like "否", "否定的", "嗯哼", "nah", etc.
 *
 * Body:    { text: string, schema: 'yesno' | 'mood' | 'goodbye' }
 * Returns: { label: string }   (one of the allowed labels for that schema)
 */
import type { FastifyInstance } from 'fastify';
import { AzureOpenAI } from 'openai';
import { z } from 'zod';

const SCHEMAS = {
  yesno: {
    labels: ['yes', 'no', 'unclear'] as const,
    instruction:
      'Classify the user text as a yes/no answer to a yes/no question. ' +
      'Reply with exactly ONE word from: yes, no, unclear. ' +
      'Examples: "是" → yes; "对" → yes; "嗯" → yes; "不" → no; "不是" → no; ' +
      '"否" → no; "否定的" → no; "没有" → no; "no" → no; "yes" → yes; ' +
      'unrelated chat → unclear.',
  },
  mood: {
    labels: ['positive', 'negative', 'neutral', 'unclear'] as const,
    instruction:
      'Classify the emotional tone of the user text. Reply with exactly ONE word ' +
      'from: positive, negative, neutral, unclear.',
  },
  goodbye: {
    labels: ['yes', 'no'] as const,
    instruction:
      'Does the user text indicate they want to end the conversation / say goodbye? ' +
      'Reply with exactly ONE word: yes or no.',
  },
  'activity-intent': {
    labels: ['yes', 'no'] as const,
    instruction:
      'Does the user text express CLEAR direct intent to (a) start one of these activities — ' +
      'breathing exercise (呼吸练习), body rhythm (身体律动), emotion-to-music (情绪音乐), ' +
      'co-creation of music (音乐创作) — OR (b) skip the current intro / game / scripted ' +
      'question to do something else? ' +
      'Reply with exactly ONE word: yes or no.\n' +
      'Examples that are YES: "我想创作音乐", "想做身体律动", "可以做呼吸练习吗", ' +
      '"我们直接玩音乐吧", "我想做音乐探险", "跳过", "skip", "i want to make music".\n' +
      'Examples that are NO (just answering the scripted question): ' +
      '"是" / "不是" (yes/no to a question), "我7岁" (giving age), "晴天" / "雨天" (weather), ' +
      '"我拍完啦" (finishing rhythm game), "鸡" / "狗" / "鸟" (sound-detective guess), ' +
      '"开心" / "难过" (mood reply), "好" / "嗯" (short ack), "再见" (goodbye). ' +
      'When unsure between yes and no, choose no.',
  },
  'task-completed': {
    labels: ['yes', 'no'] as const,
    instruction:
      'In the Rhythm Story game, the child is asked to tap a rhythm and then say "我拍完啦" ' +
      'or similar when finished. Does the user text indicate they have FINISHED their task ' +
      '(tapping / clapping / drumming)? Reply with exactly ONE word: yes or no.\n' +
      'Examples that are YES: "我拍完啦", "拍完了", "做完了", "好了", "ok 我弄完了", ' +
      '"finished", "im done", "done!".\n' +
      'Examples that are NO (still doing it, off-topic, refusing, asking for help): ' +
      '"还没有", "不行", "太难了", "我不会", "再来一次", "可以重新讲一遍吗", ' +
      '"i can\'t", "this is hard", random off-topic chat.',
  },
  'sound-match': {
    labels: ['yes', 'no'] as const,
    instruction:
      'You are running the Sound Detective game. A sound was just played and the child gave ' +
      'a guess. Does the child\'s guess correctly identify the expected sound? Be lenient — ' +
      'related words, partial matches, child-appropriate descriptions, and any animal/object ' +
      'family member count as YES. Pure wrong guesses count as NO. ' +
      'The expected answer is given in the system message after "Expected:". ' +
      'Reply with exactly ONE word: yes or no.',
  },
  'quit-activity': {
    labels: ['yes', 'no'] as const,
    instruction:
      'A music-therapy activity is currently running for a child. Does the user text indicate ' +
      'they want to STOP / quit / pause the current activity, are NOT interested, refuse to ' +
      'continue, or want to switch to something else? ' +
      'Reply with exactly ONE word: yes or no.\n' +
      'Examples that are YES: "不了", "不想玩了", "我不想做这个", "不要", "停下", "别玩了", ' +
      '"不想继续", "没意思", "无聊", "skip", "stop", "no thanks", "i\'m done", "quit", ' +
      '"i don\'t want to play".\n' +
      'Examples that are NO (engaging or answering the activity question): "好", "嗯", "继续", ' +
      'note names ("Do", "Mi", "Sol"), digits ("1", "2", "3"), "1 2 3", "再来一次", "晴天", ' +
      '"换音符", "1️⃣", "魔法一", "我想换个音符", short reactions like "哇" / "好玩". ' +
      'When unsure between yes and no, choose no.',
  },
} as const;

type SchemaName = keyof typeof SCHEMAS;

const ClassifyBodySchema = z.object({
  text: z.string().min(1).max(500),
  schema: z.enum(['yesno', 'mood', 'goodbye', 'activity-intent', 'task-completed', 'sound-match', 'quit-activity']),
  /** Optional context string the schema's instruction can reference (e.g. expected answer for sound-match). */
  context: z.string().max(500).optional(),
});

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

export async function registerClassifyRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/classify', async (request, reply) => {
    const parsed = ClassifyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { text, schema, context } = parsed.data;
    const spec = SCHEMAS[schema as SchemaName];
    const systemContent = context
      ? `${spec.instruction}\n\nExpected: ${context}`
      : spec.instruction;

    try {
      const client = getClient();
      const completion = await client.chat.completions.create({
        model: process.env['AZURE_FOUNDRY_DEPLOYMENT'] ?? '',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 4,
      });
      const raw = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? '';
      const allowed = spec.labels as readonly string[];
      const label = allowed.find((l) => raw.startsWith(l)) ?? allowed[allowed.length - 1]!;
      return { label };
    } catch (err) {
      request.log.error({ err }, 'classify failed');
      // Fail open: return 'unclear' so the caller can re-prompt rather than crash.
      const allowed = spec.labels as readonly string[];
      return { label: allowed[allowed.length - 1] };
    }
  });
}
