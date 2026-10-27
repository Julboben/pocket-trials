// Where the editor keeps drafts and autosaves: a text store in IndexedDB,
// compressed (see js/text-store.js). Drafts of a large trail, kept a few
// times over, used to fill localStorage.
import { createTextStore } from "../text-store.js";

// Keys this module took over from localStorage: they move on first open.
const LEGACY_PREFIXES = ["hjulben-editor-drafts-v2-", "hjulben-editor-autosave-v1-"];

const drafts = createTextStore({
  name: "hjulben-editor",
  adopt(local) {
    const moved = [];
    for (let index = 0; index < local.length; index++) {
      const key = local.key(index);
      const text = key && LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)) ? local.getItem(key) : null;
      if (text !== null) moved.push({ from: key, entries: [[key, text]] });
    }
    return moved;
  },
});

/** Read everything into memory, before the editor opens a trail. */
export const openDraftStore = () => drafts.open();
/** Called with the key whenever a write fails, so the author can be told. */
export const onStoreFailure = (handler) => drafts.onFailure(handler);
export const readText = (key) => drafts.read(key);
/** See createTextStore's `write`; `urgent` as the page is hidden or closed. */
export const writeText = (key, text, options) => {
  drafts.write(key, text, options);
};
export const removeText = (key) => {
  drafts.remove(key);
};
export const whenWritten = () => drafts.whenWritten();
