import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import type { Block } from '../types';

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

function runsFor(text: string): TextRun[] {
  return text.split('\n').map((line, index) => new TextRun({ text: line, break: index > 0 ? 1 : 0 }));
}

export interface DocxOptions {
  title?: string;
  /** Short note shown in italics under the title (e.g. provenance). */
  note?: string;
}

export function buildDocx(blocks: Block[], options: DocxOptions = {}): Document {
  const children: Paragraph[] = [];
  if (options.title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runsFor(options.title) }));
  if (options.note) children.push(new Paragraph({ children: [new TextRun({ text: options.note, italics: true })] }));
  for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(new Paragraph({ heading: HEADINGS[block.level - 1], children: runsFor(block.text) }));
    } else if (block.type === 'list-item') {
      children.push(
        new Paragraph({
          children: runsFor(block.text),
          ...(block.ordered ? { numbering: { reference: 'reopen-ordered', level: 0 } } : { bullet: { level: 0 } }),
        }),
      );
    } else {
      children.push(new Paragraph({ children: runsFor(block.text) }));
    }
  }
  return new Document({
    creator: 'Reopen',
    title: options.title ?? 'Rescued document',
    numbering: {
      config: [
        {
          reference: 'reopen-ordered',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children }],
  });
}

/** Browser-safe: Packer.toBlob works in browsers and Workers (and in Node 20+, which has Blob). */
export async function docxBytes(blocks: Block[], options: DocxOptions = {}): Promise<Uint8Array> {
  const blob = await Packer.toBlob(buildDocx(blocks, options));
  return new Uint8Array(await blob.arrayBuffer());
}
