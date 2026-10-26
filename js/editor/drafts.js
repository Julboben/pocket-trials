// Draft history per trail, and the header chip naming the version being edited.
import { store } from "../local-store.js";
import { trailEntries } from "../trails.js";
import { $ } from "./dom.js";
import { readText, removeText, writeText } from "./draft-store.js";
import { editor } from "./state.js";

// Drafts and autosaves can be large, so they live in IndexedDB (see
// draft-store.js); the save times are small and stay in localStorage.
const DRAFTS_PREFIX = "hjulben-editor-drafts-v2-";
// One trail per draft, named so it needn't move when its trail is renamed.
const DRAFT_PREFIX = "hjulben-editor-draft-v3-";
const SAVED_AT_PREFIX = "hjulben-editor-saved-at-v1-";
// One autosave per trail, apart from the drafts so it never pushes one out.
const AUTOSAVE_PREFIX = "hjulben-editor-autosave-v1-";
const MAX_DRAFTS = 12;

function read(key, fallback) {
  try {
    return JSON.parse(readText(key) ?? "null") ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value, options) {
  try {
    writeText(key, JSON.stringify(value), options);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * A short fingerprint of a text (FNV-1a, 8 hex digits). Drafts and autosaves
 * carry the fingerprint of the published trail they were made on, so one made
 * on a version the file has since moved past is not opened over the file.
 */
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Drafts for a trail, newest first: `{ at, trail, base }`. The list keeps
 * each draft's time and where its trail is stored, so saving a draft writes
 * that one trail and not every draft again; a trail is only read when used.
 */
export function listDrafts(id) {
  return draftIndex(id).flatMap((entry) => {
    const text = readText(entry.key);
    if (text === null) return [];
    let trail;
    return [{
      at: entry.at,
      base: entry.base,
      get trail() {
        return (trail ??= JSON.parse(text));
      },
    }];
  });
}

/** `[{ at, base, key }]`, newest first. Lists from before keep their trails in themselves, and are split up here. */
function draftIndex(id) {
  const list = read(DRAFTS_PREFIX + id, []);
  if (!Array.isArray(list)) return [];
  if (!list.some((entry) => entry.trail)) return list;
  const index = list.map(({ at, base, trail }) => {
    const key = newDraftKey();
    writeText(key, JSON.stringify(trail));
    return { at, base, key };
  });
  write(DRAFTS_PREFIX + id, index);
  return index;
}

let drafted = 0;
const newDraftKey = () => `${DRAFT_PREFIX}${Date.now().toString(36)}-${(drafted++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Keep a copy of the trail; an unchanged trail only moves the newest draft's
 * time. `base` fingerprints the published trail the draft was made on.
 */
export function addDraft(id, trail, base) {
  const index = draftIndex(id);
  const at = Date.now();
  const text = JSON.stringify(trail);
  if (index[0] && readText(index[0].key) === text) Object.assign(index[0], { at, base });
  else {
    const key = newDraftKey();
    writeText(key, text);
    index.unshift({ at, base, key });
  }
  for (const dropped of index.splice(MAX_DRAFTS)) removeText(dropped.key);
  if (!write(DRAFTS_PREFIX + id, index)) return null;
  return at;
}

export function removeDraft(id, at) {
  const index = draftIndex(id);
  for (const entry of index) if (entry.at === at) removeText(entry.key);
  write(
    DRAFTS_PREFIX + id,
    index.filter((entry) => entry.at !== at),
  );
}

export function clearDrafts(id) {
  for (const entry of draftIndex(id)) removeText(entry.key);
  removeText(DRAFTS_PREFIX + id);
  removeText(AUTOSAVE_PREFIX + id);
  try {
    store().removeItem(SAVED_AT_PREFIX + id);
  } catch (_) {}
}

/** The trail as it was when last autosaved: `{ at, trail, base }`, or null. */
export function readAutosave(id) {
  const autosave = read(AUTOSAVE_PREFIX + id, null);
  return Number.isFinite(autosave?.at) && autosave.trail ? autosave : null;
}

/**
 * `base` fingerprints the published trail the edits were made on. `urgent`
 * is for the page being hidden or closed (see draft-store.js).
 */
export function writeAutosave(id, trail, base, urgent = false) {
  return write(AUTOSAVE_PREFIX + id, { at: Date.now(), trail, base }, { urgent });
}

export function clearAutosave(id) {
  removeText(AUTOSAVE_PREFIX + id);
}

/** Carry a trail's drafts and save time over to a new id, after its file moves. */
export function moveDrafts(from, to) {
  if (from === to) return;
  for (const prefix of [DRAFTS_PREFIX, AUTOSAVE_PREFIX]) {
    const text = readText(prefix + from);
    if (text !== null) writeText(prefix + to, text);
    removeText(prefix + from);
  }
  try {
    const value = store().getItem(SAVED_AT_PREFIX + from);
    if (value !== null) store().setItem(SAVED_AT_PREFIX + to, value);
    store().removeItem(SAVED_AT_PREFIX + from);
  } catch (_) {}
}

export function markSaved(id) {
  try {
    store().setItem(SAVED_AT_PREFIX + id, JSON.stringify(Date.now()));
  } catch (_) {}
}

export function savedAt(id) {
  try {
    return Number(JSON.parse(store().getItem(SAVED_AT_PREFIX + id) || "0")) || 0;
  } catch (_) {
    return 0;
  }
}

/** "Today 12:03" or "3 Oct 12:03". */
export function formatDraftTime(at) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? `Today ${time}`
    : `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** "5 minutes ago", for the versions list. */
export function draftAge(at) {
  const seconds = Math.round((at - Date.now()) / 1000);
  const units = [["day", 86400], ["hour", 3600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat([], { numeric: "auto" });
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "Just now";
}

/** The name of a saved version: read-only trails can only be the original. */
export function savedName(entry) {
  const writable = entry?.storage === "browser" || (editor.devServer && entry?.file);
  if (!writable) return "Original";
  if (entry.source === "official") return "Official file";
  return entry.source === "bonus" ? "Bonus file" : "Published version";
}

/**
 * Say which version is open and whether it has been edited since.
 *
 * `json` is the trail as pretty JSON, which the inspector has already built.
 */
export function updateVersionChip(json) {
  const version = editor.version;
  if (!version) return;
  if (json !== undefined) {
    version.edited = json !== version.base;
    version.unpublished = json !== version.published;
  }
  // Nothing new to save or publish greys the buttons out.
  for (const id of ["save-draft", "versions-save-draft"]) $(id).disabled = !version.edited;
  $("save-trail").disabled = !version.unpublished;
  const name =
    version.kind === "draft" ? `Draft · ${formatDraftTime(version.at)}` : savedName(trailEntries[editor.trailIndex]);
  $("version-label").textContent = version.edited ? `${name} · edited` : name;
  $("version-chip").classList.toggle("edited", Boolean(version.edited));
  $("version-chip").classList.toggle("draft", version.kind === "draft");
}
