// Achievements and unlocks: the achievement catalog and how each kind is
// earned, the unlock table pointing at real trails, items and achievements,
// unlock rules and hints, and achievements and stats in saves and cloud sync.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACHIEVEMENTS, ACHIEVEMENT_GROUPS, achievement, statGains, eventAchievements, finishAchievements,
  interactAchievements, hasAchievement, newlyEarned, cleanAchievements, cleanStats, mergeAchievements, mergeStats, aheadOf
} from '../js/achievements.js';
import { UNLOCKS, trailUnlock, lookUnlock, unlockStatus } from '../js/unlocks.js';
import { lookItem } from '../js/cosmetics.js';
import icons from '../icons/pixel-icons.mjs';

const catalog = JSON.parse(readFileSync(new URL('../trails/catalog.json', import.meta.url), 'utf8'));
const trailIds = new Set(catalog.trails.map(entry => entry.id));

// --- Catalog ---------------------------------------------------------------------

{
  const groups = new Set(ACHIEVEMENT_GROUPS.map(group => group.id));
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.match(a.id, /^[a-z0-9-]+$/, `${a.id} is a plain id`);
    assert.ok(!ids.has(a.id), `${a.id} is listed once`);
    ids.add(a.id);
    assert.ok(groups.has(a.group), `${a.id} is in a known group`);
    assert.ok(a.name && a.blurb, `${a.id} has a name and blurb`);
    assert.ok(icons[a.icon], `${a.id}'s icon "${a.icon}" exists`);
    assert.ok(Object.isFrozen(a), `${a.id} is frozen`);
    const ways = ['career', 'stat', 'event', 'finish', 'interact'].filter(way => a[way] !== undefined);
    assert.equal(ways.length, 1, `${a.id} is earned exactly one way`);
    if (a.stat) assert.ok(Number.isInteger(a.goal) && a.goal > 0, `${a.id} has a goal`);
    assert.equal(achievement(a.id), a);
  }
  assert.equal(achievement('nope'), null);
}

// --- Unlock table ------------------------------------------------------------------

{
  for (const [key, rule] of Object.entries(UNLOCKS)) {
    const [kind, ...rest] = key.split(':');
    if (kind === 'trail') assert.ok(trailIds.has(rest.join(':')), `${key} is a trail in the catalog`);
    else if (kind === 'look') assert.ok(lookItem(rest[0], rest[1]), `${key} is a rider item`);
    else assert.fail(`${key} is a trail or look reward`);
    for (const [part, value] of Object.entries(rule)) {
      assert.ok(['trails', 'golds', 'trail', 'achievement'].includes(part), `${key}.${part} is a rule part`);
      if (part === 'trail') assert.ok(trailIds.has(value), `${key} asks for a trail in the catalog`);
      else if (part === 'achievement') assert.ok(achievement(value), `${key} asks for a known achievement`);
      else assert.ok(Number.isInteger(value) && value > 0, `${key}.${part} is a positive count`);
    }
  }
  assert.deepEqual(trailUnlock('bonus:01-the-bonny-tyler'), { golds: 2 });
  assert.deepEqual(trailUnlock('bonus:02-the-mining-cave'), { golds: 4 });
  assert.equal(trailUnlock('official:01-the-orchard'), null, 'official trails follow the career instead');
  assert.equal(lookUnlock('bike', 'elasto'), null);
}

// --- Unlock rules ------------------------------------------------------------------

{
  const progress = ({ trails = 0, golds = 0, finished = [], has = [] } = {}) =>
    ({ trails, golds, finished: id => finished.includes(id), has: id => has.includes(id) });
  assert.deepEqual(unlockStatus(null, null), { open: true, hint: '' }, 'no rule is open, even without a save');
  assert.equal(unlockStatus({ trails: 3 }, null).open, false, 'a rule stays shut without a save');
  assert.equal(unlockStatus({ trails: 3 }, progress({ trails: 2, golds: 9 })).open, false);
  assert.equal(unlockStatus({ trails: 3 }, progress({ trails: 3 })).open, true);
  assert.equal(unlockStatus({ trails: 3, golds: 2 }, progress({ trails: 5, golds: 1 })).open, false, 'every part must be met');
  assert.equal(unlockStatus({ trails: 1, golds: 2 }, null).hint, 'FINISH 1 TRAIL & WIN 2 GOLD MEDALS TO UNLOCK');

  const trailRule = { trail: 'bonus:01-the-bonny-tyler' };
  assert.equal(unlockStatus(trailRule, progress()).open, false);
  assert.equal(unlockStatus(trailRule, progress({ finished: [trailRule.trail] })).open, true);
  assert.equal(unlockStatus(trailRule, null).hint, 'FINISH A TRAIL TO UNLOCK');
  assert.equal(unlockStatus(trailRule, null, () => 'The Bonny Tyler').hint, 'FINISH THE BONNY TYLER TO UNLOCK');

  const earnRule = { achievement: 'triple-threat' };
  assert.equal(unlockStatus(earnRule, progress()).open, false);
  assert.equal(unlockStatus(earnRule, progress({ has: ['triple-threat'] })).open, true);
  assert.equal(unlockStatus(earnRule, null).hint, 'EARN “TRIPLE THREAT” TO UNLOCK');
  assert.equal(unlockStatus({ achievement: 'photo-finish' }, null).hint, 'EARN A SECRET ACHIEVEMENT TO UNLOCK', 'secrets stay secret');
}

// --- Earning -----------------------------------------------------------------------

{
  assert.deepEqual(statGains({ type: 'flip', count: 2, direction: 1 }), { flips: 2 });
  assert.deepEqual(statGains({ type: 'crash', cause: 'head' }), { crashes: 1 });
  assert.deepEqual(statGains({ type: 'apple', collected: 1, total: 3 }), { apples: 1 });
  assert.deepEqual(statGains({ type: 'shatter', blockId: 'a' }), { panes: 1 });
  assert.equal(statGains({ type: 'land', impact: 50 }), null);

  assert.deepEqual(eventAchievements({ type: 'flip', count: 1 }), ['head-over-heels']);
  assert.deepEqual(eventAchievements({ type: 'flip', count: 3 }), ['head-over-heels', 'triple-threat']);
  assert.deepEqual(eventAchievements({ type: 'crash', cause: 'water' }), ['splashdown']);
  assert.deepEqual(eventAchievements({ type: 'crash', cause: 'spike' }), []);
  assert.deepEqual(eventAchievements({ type: 'shatter' }), ['bull-in-a-china-shop']);
  assert.deepEqual(eventAchievements({ type: 'helmet' }), ['bonk']);
  assert.deepEqual(interactAchievements('corgi'), ['pet-coda']);
  assert.deepEqual(interactAchievements('sign'), []);

  const run = { flips: 0, time: 30, medal: null, gold: 20, helmet: true, bike: 'elasto', night: false, firstTry: false };
  assert.deepEqual(finishAchievements(run), [], 'a plain finish earns nothing');
  assert.deepEqual(finishAchievements({ ...run, flips: 5 }), ['flip-circus']);
  assert.deepEqual(finishAchievements({ ...run, firstTry: true }), ['first-try']);
  assert.deepEqual(finishAchievements({ ...run, helmet: false }), ['wind-in-your-hair']);
  assert.deepEqual(finishAchievements({ ...run, night: true }), ['night-rider']);
  assert.deepEqual(finishAchievements({ ...run, time: 19.5, medal: 'gold', bike: 'classic' }), ['old-school']);
  assert.deepEqual(finishAchievements({ ...run, time: 19.95, medal: 'gold' }), ['photo-finish']);
  assert.deepEqual(finishAchievements({ ...run, time: 19.95, medal: 'gold', gold: null }), [], 'photo finish needs a gold time');

  const career = { trails: 0, golds: 0, officialTotal: 9, bonusFinished: 0, bonusTotal: 2 };
  assert.ok(!hasAchievement('first-steps', {}, {}, career));
  assert.ok(hasAchievement('first-steps', {}, {}, { ...career, trails: 1 }), 'career achievements come from progress');
  assert.ok(!hasAchievement('career-rider', {}, {}, { ...career, trails: 8 }));
  assert.ok(hasAchievement('career-rider', {}, {}, { ...career, trails: 9 }));
  assert.ok(!hasAchievement('career-rider', {}, {}, { ...career, officialTotal: 0 }), 'no trails is not every trail');
  assert.ok(hasAchievement('gold-rush', {}, {}, { ...career, golds: 9 }));
  assert.ok(!hasAchievement('completionist', {}, {}, { ...career, trails: 9, bonusFinished: 1 }));
  assert.ok(hasAchievement('completionist', {}, {}, { ...career, trails: 9, bonusFinished: 2 }));
  assert.ok(!hasAchievement('crash-test-dummy', {}, { crashes: 99 }, career));
  assert.ok(hasAchievement('crash-test-dummy', {}, { crashes: 100 }, career), 'stat achievements come from totals');
  assert.ok(hasAchievement('bonk', { bonk: 1 }, {}, career), 'the rest are stored');
  assert.ok(!hasAchievement('bonk', {}, {}, career));
  assert.ok(hasAchievement('from-a-newer-version', { 'from-a-newer-version': 1 }, {}, career));

  const snapshot = (stored, stats = {}) => ({ has: id => hasAchievement(id, stored, stats, career) });
  assert.deepEqual(newlyEarned(snapshot({}), snapshot({ bonk: 1 }, { flips: 100 })).map(a => a.id), ['bonk', 'frequent-flyer']);
  assert.deepEqual(newlyEarned(snapshot({ bonk: 1 }), snapshot({ bonk: 1 })), []);
}

// --- Saving and syncing ------------------------------------------------------------------

{
  assert.deepEqual(cleanAchievements({ bonk: 5, 'from-a-newer-version': 7, 'Bad Id': 1, gone: 0, nan: 'x' }), { bonk: 5, 'from-a-newer-version': 7 },
    'unknown ids are kept, so an older version cannot drop them');
  assert.deepEqual(cleanAchievements([1, 2]), {});
  assert.deepEqual(cleanStats({ flips: 4.7, crashes: -1, apples: 2e12, 'Bad Name': 3 }), { flips: 4, apples: 1e9 });
  assert.deepEqual(mergeAchievements({ bonk: 5, 'pet-coda': 9 }, { bonk: 3, splashdown: 4 }), { bonk: 3, 'pet-coda': 9, splashdown: 4 }, 'the earlier time wins');
  assert.deepEqual(mergeStats({ flips: 10, crashes: 2 }, { flips: 4, apples: 7 }), { flips: 10, crashes: 2, apples: 7 }, 'the higher count wins');
  assert.ok(aheadOf({ achievements: { bonk: 1 } }, { achievements: {} }));
  assert.ok(aheadOf({ stats: { flips: 3 } }, { stats: { flips: 2 } }));
  assert.ok(!aheadOf({ achievements: { bonk: 1 }, stats: { flips: 2 } }, { achievements: { bonk: 9 }, stats: { flips: 3 } }));
  assert.ok(!aheadOf({}, null));

  const items = new Map();
  globalThis.localStorage = /** @type {any} */ ({
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
  });
  const playerId = '0a1b2c3d-1111-4222-8333-444455556666';
  items.set('hjulben-saves-v2', JSON.stringify([
    { rider: 'female', createdAt: 1, trail: 0, unlocked: 0, bestTimes: {}, name: 'OLDIE', playerId },
  ]));
  const storage = await import('../js/storage.js');
  const [old] = storage.loadSaveSlots(9);
  assert.deepEqual(old.achievements, {}, 'saves from before achievements start with none');
  assert.deepEqual(old.stats, {});

  const after = storage.recordAchievements(0, 9, ['bonk'], { flips: 3, crashes: 1 });
  assert.deepEqual(Object.keys(after.achievements), ['bonk']);
  assert.deepEqual(after.stats, { flips: 3, crashes: 1 });
  const firstTime = after.achievements.bonk;
  const again = storage.recordAchievements(0, 9, ['bonk'], { flips: 2 });
  assert.equal(again.achievements.bonk, firstTime, 'earning again keeps the first time');
  assert.equal(again.stats.flips, 5, 'stats add up');
  assert.deepEqual(storage.loadSaveSlots(9)[0].stats, { flips: 5, crashes: 1 }, 'and are written to storage');
  assert.equal(storage.recordAchievements(2, 9, ['bonk'], {}), null, 'an empty slot has nothing to record');

  const onlineId = '0a1b2c3d-9999-4222-8333-444455556666';
  const created = storage.createSave(1, old.look, 9, 'NEWBIE', { playerId: onlineId, token: 'abc.def' });
  assert.deepEqual([created.achievements, created.stats], [{}, {}]);
  storage.recordAchievements(1, 9, ['pet-coda'], { apples: 10 });
  const player = { id: onlineId, name: 'NEWBIE', look: created.look };
  const synced = storage.applyCloudSave(1, 9, {
    player, save: { unlocked: 0, bestTimes: {}, achievements: { bonk: 2 }, stats: { apples: 4, flips: 8 } }
  });
  assert.ok(synced.changed, 'the cloud copy brought something new');
  assert.ok(synced.ahead, 'and this device has something the cloud lacks');
  assert.deepEqual(Object.keys(synced.save.achievements).sort(), ['bonk', 'pet-coda']);
  assert.deepEqual(synced.save.stats, { apples: 10, flips: 8 });
  const caughtUp = storage.applyCloudSave(1, 9, { player, save: { ...synced.save } });
  assert.ok(!caughtUp.changed && !caughtUp.ahead, 'an equal cloud copy changes nothing');

  storage.deleteSave(1, 9);
  const index = storage.restoreOnlineSave(9, {
    token: 'abc.def', player, runs: [], save: { unlocked: 0, bestTimes: {}, achievements: { splashdown: 3 }, stats: { panes: 2 } }
  });
  const restored = storage.loadSaveSlots(9)[index];
  assert.deepEqual(restored.achievements, { splashdown: 3 }, 'logging in brings the cloud achievements');
  assert.deepEqual(restored.stats, { panes: 2 });
}

console.log('Achievement tests passed.');
