import { clamp } from './config.js';

const SETTINGS_KEY = 'pocket-trials-settings-v1';
const PROGRESS_KEY = 'pocket-trials-progress-v1';
const BEST_KEY_PREFIX = 'pocket-trials-v1-';

export function readBest(levelIndex) {
  try {
    const value = Number(localStorage.getItem(BEST_KEY_PREFIX + levelIndex));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (_) {
    return null;
  }
}

export function saveBest(levelIndex, elapsed) {
  try { localStorage.setItem(BEST_KEY_PREFIX + levelIndex, String(elapsed)); } catch (_) {}
}

export function savePreferences(preferences) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch (_) {}
}

export function loadPreferences(defaults) {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (stored) return {
      rider: stored.rider ?? defaults.rider,
      scenery: stored.scenery ?? defaults.scenery,
      controls: stored.controls ?? stored.hints ?? defaults.controls,
      sound: stored.sound ?? defaults.sound
    };
    return { ...defaults, rider: localStorage.getItem('pocket-trials-rider') || defaults.rider };
  } catch (_) {
    return { ...defaults };
  }
}

export function saveProgress(levelIndex, unlockedLevel) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ level: levelIndex, unlocked: unlockedLevel })); } catch (_) {}
}

export function loadProgress(levelCount) {
  try {
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    if (progress) {
      const unlocked = clamp(Number(progress.unlocked) || 0, 0, levelCount - 1);
      return { unlocked, level: clamp(Number(progress.level) || 0, 0, unlocked) };
    }
    let unlocked = 0;
    for (let index = 0; index < levelCount - 1; index++) {
      if (Number(localStorage.getItem(BEST_KEY_PREFIX + index)) > 0) unlocked = index + 1;
      else break;
    }
    return { unlocked, level: 0 };
  } catch (_) {
    return { unlocked: 0, level: 0 };
  }
}
