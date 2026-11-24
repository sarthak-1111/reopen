import { unzipSync } from 'fflate';
import { CFB } from './interop';
import { asciiHead, hex, startsWith, u16le, u32le, u8 } from './bytes';
import { ebcdicStats } from './encoding';
import type { Detection, FormatFamily, FormatId } from './types';

const FAMILY: Record<FormatId, FormatFamily> = {
  'xls-biff2': 'spreadsheet',
  'xls-biff3': 'spreadsheet',
  'xls-biff4': 'spreadsheet',
  'xls-biff5': 'spreadsheet',
  'xls-biff8': 'spreadsheet',
  'spreadsheetml-2003': 'spreadsheet',
  sylk: 'spreadsheet',
  dif: 'spreadsheet',
  'lotus-wks': 'spreadsheet',
  'lotus-wk1': 'spreadsheet',
  'lotus-wk3': 'spreadsheet',
  'lotus-wk4': 'spreadsheet',
  'lotus-123': 'spreadsheet',
  quattro: 'spreadsheet',
  'works-sheet': 'spreadsheet',
  dbf: 'spreadsheet',
  rtf: 'document',
  'word-97-doc': 'document',
  'word-legacy-doc': 'document',
  wordperfect: 'document',
  'works-wps': 'document',
  'write-wri': 'document',
  ichitaro: 'document',
  'ole-unknown': 'container',
  zip: 'container',
  ooxml: 'container',
  opendocument: 'container',
  'bmp-image': 'image',
  text: 'text',
  'ebcdic-text': 'text',
  unknown: 'unknown',
};

/** Extensions that would agree with a structural result. Used only to annotate evidence. */
const EXTENSION_HINTS: Partial<Record<FormatId, readonly string[]>> = {
  'xls-biff2': ['xls'],
  'xls-biff3': ['xls'],
  'xls-biff4': ['xls', 'xlw'],
  'xls-biff5': ['xls'],
  'xls-biff8': ['xls'],
  'spreadsheetml-2003': ['xml', 'xls'],
  sylk: ['slk', 'sylk'],
  dif: ['dif'],
  'lotus-wks': ['wks', 'wk1'],
  'lotus-wk1': ['wk1'],
  'lotus-wk3': ['wk3'],
  'lotus-wk4': ['wk4'],
  'lotus-123': ['123'],
  quattro: ['wq1', 'wq2', 'wb1', 'wb2', 'wb3', 'qpw'],
  'works-sheet': ['xlr', 'wks'],
  dbf: ['dbf'],
  rtf: ['rtf'],
  'word-97-doc': ['doc'],
  'word-legacy-doc': ['doc'],
  wordperfect: ['wpd', 'wp', 'wp5', 'wp6', 'doc'],
  'works-wps': ['wps'],
  'write-wri': ['wri', 'doc'],
  ichitaro: ['jtd', 'jtt'],
  'bmp-image': ['bmp', 'dib'],
  text: ['txt', 'text', 'asc', 'csv', 'prn'],
  'ebcdic-text': ['txt', 'dat', 'ebc'],
};

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

function result(format: FormatId, confidence: number, evidence: string[], extra: Partial<Detection> = {}): Detection {
  return { format, family: FAMILY[format], confidence, evidence, ...extra };
}

function extensionOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : undefined;
}

/** Appends a note about the extension. The extension never changes the format. */
function annotateExtension(detection: Detection, name: string | undefined): Detection {
  const ext = extensionOf(name);
  if (!ext) return detection;
  const hints = EXTENSION_HINTS[detection.format];
  if (!hints) {
    detection.evidence.push(`Extension ".${ext}" noted but not used to decide the format.`);
  } else if (hints.includes(ext)) {
    detection.evidence.push(`Extension ".${ext}" agrees with the structure (used only as a tie-break hint).`);
    detection.confidence = Math.min(1, detection.confidence + 0.02);
  } else {
    detection.evidence.push(`Extension ".${ext}" does not match; the file structure was trusted instead.`);
  }
  return detection;
}

// --- OLE compound files -------------------------------------------------------

function detectOle(bytes: Uint8Array): Detection {
  const evidence = [`OLE compound file signature ${hex(0xd0cf11e0, 8)}A1B11AE1 at offset 0.`];
  let container: ReturnType<typeof CFB.parse>;
  try {
    container = CFB.parse(bytes);
  } catch (error) {
    evidence.push(`Container could not be parsed: ${error instanceof Error ? error.message : String(error)}.`);
    return result('ole-unknown', 0.5, evidence);
  }
  const streams = container.FileIndex.filter((entry) => entry.type === 2).map((entry) => entry.name);
  evidence.push(`Streams: ${streams.slice(0, 12).join(', ')}${streams.length > 12 ? ', …' : ''}.`);
  const has = (name: string): boolean => streams.includes(name);
  const extra = { oleStreams: streams };

  if (has('WordDocument')) {
    const entry = CFB.find(container, 'WordDocument');
    const stream = entry ? Uint8Array.from(entry.content as ArrayLike<number>) : new Uint8Array();
    const ident = u16le(stream, 0);
    const nFib = u16le(stream, 2) ?? 0;
    const flags = u16le(stream, 0x0a) ?? 0;
    if (ident !== 0xa5ec) {
      evidence.push(`"WordDocument" stream present but FIB identifier is ${ident === undefined ? 'missing' : hex(ident, 4)} (expected 0xA5EC).`);
      return result('word-legacy-doc', 0.6, evidence, extra);
    }
    evidence.push(`Word File Information Block: wIdent 0xA5EC, nFib ${hex(nFib, 4)}.`);
    if (flags & 0x0100) evidence.push('FIB says the document is encrypted (fEncrypted).');
    if (nFib >= 0x00c1) {
      evidence.push('nFib ≥ 0x00C1: Word 97 or later binary format ([MS-DOC]).');
      return result('word-97-doc', 0.97, evidence, extra);
    }
    evidence.push('nFib < 0x00C1: Word 6.0/95 binary format.');
    return result('word-legacy-doc', 0.9, evidence, extra);
  }
  if (has('Workbook')) {
    evidence.push('"Workbook" stream: Excel 97–2003 (BIFF8).');
    return result('xls-biff8', 0.95, evidence, extra);
  }
  if (has('Book')) {
    evidence.push('"Book" stream: Excel 5.0/95 (BIFF5).');
    return result('xls-biff5', 0.95, evidence, extra);
  }
  if (has('WksSSWorkBook')) {
    evidence.push('"WksSSWorkBook" stream: Works 6–9 spreadsheet (XLR).');
    return result('works-sheet', 0.9, evidence, extra);
  }
  if (has('NativeContent_MAIN')) {
    evidence.push('"NativeContent_MAIN" stream: Quattro Pro (QPW/WB3) in an OLE container.');
    return result('quattro', 0.85, evidence, extra);
  }
  if (has('MatOST') || (has('CONTENTS') && has('SPELLING'))) {
    evidence.push('"MatOST"/"CONTENTS" streams: Works word processor (WPS).');
    return result('works-wps', 0.75, evidence, extra);
  }
  if (has('DocumentText')) {
    evidence.push('"DocumentText" stream: commonly seen in Ichitaro documents (heuristic, unverified).');
    return result('ichitaro', 0.5, evidence, extra);
  }
  evidence.push('No known application stream; treating as an unknown OLE document.');
  return result('ole-unknown', 0.6, evidence, extra);
}

// --- ZIP containers ---------------------------------------------------------

function detectZip(bytes: Uint8Array): Detection {
  const evidence = ['ZIP local file header "PK\\x03\\x04" at offset 0.'];
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter(file) {
        names.push(file.name);
        return false; // list only, do not inflate
      },
    });
  } catch (error) {
    evidence.push(`ZIP directory could not be read: ${error instanceof Error ? error.message : String(error)}.`);
    return result('zip', 0.6, evidence);
  }
  if (names.includes('[Content_Types].xml')) {
    const kind = names.some((n) => n.startsWith('word/')) ? 'Word' : names.some((n) => n.startsWith('xl/')) ? 'Excel' : 'Office';
    evidence.push(`"[Content_Types].xml" present: Office Open XML (${kind}). Already a modern format.`);
    return result('ooxml', 0.95, evidence);
  }
  if (names.includes('mimetype')) {
    evidence.push('"mimetype" entry present: OpenDocument. Already a modern format.');
    return result('opendocument', 0.9, evidence);
  }
  evidence.push(`Plain ZIP archive with ${names.length} entries.`);
  return result('zip', 0.9, evidence);
}

// --- Binary signatures -----------------------------------------------------------

function detectWordPerfect(bytes: Uint8Array): Detection | undefined {
  if (!startsWith(bytes, [0xff, 0x57, 0x50, 0x43])) return undefined;
  const pointer = u32le(bytes, 4) ?? 0;
  const product = u8(bytes, 8) ?? 0;
  const fileType = u8(bytes, 9) ?? 0;
  const major = u8(bytes, 10) ?? 0;
  const evidence = [
    'WordPerfect prefix "\\xFFWPC" at offset 0.',
    `Document area pointer ${pointer}, product type ${product}, file type ${hex(fileType)}, major version ${major}.`,
  ];
  if (fileType !== 0x0a) evidence.push('File type is not 0x0A (document); it may be another WordPerfect Corporation file.');
  return result('wordperfect', fileType === 0x0a ? 0.95 : 0.7, evidence);
}

function detectBmp(bytes: Uint8Array): Detection | undefined {
  if (!startsWith(bytes, [0x42, 0x4d])) return undefined;
  const size = u32le(bytes, 2);
  const dataOffset = u32le(bytes, 10);
  const headerSize = u32le(bytes, 14);
  if (size === undefined || dataOffset === undefined || headerSize === undefined) return undefined;
  if (Math.abs(size - bytes.length) > 2 || dataOffset >= bytes.length || ![12, 40, 52, 56, 64, 108, 124].includes(headerSize)) return undefined;
  return result('bmp-image', 0.95, [`"BM" bitmap header: stated size ${size} matches the file, ${headerSize}-byte info header, pixels at ${dataOffset}.`]);
}

function detectWrite(bytes: Uint8Array): Detection | undefined {
  const ident = u16le(bytes, 0);
  if ((ident !== 0xbe31 && ident !== 0xbe32) || u16le(bytes, 2) !== 0 || u16le(bytes, 4) !== 0xab00) return undefined;
  const fcMac = u32le(bytes, 14) ?? 0;
  const evidence = [
    `Header identifier ${hex(ident, 4)}, 0x0000, 0xAB00: Microsoft Write / Word for DOS layout.`,
    `Text ends at byte ${fcMac} (fcMac); text starts at byte 128.`,
  ];
  const plausible = fcMac >= 128 && fcMac <= bytes.length;
  if (!plausible) evidence.push('fcMac is outside the file; the header may be damaged.');
  return result('write-wri', plausible ? 0.9 : 0.6, evidence);
}

function detectLotusOrQuattro(bytes: Uint8Array): Detection | undefined {
  if (u16le(bytes, 0) !== 0x0000) return undefined;
  const length = u16le(bytes, 2);
  const version = u16le(bytes, 4) ?? -1;
  if (length === 2) {
    const evidence = [`BOF record (opcode 0x0000, length 2) with version ${hex(version, 4)}.`];
    if (version === 0x0404 || version === 0x0405) {
      evidence.push('Version 0x0404/0x0405: Lotus 1-2-3 release 1 (WKS) family; Works for DOS spreadsheets use the same BOF.');
      return result('lotus-wks', 0.85, evidence);
    }
    if (version === 0x0406) {
      evidence.push('Version 0x0406: Lotus 1-2-3 release 2 (WK1).');
      return result('lotus-wk1', 0.9, evidence);
    }
    if (version >= 0x5120 && version <= 0x5123) {
      evidence.push('Version 0x512x: Quattro Pro for DOS (WQ1/WQ2).');
      return result('quattro', 0.85, evidence);
    }
    return undefined;
  }
  if (length === 0x1a) {
    const evidence = [`BOF record (opcode 0x0000, length 26) with version ${hex(version, 4)}.`];
    if (version === 0x1000 || version === 0x1001) return result('lotus-wk3', 0.9, [...evidence, 'Lotus 1-2-3 release 3 (WK3).']);
    if (version === 0x1002) return result('lotus-wk4', 0.9, [...evidence, 'Lotus 1-2-3 release 4/5 (WK4).']);
    if (version >= 0x1003 && version <= 0x1005) return result('lotus-123', 0.85, [...evidence, 'Lotus 1-2-3 97/Millennium (123).']);
  }
  return undefined;
}

function detectBiffStandalone(bytes: Uint8Array): Detection | undefined {
  const opcode = u16le(bytes, 0);
  const length = u16le(bytes, 2) ?? 0;
  const versions: Record<number, [FormatId, string]> = {
    0x0009: ['xls-biff2', 'Excel 2.x / Multiplan 4 (BIFF2)'],
    0x0209: ['xls-biff3', 'Excel 3.0 (BIFF3)'],
    0x0409: ['xls-biff4', 'Excel 4.0 (BIFF4)'],
    0x0809: ['xls-biff5', 'Excel 5.0 (BIFF5, without OLE wrapper)'],
  };
  if (opcode === undefined || !(opcode in versions) || length < 4 || length > 20) return undefined;
  const sheetType = opcode === 0x0009 ? u16le(bytes, 6) : u16le(bytes, 6);
  const knownTypes = [0x0005, 0x0006, 0x0010, 0x0020, 0x0040, 0x0100];
  if (sheetType === undefined || !knownTypes.includes(sheetType)) return undefined;
  const [format, label] = versions[opcode]!;
  return result(format, 0.9, [`BIFF BOF record ${hex(opcode, 4)} (length ${length}, substream type ${hex(sheetType, 4)}): ${label}.`]);
}

const DBF_VERSIONS = new Set([0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0x8e, 0xcb, 0xf5, 0xfb]);

function detectDbf(bytes: Uint8Array): Detection | undefined {
  if (bytes.length < 66) return undefined;
  const version = bytes[0]!;
  const month = bytes[2]!;
  const day = bytes[3]!;
  const records = u32le(bytes, 4) ?? 0;
  const headerLength = u16le(bytes, 8) ?? 0;
  const recordLength = u16le(bytes, 10) ?? 0;
  if (!DBF_VERSIONS.has(version) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (headerLength < 65 || recordLength < 1) return undefined;
  const expected = headerLength + records * recordLength;
  const sizeMatches = bytes.length === expected || bytes.length === expected + 1;
  if (!sizeMatches) return undefined;
  const firstField = asciiHead(bytes, 11, 32).replace(/\0+$/, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(firstField)) return undefined;
  return result('dbf', 0.9, [
    `dBASE header: version ${hex(version)}, last update month ${month} day ${day}.`,
    `${records} records × ${recordLength} bytes + ${headerLength}-byte header = file size.`,
    `First field descriptor "${firstField}".`,
  ]);
}

// --- Text-based formats --------------------------------------------------------

function controlShare(bytes: Uint8Array): number {
  const n = Math.min(bytes.length, 64 * 1024);
  if (n === 0) return 0;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c && b !== 0x1b) control++;
  }
  return control / n;
}

function looksLikeUtf16(bytes: Uint8Array): boolean {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  const n = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (n < 8) return false;
  let oddZero = 0;
  for (let i = 1; i < n; i += 2) if (bytes[i] === 0) oddZero++;
  return oddZero / (n / 2) > 0.4;
}

function detectTextFormats(bytes: Uint8Array): Detection | undefined {
  const head = asciiHead(bytes, 4096).replace(/^﻿|^\xEF\xBB\xBF/, '');
  const trimmed = head.trimStart();
  if (trimmed.startsWith('{\\rtf')) return result('rtf', 0.98, ['Starts with "{\\rtf": Rich Text Format.']);
  if (/^ID;P/.test(trimmed)) return result('sylk', 0.95, ['Starts with an "ID;P" record: Symbolic Link (SYLK).']);
  if (/^TABLE\r?\n0,1\r?\n/.test(trimmed)) return result('dif', 0.95, ['Starts with "TABLE" / "0,1" header: Data Interchange Format (DIF).']);
  if (trimmed.startsWith('<?xml') && head.includes('urn:schemas-microsoft-com:office:spreadsheet') && /<(ss:)?Workbook/.test(head)) {
    return result('spreadsheetml-2003', 0.95, ['XML with the "urn:schemas-microsoft-com:office:spreadsheet" namespace: Excel 2003 XML.']);
  }
  return undefined;
}

/**
 * Detects a file's format from its bytes. The optional name is only used to annotate
 * the evidence (and nudge confidence when it agrees); it never decides the format.
 * Never throws.
 */
export function detectFormat(input: Uint8Array, name?: string): Detection {
  try {
    return annotateExtension(detectFormatInner(input), name);
  } catch (error) {
    return result('unknown', 0, [`Detection failed safely: ${error instanceof Error ? error.message : String(error)}.`]);
  }
}

function detectFormatInner(bytes: Uint8Array): Detection {
  if (bytes.length === 0) return result('unknown', 0, ['Empty file.']);
  if (startsWith(bytes, OLE_SIGNATURE)) return detectOle(bytes);
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return detectZip(bytes);

  const text = detectTextFormats(bytes);
  if (text) return text;

  const binary = detectWordPerfect(bytes) ?? detectBmp(bytes) ?? detectWrite(bytes) ?? detectLotusOrQuattro(bytes) ?? detectBiffStandalone(bytes) ?? detectDbf(bytes);
  if (binary) return binary;

  const ebcdic = ebcdicStats(bytes);
  if (ebcdic.score >= 0.8) {
    return result('ebcdic-text', Math.min(0.95, ebcdic.score), [
      `Byte statistics match EBCDIC text: ${(ebcdic.spaceShare * 100).toFixed(1)}% 0x40 spaces, ${(ebcdic.textShare * 100).toFixed(1)}% EBCDIC letters/digits/punctuation, almost no ASCII spaces or line feeds.`,
    ]);
  }

  if (looksLikeUtf16(bytes)) return result('text', 0.85, ['UTF-16 byte pattern (byte order mark or alternating zero bytes).']);
  const control = controlShare(bytes);
  if (control < 0.01) {
    return result('text', 0.9, [`Only ${(control * 100).toFixed(2)}% control bytes: plain text in some encoding.`]);
  }
  return result('unknown', 0.2, [`No known signature; ${(control * 100).toFixed(1)}% control bytes, so it is binary data of an unknown format.`]);
}

export function familyOf(format: FormatId): FormatFamily {
  return FAMILY[format];
}
