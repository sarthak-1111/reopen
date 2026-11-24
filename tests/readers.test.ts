import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { detectFormat } from '../src/core/detect';
import { rescueFile } from '../src/core/rescue';
import { readRtf } from '../src/core/readers/rtf';
import { readWord97, Word97Error } from '../src/core/readers/word97';
import { readWrite, recoverTextRuns, recoverWordPerfect } from '../src/core/readers/text-recovery';
import { decodeBmp } from '../src/core/readers/bmp';
import { manifest, sampleBytes } from './helpers';

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('RTF reader', () => {
  it('handles \\u with \\uc skipping, symbols and hex escapes', () => {
    const rtf = readRtf(ascii("{\\rtf1\\ansi\\uc1 caf\\u233?\\'e9 \\endash\\~x\\par}"));
    expect(rtf.blocks).toEqual([{ type: 'paragraph', text: 'caféé – x' }]); // \~ is a non-breaking space
  });

  it('skips ignorable destinations and field instructions but keeps field results', () => {
    const rtf = readRtf(ascii('{\\rtf1{\\*\\generator Foo;}{\\field{\\*\\fldinst HYPERLINK "x"}{\\fldrslt shown}} text\\par}'));
    expect(rtf.blocks).toEqual([{ type: 'paragraph', text: 'shown text' }]);
  });

  it('joins Shift_JIS lead bytes with literal ASCII trail bytes', () => {
    // 研 = 8C A4, 修 = 8F 43 ('C'), 望 = 96 5D (']')
    const rtf = readRtf(ascii("{\\rtf1\\ansi\\ansicpg932{\\fonttbl{\\f0\\fcharset128 M;}}\\f0 \\'8c\\'a4\\'8fC\\'96]\\par}"));
    expect(rtf.blocks).toEqual([{ type: 'paragraph', text: '研修望' }]);
  });

  it('never throws on arbitrary input (property)', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 400 }), (tail) => {
      readRtf(Uint8Array.from([...ascii('{\\rtf1 '), ...tail]));
    }), { numRuns: 500 });
  });
});

describe('Word 97 reader', () => {
  const doc = sampleBytes('docs/quarterly-report-word97.doc');

  it('reports encryption instead of returning garbage', async () => {
    const CFB = (await import('../src/core/interop')).CFB;
    const container = CFB.read(doc, { type: 'buffer' });
    const entry = CFB.find(container, 'WordDocument')!;
    const content = Uint8Array.from(entry.content as ArrayLike<number>);
    content[0x0b] = content[0x0b]! | 0x01; // fEncrypted (0x0100)
    entry.content = content as never;
    const encrypted = new Uint8Array(CFB.write(container, { type: 'array' }) as number[]);
    const result = readWord97(encrypted);
    expect(result.encrypted).toBe(true);
    expect(result.text).toBe('');
    const rescued = await rescueFile('SECRET.DOC', encrypted);
    expect(rescued.conversionLevel).toBe('none');
    expect(rescued.warnings.join(' ')).toMatch(/encrypted/);
  });

  it('throws a Word97Error for a WordDocument stream that is not a FIB', () => {
    expect(() => readWord97(sampleBytes('sheets/inventory-biff8.xls'))).toThrow(Word97Error);
  });
});

describe('text recovery', () => {
  it('finds cp1252, Shift_JIS and UTF-16LE runs inside binary noise, in file order', () => {
    const sjis = Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x95, 0xb6, 0x8f, 0xcd]); // 日本語の文章
    const utf16 = new Uint8Array(Array.from('Hidden notes here', (c) => [c.charCodeAt(0), 0]).flat());
    const bytes = Uint8Array.from([
      0, 1, 2, 3, ...ascii('Visible letter text'), 0, 0xff, 0xfe, 7, ...sjis, 0, 0, 0, 0, 1, 0, ...utf16, 0, 0, 0x10,
    ]);
    const runs = recoverTextRuns(bytes);
    expect(runs.map((r) => r.text)).toEqual(['Visible letter text', '日本語の文章', 'Hidden notes here']);
    expect(runs.map((r) => r.encoding)).toEqual(['windows-1252', 'shift_jis', 'utf-16le']);
  });

  it('does not report scrambled bytes as text', () => {
    const scrambled = Uint8Array.from(ascii('Sow the beans along the south fence after the last frost.'), (b) => b ^ 0x5a);
    expect(recoverTextRuns(scrambled)).toEqual([]);
  });

  it('WordPerfect walk skips function codes', () => {
    const wp = recoverWordPerfect(sampleBytes('docs/project-status.wpd'));
    expect(wp.text).toBe('PROJECT STATUS NOTE\n\nBudget remains within the approved limits. The survey team finished early.\nNext review in June 1991.');
    expect(wp.unknownBytes).toBe(0);
  });

  it('Write reader drops binary-looking paragraphs', () => {
    const bytes = new Uint8Array(256);
    bytes.set([0x31, 0xbe, 0, 0, 0, 0xab], 0);
    const body = Uint8Array.from([...ascii('Hello there\r\n'), 1, 2, 3, 4, 5, 6, 7, 8, ...ascii('\r\nBye\r\n')]);
    bytes.set(body, 128);
    new DataView(bytes.buffer).setUint32(14, 128 + body.length, true);
    expect(readWrite(bytes)).toEqual({ paragraphs: ['Hello there', 'Bye'], droppedBinaryParagraphs: 1 });
  });
});

describe('BMP decoder', () => {
  it('decodes the 24-bit sample', () => {
    const image = decodeBmp(sampleBytes('images/pattern.bmp'));
    expect([image.width, image.height]).toEqual([16, 16]);
    // Bottom-up file: output row 0 is the last stored row (y = 15, "off"); output row 15 is stored row 0 ("on").
    expect(Array.from(image.rgba.subarray(0, 4))).toEqual([0xf7, 0xf3, 0xec, 255]);
    expect(Array.from(image.rgba.subarray(15 * 16 * 4, 15 * 16 * 4 + 4))).toEqual([0x1f, 0x6b, 0x2a, 255]);
  });

  it('decodes a 1-bit palette DIB without a file header', () => {
    const dib = new Uint8Array(40 + 8 + 4 * 2);
    const v = new DataView(dib.buffer);
    v.setUint32(0, 40, true);
    v.setInt32(4, 3, true);
    v.setInt32(8, -2, true); // top-down
    v.setUint16(12, 1, true);
    v.setUint16(14, 1, true);
    dib.set([0, 0, 0, 0, 255, 255, 255, 0], 40); // palette: black, white
    dib.set([0b10100000, 0, 0, 0, 0b01000000, 0, 0, 0], 48);
    const image = decodeBmp(dib);
    const px = (x: number, y: number) => image.rgba[(y * 3 + x) * 4];
    expect([px(0, 0), px(1, 0), px(2, 0), px(0, 1), px(1, 1), px(2, 1)]).toEqual([255, 0, 255, 0, 255, 0]);
  });
});

describe('robustness', () => {
  it('detectFormat never throws on random bytes (property)', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) => {
      detectFormat(bytes);
    }), { numRuns: 2000 });
  });

  it('detectFormat and rescueFile never throw on truncated or corrupted samples', async () => {
    const random = fc.sample(fc.tuple(fc.nat(), fc.nat(), fc.integer({ min: 0, max: 255 })), { numRuns: 400, seed: 42 });
    const samples = manifest().filter((s) => !s.copyOf);
    for (const [k, [sampleIndex, position, value]] of random.entries()) {
      const sample = samples[sampleIndex % samples.length]!;
      const original = sampleBytes(sample.path);
      const bytes = k % 2 === 0 ? original.slice(0, position % (original.length + 1)) : original.slice();
      if (k % 2 === 1) bytes[position % bytes.length] = value;
      detectFormat(bytes, sample.path);
      const result = await rescueFile(sample.path, bytes);
      expect(result.source.size).toBe(bytes.length);
    }
  });

  it('rescueFile never throws on random bytes (property)', async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 1024 }), async (bytes) => {
      await rescueFile('random.bin', bytes);
    }), { numRuns: 300 });
  });
});
