// Service worker. The game's own files (CORE) are served from the cache this
// worker filled when it installed: CACHE changes with their content, so every
// release installs a fresh copy of all of them and a page never mixes files
// from two releases. It takes over on the next load. Trail files and anything
// else are network-first, and kept so the game also starts offline.
const CACHE = 'hjulben-c6b12a06';
const CORE = [
  './',
  './css/editor.css',
  './css/game.css',
  './css/icons.css',
  './css/tokens.css',
  './editor.html',
  './fonts/Jersey10-Regular.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
  './index.html',
  './js/account.js',
  './js/achievements.js',
  './js/apple.js',
  './js/audio.js',
  './js/bike-lamps.js',
  './js/camera.js',
  './js/cave-props.js',
  './js/changelog.js',
  './js/city-props.js',
  './js/config.js',
  './js/corgi-props.js',
  './js/cosmetics.js',
  './js/desert-props.js',
  './js/det-math.js',
  './js/drawing.js',
  './js/easter-eggs.js',
  './js/editor/autosave.js',
  './js/editor/blocks.js',
  './js/editor/clipboard.js',
  './js/editor/dom.js',
  './js/editor/drafts.js',
  './js/editor/history.js',
  './js/editor/hit-test.js',
  './js/editor/input.js',
  './js/editor/inspector.js',
  './js/editor/main.js',
  './js/editor/menu.js',
  './js/editor/picker.js',
  './js/editor/playtest.js',
  './js/editor/render.js',
  './js/editor/rotate.js',
  './js/editor/scale.js',
  './js/editor/selection.js',
  './js/editor/snap.js',
  './js/editor/state.js',
  './js/editor/status.js',
  './js/editor/thumbnails.js',
  './js/editor/tools.js',
  './js/editor/trails.js',
  './js/editor/view.js',
  './js/editor/water.js',
  './js/effects.js',
  './js/finish.js',
  './js/forest-props.js',
  './js/fps-meter.js',
  './js/game.js',
  './js/garage-backdrop.js',
  './js/glass.js',
  './js/input.js',
  './js/interactions.js',
  './js/light-field.js',
  './js/lighting.js',
  './js/local-store.js',
  './js/main.js',
  './js/materials.js',
  './js/mountain-props.js',
  './js/online-leaderboard.js',
  './js/physics-debug.js',
  './js/physics.js',
  './js/player-shape.js',
  './js/ragdoll.js',
  './js/render.js',
  './js/replay-codec.js',
  './js/ride.js',
  './js/rider-hair.js',
  './js/rider-name.js',
  './js/scene-preview.js',
  './js/spike.js',
  './js/state.js',
  './js/storage.js',
  './js/terrain-geometry.js',
  './js/terrain-render.js',
  './js/terrain-runtime.js',
  './js/terrain.js',
  './js/trail-hash.js',
  './js/trail-schema.js',
  './js/trails.js',
  './js/types.js',
  './js/ui/customizer.js',
  './js/ui/menu.js',
  './js/ui/overlay.js',
  './js/unlocks.js',
  './js/vehicle-physics.js',
  './js/version.js',
  './js/water-props.js',
  './js/water.js',
  './manifest.webmanifest',
];

// The dev server (npm run dev) stays network-first for everything, so an edit
// shows on the next reload without regenerating the cache name.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
const CORE_PATHS = new Set(CORE.map(file => new URL(file, self.location.href).pathname));
// Past the browser's HTTP cache, so a release is precached as deployed.
const fresh = file => new Request(file, { cache: 'reload' });

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One file at a time: addAll is all-or-nothing, so a single 404 would
    // leave the whole app uncached. A file that fails is logged, not fatal.
    const results = await Promise.allSettled(CORE.map(file => cache.add(fresh(file))));
    const failed = results
      .map((result, index) => (result.status === 'rejected' ? CORE[index] : null))
      .filter(Boolean);
    if (failed.length) console.warn('[sw] could not precache:', failed);
    try {
      const catalog = await (await fetch('./trails/catalog.json')).json();
      await Promise.allSettled(
        catalog.trails.map(entry => cache.add(fresh('./trails/' + entry.file))),
      );
      // Only exists locally, next to the git-ignored custom trails.
      const custom = await fetch('./trails/custom-catalog.json').catch(() => null);
      if (custom?.ok) {
        await cache.put('./trails/custom-catalog.json', custom.clone());
        const { trails } = await custom.json();
        await Promise.allSettled(trails.map(entry => cache.add(fresh('./trails/' + entry.file))));
      }
    } catch (error) {
      console.warn('[sw] could not precache the trail catalog:', error);
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
  if (!LOCAL && CORE_PATHS.has(url.pathname)) {
    event.respondWith(cacheFirst(event));
    return;
  }
  event.respondWith(networkFirst(event));
});

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  if (cached) return cached;
  // Missed at install (offline, or a failed file): fetch it now and keep it.
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
  return response;
}

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    // A slow network should not hold up the page, but giving up after the
    // timeout would break a first load with nothing cached. So the cached
    // copy is used when there is one, and otherwise the fetch keeps going.
    const network = fetch(event.request);
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000, null));
    const response = await Promise.race([network, timeout]);
    if (response) {
      // waitUntil keeps the worker alive until the copy is stored.
      if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
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
    if (late.ok) event.waitUntil(cache.put(event.request, late.clone()));
    return late;
  } catch (error) {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}
