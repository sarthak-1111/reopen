import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCloudGate } from '../../src/ai/cloud-gate';
import { createConsentStore } from '../../src/ai/consent';
import { createLedger } from '../../src/ai/ledger';
import type { Generate } from '../../src/ai/models';
import { createTaintRegistry } from '../../src/ai/taint';
import { readWithPlugin } from '../../src/research/interpreter';
import { createResearcher } from '../../src/research/researcher';
import { createResearcherController, laneStatus } from '../../src/ui/researcher-panel';
import { config, scriptedModel } from '../ai/helpers';
import { ROOT, manifest, sampleBytes } from '../helpers';
import { QNB_PLUGIN } from './qnb-plugin';

const SPEC_TEXT = readFileSync(join(ROOT, 'docs', 'specs', 'quillstone-notebook-qnb.md'), 'utf8');
const mystery = manifest().filter((m) => m.path.startsWith('mystery/'));
const samples = mystery.map((m) => ({ name: m.path, bytes: sampleBytes(m.path) }));

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function setup(options: { lane?: boolean; online?: boolean; answers?: Array<unknown | Error> } = {}) {
  const ledger = createLedger();
  const consent = createConsentStore();
  const taint = createTaintRegistry();
  // The app fingerprints every loaded file before any AI work; do the same with the samples.
  for (const s of samples) {
    const read = readWithPlugin(QNB_PLUGIN, s.bytes);
    taint.registerFile(s.bytes, [read.title ?? '', ...read.blocks.map((b) => b.text)].join('\n'));
  }
  const model = scriptedModel(options.answers ?? [QNB_PLUGIN], 'CLOUD');
  const factoryCalls: string[] = [];
  const gate = createCloudGate({
    config: () => config({ cloudLaneEnabled: options.lane ?? true }),
    isOnline: () => options.online ?? true,
    consent,
    taint,
    ledger,
    cloudGenerate: (modelName): Generate => {
      factoryCalls.push(modelName);
      return model;
    },
  });
  const researcher = createResearcher(gate);
  return { ledger, consent, taint, model, factoryCalls, researcher };
}

describe('format researcher through the real cloud gate (fake model)', () => {
  it('valid flow: one ledger entry with the documentation and none of the sample bytes; reader certified locally', async () => {
    const { ledger, consent, model, researcher } = setup();
    const { request, payload } = researcher.prepare('Quillstone Notebook spec', SPEC_TEXT);
    const token = await consent.grant(payload);
    const draft = await researcher.draft(request, token);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.badge).toBe('CLOUD');

    expect(model.prompts).toEqual([payload]);
    const entries = ledger.entries();
    expect(entries).toHaveLength(1);
    const sent = entries[0]!.sentText;
    expect(entries[0]!.outcome).toBe('ok');
    expect(sent).toContain(SPEC_TEXT.trim());
    for (const s of samples) {
      const read = readWithPlugin(QNB_PLUGIN, s.bytes);
      for (let i = 0; i + 16 <= s.bytes.length; i += 8) {
        const slice = s.bytes.subarray(i, i + 16);
        expect(sent).not.toContain(hex(slice));
        expect(sent).not.toContain(latin1(slice));
      }
      for (const block of read.blocks) expect(sent).not.toContain(block.text);
    }

    const report = researcher.certify(draft.plugin, samples, { knownText: 'Spring planting' });
    expect(report.passed).toBe(true);
    const result = await researcher.apply(draft.plugin, samples[0]!, { docName: request.docName, badge: draft.badge });
    expect(result.outputs.map((o) => o.name.split('.').pop())).toEqual(['md', 'docx']);
    expect(new TextDecoder().decode(result.outputs[0]!.bytes)).toContain('Only that documentation was sent to the cloud');
    // Applying and certifying are local: still exactly one cloud call.
    expect(ledger.entries()).toHaveLength(1);
    expect(model.prompts).toHaveLength(1);
  });

  it('one cloud attempt per consent: the token cannot be reused', async () => {
    const { ledger, consent, model, researcher } = setup();
    const { request, payload } = researcher.prepare('spec', SPEC_TEXT);
    const token = await consent.grant(payload);
    expect((await researcher.draft(request, token)).ok).toBe(true);
    const second = await researcher.draft(request, token);
    expect(second).toMatchObject({ ok: false, code: 'blocked', blockCode: 'no-consent' });
    expect(ledger.entries()).toHaveLength(1);
    expect(model.prompts).toHaveLength(1);
  });

  it('consent declined or missing: nothing sent, ledger empty', async () => {
    const { ledger, model, researcher } = setup();
    const { request } = researcher.prepare('spec', SPEC_TEXT);
    const draft = await researcher.draft(request, 'not-a-token');
    expect(draft).toMatchObject({ ok: false, code: 'blocked', blockCode: 'no-consent' });
    expect(ledger.entries()).toHaveLength(0);
    expect(model.prompts).toHaveLength(0);
  });

  it('consent for different text does not cover an edited payload', async () => {
    const { ledger, consent, model, researcher } = setup();
    const reviewed = researcher.prepare('spec', SPEC_TEXT);
    const token = await consent.grant(reviewed.payload);
    const edited = researcher.prepare('spec', `${SPEC_TEXT}\nextra line`);
    expect(await researcher.draft(edited.request, token)).toMatchObject({ ok: false, blockCode: 'no-consent' });
    expect(ledger.entries()).toHaveLength(0);
    expect(model.prompts).toHaveLength(0);
  });

  it('lane disabled (Remote Config): blocked, nothing sent', async () => {
    const { ledger, consent, model, factoryCalls, researcher } = setup({ lane: false });
    const { request, payload } = researcher.prepare('spec', SPEC_TEXT);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'blocked', blockCode: 'lane-disabled' });
    expect(ledger.entries()).toHaveLength(0);
    expect(model.prompts).toHaveLength(0);
    expect(factoryCalls).toHaveLength(0);
  });

  it('offline: blocked, nothing sent', async () => {
    const { ledger, consent, model, researcher } = setup({ online: false });
    const { request, payload } = researcher.prepare('spec', SPEC_TEXT);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'blocked', blockCode: 'offline' });
    expect(ledger.entries()).toHaveLength(0);
    expect(model.prompts).toHaveLength(0);
  });

  it('documentation containing a 64-byte slice of a sample (as hex) is blocked even with consent', async () => {
    const { ledger, consent, model, researcher } = setup();
    const slice = samples[0]!.bytes.subarray(32, 96);
    expect(slice.length).toBe(64);
    const docText = `${SPEC_TEXT}\n\nExample bytes from my file:\n${hex(slice)}\n`;
    const { request, payload } = researcher.prepare('spec', docText);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'blocked', blockCode: 'tainted' });
    expect(ledger.entries()).toHaveLength(0);
    expect(model.prompts).toHaveLength(0);
  });

  it('documentation containing decoded text from a sample is blocked', async () => {
    const { ledger, consent, model, researcher } = setup();
    const read = readWithPlugin(QNB_PLUGIN, samples[0]!.bytes);
    const copied = read.blocks.map((b) => b.text).join('\n');
    expect(copied.length).toBeGreaterThan(60);
    const { request, payload } = researcher.prepare('spec', `${SPEC_TEXT}\n\n${copied}`);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'blocked', blockCode: 'tainted' });
    expect(ledger.entries()).toHaveLength(0);
    expect(model.prompts).toHaveLength(0);
  });

  it('invalid JSON from the model: typed failure, the plugin is not used', async () => {
    const { ledger, consent, researcher } = setup({ answers: ['Sure! Here is a reader: {oops'] });
    const { request, payload } = researcher.prepare('spec', SPEC_TEXT);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'invalid-json' });
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.entries()[0]!.outcome).toBe('ok');
  });

  it('schema-valid but inconsistent plugin: typed failure with problems', async () => {
    const broken = JSON.parse(JSON.stringify(QNB_PLUGIN));
    broken.body.textField = 'missing';
    const { consent, researcher } = setup({ answers: [broken] });
    const { request, payload } = researcher.prepare('spec', SPEC_TEXT);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'invalid-plugin' });
    if (!draft.ok) expect(draft.problems.join(' ')).toMatch(/textField/);
  });

  it('model error: typed failure, ledger entry settled as error', async () => {
    const { ledger, consent, researcher } = setup({ answers: [new Error('quota')] });
    const { request, payload } = researcher.prepare('spec', SPEC_TEXT);
    const draft = await researcher.draft(request, await consent.grant(payload));
    expect(draft).toMatchObject({ ok: false, code: 'model-error' });
    expect(ledger.entries()[0]!.outcome).toBe('error');
  });

  it('the fixed instructions say the documentation is public and contain no file data', () => {
    const { researcher } = setup();
    const { payload } = researcher.prepare('', 'Some public text about a format.');
    expect(payload).toMatch(/PUBLIC documentation/);
    expect(payload).toMatch(/No file contents are included/);
    expect(payload).toMatch(/JSON object only/);
    expect(payload).toContain('--- PUBLIC DOCUMENTATION: Public format documentation ---');
  });
});

describe('researcher panel controller (no DOM)', () => {
  const deps = (s: ReturnType<typeof setup>, overrides: { online?: boolean; lane?: boolean; ai?: boolean } = {}) => ({
    researcher: s.researcher,
    consent: s.consent,
    cloudLaneEnabled: () => overrides.lane ?? true,
    aiConfigured: overrides.ai ?? true,
    isOnline: () => overrides.online ?? true,
  });

  it('Cancel sends nothing', async () => {
    const s = setup();
    const controller = createResearcherController(deps(s));
    const prepared = controller.prepare('spec', SPEC_TEXT);
    expect(prepared.bytes).toBe(new TextEncoder().encode(prepared.payload).length);
    controller.cancel();
    expect(await controller.confirm(true)).toMatchObject({ ok: false, code: 'nothing-prepared' });
    expect(s.ledger.entries()).toHaveLength(0);
    expect(s.model.prompts).toHaveLength(0);
  });

  it('without the "public documentation" tick, nothing is sent', async () => {
    const s = setup();
    const controller = createResearcherController(deps(s));
    controller.prepare('spec', SPEC_TEXT);
    expect(await controller.confirm(false)).toMatchObject({ ok: false, code: 'not-confirmed' });
    expect(s.ledger.entries()).toHaveLength(0);
    expect(s.model.prompts).toHaveLength(0);
  });

  it('with the tick, exactly the reviewed payload is sent once', async () => {
    const s = setup();
    const controller = createResearcherController(deps(s));
    const { payload } = controller.prepare('spec', SPEC_TEXT);
    const outcome = await controller.confirm(true);
    expect(outcome.ok).toBe(true);
    expect(s.model.prompts).toEqual([payload]);
    // A second confirm without a new review sends nothing.
    expect(await controller.confirm(true)).toMatchObject({ ok: false, code: 'nothing-prepared' });
    expect(s.model.prompts).toHaveLength(1);
  });

  it('lane status explains why the researcher is off', () => {
    expect(laneStatus({ aiConfigured: false, cloudLaneEnabled: () => true, isOnline: () => true })).toMatchObject({ usable: false, message: expect.stringMatching(/not configured/) });
    expect(laneStatus({ aiConfigured: true, cloudLaneEnabled: () => false, isOnline: () => true })).toMatchObject({ usable: false, message: expect.stringMatching(/switched off/) });
    expect(laneStatus({ aiConfigured: true, cloudLaneEnabled: () => true, isOnline: () => false })).toMatchObject({ usable: false, message: expect.stringMatching(/offline/) });
    expect(laneStatus({ aiConfigured: true, cloudLaneEnabled: () => true, isOnline: () => true }).usable).toBe(true);
  });
});
