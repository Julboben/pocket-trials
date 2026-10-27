// Every persistent read and write goes through store().
//
// Dev sandbox: on localhost, add ?sandbox to the URL to play as a brand-new
// player. Data then lives in this tab's sessionStorage, so it survives reloads,
// the editor and playtests, while your real saves are never read or touched.
//   ?sandbox        enter the sandbox (keeps its data across reloads)
//   ?sandbox=reset  wipe the sandbox and start fresh again
//   ?sandbox=off    leave it and go back to your real data
// Closing the tab throws the sandbox away too; its drafts and trails stay in
// IndexedDB under the tab's own id, where nothing reads them again.
const SANDBOX_FLAG = 'hjulben-sandbox';
// The IndexedDB databases kept for the page (see text-store.js). The sandbox
// keeps its own, named for the tab: IndexedDB is shared by every tab, and
// another tab's sandbox must never see them, nor have them deleted under it.
const DATABASES = ['hjulben-editor', 'hjulben-trails'];
const sandboxName = (name, id) => `${name}-sandbox-${id}`;
/** The database this tab's sandbox keeps in place of `name`. */
export const sandboxDatabase = name => sandboxName(name, globalThis.sessionStorage.getItem(SANDBOX_FLAG));
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

let chosen = null;

function pick() {
  const { location, localStorage, sessionStorage } = globalThis;
  if (!location || !LOCAL_HOSTS.has(location.hostname)) return localStorage;
  try {
    const param = new URLSearchParams(location.search).get('sandbox');
    if (param === 'off' || param === 'reset') {
      // The sandbox's drafts and trails outlive the tab in IndexedDB, so
      // leaving or resetting it throws this tab's away too.
      const id = sessionStorage.getItem(SANDBOX_FLAG);
      if (id) for (const name of DATABASES) globalThis.indexedDB?.deleteDatabase(sandboxName(name, id));
      sessionStorage.clear();
    }
    // A new sandbox gets a new id, and with it databases no tab has used.
    if (param !== null && param !== 'off' && !sessionStorage.getItem(SANDBOX_FLAG))
      sessionStorage.setItem(SANDBOX_FLAG, globalThis.crypto.randomUUID().slice(0, 8));
    if (!sessionStorage.getItem(SANDBOX_FLAG)) return localStorage;
    globalThis.document?.documentElement?.setAttribute('data-sandbox', '');
    return sessionStorage;
  } catch (_) {
    return localStorage;
  }
}

/** Fired on window when a write to storage failed (usually because it is full), with `{ key }`. */
export const STORAGE_FAILED_EVENT = 'hjulben:storage-failed';

/** @returns {Storage} */
export function store() {
  return chosen ??= pick();
}

export const isSandbox = () => Boolean(globalThis.sessionStorage) && store() === globalThis.sessionStorage;
