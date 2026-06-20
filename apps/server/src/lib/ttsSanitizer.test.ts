/**
 * ttsSanitizer unit tests
 */
import { describe, it, expect } from 'vitest';
import { sanitize } from './ttsSanitizer.js';

// ── XML well-formedness helper ─────────────────────────────────────────────

interface WellFormResult {
  ok: boolean;
  reason?: string;
}

function isWellFormedXml(xml: string): WellFormResult {
  // Strip XML declaration (<?xml ...?>) and processing instructions
  const cleaned = xml.replace(/<\?[^>]*\?>/g, '');

  // Regex to match tags: opening, closing, or self-closing
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:._-]*)([^>]*)>/g;
  const stack: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(cleaned)) !== null) {
    const full = match[0]!;
    const name = match[1]!;
    const attrs = match[2]!;

    // Self-closing tag — no stack effect
    if (attrs.trimEnd().endsWith('/') || full.endsWith('/>')) {
      continue;
    }

    // Closing tag
    if (full.startsWith('</')) {
      if (stack.length === 0) {
        return { ok: false, reason: `Unexpected closing tag </${name}> with empty stack` };
      }
      const top = stack[stack.length - 1];
      if (top !== name) {
        return { ok: false, reason: `Closing tag </${name}> does not match opening <${top}>` };
      }
      stack.pop();
      continue;
    }

    // Opening tag
    stack.push(name);
  }

  if (stack.length !== 0) {
    return { ok: false, reason: `Unclosed tags: ${stack.join(', ')}` };
  }

  return { ok: true };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ttsSanitizer', () => {
  // ── Quote handling ───────────────────────────────────────────────────────

  it('curly double quotes → emphasis, no raw \u201c/\u201d in output', () => {
    const ssml = sanitize('\u201c你好\u201d');
    expect(ssml).toContain('<emphasis level="moderate">你好</emphasis>');
    expect(ssml).not.toContain('\u201c');
    expect(ssml).not.toContain('\u201d');
  });

  it('ASCII double quotes → emphasis, no bare quote in text content', () => {
    const ssml = sanitize('"hello"');
    expect(ssml).toContain('<emphasis level="moderate">hello</emphasis>');
    // Strip all SSML tags and check no bare " remains
    const text = ssml.replace(/<[^>]+>/g, '');
    expect(text).not.toContain('"');
  });

  it('corner bracket quotes 「...」 → emphasis', () => {
    const ssml = sanitize('小沐说\u300c我们一起呼吸吧\u300d');
    expect(ssml).toContain('<emphasis level="moderate">我们一起呼吸吧</emphasis>');
  });

  it('guillemets «...» → emphasis', () => {
    const ssml = sanitize('\u00ab我们\u00bb');
    expect(ssml).toContain('<emphasis level="moderate">我们</emphasis>');
  });

  // ── Markdown stripping ───────────────────────────────────────────────────

  it('**bold** → text only, no * in content', () => {
    const ssml = sanitize('**好朋友**');
    const text = ssml.replace(/<[^>]+>/g, '');
    expect(text).toContain('好朋友');
    expect(text).not.toContain('*');
  });

  it('*italic* → text only', () => {
    const ssml = sanitize('*轻轻地*');
    const text = ssml.replace(/<[^>]+>/g, '');
    expect(text).toContain('轻轻地');
    expect(text).not.toContain('*');
  });

  it('inline `code` → text only', () => {
    const ssml = sanitize('按下`确认`键');
    const text = ssml.replace(/<[^>]+>/g, '');
    expect(text).toContain('确认');
    expect(text).not.toContain('`');
  });

  it('code fence stripped entirely', () => {
    const raw = '请看：\n```python\nprint("hello")\n```\n继续';
    const ssml = sanitize(raw);
    const text = ssml.replace(/<[^>]+>/g, '');
    expect(text).not.toContain('python');
    expect(text).not.toContain('print');
    expect(text).toContain('继续');
  });

  // ── Digit wrapping ────────────────────────────────────────────────────────

  it('bare digit → say-as cardinal', () => {
    const ssml = sanitize('我有7个朋友');
    expect(ssml).toContain('<say-as interpret-as="cardinal">7</say-as>');
  });

  it('multi-digit → say-as cardinal', () => {
    const ssml = sanitize('共100人');
    expect(ssml).toContain('<say-as interpret-as="cardinal">100</say-as>');
  });

  it('5+ digit run → spelled out hanzi (hotline / postcode)', () => {
    const ssml = sanitize('热线12355');
    expect(ssml).toContain('一二三五五');
    // No cardinal/digits SSML for the long run — we bypass say-as entirely
    expect(ssml).not.toContain('<say-as interpret-as="cardinal">12355</say-as>');
    expect(ssml).not.toContain('<say-as interpret-as="digits">12355</say-as>');
  });

  it('hyphenated phone → per-group hanzi', () => {
    const ssml = sanitize('打 400-161-9995');
    expect(ssml).toContain('四零零');
    expect(ssml).toContain('一六一');
    expect(ssml).toContain('九九九五');
    // No leftover cardinal wrap for any phone segment
    expect(ssml).not.toContain('<say-as interpret-as="cardinal">400</say-as>');
    expect(ssml).not.toContain('<say-as interpret-as="cardinal">161</say-as>');
  });

  // ── Mixed input ───────────────────────────────────────────────────────────

  it('mixed: quote + digit → emphasis + say-as, well-formed XML', () => {
    const ssml = sanitize('\u5c0f\u6c90\u8bf4\u201c\u6211\u4eec\u4e00\u8d77\u547c\u5438\u5427\u201d\uff0c\u516b3\u6b21');
    expect(ssml).toContain('<emphasis level="moderate">');
    expect(ssml).toContain('<say-as interpret-as="cardinal">3</say-as>');
    const result = isWellFormedXml(ssml);
    expect(result.ok, result.reason).toBe(true);
  });

  // ── SSML structure ────────────────────────────────────────────────────────

  it('output is well-formed XML', () => {
    const ssml = sanitize('你好，小朋友！');
    const result = isWellFormedXml(ssml);
    expect(result.ok, result.reason).toBe(true);
  });

  it('starts with <speak version="1.0"', () => {
    const ssml = sanitize('你好');
    expect(ssml.startsWith('<speak version="1.0"')).toBe(true);
  });

  it('ends with </speak>', () => {
    const ssml = sanitize('你好');
    expect(ssml.endsWith('</speak>')).toBe(true);
  });

  it('contains default voice name', () => {
    const ssml = sanitize('你好');
    expect(ssml).toContain('<voice name="zh-CN-XiaoxiaoMultilingualNeural">');
  });

  it('default style → mstts:express-as style="cheerful"', () => {
    const ssml = sanitize('你好');
    expect(ssml).toContain('<mstts:express-as style="cheerful">');
  });

  // ── Style overrides ───────────────────────────────────────────────────────

  const styles = ['gentle', 'whispering', 'excited', 'empathetic'] as const;
  for (const s of styles) {
    it(`style=${s} → valid mstts:express-as + well-formed XML`, () => {
      const ssml = sanitize('你好', { style: s });
      expect(ssml).toContain(`<mstts:express-as style="${s}">`);
      const result = isWellFormedXml(ssml);
      expect(result.ok, result.reason).toBe(true);
    });
  }

  // ── Break insertion ───────────────────────────────────────────────────────

  it('<break time="100ms"/> after 。', () => {
    const ssml = sanitize('你好。再见');
    expect(ssml).toContain('。<break time="100ms"/>');
  });

  it('<break time="100ms"/> after ！', () => {
    const ssml = sanitize('太棒了！');
    expect(ssml).toContain('！<break time="100ms"/>');
  });

  // ── XML escaping ──────────────────────────────────────────────────────────

  it('& in text → &amp; in output', () => {
    const ssml = sanitize('a&b');
    expect(ssml).toContain('&amp;');
  });

  it('< in text → &lt; in output', () => {
    const ssml = sanitize('x<y');
    expect(ssml).toContain('&lt;');
  });

  // ── Voice override ────────────────────────────────────────────────────────

  it('voice override appears in output', () => {
    const ssml = sanitize('你好', { voice: 'zh-CN-YunxiNeural' });
    expect(ssml).toContain('<voice name="zh-CN-YunxiNeural">');
  });
});
