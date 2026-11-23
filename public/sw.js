// Service Worker: Web-Push + Offline-Lesemodus
// - App-Gerüst und Programmdateien werden zwischengespeichert (App startet auch ohne Netz)
// - Lese-Anfragen an die Datenbank (GET /rest/v1) laufen „Netz zuerst"; bei Funkloch/schwachem Netz
//   wird nach 6 Sekunden der zuletzt geladene Stand angezeigt
// - Änderungen (POST/PATCH/DELETE) werden nie zwischengespeichert – offline sind sie nicht möglich
// - Beim Abmelden löscht die App den Datenzwischenspeicher (lager-api)
const SHELL = 'lager-shell-v3';
const ASSETS = 'lager-assets-v1';
const API = 'lager-api';
const IMG = 'lager-img-v1';
const KEEP = [SHELL, ASSETS, API, IMG];
const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lager-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const cached = () => cache.match(req, { ignoreVary: true });
  const net = fetch(req).then(async (res) => {
    if (res.ok) { await cache.put(req, res.clone()); trim(cacheName, 600); }
    return res;
  });
  if (!timeoutMs) return net.catch(async () => (await cached()) || Response.error());
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(async () => { const c = await cached(); if (c && !done) { done = true; resolve(c); } }, timeoutMs);
    net.then((r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
      .catch(async () => { clearTimeout(t); if (!done) { done = true; resolve((await cached()) || Response.error()); } });
  });
}

async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') { await cache.put(req, res.clone()); if (max) trim(cacheName, max); }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/index.html', copy)); return res; })
        .catch(async () => (await caches.match('/index.html')) || Response.error()));
      return;
    }
    if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req, ASSETS, 120)); return; }
    if (SHELL_FILES.includes(url.pathname)) { event.respondWith(networkFirst(req, SHELL, 0)); }
    return;
  }
  if (url.pathname.includes('/rest/v1/')) { event.respondWith(networkFirst(req, API, 6000)); return; }
  if (url.pathname.includes('/storage/v1/object/public/')) { event.respondWith(cacheFirst(req, IMG, 400)); }
});

// ---------- Web-Push ----------
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'MBG Lemgo – Lager', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'MBG Lemgo – Lager', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/#/chat' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
