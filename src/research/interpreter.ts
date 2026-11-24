import { isNumericType, type BlockKind, type FieldSpec, type PluginEncoding, type ReaderPlugin } from './plugin-schema';

/**
 * Reopen's own, deterministic interpreter for declarative reader plugins. It never executes
 * anything from the plugin; it only reads fields at offsets the plugin names, with strict
 * bounds checks and hard caps, and it never throws (problems are returned as `errors`).
 */

export const MAX_RECORDS = 100_000;
export const MAX_FIELD_BYTES = 1_000_000;
export const MAX_TOTAL_TEXT = 10_000_000;

export interface PluginBlock {
  kind: BlockKind;
  text: string;
}

export interface PluginReadResult {
  ok: boolean;
  blocks: PluginBlock[];
  title?: string;
  date?: string;
  fields: Record<string, string | number>;
  warnings: string[];
  errors: string[];
  /** Highest byte offset read (exclusive). */
  bytesConsumed: number;
  recordCount: number;
  /** Header value of `countFrom`, when the plugin declares one. */
  declaredCount?: number;
  /** True when a read went past the end of the file or used an impossible offset/length. */
  outOfBounds: boolean;
}

const SUPPORTED: ReadonlySet<string> = new Set<PluginEncoding>(['windows-1252', 'shift_jis', 'euc-jp', 'utf-8', 'utf-16le']);

class ReadError extends Error {
  constructor(
    message: string,
    readonly outOfBounds: boolean,
  ) {
    super(message);
  }
}

function decodeText(bytes: Uint8Array, encoding: string): string {
  if (!SUPPORTED.has(encoding)) throw new ReadError(`unsupported encoding "${encoding}"`, false);
  const text = new TextDecoder(encoding, { fatal: false }).decode(bytes);
  return text.replace(/\u0000+$/u, '');
}

interface Cursor {
  bytes: Uint8Array;
  view: DataView;
  little: boolean;
  maxRead: number;
}

const sizeOfNumeric = (type: FieldSpec['type']): number => (type === 'u8' ? 1 : type === 'u16' || type === 'i16' ? 2 : 4);

function checkRange(cursor: Cursor, offset: number, length: number, what: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ReadError(`${what}: invalid offset ${offset}`, true);
  if (!Number.isSafeInteger(length) || length < 0) throw new ReadError(`${what}: invalid length ${length}`, true);
  if (length > MAX_FIELD_BYTES) throw new ReadError(`${what}: length ${length} exceeds the ${MAX_FIELD_BYTES}-byte limit`, true);
  if (offset + length > cursor.bytes.length) {
    throw new ReadError(`${what}: bytes ${offset}–${offset + length} are past the end of the file (${cursor.bytes.length} bytes)`, true);
  }
  cursor.maxRead = Math.max(cursor.maxRead, offset + length);
}

function readNumber(cursor: Cursor, type: FieldSpec['type'], offset: number, what: string): number {
  checkRange(cursor, offset, sizeOfNumeric(type), what);
  switch (type) {
    case 'u8':
      return cursor.view.getUint8(offset);
    case 'u16':
      return cursor.view.getUint16(offset, cursor.little);
    case 'i16':
      return cursor.view.getInt16(offset, cursor.little);
    case 'u32':
      return cursor.view.getUint32(offset, cursor.little);
    default:
      return cursor.view.getInt32(offset, cursor.little);
  }
}

function resolveLength(field: FieldSpec, scopes: ReadonlyArray<Record<string, string | number>>, what: string): number {
  if (field.lengthFrom) {
    for (const scope of scopes) {
      const value = scope[field.lengthFrom];
      if (typeof value === 'number') return value;
      if (value !== undefined) throw new ReadError(`${what}: length field "${field.lengthFrom}" is not a number`, false);
    }
    throw new ReadError(`${what}: length field "${field.lengthFrom}" was not read before this field`, false);
  }
  if (typeof field.length === 'number') return field.length;
  throw new ReadError(`${what}: no length given`, false);
}

function applyXor(bytes: Uint8Array, xor: number | null | undefined): Uint8Array {
  if (xor === null || xor === undefined || xor === 0) return bytes;
  const key = xor & 0xff;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ key;
  return out;
}

/** Reads one field; returns its value and the offset just after it. */
function readField(
  cursor: Cursor,
  plugin: ReaderPlugin,
  field: FieldSpec,
  offset: number,
  scopes: ReadonlyArray<Record<string, string | number>>,
  what: string,
): { value: string | number; end: number } {
  if (isNumericType(field.type)) {
    const value = readNumber(cursor, field.type, offset, what);
    return { value, end: offset + sizeOfNumeric(field.type) };
  }
  const length = resolveLength(field, scopes, what);
  checkRange(cursor, offset, length, what);
  const raw = applyXor(cursor.bytes.subarray(offset, offset + length), field.xor);
  if (field.type === 'bytes') {
    return { value: Array.from(raw.subarray(0, 64), (b) => b.toString(16).padStart(2, '0')).join(' '), end: offset + length };
  }
  return { value: decodeText(raw, field.encoding ?? plugin.defaultEncoding), end: offset + length };
}

function splitParagraphs(text: string): PluginBlock[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ kind: 'paragraph' as const, text: line }));
}

function magicMatches(plugin: ReaderPlugin, bytes: Uint8Array): boolean {
  const offset = plugin.magic.offset;
  let expected: number[];
  if (plugin.magic.hex) {
    const digits = plugin.magic.hex.replace(/[^0-9a-fA-F]/g, '');
    expected = [];
    for (let i = 0; i + 1 < digits.length; i += 2) expected.push(parseInt(digits.slice(i, i + 2), 16));
  } else {
    expected = Array.from(plugin.magic.ascii ?? '', (ch) => ch.charCodeAt(0) & 0xff);
  }
  if (expected.length === 0 || !Number.isSafeInteger(offset) || offset < 0 || offset + expected.length > bytes.length) return false;
  return expected.every((b, i) => bytes[offset + i] === b);
}

export { magicMatches };

export function readWithPlugin(plugin: ReaderPlugin, bytes: Uint8Array): PluginReadResult {
  const result: PluginReadResult = {
    ok: false,
    blocks: [],
    fields: {},
    warnings: [],
    errors: [],
    bytesConsumed: 0,
    recordCount: 0,
    outOfBounds: false,
  };
  const cursor: Cursor = {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    little: plugin?.endianness !== 'big',
    maxRead: 0,
  };

  try {
    if (!magicMatches(plugin, bytes)) result.errors.push('the signature bytes (magic) do not match');

    // Header: absolute offsets.
    let headerEnd = 0;
    for (const field of plugin.header ?? []) {
      const what = `header field "${field.name}"`;
      const offset = field.offset ?? -1;
      const { value, end } = readField(cursor, plugin, field, offset, [result.fields], what);
      result.fields[field.name] = value;
      headerEnd = Math.max(headerEnd, end);
    }
    if (typeof plugin.headerLength === 'number') {
      checkRange(cursor, 0, plugin.headerLength, 'header');
      if (headerEnd > plugin.headerLength) {
        throw new ReadError(`a header field ends at byte ${headerEnd}, past the declared header length ${plugin.headerLength}`, true);
      }
      headerEnd = plugin.headerLength;
    }

    const body = plugin.body;
    let totalText = 0;
    if (body.kind === 'records') {
      const fields = body.recordFields ?? [];
      if (fields.length === 0) throw new ReadError('records body has no recordFields', false);
      const until = body.until ?? (body.countFrom ? 'count' : 'end-of-file');
      let declared: number | undefined;
      if (body.countFrom) {
        const value = result.fields[body.countFrom];
        if (typeof value !== 'number') throw new ReadError(`count field "${body.countFrom}" is not a numeric header field`, false);
        declared = value;
        result.declaredCount = value;
      }
      if (until === 'count' && declared === undefined) throw new ReadError('until "count" needs countFrom', false);
      const kindMap = new Map((body.kindMap ?? []).map((m) => [m.value, m.kind] as const));
      let offset = typeof body.startOffset === 'number' ? body.startOffset : headerEnd;
      if (!Number.isSafeInteger(offset) || offset < 0) throw new ReadError(`records start at an invalid offset ${offset}`, true);
      if (typeof body.startOffset === 'number') checkRange(cursor, 0, offset, 'records start');

      while (until === 'count' ? result.recordCount < (declared ?? 0) : offset < bytes.length) {
        if (result.recordCount >= MAX_RECORDS) throw new ReadError(`more than ${MAX_RECORDS} records`, false);
        const record: Record<string, string | number> = {};
        const recordStart = offset;
        for (const field of fields) {
          const what = `record ${result.recordCount + 1} field "${field.name}"`;
          const { value, end } = readField(cursor, plugin, field, offset, [record, result.fields], what);
          record[field.name] = value;
          offset = end;
        }
        if (offset === recordStart && until === 'end-of-file') {
          throw new ReadError(`record ${result.recordCount + 1} is empty, so the file would never end`, false);
        }
        result.recordCount++;
        const text = body.textField ? record[body.textField] : undefined;
        if (typeof text !== 'string') throw new ReadError(`record ${result.recordCount}: textField "${body.textField ?? ''}" is not a text field`, false);
        totalText += text.length;
        if (totalText > MAX_TOTAL_TEXT) throw new ReadError('more than 10 million characters of text', false);
        let kind: BlockKind = 'paragraph';
        if (body.kindField) {
          const code = record[body.kindField];
          const mapped = typeof code === 'number' ? kindMap.get(code) : undefined;
          if (mapped) kind = mapped;
          else result.warnings.push(`record ${result.recordCount}: unknown kind ${String(code)}, shown as a paragraph`);
        }
        result.blocks.push({ kind, text });
      }
      if (declared !== undefined && until === 'end-of-file' && declared !== result.recordCount) {
        result.warnings.push(`the header says ${declared} records but ${result.recordCount} were found`);
      }
    } else {
      const offset = body.textOffsetFrom ? result.fields[body.textOffsetFrom] : (body.textOffset ?? headerEnd);
      if (typeof offset !== 'number') throw new ReadError(`text offset field "${body.textOffsetFrom ?? ''}" is not a number`, false);
      const lengthValue = body.textLengthFrom ? result.fields[body.textLengthFrom] : (body.textLength ?? bytes.length - offset);
      if (typeof lengthValue !== 'number') throw new ReadError(`text length field "${body.textLengthFrom ?? ''}" is not a number`, false);
      checkRange(cursor, offset, lengthValue, 'text block');
      const text = decodeText(applyXor(bytes.subarray(offset, offset + lengthValue), body.xor), body.encoding ?? plugin.defaultEncoding);
      result.blocks = splitParagraphs(text);
    }

    if (plugin.titleField) {
      const title = result.fields[plugin.titleField];
      if (typeof title === 'string' && title.trim()) result.title = title.trim();
    }
    const dates = plugin.dateFields;
    if (dates?.year) {
      const y = result.fields[dates.year];
      const m = dates.month ? result.fields[dates.month] : 1;
      const d = dates.day ? result.fields[dates.day] : 1;
      if (typeof y === 'number' && typeof m === 'number' && typeof d === 'number' && y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        result.date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      } else {
        result.warnings.push('the date fields do not hold a valid date');
      }
    }
  } catch (error) {
    if (error instanceof ReadError) {
      result.errors.push(error.message);
      if (error.outOfBounds) result.outOfBounds = true;
    } else {
      result.errors.push(`the reader could not be applied: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result.bytesConsumed = cursor.maxRead;
  result.ok = result.errors.length === 0;
  return result;
}
