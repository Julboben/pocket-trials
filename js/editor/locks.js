// Locking: a locked group, or a single locked item, is still drawn but can't
// be picked, box-selected, cut or drawn onto. Locks are the author's way of
// working, not part of the trail, so they live in local storage and never in
// the trail file.
//
// Group locks apply to every trail. Item locks belong to one trail: a block is
// known by its id, and anything else by its content, which can't change while
// it is locked.
import { store } from "../local-store.js";
import { isBackWall } from "../trail-schema.js";
import { editor, waters } from "./state.js";
import { currentEntry } from "./trails.js";

/** The groups the Objects tab lists, in the order it lists them. */
export const LOCK_GROUPS = [
  { key: "terrain", label: "Terrain" },
  { key: "back", label: "Back walls" },
  { key: "backProps", label: "Back props" },
  { key: "frontProps", label: "Front props" },
  { key: "water", label: "Water" },
  { key: "spikes", label: "Spikes" },
  { key: "apples", label: "Apples" },
];

const GROUPS_KEY = "hjulben-editor-locked-groups";
const ITEMS_PREFIX = "hjulben-editor-locked-items-";

let lockedGroups = null;
let itemLocks = { id: undefined, keys: new Set() };

function read(key) {
  try {
    const value = JSON.parse(store().getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch (_) {
    return new Set();
  }
}

function write(key, set) {
  try {
    if (set.size) store().setItem(key, JSON.stringify([...set]));
    else store().removeItem(key);
  } catch (_) {
    // Full or blocked storage: the lock still holds until the page reloads.
  }
}

function groups() {
  return (lockedGroups ??= read(GROUPS_KEY));
}

/** The current trail's item locks, read again when another trail is opened. */
function items() {
  const id = currentEntry()?.id ?? null;
  if (itemLocks.id !== id)
    itemLocks = { id, keys: id === null ? new Set() : read(ITEMS_PREFIX + id) };
  return itemLocks.keys;
}

// ---- What an object is -----------------------------------------------------

const LISTS = () => ({
  apple: editor.trail.apples,
  prop: editor.trail.props,
  spike: editor.trail.spikes,
  water: waters(),
});

/** The group a block, apple, prop, spike or water body belongs to. */
export function groupOf(type, object) {
  if (type === "block") return isBackWall(object) ? "back" : "terrain";
  if (type === "prop") return object.layer === "front" ? "frontProps" : "backProps";
  return { water: "water", spike: "spikes", apple: "apples" }[type] || null;
}

/** JSON with sorted keys, so the same content always reads the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * What an item lock is stored under. Two identical props are told apart by
 * how many identical ones come before them in the list.
 */
function itemKey(type, index) {
  if (type === "block") {
    const block = editor.trail.terrainBlocks?.[index];
    return block ? `block:${block.id}` : null;
  }
  const list = LISTS()[type];
  if (!list?.[index]) return null;
  const content = canonical(list[index]);
  let copy = 0;
  for (let other = 0; other < index; other++)
    if (canonical(list[other]) === content) copy++;
  return `${type}:${content}#${copy}`;
}

function objectAt(type, index) {
  if (type === "block") return editor.trail.terrainBlocks?.[index] || null;
  return LISTS()[type]?.[index] || null;
}

// ---- Asking ----------------------------------------------------------------

export function isGroupLocked(key) {
  return groups().has(key);
}

/**
 * Is this one item locked on its own, apart from its group? This runs for
 * every object on every hover, so the full key, which counts lookalikes, is
 * only worked out when the content alone already matches a lock.
 */
export function isItemLocked(type, index) {
  const keys = items();
  if (!keys.size) return false;
  if (type === "block") {
    const block = editor.trail.terrainBlocks?.[index];
    return Boolean(block) && keys.has(`block:${block.id}`);
  }
  const object = LISTS()[type]?.[index];
  if (!object) return false;
  const prefix = `${type}:${canonical(object)}#`;
  for (const key of keys) if (key.startsWith(prefix)) return keys.has(itemKey(type, index));
  return false;
}

/** Can't be picked or changed: its group is locked, or it is. */
export function isLocked(type, index) {
  const object = objectAt(type, index);
  if (!object) return false;
  return isGroupLocked(groupOf(type, object)) || isItemLocked(type, index);
}

export const isBlockLocked = (blockIndex) => isLocked("block", blockIndex);

/**
 * Is a selection item ({ type, index }, or a block point) locked? The start
 * and finish never are, so there is always something to select.
 */
export function isSelectionItemLocked(item) {
  if (item.type === "point") return isBlockLocked(item.blockIndex);
  if (item.type === "start" || item.type === "finish") return false;
  return isLocked(item.type, item.index);
}

/** Is a hit locked: anything on a block by its block, objects by themselves. */
export function isHitLocked(hit) {
  if (!hit) return false;
  if (Number.isInteger(hit.blockIndex)) return isBlockLocked(hit.blockIndex);
  if (LISTS()[hit.kind]) return isLocked(hit.kind, hit.index);
  return false;
}

/** Is anything locked at all, in any group or on this trail? */
export function anyLocked() {
  return groups().size > 0 || items().size > 0;
}

// ---- Changing --------------------------------------------------------------

export function setGroupLocked(key, locked) {
  if (locked) groups().add(key);
  else groups().delete(key);
  write(GROUPS_KEY, groups());
}

export function setItemLocked(type, index, locked) {
  const key = itemKey(type, index);
  if (!key) return;
  const keys = items();
  if (locked) keys.add(key);
  else keys.delete(key);
  pruneItemLocks();
}

/**
 * Forget item locks that match nothing on the trail any more, such as after an
 * undo past the moment something was locked, so a lookalike added later isn't
 * locked by surprise. Saves what is left.
 */
export function pruneItemLocks() {
  const keys = items();
  if (itemLocks.id === null) return;
  const present = new Set();
  const all = [
    ["block", editor.trail.terrainBlocks || []],
    ...Object.entries(LISTS()),
  ];
  for (const [type, list] of all)
    list.forEach((_, index) => present.add(itemKey(type, index)));
  for (const key of keys) if (!present.has(key)) keys.delete(key);
  write(ITEMS_PREFIX + itemLocks.id, keys);
}

/** The group a drawing tool adds to, or null when it adds nothing lockable. */
export function toolGroup(tool, settings) {
  if (tool === "block" || tool === "cut")
    return settings[tool]?.layer === "back" ? "back" : "terrain";
  if (tool === "prop") return settings.prop?.layer === "front" ? "frontProps" : "backProps";
  return { water: "water", spike: "spikes", apple: "apples" }[tool] || null;
}

export function groupLabel(key) {
  return LOCK_GROUPS.find((group) => group.key === key)?.label || key;
}
