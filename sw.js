// Service worker: the app's own files are served from the phone straight away (instant start, works offline),
// and a fresh copy is fetched in the background, so an update shows up the next time the app is opened.
const VERSION = 'homebase-v44';
const SHARE_CACHE = 'homebase-share';   // things shared into Homebase wait here until the app picks them up
const SHELL = ['./', './index.html', './styles.css', './app.js', './api.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './charts.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== SHARE_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Android "Share → Homebase": keep what was shared, then open the chat (GitHub Pages can't take a POST itself).
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const chat = new URL('./#chat', self.registration.scope).href;
      try {
        const fd = await e.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const meta = { title: String(fd.get('title') || ''), text: String(fd.get('text') || ''), url: String(fd.get('url') || ''), at: Date.now() };
        await cache.put('./__shared/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
        const img = fd.getAll('image').find(f => f && f.size);
        if (img) await cache.put('./__shared/image', new Response(img, { headers: { 'Content-Type': img.type || 'image/jpeg' } }));
        else await cache.delete('./__shared/image');
      } catch (err) { /* open the chat anyway */ }
      return Response.redirect(chat, 303);
    })());
    return;
  }
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
