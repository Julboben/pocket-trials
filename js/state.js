// @ts-check
// Session state shared by the browser modules. Only game.js changes the
// ride and the state machine; the menu changes saves and preferences.
import { trails, officialTrailEntries, bonusTrailEntries, customTrailEntries } from './trails.js';
import { trailHash } from './trail-hash.js';
import { unlockStatus } from './trail-schema.js';
import { DEFAULT_LOOK, ownedLook, ownsWith } from './cosmetics.js';

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
  lights: ['KeyL'],
  restart: ['KeyR'],
  pause: ['KeyP'],
  fullscreen: ['KeyF']
};

export const DEFAULT_PREFERENCES = {
  scenery: 'full',
  controls: 'show',
  sound: 'on',
  volume: 80,
  shake: reducedMotion ? 'off' : 'on',
  haptics: 'off',
  ghost: 'on',
  headlight: 'on',
  bindings: DEFAULT_BINDINGS
};

const CHOICES = {
  scenery: ['full', 'reduced'], controls: ['show', 'hide'], sound: ['on', 'off'],
  shake: ['on', 'off'], haptics: ['on', 'off'], ghost: ['on', 'world', 'off'],
  headlight: ['on', 'off']
};

/** Repairs preferences loaded from storage. */
export function sanitizePreferences(preferences) {
  const next = { ...DEFAULT_PREFERENCES, ...preferences };
  for (const [key, choices] of Object.entries(CHOICES)) if (!choices.includes(next[key])) next[key] = DEFAULT_PREFERENCES[key];
  const volume = Number(next.volume);
  next.volume = Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : DEFAULT_PREFERENCES.volume;
  const bindings = {};
  const used = new Set();
  for (const [action, codes] of Object.entries(DEFAULT_BINDINGS)) {
    const stored = next.bindings?.[action];
    const valid = Array.isArray(stored) && stored.every(code => typeof code === 'string');
    bindings[action] = valid ? stored.slice(0, 2) : codes.filter(code => !used.has(code));
    bindings[action].forEach(code => used.add(code));
  }
  next.bindings = bindings;
  return next;
}

export const session = {
  /** @type {GameState} */ state: 'menu',
  /** @type {GameState} */ stateBeforeMenu: 'running',
  trailIndex: 0,
  trail: trails[0],
  /** @type {'official' | 'bonus' | 'custom' | 'playtest'} */ trailSource: 'official',
  bonusTrailIndex: -1,
  customTrailIndex: -1,
  /** @type {import('./cosmetics.js').Look} */ look: DEFAULT_LOOK,
  unlockedTrail: 0,
  savedTrail: 0,
  /** @type {any} */ saveGame: null,
  /** @type {any[]} */ saveSlots: [null, null, null],
  activeSaveSlot: 0,
  preferences: sanitizePreferences({}),
  /** @type {Ride | null} */ ride: null,
  gameLoopStarted: false,
  /** Save the current ride belongs to, so a slot switch can't resume it. */
  /** @type {number | null} */ rideSaveId: null
};

export const officialTrailIds = officialTrailEntries.map(entry => entry.id);
export const leaderboardTrails = () => [...officialTrailEntries, ...bonusTrailEntries, ...customTrailEntries];

/** Shipped trails: their times are save bests and go to the online board. */
export const isRankedSource = source => source === 'official' || source === 'bonus';

/**
 * Leaderboard, ghost and best-time key for a trail. It includes a hash of
 * everything that decides a run, so an edit that changes the ride starts fresh
 * boards while a rename or new props keep them. Official and bonus trails keep
 * their id in front, so the online board can tell which trail it is.
 */
export function trailKey(entry) {
  const hash = trailHash(entry.trail);
  return isRankedSource(entry.source) ? `${entry.id}@${hash}` : 'trail:' + hash;
}

export function currentTrailEntry() {
  if (session.trailSource === 'official') return officialTrailEntries[session.trailIndex];
  if (session.trailSource === 'bonus') return bonusTrailEntries[session.bonusTrailIndex];
  return customTrailEntries[session.customTrailIndex];
}

/**
 * The career progress bonus trails unlock with: official trails finished and
 * gold medals won on them. Null without a savegame.
 * @param {any} save
 */
export function careerProgress(save) {
  if (!save) return null;
  let finished = 0, golds = 0;
  officialTrailEntries.forEach((entry, index) => {
    const best = save.bestTimes?.[trailKey(entry)];
    // Reaching the next trail means this one was finished, even if an edit
    // has since moved its best time to a new key.
    if (index < (save.unlocked || 0) || best) finished++;
    if (best && entry.trail.medals && best <= entry.trail.medals.gold) golds++;
  });
  return { trails: finished, golds };
}

/**
 * What a save has done towards rider items: gold medals and finished trails.
 * A shipped trail counts as finished under any version of it, so an edit
 * that moves its best time to a new key keeps the item.
 * @returns {import('./cosmetics.js').LookProgress | null}
 */
export function lookProgress(save) {
  const progress = careerProgress(save);
  if (!progress) return null;
  const keys = Object.keys(save.bestTimes || {});
  const officialIndex = new Map(officialTrailEntries.map((entry, index) => [entry.id, index]));
  return {
    golds: progress.golds,
    finished: trailId => (officialIndex.get(trailId) ?? Infinity) < (save.unlocked || 0)
      || keys.some(key => key.startsWith(trailId + '@')),
  };
}

/** Which rider items a save may wear. */
export const lookOwner = save => ownsWith(lookProgress(save));

/** The look a save rides in: its own, with any item it hasn't unlocked swapped for a starter one. */
export const riderLook = (save = session.saveGame) => (save ? ownedLook(save.look, lookOwner(save)) : DEFAULT_LOOK);

/**
 * What unlocks a rider item, in the words the trail list uses, or '' for
 * items everyone has.
 * @param {import('./cosmetics.js').LookItem} item
 */
export function lookItemHint(item) {
  const { unlock } = item;
  if (unlock.type === 'golds') return `WIN ${unlock.count} GOLD MEDAL${unlock.count === 1 ? '' : 'S'} TO UNLOCK`;
  if (unlock.type === 'trail') {
    const entry = [...officialTrailEntries, ...bonusTrailEntries].find(candidate => candidate.id === unlock.trail);
    return `FINISH ${(entry?.name ?? 'A TRAIL').toUpperCase()} TO UNLOCK`;
  }
  return '';
}

/** Whether a bonus trail is open for this save, and what opens it if not. */
export function bonusUnlock(entry, save = session.saveGame) {
  return unlockStatus(entry.trail.unlock, careerProgress(save));
}

export function timeText(seconds) {
  const tenths = Math.floor(seconds * 10 + 0.00001);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + (tenths % 10);
}

/** A finished run's time to the millisecond, e.g. 1:04.517. */
export function runTimeText(seconds) {
  const ms = Math.round(seconds * 1000);
  return Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.' + String(ms % 1000).padStart(3, '0');
}

export function deltaText(seconds) {
  const sign = seconds < 0 ? '−' : '+';
  return sign + Math.abs(seconds).toFixed(2);
}

/** A trail's number, by its index in leaderboardTrails(): 01, B01 or C01. */
export function trailMarker(index) {
  if (index < officialTrailEntries.length) return String(index + 1).padStart(2, '0');
  index -= officialTrailEntries.length;
  if (index < bonusTrailEntries.length) return `B${String(index + 1).padStart(2, '0')}`;
  return `C${String(index - bonusTrailEntries.length + 1).padStart(2, '0')}`;
}
