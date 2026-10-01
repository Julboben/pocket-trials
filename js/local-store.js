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
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

let chosen = null;

function pick() {
  const { location, localStorage, sessionStorage } = globalThis;
  if (!location || !LOCAL_HOSTS.has(location.hostname)) return localStorage;
  try {
    const param = new URLSearchParams(location.search).get('sandbox');
    if (param === 'off' || param === 'reset') sessionStorage.clear();
    if (param !== null && param !== 'off') sessionStorage.setItem(SANDBOX_FLAG, '1');
    if (!sessionStorage.getItem(SANDBOX_FLAG)) return localStorage;
    globalThis.document?.documentElement?.setAttribute('data-sandbox', '');
    return sessionStorage;
  } catch (_) {
    return localStorage;
  }
}

/** @returns {Storage} */
export function store() {
  return chosen ??= pick();
}

export const isSandbox = () => Boolean(globalThis.sessionStorage) && store() === globalThis.sessionStorage;
