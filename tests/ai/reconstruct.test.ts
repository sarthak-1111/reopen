import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkNoInvention, tokenize } from '../../src/core/no-invention';
import type { GenResult } from '../../src/ai/models';
import { chunkText, runReconstruction } from '../../src/ai/reconstruct';
import { promptText, scriptedModel } from './helpers';

const options = { chunkChars: 400, maxAttempts: 2 };
const outputText = (blocks: { text: string }[]): string => blocks.map((b) => b.text).join('\n');

const word = fc.oneof(
  fc.stringMatching(/^[a-z]{2,9}$/),
  fc.constantFrom('Quarterly', 'report', 'Osaka', 'office', '在庫', '報告書', 'Müller', 'ÉTÉ', 'naïve'),
);
const sourceText = fc.array(fc.array(word, { minLength: 1, maxLength: 9 }).map((w) => w.join(' ')), { minLength: 1, maxLength: 12 }).map((lines) => lines.join('\n'));

describe('reconstruction under the no-invention rule', () => {
  it('uses an answer that only reorders and structures recovered text', async () => {
    const model = scriptedModel([{ blocks: [{ kind: 'heading', text: 'Stock count' }, { kind: 'paragraph', text: 'Totals attached for the office' }] }]);
    const result = await runReconstruction(model, 'attached for the office\nStock count\nTotals', options);
    expect(result).toMatchObject({ mode: 'ai-structured', badge: 'ON_DEVICE', noInvention: { ok: true } });
  });

  it('rejects an answer that adds a word, retries, then falls back to the raw text', async () => {
    const model = scriptedModel([{ blocks: [{ kind: 'paragraph', text: 'Stock count totals are attached' }] }]);
    const result = await runReconstruction(model, 'Stock count\nTotals attached', options);
    expect(result.mode).toBe('raw-fallback');
    expect(result.noInvention.ok).toBe(false);
    expect(result.noInvention.inventedTokens).toContain('are');
    expect(outputText(result.blocks)).toBe('Stock count\nTotals attached');
    expect(model.prompts[1]).toContain('not in the text');
  });

  it('falls back to raw text, labelled NO_AI, when Nano is unavailable', async () => {
    const model = scriptedModel([new Error('unavailable')]);
    const result = await runReconstruction(model, 'line one\nline two', options);
    expect(result).toMatchObject({ mode: 'raw-fallback', badge: 'NO_AI' });
  });

  it('property: a model that only shuffles and regroups words always passes, and its output passes the checker', async () => {
    await fc.assert(
      fc.asyncProperty(sourceText, fc.integer({ min: 0, max: 1000 }), async (text, seed) => {
        const shuffle = async (prompt: string): Promise<GenResult> => {
          const words = promptText(prompt).split(/\s+/).filter(Boolean);
          const rotated = words.map((_, i) => words[(i + seed) % words.length]!);
          const half = Math.ceil(rotated.length / 2);
          const blocks = [{ kind: 'heading', text: rotated.slice(0, half).join(' ') }];
          if (rotated.length > half) blocks.push({ kind: 'paragraph', text: rotated.slice(half).join(' ') });
          return { text: JSON.stringify({ blocks }), badge: 'ON_DEVICE' };
        };
        const result = await runReconstruction(shuffle, text, { chunkChars: 120, maxAttempts: 1 });
        expect(result.mode).toBe('ai-structured');
        expect(checkNoInvention(text, outputText(result.blocks)).ok).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('property: no invented word ever reaches the output', async () => {
    const newWord = fc.stringMatching(/^[a-z]{3,8}$/).map((w) => `zq${w}`);
    await fc.assert(
      fc.asyncProperty(sourceText, newWord, async (text, extra) => {
        const inventive = async (prompt: string): Promise<GenResult> => ({
          text: JSON.stringify({ blocks: [{ kind: 'paragraph', text: `${promptText(prompt)} ${extra}` }] }),
          badge: 'ON_DEVICE',
        });
        const result = await runReconstruction(inventive, text, { chunkChars: 120, maxAttempts: 2 });
        expect(result.mode).toBe('raw-fallback');
        const sourceTokens = new Set(tokenize(text));
        for (const token of tokenize(outputText(result.blocks))) expect(sourceTokens.has(token)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('chunks long text at line boundaries without losing characters', () => {
    fc.assert(
      fc.property(sourceText, fc.integer({ min: 20, max: 200 }), (text, size) => {
        const chunks = chunkText(text, size);
        for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(size);
        expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
      }),
    );
  });
});
