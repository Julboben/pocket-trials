// Keeps the trail being edited in browser storage, so a refresh, a closed tab
// or switching trails doesn't lose work. Loading picks it up again; see
// loadTrailData.
import { trailEntries } from "../trails.js";
import { clearAutosave, writeAutosave } from "./drafts.js";
import { editor } from "./state.js";
import { showStatus } from "./status.js";

const AUTOSAVE_DELAY = 1000;
let timer = null;
// What the autosave slot holds (trail id and JSON), so an unchanged trail is
// not written again; null once the slot is empty or the last write failed.
let written = null;
// The last write failed, so the edits exist only in this tab until one works.
let failing = false;

/** Store the trail now if it differs from the version opened, else forget it. */
export function autosaveNow() {
  clearTimeout(timer);
  timer = null;
  const entry = trailEntries[editor.trailIndex];
  if (!entry || !editor.trail || !editor.version) return;
  const json = JSON.stringify(editor.trail, null, 2);
  const key = `${entry.id}\n${json}`;
  if (key === written) return;
  if (json === editor.version.base) {
    clearAutosave(entry.id);
    written = null;
    failing = false;
    return;
  }
  if (writeAutosave(entry.id, editor.trail, editor.version.baseHash)) {
    written = key;
    failing = false;
    return;
  }
  written = null;
  // Said every time it fails, not just the first: storage that fills up
  // later would otherwise lose edits in silence.
  failing = true;
  showStatus(
    "error",
    "Autosave failed: browser storage is full or blocked. Save a draft or export to keep your changes.",
  );
}

/** Are there edits that autosave could not keep? */
export const autosaveFailing = () => failing && Boolean(editor.version?.edited);

/** Autosave once editing pauses. */
export function scheduleAutosave() {
  clearTimeout(timer);
  timer = setTimeout(autosaveNow, AUTOSAVE_DELAY);
}

export function bindAutosave() {
  // pagehide fires on refresh and close; visibilitychange covers mobile, where
  // a backgrounded tab can be killed without either.
  window.addEventListener("pagehide", autosaveNow);
  // Edits the browser could not keep would be lost with the tab, so leaving
  // asks first.
  window.addEventListener("beforeunload", (event) => {
    autosaveNow();
    if (autosaveFailing()) event.preventDefault();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autosaveNow();
  });
}
