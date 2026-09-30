// Network-first service worker: online loads always get the latest files,
// and everything fetched is kept so the game also starts offline.
const CACHE = 'pocket-trials-b63fd77e';
const CORE = [
  './',
  './css/editor.css',
  './css/game.css',
  './editor.html',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
  './index.html',
  './js/audio.js',
  './js/camera.js',
  './js/config.js',
  './js/det-math.js',
  './js/drawing.js',
  './js/editor-snap.js',
  './js/editor.js',
  './js/effects.js',
  './js/finish.js',
  './js/game.js',
  './js/input.js',
  './js/level-hash.js',
  './js/level-schema.js',
  './js/levels.js',
  './js/main.js',
  './js/materials.js',
  './js/online-leaderboard.js',
  './js/physics-debug.js',
  './js/physics.js',
  './js/ragdoll.js',
  './js/render.js',
  './js/replay-codec.js',
  './js/ride.js',
  './js/rider-hair.js',
  './js/state.js',
  './js/storage.js',
  './js/terrain-geometry.js',
  './js/terrain-legacy.js',
  './js/terrain-render.js',
  './js/terrain-runtime.js',
  './js/terrain.js',
  './js/types.js',
  './js/ui/menu.js',
  './js/ui/overlay.js',
  './js/vehicle-physics.js',
  './manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One file at a time: addAll is all-or-nothing, so a single 404 would
    // leave the whole app uncached. A file that fails is logged, not fatal.
    const results = await Promise.allSettled(CORE.map(file => cache.add(file)));
    const failed = results
      .map((result, index) => (result.status === 'rejected' ? CORE[index] : null))
      .filter(Boolean);
    if (failed.length) console.warn('[sw] could not precache:', failed);
    try {
      const catalog = await (await fetch('./levels/catalog.json')).json();
      await Promise.allSettled(
        catalog.levels.map(entry => cache.add('./levels/' + entry.file)),
      );
    } catch (error) {
      console.warn('[sw] could not precache the level catalog:', error);
    }
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
      // A slow network should not hold up the page, but giving up after the
      // timeout would break a first load with nothing cached. So the cached
      // copy is used when there is one, and otherwise the fetch keeps going.
      const network = fetch(event.request);
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000, null));
      const response = await Promise.race([network, timeout]);
      if (response) {
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      }
      // Slow network: use the cached copy if there is one, else keep waiting.
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) {
        // Keep the late response for next time, and ignore it if it fails.
        event.waitUntil(
          network
            .then((late) => late.ok && cache.put(event.request, late.clone()))
            .catch(() => {}),
        );
        return cached;
      }
      const late = await network;
      if (late.ok) cache.put(event.request, late.clone());
      return late;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      throw error;
    }
  })());
});
