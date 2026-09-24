// NILAVUS offline shell: lets the installed (Add to Home Screen) web app open without a
// connection. Live telemetry and the Dosimeter assistant are cross-origin, so they always
// go to the network. Paths are relative, so this works on all three NILAVUS sites.
const SHELL_CACHE = 'nilavus-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './n-logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only remove our own old shell caches.
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('nilavus-shell-') && name !== SHELL_CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Live telemetry, the model download and anything cross-origin always go to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first so updates show up; fall back to the cached shell when offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Built assets have content hashes in their names, so cache-first is safe.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !request.headers.has('range')) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  })());
});
