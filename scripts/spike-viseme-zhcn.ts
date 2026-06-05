/**
 * scripts/spike-viseme-zhcn.ts
 *
 * Verifies that Azure TTS returns VisemeReceived events for zh-CN.
 *
 * See CLAUDE.md §6.4 — do NOT trust the docs (which imply viseme is en-US only).
 * Community reports confirm zh-CN works. This script provides the ground truth.
 *
 * Usage:  pnpm spike:viseme
 *         (or: pnpm tsx scripts/spike-viseme-zhcn.ts)
 *
 * Reads:  .env (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)
 * Writes: scripts/viseme-spike-result.json
 *
 * Exit codes: 0 = PASS, 1 = PARTIAL, 2 = FAIL, 3 = config/network error
 */

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ── Load .env ─────────────────────────────────────────────────────────────────
loadEnv({ path: path.join(repoRoot, '.env') });

const SPEECH_KEY    = process.env['AZURE_SPEECH_KEY']    ?? '';
const SPEECH_REGION = process.env['AZURE_SPEECH_REGION'] ?? '';
const VOICE         = process.env['AZURE_SPEECH_DEFAULT_VOICE'] ?? 'zh-CN-XiaoxiaoMultilingualNeural';

// ── Config ────────────────────────────────────────────────────────────────────
const INPUT_TEXT =
  '你好，我是小沐，今天想和你一起唱歌。';

const RESULT_FILE = path.join(__dirname, 'viseme-spike-result.json');

// ── Validation ────────────────────────────────────────────────────────────────
if (!SPEECH_KEY || SPEECH_KEY.startsWith('<') || SPEECH_KEY.length < 10) {
  console.error('✗  AZURE_SPEECH_KEY is missing or looks like a placeholder.');
  console.error('   Run ./scripts/setup.sh first to populate .env.');
  process.exit(3);
}
if (!SPEECH_REGION) {
  console.error('✗  AZURE_SPEECH_REGION is missing in .env.');
  process.exit(3);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface VisemeCapture {
  audioOffsetMs: number;
  visemeId: number;
}

interface SpikeResult {
  timestamp: string;
  input: string;
  voice: string;
  region: string;
  events: VisemeCapture[];
  audioDurationMs: number | null;
  summary: {
    totalEvents: number;
    distinctVisemeIds: number[];
    firstOffsetMs: number | null;
    lastOffsetMs: number | null;
    audioDurationMs: number | null;
    trailingGapMs: number | null;
    coveragePct: number | null;
    verdict: 'PASS' | 'PARTIAL' | 'FAIL';
    verdictReason: string;
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Xiaomu Studio — zh-CN Viseme Spike');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Input:  "${INPUT_TEXT}"`);
  console.log(`  Voice:  ${VOICE}`);
  console.log(`  Region: ${SPEECH_REGION}`);
  console.log('');

  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  speechConfig.speechSynthesisVoiceName = VOICE;

  // Collect audio into a memory stream rather than playing to speakers,
  // so the script runs cleanly in headless environments.
  const pullStream = sdk.AudioOutputStream.createPullStream();
  const audioConfig = sdk.AudioConfig.fromStreamOutput(pullStream);

  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

  const events: VisemeCapture[] = [];

  synthesizer.visemeReceived = (_s, e) => {
    // Azure audio offsets are in 100-nanosecond (Hecto-nanosecond) ticks.
    const audioOffsetMs = e.audioOffset / 10_000;
    events.push({ audioOffsetMs, visemeId: e.visemeId });
    process.stdout.write(`  viseme ${String(e.visemeId).padStart(2)} @ ${audioOffsetMs.toFixed(1).padStart(8)}ms\n`);
  };

  // Optionally log word boundaries for debugging timing
  synthesizer.wordBoundary = (_s, e) => {
    const offsetMs = e.audioOffset / 10_000;
    console.log(`  [word] "${e.text}" @ ${offsetMs.toFixed(1)}ms`);
  };

  console.log('Synthesizing...');
  console.log('');

  const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
    synthesizer.speakTextAsync(
      INPUT_TEXT,
      (res) => {
        synthesizer.close();
        resolve(res);
      },
      (err) => {
        synthesizer.close();
        reject(new Error(String(err)));
      },
    );
  });

  // ── Check synthesis result ─────────────────────────────────────────────────
  if (result.reason === sdk.ResultReason.Canceled) {
    const cancellation = sdk.CancellationDetails.fromResult(result);
    console.error('');
    console.error('✗  Synthesis was cancelled.');
    console.error(`   Reason: ${sdk.CancellationReason[cancellation.reason]}`);
    if (cancellation.errorDetails) {
      console.error(`   Details: ${cancellation.errorDetails}`);
    }
    if (cancellation.reason === sdk.CancellationReason.Error) {
      console.error('   Common causes:');
      console.error('   • Invalid AZURE_SPEECH_KEY');
      console.error('   • Wrong AZURE_SPEECH_REGION (must match where account was created)');
      console.error('   • Voice not available in this region');
    }
    process.exit(3);
  }

  // audioDuration is in 100ns ticks
  const audioDurationMs = result.audioDuration
    ? result.audioDuration / 10_000
    : null;

  // ── Compute summary ────────────────────────────────────────────────────────
  const totalEvents = events.length;
  const distinctVisemeIds = [...new Set(events.map((e) => e.visemeId))].sort((a, b) => a - b);
  const firstOffsetMs = totalEvents > 0 ? (events[0]?.audioOffsetMs ?? null) : null;
  const lastOffsetMs  = totalEvents > 0 ? (events[events.length - 1]?.audioOffsetMs ?? null) : null;

  const trailingGapMs =
    lastOffsetMs !== null && audioDurationMs !== null
      ? audioDurationMs - lastOffsetMs
      : null;

  const coveragePct =
    lastOffsetMs !== null && audioDurationMs !== null && audioDurationMs > 0
      ? Math.min(100, (lastOffsetMs / audioDurationMs) * 100)
      : null;

  // ── Verdict ────────────────────────────────────────────────────────────────
  let verdict: 'PASS' | 'PARTIAL' | 'FAIL';
  let verdictReason: string;

  if (totalEvents === 0) {
    verdict = 'FAIL';
    verdictReason =
      'Zero VisemeReceived events. zh-CN viseme is NOT available from this account/region. ' +
      'The face renderer will need to use audio-envelope lip-sync fallback.';
  } else if (totalEvents < 10) {
    verdict = 'PARTIAL';
    verdictReason =
      `Only ${totalEvents} events — too few for reliable lip-sync. ` +
      'The face renderer should use audio-envelope as primary lip-sync source.';
  } else if (coveragePct !== null && coveragePct < 70) {
    verdict = 'PARTIAL';
    verdictReason =
      `${totalEvents} events but coverage is ${coveragePct.toFixed(1)}% of audio duration. ` +
      'Timing may be compressed into the first part of the audio (known zh-CN quirk). ' +
      'Consider using audio-envelope as primary and viseme as supplemental.';
  } else {
    verdict = 'PASS';
    verdictReason =
      `${totalEvents} events across ${coveragePct?.toFixed(1) ?? '?'}% of audio. ` +
      `${distinctVisemeIds.length} distinct viseme IDs. zh-CN viseme is usable for lip-sync.`;
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  const spikeResult: SpikeResult = {
    timestamp: new Date().toISOString(),
    input: INPUT_TEXT,
    voice: VOICE,
    region: SPEECH_REGION,
    events,
    audioDurationMs,
    summary: {
      totalEvents,
      distinctVisemeIds,
      firstOffsetMs,
      lastOffsetMs,
      audioDurationMs,
      trailingGapMs,
      coveragePct,
      verdict,
      verdictReason,
    },
  };

  fs.writeFileSync(RESULT_FILE, JSON.stringify(spikeResult, null, 2));

  // ── Print summary ──────────────────────────────────────────────────────────
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Results');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total viseme events   : ${totalEvents}`);
  console.log(`  Distinct viseme IDs   : [${distinctVisemeIds.join(', ')}]`);
  console.log(`  First event offset    : ${firstOffsetMs?.toFixed(1) ?? 'n/a'} ms`);
  console.log(`  Last event offset     : ${lastOffsetMs?.toFixed(1) ?? 'n/a'} ms`);
  console.log(`  Audio duration        : ${audioDurationMs?.toFixed(1) ?? 'n/a'} ms`);
  console.log(`  Trailing gap          : ${trailingGapMs?.toFixed(1) ?? 'n/a'} ms`);
  console.log(`  Coverage              : ${coveragePct?.toFixed(1) ?? 'n/a'}%`);
  console.log('');

  const VERDICT_COLOUR = verdict === 'PASS' ? '\x1b[32m' : verdict === 'PARTIAL' ? '\x1b[33m' : '\x1b[31m';
  const RESET = '\x1b[0m';
  console.log(`  Verdict: ${VERDICT_COLOUR}${verdict}${RESET}`);
  console.log(`  ${verdictReason}`);
  console.log('');
  console.log(`  Full event log → ${path.relative(process.cwd(), RESULT_FILE)}`);
  console.log('');

  // Exit code encodes verdict for CI use
  if (verdict === 'PASS')    process.exit(0);
  if (verdict === 'PARTIAL') process.exit(1);
  process.exit(2);
}

run().catch((err: unknown) => {
  console.error('');
  console.error('✗  Spike script crashed:');
  console.error('  ', err instanceof Error ? err.message : String(err));
  process.exit(3);
});
