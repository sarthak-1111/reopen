import { CFB } from '../interop';
import { u16le, u32le, u8 } from '../bytes';
import type { Block } from '../types';

/**
 * Text extraction for Word 97–2003 binary documents, written from Microsoft's public
 * [MS-DOC] specification (Word (.doc) Binary File Format):
 *
 *   WordDocument stream → FIB (wIdent 0xA5EC, nFib, flags, ccpText, fcClx/lcbClx)
 *   0Table/1Table stream (fWhichTblStm) → CLX → Pcdt → PlcPcd (CPs + PCDs)
 *   each PCD → FcCompressed: bit 30 set = 8-bit cp1252 text at fc/2, else UTF-16LE at fc.
 *
 * Only the main document text (the first ccpText characters) is returned, with paragraph
 * breaks. Character and paragraph formatting are not read.
 */

export interface Word97Result {
  text: string;
  blocks: Block[];
  warnings: string[];
  encrypted: boolean;
}

export class Word97Error extends Error {
  override name = 'Word97Error';
}

/** cp1252 bytes 0x80–0x9F as Unicode, per [MS-DOC] 2.4.1 (compressed text mapping). */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function streamBytes(container: ReturnType<typeof CFB.parse>, name: string): Uint8Array | undefined {
  const entry = CFB.find(container, name);
  if (!entry || !entry.content) return undefined;
  return entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content as ArrayLike<number>);
}

interface Fib {
  nFib: number;
  encrypted: boolean;
  tableStream: '0Table' | '1Table';
  ccpText: number;
  fcClx: number;
  lcbClx: number;
}

/** Reads the FIB using the counts it declares (csw, cslw, cbRgFcLcb) rather than fixed offsets. */
export function readFib(wordDocument: Uint8Array): Fib {
  if (u16le(wordDocument, 0) !== 0xa5ec) throw new Word97Error('Not a Word binary document (FIB wIdent is not 0xA5EC).');
  const nFib = u16le(wordDocument, 2) ?? 0;
  const flags = u16le(wordDocument, 0x0a) ?? 0;
  const csw = u16le(wordDocument, 0x20);
  if (csw === undefined) throw new Word97Error('FIB is truncated.');
  const cslwOffset = 0x22 + csw * 2;
  const cslw = u16le(wordDocument, cslwOffset);
  if (cslw === undefined) throw new Word97Error('FIB is truncated.');
  const rgLw = cslwOffset + 2;
  const ccpText = u32le(wordDocument, rgLw + 3 * 4); // FibRgLw97.ccpText
  const cbOffset = rgLw + cslw * 4;
  const cbRgFcLcb = u16le(wordDocument, cbOffset);
  if (ccpText === undefined || cbRgFcLcb === undefined) throw new Word97Error('FIB is truncated.');
  const rgFcLcb = cbOffset + 2;
  if (cbRgFcLcb < 34) throw new Word97Error('FIB has no CLX entry.');
  const fcClx = u32le(wordDocument, rgFcLcb + 66 * 4); // FibRgFcLcb97.fcClx
  const lcbClx = u32le(wordDocument, rgFcLcb + 67 * 4);
  if (fcClx === undefined || lcbClx === undefined) throw new Word97Error('FIB is truncated.');
  return {
    nFib,
    encrypted: (flags & 0x0100) !== 0,
    tableStream: flags & 0x0200 ? '1Table' : '0Table',
    ccpText,
    fcClx,
    lcbClx,
  };
}

interface Piece {
  cpStart: number;
  cpEnd: number;
  fc: number;
  compressed: boolean;
}

/** Parses the CLX: skips Prc entries (0x01) and reads the Pcdt (0x02) piece table. */
export function readPieceTable(table: Uint8Array, fcClx: number, lcbClx: number): Piece[] {
  let pos = fcClx;
  const end = Math.min(table.length, fcClx + lcbClx);
  while (pos < end && table[pos] === 0x01) {
    const cbGrpprl = u16le(table, pos + 1);
    if (cbGrpprl === undefined) throw new Word97Error('CLX Prc is truncated.');
    pos += 3 + cbGrpprl;
  }
  if (table[pos] !== 0x02) throw new Word97Error('CLX has no Pcdt (piece table).');
  const lcb = u32le(table, pos + 1);
  if (lcb === undefined || lcb < 4) throw new Word97Error('Piece table is truncated.');
  const plc = pos + 5;
  const count = Math.floor((lcb - 4) / 12);
  if (count <= 0 || plc + lcb > table.length) throw new Word97Error('Piece table size is invalid.');
  const pieces: Piece[] = [];
  for (let k = 0; k < count; k++) {
    const cpStart = u32le(table, plc + k * 4)!;
    const cpEnd = u32le(table, plc + (k + 1) * 4)!;
    const pcd = plc + (count + 1) * 4 + k * 8;
    const fcRaw = u32le(table, pcd + 2)!;
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    if (cpEnd < cpStart) throw new Word97Error('Piece table CPs are not ascending.');
    pieces.push({ cpStart, cpEnd, fc: compressed ? fc / 2 : fc, compressed });
  }
  return pieces;
}

/** Turns Word's special characters into plain text. Field codes keep only their result. */
function cleanSpecialCharacters(raw: string): string {
  let out = '';
  // Field nesting: 0x13 begin, 0x14 separator, 0x15 end. Text between begin and separator is the
  // field instruction (hidden); text between separator and end is the visible result.
  const fieldStack: boolean[] = []; // true = currently inside the instruction part
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) {
      fieldStack.push(true);
      continue;
    }
    if (c === 0x14) {
      if (fieldStack.length > 0) fieldStack[fieldStack.length - 1] = false;
      continue;
    }
    if (c === 0x15) {
      fieldStack.pop();
      continue;
    }
    if (fieldStack.some((inInstruction) => inInstruction)) continue;
    switch (c) {
      case 0x0d: // paragraph mark
      case 0x0b: // line break
      case 0x0c: // page / section break
        out += '\n';
        break;
      case 0x07: // cell / row mark
        out += '\t';
        break;
      case 0x1e: // non-breaking hyphen
        out += '-';
        break;
      case 0x1f: // optional hyphen
      case 0x01: // picture anchor
      case 0x08: // drawn object anchor
      case 0x05: // annotation reference
      case 0x02: // auto-numbered footnote reference
        break;
      case 0xa0:
        out += ' ';
        break;
      default:
        if (c >= 0x20 || c === 0x09) out += ch;
        break;
    }
  }
  return out;
}

export function readWord97(bytes: Uint8Array): Word97Result {
  const container = CFB.parse(bytes);
  const wordDocument = streamBytes(container, 'WordDocument');
  if (!wordDocument) throw new Word97Error('No WordDocument stream.');
  const fib = readFib(wordDocument);
  const warnings: string[] = [];
  if (fib.nFib < 0x00c1) throw new Word97Error(`nFib ${fib.nFib} is older than Word 97.`);
  if (fib.encrypted) {
    return { text: '', blocks: [], warnings: ['The document is encrypted; its text cannot be read without the password.'], encrypted: true };
  }
  const table = streamBytes(container, fib.tableStream);
  if (!table) throw new Word97Error(`Missing ${fib.tableStream} stream.`);
  const pieces = readPieceTable(table, fib.fcClx, fib.lcbClx);

  let raw = '';
  for (const piece of pieces) {
    if (piece.cpStart >= fib.ccpText) break;
    const cpEnd = Math.min(piece.cpEnd, fib.ccpText);
    const length = cpEnd - piece.cpStart;
    if (piece.compressed) {
      for (let k = 0; k < length; k++) {
        const b = u8(wordDocument, piece.fc + k);
        if (b === undefined) {
          warnings.push('A text piece runs past the end of the WordDocument stream.');
          break;
        }
        raw += String.fromCharCode(CP1252_HIGH[b] ?? b);
      }
    } else {
      for (let k = 0; k < length; k++) {
        const code = u16le(wordDocument, piece.fc + k * 2);
        if (code === undefined) {
          warnings.push('A text piece runs past the end of the WordDocument stream.');
          break;
        }
        raw += String.fromCharCode(code);
      }
    }
  }

  const text = cleanSpecialCharacters(raw).replace(/\n{3,}/g, '\n\n').trim();
  const blocks: Block[] = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ type: 'paragraph', text: line }));
  return { text, blocks, warnings, encrypted: false };
}
