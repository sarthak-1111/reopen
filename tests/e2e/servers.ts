/** Ports of the two local servers started by playwright.config.ts (not used for hosted runs). */
export const APP_PORT = 4183;
/** Same app built with fake Firebase settings (tools/e2e-server.mjs configured). */
export const CONFIGURED_PORT = 4184;
export const CONFIGURED_URL = `http://localhost:${CONFIGURED_PORT}`;
/** True when the suite runs against a deployed URL (E2E_BASE_URL) instead of local servers. */
export const HOSTED = !!process.env.E2E_BASE_URL;
