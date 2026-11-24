import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

declare global {
  // Read by the App Check SDK. Development only: `true` makes the SDK print a new debug
  // token in the console; a string reuses an already registered token.
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

export class FirebaseConfigError extends Error {
  override name = 'FirebaseConfigError';
}

export interface FirebaseHandles {
  app: FirebaseApp;
  appCheck: AppCheck;
  ai: AI;
  appCheckMode: 'debug-token' | 'recaptcha-enterprise';
}

/**
 * Firebase web config is injected at build time from an untracked .env.local /
 * .env.production.local file, so no project identifiers are committed to the repo.
 */
function readConfig(): FirebaseOptions {
  const env = import.meta.env;
  const config: FirebaseOptions = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  };
  const missing = (['apiKey', 'projectId', 'appId'] as const).filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new FirebaseConfigError(
      `Missing Firebase config (${missing.join(', ')}). Copy .env.example to .env.local and fill it in.`,
    );
  }
  return config;
}

let handles: FirebaseHandles | undefined;

/** Initialises Firebase once. App Check is always initialised before AI Logic is used. */
export function initFirebase(): FirebaseHandles {
  if (handles) return handles;

  const app = initializeApp(readConfig());

  let appCheckMode: FirebaseHandles['appCheckMode'] = 'recaptcha-enterprise';
  if (import.meta.env.DEV) {
    const token = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = token && token.length > 0 ? token : true;
    appCheckMode = 'debug-token';
  }

  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!siteKey) {
    throw new FirebaseConfigError('Missing VITE_RECAPTCHA_ENTERPRISE_SITE_KEY in .env.local.');
  }
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  handles = { app, appCheck, ai, appCheckMode };
  return handles;
}
