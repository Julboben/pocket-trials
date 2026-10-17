// @ts-check
// Session state shared by the browser modules. Only game.js changes the
// ride and the state machine; the menu changes saves and preferences.
import { trails, officialTrailEntries, bonusTrailEntries, customTrailEntries } from './trails.js';
import { trailHash } from './trail-hash.js';
import { DEFAULT_LOOK, ownedLook, ownsWith } from './cosmetics.js';
import { lookUnlock, trailUnlock, unlockStatus } from './unlocks.js';
import { hasAchievement } from './achievements.js';

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
  fullscreen: ['KeyF'],
  interact: ['KeyE']
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

/**
 * Where finding a trail's nisse is remembered: an official or bonus trail by
 * its id, so editing the trail keeps the find, and a custom trail by its hash.
 */
export function nisseKey(entry) {
  return isRankedSource(entry.source) ? entry.id : 'trail:' + trailHash(entry.trail);
}

export function currentTrailEntry() {
  if (session.trailSource === 'official') return officialTrailEntries[session.trailIndex];
  if (session.trailSource === 'bonus') return bonusTrailEntries[session.bonusTrailIndex];
  return customTrailEntries[session.customTrailIndex];
}

/**
 * @typedef {import('./unlocks.js').UnlockProgress & import('./achievements.js').CareerProgress & {
 *   stats: Record<string, number>
 * }} Progress
 */

/**
 * What a save has done, for unlocks and achievements: official trails
 * finished and gold medals won on them, which trails it has finished, its
 * lifetime stats and the achievements it has earned. A shipped trail counts
 * as finished under any version of it, so an edit that moves its best time
 * to a new key keeps what it won; a gold medal is checked against the
 * current medal times. A snapshot: later changes to the save don't show.
 * Null without a savegame.
 * @returns {Progress | null}
 */
export function progressOf(save) {
  if (!save) return null;
  const keys = Object.keys(save.bestTimes || {});
  const officialIndex = new Map(officialTrailEntries.map((entry, index) => [entry.id, index]));
  const unlocked = save.unlocked || 0;
  // Reaching the next official trail means this one was finished.
  const finished = trailId => (officialIndex.get(trailId) ?? Infinity) < unlocked
    || keys.some(key => key.startsWith(trailId + '@'));
  let trails = 0, golds = 0;
  for (const entry of officialTrailEntries) {
    if (finished(entry.id)) trails++;
    const best = save.bestTimes?.[trailKey(entry)];
    if (best && entry.trail.medals && best <= entry.trail.medals.gold) golds++;
  }
  const career = {
    trails, golds, officialTotal: officialTrailEntries.length,
    bonusFinished: bonusTrailEntries.filter(entry => finished(entry.id)).length, bonusTotal: bonusTrailEntries.length,
    // The official trails with a nisse, and how many of those it was found on.
    nisseTotal: officialTrailEntries.filter(entry => entry.trail.nisse).length,
    nisseFound: officialTrailEntries.filter(entry => entry.trail.nisse && save.nisse?.[nisseKey(entry)]).length,
  };
  const achievements = { ...save.achievements };
  const stats = { ...save.stats };
  return { ...career, finished, stats, has: id => hasAchievement(id, achievements, stats, career) };
}

/** Which rider items a save may wear. */
export const lookOwner = save => ownsWith(progressOf(save));

/** The look a save rides in: its own, with any item it hasn't unlocked swapped for a starter one. */
export const riderLook = (save = session.saveGame) => (save ? ownedLook(save.look, lookOwner(save)) : DEFAULT_LOOK);

/** A shipped trail's name, by catalog id, for unlock hints. */
const shippedTrailName = trailId =>
  [...officialTrailEntries, ...bonusTrailEntries].find(entry => entry.id === trailId)?.name ?? 'a trail';

/**
 * What unlocks a rider item, in the words the trail list uses, or '' for
 * items everyone has.
 * @param {import('./cosmetics.js').LookItem} item
 */
export const lookItemHint = item => unlockStatus(lookUnlock(item.slot, item.id), null, shippedTrailName).hint;

/** Whether a bonus trail is open for this save, and what opens it if not. */
export const bonusUnlock = (entry, save = session.saveGame) =>
  unlockStatus(trailUnlock(entry.id), progressOf(save), shippedTrailName);

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
