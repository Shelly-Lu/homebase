// Service worker: the app's own files are served from the phone straight away (instant start, works offline),
// and a fresh copy is fetched in the background, so an update shows up the next time the app is opened.
const VERSION = 'homebase-v20';
const SHELL = ['./', './index.html', './styles.css', './app.js', './api.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const nav = e.request.mode === 'navigate';
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: nav });
    // no-cache: ask GitHub Pages whether the file changed instead of using the browser's 10-minute copy
    const fresh = fetch(e.request.url, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) cache.put(nav ? url.origin + url.pathname : e.request, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    return res || (await cache.match('./index.html')) || Response.error();
  }));
});
