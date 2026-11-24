import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'node:module';
import { EncodingJapanese } from '../src/core/interop';
import { decodeText, detectEncoding, encodeEbcdic, decodeEbcdic, normaliseNewlines } from '../src/core/encoding';
import { EBCDIC_CODE_PAGES, EBCDIC_TABLES } from '../src/core/ebcdic-tables';
import { ENGLISH, JAPANESE, LATIN, makeText, rng } from './corpus';

const cptable = createRequire(import.meta.url)('codepage') as { utils: { encode(cp: number, text: string): ArrayLike<number> } };

const toSjis = (text: string): Uint8Array =>
  Uint8Array.from(EncodingJapanese.convert(EncodingJapanese.stringToCode(text), { to: 'SJIS', from: 'UNICODE' }) as number[]);
const toEucJp = (text: string): Uint8Array =>
  Uint8Array.from(EncodingJapanese.convert(EncodingJapanese.stringToCode(text), { to: 'EUCJP', from: 'UNICODE' }) as number[]);
const toCp1252 = (text: string): Uint8Array => Uint8Array.from(cptable.utils.encode(1252, text));

const japaneseChar = fc.constantFrom(...Array.from(new Set(JAPANESE.join(''))));
const latinChar = fc.constantFrom(...Array.from(new Set(LATIN.join(''))));

describe('decoding with a known encoding is exact (round trip)', () => {
  it('Shift_JIS', () => {
    fc.assert(fc.property(fc.array(japaneseChar, { minLength: 1, maxLength: 200 }), (chars) => {
      const text = chars.join('');
      expect(decodeText(toSjis(text), 'shift_jis')).toBe(text);
    }));
  });

  it('EUC-JP', () => {
    fc.assert(fc.property(fc.array(japaneseChar, { minLength: 1, maxLength: 200 }), (chars) => {
      const text = chars.join('');
      expect(decodeText(toEucJp(text), 'euc-jp')).toBe(text);
    }));
  });

  it('Windows-1252', () => {
    fc.assert(fc.property(fc.array(latinChar, { minLength: 1, maxLength: 200 }), (chars) => {
      const text = chars.join('');
      expect(decodeText(toCp1252(text), 'windows-1252')).toBe(text);
    }));
  });

  for (const cp of EBCDIC_CODE_PAGES) {
    it(`EBCDIC ${cp} (${EBCDIC_TABLES[cp]!.label}): every mapped byte round-trips`, () => {
      const table = EBCDIC_TABLES[cp]!.table;
      const mappable = Array.from(table).filter((ch, byte) => ch !== '�' && byte >= 0x40 && ch !== '\u0085');
      fc.assert(fc.property(fc.array(fc.constantFrom(...mappable), { minLength: 1, maxLength: 200 }), (chars) => {
        const text = chars.join('');
        const bytes = encodeEbcdic(text, cp);
        expect(bytes.length).toBe(chars.length);
        expect(decodeEbcdic(bytes, cp)).toBe(text);
      }));
    });
  }

  it('EBCDIC newlines: \\n is written as NEL and read back as \\n', () => {
    const bytes = encodeEbcdic('A\nB', 37);
    expect(Array.from(bytes)).toEqual([0xc1, 0x15, 0xc2]);
    expect(decodeEbcdic(bytes, 37)).toBe('A\nB');
  });
});

/**
 * Auto-detection accuracy on generated texts. A detection counts as correct when the text
 * decoded with the detected encoding equals the original exactly. Results are printed so the
 * numbers in the docs come from this run, not from memory.
 */
describe('automatic encoding detection accuracy', () => {
  const SAMPLES_PER_CASE = 60;
  const cases: { name: string; sentences: readonly string[]; encode: (t: string) => Uint8Array; decodeAs?: string }[] = [
    { name: 'Shift_JIS', sentences: JAPANESE, encode: toSjis },
    { name: 'EUC-JP', sentences: JAPANESE, encode: toEucJp },
    { name: 'Windows-1252', sentences: LATIN, encode: toCp1252 },
    ...EBCDIC_CODE_PAGES.filter((cp) => cp !== 875).map((cp) => ({
      name: `EBCDIC ${cp}`,
      sentences: ENGLISH,
      encode: (t: string) => encodeEbcdic(t.replace(/\r\n/g, '\n'), cp),
    })),
  ];
  const lengths = [20, 60, 200, 1000];
  const results: Record<string, Record<string, string>> = {};
  const accuracy = new Map<string, number>();

  for (const c of cases) {
    for (const minChars of lengths) {
      it(`${c.name}, texts of ≥${minChars} characters`, () => {
        const random = rng(minChars * 7919 + c.name.length);
        let correct = 0;
        const wrong = new Map<string, number>();
        for (let k = 0; k < SAMPLES_PER_CASE; k++) {
          const original = makeText(c.sentences, minChars, random);
          const bytes = c.encode(original);
          const detected = detectEncoding(bytes);
          const decoded = normaliseNewlines(decodeText(bytes, detected.encoding));
          if (decoded === normaliseNewlines(original)) correct++;
          else wrong.set(detected.encoding, (wrong.get(detected.encoding) ?? 0) + 1);
        }
        const share = correct / SAMPLES_PER_CASE;
        accuracy.set(`${c.name}|${minChars}`, share);
        (results[c.name] ??= {})[`≥${minChars} chars`] =
          `${Math.round(share * 100)}%${wrong.size ? ` (wrong: ${[...wrong].map(([e, n]) => `${e}×${n}`).join(', ')})` : ''}`;
        // Honest thresholds, set from measured results: short texts are genuinely ambiguous.
        if (minChars >= 60) expect(share).toBeGreaterThanOrEqual(0.95);
      });
    }
  }

  it('prints the accuracy table', () => {
    console.log('\nEncoding auto-detection accuracy (exact decode, 60 generated texts per cell):');
    console.table(results);
    expect(accuracy.size).toBe(cases.length * lengths.length);
  });
});
