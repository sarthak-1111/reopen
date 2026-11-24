import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { findDate, MAX_NAME_CHARS, proposeName, sanitiseFileName, uniqueName } from '../src/core/naming';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

describe('sanitiseFileName', () => {
  it('always returns a safe, non-empty name (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (raw) => {
        const name = sanitiseFileName(raw);
        expect(name.length).toBeGreaterThan(0);
        expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001F\u007F]/);
        expect(name).not.toMatch(/[. ]$/);
        expect(name).not.toMatch(/^[. ]/);
        expect(RESERVED.test(name)).toBe(false);
        expect(Array.from(name).length).toBeLessThanOrEqual(MAX_NAME_CHARS + 1);
        expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(201);
      }),
      { numRuns: 1000 },
    );
  });

  it('is idempotent (property)', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (raw) => {
      const once = sanitiseFileName(raw);
      expect(sanitiseFileName(once)).toBe(once);
    }), { numRuns: 1000 });
  });

  it('handles reserved Windows names and empty input', () => {
    expect(sanitiseFileName('CON')).toBe('_CON');
    expect(sanitiseFileName('lpt1.txt')).toBe('_lpt1.txt');
    expect(sanitiseFileName('...')).toBe('untitled');
    expect(sanitiseFileName('a/b:c*d?')).toBe('a b c d');
  });
});

describe('uniqueName', () => {
  it('never hands out the same name twice, case-insensitively (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('Report', 'report', 'REPORT', 'Notes', 'notes (2)'), { maxLength: 30 }), (bases) => {
        const taken = new Set<string>();
        const names = bases.map((b) => uniqueName(b, '.docx', taken).toLowerCase());
        expect(new Set(names).size).toBe(names.length);
      }),
    );
  });

  it('numbers duplicates as " (2)", " (3)"', () => {
    const taken = new Set<string>();
    expect([uniqueName('Memo', 'txt', taken), uniqueName('Memo', 'txt', taken), uniqueName('memo', 'txt', taken)]).toEqual([
      'Memo',
      'Memo (2)',
      'memo (3)',
    ]);
  });
});

describe('findDate and proposeName', () => {
  it.each([
    ['Meeting on 1994-03-02', '1994-03-02'],
    ['1994年3月2日', '1994-03-02'],
    ['held on 14 June 1992 in the hall', '1992-06-14'],
    ['Paris, le 12 mai 1996', undefined], // French month names are not parsed
    ['March 5th, 1987', '1987-03-05'],
    ['1999-02-30 is not a date', undefined],
  ])('%s → %s', (text, expected) => {
    expect(findDate(text)).toBe(expected);
  });

  it('uses the title, then the first meaningful line, then the original name', () => {
    expect(proposeName({ title: 'Garden club minutes', text: 'held on 14 June 1992', originalName: 'MINUTES.RTF' })).toBe(
      '1992-06-14 Garden club minutes',
    );
    expect(proposeName({ text: '\n\n--\nQuarterly report\nmore', originalName: 'REPORT.DOC' })).toBe('Quarterly report');
    expect(proposeName({ originalName: 'OLDPC/NOTES/LETTER1.WRI' })).toBe('LETTER1');
  });
});
