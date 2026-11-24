import { codepageForCharset, decodeWithCodepage } from '../codepages';
import type { Block, EmbeddedPicture } from '../types';

/**
 * A small, pure RTF reader (no DOM), written from Microsoft's public Rich Text Format
 * specification. It recovers document structure (headings, paragraphs, list items),
 * the \info title and embedded pictures. Character formatting is not kept.
 *
 * rtf.js (MIT) renders RTF to HTML but needs a DOM; the UI layer can use it for
 * previews and to rasterise WMF/EMF pictures. This reader runs anywhere, including
 * Web Workers and tests.
 */

export interface RtfResult {
  blocks: Block[];
  title?: string;
  pictures: EmbeddedPicture[];
  codepage: number;
  warnings: string[];
}

type Destination =
  | 'body'
  | 'skip'
  | 'fonttbl'
  | 'stylesheet'
  | 'info'
  | 'title'
  | 'pict'
  | 'listmarker'
  | 'fldinst';

interface GroupState {
  dest: Destination;
  uc: number;
  font: number;
  /** Paragraph properties live in the group state so that `}` restores them. */
  outline: number | undefined;
  style: number | undefined;
}

const SKIP_DESTINATIONS = new Set([
  'colortbl', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'footnote', 'annotation', 'object', 'objdata', 'themedata', 'colorschememapping', 'datastore',
  'latentstyles', 'rsidtbl', 'generator', 'xmlnstbl', 'listtable', 'listoverridetable', 'filetbl',
  'revtbl', 'pgdsctbl', 'nonshppict', 'bkmkstart', 'bkmkend', 'atnid', 'atnauthor', 'mmathPr', 'pnseclvl',
  'author', 'operator', 'company', 'subject', 'keywords', 'comment', 'doccomm', 'creatim', 'revtim',
  'printim', 'buptim', 'falt', 'panose', 'fname', 'listname', 'leveltext', 'levelnumbers', 'shpinst',
  'sp', 'sn', 'sv', 'xe', 'tc', 'private', 'userprops', 'wgrffmtfilter', 'passwordhash', 'protusertbl',
]);

/** Starred (ignorable) destinations we still want to read. */
const KEEP_STARRED = new Set(['shppict', 'fldrslt']);

const SYMBOL_WORDS: Record<string, string> = {
  tab: '\t',
  line: '\n',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
};

const PICTURE_KINDS: Record<string, EmbeddedPicture['kind']> = {
  wmetafile: 'wmf',
  emfblip: 'emf',
  pngblip: 'png',
  jpegblip: 'jpeg',
  dibitmap: 'bmp',
  wbitmap: 'bmp',
};

export function readRtf(bytes: Uint8Array): RtfResult {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  const pictures: EmbeddedPicture[] = [];
  const fontCharsets = new Map<number, number>();
  const styleNames = new Map<number, string>();
  let ansiCodepage = 1252;
  let title = '';

  let state: GroupState = { dest: 'body', uc: 1, font: 0, outline: undefined, style: undefined };
  const stack: GroupState[] = [];

  // Paragraph accumulation
  let paragraph = '';
  let listMarker: string | undefined;
  let pendingBytes: number[] = [];
  let pendingCodepage = 1252;
  let skipChars = 0;

  // Font table / stylesheet scratch
  let tableEntryNumber: number | undefined;
  let tableEntryCharset: number | undefined;
  let tableEntryName = '';

  // Picture scratch
  let pictKind: EmbeddedPicture['kind'] = 'unknown';
  let pictHex = '';
  let pictBinary: number[] = [];

  let listMarkerText = '';
  let ignorableNext = false;

  const currentCodepage = (): number => {
    const charset = fontCharsets.get(state.font);
    const cp = charset === undefined ? undefined : codepageForCharset(charset);
    return cp ?? ansiCodepage;
  };

  const emitText = (text: string): void => {
    if (text.length === 0) return;
    switch (state.dest) {
      case 'body':
        paragraph += text;
        break;
      case 'title':
        title += text;
        break;
      case 'listmarker':
        listMarkerText += text;
        break;
      case 'fonttbl':
      case 'stylesheet':
        tableEntryName += text;
        break;
      default:
        break;
    }
  };

  const flushBytes = (): void => {
    if (pendingBytes.length === 0) return;
    emitText(decodeWithCodepage(Uint8Array.from(pendingBytes), pendingCodepage));
    pendingBytes = [];
  };

  const pushByte = (byte: number): void => {
    if (skipChars > 0) {
      skipChars--;
      return;
    }
    if (state.dest === 'pict') {
      pictBinary.push(byte);
      return;
    }
    const cp = currentCodepage();
    if (pendingBytes.length > 0 && cp !== pendingCodepage) flushBytes();
    pendingCodepage = cp;
    pendingBytes.push(byte);
  };

  /** True when the buffered bytes end with a double-byte lead byte that still needs its trail byte. */
  const awaitingTrailByte = (): boolean => {
    if (pendingBytes.length === 0) return false;
    const isLead =
      pendingCodepage === 932
        ? (b: number) => (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)
        : pendingCodepage === 936 || pendingCodepage === 949 || pendingCodepage === 950
          ? (b: number) => b >= 0x81 && b <= 0xfe
          : undefined;
    if (!isLead) return false;
    let k = 0;
    while (k < pendingBytes.length) k += isLead(pendingBytes[k]!) ? 2 : 1;
    return k > pendingBytes.length;
  };

  /**
   * A literal ASCII byte. In double-byte code pages (Shift_JIS, GBK, Big5…) RTF writers emit the
   * lead byte as 'hh and the trail byte as a plain character when it is printable ASCII.
   */
  const pushAscii = (byte: number): void => {
    if (awaitingTrailByte()) pushByte(byte);
    else pushChar(String.fromCharCode(byte));
  };

  const pushChar = (ch: string): void => {
    if (skipChars > 0) {
      skipChars--;
      return;
    }
    flushBytes();
    emitText(ch);
  };

  const endParagraph = (): void => {
    flushBytes();
    const text = paragraph.replace(/[ \t]+\n/g, '\n').trim();
    paragraph = '';
    if (text.length > 0) {
      const styleName = state.style !== undefined ? styleNames.get(state.style) ?? '' : '';
      const styleHeading = /heading\s*([1-6])/i.exec(styleName) ?? /^見出し\s*([1-6])/.exec(styleName);
      if (state.outline !== undefined && state.outline >= 0 && state.outline <= 5) {
        blocks.push({ type: 'heading', level: (state.outline + 1) as 1 | 2 | 3 | 4 | 5 | 6, text });
      } else if (styleHeading) {
        blocks.push({ type: 'heading', level: Number(styleHeading[1]) as 1 | 2 | 3 | 4 | 5 | 6, text });
      } else if (listMarker !== undefined) {
        blocks.push({ type: 'list-item', text, ordered: /^\s*[0-9a-zA-Z]{1,3}[.)]/.test(listMarker) });
      } else {
        blocks.push({ type: 'paragraph', text });
      }
    }
    listMarker = undefined;
  };

  const finishTableEntry = (): void => {
    if (tableEntryNumber !== undefined) {
      if (state.dest === 'fonttbl' && tableEntryCharset !== undefined) fontCharsets.set(tableEntryNumber, tableEntryCharset);
      if (state.dest === 'stylesheet') styleNames.set(tableEntryNumber, tableEntryName.replace(/;\s*$/, '').trim());
    }
    tableEntryNumber = undefined;
    tableEntryCharset = undefined;
    tableEntryName = '';
  };

  const openDestination = (word: string, starred: boolean): boolean => {
    if (word === 'fonttbl') return ((state.dest = 'fonttbl'), true);
    if (word === 'stylesheet') return ((state.dest = 'stylesheet'), true);
    if (word === 'info') return ((state.dest = 'info'), true);
    if (word === 'title' && state.dest === 'info') return ((state.dest = 'title'), true);
    if (word === 'pict') {
      state.dest = 'pict';
      pictKind = 'unknown';
      pictHex = '';
      pictBinary = [];
      return true;
    }
    if (word === 'pntext' || word === 'listtext') {
      flushBytes();
      state.dest = 'listmarker';
      listMarkerText = '';
      return true;
    }
    if (word === 'fldinst') return ((state.dest = 'skip'), true);
    if (SKIP_DESTINATIONS.has(word) || (starred && !KEEP_STARRED.has(word))) {
      state.dest = 'skip';
      return true;
    }
    return false;
  };

  let groupJustOpened = false;
  let i = 0;
  const n = bytes.length;

  while (i < n) {
    const b = bytes[i]!;

    if (b === 0x7b /* { */) {
      flushBytes();
      stack.push({ ...state });
      groupJustOpened = true;
      i++;
      continue;
    }

    if (b === 0x7d /* } */) {
      flushBytes();
      const closing = state;
      if (closing.dest === 'fonttbl' || closing.dest === 'stylesheet') finishTableEntry();
      if (closing.dest === 'pict') {
        const fromHex = pictHex.length >= 2 ? hexToBytes(pictHex) : new Uint8Array();
        const data = pictBinary.length > 0 ? Uint8Array.from(pictBinary) : fromHex;
        if (data.length > 0) {
          pictures.push({ kind: pictKind, bytes: data, needsRasterising: pictKind !== 'png' && pictKind !== 'jpeg' });
        }
      }
      if (closing.dest === 'listmarker') listMarker = listMarkerText;
      const parent = stack.pop();
      if (parent) {
        // Paragraph properties set inside a group only last for that group.
        state = parent;
      }
      groupJustOpened = false;
      i++;
      continue;
    }

    if (b === 0x5c /* \ */) {
      const next = bytes[i + 1];
      if (next === undefined) break;
      // Control symbols
      if (next === 0x27 /* ' */) {
        const value = parseInt(String.fromCharCode(bytes[i + 2] ?? 0, bytes[i + 3] ?? 0), 16);
        if (!Number.isNaN(value)) {
          if (state.dest === 'pict') pictBinary.push(value);
          else pushByte(value);
        }
        i += 4;
        groupJustOpened = false;
        continue;
      }
      if (next === 0x5c || next === 0x7b || next === 0x7d) {
        pushAscii(next);
        i += 2;
        groupJustOpened = false;
        continue;
      }
      if (next === 0x7e /* ~ */) {
        pushChar(' ');
        i += 2;
        continue;
      }
      if (next === 0x5f /* _ */) {
        pushChar('-');
        i += 2;
        continue;
      }
      if (next === 0x2d /* - optional hyphen */) {
        i += 2;
        continue;
      }
      if (next === 0x2a /* * */) {
        ignorableNext = true;
        i += 2;
        continue;
      }
      if (next === 0x0a || next === 0x0d) {
        if (state.dest === 'body') endParagraph();
        i += 2;
        continue;
      }
      if (!isLetter(next)) {
        i += 2;
        continue;
      }
      // Control word
      let j = i + 1;
      let word = '';
      while (j < n && isLetter(bytes[j]!)) word += String.fromCharCode(bytes[j++]!);
      let param: number | undefined;
      let sign = 1;
      if (bytes[j] === 0x2d) {
        sign = -1;
        j++;
      }
      let digits = '';
      while (j < n && bytes[j]! >= 0x30 && bytes[j]! <= 0x39) digits += String.fromCharCode(bytes[j++]!);
      if (digits.length > 0) param = sign * Number(digits);
      if (bytes[j] === 0x20) j++; // delimiter space belongs to the control word
      i = j;

      const starred = ignorableNext;
      ignorableNext = false;
      if (groupJustOpened || starred) {
        groupJustOpened = false;
        if (openDestination(word, starred)) {
          if (state.dest === 'skip') i = skipGroup(bytes, i, stack, () => (state = stack.pop() ?? state));
          continue;
        }
      }
      groupJustOpened = false;

      if (state.dest === 'pict') {
        if (word in PICTURE_KINDS) pictKind = PICTURE_KINDS[word]!;
        if (word === 'bin' && param !== undefined && param > 0) {
          for (let k = 0; k < param && i + k < n; k++) pictBinary.push(bytes[i + k]!);
          i += param;
        }
        continue;
      }

      if ((state.dest === 'fonttbl' || state.dest === 'stylesheet') && (word === 'f' || word === 's') && param !== undefined) {
        finishTableEntry();
        tableEntryNumber = param;
        continue;
      }
      if (state.dest === 'fonttbl' && word === 'fcharset' && param !== undefined) {
        tableEntryCharset = param;
        continue;
      }

      switch (word) {
        case 'ansicpg':
          if (param !== undefined) ansiCodepage = param;
          break;
        case 'uc':
          if (param !== undefined) state.uc = param;
          break;
        case 'u':
          if (param !== undefined) {
            const code = param < 0 ? param + 65536 : param;
            pushChar(String.fromCharCode(code));
            skipChars = state.uc;
          }
          break;
        case 'f':
          if (param !== undefined && state.dest !== 'fonttbl') {
            flushBytes();
            state.font = param;
          }
          break;
        case 'par':
        case 'sect':
        case 'page':
          if (state.dest === 'body') endParagraph();
          break;
        case 'pard':
          state.outline = undefined;
          state.style = undefined;
          break;
        case 'outlinelevel':
          state.outline = param;
          break;
        case 's':
          if (state.dest === 'body') state.style = param;
          break;
        case 'cell':
          pushChar('\t');
          break;
        case 'row':
          if (state.dest === 'body') endParagraph();
          break;
        default:
          if (word in SYMBOL_WORDS) pushChar(SYMBOL_WORDS[word]!);
          break;
      }
      continue;
    }

    groupJustOpened = false;
    if (b === 0x0d || b === 0x0a) {
      i++;
      continue;
    }
    if (state.dest === 'pict') {
      const ch = String.fromCharCode(b);
      if (/[0-9a-fA-F]/.test(ch)) pictHex += ch;
      i++;
      continue;
    }
    if (b >= 0x80) pushByte(b);
    else pushAscii(b);
    i++;
  }
  flushBytes();
  if (paragraph.trim().length > 0) endParagraph();

  if (stack.length > 0) warnings.push('Unbalanced braces: the file may be truncated.');
  const cleanTitle = title.trim();
  return { blocks, ...(cleanTitle ? { title: cleanTitle } : {}), pictures, codepage: ansiCodepage, warnings };
}

function isLetter(b: number): boolean {
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
}

/** Skips to the end of the current group (the one just opened). Returns the index after its "}". */
function skipGroup(bytes: Uint8Array, start: number, stack: GroupState[], pop: () => void): number {
  let depth = 1;
  let i = start;
  while (i < bytes.length && depth > 0) {
    const b = bytes[i]!;
    if (b === 0x5c) {
      if (bytes[i + 1] === 0x62 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x6e) {
        // \binN inside a skipped group: skip N raw bytes
        let j = i + 4;
        let digits = '';
        while (j < bytes.length && bytes[j]! >= 0x30 && bytes[j]! <= 0x39) digits += String.fromCharCode(bytes[j++]!);
        if (bytes[j] === 0x20) j++;
        i = j + (digits ? Number(digits) : 0);
        continue;
      }
      i += 2;
      continue;
    }
    if (b === 0x7b) depth++;
    else if (b === 0x7d) depth--;
    i++;
  }
  // The group we skipped was pushed on "{"; restore the parent state.
  if (stack.length > 0) pop();
  return i;
}

function hexToBytes(hexText: string): Uint8Array {
  const length = Math.floor(hexText.length / 2);
  const out = new Uint8Array(length);
  for (let k = 0; k < length; k++) out[k] = parseInt(hexText.slice(k * 2, k * 2 + 2), 16);
  return out;
}
