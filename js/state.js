// @ts-check
// Session state shared by the browser modules. Only game.js changes the
// ride and the state machine; the menu changes saves and preferences.
import { levels, officialLevelEntries, customLevelEntries } from './levels.js';
import { levelHash } from './level-hash.js';

/** @typedef {import('./types.js').Ride} Ride */
/** @typedef {'menu' | 'running' | 'paused' | 'ragdoll' | 'won'} GameState */

export const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Default key bindings; each action accepts several `KeyboardEvent.code`s. */
export const DEFAULT_BINDINGS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  back: ['ArrowLeft', 'KeyA'],
  forward: ['ArrowRight', 'KeyD'],
  flip: ['Space'],
  restart: ['KeyR'],
  pause: ['KeyP']
};

export const DEFAULT_PREFERENCES = {
  scenery: 'full',
  controls: 'show',
  sound: 'on',
  volume: 80,
  shake: reducedMotion ? 'off' : 'on',
  haptics: 'off',
  ghost: 'on',
  bindings: DEFAULT_BINDINGS
};

const CHOICES = {
  scenery: ['full', 'reduced'], controls: ['show', 'hide'], sound: ['on', 'off'],
  shake: ['on', 'off'], haptics: ['on', 'off'], ghost: ['on', 'off']
};

/** Repairs preferences loaded from storage. */
export function sanitizePreferences(preferences) {
  const next = { ...DEFAULT_PREFERENCES, ...preferences };
  for (const [key, choices] of Object.entries(CHOICES)) if (!choices.includes(next[key])) next[key] = DEFAULT_PREFERENCES[key];
  const volume = Number(next.volume);
  next.volume = Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : DEFAULT_PREFERENCES.volume;
  const bindings = {};
  for (const [action, codes] of Object.entries(DEFAULT_BINDINGS)) {
    const stored = next.bindings?.[action];
    bindings[action] = Array.isArray(stored) && stored.every(code => typeof code === 'string') ? stored.slice(0, 2) : [...codes];
  }
  next.bindings = bindings;
  return next;
}

export const session = {
  /** @type {GameState} */ state: 'menu',
  /** @type {GameState} */ stateBeforeMenu: 'running',
  levelIndex: 0,
  level: levels[0],
  /** @type {'official' | 'custom'} */ levelSource: 'official',
  customLevelIndex: -1,
  rider: 'max',
  unlockedLevel: 0,
  savedLevel: 0,
  /** @type {any} */ saveGame: null,
  /** @type {any[]} */ saveSlots: [null, null, null],
  activeSaveSlot: 0,
  preferences: sanitizePreferences({}),
  /** @type {Ride | null} */ ride: null,
  gameLoopStarted: false
};

export const officialTrailIds = officialLevelEntries.map(entry => entry.id);
export const leaderboardTrails = () => [...officialLevelEntries, ...customLevelEntries];

/**
 * Leaderboard and ghost key for a trail. Custom trails are keyed by their
 * content, so an edited trail gets a fresh board and a re-import keeps it.
 */
export function trailKey(entry) {
  return entry.source === 'official' ? entry.id : 'trail:' + levelHash(entry.level);
}

export function currentTrailEntry() {
  return session.levelSource === 'official'
    ? officialLevelEntries[session.levelIndex]
    : customLevelEntries[session.customLevelIndex];
}

export function timeText(seconds) {
  const tenths = Math.floor(seconds * 10 + 0.00001);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + (tenths % 10);
}

export function deltaText(seconds) {
  const sign = seconds < 0 ? '−' : '+';
  return sign + Math.abs(seconds).toFixed(2);
}

export function trailMarker(index) {
  return index < officialLevelEntries.length
    ? String(index + 1).padStart(2, '0')
    : `C${String(index - officialLevelEntries.length + 1).padStart(2, '0')}`;
}
