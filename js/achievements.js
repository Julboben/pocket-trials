// Achievements: feats a rider earns while playing. Shared by the game, the
// editor and the server, so it stays free of the DOM.
//
// Each achievement is earned one of these ways:
//   career    worked out from the save's progress (trails finished, gold
//             medals), so riders from before achievements get them as well
//   stat      a lifetime total in `save.stats` reaching `goal`
//   event     a ride event (see RideEvent in types.js) during a run
//   finish    something about a finished run
//   interact  using a prop of that type (see interactions.js)
// Only event, finish and interact achievements are stored, in
// `save.achievements` as id -> time earned; the rest are worked out whenever
// they're needed. Every trail counts, custom ones too, but editor play-tests
// don't (see game.js). Ids are stored in
// saves, so they are never renamed or reused.

/**
 * @typedef {{
 *   trails: number, golds: number, officialTotal: number,
 *   bonusFinished: number, bonusTotal: number
 * }} CareerProgress
 * @typedef {{
 *   flips: number, time: number, medal: string | null, gold: number | null,
 *   helmet: boolean, bike: string, night: boolean, firstTry: boolean
 * }} FinishedRun what a run that reached the finish did: its flips, time,
 *   medal and the gold time, whether the rider wore a helmet, the bike
 *   (item id), whether the trail is at night, and whether it was the first
 *   attempt since the trail was opened
 * @typedef {{
 *   id: string, group: 'career' | 'riding' | 'lifetime', name: string, blurb: string, icon: string,
 *   secret?: boolean,
 *   career?: (progress: CareerProgress) => boolean,
 *   stat?: string, goal?: number,
 *   event?: (event: any) => boolean,
 *   finish?: (run: FinishedRun) => boolean,
 *   interact?: string
 * }} Achievement
 */

/** The achievement groups, in the order the menu lists them. */
export const ACHIEVEMENT_GROUPS = Object.freeze([
  { id: 'career', title: 'CAREER', blurb: 'Progress through the official and bonus trails' },
  { id: 'riding', title: 'RIDING', blurb: 'Earned on any trail, custom ones too' },
  { id: 'lifetime', title: 'LIFETIME', blurb: 'Totals across every ride' },
].map(group => Object.freeze(group)));

const everyTrail = (finished, total) => total > 0 && finished >= total;

/** Every achievement, in the order the menu lists them. */
export const ACHIEVEMENTS = /** @type {readonly Achievement[]} */ (Object.freeze([
  {
    id: 'first-steps', group: 'career', name: 'First Steps', icon: 'flag',
    blurb: 'Finish your first official trail.', career: p => p.trails >= 1
  },
  {
    id: 'career-rider', group: 'career', name: 'Career Rider', icon: 'flag',
    blurb: 'Finish every official trail.', career: p => everyTrail(p.trails, p.officialTotal)
  },
  {
    id: 'golden-touch', group: 'career', name: 'Golden Touch', icon: 'trophy',
    blurb: 'Win your first gold medal.', career: p => p.golds >= 1
  },
  {
    id: 'gold-rush', group: 'career', name: 'Gold Rush', icon: 'trophy',
    blurb: 'Win gold on every official trail.', career: p => everyTrail(p.golds, p.officialTotal)
  },
  {
    id: 'off-the-beaten-path', group: 'career', name: 'Off the Beaten Path', icon: 'tree',
    blurb: 'Finish a bonus trail.', career: p => p.bonusFinished >= 1
  },
  {
    id: 'completionist', group: 'career', name: 'Completionist', icon: 'trophy',
    blurb: 'Finish every official and bonus trail.',
    career: p => everyTrail(p.trails, p.officialTotal) && p.bonusFinished >= p.bonusTotal
  },

  {
    id: 'head-over-heels', group: 'riding', name: 'Head over Heels', icon: 'rotate-right',
    blurb: 'Land your first flip.', event: e => e.type === 'flip'
  },
  {
    id: 'triple-threat', group: 'riding', name: 'Triple Threat', icon: 'rotate-right',
    blurb: 'Land a triple flip in one jump.', event: e => e.type === 'flip' && e.count >= 3
  },
  {
    id: 'flip-circus', group: 'riding', name: 'Flip Circus', icon: 'rotate-right',
    blurb: 'Land 5 flips in one run and finish it.', finish: run => run.flips >= 5
  },
  {
    id: 'first-try', group: 'riding', name: 'First Try', icon: 'check',
    blurb: 'Finish a trail on your first attempt.', finish: run => run.firstTry
  },
  {
    id: 'photo-finish', group: 'riding', name: 'Photo Finish', icon: 'clock', secret: true,
    blurb: 'Win a gold medal by less than a tenth of a second.',
    finish: run => run.medal === 'gold' && Number.isFinite(run.gold) && run.gold - run.time < 0.1
  },
  {
    id: 'wind-in-your-hair', group: 'riding', name: 'Wind in Your Hair', icon: 'hair',
    blurb: 'Finish a trail without a helmet.', finish: run => !run.helmet
  },
  {
    id: 'old-school', group: 'riding', name: 'Old School', icon: 'bike',
    blurb: 'Win a gold medal on the Pocket Classic.', finish: run => run.medal === 'gold' && run.bike === 'classic'
  },
  {
    id: 'night-rider', group: 'riding', name: 'Night Rider', icon: 'headlight',
    blurb: 'Finish a trail at night.', finish: run => run.night
  },
  {
    id: 'splashdown', group: 'riding', name: 'Splashdown', icon: 'water',
    blurb: 'Crash into water.', event: e => e.type === 'crash' && e.cause === 'water'
  },
  {
    id: 'bull-in-a-china-shop', group: 'riding', name: 'Bull in a China Shop', icon: 'block',
    blurb: 'Shatter a glass pane.', event: e => e.type === 'shatter'
  },
  {
    id: 'bonk', group: 'riding', name: 'Bonk', icon: 'helmet',
    blurb: 'Lose your helmet in a crash.', event: e => e.type === 'helmet'
  },
  {
    id: 'pet-coda', group: 'riding', name: 'Pet Coda', icon: 'paw',
    blurb: 'Give Coda the corgi some attention.', interact: 'corgi'
  },

  {
    id: 'frequent-flyer', group: 'lifetime', name: 'Frequent Flyer', icon: 'rotate-right',
    blurb: 'Land 100 flips.', stat: 'flips', goal: 100
  },
  {
    id: 'crash-test-dummy', group: 'lifetime', name: 'Crash Test Dummy', icon: 'retry',
    blurb: 'Crash 100 times.', stat: 'crashes', goal: 100
  },
  {
    id: 'an-apple-a-day', group: 'lifetime', name: 'An Apple a Day', icon: 'apple',
    blurb: 'Collect 500 apples.', stat: 'apples', goal: 500
  },
  {
    id: 'glaziers-nightmare', group: 'lifetime', name: 'Glazier’s Nightmare', icon: 'block',
    blurb: 'Shatter 50 glass panes.', stat: 'panes', goal: 50
  },
].map(achievement => Object.freeze(achievement))));

const BY_ID = new Map(ACHIEVEMENTS.map(achievement => [achievement.id, achievement]));

/** @returns {Achievement | null} */
export const achievement = id => BY_ID.get(id) ?? null;

/** What each ride event adds to the lifetime stats. */
const STAT_EVENTS = {
  flip: e => ({ flips: e.count }),
  crash: () => ({ crashes: 1 }),
  apple: () => ({ apples: 1 }),
  shatter: () => ({ panes: 1 }),
};

/** @returns {Record<string, number> | null} what `event` adds to the lifetime stats */
export const statGains = event => STAT_EVENTS[event.type]?.(event) ?? null;

/** The ids a ride event earns. */
export const eventAchievements = event => ACHIEVEMENTS.filter(a => a.event?.(event)).map(a => a.id);

/** The ids a finished run earns. @param {FinishedRun} run */
export const finishAchievements = run => ACHIEVEMENTS.filter(a => a.finish?.(run)).map(a => a.id);

/** The ids using a prop of `type` earns. */
export const interactAchievements = type => ACHIEVEMENTS.filter(a => a.interact === type).map(a => a.id);

/**
 * Whether a save has earned achievement `id`: stored when it was earned, or
 * worked out from its career progress and lifetime stats.
 * @param {Record<string, number>} stored
 * @param {Record<string, number>} stats
 * @param {CareerProgress} career
 */
export function hasAchievement(id, stored, stats, career) {
  if (stored[id]) return true;
  const found = achievement(id);
  if (!found) return false;
  if (found.career) return found.career(career);
  if (found.stat) return (stats[found.stat] || 0) >= found.goal;
  return false;
}

/**
 * The achievements earned between two snapshots of a save's progress.
 * @param {{ has: (id: string) => boolean }} before
 * @param {{ has: (id: string) => boolean }} after
 */
export const newlyEarned = (before, after) => ACHIEVEMENTS.filter(a => !before.has(a.id) && after.has(a.id));

// --- Saving ------------------------------------------------------------------

// Ids this version doesn't know are kept, so an older copy of the game can't
// drop what a newer one earned when it syncs.
const ID_RE = /^[a-z0-9-]{1,40}$/;
const MAX_ACHIEVEMENTS = 200;
const MAX_STATS = 50;
const MAX_STAT = 1e9;
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A save's earned achievements, id -> time earned, with anything else dropped. */
export function cleanAchievements(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([id, time]) => ID_RE.test(id) && Number.isFinite(Number(time)) && Number(time) > 0)
    .slice(0, MAX_ACHIEVEMENTS)
    .map(([id, time]) => [id, Number(time)]));
}

/** A save's lifetime stats, name -> whole count, with anything else dropped. */
export function cleanStats(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([name, count]) => ID_RE.test(name) && Number.isFinite(Number(count)) && Number(count) > 0)
    .slice(0, MAX_STATS)
    .map(([name, count]) => [name, Math.min(MAX_STAT, Math.floor(Number(count)))]));
}

/** Both copies' achievements, each with the earlier time it was earned. */
export function mergeAchievements(a, b) {
  const merged = cleanAchievements(a);
  for (const [id, time] of Object.entries(cleanAchievements(b))) merged[id] = Math.min(time, merged[id] ?? Infinity);
  return cleanAchievements(merged);
}

/** Both copies' stats, each the higher count: neither device loses a ride. */
export function mergeStats(a, b) {
  const merged = cleanStats(a);
  for (const [name, count] of Object.entries(cleanStats(b))) merged[name] = Math.max(count, merged[name] ?? 0);
  return merged;
}

/** Whether `local` has achievements or stats that `cloud` lacks. */
export function aheadOf(local, cloud) {
  const cloudAchievements = cleanAchievements(cloud?.achievements);
  const cloudStats = cleanStats(cloud?.stats);
  return Object.keys(cleanAchievements(local?.achievements)).some(id => !cloudAchievements[id])
    || Object.entries(cleanStats(local?.stats)).some(([name, count]) => count > (cloudStats[name] ?? 0));
}
