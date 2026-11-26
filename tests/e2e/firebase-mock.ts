import type { BrowserContext, Route } from '@playwright/test';
import type { RecordedRequest } from './helpers';

/**
 * Answers, inside the browser, every request the configured e2e build (fake Firebase settings,
 * see tools/e2e-server.mjs) makes to Firebase or reCAPTCHA. Nothing reaches Google:
 * any other non-local request is aborted. The reCAPTCHA script is replaced by a stub that
 * returns a fake token, which only this mock's fake App Check endpoint accepts.
 */
export interface FirebaseMockOptions {
  /** Remote Config `cloud_lane_enabled`, or 'unreachable' to make the Remote Config fetch fail. */
  cloudLane: boolean | 'unreachable';
  /** Text the fake Gemini endpoint answers with. Undefined: AI requests are aborted. */
  aiResponseText?: string;
}

export interface FirebaseMock {
  /** Every non-local request the page attempted (answered or aborted). */
  attempts: RecordedRequest[];
  /** Requests that reached the fake Gemini endpoint (with their headers). */
  aiCalls: (RecordedRequest & { headers: Record<string, string> })[];
  setCloudLane(value: FirebaseMockOptions['cloudLane']): void;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
};

const RECAPTCHA_STUB = `
  // Test stub of the reCAPTCHA Enterprise client (tests/e2e/firebase-mock.ts).
  // Like the real client, execute() reports success through the widget's callback.
  var widgets = [];
  window.grecaptcha = { enterprise: {
    ready: function (cb) { setTimeout(cb, 0); },
    render: function (container, params) { widgets.push(params); return widgets.length - 1; },
    execute: function (id) {
      var params = widgets[id];
      if (params && params.callback) params.callback('e2e-fake-recaptcha-token');
      return Promise.resolve('e2e-fake-recaptcha-token');
    }
  } };
`;

const isLocal = (url: URL): boolean => url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';

export async function mockFirebase(context: BrowserContext, options: FirebaseMockOptions): Promise<FirebaseMock> {
  let cloudLane = options.cloudLane;
  const attempts: RecordedRequest[] = [];
  const aiCalls: FirebaseMock['aiCalls'] = [];

  const json = (route: Route, body: unknown, extraHeaders: Record<string, string> = {}) =>
    route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });

  await context.route(
    (url) => !isLocal(url) && url.protocol !== 'data:' && url.protocol !== 'blob:',
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const recorded: RecordedRequest = { url: request.url(), host: url.hostname, method: request.method(), body: request.postDataBuffer() };
      attempts.push(recorded);
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

      if (url.hostname === 'www.google.com' && url.pathname === '/recaptcha/enterprise.js') {
        return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: RECAPTCHA_STUB });
      }
      if (url.hostname === 'content-firebaseappcheck.googleapis.com') {
        return json(route, { token: 'e2e-fake-app-check-token', ttl: '3600s' });
      }
      if (url.hostname === 'firebaseinstallations.googleapis.com') {
        if (url.pathname.endsWith(':generate')) return json(route, { token: 'e2e-fake-installation-token', expiresIn: '604800s' });
        return json(route, {
          name: 'projects/000000000000/installations/cE2eFakeInstallation0',
          fid: 'cE2eFakeInstallation0',
          refreshToken: 'e2e-fake-refresh-token',
          authToken: { token: 'e2e-fake-installation-token', expiresIn: '604800s' },
        });
      }
      if (url.hostname === 'firebaseremoteconfig.googleapis.com') {
        if (cloudLane === 'unreachable') return route.abort('internetdisconnected');
        return json(route, {
          entries: {
            cloud_lane_enabled: String(cloudLane),
            batch_size: '4',
            cloud_model: 'gemini-4-hydrogen',
            cloud_max_output_tokens: '4096',
            nano_chunk_chars: '6000',
            ai_max_attempts: '3',
          },
          state: 'UPDATE',
          templateVersion: '1',
          // The SDK only activates a fetched template that has an ETag.
        }, { etag: `"e2e-remote-config-${String(cloudLane)}"` });
      }
      if (url.hostname === 'firebasevertexai.googleapis.com') {
        aiCalls.push({ ...recorded, headers: await request.allHeaders() });
        if (options.aiResponseText === undefined) return route.abort('blockedbyclient');
        return json(route, {
          candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: options.aiResponseText }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        });
      }
      return route.abort('blockedbyclient');
    },
  );

  return {
    attempts,
    aiCalls,
    setCloudLane: (value) => {
      cloudLane = value;
    },
  };
}
