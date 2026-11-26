import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { QNB_PLUGIN } from '../research/qnb-plugin';
import { mockFirebase } from './firebase-mock';
import {
  card,
  declineConsentEveryWay,
  leakProblems,
  oldFolderEntries,
  openApp,
  QNB_SPEC,
  researcherStatus,
  waitForFinished,
} from './helpers';
import { CONFIGURED_URL, HOSTED } from './servers';

/*
 * The app as built WITH Firebase AI Logic (fake settings, tools/e2e-server.mjs configured).
 * Every Firebase and reCAPTCHA request is answered inside the browser by firebase-mock.ts, so
 * these tests exercise App Check start-up, Remote Config, the cloud gate, the Privacy Ledger and
 * the format researcher without sending anything to Google. Service workers are blocked so that
 * every request is visible to the mock.
 */

test.skip(HOSTED, 'Runs only against the local fake-config build, not a hosted URL.');
test.use({ baseURL: CONFIGURED_URL, serviceWorkers: 'block' });

const ENTRIES = oldFolderEntries();
const QNB_PATH = 'OLDPC/NOTEBOOK/GARDEN.QNB';
const QNB_ENTRY = ENTRIES.find((e) => e.appPath === QNB_PATH)!;
const FIREBASE_HOSTS = new Set(['www.google.com', 'content-firebaseappcheck.googleapis.com', 'firebaseinstallations.googleapis.com', 'firebaseremoteconfig.googleapis.com']);
const READY = 'Ready. Nothing is sent until you review the exact text and confirm.';

async function rescueSamples(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try the sample folder' }).click();
  await waitForFinished(page);
  await expect(page.locator('#count-device')).toHaveText(String(ENTRIES.length));
}

test.describe('configured build: start-up and privacy', () => {
  test('start-up contacts only reCAPTCHA (App Check), Installations and Remote Config; a full rescue and export call no AI and leak nothing', async ({ page, context }) => {
    const mock = await mockFirebase(context, { cloudLane: true });
    const { pageErrors } = await openApp(page);
    await expect(page.locator('#format-researcher-root')).not.toHaveAttribute('data-placeholder', 'true');
    await expect(researcherStatus(page)).toHaveText(READY);

    await rescueSamples(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download everything (.zip)' }).click()]);
    await download.path();

    await expect(page.locator('#count-cloud')).toHaveText('0');
    await expect(page.locator('#library .badge-cloud')).toHaveCount(0);
    expect(mock.aiCalls).toEqual([]);
    const hosts = [...new Set(mock.attempts.map((r) => r.host))];
    test.info().annotations.push({ type: 'hosts contacted (all answered by the mock)', description: hosts.join(', ') });
    expect(hosts.filter((h) => !FIREBASE_HOSTS.has(h))).toEqual([]);
    expect(hosts).toContain('firebaseremoteconfig.googleapis.com');
    expect(leakProblems(mock.attempts, CONFIGURED_URL)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('pasting a rescued file’s text into the researcher is blocked before anything is sent', async ({ page, context }) => {
    // The fake endpoint WOULD answer, so a block here is the gate's doing, not a network failure.
    const mock = await mockFirebase(context, { cloudLane: true, aiResponseText: JSON.stringify(QNB_PLUGIN) });
    await openApp(page);
    await rescueSamples(page);
    const letter = (await card(page, 'OLDPC/LETTER.TXT').locator('figure.preview-text pre').textContent()) ?? '';
    expect(letter).toContain('Nous avons bien reçu votre commande');

    await page.locator('#research-doc-name').fill('Not really documentation');
    await page.locator('#research-doc-text').fill(letter);
    await page.getByRole('button', { name: 'Review what will be sent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send this documentation to cloud Gemini?' });
    await dialog.getByLabel('This is public documentation I’m allowed to share.').check();
    await dialog.getByRole('button', { name: 'Send to cloud Gemini' }).click();

    const warning = page.locator('.research-draft .warning');
    await expect(warning).toContainText('Nothing was sent.');
    test.info().annotations.push({ type: 'message shown', description: (await warning.textContent()) ?? '' });
    // The gate refuses before the request exists, so the ledger (what was sent) stays empty.
    await expect(page.locator('#ledger-root')).toContainText('0 cloud calls this session.');
    await expect(page.locator('#count-cloud')).toHaveText('0');
    await expect(page.locator('.research-draft .badge-cloud')).toHaveCount(0);
    expect(mock.aiCalls).toEqual([]);
  });
});

test.describe('configured build: the cloud lane and its fallbacks', () => {
  test('consent declined: cancel, Escape or an unticked box send nothing', async ({ page, context }) => {
    const mock = await mockFirebase(context, { cloudLane: true, aiResponseText: JSON.stringify(QNB_PLUGIN) });
    await openApp(page);
    await expect(researcherStatus(page)).toHaveText(READY);
    await declineConsentEveryWay(page);
    expect(mock.aiCalls).toEqual([]);
  });

  test('cloud lane switched off by Remote Config: nothing can be sent', async ({ page, context }) => {
    const mock = await mockFirebase(context, { cloudLane: false });
    await openApp(page);
    await expect(researcherStatus(page)).toHaveText('The cloud lane is switched off right now (Remote Config). Nothing can be sent.');
    await expect(page.getByRole('button', { name: 'Review what will be sent' })).toBeDisabled();
    expect(mock.aiCalls).toEqual([]);
  });

  test('Remote Config unreachable: the cloud lane stays off (fails closed)', async ({ page, context }) => {
    const mock = await mockFirebase(context, { cloudLane: 'unreachable' });
    await openApp(page);
    await expect(researcherStatus(page)).toHaveText('The cloud lane is switched off right now (Remote Config). Nothing can be sent.');
    await expect(page.getByRole('button', { name: 'Review what will be sent' })).toBeDisabled();
    expect(mock.attempts.some((r) => r.host === 'firebaseremoteconfig.googleapis.com')).toBe(true);
    expect(mock.aiCalls).toEqual([]);
  });

  test('offline: the researcher says so and cannot send; back online it is ready again', async ({ page, context }) => {
    await mockFirebase(context, { cloudLane: true });
    await openApp(page);
    await expect(researcherStatus(page)).toHaveText(READY);
    await context.setOffline(true);
    await expect(researcherStatus(page)).toHaveText('You are offline. The format researcher needs the network; everything else keeps working.');
    await expect(page.getByRole('button', { name: 'Review what will be sent' })).toBeDisabled();
    await expect(page.locator('#net-status')).toHaveText('Offline: still working on this device');
    await context.setOffline(false);
    await expect(researcherStatus(page)).toHaveText(READY);
    await expect(page.getByRole('button', { name: 'Review what will be sent' })).toBeEnabled();
  });

  test('full researcher flow: documentation drafted by the (mock) cloud, reader tested and used on this device', async ({ page, context }) => {
    const mock = await mockFirebase(context, { cloudLane: true, aiResponseText: JSON.stringify(QNB_PLUGIN) });
    await openApp(page);
    await rescueSamples(page);
    // The mystery file could not be read, so it is offered as a local test file.
    await expect(card(page, QNB_PATH).locator('.chip').first()).toHaveText('Not converted');
    await expect(page.locator('#format-researcher-root .research-samples')).toContainText(QNB_PATH);

    await page.locator('#research-doc-name').fill('Quillstone Notebook format, version 3');
    await page.locator('#research-doc-text').fill(readFileSync(QNB_SPEC, 'utf8'));
    await page.getByRole('button', { name: 'Review what will be sent' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send this documentation to cloud Gemini?' });
    const payload = (await dialog.locator('pre.payload').textContent()) ?? '';
    await dialog.getByLabel('This is public documentation I’m allowed to share.').check();
    await dialog.getByRole('button', { name: 'Send to cloud Gemini' }).click();

    await expect(researcherStatus(page)).toHaveText('Draft received. Choose sample files and run the tests on this computer.');
    const draft = page.locator('.research-draft');
    await expect(draft).toContainText('Draft reader for “Quillstone Notebook”');
    await expect(draft.locator('.badge-cloud')).toHaveText('CLOUD');

    // Exactly one cloud call, and it carried exactly the reviewed text: no file bytes or contents.
    expect(mock.aiCalls).toHaveLength(1);
    const sent = JSON.parse(mock.aiCalls[0]!.body!.toString('utf8')) as { contents: { parts: { text?: string }[] }[]; generationConfig?: { responseSchema?: unknown } };
    const sentText = sent.contents.flatMap((c) => c.parts.map((p) => p.text ?? '')).join('');
    expect(sentText).toBe(payload);
    expect(sent.generationConfig?.responseSchema).toBeTruthy();
    // App Check is attached to the cloud call (token from the mock's App Check exchange).
    expect(mock.aiCalls[0]!.headers['x-firebase-appcheck']).toBe('e2e-fake-app-check-token');
    expect(mock.attempts.some((r) => r.host === 'content-firebaseappcheck.googleapis.com')).toBe(true);
    expect(leakProblems(mock.attempts, CONFIGURED_URL, { allowAiCalls: true })).toEqual([]);

    // The Privacy Ledger shows the call, with the exact text.
    await expect(page.locator('#count-cloud')).toHaveText('1');
    await expect(page.locator('#ledger-root')).toContainText('1 cloud call this session.');
    const entry = page.locator('#ledger-root .ledger-entry');
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveClass(/outcome-ok/);
    expect((await entry.locator('details pre').textContent()) ?? '').toContain(payload);

    // Tests run here, on this device, against the unconverted file and a phrase the user knows.
    await page.locator('#research-known-text').fill(QNB_ENTRY.includes![0]!);
    await page.getByRole('button', { name: 'Run tests on this computer' }).click();
    await expect(page.locator('.research-report')).toContainText('All tests passed on this computer.');
    await page.getByRole('button', { name: 'Use this reader' }).click();
    await expect(researcherStatus(page)).toHaveText('Added 1 file to your library, read on this device.');

    const rescued = card(page, QNB_PATH);
    await expect(rescued.locator('.chip').first()).not.toHaveText('Not converted');
    for (const phrase of QNB_ENTRY.includes!) await expect(rescued).toContainText(phrase);
    // Still exactly one cloud call: reading the file happened on this device.
    expect(mock.aiCalls).toHaveLength(1);
    await expect(page.locator('#count-cloud')).toHaveText('1');
  });
});

test.describe('configured build: Gemini Nano states (no download is ever started)', () => {
  const STATES = [
    { availability: 'unavailable', chip: 'On-device AI not supported here', wake: false },
    { availability: 'downloadable', chip: 'On-device AI available', wake: true },
    { availability: null, chip: 'No on-device AI in this browser', wake: false },
  ] as const;

  for (const state of STATES) {
    test(`Nano ${state.availability ?? 'API missing'}: chip says “${state.chip}”, conversion still works with no AI`, async ({ page, context }) => {
      await mockFirebase(context, { cloudLane: true });
      await context.addInitScript((availability) => {
        const g = globalThis as { LanguageModel?: unknown };
        if (availability === null) {
          delete g.LanguageModel;
          return;
        }
        // A stand-in Prompt API that reports the state and refuses to create sessions.
        g.LanguageModel = {
          availability: async () => availability,
          create: async () => {
            throw new Error('e2e: no on-device model');
          },
        };
      }, state.availability);
      await openApp(page);
      await expect(page.locator('#nano-status .nano-label strong')).toHaveText(state.chip);
      await expect(page.getByRole('button', { name: 'Wake on-device AI' })).toHaveCount(state.wake ? 1 : 0);

      await rescueSamples(page);
      const badges = page.locator('#library .chips .badge');
      await expect(badges).toHaveCount(ENTRIES.length);
      for (const text of await badges.allTextContents()) expect(text).toBe('NO AI');
      await expect(page.locator('#library .reconstruction')).toHaveCount(0);
      await expect(page.locator('#count-cloud')).toHaveText('0');
    });
  }
});
