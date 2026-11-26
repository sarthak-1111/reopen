/**
 * Pure mapping from core results (+ optional AI insights) to what the UI shows and exports.
 * No DOM here, so all of it is unit-tested.
 */
import type { Block, ConversionLevel, OutputFile, RescueResult } from '../core/types';
import { sanitiseFileName, uniqueName } from '../core/naming';
import { buildCatalogueHtml, buildRescueReport, type CatalogueEntry, type CatalogueMeta } from '../core/catalogue';
import type { PackagedFile } from '../core/package';
import type { FileInsight, InferenceBadge, Reconstruction } from '../ai/contract';

export interface RescuedItem {
  id: number;
  originalPath: string;
  result: RescueResult;
  /** Final, de-duplicated base name used for every output of this file. */
  finalName: string;
  /** Where the final name came from. */
  nameSource: 'content' | 'ai';
  insight?: FileInsight;
  reconstruction?: Reconstruction;
  /** Outputs added in the browser (PNG from WMF/EMF, AI-structured documents). */
  extraOutputs: OutputFile[];
  /** Read on this device with a reader that cloud Gemini drafted from public documentation. */
  researched?: true;
}

export const LEVEL_LABEL: Record<ConversionLevel, string> = {
  full: 'Full conversion',
  'text-and-paragraphs': 'Text and paragraphs (no formatting)',
  'text-recovery': 'Recovered text — shown raw',
  none: 'Not converted',
};

export const LEVEL_TONE: Record<ConversionLevel, 'good' | 'fair' | 'raw' | 'none'> = {
  full: 'good',
  'text-and-paragraphs': 'fair',
  'text-recovery': 'raw',
  none: 'none',
};

export function badgeLabel(badge: InferenceBadge): string {
  switch (badge) {
    case 'ON_DEVICE':
      return 'ON DEVICE';
    case 'CLOUD':
      return 'CLOUD';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return 'NO AI';
  }
}

/** Catalogue/report use the SDK's own lower-case values. */
export function badgeToSource(badge: InferenceBadge | undefined): 'on_device' | 'in_cloud' | null {
  if (badge === 'ON_DEVICE') return 'on_device';
  if (badge === 'CLOUD') return 'in_cloud';
  return null;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human label for a FormatId, e.g. "xls-biff8" → "Excel 97–2003 workbook (BIFF8)". */
const FORMAT_LABEL: Record<string, string> = {
  'xls-biff2': 'Excel 2.x worksheet (BIFF2)',
  'xls-biff3': 'Excel 3.0 worksheet (BIFF3)',
  'xls-biff4': 'Excel 4.0 worksheet (BIFF4)',
  'xls-biff5': 'Excel 5.0/95 workbook (BIFF5)',
  'xls-biff8': 'Excel 97–2003 workbook (BIFF8)',
  'spreadsheetml-2003': 'Excel 2003 XML spreadsheet',
  sylk: 'SYLK spreadsheet',
  dif: 'DIF data file',
  'lotus-wks': 'Lotus 1-2-3 (WKS)',
  'lotus-wk1': 'Lotus 1-2-3 (WK1)',
  'lotus-wk3': 'Lotus 1-2-3 (WK3)',
  'lotus-wk4': 'Lotus 1-2-3 (WK4)',
  'lotus-123': 'Lotus 1-2-3 (123)',
  quattro: 'Quattro Pro spreadsheet',
  'works-sheet': 'Works spreadsheet',
  dbf: 'dBASE table',
  rtf: 'Rich Text document',
  'word-97-doc': 'Word 97–2003 document',
  'word-legacy-doc': 'Older Word document',
  wordperfect: 'WordPerfect document',
  'works-wps': 'Works word-processor document',
  'write-wri': 'Write document',
  ichitaro: 'Ichitaro document',
  'ole-unknown': 'OLE compound file (unknown kind)',
  zip: 'ZIP archive',
  ooxml: 'Modern Office file',
  opendocument: 'OpenDocument file',
  'bmp-image': 'Bitmap image',
  text: 'Plain text',
  'ebcdic-text': 'EBCDIC (mainframe) text',
  unknown: 'Unknown format',
};

export function formatLabel(format: string): string {
  return FORMAT_LABEL[format] ?? format;
}

/** Friendly encoding label, e.g. "ebcdic-37" → "EBCDIC code page 37". */
export function encodingLabel(encoding: string | undefined): string | undefined {
  if (!encoding) return undefined;
  const ebcdic = /^ebcdic-(\d+)$/.exec(encoding);
  if (ebcdic) return `EBCDIC code page ${ebcdic[1]}`;
  const names: Record<string, string> = {
    shift_jis: 'Shift_JIS (Japanese)',
    'euc-jp': 'EUC-JP (Japanese)',
    'iso-2022-jp': 'ISO-2022-JP (Japanese)',
    'windows-1252': 'Windows-1252 (Western)',
    'utf-8': 'UTF-8',
    'utf-16le': 'UTF-16 (little-endian)',
    'utf-16be': 'UTF-16 (big-endian)',
  };
  return names[encoding.toLowerCase()] ?? encoding;
}

/**
 * Renames every output that starts with `oldBase` so it starts with `newBase` instead.
 * Outputs that don't share the base keep their names.
 */
export function renameOutputs(outputs: readonly OutputFile[], oldBase: string, newBase: string): OutputFile[] {
  if (oldBase === newBase) return [...outputs];
  return outputs.map((output) =>
    output.name.startsWith(oldBase) ? { ...output, name: newBase + output.name.slice(oldBase.length) } : output,
  );
}

/**
 * Picks the final base name: an AI-proposed name when one exists and AI actually ran,
 * otherwise the core's content-based name. Always sanitised and unique within `taken`.
 */
export function chooseFinalName(
  result: RescueResult,
  insight: FileInsight | undefined,
  taken: Set<string>,
): { name: string; source: 'content' | 'ai' } {
  const aiName = insight && insight.badge !== 'NO_AI' && insight.proposedName ? sanitiseFileName(insight.proposedName) : undefined;
  const base = aiName ?? result.proposedName;
  return { name: uniqueName(base, '', taken), source: aiName ? 'ai' : 'content' };
}

/** Maps AI reconstruction blocks onto the core's document blocks (for DOCX/Markdown writers). */
export function reconstructionToBlocks(reconstruction: Reconstruction): Block[] {
  return reconstruction.blocks.map((block): Block => {
    if (block.kind === 'heading') return { type: 'heading', level: 2, text: block.text };
    if (block.kind === 'list-item') return { type: 'list-item', text: block.text, ordered: false };
    return { type: 'paragraph', text: block.text };
  });
}

/** Whether a reconstruction may replace the raw text in the UI and exports. */
export function reconstructionUsable(reconstruction: Reconstruction | undefined): boolean {
  return !!reconstruction && reconstruction.mode === 'ai-structured' && reconstruction.noInvention.ok && reconstruction.blocks.length > 0;
}

/** Minimal RFC 4180 parser for previews (handles BOM, CRLF, quotes, doubled quotes). */
export function parseCsvPreview(text: string, maxRows = 8, maxCols = 8): string[][] {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row.slice(0, maxCols));
      row = [];
      cell = '';
      if (rows.length >= maxRows) return rows;
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row.slice(0, maxCols));
  }
  return rows.slice(0, maxRows);
}

export type PreviewKind = 'text' | 'csv' | 'image' | 'none';

export function previewKind(output: OutputFile): PreviewKind {
  if (output.mime.startsWith('image/')) return 'image';
  if (output.mime.startsWith('text/csv')) return 'csv';
  if (output.mime.startsWith('text/')) return 'text';
  return 'none';
}

/**
 * The output to preview first. Pictures lead only for image files; documents show their words
 * (plain text, then Markdown), spreadsheets their first sheet, and embedded pictures come last.
 */
export function primaryPreview(outputs: readonly OutputFile[], family?: string): OutputFile | undefined {
  const image = outputs.find((o) => previewKind(o) === 'image');
  if (family === 'image' && image) return image;
  return (
    outputs.find((o) => o.mime.startsWith('text/plain')) ??
    outputs.find((o) => o.mime.startsWith('text/markdown')) ??
    outputs.find((o) => previewKind(o) === 'csv') ??
    image
  );
}

/** Pictures worth showing as thumbnails next to a text or table preview. */
export function pictureOutputs(outputs: readonly OutputFile[], primary: OutputFile | undefined): OutputFile[] {
  return outputs.filter((o) => previewKind(o) === 'image' && o !== primary);
}

export function allOutputs(item: RescuedItem): OutputFile[] {
  return [...item.result.outputs, ...item.extraOutputs];
}

/** A short text sample for triage (first characters of readable content). */
export function textSampleOf(result: RescueResult, maxChars = 1500): string {
  if (result.recoveredText) return result.recoveredText.slice(0, maxChars);
  if (result.structure?.length) return result.structure.map((b) => b.text).join('\n').slice(0, maxChars);
  const textOutput = result.outputs.find((o) => o.mime.startsWith('text/'));
  if (textOutput) return new TextDecoder().decode(textOutput.bytes.subarray(0, maxChars * 4)).slice(0, maxChars);
  return '';
}

export const EXPORT_DIR = 'files';

export function toCatalogueEntry(item: RescuedItem): CatalogueEntry {
  const summary = item.insight?.summary ? item.insight.summary.join(' ') : undefined;
  return {
    originalPath: item.originalPath,
    newName: item.finalName,
    format: item.result.detected.format,
    ...(item.result.detected.label ? { formatName: item.result.detected.label } : {}),
    evidence: item.result.detected.evidence,
    ...(item.result.encoding ? { encoding: item.result.encoding.encoding } : {}),
    conversionLevel: item.result.conversionLevel,
    outputs: allOutputs(item).map((o) => ({ path: `${EXPORT_DIR}/${o.name}`, mime: o.mime })),
    warnings: item.result.warnings,
    aiSource: badgeToSource(item.insight?.badge),
    ...(summary ? { summary } : {}),
  };
}

/** Everything that goes into the "Download everything" zip. */
export function buildExportFiles(items: readonly RescuedItem[], meta: CatalogueMeta): PackagedFile[] {
  const files: PackagedFile[] = [];
  const used = new Set<string>();
  for (const item of items) {
    for (const output of allOutputs(item)) {
      const path = `${EXPORT_DIR}/${output.name}`;
      if (used.has(path.toLowerCase())) continue;
      used.add(path.toLowerCase());
      files.push({ path, bytes: output.bytes });
    }
  }
  const entries = items.map(toCatalogueEntry);
  const encoder = new TextEncoder();
  files.push({ path: 'index.html', bytes: encoder.encode(buildCatalogueHtml(entries, meta)) });
  files.push({ path: 'RESCUE_REPORT.md', bytes: encoder.encode(buildRescueReport(entries, meta)) });
  return files;
}

/** Running totals shown in the always-visible counter bar. */
export interface Counters {
  queued: number;
  processedOnDevice: number;
  failed: number;
  skipped: number;
  cloudCalls: number;
}

export function emptyCounters(): Counters {
  return { queued: 0, processedOnDevice: 0, failed: 0, skipped: 0, cloudCalls: 0 };
}
