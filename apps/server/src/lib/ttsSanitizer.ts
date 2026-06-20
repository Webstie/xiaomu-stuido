/**
 * ttsSanitizer — converts raw LLM text to valid Azure SSML.
 *
 * Processing order:
 *  1. Strip code fences
 *  2. Wrap paired quote spans in <emphasis level="moderate">
 *  3. Strip remaining standalone quote chars
 *  4. Strip inline markdown
 *  5. Strip emoji (default) or expand (expandEmoji:true)
 *  6. XML-escape & < > in text segments (not in already-injected SSML tags)
 *  7. Wrap digit runs (in text segments) in <say-as interpret-as="cardinal">
 *  8. Insert <break time="100ms"/> after Mandarin sentence-ending punctuation
 *  9. Optional <prosody> wrapper if opts.rate or opts.pitch provided
 * 10. Wrap in full <speak> envelope
 *
 * IMPORTANT: Quote-wrapping (step 2) and stripping (step 3) happen BEFORE
 * XML-escaping so that injected SSML attribute quotes are never caught by
 * the strip pass. XML-escaping is then applied only to text-node content
 * by splitting on SSML tags and escaping the text segments.
 */

export interface SanitizeOptions {
  voice?: string;
  lang?: string;
  style?: string;
  expandEmoji?: boolean;
  rate?: string;
  pitch?: string;
}

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoMultilingualNeural';
const DEFAULT_LANG = 'zh-CN';
const DEFAULT_STYLE = 'cheerful';

/**
 * Basic emoji-to-Mandarin label map for common pictographics.
 * Used when expandEmoji is true.
 */
const EMOJI_LABELS: Record<string, string> = {
  '😊': '微笑',
  '😄': '大笑',
  '😢': '哭泣',
  '❤️': '爱心',
  '👍': '很好',
  '🌟': '星星',
  '🎵': '音乐',
  '🎶': '音符',
};

/** Per-digit Mandarin readings used for phone numbers / long codes. */
const DIGIT_HANZI: Record<string, string> = {
  '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};
function digitsToHanzi(digits: string): string {
  let out = '';
  for (const c of digits) out += DIGIT_HANZI[c] ?? c;
  return out;
}

/**
 * XML-escape a plain text segment (no tags).
 * Only escapes &, <, > — attributes are not in scope here.
 */
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Process text segments between injected SSML tags:
 * XML-escape, wrap digits, insert breaks after Mandarin punctuation.
 *
 * The input is a mixed string of text + already-injected SSML markup.
 * We split on SSML tags, process text nodes, then reassemble.
 */
function processTextSegments(mixed: string): string {
  // Split on SSML tags (keep delimiters)
  const parts = mixed.split(/(<[^>]+>)/);
  return parts
    .map((part) => {
      if (part.startsWith('<')) {
        // SSML tag — pass through untouched
        return part;
      }
      // Text segment: XML-escape, then wrap digits, then add breaks
      let t = xmlEscape(part);
      // Wrap digit runs. Three cases handled in ONE sweep so the inner
      // SSML markup we emit can't get re-matched by a follow-up pass:
      //   1. Phone-shape (digit groups joined by - or .)        → spell out hanzi
      //      e.g. "400-161-9995" → "四零零 一六一 九九九五"
      //   2. Bare run of 5+ digits (hotline, postcode, ID-like) → spell out hanzi
      //      e.g. "12355" → "一二三五五" (not "twelve thousand three hundred…")
      //   3. Short run (1–4 digits)                             → cardinal SSML
      //      e.g. "7" / "100" → "七" / "一百"
      //
      // Reason for cases 1 & 2 not using <say-as interpret-as="digits">:
      // the zh-CN multilingual voices observably ignore that hint and still
      // read "400" as 四百. Replacing the literal characters bypasses the
      // ambiguity — TTS has nothing left to interpret.
      t = t.replace(/\d+(?:[-.]\d+)+|\d+/g, (match) => {
        if (/[-.]/.test(match)) {
          return match
            .split(/([-.])/)
            .map((p) => (/^\d+$/.test(p) ? digitsToHanzi(p) : ' '))
            .join('');
        }
        if (match.length >= 5) {
          return digitsToHanzi(match);
        }
        return `<say-as interpret-as="cardinal">${match}</say-as>`;
      });
      // Insert break after Mandarin sentence-ending punctuation
      t = t.replace(/([。！？…])/g, '$1<break time="100ms"/>');
      return t;
    })
    .join('');
}

export function sanitize(rawText: string, opts?: SanitizeOptions): string {
  const voice = opts?.voice ?? DEFAULT_VOICE;
  const lang = opts?.lang ?? DEFAULT_LANG;
  const style = opts?.style ?? DEFAULT_STYLE;
  const expandEmoji = opts?.expandEmoji ?? false;
  const rate = opts?.rate;
  const pitch = opts?.pitch;

  let t = rawText;

  // ── Step 1: Strip code fences (``` ... ```) ────────────────────────────────
  t = t.replace(/```[\s\S]*?```/g, '');

  // ── Step 2: Wrap paired quote spans in <emphasis level="moderate"> ─────────
  // Order: longest / most specific patterns first.
  // NOTE: This runs BEFORE XML-escaping so that the injected attribute quotes
  // are never touched by the strip-quotes pass below.
  //
  // IMPORTANT: Unicode quote pairs (curly/corner/guillemet) are applied globally
  // on the full text first. Then ASCII quote pairs are applied only in text
  // segments (splitting on already-injected SSML tags) to avoid matching
  // attribute values like level="moderate".

  // Unicode pairs — safe to apply globally (they only appear in user text)
  // 「...」 corner brackets (Japanese/Chinese)
  t = t.replace(/\u300c([^\u300c\u300d]*)\u300d/g, '<emphasis level="moderate">$1</emphasis>');
  // 『...』 white corner brackets
  t = t.replace(/\u300e([^\u300e\u300f]*)\u300f/g, '<emphasis level="moderate">$1</emphasis>');
  // «...» guillemets
  t = t.replace(/\u00ab([^\u00ab\u00bb]*)\u00bb/g, '<emphasis level="moderate">$1</emphasis>');
  // \u201c...\u201d curly double quotes "..."
  t = t.replace(/\u201c([^\u201c\u201d]*)\u201d/g, '<emphasis level="moderate">$1</emphasis>');
  // \u2018...\u2019 curly single quotes '...'
  t = t.replace(/\u2018([^\u2018\u2019]*)\u2019/g, '<emphasis level="moderate">$1</emphasis>');

  // ASCII "..." and '...' — apply only in text segments to avoid matching
  // attribute quotes in already-injected SSML (e.g. level="moderate")
  {
    const parts = t.split(/(<[^>]+>)/);
    t = parts
      .map((part) => {
        if (part.startsWith('<')) return part; // SSML tag — skip
        let s = part;
        // ASCII "..." double quotes
        s = s.replace(/"([^"]*)"/g, '<emphasis level="moderate">$1</emphasis>');
        // ASCII '...' single quotes
        s = s.replace(/'([^']*)'/g, '<emphasis level="moderate">$1</emphasis>');
        return s;
      })
      .join('');
  }

  // ── Step 3: Strip remaining standalone quote chars ─────────────────────────
  // Only strip in text segments — split on tags so we never touch SSML markup
  {
    const parts = t.split(/(<[^>]+>)/);
    t = parts
      .map((part) => {
        if (part.startsWith('<')) return part; // SSML tag, untouched
        return part.replace(/["\u2018\u2019\u201c\u201d\u00ab\u00bb\u300c\u300d\u300e\u300f]/g, '');
      })
      .join('');
  }

  // ── Step 4: Strip inline markdown (text segments only) ───────────────────
  {
    const parts = t.split(/(<[^>]+>)/);
    t = parts
      .map((part) => {
        if (part.startsWith('<')) return part;
        let s = part;
        // **bold** or __bold__
        s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
        s = s.replace(/__([^_]+)__/g, '$1');
        // *italic* or _italic_
        s = s.replace(/\*([^*]+)\*/g, '$1');
        s = s.replace(/_([^_]+)_/g, '$1');
        // `inline code`
        s = s.replace(/`([^`]*)`/g, '$1');
        // Strip bare * _ ` characters
        s = s.replace(/[*_`]/g, '');
        return s;
      })
      .join('');
  }

  // ── Step 5: Emoji handling (text segments only) ──────────────────────────
  {
    const parts = t.split(/(<[^>]+>)/);
    t = parts
      .map((part) => {
        if (part.startsWith('<')) return part;
        if (expandEmoji) {
          return part.replace(/\p{Extended_Pictographic}/gu, (emoji) => {
            return EMOJI_LABELS[emoji] ?? '';
          });
        }
        return part.replace(/\p{Extended_Pictographic}/gu, '');
      })
      .join('');
  }

  // ── Steps 6–8: XML-escape text segments, wrap digits, add breaks ──────────
  t = processTextSegments(t);

  // ── Step 9: Optional prosody wrapper ──────────────────────────────────────
  let inner = t;
  if (rate !== undefined || pitch !== undefined) {
    const attrs: string[] = [];
    if (rate !== undefined) attrs.push(`rate="${rate}"`);
    if (pitch !== undefined) attrs.push(`pitch="${pitch}"`);
    inner = `<prosody ${attrs.join(' ')}>${t}</prosody>`;
  }

  // ── Step 10: Full <speak> envelope ────────────────────────────────────────
  const ssml = [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"`,
    ` xmlns:mstts="http://www.w3.org/2001/mstts"`,
    ` xml:lang="${lang}">`,
    `<voice name="${voice}">`,
    `<mstts:express-as style="${style}">`,
    inner,
    `</mstts:express-as>`,
    `</voice>`,
    `</speak>`,
  ].join('');

  return ssml;
}
