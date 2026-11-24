import { describe, expect, it } from 'vitest';
import { compileSchema, extractJson, generateStructured } from '../../src/ai/structured';
import { scriptedModel } from './helpers';

const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
const validate = compileSchema<{ name: string }>(schema);

describe('generateStructured (shared by the on-device and cloud paths)', () => {
  it('accepts a valid answer first time', async () => {
    const model = scriptedModel([{ name: 'memo' }]);
    const result = await generateStructured({ generate: model, prompt: 'p', validate, maxAttempts: 3 });
    expect(result).toMatchObject({ ok: true, data: { name: 'memo' }, attempts: 1, badge: 'ON_DEVICE' });
  });

  it('retries after invalid JSON and after a schema violation, feeding the error back', async () => {
    const model = scriptedModel(['not json', { nom: 'x' }, { name: 'ok' }]);
    const result = await generateStructured({ generate: model, prompt: 'p', validate, maxAttempts: 3 });
    expect(result).toMatchObject({ ok: true, attempts: 3 });
    expect(model.prompts[1]).toContain('not valid JSON');
    expect(model.prompts[2]).toContain('name');
  });

  it('gives up after maxAttempts invalid answers', async () => {
    const model = scriptedModel([{ wrong: 1 }]);
    const result = await generateStructured({ generate: model, prompt: 'p', validate, maxAttempts: 3 });
    expect(result).toMatchObject({ ok: false, attempts: 3, modelError: false });
    expect(model.prompts).toHaveLength(3);
  });

  it('does not retry when the model itself fails (e.g. Nano unavailable)', async () => {
    const model = scriptedModel([new Error('on-device model unavailable')]);
    const result = await generateStructured({ generate: model, prompt: 'p', validate, maxAttempts: 3 });
    expect(result).toMatchObject({ ok: false, attempts: 1, modelError: true });
  });

  it('applies the semantic check and retries with its message', async () => {
    const model = scriptedModel([{ name: '' }, { name: 'fine' }]);
    const result = await generateStructured({
      generate: model,
      prompt: 'p',
      validate,
      maxAttempts: 2,
      check: (data) => (data.name ? null : 'name must not be empty'),
    });
    expect(result.ok).toBe(true);
    expect(model.prompts[1]).toContain('name must not be empty');
  });

  it('extracts JSON from a Markdown fence only', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson(' {"a":1} ')).toBe('{"a":1}');
  });
});
