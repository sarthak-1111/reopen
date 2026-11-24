import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_FILE_BYTES, selectFiles, skipReason } from '../../src/ui/filter';

describe('skipReason', () => {
  it.each([
    ['OLDPC/.DS_Store', 10, 'system file'],
    ['OLDPC/Thumbs.db', 10, 'system file'],
    ['OLDPC/desktop.ini', 10, 'system file'],
    ['__MACOSX/OLDPC/._MEMO.TXT', 10, 'system file'],
    ['OLDPC/._MEMO.TXT', 10, 'system file'],
    ['OLDPC/~$REPORT.DOC', 10, 'temporary file'],
    ['OLDPC/OLD.TMP', 10, 'temporary file'],
    ['OLDPC/.hidden', 10, 'hidden file'],
    ['OLDPC/EMPTY.TXT', 0, 'empty file'],
    ['OLDPC/HUGE.BIN', MAX_FILE_BYTES + 1, 'too large'],
  ])('%s → %s', (path, size, reason) => {
    expect(skipReason(path, size)).toBe(reason);
  });

  it.each(['OLDPC/REPORT.DOC', 'OLDPC/NOTEBOOK/GARDEN.QNB', 'LEDGER.DAT', 'a\\b\\MEMO1.TXT', '会計/予算.XLS'])('keeps %s', (path) => {
    expect(skipReason(path, 1234)).toBeUndefined();
  });
});

describe('selectFiles', () => {
  it('applies the file limit after skipping, in a stable natural order', () => {
    const candidates = [
      { path: 'F/file10.txt', size: 1 },
      { path: 'F/file2.txt', size: 1 },
      { path: 'F/.DS_Store', size: 1 },
      { path: 'F/file1.txt', size: 1 },
    ];
    const { keep, skipped } = selectFiles(candidates, 2);
    expect(keep.map((f) => f.path)).toEqual(['F/file1.txt', 'F/file2.txt']);
    expect(skipped).toEqual([
      { path: 'F/.DS_Store', reason: 'system file' },
      { path: 'F/file10.txt', reason: 'over the file limit' },
    ]);
  });

  it('every candidate ends up kept or skipped exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ path: fc.string({ minLength: 1, maxLength: 20 }), size: fc.nat({ max: MAX_FILE_BYTES * 2 }) }), { maxLength: 40 }),
        fc.integer({ min: 0, max: 50 }),
        (candidates, max) => {
          const { keep, skipped } = selectFiles(candidates, max);
          expect(keep.length + skipped.length).toBe(candidates.length);
          expect(keep.length).toBeLessThanOrEqual(max);
          for (const file of keep) expect(skipReason(file.path, file.size)).toBeUndefined();
        },
      ),
    );
  });
});
