// sw.js  — place at /violin-positions-quest/sw.js

// Bump this on each deploy to invalidate the old cache.
const CACHE = 'vpq-v10.8.2';

// Build absolute URLs for the app shell based on this SW's scope.
// This avoids subtle path issues on GitHub Pages (subdirectory hosting).
const SCOPE = self.registration ? self.registration.scope : self.location.href;
const urlFromScope = (p) => new URL(p, SCOPE).toString();

const APP_SHELL = [
  '',                    // resolves to /violin-positions-quest/
  'index.html',
  '404.html',            // GH Pages SPA fallback (nice to have)
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
].map(urlFromScope);

const INDEX_URL = urlFromScope('index.html');

// Third-party assets to allow at runtime (cache after first use).
// We check by hostname to handle both with/without trailing slash and query strings.
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // If any file 404s, addAll would reject and skip everything.
      // These adds run individually so one flaky file won't block install.
      await Promise.all(
        APP_SHELL.map((u) =>
          cache.add(u).catch(() => {
            /* ignore failures (e.g., optional 404.html) */
          })
        )
      );
    })()
  );

  // Move to "waiting" immediately; we'll claim on activate.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : undefined)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 1) HTML navigations → network-first, with offline fallback to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Prefer fresh content
          const live = await fetch(req);
          // Stash a copy of the app shell (index) so we always have offline fallback
          const cache = await caches.open(CACHE);
          cache.put(INDEX_URL, live.clone()).catch(() => {});
          return live;
        } catch {
          // Offline fallback
          const offline = await caches.match(INDEX_URL, { ignoreSearch: true });
          return (
            offline ||
            new Response('Offline', { status: 503, statusText: 'Offline' })
          );
        }
      })()
    );
    return;
  }

  // 2) Everything else → cache-first with runtime caching for allowed origins
  event.respondWith(
    (async () => {
      // Serve from cache if we have it
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        // Otherwise go to network
        const res = await fetch(req);

        // Cache a copy of successful GETs from same origin or allowed CDNs
        if (req.method === 'GET' && res.ok && isRuntimeAllowed(req.url)) {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          cache.put(req, copy).catch(() => {});
        }

        return res;
      } catch {
        // Last resort: return any stale cached copy if present
        const stale = await caches.match(req);
        return stale || Response.error();
      }
    })()
  );
});
