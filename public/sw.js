/*
 * Reopen offline app shell (hand-written, no dependencies).
 *
 * - Precaches the files listed in /precache-manifest.json (generated at build time).
 * - Same-origin GET only. Requests to any other origin, including googleapis.com, firebase and
 *   gstatic (Firebase AI Logic, App Check, Remote Config), are never intercepted or cached.
 * - Navigations: network first, cached shell when offline. Everything else: cache first.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `reopen-shell-${VERSION}`;
// Same-origin, content-hashed files: a `Vary: Origin` header (sent by some servers) must not stop
// the crossorigin <script>/<link> requests Vite emits from matching what was precached.
const MATCH = { ignoreVary: true };
const NEVER_TOUCH =/(^|\.)(googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com|recaptcha\.net)$/;

function handled(request) {
  if (request.method !== 'GET' || request.headers.has('range')) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (NEVER_TOUCH.test(url.hostname)) return false;
  if (url.pathname.startsWith('/__/') || url.pathname === '/precache-manifest.json' || url.pathname === '/sw.js') return false;
  return true;
}

// All or nothing: if any file can't be fetched (e.g. the connection drops mid-install), the
// install fails, the previous worker and its complete cache stay in charge, and the browser
// retries on a later visit. A half-filled cache must never replace a complete one.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch('/precache-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`precache manifest: HTTP ${response.status}`);
      const manifest = await response.json();
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll((manifest.files || []).map((path) => new Request(path, { cache: 'no-cache' })));
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('reopen-shell-') && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!handled(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok && !fresh.redirected && (await caches.has(CACHE))) {
            const cache = await caches.open(CACHE);
            await cache.put(new URL(request.url).pathname, fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(new URL(request.url).pathname, MATCH)) || (await cache.match('/', MATCH)) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      // caches.has first: an outgoing worker must not re-create the cache its successor just deleted.
      if (!(await caches.has(CACHE))) return fetch(request);
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, MATCH);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.redirected && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    })(),
  );
});
