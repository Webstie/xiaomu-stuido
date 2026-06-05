import { describe, test, expect, beforeEach } from 'vitest';
import { createClauseClassifier } from './clauseSentiment.js';
import type { ClauseClassifier } from './clauseSentiment.js';

describe('ClauseClassifier', () => {
  let classifier: ClauseClassifier;

  beforeEach(() => {
    classifier = createClauseClassifier();
  });

  // ── Mandarin clause detection ─────────────────────────────────────────────

  test('happy: 你今天做得很棒！', () => {
    const events = classifier.feed('你今天做得很棒！');
    expect(events).toHaveLength(1);
    expect(events[0]?.expressionId).toBe('happy');
    expect(events[0]?.confidence).toBeGreaterThan(0.2);
  });

  test('sad: 我很难过，心里很不开心。', () => {
    const events = classifier.feed('我很难过，心里很不开心。');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds).toContain('sad');
  });

  test('curious: 为什么天空是蓝色的呢？', () => {
    const events = classifier.feed('为什么天空是蓝色的呢？');
    expect(events).toHaveLength(1);
    expect(events[0]?.expressionId).toBe('curious');
  });

  test('excited: 哇，太棒了！', () => {
    const events = classifier.feed('哇，太棒了！');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds.some(id => id === 'excited' || id === 'happy')).toBe(true);
  });

  test('anxious: 我好害怕，很紧张。', () => {
    const events = classifier.feed('我好害怕，很紧张。');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds).toContain('anxious');
  });

  test('sleepy: 我好困，眼睛很重。', () => {
    const events = classifier.feed('我好困，眼睛很重。');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds).toContain('sleepy');
  });

  test('celebrating: 我们成功了，耶！', () => {
    const events = classifier.feed('我们成功了，耶！');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds.some(id => id === 'celebrating' || id === 'happy')).toBe(true);
  });

  // ── English clauses ───────────────────────────────────────────────────────

  test('English happy: You did amazing today!', () => {
    const events = classifier.feed('You did amazing today!');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds.some(id => id === 'happy' || id === 'excited')).toBe(true);
  });

  test('English sad: I feel really lonely and sad.', () => {
    const events = classifier.feed('I feel really lonely and sad.');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds).toContain('sad');
  });

  test('English curious: Why does the rain make that sound?', () => {
    const events = classifier.feed('Why does the rain make that sound?');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds).toContain('curious');
  });

  test('English encouraging: You can do it, keep going!', () => {
    const events = classifier.feed('You can do it, keep going!');
    const exprIds = events.map(e => e.expressionId);
    expect(exprIds).toContain('encouraging');
  });

  // ── Streaming behavior ────────────────────────────────────────────────────

  test('no events emitted mid-clause (no boundary yet)', () => {
    const events = classifier.feed('今天天气很好');  // no boundary
    expect(events).toHaveLength(0);
  });

  test('event emitted when clause boundary arrives in next chunk', () => {
    classifier.feed('今天天气很好');
    const events = classifier.feed('！');
    expect(events).toHaveLength(1);
  });

  test('multiple clauses in one chunk produce multiple events', () => {
    const events = classifier.feed('我很难过。但是我们成功了！');
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test('atCharOffset increases monotonically across calls', () => {
    const e1 = classifier.feed('我很开心！');
    const e2 = classifier.feed('但是我担心明天。');
    const all = [...e1, ...e2];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.atCharOffset).toBeGreaterThan(all[i - 1]!.atCharOffset);
    }
  });

  test('flush emits remaining buffer as an event', () => {
    classifier.feed('这是一段没有结束标点的话');
    const events = classifier.flush();
    expect(events).toHaveLength(1);
  });

  test('flush returns empty if buffer already drained', () => {
    classifier.feed('今天很好！');
    classifier.flush();  // already triggered by !
    const events = classifier.flush();
    expect(events).toHaveLength(0);
  });

  test('reset clears state and offsets restart from 0', () => {
    classifier.feed('第一句。');
    classifier.reset();
    const events = classifier.feed('第二句。');
    expect(events[0]?.atCharOffset).toBeLessThan(10);
  });

  // ── Confidence ────────────────────────────────────────────────────────────

  test('confidence is between 0 and 1', () => {
    const events = classifier.feed('我好开心啊，哈哈！');
    for (const e of events) {
      expect(e.confidence).toBeGreaterThanOrEqual(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('strong keyword match gives higher confidence than neutral text', () => {
    const strongEvents = classifier.feed('我非常非常难过，心里很痛苦。');
    const neutralEvents = classifier.flush();
    classifier.reset();
    const weakEvents = createClauseClassifier().feed('今天吃饭了。');

    const strongConf = strongEvents[0]?.confidence ?? 0;
    const weakConf = weakEvents[0]?.confidence ?? 1;
    expect(strongConf).toBeGreaterThanOrEqual(weakConf);
  });

  // ── Soft boundary behavior ────────────────────────────────────────────────

  test('short clause before comma does not split (under SOFT_MIN_LEN)', () => {
    // "嗯，" — only 2 chars before comma, under threshold
    const events = classifier.feed('嗯，');
    expect(events).toHaveLength(0);
  });

  test('long clause before comma splits (over SOFT_MIN_LEN)', () => {
    const events = classifier.feed('我们今天一起完成了一件非常重要的事情，');
    expect(events).toHaveLength(1);
  });
});
