import { clamp } from './config.js';

const SETTINGS_KEY = 'pocket-trials-settings-v1';
const SAVE_SLOTS_KEY = 'pocket-trials-saves-v2';
const ACTIVE_SLOT_KEY = 'pocket-trials-active-slot-v1';
const LEGACY_SAVE_KEY = 'pocket-trials-save-v1';
const LEGACY_PROGRESS_KEY = 'pocket-trials-progress-v1';
const LEGACY_BEST_KEY_PREFIX = 'pocket-trials-v2-';
const OLDEST_BEST_KEY_PREFIX = 'pocket-trials-v1-';
const SLOT_COUNT = 3;

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
