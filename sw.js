// Service worker: the app works offline and starts fast. The page and its main scripts (index.html, app.js, api.js)
// come from the network first (with a short timeout, then the saved copy); everything else is served from the phone
// and refreshed in the background. A new VERSION downloads a fresh set of files (never the browser's 10-minute copy).
const VERSION = 'homebase-v49';
const SHARE_CACHE = 'homebase-share';   // things shared into Homebase wait here until the app picks them up
const TTS_CACHE = 'homebase-tts';       // short phrases in the natural voice (kept by the app)
const SHELL = ['./', './index.html', './styles.css', './app.js', './api.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './maskable-512.png', './charts.js', './growth-cdc.js'];
const NET_FIRST_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== SHARE_CACHE && k !== TTS_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The app asks which version is running (Settings → AI models).
self.addEventListener('message', e => {
  if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
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
  if (url.pathname.includes('/__tts/') || url.pathname.endsWith('/sw.js')) return;   // kept phrases; the worker itself
  const nav = e.request.mode === 'navigate';
  const key = nav ? url.origin + url.pathname : e.request;
  // no-cache: ask GitHub Pages whether the file changed instead of using the browser's 10-minute copy
  const fetchFresh = cache => fetch(e.request.url, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  });
  if (nav || /\/(app|api)\.js$/.test(url.pathname)) {
    // network first: a new deploy shows up on the next start, not the one after
    e.respondWith(caches.open(VERSION).then(async cache => {
      const fresh = fetchFresh(cache).catch(() => null);
      const late = new Promise(r => setTimeout(r, NET_FIRST_MS, 'late'));
      const first = await Promise.race([fresh, late]);
      if (first && first !== 'late' && first.ok) return first;
      const hit = await cache.match(key, { ignoreSearch: nav }) || (nav ? await cache.match('./index.html') : null);
      if (hit) { e.waitUntil(fresh); return hit; }
      return (await fresh) || Response.error();
    }));
    return;
  }
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request);
    const fresh = fetchFresh(cache).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || Response.error();
  }));
});
