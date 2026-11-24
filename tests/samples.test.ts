import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { detectFormat } from '../src/core/detect';
import { rescueFile } from '../src/core/rescue';
import { readRtf } from '../src/core/readers/rtf';
import type { RescueResult } from '../src/core/types';
import { manifest, sampleBytes, squash } from './helpers';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes).replace(/^﻿/, '');

/** All text a person would see in the outputs: Markdown, TXT, CSV, DOCX body, XLSX cells. */
function visibleText(result: RescueResult): string {
  const parts: string[] = [];
  for (const output of result.outputs) {
    if (/\.(md|txt|csv)$/.test(output.name)) parts.push(decode(output.bytes));
    if (output.name.endsWith('.docx')) {
      const xml = decode(unzipSync(output.bytes)['word/document.xml']!);
      parts.push(Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g), (m) => m[1]).join(' '));
    }
    if (output.name.endsWith('.xlsx')) {
      const wb = XLSX.read(output.bytes, { type: 'array' });
      for (const name of wb.SheetNames) parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]!));
    }
  }
  return parts.join('\n');
}

describe.each(manifest())('sample $path', (sample) => {
  const bytes = sampleBytes(sample.path);

  it(`is detected as ${sample.format} by structure`, () => {
    // The old-folder copies have misleading or 8.3 extensions; detection must not depend on them.
    expect(detectFormat(bytes, sample.path).format).toBe(sample.format);
    expect(detectFormat(bytes).format).toBe(sample.format);
  });

  it('is rescued with the expected text', async () => {
    const result = await rescueFile(sample.path, bytes);
    if (sample.mystery) {
      // Not readable without a format plugin: no invented output, honest level.
      expect(result.conversionLevel).toBe('none');
      expect(result.outputs).toEqual([]);
      return;
    }
    if (sample.encoding) expect(result.encoding?.encoding).toBe(sample.encoding);
    expect(result.conversionLevel).not.toBe('none');
    const text = squash(visibleText(result));
    for (const expected of sample.includes ?? []) expect(text).toContain(squash(expected));
    for (const unexpected of sample.excludes ?? []) expect(text).not.toContain(unexpected);
    if (sample.format === 'bmp-image') {
      const png = result.outputs.find((o) => o.name.endsWith('.png'));
      expect(png?.bytes.subarray(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    }
  });

  if (sample.format === 'rtf') {
    it('keeps RTF structure', () => {
      const rtf = readRtf(bytes);
      if (sample.title) expect(rtf.title).toBe(sample.title);
      const headings = rtf.blocks.filter((b) => b.type === 'heading').map((b) => b.text);
      expect(headings).toEqual(sample.headings ?? []);
      expect(rtf.blocks.filter((b) => b.type === 'list-item')).toHaveLength(sample.listItems ?? 0);
      expect(rtf.pictures.filter((p) => p.kind === 'png')).toHaveLength(sample.pictures ?? 0);
    });
  }
});

describe('rescue outputs', () => {
  it('names files from their content, not their 8.3 names', async () => {
    const names = await Promise.all(
      ['old-folder/REPORT.DOC', 'old-folder/MINUTES.RTF', 'old-folder/MEMO1.TXT', 'old-folder/BUDGET.XLS'].map(
        async (path) => (await rescueFile(path, sampleBytes(path))).proposedName,
      ),
    );
    expect(names).toEqual(['1997-05-02 Quarterly report', '1992-06-14 Garden club minutes', '1994-03-02 社内連絡', 'Stationery inventory']);
  });

  it('labels raw recovered text clearly', async () => {
    const result = await rescueFile('STATUS.DOC', sampleBytes('docs/project-status.wpd'));
    expect(result.conversionLevel).toBe('text-recovery');
    const md = decode(result.outputs.find((o) => o.name.endsWith('.md'))!.bytes);
    expect(md.startsWith('> Recovered text, shown raw.')).toBe(true);
  });
});
