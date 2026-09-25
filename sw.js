// Network-first service worker: online loads always get the latest files,
// and everything fetched is kept so the game also starts offline.
const CACHE = 'pocket-trials-v1';
const CORE = [
  './', './index.html', './editor.html', './manifest.webmanifest', './css/game.css',
  './icons/icon.svg', './icons/icon-maskable.svg', './levels/catalog.json',
  './js/main.js', './js/game.js', './js/state.js', './js/input.js', './js/camera.js', './js/effects.js',
  './js/render.js', './js/ui/menu.js', './js/ui/overlay.js', './js/ride.js', './js/ragdoll.js',
  './js/replay-codec.js', './js/level-hash.js', './js/types.js', './js/det-math.js', './js/config.js', './js/levels.js',
  './js/materials.js', './js/audio.js', './js/physics.js', './js/physics-debug.js', './js/vehicle-physics.js',
  './js/rider-hair.js', './js/drawing.js', './js/terrain.js', './js/terrain-render.js', './js/storage.js',
  './js/level-schema.js', './js/editor.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE).catch(() => {});
    try {
      const catalog = await (await fetch('./levels/catalog.json')).json();
      await cache.addAll(catalog.levels.map(entry => './levels/' + entry.file));
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      throw error;
    }
  })());
});
