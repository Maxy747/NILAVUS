// NILAVUS offline shell: lets the installed (Add to Home Screen) web app open without a
// connection. Live telemetry and the M.A.X. core are cross-origin, so they always go to the
// network. Paths are relative, so this works on all three NILAVUS sites.
//
// The build (vite.config.ts, precacheManifest) replaces the two placeholders below with the
// exact list of built files, including the content-hashed JS/CSS, and a version derived from
// that list, so every deploy gets a fresh cache and the old one is removed.
const PRECACHE = self.__PRECACHE__;
const CACHE = 'nilavus-shell-__PRECACHE_VERSION__';
// Vite loads its bundles as crossorigin module scripts; some hosts answer with "Vary: Origin",
// which would make a precached copy (fetched without Origin) never match. Files here are
// static and content-hashed, so ignoring Vary is safe.
const MATCH = { ignoreVary: true };

self.addEventListener('install', event => {
  // All-or-nothing: if any file fails, the new version isn't installed and the old one keeps working.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('nilavus-shell-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first so updates show up; fall back to the precached shell when offline.
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('./index.html', MATCH)) || (await caches.match('./', MATCH)) || Response.error();
      }
    })());
    return;
  }

  // Precached and hashed files: cache first. Anything else (e.g. the large menu track) is
  // cached the first time it's played, so later visits can use it offline too.
  event.respondWith((async () => {
    const cached = await caches.match(request, MATCH);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !request.headers.has('range')) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  })());
});
