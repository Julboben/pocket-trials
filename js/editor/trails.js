// Loading, saving, drafts and the trail picker.
import { store } from "../local-store.js";
import {
  createBlankTrail,
  normalizeTrail,
  validateTrail,
} from "../trail-schema.js";
import {
  deleteBrowserTrail,
  deleteTrailFile,
  saveBrowserTrail,
  saveTrailFile,
  trailEntries,
  uniqueCustomFile,
} from "../trails.js";
import { $ } from "./dom.js";
import { syncInspector } from "./inspector.js";
import { render } from "./render.js";
import { editor } from "./state.js";
import { flash, refuse, showStatus } from "./status.js";
import { focusOnStart } from "./view.js";

export const DRAFT_PREFIX = "hjulben-editor-draft-v1-";

const CURRENT_TRAIL_KEY = "hjulben-editor-current-v1";

export function storedTrailIndex() {
  try {
    const index = trailEntries.findIndex(
      (entry) => entry.id === store().getItem(CURRENT_TRAIL_KEY),
    );
    return Math.max(0, index);
  } catch (_) {
    return 0;
  }
}

function rememberTrail() {
  try {
    store().setItem(CURRENT_TRAIL_KEY, trailEntries[editor.trailIndex].id);
  } catch (_) {}
}

export function loadTrailData(index) {
  const stored = trailEntries[index]?.trail;
  try {
    const draft = JSON.parse(
      store().getItem(DRAFT_PREFIX + trailEntries[index].id) || "null",
    );
    return normalizeTrail(draft || stored || createBlankTrail(index), index);
  } catch (_) {
    return normalizeTrail(stored || createBlankTrail(index), index);
  }
}

export function download(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

// The trail picker groups its options natively: official trails first, then
// custom ones split by where they are stored. The group heading says which is
// which, so each option needs only its name. Option values stay the entry's
// index in trailEntries, which is what selectEntry() expects.
export function buildPicker() {
  const picker = $("trail-picker");
  const entries = trailEntries.map((entry, index) => ({ entry, index }));
  const groups = [
    ["OFFICIAL", (entry) => entry.source === "official"],
    ["CUSTOM · FILE", (entry) => entry.source === "custom" && entry.storage !== "browser"],
    ["CUSTOM · BROWSER", (entry) => entry.source === "custom" && entry.storage === "browser"],
  ];
  picker.replaceChildren(
    ...groups
      .map(([label, matches]) => [
        label,
        entries.filter(({ entry }) => matches(entry)),
      ])
      .filter(([, items]) => items.length)
      .map(([label, items]) => {
        const group = document.createElement("optgroup");
        group.label = label;
        for (const { entry, index } of items) {
          const option = document.createElement("option");
          option.value = index;
          option.textContent = entry.trail.name;
          group.append(option);
        }
        return group;
      }),
  );
  picker.value = String(editor.trailIndex);
}

export function currentEntry() {
  return trailEntries[editor.trailIndex];
}

export function canSave(entry = currentEntry()) {
  return entry?.storage === "browser" || (editor.devServer && Boolean(entry?.file));
}

export function updateTrailControls() {
  const entry = currentEntry();
  $("save-trail").hidden = !canSave(entry);
  $("delete-trail").hidden =
    entry?.source !== "custom" || (entry.storage !== "browser" && !editor.devServer);
  $("save-status").textContent =
    entry?.storage === "browser"
      ? "Saved in this browser"
      : editor.devServer
        ? `Dev server · trails/${entry?.file}`
        : "Read-only here · duplicate or export to keep changes";
}

export function selectEntry(index) {
  editor.trailIndex = index;
  editor.trail = loadTrailData(editor.trailIndex);
  editor.selection = null;
  editor.history = [];
  editor.future = [];
  editor.focusPending = true;
  focusOnStart();
  rememberTrail();
  buildPicker();
  updateTrailControls();
  syncInspector();
  render();
}

async function persist(entry, data) {
  if (entry.storage === "browser") return saveBrowserTrail(data, entry.key);
  return saveTrailFile(entry.file, data);
}

export async function saveTrail() {
  const entry = currentEntry();
  if (!canSave(entry)) return;
  const errors = validateTrail(editor.trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("saving", errors)) return;
  try {
    await persist(entry, editor.trail);
    store().removeItem(DRAFT_PREFIX + entry.id);
    buildPicker();
    updateTrailControls();
    flash($("save-trail"), "SAVED");
  } catch (error) {
    showStatus("error", `Could not save: ${error.message}`);
  }
}

// Dev creates a file in trails/custom; otherwise the trail is stored in this browser.
export async function createCustomTrail(data) {
  try {
    const entry = editor.devServer
      ? await saveTrailFile(uniqueCustomFile(data.name), data)
      : saveBrowserTrail(data);
    selectEntry(trailEntries.indexOf(entry));
  } catch (error) {
    showStatus("error", `Could not create the trail: ${error.message}`);
  }
}

export async function deleteTrail() {
  const entry = currentEntry();
  if (
    entry?.source !== "custom" ||
    !window.confirm(`Delete “${entry.trail.name}”? This cannot be undone.`)
  )
    return;
  try {
    if (entry.storage === "browser") deleteBrowserTrail(entry.key);
    else await deleteTrailFile(entry.file);
    store().removeItem(DRAFT_PREFIX + entry.id);
    selectEntry(0);
  } catch (error) {
    showStatus("error", `Could not delete: ${error.message}`);
  }
}
