// Texts too large for localStorage: IndexedDB, gzip-compressed. localStorage
// holds about 5 MB per site and only text, so a large trail, kept a few
// times over, used to fill it. The editor keeps its drafts and autosaves
// here (js/editor/draft-store.js), and the game the trails saved in the
// browser (js/trails.js).
//
// Everything stored is read into memory when the store opens, as the text
// it was saved as, so reading stays as quick and synchronous as it was from
// localStorage. Writes go to memory at once and to the database in the
// background, compressed; when one fails, the store's failure handler is told.
import { isSandbox, sandboxDatabase, store } from "./local-store.js";

const RECORDS = "texts";

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
 * A store of texts by key, in the database `name` (its own one in the
 * localhost sandbox, see local-store.js).
 *
 * `adopt` finds what the page kept in localStorage before: for each old key,
 * the texts it becomes here. They are moved over when the store opens, and the
 * old key only removed once they are safely written.
 * @param {{ name: string, adopt?: (local: Storage) => { from: string, entries: [string, string][] }[] }} options
 */
export function createTextStore({ name, adopt = () => [] }) {
  /** @type {Map<string, string>} */
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

  const track = (promise) => {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
    return promise;
  };

  async function write(key, text, urgent = false) {
    const version = ++serial;
    versions.set(key, version);
    try {
      if (!db) throw new Error("no database");
      const value = text === null || urgent ? text : { gzip: await gzip(text) };
      // A newer write to this key has started; it carries the latest text.
      if (versions.get(key) !== version) return true;
      const transaction = db.transaction(RECORDS, "readwrite");
      const records = transaction.objectStore(RECORDS);
      if (value === null) records.delete(key);
      else records.put(typeof value === "string" ? { text: value } : value, key);
      await done(transaction);
      return true;
    } catch (_) {
      if (versions.get(key) === version) failureHandler(key);
      return false;
    }
  }

  function moveFromLocalStorage() {
    try {
      const local = store();
      for (const { from, entries } of adopt(local)) {
        const fresh = entries.filter(([key]) => !texts.has(key));
        for (const [key, text] of fresh) texts.set(key, text);
        Promise.all(fresh.map(([key, text]) => track(write(key, text)))).then((written) => {
          if (written.every(Boolean)) local.removeItem(from);
        });
      }
    } catch (_) {}
  }

  return {
    /**
     * Open the database and read everything in it, then move over what
     * localStorage still holds. Without IndexedDB (storage blocked), the page
     * still works, and every write reports a failure.
     */
    async open() {
      try {
        const request = indexedDB.open(isSandbox() ? sandboxDatabase(name) : name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(RECORDS);
        db = await done(request);
        const transaction = db.transaction(RECORDS);
        const keys = transaction.objectStore(RECORDS).getAllKeys();
        const values = transaction.objectStore(RECORDS).getAll();
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
    },
    /** Called with the key whenever a write fails, so the player can be told. */
    onFailure(handler) {
      failureHandler = handler;
    },
    /** @returns {string | null} */
    read: (key) => texts.get(key) ?? null,
    /** The keys starting with `prefix`. */
    keys: (prefix = "") => [...texts.keys()].filter((key) => key.startsWith(prefix)),
    /**
     * Store `text` under `key`. With `urgent`, as the page is hidden or closed,
     * it is written uncompressed in a transaction started right away, which the
     * browser finishes even as the page goes; the next write compresses it again.
     * @returns {Promise<boolean>} whether it reached the database
     */
    write(key, text, { urgent = false } = {}) {
      texts.set(key, text);
      return track(write(key, text, urgent));
    },
    /** @returns {Promise<boolean>} */
    remove(key) {
      texts.delete(key);
      return track(write(key, null));
    },
    /** Resolves once every write started so far has reached the database, or failed. */
    async whenWritten() {
      while (inFlight.size) await Promise.all(inFlight);
    },
  };
}
