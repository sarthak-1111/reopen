import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SAMPLE_DIR = join(ROOT, 'samples', 'old-folder');
export const SAMPLE_ZIP = join(ROOT, 'samples', 'old-folder.zip');
export const QNB_SPEC = join(ROOT, 'docs', 'specs', 'quillstone-notebook-qnb.md');

/** The 10-second line (index.html h1). */
export const TEN_SECOND_LINE = 'Drop in a folder from an old computer. Your files come back, readable, and nothing leaves your laptop.';

/** Hosts that serve Firebase AI Logic / Gemini. The app must never call them during a rescue. */
export const AI_HOSTS = /(^|\.)(firebasevertexai|generativelanguage|aiplatform)\.googleapis\.com$/i;

export interface ManifestEntry {
  path: string;
  bytes: number;
  format: string;
  encoding?: string;
  includes?: string[];
  excludes?: string[];
  mystery?: string;
}

/** The old-folder entries of samples/manifest.json, with the path the app shows (`OLDPC/...`). */
export function oldFolderEntries(): (ManifestEntry & { appPath: string })[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'samples', 'manifest.json'), 'utf8')) as ManifestEntry[];
  return manifest
    .filter((entry) => entry.path.startsWith('old-folder/'))
    .map((entry) => ({ ...entry, appPath: `OLDPC/${entry.path.slice('old-folder/'.length)}` }));
}

/** Every file under samples/old-folder (the bytes the network guard looks for). */
export function sampleFiles(): { path: string; bytes: Buffer }[] {
  const out: { path: string; bytes: Buffer }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ path: relative(SAMPLE_DIR, full).replace(/\\/g, '/'), bytes: readFileSync(full) });
    }
  };
  walk(SAMPLE_DIR);
  return out;
}

export interface RecordedRequest {
  url: string;
  host: string;
  method: string;
  body: Buffer | null;
}

/** Records every request the context makes (pages and, in Chromium, their workers). */
export function recordRequests(context: BrowserContext): RecordedRequest[] {
  const list: RecordedRequest[] = [];
  context.on('request', (request) => {
    let host = '';
    try {
      host = new URL(request.url()).hostname;
    } catch {
      host = '';
    }
    list.push({ url: request.url(), host, method: request.method(), body: request.postDataBuffer() });
  });
  return list;
}

/** Opens the app and waits until start-up has finished (the ledger panel is mounted last-but-one). */
export async function openApp(page: Page, path = '/'): Promise<{ pageErrors: string[] }> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(path);
  await expect(page.locator('#ledger-root')).toContainText('0 cloud calls this session.');
  await expect(page.locator('#nano-status .nano-label')).toBeVisible();
  return { pageErrors };
}

/** Waits for the run to finish and returns the final status line. */
export async function waitForFinished(page: Page): Promise<string> {
  const status = page.locator('#run-status');
  await expect(status).toHaveText(/^Finished: /, { timeout: 90_000 });
  return (await status.textContent()) ?? '';
}

export function card(page: Page, appPath: string) {
  return page.locator(`#library article.card[data-original-path="${appPath.replace(/"/g, '\\"')}"]`);
}

/**
 * Byte windows that identify each sample file. Windows with little variety (zero padding, runs of
 * spaces, OLE filler) are left out so that unrelated traffic cannot match them by chance.
 */
export function fingerprints(files: { path: string; bytes: Buffer }[], size = 24): { path: string; window: Buffer }[] {
  const out: { path: string; window: Buffer }[] = [];
  for (const file of files) {
    for (let start = 0; start + size <= file.bytes.length; start += size) {
      const window = file.bytes.subarray(start, start + size);
      if (new Set(window).size >= 10) out.push({ path: file.path, window });
    }
  }
  return out;
}

/** Problems found in the recorded traffic: AI calls, non-GET same-origin calls, file content anywhere. */
export function leakProblems(requests: RecordedRequest[], appOrigin: string, options: { allowAiCalls?: boolean } = {}): string[] {
  const problems: string[] = [];
  const files = sampleFiles();
  const windows = fingerprints(files);
  const phrases = oldFolderEntries().flatMap((entry) => entry.includes ?? []);
  for (const request of requests) {
    if (request.url.startsWith('data:') || request.url.startsWith('blob:')) continue;
    if (AI_HOSTS.test(request.host) && !options.allowAiCalls) problems.push(`AI endpoint called: ${request.method} ${request.url}`);
    const sameOrigin = request.url.startsWith(appOrigin);
    if (sameOrigin && request.method !== 'GET' && request.method !== 'HEAD') {
      problems.push(`non-GET request to the app's own origin: ${request.method} ${request.url}`);
    }
    for (const phrase of phrases) {
      if (request.url.includes(phrase) || request.url.includes(encodeURIComponent(phrase))) {
        problems.push(`file text "${phrase}" in URL ${request.url}`);
      }
    }
    const body = request.body;
    if (!body || body.length === 0) continue;
    for (const phrase of phrases) {
      if (body.includes(Buffer.from(phrase, 'utf8'))) problems.push(`file text "${phrase}" in body of ${request.method} ${request.url}`);
    }
    const hit = windows.find(({ window }) => body.includes(window));
    if (hit) problems.push(`bytes of ${hit.path} in body of ${request.method} ${request.url}`);
    const hex = body.toString('latin1');
    const hexHit = windows.find(({ window }) => hex.includes(window.toString('hex')) || hex.includes(window.toString('hex').toUpperCase()));
    if (hexHit) problems.push(`hex of ${hexHit.path} in body of ${request.method} ${request.url}`);
  }
  return problems;
}

export function researcherStatus(page: Page): Locator {
  return page.locator('#format-researcher-root p[role="status"]');
}

/**
 * Fills the researcher with the (self-made, public) QNB spec, opens the consent dialog and
 * declines in every way the dialog offers. Nothing may be sent.
 */
export async function declineConsentEveryWay(page: Page): Promise<void> {
  const review = page.getByRole('button', { name: 'Review what will be sent' });
  await page.locator('#research-doc-name').fill('Quillstone Notebook format (fictional, Apache-2.0)');
  await page.locator('#research-doc-text').fill(readFileSync(QNB_SPEC, 'utf8'));
  await expect(review).toBeEnabled();

  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Send this documentation to cloud Gemini?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('pre.payload')).toContainText('QNB1');
  await expect(dialog.locator('pre.payload')).toContainText('--- PUBLIC DOCUMENTATION: Quillstone Notebook format');
  const send = dialog.getByRole('button', { name: 'Send to cloud Gemini' });
  const publicBox = dialog.getByLabel('This is public documentation I’m allowed to share.');
  // Sending needs the "public documentation" box ticked.
  await expect(send).toBeDisabled();
  await publicBox.check();
  await expect(send).toBeEnabled();
  await publicBox.uncheck();
  await expect(send).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel (send nothing)' }).click();
  await expect(dialog).toBeHidden();
  await expect(researcherStatus(page)).toHaveText('Cancelled. Nothing was sent.');

  // Escape closes it too, and also sends nothing.
  await review.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(researcherStatus(page)).toHaveText('Cancelled. Nothing was sent.');

  await expect(page.locator('#count-cloud')).toHaveText('0');
  await expect(page.locator('#ledger-root')).toContainText('0 cloud calls this session.');
}
