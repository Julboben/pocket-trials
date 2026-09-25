import { clamp } from './config.js';

const SETTINGS_KEY = 'pocket-trials-settings-v1';
const SAVE_SLOTS_KEY = 'pocket-trials-saves-v2';
const ACTIVE_SLOT_KEY = 'pocket-trials-active-slot-v1';
const LEADERBOARD_KEY = 'pocket-trials-leaderboard-v1';
const SLOT_COUNT = 3;
export const LEADERBOARD_SIZE = 10;

// Parsed copies of each key. localStorage is only read on first use and after
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
  try { value = JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch (_) {}
  cache.set(key, value);
  return value;
}

function writeJson(key, value) {
  cache.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

const emptySlots = () => Array(SLOT_COUNT).fill(null);
const cloneSave = save => save && { ...save, bestTimes: [...save.bestTimes] };

function normalizeSave(save, levelCount) {
  if (!save || !['max', 'Maxine'].includes(save.rider)) return null;
  const unlocked = clamp(Number(save.unlocked) || 0, 0, levelCount - 1);
  const level = clamp(Number(save.level) || 0, 0, unlocked);
  const bestTimes = Array.from({ length: levelCount }, (_, index) => {
    const value = Number(save.bestTimes?.[index]);
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  return { rider: save.rider, createdAt: Number(save.createdAt) || Date.now(), level, unlocked, bestTimes };
}

function slots(levelCount) {
  const stored = readJson(SAVE_SLOTS_KEY, null);
  if (stored?.levelCount === levelCount && Array.isArray(stored.slots)) return stored.slots;
  const normalized = Array.isArray(stored)
    ? emptySlots().map((_, index) => normalizeSave(stored[index], levelCount))
    : Array.isArray(stored?.slots)
      ? emptySlots().map((_, index) => normalizeSave(stored.slots[index], levelCount))
      : emptySlots();
  cache.set(SAVE_SLOTS_KEY, { levelCount, slots: normalized });
  return normalized;
}

function persistSlots(levelCount, next) {
  cache.set(SAVE_SLOTS_KEY, { levelCount, slots: next });
  try { localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(next)); } catch (_) {}
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

export function loadSaveSlots(levelCount) {
  return slots(levelCount).map(cloneSave);
}

export function loadActiveSlot() {
  return clamp(Number(readJson(ACTIVE_SLOT_KEY, 0)) || 0, 0, SLOT_COUNT - 1);
}

export function saveActiveSlot(slotIndex) {
  writeJson(ACTIVE_SLOT_KEY, clamp(slotIndex, 0, SLOT_COUNT - 1));
}

export function createSave(slotIndex, rider, levelCount) {
  const next = [...slots(levelCount)];
  const index = clamp(slotIndex, 0, SLOT_COUNT - 1);
  if (next[index]) return null;
  const save = {
    rider: rider === 'Maxine' ? 'Maxine' : 'max',
    createdAt: Date.now(),
    level: 0,
    unlocked: 0,
    bestTimes: Array(levelCount).fill(null)
  };
  next[index] = save;
  persistSlots(levelCount, next);
  saveActiveSlot(index);
  return cloneSave(save);
}

export function deleteSave(slotIndex, levelCount) {
  const next = [...slots(levelCount)];
  next[clamp(slotIndex, 0, SLOT_COUNT - 1)] = null;
  persistSlots(levelCount, next);
}

function updateSave(slotIndex, levelCount, change) {
  const next = [...slots(levelCount)];
  const save = cloneSave(next[slotIndex]);
  if (!save) return;
  change(save);
  next[slotIndex] = save;
  persistSlots(levelCount, next);
}

export function saveProgress(slotIndex, levelIndex, unlockedLevel, levelCount) {
  updateSave(slotIndex, levelCount, save => {
    save.level = clamp(levelIndex, 0, unlockedLevel);
    save.unlocked = clamp(unlockedLevel, 0, levelCount - 1);
  });
}

export function readBest(slotIndex, levelIndex, levelCount) {
  const value = Number(slots(levelCount)[slotIndex]?.bestTimes?.[levelIndex]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveBest(slotIndex, levelIndex, elapsed, levelCount) {
  updateSave(slotIndex, levelCount, save => { save.bestTimes[levelIndex] = elapsed; });
}

function normalizeRun(run) {
  const time = Number(run?.time);
  if (!Number.isFinite(time) || time <= 0) return null;
  const slot = run.slot === null || run.slot === undefined ? null : Number(run.slot);
  return {
    time,
    rider: run.rider === 'Maxine' ? 'Maxine' : 'max',
    slot: Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT ? slot : null,
    saveId: Number(run.saveId) || null,
    date: Number(run.date) || null
  };
}

function rankRuns(runs) {
  return runs.map(normalizeRun).filter(Boolean)
    .sort((a, b) => a.time - b.time || (a.date ?? 0) - (b.date ?? 0))
    .slice(0, LEADERBOARD_SIZE);
}

function loadLeaderboards() {
  const stored = readJson(LEADERBOARD_KEY, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

export function readLeaderboard(trailId) {
  const runs = loadLeaderboards()[trailId];
  return Array.isArray(runs) ? rankRuns(runs) : [];
}

const GHOST_KEY_PREFIX = 'pocket-trials-ghost-v1:';

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
