import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compileSchema } from '../../src/ai/structured';
import { runConformance } from '../../src/research/conformance';
import { readWithPlugin } from '../../src/research/interpreter';
import { FIELD_TYPES, PLUGIN_ENCODINGS, READER_PLUGIN_SCHEMA, semanticProblems, type FieldSpec, type ReaderPlugin } from '../../src/research/plugin-schema';
import { parsePlugin } from '../../src/research/researcher';
import { manifest, sampleBytes } from '../helpers';
import { QNB_PLUGIN, clonePlugin } from './qnb-plugin';

const mystery = manifest().filter((m) => m.path.startsWith('mystery/'));
const samples = mystery.map((m) => ({ name: m.path, bytes: sampleBytes(m.path) }));
const validate = compileSchema<ReaderPlugin>(READER_PLUGIN_SCHEMA);

describe('reader plugin schema', () => {
  it('accepts the hand-written QNB plugin, with no semantic problems', () => {
    expect(validate(QNB_PLUGIN)).toBe(true);
    expect(semanticProblems(QNB_PLUGIN)).toEqual([]);
  });

  it('rejects broken plugins with readable problems', () => {
    const later = clonePlugin();
    later.header[7]!.lengthFrom = 'nope';
    expect(semanticProblems(later).join(' ')).toMatch(/unknown or later field "nope"/);
    expect(parsePlugin('not json').code).toBe('invalid-json');
    expect(parsePlugin(JSON.stringify({ formatName: 'x' })).code).toBe('invalid-plugin');
    expect(parsePlugin('```json\n' + JSON.stringify(QNB_PLUGIN) + '\n```').plugin).toBeDefined();
  });
});

describe('QNB plugin on the self-made mystery samples', () => {
  it('passes every conformance check and reads the expected text', () => {
    expect(samples.length).toBe(3);
    const report = runConformance(QNB_PLUGIN, samples, { knownText: 'Spring planting' });
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    for (const m of mystery) {
      const read = readWithPlugin(QNB_PLUGIN, sampleBytes(m.path));
      expect(read.ok).toBe(true);
      expect(read.title).toBe(m.title);
      const text = read.blocks.map((b) => b.text).join('\n');
      for (const expected of m.includes ?? []) expect(text).toContain(expected);
      expect(read.bytesConsumed).toBe(m.bytes);
      expect(read.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const garden = readWithPlugin(QNB_PLUGIN, sampleBytes('mystery/garden-plan.qnb'));
    expect(garden.blocks[0]).toEqual({ kind: 'heading', text: 'Spring planting' });
    expect(garden.blocks.some((b) => b.kind === 'list-item')).toBe(true);
  });

  it('fails when the XOR transform is missing', () => {
    const plugin = clonePlugin();
    plugin.header[7]!.xor = null;
    plugin.body.recordFields![2]!.xor = null;
    const report = runConformance(plugin, samples);
    expect(report.passed).toBe(false);
    expect(report.checks.some((c) => c.id === 'plausible' && !c.passed)).toBe(true);
  });

  it('a one-bit XOR mistake slips past plausibility but is caught by the known-text check', () => {
    const plugin = clonePlugin();
    plugin.header[7]!.xor = 0x5b;
    plugin.body.recordFields![2]!.xor = 0x5b;
    // Documented limitation: letters stay letters, so plausibility alone passes.
    expect(runConformance(plugin, samples).passed).toBe(true);
    const report = runConformance(plugin, samples, { knownText: 'Spring planting' });
    expect(report.passed).toBe(false);
    expect(report.checks.find((c) => c.id === 'known-text')?.passed).toBe(false);
  });

  it('fails with a wrong offset', () => {
    const plugin = clonePlugin();
    plugin.header[6]!.offset = 14; // titleLength read from the wrong byte
    const report = runConformance(plugin, samples);
    expect(report.passed).toBe(false);
    expect(report.checks.some((c) => c.id === 'bounds' && !c.passed)).toBe(true);

    // Same mistake without a declared header length: the records are then misaligned.
    const loose = clonePlugin();
    loose.header[6]!.offset = 14;
    loose.headerLength = null;
    expect(runConformance(loose, samples).passed).toBe(false);
  });

  it('fails with the record fields in the wrong order', () => {
    const plugin = clonePlugin();
    const [type, length, text] = plugin.body.recordFields!;
    plugin.body.recordFields = [length!, type!, text!];
    expect(runConformance(plugin, samples).passed).toBe(false);
  });

  it('fails with the wrong endianness', () => {
    const plugin = clonePlugin();
    plugin.endianness = 'big';
    const report = runConformance(plugin, samples);
    expect(report.passed).toBe(false);
    expect(report.checks.some((c) => (c.id === 'bounds' || c.id === 'parses') && !c.passed)).toBe(true);
  });

  it('fails with the wrong magic, and with no samples', () => {
    const plugin = clonePlugin();
    plugin.magic = { offset: 0, ascii: 'QNB2', hex: null };
    expect(runConformance(plugin, samples).checks.some((c) => c.id === 'magic' && !c.passed)).toBe(true);
    expect(runConformance(QNB_PLUGIN, []).passed).toBe(false);
  });
});

// ---- property: the interpreter never throws ----

const names = ['a', 'b', 'len', 'count', 'text', 'kind', 'title', 'year'];
const fieldArb = (withOffset: boolean): fc.Arbitrary<FieldSpec> =>
  fc.record({
    name: fc.constantFrom(...names),
    offset: withOffset ? fc.oneof(fc.integer({ min: -5, max: 300 }), fc.constant(null)) : fc.constant(null),
    type: fc.constantFrom(...FIELD_TYPES),
    length: fc.oneof(fc.integer({ min: -3, max: 2_000_000 }), fc.constant(null)),
    lengthFrom: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
    xor: fc.oneof(fc.integer({ min: -10, max: 400 }), fc.constant(null)),
    encoding: fc.oneof(fc.constantFrom(...PLUGIN_ENCODINGS), fc.constant(null)),
  });

const pluginArb: fc.Arbitrary<ReaderPlugin> = fc.record({
  formatName: fc.string(),
  formatVersion: fc.string(),
  endianness: fc.constantFrom('little' as const, 'big' as const),
  magic: fc.record({ offset: fc.integer({ min: -2, max: 64 }), ascii: fc.oneof(fc.string({ maxLength: 6 }), fc.constant(null)), hex: fc.oneof(fc.string({ unit: fc.constantFrom(...'0123456789abcdefAF '.split('')), maxLength: 12 }), fc.constant(null)) }),
  defaultEncoding: fc.constantFrom(...PLUGIN_ENCODINGS),
  headerLength: fc.oneof(fc.integer({ min: -5, max: 400 }), fc.constant(null)),
  header: fc.array(fieldArb(true), { maxLength: 8 }),
  body: fc.record({
    kind: fc.constantFrom('records' as const, 'text-block' as const),
    startOffset: fc.oneof(fc.integer({ min: -5, max: 300 }), fc.constant(null)),
    countFrom: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
    until: fc.oneof(fc.constantFrom('count' as const, 'end-of-file' as const), fc.constant(null)),
    recordFields: fc.oneof(fc.array(fieldArb(false), { maxLength: 5 }), fc.constant(null)),
    kindField: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
    kindMap: fc.oneof(fc.array(fc.record({ value: fc.integer({ min: -2, max: 10 }), kind: fc.constantFrom('heading' as const, 'paragraph' as const, 'list-item' as const) }), { maxLength: 4 }), fc.constant(null)),
    textField: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
    textOffset: fc.oneof(fc.integer({ min: -5, max: 300 }), fc.constant(null)),
    textOffsetFrom: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
    textLength: fc.oneof(fc.integer({ min: -5, max: 2_000_000 }), fc.constant(null)),
    textLengthFrom: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
    xor: fc.oneof(fc.integer({ min: 0, max: 255 }), fc.constant(null)),
    encoding: fc.oneof(fc.constantFrom(...PLUGIN_ENCODINGS), fc.constant(null)),
  }),
  titleField: fc.oneof(fc.constantFrom(...names), fc.constant(null)),
  dateFields: fc.oneof(fc.record({ year: fc.oneof(fc.constantFrom(...names), fc.constant(null)) }), fc.constant(null)),
  notes: fc.constant(null),
});

describe('interpreter robustness (property)', () => {
  it('never throws on random bytes × random plugins, and stays within the file', () => {
    fc.assert(
      fc.property(pluginArb, fc.uint8Array({ maxLength: 400 }), (plugin, bytes) => {
        const read = readWithPlugin(plugin, bytes);
        expect(read.bytesConsumed).toBeLessThanOrEqual(bytes.length);
        expect(read.ok).toBe(read.errors.length === 0);
        expect(() => runConformance(plugin, [{ name: 'x', bytes }])).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });

  it('never throws on random bytes with the real QNB plugin', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), (tail) => {
        const bytes = new Uint8Array([0x51, 0x4e, 0x42, 0x31, ...tail]);
        const read = readWithPlugin(QNB_PLUGIN, bytes);
        expect(read.bytesConsumed).toBeLessThanOrEqual(bytes.length);
      }),
      { numRuns: 400 },
    );
  });
});
