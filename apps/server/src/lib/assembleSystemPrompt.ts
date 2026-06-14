/**
 * Assembles the system prompt for a chat session.
 *
 * Deterministic: same inputs always produce same output.
 * Snapshot-tested in assembleSystemPrompt.test.ts.
 *
 * Sections:
 *   1. Identity + language
 *   2. Character: traits, do/don't
 *   3. Child profile: age only
 *   4. Language register (from ageRouting) + age-bucketed music preferences
 *   5. Voice guide: all voice samples as few-shot examples
 *   6. Safety rules
 *   7. Activity context (if mid-session)
 *   8. Session rhythm
 */

import type { StudioConfig, ActivityContext } from '@xiaomu/contracts';
import { resolveActivityScript } from './activityResolver.js';
import {
  FIRST_MEETING_QUESTION,
  FIRST_TIME_INTRO,
  AGE_PROMPT,
  RETURNING_RECOGNITION,
  RETURNING_DAILY_STORIES,
  WEATHER_PROMPT,
} from './introFlow.js';

const LANG_LABEL: Record<string, string> = {
  'zh-CN': 'Mandarin (zh-CN)',
  'en-US': 'English (en-US)',
};

const CATEGORY_LABEL: Record<string, string> = {
  'greeting':            'Greeting',
  'breathing-exercise':  'Breathing exercise opener',
  'encouragement':       'Encouragement',
  'celebration':         'Celebration',
  'gentle-redirect':     'Gentle redirect',
  'curiosity-prompt':    'Curiosity prompt',
  'sadness-mirror':      'Mirroring sadness',
  'sleepy-wind-down':    'Sleepy wind-down',
  'body-rhythm-prompt':  'Body rhythm prompt',
  'end-of-session':      'End-of-session ritual',
};

const REGISTER_NOTE: Record<string, string> = {
  'very-simple': 'Use 1–5 word sentences. Concrete nouns only. Repeat key words for emphasis. No abstract concepts.',
  'simple':      'Short sentences (under 10 words). Concrete language. Stories with clear characters and actions.',
  'normal':      'Full sentences. Can handle nuance. Respect emotional complexity. Do NOT use baby talk.',
  'nuanced':     'Full language. Engage with abstract ideas, metaphors, and complex feelings.',
};

function hr(): string {
  return '─────────────────────────────────────────────';
}

export function assembleSystemPrompt(
  config: StudioConfig,
  childAge: number,
  activityContext?: ActivityContext,
): string {
  const lines: string[] = [];
  const { identity, personality, voiceSamples, safety, conversationFlow, ageRouting, musicPreferences } = config;

  // ── 1. Identity ───────────────────────────────────────────────────────────
  lines.push(
    `You are ${identity.robotName}, a music-therapy companion robot for hospitalized children aged 3–12.`,
  );
  lines.push(identity.tagline);
  const langStr = LANG_LABEL[identity.primaryLanguage] ?? identity.primaryLanguage;
  const secLang = identity.secondaryLanguage
    ? ` Secondary: ${LANG_LABEL[identity.secondaryLanguage] ?? identity.secondaryLanguage}.`
    : '';
  lines.push(`Primary language: ${langStr}.${secLang}`);
  lines.push('');
  lines.push(hr());
  lines.push('');

  // ── 2. Character ──────────────────────────────────────────────────────────
  lines.push('## Your character');
  lines.push('');
  lines.push(`You are: ${personality.traits.join(', ')}.`);
  lines.push('');
  lines.push('You always:');
  for (const d of personality.doList) lines.push(`• ${d}`);
  lines.push('');
  lines.push('You never:');
  for (const d of personality.dontList) lines.push(`• ${d}`);
  lines.push('');
  lines.push(hr());
  lines.push('');

  // ── 3. Child profile (age only) ───────────────────────────────────────────
  lines.push('## The child you\'re with');
  lines.push('');
  lines.push(`Age: ${childAge} years old`);
  lines.push('');

  // ── 4. Language register + age-bucketed music preferences ────────────────
  const ageRoute = ageRouting.find(
    (r) => childAge >= r.minAge && childAge <= r.maxAge,
  );
  if (ageRoute) {
    const note = REGISTER_NOTE[ageRoute.languageRegister] ?? ageRoute.notes ?? '';
    lines.push(`Language register: **${ageRoute.languageRegister}** — ${note}`);
    if (ageRoute.notes && REGISTER_NOTE[ageRoute.languageRegister]) {
      lines.push(`Additional note: ${ageRoute.notes}`);
    }
    lines.push('');
  }

  const mp = musicPreferences.find(
    (b) => childAge >= b.minAge && childAge <= b.maxAge,
  );
  if (mp) {
    const mpParts: string[] = [`max volume ${mp.maxVolume}%`];
    if (mp.allowlist.length > 0) mpParts.push(`prefers: ${mp.allowlist.join(', ')}`);
    if (mp.blocklist.length > 0) mpParts.push(`avoid: ${mp.blocklist.join(', ')}`);
    if (mp.avoidNotes) mpParts.push(mp.avoidNotes);
    lines.push(`Music: ${mpParts.join(' | ')}`);
    lines.push('');
  }

  lines.push(hr());
  lines.push('');

  // ── 5. Voice guide ────────────────────────────────────────────────────────
  lines.push('## Voice guide — follow this style exactly');
  lines.push('');
  lines.push('These are examples of how you speak. Study the tone, length, and discourse markers.');
  lines.push('');
  for (const sample of voiceSamples) {
    const label = CATEGORY_LABEL[sample.category] ?? sample.category;
    lines.push(`### ${label}`);
    lines.push(sample.text);
    lines.push('');
  }

  lines.push(hr());
  lines.push('');

  // ── 6. Safety ─────────────────────────────────────────────────────────────
  lines.push('## Safety');
  lines.push('');
  if (safety.avoidTopics.length > 0) {
    lines.push('Topics to avoid:');
    for (const t of safety.avoidTopics) lines.push(`• ${t}`);
    lines.push('');
  }
  if (safety.hardProhibitions.length > 0) {
    lines.push('Hard prohibitions (never under any circumstances):');
    for (const p of safety.hardProhibitions) lines.push(`• ${p}`);
    lines.push('');
  }

  const activityAlreadyRunning = Boolean(activityContext?.activityId);

  // ── 6a. Opening flow (model-judged intent — no classifier) ───────────────
  // The studio still shows FIRST_MEETING_QUESTION as the assistant's opening
  // line. Once the child replies, the studio's client state machine takes
  // over: it classifies yes/no/unclear and emits scripted replies (age prompt,
  // mood reply, weather prompt, recommendation, game card, etc.) entirely on
  // the client. The model is only consulted for free-form turns AFTER the
  // child either (a) picks a game to try → silently triggers `start_activity`,
  // (b) the recommended-game pool is exhausted, or (c) the child expresses
  // direct activity intent at any point (bypass).
  //
  // This block remains so the model has the FIRST_TIME_INTRO + DAILY_STORIES
  // text available when the studio plays them back, and so it knows the
  // scripted flow exists and not to second-guess it.
  if (!activityAlreadyRunning) {
    lines.push(hr());
    lines.push('');
    lines.push('## Opening flow (handled by the studio client, not you)');
    lines.push('');
    lines.push(`Session opens with the assistant asking: "${FIRST_MEETING_QUESTION}"`);
    lines.push('');
    lines.push('The studio\'s client state machine handles the next 2–6 turns: it classifies the child\'s reply, plays FIRST-TIME INTRO + ' + AGE_PROMPT + ' OR ' + RETURNING_RECOGNITION + ' + a daily story, then routes through a weather mood prompt and game recommendation. You do NOT generate these turns. The first time you are called is either:');
    lines.push('');
    lines.push('  • a silent message like "开始呼吸练习" / "开始身体小乐队" / "开始音乐心情猜猜猜" / "开始三个音符变魔法" — the child picked a game and the client is asking you to call `start_activity` with the matching activity_id. Call it immediately.');
    lines.push('  • the child gave a free-form reply after the client offered "那你想做什么呢?我们可以做呼吸练习、身体小乐队、音乐心情猜猜猜、或者三个音符变魔法。" — pick the matching activity and call `start_activity`, or ask one short clarifying question if their reply is ambiguous.');
    lines.push('  • the child expressed direct activity intent at any point during the scripted flow — same: call `start_activity` immediately.');
    lines.push('');
    lines.push('Do not re-ask scripted questions, do not repeat the weather prompt, do not narrate the recommendation. Stay focused on getting to `start_activity`.');
    lines.push('');
    lines.push('─── FIRST-TIME INTRO (reference — the client plays this verbatim) ───');
    lines.push(FIRST_TIME_INTRO);
    lines.push('─── END ───');
    lines.push('');
    lines.push('─── DAILY STORIES POOL (reference — the client picks one) ───');
    RETURNING_DAILY_STORIES.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('─── END ───');
    lines.push('');
    lines.push('─── WEATHER PROMPT (reference) ───');
    lines.push(WEATHER_PROMPT);
    lines.push('─── END ───');
    lines.push('');
  }

  // ── 6b. Activities the model can start ───────────────────────────────────
  // Skip this whole block when an activity is already running — otherwise the
  // model tries to call start_activity again every turn.
  if (config.activities.length > 0 && !activityAlreadyRunning) {
    lines.push(hr());
    lines.push('');
    lines.push('## Activities you can begin');
    lines.push('');
    lines.push('You have a tool `start_activity(activity_id, reason?)` for these:');
    for (const act of config.activities) {
      lines.push(`• \`${act.id}\` — ${act.name}. ${act.description}`);
    }
    lines.push('');
    lines.push('**Intent recognition — call `start_activity` the moment the child\'s intent is clear:**');
    lines.push('You — not a keyword table — decide whether the child has expressed intent for one of the four activities. Use full semantic understanding: the child may speak Mandarin, English, slang, baby-talk, or describe the activity indirectly ("I want to make a song", "let\'s clap", "我心慌"). You judge each utterance on its meaning, not its surface words.');
    lines.push('');
    lines.push('When intent is clear, call `start_activity` IMMEDIATELY on the same turn. You may add a one-line acknowledgement before the tool call ("好呀~我们一起创作吧。") but no questions, no preamble checks, no narrating the activity in text before the tool fires.');
    lines.push('');
    lines.push('When intent is genuinely ambiguous, ask ONE direct question — "你想做什么呢？" — never a mood-metaphor question. Do not ask follow-up clarifications turn after turn; pick the most likely activity after one round.');
    lines.push('');
    lines.push('**Anti-deflection rules (these are absolute):**');
    lines.push('• NEVER ask "如果你的心情是一种颜色/天气/动物/声音…" or any "what is your mood like" metaphor question. The voice samples that contain such lines are there to teach tone and discourse markers ONLY — they are not a recurring script. Treat them as forbidden as direct templates.');
    lines.push('• NEVER ask the child to describe their mood, weather, color, or feeling before starting an activity that the child has already requested. Doing so is a failure of the dispatch role.');
    lines.push('• If the child has already named what they want, even loosely, your only acceptable response shape is: (optional 1-line ack) + tool call. Anything else is wrong.');
    lines.push('• At most ONE open-ended check-in over the entire session, and only when the child has NOT signalled any intent. After the very first exchange, move forward — repeat check-ins are forbidden.');
    lines.push('');
  }

  // ── 7. Activity context ───────────────────────────────────────────────────
  if (activityContext) {
    lines.push(hr());
    lines.push('');
    lines.push('## Current activity');
    lines.push('');
    if (activityContext.activityName) {
      const typeStr = activityContext.type ? ` (${activityContext.type})` : '';
      lines.push(`Activity: ${activityContext.activityName}${typeStr}`);
    }
    if (activityContext.description) {
      lines.push(activityContext.description);
    }
    if (activityContext.therapyMode) {
      lines.push('');
      lines.push(
        '⚠ Therapy mode: Keep responses especially calm, brief, and grounded. ' +
        'Avoid humour or playfulness until the child signals readiness.',
      );
    }

    // Inject narration script section — supports age-bucketed (body-rhythm /
    // breathing), emotion-bucketed (emotion-music-mapping), and the interactive
    // co-creation activity (which uses the full script as a free-form guide,
    // not section slicing).
    if (activityContext.activityId) {
      const activity = config.activities.find((a) => a.id === activityContext.activityId);
      if (activity?.coCreation) {
        const cc = activity.coCreation;
        const lastVariant = activityContext.coCreationLastVariant ?? 'none';
        const notes = activityContext.coCreationNotes;
        const notesStr = notes && notes.length === 3 ? `[${notes.join(', ')}]` : '(child has not picked yet)';

        // Determine the current stage explicitly from the last play_melody variant.
        let currentStage: 2 | 4 | 5 | 6;
        if (lastVariant === 'none') currentStage = 2;
        else if (lastVariant === 'original') currentStage = 4;
        else if (lastVariant === 'revised') currentStage = 5;
        else /* background */ currentStage = 6;

        lines.push('');
        lines.push(`**You are mid-way through the ${activity.name} activity.**`);
        lines.push('');
        lines.push(`**The platform has tracked your stage: you are now at STAGE ${currentStage}.**`);
        lines.push(`Last play_melody variant: \`${lastVariant}\`. Notes the child picked: ${notesStr}.`);
        lines.push('');
        lines.push('**This single turn delivers exactly Stage ' + currentStage + ' and nothing else.** Do not preview later stages. Do not skip stages.');
        lines.push('');

        if (currentStage === 2) {
          lines.push('## Stage 2 — Collect three notes');
          lines.push('The child just replied. Inspect their message:');
          lines.push('  • If they named 3 valid notes (words or numbers 1–6), proceed: say "选得真好！我们来听听你的音乐听起来是什么样子的。" then call `play_melody({ notes, variant: "original" })` with their picks. END TURN.');
          lines.push('  • If they picked fewer than 3, or unsupported notes, gently re-ask: list the 6 options again and invite them to choose three. Do NOT call play_melody.');
          lines.push(`Available notes: ${cc.notes.join(', ')}. Translate digits: 1=Do, 2=Re, 3=Mi, 4=Fa, 5=Sol, 6=La, 7=Ti.`);
        } else if (currentStage === 4) {
          lines.push('## Stage 4 — Introduce the three magics and play revised');
          lines.push('The original melody just finished. **This turn MUST include BOTH:**');
          lines.push('  (a) Speak the three-magics intro:');
          lines.push('      "哇！我们一起创造了一个音乐点子！🎉 但是音乐家们常常喜欢跟自己的音乐玩游戏，用不同的方式去改变它。我们来学几个音乐魔法吧！🦋 魔法一：换一个音符 — 换掉其中一个音符，听听看音乐会变得不一样。🐢🐇 魔法二：改变速度 — 速度就是音乐的快慢。⭐ 魔法三：加入一个新音符。现在，我们来听一听，这段音乐可以变出什么不一样的样子吧。"');
          lines.push(`  (b) Then call \`play_melody({ notes: ${JSON.stringify(notes ?? ['Do','Re','Mi'])}, variant: "revised" })\` in the SAME turn.`);
          lines.push('Without the tool call no music plays. END TURN after the tool call.');
        } else if (currentStage === 5) {
          lines.push('## Stage 5 — Menu prompt and play background');
          lines.push('The revised melody just finished. **This turn MUST include BOTH:**');
          lines.push('  (a) Speak the menu prompt verbatim:');
          lines.push('      "现在轮到你当音乐探险家啦！1️⃣ 换一个音符  2️⃣ 改变速度  3️⃣ 加入一个新音符。慢慢来，没有标准答案。我好期待听到你创作的音乐！🌈"');
          lines.push(`  (b) Then call \`play_melody({ notes: ${JSON.stringify(notes ?? ['Do','Re','Mi'])}, variant: "background" })\` in the SAME turn.`);
          lines.push('Without the tool call no music plays and the activity stalls. END TURN after the tool call. The studio will auto-send "继续" once the background has played through twice.');
        } else if (currentStage === 6) {
          lines.push('## Stage 6 — Closing and end_activity');
          lines.push('The background music just finished. **This turn MUST include BOTH:**');
          lines.push('  (a) Speak the closing line:');
          lines.push('      "谢谢你今天和我一起创作音乐。🎵 你的音乐跟别人的不一样，因为它来自你心里。我会记住我们的音乐大冒险，下次我们可以一起创作新的东西！下次再来彩虹缤纷镇找我玩哦！🌈✨"');
          lines.push('  (b) Then call `end_activity()` in the SAME turn.');
          lines.push('END TURN after end_activity. Do not invent any further stages.');
        }

        lines.push('');
        lines.push('─── DIALOGUE GUIDE (for reference phrasing only — the stage instructions above are authoritative) ───');
        lines.push(cc.narrationScript);
        lines.push('─── END GUIDE ───');
      } else if (activity) {
        const resolved = resolveActivityScript(activity, childAge);
        if (resolved && resolved.sections.length > 0) {
          const idx = activityContext.sectionIndex ?? 0;

          lines.push('');
          if (idx >= resolved.sections.length) {
            // All sections delivered → wrap up
            lines.push(
              `**${activity.name} script is complete (${resolved.sections.length} sections delivered).** ` +
              `The activity is winding down. Invite the child to share how their body and mood feel ` +
              `now, celebrate what they did, and gently offer to rest or pick another activity.`,
            );
          } else {
            const currentSection = resolved.sections[idx]!;
            lines.push(
              `**Script section ${idx + 1} of ${resolved.sections.length} — speak this verbatim then STOP.**`,
            );
            lines.push('');
            lines.push('Rules (MANDATORY — applies regardless of conversation length or how the child replies):');
            lines.push('• **Your response BEGINS with the first character of the section text below.** Do NOT add any preamble, acknowledgement, transition phrase, or paraphrase before it. The very first character you emit must be the first character of the section.');
            lines.push('• Speak the section text word-for-word. Do not paraphrase, summarize, shorten, expand, or invent new lines.');
            lines.push('• Your response ends after this section. Do NOT add a preview of the next section or any closing remark.');
            lines.push('• The child\'s last message may be brief, vague, or a literal "继续" — the platform uses any reply to advance to the next section. Deliver THIS section regardless of what the child said.');
            lines.push('');
            lines.push('─── SECTION TO SPEAK ───');
            lines.push(currentSection);
            lines.push('─── END SECTION ───');
          }
        }
      }
    }

    lines.push('');
  }

  // ── 8. Session rhythm ─────────────────────────────────────────────────────
  lines.push(hr());
  lines.push('');
  lines.push('## Session rhythm');
  lines.push('');
  lines.push(`Opening: "${conversationFlow.sessionOpeningScript}"`);
  const closings = conversationFlow.sessionClosingScript
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (closings.length > 1) {
    lines.push('Closing — pick the one that fits the moment:');
    for (const c of closings) lines.push(`• "${c}"`);
  } else {
    lines.push(`Closing: "${closings[0] ?? conversationFlow.sessionClosingScript}"`);
  }
  if (conversationFlow.transitionPhrases.length > 0) {
    lines.push(`Transition phrases: ${conversationFlow.transitionPhrases.join(' / ')}`);
  }
  lines.push(
    `Suggest a natural break after approximately ${conversationFlow.maxTurnsBeforeBreak} turns.`,
  );
  lines.push('');

  return lines.join('\n');
}
