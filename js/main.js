import { startGame } from './game.js';
import { readSharedTrail, trailLinkFromHash } from './trail-link.js';
import { customTrailEntries, saveSharedTrail } from './trails.js';

// A share link (#trail=…) rides its trail straight away and keeps it under
// Custom Trails.
let shared = null;
try {
  const trail = await readSharedTrail(window.location.hash, customTrailEntries.length);
  if (trail) shared = { entry: saveSharedTrail(trail) };
} catch (error) {
  shared = { error };
}
// So a reload doesn't open the trail again, and the address bar stays short.
if (shared) history.replaceState(null, '', window.location.pathname + window.location.search);

startGame({ shared });

// A share link opened in a tab that already has the game only changes the hash.
window.addEventListener('hashchange', () => {
  if (trailLinkFromHash(window.location.hash) !== null) window.location.reload();
});

// Offline play once installed. The worker serves the game's own files from
// its cache; a new release installs in the background and takes over the page
// (see sw.js), and the dashboard then offers a reload. Trail files, and
// everything on the dev server, stay network-first.
if ('serviceWorker' in navigator && window.isSecureContext) {
  // A worker taking over a page that already had one means a new release.
  // The first install claims the page too, but there is nothing to reload for.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    // The toast lives in the menu screen, so it only shows on the dashboard and never mid-ride.
    const toast = document.getElementById('update-toast');
    if (!toast) return;
    toast.hidden = false;
    document.getElementById('update-reload')?.addEventListener('click', () => {
      reloading = true;
      window.location.reload();
    }, { once: true });
  });
  // Checks for a new release on every load too: the browser's own check on
  // reload can't be relied on, and the game's files come from the cache.
  const register = () => navigator.serviceWorker.register('./sw.js').then(registration => registration.update()).catch(() => {});
  // The trails are awaited while the modules load, so the page has usually
  // finished loading by now and a load listener would never fire.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
