import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStubAiService, categoryForFormat, rawBlocks } from '../../src/ai/stub';
import { checkNoInvention } from '../../src/core/no-invention';
import { rescueFile } from '../../src/core/rescue';
import { unzipFolder, zipFiles } from '../../src/core/package';
import { filesFromZip, expandSingleZip } from '../../src/ui/input';
import { selectFiles } from '../../src/ui/filter';
import { buildExportFiles, chooseFinalName, renameOutputs, textSampleOf, type RescuedItem } from '../../src/ui/view-model';
import { precacheList } from '../../vite.config';

const SAMPLE_ZIP = resolve(import.meta.dirname, '../../samples/old-folder.zip');

describe('stub AI service (behaves like "no on-device AI")', () => {
  it('reports not-configured, never sends anything, and labels everything NO_AI', async () => {
    const ai = createStubAiService();
    expect(await ai.nanoState()).toBe('not-configured');
    await expect(ai.warmUp(() => undefined)).rejects.toThrow();
    const insight = await ai.triage({ fileName: 'MEMO1.TXT', detectedFormat: 'text', textSample: 'Stock count 2 March 1994\nTotals attached', encoding: 'shift_jis' });
    expect(insight.badge).toBe('NO_AI');
    expect(insight.summary).toBeNull();
    expect(insight.proposedName).toBe('1994-03-02 Stock count 2 March 1994');
    expect(insight.encodingHint).toBe('shift_jis');
    expect(ai.ledger()).toHaveLength(0);
  });

  it('raw fallback never invents, reorders or drops words', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 20 }), (lines) => {
        const source = lines.join('\n');
        const blocks = rawBlocks(source);
        const output = blocks.map((b) => b.text).join('\n');
        expect(checkNoInvention(source, output).ok).toBe(true);
        expect(blocks.map((b) => b.text)).toEqual(lines.map((l) => l.trim()).filter((l) => l.length > 0));
      }),
    );
  });

  it('categorises formats without AI', () => {
    expect(categoryForFormat('xls-biff8')).toBe('Spreadsheet');
    expect(categoryForFormat('wordperfect')).toBe('Document');
    expect(categoryForFormat('ebcdic-text')).toBe('Text');
    expect(categoryForFormat('bmp-image')).toBe('Image');
    expect(categoryForFormat('unknown')).toBe('Unknown');
  });
});

describe('UI pipeline on the bundled sample folder (core + view-model, no DOM)', () => {
  it('rescues the sample zip and exports a catalogue that links every output', async () => {
    const zip = new Uint8Array(readFileSync(SAMPLE_ZIP));
    const expanded = await expandSingleZip(filesFromZip(zip).files.length ? [{ path: 'old-folder.zip', size: zip.length, read: async () => zip }] : []);
    expect(expanded.fromZip).toBe(true);
    const { keep, skipped } = selectFiles(expanded.files);
    expect(skipped).toEqual([]);
    expect(keep.length).toBe(15);

    const ai = createStubAiService();
    const taken = new Set<string>();
    const items: RescuedItem[] = [];
    for (const [index, file] of keep.entries()) {
      const result = await rescueFile(file.path, await file.read());
      const insight = await ai.triage({ fileName: file.path, detectedFormat: result.detected.format, textSample: textSampleOf(result), encoding: result.encoding?.encoding ?? null });
      const { name, source } = chooseFinalName(result, insight, taken);
      result.outputs = renameOutputs(result.outputs, result.proposedName, name);
      items.push({ id: index + 1, originalPath: file.path, result, finalName: name, nameSource: source, insight, extraOutputs: [] });
    }

    // Names are unique and come from content, not AI (the stub never claims AI).
    expect(new Set(items.map((i) => i.finalName.toLowerCase())).size).toBe(items.length);
    expect(items.every((i) => i.nameSource === 'content')).toBe(true);

    const files = buildExportFiles(items, { title: 'Reopen rescue of OLDPC', createdAt: '2026-11-24T00:00:00.000Z', filesProcessedOnDevice: items.length, cloudCalls: ai.ledger().length });
    const back = unzipFolder(zipFiles(files)).files;
    const paths = new Set(back.map((f) => f.path));
    expect(paths.has('index.html')).toBe(true);
    expect(paths.has('RESCUE_REPORT.md')).toBe(true);
    const html = new TextDecoder().decode(back.find((f) => f.path === 'index.html')!.bytes);
    for (const item of items) for (const o of item.result.outputs) {
      expect(paths.has(`files/${o.name}`)).toBe(true);
      expect(html).toContain(`files/${o.name.split('/').map(encodeURIComponent).join('/')}`.replace(/&/g, '&amp;'));
    }
    expect(html).toContain('0 cloud calls');
    // At least the clearly convertible samples produced outputs.
    const converted = items.filter((i) => i.result.outputs.length > 0).length;
    expect(converted).toBeGreaterThanOrEqual(13);
  });
});

describe('service-worker precache list', () => {
  it('includes the shell and hashed assets, never HTML pages, maps or the manifest itself', () => {
    const list = precacheList(['assets/main-abc.js', 'assets/main-abc.js.map', 'smoke/index.html', 'index.html', 'precache-manifest.json', 'assets/old-folder-x.zip']);
    expect(list).toEqual(['/', '/manifest.webmanifest', '/icon.svg', '/assets/main-abc.js', '/assets/old-folder-x.zip']);
  });
});
