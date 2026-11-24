import { CFB, EncodingJapanese } from '../interop';
import { u16le, u32le } from '../bytes';
import { decodeEbcdic, plausibility } from '../encoding';
import type { TextRun } from '../types';

/**
 * Best-effort text recovery for binary documents that have no permissively licensed reader
 * (WordPerfect, Works, Ichitaro, unknown formats…). The output is a list of text runs with
 * their byte offsets: raw material, in file order. Nothing is invented here; later steps may
 * only reorder, clean and structure these runs (see no-invention.ts).
 */

const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export interface RecoveryOptions {
  /** Only scan from this offset (e.g. a document-area pointer). */
  start?: number;
  minChars?: number;
  /** Label added to each run, e.g. an OLE stream name. */
  label?: string;
}

interface ScoredRun extends TextRun {
  score: number;
}

const isPrintable1252 = (b: number): boolean =>
  (b >= 0x20 && b <= 0x7e) || b === 0x09 || (b >= 0xa0 && b <= 0xff) || (b >= 0x91 && b <= 0x97) || b === 0x85 || b === 0x80;

const isSjisLead = (b: number): boolean => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef);
const isSjisTrail = (b: number): boolean => b >= 0x40 && b <= 0xfc && b !== 0x7f;

const EBCDIC_TEXT = (b: number): boolean =>
  b === 0x40 ||
  (b >= 0x81 && b <= 0x89) ||
  (b >= 0x91 && b <= 0x99) ||
  (b >= 0xa2 && b <= 0xa9) ||
  (b >= 0xc1 && b <= 0xc9) ||
  (b >= 0xd1 && b <= 0xd9) ||
  (b >= 0xe2 && b <= 0xe9) ||
  (b >= 0xf0 && b <= 0xf9) ||
  [0x4b, 0x6b, 0x60, 0x61, 0x7d, 0x7f, 0x4d, 0x5d, 0x7a, 0x5e, 0x6f, 0x5a].includes(b);

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function makeRun(offset: number, byteLength: number, encoding: string, text: string, label?: string): ScoredRun | undefined {
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  const chars = Array.from(cleaned).length;
  if (chars === 0) return undefined;
  // Real text is mostly letters and digits, and at least a quarter letters. Scrambled or
  // binary bytes that happen to be printable are mostly punctuation and digits.
  const letters = countMatches(cleaned, /\p{L}/gu);
  const alphanumeric = letters + countMatches(cleaned, /\p{N}/gu);
  if (alphanumeric / chars < 0.5 || letters / chars < 0.25) return undefined;
  const plaus = plausibility(cleaned);
  if (plaus < 0.5) return undefined;
  return {
    offset,
    byteLength,
    encoding: label ? `${encoding} (${label})` : encoding,
    text: cleaned,
    score: letters * plaus,
  };
}

function scanSingleByte(bytes: Uint8Array, start: number, minChars: number, label?: string): ScoredRun[] {
  const runs: ScoredRun[] = [];
  const decoder = new TextDecoder('windows-1252');
  let i = start;
  while (i < bytes.length) {
    if (!isPrintable1252(bytes[i]!)) {
      i++;
      continue;
    }
    const begin = i;
    while (i < bytes.length && (isPrintable1252(bytes[i]!) || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    if (i - begin >= minChars) {
      const run = makeRun(begin, i - begin, 'windows-1252', decoder.decode(bytes.subarray(begin, i)), label);
      if (run) runs.push(run);
    }
  }
  return runs;
}

function scanShiftJis(bytes: Uint8Array, start: number, label?: string): ScoredRun[] {
  const runs: ScoredRun[] = [];
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  let i = start;
  while (i < bytes.length) {
    const begin = i;
    let doubleBytes = 0;
    while (i < bytes.length) {
      const b = bytes[i]!;
      if (isSjisLead(b) && i + 1 < bytes.length && isSjisTrail(bytes[i + 1]!)) {
        doubleBytes++;
        i += 2;
      } else if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) {
        i++;
      } else break;
    }
    if (i === begin) {
      i++;
      continue;
    }
    if (doubleBytes >= 2) {
      try {
        const text = decoder.decode(bytes.subarray(begin, i));
        if (/[぀-ヿ一-鿿]/.test(text)) {
          const run = makeRun(begin, i - begin, 'shift_jis', text, label);
          if (run) runs.push(run);
        }
      } catch {
        // not valid Shift_JIS
      }
    }
  }
  return runs;
}

const commonKanji = new Map<number, boolean>();

/**
 * JIS X 0208 level-1 kanji (Shift_JIS lead bytes 0x88–0x98) are the ~3,000 everyday kanji.
 * Bytes of other encodings read as UTF-16 produce mostly rare ideographs, so this separates
 * real Japanese UTF-16 text from noise.
 */
function isCommonKanji(code: number): boolean {
  let known = commonKanji.get(code);
  if (known === undefined) {
    const sjis = EncodingJapanese.convert([code], { to: 'SJIS', from: 'UNICODE' }) as number[];
    known = sjis.length === 2 && sjis[0]! >= 0x88 && sjis[0]! <= 0x98;
    commonKanji.set(code, known);
  }
  return known;
}

type Utf16Class = 'cjk' | 'latin' | 'neutral' | 'invalid';

function utf16Class(code: number): Utf16Class {
  if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xff01 && code <= 0xff5e)) return 'cjk';
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7)) return 'latin';
  if ((code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0xa0 && code <= 0xbf) || code === 0xd7 || code === 0xf7) return 'neutral';
  if ((code >= 0x2010 && code <= 0x2027) || (code >= 0x3000 && code <= 0x303f)) return 'neutral';
  return 'invalid';
}

/**
 * UTF-16LE runs, split where the script changes so that noise read as CJK cannot glue itself
 * to real text. Each script segment is checked on its own; good neighbours are merged again.
 */
function scanUtf16le(bytes: Uint8Array, start: number, minChars: number, label?: string): ScoredRun[] {
  const runs: ScoredRun[] = [];
  const decoder = new TextDecoder('utf-16le');
  for (const parity of [0, 1]) {
    let i = start % 2 === parity ? start : start + 1;
    while (i + 1 < bytes.length) {
      // Collect one raw run of valid code units, split into script segments.
      const segments: { begin: number; end: number; cls: 'cjk' | 'latin' | 'neutral'; codes: number[] }[] = [];
      while (i + 1 < bytes.length) {
        const code = bytes[i]! | (bytes[i + 1]! << 8);
        const cls = utf16Class(code);
        if (cls === 'invalid') break;
        const current = segments[segments.length - 1];
        if (current && (cls === 'neutral' || cls === current.cls || current.cls === 'neutral')) {
          if (current.cls === 'neutral') current.cls = cls;
          current.end = i + 2;
          current.codes.push(code);
        } else segments.push({ begin: i, end: i + 2, cls, codes: [code] });
        i += 2;
      }
      if (segments.length === 0) {
        i += 2;
        continue;
      }
      const good = segments.map((segment) => {
        if (segment.cls === 'cjk') {
          const kanji = segment.codes.filter((c) => c >= 0x4e00 && c <= 0x9fff);
          const japanese = segment.codes.filter((c) => utf16Class(c) === 'cjk').length;
          return japanese >= 2 && (kanji.length === 0 || kanji.filter(isCommonKanji).length / kanji.length >= 0.7);
        }
        return segment.codes.length >= minChars;
      });
      // Merge consecutive good segments back into runs.
      for (let k = 0; k < segments.length; k++) {
        if (!good[k]) continue;
        let last = k;
        while (last + 1 < segments.length && good[last + 1]) last++;
        const begin = segments[k]!.begin;
        const end = segments[last]!.end;
        const run = makeRun(begin, end - begin, 'utf-16le', decoder.decode(bytes.subarray(begin, end)), label);
        if (run) runs.push(run);
        k = last;
      }
    }
  }
  return runs;
}

function scanEbcdic(bytes: Uint8Array, start: number, minChars: number, label?: string): ScoredRun[] {
  const runs: ScoredRun[] = [];
  let i = start;
  while (i < bytes.length) {
    if (!EBCDIC_TEXT(bytes[i]!)) {
      i++;
      continue;
    }
    const begin = i;
    let spaces = 0;
    while (i < bytes.length && (EBCDIC_TEXT(bytes[i]!) || bytes[i] === 0x15 || bytes[i] === 0x25)) {
      if (bytes[i] === 0x40) spaces++;
      i++;
    }
    if (i - begin >= Math.max(minChars, 6) && spaces > 0) {
      const run = makeRun(begin, i - begin, 'ebcdic-37', decodeEbcdic(bytes.subarray(begin, i), 37), label);
      if (run) runs.push(run);
    }
  }
  return runs;
}

/** Keeps the best-scoring runs that do not overlap, then returns them in file order. */
function selectRuns(candidates: ScoredRun[]): TextRun[] {
  const chosen: ScoredRun[] = [];
  for (const run of [...candidates].sort((a, b) => b.score - a.score || a.offset - b.offset)) {
    const overlaps = chosen.some((c) => run.offset < c.offset + c.byteLength && c.offset < run.offset + run.byteLength);
    if (!overlaps) chosen.push(run);
  }
  return chosen
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset, byteLength, encoding, text }) => ({ offset, byteLength, encoding, text }));
}

export function recoverTextRuns(input: Uint8Array, options: RecoveryOptions = {}): TextRun[] {
  const bytes = input.subarray(0, MAX_SCAN_BYTES);
  const start = Math.max(0, Math.min(options.start ?? 0, bytes.length));
  const minChars = options.minChars ?? 4;
  const candidates = [
    ...scanSingleByte(bytes, start, minChars, options.label),
    ...scanShiftJis(bytes, start, options.label),
    ...scanUtf16le(bytes, start, minChars, options.label),
    ...scanEbcdic(bytes, start, minChars, options.label),
  ];
  return selectRuns(candidates);
}

export function runsToText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('\n');
}

/** OLE files: recover per stream (sectors of different streams are interleaved on disk). */
export function recoverFromOle(bytes: Uint8Array): TextRun[] {
  const container = CFB.parse(bytes);
  const runs: TextRun[] = [];
  for (const entry of container.FileIndex) {
    if (entry.type !== 2 || !entry.content) continue;
    const content = entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content as ArrayLike<number>);
    if (content.length < 8) continue;
    runs.push(...recoverTextRuns(content, { label: entry.name }));
  }
  return runs;
}

// ---------------------------------------------------------------------------
// WordPerfect 5.x/6.x: walk the document area and skip function codes.
// Based on the publicly documented WordPerfect function-code layout: single-byte codes
// 0x80–0xBF, fixed-length codes 0xC0–0xCF that end with the same byte, and variable-length
// codes 0xD0–0xFE: [code, subcode, length (u16), …, code]. Each skip is validated by its
// closing byte; when validation fails we advance one byte. Unverified on real files —
// tested only on self-made samples — so the result is labelled text recovery.
// ---------------------------------------------------------------------------

const WP_FIXED_LENGTHS: Record<number, number> = { 0xc0: 4, 0xc1: 9, 0xc2: 11, 0xc3: 3, 0xc4: 3, 0xc5: 5, 0xc6: 6, 0xc7: 7 };

export interface WordPerfectResult {
  text: string;
  skippedCodes: number;
  unknownBytes: number;
  /** WordPerfect extended characters that were left out (their tables are not implemented). */
  extendedCharacters: number;
}

export function recoverWordPerfect(bytes: Uint8Array): WordPerfectResult {
  const pointer = u32le(bytes, 4) ?? 16;
  let i = pointer >= 16 && pointer < bytes.length ? pointer : 16;
  let text = '';
  let skippedCodes = 0;
  let unknownBytes = 0;
  let extendedCharacters = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b >= 0x20 && b <= 0x7e) {
      text += String.fromCharCode(b);
      i++;
    } else if (b === 0x0a || b === 0x0c) {
      text += '\n'; // hard return / hard page
      i++;
    } else if (b === 0x0d || b === 0x0b) {
      text += ' '; // soft return / soft page
      i++;
    } else if (b === 0x09) {
      text += '\t';
      i++;
    } else if (b >= 0x80 && b <= 0xbf) {
      if (b === 0xa0) text += ' ';
      else if (b === 0xa9 || b === 0xaa || b === 0xab) text += '-';
      skippedCodes++;
      i++;
    } else if (b >= 0xc0 && b <= 0xcf) {
      const length = WP_FIXED_LENGTHS[b];
      if (length !== undefined && bytes[i + length - 1] === b) {
        // 0xC0 is an extended character [C0, char, set, C0]. Its character-set tables are not
        // implemented, so the character is counted and left out rather than guessed.
        if (b === 0xc0) extendedCharacters++;
        i += length;
        skippedCodes++;
      } else {
        i++;
        unknownBytes++;
      }
    } else if (b >= 0xd0 && b <= 0xfe) {
      const length = u16le(bytes, i + 2);
      const end = length === undefined ? undefined : i + 4 + length;
      if (end !== undefined && end <= bytes.length && bytes[end - 1] === b) {
        i = end;
        skippedCodes++;
      } else {
        i++;
        unknownBytes++;
      }
    } else {
      i++;
      unknownBytes++;
    }
  }
  return {
    text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    skippedCodes,
    unknownBytes,
    extendedCharacters,
  };
}

// ---------------------------------------------------------------------------
// Microsoft Write (.wri) / Word for DOS: text lives between byte 128 and fcMac.
// Header layout as publicly described for the Write file format (wIdent, dty, wTool,
// reserved words, fcMac at offset 14). Pictures are stored inline in the text area;
// paragraphs that look binary are dropped with a warning.
// ---------------------------------------------------------------------------

export interface WriteResult {
  paragraphs: string[];
  droppedBinaryParagraphs: number;
}

export function readWrite(bytes: Uint8Array): WriteResult {
  const fcMac = u32le(bytes, 14) ?? bytes.length;
  const end = Math.min(Math.max(128, fcMac), bytes.length);
  const text = new TextDecoder('windows-1252').decode(bytes.subarray(128, end));
  const paragraphs: string[] = [];
  let droppedBinaryParagraphs = 0;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\f/g, '').trim();
    if (line.length === 0) continue;
    const control = (line.match(/[\u0000-\u0008\u000B\u000E-\u001F]/g) ?? []).length;
    if (control / line.length > 0.1) {
      droppedBinaryParagraphs++;
      continue;
    }
    paragraphs.push(line);
  }
  return { paragraphs, droppedBinaryParagraphs };
}
