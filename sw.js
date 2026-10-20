// Service worker : l'appli s'ouvre même hors ligne ; images mises en cache ; données/prix toujours via le réseau.
const SHELL = 'vitrine-shell-v4';
const IMGS = 'vitrine-img-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'data/pokedex.json', 'data/legacy-alt.json', 'data/legacy-gallery.json', 'data/legacy-promo.json', 'data/legacy-scenes.json', 'data/ja-meta.json', 'icons/card-back.svg', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, IMGS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.tcgdex.net') return;                    // prix et catalogue : jamais en cache SW
  if (url.origin === location.origin) {                              // appli : réseau d'abord, cache en secours
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  if (req.destination === 'image') {                                 // images : cache d'abord
    e.respondWith(caches.open(IMGS).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r;
    }));
  }
});
