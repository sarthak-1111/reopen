import { detectFormat } from './detect';
import { detectEncoding } from './encoding';
import { proposeName, uniqueName } from './naming';
import { readSpreadsheet } from './readers/spreadsheet';
import { readRtf } from './readers/rtf';
import { readText } from './readers/text';
import { readWord97, Word97Error } from './readers/word97';
import { readWrite, recoverFromOle, recoverTextRuns, recoverWordPerfect, runsToText } from './readers/text-recovery';
import { blocksToMarkdown } from './writers/markdown';
import { docxBytes } from './writers/docx';
import { csvBytes } from './writers/csv';
import { encodePng } from './writers/png';
import { BmpError, decodeBmp } from './readers/bmp';
import type { Block, ConversionLevel, EmbeddedPicture, OutputFile, RescueResult } from './types';

/**
 * Converts a picture (WMF/EMF/BMP) to PNG. Supplied by the browser UI layer (canvas / rtf.js);
 * the core never touches the DOM.
 */
export type Rasterise = (picture: EmbeddedPicture) => Promise<Uint8Array | undefined>;

export interface RescueOptions {
  rasterise?: Rasterise;
  /** Names already used in this rescue (lower-case "name.ext"), for de-duplication. */
  takenNames?: Set<string>;
}

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  png: 'image/png',
  jpeg: 'image/jpeg',
} as const;

const RAW_NOTE = 'Recovered text, shown raw. Reopen could not read this format fully; nothing has been added or reworded.';

/** Below this, recovered "text" is treated as fragments (magic numbers, field names), not a document. */
const MIN_RECOVERED_LETTERS = 16;

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

function paragraphsToBlocks(text: string): Block[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ type: 'paragraph', text: line }));
}

function blocksText(blocks: Block[]): string {
  return blocks.map((b) => b.text).join('\n');
}

async function documentOutputs(base: string, blocks: Block[], title: string | undefined, note?: string): Promise<OutputFile[]> {
  // Don't repeat the title when the document already starts with it as a heading.
  const first = blocks[0];
  const showTitle = title && !(first?.type === 'heading' && first.text.trim() === title.trim()) ? title : undefined;
  const options = { ...(showTitle ? { title: showTitle } : {}), ...(note ? { note } : {}) };
  return [
    { name: `${base}.docx`, mime: MIME.docx, bytes: await docxBytes(blocks, options) },
    { name: `${base}.md`, mime: MIME.md, bytes: utf8(blocksToMarkdown(blocks, options)) },
  ];
}

async function pictureOutputs(
  base: string,
  pictures: EmbeddedPicture[],
  rasterise: Rasterise | undefined,
  warnings: string[],
  standalone = false,
): Promise<OutputFile[]> {
  const outputs: OutputFile[] = [];
  let pending = 0;
  for (const [index, picture] of pictures.entries()) {
    const label = standalone ? base : `${base} - picture ${index + 1}`;
    if (picture.kind === 'png') {
      outputs.push({ name: `${label}.png`, mime: MIME.png, bytes: picture.bytes });
      continue;
    }
    if (picture.kind === 'jpeg') {
      outputs.push({ name: `${label}.jpg`, mime: MIME.jpeg, bytes: picture.bytes });
      continue;
    }
    if (picture.kind === 'bmp') {
      try {
        outputs.push({ name: `${label}.png`, mime: MIME.png, bytes: encodePng(decodeBmp(picture.bytes)) });
        continue;
      } catch (error) {
        if (!(error instanceof BmpError)) throw error;
        if (!rasterise) warnings.push(`Bitmap ${index + 1}: ${error.message}`);
      }
    }
    if (rasterise) {
      const png = await rasterise(picture);
      if (png) outputs.push({ name: `${label}.png`, mime: MIME.png, bytes: png });
      else warnings.push(`Picture ${index + 1} (${picture.kind.toUpperCase()}) could not be converted to PNG.`);
    } else if (picture.kind !== 'bmp') pending++;
  }
  if (pending > 0) warnings.push(`${pending} picture(s) in WMF/EMF form need the browser to convert them to PNG.`);
  return outputs;
}

/** Rescues one file. Pure: bytes in, result out. Never throws for bad input. */
export async function rescueFile(path: string, bytes: Uint8Array, options: RescueOptions = {}): Promise<RescueResult> {
  const detected = detectFormat(bytes, path);
  const taken = options.takenNames ?? new Set<string>();
  const warnings: string[] = [];
  const source = { path, size: bytes.length };
  const finish = (partial: Omit<RescueResult, 'source' | 'detected' | 'warnings'>): RescueResult => ({ source, detected, warnings, ...partial });
  const reserve = (title: string | undefined, text: string | undefined): string =>
    uniqueName(proposeName({ ...(title ? { title } : {}), ...(text ? { text } : {}), originalName: path }), '', taken);

  try {
    switch (detected.family) {
      case 'spreadsheet': {
        const sheet = await readSpreadsheet(bytes);
        warnings.push(...sheet.warnings, 'Cell values and sheets are converted; cell formatting is not carried over.');
        // Name: workbook title, else a meaningful first sheet name, else the first row's headings.
        const first = sheet.sheets[0];
        const namedSheet = first && !/^(sheet|book|tabelle|feuil|hoja)\s*\d*$/i.test(first.name) ? first.name : undefined;
        const headerCells = (first?.csv.split('\n')[0] ?? '').split(',').map((c) => c.replace(/"/g, '').trim()).filter(Boolean);
        const base = reserve(sheet.title ?? namedSheet, headerCells.slice(0, 4).join(', '));
        const outputs: OutputFile[] = [{ name: `${base}.xlsx`, mime: MIME.xlsx, bytes: sheet.xlsx }];
        for (const s of sheet.sheets) {
          const csvName = sheet.sheets.length === 1 ? `${base}.csv` : `${base} - ${s.name.replace(/[<>:"/\\|?*]/g, ' ')}.csv`;
          outputs.push({ name: csvName, mime: MIME.csv, bytes: csvBytes(s.csv) });
        }
        return finish({ proposedName: base, outputs, sheets: sheet.sheets.map(({ name, rows, cols }) => ({ name, rows, cols })), conversionLevel: 'full' });
      }

      case 'image': {
        const base = reserve(undefined, undefined);
        const picture: EmbeddedPicture = { kind: 'bmp', bytes, needsRasterising: true };
        const outputs = await pictureOutputs(base, [picture], options.rasterise, warnings, true);
        return finish({ proposedName: base, outputs, pictures: [picture], conversionLevel: outputs.length > 0 ? 'full' : 'none' });
      }

      case 'text': {
        const forced = detected.format === 'ebcdic-text' ? detectEncoding(bytes).encoding : undefined;
        const text = readText(bytes, forced);
        const base = reserve(undefined, text.text);
        const outputs: OutputFile[] = [
          { name: `${base}.txt`, mime: MIME.txt, bytes: utf8(text.text) },
          { name: `${base}.md`, mime: MIME.md, bytes: utf8(blocksToMarkdown(text.blocks)) },
        ];
        if (text.encoding.confidence < 0.5) warnings.push(`Encoding guess "${text.encoding.encoding}" has low confidence (${text.encoding.confidence.toFixed(2)}).`);
        return finish({ proposedName: base, encoding: text.encoding, outputs, structure: text.blocks, conversionLevel: 'full' });
      }

      case 'document':
        return await rescueDocument(path, bytes, detected.format, options, warnings, reserve, finish);

      case 'container': {
        if (detected.format === 'ole-unknown') return await rescueRecovered(bytes, true, options, warnings, reserve, finish);
        const base = reserve(undefined, undefined);
        if (detected.format === 'zip') warnings.push('ZIP archive: open it as a folder to rescue the files inside.');
        else warnings.push('Already a modern format; copied unchanged.');
        const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
        const outputs = detected.format === 'zip' ? [] : [{ name: `${base}${ext}`, mime: 'application/octet-stream', bytes }];
        return finish({ proposedName: base, outputs, conversionLevel: 'none' });
      }

      default:
        return await rescueRecovered(bytes, false, options, warnings, reserve, finish);
    }
  } catch (error) {
    warnings.push(`Reader failed (${error instanceof Error ? error.message : String(error)}); falling back to text recovery.`);
    return rescueRecovered(bytes, detected.format.startsWith('ole') || detected.oleStreams !== undefined, options, warnings, reserve, finish);
  }
}

type Reserve = (title: string | undefined, text: string | undefined) => string;
type Finish = (partial: Omit<RescueResult, 'source' | 'detected' | 'warnings'>) => RescueResult;

async function rescueDocument(
  path: string,
  bytes: Uint8Array,
  format: RescueResult['detected']['format'],
  options: RescueOptions,
  warnings: string[],
  reserve: Reserve,
  finish: Finish,
): Promise<RescueResult> {
  switch (format) {
    case 'rtf': {
      const rtf = readRtf(bytes);
      warnings.push(...rtf.warnings, 'Headings, paragraphs, lists and pictures are kept; fonts, bold/italic and tables are not.');
      const base = reserve(rtf.title, blocksText(rtf.blocks));
      const outputs = [
        ...(await documentOutputs(base, rtf.blocks, rtf.title)),
        ...(await pictureOutputs(base, rtf.pictures, options.rasterise, warnings)),
      ];
      return finish({ proposedName: base, outputs, structure: rtf.blocks, pictures: rtf.pictures, conversionLevel: 'text-and-paragraphs' });
    }
    case 'word-97-doc': {
      try {
        const doc = readWord97(bytes);
        warnings.push(...doc.warnings);
        if (doc.encrypted) return finish({ proposedName: reserve(undefined, undefined), outputs: [], conversionLevel: 'none' });
        warnings.push('Text and paragraph breaks are recovered from the Word 97 piece table; formatting is not.');
        const base = reserve(undefined, doc.text);
        return finish({ proposedName: base, outputs: await documentOutputs(base, doc.blocks, undefined), structure: doc.blocks, conversionLevel: 'text-and-paragraphs' });
      } catch (error) {
        if (!(error instanceof Word97Error)) throw error;
        warnings.push(`Word 97 reader: ${error.message}`);
        return rescueRecovered(bytes, true, options, warnings, reserve, finish);
      }
    }
    case 'write-wri': {
      const write = readWrite(bytes);
      if (write.droppedBinaryParagraphs > 0) warnings.push(`${write.droppedBinaryParagraphs} picture/binary paragraph(s) were skipped.`);
      warnings.push('Text and paragraphs are read from the Write text area; formatting is not.');
      const blocks: Block[] = write.paragraphs.map((text) => ({ type: 'paragraph', text }));
      const base = reserve(undefined, write.paragraphs.join('\n'));
      return finish({ proposedName: base, outputs: await documentOutputs(base, blocks, undefined), structure: blocks, conversionLevel: 'text-and-paragraphs' });
    }
    case 'wordperfect': {
      const wp = recoverWordPerfect(bytes);
      if (wp.extendedCharacters > 0) warnings.push(`${wp.extendedCharacters} WordPerfect extended character(s) were left out.`);
      if (wp.unknownBytes > 0) warnings.push(`${wp.unknownBytes} byte(s) could not be interpreted and were skipped.`);
      const base = reserve(undefined, wp.text);
      const blocks = paragraphsToBlocks(wp.text);
      const outputs: OutputFile[] = [
        { name: `${base}.txt`, mime: MIME.txt, bytes: utf8(wp.text) },
        ...(await documentOutputs(base, blocks, undefined, RAW_NOTE)),
      ];
      return finish({
        proposedName: base,
        outputs,
        recoveredText: wp.text,
        textRuns: [{ offset: 0, byteLength: bytes.length, encoding: 'wordperfect', text: wp.text }],
        structure: blocks,
        conversionLevel: 'text-recovery',
      });
    }
    default:
      void path;
      return rescueRecovered(bytes, format !== 'unknown', options, warnings, reserve, finish);
  }
}

async function rescueRecovered(bytes: Uint8Array, ole: boolean, _options: RescueOptions, warnings: string[], reserve: Reserve, finish: Finish): Promise<RescueResult> {
  let runs;
  try {
    runs = ole ? recoverFromOle(bytes) : recoverTextRuns(bytes);
  } catch {
    runs = recoverTextRuns(bytes);
  }
  const text = runsToText(runs);
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < MIN_RECOVERED_LETTERS) {
    warnings.push(
      runs.length === 0
        ? 'No readable text was found. A format plugin (from public documentation) may be able to read it.'
        : `Only fragments were found (${letters} letters, e.g. "${text.slice(0, 40)}"). A format plugin (from public documentation) may be able to read it.`,
    );
    return finish({ proposedName: reserve(undefined, undefined), outputs: [], textRuns: runs, recoveredText: text, conversionLevel: 'none' });
  }
  const level: ConversionLevel = 'text-recovery';
  warnings.push(`${runs.length} text run(s) recovered without understanding the format; order and layout may be wrong.`);
  const base = reserve(undefined, text);
  const blocks = runs.map((run): Block => ({ type: 'paragraph', text: run.text }));
  const outputs: OutputFile[] = [
    { name: `${base}.txt`, mime: MIME.txt, bytes: utf8(text) },
    ...(await documentOutputs(base, blocks, undefined, RAW_NOTE)),
  ];
  return finish({ proposedName: base, outputs, recoveredText: text, textRuns: runs, structure: blocks, conversionLevel: level });
}
