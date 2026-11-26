import { defineConfig } from '@playwright/test';
import { APP_PORT, CONFIGURED_PORT, CONFIGURED_URL } from './tests/e2e/servers';

/**
 * End-to-end tests in real Google Chrome (channel "chrome"; Playwright downloads no browser).
 *
 *   npm run test:e2e          builds the app twice and tests both locally (`vite preview`), never
 *                             contacting a real Firebase project (tools/e2e-server.mjs):
 *                             - plain: Firebase settings blanked, AI Logic not configured (port 4183)
 *                             - configured: FAKE Firebase settings; its Firebase/reCAPTCHA traffic
 *                               is answered inside the browser by tests/e2e/firebase-mock.ts (port 4184)
 *   npm run test:e2e:hosted   tests the hosted demo (E2E_BASE_URL, default https://reopen-751ea.web.app)
 *
 * See tests/e2e/README.md, including the optional with-Gemini-Nano run (E2E_CHROME_PROFILE).
 */
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${APP_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    channel: 'chrome',
    headless: !process.env.E2E_HEADED,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
  },
  projects: [{ name: 'chrome' }],
  // Local runs test production builds (service worker included), never the dev server.
  ...(external
    ? {}
    : {
        webServer: [
          {
            command: `node tools/e2e-server.mjs plain ${APP_PORT}`,
            url: baseURL,
            reuseExistingServer: false,
            timeout: 240_000,
            stdout: 'ignore',
            stderr: 'pipe',
          },
          {
            command: `node tools/e2e-server.mjs configured ${CONFIGURED_PORT}`,
            url: CONFIGURED_URL,
            reuseExistingServer: false,
            timeout: 240_000,
            stdout: 'ignore',
            stderr: 'pipe',
          },
        ],
      }),
});
