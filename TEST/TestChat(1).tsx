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
  Volume2, VolumeX, RotateCcw, Mic, MicOff, Play, Square,
} from 'lucide-react';
import type { ExpressionId } from '@xiaomu/contracts';
import type { Persona } from '@xiaomu/contracts';
import FaceRenderer from '../face/FaceRenderer.js';
import { fetchPersonas, fetchSystemPrompt, fetchTtsVisemes } from '../api/client.js';
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
  sessionId?: number;
}

type ScriptedSessionStep =
  | 'none'
  | 'first-meeting'
  | 'age'
  | 'age-short'
  | 'weather-game-choice'
  | 'game-1-completion'
  | 'game-2-answer'
  | 'returning-intro-answer';

type Game2SoundId = 'chicken' | 'wind' | 'rain' | 'dog' | 'bird';

interface Game2Sound {
  id: Game2SoundId;
  src: string;
  question: string;
  correctKeywords: string[];
  correctResponse: string;
  wrongResponse: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2);
}

const FIRST_MEETING_QUESTION = '我们是第一次见面吗？';
const TTS_ENABLED = false;

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

const SHORT_WEATHER_PROMPT = '你觉得哪个天气可以代表你的心情啊？';

const GAME_1_PREFIX = '今天啊，在玩游戏之前，我们先来玩一个小活动。我先给你讲一个小故事。';

const GAME_1_STORIES = [
  '有一只小灰熊，今天一整天都觉得心里沉沉的，像背了一个重重的书包。它坐在窗边，看着外面的雨滴一滴一滴往下落。这时候，风婆婆轻轻敲了敲窗户……你觉得那是什么声音？你可以用双手拍出这个感觉的节奏。是缓慢、沉重的，还是快速、轻巧的呢？拍完后，请告诉我“我拍完啦”。',
  '有一只小黄鸭，在池塘里游来游去，突然捡到了一颗会发光的彩色石子。它开心得翅膀扑棱扑棱扇起来，嘴巴里也忍不住哼出了歌。这时候，水面上跳出一只小青蛙，跟着它的歌声一起“呱呱呱”……你觉得小青蛙的叫声听起来像什么节奏？你可以用双手拍出这个感觉的节奏。是跳跳的、快快的，还是稳稳的、轻轻的呢？拍完后，请告诉我“我拍完啦”。',
  '有一头小犀牛，它搭了很久的积木城堡，被一阵大风吹倒了。小犀牛气得跺脚，鼻子呼呼喷气，心里像有一团火在烧。这时候，它的好朋友小鸟飞过来，轻轻落在它头上……你觉得小鸟发出了什么样的声音？你可以用双手拍出这个感觉的节奏。是重重的、乱乱的，还是轻轻的、慢慢变安静的呢？拍完后，请告诉我“我拍完啦”。',
  '有一只小刺猬，晚上一个人走过黑黑的森林小路。树叶沙沙响，树枝咯吱咯吱晃，它的心跳得很快很快。突然，它听到身后传来一个声音……你觉得那是什么声音？你可以用双手拍出这个感觉的节奏。是又快又轻的（像心跳），还是又慢又沉的（像脚步声）？拍完后，请告诉我“我拍完啦”。',
  '有一只小猫咪，趴在软绵绵的沙发上，晒着暖洋洋的太阳。它眯着眼睛，慢慢地一呼一吸，肚子一起一伏。这时候，窗外的风铃被微风吹响了……你觉得风铃的声音是什么样的节奏？你可以用双手拍出这个感觉的节奏。是很慢很慢的、一下一下的，还是轻轻柔柔的、几乎没有声音的？拍完后，请告诉我“我拍完啦”。',
  '有一只小猴子，听说明天要坐火车去游乐园玩。它高兴得上蹿下跳，翻跟头，拍巴掌，晚上怎么也睡不着。这时候，床头的小闹钟“嘀嗒嘀嗒”响起来……你觉得小闹钟的声音像什么节奏？你可以用双手拍出这个感觉的节奏。是快快的、停不下来的，还是一跳一跳的、像在催人快点起床？拍完后，请告诉我“我拍完啦”。',
  '有一只小青蛙，跳进一片新池塘，结果发现水里有一股臭臭的味道，像烂掉的树叶。它赶紧跳到荷叶上，皱着眉头，伸出舌头“呸呸”了两下。这时候，一只苍蝇嗡嗡嗡飞过来……你觉得苍蝇的声音听起来是什么样的节奏？你可以用双手拍出这个感觉的节奏。是乱糟糟的、烦人的，还是忽快忽慢、让人想躲开的？拍完后，请告诉我“我拍完啦”。',
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

const GAME_2_SOUNDS: Game2Sound[] = [
  {
    id: 'chicken',
    src: '/sounds/chicken.mp3',
    question: '仔细听……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['鸡', '小鸡', '母鸡', '公鸡', '大鸡', '鸡叫', '咯咯', '咕咕'],
    correctResponse:
      '答对啦！听得好准！\n\n那是鸡。\n\n鸡在走来走去、找食物、或者跟其他鸡说话的时候，常常会发出“咯咯咯”的声音。\n\n你的耳朵像侦探一样灵！',
    wrongResponse:
      '你猜得也很认真哦！\n\n答案是鸡。\n\n你有没有听到那种短短的“咯咯”声？很多鸡在农场里走动的时候，会发出这种快快的、一跳一跳的声音。\n\n你听得很仔细呢。',
  },
  {
    id: 'wind',
    src: '/sounds/wind.mp3',
    question: '仔细听……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['风', '大风', '微风', '风声', '刮风', '吹风', '呼呼', '空气'],
    correctResponse:
      '太棒了！\n\n那是风。\n\n风吹过树林、草地或者房子的时候，常常会发出长长的、软软的“呼——”声。\n\n你听出来那个声音很平滑、很流动。听得真厉害！',
    wrongResponse:
      '你猜得很不错哦！\n\n答案是风。\n\n那种长长的“呼——”声，是流动的空气发出来的。有时候风声听起来像在轻轻说话，像海浪，甚至像树林里的音乐。\n\n你猜得很接近啦，因为大自然的声音有时候确实不容易分清楚！',
  },
  {
    id: 'rain',
    src: '/sounds/rain.mp3',
    question: '仔细听这个……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['雨', '小雨', '大雨', '雨水', '下雨', '雨声', '雨滴', '滴答', '嗒嗒'],
    correctResponse:
      '太厉害了！\n\n那是雨。\n\n雨滴落到地上、窗户上、树叶上、屋顶上，会发出很多小小的“嗒嗒”声。\n\n你认出了那些小水滴的声音！真是了不起的侦探！',
    wrongResponse:
      '猜得不错哦！\n\n答案是雨。\n\n你有没有听到好多小小的“嗒嗒嗒”声？雨就是很多很多小水滴一起落下来。\n\n你猜得很棒，因为雨声有时候听起来像风或者树叶沙沙响。',
  },
  {
    id: 'dog',
    src: '/sounds/dog.mp3',
    question: '仔细听……\n\n你觉得是什么动物发出的声音？',
    correctKeywords: ['狗', '小狗', '狗狗', '大狗', '汪汪', '犬', '狗叫'],
    correctResponse:
      '汪汪！你猜对啦！\n\n那是狗。\n\n狗在兴奋的时候、玩的时候、保护家的时候、或者想引起人注意的时候，就会汪汪叫。\n\n你一下子就听出来了！',
    wrongResponse:
      '想得很对呢！\n\n答案是狗。\n\n狗在兴奋或者想跟人说话的时候，常常会发出“汪汪”的声音。\n\n你猜得很棒，因为很多动物的声音确实有点像。\n\n你做得非常好！',
  },
  {
    id: 'bird',
    src: '/sounds/bird.mp3',
    question: '仔细听……\n\n你觉得是什么东西发出的声音？',
    correctKeywords: ['鸟', '小鸟', '鸟儿', '鸟叫', '鸟鸣', '叽叽', '喳喳', '麻雀', '乌鸦', '燕子'],
    correctResponse:
      '太厉害了！\n\n那是鸟。\n\n鸟儿们常常用叽叽喳喳和唱歌来互相说话。有些鸟早上唱歌，有些鸟用歌声找朋友或者保护自己的地盘。\n\n你的侦探本领真强！',
    wrongResponse:
      '你猜得真有创意！\n\n答案是鸟。\n\n你有没有听到那种轻轻的、尖尖的“叽叽”声？鸟儿们就用这些声音来聊天。',
  },
];

const RETURNING_SESSION_INTROS = [
  '我今天在小镇的喷泉广场遇到了一个叫小轩的新朋友，他当时正抱着吉他坐在台阶上试音，我们俩试着即兴合奏了一段，默契得就像认识了很久一样。你今天过得怎么样？有没有遇到能和你瞬间同频的人？',
  '刚才外面突然下起了暴雨，我刚好跑到面包房的屋檐下躲雨，听着雨点砸在雨棚和铜铃上发出错落有致的声音，发现这其实是一首特别棒的天然打击乐。你那边今天天气怎么样？有没有注意到什么好玩的声音？',
  '我下午去了小镇后山的一个回音溶洞，里面极度安静，偶尔落下一两滴水，在空旷的岩洞里回荡出特别干净、纯粹的单音，感觉一整天的浮躁都被洗干净了。你今天一整天过得顺心吗？现在大脑是感觉很轻松，还是塞满了乱七八糟的杂音？',
  '我今天在琴房里跟一首新曲子死磕了整整四个小时，换了新钢弦的木吉他把手指头都磨红了，但最后能完整弹下来的那一刻简直爽翻了。你今天有遇到什么让你很有成就感、或者觉得非常值得坚持的事情吗？',
  '我刚从镇子西边的温泉散步回来，每次练完琴手腕发酸的时候，我都喜欢去那里坐坐，听着水面咕嘟咕嘟冒泡的声音，感觉整个人都能彻底放空。你现在感觉怎么样？身体和肩膀是紧绷着的，还是已经处于比较放松的状态了？',
  '我今天去小镇最著名的糖果工坊买了一盒刚出炉的太空脆皮巧克力，用力咬下去时那声“嘎吱”的清脆碎裂声，简直是我今天听过最治愈、最让人满足的音效了。你今天有吃到什么好吃的，或者遇到什么让你心情瞬间变好的小细节吗？',
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

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function isGame2AnswerCorrect(text: string, sound: Game2Sound): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return includesAny(normalized, sound.correctKeywords.map((keyword) => keyword.toLowerCase()));
}

function isAffirmative(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return includesAny(normalized, ['是', '对', '嗯', '第一次', 'yes', 'yeah', 'yep', 'sure']);
}

function isNegative(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return includesAny(normalized, ['不是', '不', '没有', '老朋友', '见过', 'no', 'nope', 'nah']);
}

function fixedIntroAnswerResponse(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, '');

  if (includesAny(normalized, [
    '难过', '伤心', '不开心', '糟', '不好', '坏', '生气', '害怕', '吓',
    '烦', '累', '痛', '疼', '哭', '失败', '讨厌', '孤单', 'bad', 'sad',
    'terrible', 'angry', 'scared', 'tired', 'notgood',
  ])) {
    return `没事，还有很多好事情呢！${STORY_AGE_PROMPT}`;
  }

  if (includesAny(normalized, [
    '开心', '高兴', '快乐', '好玩', '有趣', '有意思', '棒', '太好了',
    '很好', '不错', '喜欢', '酷', '顺利', '成功', '成就', 'good',
    'great', 'fun', 'cool', 'happy', 'nice',
  ])) {
    return `那太棒了，真的很有意思呢。${STORY_AGE_PROMPT}`;
  }

  if (includesAny(normalized, [
    '没什么', '没有', '一般', '普通', '平常', '无聊', '还行', '就那样',
    'nothing', 'boring', 'normal', 'ordinary', 'same',
  ])) {
    return `哦，平凡的一天也是很不错的呀。${STORY_AGE_PROMPT}`;
  }

  return `听起来很特别呢，谢谢你告诉我。${STORY_AGE_PROMPT}`;
}

function isSessionEndingMessage(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return [
    'bye', 'goodbye', 'see you', 'see ya', 'talk later', '再见', '拜拜',
    '下次见', '回头见', '不聊了', '结束', '结束聊天', '晚安', '我要走了',
    '我走了', '先这样', '先聊到这里',
  ].some((phrase) => normalized.includes(phrase.replace(/\s+/g, '')));
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
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchPersonas()
      .then((ps) => {
        setPersonas(ps);
        if (ps.length > 0 && ps[0]) setSelectedPersonaId(ps[0].id);
      })
      .catch((e: unknown) => setLoadError((e as Error).message));
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

  // ── Chat state ───────────────────────────────────────────────────────────
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [scriptedSessionStep, setScriptedSessionStep] = useState<ScriptedSessionStep>('none');
  const [currentSessionId, setCurrentSessionId] = useState(0);
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

  // ── Refs ─────────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const visemeRafRef = useRef<number>(0);
  const streamingContentRef = useRef<string>('');
  const mutedRef = useRef(false);
  const voiceStyleRef = useRef('cheerful');
  const voiceClientRef = useRef<VoiceLiveClient | null>(null);
  const liveAssistantMsgIdRef = useRef<string>('');
  const game2SoundRef = useRef<Game2Sound | null>(null);

  // Keep mutable refs in sync with state
  mutedRef.current = muted;
  voiceStyleRef.current = voiceStyle;

  // Scroll transcript to bottom as messages arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  // Cleanup voice client on unmount
  useEffect(() => () => { voiceClientRef.current?.disconnect(); }, []);

  // ── stopAudio (stable, no deps) ──────────────────────────────────────────
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    cancelAnimationFrame(visemeRafRef.current);
    setVisemePlaybackMs(-1);
  }, []);

  const playSoundEffect = useCallback(async (src: string) => {
    stopAudio();
    const audio = new Audio(src);
    audioRef.current = audio;
    const ended = new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
    });
    await audio.play();
    await ended;
    if (audioRef.current === audio) audioRef.current = null;
  }, [stopAudio]);

  // ── callTts ──────────────────────────────────────────────────────────────
  const callTts = useCallback(async (text: string, msgId: string) => {
    if (!TTS_ENABLED) return;
    if (mutedRef.current || !text.trim()) return;
    stopAudio();
    setTtsLoading(true);
    try {
      const data = await fetchTtsVisemes(text, voiceStyleRef.current);
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
      });
      audio.addEventListener('ended', () => {
        cancelAnimationFrame(visemeRafRef.current);
        setVisemePlaybackMs(-1);
        setTimeout(() => {
          setVisemeStream([]);
          setFaceExpr('calm');
        }, 500);
      });
      const ended = new Promise<void>((resolve) => {
        audio.addEventListener('ended', () => resolve(), { once: true });
      });
      await audio.play();
      await ended;
    } catch {
      // TTS errors are non-fatal; chat text already shown
    } finally {
      setTtsLoading(false);
    }
  }, [stopAudio]);

  const handleStartChatting = useCallback(() => {
    if (sessionActive || streaming || voiceMode || ttsLoading) return;

    const nextSessionId = currentSessionId + 1;

    const assistantMsg: Transcript = {
      id: uid(),
      role: 'assistant',
      content: FIRST_MEETING_QUESTION,
      sessionId: nextSessionId,
    };

    setCurrentSessionId(nextSessionId);
    setSessionActive(true);
    setScriptedSessionStep('first-meeting');
    setTranscript((prev) => [...prev, assistantMsg]);
    setStreaming(true);
    setFaceExpr('gentle');

    void callTts(FIRST_MEETING_QUESTION, assistantMsg.id).finally(() => {
      setStreaming(false);
      setTimeout(() => setFaceExpr('calm'), 500);
    });
  }, [callTts, currentSessionId, sessionActive, streaming, ttsLoading, voiceMode]);

  const handleEndSession = useCallback(() => {
    if (!sessionActive) return;
    cancelRef.current?.();
    cancelRef.current = null;
    setSessionActive(false);
    setScriptedSessionStep('none');
    setStreaming(false);
    voiceClientRef.current?.disconnect();
    voiceClientRef.current = null;
    setVoiceMode(false);
    setVoiceReady(false);
    setVoiceError(null);
    setRecording(false);
    setRmsLevel(0);
    setLiveUserTranscript('');
    setLiveAssistantText('');
    game2SoundRef.current = null;
    setInput('');
    stopAudio();
    setFaceExpr('calm');
  }, [sessionActive, stopAudio]);

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !selectedPersonaId || !sessionActive || streaming) return;

    setInput('');

    const userMsg: Transcript = { id: uid(), role: 'user', content: text, sessionId: currentSessionId };
    const assistantMsg: Transcript = {
      id: uid(),
      role: 'assistant',
      content: '',
      streaming: true,
      sessionId: currentSessionId,
    };
    const shouldEndAfterReply = isSessionEndingMessage(text);

    if (scriptedSessionStep === 'first-meeting') {
      let fixedReply: string;
      let nextStep: ScriptedSessionStep;

      if (isNegative(text)) {
        fixedReply = `${OLD_FRIEND_INTRO_PREFIX}\n\n${pickReturningIntro()}`;
        nextStep = 'returning-intro-answer';
      } else if (isAffirmative(text)) {
        fixedReply = `${START_CHATTING_INTRO}\n\n${AGE_PROMPT}`;
        nextStep = 'age';
      } else {
        fixedReply = '你可以告诉我是或者不是哦。我们是第一次见面吗？';
        nextStep = 'first-meeting';
      }

      const fixedAssistantMsg: Transcript = {
        id: uid(),
        role: 'assistant',
        content: fixedReply,
        sessionId: currentSessionId,
      };

      setTranscript((prev) => [...prev, userMsg, fixedAssistantMsg]);
      setScriptedSessionStep(nextStep);
      setStreaming(true);
      setFaceExpr('gentle');

      void callTts(fixedReply, fixedAssistantMsg.id).finally(() => {
        setStreaming(false);
        setTimeout(() => setFaceExpr('calm'), 500);
        if (shouldEndAfterReply) {
          setScriptedSessionStep('none');
          setSessionActive(false);
        }
      });
      return;
    }

    if (scriptedSessionStep === 'age' || scriptedSessionStep === 'age-short') {
      const weatherPrompt = scriptedSessionStep === 'age-short' ? SHORT_WEATHER_PROMPT : WEATHER_PROMPT;
      const fixedAssistantMsg: Transcript = {
        id: uid(),
        role: 'assistant',
        content: weatherPrompt,
        sessionId: currentSessionId,
      };

      setTranscript((prev) => [...prev, userMsg, fixedAssistantMsg]);
      setScriptedSessionStep(scriptedSessionStep === 'age-short' ? 'weather-game-choice' : 'none');
      setStreaming(true);
      setFaceExpr('gentle');

      void callTts(weatherPrompt, fixedAssistantMsg.id).finally(() => {
        setStreaming(false);
        setTimeout(() => setFaceExpr('calm'), 500);
        if (shouldEndAfterReply) setSessionActive(false);
      });
      return;
    }

    if (scriptedSessionStep === 'weather-game-choice') {
      const gameRoll = Math.floor(Math.random() * 3);
      if (gameRoll === 1) {
        const selectedSound = pickGame2Sound();
        game2SoundRef.current = selectedSound;
        const introMsg: Transcript = {
          id: uid(),
          role: 'assistant',
          content: GAME_2_INTRO,
          sessionId: currentSessionId,
        };

        setTranscript((prev) => [...prev, userMsg, introMsg]);
        setScriptedSessionStep('game-2-answer');
        setStreaming(true);
        setFaceExpr('gentle');

        void (async () => {
          await callTts(GAME_2_INTRO, introMsg.id);
          await playSoundEffect(selectedSound.src);

          const questionMsg: Transcript = {
            id: uid(),
            role: 'assistant',
            content: selectedSound.question,
            sessionId: currentSessionId,
          };
          setTranscript((prev) => [...prev, questionMsg]);
          setStreaming(false);
          setTimeout(() => setFaceExpr('calm'), 500);
          if (shouldEndAfterReply) {
            setScriptedSessionStep('none');
            setSessionActive(false);
          }
        })().catch(() => {
          setStreaming(false);
          setFaceExpr('confused');
        });
        return;
      }

      const fixedReply = gameRoll === 0
        ? `${GAME_1_PREFIX}\n\n${pickGame1Story()}`
        : 'game 3';
      const fixedAssistantMsg: Transcript = {
        id: uid(),
        role: 'assistant',
        content: fixedReply,
        sessionId: currentSessionId,
      };

      setTranscript((prev) => [...prev, userMsg, fixedAssistantMsg]);
      setScriptedSessionStep(gameRoll === 0 ? 'game-1-completion' : 'none');
      setStreaming(true);
      setFaceExpr('gentle');

      void callTts(fixedReply, fixedAssistantMsg.id).finally(() => {
        setStreaming(false);
        setTimeout(() => setFaceExpr('calm'), 500);
        if (shouldEndAfterReply) {
          setScriptedSessionStep('none');
          setSessionActive(false);
        }
      });
      return;
    }

    if (scriptedSessionStep === 'game-2-answer') {
      const selectedSound = game2SoundRef.current;
      const fixedReply = selectedSound
        ? isGame2AnswerCorrect(text, selectedSound)
          ? selectedSound.correctResponse
          : selectedSound.wrongResponse
        : '我刚才的声音好像跑丢了。没关系，我们等下再玩一次声音侦探吧。';
      const fixedAssistantMsg: Transcript = {
        id: uid(),
        role: 'assistant',
        content: fixedReply,
        sessionId: currentSessionId,
      };

      setTranscript((prev) => [...prev, userMsg, fixedAssistantMsg]);
      game2SoundRef.current = null;
      setScriptedSessionStep('none');
      setStreaming(true);
      setFaceExpr('gentle');

      void callTts(fixedReply, fixedAssistantMsg.id).finally(() => {
        setStreaming(false);
        setTimeout(() => setFaceExpr('calm'), 500);
        if (shouldEndAfterReply) setSessionActive(false);
      });
      return;
    }

    if (scriptedSessionStep === 'game-1-completion') {
      const fixedReply = pickGame1CompletionResponse();
      const fixedAssistantMsg: Transcript = {
        id: uid(),
        role: 'assistant',
        content: fixedReply,
        sessionId: currentSessionId,
      };

      setTranscript((prev) => [...prev, userMsg, fixedAssistantMsg]);
      setScriptedSessionStep('none');
      setStreaming(true);
      setFaceExpr('gentle');

      void callTts(fixedReply, fixedAssistantMsg.id).finally(() => {
        setStreaming(false);
        setTimeout(() => setFaceExpr('calm'), 500);
        if (shouldEndAfterReply) setSessionActive(false);
      });
      return;
    }

    if (scriptedSessionStep === 'returning-intro-answer') {
      const fixedReply = fixedIntroAnswerResponse(text);
      const fixedAssistantMsg: Transcript = {
        id: uid(),
        role: 'assistant',
        content: fixedReply,
        sessionId: currentSessionId,
      };

      setTranscript((prev) => [...prev, userMsg, fixedAssistantMsg]);
      setScriptedSessionStep('age-short');
      setStreaming(true);
      setFaceExpr('gentle');

      void callTts(fixedReply, fixedAssistantMsg.id).finally(() => {
        setStreaming(false);
        setTimeout(() => setFaceExpr('calm'), 500);
        if (shouldEndAfterReply) setSessionActive(false);
      });
      return;
    }

    setTranscript((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    setFaceExpr('listening');

    // Reset streaming content accumulator
    streamingContentRef.current = '';

    // Build message history (exclude the empty streaming assistant placeholder)
    const history: ChatMessage[] = transcript
      .filter((t) => t.sessionId === currentSessionId)
      .filter((t) => t.content.trim())
      .map((t) => ({ role: t.role, content: t.content }));
    history.push({ role: 'user', content: text });

    const cancel = startChatStream(
      {
        personaId: selectedPersonaId,
        messages: history,
        ...(therapyMode ? { activityContext: { therapyMode: true as const } } : {}),
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
        onDone() {
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === assistantMsg.id ? { ...t, streaming: false } : t,
            ),
          );
          setStreaming(false);
          if (shouldEndAfterReply) setSessionActive(false);
          // Return to calm after a short delay
          setTimeout(() => setFaceExpr('calm'), 2000);

          // Trigger TTS for the completed assistant message
          const finalContent = streamingContentRef.current;
          streamingContentRef.current = '';
          void callTts(finalContent, assistantMsg.id);
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
  }, [
    callTts,
    currentSessionId,
    input,
    selectedPersonaId,
    sessionActive,
    scriptedSessionStep,
    streaming,
    transcript,
    therapyMode,
  ]);

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
      if (!selectedPersonaId || !sessionActive) return;
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
                    ? { ...t, id: uid(), content: text, sessionId: currentSessionId }
                    : t,
                );
              }
              return [
                ...prev,
                { id: uid(), role: 'user' as const, content: text, voiceMode: true, sessionId: currentSessionId },
              ];
            });
            if (isSessionEndingMessage(text)) {
              setScriptedSessionStep('none');
              setSessionActive(false);
            }
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
            {
              id,
              role: 'assistant' as const,
              content: '',
              streaming: true,
              voiceMode: true,
              sessionId: currentSessionId,
            },
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
  }, [currentSessionId, sessionActive, voiceMode, selectedPersonaId, stopAudio]);

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
                    : sessionActive
                      ? 'Send a message to continue the session'
                      : 'Press Start chatting to begin a session'}
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
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleStartChatting}
                disabled={sessionActive || streaming || voiceMode || ttsLoading}
                title="Start a new session"
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-200 transition-colors hover:bg-purple-500/25 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Play size={15} />
                Start chatting
              </button>
              <button
                onClick={handleEndSession}
                disabled={!sessionActive && !voiceMode}
                title="End the current session and keep the transcript"
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-slate-600 bg-led-panel px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Square size={14} />
                End session
              </button>
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
                disabled={!selectedPersonaId || (!sessionActive && !voiceMode)}
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
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={streaming || !selectedPersonaId || !sessionActive}
                  placeholder={
                    !sessionActive
                      ? 'Press Start chatting before sending messages'
                      : selectedPersona
                        ? `Say something to ${selectedPersona.name}… (Enter to send)`
                        : 'Loading…'
                  }
                  rows={2}
                  className="flex-1 resize-none bg-led-panel border border-led-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 disabled:opacity-40 transition-colors"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || streaming || !selectedPersonaId || !sessionActive}
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
