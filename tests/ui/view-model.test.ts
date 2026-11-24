import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { OutputFile, RescueResult } from '../../src/core/types';
import type { FileInsight, Reconstruction } from '../../src/ai/contract';
import {
  badgeLabel,
  badgeToSource,
  buildExportFiles,
  chooseFinalName,
  encodingLabel,
  formatLabel,
  parseCsvPreview,
  pictureOutputs,
  previewKind,
  primaryPreview,
  reconstructionToBlocks,
  reconstructionUsable,
  renameOutputs,
  textSampleOf,
  toCatalogueEntry,
  type RescuedItem,
} from '../../src/ui/view-model';
import { poolSize } from '../../src/ui/pool';
import { emfSize, wmfSize } from '../../src/ui/rasterise';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const out = (name: string, mime: string, text = 'x'): OutputFile => ({ name, mime, bytes: enc(text) });

function result(partial: Partial<RescueResult> = {}): RescueResult {
  return {
    source: { path: 'OLDPC/MEMO1.TXT', size: 10 },
    detected: { format: 'text', family: 'text', evidence: ['Text bytes'], confidence: 0.9 },
    proposedName: 'Memo',
    outputs: [out('Memo.txt', 'text/plain;charset=utf-8'), out('Memo.md', 'text/markdown;charset=utf-8')],
    warnings: [],
    conversionLevel: 'full',
    ...partial,
  };
}

const insight = (partial: Partial<FileInsight> = {}): FileInsight => ({ category: 'Text', summary: null, proposedName: null, encodingHint: null, badge: 'NO_AI', ...partial });

describe('labels', () => {
  it('badges use the SDK-reported routing only', () => {
    expect(badgeLabel('ON_DEVICE')).toBe('ON DEVICE');
    expect(badgeLabel('CLOUD')).toBe('CLOUD');
    expect(badgeLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(badgeLabel('NO_AI')).toBe('NO AI');
    expect(badgeToSource('ON_DEVICE')).toBe('on_device');
    expect(badgeToSource('CLOUD')).toBe('in_cloud');
    expect(badgeToSource('UNKNOWN')).toBeNull();
    expect(badgeToSource(undefined)).toBeNull();
  });

  it('formats and encodings get friendly names, with a safe fallback', () => {
    expect(formatLabel('xls-biff8')).toContain('BIFF8');
    expect(formatLabel('something-new')).toBe('something-new');
    expect(encodingLabel('ebcdic-37')).toBe('EBCDIC code page 37');
    expect(encodingLabel('shift_jis')).toContain('Japanese');
    expect(encodingLabel(undefined)).toBeUndefined();
  });
});

describe('naming', () => {
  it('renames only outputs that share the base name', () => {
    const renamed = renameOutputs([out('Memo.txt', 'text/plain'), out('Memo - Sheet1.csv', 'text/csv'), out('other.png', 'image/png')], 'Memo', 'Stock memo');
    expect(renamed.map((o) => o.name)).toEqual(['Stock memo.txt', 'Stock memo - Sheet1.csv', 'other.png']);
  });

  it('uses the AI name only when AI actually ran, and de-duplicates', () => {
    const taken = new Set<string>();
    expect(chooseFinalName(result(), insight({ proposedName: 'Ignored', badge: 'NO_AI' }), taken)).toEqual({ name: 'Memo', source: 'content' });
    expect(chooseFinalName(result(), undefined, taken)).toEqual({ name: 'Memo (2)', source: 'content' });
    expect(chooseFinalName(result(), insight({ proposedName: '1994 stock: count?', badge: 'ON_DEVICE' }), taken)).toEqual({ name: '1994 stock count', source: 'ai' });
  });

  it('final names are always unique and Windows-safe', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 30 }), { minLength: 1, maxLength: 20 }), (names) => {
        const taken = new Set<string>();
        const finals = names.map((n) => chooseFinalName(result({ proposedName: 'Memo' }), insight({ proposedName: n, badge: 'ON_DEVICE' }), taken).name);
        expect(new Set(finals.map((f) => f.toLowerCase())).size).toBe(finals.length);
        for (const f of finals) expect(f).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
      }),
    );
  });
});

describe('reconstruction', () => {
  const rec = (partial: Partial<Reconstruction>): Reconstruction => ({
    blocks: [
      { kind: 'heading', text: 'Garden notes' },
      { kind: 'paragraph', text: 'Plant beans.' },
      { kind: 'list-item', text: 'Water daily' },
    ],
    badge: 'ON_DEVICE',
    mode: 'ai-structured',
    noInvention: { ok: true, inventedTokens: [] },
    ...partial,
  });

  it('maps blocks onto document blocks', () => {
    expect(reconstructionToBlocks(rec({}))).toEqual([
      { type: 'heading', level: 2, text: 'Garden notes' },
      { type: 'paragraph', text: 'Plant beans.' },
      { type: 'list-item', text: 'Water daily', ordered: false },
    ]);
  });

  it('is only used when structured by AI and the no-invention check passed', () => {
    expect(reconstructionUsable(rec({}))).toBe(true);
    expect(reconstructionUsable(rec({ noInvention: { ok: false, inventedTokens: ['magic'] } }))).toBe(false);
    expect(reconstructionUsable(rec({ mode: 'raw-fallback' }))).toBe(false);
    expect(reconstructionUsable(rec({ blocks: [] }))).toBe(false);
    expect(reconstructionUsable(undefined)).toBe(false);
  });
});

describe('previews', () => {
  it('parses CSV with BOM, quotes, doubled quotes, commas and newlines inside quotes, CRLF', () => {
    const csv = '﻿Name,Note\r\n"Smith, J","said ""hi""\nthere"\r\nLast,row';
    expect(parseCsvPreview(csv)).toEqual([
      ['Name', 'Note'],
      ['Smith, J', 'said "hi"\nthere'],
      ['Last', 'row'],
    ]);
  });

  it('limits rows and columns', () => {
    const csv = Array.from({ length: 20 }, (_, r) => Array.from({ length: 12 }, (_, c) => `${r}-${c}`).join(',')).join('\n');
    const rows = parseCsvPreview(csv, 3, 4);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['0-0', '0-1', '0-2', '0-3']);
  });

  it('never throws and round-trips simple tables', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.string({ maxLength: 8 }).filter((s) => !/[",\r\n]/.test(s)), { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }), (table) => {
        const csv = table.map((row) => row.join(',')).join('\r\n');
        const parsed = parseCsvPreview(csv, 100, 100);
        // An all-empty last row is indistinguishable from a trailing newline; compare the rest.
        expect(parsed.slice(0, table.length - 1)).toEqual(table.slice(0, table.length - 1));
      }),
    );
    fc.assert(fc.property(fc.string(), (s) => void parseCsvPreview(s)));
  });

  it('documents preview their words; only image files lead with the picture', () => {
    const txt = out('a.txt', 'text/plain;charset=utf-8');
    const md = out('a.md', 'text/markdown;charset=utf-8');
    const csv = out('a.csv', 'text/csv;charset=utf-8');
    const png = out('a - picture 1.png', 'image/png');
    const docx = out('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(primaryPreview([docx, csv, md, txt, png], 'document')).toBe(txt);
    expect(primaryPreview([docx, md, png], 'document')).toBe(md);
    expect(primaryPreview([docx, csv], 'spreadsheet')).toBe(csv);
    expect(primaryPreview([docx, png], 'document')).toBe(png);
    expect(primaryPreview([png, txt], 'image')).toBe(png);
    expect(primaryPreview([docx])).toBeUndefined();
    expect(pictureOutputs([docx, md, png], md)).toEqual([png]);
    expect(pictureOutputs([png], png)).toEqual([]);
    expect(previewKind(docx)).toBe('none');
  });

  it('text samples prefer recovered text, then structure, then text outputs', () => {
    expect(textSampleOf(result({ recoveredText: 'raw words' }))).toBe('raw words');
    expect(textSampleOf(result({ structure: [{ type: 'paragraph', text: 'para' }] }))).toBe('para');
    expect(textSampleOf(result({ outputs: [out('m.txt', 'text/plain', 'from output')] }))).toBe('from output');
    expect(textSampleOf(result({ outputs: [] }))).toBe('');
  });
});

describe('export', () => {
  const item = (id: number, name: string, extra: Partial<RescuedItem> = {}): RescuedItem => ({
    id,
    originalPath: `OLDPC/${name.toUpperCase()}.TXT`,
    result: result({ proposedName: name, outputs: [out(`${name}.txt`, 'text/plain'), out(`${name}.md`, 'text/markdown')] }),
    finalName: name,
    nameSource: 'content',
    extraOutputs: [],
    ...extra,
  });

  it('puts outputs under files/, plus a catalogue and a report', () => {
    const files = buildExportFiles([item(1, 'Memo'), item(2, 'Letter', { extraOutputs: [out('Letter - picture 1.png', 'image/png')] })], {
      title: 'Reopen rescue of OLDPC',
      createdAt: '2026-11-24T00:00:00.000Z',
      filesProcessedOnDevice: 2,
      cloudCalls: 0,
    });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(['files/Memo.txt', 'files/Memo.md', 'files/Letter.txt', 'files/Letter.md', 'files/Letter - picture 1.png', 'index.html', 'RESCUE_REPORT.md']);
    const html = new TextDecoder().decode(files.find((f) => f.path === 'index.html')!.bytes);
    expect(html).toContain('href="files/Letter%20-%20picture%201.png"');
    expect(html).toContain('2 processed on this device');
    expect(html).toContain('0 cloud calls');
  });

  it('catalogue entries carry the AI routing and summary', () => {
    const entry = toCatalogueEntry(item(1, 'Memo', { insight: insight({ summary: ['Line one.', 'Line two.'], badge: 'ON_DEVICE' }) }));
    expect(entry.aiSource).toBe('on_device');
    expect(entry.summary).toBe('Line one. Line two.');
    expect(entry.outputs[0]?.path).toBe('files/Memo.txt');
  });
});

describe('worker pool size', () => {
  it('respects the batch size, the core count and a hard cap', () => {
    expect(poolSize(4, 16)).toBe(4);
    expect(poolSize(4, 2)).toBe(2);
    expect(poolSize(50, 64)).toBe(8);
    expect(poolSize(0, 8)).toBe(4);
    expect(poolSize(Number.NaN, undefined)).toBe(2);
    expect(poolSize(1, 1)).toBe(1);
  });
});

describe('metafile sizes', () => {
  it('reads the placeable WMF header', () => {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x9ac6cdd7, true);
    view.setInt16(6, 0, true);
    view.setInt16(8, 0, true);
    view.setInt16(10, 1440, true);
    view.setInt16(12, 720, true);
    view.setUint16(14, 1440, true);
    // 1 inch × 0.5 inch → 96 × 48 CSS px, rendered up to 512 px on the long side (vector, so lossless).
    expect(wmfSize(bytes)).toEqual({ widthPx: 512, heightPx: 256, xExt: 1440, yExt: 720 });
  });

  it('renders at least 2× even when already large', () => {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x9ac6cdd7, true);
    view.setInt16(10, 7200, true);
    view.setInt16(12, 1440, true);
    view.setUint16(14, 1440, true);
    expect(wmfSize(bytes)).toMatchObject({ widthPx: 960, heightPx: 192 });
  });

  it('reads EMF bounds and clamps huge pictures', () => {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, true);
    view.setInt32(8, 0, true);
    view.setInt32(12, 0, true);
    view.setInt32(16, 8000, true);
    view.setInt32(20, 4000, true);
    const size = emfSize(bytes);
    expect(size.widthPx).toBe(2000);
    expect(size.heightPx).toBe(1000);
  });

  it('falls back to a default size for garbage', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        for (const size of [wmfSize(bytes), emfSize(bytes)]) {
          expect(size.widthPx).toBeGreaterThan(0);
          expect(size.heightPx).toBeGreaterThan(0);
          expect(Math.max(size.widthPx, size.heightPx)).toBeLessThanOrEqual(2000);
        }
      }),
    );
  });
});
