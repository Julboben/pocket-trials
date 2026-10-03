// Draft history per trail, and the header chip naming the version being edited.
import { store } from "../local-store.js";
import { trailEntries } from "../trails.js";
import { $ } from "./dom.js";
import { editor } from "./state.js";

/** The single draft the editor kept before it had a history. */
export const DRAFT_PREFIX = "hjulben-editor-draft-v1-";
const DRAFTS_PREFIX = "hjulben-editor-drafts-v2-";
const SAVED_AT_PREFIX = "hjulben-editor-saved-at-v1-";
const MAX_DRAFTS = 12;
// A draft migrated from the old single slot has no real time. It sorts as the
// oldest, but still counts as newer than a save that was never recorded.
const UNKNOWN_TIME = 1;

function read(key, fallback) {
  try {
    return JSON.parse(store().getItem(key) || "null") ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try {
    store().setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

/** Drafts for a trail, newest first: `{ at, trail }`. */
export function listDrafts(id) {
  const drafts = read(DRAFTS_PREFIX + id, []);
  const legacy = read(DRAFT_PREFIX + id, null);
  if (legacy) {
    drafts.push({ at: UNKNOWN_TIME, trail: legacy });
    write(DRAFTS_PREFIX + id, drafts);
    try {
      store().removeItem(DRAFT_PREFIX + id);
    } catch (_) {}
  }
  return drafts;
}

/** Keep a copy of the trail; an unchanged trail only moves the newest draft's time. */
export function addDraft(id, trail) {
  const drafts = listDrafts(id);
  const at = Date.now();
  if (drafts[0] && JSON.stringify(drafts[0].trail) === JSON.stringify(trail)) drafts[0].at = at;
  else drafts.unshift({ at, trail: JSON.parse(JSON.stringify(trail)) });
  if (!write(DRAFTS_PREFIX + id, drafts.slice(0, MAX_DRAFTS))) return null;
  return at;
}

export function removeDraft(id, at) {
  write(
    DRAFTS_PREFIX + id,
    listDrafts(id).filter((draft) => draft.at !== at),
  );
}

export function clearDrafts(id) {
  try {
    store().removeItem(DRAFTS_PREFIX + id);
    store().removeItem(DRAFT_PREFIX + id);
    store().removeItem(SAVED_AT_PREFIX + id);
  } catch (_) {}
}

export function markSaved(id) {
  write(SAVED_AT_PREFIX + id, Date.now());
}

export function savedAt(id) {
  return Number(read(SAVED_AT_PREFIX + id, 0)) || 0;
}

/** "Today 12:03", "3 Oct 12:03", or "Older draft" for a migrated one. */
export function formatDraftTime(at) {
  if (at <= UNKNOWN_TIME) return "Older draft";
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? `Today ${time}`
    : `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** "5 minutes ago", for the versions list. */
export function draftAge(at) {
  if (at <= UNKNOWN_TIME) return "Kept from before draft history";
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
  return entry.source === "official" ? "Official file" : "Published version";
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
