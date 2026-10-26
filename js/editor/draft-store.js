// Where the editor keeps drafts and autosaves: IndexedDB, gzip-compressed.
// localStorage holds about 5 MB per site and only text, so a large trail,
// with an autosave and a few drafts of it, used to fill it.
//
// Everything stored is read into memory when the editor opens, as the JSON
// text it was saved as, so reading stays as quick and synchronous as it was
// from localStorage. Writes go to memory at once and to the database in the
// background, compressed; when one fails, onStoreFailure's handler is told.
import { SANDBOX_DATABASE, isSandbox, store } from "../local-store.js";

const STORE = "texts";
// Keys this module took over from localStorage: they move on first open.
const LEGACY_PREFIXES = ["hjulben-editor-drafts-v2-", "hjulben-editor-autosave-v1-"];

/** @type {Map<string, string>} key -> JSON text */
const texts = new Map();
/** @type {IDBDatabase | null} */
let db = null;
// Every write to a key gets the next number, so a slow compressed write
// never lands on top of a newer one.
const versions = new Map();
let serial = 0;
let failureHandler = (_key) => {};
/** @type {Set<Promise<boolean>>} */
const inFlight = new Set();

const databaseName = () => (isSandbox() ? SANDBOX_DATABASE : "hjulben-editor");

/** @param {IDBRequest | IDBTransaction} request */
const done = (request) =>
  new Promise((resolve, reject) => {
    if ("oncomplete" in request) {
      request.oncomplete = () => resolve(undefined);
      request.onabort = request.onerror = () => reject(request.error);
    } else {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  });

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Open the database and read everything in it. Drafts still in localStorage
 * from before are moved over, and only removed from there once they are
 * safely written. Without IndexedDB (storage blocked), the editor still
 * works, and every write reports a failure.
 */
export async function openDraftStore() {
  try {
    const request = indexedDB.open(databaseName(), 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    db = await done(request);
    const transaction = db.transaction(STORE);
    const keys = transaction.objectStore(STORE).getAllKeys();
    const values = transaction.objectStore(STORE).getAll();
    await done(transaction);
    await Promise.all(
      keys.result.map(async (key, index) => {
        const value = values.result[index];
        try {
          texts.set(String(key), value.gzip ? await gunzip(value.gzip) : value.text);
        } catch (_) {}
      }),
    );
  } catch (_) {
    db = null;
  }
  moveFromLocalStorage();
}

function moveFromLocalStorage() {
  let local;
  try {
    local = store();
    for (let index = 0; index < local.length; index++) {
      const key = local.key(index);
      if (!key || !LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      const text = local.getItem(key);
      if (text === null) continue;
      if (!texts.has(key)) {
        texts.set(key, text);
        track(write(key, text)).then((written) => {
          if (written) local.removeItem(key);
        });
      } else local.removeItem(key);
    }
  } catch (_) {}
}

/** Called with the key whenever a write fails, so the author can be told. */
export function onStoreFailure(handler) {
  failureHandler = handler;
}

/** @returns {string | null} */
export function readText(key) {
  return texts.get(key) ?? null;
}

/**
 * Store `text` under `key`. With `urgent`, as the page is hidden or closed,
 * it is written uncompressed in a transaction started right away, which the
 * browser finishes even as the page goes; the next write compresses it again.
 */
export function writeText(key, text, { urgent = false } = {}) {
  texts.set(key, text);
  track(write(key, text, urgent));
}

export function removeText(key) {
  texts.delete(key);
  track(write(key, null));
}

function track(promise) {
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise));
  return promise;
}

/** Resolves once every write started so far has reached the database, or failed. */
export async function whenWritten() {
  while (inFlight.size) await Promise.all(inFlight);
}

async function write(key, text, urgent = false) {
  const version = ++serial;
  versions.set(key, version);
  try {
    if (!db) throw new Error("no database");
    const value = text === null || urgent ? text : { gzip: await gzip(text) };
    // A newer write to this key has started; it carries the latest text.
    if (versions.get(key) !== version) return true;
    const transaction = db.transaction(STORE, "readwrite");
    const records = transaction.objectStore(STORE);
    if (value === null) records.delete(key);
    else records.put(typeof value === "string" ? { text: value } : value, key);
    await done(transaction);
    return true;
  } catch (_) {
    if (versions.get(key) === version) failureHandler(key);
    return false;
  }
}
