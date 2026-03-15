// ============================================================
// sw.js – Service Worker for background trip checks
// ============================================================

const CACHE_NAME = 'fahrplan-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/db.js', '/trias.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ---- Periodic trip check ----
self.addEventListener('message', e => {
  if (e.data?.type === 'CHECK_TRIPS') {
    checkTrips();
  }
});

async function checkTrips() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SW_CHECK_TRIPS' });
  });
}

// Trigger check via setInterval from client side every 60 s
