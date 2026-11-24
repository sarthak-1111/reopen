import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { unzipSync, zipSync } from 'fflate';
import { safeRelativePath, unzipFolder, zipFiles } from '../src/core/package';
import { buildCatalogueHtml, buildRescueReport, type CatalogueEntry } from '../src/core/catalogue';
import { rescueFile } from '../src/core/rescue';
import { sampleBytes } from './helpers';

describe('zip packaging', () => {
  it('is deterministic and round-trips', () => {
    const files = [
      { path: 'rescued/a.txt', bytes: new TextEncoder().encode('hello') },
      { path: 'rescued/日本語.md', bytes: new TextEncoder().encode('# 見出し') },
    ];
    const first = zipFiles(files);
    expect(zipFiles(files)).toEqual(first);
    const back = unzipSync(first);
    expect(new TextDecoder().decode(back['rescued/日本語.md'])).toBe('# 見出し');
  });

  it('rejects unsafe output paths', () => {
    expect(() => zipFiles([{ path: '../escape.txt', bytes: new Uint8Array() }])).toThrow();
    expect(safeRelativePath('/etc/passwd')).toBeUndefined();
    expect(safeRelativePath('C:/Windows/x')).toBeUndefined();
    expect(safeRelativePath('a\\b\\..\\c')).toBeUndefined();
    expect(safeRelativePath('./a//b')).toBe('a/b');
  });

  it('safeRelativePath never returns a path that climbs out (property)', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('a', '..', '.', '', 'b c', 'C:', '/', '\\'), { maxLength: 8 }).map((p) => p.join('/')), (path) => {
      const safe = safeRelativePath(path);
      if (safe !== undefined) {
        expect(safe.split('/')).not.toContain('..');
        expect(safe.startsWith('/')).toBe(false);
      }
    }));
  });

  it('unzips an uploaded folder, skipping zip-slip entries and enforcing limits', () => {
    const evil = zipSync({
      'ok/one.txt': new TextEncoder().encode('1'),
      '../evil.txt': new TextEncoder().encode('x'),
      'ok/two.txt': new TextEncoder().encode('22'),
    });
    const { files, skipped } = unzipFolder(evil);
    expect(files.map((f) => f.path)).toEqual(['ok/one.txt', 'ok/two.txt']);
    expect(skipped).toEqual(['../evil.txt (unsafe path)']);
    const limited = unzipFolder(evil, { maxEntries: 1, maxTotalBytes: 100 });
    expect(limited.files).toHaveLength(1);
    expect(limited.skipped.some((s) => s.includes('too many files'))).toBe(true);
  });

  it('unzips the sample old-folder.zip', () => {
    const { files, skipped } = unzipFolder(sampleBytes('old-folder.zip'));
    expect(skipped).toEqual([]);
    expect(files.map((f) => f.path)).toContain('OLDPC/NOTEBOOK/GARDEN.QNB');
    expect(files).toHaveLength(15);
  });
});

describe('catalogue', () => {
  const entry = (over: Partial<CatalogueEntry>): CatalogueEntry => ({
    originalPath: 'OLD/A.DOC',
    newName: 'A',
    format: 'word-97-doc',
    evidence: ['FIB'],
    conversionLevel: 'text-and-paragraphs',
    outputs: [{ path: 'rescued/A.docx', mime: 'x' }],
    warnings: [],
    ...over,
  });
  const meta = { title: 'Rescue', createdAt: '2026-11-24', filesProcessedOnDevice: 2, cloudCalls: 0 };

  it('escapes every user-controlled string and contains no scripts', () => {
    const html = buildCatalogueHtml(
      [entry({ newName: '<script>alert(1)</script>', originalPath: '"><img src=x onerror=1>', summary: '<b>x</b>' })],
      meta,
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('report counts conversion levels', () => {
    const report = buildRescueReport([entry({}), entry({ conversionLevel: 'none', outputs: [] })], meta);
    expect(report).toContain('- Text and paragraphs (no formatting): 1');
    expect(report).toContain('- Not converted: 1');
    expect(report).toContain('Cloud calls: 0');
  });

  it('builds a catalogue for the whole sample folder', async () => {
    const { files } = unzipFolder(sampleBytes('old-folder.zip'));
    const taken = new Set<string>();
    const entries: CatalogueEntry[] = [];
    for (const file of files) {
      const r = await rescueFile(file.path, file.bytes, { takenNames: taken });
      entries.push({
        originalPath: file.path,
        newName: r.proposedName,
        format: r.detected.format,
        evidence: r.detected.evidence,
        ...(r.encoding ? { encoding: r.encoding.encoding } : {}),
        conversionLevel: r.conversionLevel,
        outputs: r.outputs.map((o) => ({ path: `rescued/${o.name}`, mime: o.mime })),
        warnings: r.warnings,
        aiSource: null,
      });
    }
    const names = entries.map((e) => e.newName.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const html = buildCatalogueHtml(entries, { ...meta, filesProcessedOnDevice: entries.length });
    expect(html).toContain('Stationery inventory');
    const allOutputs = entries.flatMap((e) => e.outputs.map((o) => o.path));
    expect(new Set(allOutputs).size).toBe(allOutputs.length);
  });
});
