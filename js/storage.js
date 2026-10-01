import { clamp } from './config.js';
import { store } from './local-store.js';
import { cachedOnlineBoard, refreshOnlineBoard } from './online-leaderboard.js';

const SETTINGS_KEY = 'hjulben-settings-v1';
const SAVE_SLOTS_KEY = 'hjulben-saves-v2';
const ACTIVE_SLOT_KEY = 'hjulben-active-slot-v1';
const LEADERBOARD_KEY = 'hjulben-leaderboard-v1';
const SLOT_COUNT = 3;
export const LEADERBOARD_SIZE = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Letters, digits, space, _ . -  (max 16). Same rule as the server, and safe for innerHTML. */
export const cleanRiderName = raw => String(raw ?? '')
  .replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);

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
const cloneSave = save => save && { ...save, bestTimes: [...save.bestTimes] };

function normalizeSave(save, trailCount) {
  if (!save || !['male', 'female'].includes(save.rider)) return null;
  const name = cleanRiderName(save.name);
  if (!name || typeof save.playerId !== 'string' || !UUID_RE.test(save.playerId)) return null;
  const unlocked = clamp(Number(save.unlocked) || 0, 0, trailCount - 1);
  const trail = clamp(Number(save.trail) || 0, 0, unlocked);
  const bestTimes = Array.from({ length: trailCount }, (_, index) => {
    const value = Number(save.bestTimes?.[index]);
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  return {
    rider: save.rider, createdAt: Number(save.createdAt) || Date.now(), trail, unlocked, bestTimes,
    name, playerId: save.playerId
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

export function createSave(slotIndex, rider, trailCount, name) {
  const next = [...slots(trailCount)];
  const index = clamp(slotIndex, 0, SLOT_COUNT - 1);
  const cleanName = cleanRiderName(name);
  if (next[index] || !cleanName) return null;
  const save = {
    rider: rider === 'female' ? 'female' : 'male',
    createdAt: Date.now(),
    trail: 0,
    unlocked: 0,
    bestTimes: Array(trailCount).fill(null),
    name: cleanName,
    playerId: newPlayerId()
  };
  next[index] = save;
  persistSlots(trailCount, next);
  saveActiveSlot(index);
  return cloneSave(save);
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

export function readBest(slotIndex, trailIndex, trailCount) {
  const value = Number(slots(trailCount)[slotIndex]?.bestTimes?.[trailIndex]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveBest(slotIndex, trailIndex, elapsed, trailCount) {
  updateSave(slotIndex, trailCount, save => { save.bestTimes[trailIndex] = elapsed; });
}

function normalizeRun(run) {
  const time = Number(run?.time);
  if (!Number.isFinite(time) || time <= 0) return null;
  const slot = run.slot === null || run.slot === undefined ? null : Number(run.slot);
  return {
    time,
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
 * @returns {{ time: number, splits: number[], startStep: number, seed: number, inputs: number[][], physics: number } | null}
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
