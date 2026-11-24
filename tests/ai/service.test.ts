import { describe, expect, it } from 'vitest';
import { createLedger } from '../../src/ai/ledger';
import type { OnDeviceModel } from '../../src/ai/models';
import { createAiService, type LanguageModelLike } from '../../src/ai/service';
import { runTriage } from '../../src/ai/triage';
import { config, scriptedModel } from './helpers';

const triageInput = { fileName: 'MEMO.DOC', detectedFormat: 'word-97-doc', textSample: 'MEMO 2 March 1994. Stock count complete.', encoding: 'windows-1252' };
const goodTriage = { category: 'memo', summaryLine1: 'Stock count memo.', summaryLine2: 'Totals are attached.', proposedName: '1994-03-02 Stock count memo', language: 'en', readsAsNaturalText: true };

function fakeModel(answers: unknown[]): OnDeviceModel & { initialised: number } {
  const generate = scriptedModel(answers);
  const model = { initialised: 0, generate, async initialize() { model.initialised += 1; } };
  return model;
}

function service(options: { configured?: boolean; state?: string | Error | null; answers?: unknown[] }) {
  const ledger = createLedger();
  const models: ReturnType<typeof fakeModel>[] = [];
  const languageModel: LanguageModelLike | undefined =
    options.state === null ? undefined : { availability: async () => { if (options.state instanceof Error) throw options.state; return (options.state as string) ?? 'available'; } };
  const ai = createAiService({
    configured: options.configured ?? true,
    config: () => config(),
    ledger,
    makeOnDeviceModel: () => {
      const model = fakeModel(options.answers ?? [goodTriage]);
      models.push(model);
      return model;
    },
    languageModel: () => languageModel,
  });
  return { ai, ledger, models };
}

describe('AI service fallbacks', () => {
  it('uses Nano when it is available and reports the ON_DEVICE badge from the model', async () => {
    const { ai, models } = service({});
    const insight = await ai.triage(triageInput);
    expect(insight).toMatchObject({ badge: 'ON_DEVICE', category: 'Memo', proposedName: '1994-03-02 Stock count memo', summary: ['Stock count memo.', 'Totals are attached.'] });
    expect(models[0]!.initialised).toBe(1);
  });

  for (const [label, opts] of [
    ['Firebase not configured', { configured: false }],
    ['no Prompt API in this browser', { state: null }],
    ['Nano unavailable', { state: 'unavailable' }],
    ['Nano still downloadable (never auto-downloads)', { state: 'downloadable' }],
    ['availability() throws', { state: new Error('boom') }],
  ] as const) {
    it(`falls back to deterministic results when ${label}`, async () => {
      const { ai, ledger, models } = service(opts);
      const insight = await ai.triage(triageInput);
      expect(insight.badge).toBe('NO_AI');
      expect(insight.summary).toBeNull();
      const rec = await ai.reconstruct({ sourceText: 'a\nb', runs: ['a', 'b'], language: null });
      expect(rec).toMatchObject({ badge: 'NO_AI', mode: 'raw-fallback' });
      expect(models).toHaveLength(0);
      expect(ledger.entries()).toHaveLength(0);
    });
  }

  it('falls back when Nano keeps returning invalid answers', async () => {
    const { ai } = service({ answers: [{ nonsense: true }] });
    expect((await ai.triage(triageInput)).badge).toBe('NO_AI');
  });

  it('never records on-device work in the cloud ledger', async () => {
    const { ai } = service({ answers: [goodTriage] });
    await ai.triage(triageInput);
    expect(ai.ledger()).toHaveLength(0);
  });

  it('reports nano states', async () => {
    expect(await service({ configured: false }).ai.nanoState()).toBe('not-configured');
    expect(await service({ state: null }).ai.nanoState()).toBe('no-api');
    expect(await service({ state: 'downloading' }).ai.nanoState()).toBe('downloading');
    expect(await service({ state: 'weird' }).ai.nanoState()).toBe('unavailable');
  });
});

describe('triage answers', () => {
  it('marks text that Nano says is garbled', async () => {
    const insight = await runTriage(scriptedModel([{ ...goodTriage, readsAsNaturalText: false }]), triageInput, 1);
    expect(insight?.encodingHint).toContain('may be wrongly decoded');
  });

  it('rejects empty names and summaries', async () => {
    expect(await runTriage(scriptedModel([{ ...goodTriage, proposedName: '---' }]), triageInput, 1)).toBeNull();
    expect(await runTriage(scriptedModel([{ ...goodTriage, summaryLine2: ' ' }]), triageInput, 1)).toBeNull();
  });
});
