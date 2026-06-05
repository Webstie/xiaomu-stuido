import { describe, test, expect } from 'vitest';
import { assembleSystemPrompt } from './assembleSystemPrompt.js';
import { DEFAULT_CONFIG, ZI_PERSONA, YUHAN_PERSONA, ZAIWA_PERSONA } from './seeds.js';
import type { ActivityContext } from '@xiaomu/contracts';

describe('assembleSystemPrompt', () => {

  // ── Snapshot tests ──────────────────────────────────────────────────────────

  test('default config + Zi persona → snapshot', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt).toMatchSnapshot();
  });

  test('default config + Yuhan persona → snapshot', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, YUHAN_PERSONA);
    expect(prompt).toMatchSnapshot();
  });

  test('default config + Zaiwa persona → snapshot', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZAIWA_PERSONA);
    expect(prompt).toMatchSnapshot();
  });

  test('with activity context → snapshot', () => {
    const ctx: ActivityContext = {
      activityId: 'breathing',
      activityName: '呼吸练习',
      type: 'breathing',
      description: 'Guided slow breathing — inhale 4 counts, hold 2, exhale 6.',
    };
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA, ctx);
    expect(prompt).toMatchSnapshot();
  });

  test('with therapy mode → snapshot', () => {
    const ctx: ActivityContext = {
      activityId: 'breathing',
      activityName: '呼吸练习',
      type: 'breathing',
      therapyMode: true,
    };
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA, ctx);
    expect(prompt).toMatchSnapshot();
  });

  // ── Structural assertions (not snapshots) ────────────────────────────────────

  test('includes robot name in first line', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt.split('\n')[0]).toContain('小沐');
  });

  test('includes child name and age', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt).toContain("The child you're with: Zi");
    expect(prompt).toContain('Age: 3 years old');
  });

  test('includes Yuhan profile — no baby talk warning present', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, YUHAN_PERSONA);
    expect(prompt).toContain('Yuhan');
    expect(prompt).toContain('12 years old');
    // Yuhan uses normal register — should NOT contain very-simple notes
    expect(prompt).not.toContain('1–5 word sentences');
  });

  test('Zi uses very-simple register', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt).toContain('very-simple');
  });

  test('Yuhan uses normal register', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, YUHAN_PERSONA);
    expect(prompt).toContain('normal');
  });

  test('contains all 10 voice sample categories', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt).toContain('Greeting');
    expect(prompt).toContain('Breathing exercise opener');
    expect(prompt).toContain('Encouragement');
    expect(prompt).toContain('Celebration');
    expect(prompt).toContain('Gentle redirect');
    expect(prompt).toContain('Curiosity prompt');
    expect(prompt).toContain('Mirroring sadness');
    expect(prompt).toContain('Sleepy wind-down');
    expect(prompt).toContain('Body rhythm prompt');
    expect(prompt).toContain('End-of-session ritual');
  });

  test('contains safety section', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt).toContain('## Safety');
    expect(prompt).toContain('Hard prohibitions');
  });

  test('activity context section absent when not provided', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    expect(prompt).not.toContain('## Current activity');
  });

  test('activity context section present when provided', () => {
    const ctx: ActivityContext = { activityName: '呼吸练习', type: 'breathing' };
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA, ctx);
    expect(prompt).toContain('## Current activity');
    expect(prompt).toContain('呼吸练习');
  });

  test('therapy mode marker present when therapyMode: true', () => {
    const ctx: ActivityContext = { therapyMode: true };
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA, ctx);
    expect(prompt).toContain('Therapy mode');
  });

  test('therapy mode marker absent when therapyMode: false', () => {
    const ctx: ActivityContext = { therapyMode: false };
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA, ctx);
    expect(prompt).not.toContain('Therapy mode');
  });

  test('no AI-tells in voice samples section', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    // The dontList deliberately names these phrases (to prohibit them), so we
    // check only the voice-guide section which must be AI-tell-free.
    const voiceSection = prompt.split('## Voice guide')[1]?.split('## Safety')[0] ?? '';
    expect(voiceSection).not.toContain("I'm here to help");
    expect(voiceSection).not.toContain('as an AI');
    expect(voiceSection).not.toContain('As an AI');
  });

  test('contains discourse markers in voice samples', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZI_PERSONA);
    // At least one Mandarin discourse marker should appear in the samples
    const hasMarker = ['欸', '哇', '嗯', '哈哈'].some((m) => prompt.includes(m));
    expect(hasMarker).toBe(true);
  });

  test('deterministic — same input produces identical output', () => {
    const a = assembleSystemPrompt(DEFAULT_CONFIG, YUHAN_PERSONA);
    const b = assembleSystemPrompt(DEFAULT_CONFIG, YUHAN_PERSONA);
    expect(a).toBe(b);
  });

  test('Zaiwa: music preferences reflected', () => {
    const prompt = assembleSystemPrompt(DEFAULT_CONFIG, ZAIWA_PERSONA);
    expect(prompt).toContain('pop');
    expect(prompt).toContain('65');  // maxVolume
  });
});
