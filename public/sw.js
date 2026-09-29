/* Only public assets are cached. Never cache API, RSC, authenticated HTML or files. */
importScripts('/sw-version.js');
const CACHE = `vehicle-shell-w2-${self.VEHICLE_SHELL_VERSION}`;
const ASSETS = [
  '/offline.html',
  '/offline-login.html',
  '/w2-offline-app.js',
  '/w2-offline-app.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('vehicle-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/'))
    return;
  if (request.mode === 'navigate') {
    if (url.pathname === '/login') {
      event.respondWith(
        fetch(request).catch(async () => (await caches.match('/offline-login.html')) ?? Response.error()),
      );
      return;
    }
    // Only W2 routes are supported by the offline form. Other owners' screens
    // must never become an offline editor by accident.
    if (
      !/^\/d(?:\/new|\/uses\/[^/]+)?$/.test(url.pathname) &&
      !/^\/m\/uses\/(?:new|[^/]+\/edit)$/.test(url.pathname)
    )
      return;
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/offline.html')) ?? Response.error()),
    );
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
