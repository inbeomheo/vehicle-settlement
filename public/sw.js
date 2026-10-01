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

self.addEventListener('push', (event) => {
  let message = {};
  try {
    const parsed = event.data?.json();
    if (parsed && typeof parsed === 'object') message = parsed;
  } catch {
    // A malformed payload still produces a useful user-visible notification.
  }
  const safePath = /^\/(?:m|d)\/uses\/[a-f0-9-]{36}$/.test(message.url ?? '') ? message.url : '/';
  event.waitUntil(
    self.registration.showNotification(
      typeof message.title === 'string' ? message.title : '차량 사용·정산 알림',
      {
        body: typeof message.body === 'string' ? message.body : '앱에서 새 요청을 확인해 주세요.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: typeof message.tag === 'string' ? message.tag : 'vehicle-notification',
        data: { url: safePath },
      },
    ),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  const url = new URL(
    typeof path === 'string' && /^\/(?:m|d)\/uses\/[a-f0-9-]{36}$/.test(path) ? path : '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => client.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
