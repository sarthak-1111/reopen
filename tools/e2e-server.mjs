#!/usr/bin/env node
// Builds and serves Reopen for the local end-to-end tests, without touching any real Firebase project.
//
//   node tools/e2e-server.mjs plain <port>       Firebase settings blanked: the "AI Logic not
//                                                configured" build (stub AI, no cloud lane).
//   node tools/e2e-server.mjs configured <port>  FAKE Firebase settings: the app takes its
//                                                configured path (App Check, Remote Config, cloud
//                                                gate, format researcher) and the tests answer every
//                                                Firebase/reCAPTCHA request inside the browser
//                                                (tests/e2e/firebase-mock.ts), so nothing reaches Google.
//
// Real settings live only in the untracked .env.local; process environment variables take priority
// over it in Vite, so neither build uses them. Output goes to .e2e-dist/, never to dist/.
import { build, preview } from 'vite';

const [variant, portArg] = process.argv.slice(2);
const SETTINGS = {
  plain: {
    VITE_FIREBASE_API_KEY: '',
    VITE_FIREBASE_AUTH_DOMAIN: '',
    VITE_FIREBASE_PROJECT_ID: '',
    VITE_FIREBASE_APP_ID: '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '',
    VITE_FIREBASE_STORAGE_BUCKET: '',
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: '',
    VITE_APPCHECK_DEBUG_TOKEN: '',
  },
  configured: {
    VITE_FIREBASE_API_KEY: 'e2e-fake-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'reopen-e2e.invalid',
    VITE_FIREBASE_PROJECT_ID: 'reopen-e2e',
    VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000e2e000',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    VITE_FIREBASE_STORAGE_BUCKET: 'reopen-e2e.invalid',
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'e2e-fake-site-key',
    VITE_APPCHECK_DEBUG_TOKEN: '',
  },
};
const settings = SETTINGS[variant];
const port = Number(portArg);
if (!settings || !Number.isInteger(port)) {
  console.error('usage: node tools/e2e-server.mjs plain|configured <port>');
  process.exit(2);
}

Object.assign(process.env, settings);
const outDir = `.e2e-dist/${variant}`;
await build({ logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({ logLevel: 'info', build: { outDir }, preview: { port, strictPort: true, open: false } });
server.printUrls();
