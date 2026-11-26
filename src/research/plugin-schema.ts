/**
 * A reader plugin is DECLARATIVE DATA, never code. Cloud Gemini drafts one from public format
 * documentation; Reopen's own interpreter (`interpreter.ts`) reads files with it, and only after
 * the plugin passes local conformance tests (`conformance.ts`).
 *
 * The schema below uses only the subset understood by both Gemini's `responseSchema`
 * (OpenAPI-style: type, properties, required, items, enum, description, nullable, min/maxItems)
 * and ajv, so the same object drives generation and validation.
 */

export type FieldType = 'u8' | 'u16' | 'u32' | 'i16' | 'i32' | 'bytes' | 'text';
export type PluginEncoding = 'windows-1252' | 'shift_jis' | 'euc-jp' | 'utf-8' | 'utf-16le';
export type BlockKind = 'heading' | 'paragraph' | 'list-item';

export const FIELD_TYPES: readonly FieldType[] = ['u8', 'u16', 'u32', 'i16', 'i32', 'bytes', 'text'];
export const PLUGIN_ENCODINGS: readonly PluginEncoding[] = ['windows-1252', 'shift_jis', 'euc-jp', 'utf-8', 'utf-16le'];
export const BLOCK_KINDS: readonly BlockKind[] = ['heading', 'paragraph', 'list-item'];

export interface FieldSpec {
  name: string;
  /** Header fields: absolute byte offset. Record fields: ignored (fields are read one after another). */
  offset?: number | null;
  type: FieldType;
  /** Fixed length in bytes for `bytes` / `text`. */
  length?: number | null;
  /** Name of an earlier numeric field that holds the length in bytes for `bytes` / `text`. */
  lengthFrom?: string | null;
  /** XOR every byte of a `bytes` / `text` field with this value (0–255) before decoding. */
  xor?: number | null;
  /** Encoding for `text` fields; defaults to the plugin's `defaultEncoding`. */
  encoding?: PluginEncoding | null;
}

export interface KindMapping {
  value: number;
  kind: BlockKind;
}

export interface BodySpec {
  kind: 'records' | 'text-block';
  // --- records ---
  /** Byte offset where the first record starts; null = straight after the header. */
  startOffset?: number | null;
  /** Header field holding the number of records. */
  countFrom?: string | null;
  /** Stop after `countFrom` records, or keep reading until the end of the file. */
  until?: 'count' | 'end-of-file' | null;
  recordFields?: FieldSpec[] | null;
  /** Record field whose numeric value says what kind of block the record is. */
  kindField?: string | null;
  kindMap?: KindMapping[] | null;
  /** Record field holding the record's text. */
  textField?: string | null;
  // --- text-block ---
  textOffset?: number | null;
  textOffsetFrom?: string | null;
  textLength?: number | null;
  textLengthFrom?: string | null;
  xor?: number | null;
  encoding?: PluginEncoding | null;
}

export interface ReaderPlugin {
  formatName: string;
  formatVersion: string;
  endianness: 'little' | 'big';
  magic: { offset: number; ascii?: string | null; hex?: string | null };
  defaultEncoding: PluginEncoding;
  /** Size of the fixed header in bytes; null = end of the last header field. */
  headerLength?: number | null;
  header: FieldSpec[];
  body: BodySpec;
  titleField?: string | null;
  dateFields?: { year?: string | null; month?: string | null; day?: string | null } | null;
  /** Short notes from the documentation the reader relied on. */
  notes?: string | null;
}

const fieldSpecSchema = {
  type: 'object',
  description: 'One field. Header fields use absolute offsets; record fields are read one after another.',
  properties: {
    name: { type: 'string', description: 'Field name, unique within the header or the record.' },
    offset: { type: 'integer', nullable: true, description: 'Absolute byte offset (header fields only).' },
    type: { type: 'string', enum: [...FIELD_TYPES] },
    length: { type: 'integer', nullable: true, description: 'Fixed length in bytes for bytes/text fields.' },
    lengthFrom: { type: 'string', nullable: true, description: 'Name of an earlier numeric field holding the length in bytes.' },
    xor: { type: 'integer', nullable: true, description: 'XOR every byte with this value (0-255) before decoding.' },
    encoding: { type: 'string', enum: [...PLUGIN_ENCODINGS], nullable: true },
  },
  required: ['name', 'type'],
};

export const READER_PLUGIN_SCHEMA = {
  type: 'object',
  description: 'A declarative reader for a simple legacy file format. Data only, no code.',
  properties: {
    formatName: { type: 'string' },
    formatVersion: { type: 'string' },
    endianness: { type: 'string', enum: ['little', 'big'] },
    magic: {
      type: 'object',
      description: 'Signature bytes that identify the format. Give ascii or hex.',
      properties: {
        offset: { type: 'integer' },
        ascii: { type: 'string', nullable: true },
        hex: { type: 'string', nullable: true, description: 'Hex bytes, e.g. "51 4E 42 31".' },
      },
      required: ['offset'],
    },
    defaultEncoding: { type: 'string', enum: [...PLUGIN_ENCODINGS] },
    headerLength: { type: 'integer', nullable: true },
    header: { type: 'array', items: fieldSpecSchema, maxItems: 64 },
    body: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['records', 'text-block'] },
        startOffset: { type: 'integer', nullable: true },
        countFrom: { type: 'string', nullable: true },
        until: { type: 'string', enum: ['count', 'end-of-file'], nullable: true },
        recordFields: { type: 'array', items: fieldSpecSchema, nullable: true, maxItems: 32 },
        kindField: { type: 'string', nullable: true },
        kindMap: {
          type: 'array',
          nullable: true,
          maxItems: 32,
          items: {
            type: 'object',
            properties: { value: { type: 'integer' }, kind: { type: 'string', enum: [...BLOCK_KINDS] } },
            required: ['value', 'kind'],
          },
        },
        textField: { type: 'string', nullable: true },
        textOffset: { type: 'integer', nullable: true },
        textOffsetFrom: { type: 'string', nullable: true },
        textLength: { type: 'integer', nullable: true },
        textLengthFrom: { type: 'string', nullable: true },
        xor: { type: 'integer', nullable: true },
        encoding: { type: 'string', enum: [...PLUGIN_ENCODINGS], nullable: true },
      },
      required: ['kind'],
    },
    titleField: { type: 'string', nullable: true },
    dateFields: {
      type: 'object',
      nullable: true,
      properties: {
        year: { type: 'string', nullable: true },
        month: { type: 'string', nullable: true },
        day: { type: 'string', nullable: true },
      },
    },
    notes: { type: 'string', nullable: true },
  },
  required: ['formatName', 'formatVersion', 'endianness', 'magic', 'defaultEncoding', 'header', 'body'],
} as const;

const CLOUD_DROPPED_KEYS = new Set(['maxItems', 'minItems', 'description', 'nullable']);

/**
 * A lighter copy of a schema for Gemini's constrained decoding. The full schema got HTTP 400
 * "The specified schema produces a constraint that has too many states for serving" (first real
 * call, 2026-11-26). This copy keeps every property, type, enum and required list. It drops array
 * limits, descriptions and `nullable`, so the model leaves out absent fields instead. The answer
 * is still validated locally against the FULL schema plus `semanticProblems`.
 */
export function toCloudSchema(schema: object): object {
  const strip = (value: unknown, isPropertyMap: boolean): unknown => {
    if (Array.isArray(value)) return value.map((item) => strip(item, false));
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (!isPropertyMap && CLOUD_DROPPED_KEYS.has(key)) continue;
      out[key] = strip(child, !isPropertyMap && key === 'properties');
    }
    return out;
  };
  return strip(schema, false) as object;
}

/** What the format researcher sends as `responseSchema` (and what the Privacy Ledger shows). */
export const CLOUD_READER_SCHEMA = toCloudSchema(READER_PLUGIN_SCHEMA);

const NUMERIC: ReadonlySet<FieldType> = new Set(['u8', 'u16', 'u32', 'i16', 'i32']);
export const isNumericType = (type: FieldType): boolean => NUMERIC.has(type);

/**
 * Checks that go beyond the JSON schema: references point at earlier numeric fields, names are
 * unique, the magic is usable. Returns human-readable problems (empty = fine).
 */
export function semanticProblems(plugin: ReaderPlugin): string[] {
  const problems: string[] = [];
  const magicAscii = plugin.magic.ascii ?? '';
  const magicHex = (plugin.magic.hex ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (!magicAscii && magicHex.length < 2) problems.push('magic needs ascii or hex bytes');
  if (magicHex.length % 2 === 1) problems.push('magic.hex has an odd number of digits');
  if (plugin.magic.offset < 0) problems.push('magic.offset must not be negative');

  const checkFields = (fields: readonly FieldSpec[], where: string, outer: Map<string, FieldType>, absolute: boolean): Map<string, FieldType> => {
    const seen = new Map<string, FieldType>();
    for (const field of fields) {
      if (!field.name.trim()) problems.push(`${where}: a field has no name`);
      if (seen.has(field.name)) problems.push(`${where}: duplicate field "${field.name}"`);
      if (absolute && (field.offset === null || field.offset === undefined || field.offset < 0)) {
        problems.push(`${where}: field "${field.name}" needs a non-negative offset`);
      }
      if (!isNumericType(field.type)) {
        const ref = field.lengthFrom ?? null;
        if ((field.length === null || field.length === undefined) && !ref) problems.push(`${where}: field "${field.name}" needs length or lengthFrom`);
        if (field.length !== null && field.length !== undefined && field.length < 0) problems.push(`${where}: field "${field.name}" has a negative length`);
        if (ref) {
          const refType = seen.get(ref) ?? outer.get(ref);
          if (!refType) problems.push(`${where}: field "${field.name}" takes its length from unknown or later field "${ref}"`);
          else if (!isNumericType(refType)) problems.push(`${where}: field "${field.name}" takes its length from non-numeric field "${ref}"`);
        }
      }
      if (field.xor !== null && field.xor !== undefined && (field.xor < 0 || field.xor > 255)) problems.push(`${where}: field "${field.name}" xor must be 0-255`);
      seen.set(field.name, field.type);
    }
    return seen;
  };

  const header = checkFields(plugin.header, 'header', new Map(), true);
  const body = plugin.body;
  if (body.kind === 'records') {
    const fields = body.recordFields ?? [];
    if (fields.length === 0) problems.push('records body needs recordFields');
    const record = checkFields(fields, 'record', header, false);
    if (!body.textField || record.get(body.textField) !== 'text') problems.push('records body needs textField naming a text record field');
    if (body.kindField && !isNumericType(record.get(body.kindField) ?? 'text')) problems.push('kindField must name a numeric record field');
    const until = body.until ?? (body.countFrom ? 'count' : 'end-of-file');
    if (until === 'count' && (!body.countFrom || !isNumericType(header.get(body.countFrom) ?? 'text'))) {
      problems.push('until "count" needs countFrom naming a numeric header field');
    }
    const values = new Set<number>();
    for (const mapping of body.kindMap ?? []) {
      if (values.has(mapping.value)) problems.push(`kindMap lists value ${mapping.value} twice`);
      values.add(mapping.value);
    }
  } else {
    if (body.textOffsetFrom && !isNumericType(header.get(body.textOffsetFrom) ?? 'text')) problems.push('textOffsetFrom must name a numeric header field');
    if (body.textLengthFrom && !isNumericType(header.get(body.textLengthFrom) ?? 'text')) problems.push('textLengthFrom must name a numeric header field');
    if (body.xor !== null && body.xor !== undefined && (body.xor < 0 || body.xor > 255)) problems.push('body.xor must be 0-255');
  }
  for (const name of [plugin.titleField, plugin.dateFields?.year, plugin.dateFields?.month, plugin.dateFields?.day]) {
    if (name && !header.has(name)) problems.push(`"${name}" is not a header field`);
  }
  return problems;
}
