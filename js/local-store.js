// Every persistent read and write goes through store().
//
// Dev sandbox: on localhost, add ?sandbox to the URL to play as a brand-new
// player. Data then lives in this tab's sessionStorage, so it survives reloads,
// the editor and playtests, while your real saves are never read or touched.
//   ?sandbox        enter the sandbox (keeps its data across reloads)
//   ?sandbox=reset  wipe the sandbox and start fresh again
//   ?sandbox=off    leave it and go back to your real data
// Closing the tab throws the sandbox away too.
const SANDBOX_FLAG = 'hjulben-sandbox';
// The IndexedDB databases kept for the page (see text-store.js), which the
// sandbox keeps apart from the real ones.
const DATABASES = ['hjulben-editor', 'hjulben-trails'];
/** The database the sandbox keeps in place of `name`. */
export const sandboxDatabase = name => `${name}-sandbox`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

let chosen = null;

function pick() {
  const { location, localStorage, sessionStorage } = globalThis;
  if (!location || !LOCAL_HOSTS.has(location.hostname)) return localStorage;
  try {
    const param = new URLSearchParams(location.search).get('sandbox');
    if (param === 'off' || param === 'reset') sessionStorage.clear();
    if (param !== null && param !== 'off') {
      // The sandbox's drafts and trails are kept in IndexedDB, which outlives
      // the tab, so a new sandbox starts without the last one's.
      if (param === 'reset' || !sessionStorage.getItem(SANDBOX_FLAG))
        for (const name of DATABASES) globalThis.indexedDB?.deleteDatabase(sandboxDatabase(name));
      sessionStorage.setItem(SANDBOX_FLAG, '1');
    }
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
