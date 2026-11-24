import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { unzipSync, unzlibSync } from 'fflate';
import { csvBytes, rowsToCsv } from '../src/core/writers/csv';
import { blocksToMarkdown } from '../src/core/writers/markdown';
import { docxBytes } from '../src/core/writers/docx';
import { encodePng } from '../src/core/writers/png';

/** Small RFC 4180 parser used only to check the writer. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

describe('CSV writer', () => {
  it('round-trips any cell content (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.string({ unit: 'grapheme' }), { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 8 }), (rows) => {
        expect(parseCsv(rowsToCsv(rows))).toEqual(rows);
      }),
      { numRuns: 500 },
    );
  });

  it('adds a UTF-8 BOM', () => {
    expect(Array.from(csvBytes('a').subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('Markdown writer', () => {
  it('escapes text that would otherwise become Markdown syntax', () => {
    const md = blocksToMarkdown([{ type: 'paragraph', text: '# not a heading\n1. not a list\n<b>raw</b> *x*' }]);
    expect(md).toBe('\\# not a heading  \n1\\. not a list  \n\\<b\\>raw\\</b\\> \\*x\\*\n');
  });

  it('starts a new list when the list type changes', () => {
    const md = blocksToMarkdown([
      { type: 'list-item', text: 'a', ordered: false },
      { type: 'list-item', text: 'b', ordered: true },
      { type: 'list-item', text: 'c', ordered: true },
    ]);
    expect(md).toBe('- a\n\n1. b\n2. c\n');
  });
});

describe('DOCX writer', () => {
  it('produces a Word document containing the text', async () => {
    const bytes = await docxBytes(
      [
        { type: 'heading', level: 1, text: 'Garden & <club>' },
        { type: 'paragraph', text: '本日の会議' },
        { type: 'list-item', text: 'first', ordered: true },
      ],
      { title: 'Minutes' },
    );
    const files = unzipSync(bytes);
    const xml = new TextDecoder().decode(files['word/document.xml']);
    expect(xml).toContain('Garden &amp; &lt;club&gt;');
    expect(xml).toContain('本日の会議');
    expect(xml).toContain('Heading1');
  });
});

describe('PNG writer', () => {
  it('writes a valid signature, IHDR and zlib-compressed scanlines', () => {
    const rgba = Uint8Array.from({ length: 2 * 2 * 4 }, (_, k) => k * 7);
    const png = encodePng({ width: 2, height: 2, rgba });
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(new TextDecoder().decode(png.subarray(12, 16))).toBe('IHDR');
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([2, 2]);
    const idatLength = view.getUint32(33);
    expect(new TextDecoder().decode(png.subarray(37, 41))).toBe('IDAT');
    const raw = unzlibSync(png.subarray(41, 41 + idatLength));
    expect(Array.from(raw.subarray(0, 9))).toEqual([0, ...Array.from(rgba.subarray(0, 8))]);
  });
});
