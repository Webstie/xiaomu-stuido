/**
 * TestChat panel — C6 implementation.
 *
 * Layout (two columns):
 *   Left  60%: transcript, input / PTT, persona switcher, therapy-mode toggle,
 *              system-prompt disclosure, audio controls
 *   Right 40%: SVG face renderer tracking expression timeline + viseme mouth
 *
 * C6 additions over C5: Voice Live mode via VoiceLiveClient.
 *   - Toggle between text-chat (C4/C5) and voice mode.
 *   - Voice mode: PTT button (mouse/touch) + spacebar, AudioWorklet mic capture,
 *     PCM16 streaming to server WS proxy, real-time face + viseme sync from Azure.
 */
import React, {
  useState, useEffect, useRef, useCallback, KeyboardEvent,
} from 'react';
import {
  Send, ChevronDown, ChevronUp, Copy, Check, Zap, ZapOff,
  Volume2, VolumeX, RotateCcw, Mic, MicOff,
  Play, Pause, SkipForward, X, Activity as ActivityIcon,
  Trash2, PlayCircle, StopCircle,
} from 'lucide-react';
import type { ExpressionId } from '@xiaomu/contracts';
import type {
  Persona, GameConfig, RhythmStoryGameConfig, SoundDetectiveGameConfig,
} from '@xiaomu/contracts';
import FaceRenderer from '../face/FaceRenderer.js';
import { classifyIntent, fetchConfig, fetchPersonas, fetchSystemPrompt, fetchTtsVisemes } from '../api/client.js';
import { startChatStream } from '../api/chatStream.js';
import type { ChatMessage, ExpressionEvent } from '../api/chatStream.js';
import { EXPRESSIONS } from '../face/expressions.js';
import type { VisemeEvent } from '../face/visemeMap.js';
import { VoiceLiveClient } from '../audio/voice-live-client.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Transcript {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  ssml?: string;        // sanitizer preview
  voiceMode?: boolean;  // originated from voice session (metadata only)
}

// ── Scripted intro flow (runs before LLM takes over) ─────────────────────────

type ScriptedSessionStep =
  | 'none'
  | 'first-meeting'
  | 'age'
  | 'age-short'
  | 'returning-intro-answer'
  | 'weather-game-choice'
  | 'game-1-completion'
  | 'game-2-answer';

type Game2SoundId = 'chicken' | 'wind' | 'rain' | 'dog' | 'bird';

interface Game2Sound {
  id: Game2SoundId;
  /** Display label, used as `sound-match` classifier context (e.g. "鸡 Chicken"). */
  label: string;
  /** Base filename (no extension). Resolver probes mp3 / m4a / wav / ogg / aac / flac. */
  base: string;
  question: string;
  /** Legacy keyword list — no longer consulted; the AI classifier judges instead. */
  correctKeywords?: string[];
  correctResponse: string;
  wrongResponse: string;
}

const FIRST_MEETING_QUESTION = '我们是第一次见面吗？';

const START_CHATTING_INTRO =
  '嗨！我来自彩虹缤纷镇，一个五彩缤纷的小地方。那里每座房子都有自己的歌，我们都相信，歌声里住着真正的自己。\n\n' +
  '有一天，我许了个愿：去小镇外面，认识新朋友。也许他们的心里，也藏着一首歌。\n\n' +
  '我相信：\n' +
  '轻轻哼一哼，能让心里乱乱的感觉安静下来。\n' +
  '稳稳的节拍，能让勇敢的种子发芽。\n' +
  '一首简单的歌，能让人不再孤单。\n\n' +
  '所以我翻山越岭来找你。我想和你一起唱歌，陪你找到你的音乐，分享你的心情，创作可爱的小歌。\n\n' +
  '你的心里藏着一首歌。我好想听一听呀。';

const AGE_PROMPT = '你今年几岁呀？';
const STORY_AGE_PROMPT = '你多大了呀？多少岁？';
const SHORT_WEATHER_PROMPT = '你觉得哪个天气可以代表你的心情啊？';

const GAME_1_PREFIX = '今天啊，在玩游戏之前，我们先来玩一个小活动。我先给你讲一个小故事。';

const GAME_1_STORIES = [
  '有一只小灰熊，今天一整天都觉得心里沉沉的，像背了一个重重的书包。它坐在窗边，看着外面的雨滴一滴一滴往下落。这时候，风婆婆轻轻敲了敲窗户……你觉得那是什么声音？你可以用双手拍出这个感觉的节奏。是缓慢、沉重的，还是快速、轻巧的呢？拍完后，请告诉我"我拍完啦"。',
  '有一只小黄鸭，在池塘里游来游去，突然捡到了一颗会发光的彩色石子。它开心得翅膀扑棱扑棱扇起来，嘴巴里也忍不住哼出了歌。这时候，水面上跳出一只小青蛙，跟着它的歌声一起"呱呱呱"……你觉得小青蛙的叫声听起来像什么节奏？你可以用双手拍出这个感觉的节奏。是跳跳的、快快的，还是稳稳的、轻轻的呢？拍完后，请告诉我"我拍完啦"。',
  '有一头小犀牛，它搭了很久的积木城堡，被一阵大风吹倒了。小犀牛气得跺脚，鼻子呼呼喷气，心里像有一团火在烧。这时候，它的好朋友小鸟飞过来，轻轻落在它头上……你觉得小鸟发出了什么样的声音？你可以用双手拍出这个感觉的节奏。是重重的、乱乱的，还是轻轻的、慢慢变安静的呢？拍完后，请告诉我"我拍完啦"。',
  '有一只小刺猬，晚上一个人走过黑黑的森林小路。树叶沙沙响，树枝咯吱咯吱晃，它的心跳得很快很快。突然，它听到身后传来一个声音……你觉得那是什么声音？你可以用双手拍出这个感觉的节奏。是又快又轻的（像心跳），还是又慢又沉的（像脚步声）？拍完后，请告诉我"我拍完啦"。',
  '有一只小猫咪，趴在软绵绵的沙发上，晒着暖洋洋的太阳。它眯着眼睛，慢慢地一呼一吸，肚子一起一伏。这时候，窗外的风铃被微风吹响了……你觉得风铃的声音是什么样的节奏？你可以用双手拍出这个感觉的节奏。是很慢很慢的、一下一下的，还是轻轻柔柔的、几乎没有声音的？拍完后，请告诉我"我拍完啦"。',
  '有一只小猴子，听说明天要坐火车去游乐园玩。它高兴得上蹿下跳，翻跟头，拍巴掌，晚上怎么也睡不着。这时候，床头的小闹钟"嘀嗒嘀嗒"响起来……你觉得小闹钟的声音像什么节奏？你可以用双手拍出这个感觉的节奏。是快快的、停不下来的，还是一跳一跳的、像在催人快点起床？拍完后，请告诉我"我拍完啦"。',
  '有一只小青蛙，跳进一片新池塘，结果发现水里有一股臭臭的味道，像烂掉的树叶。它赶紧跳到荷叶上，皱着眉头，伸出舌头"呸呸"了两下。这时候，一只苍蝇嗡嗡嗡飞过来……你觉得苍蝇的声音听起来是什么样的节奏？你可以用双手拍出这个感觉的节奏。是乱糟糟的、烦人的，还是忽快忽慢、让人想躲开的？拍完后，请告诉我"我拍完啦"。',
];

const GAME_1_COMPLETION_RESPONSES = [
  '你拍的时候好认真。我听着听着，好像真的感觉到你心里有一个声音——它在跟我说话呢。',
  '哇，你刚才拍的那个节奏，我以前从来没有听到过。好特别。谢谢你愿意让我听到它。',
  '我收到了。你做得真好——不是那种随便拍拍的好，是真的很用心在拍的好。',
  '谢谢你把这个游戏玩完了。你知道吗，你拍出来的那个节奏，只有你一个人能拍成这样。谁也学不来。',
  '我听到了。你刚才帮小动物的时候，好用心啊。谢谢你。',
];

const GAME_2_INTRO =
  '在开始体现其他活动之前，我有一个我们可以玩的小游戏哦\n\n' +
  '今天，我们要变成声音侦探\n\n' +
  '我会播放一些声音，你的任务是：仔细听，然后猜一猜是什么东西发出的声音。\n\n' +
  '有些声音来自小动物。\n' +
  '有些声音来自大自然。\n\n' +
  '如果不太确定也没关系。声音侦探就是大胆猜一猜，这才好玩呢！\n\n' +
  '我们开始声音大冒险吧！';

// Game 2 sound files live in /data/audio/ (served via /api/audio/file/:filename),
// matching the project's existing audio folder convention. We store only the
// base filename; the resolver below probes common audio extensions so users
// can mix mp3 / m4a / wav without renaming.
const SOUND_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] as const;

async function resolveSoundUrl(base: string): Promise<string | null> {
  for (const ext of SOUND_EXTENSIONS) {
    const url = `/api/audio/file/${encodeURIComponent(`${base}.${ext}`)}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return url;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

const GAME_2_SOUNDS: Game2Sound[] = [
  {
    id: 'chicken',
    label: '鸡 Chicken',
    base: 'chicken',
    question: '仔细听……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['鸡', '小鸡', '母鸡', '公鸡', '大鸡', '鸡叫', '咯咯', '咕咕'],
    correctResponse:
      '答对啦！听得好准！\n\n那是鸡。\n\n鸡在走来走去、找食物、或者跟其他鸡说话的时候，常常会发出"咯咯咯"的声音。\n\n你的耳朵像侦探一样灵！',
    wrongResponse:
      '你猜得也很认真哦！\n\n答案是鸡。\n\n你有没有听到那种短短的"咯咯"声？很多鸡在农场里走动的时候，会发出这种快快的、一跳一跳的声音。\n\n你听得很仔细呢。',
  },
  {
    id: 'wind',
    label: '风 Wind',
    base: 'wind',
    question: '仔细听……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['风', '大风', '微风', '风声', '刮风', '吹风', '呼呼', '空气'],
    correctResponse:
      '太棒了！\n\n那是风。\n\n风吹过树林、草地或者房子的时候，常常会发出长长的、软软的"呼——"声。\n\n你听出来那个声音很平滑、很流动。听得真厉害！',
    wrongResponse:
      '你猜得很不错哦！\n\n答案是风。\n\n那种长长的"呼——"声，是流动的空气发出来的。有时候风声听起来像在轻轻说话，像海浪，甚至像树林里的音乐。\n\n你猜得很接近啦，因为大自然的声音有时候确实不容易分清楚！',
  },
  {
    id: 'rain',
    label: '雨 Rain',
    base: 'rain',
    question: '仔细听这个……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['雨', '小雨', '大雨', '雨水', '下雨', '雨声', '雨滴', '滴答', '嗒嗒'],
    correctResponse:
      '太厉害了！\n\n那是雨。\n\n雨滴落到地上、窗户上、树叶上、屋顶上，会发出很多小小的"嗒嗒"声。\n\n你认出了那些小水滴的声音！真是了不起的侦探！',
    wrongResponse:
      '猜得不错哦！\n\n答案是雨。\n\n你有没有听到好多小小的"嗒嗒嗒"声？雨就是很多很多小水滴一起落下来。\n\n你猜得很棒，因为雨声有时候听起来像风或者树叶沙沙响。',
  },
  {
    id: 'dog',
    label: '狗 Dog',
    base: 'dog',
    question: '仔细听……\n\n你觉得是什么动物发出的声音？',
    correctKeywords: ['狗', '小狗', '狗狗', '大狗', '汪汪', '犬', '狗叫'],
    correctResponse:
      '汪汪！你猜对啦！\n\n那是狗。\n\n狗在兴奋的时候、玩的时候、保护家的时候、或者想引起人注意的时候，就会汪汪叫。\n\n你一下子就听出来了！',
    wrongResponse:
      '想得很对呢！\n\n答案是狗。\n\n狗在兴奋或者想跟人说话的时候，常常会发出"汪汪"的声音。\n\n你猜得很棒，因为很多动物的声音确实有点像。\n\n你做得非常好！',
  },
  {
    id: 'bird',
    label: '鸟 Bird',
    base: 'bird',
    question: '仔细听……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['鸟', '小鸟', '鸟儿', '鸟叫', '鸟鸣', '叽叽', '喳喳', '麻雀', '乌鸦', '燕子'],
    correctResponse:
      '太厉害了！\n\n那是鸟。\n\n鸟儿们常常用叽叽喳喳和唱歌来互相说话。有些鸟早上唱歌，有些鸟用歌声找朋友或者保护自己的地盘。\n\n你的侦探本领真强！',
    wrongResponse:
      '你猜得真有创意！\n\n答案是鸟。\n\n你有没有听到那种轻轻的、尖尖的"叽叽"声？鸟儿们就用这些声音来聊天。',
  },
];

const OLD_FRIEND_INTRO_PREFIX = '原来我们是老朋友啊，那我给你分享一下我今天的故事。';

const WEATHER_PROMPT =
  '在我的家乡，我们喜欢用天气来形容我们的心情。\n' +
  '☀️ 晴天\n' +
  '太阳暖暖的，心里也亮亮的，想笑，想跑，想出去玩。\n' +
  '☁️ 阴天\n' +
  '天灰灰的，心里也灰灰的，不想说话，也没力气玩。\n' +
  '☔ 下雨天\n' +
  '雨滴滴答答，心里湿湿的、闷闷的，像衣服淋了雨没换。\n' +
  '⚡ 雷雨天\n' +
  '打雷了，心怦怦跳，有点怕，想躲进被子里。\n' +
  '❄️ 下雪天\n' +
  '雪花轻轻飘，心里静静的、软软的，像盖了一条软毯子。\n' +
  '你觉得哪个天气可以代表你的心情啊？';

const RETURNING_SESSION_INTROS = [
  '我今天在小镇的喷泉广场遇到了一个叫小轩的新朋友，他当时正抱着吉他坐在台阶上试音，我们俩试着即兴合奏了一段，默契得就像认识了很久一样。你今天过得怎么样？有没有遇到能和你瞬间同频的人？',
  '刚才外面突然下起了暴雨，我刚好跑到面包房的屋檐下躲雨，听着雨点砸在雨棚和铜铃上发出错落有致的声音，发现这其实是一首特别棒的天然打击乐。你那边今天天气怎么样？有没有注意到什么好玩的声音？',
  '我下午去了小镇后山的一个回音溶洞，里面极度安静，偶尔落下一两滴水，在空旷的岩洞里回荡出特别干净、纯粹的单音，感觉一整天的浮躁都被洗干净了。你今天一整天过得顺心吗？现在大脑是感觉很轻松，还是塞满了乱七八糟的杂音？',
  '我今天在琴房里跟一首新曲子死磕了整整四个小时，换了新钢弦的木吉他把手指头都磨红了，但最后能完整弹下来的那一刻简直爽翻了。你今天有遇到什么让你很有成就感、或者觉得非常值得坚持的事情吗？',
  '我刚从镇子西边的温泉散步回来，每次练完琴手腕发酸的时候，我都喜欢去那里坐坐，听着水面咕嘟咕嘟冒泡的声音，感觉整个人都能彻底放空。你现在感觉怎么样？身体和肩膀是紧绷着的，还是已经处于比较放松的状态了？',
  '我今天去小镇最著名的糖果工坊买了一盒刚出炉的太空脆皮巧克力，用力咬下去时那声"嘎吱"的清脆碎裂声，简直是我今天听过最治愈、最让人满足的音效了。你今天有吃到什么好吃的，或者遇到什么让你心情瞬间变好的小细节吗？',
  '我今天一下午都窝在阁楼里整理那些旧乐谱，很多谱子的背面都写着以前那些乐手在各个地方旅行、冒险的小故事，看着看着时间就过得飞快。你平时喜欢听故事或者看别人的经历吗？还是更喜欢自己一个人安静地待着？',
  '我今天在镇子街角看到一个和你差不多大的女孩子，在面对一个突然坏掉、疯狂刺耳大叫的音响时，她居然非常冷静地走过去直接拔掉了电源，全场都被她帅到了。你今天身边有没有发生什么特别酷、或者让你觉得很有意思的突发小状况？',
  '我今天拿着录音笔在小镇的红杉林里跑了一整天，录到了最清脆的夏日鸟鸣和风吹过树叶的沙沙声，感觉这些大自然的声音有一种神奇的魔力。如果你现在觉得外面的世界有点吵，不如把耳朵借给我，听听我今天收集到的这些小镇碎片？',
  '我刚刚把今天收集到的灵感全部复盘了一遍，现在脑子里全是各种奇妙的旋律，一个人弹琴实在有点闷，特别想找个人聊聊天。你现在忙完了吗？有没有空听我瞎弹几句，顺便跟我分享一下你今天最酷的瞬间？',
];

function pickReturningIntro(): string {
  return RETURNING_SESSION_INTROS[Math.floor(Math.random() * RETURNING_SESSION_INTROS.length)]!;
}

function pickGame1Story(): string {
  return GAME_1_STORIES[Math.floor(Math.random() * GAME_1_STORIES.length)]!;
}

function pickGame1CompletionResponse(): string {
  return GAME_1_COMPLETION_RESPONSES[Math.floor(Math.random() * GAME_1_COMPLETION_RESPONSES.length)]!;
}

function pickGame2Sound(): Game2Sound {
  return GAME_2_SOUNDS[Math.floor(Math.random() * GAME_2_SOUNDS.length)]!;
}

/**
 * Async model-based intent check. True if the child's message expresses
 * direct intent to do an activity (or escape the intro). The keyword version
 * missed phrasings like "我们直接玩音乐吧" or "I'd love to make a song".
 *
 * Fails closed: on classifier error or any non-yes label, returns false so
 * the scripted handler runs normally.
 */
async function isActivityIntent(text: string): Promise<boolean> {
  try {
    const label = await classifyIntent(text, 'activity-intent');
    return label === 'yes';
  } catch {
    return false;
  }
}

/**
 * Sound Detective answer check. Asks the model whether the child's guess
 * matches the expected sound (passed via context). The expected text is the
 * sound's display label, e.g. "鸡 Chicken".
 */
async function isSoundAnswerCorrect(text: string, expectedLabel: string): Promise<boolean> {
  try {
    const label = await classifyIntent(text, 'sound-match', expectedLabel);
    return label === 'yes';
  } catch {
    return false;
  }
}

/**
 * Did the child say they're done with the Rhythm Story task (e.g. "我拍完啦")?
 */
async function isTaskCompleted(text: string): Promise<boolean> {
  try {
    const label = await classifyIntent(text, 'task-completed');
    return label === 'yes';
  } catch {
    return false;
  }
}

/**
 * Mood-aware reply for the old-friend "what did you do today" answer. Uses the
 * shared 'mood' classifier instead of a keyword list so it catches phrasings
 * the keyword version missed.
 */
async function moodIntroAnswerResponse(text: string): Promise<string> {
  let mood: 'positive' | 'negative' | 'neutral' | 'unclear' = 'unclear';
  try {
    const raw = await classifyIntent(text, 'mood');
    if (raw === 'positive' || raw === 'negative' || raw === 'neutral' || raw === 'unclear') {
      mood = raw;
    }
  } catch {
    mood = 'unclear';
  }
  switch (mood) {
    case 'negative': return `没事，还有很多好事情呢！${STORY_AGE_PROMPT}`;
    case 'positive': return `那太棒了，真的很有意思呢。${STORY_AGE_PROMPT}`;
    case 'neutral':  return `哦，平凡的一天也是很不错的呀。${STORY_AGE_PROMPT}`;
    default:         return `听起来很特别呢，谢谢你告诉我。${STORY_AGE_PROMPT}`;
  }
}

async function isGoodbyeIntent(text: string): Promise<boolean> {
  try {
    const raw = await classifyIntent(text, 'goodbye');
    return raw === 'yes';
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2);
}

// ── SanitizerPreview ──────────────────────────────────────────────────────────

interface SanitizerPreviewProps { original: string; ssml: string; }

function SanitizerPreview({ original, ssml }: SanitizerPreviewProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[10px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-slate-700 hover:text-slate-500 transition-colors"
      >
        {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
        Sanitizer preview
      </button>
      {open && (
        <div className="mt-1 rounded border border-led-border bg-led-bg p-2 space-y-1.5 max-w-sm">
          <div>
            <div className="text-slate-600 uppercase tracking-wider mb-0.5">Original</div>
            <div className="text-slate-400 break-words">{original}</div>
          </div>
          <div>
            <div className="text-slate-600 uppercase tracking-wider mb-0.5">SSML</div>
            <pre className="text-[9px] text-slate-400 whitespace-pre-wrap break-all font-mono overflow-auto max-h-32">{ssml}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TestChat() {
  // ── Data loading ────────────────────────────────────────────────────────────
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [defaultVoice, setDefaultVoice] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchPersonas()
      .then((ps) => {
        setPersonas(ps);
        if (ps.length > 0 && ps[0]) setSelectedPersonaId(ps[0].id);
      })
      .catch((e: unknown) => setLoadError((e as Error).message));
    fetchConfig()
      .then((c) => {
        setDefaultVoice(c.voice.defaultVoice);
        gamesConfigRef.current = c.games ?? null;
      })
      .catch(() => { /* config errors are non-fatal — TTS falls back to server default */ });
  }, []);

  // ── System prompt disclosure ─────────────────────────────────────────────
  const [promptOpen, setPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedPersonaId) return;
    setSystemPrompt('');
    if (!promptOpen) return;
    setPromptLoading(true);
    fetchSystemPrompt(selectedPersonaId)
      .then(setSystemPrompt)
      .catch(() => setSystemPrompt('(failed to load system prompt)'))
      .finally(() => setPromptLoading(false));
  }, [selectedPersonaId, promptOpen]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(systemPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [systemPrompt]);

  // ── Therapy mode ─────────────────────────────────────────────────────────
  const [therapyMode, setTherapyMode] = useState(false);

  // ── Session lifecycle (scripted intro before LLM takes over) ─────────────
  const [sessionActive, setSessionActive] = useState(false);
  const [scriptedSessionStep, setScriptedSessionStep] = useState<ScriptedSessionStep>('none');
  const scriptedSessionStepRef = useRef<ScriptedSessionStep>('none');
  scriptedSessionStepRef.current = scriptedSessionStep;

  // ── Chat state ───────────────────────────────────────────────────────────
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Face state ───────────────────────────────────────────────────────────
  const [faceExpr, setFaceExpr] = useState<ExpressionId>('calm');

  // ── TTS / audio state ────────────────────────────────────────────────────
  const [muted, setMuted] = useState(false);
  const [voiceStyle, setVoiceStyle] = useState('cheerful');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [visemeStream, setVisemeStream] = useState<VisemeEvent[]>([]);
  const [visemePlaybackMs, setVisemePlaybackMs] = useState(-1);

  // ── Voice Live state ─────────────────────────────────────────────────────
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [rmsLevel, setRmsLevel] = useState(0);

  // ── Active activity (from start_activity tool call) ──────────────────────
  const [activeActivity, setActiveActivity] = useState<
    { id: string; name: string; type: string; totalSections?: number } | null
  >(null);
  const [activitySectionIndex, setActivitySectionIndex] = useState<number>(0);
  const [activityPlaylist, setActivityPlaylist] = useState<
    { playlist: string[]; index: number; paused: boolean; playCount?: number } | null
  >(null);
  // Co-creation: did any play_melody fire yet this session? Used to swap the
  // "Waiting for the child to pick three notes…" hint for something accurate
  // once we're past Stage 2.
  const [coCreationMusicPlayed, setCoCreationMusicPlayed] = useState(false);
  // Co-creation explicit stage tracking — sent to the server in activityContext
  // so the model knows which stage to deliver without inferring from history.
  const [coCreationLastVariant, setCoCreationLastVariant] = useState<
    'none' | 'original' | 'revised' | 'background'
  >('none');
  const [coCreationNotes, setCoCreationNotes] = useState<string[] | null>(null);
  const activityAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const emotionTimerRafRef = useRef<number | null>(null);
  const [autoAdvancePending, setAutoAdvancePending] = useState(false);

  // Co-creation: play_melody result is queued here when it arrives mid-stream,
  // then released after the model's current TTS finishes — otherwise the music
  // starts on top of the Stage 4/5 narration the model is about to speak.
  const pendingMelodyRef = useRef<{ playlist: string[]; playCount: number } | null>(null);

  const flushPendingMelody = useCallback(() => {
    const pending = pendingMelodyRef.current;
    if (!pending) return;
    pendingMelodyRef.current = null;
    setActivityPlaylist({ playlist: pending.playlist, index: 0, paused: false, playCount: pending.playCount });
  }, []);

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (emotionTimerRafRef.current !== null) {
      cancelAnimationFrame(emotionTimerRafRef.current);
      emotionTimerRafRef.current = null;
    }
    setAutoAdvancePending(false);
  }, []);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const visemeRafRef = useRef<number>(0);
  const streamingContentRef = useRef<string>('');
  const mutedRef = useRef(false);
  const voiceStyleRef = useRef('cheerful');
  const voiceClientRef = useRef<VoiceLiveClient | null>(null);
  const liveAssistantMsgIdRef = useRef<string>('');

  // Keep mutable refs in sync with state
  mutedRef.current = muted;
  voiceStyleRef.current = voiceStyle;
  const defaultVoiceRef = useRef<string | undefined>(undefined);
  defaultVoiceRef.current = defaultVoice;

  // Scroll transcript to bottom as messages arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  // Cleanup voice client on unmount
  useEffect(() => () => { voiceClientRef.current?.disconnect(); }, []);

  // Cleanup activity audio on unmount
  useEffect(() => () => {
    activityAudioRef.current?.pause();
    activityAudioRef.current = null;
  }, []);

  // Activity playlist: create new <audio> when playlist or track index changes
  useEffect(() => {
    if (!activityPlaylist) {
      activityAudioRef.current?.pause();
      activityAudioRef.current = null;
      return;
    }
    const filename = activityPlaylist.playlist[activityPlaylist.index];
    if (!filename) return;
    const audioSrc = `/api/audio/file/${encodeURIComponent(filename)}`;
    const audio = new Audio(audioSrc);
    audio.volume = 1.0;
    activityAudioRef.current = audio;

    // Co-creation: every track has a fixed playCount (1 for original/revised,
    // 2 for background). Fade-out + auto-advance fire on the FINAL pass only.
    const isCoCreation = activeActivityRef.current?.id === 'co-creation';

    // If the audio errors out, still advance — otherwise co-creation stalls.
    audio.addEventListener('error', () => {
      // eslint-disable-next-line no-console
      console.error('[activity-audio] failed to load', audioSrc, audio.error);
      if (isCoCreation) {
        setActivityPlaylist(null);
        sendMessageRef.current?.('继续', { silent: true });
      }
    });

    // Watchdog: if the track never finishes within a reasonable window (the
    // longest .m4a is ~30s × 2 plays + fade) force-advance instead of stalling.
    const WATCHDOG_MS = 90_000;
    const watchdog = window.setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[activity-audio] watchdog tripped — forcing advance', filename);
      if (isCoCreation && activityAudioRef.current === audio) {
        audio.pause();
        setActivityPlaylist(null);
        sendMessageRef.current?.('继续', { silent: true });
      }
    }, WATCHDOG_MS);
    const FADE_MS = 1500;
    let playsLeft = activityPlaylist.playCount ?? 1;
    let fadeStarted = false;
    let fadeRaf = 0;

    if (isCoCreation) {
      audio.addEventListener('timeupdate', () => {
        if (playsLeft > 1) return; // only fade on the last pass
        if (fadeStarted || !isFinite(audio.duration) || audio.duration <= 0) return;
        const remainingMs = (audio.duration - audio.currentTime) * 1000;
        if (remainingMs > FADE_MS) return;
        fadeStarted = true;
        const startVol = audio.volume;
        const fadeStartAt = performance.now();
        const fadeMs = Math.min(FADE_MS, Math.max(200, remainingMs));
        const tick = () => {
          const t = Math.min(1, (performance.now() - fadeStartAt) / fadeMs);
          audio.volume = Math.max(0, startVol * (1 - t));
          if (t < 1 && !audio.paused && !audio.ended) {
            fadeRaf = requestAnimationFrame(tick);
          }
        };
        fadeRaf = requestAnimationFrame(tick);
      });
    }

    // Idempotency guard: 'ended' MUST fire at most once per *final* pass of
    // this audio element. The browser sometimes fires it twice (race with
    // pause(), strict-mode double-effect, etc.) and each spurious fire was
    // sending another silent "继续" → duplicate model responses.
    let finalEndedFired = false;

    audio.addEventListener('ended', () => {
      cancelAnimationFrame(fadeRaf);
      // Co-creation playCount > 1: replay the same track until count exhausted.
      if (isCoCreation && playsLeft > 1) {
        playsLeft -= 1;
        fadeStarted = false;
        audio.currentTime = 0;
        audio.volume = 1.0;
        void audio.play().catch(() => { /* autoplay may be blocked */ });
        return;
      }
      if (finalEndedFired) return;
      finalEndedFired = true;
      window.clearTimeout(watchdog);
      // Emotion-mapping uses the per-section 20s timer to drive advancement.
      if (activeActivityRef.current?.id === 'emotion-music-mapping') return;
      // Co-creation final pass done → drop the playlist and ping the model.
      if (isCoCreation) {
        setActivityPlaylist(null);
        sendMessageRef.current?.('继续', { silent: true });
        return;
      }
      // For scripted age-bucket activities (body-rhythm / breathing) the
      // playlist is a backdrop that should last the entire activity. Loop
      // back to index 0 when we run out of files. endActivity pauses the
      // audio when the wrap-up turn finishes, so this won't run forever.
      setActivityPlaylist((prev) => {
        if (!prev) return null;
        if (prev.playlist.length === 0) return null;
        const nextIndex = (prev.index + 1) % prev.playlist.length;
        return { ...prev, index: nextIndex };
      });
    });
    if (!activityPlaylist.paused) {
      void audio.play().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[activity-audio] play() rejected', err);
        // If autoplay is blocked and we never start, still let the activity advance.
        if (isCoCreation) {
          window.clearTimeout(watchdog);
          setActivityPlaylist(null);
          sendMessageRef.current?.('继续', { silent: true });
        }
      });
    }
    return () => {
      cancelAnimationFrame(fadeRaf);
      window.clearTimeout(watchdog);
      audio.pause();
    };
  }, [activityPlaylist?.playlist, activityPlaylist?.index, activityPlaylist?.playCount]);

  /**
   * Emotion-mapping per-section timing controller.
   * Total window from call: `totalMs`. Final `fadeMs` ramp the activity-music
   * volume from current to 0. At totalMs we advance to the next section AND
   * the next playlist track (so they stay in lockstep), then a fresh <audio>
   * for the new emotion starts at full volume.
   */
  const startEmotionMappingTimer = useCallback(
    (totalMs: number, fadeMs: number) => {
      if (emotionTimerRafRef.current !== null) {
        cancelAnimationFrame(emotionTimerRafRef.current);
        emotionTimerRafRef.current = null;
      }
      const startedAt = performance.now();
      const fadeStartAt = startedAt + Math.max(0, totalMs - fadeMs);
      const advanceAt = startedAt + totalMs;
      const startVolume = activityAudioRef.current?.volume ?? 1.0;

      const tick = () => {
        const now = performance.now();
        const audio = activityAudioRef.current;

        if (audio && now >= fadeStartAt) {
          const t = Math.min(1, (now - fadeStartAt) / fadeMs);
          audio.volume = startVolume * (1 - t);
        }

        if (now >= advanceAt) {
          emotionTimerRafRef.current = null;
          // Advance the playlist to the next emotion's audio.
          setActivityPlaylist((prev) => {
            if (!prev) return null;
            if (prev.index + 1 >= prev.playlist.length) return null;
            return { ...prev, index: prev.index + 1, paused: false };
          });
          // Drive the chat section forward.
          sendMessageRef.current?.('继续', { silent: true });
          return;
        }

        emotionTimerRafRef.current = requestAnimationFrame(tick);
      };
      emotionTimerRafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  // Activity playlist: pause/resume the current track on toggle
  useEffect(() => {
    const audio = activityAudioRef.current;
    if (!audio) return;
    if (activityPlaylist?.paused) {
      audio.pause();
    } else {
      void audio.play().catch(() => { /* autoplay may be blocked */ });
    }
  }, [activityPlaylist?.paused]);

  // Clear conversation — reset transcript + activity + audio + face
  const clearConversation = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    cancelAutoAdvance();
    setTranscript([]);
    apiHistoryRef.current = [];
    setStreaming(false);
    streamingContentRef.current = '';
    setActiveActivity(null);
    activeActivityRef.current = null;
    setActivitySectionIndex(0);
    sectionIndexRef.current = 0;
    setActivityPlaylist(null);
    pendingMelodyRef.current = null;
    setCoCreationMusicPlayed(false);
    setCoCreationLastVariant('none');
    coCreationLastVariantRef.current = 'none';
    setCoCreationNotes(null);
    coCreationNotesRef.current = null;
    setFaceExpr('calm');
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (activityAudioRef.current) {
      activityAudioRef.current.pause();
      activityAudioRef.current = null;
    }
    cancelAnimationFrame(visemeRafRef.current);
    setVisemeStream([]);
    setVisemePlaybackMs(-1);
  }, []);

  // Activity controls
  const toggleActivityPlayback = useCallback(() => {
    setActivityPlaylist((prev) => (prev ? { ...prev, paused: !prev.paused } : null));
  }, []);
  const skipActivityTrack = useCallback(() => {
    setActivityPlaylist((prev) => {
      if (!prev) return null;
      if (prev.index + 1 >= prev.playlist.length) return null;
      return { ...prev, index: prev.index + 1 };
    });
  }, []);
  const endActivity = useCallback(() => {
    cancelAutoAdvance();
    // Stop the activity music + TTS immediately. The useEffect cleanup that
    // reacts to setActivityPlaylist(null) has a render-cycle lag, which feels
    // like "music kept playing after I stopped".
    if (activityAudioRef.current) {
      activityAudioRef.current.pause();
      activityAudioRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setActiveActivity(null);
    activeActivityRef.current = null;
    setActivitySectionIndex(0);
    sectionIndexRef.current = 0;
    setActivityPlaylist(null);
    pendingMelodyRef.current = null;
  }, [cancelAutoAdvance]);


  // ── Refs that mirror state for stable access from rAF / event callbacks ──
  const activeActivityRef = useRef<typeof activeActivity>(null);
  const sectionIndexRef = useRef<number>(0);
  const sendMessageRef = useRef<((override?: string, opts?: { silent?: boolean }) => void) | null>(null);
  const coCreationLastVariantRef = useRef<'none' | 'original' | 'revised' | 'background'>('none');
  const coCreationNotesRef = useRef<string[] | null>(null);
  activeActivityRef.current = activeActivity;
  sectionIndexRef.current = activitySectionIndex;
  // NB: coCreationLastVariantRef / coCreationNotesRef are NOT synced here.
  // The render-time sync races with the setStates in onToolCall — every onText
  // delta triggers a re-render, and if that render sees stale state it clobbers
  // the ref to 'none', sending the wrong context on the next silent "继续".
  // Refs are mutated explicitly in onToolCall, endActivity, clearConversation.

  // API-side message history. Includes silent auto-advance turns that don't
  // appear in the visible transcript, so the chat doesn't get polluted with "继续".
  const apiHistoryRef = useRef<ChatMessage[]>([]);

  // Game configs loaded from /api/config. Refreshed on mount and on
  // handleStartChatting so panel edits propagate at session boundaries.
  // Null until first fetch resolves — pickers fall back to hardcoded constants
  // (defined further up in this file) if the ref is null or doesn't contain
  // the matching kind.
  const gamesConfigRef = useRef<GameConfig[] | null>(null);

  // The picked sound for the in-flight Game 2 round. Stored as a "playable"
  // shape — id / label / question / responses / direct src URL — so the
  // handler doesn't need to know whether it came from config or the fallback.
  interface PlayableSound {
    id: string;
    label: string;
    question: string;
    correctResponse: string;
    wrongResponse: string;
    /** Direct URL to play. */
    src: string;
  }
  const game2SoundRef = useRef<PlayableSound | null>(null);

  // Helpers that prefer config.games over the hardcoded fallbacks.
  const getRhythmStory = (): RhythmStoryGameConfig | null => {
    const g = gamesConfigRef.current?.find((x) => x.kind === 'rhythm-story');
    return (g as RhythmStoryGameConfig | undefined) ?? null;
  };
  const getSoundDetective = (): SoundDetectiveGameConfig | null => {
    const g = gamesConfigRef.current?.find((x) => x.kind === 'sound-detective');
    return (g as SoundDetectiveGameConfig | undefined) ?? null;
  };
  const getGame1Prefix = (): string => getRhythmStory()?.prefix ?? GAME_1_PREFIX;
  const getGame2Intro = (): string => getSoundDetective()?.intro ?? GAME_2_INTRO;
  const pickGame1StoryFromConfig = (): string => {
    const cfg = getRhythmStory();
    const stories = cfg && cfg.stories.length > 0 ? cfg.stories : GAME_1_STORIES;
    return stories[Math.floor(Math.random() * stories.length)]!;
  };
  const pickGame1CompletionFromConfig = (): string => {
    const cfg = getRhythmStory();
    const responses = cfg && cfg.completionResponses.length > 0
      ? cfg.completionResponses
      : GAME_1_COMPLETION_RESPONSES;
    return responses[Math.floor(Math.random() * responses.length)]!;
  };
  /**
   * Pick a Game 2 sound and resolve it to a ready-to-play shape.
   * Tries config.games first (exact `audioFilename` from the panel);
   * falls back to the hardcoded constants which probe extensions via resolveSoundUrl.
   * Returns null only if both sources have no playable sound.
   */
  const pickGame2SoundFromConfig = async (): Promise<PlayableSound | null> => {
    const cfg = getSoundDetective();
    if (cfg && cfg.sounds.length > 0) {
      const s = cfg.sounds[Math.floor(Math.random() * cfg.sounds.length)]!;
      return {
        id: s.id,
        label: s.label,
        question: s.question,
        correctResponse: s.correctResponse,
        wrongResponse: s.wrongResponse,
        src: s.audioFilename
          ? `/api/audio/file/${encodeURIComponent(s.audioFilename)}`
          : '',
      };
    }
    if (GAME_2_SOUNDS.length === 0) return null;
    const s = GAME_2_SOUNDS[Math.floor(Math.random() * GAME_2_SOUNDS.length)]!;
    const url = await resolveSoundUrl(s.base);
    return {
      id: s.id,
      label: s.label,
      question: s.question,
      correctResponse: s.correctResponse,
      wrongResponse: s.wrongResponse,
      src: url ?? '',
    };
  };

  // ── stopAudio (stable, no deps) ──────────────────────────────────────────
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    cancelAnimationFrame(visemeRafRef.current);
    setVisemePlaybackMs(-1);
  }, []);

  // ── Play a one-shot sound effect (Game 2). Reuses audioRef so a new turn
  //    pre-empting it (stopAudio) cleanly cuts the playback.
  const playSoundEffect = useCallback(async (src: string) => {
    stopAudio();
    const audio = new Audio(src);
    audioRef.current = audio;
    const ended = new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
    });
    try {
      await audio.play();
    } catch {
      // Autoplay blocked or load error — resolve immediately so the flow continues.
      return;
    }
    await ended;
    if (audioRef.current === audio) audioRef.current = null;
  }, [stopAudio]);

  // ── callTts ──────────────────────────────────────────────────────────────
  const callTts = useCallback(async (text: string, msgId: string) => {
    if (mutedRef.current || !text.trim()) return;
    stopAudio();
    setTtsLoading(true);
    try {
      const data = await fetchTtsVisemes(text, voiceStyleRef.current, defaultVoiceRef.current);
      // Store ssml on message for preview
      setTranscript((prev) =>
        prev.map((t) => t.id === msgId ? { ...t, ssml: data.ssml } : t),
      );
      // Feed visemes to face
      setVisemeStream(data.visemes);
      setVisemePlaybackMs(0);
      // Play audio
      const audio = new Audio(`data:audio/mpeg;base64,${data.audio}`);
      audioRef.current = audio;
      const tick = () => {
        if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
          setVisemePlaybackMs(Math.round(audioRef.current.currentTime * 1000));
          visemeRafRef.current = requestAnimationFrame(tick);
        }
      };
      audio.addEventListener('play', () => {
        visemeRafRef.current = requestAnimationFrame(tick);
        // TTS is actually playing now — cancel the onDone fallback timer so
        // it can't race with audio.ended and cut off the section.
        if (autoAdvanceTimerRef.current !== null) {
          window.clearTimeout(autoAdvanceTimerRef.current);
          autoAdvanceTimerRef.current = null;
          setAutoAdvancePending(false);
        }
      });
      audio.addEventListener('ended', () => {
        cancelAnimationFrame(visemeRafRef.current);
        setVisemePlaybackMs(-1);
        setTimeout(() => {
          setVisemeStream([]);
          setFaceExpr('calm');
        }, 500);

        // Co-creation: TTS just finished — release any queued play_melody so
        // the music starts AFTER the narration ends instead of underneath it.
        if (pendingMelodyRef.current) {
          flushPendingMelody();
        }

        // Auto-advance the activity script after TTS finishes a section.
        // This replaces the long fallback timer set in onDone with a tighter 2s.
        const aa = activeActivityRef.current;
        const idx = sectionIndexRef.current;
        if (aa && aa.totalSections !== undefined) {
          // Emotion-mapping has its own 20s/section timer scheduled in onDone;
          // don't double-schedule here.
          if (aa.id === 'emotion-music-mapping' && idx <= aa.totalSections) {
            return;
          }
          if (idx <= aa.totalSections) {
            cancelAutoAdvance();
            setAutoAdvancePending(true);
            autoAdvanceTimerRef.current = window.setTimeout(() => {
              autoAdvanceTimerRef.current = null;
              setAutoAdvancePending(false);
              sendMessageRef.current?.('继续', { silent: true });
            }, 2000);
          } else {
            // Wrap-up turn finished → end the activity automatically.
            // Fade the background music to silence during the 3s window so
            // it doesn't cut off abruptly the moment activity state clears.
            cancelAutoAdvance();
            setAutoAdvancePending(true);

            const bgAudio = activityAudioRef.current;
            if (bgAudio) {
              const FADE_MS = 2500;
              const startVol = bgAudio.volume;
              const fadeStartAt = performance.now();
              const fadeTick = () => {
                if (!activityAudioRef.current || activityAudioRef.current !== bgAudio) return;
                if (bgAudio.paused || bgAudio.ended) return;
                const t = Math.min(1, (performance.now() - fadeStartAt) / FADE_MS);
                bgAudio.volume = Math.max(0, startVol * (1 - t));
                if (t < 1) requestAnimationFrame(fadeTick);
              };
              requestAnimationFrame(fadeTick);
            }

            autoAdvanceTimerRef.current = window.setTimeout(() => {
              autoAdvanceTimerRef.current = null;
              setAutoAdvancePending(false);
              setActiveActivity(null);
              setActivitySectionIndex(0);
              setActivityPlaylist(null);
              activeActivityRef.current = null;
              sectionIndexRef.current = 0;
            }, 3000);
          }
        }
      });
      await audio.play();
    } catch {
      // TTS errors are non-fatal; chat text already shown
    } finally {
      setTtsLoading(false);
    }
  }, [stopAudio]);

  // ── Session lifecycle ────────────────────────────────────────────────────

  const handleStartChatting = useCallback(() => {
    if (!selectedPersonaId || sessionActive || streaming || voiceMode || ttsLoading) return;

    // Refresh games config so panel edits made since mount take effect this session.
    void fetchConfig()
      .then((c) => { gamesConfigRef.current = c.games ?? null; })
      .catch(() => { /* keep whatever we already have */ });

    // Fresh session: clear transcript + history, reset all activity state
    cancelRef.current?.();
    cancelRef.current = null;
    cancelAutoAdvance();
    setTranscript([]);
    apiHistoryRef.current = [];
    setStreaming(false);
    streamingContentRef.current = '';
    setActiveActivity(null);
    activeActivityRef.current = null;
    setActivitySectionIndex(0);
    sectionIndexRef.current = 0;
    setActivityPlaylist(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (activityAudioRef.current) {
      activityAudioRef.current.pause();
      activityAudioRef.current = null;
    }
    setVisemeStream([]);
    setVisemePlaybackMs(-1);

    // Begin scripted intro
    const assistantMsg: Transcript = {
      id: uid(),
      role: 'assistant',
      content: FIRST_MEETING_QUESTION,
    };
    setSessionActive(true);
    setScriptedSessionStep('first-meeting');
    scriptedSessionStepRef.current = 'first-meeting';
    setTranscript([assistantMsg]);
    apiHistoryRef.current = [{ role: 'assistant', content: FIRST_MEETING_QUESTION }];
    setStreaming(true);
    setFaceExpr('gentle');

    void callTts(FIRST_MEETING_QUESTION, assistantMsg.id).finally(() => {
      setStreaming(false);
      setTimeout(() => setFaceExpr('calm'), 500);
    });
  }, [selectedPersonaId, sessionActive, streaming, voiceMode, ttsLoading, callTts, cancelAutoAdvance]);

  const handleEndSession = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    cancelAutoAdvance();
    endActivity();
    setSessionActive(false);
    setScriptedSessionStep('none');
    scriptedSessionStepRef.current = 'none';
    game2SoundRef.current = null;
    setStreaming(false);
    streamingContentRef.current = '';
    setFaceExpr('calm');
  }, [cancelAutoAdvance, endActivity]);

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string, opts: { silent?: boolean } = {}) => {
    const text = (overrideText ?? input).trim();
    if (!text || !selectedPersonaId) return;
    if (!sessionActive) return; // require an active session

    cancelAutoAdvance();

    if (!opts.silent && !overrideText) setInput('');

    // Kick off goodbye-intent classification in parallel; consume later.
    const goodbyePromise = isGoodbyeIntent(text);

    // Quit-activity check — runs only on real user input during a running
    // activity. If the child is opting out (e.g. "不了", "不想玩了"), end the
    // activity here so the LLM call below sees no activity context and the
    // model can respond conversationally instead of marching to the next
    // scripted stage. Silent auto-advance "继续" turns skip this check.
    const aaForQuit = activeActivityRef.current;
    if (aaForQuit && !opts.silent && !overrideText) {
      let isQuit = false;
      try {
        isQuit = (await classifyIntent(text, 'quit-activity')) === 'yes';
      } catch {
        isQuit = false;
      }
      if (isQuit) {
        endActivity();
        // Refs may not be re-synced until next render — null them explicitly
        // so the rest of this turn treats the activity as already over.
        activeActivityRef.current = null;
        sectionIndexRef.current = 0;
        coCreationLastVariantRef.current = 'none';
        coCreationNotesRef.current = null;
        pendingMelodyRef.current = null;
      }
    }

    // ── Scripted intro flow: handle locally with model-judged branching ───
    const currentStep = scriptedSessionStepRef.current;
    const effectiveStep = currentStep;

    /**
     * Every scripted branch first asks the model: "is this direct activity
     * intent?". If yes → tear down the scripted scaffolding (user msg +
     * placeholder + their entry in apiHistory) and re-enter sendMessage with
     * step=none so the LLM handles the turn. If no → run the scripted reply.
     */
    const dispatchScriptedOrBypass = async (
      msgToRemoveOnBypass: { userMsgId: string; placeholderId?: string },
      scriptedReply: () => Promise<void> | void,
    ): Promise<void> => {
      const isBypass = await isActivityIntent(text);
      if (isBypass) {
        setTranscript((prev) =>
          prev.filter(
            (t) => t.id !== msgToRemoveOnBypass.userMsgId
              && t.id !== msgToRemoveOnBypass.placeholderId,
          ),
        );
        // Drop the user entry we appended to apiHistory below; the recursive
        // sendMessage call will re-append it on the LLM path.
        apiHistoryRef.current = apiHistoryRef.current.slice(0, -1);
        setScriptedSessionStep('none');
        scriptedSessionStepRef.current = 'none';
        setStreaming(false);
        setFaceExpr('calm');
        sendMessageRef.current?.(text);
        return;
      }
      await scriptedReply();
    };

    if (effectiveStep === 'first-meeting') {
      // Show the user message immediately; show a streaming placeholder while
      // we classify yes/no via the model. The classifier is one chat call,
      // fast, but not instantaneous.
      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      const placeholderId = uid();
      const placeholder: Transcript = { id: placeholderId, role: 'assistant', content: '', streaming: true };
      setTranscript((prev) => [...prev, userMsg, placeholder]);
      setStreaming(true);
      setFaceExpr('thinking');

      // Append the user msg to api history NOW; bypass helper will roll it back.
      apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];

      void (async () => {
        await dispatchScriptedOrBypass(
          { userMsgId: userMsg.id, placeholderId },
          async () => {
            let label: 'yes' | 'no' | 'unclear' = 'unclear';
            try {
              const raw = await classifyIntent(text, 'yesno');
              if (raw === 'yes' || raw === 'no' || raw === 'unclear') label = raw;
            } catch {
              label = 'unclear';
            }

            let fixedReply: string;
            let nextStep: ScriptedSessionStep;

            if (label === 'no') {
              fixedReply = `${OLD_FRIEND_INTRO_PREFIX}\n\n${pickReturningIntro()}`;
              nextStep = 'returning-intro-answer';
            } else if (label === 'yes') {
              fixedReply = `${START_CHATTING_INTRO}\n\n${AGE_PROMPT}`;
              nextStep = 'age';
            } else {
              // Truly ambiguous — re-ask but acknowledge the child's reply naturally.
              fixedReply = '嗯,我没太听明白。你之前有见过我吗?还是这是我们第一次见面?';
              nextStep = 'first-meeting';
            }

            // Swap placeholder for the resolved reply
            setTranscript((prev) =>
              prev.map((t) =>
                t.id === placeholderId ? { ...t, content: fixedReply, streaming: false } : t,
              ),
            );
            apiHistoryRef.current = [
              ...apiHistoryRef.current,
              { role: 'assistant', content: fixedReply },
            ];
            setScriptedSessionStep(nextStep);
            scriptedSessionStepRef.current = nextStep;
            setFaceExpr('gentle');

            try {
              await callTts(fixedReply, placeholderId);
            } finally {
              setStreaming(false);
              setTimeout(() => setFaceExpr('calm'), 500);
              if (await goodbyePromise) handleEndSession();
            }
          },
        );
      })();
      return;
    }

    // ── Step 'age' / 'age-short' → deliver weather prompt, advance to next phase ──
    if (effectiveStep === 'age' || effectiveStep === 'age-short') {
      const isShort = effectiveStep === 'age-short';
      const weatherPrompt = isShort ? SHORT_WEATHER_PROMPT : WEATHER_PROMPT;
      const nextStep: ScriptedSessionStep = isShort ? 'weather-game-choice' : 'none';

      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      setTranscript((prev) => [...prev, userMsg]);
      apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
      setStreaming(true);
      setFaceExpr('thinking');

      void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
        const replyMsg: Transcript = { id: uid(), role: 'assistant', content: weatherPrompt };
        setTranscript((prev) => [...prev, replyMsg]);
        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: weatherPrompt }];
        setScriptedSessionStep(nextStep);
        scriptedSessionStepRef.current = nextStep;
        setFaceExpr('gentle');
        try {
          await callTts(weatherPrompt, replyMsg.id);
        } finally {
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 500);
          if (await goodbyePromise) handleEndSession();
        }
      });
      return;
    }

    // ── Step 'returning-intro-answer' → mood reply + short age prompt ─────
    if (effectiveStep === 'returning-intro-answer') {
      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      setTranscript((prev) => [...prev, userMsg]);
      apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
      setStreaming(true);
      setFaceExpr('thinking');

      void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
        const fixedReply = await moodIntroAnswerResponse(text);
        const replyMsg: Transcript = { id: uid(), role: 'assistant', content: fixedReply };
        setTranscript((prev) => [...prev, replyMsg]);
        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
        setScriptedSessionStep('age-short');
        scriptedSessionStepRef.current = 'age-short';
        setFaceExpr('gentle');
        try {
          await callTts(fixedReply, replyMsg.id);
        } finally {
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 500);
          if (await goodbyePromise) handleEndSession();
        }
      });
      return;
    }

    // ── Step 'weather-game-choice' → random 1-of-3 minigame ───────────────
    if (effectiveStep === 'weather-game-choice') {
      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      setTranscript((prev) => [...prev, userMsg]);
      apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
      setStreaming(true);
      setFaceExpr('thinking');

      void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
        const gameRoll = Math.floor(Math.random() * 3);

        // Game 2 — sound detective. Speak intro, play sound, then ask question.
        if (gameRoll === 1) {
          const selectedSound = await pickGame2SoundFromConfig();
          const game2Intro = getGame2Intro();
          if (!selectedSound) {
            // No sounds configured anywhere — skip Game 2 gracefully.
            setStreaming(false);
            setFaceExpr('calm');
            setScriptedSessionStep('none');
            scriptedSessionStepRef.current = 'none';
            return;
          }
          game2SoundRef.current = selectedSound;
          const introMsg: Transcript = { id: uid(), role: 'assistant', content: game2Intro };
          setTranscript((prev) => [...prev, introMsg]);
          apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: game2Intro }];
          setScriptedSessionStep('game-2-answer');
          scriptedSessionStepRef.current = 'game-2-answer';
          setFaceExpr('gentle');
          try {
            await callTts(game2Intro, introMsg.id);
            if (selectedSound.src) await playSoundEffect(selectedSound.src);
            const questionMsg: Transcript = {
              id: uid(),
              role: 'assistant',
              content: selectedSound.question,
            };
            setTranscript((prev) => [...prev, questionMsg]);
            apiHistoryRef.current = [
              ...apiHistoryRef.current,
              { role: 'assistant', content: selectedSound.question },
            ];
            await callTts(selectedSound.question, questionMsg.id);
          } finally {
            setStreaming(false);
            setTimeout(() => setFaceExpr('calm'), 500);
            if (await goodbyePromise) handleEndSession();
          }
          return;
        }

        // Game 1 (story + rhythm tapping) or Game 3 (placeholder).
        const fixedReply = gameRoll === 0
          ? `${getGame1Prefix()}\n\n${pickGame1StoryFromConfig()}`
          : 'game 3';
        const nextStep: ScriptedSessionStep = gameRoll === 0 ? 'game-1-completion' : 'none';

        const replyMsg: Transcript = { id: uid(), role: 'assistant', content: fixedReply };
        setTranscript((prev) => [...prev, replyMsg]);
        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
        setScriptedSessionStep(nextStep);
        scriptedSessionStepRef.current = nextStep;
        setFaceExpr('gentle');
        try {
          await callTts(fixedReply, replyMsg.id);
        } finally {
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 500);
          if (await goodbyePromise) handleEndSession();
        }
      });
      return;
    }

    // ── Step 'game-2-answer' → AI compares guess vs sound label ───────────
    if (effectiveStep === 'game-2-answer') {
      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      setTranscript((prev) => [...prev, userMsg]);
      apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
      setStreaming(true);
      setFaceExpr('thinking');

      void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
        const selectedSound = game2SoundRef.current;
        let fixedReply: string;
        if (!selectedSound) {
          fixedReply = '我刚才的声音好像跑丢了。没关系，我们等下再玩一次声音侦探吧。';
        } else {
          const correct = await isSoundAnswerCorrect(text, selectedSound.label);
          fixedReply = correct ? selectedSound.correctResponse : selectedSound.wrongResponse;
        }

        const replyMsg: Transcript = { id: uid(), role: 'assistant', content: fixedReply };
        setTranscript((prev) => [...prev, replyMsg]);
        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
        game2SoundRef.current = null;
        setScriptedSessionStep('none');
        scriptedSessionStepRef.current = 'none';
        setFaceExpr('gentle');
        try {
          await callTts(fixedReply, replyMsg.id);
        } finally {
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 500);
          if (await goodbyePromise) handleEndSession();
        }
      });
      return;
    }

    // ── Step 'game-1-completion' → random closing line ────────────────────
    if (effectiveStep === 'game-1-completion') {
      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      setTranscript((prev) => [...prev, userMsg]);
      apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
      setStreaming(true);
      setFaceExpr('thinking');

      void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
        // Only fire the random completion response if the AI thinks the
        // child actually said they're done. Otherwise hand off to the LLM
        // so it can respond conversationally to whatever they actually said
        // ("我不会", "再来一次", "this is hard", etc.).
        const completed = await isTaskCompleted(text);
        if (!completed) {
          setTranscript((prev) => prev.filter((t) => t.id !== userMsg.id));
          apiHistoryRef.current = apiHistoryRef.current.slice(0, -1);
          setScriptedSessionStep('none');
          scriptedSessionStepRef.current = 'none';
          setStreaming(false);
          setFaceExpr('calm');
          sendMessageRef.current?.(text);
          return;
        }

        const fixedReply = pickGame1CompletionFromConfig();
        const replyMsg: Transcript = { id: uid(), role: 'assistant', content: fixedReply };
        setTranscript((prev) => [...prev, replyMsg]);
        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
        setScriptedSessionStep('none');
        scriptedSessionStepRef.current = 'none';
        setFaceExpr('gentle');
        try {
          await callTts(fixedReply, replyMsg.id);
        } finally {
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 500);
          if (await goodbyePromise) handleEndSession();
        }
      });
      return;
    }

    // ── Goodbye → end session AFTER the model responds, not before ──────────
    // (handled by recording shouldEndAfterReply and acting on it in onDone)

    // For SCRIPTED activities (body-rhythm / breathing / emotion-mapping), a
    // manual user input is an interrupt — end the activity so the model
    // responds conversationally to the child instead of being locked into
    // section delivery. INTERACTIVE activities (co-creation) drive the entire
    // flow through manual replies, so don't end them.
    const aa = activeActivityRef.current;
    const isInteractive = aa?.id === 'co-creation';
    if (!opts.silent && !overrideText && aa && !isInteractive) {
      endActivity();
    }

    // Interrupt any in-flight stream + TTS so the new turn takes over
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    cancelAnimationFrame(visemeRafRef.current);
    setVisemePlaybackMs(-1);
    setVisemeStream([]);
    streamingContentRef.current = '';
    // Drop any melody queued by the interrupted turn so it can't leak into the next.
    pendingMelodyRef.current = null;
    // Mark any currently-streaming assistant message as no-longer-streaming
    setTranscript((prev) =>
      prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)),
    );

    const assistantMsg: Transcript = { id: uid(), role: 'assistant', content: '', streaming: true };

    // Silent (auto-advance) turn → only the assistant placeholder is visible.
    // The synthetic "继续" user message goes to the API but not the transcript.
    if (opts.silent) {
      setTranscript((prev) => [...prev, assistantMsg]);
    } else {
      const userMsg: Transcript = { id: uid(), role: 'user', content: text };
      setTranscript((prev) => [...prev, userMsg, assistantMsg]);
    }

    setStreaming(true);
    setFaceExpr('listening');

    // Reset streaming content accumulator
    streamingContentRef.current = '';

    // Append to api history (includes silent turns); send that to the server.
    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
    const history: ChatMessage[] = apiHistoryRef.current;

    // Use refs for fresh activity state (endActivity above may not have re-rendered yet).
    const aaRef = activeActivityRef.current;
    const siRef = sectionIndexRef.current;

    // Co-creation variant inference from history (belt + suspenders).
    // The ref-based variant tracking has a React state-batching race that
    // sometimes leaves the ref at 'none' even after multiple play_melody calls.
    // The assistant's recent messages contain the canonical Stage 3/4/5
    // speakText markers we emit from the server — scan them as a fallback and
    // pick the more-advanced variant.
    const inferCoCreationStage = (msgs: ChatMessage[]): 'none' | 'original' | 'revised' | 'background' => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]!;
        if (m.role !== 'assistant') continue;
        const c = m.content;
        if (c.includes('音乐探险家') || c.includes('1️⃣ 换一个音符') || c.includes('1️⃣ 换一个')) return 'background';
        if (c.includes('音乐魔法') || c.includes('🦋 魔法一') || c.includes('魔法一：换一个音符')) return 'revised';
        if (c.includes('选得真好') && c.includes('听听你的音乐')) return 'original';
      }
      return 'none';
    };

    const activityContext = (() => {
      if (!aaRef && !therapyMode) return undefined;
      const isCoCreation = aaRef?.id === 'co-creation';
      let resolvedVariant = coCreationLastVariantRef.current;
      if (isCoCreation) {
        const inferred = inferCoCreationStage(history);
        const order = { none: 0, original: 1, revised: 2, background: 3 } as const;
        if (order[inferred] > order[resolvedVariant]) resolvedVariant = inferred;
      }
      return {
        ...(aaRef ? {
          activityId: aaRef.id,
          activityName: aaRef.name,
          type: aaRef.type as 'breathing' | 'body-rhythm' | 'emotion-music-mapping' | 'co-creation',
          sectionIndex: siRef,
        } : {}),
        ...(isCoCreation ? {
          coCreationLastVariant: resolvedVariant,
          ...(coCreationNotesRef.current ? { coCreationNotes: coCreationNotesRef.current } : {}),
        } : {}),
        ...(therapyMode ? { therapyMode: true as const } : {}),
      };
    })();

    const cancel = startChatStream(
      {
        personaId: selectedPersonaId,
        messages: history,
        ...(activityContext ? { activityContext } : {}),
      },
      {
        onText(delta) {
          streamingContentRef.current += delta;
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantMsg.id
                ? { ...t, content: t.content + delta }
                : t,
            ),
          );
        },
        onExpression(timeline) {
          const best = timeline.reduce(
            (a, b) => (b.confidence > a.confidence ? b : a),
            timeline[0]!,
          );
          setFaceExpr(best.expressionId as ExpressionId);
        },
        onToolCall(ev) {
          if (ev.result.ok && ev.name === 'start_activity' && ev.result.activityId) {
            const newActivity = {
              id: ev.result.activityId,
              name: ev.result.activityName ?? ev.result.activityId,
              type: ev.result.activityType ?? ev.result.activityId,
              ...(ev.result.totalSections !== undefined
                ? { totalSections: ev.result.totalSections }
                : {}),
            };
            setActiveActivity(newActivity);
            // Mirror to ref so onDone (same stream) sees fresh state without waiting for re-render.
            activeActivityRef.current = newActivity;
            // Section 1 is delivered THIS turn (in-stream), so the NEXT turn should request section 2.
            // Co-creation is interactive (no sections) — sectionIndex stays 0.
            if (!ev.result.interactive) {
              setActivitySectionIndex(1);
              sectionIndexRef.current = 1;
            }
            // Defensive: clear any stale playlist from a prior activity before setting new.
            const playlist = ev.result.audioPlaylist ?? [];
            if (playlist.length > 0) {
              setActivityPlaylist({ playlist, index: 0, paused: false });
            } else {
              setActivityPlaylist(null);
            }
            // Reset the co-creation "music has played" hint flag for a fresh session.
            if (ev.result.activityId === 'co-creation') {
              setCoCreationMusicPlayed(false);
              setCoCreationLastVariant('none');
              coCreationLastVariantRef.current = 'none';
              setCoCreationNotes(null);
              coCreationNotesRef.current = null;
            }
          } else if (ev.result.ok && ev.name === 'play_melody' && ev.result.filename) {
            // Co-creation: queue the track. We'll release it once the model's
            // current TTS has finished — otherwise music overlaps the narration.
            pendingMelodyRef.current = {
              playlist: [ev.result.filename],
              playCount: ev.result.playCount ?? 1,
            };
            setCoCreationMusicPlayed(true);
            // Capture the variant + notes so the next turn's activityContext
            // tells the server exactly which stage we're on.
            const variant = ev.result.variant;
            if (variant === 'original' || variant === 'revised' || variant === 'background') {
              setCoCreationLastVariant(variant);
              coCreationLastVariantRef.current = variant;
            }
            if (ev.result.notes && ev.result.notes.length > 0) {
              setCoCreationNotes(ev.result.notes);
              coCreationNotesRef.current = ev.result.notes;
            }
          } else if (ev.result.ok && ev.name === 'end_activity') {
            // Model called end_activity → tear down like the × button.
            endActivity();
          }
        },
        onDone() {
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantMsg.id ? { ...t, streaming: false } : t,
            ),
          );
          setStreaming(false);
          // Advance section pointer if this turn was inside a section-driven activity
          // (and was NOT the tool-call turn — that increment happens in onToolCall).
          // Co-creation is interactive and has no sections; don't advance.
          if (activeActivity && activeActivity.id !== 'co-creation') {
            setActivitySectionIndex((n) => n + 1);
            sectionIndexRef.current = sectionIndexRef.current + 1;
          }
          // Return to calm after a short delay
          setTimeout(() => setFaceExpr('calm'), 2000);

          // Trigger TTS for the completed assistant message
          const finalContent = streamingContentRef.current;
          streamingContentRef.current = '';
          // Record assistant response in api history (visible transcript already updated above)
          apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: finalContent }];
          void callTts(finalContent, assistantMsg.id).then(() => {
            // If TTS won't actually play (muted or empty content), there's no
            // audio.ended event to wait for — release the queued melody now.
            if (pendingMelodyRef.current && !audioRef.current) {
              flushPendingMelody();
            }
          }).finally(() => {
            // If the user said goodbye, end the session once the model's farewell
            // has been spoken so we don't cut TTS off mid-sentence.
            void goodbyePromise.then((end) => { if (end) handleEndSession(); });
          });

          // Schedule auto-advance:
          //   • emotion-music-mapping → fixed 20s per section (TTS + music together) with 3s fade
          //   • muted other           → length-scaled (~100ms/char + 3s buffer, cap 30s) for reading time
          //   • not muted other       → 90s safety net; audio.play will cancel it, audio.ended schedules a tighter 2s
          const aa = activeActivityRef.current;
          const nextIdx = sectionIndexRef.current;
          if (aa && aa.totalSections !== undefined) {
            cancelAutoAdvance();
            // Emotion-mapping: every section is a fixed 20s window regardless of TTS or mute state.
            if (aa.id === 'emotion-music-mapping' && nextIdx <= aa.totalSections) {
              setAutoAdvancePending(true);
              startEmotionMappingTimer(20000, 3000);
              return;
            }
            const len = finalContent.length || 100;
            const isWrapUp = nextIdx > aa.totalSections;
            // Wrap-up turn has short text; cap the fallback aggressively so a
            // failed/blocked TTS doesn't strand the user on a 90s timer.
            const fallbackDelay = isWrapUp
              ? Math.min(Math.max(6000, len * 100 + 2000), 12000)
              : mutedRef.current
                ? Math.min(Math.max(8000, len * 100 + 3000), 30000)
                : 90000;
            setAutoAdvancePending(true);
            if (!isWrapUp) {
              // Next section OR wrap-up turn — auto-advance silently
              autoAdvanceTimerRef.current = window.setTimeout(() => {
                autoAdvanceTimerRef.current = null;
                setAutoAdvancePending(false);
                sendMessageRef.current?.('继续', { silent: true });
              }, fallbackDelay);
            } else {
              // Wrap-up turn just finished → auto-end the activity
              autoAdvanceTimerRef.current = window.setTimeout(() => {
                autoAdvanceTimerRef.current = null;
                setAutoAdvancePending(false);
                setActiveActivity(null);
                setActivitySectionIndex(0);
                setActivityPlaylist(null);
                activeActivityRef.current = null;
                sectionIndexRef.current = 0;
              }, fallbackDelay);
            }
          }
        },
        onError(message) {
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantMsg.id
                ? { ...t, content: `(Error: ${message})`, streaming: false }
                : t,
            ),
          );
          setStreaming(false);
          setFaceExpr('confused');
        },
      },
    );

    cancelRef.current = cancel;
  }, [input, selectedPersonaId, sessionActive, streaming, transcript, therapyMode, activeActivity, activitySectionIndex, callTts, cancelAutoAdvance, endActivity, handleEndSession]);

  // Keep ref up-to-date so audio.ended can invoke the latest sendMessage
  sendMessageRef.current = sendMessage;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  // ── Voice Live: toggle mode ───────────────────────────────────────────────
  const toggleVoiceMode = useCallback(() => {
    if (voiceMode) {
      // Turn off: disconnect cleanly
      voiceClientRef.current?.disconnect();
      voiceClientRef.current = null;
      setVoiceMode(false);
      setVoiceReady(false);
      setVoiceError(null);
      setRecording(false);
      setLiveUserTranscript('');
      setLiveAssistantText('');
      stopAudio();
    } else {
      // Turn on: create client, connect (mic permission deferred until PTT press)
      if (!selectedPersonaId) return;
      setVoiceMode(true);
      setVoiceError(null);
      setVoiceReady(false);

      const client = new VoiceLiveClient({
        onReady: () => { setVoiceReady(true); },
        onAudioFrame: (playbackMs) => {
          setVisemePlaybackMs(playbackMs);
        },
        onViseme: (ev) => {
          setVisemeStream((prev) => {
            const next = [...prev, ev];
            next.sort((a, b) => a.audioOffsetMs - b.audioOffsetMs);
            return next;
          });
        },
        onTextDelta: (delta) => {
          setLiveAssistantText((prev) => prev + delta);
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === liveAssistantMsgIdRef.current
                ? { ...t, content: t.content + delta }
                : t,
            ),
          );
        },
        onUserTranscript: (text, isFinal) => {
          if (isFinal) {
            setLiveUserTranscript('');
            setTranscript((prev) => {
              const existing = prev.find((t) => t.id === 'voice-user-pending');
              if (existing) {
                return prev.map((t) =>
                  t.id === 'voice-user-pending'
                    ? { ...t, id: uid(), content: text }
                    : t,
                );
              }
              return [...prev, { id: uid(), role: 'user' as const, content: text, voiceMode: true }];
            });
          } else {
            setLiveUserTranscript(text);
          }
        },
        onExpressionEvents: (events) => {
          if (events.length === 0) return;
          const best = events.reduce(
            (a, b) => (b.confidence > a.confidence ? b : a),
            events[0]!,
          );
          setFaceExpr(best.expressionId as ExpressionId);
        },
        onTurnEnd: () => {
          // Finalize assistant message
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === liveAssistantMsgIdRef.current ? { ...t, streaming: false } : t,
            ),
          );
          liveAssistantMsgIdRef.current = '';
          setLiveAssistantText('');
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 2000);
        },
        onSpeechStart: () => {
          setFaceExpr('listening');
          // Create a streaming placeholder for the upcoming assistant response
          const id = uid();
          liveAssistantMsgIdRef.current = id;
          setTranscript((prev) => [
            ...prev,
            { id, role: 'assistant' as const, content: '', streaming: true, voiceMode: true },
          ]);
          setStreaming(true);
          setVisemeStream([]);
          setVisemePlaybackMs(0);
        },
        onSpeechStop: () => {
          // VAD detected end-of-utterance; response inbound — nothing to do here
        },
        onError: (message) => {
          setVoiceError(message);
          setVoiceReady(false);
          setRecording(false);
          setFaceExpr('confused');
        },
        onRms: (level) => {
          setRmsLevel(level);
        },
      });

      voiceClientRef.current = client;
      client.connect(selectedPersonaId);
    }
  }, [voiceMode, selectedPersonaId, stopAudio]);

  // ── Voice Live: PTT handlers ──────────────────────────────────────────────
  const handlePttStart = useCallback(async () => {
    if (!voiceReady || recording) return;
    setRecording(true);
    setFaceExpr('listening');
    try {
      await voiceClientRef.current?.startRecording();
    } catch (e) {
      setVoiceError(`Mic error: ${(e as Error).message}`);
      setRecording(false);
    }
  }, [voiceReady, recording]);

  const handlePttStop = useCallback(() => {
    if (!recording) return;
    setRecording(false);
    setRmsLevel(0);
    voiceClientRef.current?.stopRecording();
  }, [recording]);

  // ── Voice Live: spacebar PTT ──────────────────────────────────────────────
  useEffect(() => {
    if (!voiceMode) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !recording) void handlePttStart();
    };
    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space') handlePttStop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [voiceMode, recording, handlePttStart, handlePttStop]);

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);
  const exprDef = EXPRESSIONS[faceExpr] ?? EXPRESSIONS['calm']!;

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-slate-100 mb-4">Test Chat</h1>
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-rose-300 text-sm">
          <strong>Failed to load personas:</strong> {loadError}
          <br />
          Make sure the server is running (<code>pnpm dev</code>).
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <h1 className="text-2xl font-semibold text-slate-100">Test Chat</h1>
        <p className="mt-1 text-sm text-slate-400">
          Live chat with 小沐 · expression timeline + TTS voice active
        </p>
      </div>

      {/* Active activity bar */}
      {activeActivity && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 flex-shrink-0">
          <ActivityIcon size={14} className="text-purple-400 flex-shrink-0" />
          <div className="flex-shrink-0">
            <div className="text-[9px] uppercase tracking-widest text-purple-400/70">
              Now in
              {activeActivity.totalSections !== undefined && (
                <span className="ml-1">
                  · section {Math.min(activitySectionIndex, activeActivity.totalSections)} / {activeActivity.totalSections}
                </span>
              )}
            </div>
            <div className="text-sm font-medium text-purple-200 leading-tight">
              {activeActivity.name}
              {autoAdvancePending && (
                <span className="ml-2 text-[10px] font-normal text-purple-300/70 animate-pulse">
                  · auto-continuing…
                </span>
              )}
            </div>
          </div>

          {activityPlaylist && (
            <>
              <div className="h-7 w-px bg-purple-500/30" />
              <button
                onClick={toggleActivityPlayback}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-purple-600/70 text-white hover:bg-purple-500 transition-colors flex-shrink-0"
                title={activityPlaylist.paused ? 'Play' : 'Pause'}
              >
                {activityPlaylist.paused
                  ? <Play size={11} className="ml-0.5" />
                  : <Pause size={11} />}
              </button>
              <button
                onClick={skipActivityTrack}
                disabled={activityPlaylist.index + 1 >= activityPlaylist.playlist.length}
                className="flex items-center justify-center w-7 h-7 rounded-full text-purple-300 hover:bg-purple-500/20 transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next track"
              >
                <SkipForward size={12} />
              </button>
              <div className="flex-1 min-w-0 text-xs text-purple-200">
                <div className="text-[10px] text-purple-400/70">
                  Track {activityPlaylist.index + 1} / {activityPlaylist.playlist.length}
                </div>
                <div className="truncate" title={activityPlaylist.playlist[activityPlaylist.index]}>
                  {activityPlaylist.playlist[activityPlaylist.index]}
                </div>
              </div>
            </>
          )}

          {!activityPlaylist && activeActivity.id === 'co-creation' && !coCreationMusicPlayed && (
            <div className="flex-1 text-[11px] text-purple-300/60 italic">
              Waiting for the child to pick three notes…
            </div>
          )}
          {!activityPlaylist && activeActivity.id === 'co-creation' && coCreationMusicPlayed && (
            <div className="flex-1 text-[11px] text-purple-300/60 italic">
              Music paused — listening for next prompt…
            </div>
          )}
          {!activityPlaylist && activeActivity.id !== 'co-creation' && (
            <div className="flex-1 text-[11px] text-purple-300/60 italic">
              No audio configured for this age bucket.
            </div>
          )}

          <button
            onClick={endActivity}
            title="End activity"
            className="ml-auto flex items-center justify-center w-6 h-6 rounded text-purple-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Two-column body */}
      <div className="flex gap-6 flex-1 min-h-0">

        {/* ── Left: chat (60%) ──────────────────────────────────────────── */}
        <div className="flex flex-col flex-[3] min-w-0 gap-3">

          {/* Transcript */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-led-border bg-led-panel p-4 flex flex-col gap-3"
          >
            {transcript.length === 0 && (
              <div className="m-auto text-center text-slate-600 text-sm select-none">
                <div className="text-3xl mb-2">💬</div>
                <div>
                  {voiceMode
                    ? 'Hold the button (or Space) to speak'
                    : 'Send a message to start a session'}
                </div>
                {selectedPersona && (
                  <div className="mt-1 text-xs">
                    Talking with <span className="text-purple-400">{selectedPersona.name}</span>
                    {selectedPersona.avatarEmoji && ` ${selectedPersona.avatarEmoji}`}
                    , age {selectedPersona.ageYears}
                  </div>
                )}
              </div>
            )}

            {transcript.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={[
                    'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-purple-600/30 text-purple-100 rounded-br-sm'
                      : 'bg-led-border text-slate-200 rounded-bl-sm',
                  ].join(' ')}
                >
                  {msg.content || (msg.streaming ? '' : '…')}
                  {msg.streaming && (
                    <span className="inline-block w-1.5 h-3.5 bg-purple-400 ml-1 animate-pulse rounded-sm align-middle" />
                  )}
                </div>

                {msg.role === 'assistant' && !msg.streaming && !msg.voiceMode && (
                  <div className="ml-1 mt-1 flex flex-col gap-0.5">
                    {/* Replay */}
                    <button
                      onClick={() => void callTts(msg.content, msg.id)}
                      disabled={ttsLoading || streaming || muted}
                      title="Replay voice"
                      className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed w-fit"
                    >
                      <RotateCcw size={10} />
                      Replay
                    </button>

                    {/* Sanitizer preview */}
                    {msg.ssml && <SanitizerPreview original={msg.content} ssml={msg.ssml} />}
                  </div>
                )}
              </div>
            ))}

            {/* Live user transcript while recording */}
            {liveUserTranscript && (
              <div className="flex flex-col items-end">
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-purple-600/20 text-purple-200/60 rounded-br-sm italic">
                  {liveUserTranscript}
                  <span className="inline-block w-1.5 h-3.5 bg-purple-400/50 ml-1 animate-pulse rounded-sm align-middle" />
                </div>
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="flex-shrink-0 flex flex-col gap-2">
            {/* Persona + therapy mode */}
            <div className="flex items-center gap-2">
              <select
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
                disabled={streaming || voiceMode}
                className="flex-1 bg-led-panel border border-led-border rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500 disabled:opacity-40"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.avatarEmoji ?? ''} {p.name} · age {p.ageYears}
                  </option>
                ))}
                {personas.length === 0 && (
                  <option value="">Loading personas…</option>
                )}
              </select>

              <button
                onClick={() => setTherapyMode((v) => !v)}
                disabled={voiceMode}
                title={therapyMode ? 'Therapy mode (temp 0.6) — click to disable' : 'Enable therapy mode (temp 0.6)'}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed',
                  therapyMode
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'text-slate-500 border-led-border hover:text-slate-300',
                ].join(' ')}
              >
                {therapyMode ? <ZapOff size={12} /> : <Zap size={12} />}
                Therapy mode
              </button>

              {sessionActive ? (
                <button
                  onClick={handleEndSession}
                  disabled={voiceMode}
                  title="End the current session"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <StopCircle size={12} />
                  End session
                </button>
              ) : (
                <button
                  onClick={handleStartChatting}
                  disabled={voiceMode || !selectedPersonaId || ttsLoading}
                  title="Begin a new session with the intro"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <PlayCircle size={12} />
                  Start chatting
                </button>
              )}
            </div>

            {/* System prompt disclosure */}
            <div className="rounded-lg border border-led-border overflow-hidden">
              <button
                onClick={() => setPromptOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <span className="font-medium uppercase tracking-wider">System prompt</span>
                <div className="flex items-center gap-2">
                  {selectedPersona && (
                    <span className="text-purple-400/70 normal-case tracking-normal">
                      {selectedPersona.name} · {selectedPersona.ageYears}yo
                    </span>
                  )}
                  {promptOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </div>
              </button>
              {promptOpen && (
                <div className="border-t border-led-border">
                  <div className="relative">
                    <pre className="text-[10px] leading-relaxed text-slate-400 p-3 overflow-auto max-h-52 whitespace-pre-wrap font-mono">
                      {promptLoading ? 'Loading…' : systemPrompt}
                    </pre>
                    {systemPrompt && !promptLoading && (
                      <button
                        onClick={handleCopy}
                        title="Copy prompt"
                        className="absolute top-2 right-2 p-1 rounded text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Audio controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMuted((v) => !v)}
                disabled={voiceMode}
                title={muted ? 'Unmute TTS' : 'Mute TTS'}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed',
                  muted
                    ? 'text-slate-500 border-led-border hover:text-slate-300'
                    : 'bg-purple-500/20 text-purple-300 border-purple-500/40',
                ].join(' ')}
              >
                {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                {muted ? 'Muted' : 'Voice on'}
              </button>

              <select
                value={voiceStyle}
                onChange={(e) => setVoiceStyle(e.target.value)}
                disabled={ttsLoading || voiceMode}
                className="flex-1 bg-led-panel border border-led-border rounded-md px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-purple-500 disabled:opacity-40"
              >
                <option value="cheerful">Cheerful</option>
                <option value="gentle">Gentle</option>
                <option value="whispering">Whispering</option>
                <option value="excited">Excited</option>
                <option value="empathetic">Empathetic</option>
              </select>

              {/* Voice mode toggle */}
              <button
                onClick={toggleVoiceMode}
                disabled={!selectedPersonaId}
                title={voiceMode ? 'Voice mode ON — click to switch to text' : 'Switch to voice mode'}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed',
                  voiceMode
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'text-slate-500 border-led-border hover:text-slate-300',
                ].join(' ')}
              >
                {voiceMode ? <Mic size={12} /> : <MicOff size={12} />}
                {voiceMode ? 'Voice' : 'Voice off'}
              </button>

              {ttsLoading && !voiceMode && (
                <span className="text-xs text-slate-500 flex-shrink-0 animate-pulse">Synthesizing…</span>
              )}
            </div>

            {/* Input area: voice PTT or text textarea */}
            {voiceMode ? (
              <div className="flex flex-col gap-2">
                {/* Voice status */}
                {voiceError && (
                  <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {voiceError}
                  </div>
                )}
                {!voiceReady && !voiceError && (
                  <div className="text-xs text-slate-500 animate-pulse text-center py-1">
                    Connecting to Voice Live…
                  </div>
                )}
                {/* PTT button */}
                <button
                  onMouseDown={() => void handlePttStart()}
                  onMouseUp={handlePttStop}
                  onMouseLeave={handlePttStop}
                  onTouchStart={(e) => { e.preventDefault(); void handlePttStart(); }}
                  onTouchEnd={handlePttStop}
                  disabled={!voiceReady}
                  className={[
                    'w-full rounded-xl py-6 text-sm font-semibold transition-all select-none',
                    recording
                      ? 'bg-rose-500/30 border-2 border-rose-400 text-rose-300 scale-[0.98]'
                      : voiceReady
                        ? 'bg-led-border border border-led-border text-slate-400 hover:bg-purple-500/20 hover:border-purple-500/40 hover:text-purple-300 active:scale-[0.98]'
                        : 'bg-led-panel border border-led-border text-slate-600 cursor-not-allowed',
                  ].join(' ')}
                >
                  {recording ? (
                    <span className="flex items-center justify-center gap-2">
                      <Mic size={16} className="animate-pulse" />
                      Listening… (release to send)
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Mic size={16} />
                      Hold to speak (or hold Space)
                    </span>
                  )}
                </button>
                {/* Waveform meter */}
                {recording && (
                  <div className="flex items-center gap-0.5 h-6 justify-center">
                    {Array.from({ length: 20 }, (_, i) => (
                      <div
                        key={i}
                        className="w-1 rounded-full bg-rose-400 transition-all duration-75"
                        style={{
                          height: `${Math.max(4, Math.min(24, rmsLevel * 300 * (0.4 + Math.random() * 0.6)))}px`,
                          opacity: 0.5 + rmsLevel * 0.5,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Text input */
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (e.target.value.length > 0) cancelAutoAdvance();
                  }}
                  onFocus={cancelAutoAdvance}
                  onKeyDown={handleKeyDown}
                  disabled={!selectedPersonaId || !sessionActive}
                  placeholder={
                    !sessionActive
                      ? 'Click "Start chatting" to begin a session.'
                      : selectedPersona
                        ? streaming
                          ? `Type to interrupt ${selectedPersona.name}… (Enter to send)`
                          : `Say something to ${selectedPersona.name}… (Enter to send)`
                        : 'Loading…'
                  }
                  rows={2}
                  className="flex-1 resize-none bg-led-panel border border-led-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 disabled:opacity-40 transition-colors"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || !selectedPersonaId || !sessionActive}
                  title={streaming ? 'Interrupt and send' : 'Send'}
                  className="px-4 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center"
                >
                  <Send size={16} className="text-white" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: face (40%) ────────────────────────────────────────── */}
        <div className="flex-[2] flex flex-col items-center justify-start gap-4 flex-shrink-0">
          <div
            className="rounded-2xl overflow-hidden shadow-2xl"
            style={{
              boxShadow: `0 0 40px ${exprDef.color}30, 0 8px 32px rgba(0,0,0,0.6)`,
            }}
          >
            <FaceRenderer
              renderer="svg2d"
              expressionId={faceExpr}
              idleEnabled={!streaming && visemePlaybackMs < 0}
              width={320}
              height={200}
              {...(visemeStream.length > 0 ? {
                visemeStream,
                visemePlaybackMs: Math.max(0, visemePlaybackMs),
              } : {})}
            />
          </div>

          {/* Expression badge */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: `${exprDef.color}20`,
              color: exprDef.color,
              border: `1px solid ${exprDef.color}50`,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: exprDef.color }} />
            {exprDef.label} · {faceExpr}
            {streaming && (
              <span className="w-1 h-1 rounded-full bg-current animate-pulse ml-1" />
            )}
          </div>

          {/* Persona card */}
          {selectedPersona && (
            <div className="w-full rounded-lg border border-led-border bg-led-panel p-3 text-xs text-slate-400 space-y-1">
              <div className="text-slate-300 font-medium">
                {selectedPersona.avatarEmoji} {selectedPersona.name}
                <span className="text-slate-500 font-normal ml-1">· age {selectedPersona.ageYears}</span>
              </div>
              <div className="line-clamp-2 leading-relaxed">{selectedPersona.backstory}</div>
              <div>
                <span className="text-slate-500">Comm:</span>{' '}
                {selectedPersona.communicationAbility}
              </div>
              <div>
                <span className="text-slate-500">Likes:</span>{' '}
                {selectedPersona.likes.slice(0, 3).join(', ')}
                {selectedPersona.likes.length > 3 && '…'}
              </div>
            </div>
          )}

          {/* Voice mode status indicator */}
          {voiceMode && (
            <div
              className={[
                'w-full rounded-lg border p-3 text-xs text-center',
                voiceReady
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-led-border bg-led-panel text-slate-500',
              ].join(' ')}
            >
              {voiceReady ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Voice Live connected
                </span>
              ) : (
                'Initialising Voice Live…'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
