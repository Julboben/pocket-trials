// @ts-check
// New releases, for the game and the editor alike. The service worker
// (sw.js) installs a release in the background and takes over the open pages
// as soon as it has. A page that was already running then has to reload: the
// old release's files are gone from the cache, so anything it loads later
// comes from the new one, and the world board turns down runs from an old
// game. So it asks in a dialog that can't be dismissed, once the page says it
// is a good moment (see setUpdatePrompt).
//
// Imported first by each page's main module, so it is listening before the
// trails load: a release that takes over during that wait is not missed.

/** How often a page that stays open looks for a new release. */
const CHECK_EVERY = 60 * 60 * 1000;

/** A new release has taken over this page, which still runs the old one. */
let ready = false;
let reloading = false;
/** The page let the player put the reload off; see setUpdatePrompt. */
let postponed = false;
let canShow = () => false;
let canPostpone = () => false;
/** @type {() => Promise<void> | void} */
let beforeReload = () => {};

const dialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('update-dialog'));
const reloadButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('update-reload'));
const laterButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('update-later'));
const laterNote = document.getElementById('update-later-note');

// The editor's play test runs the game in a frame; the editor around it asks.
const embedded = window.parent !== window;

if ('serviceWorker' in navigator && window.isSecureContext && !embedded) {
  // A worker taking over a page that already had one means a new release.
  // The first install claims the page too, but there is nothing to reload for.
  const hadController = Boolean(navigator.serviceWorker.controller);
  // On the dev server (npm run dev) the worker fetches every file from the
  // network first (see LOCAL in sw.js), so a reload always runs the latest
  // code and nothing goes stale. Every change there regenerates sw.js, which
  // would otherwise ask for a reload each time.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || ready || local) return;
    ready = true;
    offerUpdate();
  });

  /** @type {ServiceWorkerRegistration | null} */
  let registration = null;
  let checkedAt = 0;
  // The browser only looks for a new worker when a page loads, so a tab left
  // open, or a home-screen app resumed for days, looks for itself.
  const check = () => {
    if (!registration || ready || Date.now() - checkedAt < CHECK_EVERY) return;
    checkedAt = Date.now();
    registration.update().catch(() => {});
  };
  const register = () => navigator.serviceWorker.register('./sw.js').then(registered => {
    registration = registered;
    // Every load checks too: the browser's own check on reload can't be relied
    // on, and the page's files come from the cache.
    checkedAt = Date.now();
    return registered.update();
  }).catch(() => {});
  // The page's modules wait for the trails, so it has usually finished
  // loading by the time anything listens for load.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    check();
    // A reload put off earlier is asked for again on coming back.
    offerUpdate();
  });
  setInterval(check, CHECK_EVERY);
}

if (dialog && reloadButton) {
  // Neither Esc nor a click outside closes it; closedby="none" in the markup
  // says the same to browsers that know it.
  dialog.addEventListener('cancel', event => event.preventDefault());
  // A browser may still close it on a second Esc; it opens again.
  dialog.addEventListener('close', () => {
    if (!reloading && !postponed) dialog.showModal();
  });
  reloadButton.addEventListener('click', reloadNow);
  laterButton?.addEventListener('click', () => {
    postponed = true;
    dialog.close();
  });
}

/**
 * How the page fits the prompt in. `canShow` says whether now is a good
 * moment; until a page says, it never is. `beforeReload` keeps what the page
 * has not stored yet. `canPostpone` lets the player put the reload off, for
 * when reloading would lose work the page could not store.
 * @param {{ canShow: () => boolean, beforeReload?: () => Promise<void> | void, canPostpone?: () => boolean }} options
 */
export function setUpdatePrompt(options) {
  canShow = options.canShow;
  beforeReload = options.beforeReload ?? (() => {});
  canPostpone = options.canPostpone ?? (() => false);
  offerUpdate();
}

/** Asks for the reload if a new release is waiting and now is a good moment. */
export function offerUpdate() {
  if (!ready || !dialog || dialog.open || !canShow()) return;
  const later = canPostpone();
  // Put off once, it asks again at the next good moment.
  postponed = false;
  if (laterButton) laterButton.hidden = !later;
  if (laterNote) laterNote.hidden = !later;
  dialog.showModal();
  reloadButton?.focus();
}

/** Whether the prompt is on screen, so the page's own controls can leave it be. */
export const updatePromptOpen = () => Boolean(dialog?.open);

/** Reloads into the new release, once the page has stored what it needs to. */
export async function reloadNow() {
  if (reloading) return;
  reloading = true;
  if (reloadButton) reloadButton.disabled = true;
  try {
    await beforeReload();
  } finally {
    window.location.reload();
    // The page may yet stay, if the player turns down the browser's own
    // "leave this page?" for edits it couldn't store.
    setTimeout(() => {
      reloading = false;
      if (reloadButton) reloadButton.disabled = false;
    }, 1000);
  }
}
