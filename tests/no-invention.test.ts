import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkNoInvention, enforceNoInvention, tokenize } from '../src/core/no-invention';
import { ENGLISH, JAPANESE, LATIN } from './corpus';

const sourceText = fc.constantFrom(...ENGLISH, ...LATIN, ...JAPANESE, ENGLISH.join('\n'), JAPANESE.join(''));

/** Allowed edits: reorder, drop, change case, change punctuation and whitespace. */
const allowedRewrite = (source: string) =>
  fc
    .record({
      order: fc.array(fc.nat(), { minLength: tokenize(source).length, maxLength: tokenize(source).length }),
      keep: fc.array(fc.boolean(), { minLength: tokenize(source).length, maxLength: tokenize(source).length }),
      upper: fc.boolean(),
      separator: fc.constantFrom(' ', '\n\n', ', ', ' — ', '。', ' * ', '# '),
    })
    .map(({ order, keep, upper, separator }) => {
      const tokens = tokenize(source)
        .map((t, k) => ({ t, k: order[k]! }))
        .filter((_, k) => keep[k])
        .sort((a, b) => a.k - b.k)
        .map(({ t }) => (upper ? t.toUpperCase() : t));
      return tokens.join(separator);
    });

describe('no-invention rule', () => {
  it('accepts any reordering, deletion, case change or punctuation change of the source', () => {
    fc.assert(
      fc.property(sourceText.chain((source) => fc.tuple(fc.constant(source), allowedRewrite(source))), ([source, output]) => {
        expect(checkNoInvention(source, output)).toEqual({ ok: true, inventedTokens: [] });
      }),
      { numRuns: 300 },
    );
  });

  it('rejects any output that adds a word not in the source', () => {
    const newWord = fc.stringMatching(/^[a-z]{3,10}$/).filter((w) => !ENGLISH.join(' ').toLowerCase().includes(w));
    fc.assert(
      fc.property(fc.constantFrom(...ENGLISH), newWord, fc.nat(), (source, word, at) => {
        const tokens = tokenize(source);
        const position = at % (tokens.length + 1);
        const output = [...tokens.slice(0, position), word, ...tokens.slice(position)].join(' ');
        const result = checkNoInvention(source, output);
        expect(result.ok).toBe(false);
        expect(result.inventedTokens).toContain(word);
      }),
      { numRuns: 300 },
    );
  });

  it('rejects repeating a source word more often than the source does (multiset)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ENGLISH, ...JAPANESE), fc.nat(), (source, pick) => {
        const tokens = tokenize(source);
        const repeated = tokens[pick % tokens.length]!;
        const count = tokens.filter((t) => t === repeated).length;
        const output = `${source} ${Array(count).fill(repeated).join(' ')}`;
        expect(checkNoInvention(source, output).ok).toBe(false);
      }),
    );
  });

  it('treats each kanji/kana as a token, so a new Japanese character is caught', () => {
    const source = '本日の会議は午後二時から行います。';
    expect(checkNoInvention(source, '会議は午後二時から本日行います').ok).toBe(true);
    const invented = checkNoInvention(source, '本日の会議は午後三時から行います。');
    expect(invented.ok).toBe(false);
    expect(invented.inventedTokens).toEqual(['三']);
  });

  it('normalises width and case (NFKC) but not spelling', () => {
    expect(checkNoInvention('ＡＢＣ ﾃﾞｰﾀ 2024', 'abc データ ２０２４').ok).toBe(true);
    expect(checkNoInvention('colour', 'color').ok).toBe(false);
    expect(checkNoInvention('im großen Saal', 'IM GROSSEN SAAL').ok).toBe(true); // found by the property test
  });

  it('allows rejoining a word split by a line-end hyphen', () => {
    expect(checkNoInvention('The text was recov-\nered from disk.', 'The text was recovered from disk.').ok).toBe(true);
    expect(checkNoInvention('The text was recov-\nered from disk.', 'The text was recovered recovered from disk.').ok).toBe(false);
  });

  it('enforceNoInvention returns the raw source, labelled, when the rule fails', () => {
    const source = 'Budget remains within limits.';
    expect(enforceNoInvention(source, 'Budget remains within limits')).toMatchObject({ mode: 'ai-reconstructed' });
    const fallback = enforceNoInvention(source, 'The budget remains comfortably within limits.');
    expect(fallback.mode).toBe('raw-fallback');
    expect(fallback.text).toBe(source);
    expect(fallback.inventedTokens).toEqual(['the', 'comfortably']);
  });

  it('fallback output always passes the rule (property)', () => {
    fc.assert(
      fc.property(sourceText, fc.string(), (source, aiOutput) => {
        const enforced = enforceNoInvention(source, aiOutput);
        expect(checkNoInvention(source, enforced.text).ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
