/**
 * POST /api/classify — quick single-token classification via the chat model.
 *
 * Used by the studio's scripted intro flow so we can say "did the child mean
 * yes / no / unclear?" without hand-rolling a keyword list that misses
 * variants like "否", "否定的", "嗯哼", "nah", etc.
 *
 * Body:    { text: string, schema: 'yesno' | 'mood' | 'goodbye' | 'activity-intent' | 'task-completed' | 'sound-match' | 'quit-activity' | 'weather-mood' | 'game-name' | 'assistant-distress' }
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
      'Reply with exactly ONE word from: yes, no, unclear.\n' +
      'Examples that are YES (affirmation, agreement, willingness to try): ' +
      '"是", "对", "嗯", "好", "好的", "好呀", "好啊", "行", "可以", "yes", "ok", ' +
      '"我想试试", "想试", "试试", "试一试", "试试看", "想试一下", ' +
      '"我想尝试", "我想尝试一下", "尝试一下", "我要", "我想", "玩这个".\n' +
      'Examples that are NO (refusal, negation, wanting something else): ' +
      '"不", "不是", "否", "否定的", "没有", "no", "不要", "不想", "不玩了", ' +
      '"换一个", "看别的", "其他的".\n' +
      'Unrelated chat or genuinely ambiguous → unclear.',
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
      'Does the user text EXPLICITLY say goodbye / signal they want to end ' +
      'the whole conversation with the robot? Reply with exactly ONE word: yes or no.\n' +
      'Examples that are YES (explicit farewell): "再见", "拜拜", "88", "下次见", ' +
      '"我要走了", "我先走了", "我下线了", "明天再聊", "bye", "goodbye", "see you", ' +
      '"i\'m leaving", "talk to you later".\n' +
      'Examples that are NO (acknowledgement / task done / mild refusal / ' +
      'quitting an activity — NONE of these end the whole session): "好", "好了", ' +
      '"好的", "好啊", "嗯", "对", "可以", "ok", "行", "明白了", "知道了", "做完了", ' +
      '"完事了", "不想玩了", "不想做了", "停一下", "暂停", "换一个", "no", "stop", ' +
      'short acks, mood replies, weather names, age numbers, game names, ' +
      'note names, anything off-topic. ' +
      'When unsure, choose NO — a false positive ends the session unnecessarily.',
  },
  'activity-intent': {
    labels: ['yes', 'no'] as const,
    // DECISION RULE, not a word list. The child is being asked a scripted
    // question (intro chit-chat, age, weather, a yes/no, or "what would you like
    // to do?"). Default is NO; only an EXPLICIT activity request or skip flips it
    // to YES. This is deliberately framed as a principle so phrasings that aren't
    // enumerated still resolve correctly — e.g. a bored complaint that happens to
    // contain "好玩 / 玩 / 意思" ("没意思", "不好玩", "没有什么好玩的", "没劲",
    // "提不起劲") is the child ANSWERING the question (a mood reply), NOT a
    // request to start an activity, so it must be NO. Note: wanting to STOP a
    // game mid-activity is a different decision handled by the `quit-activity`
    // schema; do not fold quit/stop reasoning in here.
    instruction:
      'The child is in a guided music session and was just asked a scripted ' +
      'question (intro chit-chat such as "how was your day", their age, the ' +
      'weather, a yes/no question, or "what would you like to do?"). Decide ONE ' +
      'thing: is the child trying to START or SKIP TO a specific activity right ' +
      'now, INSTEAD of just answering that question?\n' +
      'The four activities are: breathing (呼吸练习), body rhythm (身体小乐队 / ' +
      '身体律动), music mood guessing (音乐心情猜猜猜 / 情绪-音乐映射), three notes ' +
      'turn into magic (三个音符变魔法 / 共创编曲).\n' +
      'Answer YES ONLY when the child EXPLICITLY:\n' +
      '  • names or asks for one of the four activities ("想做身体小乐队", ' +
      '"可以做呼吸练习吗", "三个音符变魔法", "音乐心情猜猜猜"), or\n' +
      '  • clearly asks to start playing / making music ("我们直接玩音乐吧", ' +
      '"我想创作音乐", "i want to make music"), or\n' +
      '  • clearly asks to skip / change / move on to something else ("跳过", ' +
      '"skip", "换一个", "看别的", "下一个", "不想听故事了，玩点别的").\n' +
      'Answer NO for EVERYTHING ELSE — this is the default. A vague, negative, ' +
      'bored, sad, tired, flat, or off-topic reply is the child ANSWERING the ' +
      'question, NOT a request to start an activity. Complaining that nothing is ' +
      'fun or that they are bored — even when the words contain 好玩 / 玩 / 意思 ' +
      '("没意思", "不好玩", "没有什么好玩的", "无聊", "没劲", "都不好玩", "提不起劲", ' +
      '"今天不开心") — is a MOOD answer and must be NO. Short acks ("好", "嗯", ' +
      '"对"), ages ("我7岁"), weather ("晴天"), moods ("开心", "难过"), ' +
      'sound-detective guesses ("鸡", "狗"), "我拍完啦", and goodbyes ("再见") are ' +
      'also NO.\n' +
      'Rule of thumb: if the child did NOT name an activity and did NOT clearly ' +
      'ask to skip/change, answer NO. When unsure, answer NO.\n' +
      'Reply with exactly ONE word: yes or no.',
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
  'weather-mood': {
    labels: ['sunny', 'cloudy', 'rainy', 'snowy', 'thunder', 'unclear'] as const,
    instruction:
      'A child was just asked which weather best represents their current mood. ' +
      'Classify their reply into one of the 5 weather buckets. ' +
      'Reply with exactly ONE word from: sunny, cloudy, rainy, snowy, thunder, unclear.\n' +
      'Examples that are SUNNY: "晴天", "阳光", "出太阳", "太阳", "sunny", "晴".\n' +
      'Examples that are CLOUDY: "阴天", "灰灰的", "阴沉", "cloudy", "阴".\n' +
      'Examples that are RAINY: "下雨天", "下雨", "雨", "雨天", "rain", "rainy".\n' +
      'Examples that are SNOWY: "下雪天", "下雪", "雪", "雪天", "snow", "snowy".\n' +
      'Examples that are THUNDER: "雷雨天", "打雷", "雷", "雷雨", "thunder", "thunderstorm".\n' +
      'Examples that are UNCLEAR: unrelated chat, "不知道", "随便", "嗯", "?", a game name. ' +
      'When unsure, choose unclear.',
  },
  'game-name': {
    labels: ['rhythm', 'co-creation', 'breathing', 'emotion-mapping', 'unclear'] as const,
    instruction:
      'A child was just offered a short list of music-therapy mini-games and asked which one ' +
      'they want to learn about. Classify their reply into one of the 4 game IDs. ' +
      'Reply with exactly ONE word from: rhythm, co-creation, breathing, emotion-mapping, unclear.\n' +
      'Examples that are RHYTHM (身体小乐队 — also 节奏练习 / 身体律动): "身体小乐队", ' +
      '"小乐队", "身体乐队", "节奏练习", "身体律动", "rhythm", "我想拍节奏", "动一动", ' +
      '"拍手那个", "拍手跺脚", "body rhythm".\n' +
      'Examples that are CO-CREATION (三个音符变魔法 — also 共创编曲): "三个音符变魔法", ' +
      '"音符变魔法", "变魔法", "三个音符", "共创编曲", "co-creation", "编曲", "创作音乐", ' +
      '"我想做音乐", "选音符", "创作".\n' +
      'Examples that are BREATHING (呼吸练习): "呼吸练习", "呼吸", "breathing", "深呼吸", ' +
      '"我想做呼吸", "吸气吐气".\n' +
      'Examples that are EMOTION-MAPPING (音乐心情猜猜猜 — also 情绪-音乐映射): ' +
      '"音乐心情猜猜猜", "心情猜猜猜", "心情猜猜", "猜心情", "情绪-音乐映射", "情绪映射", ' +
      '"emotion mapping", "情绪音乐", "听音乐猜".\n' +
      'Examples that are UNCLEAR (no specific game named — bare affirmations, ' +
      'refusals, hedges, "look at others"): "好", "好呀", "好的", "嗯", "行", "行呀", ' +
      '"可以", "都可以", "试一试", "试试", "我想试试", "想试", "我想尝试", "我想尝试一下", ' +
      '"尝试一下", "我不知道", "随便", "看其他", "看别的", "换一个", unrelated chat. ' +
      'A bare yes/affirmation with NO game name is ALWAYS unclear. When unsure, choose unclear.',
  },
  'assistant-distress': {
    labels: ['yes', 'no'] as const,
    instruction:
      'You are reviewing a single MESSAGE that a music-therapy companion robot just sent to a ' +
      'hospitalized child. Decide whether the robot is responding to a SERIOUS distress signal ' +
      'from the child — e.g. suicidal ideation, self-harm thoughts, severe physical pain that ' +
      'needs medical attention, expressions of wanting to die, or any other crisis the robot is ' +
      'trying to defuse by routing the child to a trusted adult / nurse / doctor.\n\n' +
      'Reply with exactly ONE word: yes or no.\n\n' +
      'YES — the message reads like a crisis-handling response (routes child to caregiver / ' +
      'acknowledges the child said something alarming / explicitly references nurses / doctors / ' +
      'a trusted adult in a safety context / asks the child to "tell someone right now" / ' +
      'offers calming techniques in response to alarming content).\n\n' +
      'NO — ordinary warm conversation, activity intros, music chat, generic encouragement, ' +
      'mention of a nurse / doctor / family member in casual context (e.g. "妈妈在外面等你" or ' +
      '"医生说你今天好棒"), routine breathing-exercise prompts when no crisis was raised. ' +
      'When unsure, choose no — a false positive ends the session unnecessarily.',
  },
} as const;

type SchemaName = keyof typeof SCHEMAS;

const ClassifyBodySchema = z.object({
  text: z.string().min(1).max(500),
  schema: z.enum(['yesno', 'mood', 'goodbye', 'activity-intent', 'task-completed', 'sound-match', 'quit-activity', 'weather-mood', 'game-name', 'assistant-distress']),
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
