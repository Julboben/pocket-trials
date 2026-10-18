// The nisse: an optional collectible, one per trail. It is taken like an
// apple inside the ride, but never counts towards the finish, never changes
// the trail's hash (so best times and boards keep), and is remembered per
// trail in the save.
import assert from 'node:assert/strict';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { trailHash } from '../js/trail-hash.js';
import { createRide, stepRide } from '../js/ride.js';
import { rectangle } from './lib/terrain-fixtures.mjs';
import { NISSE_SPRITE, cleanNisseFinds, mergeNisseFinds, nisseWiggle, playerTouchesNisse } from '../js/nisse.js';
import { eventAchievements, hasAchievement } from '../js/achievements.js';
import { FRAME_REACH } from '../js/finish.js';

// One terrain for every trail here: each new block gets a fresh id, which
// would change the hash on its own.
const GROUND = rectangle(-200, 320, 3000, 620, 'grass', 'ground');
const base = (extra = {}) => ({
  name: 'test', apples: [], spikes: [], props: [],
  terrainBlocks: [structuredClone(GROUND)],
  start: { x: 100, y: null, facing: 1 }, finish: { x: 900, y: null },
  ...extra,
});

// A trail keeps its nisse; one without has no field at all; junk is dropped.
{
  assert.deepEqual(normalizeTrail(base({ nisse: { x: 400, y: null } })).nisse, { x: 400, y: null });
  assert.deepEqual(normalizeTrail(base({ nisse: { x: '400', y: '300' } })).nisse, { x: 400, y: 300 });
  assert.ok(!('nisse' in normalizeTrail(base())), 'no nisse, no field');
  assert.ok(!('nisse' in normalizeTrail(base({ nisse: { y: 3 } }))), 'a nisse needs an x');
  assert.ok(!('nisse' in normalizeTrail(base({ nisse: 'here' }))));
}

// Validation: a ground-anchored nisse needs ground, and a spike on it is flagged.
{
  const messages = (trail) => validateTrail(normalizeTrail(trail)).map((m) => `${m.type}: ${m.text}`);
  assert.ok(messages(base({ nisse: { x: 5000, y: null } })).some((m) => /^error: .*nisse has no terrain/.test(m)));
  assert.ok(!messages(base({ nisse: { x: 400, y: null } })).some((m) => /nisse/.test(m)), 'a nisse on the ground is fine');
  assert.ok(messages(base({ nisse: { x: 400, y: 320 }, spikes: [{ x: 400, y: 306, radius: 12 }] }))
    .some((m) => /^warning: Spike 1 overlaps the nisse/.test(m)));
}

// Adding, moving or removing the nisse never changes the trail's hash, so
// best times, ghosts and the online boards carry over.
{
  const plain = normalizeTrail(base());
  assert.equal(trailHash(normalizeTrail(base({ nisse: { x: 400, y: null } }))), trailHash(plain));
  assert.equal(trailHash(normalizeTrail(base({ nisse: { x: 700, y: 100 } }))), trailHash(plain));
}

// The nisse is taken when the player's hitbox touches the drawn sprite.
{
  const player = (rearX, rearY = 0) => ({ rear: { x: rearX, y: rearY }, front: { x: rearX - 50, y: rearY }, frameReach: FRAME_REACH, probes: [] });
  // Its feet stand at (0, 12): a wheel rolling into it at that height takes it.
  assert.ok(playerTouchesNisse({ x: 0, y: 12 }, player(-20)), 'a wheel against its boots');
  assert.ok(!playerTouchesNisse({ x: 0, y: 12 }, player(-40)), 'a wheel short of it');
  assert.equal(NISSE_SPRITE.length, 12);
  assert.ok(NISSE_SPRITE.every((row) => row.length === 10));
  assert.equal(nisseWiggle({ x: 0 }, 0), 0, 'its hat holds still at time 0');
  assert.ok(Array.from({ length: 100 }, (_, i) => nisseWiggle({ x: 0 }, i * 0.05)).some((w) => w !== 0), 'and flops now and then');
}

// Riding through it takes it without touching the apples or the finish: a
// run that finds it and one that doesn't both win, at the same time.
{
  const ride = (trail) => {
    const run = createRide(normalizeTrail(trail));
    const events = [];
    for (let step = 0; step < 4000 && run.status === 'running'; step++)
      events.push(...stepRide(run, { accelerating: true }));
    return { run, events };
  };
  const found = ride(base({ nisse: { x: 400, y: null } }));
  const missed = ride(base({ nisse: { x: 400, y: 100 } }));
  const none = ride(base());
  assert.equal(found.events.filter((e) => e.type === 'nisse').length, 1, 'found once');
  assert.ok(found.run.nisse.taken);
  assert.equal(missed.events.filter((e) => e.type === 'nisse').length, 0, 'high above the line, it is missed');
  for (const { run } of [found, missed, none]) assert.equal(run.status, 'won', 'the finish never waits for it');
  assert.equal(found.run.collected, 0, 'it is not an apple');
  assert.equal(found.run.elapsed, none.run.elapsed, 'and it never changes the run');
  assert.equal(none.run.nisse, null);
}

// Finds in a save: official and bonus trails by id, custom ones by hash; only
// the first two go to the cloud. Merging keeps both devices' finds.
{
  const finds = { 'official:05-windmill-hill': 10, 'trail:0a1b2c3d': 20, 'bonus:x@deadbeef': 5, junk: 3, 'official:x': -1 };
  assert.deepEqual(cleanNisseFinds(finds), { 'official:05-windmill-hill': 10, 'trail:0a1b2c3d': 20 });
  assert.deepEqual(cleanNisseFinds(finds, true), { 'official:05-windmill-hill': 10 });
  assert.deepEqual(mergeNisseFinds({ 'official:a': 30 }, { 'official:a': 10, 'bonus:b': 40 }), { 'official:a': 10, 'bonus:b': 40 });
}

// Achievements: the first find, and every official nisse once there are some.
{
  assert.ok(eventAchievements({ type: 'nisse' }).includes('hej-nisse'));
  const career = (nisseFound, nisseTotal) => ({ trails: 0, golds: 0, officialTotal: 35, bonusFinished: 0, bonusTotal: 0, nisseFound, nisseTotal });
  assert.ok(hasAchievement('nisse-hunter', {}, {}, career(3, 3)));
  assert.ok(!hasAchievement('nisse-hunter', {}, {}, career(2, 3)));
  assert.ok(!hasAchievement('nisse-hunter', {}, {}, career(0, 0)), 'not before any official trail hides one');
}

console.log('Nisse tests passed.');
