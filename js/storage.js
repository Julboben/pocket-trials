import { clamp } from './config.js';

const SETTINGS_KEY = 'pocket-trials-settings-v1';
const SAVE_SLOTS_KEY = 'pocket-trials-saves-v2';
const ACTIVE_SLOT_KEY = 'pocket-trials-active-slot-v1';
const LEGACY_SAVE_KEY = 'pocket-trials-save-v1';
const LEGACY_PROGRESS_KEY = 'pocket-trials-progress-v1';
const LEGACY_BEST_KEY_PREFIX = 'pocket-trials-v2-';
const OLDEST_BEST_KEY_PREFIX = 'pocket-trials-v1-';
const LEADERBOARD_KEY = 'pocket-trials-leaderboard-v1';
const SLOT_COUNT = 3;
export const LEADERBOARD_SIZE = 10;

const emptySlots = () => Array(SLOT_COUNT).fill(null);

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

function persistSlots(slots) {
  try { localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots)); } catch (_) {}
}

export function savePreferences(preferences) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch (_) {}
}

export function loadPreferences(defaults) {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (stored) return {
      scenery: stored.scenery ?? defaults.scenery,
      controls: stored.controls ?? stored.hints ?? defaults.controls,
      sound: stored.sound ?? defaults.sound
    };
    return { ...defaults };
  } catch (_) {
    return { ...defaults };
  }
}

export function loadSaveSlots(levelCount) {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVE_SLOTS_KEY) || 'null');
    if (Array.isArray(stored)) return emptySlots().map((_, index) => normalizeSave(stored[index], levelCount));

    // Migrate the former single-save format into slot 1 without losing progress.
    const legacySave = JSON.parse(localStorage.getItem(LEGACY_SAVE_KEY) || 'null');
    const legacyProgress = JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY) || 'null');
    const hasLegacyData = legacySave || legacyProgress
      || localStorage.getItem(LEGACY_BEST_KEY_PREFIX + '0') !== null
      || localStorage.getItem(OLDEST_BEST_KEY_PREFIX + '0') !== null;
    if (!hasLegacyData) return emptySlots();

    const oldPreferences = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    const rider = ['max', 'Maxine'].includes(legacySave?.rider)
      ? legacySave.rider
      : (oldPreferences?.rider === 'Maxine' || localStorage.getItem('pocket-trials-rider') === 'Maxine' ? 'Maxine' : 'max');
    let unlocked = clamp(Number(legacyProgress?.unlocked) || 0, 0, levelCount - 1);
    const bestTimes = Array.from({ length: levelCount }, (_, index) => {
      const value = Number(localStorage.getItem(LEGACY_BEST_KEY_PREFIX + index));
      return Number.isFinite(value) && value > 0 ? value : null;
    });
    if (!legacyProgress) {
      unlocked = 0;
      for (let index = 0; index < levelCount - 1 && bestTimes[index]; index++) unlocked = index + 1;
    }
    const level = clamp(Number(legacyProgress?.level) || 0, 0, unlocked);
    const slots = emptySlots();
    slots[0] = { rider, createdAt: Number(legacySave?.createdAt) || Date.now(), level, unlocked, bestTimes };
    persistSlots(slots);
    return slots;
  } catch (_) {
    return emptySlots();
  }
}

export function loadActiveSlot() {
  try { return clamp(Number(localStorage.getItem(ACTIVE_SLOT_KEY)) || 0, 0, SLOT_COUNT - 1); }
  catch (_) { return 0; }
}

export function saveActiveSlot(slotIndex) {
  try { localStorage.setItem(ACTIVE_SLOT_KEY, String(clamp(slotIndex, 0, SLOT_COUNT - 1))); } catch (_) {}
}

export function createSave(slotIndex, rider, levelCount) {
  const slots = loadSaveSlots(levelCount);
  const index = clamp(slotIndex, 0, SLOT_COUNT - 1);
  if (slots[index]) return null;
  const save = {
    rider: rider === 'Maxine' ? 'Maxine' : 'max',
    createdAt: Date.now(),
    level: 0,
    unlocked: 0,
    bestTimes: Array(levelCount).fill(null)
  };
  slots[index] = save;
  persistSlots(slots);
  saveActiveSlot(index);
  return save;
}

export function deleteSave(slotIndex, levelCount) {
  const slots = loadSaveSlots(levelCount);
  const index = clamp(slotIndex, 0, SLOT_COUNT - 1);
  slots[index] = null;
  persistSlots(slots);
}

export function saveProgress(slotIndex, levelIndex, unlockedLevel, levelCount) {
  const slots = loadSaveSlots(levelCount);
  const save = slots[slotIndex];
  if (!save) return;
  save.level = clamp(levelIndex, 0, unlockedLevel);
  save.unlocked = clamp(unlockedLevel, 0, levelCount - 1);
  persistSlots(slots);
}

export function readBest(slotIndex, levelIndex, levelCount) {
  const save = loadSaveSlots(levelCount)[slotIndex];
  const value = Number(save?.bestTimes?.[levelIndex]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveBest(slotIndex, levelIndex, elapsed, levelCount) {
  const slots = loadSaveSlots(levelCount);
  const save = slots[slotIndex];
  if (!save) return;
  save.bestTimes[levelIndex] = elapsed;
  persistSlots(slots);
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

function persistLeaderboards(boards) {
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(boards)); } catch (_) {}
}

// Seeds the board from career best times recorded before leaderboards existed.
function loadLeaderboards(officialTrailIds) {
  try {
    const stored = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || 'null');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored;
    const boards = {};
    loadSaveSlots(officialTrailIds.length).forEach((save, slot) => {
      save?.bestTimes.forEach((time, levelIndex) => {
        if (time === null) return;
        const trailId = officialTrailIds[levelIndex];
        boards[trailId] = rankRuns([...(boards[trailId] || []), { time, rider: save.rider, slot, saveId: save.createdAt }]);
      });
    });
    persistLeaderboards(boards);
    return boards;
  } catch (_) {
    return {};
  }
}

export function readLeaderboard(trailId, officialTrailIds) {
  const runs = loadLeaderboards(officialTrailIds)[trailId];
  return Array.isArray(runs) ? rankRuns(runs) : [];
}

// Returns the 1-based rank of the new run, or null when it misses the board.
export function recordLeaderboardRun(trailId, run, officialTrailIds) {
  const boards = loadLeaderboards(officialTrailIds);
  const entry = normalizeRun({ ...run, date: Date.now() });
  if (!entry) return null;
  const ranked = rankRuns([...(Array.isArray(boards[trailId]) ? boards[trailId] : []), entry]);
  boards[trailId] = ranked;
  persistLeaderboards(boards);
  return ranked.findIndex(item => item.date === entry.date && item.time === entry.time) + 1 || null;
}
