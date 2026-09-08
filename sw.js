// Temporary cleanup service worker.
// It removes all old CG-player caches and unregisters itself so mobile playback
// uses direct network requests instead of stale/broken PWA cache entries.
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
      for (const client of clients) {
        try { client.postMessage({type:'CG_SW_CLEANED'}); } catch (e) {}
      }
    } catch (e) {}
  })());
});

self.addEventListener('fetch', event => {
  // Do not intercept requests while cleanup is in progress.
});
