import assert from 'node:assert/strict';
import { terrainAt } from '../js/terrain.js';
import {
  SPIKE_RADIUS, createBlankTrail, normalizeTrail, normalizeSpike, validateTrail, medalFor, normalizeMedals,
  trailTerrainBlocks, trailBackWalls
} from '../js/trail-schema.js';
import { trailHash } from '../js/trail-hash.js';
import { isOnlineTrail } from '../js/online-leaderboard.js';
import { loadCatalogTrails } from './lib/trails.mjs';

const errors = trail => validateTrail(trail).filter(message => message.type === 'error').map(message => message.text);

// Every shipped trail validates, and normalizing is idempotent.
for (const entry of [...loadCatalogTrails('official'), ...loadCatalogTrails('custom')]) {
  const trail = normalizeTrail(entry.trail);
  assert.deepEqual(errors(trail), [], `${entry.id} validates`);
  assert.deepEqual(normalizeTrail(trail), trail, `${entry.id} normalizes idempotently`);
}

// Spikes: ground-anchored spikes sit on the ground, radius is clamped, spin defaults to 1.
{
  const anchored = normalizeSpike({ x: 200 }, 300);
  assert.equal(anchored.radius, SPIKE_RADIUS.default);
  assert.equal(anchored.y, 300 - SPIKE_RADIUS.default);
  assert.equal(anchored.spin, 1);
  assert.equal(normalizeSpike({ x: 0, y: 10, radius: 999 }).radius, SPIKE_RADIUS.max);
  assert.equal(normalizeSpike({ x: 0, y: 10, radius: 1 }).radius, SPIKE_RADIUS.min);
  assert.equal(normalizeSpike({ x: 0, y: 10, spin: -0.5 }).spin, -0.5);
  assert.equal(normalizeSpike({ x: 0, y: null }, 250).y, 250 - SPIKE_RADIUS.default);

  const trail = normalizeTrail({ ...createBlankTrail(), spikes: [{ x: 700, y: 100, radius: 20 }] });
  trail.spikes.push({ x: Number.NaN, y: 0, radius: 20, spin: 1 });
  assert.ok(errors(trail).some(text => text.includes('finite coordinates')));
  trail.spikes = [{ x: trail.start.x + 10, y: terrainAt(trail, trail.start.x).y - 20, radius: 20, spin: 1 }];
  assert.ok(validateTrail(trail).some(message => message.type === 'warning' && message.text.includes('close to the start')));
}

// Import round-trip: export as JSON, parse, normalize — nothing is lost.
{
  const original = normalizeTrail({
    ...createBlankTrail(3),
    name: 'Round Trip',
    spikes: [{ x: 640, radius: 24, spin: -1 }],
    apples: [{ x: 500, y: null }, { x: 820, y: 180 }],
    medals: { gold: 20, silver: 30, bronze: 45 }
  }, 3);
  const imported = normalizeTrail(JSON.parse(JSON.stringify(original)), 3);
  assert.deepEqual(imported, original);
  assert.deepEqual(errors(imported), []);
  assert.equal(trailHash(imported), trailHash(original));
}

// Garbage input still normalizes into a well-formed trail.
{
  const trail = normalizeTrail({ name: 'Broken', terrainBlocks: 'nope', spikes: [{}], apples: [{ x: 'x' }], start: {} });
  assert.deepEqual(trail.terrainBlocks, []);
  assert.equal(trail.spikes.length, 1);
  assert.ok(Number.isFinite(trail.spikes[0].y));
  assert.equal(trail.start.facing, 1);
}

// Medals.
{
  assert.equal(normalizeMedals({ gold: 10 }), null);
  assert.deepEqual(normalizeMedals({ gold: '10', silver: 12, bronze: 15 }), { gold: 10, silver: 12, bronze: 15 });
  const medals = { gold: 10, silver: 12, bronze: 15 };
  assert.equal(medalFor(medals, 9.5), 'gold');
  assert.equal(medalFor(medals, 12), 'silver');
  assert.equal(medalFor(medals, 14), 'bronze');
  assert.equal(medalFor(medals, 16), null);
  assert.equal(medalFor(undefined, 1), null);
  const trail = normalizeTrail({ ...createBlankTrail(), medals: { gold: 30, silver: 20, bronze: 40 } });
  assert.ok(errors(trail).some(text => text.includes('slower')));
}

// Content hashes identify a trail by its geometry, not its name or storage.
{
  const a = normalizeTrail(createBlankTrail(0));
  const b = normalizeTrail({ ...a, name: 'Renamed', label: 'X' });
  const c = normalizeTrail({ ...a, goal: a.goal - 10 });
  assert.equal(trailHash(a), trailHash(b));
  assert.notEqual(trailHash(a), trailHash(c));
  assert.match(trailHash(a), /^[0-9a-f]{8}$/);
  const d = normalizeTrail({ ...a, props: [{ x: 100, y: null, type: 'fence' }] });
  assert.equal(trailHash(a), trailHash(d), 'props do not change the identity');
  // Dropping a base material that matches the first block keeps the hash.
  const legacy = { ...a, terrain: a.terrainBlocks[0].material };
  const { terrain: _dropped, ...stripped } = legacy;
  assert.equal(trailHash(stripped), trailHash(legacy), 'a matching base material is not needed for the hash');
  assert.equal(trailHash(normalizeTrail(legacy)), trailHash(legacy), 'normalizing drops it without changing the hash');
  for (const colour of ['sky', 'sun', 'mountain', 'spray'])
    assert.equal(colour in normalizeTrail({ ...a, [colour]: '#fff' }), false, `${colour} is dropped`);
}

// Only official trails, keyed by id and gameplay hash, go to the online board.
for (const entry of loadCatalogTrails('official')) {
  assert.ok(isOnlineTrail(`${entry.id}@${trailHash(entry.trail)}`), entry.id);
}
// Back walls: blocks on the back layer keep their layer, are left out of the
// ridden terrain, and are scenery only, so they never change the gameplay hash.
{
  const blank = normalizeTrail(createBlankTrail());
  const wall = { id: 'back-1', material: 'rock', layer: 'back', regions: [{ outer: { nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, inner: [] }] };
  const walled = normalizeTrail({ ...blank, terrainBlocks: [wall, ...blank.terrainBlocks] });
  assert.equal(walled.terrainBlocks[0].layer, 'back');
  assert.ok(!('layer' in walled.terrainBlocks[1]), 'terrain blocks store no layer');
  assert.deepEqual(normalizeTrail(walled), walled, 'back walls normalize idempotently');
  assert.deepEqual(trailTerrainBlocks(walled), blank.terrainBlocks, 'back walls are not ridden');
  assert.equal(trailBackWalls(walled).length, 1);
  assert.equal(trailHash(walled), trailHash(blank), 'back walls do not change the trail hash');
  assert.equal(terrainAt(walled, 50, 20).y, terrainAt(blank, 50, 20).y, 'back walls do not collide');
  assert.deepEqual(errors(walled), []);
  assert.ok(errors(normalizeTrail({ ...blank, terrainBlocks: [wall] })).some(text => text.includes('needs terrain')), 'back walls alone are not terrain');
}
assert.ok(!isOnlineTrail('official:01-the-orchard'), 'an official id without its hash stays offline');
assert.ok(!isOnlineTrail('trail:0123abcd'), 'custom trails stay offline');

console.log('Trail schema tests passed.');
