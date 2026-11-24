import * as chardet from 'chardet';
import * as jschardet from 'jschardet';
import { EncodingJapanese } from './interop';
import { EBCDIC_TABLES, type EbcdicCodePage } from './ebcdic-tables';
import type { EncodingCandidate, EncodingDetection } from './types';

const SAMPLE_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Labels we decode with the browser's own TextDecoder (WHATWG Encoding Standard). */
const WHATWG_LABELS = new Set([
  'utf-8',
  'utf-16le',
  'utf-16be',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'iso-8859-2',
  'iso-8859-5',
  'iso-8859-7',
  'koi8-r',
  'gb18030',
  'big5',
  'euc-kr',
]);

export function isEbcdic(encoding: string): boolean {
  return encoding.startsWith('ebcdic-');
}

export function ebcdicCodePage(encoding: string): EbcdicCodePage | undefined {
  const cp = Number(encoding.slice('ebcdic-'.length));
  return cp in EBCDIC_TABLES ? (cp as EbcdicCodePage) : undefined;
}

/** Decode single-byte EBCDIC. NEL (U+0085) becomes a line feed. */
export function decodeEbcdic(bytes: Uint8Array, codePage: EbcdicCodePage = 37): string {
  const table = EBCDIC_TABLES[codePage]?.table;
  if (!table) throw new Error(`Unsupported EBCDIC code page ${codePage}`);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const ch = table[bytes[i] ?? 0] ?? '�';
    out += ch === '\u0085' ? '\n' : ch;
  }
  return out;
}

/** Encode text to single-byte EBCDIC (used by tests and sample generation). */
export function encodeEbcdic(text: string, codePage: EbcdicCodePage = 37): Uint8Array {
  const table = EBCDIC_TABLES[codePage]?.table;
  if (!table) throw new Error(`Unsupported EBCDIC code page ${codePage}`);
  const reverse = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const ch = table[b];
    if (ch !== undefined && !reverse.has(ch)) reverse.set(ch, b);
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] === '\n' ? '\u0085' : (text[i] ?? '');
    const b = reverse.get(ch);
    if (b === undefined) throw new Error(`Character ${JSON.stringify(ch)} not in EBCDIC ${codePage}`);
    out[i] = b;
  }
  return out;
}

function stripBom(bytes: Uint8Array, encoding: string): Uint8Array {
  if (encoding === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3);
  if (encoding === 'utf-16le' && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2);
  if (encoding === 'utf-16be' && bytes[0] === 0xfe && bytes[1] === 0xff) return bytes.subarray(2);
  return bytes;
}

/** Decode with a known encoding. Never throws on bad bytes (they become U+FFFD). */
export function decodeText(bytes: Uint8Array, encoding: string, fatal = false): string {
  if (isEbcdic(encoding)) {
    const cp = ebcdicCodePage(encoding);
    if (cp === undefined) throw new Error(`Unsupported encoding ${encoding}`);
    return decodeEbcdic(bytes, cp);
  }
  const label = encoding === 'ascii' ? 'utf-8' : encoding;
  return new TextDecoder(label, { fatal, ignoreBOM: false }).decode(stripBom(bytes, label));
}

function tryDecode(bytes: Uint8Array, encoding: string): string | undefined {
  try {
    return decodeText(bytes, encoding, true);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Plausibility: how much does decoded text look like real writing?
// ---------------------------------------------------------------------------

const isJapaneseChar = (c: number): boolean =>
  (c >= 0x3040 && c <= 0x30ff) || // hiragana, katakana
  (c >= 0x4e00 && c <= 0x9fff) || // CJK unified ideographs
  (c >= 0x3400 && c <= 0x4dbf); // CJK extension A

/** Cp1252 punctuation that appears in real Western text. */
const GOOD_WESTERN_PUNCT = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026, 0x20ac, 0x2022, 0x2122]);

/**
 * Returns a score in [-1, 1]. Real text scores high; text decoded with the wrong
 * encoding is full of control characters, isolated ideographs, half-width katakana
 * or rare symbols, and scores low.
 */
export function plausibility(text: string): number {
  if (text.length === 0) return 0;
  const chars = Array.from(text);
  let good = 0;
  let bad = 0;
  let japanese = 0;
  let japaneseWithNeighbour = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!.codePointAt(0)!;
    if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c) good++;
    else if (c < 0x20 || c === 0x7f) bad += 2;
    else if (c < 0x7f) good++;
    else if (c === 0xfffd) bad += 3;
    else if (c >= 0x80 && c <= 0x9f) bad += 2; // C1 controls
    else if (c >= 0xc0 && c <= 0xff && c !== 0xd7 && c !== 0xf7) good++; // Latin-1 letters
    else if (c >= 0xa0 && c <= 0xbf) bad += 0.5; // Latin-1 symbols: rare in prose
    else if (GOOD_WESTERN_PUNCT.has(c)) good++;
    else if (c >= 0x100 && c <= 0x24f) good += 0.5; // Latin extended
    else if (isJapaneseChar(c)) {
      japanese++;
      const prev = i > 0 ? chars[i - 1]!.codePointAt(0)! : 0;
      const next = i + 1 < chars.length ? chars[i + 1]!.codePointAt(0)! : 0;
      const neighbourIsJapanese =
        isJapaneseChar(prev) || isJapaneseChar(next) || (prev >= 0x3000 && prev <= 0x303f) || (next >= 0x3000 && next <= 0x303f);
      if (neighbourIsJapanese) japaneseWithNeighbour++;
      good++;
    } else if ((c >= 0x3000 && c <= 0x303f) || (c >= 0xff01 && c <= 0xff5e)) good++; // CJK punctuation, full-width ASCII
    else if (c >= 0xff61 && c <= 0xff9f) bad += 1; // half-width katakana: typical of mis-decoding
    else if (c >= 0xe000 && c <= 0xf8ff) bad += 2; // private use
    else if (c >= 0x370 && c <= 0x3ff) good += 0.5; // Greek
    else if (c >= 0x400 && c <= 0x4ff) good += 0.5; // Cyrillic
    else bad += 0.5;
  }
  // Isolated ideographs between Latin letters are the signature of Latin text read as Shift_JIS.
  if (japanese >= 4) {
    const isolatedShare = 1 - japaneseWithNeighbour / japanese;
    bad += isolatedShare * japanese * 2;
  }
  return Math.max(-1, Math.min(1, (good - bad) / chars.length));
}

// ---------------------------------------------------------------------------
// EBCDIC heuristic (own code: the MIT detectors do not cover EBCDIC)
// ---------------------------------------------------------------------------

function inEbcdicLetterRange(b: number): boolean {
  return (
    (b >= 0x81 && b <= 0x89) ||
    (b >= 0x91 && b <= 0x99) ||
    (b >= 0xa2 && b <= 0xa9) ||
    (b >= 0xc1 && b <= 0xc9) ||
    (b >= 0xd1 && b <= 0xd9) ||
    (b >= 0xe2 && b <= 0xe9)
  );
}

const EBCDIC_COMMON_PUNCT = new Set([0x4b, 0x6b, 0x60, 0x61, 0x7d, 0x7f, 0x4d, 0x5d, 0x7a, 0x5e, 0x6f, 0x5a, 0x5c, 0x15, 0x25, 0x0d, 0x05]);

export interface EbcdicStats {
  score: number;
  spaceShare: number;
  textShare: number;
  asciiSpaceShare: number;
  asciiNewlineShare: number;
}

/**
 * Byte statistics for EBCDIC text: 0x40 is the space, letters live in 0x81–0xE9,
 * digits in 0xF0–0xF9, and the ASCII space (0x20) and line feed (0x0A) are rare.
 */
export function ebcdicStats(bytes: Uint8Array): EbcdicStats {
  const n = Math.min(bytes.length, SAMPLE_BYTES);
  if (n === 0) return { score: 0, spaceShare: 0, textShare: 0, asciiSpaceShare: 0, asciiNewlineShare: 0 };
  let space = 0;
  let text = 0;
  let asciiSpace = 0;
  let asciiNewline = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0x40) {
      space++;
      text++;
    } else if (inEbcdicLetterRange(b) || (b >= 0xf0 && b <= 0xf9) || EBCDIC_COMMON_PUNCT.has(b)) text++;
    if (b === 0x20) asciiSpace++;
    if (b === 0x0a) asciiNewline++;
  }
  const spaceShare = space / n;
  const textShare = text / n;
  const asciiSpaceShare = asciiSpace / n;
  const asciiNewlineShare = asciiNewline / n;
  let score = 0;
  if (spaceShare >= 0.04 && spaceShare <= 0.4) score += 0.35;
  score += Math.max(0, (textShare - 0.6) / 0.4) * 0.45;
  if (asciiSpaceShare < 0.01) score += 0.1;
  if (asciiNewlineShare < 0.005) score += 0.1;
  return { score: Math.min(1, score), spaceShare, textShare, asciiSpaceShare, asciiNewlineShare };
}

export function looksLikeEbcdic(bytes: Uint8Array): boolean {
  return ebcdicStats(bytes).score >= 0.8;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const CHARDET_TO_WHATWG: Record<string, string> = {
  'UTF-8': 'utf-8',
  'UTF-16LE': 'utf-16le',
  'UTF-16BE': 'utf-16be',
  Shift_JIS: 'shift_jis',
  'EUC-JP': 'euc-jp',
  'ISO-2022-JP': 'iso-2022-jp',
  'ISO-8859-1': 'windows-1252',
  'windows-1252': 'windows-1252',
  'windows-1250': 'windows-1250',
  'windows-1251': 'windows-1251',
  'windows-1253': 'windows-1253',
  'windows-1254': 'windows-1254',
  'ISO-8859-2': 'iso-8859-2',
  'KOI8-R': 'koi8-r',
  'EUC-KR': 'euc-kr',
  Big5: 'big5',
  GB18030: 'gb18030',
};

const JSCHARDET_EBCDIC: Record<string, string> = {
  cp500: 'ebcdic-500',
  cp1140: 'ebcdic-1140',
  cp1026: 'ebcdic-1026',
  cp875: 'ebcdic-875',
  cp273: 'ebcdic-20273',
  cp037: 'ebcdic-37',
};

function normaliseLabel(name: string): string | undefined {
  const mapped = CHARDET_TO_WHATWG[name];
  if (mapped) return mapped;
  const lower = name.toLowerCase();
  if (JSCHARDET_EBCDIC[lower]) return JSCHARDET_EBCDIC[lower];
  if (lower === 'shift_jis' || lower === 'cp932' || lower === 'shift_jis_2004' || lower === 'windows-31j') return 'shift_jis';
  if (lower === 'euc-jp' || lower === 'euc-jis-2004') return 'euc-jp';
  if (lower.startsWith('iso2022-jp') || lower === 'iso-2022-jp') return 'iso-2022-jp';
  if (lower === 'ascii') return 'ascii';
  if (lower === 'utf-8-sig') return 'utf-8';
  if (WHATWG_LABELS.has(lower)) return lower;
  return undefined;
}

function hasEscapeSequences(bytes: Uint8Array): boolean {
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0x1b && (bytes[i + 1] === 0x24 || bytes[i + 1] === 0x28)) return true;
  }
  return false;
}

function isAllAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i]! >= 0x80) return false;
  return true;
}

function utf16Pattern(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | undefined {
  const n = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (n < 8) return undefined;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++;
    if (bytes[i + 1] === 0) oddZero++;
  }
  const pairs = n / 2;
  if (oddZero / pairs > 0.3 && evenZero / pairs < 0.05) return 'utf-16le';
  if (evenZero / pairs > 0.3 && oddZero / pairs < 0.05) return 'utf-16be';
  return undefined;
}

function addCandidate(list: EncodingCandidate[], encoding: string | undefined, confidence: number, source: string): void {
  if (!encoding) return;
  list.push({ encoding, confidence: Math.max(0, Math.min(1, confidence)), source });
}

/**
 * Detects the text encoding of a byte array.
 * Order: BOM → pure ASCII / ISO-2022-JP escapes → valid UTF-8 → UTF-16 without BOM →
 * candidates from encoding-japanese, chardet, jschardet and our EBCDIC statistics →
 * each candidate is decoded and scored for plausibility; the best decode wins.
 */
export function detectEncoding(input: Uint8Array): EncodingDetection {
  const bytes = input.subarray(0, SAMPLE_BYTES);
  const method: string[] = [];
  const candidates: EncodingCandidate[] = [];

  if (bytes.length === 0) return { encoding: 'utf-8', confidence: 0, candidates, method: ['empty input'] };

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { encoding: 'utf-8', confidence: 1, candidates: [{ encoding: 'utf-8', confidence: 1, source: 'bom' }], method: ['UTF-8 byte order mark'] };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { encoding: 'utf-16le', confidence: 1, candidates: [{ encoding: 'utf-16le', confidence: 1, source: 'bom' }], method: ['UTF-16LE byte order mark'] };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { encoding: 'utf-16be', confidence: 1, candidates: [{ encoding: 'utf-16be', confidence: 1, source: 'bom' }], method: ['UTF-16BE byte order mark'] };

  const escapes = hasEscapeSequences(bytes);
  if (isAllAscii(bytes)) {
    if (escapes && tryDecode(bytes, 'iso-2022-jp') !== undefined) {
      return { encoding: 'iso-2022-jp', confidence: 0.95, candidates: [{ encoding: 'iso-2022-jp', confidence: 0.95, source: 'escape sequences' }], method: ['7-bit with ISO-2022-JP escape sequences'] };
    }
    const ebcdic = ebcdicStats(bytes);
    if (ebcdic.score < 0.8) {
      return { encoding: 'ascii', confidence: 0.99, candidates: [{ encoding: 'ascii', confidence: 0.99, source: 'byte range' }], method: ['all bytes below 0x80'] };
    }
  }

  const utf16 = utf16Pattern(bytes);
  if (utf16 && tryDecode(bytes, utf16) !== undefined) {
    method.push(`zero-byte pattern suggests ${utf16} without BOM`);
    addCandidate(candidates, utf16, 0.9, 'zero-byte pattern');
  }

  const asUtf8 = tryDecode(bytes, 'utf-8');
  if (asUtf8 !== undefined) {
    // Valid multi-byte UTF-8 by accident is very unlikely for legacy text.
    return { encoding: 'utf-8', confidence: 0.97, candidates: [{ encoding: 'utf-8', confidence: 0.97, source: 'valid UTF-8' }], method: ['decodes as valid UTF-8 with non-ASCII characters'] };
  }

  // Library votes.
  const japanese = EncodingJapanese.detect(bytes);
  if (japanese === 'SJIS') addCandidate(candidates, 'shift_jis', 0.7, 'encoding-japanese');
  else if (japanese === 'EUCJP') addCandidate(candidates, 'euc-jp', 0.7, 'encoding-japanese');
  else if (japanese === 'JIS') addCandidate(candidates, 'iso-2022-jp', 0.7, 'encoding-japanese');
  method.push(`encoding-japanese: ${String(japanese)}`);

  try {
    for (const match of chardet.analyse(bytes).slice(0, 5)) {
      addCandidate(candidates, normaliseLabel(match.name), match.confidence / 100, 'chardet');
    }
    method.push('chardet analysed');
  } catch {
    method.push('chardet failed');
  }

  try {
    for (const match of jschardet.detectAll(bytes).slice(0, 5)) {
      if (match.encoding) addCandidate(candidates, normaliseLabel(match.encoding), match.confidence, 'jschardet');
    }
    method.push('jschardet analysed');
  } catch {
    method.push('jschardet failed');
  }

  const ebcdic = ebcdicStats(bytes);
  if (ebcdic.score >= 0.5) {
    addCandidate(candidates, 'ebcdic-37', ebcdic.score, 'byte statistics');
    method.push(`EBCDIC statistics score ${ebcdic.score.toFixed(2)} (space 0x40 ${(ebcdic.spaceShare * 100).toFixed(1)}%)`);
  }

  // Always consider the common legacy encodings, even with no vote.
  for (const fallback of ['shift_jis', 'euc-jp', 'windows-1252']) addCandidate(candidates, fallback, 0.05, 'baseline');
  if (escapes) addCandidate(candidates, 'iso-2022-jp', 0.3, 'escape sequences');

  // Decode every distinct candidate and score it.
  const votes = new Map<string, number>();
  for (const c of candidates) votes.set(c.encoding, Math.max(votes.get(c.encoding) ?? 0, c.confidence));
  if ([...votes.keys()].some(isEbcdic)) {
    for (const cp of Object.keys(EBCDIC_TABLES)) if (!votes.has(`ebcdic-${cp}`)) votes.set(`ebcdic-${cp}`, 0);
  }

  let best: { encoding: string; total: number; plaus: number } | undefined;
  for (const [encoding, vote] of votes) {
    if (encoding === 'ascii' || encoding === 'utf-8') continue;
    if (!isEbcdic(encoding) && !WHATWG_LABELS.has(encoding)) continue;
    if (isEbcdic(encoding) && ebcdic.score < 0.5) continue;
    const decoded = tryDecode(bytes, encoding);
    if (decoded === undefined) continue;
    const plaus = plausibility(decoded);
    // Plausibility decides; library votes break near-ties. Code page 37 wins EBCDIC ties.
    const total = plaus + vote * 0.15 + (encoding === 'ebcdic-37' ? 0.001 : 0);
    if (!best || total > best.total) best = { encoding, total, plaus };
  }

  if (!best) {
    return { encoding: 'windows-1252', confidence: 0.1, candidates, method: [...method, 'no candidate decoded cleanly; falling back to windows-1252'] };
  }
  method.push(`best plausibility: ${best.encoding} (${best.plaus.toFixed(2)})`);
  return { encoding: best.encoding, confidence: Math.max(0.1, Math.min(0.99, best.plaus)), candidates, method };
}

/** Detect then decode. */
export function decodeAuto(bytes: Uint8Array): { text: string; detection: EncodingDetection } {
  const detection = detectEncoding(bytes);
  return { text: decodeText(bytes, detection.encoding), detection };
}

export function normaliseNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
