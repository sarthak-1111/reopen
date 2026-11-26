import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CloudBlockedError, createCloudGate, type CloudRequest } from '../../src/ai/cloud-gate';
import { createConsentStore } from '../../src/ai/consent';
import { createLedger } from '../../src/ai/ledger';
import type { Generate } from '../../src/ai/models';
import { createTaintRegistry, MIN_CAUGHT_BYTES, MIN_CAUGHT_CHARS } from '../../src/ai/taint';
import { sanitiseConfig } from '../../src/firebase/remote-config';
import { config } from './helpers';

const request = (docText: string): CloudRequest => ({
  feature: 'format-research',
  instructions: 'Draft a reader plugin from this public documentation.',
  docName: 'manual.md',
  docText,
  schema: { type: 'object', properties: { formatName: { type: 'string' } }, required: ['formatName'] },
});

function setup(overrides: { lane?: boolean; online?: boolean } = {}) {
  const sent: string[] = [];
  const ledger = createLedger();
  const consent = createConsentStore();
  const taint = createTaintRegistry();
  const cloud: Generate = async (prompt) => {
    sent.push(prompt);
    return { text: '{"formatName":"QNB"}', badge: 'CLOUD' };
  };
  const gate = createCloudGate({
    config: () => config({ cloudLaneEnabled: overrides.lane ?? true }),
    isOnline: () => overrides.online ?? true,
    consent,
    taint,
    ledger,
    cloudGenerate: () => cloud,
  });
  return { gate, ledger, consent, taint, sent };
}

async function blockedCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'sent';
  } catch (error) {
    return error instanceof CloudBlockedError ? error.code : `error:${String(error)}`;
  }
}

describe('cloud gate', () => {
  it('sends with consent and records the exact payload in the ledger first', async () => {
    const { gate, ledger, consent, sent } = setup();
    const req = request('Header is 32 bytes. Magic QNB1.');
    const token = await consent.grant(gate.payloadFor(req));
    const result = await gate.send(req, token);
    expect(result.badge).toBe('CLOUD');
    expect(sent).toEqual([gate.payloadFor(req)]);
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.entries()[0]).toMatchObject({ outcome: 'ok', badge: 'CLOUD', feature: 'format-research' });
    expect(ledger.entries()[0]!.sentText.startsWith(gate.payloadFor(req))).toBe(true);
  });

  it('puts the reply format in the prompt (JSON mode, no constrained schema) and passes model options from Remote Config', async () => {
    // Found in Chrome: constrained decoding with the plugin schema got HTTP 400 "too many states",
    // and a lighter schema timed out (503) after 3.5 minutes.
    const seen: Array<{ model: string; options: unknown }> = [];
    const consent = createConsentStore();
    const gate = createCloudGate({
      config: () => config({ cloudLaneEnabled: true, cloudModel: 'gemini-test', cloudMaxOutputTokens: 2048, cloudThinkingLevel: 'LOW' }),
      isOnline: () => true,
      consent,
      taint: createTaintRegistry(),
      ledger: createLedger(),
      cloudGenerate: (model, options) => {
        seen.push({ model, options });
        return async () => ({ text: '{"formatName":"QNB"}', badge: 'CLOUD' });
      },
    });
    const req = request('Header is 32 bytes. Magic QNB1.');
    const payload = gate.payloadFor(req);
    expect(payload).toContain(JSON.stringify(req.schema));
    expect(payload.indexOf(JSON.stringify(req.schema))).toBeLessThan(payload.indexOf('--- PUBLIC DOCUMENTATION'));
    await gate.send(req, await consent.grant(payload));
    expect(seen).toEqual([{ model: 'gemini-test', options: { maxOutputTokens: 2048, thinkingLevel: 'LOW' } }]);
  });

  it('sanitises the thinking level from Remote Config', () => {
    expect(sanitiseConfig({}, 'remote').cloudThinkingLevel).toBe('LOW');
    expect(sanitiseConfig({ cloudThinkingLevel: 'medium' }, 'remote').cloudThinkingLevel).toBe('MEDIUM');
    expect(sanitiseConfig({ cloudThinkingLevel: 'NONE' }, 'remote').cloudThinkingLevel).toBeNull();
    expect(sanitiseConfig({ cloudThinkingLevel: '' }, 'remote').cloudThinkingLevel).toBeNull();
    expect(sanitiseConfig({ cloudThinkingLevel: 'ultra; drop' }, 'remote').cloudThinkingLevel).toBe('LOW');
  });

  it('shows an in-flight call as sending (found in Chrome: it read "Blocked before sending")', async () => {
    const ledger = createLedger();
    const consent = createConsentStore();
    let release: (value: { text: string; badge: 'CLOUD' }) => void = () => undefined;
    const gate = createCloudGate({
      config: () => config({ cloudLaneEnabled: true }),
      isOnline: () => true,
      consent,
      taint: createTaintRegistry(),
      ledger,
      cloudGenerate: () => () => new Promise((resolve) => (release = resolve)),
    });
    const req = request('Header is 32 bytes. Magic QNB1.');
    const pending = gate.send(req, await consent.grant(gate.payloadFor(req)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ledger.entries()[0]).toMatchObject({ outcome: 'sending', badge: 'UNKNOWN' });
    release({ text: '{"formatName":"QNB"}', badge: 'CLOUD' });
    await pending;
    expect(ledger.entries()[0]).toMatchObject({ outcome: 'ok', badge: 'CLOUD' });
  });

  it('declined consent: nothing sent, nothing recorded', async () => {
    const { gate, ledger, sent } = setup();
    expect(await blockedCode(gate.send(request('public doc'), 'no-token'))).toBe('no-consent');
    expect(sent).toHaveLength(0);
    expect(ledger.entries()).toHaveLength(0);
  });

  it('consent is single-use and bound to the exact text', async () => {
    const { gate, consent } = setup();
    const token = await consent.grant(gate.payloadFor(request('version A')));
    expect(await blockedCode(gate.send(request('version B'), token))).toBe('no-consent');
    const token2 = await consent.grant(gate.payloadFor(request('version A')));
    expect(await blockedCode(gate.send(request('version A'), token2))).toBe('sent');
    expect(await blockedCode(gate.send(request('version A'), token2))).toBe('no-consent');
  });

  it('cloud lane disabled by Remote Config blocks before consent is even used', async () => {
    const { gate, consent, sent } = setup({ lane: false });
    const token = await consent.grant(gate.payloadFor(request('doc')));
    expect(await blockedCode(gate.send(request('doc'), token))).toBe('lane-disabled');
    expect(sent).toHaveLength(0);
  });

  it('offline blocks', async () => {
    const { gate, consent, sent } = setup({ online: false });
    const token = await consent.grant(gate.payloadFor(request('doc')));
    expect(await blockedCode(gate.send(request('doc'), token))).toBe('offline');
    expect(sent).toHaveLength(0);
  });

  it('Remote Config values are sanitised and the lane fails closed', () => {
    expect(sanitiseConfig({ cloudLaneEnabled: 'true' as unknown as boolean }, 'remote').cloudLaneEnabled).toBe(false);
    expect(sanitiseConfig({ batchSize: 99, nanoChunkChars: 1 }, 'remote')).toMatchObject({ batchSize: 8, nanoChunkChars: 500 });
    expect(sanitiseConfig({ cloudModel: 'bad model; drop' }, 'remote').cloudModel).toBe('gemini-4-hydrogen');
  });
});

/** Naive search: does `haystack` contain any run of `min` consecutive items from `needle`? */
function containsRun(haystack: ArrayLike<number>, needle: ArrayLike<number>, min: number): boolean {
  const hay = Array.from(haystack).join(',');
  for (let i = 0; i + min <= needle.length; i++) {
    if (hay.includes(Array.from(needle).slice(i, i + min).join(','))) return true;
  }
  return false;
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const toLatin1 = (bytes: Uint8Array): string => String.fromCharCode(...bytes);
const docWords = fc.array(fc.stringMatching(/^[A-Za-z]{2,10}$/), { minLength: 5, maxLength: 60 }).map((w) => w.join(' '));

describe('property: no cloud request ever contains file bytes or contents', () => {
  it('any copied run of a dropped file (raw, hex or base64) is blocked; clean docs pass', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 128, maxLength: 2048 }),
        docWords,
        fc.constantFrom('none', 'hex', 'base64', 'latin1'),
        fc.nat(),
        fc.integer({ min: MIN_CAUGHT_BYTES, max: 120 }),
        async (fileBytes, words, encoding, start, length) => {
          fc.pre(new Set(fileBytes).size > 16); // real files are not constant
          const { gate, consent, taint, sent } = setup();
          taint.registerFile(fileBytes, null);
          const from = start % (fileBytes.length - length);
          const slice = fileBytes.slice(from, from + length);
          const injected = encoding === 'hex' ? toHex(slice) : encoding === 'base64' ? toBase64(slice) : encoding === 'latin1' ? toLatin1(slice) : '';
          const req = request(`${words} ${injected} ${words}`);
          const token = await consent.grant(gate.payloadFor(req));
          const outcome = await blockedCode(gate.send(req, token));
          if (encoding === 'none') expect(outcome).toBe('sent');
          else expect(outcome).toBe('tainted');
          // Whatever happened, nothing that reached the model carries a run of file bytes.
          for (const payload of sent) {
            expect(containsRun(new TextEncoder().encode(payload), fileBytes, MIN_CAUGHT_BYTES)).toBe(false);
            expect(containsRun(Array.from(payload, (c) => c.charCodeAt(0) & 0xff), fileBytes, MIN_CAUGHT_BYTES)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('any copied passage of a dropped file’s text is blocked', async () => {
    const sentence = fc.array(fc.stringMatching(/^[a-z]{2,9}$/), { minLength: 30, maxLength: 120 }).map((w) => w.join(' '));
    await fc.assert(
      fc.asyncProperty(sentence, docWords, fc.nat(), fc.integer({ min: MIN_CAUGHT_CHARS, max: 140 }), async (fileText, words, start, length) => {
        fc.pre(fileText.length > length + 1);
        const { gate, consent, taint, sent } = setup();
        taint.registerFile(new TextEncoder().encode(fileText), fileText);
        const from = start % (fileText.length - length);
        const copied = fileText.slice(from, from + length).toUpperCase(); // case changes don't help
        const req = request(`${words}\n${copied}\n${words}`);
        const token = await consent.grant(gate.payloadFor(req));
        expect(await blockedCode(gate.send(req, token))).toBe('tainted');
        expect(sent).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});
