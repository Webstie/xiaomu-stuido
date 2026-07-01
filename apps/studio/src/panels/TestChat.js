import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useState, useEffect, useRef, useCallback, } from 'react';
import { Send, ChevronDown, ChevronUp, Copy, Check, Zap, ZapOff, Volume2, VolumeX, RotateCcw, Mic, MicOff, Music, Play, Pause, SkipForward, X, Activity as ActivityIcon, PlayCircle, StopCircle, ShieldAlert, Baby, Loader2, } from 'lucide-react';
import FaceRenderer from '../face/FaceRenderer.js';
import { assessUserRisk, classifyIntent, fetchConfig, fetchSystemPrompt, fetchTtsVisemes, transcribeAudio } from '../api/client.js';
import { VoiceInputRecorder } from '../audio/voice-input-recorder.js';
import { startChatStream } from '../api/chatStream.js';
import { EXPRESSIONS } from '../face/expressions.js';
import { VoiceLiveClient } from '../audio/voice-live-client.js';
const RECOMMENDED_GAMES = {
    'rhythm': {
        activityId: 'body-rhythm',
        displayName: '身体小乐队',
        card: '身体小乐队——这个游戏是把身体当成乐器!拍手、跺脚、打响指,跟着节奏敲出你自己的节拍。不需要乐器,你的身体就是最好的乐队。',
    },
    'co-creation': {
        activityId: 'co-creation',
        displayName: '三个音符变魔法',
        card: '三个音符变魔法——这个游戏是你选三个音符,系统帮你变成一段小旋律,再用音乐魔法把它变出不一样的样子。三个音就能玩出完全不一样的感觉,试试看?',
    },
    'breathing': {
        activityId: 'breathing',
        displayName: '呼吸练习',
        card: '呼吸练习——这个练习是跟着音乐慢慢吸气、吐气,让心跳和旋律变成好朋友。做完会觉得身体变轻,心里也安安静静的。',
    },
    'emotion-mapping': {
        activityId: 'emotion-music-mapping',
        displayName: '音乐心情猜猜猜',
        card: '音乐心情猜猜猜——这个练习是听一小段音乐,猜猜它是什么心情——开心的?还是有点难过?像给音乐贴表情包,慢慢你就能听懂音乐在说什么了。',
    },
};
const SUNNY_POOL = ['rhythm', 'co-creation'];
const QUIET_POOL = ['breathing', 'emotion-mapping', 'co-creation'];
const SUNNY_RECOMMENDATION = '原来是晴天啊!阳光好的日子,身体也想跟着动起来呢。我来给你推荐两个小游戏吧:身体小乐队和三个音符变魔法。你对哪一个小游戏感兴趣呢?请告诉我这个游戏的名字,我可以简单给你介绍一下。';
function quietRecommendationLocal(weatherWord) {
    return `原来是${weatherWord}啊。这种天气适合安安静静地和自己待一会儿。我来给你推荐三个小练习吧:呼吸练习、音乐心情猜猜猜和三个音符变魔法。你对哪一个小游戏感兴趣呢?请告诉我这个游戏的名字,我可以简单给你介绍一下。`;
}
const RE_ASK_WEATHER = '嗯,我没太听明白。哪个天气更代表你现在的心情呢?';
const GAME_DECIDE_PROMPT = '你想尝试一下这个小游戏吗?还是想看看其他游戏?如果是的话,请告诉我你想要了解的游戏。';
const GAME_START_LINE = '好啊,那我们现在就开始咯。';
const GAME_POOL_EXHAUSTED_PROMPT = '那你想做什么呢?我们可以做呼吸练习、身体小乐队、音乐心情猜猜猜、或者三个音符变魔法。';
const RE_ASK_GAME_NAME_UNMATCHED = '哎呀这个名字我好像没对上,不过我这里有这些游戏可以选:身体小乐队、跟着音乐深呼吸、音乐心情猜猜猜、三个音符变魔法。你对哪个好奇呀?';
const RE_ASK_GAME_NAME_VAGUE = '太好啦!那你想先试哪一个呢?我这里有四种小游戏等着你呢,挑一个名字最吸引你的就行～';
// Spoken once when all seven emotions in 音乐心情猜猜猜 have been heard. This is
// a fixed CLOSING line (a question, but the answer is routed through the
// scripted game-pick machine — never back into the model with start_activity,
// so the activity can't auto-restart). See the emotion-mapping branch in onDone.
const EMOTION_MAPPING_CLOSING = '七种心情都听完啦！你想歇一歇，还是换一个小游戏呢？';
// Fixed safety responses — spoken in place of scripted dispatch / LLM when
// the front-line safety check fires. These short-circuit BEFORE any scripted
// step so distress can never be swallowed by the intro yes/no classifier.
const HIGH_RISK_RESPONSE = '如果你有时候心里特别难受,或者想伤害自己,请一定记住:这不是你的错。' +
    '你可以马上跑到爸爸妈妈、老师,或者任何一个你信任的大人身边,拉住他们的手,' +
    '说:"我需要帮助。"他们会抱住你,听你说话。\n\n' +
    '你也可以随时打电话:\n\n' +
    '12355——青少年心理咨询热线,专门帮助小朋友和大孩子\n' +
    '400-161-9995——希望24热线,24小时危机干预热线';
const CONCERNING_RESPONSE = '听起来,你现在心里一定很沉重吧。谢谢你愿意告诉我这些。\n' +
    '你不需要一个人扛着。有时候,和身边的人聊一聊——比如老师或者家人——真的会有帮助。' +
    '我记得有一次,我在一次音乐表演里没有拿到自己想要的角色,那时候我也开始怀疑自己。' +
    '后来,我去问了身边的人,他们给了很大的鼓励。他们告诉我这不是我的问题,只是那个角色不太适合我。\n\n' +
    '如果实在找不到可以说话的人,就找个办法把压力释放出来吧:' +
    '我们可以一起听一些轻柔的音乐,或者,如果你愿意,就这样慢慢地、深深地呼吸几次。\n\n' +
    '要不要我现在放一段轻柔的音乐给你听?';
// Module-level alternation cursor: rotates through
// safety.comfortMusicFiles so every track gets played in turn, instead of
// relying on Math.random (which the operator observed always landing on
// the same file). Masked by files.length at use-time, so resizing the
// config list mid-session doesn't break the rotation.
let comfortMusicCursor = 0;
const COMFORT_MUSIC_ACCEPTED = '好,我放一段给你听,你可以闭上眼睛慢慢呼吸。';
const COMFORT_MUSIC_DECLINED = '好的,你想再说点什么我都在听。';
const FIRST_MEETING_QUESTION = '我们是第一次见面吗？';
const START_CHATTING_INTRO = '嗨！我来自彩虹缤纷镇，一个五彩缤纷的地方。那里的人们都喜欢唱歌，或者弹琴、拍手，用音乐说出心里的话。我相信音乐能让心情好起来，也能让人不再孤单。我走了很远来找你，想和你一起唱歌，找到你的歌。你几岁啦？我们一起唱吧！';
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
const GAME_2_INTRO = '在开始体现其他活动之前，我有一个我们可以玩的小游戏哦\n\n' +
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
const SOUND_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'];
async function resolveSoundUrl(base) {
    for (const ext of SOUND_EXTENSIONS) {
        const url = `/api/audio/file/${encodeURIComponent(`${base}.${ext}`)}`;
        try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok)
                return url;
        }
        catch {
            /* keep trying */
        }
    }
    return null;
}
const GAME_2_SOUNDS = [
    {
        id: 'chicken',
        label: '鸡 Chicken',
        base: 'chicken',
        question: '仔细听……\n\n你觉得是什么东西发出的声音？',
        correctKeywords: ['鸡', '小鸡', '母鸡', '公鸡', '大鸡', '鸡叫', '咯咯', '咕咕'],
        correctResponse: '答对啦！听得好准！\n\n那是鸡。\n\n鸡在走来走去、找食物、或者跟其他鸡说话的时候，常常会发出"咯咯咯"的声音。\n\n你的耳朵像侦探一样灵！',
        wrongResponse: '你猜得也很认真哦！\n\n答案是鸡。\n\n你有没有听到那种短短的"咯咯"声？很多鸡在农场里走动的时候，会发出这种快快的、一跳一跳的声音。\n\n你听得很仔细呢。',
    },
    {
        id: 'wind',
        label: '风 Wind',
        base: 'wind',
        question: '仔细听……\n\n你觉得是什么东西发出的声音？',
        correctKeywords: ['风', '大风', '微风', '风声', '刮风', '吹风', '呼呼', '空气'],
        correctResponse: '太棒了！\n\n那是风。\n\n风吹过树林、草地或者房子的时候，常常会发出长长的、软软的"呼——"声。\n\n你听出来那个声音很平滑、很流动。听得真厉害！',
        wrongResponse: '你猜得很不错哦！\n\n答案是风。\n\n那种长长的"呼——"声，是流动的空气发出来的。有时候风声听起来像在轻轻说话，像海浪，甚至像树林里的音乐。\n\n你猜得很接近啦，因为大自然的声音有时候确实不容易分清楚！',
    },
    {
        id: 'rain',
        label: '雨 Rain',
        base: 'rain',
        question: '仔细听这个……\n\n你觉得是什么东西发出的声音？',
        correctKeywords: ['雨', '小雨', '大雨', '雨水', '下雨', '雨声', '雨滴', '滴答', '嗒嗒'],
        correctResponse: '太厉害了！\n\n那是雨。\n\n雨滴落到地上、窗户上、树叶上、屋顶上，会发出很多小小的"嗒嗒"声。\n\n你认出了那些小水滴的声音！真是了不起的侦探！',
        wrongResponse: '猜得不错哦！\n\n答案是雨。\n\n你有没有听到好多小小的"嗒嗒嗒"声？雨就是很多很多小水滴一起落下来。\n\n你猜得很棒，因为雨声有时候听起来像风或者树叶沙沙响。',
    },
    {
        id: 'dog',
        label: '狗 Dog',
        base: 'dog',
        question: '仔细听……\n\n你觉得是什么动物发出的声音？',
        correctKeywords: ['狗', '小狗', '狗狗', '大狗', '汪汪', '犬', '狗叫'],
        correctResponse: '汪汪！你猜对啦！\n\n那是狗。\n\n狗在兴奋的时候、玩的时候、保护家的时候、或者想引起人注意的时候，就会汪汪叫。\n\n你一下子就听出来了！',
        wrongResponse: '想得很对呢！\n\n答案是狗。\n\n狗在兴奋或者想跟人说话的时候，常常会发出"汪汪"的声音。\n\n你猜得很棒，因为很多动物的声音确实有点像。\n\n你做得非常好！',
    },
    {
        id: 'bird',
        label: '鸟 Bird',
        base: 'bird',
        question: '仔细听……\n\n你觉得是什么东西发出的声音？',
        correctKeywords: ['鸟', '小鸟', '鸟儿', '鸟叫', '鸟鸣', '叽叽', '喳喳', '麻雀', '乌鸦', '燕子'],
        correctResponse: '太厉害了！\n\n那是鸟。\n\n鸟儿们常常用叽叽喳喳和唱歌来互相说话。有些鸟早上唱歌，有些鸟用歌声找朋友或者保护自己的地盘。\n\n你的侦探本领真强！',
        wrongResponse: '你猜得真有创意！\n\n答案是鸟。\n\n你有没有听到那种轻轻的、尖尖的"叽叽"声？鸟儿们就用这些声音来聊天。',
    },
];
const OLD_FRIEND_INTRO_PREFIX = '原来我们是老朋友啊，那我给你分享一下我今天的故事。';
// New old-friend flow splits the recognition: first half + age question;
// second half ("...那我给你分享我今天的故事") rides on top of the daily story
// after the child answers their age.
const OLD_FRIEND_RECOGNITION = '原来我们是老朋友啊！';
const OLD_FRIEND_AGE_TO_STORY = '好，那我给你分享一下我今天的故事。';
const WEATHER_PROMPT = '在我们的家乡，我们喜欢用天气说心情：晴天太阳暖暖的，心里开心得想笑；雨天滴滴答答，有点难过；雪天轻轻飘，心里很安静；打雷时，轰隆隆，有点害怕。你觉得今天你的心情像哪个天气呀？';
// Younger kids (≤7) get a shorter version that drops the snow option.
const WEATHER_PROMPT_YOUNG = '在我们的家乡，我们喜欢用天气说心情：晴天太阳暖暖的，心里开心得想笑；雨天滴滴答答，有点难过；打雷时，轰隆隆，有点害怕。你觉得今天你的心情像哪个天气呀？';
function weatherPromptForAge(prompt, childAge) {
    return childAge <= 7 ? WEATHER_PROMPT_YOUNG : prompt;
}
// Kids answer the age question in whatever form is natural: "3", "3岁",
// "三", "三岁了", "我五岁", "两岁半". A bare /\d+/ only catches the
// Western-digit cases and silently drops Chinese numerals (which is why
// "三岁了" used to leave childAge stuck on the default while "3" worked).
// parseAgeFromText covers both. Returns null when nothing numeric is found.
const CN_DIGITS = {
    '零': 0, '〇': 0,
    '一': 1, '壹': 1, '幺': 1,
    '二': 2, '两': 2, '俩': 2, '贰': 2,
    '三': 3, '叁': 3,
    '四': 4, '肆': 4,
    '五': 5, '伍': 5,
    '六': 6, '陆': 6,
    '七': 7, '柒': 7,
    '八': 8, '捌': 8,
    '九': 9, '玖': 9,
};
const CN_UNITS = { '十': 10, '拾': 10, '百': 100, '佰': 100 };
function parseAgeFromText(text) {
    // Western digits win when present (e.g. "3", "3岁").
    const ascii = text.match(/\d+/);
    if (ascii) {
        const n = parseInt(ascii[0], 10);
        return Number.isFinite(n) ? n : null;
    }
    // Fall back to Chinese numerals. Handles 一–九, 两/俩, and 十/百 compounds
    // (十五 = 15, 二十三 = 23, 一百二十 = 120). Non-numeral chars (岁, 了, 半…)
    // are ignored. This easily spans the [1, 120] age range we validate against.
    let section = 0; // accumulated value within the current 十/百 run
    let current = 0; // pending standalone digit not yet multiplied by a unit
    let sawNumeral = false;
    for (const ch of text) {
        const digit = CN_DIGITS[ch];
        const unit = CN_UNITS[ch];
        if (digit !== undefined) {
            current = digit;
            sawNumeral = true;
        }
        else if (unit !== undefined) {
            // Bare leading "十" means one ten (十五 = 15, not 0×10).
            section += (current === 0 ? 1 : current) * unit;
            current = 0;
            sawNumeral = true;
        }
    }
    return sawNumeral ? section + current : null;
}
const RETURNING_SESSION_INTROS = [
    '我今天在小镇的喷泉广场遇到了一个叫小轩的新朋友，他当时正抱着吉他坐在台阶上试音，我们俩试着即兴合奏了一段，默契得就像认识了很久一样。你今天过得怎么样呢？有什么好玩的事吗？',
    '刚才外面突然下起了暴雨，我刚好跑到面包房的屋檐下躲雨，听着雨点砸在雨棚和铜铃上发出错落有致的声音，发现这其实是一首特别棒的天然打击乐。你今天过得怎么样呢？有什么好玩的事吗？',
    '我下午去了小镇后山的一个回音溶洞，里面极度安静，偶尔落下一两滴水，在空旷的岩洞里回荡出特别干净、纯粹的单音，感觉一整天的浮躁都被洗干净了。你今天过得怎么样呢？有什么好玩的事吗？',
    '我今天在琴房里跟一首新曲子死磕了整整四个小时，换了新钢弦的木吉他把手指头都磨红了，但最后能完整弹下来的那一刻简直爽翻了。你今天过得怎么样呢？有什么好玩的事吗？',
    '我刚从镇子西边的温泉散步回来，每次练完琴手腕发酸的时候，我都喜欢去那里坐坐，听着水面咕嘟咕嘟冒泡的声音，感觉整个人都能彻底放空。你今天过得怎么样呢？有什么好玩的事吗？',
    '我今天去小镇最著名的糖果工坊买了一盒刚出炉的太空脆皮巧克力，用力咬下去时那声"嘎吱"的清脆碎裂声，简直是我今天听过最治愈、最让人满足的音效了。你今天过得怎么样呢？有什么好玩的事吗？',
    '我今天一下午都窝在阁楼里整理那些旧乐谱，很多谱子的背面都写着以前那些乐手在各个地方旅行、冒险的小故事，看着看着时间就过得飞快。你今天过得怎么样呢？有什么好玩的事吗？',
    '我今天在镇子街角看到一个和你差不多大的女孩子，在面对一个突然坏掉、疯狂刺耳大叫的音响时，她居然非常冷静地走过去直接拔掉了电源，全场都被她帅到了。你今天过得怎么样呢？有什么好玩的事吗？',
    '我今天拿着录音笔在小镇的红杉林里跑了一整天，录到了最清脆的夏日鸟鸣和风吹过树叶的沙沙声，感觉这些大自然的声音有一种神奇的魔力。你今天过得怎么样呢？有什么好玩的事吗？',
    '我刚刚把今天收集到的灵感全部复盘了一遍，现在脑子里全是各种奇妙的旋律，一个人弹琴实在有点闷，特别想找个人聊聊天。你今天过得怎么样呢？有什么好玩的事吗？',
];
function pickReturningIntro() {
    return RETURNING_SESSION_INTROS[Math.floor(Math.random() * RETURNING_SESSION_INTROS.length)];
}
function pickGame1Story() {
    return GAME_1_STORIES[Math.floor(Math.random() * GAME_1_STORIES.length)];
}
function pickGame1CompletionResponse() {
    return GAME_1_COMPLETION_RESPONSES[Math.floor(Math.random() * GAME_1_COMPLETION_RESPONSES.length)];
}
function pickGame2Sound() {
    return GAME_2_SOUNDS[Math.floor(Math.random() * GAME_2_SOUNDS.length)];
}
/**
 * Async model-based intent check. True if the child's message expresses
 * direct intent to do an activity (or escape the intro). The keyword version
 * missed phrasings like "我们直接玩音乐吧" or "I'd love to make a song".
 *
 * Fails closed: on classifier error or any non-yes label, returns false so
 * the scripted handler runs normally.
 */
async function isActivityIntent(text) {
    try {
        const label = await classifyIntent(text, 'activity-intent');
        return label === 'yes';
    }
    catch {
        return false;
    }
}
/**
 * Sound Detective answer check. Asks the model whether the child's guess
 * matches the expected sound (passed via context). The expected text is the
 * sound's display label, e.g. "鸡 Chicken".
 */
async function isSoundAnswerCorrect(text, expectedLabel) {
    try {
        const label = await classifyIntent(text, 'sound-match', expectedLabel);
        return label === 'yes';
    }
    catch {
        return false;
    }
}
/**
 * Did the child say they're done with the Rhythm Story task (e.g. "我拍完啦")?
 */
async function isTaskCompleted(text) {
    try {
        const label = await classifyIntent(text, 'task-completed');
        return label === 'yes';
    }
    catch {
        return false;
    }
}
/**
 * Mood-aware reply for the old-friend "what did you do today" answer. Uses the
 * shared 'mood' classifier instead of a keyword list so it catches phrasings
 * the keyword version missed.
 */
async function moodIntroAnswerResponse(text, ageSuffix) {
    let mood = 'unclear';
    try {
        const raw = await classifyIntent(text, 'mood');
        if (raw === 'positive' || raw === 'negative' || raw === 'neutral' || raw === 'unclear') {
            mood = raw;
        }
    }
    catch {
        mood = 'unclear';
    }
    switch (mood) {
        case 'negative': return `没事，还有很多好事情呢！${ageSuffix}`;
        case 'positive': return `那太棒了，真的很有意思呢。${ageSuffix}`;
        case 'neutral': return `哦，平凡的一天也是很不错的呀。${ageSuffix}`;
        default: return `听起来很特别呢，谢谢你告诉我。${ageSuffix}`;
    }
}
async function isGoodbyeIntent(text) {
    try {
        const raw = await classifyIntent(text, 'goodbye');
        return raw === 'yes';
    }
    catch {
        return false;
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() {
    return Math.random().toString(36).slice(2);
}
function SanitizerPreview({ original, ssml }) {
    const [open, setOpen] = useState(false);
    return (_jsxs("div", { className: "text-[10px]", children: [_jsxs("button", { onClick: () => setOpen((v) => !v), className: "flex items-center gap-1 text-slate-700 hover:text-slate-500 transition-colors", children: [open ? _jsx(ChevronUp, { size: 9 }) : _jsx(ChevronDown, { size: 9 }), "Sanitizer preview"] }), open && (_jsxs("div", { className: "mt-1 rounded border border-led-border bg-led-bg p-2 space-y-1.5 max-w-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "text-slate-600 uppercase tracking-wider mb-0.5", children: "Original" }), _jsx("div", { className: "text-slate-400 break-words", children: original })] }), _jsxs("div", { children: [_jsx("div", { className: "text-slate-600 uppercase tracking-wider mb-0.5", children: "SSML" }), _jsx("pre", { className: "text-[9px] text-slate-400 whitespace-pre-wrap break-all font-mono overflow-auto max-h-32", children: ssml })] })] }))] }));
}
// ── Component ─────────────────────────────────────────────────────────────────
export default function TestChat() {
    // ── Data loading ────────────────────────────────────────────────────────────
    // childAge is captured from the kid's reply during the scripted intro
    // ('age', 'age-short', or 'returning-age' step). Until then it falls back
    // to AGE_DEFAULT so any early activity-intent bypass still has a valid age
    // to send to the LLM.
    const AGE_DEFAULT = 8;
    const [childAge, setChildAge] = useState(AGE_DEFAULT);
    const childAgeRef = useRef(AGE_DEFAULT);
    useEffect(() => { childAgeRef.current = childAge; }, [childAge]);
    const [defaultVoice, setDefaultVoice] = useState(undefined);
    const [loadError, setLoadError] = useState(null);
    useEffect(() => {
        fetchConfig()
            .then((c) => {
            setDefaultVoice(c.voice.defaultVoice);
            gamesConfigRef.current = c.games ?? null;
            convFlowRef.current = c.conversationFlow ?? null;
            safetyRef.current = c.safety ?? null;
        })
            .catch((e) => setLoadError(e.message));
    }, []);
    // ── System prompt disclosure ─────────────────────────────────────────────
    const [promptOpen, setPromptOpen] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [promptLoading, setPromptLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        setSystemPrompt('');
        if (!promptOpen)
            return;
        setPromptLoading(true);
        fetchSystemPrompt(childAge)
            .then(setSystemPrompt)
            .catch(() => setSystemPrompt('(failed to load system prompt)'))
            .finally(() => setPromptLoading(false));
    }, [childAge, promptOpen]);
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
    const [scriptedSessionStep, setScriptedSessionStep] = useState('none');
    const scriptedSessionStepRef = useRef('none');
    scriptedSessionStepRef.current = scriptedSessionStep;
    // ── Chat state ───────────────────────────────────────────────────────────
    const [transcript, setTranscript] = useState([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const cancelRef = useRef(null);
    const scrollRef = useRef(null);
    // ── Face state ───────────────────────────────────────────────────────────
    const [faceExpr, setFaceExpr] = useState('calm');
    // ── TTS / audio state ────────────────────────────────────────────────────
    const [muted, setMuted] = useState(false);
    const [voiceStyle, setVoiceStyle] = useState('cheerful');
    const [ttsLoading, setTtsLoading] = useState(false);
    const [visemeStream, setVisemeStream] = useState([]);
    const [visemePlaybackMs, setVisemePlaybackMs] = useState(-1);
    // ── Voice Live state ─────────────────────────────────────────────────────
    const [voiceMode, setVoiceMode] = useState(false);
    const [recording, setRecording] = useState(false);
    const [voiceReady, setVoiceReady] = useState(false);
    const [voiceError, setVoiceError] = useState(null);
    const [liveUserTranscript, setLiveUserTranscript] = useState('');
    const [liveAssistantText, setLiveAssistantText] = useState('');
    const [rmsLevel, setRmsLevel] = useState(0);
    // ── One-shot voice input (mic button in text mode) ───────────────────────
    // Independent of voiceMode (Voice Live). Click → record → VAD auto-stop →
    // Azure Speech REST transcribe → sendMessage(text). Click during recording
    // cancels without sending.
    const [voiceInputState, setVoiceInputState] = useState('idle');
    const [voiceInputLevel, setVoiceInputLevel] = useState(0);
    const [voiceInputError, setVoiceInputError] = useState(null);
    const voiceInputRecorderRef = useRef(null);
    // ── Active activity (from start_activity tool call) ──────────────────────
    const [activeActivity, setActiveActivity] = useState(null);
    const [activitySectionIndex, setActivitySectionIndex] = useState(0);
    const [activityPlaylist, setActivityPlaylist] = useState(null);
    // Co-creation: did any play_melody fire yet this session? Used to swap the
    // "Waiting for the child to pick three notes…" hint for something accurate
    // once we're past Stage 2.
    const [coCreationMusicPlayed, setCoCreationMusicPlayed] = useState(false);
    // Co-creation explicit stage tracking — sent to the server in activityContext
    // so the model knows which stage to deliver without inferring from history.
    const [coCreationLastVariant, setCoCreationLastVariant] = useState('none');
    const [coCreationNotes, setCoCreationNotes] = useState(null);
    const activityAudioRef = useRef(null);
    const autoAdvanceTimerRef = useRef(null);
    const emotionTimerRafRef = useRef(null);
    const [autoAdvancePending, setAutoAdvancePending] = useState(false);
    // Comfort music — soft track played after a `concerning` distress response
    // when the child says yes. Rendered as a top banner (same shape as the
    // activity-playlist bar), NOT an inline `<audio controls>` in the transcript.
    const [comfortMusic, setComfortMusic] = useState(null);
    const comfortMusicAudioRef = useRef(null);
    // Co-creation: play_melody result is queued here when it arrives mid-stream,
    // then released after the model's current TTS finishes — otherwise the music
    // starts on top of the Stage 4/5 narration the model is about to speak.
    const pendingMelodyRef = useRef(null);
    const flushPendingMelody = useCallback(() => {
        const pending = pendingMelodyRef.current;
        if (!pending)
            return;
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
    const audioRef = useRef(null);
    const visemeRafRef = useRef(0);
    const streamingContentRef = useRef('');
    const mutedRef = useRef(false);
    const voiceStyleRef = useRef('cheerful');
    const voiceClientRef = useRef(null);
    const liveAssistantMsgIdRef = useRef('');
    // Keep mutable refs in sync with state
    mutedRef.current = muted;
    voiceStyleRef.current = voiceStyle;
    const defaultVoiceRef = useRef(undefined);
    defaultVoiceRef.current = defaultVoice;
    // Scroll transcript to bottom as messages arrive
    useEffect(() => {
        const el = scrollRef.current;
        if (el)
            el.scrollTop = el.scrollHeight;
    }, [transcript]);
    // Cleanup voice client on unmount
    useEffect(() => () => { voiceClientRef.current?.disconnect(); }, []);
    // Cleanup activity audio on unmount
    useEffect(() => () => {
        activityAudioRef.current?.pause();
        activityAudioRef.current = null;
    }, []);
    // Comfort music — drive a single hidden <audio> via state. The banner UI
    // toggles `paused` and the X button sets comfortMusic to null.
    useEffect(() => {
        if (!comfortMusic) {
            comfortMusicAudioRef.current?.pause();
            comfortMusicAudioRef.current = null;
            return;
        }
        const wanted = `/api/audio/file/${encodeURIComponent(comfortMusic.filename)}`;
        let audio = comfortMusicAudioRef.current;
        // New track (or first time) — spin up a fresh element. Comparing by full
        // URL handles the case where the cursor advances to the same filename.
        if (!audio || audio.src.split(location.origin).pop() !== wanted) {
            audio?.pause();
            audio = new Audio(wanted);
            audio.volume = 0.7;
            comfortMusicAudioRef.current = audio;
            audio.addEventListener('ended', () => setComfortMusic(null));
            audio.addEventListener('error', () => {
                // eslint-disable-next-line no-console
                console.error('[comfort-music] failed to load', wanted, audio?.error);
                setComfortMusic(null);
            });
        }
        if (comfortMusic.paused) {
            if (!audio.paused)
                audio.pause();
        }
        else if (audio.paused) {
            void audio.play().catch((e) => {
                // eslint-disable-next-line no-console
                console.error('[comfort-music] play() rejected', e);
            });
        }
    }, [comfortMusic]);
    // End-session: kill comfort music too. handleEndSession only touches audioRef
    // / activityAudioRef; this catches the comfort track on top of those.
    useEffect(() => {
        if (sessionActive)
            return;
        if (comfortMusic)
            setComfortMusic(null);
    }, [sessionActive, comfortMusic]);
    // Activity playlist: create new <audio> when playlist or track index changes
    useEffect(() => {
        if (!activityPlaylist) {
            activityAudioRef.current?.pause();
            activityAudioRef.current = null;
            return;
        }
        const filename = activityPlaylist.playlist[activityPlaylist.index];
        if (!filename)
            return;
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
                if (playsLeft > 1)
                    return; // only fade on the last pass
                if (fadeStarted || !isFinite(audio.duration) || audio.duration <= 0)
                    return;
                const remainingMs = (audio.duration - audio.currentTime) * 1000;
                if (remainingMs > FADE_MS)
                    return;
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
                void audio.play().catch(() => { });
                return;
            }
            if (finalEndedFired)
                return;
            finalEndedFired = true;
            window.clearTimeout(watchdog);
            // Emotion-mapping uses the per-section 20s timer to drive advancement.
            if (activeActivityRef.current?.id === 'emotion-music-mapping')
                return;
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
                if (!prev)
                    return null;
                if (prev.playlist.length === 0)
                    return null;
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
    const startEmotionMappingTimer = useCallback((totalMs, fadeMs, onComplete) => {
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
                if (onComplete) {
                    // Final emotion's window elapsed — hand off (e.g. the closing line)
                    // instead of advancing to a non-existent next emotion / "继续".
                    onComplete();
                    return;
                }
                // Advance the playlist to the next emotion's audio.
                setActivityPlaylist((prev) => {
                    if (!prev)
                        return null;
                    if (prev.index + 1 >= prev.playlist.length)
                        return null;
                    return { ...prev, index: prev.index + 1, paused: false };
                });
                // Drive the chat section forward.
                sendMessageRef.current?.('继续', { silent: true });
                return;
            }
            emotionTimerRafRef.current = requestAnimationFrame(tick);
        };
        emotionTimerRafRef.current = requestAnimationFrame(tick);
    }, []);
    // Activity playlist: pause/resume the current track on toggle
    useEffect(() => {
        const audio = activityAudioRef.current;
        if (!audio)
            return;
        if (activityPlaylist?.paused) {
            audio.pause();
        }
        else {
            void audio.play().catch(() => { });
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
            if (!prev)
                return null;
            if (prev.index + 1 >= prev.playlist.length)
                return null;
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
    const activeActivityRef = useRef(null);
    const sectionIndexRef = useRef(0);
    const sendMessageRef = useRef(null);
    const coCreationLastVariantRef = useRef('none');
    const coCreationNotesRef = useRef(null);
    activeActivityRef.current = activeActivity;
    sectionIndexRef.current = activitySectionIndex;
    // NB: coCreationLastVariantRef / coCreationNotesRef are NOT synced here.
    // The render-time sync races with the setStates in onToolCall — every onText
    // delta triggers a re-render, and if that render sees stale state it clobbers
    // the ref to 'none', sending the wrong context on the next silent "继续".
    // Refs are mutated explicitly in onToolCall, endActivity, clearConversation.
    // API-side message history. Includes silent auto-advance turns that don't
    // appear in the visible transcript, so the chat doesn't get polluted with "继续".
    const apiHistoryRef = useRef([]);
    // Game configs loaded from /api/config. Refreshed on mount and on
    // handleStartChatting so panel edits propagate at session boundaries.
    // Null until first fetch resolves — pickers fall back to hardcoded constants
    // (defined further up in this file) if the ref is null or doesn't contain
    // the matching kind.
    const gamesConfigRef = useRef(null);
    // Conversation-flow config — scripted intro phrases, transitions, break
    // settings. Same fallback pattern as gamesConfigRef: refreshed on mount and
    // session start; getters fall through to the file-level constants if the
    // ref is null or the field is missing.
    const convFlowRef = useRef(null);
    // Safety config — distress keywords + deterministic compassionate response.
    // Distress detection runs on EVERY non-silent user message before any other
    // logic (scripted intro / activity / LLM). The message never reaches the
    // model, which also avoids Azure's content-policy filter tripping.
    const safetyRef = useRef(null);
    // Free-form turn counter. Incremented when the child sends a non-silent
    // message while NOT in scripted intro and NOT inside an activity (activities
    // count as exactly one turn — the trigger). When count reaches
    // maxTurnsBeforeBreak, a break suggestion is injected on the next onDone.
    const userTurnCountRef = useRef(0);
    const breakDueRef = useRef(false);
    const game2SoundRef = useRef(null);
    // ── Game-recommendation flow (weather → recommend → pick → decide) ──────
    // gamePoolRef holds the remaining recommended games for this session (sunny
    // bucket = 2, quiet = 3). introducedGamesRef remembers everything the child
    // has already heard the card for, so "look at others" doesn't repeat. When
    // the pool drains, we fall through to 'game-pool-exhausted' and hand back
    // to the model.
    const gamePoolRef = useRef([]);
    const introducedGamesRef = useRef(new Set());
    const currentGameRef = useRef(null);
    // Helpers that prefer config.games over the hardcoded fallbacks.
    const getRhythmStory = () => {
        const g = gamesConfigRef.current?.find((x) => x.kind === 'rhythm-story');
        return g ?? null;
    };
    const getSoundDetective = () => {
        const g = gamesConfigRef.current?.find((x) => x.kind === 'sound-detective');
        return g ?? null;
    };
    const getGame1Prefix = () => getRhythmStory()?.prefix ?? GAME_1_PREFIX;
    const getGame2Intro = () => getSoundDetective()?.intro ?? GAME_2_INTRO;
    // ── Conversation-flow getters (config → fallback to file-level constants) ─
    const getFirstMeetingQuestion = () => convFlowRef.current?.firstMeetingQuestion || FIRST_MEETING_QUESTION;
    const getStartChattingIntro = () => convFlowRef.current?.startChattingIntro || START_CHATTING_INTRO;
    const getAgePrompt = () => convFlowRef.current?.agePrompt || AGE_PROMPT;
    const getShortWeatherPrompt = () => convFlowRef.current?.shortWeatherPrompt || SHORT_WEATHER_PROMPT;
    const getWeatherPrompt = () => convFlowRef.current?.weatherPrompt || WEATHER_PROMPT;
    const getOldFriendIntroPrefix = () => convFlowRef.current?.oldFriendIntroPrefix || OLD_FRIEND_INTRO_PREFIX;
    const pickReturningIntroFromConfig = () => {
        const arr = convFlowRef.current?.returningSessionIntros;
        if (arr && arr.length > 0)
            return arr[Math.floor(Math.random() * arr.length)];
        return pickReturningIntro();
    };
    const pickBreakSuggestion = () => {
        const arr = convFlowRef.current?.breakSuggestionPhrases;
        if (arr && arr.length > 0)
            return arr[Math.floor(Math.random() * arr.length)];
        return '欸，我们已经聊了不少了，要不要先歇一歇？想接着玩就告诉我哦。';
    };
    const getMaxTurnsBeforeBreak = () => convFlowRef.current?.maxTurnsBeforeBreak ?? 8;
    const pickGame1StoryFromConfig = () => {
        const cfg = getRhythmStory();
        const stories = cfg && cfg.stories.length > 0 ? cfg.stories : GAME_1_STORIES;
        return stories[Math.floor(Math.random() * stories.length)];
    };
    const pickGame1CompletionFromConfig = () => {
        const cfg = getRhythmStory();
        const responses = cfg && cfg.completionResponses.length > 0
            ? cfg.completionResponses
            : GAME_1_COMPLETION_RESPONSES;
        return responses[Math.floor(Math.random() * responses.length)];
    };
    /**
     * Pick a Game 2 sound and resolve it to a ready-to-play shape.
     * Tries config.games first (exact `audioFilename` from the panel);
     * falls back to the hardcoded constants which probe extensions via resolveSoundUrl.
     * Returns null only if both sources have no playable sound.
     */
    const pickGame2SoundFromConfig = async () => {
        const cfg = getSoundDetective();
        if (cfg && cfg.sounds.length > 0) {
            const s = cfg.sounds[Math.floor(Math.random() * cfg.sounds.length)];
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
        if (GAME_2_SOUNDS.length === 0)
            return null;
        const s = GAME_2_SOUNDS[Math.floor(Math.random() * GAME_2_SOUNDS.length)];
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
    // Close the comfort-music banner the moment the child engages again
    // (sends a message). The banner has done its job; leaving it sitting as
    // "Paused" feels stale. The lifecycle effect on comfortMusic stops the
    // audio when the state goes to null.
    const pauseComfortMusic = useCallback(() => {
        setComfortMusic(null);
    }, []);
    // ── Play a one-shot sound effect (Game 2). Reuses audioRef so a new turn
    //    pre-empting it (stopAudio) cleanly cuts the playback.
    const playSoundEffect = useCallback(async (src) => {
        stopAudio();
        const audio = new Audio(src);
        audioRef.current = audio;
        const ended = new Promise((resolve) => {
            audio.addEventListener('ended', () => resolve(), { once: true });
            audio.addEventListener('error', () => resolve(), { once: true });
        });
        try {
            await audio.play();
        }
        catch {
            // Autoplay blocked or load error — resolve immediately so the flow continues.
            return;
        }
        await ended;
        if (audioRef.current === audio)
            audioRef.current = null;
    }, [stopAudio]);
    // ── callTts ──────────────────────────────────────────────────────────────
    const callTts = useCallback(async (text, msgId, options) => {
        if (mutedRef.current || !text.trim())
            return;
        stopAudio();
        setTtsLoading(true);
        try {
            const data = await fetchTtsVisemes(text, voiceStyleRef.current, defaultVoiceRef.current);
            // Store ssml on message for preview
            setTranscript((prev) => prev.map((t) => t.id === msgId ? { ...t, ssml: data.ssml } : t));
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
            const playbackEnded = new Promise((resolve) => {
                audio.addEventListener('ended', () => resolve(), { once: true });
                audio.addEventListener('error', () => resolve(), { once: true });
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
                    }
                    else {
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
                                if (!activityAudioRef.current || activityAudioRef.current !== bgAudio)
                                    return;
                                if (bgAudio.paused || bgAudio.ended)
                                    return;
                                const t = Math.min(1, (performance.now() - fadeStartAt) / FADE_MS);
                                bgAudio.volume = Math.max(0, startVol * (1 - t));
                                if (t < 1)
                                    requestAnimationFrame(fadeTick);
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
            if (options?.waitForEnd) {
                await playbackEnded;
            }
        }
        catch {
            // TTS errors are non-fatal; chat text already shown
        }
        finally {
            setTtsLoading(false);
        }
    }, [stopAudio]);
    // ── Session lifecycle ────────────────────────────────────────────────────
    const handleStartChatting = useCallback(() => {
        if (sessionActive || streaming || voiceMode || ttsLoading)
            return;
        // Refresh games + conversation-flow + safety config so panel edits made
        // since mount take effect for this session.
        void fetchConfig()
            .then((c) => {
            gamesConfigRef.current = c.games ?? null;
            convFlowRef.current = c.conversationFlow ?? null;
            safetyRef.current = c.safety ?? null;
        })
            .catch(() => { });
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
        // Reset break-suggestion state for the new session.
        userTurnCountRef.current = 0;
        breakDueRef.current = false;
        // Begin scripted intro (read from config; falls back to file constant)
        const firstQ = getFirstMeetingQuestion();
        const assistantMsg = {
            id: uid(),
            role: 'assistant',
            content: firstQ,
        };
        setSessionActive(true);
        setScriptedSessionStep('first-meeting');
        scriptedSessionStepRef.current = 'first-meeting';
        gamePoolRef.current = [];
        introducedGamesRef.current = new Set();
        currentGameRef.current = null;
        setTranscript([assistantMsg]);
        apiHistoryRef.current = [{ role: 'assistant', content: firstQ }];
        setStreaming(true);
        setFaceExpr('gentle');
        void callTts(firstQ, assistantMsg.id).finally(() => {
            setStreaming(false);
            setTimeout(() => setFaceExpr('calm'), 500);
        });
    }, [sessionActive, streaming, voiceMode, ttsLoading, callTts, cancelAutoAdvance]);
    const handleEndSession = useCallback(() => {
        cancelRef.current?.();
        cancelRef.current = null;
        cancelAutoAdvance();
        // Close the comfort-music banner entirely on End Session (don't leave it
        // sitting as "Paused" — operator wants a clean slate).
        setComfortMusic(null);
        endActivity();
        setSessionActive(false);
        setScriptedSessionStep('none');
        scriptedSessionStepRef.current = 'none';
        game2SoundRef.current = null;
        gamePoolRef.current = [];
        introducedGamesRef.current = new Set();
        currentGameRef.current = null;
        setStreaming(false);
        streamingContentRef.current = '';
        setFaceExpr('calm');
        userTurnCountRef.current = 0;
        breakDueRef.current = false;
    }, [cancelAutoAdvance, endActivity]);
    // ── Send message ─────────────────────────────────────────────────────────
    const sendMessage = useCallback(async (overrideText, opts = {}) => {
        const text = (overrideText ?? input).trim();
        if (!text)
            return;
        if (!sessionActive)
            return; // require an active session
        cancelAutoAdvance();
        // Always silence any playing comfort-music player before the new turn so
        // TTS doesn't talk over it; the widget stays in the transcript for replay.
        pauseComfortMusic();
        const visibleUserMsg = opts.silent
            ? null
            : { id: uid(), role: 'user', content: text };
        if (visibleUserMsg) {
            setTranscript((prev) => [...prev, visibleUserMsg]);
        }
        if (!opts.silent && !overrideText)
            setInput('');
        // ── Two-layer safety check ──────────────────────────────────────────
        // Runs on real user input only and short-circuits the rest of the
        // pipeline (scripted intro, activity quit-check, LLM call, turn counter)
        // whenever either layer trips.
        //
        // Layer 1 — Front-line AI risk classifier (/api/risk-assess). Returns
        //   { emotion, risk_level }. risk_level dispatches:
        //     high_risk  → block + caregiver banner + end session
        //     concerning → still call the LLM, but with `concerningMode: true`
        //                  so it strips activity tools and injects a one-turn
        //                  comfort + steer-to-trusted-adult system note.
        //     safe       → fall through normally; emotion drives face expression.
        //
        // Layer 2 — Local keyword distress filter (`safetyRef.distressKeywords`).
        //   Runs even when the AI layer says `safe`, as a deterministic safety
        //   net for the obvious crisis phrases the model might somehow miss.
        //
        // The block path (high_risk OR keyword hit) is shared so transcript +
        // cleanup behaviour is identical regardless of which layer fired.
        let concerningModeForThisTurn = false;
        let safetyBlocked = false;
        if (!opts.silent && !overrideText) {
            try {
                // Pass the robot's previous line as context so the classifier reads a
                // vague reply in situ — a bare "没有意思" answering "你今天过得怎么样" is
                // boredom (safe), not the existential "没有意思" (concerning) the model
                // assumes with no context. The robot's last line is the last assistant
                // entry in apiHistory (the child's current text isn't appended until the
                // per-step handlers below). Trailing slice keeps the closing question of
                // long daily-story intros and bounds the payload.
                const lastRobotLine = [...apiHistoryRef.current]
                    .reverse()
                    .find((m) => m.role === 'assistant')
                    ?.content.slice(-300);
                const r = await assessUserRisk(text, lastRobotLine);
                if (r.risk_level === 'high_risk') {
                    safetyBlocked = true;
                }
                else if (r.risk_level === 'concerning') {
                    concerningModeForThisTurn = true;
                }
                // Only drive the face from the emotion when we're not about to
                // block — a blocked turn forces 'anxious' below regardless.
                if (!safetyBlocked) {
                    const e = r.emotion;
                    const exprFromEmotion = e === 'happy' ? 'happy'
                        : e === 'excited' ? 'excited'
                            : e === 'calm' ? 'calm'
                                : e === 'curious' ? 'curious'
                                    : e === 'confused' ? 'confused'
                                        : e === 'sad' ? 'sad'
                                            : e === 'anxious' || e === 'scared' || e === 'angry' ? 'anxious'
                                                : null;
                    if (exprFromEmotion)
                        setFaceExpr(exprFromEmotion);
                }
            }
            catch {
                // Fail safe — classifier hiccup must NOT block the turn; the keyword
                // layer below still runs.
            }
            if (!safetyBlocked) {
                const keywords = safetyRef.current?.distressKeywords ?? [];
                const lowered = text.toLowerCase();
                // Bidirectional substring match. The forward case catches longer user
                // utterances ("我真的不想活了" ⊇ "不想活"). The reverse case catches
                // shortened forms ("不想活了" ⊂ "我不想活了"). The 2-char minimum on
                // the reverse side keeps single common characters from false-firing.
                const triggered = keywords.some((kw) => {
                    const k = kw.trim().toLowerCase();
                    if (k.length < 2)
                        return false;
                    if (lowered.includes(k))
                        return true;
                    if (lowered.length >= 2 && k.includes(lowered))
                        return true;
                    return false;
                });
                if (triggered)
                    safetyBlocked = true;
            }
        }
        if (safetyBlocked) {
            // high_risk OR keyword match: speak the fixed crisis-redirect message
            // (trusted-adult + hotline numbers), then end the session.
            cancelRef.current?.();
            cancelRef.current = null;
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            cancelAnimationFrame(visemeRafRef.current);
            setVisemePlaybackMs(-1);
            setVisemeStream([]);
            if (activeActivityRef.current)
                endActivity();
            const userMsg = visibleUserMsg ?? {
                id: uid(), role: 'user', content: text,
            };
            const responseMsg = {
                id: uid(),
                role: 'assistant',
                content: HIGH_RISK_RESPONSE,
            };
            setTranscript((prev) => visibleUserMsg ? [...prev, responseMsg] : [...prev, userMsg, responseMsg]);
            // Intentionally NOT appended to apiHistoryRef — the LLM never sees
            // the distress text and never sees this fixed reply, so a later
            // turn can't accidentally echo the phrase or the hotline numbers.
            // Skip distress UI flags (red highlight + caregiver banner) per
            // operator request — the session ends, which is signal enough.
            setStreaming(false);
            setFaceExpr('gentle');
            // waitForEnd:true is REQUIRED — without it callTts resolves on play()
            // start, the finally fires immediately, and handleEndSession →
            // endActivity → audioRef.pause() cuts the hotline message off mid-syllable.
            try {
                await callTts(HIGH_RISK_RESPONSE, responseMsg.id, { waitForEnd: true });
            }
            finally {
                setTimeout(() => setFaceExpr('calm'), 2000);
                handleEndSession();
            }
            return;
        }
        if (concerningModeForThisTurn) {
            // Concerning (distressed but not crisis): short-circuit BEFORE the
            // scripted dispatch / LLM call and speak a fixed comforting reply.
            // This is the top-priority override the operator asked for — without
            // it, scripted yes/no classifiers would swallow phrases like
            // "我好难受啊" as ambiguous answers to the intro question.
            // Session stays active so the child can keep talking.
            cancelRef.current?.();
            cancelRef.current = null;
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            cancelAnimationFrame(visemeRafRef.current);
            setVisemePlaybackMs(-1);
            setVisemeStream([]);
            if (activeActivityRef.current)
                endActivity();
            const userMsg = visibleUserMsg ?? {
                id: uid(), role: 'user', content: text,
            };
            const responseMsg = {
                id: uid(),
                role: 'assistant',
                content: CONCERNING_RESPONSE,
            };
            setTranscript((prev) => visibleUserMsg ? [...prev, responseMsg] : [...prev, userMsg, responseMsg]);
            // Match the high_risk pattern: don't pollute apiHistory with the
            // distress turn. The next user reply will be handled by the
            // 'concerning-music-offer' step below (yes → play music, else → reset).
            setStreaming(false);
            setFaceExpr('gentle');
            // Move into the music-offer step BEFORE TTS resolves, so a fast typer
            // who answers mid-playback is already routed correctly.
            setScriptedSessionStep('concerning-music-offer');
            scriptedSessionStepRef.current = 'concerning-music-offer';
            try {
                await callTts(CONCERNING_RESPONSE, responseMsg.id);
            }
            finally {
                setTimeout(() => setFaceExpr('calm'), 2000);
            }
            return;
        }
        // Kick off goodbye-intent classification in parallel; consume later.
        // BUT only when we're past the scripted intro — during the intro the
        // child is answering specific yes/no/age/weather questions and short
        // affirmatives ("是", "嗯", "对") were getting misclassified as
        // goodbyes, ending the session right after the welcome was spoken.
        const goodbyePromise = scriptedSessionStepRef.current === 'none'
            ? isGoodbyeIntent(text)
            : Promise.resolve(false);
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
            }
            catch {
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
        const dispatchScriptedOrBypass = async (msgToRemoveOnBypass, scriptedReply) => {
            const isBypass = await isActivityIntent(text);
            if (isBypass) {
                setTranscript((prev) => prev.filter((t) => t.id !== msgToRemoveOnBypass.userMsgId
                    && t.id !== msgToRemoveOnBypass.placeholderId));
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
        // ── Step 'concerning-music-offer' → child answers yes/no to "want to
        // listen to soft music?" Yes → pick a random comfort track, speak the
        // intro line, play it; No / unclear → speak the decline line; either
        // way reset to 'none' so the next turn flows normally. We deliberately
        // skip dispatchScriptedOrBypass: the child just heard a distress
        // response, "activity intent" doesn't apply here.
        if (effectiveStep === 'concerning-music-offer') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            setStreaming(true);
            setFaceExpr('thinking');
            void (async () => {
                let yesno = 'unclear';
                try {
                    const raw = await classifyIntent(text, 'yesno');
                    if (raw === 'yes' || raw === 'no' || raw === 'unclear')
                        yesno = raw;
                }
                catch { /* default unclear */ }
                const accepted = yesno === 'yes';
                const reply = accepted ? COMFORT_MUSIC_ACCEPTED : COMFORT_MUSIC_DECLINED;
                const replyMsg = { id: uid(), role: 'assistant', content: reply };
                setTranscript((prev) => [...prev, replyMsg]);
                setScriptedSessionStep('none');
                scriptedSessionStepRef.current = 'none';
                setFaceExpr('gentle');
                // waitForEnd:true so the comfort music starts AFTER the intro line
                // ("好,我放一段给你听...") finishes, not on top of it.
                try {
                    await callTts(reply, replyMsg.id, { waitForEnd: true });
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 1000);
                }
                if (accepted) {
                    const files = (safetyRef.current?.comfortMusicFiles ?? []).filter((f) => f.trim());
                    if (files.length > 0) {
                        const pick = files[comfortMusicCursor % files.length];
                        comfortMusicCursor = (comfortMusicCursor + 1) % files.length;
                        // eslint-disable-next-line no-console
                        console.log('[comfort-music] playing', pick);
                        // Drive the top banner. The lifecycle effect on comfortMusic
                        // creates the <audio> element and starts playback.
                        setComfortMusic({ filename: pick, paused: false });
                    }
                    else {
                        // eslint-disable-next-line no-console
                        console.warn('[comfort-music] no files configured in safety.comfortMusicFiles');
                    }
                }
            })();
            return;
        }
        if (effectiveStep === 'first-meeting') {
            // Show the user message immediately; show a streaming placeholder while
            // we classify yes/no via the model. The classifier is one chat call,
            // fast, but not instantaneous.
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            const placeholderId = uid();
            const placeholder = { id: placeholderId, role: 'assistant', content: '', streaming: true };
            setTranscript((prev) => visibleUserMsg ? [...prev, placeholder] : [...prev, userMsg, placeholder]);
            setStreaming(true);
            setFaceExpr('thinking');
            // Append the user msg to api history NOW; bypass helper will roll it back.
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            void (async () => {
                await dispatchScriptedOrBypass({ userMsgId: userMsg.id, placeholderId }, async () => {
                    let label = 'unclear';
                    try {
                        const raw = await classifyIntent(text, 'yesno');
                        if (raw === 'yes' || raw === 'no' || raw === 'unclear')
                            label = raw;
                    }
                    catch {
                        label = 'unclear';
                    }
                    let fixedReply;
                    let nextStep;
                    if (label === 'no') {
                        // Old-friend flow: ack only, then age question. The daily story
                        // is held off until the child answers their age in the
                        // 'returning-age' step below.
                        fixedReply = `${OLD_FRIEND_RECOGNITION}\n\n${getAgePrompt()}`;
                        nextStep = 'returning-age';
                    }
                    else if (label === 'yes') {
                        fixedReply = getStartChattingIntro();
                        nextStep = 'age';
                    }
                    else {
                        // Truly ambiguous — re-ask but acknowledge the child's reply naturally.
                        fixedReply = '嗯,我没太听明白。你之前有见过我吗?还是这是我们第一次见面?';
                        nextStep = 'first-meeting';
                    }
                    // Swap placeholder for the resolved reply
                    setTranscript((prev) => prev.map((t) => t.id === placeholderId ? { ...t, content: fixedReply, streaming: false } : t));
                    apiHistoryRef.current = [
                        ...apiHistoryRef.current,
                        { role: 'assistant', content: fixedReply },
                    ];
                    setScriptedSessionStep(nextStep);
                    scriptedSessionStepRef.current = nextStep;
                    setFaceExpr('gentle');
                    try {
                        await callTts(fixedReply, placeholderId);
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise)
                            handleEndSession();
                    }
                });
            })();
            return;
        }
        // ── Step 'age' / 'age-short' → deliver weather prompt, advance to next phase ──
        if (effectiveStep === 'age' || effectiveStep === 'age-short') {
            const isShort = effectiveStep === 'age-short';
            const nextStep = isShort ? 'weather-game-choice' : 'none';
            // Persist the kid's age as the source-of-truth for all subsequent
            // LLM + Voice Live + system-prompt calls this session. First digit run
            // in [1, 120] wins; if the kid types nothing parseable we keep the
            // existing default and the model still gets a usable age bucket.
            let effectiveAge = childAgeRef.current;
            const parsed = parseAgeFromText(text);
            if (parsed !== null && parsed >= 1 && parsed <= 120) {
                setChildAge(parsed);
                childAgeRef.current = parsed;
                effectiveAge = parsed;
            }
            const weatherPrompt = isShort
                ? getShortWeatherPrompt()
                : weatherPromptForAge(getWeatherPrompt(), effectiveAge);
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
                const replyMsg = { id: uid(), role: 'assistant', content: weatherPrompt };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: weatherPrompt }];
                setScriptedSessionStep(nextStep);
                scriptedSessionStepRef.current = nextStep;
                setFaceExpr('gentle');
                try {
                    await callTts(weatherPrompt, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            });
            return;
        }
        // ── Step 'returning-age' → ack age + daily story ───────────────────────
        // Returning visitor just answered their age. Parse the digits the same way
        // the new-friend 'age' step does so the LLM gets a fresh childAge for the
        // remainder of the session, then transition by echoing the story-preamble
        // line ("好,那我给你分享一下我今天的故事。") and dropping a daily story
        // underneath. The next step mirrors the original returning flow:
        // 'returning-intro-answer'.
        if (effectiveStep === 'returning-age') {
            const parsed = parseAgeFromText(text);
            if (parsed !== null && parsed >= 1 && parsed <= 120) {
                setChildAge(parsed);
                childAgeRef.current = parsed;
            }
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
                const story = pickReturningIntroFromConfig();
                const fixedReply = `${OLD_FRIEND_AGE_TO_STORY}\n\n${story}`;
                const replyMsg = { id: uid(), role: 'assistant', content: fixedReply };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
                setScriptedSessionStep('returning-intro-answer');
                scriptedSessionStepRef.current = 'returning-intro-answer';
                setFaceExpr('gentle');
                try {
                    await callTts(fixedReply, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            });
            return;
        }
        // ── Step 'returning-intro-answer' → mood reply + warmup game ────────
        // Returning visitor just replied to the daily story. Mood-mirror that, then
        // launch ONE warmup game (50/50 between rhythm-story and sound-detective —
        // matching the two configured games in default.json). The warmup's
        // completion handler (game-1-completion / game-2-answer) appends the
        // WEATHER PROMPT and transitions to weather-game-choice afterward.
        if (effectiveStep === 'returning-intro-answer') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
                const moodReply = (await moodIntroAnswerResponse(text, '')).trim();
                const useSoundDetective = Math.random() < 0.5;
                // ── Branch: sound detective ────────────────────────────────────────
                if (useSoundDetective) {
                    const selectedSound = await pickGame2SoundFromConfig();
                    if (!selectedSound) {
                        // No sounds configured — skip the warmup and go straight to
                        // weather so the flow still terminates correctly.
                        const fallback = `${moodReply}\n\n${weatherPromptForAge(getWeatherPrompt(), childAgeRef.current)}`;
                        const replyMsg = { id: uid(), role: 'assistant', content: fallback };
                        setTranscript((prev) => [...prev, replyMsg]);
                        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fallback }];
                        setScriptedSessionStep('weather-game-choice');
                        scriptedSessionStepRef.current = 'weather-game-choice';
                        setFaceExpr('gentle');
                        try {
                            await callTts(fallback, replyMsg.id);
                        }
                        finally {
                            setStreaming(false);
                            setTimeout(() => setFaceExpr('calm'), 500);
                            if (await goodbyePromise)
                                handleEndSession();
                        }
                        return;
                    }
                    game2SoundRef.current = selectedSound;
                    const introBlock = `${moodReply}\n\n${getGame2Intro()}`;
                    const introMsg = { id: uid(), role: 'assistant', content: introBlock };
                    setTranscript((prev) => [...prev, introMsg]);
                    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: introBlock }];
                    setScriptedSessionStep('game-2-answer');
                    scriptedSessionStepRef.current = 'game-2-answer';
                    setFaceExpr('gentle');
                    try {
                        await callTts(introBlock, introMsg.id, { waitForEnd: true });
                        if (selectedSound.src)
                            await playSoundEffect(selectedSound.src);
                        const questionMsg = {
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
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise)
                            handleEndSession();
                    }
                    return;
                }
                // ── Branch: rhythm story ───────────────────────────────────────────
                const story = pickGame1StoryFromConfig();
                const fixedReply = `${moodReply}\n\n${getGame1Prefix()}\n\n${story}`;
                const replyMsg = { id: uid(), role: 'assistant', content: fixedReply };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
                setScriptedSessionStep('game-1-completion');
                scriptedSessionStepRef.current = 'game-1-completion';
                setFaceExpr('gentle');
                try {
                    await callTts(fixedReply, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            });
            return;
        }
        // ── Step 'weather-game-choice' → classify weather → recommend games ───
        // The child just named a weather (sunny / cloudy / rainy / snowy / thunder).
        // Classify it, then emit the matching recommendation line and seed the
        // game pool. Sunny gets a 2-game pool (rhythm + co-creation); the other
        // four ("quiet" weather) get a 3-game pool (breathing + emotion-mapping +
        // co-creation). The pool is consumed by the 'game-decide' state below
        // when the child says "look at others" until it's empty, at which point
        // we hand back to the model via 'game-pool-exhausted'.
        if (effectiveStep === 'weather-game-choice') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
                let raw = 'unclear';
                try {
                    raw = await classifyIntent(text, 'weather-mood');
                }
                catch {
                    raw = 'unclear';
                }
                let bucket = 'unclear';
                let mirror = '';
                switch (raw) {
                    case 'sunny':
                        bucket = 'sunny';
                        mirror = '晴天';
                        break;
                    case 'cloudy':
                        bucket = 'quiet';
                        mirror = '阴天';
                        break;
                    case 'rainy':
                        bucket = 'quiet';
                        mirror = '下雨天';
                        break;
                    case 'snowy':
                        bucket = 'quiet';
                        mirror = '下雪天';
                        break;
                    case 'thunder':
                        bucket = 'quiet';
                        mirror = '雷雨天';
                        break;
                    default: bucket = 'unclear';
                }
                // Unclear → re-ask without advancing state.
                if (bucket === 'unclear') {
                    const replyMsg = { id: uid(), role: 'assistant', content: RE_ASK_WEATHER };
                    setTranscript((prev) => [...prev, replyMsg]);
                    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: RE_ASK_WEATHER }];
                    setFaceExpr('gentle');
                    try {
                        await callTts(RE_ASK_WEATHER, replyMsg.id);
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise)
                            handleEndSession();
                    }
                    return;
                }
                // Seed the pool fresh — defensive in case a prior session leaked.
                gamePoolRef.current = bucket === 'sunny'
                    ? [...SUNNY_POOL]
                    : [...QUIET_POOL];
                introducedGamesRef.current = new Set();
                currentGameRef.current = null;
                const recommendation = bucket === 'sunny'
                    ? SUNNY_RECOMMENDATION
                    : quietRecommendationLocal(mirror);
                const replyMsg = { id: uid(), role: 'assistant', content: recommendation };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: recommendation }];
                setScriptedSessionStep('game-pick');
                scriptedSessionStepRef.current = 'game-pick';
                setFaceExpr('gentle');
                try {
                    await callTts(recommendation, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            });
            return;
        }
        // ── Step 'game-pick' → child names a game → emit card + decide prompt ─
        // The child has just heard the recommendation and is naming one of the
        // games. Classify which one, drop it from the remaining pool, mark it
        // introduced, then speak the card + GAME_DECIDE_PROMPT in one bubble.
        //
        // We deliberately skip dispatchScriptedOrBypass here. The activity-intent
        // classifier flags bare game names ("身体律动", "body exercise") as YES,
        // which would bypass to the model and trigger start_activity — skipping
        // the card the child explicitly asked to hear. At this step the user IS
        // answering the scripted question, so the scripted reply always runs.
        if (effectiveStep === 'game-pick') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void (async () => {
                let game = 'unclear';
                try {
                    const raw = await classifyIntent(text, 'game-name');
                    if (raw === 'rhythm' || raw === 'co-creation' || raw === 'breathing' || raw === 'emotion-mapping') {
                        game = raw;
                    }
                }
                catch {
                    game = 'unclear';
                }
                if (game === 'unclear') {
                    // Distinguish two flavours of "unclear":
                    //   • child said a vague yes ("好呀" / "都可以") without naming a game
                    //     → ask them to pick one of the four
                    //   • child said something we couldn't match to any game name
                    //     → list the games again with the "name didn't match" wording
                    // Reason: the child is much more cooperative with the right framing.
                    let vague = false;
                    try {
                        const raw = await classifyIntent(text, 'yesno');
                        vague = raw === 'yes';
                    }
                    catch { /* default to unmatched wording */ }
                    const reAsk = vague ? RE_ASK_GAME_NAME_VAGUE : RE_ASK_GAME_NAME_UNMATCHED;
                    const replyMsg = { id: uid(), role: 'assistant', content: reAsk };
                    setTranscript((prev) => [...prev, replyMsg]);
                    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: reAsk }];
                    setFaceExpr('gentle');
                    try {
                        await callTts(reAsk, replyMsg.id);
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise)
                            handleEndSession();
                    }
                    return;
                }
                // Take the picked game out of the remaining pool (so "look at others"
                // never re-offers it) and remember we've shown its card.
                gamePoolRef.current = gamePoolRef.current.filter((g) => g !== game);
                introducedGamesRef.current.add(game);
                currentGameRef.current = game;
                const card = RECOMMENDED_GAMES[game].card;
                const reply = `${card}\n\n${GAME_DECIDE_PROMPT}`;
                const replyMsg = { id: uid(), role: 'assistant', content: reply };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: reply }];
                setScriptedSessionStep('game-decide');
                scriptedSessionStepRef.current = 'game-decide';
                setFaceExpr('gentle');
                try {
                    await callTts(reply, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            })();
            return;
        }
        // ── Step 'game-decide' → "try it" → start_activity; "look at others" → loop ─
        // After hearing the card, the child either wants to start the game (yes)
        // or wants to hear about a different one (no). Yes: speak the start line,
        // then SILENTLY tell the model "开始<game>吧" so it calls start_activity.
        // No: if the recommended pool still has games, classify whether the child
        // named a specific one (handle that as a direct game-pick) or just said
        // "看其他" — pick the next pool game and emit its card. If the pool is
        // empty, transition to 'game-pool-exhausted'.
        //
        // Bypass intentionally skipped here for the same reason as 'game-pick':
        // bare game names ("呼吸") would otherwise be flagged as direct intent and
        // skip past the "想试 / 看其他" prompt.
        if (effectiveStep === 'game-decide') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void (async () => {
                // Run yes/no and game-name in parallel. yes/no wins to defend against
                // the game-name classifier falsely tagging affirmations like
                // "我想尝试一下" as a different game and skipping past the start line.
                // Only re-route to a different game if the child clearly named one
                // AND the yes/no signal isn't a plain "yes".
                const [yesnoRaw, gameRaw] = await Promise.all([
                    classifyIntent(text, 'yesno').catch(() => 'unclear'),
                    classifyIntent(text, 'game-name').catch(() => 'unclear'),
                ]);
                const yesno = yesnoRaw === 'yes' || yesnoRaw === 'no' || yesnoRaw === 'unclear' ? yesnoRaw : 'unclear';
                const namedGame = gameRaw === 'rhythm' || gameRaw === 'co-creation' || gameRaw === 'breathing' || gameRaw === 'emotion-mapping'
                    ? gameRaw
                    : 'unclear';
                if (yesno !== 'yes' &&
                    namedGame !== 'unclear' &&
                    namedGame !== currentGameRef.current) {
                    // Re-route as if we were in 'game-pick' for the newly named game.
                    gamePoolRef.current = gamePoolRef.current.filter((g) => g !== namedGame);
                    introducedGamesRef.current.add(namedGame);
                    currentGameRef.current = namedGame;
                    const card = RECOMMENDED_GAMES[namedGame].card;
                    const reply = `${card}\n\n${GAME_DECIDE_PROMPT}`;
                    const replyMsg = { id: uid(), role: 'assistant', content: reply };
                    setTranscript((prev) => [...prev, replyMsg]);
                    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: reply }];
                    // Stay in game-decide for the newly introduced game.
                    setFaceExpr('gentle');
                    try {
                        await callTts(reply, replyMsg.id);
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise)
                            handleEndSession();
                    }
                    return;
                }
                if (yesno === 'yes') {
                    // Start the picked game. Speak the start line, then silently nudge
                    // the model with "开始<游戏中文名>吧" so it calls start_activity.
                    const game = currentGameRef.current;
                    const replyMsg = { id: uid(), role: 'assistant', content: GAME_START_LINE };
                    setTranscript((prev) => [...prev, replyMsg]);
                    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: GAME_START_LINE }];
                    setScriptedSessionStep('none');
                    scriptedSessionStepRef.current = 'none';
                    setFaceExpr('excited');
                    try {
                        await callTts(GAME_START_LINE, replyMsg.id);
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise) {
                            handleEndSession();
                            return;
                        }
                    }
                    if (game) {
                        sendMessageRef.current?.(`开始${RECOMMENDED_GAMES[game].displayName}吧`, { silent: true });
                    }
                    return;
                }
                // "No" or unclear → look at others. If the pool still has games,
                // pop one and present it. Otherwise fall through to exhausted.
                if (gamePoolRef.current.length === 0) {
                    const replyMsg = { id: uid(), role: 'assistant', content: GAME_POOL_EXHAUSTED_PROMPT };
                    setTranscript((prev) => [...prev, replyMsg]);
                    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: GAME_POOL_EXHAUSTED_PROMPT }];
                    setScriptedSessionStep('game-pool-exhausted');
                    scriptedSessionStepRef.current = 'game-pool-exhausted';
                    setFaceExpr('gentle');
                    try {
                        await callTts(GAME_POOL_EXHAUSTED_PROMPT, replyMsg.id);
                    }
                    finally {
                        setStreaming(false);
                        setTimeout(() => setFaceExpr('calm'), 500);
                        if (await goodbyePromise)
                            handleEndSession();
                    }
                    return;
                }
                const next = gamePoolRef.current.shift();
                introducedGamesRef.current.add(next);
                currentGameRef.current = next;
                const card = RECOMMENDED_GAMES[next].card;
                const reply = `${card}\n\n${GAME_DECIDE_PROMPT}`;
                const replyMsg = { id: uid(), role: 'assistant', content: reply };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: reply }];
                // Stay in game-decide for the new card.
                setFaceExpr('gentle');
                try {
                    await callTts(reply, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            })();
            return;
        }
        // ── Step 'game-pool-exhausted' → child's free-form reply → hand to model ─
        // We just asked "那你想做什么呢?". Whatever the child says, drop the
        // scripted scaffolding and let the model handle it — the system prompt
        // already tells it to call start_activity on direct intent.
        if (effectiveStep === 'game-pool-exhausted') {
            if (visibleUserMsg) {
                setTranscript((prev) => prev.filter((t) => t.id !== visibleUserMsg.id));
            }
            setScriptedSessionStep('none');
            scriptedSessionStepRef.current = 'none';
            sendMessageRef.current?.(text);
            return;
        }
        // ── Step 'game-2-answer' → AI compares guess vs sound label ───────────
        if (effectiveStep === 'game-2-answer') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
                const selectedSound = game2SoundRef.current;
                let baseReply;
                if (!selectedSound) {
                    baseReply = '我刚才的声音好像跑丢了。没关系，我们等下再玩一次声音侦探吧。';
                }
                else {
                    const correct = await isSoundAnswerCorrect(text, selectedSound.label);
                    baseReply = correct ? selectedSound.correctResponse : selectedSound.wrongResponse;
                }
                // Warmup done → weather prompt rides in the same bubble, then the
                // weather-game-choice state handles the recommendation.
                const fixedReply = `${baseReply}\n\n${weatherPromptForAge(getWeatherPrompt(), childAgeRef.current)}`;
                const replyMsg = { id: uid(), role: 'assistant', content: fixedReply };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
                game2SoundRef.current = null;
                setScriptedSessionStep('weather-game-choice');
                scriptedSessionStepRef.current = 'weather-game-choice';
                setFaceExpr('gentle');
                try {
                    await callTts(fixedReply, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            });
            return;
        }
        // ── Step 'game-1-completion' → closing line + weather prompt ──────────
        if (effectiveStep === 'game-1-completion') {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            if (!visibleUserMsg)
                setTranscript((prev) => [...prev, userMsg]);
            apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
            setStreaming(true);
            setFaceExpr('thinking');
            void dispatchScriptedOrBypass({ userMsgId: userMsg.id }, async () => {
                // Only fire the random completion response if the AI thinks the
                // child actually said they're done. Otherwise hand off to the LLM
                // so it can respond conversationally to whatever they actually said
                // ("我不会", "再来一次", "this is hard", etc.) — the weather step is
                // lost in that case, but the scripted flow has already broken anyway.
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
                // Warmup done → weather prompt rides in the same bubble, then the
                // weather-game-choice state handles the recommendation.
                const fixedReply = `${pickGame1CompletionFromConfig()}\n\n${weatherPromptForAge(getWeatherPrompt(), childAgeRef.current)}`;
                const replyMsg = { id: uid(), role: 'assistant', content: fixedReply };
                setTranscript((prev) => [...prev, replyMsg]);
                apiHistoryRef.current = [...apiHistoryRef.current, { role: 'assistant', content: fixedReply }];
                setScriptedSessionStep('weather-game-choice');
                scriptedSessionStepRef.current = 'weather-game-choice';
                setFaceExpr('gentle');
                try {
                    await callTts(fixedReply, replyMsg.id);
                }
                finally {
                    setStreaming(false);
                    setTimeout(() => setFaceExpr('calm'), 500);
                    if (await goodbyePromise)
                        handleEndSession();
                }
            });
            return;
        }
        // ── Goodbye → end session AFTER the model responds, not before ──────────
        // (handled by recording shouldEndAfterReply and acting on it in onDone)
        // ── Free-form turn counter (for break-suggestion behaviour) ─────────────
        // Snapshot BEFORE we possibly end the activity below — a user's "stop"
        // message during an activity should not count as a new free-form turn.
        // Activities and scripted intro are excluded; the activity itself was
        // counted when the user's trigger message came in.
        if (!opts.silent
            && !overrideText
            && scriptedSessionStepRef.current === 'none'
            && !activeActivityRef.current) {
            userTurnCountRef.current += 1;
            if (!breakDueRef.current
                && userTurnCountRef.current >= getMaxTurnsBeforeBreak()) {
                breakDueRef.current = true;
                userTurnCountRef.current = 0;
            }
        }
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
        setTranscript((prev) => prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
        const assistantMsg = { id: uid(), role: 'assistant', content: '', streaming: true };
        // Silent (auto-advance) turn → only the assistant placeholder is visible.
        // The synthetic "继续" user message goes to the API but not the transcript.
        if (opts.silent) {
            setTranscript((prev) => [...prev, assistantMsg]);
        }
        else {
            const userMsg = visibleUserMsg ?? { id: uid(), role: 'user', content: text };
            setTranscript((prev) => visibleUserMsg ? [...prev, assistantMsg] : [...prev, userMsg, assistantMsg]);
        }
        setStreaming(true);
        setFaceExpr('listening');
        // Reset streaming content accumulator
        streamingContentRef.current = '';
        // Append to api history (includes silent turns); send that to the server.
        apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];
        const history = apiHistoryRef.current;
        // Use refs for fresh activity state (endActivity above may not have re-rendered yet).
        const aaRef = activeActivityRef.current;
        const siRef = sectionIndexRef.current;
        // Co-creation variant inference from history (belt + suspenders).
        // The ref-based variant tracking has a React state-batching race that
        // sometimes leaves the ref at 'none' even after multiple play_melody calls.
        // The assistant's recent messages contain the canonical Stage 3/4/5
        // speakText markers we emit from the server — scan them as a fallback and
        // pick the more-advanced variant.
        const inferCoCreationStage = (msgs) => {
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.role !== 'assistant')
                    continue;
                const c = m.content;
                if (c.includes('音乐探险家') || c.includes('1️⃣ 换一个音符') || c.includes('1️⃣ 换一个'))
                    return 'background';
                if (c.includes('音乐魔法') || c.includes('🦋 魔法一') || c.includes('魔法一：换一个音符'))
                    return 'revised';
                if (c.includes('选得真好') && c.includes('听听你的音乐'))
                    return 'original';
            }
            return 'none';
        };
        const activityContext = (() => {
            if (!aaRef && !therapyMode)
                return undefined;
            const isCoCreation = aaRef?.id === 'co-creation';
            let resolvedVariant = coCreationLastVariantRef.current;
            if (isCoCreation) {
                const inferred = inferCoCreationStage(history);
                const order = { none: 0, original: 1, revised: 2, background: 3 };
                if (order[inferred] > order[resolvedVariant])
                    resolvedVariant = inferred;
            }
            return {
                ...(aaRef ? {
                    activityId: aaRef.id,
                    activityName: aaRef.name,
                    type: aaRef.type,
                    sectionIndex: siRef,
                } : {}),
                ...(isCoCreation ? {
                    coCreationLastVariant: resolvedVariant,
                    ...(coCreationNotesRef.current ? { coCreationNotes: coCreationNotesRef.current } : {}),
                } : {}),
                ...(therapyMode ? { therapyMode: true } : {}),
            };
        })();
        const cancel = startChatStream({
            childAge: childAgeRef.current,
            messages: history,
            ...(activityContext ? { activityContext } : {}),
        }, {
            onText(delta) {
                streamingContentRef.current += delta;
                setTranscript((prev) => prev.map((t) => t.id === assistantMsg.id
                    ? { ...t, content: t.content + delta }
                    : t));
            },
            onExpression(timeline) {
                const best = timeline.reduce((a, b) => (b.confidence > a.confidence ? b : a), timeline[0]);
                setFaceExpr(best.expressionId);
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
                    }
                    else {
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
                }
                else if (ev.result.ok && ev.name === 'play_melody' && ev.result.filename) {
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
                }
                else if (ev.result.ok && ev.name === 'end_activity') {
                    // Model called end_activity → tear down like the × button.
                    endActivity();
                }
            },
            onDone() {
                setTranscript((prev) => prev.map((t) => t.id === assistantMsg.id ? { ...t, streaming: false } : t));
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
                // The previous build also re-classified the assistant's reply with
                // an 'assistant-distress' schema and ended the session if positive.
                // That layer is removed — the front-line AI risk classifier (run on
                // the user's input at the top of sendMessage) catches the same
                // crises earlier, without adding a second model round-trip after
                // every assistant turn.
                void callTts(finalContent, assistantMsg.id).then(() => {
                    // If TTS won't actually play (muted or empty content), there's no
                    // audio.ended event to wait for — release the queued melody now.
                    if (pendingMelodyRef.current && !audioRef.current) {
                        flushPendingMelody();
                    }
                }).finally(() => {
                    void goodbyePromise.then((end) => { if (end)
                        handleEndSession(); });
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
                    if (aa.id === 'emotion-music-mapping') {
                        setAutoAdvancePending(true);
                        if (nextIdx < aa.totalSections) {
                            // More emotions to go — play this one for 20s, then "继续".
                            startEmotionMappingTimer(20000, 3000);
                        }
                        else {
                            // The LAST emotion is now playing. Give it the same 20s window,
                            // then close the activity DETERMINISTICALLY. Previously an
                            // out-of-range "继续" fired here, making the model freestyle a
                            // wrap-up question, after which the activity auto-ended — so the
                            // child's answer hit a fresh start_activity and replayed the
                            // whole thing. Instead: end the activity (nothing can restart
                            // it), seed the remaining games, speak a fixed closing question,
                            // and route the answer through the scripted game-pick machine,
                            // which never re-opens 音乐心情猜猜猜.
                            startEmotionMappingTimer(20000, 3000, () => {
                                cancelAutoAdvance();
                                setActiveActivity(null);
                                activeActivityRef.current = null;
                                setActivitySectionIndex(0);
                                sectionIndexRef.current = 0;
                                setActivityPlaylist(null);
                                activityAudioRef.current?.pause();
                                gamePoolRef.current = ['rhythm', 'breathing', 'co-creation'];
                                introducedGamesRef.current = new Set(['emotion-mapping']);
                                currentGameRef.current = null;
                                const closeId = uid();
                                const closeMsg = {
                                    id: closeId, role: 'assistant', content: EMOTION_MAPPING_CLOSING,
                                };
                                setTranscript((prev) => [...prev, closeMsg]);
                                apiHistoryRef.current = [
                                    ...apiHistoryRef.current,
                                    { role: 'assistant', content: EMOTION_MAPPING_CLOSING },
                                ];
                                setScriptedSessionStep('game-pick');
                                scriptedSessionStepRef.current = 'game-pick';
                                setFaceExpr('gentle');
                                void callTts(EMOTION_MAPPING_CLOSING, closeId).finally(() => {
                                    setTimeout(() => setFaceExpr('calm'), 500);
                                });
                            });
                        }
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
                    }
                    else {
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
                // ── Break suggestion injection ─────────────────────────────────
                // If the turn count crossed the threshold during this user turn AND
                // the model didn't already start an activity in response, append a
                // gentle break suggestion as a separate assistant bubble after the
                // current TTS lands. The child can continue or take the break —
                // either way the conversation resumes normally on the next turn.
                if (breakDueRef.current) {
                    if (activeActivityRef.current || scriptedSessionStepRef.current !== 'none') {
                        // The model already gave the child a structured rest (activity
                        // / scripted intro). Treat that as the break and silently clear.
                        breakDueRef.current = false;
                    }
                    else {
                        breakDueRef.current = false;
                        const phrase = pickBreakSuggestion();
                        // Defer until after the just-finished assistant TTS lands so the
                        // two bubbles don't speak over each other.
                        window.setTimeout(() => {
                            // Bail if the user already started a new turn or an activity
                            // started in the meantime.
                            if (activeActivityRef.current)
                                return;
                            if (scriptedSessionStepRef.current !== 'none')
                                return;
                            const breakId = uid();
                            const breakMsg = {
                                id: breakId, role: 'assistant', content: phrase,
                            };
                            setTranscript((prev) => [...prev, breakMsg]);
                            apiHistoryRef.current = [
                                ...apiHistoryRef.current,
                                { role: 'assistant', content: phrase },
                            ];
                            setFaceExpr('gentle');
                            void callTts(phrase, breakId).finally(() => {
                                setTimeout(() => setFaceExpr('calm'), 500);
                            });
                        }, 1500);
                    }
                }
            },
            onError(message) {
                // Azure content-filter 400s mean the cloud caught content my local
                // keyword list missed. Treat it as equivalent to a distress hit:
                // mark the bubble, raise the banner, and don't speak.
                const lower = message.toLowerCase();
                const isContentFilter = lower.includes('content management policy')
                    || lower.includes('content_filter')
                    || lower.includes('responsibleaipolicyviolation')
                    || (lower.includes('400') && lower.includes('filtered'));
                setTranscript((prev) => prev.map((t) => t.id === assistantMsg.id
                    ? {
                        ...t,
                        content: `(Error: ${message})`,
                        streaming: false,
                        ...(isContentFilter ? { distressResponse: true } : {}),
                    }
                    : t));
                // Also flag the user's last message in the visible transcript so the
                // operator can see which input the cloud filter caught.
                if (isContentFilter) {
                    setTranscript((prev) => {
                        // Walk back from end to find the most recent user message.
                        for (let i = prev.length - 1; i >= 0; i--) {
                            if (prev[i].role === 'user') {
                                return prev.map((m, idx) => idx === i ? { ...m, distressTrigger: true } : m);
                            }
                        }
                        return prev;
                    });
                    setFaceExpr('anxious');
                    setTimeout(() => setFaceExpr('calm'), 1500);
                    // End the session on safety filter — operator must restart.
                    handleEndSession();
                }
                else {
                    setFaceExpr('confused');
                }
                setStreaming(false);
            },
        });
        cancelRef.current = cancel;
    }, [input, sessionActive, streaming, transcript, therapyMode, activeActivity, activitySectionIndex, callTts, cancelAutoAdvance, endActivity, handleEndSession, pauseComfortMusic]);
    // Keep ref up-to-date so audio.ended can invoke the latest sendMessage
    sendMessageRef.current = sendMessage;
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);
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
        }
        else {
            // Turn on: create client, connect (mic permission deferred until PTT press)
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
                    setTranscript((prev) => prev.map((t) => t.id === liveAssistantMsgIdRef.current
                        ? { ...t, content: t.content + delta }
                        : t));
                },
                onUserTranscript: (text, isFinal) => {
                    if (isFinal) {
                        setLiveUserTranscript('');
                        setTranscript((prev) => {
                            const existing = prev.find((t) => t.id === 'voice-user-pending');
                            if (existing) {
                                return prev.map((t) => t.id === 'voice-user-pending'
                                    ? { ...t, id: uid(), content: text }
                                    : t);
                            }
                            return [...prev, { id: uid(), role: 'user', content: text, voiceMode: true }];
                        });
                    }
                    else {
                        setLiveUserTranscript(text);
                    }
                },
                onExpressionEvents: (events) => {
                    if (events.length === 0)
                        return;
                    const best = events.reduce((a, b) => (b.confidence > a.confidence ? b : a), events[0]);
                    setFaceExpr(best.expressionId);
                },
                onTurnEnd: () => {
                    // Finalize assistant message
                    setTranscript((prev) => prev.map((t) => t.id === liveAssistantMsgIdRef.current ? { ...t, streaming: false } : t));
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
                        { id, role: 'assistant', content: '', streaming: true, voiceMode: true },
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
            client.connect(childAgeRef.current);
        }
    }, [voiceMode, stopAudio]);
    // ── Voice Live: PTT handlers ──────────────────────────────────────────────
    const handlePttStart = useCallback(async () => {
        if (!voiceReady || recording)
            return;
        setRecording(true);
        setFaceExpr('listening');
        try {
            await voiceClientRef.current?.startRecording();
        }
        catch (e) {
            setVoiceError(`Mic error: ${e.message}`);
            setRecording(false);
        }
    }, [voiceReady, recording]);
    const handlePttStop = useCallback(() => {
        if (!recording)
            return;
        setRecording(false);
        setRmsLevel(0);
        voiceClientRef.current?.stopRecording();
    }, [recording]);
    // ── One-shot voice input handler (mic button in text mode) ───────────────
    const handleVoiceInputClick = useCallback(() => {
        // Click during recording → cancel and release mic, no send.
        if (voiceInputState === 'recording') {
            voiceInputRecorderRef.current?.cancel();
            return;
        }
        if (voiceInputState === 'transcribing')
            return;
        setVoiceInputError(null);
        const recorder = new VoiceInputRecorder();
        voiceInputRecorderRef.current = recorder;
        void recorder.start({
            onStart: () => {
                setVoiceInputState('recording');
                cancelAutoAdvance();
            },
            onRms: (level) => setVoiceInputLevel(level),
            onStopped: (wav) => {
                setVoiceInputLevel(0);
                setVoiceInputState('transcribing');
                voiceInputRecorderRef.current = null;
                void (async () => {
                    try {
                        const { text, status } = await transcribeAudio(wav, 'zh-CN');
                        if (text) {
                            sendMessageRef.current?.(text);
                        }
                        else {
                            setVoiceInputError(status === 'NoMatch' ? '没听清楚,再说一次?' : '识别为空');
                        }
                    }
                    catch (e) {
                        setVoiceInputError(e.message);
                    }
                    finally {
                        setVoiceInputState('idle');
                    }
                })();
            },
            onCancelled: (reason) => {
                setVoiceInputLevel(0);
                setVoiceInputState('idle');
                voiceInputRecorderRef.current = null;
                if (reason === 'no-speech')
                    setVoiceInputError('没听到声音');
                else if (reason === 'error')
                    setVoiceInputError('麦克风不可用');
            },
        }).catch((e) => {
            setVoiceInputState('idle');
            setVoiceInputError(e.message);
            voiceInputRecorderRef.current = null;
        });
    }, [voiceInputState, cancelAutoAdvance]);
    useEffect(() => () => {
        voiceInputRecorderRef.current?.cancel();
    }, []);
    // ── Voice Live: spacebar PTT ──────────────────────────────────────────────
    useEffect(() => {
        if (!voiceMode)
            return;
        const onKeyDown = (e) => {
            if (e.code === 'Space' && !e.repeat && !recording)
                void handlePttStart();
        };
        const onKeyUp = (e) => {
            if (e.code === 'Space')
                handlePttStop();
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [voiceMode, recording, handlePttStart, handlePttStop]);
    const exprDef = EXPRESSIONS[faceExpr] ?? EXPRESSIONS['calm'];
    // ── Render ────────────────────────────────────────────────────────────────
    if (loadError) {
        return (_jsxs("div", { className: "max-w-2xl", children: [_jsx("h1", { className: "text-2xl font-semibold text-slate-100 mb-4", children: "Test Chat" }), _jsxs("div", { className: "rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-rose-300 text-sm", children: [_jsx("strong", { children: "Failed to load config:" }), " ", loadError, _jsx("br", {}), "Make sure the server is running (", _jsx("code", { children: "pnpm dev" }), ")."] })] }));
    }
    return (_jsxs("div", { className: "flex flex-col h-[calc(100vh-4rem)]", children: [_jsxs("div", { className: "mb-4 flex-shrink-0", children: [_jsx("h1", { className: "text-2xl font-semibold text-slate-100", children: "Test Chat" }), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: "Live chat with \u5C0F\u6C90 \u00B7 expression timeline + TTS voice active" })] }), activeActivity && (_jsxs("div", { className: "mb-3 flex items-center gap-3 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 flex-shrink-0", children: [_jsx(ActivityIcon, { size: 14, className: "text-purple-400 flex-shrink-0" }), _jsxs("div", { className: "flex-shrink-0", children: [_jsxs("div", { className: "text-[9px] uppercase tracking-widest text-purple-400/70", children: ["Now in", activeActivity.totalSections !== undefined && (_jsxs("span", { className: "ml-1", children: ["\u00B7 section ", Math.min(activitySectionIndex, activeActivity.totalSections), " / ", activeActivity.totalSections] }))] }), _jsxs("div", { className: "text-sm font-medium text-purple-200 leading-tight", children: [activeActivity.name, autoAdvancePending && (_jsx("span", { className: "ml-2 text-[10px] font-normal text-purple-300/70 animate-pulse", children: "\u00B7 auto-continuing\u2026" }))] })] }), activityPlaylist && (_jsxs(_Fragment, { children: [_jsx("div", { className: "h-7 w-px bg-purple-500/30" }), _jsx("button", { onClick: toggleActivityPlayback, className: "flex items-center justify-center w-7 h-7 rounded-full bg-purple-600/70 text-white hover:bg-purple-500 transition-colors flex-shrink-0", title: activityPlaylist.paused ? 'Play' : 'Pause', children: activityPlaylist.paused
                                    ? _jsx(Play, { size: 11, className: "ml-0.5" })
                                    : _jsx(Pause, { size: 11 }) }), _jsx("button", { onClick: skipActivityTrack, disabled: activityPlaylist.index + 1 >= activityPlaylist.playlist.length, className: "flex items-center justify-center w-7 h-7 rounded-full text-purple-300 hover:bg-purple-500/20 transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed", title: "\u5207\u6362\u97F3\u9891", children: _jsx(SkipForward, { size: 12 }) }), _jsxs("div", { className: "flex-1 min-w-0 text-xs text-purple-200", children: [_jsxs("div", { className: "text-[10px] text-purple-400/70", children: ["Track ", activityPlaylist.index + 1, " / ", activityPlaylist.playlist.length] }), _jsx("div", { className: "truncate", title: activityPlaylist.playlist[activityPlaylist.index], children: activityPlaylist.playlist[activityPlaylist.index] })] })] })), !activityPlaylist && activeActivity.id === 'co-creation' && !coCreationMusicPlayed && (_jsx("div", { className: "flex-1 text-[11px] text-purple-300/60 italic", children: "Waiting for the child to pick three notes\u2026" })), !activityPlaylist && activeActivity.id === 'co-creation' && coCreationMusicPlayed && (_jsx("div", { className: "flex-1 text-[11px] text-purple-300/60 italic", children: "Music paused \u2014 listening for next prompt\u2026" })), !activityPlaylist && activeActivity.id !== 'co-creation' && (_jsx("div", { className: "flex-1 text-[11px] text-purple-300/60 italic", children: "No audio configured for this age bucket." })), _jsx("button", { onClick: endActivity, title: "End activity", className: "ml-auto flex items-center justify-center w-6 h-6 rounded text-purple-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors flex-shrink-0", children: _jsx(X, { size: 13 }) })] })), comfortMusic && (_jsxs("div", { className: "mb-3 flex items-center gap-3 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 flex-shrink-0", children: [_jsx(Music, { size: 14, className: "text-purple-400 flex-shrink-0" }), _jsxs("div", { className: "flex-shrink-0", children: [_jsx("div", { className: "text-[9px] uppercase tracking-widest text-purple-400/70", children: "Comfort music" }), _jsx("div", { className: "text-sm font-medium text-purple-200 leading-tight", children: comfortMusic.paused ? 'Paused' : 'Now playing' })] }), _jsx("div", { className: "h-7 w-px bg-purple-500/30" }), _jsx("button", { onClick: () => setComfortMusic((cm) => (cm ? { ...cm, paused: !cm.paused } : cm)), title: comfortMusic.paused ? 'Play' : 'Pause', className: "flex items-center justify-center w-7 h-7 rounded-full bg-purple-600/70 text-white hover:bg-purple-500 transition-colors flex-shrink-0", children: comfortMusic.paused
                            ? _jsx(Play, { size: 11, className: "ml-0.5" })
                            : _jsx(Pause, { size: 11 }) }), _jsx("div", { className: "flex-1 min-w-0 text-xs text-purple-200", children: _jsx("div", { className: "truncate", title: comfortMusic.filename, children: comfortMusic.filename }) }), _jsx("button", { onClick: () => setComfortMusic(null), title: "Stop", className: "ml-auto flex items-center justify-center w-6 h-6 rounded text-purple-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors flex-shrink-0", children: _jsx(X, { size: 13 }) })] })), _jsxs("div", { className: "flex gap-6 flex-1 min-h-0", children: [_jsxs("div", { className: "flex flex-col flex-[3] min-w-0 gap-3", children: [_jsxs("div", { ref: scrollRef, className: "flex-1 min-h-0 overflow-y-auto rounded-lg border border-led-border bg-led-panel p-4 flex flex-col gap-3", children: [transcript.length === 0 && (_jsxs("div", { className: "m-auto text-center text-slate-600 text-sm select-none", children: [_jsx("div", { className: "text-3xl mb-2", children: "\uD83D\uDCAC" }), _jsx("div", { children: voiceMode
                                                    ? 'Hold the button (or Space) to speak'
                                                    : 'Send a message to start a session' }), _jsxs("div", { className: "mt-1 text-xs", children: ["Child age (asked during intro):", ' ', _jsx("span", { className: "text-purple-400", children: childAge })] })] })), transcript.map((msg) => (_jsxs("div", { className: `flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`, children: [(msg.distressTrigger || msg.distressResponse) && (_jsxs("div", { className: "mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-rose-300 flex items-center gap-1", children: [_jsx(ShieldAlert, { size: 10 }), msg.distressTrigger ? 'Distress signal' : 'Blocked — robot did not respond'] })), _jsxs("div", { className: [
                                                    'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                                                    msg.role === 'user'
                                                        ? 'bg-purple-600/30 text-purple-100 rounded-br-sm'
                                                        : 'bg-led-border text-slate-200 rounded-bl-sm',
                                                    (msg.distressTrigger || msg.distressResponse)
                                                        ? 'ring-2 ring-rose-500/50'
                                                        : '',
                                                ].join(' '), children: [msg.content || (msg.streaming ? '' : '…'), msg.streaming && (_jsx("span", { className: "inline-block w-1.5 h-3.5 bg-purple-400 ml-1 animate-pulse rounded-sm align-middle" }))] }), msg.role === 'assistant' && !msg.streaming && !msg.voiceMode && (_jsxs("div", { className: "ml-1 mt-1 flex flex-col gap-0.5", children: [_jsxs("button", { onClick: () => void callTts(msg.content, msg.id), disabled: ttsLoading || streaming || muted, title: "Replay voice", className: "flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed w-fit", children: [_jsx(RotateCcw, { size: 10 }), "Replay"] }), msg.ssml && _jsx(SanitizerPreview, { original: msg.content, ssml: msg.ssml })] }))] }, msg.id))), liveUserTranscript && (_jsx("div", { className: "flex flex-col items-end", children: _jsxs("div", { className: "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-purple-600/20 text-purple-200/60 rounded-br-sm italic", children: [liveUserTranscript, _jsx("span", { className: "inline-block w-1.5 h-3.5 bg-purple-400/50 ml-1 animate-pulse rounded-sm align-middle" })] }) }))] }), _jsxs("div", { className: "flex-shrink-0 flex flex-col gap-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md border border-led-border bg-led-panel text-xs text-slate-400", children: [_jsx(Baby, { size: 12, className: "text-purple-400" }), _jsxs("span", { children: ["Child age \u2014 defaults to ", AGE_DEFAULT, " until the scripted intro collects it. Current: ", _jsx("span", { className: "text-purple-300 font-medium", children: childAge })] })] }), _jsxs("button", { onClick: () => setTherapyMode((v) => !v), disabled: voiceMode, title: therapyMode ? 'Therapy mode (temp 0.6) — click to disable' : 'Enable therapy mode (temp 0.6)', className: [
                                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed',
                                                    therapyMode
                                                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                                        : 'text-slate-500 border-led-border hover:text-slate-300',
                                                ].join(' '), children: [therapyMode ? _jsx(ZapOff, { size: 12 }) : _jsx(Zap, { size: 12 }), "Therapy mode"] }), sessionActive ? (_jsxs("button", { onClick: handleEndSession, disabled: voiceMode, title: "End the current session", className: "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed", children: [_jsx(StopCircle, { size: 12 }), "End session"] })) : (_jsxs("button", { onClick: handleStartChatting, disabled: voiceMode || ttsLoading, title: "Begin a new session with the intro", className: "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed", children: [_jsx(PlayCircle, { size: 12 }), "Start chatting"] }))] }), _jsxs("div", { className: "rounded-lg border border-led-border overflow-hidden", children: [_jsxs("button", { onClick: () => setPromptOpen((v) => !v), className: "w-full flex items-center justify-between px-3 py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors", children: [_jsx("span", { className: "font-medium uppercase tracking-wider", children: "System prompt" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "text-purple-400/70 normal-case tracking-normal", children: ["age ", childAge] }), promptOpen ? _jsx(ChevronUp, { size: 13 }) : _jsx(ChevronDown, { size: 13 })] })] }), promptOpen && (_jsx("div", { className: "border-t border-led-border", children: _jsxs("div", { className: "relative", children: [_jsx("pre", { className: "text-[10px] leading-relaxed text-slate-400 p-3 overflow-auto max-h-52 whitespace-pre-wrap font-mono", children: promptLoading ? 'Loading…' : systemPrompt }), systemPrompt && !promptLoading && (_jsx("button", { onClick: handleCopy, title: "Copy prompt", className: "absolute top-2 right-2 p-1 rounded text-slate-600 hover:text-slate-300 transition-colors", children: copied ? _jsx(Check, { size: 12 }) : _jsx(Copy, { size: 12 }) }))] }) }))] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: () => setMuted((v) => !v), disabled: voiceMode, title: muted ? 'Unmute TTS' : 'Mute TTS', className: [
                                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed',
                                                    muted
                                                        ? 'text-slate-500 border-led-border hover:text-slate-300'
                                                        : 'bg-purple-500/20 text-purple-300 border-purple-500/40',
                                                ].join(' '), children: [muted ? _jsx(VolumeX, { size: 12 }) : _jsx(Volume2, { size: 12 }), muted ? 'Muted' : 'Voice on'] }), _jsxs("select", { value: voiceStyle, onChange: (e) => setVoiceStyle(e.target.value), disabled: ttsLoading || voiceMode, className: "flex-1 bg-led-panel border border-led-border rounded-md px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-purple-500 disabled:opacity-40", children: [_jsx("option", { value: "cheerful", children: "Cheerful" }), _jsx("option", { value: "gentle", children: "Gentle" }), _jsx("option", { value: "whispering", children: "Whispering" }), _jsx("option", { value: "excited", children: "Excited" }), _jsx("option", { value: "empathetic", children: "Empathetic" })] }), _jsxs("button", { onClick: toggleVoiceMode, title: voiceMode ? 'Voice mode ON — click to switch to text' : 'Switch to voice mode', className: [
                                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed',
                                                    voiceMode
                                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                                        : 'text-slate-500 border-led-border hover:text-slate-300',
                                                ].join(' '), children: [voiceMode ? _jsx(Mic, { size: 12 }) : _jsx(MicOff, { size: 12 }), voiceMode ? 'Voice' : 'Voice off'] }), ttsLoading && !voiceMode && (_jsx("span", { className: "text-xs text-slate-500 flex-shrink-0 animate-pulse", children: "Synthesizing\u2026" }))] }), voiceMode ? (_jsxs("div", { className: "flex flex-col gap-2", children: [voiceError && (_jsx("div", { className: "rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300", children: voiceError })), !voiceReady && !voiceError && (_jsx("div", { className: "text-xs text-slate-500 animate-pulse text-center py-1", children: "Connecting to Voice Live\u2026" })), _jsx("button", { onMouseDown: () => void handlePttStart(), onMouseUp: handlePttStop, onMouseLeave: handlePttStop, onTouchStart: (e) => { e.preventDefault(); void handlePttStart(); }, onTouchEnd: handlePttStop, disabled: !voiceReady, className: [
                                                    'w-full rounded-xl py-6 text-sm font-semibold transition-all select-none',
                                                    recording
                                                        ? 'bg-rose-500/30 border-2 border-rose-400 text-rose-300 scale-[0.98]'
                                                        : voiceReady
                                                            ? 'bg-led-border border border-led-border text-slate-400 hover:bg-purple-500/20 hover:border-purple-500/40 hover:text-purple-300 active:scale-[0.98]'
                                                            : 'bg-led-panel border border-led-border text-slate-600 cursor-not-allowed',
                                                ].join(' '), children: recording ? (_jsxs("span", { className: "flex items-center justify-center gap-2", children: [_jsx(Mic, { size: 16, className: "animate-pulse" }), "Listening\u2026 (release to send)"] })) : (_jsxs("span", { className: "flex items-center justify-center gap-2", children: [_jsx(Mic, { size: 16 }), "Hold to speak (or hold Space)"] })) }), recording && (_jsx("div", { className: "flex items-center gap-0.5 h-6 justify-center", children: Array.from({ length: 20 }, (_, i) => (_jsx("div", { className: "w-1 rounded-full bg-rose-400 transition-all duration-75", style: {
                                                        height: `${Math.max(4, Math.min(24, rmsLevel * 300 * (0.4 + Math.random() * 0.6)))}px`,
                                                        opacity: 0.5 + rmsLevel * 0.5,
                                                    } }, i))) }))] })) : (
                                    /* Text input */
                                    _jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex gap-2", children: [_jsx("textarea", { value: input, onChange: (e) => {
                                                            setInput(e.target.value);
                                                            if (e.target.value.length > 0)
                                                                cancelAutoAdvance();
                                                        }, onFocus: cancelAutoAdvance, onKeyDown: handleKeyDown, disabled: !sessionActive, placeholder: !sessionActive
                                                            ? 'Click "Start chatting" to begin a session.'
                                                            : voiceInputState === 'recording'
                                                                ? '正在听你说话… (再点麦克风取消)'
                                                                : voiceInputState === 'transcribing'
                                                                    ? '识别中…'
                                                                    : streaming
                                                                        ? 'Type to interrupt… (Enter to send)'
                                                                        : 'Say something… (Enter to send, or click mic to speak)', rows: 2, className: "flex-1 resize-none bg-led-panel border border-led-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 disabled:opacity-40 transition-colors" }), _jsx("button", { onClick: handleVoiceInputClick, disabled: !sessionActive, title: voiceInputState === 'recording'
                                                            ? 'Click to cancel'
                                                            : voiceInputState === 'transcribing'
                                                                ? 'Transcribing…'
                                                                : 'Speak instead of typing', className: `px-3 rounded-lg flex items-center transition-colors ${voiceInputState === 'recording'
                                                            ? 'bg-rose-600 hover:bg-rose-500 animate-pulse'
                                                            : voiceInputState === 'transcribing'
                                                                ? 'bg-slate-700 cursor-wait'
                                                                : 'bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed'}`, children: voiceInputState === 'transcribing'
                                                            ? _jsx(Loader2, { size: 16, className: "text-white animate-spin" })
                                                            : voiceInputState === 'recording'
                                                                ? _jsx(Mic, { size: 16, className: "text-white" })
                                                                : _jsx(Mic, { size: 16, className: "text-slate-300" }) }), _jsx("button", { onClick: () => sendMessage(), disabled: !input.trim() || !sessionActive, title: streaming ? 'Interrupt and send' : 'Send', className: "px-4 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center", children: _jsx(Send, { size: 16, className: "text-white" }) })] }), voiceInputState === 'recording' && (_jsx("div", { className: "flex items-center gap-2 px-1 h-3", children: _jsx("div", { className: "flex-1 h-1 bg-slate-800 rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-rose-400 transition-all duration-75", style: { width: `${Math.min(100, voiceInputLevel * 600)}%` } }) }) })), voiceInputError && voiceInputState === 'idle' && (_jsx("div", { className: "px-1 text-xs text-rose-400", children: voiceInputError }))] }))] })] }), _jsxs("div", { className: "flex-[2] flex flex-col items-center justify-start gap-4 flex-shrink-0", children: [_jsx("div", { className: "rounded-2xl overflow-hidden shadow-2xl", style: {
                                    boxShadow: `0 0 40px ${exprDef.color}30, 0 8px 32px rgba(0,0,0,0.6)`,
                                }, children: _jsx(FaceRenderer, { renderer: "svg2d", expressionId: faceExpr, idleEnabled: !streaming && visemePlaybackMs < 0, width: 320, height: 200, ...(visemeStream.length > 0 ? {
                                        visemeStream,
                                        visemePlaybackMs: Math.max(0, visemePlaybackMs),
                                    } : {}) }) }), _jsxs("div", { className: "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium", style: {
                                    background: `${exprDef.color}20`,
                                    color: exprDef.color,
                                    border: `1px solid ${exprDef.color}50`,
                                }, children: [_jsx("span", { className: "w-2 h-2 rounded-full", style: { background: exprDef.color } }), exprDef.label, " \u00B7 ", faceExpr, streaming && (_jsx("span", { className: "w-1 h-1 rounded-full bg-current animate-pulse ml-1" }))] }), _jsxs("div", { className: "w-full rounded-lg border border-led-border bg-led-panel p-3 text-xs text-slate-400 space-y-1", children: [_jsxs("div", { className: "text-slate-300 font-medium flex items-center gap-1.5", children: [_jsx(Baby, { size: 12, className: "text-purple-400" }), "Child age", _jsx("span", { className: "text-purple-300 font-normal ml-1", children: childAge })] }), _jsxs("div", { className: "text-[10px] leading-relaxed", children: ["Captured during the scripted intro (new + returning friends both asked). Defaults to ", AGE_DEFAULT, " until the kid replies."] })] }), voiceMode && (_jsx("div", { className: [
                                    'w-full rounded-lg border p-3 text-xs text-center',
                                    voiceReady
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                        : 'border-led-border bg-led-panel text-slate-500',
                                ].join(' '), children: voiceReady ? (_jsxs("span", { className: "flex items-center justify-center gap-1.5", children: [_jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" }), "Voice Live connected"] })) : ('Initialising Voice Live…') }))] })] })] }));
}
