import { clamp } from './config.js';
import { store } from './local-store.js';
import { cachedOnlineBoard, refreshOnlineBoard } from './online-leaderboard.js';
import { cleanRiderName } from './rider-name.js';
import { isDefaultItem, keepIdentity, legacyRider, lookOf, normalizeLook, ownedLook } from './cosmetics.js';

const SETTINGS_KEY = 'hjulben-settings-v1';
const SAVE_SLOTS_KEY = 'hjulben-saves-v2';
const ACTIVE_SLOT_KEY = 'hjulben-active-slot-v1';
const LEADERBOARD_KEY = 'hjulben-leaderboard-v1';
const SLOT_COUNT = 3;
export const LEADERBOARD_SIZE = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { cleanRiderName };

// crypto.randomUUID only exists on https/localhost, so fall back for LAN testing.
const newPlayerId = () => globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });

// Parsed copies of each key. storage is only read on first use and after
// another tab writes, and every change is written through immediately.
const cache = new Map();
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === null) cache.clear();
    else cache.delete(event.key);
  });
}

function readJson(key, fallback) {
  if (cache.has(key)) return cache.get(key);
  let value = fallback;
  try { value = JSON.parse(store().getItem(key) || 'null') ?? fallback; } catch (_) {}
  cache.set(key, value);
  return value;
}

function writeJson(key, value) {
  cache.set(key, value);
  try { store().setItem(key, JSON.stringify(value)); } catch (_) {}
}

const emptySlots = () => Array(SLOT_COUNT).fill(null);
const cloneSave = save => save && { ...save, look: { ...save.look }, bestTimes: { ...save.bestTimes } };
const TOKEN_RE = /^[\w-]+\.[\w-]+$/;

// Saves from before looks existed only have a `rider` of 'male' or 'female',
// which becomes the matching look; `rider` is still written for older clients.
function normalizeSave(save, trailCount) {
  if (!save || !(save.look && typeof save.look === 'object') && !['male', 'female'].includes(save.rider)) return null;
  const look = lookOf(save);
  const name = cleanRiderName(save.name);
  if (!name || typeof save.playerId !== 'string' || !UUID_RE.test(save.playerId)) return null;
  const unlocked = clamp(Number(save.unlocked) || 0, 0, trailCount - 1);
  const trail = clamp(Number(save.trail) || 0, 0, unlocked);
  // Keyed by trailKey(), so editing a trail's gameplay leaves its old best behind.
  const stored = save.bestTimes && typeof save.bestTimes === 'object' && !Array.isArray(save.bestTimes) ? save.bestTimes : {};
  const bestTimes = Object.fromEntries(Object.entries(stored)
    .map(([key, value]) => [key, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value > 0));
  return {
    look, rider: legacyRider(look), createdAt: Number(save.createdAt) || Date.now(), trail, unlocked, bestTimes,
    name, playerId: save.playerId,
    // Online riders carry the server's session token; offline saves have none.
    token: typeof save.token === 'string' && TOKEN_RE.test(save.token) ? save.token : null,
    // Stays true after the session expires, so the rider is shown as signed out, not offline.
    online: Boolean(save.online || save.token)
  };
}

function slots(trailCount) {
  const stored = readJson(SAVE_SLOTS_KEY, null);
  if (stored?.trailCount === trailCount && Array.isArray(stored.slots)) return stored.slots;
  const normalized = Array.isArray(stored)
    ? emptySlots().map((_, index) => normalizeSave(stored[index], trailCount))
    : Array.isArray(stored?.slots)
      ? emptySlots().map((_, index) => normalizeSave(stored.slots[index], trailCount))
      : emptySlots();
  cache.set(SAVE_SLOTS_KEY, { trailCount, slots: normalized });
  return normalized;
}

function persistSlots(trailCount, next) {
  cache.set(SAVE_SLOTS_KEY, { trailCount, slots: next });
  try { store().setItem(SAVE_SLOTS_KEY, JSON.stringify(next)); } catch (_) {}
}

export function savePreferences(preferences) {
  writeJson(SETTINGS_KEY, { ...preferences });
}

export function loadPreferences(defaults) {
  const stored = readJson(SETTINGS_KEY, null);
  const merged = { ...defaults };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(defaults)) if (stored[key] !== undefined) merged[key] = stored[key];
  }
  return merged;
}

export function loadSaveSlots(trailCount) {
  return slots(trailCount).map(cloneSave);
}

export function loadActiveSlot() {
  return clamp(Number(readJson(ACTIVE_SLOT_KEY, 0)) || 0, 0, SLOT_COUNT - 1);
}

export function saveActiveSlot(slotIndex) {
  writeJson(ACTIVE_SLOT_KEY, clamp(slotIndex, 0, SLOT_COUNT - 1));
}

/**
 * @param {{ playerId: string, token: string } | null} [account] the online rider, or null for an offline save
 */
export function createSave(slotIndex, look, trailCount, name, account = null) {
  const next = [...slots(trailCount)];
  const index = clamp(slotIndex, 0, SLOT_COUNT - 1);
  const cleanName = cleanRiderName(name);
  if (next[index] || !cleanName) return null;
  // A new rider has won nothing yet, so only default items are theirs.
  const clean = ownedLook(look, isDefaultItem);
  const save = {
    look: clean,
    rider: legacyRider(clean),
    createdAt: Date.now(),
    trail: 0,
    unlocked: 0,
    bestTimes: {},
    name: cleanName,
    playerId: account?.playerId ?? newPlayerId(),
    token: account?.token ?? null,
    online: Boolean(account)
  };
  next[index] = save;
  persistSlots(trailCount, next);
  saveActiveSlot(index);
  return cloneSave(save);
}

/**
 * Changes a save's look. Unknown items keep the current ones, items the rider
 * doesn't `own` go back to their starter ones, and gender and skin, picked
 * when it was created, stay.
 * @param {(slot: string, id: string) => boolean} owns
 */
export function saveLook(slotIndex, trailCount, look, owns) {
  updateSave(slotIndex, trailCount, save => {
    save.look = ownedLook(keepIdentity(normalizeLook(look, { fallback: save.look }), save.look), owns);
    save.rider = legacyRider(save.look);
  });
  return cloneSave(slots(trailCount)[slotIndex]);
}

/** Turns an offline save into the online rider that was just created for it. */
export function linkSave(slotIndex, trailCount, { playerId, token, name }) {
  updateSave(slotIndex, trailCount, save => {
    save.playerId = playerId;
    save.token = token;
    save.online = true;
    save.name = cleanRiderName(name) || save.name;
  });
  return cloneSave(slots(trailCount)[slotIndex]);
}

/** Forgets an online save's expired session; the rider logs in again to get a new one. */
export function clearSaveToken(slotIndex, trailCount) {
  updateSave(slotIndex, trailCount, save => {
    if (save.token) save.online = true;
    save.token = null;
  });
}

/**
 * Puts a logged-in rider into their existing slot, or the first free one,
 * merging the cloud save and the server's best runs (as ghosts) with what is
 * on this device.
 * @returns {number} the slot, or -1 when every slot is taken by someone else
 */
export function restoreOnlineSave(trailCount, { token, player, save: cloud, runs }) {
  const next = [...slots(trailCount)];
  let index = next.findIndex(save => save?.playerId === player.id);
  if (index < 0) index = next.findIndex(save => !save);
  if (index < 0) return -1;
  const local = next[index];
  const bestTimes = { ...cloud?.bestTimes };
  for (const [key, time] of Object.entries(local?.bestTimes ?? {})) bestTimes[key] = Math.min(time, bestTimes[key] ?? Infinity);
  for (const { trail, ghost } of Array.isArray(runs) ? runs : []) {
    const time = Number(ghost?.time);
    if (!Number.isFinite(time) || time <= 0) continue;
    bestTimes[trail] = Math.min(time, bestTimes[trail] ?? Infinity);
    const stored = readGhost(trail);
    if (!stored || stored.physics !== ghost.physics || time < stored.time) saveGhost(trail, ghost);
  }
  const unlocked = Math.max(Number(local?.unlocked) || 0, Number(cloud?.unlocked) || 0);
  // The server's look wins: it is what the rider last saved on any device.
  next[index] = normalizeSave({
    look: player.look ?? cloud?.look ?? local?.look,
    rider: player.rider,
    createdAt: local?.createdAt ?? cloud?.createdAt ?? Date.now(),
    trail: local?.trail ?? cloud?.trail ?? 0,
    unlocked, bestTimes,
    name: player.name, playerId: player.id, token
  }, trailCount);
  persistSlots(trailCount, next);
  saveActiveSlot(index);
  return next[index] ? index : -1;
}

export function deleteSave(slotIndex, trailCount) {
  const next = [...slots(trailCount)];
  next[clamp(slotIndex, 0, SLOT_COUNT - 1)] = null;
  persistSlots(trailCount, next);
}

function updateSave(slotIndex, trailCount, change) {
  const next = [...slots(trailCount)];
  const save = cloneSave(next[slotIndex]);
  if (!save) return;
  change(save);
  next[slotIndex] = save;
  persistSlots(trailCount, next);
}

export function saveProgress(slotIndex, trailIndex, unlockedTrail, trailCount) {
  updateSave(slotIndex, trailCount, save => {
    save.trail = clamp(trailIndex, 0, unlockedTrail);
    save.unlocked = clamp(unlockedTrail, 0, trailCount - 1);
  });
}

export function readBest(slotIndex, trailKey, trailCount) {
  return slots(trailCount)[slotIndex]?.bestTimes?.[trailKey] ?? null;
}

export function saveBest(slotIndex, trailKey, elapsed, trailCount) {
  updateSave(slotIndex, trailCount, save => { save.bestTimes[trailKey] = elapsed; });
}

function normalizeRun(run) {
  const time = Number(run?.time);
  if (!Number.isFinite(time) || time <= 0) return null;
  const slot = run.slot === null || run.slot === undefined ? null : Number(run.slot);
  return {
    time,
    look: lookOf(run),
    rider: run.rider === 'female' ? 'female' : 'male',
    name: cleanRiderName(run.name) || null,
    slot: Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT ? slot : null,
    saveId: Number(run.saveId) || null,
    date: Number(run.date) || null
  };
}

// One row per rider, like the online board: a save's runs share its id, and
// runs without a save are grouped by name.
const runOwner = run => run.saveId ? `save:${run.saveId}` : `name:${run.name ?? ''}`;

function rankRuns(runs) {
  const owners = new Set();
  return runs.map(normalizeRun).filter(Boolean)
    .sort((a, b) => a.time - b.time || (a.date ?? 0) - (b.date ?? 0))
    .filter(run => !owners.has(runOwner(run)) && owners.add(runOwner(run)))
    .slice(0, LEADERBOARD_SIZE);
}

function loadLeaderboards() {
  const stored = readJson(LEADERBOARD_KEY, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

export function readLeaderboard(trailId) {
  refreshOnlineBoard(trailId);                    // background fetch, throttled to every 30s
  const online = cachedOnlineBoard(trailId);
  if (online) return online.slice(0, LEADERBOARD_SIZE);
  const runs = loadLeaderboards()[trailId];       // fallback: local board
  return Array.isArray(runs) ? rankRuns(runs) : [];
}

const GHOST_KEY_PREFIX = 'hjulben-ghost-v1:';

/**
 * The fastest finished run on a trail, as encoded inputs for ghost playback.
 * Ghosts saved since looks existed also carry the rider's `look` (see lookOf).
 * @returns {{ time: number, splits: number[], startStep: number, seed: number, inputs: number[][], physics: number, look?: object, rider?: string } | null}
 */
export function readGhost(trailKey) {
  const ghost = readJson(GHOST_KEY_PREFIX + trailKey, null);
  return ghost && Number.isFinite(ghost.time) && Array.isArray(ghost.inputs) ? ghost : null;
}

export function saveGhost(trailKey, ghost) {
  writeJson(GHOST_KEY_PREFIX + trailKey, ghost);
}

// Returns the 1-based rank of the new run, or null when it misses the board.
export function recordLeaderboardRun(trailId, run) {
  const boards = { ...loadLeaderboards() };
  const entry = normalizeRun({ ...run, date: Date.now() });
  if (!entry) return null;
  const ranked = rankRuns([...(Array.isArray(boards[trailId]) ? boards[trailId] : []), entry]);
  boards[trailId] = ranked;
  writeJson(LEADERBOARD_KEY, boards);
  return ranked.findIndex(item => item.date === entry.date && item.time === entry.time) + 1 || null;
}
