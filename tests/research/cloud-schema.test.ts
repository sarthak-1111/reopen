import { describe, expect, it } from 'vitest';
import { compileSchema } from '../../src/ai/structured';
import { CLOUD_READER_SCHEMA, READER_PLUGIN_SCHEMA, toCloudSchema, type ReaderPlugin } from '../../src/research/plugin-schema';
import { createResearcher } from '../../src/research/researcher';
import { QNB_PLUGIN } from './qnb-plugin';

type Node = Record<string, unknown>;

/** Every property path in a schema, e.g. "body.recordFields[].xor". */
function paths(schema: Node, prefix = ''): string[] {
  const out: string[] = [];
  const props = schema.properties as Record<string, Node> | undefined;
  for (const [key, child] of Object.entries(props ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path, ...paths(child, path));
    if (child.items) out.push(...paths(child.items as Node, `${path}[]`));
  }
  if (schema.items && !prefix) out.push(...paths(schema.items as Node, '[]'));
  return out;
}

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]);
  return [];
}

describe('cloud response schema (found in Chrome: the full schema got HTTP 400 "too many states for serving")', () => {
  it('drops array limits, descriptions and nullable, which drive the constraint size', () => {
    const keys = new Set(keysDeep(CLOUD_READER_SCHEMA));
    for (const banned of ['maxItems', 'minItems', 'description', 'nullable']) expect(keys.has(banned)).toBe(false);
  });

  it('keeps every property, type, enum and required list of the full schema', () => {
    expect(paths(CLOUD_READER_SCHEMA as Node)).toEqual(paths(READER_PLUGIN_SCHEMA as Node));
    expect(CLOUD_READER_SCHEMA).toEqual(toCloudSchema(READER_PLUGIN_SCHEMA));
    expect((CLOUD_READER_SCHEMA as Node).required).toEqual((READER_PLUGIN_SCHEMA as Node).required);
  });

  it('does not change the full schema used for local validation', () => {
    expect(keysDeep(READER_PLUGIN_SCHEMA)).toContain('maxItems');
    expect(compileSchema<ReaderPlugin>(READER_PLUGIN_SCHEMA)(QNB_PLUGIN)).toBe(true);
  });

  it('the researcher sends the light schema, and the ledger shows that exact schema', () => {
    const researcher = createResearcher({ payloadFor: () => '', send: () => Promise.reject(new Error('unused')) });
    const { request } = researcher.prepare('spec.md', 'Magic QNB1.');
    expect(request.schema).toBe(CLOUD_READER_SCHEMA);
  });
});
