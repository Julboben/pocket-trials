// Keeps the trail being edited in browser storage, so a refresh, a closed tab
// or switching trails doesn't lose work. Loading picks it up again; see
// loadTrailData.
import { trailEntries } from "../trails.js";
import { clearAutosave, writeAutosave } from "./drafts.js";
import { editor } from "./state.js";
import { showStatus } from "./status.js";

const AUTOSAVE_DELAY = 1000;
let timer = null;
let written = null;
let warned = false;

/** Store the trail now if it differs from the version opened, else forget it. */
export function autosaveNow() {
  clearTimeout(timer);
  timer = null;
  const entry = trailEntries[editor.trailIndex];
  if (!entry || !editor.trail || !editor.version) return;
  const json = JSON.stringify(editor.trail, null, 2);
  const key = `${entry.id}\n${json}`;
  if (key === written) return;
  written = key;
  if (json === editor.version.base) {
    clearAutosave(entry.id);
    return;
  }
  if (writeAutosave(entry.id, editor.trail)) return;
  written = null;
  if (warned) return;
  warned = true;
  showStatus(
    "error",
    "Autosave failed: browser storage is full or blocked. Save a draft or export to keep your changes.",
  );
}

/** Autosave once editing pauses. */
export function scheduleAutosave() {
  clearTimeout(timer);
  timer = setTimeout(autosaveNow, AUTOSAVE_DELAY);
}

export function bindAutosave() {
  // pagehide fires on refresh and close; visibilitychange covers mobile, where
  // a backgrounded tab can be killed without either.
  window.addEventListener("pagehide", autosaveNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autosaveNow();
  });
}
