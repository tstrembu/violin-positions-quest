// sw.js (at /violin-positions-quest/sw.js)
const CACHE = "vpq-v8.9.1"; // ← bump this string
const ASSETS = [
    "./",                 // resolves to /violin-positions-quest/
  "./index.html",
  "./404.html",         // GH Pages SPA fallback (optional but nice)
  "./manifest.webmanifest",
  "./sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];
const APP_SHELL = [
  "./",                 // resolves to /violin-positions-quest/
  "./index.html",
  "./404.html",         // GH Pages SPA fallback (optional but nice)
  "./manifest.webmanifest",
  "./sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

// Third-party assets: cache after first use (runtime), not during install.
// (Google Fonts & CDNs are CORS-enabled; cache will work.)
const RUNTIME_ALLOWED = new Set([
  "https://cdn.tailwindcss.com/",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
  "https://fonts.gstatic.com/"
]);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting(); // lets the new SW become waiting immediately
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : undefined)))
    )
  );
  self.clients.claim(); // new SW controls open pages after one refresh
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1) HTML navigations → network-first with offline fallback to app shell
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Try network (fresh content)
          const live = await fetch(req);
          // Optionally stash a copy for offline too
          const cache = await caches.open(CACHE);
          cache.put("./index.html", live.clone()).catch(() => {});
          return live;
        } catch (err) {
          // Offline → cached shell (index.html)
          const offline = await caches.match("./index.html");
          return offline || new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // 2) Static app shell assets → cache-first
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        // Only cache GETs and allowed cross-origin assets
        const url = new URL(req.url);
        const isSameOrigin = url.origin === self.location.origin;
        const okThirdParty = [...RUNTIME_ALLOWED].some((p) => req.url.startsWith(p));
        if (req.method === "GET" && (isSameOrigin || okThirdParty) && res.ok) {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          cache.put(req, copy).catch(() => {});
        }
        return res;
      } catch (err) {
        // Last-resort: return any stale cached copy if present
        return cached || Response.error();
      }
    })()
  );
});
