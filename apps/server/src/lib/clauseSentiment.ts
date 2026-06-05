/**
 * Clause-level sentiment classifier — rule-based v1.
 *
 * Streams text chunks in, emits ExpressionTimeline events at clause boundaries.
 * Clause boundaries: 。！？，；…（）— and English .!?,;
 *
 * This is a placeholder for C4. Accuracy is "good enough to feel alive" — not
 * production-grade NLP. The full classifier is a future upgrade.
 *
 * Vitest unit tests in clauseSentiment.test.ts.
 */

import type { ExpressionId } from '@xiaomu/contracts';

export interface ExpressionEvent {
  atCharOffset: number;
  expressionId: ExpressionId;
  confidence: number;
}

// ── Keyword lexicons ──────────────────────────────────────────────────────────
// Each entry: [keyword, weight]. Weights let stronger signals dominate.

type WeightedKeyword = [string, number];

const LEXICONS: Record<ExpressionId, WeightedKeyword[]> = {
  happy: [
    ['高兴', 1], ['开心', 1.5], ['快乐', 1], ['好玩', 1], ['喜欢', 1], ['爱', 0.7],
    ['哈哈', 1.5], ['嘻嘻', 1.2], ['太好了', 1.5], ['棒', 0.8], ['真好', 1],
    ['happy', 1], ['great', 1], ['love', 0.7], ['fun', 1], ['wonderful', 1],
    ['好', 0.3], ['nice', 0.5],
  ],
  excited: [
    ['哇', 1.5], ['太棒了', 1.5], ['厉害', 1.2], ['激动', 1.5], ['精彩', 1.2],
    ['超级', 1], ['最喜欢', 1.2], ['不得了', 1.5],
    ['excited', 1.5], ['amazing', 1.5], ['wow', 1.5], ['incredible', 1.5], ['awesome', 1.2],
  ],
  calm: [
    ['平静', 1.5], ['放松', 1.5], ['慢慢', 1], ['好的', 0.8], ['嗯', 0.4],
    ['稳', 1], ['轻轻', 0.8], ['安静', 1.2],
    ['calm', 1.5], ['okay', 0.5], ['slowly', 1], ['relax', 1.5], ['gentle', 1], ['quiet', 1.2],
  ],
  gentle: [
    ['温柔', 1.5], ['轻轻', 1.5], ['柔和', 1.5], ['轻', 1], ['软', 0.8],
    ['gentle', 1.5], ['softly', 1.5], ['carefully', 1], ['tender', 1.2],
  ],
  listening: [
    ['嗯嗯', 1.5], ['我在听', 2], ['说吧', 1.5], ['继续', 1], ['告诉我', 1.5], ['讲', 0.7],
    ['hmm', 1], ['listening', 2], ['tell me', 1.5], ['go on', 1.5], ['right', 0.5], ['yes', 0.4],
  ],
  curious: [
    ['为什么', 2], ['怎么', 1.5], ['什么', 1], ['想知道', 2], ['好奇', 2], ['有趣', 1.5],
    ['对吗', 1], ['真的吗', 1.5], ['是吗', 1],
    ['curious', 2], ['why', 1.5], ['how', 1], ['what', 0.8], ['interesting', 1.5], ['wonder', 1.5],
  ],
  thinking: [
    ['想想', 1.5], ['等一下', 1.5], ['让我想', 2], ['嗯…', 1.5], ['也许', 1.2], ['可能', 1],
    ['hmm', 1], ['let me think', 2], ['maybe', 1.2], ['perhaps', 1.2], ['wondering', 1.5],
  ],
  sad: [
    ['难过', 2], ['哭', 1.5], ['伤心', 2], ['不开心', 2], ['心痛', 2], ['失落', 1.5],
    ['想念', 1.2], ['孤独', 1.5], ['重重的', 1.5],
    ['sad', 2], ['cry', 1.5], ['hurt', 1.5], ['miss', 1.2], ['unhappy', 2], ['lonely', 2],
  ],
  anxious: [
    ['担心', 2], ['害怕', 2], ['紧张', 2], ['怕', 1.5], ['不安', 2], ['慌', 1.5],
    ['nervous', 2], ['scared', 2], ['worried', 2], ['afraid', 2], ['anxious', 2],
  ],
  sleepy: [
    ['困', 2], ['累', 1.5], ['休息', 1.5], ['睡', 1.5], ['打哈欠', 2], ['眼睛重', 2],
    ['sleepy', 2], ['tired', 1.5], ['rest', 1.2], ['yawn', 2], ['heavy eyes', 2],
  ],
  surprised: [
    ['啊', 1], ['哇哦', 2], ['不是吧', 2], ['真的吗', 1.5], ['没想到', 2],
    ['surprising', 2], ['really', 1], ['unexpected', 2], ['oh my', 1.5], ['no way', 2],
  ],
  celebrating: [
    ['庆祝', 2], ['成功', 1.5], ['赢了', 2], ['做到了', 1.5], ['胜利', 2], ['耶', 2],
    ['celebrate', 2], ['won', 2], ['success', 1.5], ['victory', 2], ['yay', 2], ['yes', 0.8],
  ],
  proud: [
    ['自豪', 2], ['骄傲', 1.5], ['厉害', 1], ['了不起', 2], ['出色', 1.5],
    ['proud', 2], ['achieved', 1.5], ['accomplished', 2], ['did it', 1.5], ['well done', 1.5],
  ],
  confused: [
    ['不明白', 2], ['不懂', 2], ['奇怪', 1.5], ['搞不清', 2], ['糊涂', 2], ['怎么回事', 2],
    ['confused', 2], ["don't understand", 2], ['unclear', 1.5], ['strange', 1.5], ['huh', 1.5],
  ],
  playful: [
    ['来玩', 2], ['游戏', 1.5], ['一起', 0.8], ['好玩', 1.5], ['调皮', 1.5], ['嘻', 1],
    ['play', 1.5], ['game', 1.5], ["let's", 1], ['together', 0.8], ['silly', 1.5],
  ],
  encouraging: [
    ['加油', 2], ['你可以', 2], ['你能做到', 2], ['没关系', 1.5], ['继续', 1], ['试试', 1.5],
    ['鼓励', 2], ['相信你', 2],
    ['you can', 2], ['keep going', 2], ['try', 1.2], ['believe', 1.5], ['almost', 1.2],
  ],
};

// ── Clause boundary detection ─────────────────────────────────────────────────

// These characters end a clause; we classify the text up to and including this char
const CLAUSE_TERMINALS = new Set(['。', '！', '？', '…', '!', '?', '.']);
// These are weaker clause splitters — we only split here if the clause is long enough
const CLAUSE_SOFT = new Set(['，', '；', ',', ';', '、']);
const SOFT_MIN_LEN = 10; // only split on soft boundaries if clause is at least this long

// ── Classifier ────────────────────────────────────────────────────────────────

export interface ClauseClassifier {
  feed(chunk: string): ExpressionEvent[];
  flush(): ExpressionEvent[];
  reset(): void;
}

const EXPRESSION_IDS = Object.keys(LEXICONS) as ExpressionId[];

function classifyClause(text: string): { expressionId: ExpressionId; confidence: number } {
  const normalized = text.toLowerCase();
  const scores: Partial<Record<ExpressionId, number>> = {};

  for (const id of EXPRESSION_IDS) {
    let score = 0;
    const keywords = LEXICONS[id]!;
    for (const [kw, weight] of keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        score += weight;
      }
    }
    if (score > 0) scores[id] = score;
  }

  // Find highest scorer
  let bestId: ExpressionId = 'calm';
  let bestScore = 0;
  let totalScore = 0;

  for (const [id, score] of Object.entries(scores) as [ExpressionId, number][]) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  // Confidence: ratio of best score to total, clamped. Low if nothing matched.
  const confidence = totalScore > 0
    ? Math.min(0.95, bestScore / (totalScore + 2))
    : 0.25; // default to calm with low confidence

  return { expressionId: bestId, confidence };
}

export function createClauseClassifier(): ClauseClassifier {
  let buffer = '';
  let totalOffset = 0;

  function processBuffer(force: boolean): ExpressionEvent[] {
    const events: ExpressionEvent[] = [];
    let start = 0;

    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i]!;
      const clauseLen = i - start + 1;

      const isTerminal = CLAUSE_TERMINALS.has(ch);
      const isSoft = CLAUSE_SOFT.has(ch) && clauseLen >= SOFT_MIN_LEN;

      if (isTerminal || isSoft) {
        const clause = buffer.slice(start, i + 1).trim();
        if (clause.length >= 2) {
          const { expressionId, confidence } = classifyClause(clause);
          events.push({
            atCharOffset: totalOffset + i,
            expressionId,
            confidence,
          });
        }
        start = i + 1;
      }
    }

    // If force (flush), classify whatever is left
    if (force && start < buffer.length) {
      const clause = buffer.slice(start).trim();
      if (clause.length >= 2) {
        const { expressionId, confidence } = classifyClause(clause);
        events.push({
          atCharOffset: totalOffset + buffer.length - 1,
          expressionId,
          confidence,
        });
        start = buffer.length;
      }
    }

    totalOffset += start;
    buffer = buffer.slice(start);
    return events;
  }

  return {
    feed(chunk: string): ExpressionEvent[] {
      buffer += chunk;
      return processBuffer(false);
    },
    flush(): ExpressionEvent[] {
      return processBuffer(true);
    },
    reset(): void {
      buffer = '';
      totalOffset = 0;
    },
  };
}
