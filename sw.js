// sw.js  — place at /violin-positions-quest/sw.js

// Bump this on each deploy to invalidate the old cache.
const CACHE = 'vpq-v8.9.9.9';

// Build absolute URLs for the app shell based on this SW's scope.
// This avoids subtle path issues on GitHub Pages (subdirectory hosting).
const SCOPE = self.registration ? self.registration.scope : self.location.href;
const urlFromScope = (p) => new URL(p, SCOPE).toString();

const APP_SHELL = [
  '',                    // resolves to /violin-positions-quest/
  'index.html',
  '404.html',            // GH Pages SPA fallback (optional)
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
].map(urlFromScope);

const INDEX_URL = urlFromScope('index.html');

// Third-party assets to allow at runtime (cache after first use).
// Check by hostname to handle query strings and trailing slashes.
const RUNTIME_ALLOWED_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

const isRuntimeAllowed = (requestUrl) => {
  const u = new URL(requestUrl);
  if (u.origin === self.location.origin) return true; // same-origin always OK
  return RUNTIME_ALLOWED_HOSTS.has(u.host);
};

// Optional: let the page tell the SW to activate immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// INSTALL: pre-cache the app shell (best-effort) and move to waiting.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      APP_SHELL.map((u) =>
        cache.add(u).catch(() => {
          /* ignore individual failures (e.g., optional 404.html) */
        })
      )
    );
  })());
  self.skipWaiting();
});

// ACTIVATE: enable navigation preload and clear old caches, then take control.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : undefined)));
    await self.clients.claim();
  })());
});

// FETCH: single, consolidated handler.
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignore non-GET early (let the network handle POST/PUT/…).
  if (req.method !== 'GET') return;

  // Avoid intercepting byte-range requests (e.g., media scrubbing).
  if (req.headers.has('range')) {
    event.respondWith(fetch(req));
    return;
  }

  // 1) HTML navigations → network-first with navigation preload; fallback to cached index.html.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        const live = preload || await fetch(req);
        // Keep a fresh copy of index.html for offline fallback.
        const cache = await caches.open(CACHE);
        cache.put(INDEX_URL, live.clone()).catch(() => {});
        return live;
      } catch {
        const offline = await caches.match(INDEX_URL, { ignoreSearch: true });
        return offline || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) Everything else → cache-first with conservative write-through for allowed origins.
  event.respondWith((async () => {
    // Serve from cache if we have it.
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);

      // Only cache successful same-origin / allow-listed responses.
      if (res && res.ok && isRuntimeAllowed(req.url)) {
        // Don’t cache explicit no-store responses.
        const cc = res.headers.get('Cache-Control') || '';
        if (!/\bno-store\b/i.test(cc)) {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          cache.put(req, copy).catch(() => {});
        }
      }

      return res;
    } catch {
      // Last resort: return any stale cached copy if present.
      const stale = await caches.match(req);
      return stale || Response.error();
    }
  })());
});