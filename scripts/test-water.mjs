// Water bodies: the data format, validation, and how the bike and rider behave in them.
import assert from 'node:assert/strict';
import { simulateRun } from '../js/ride.js';
import { createBlankTrail, normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { trailHash } from '../js/trail-hash.js';
import { WATER_SIZE, WATER_WIPEOUT_DEPTH, deepWater, normalizeWater, waterAt, wheelImmersion } from '../js/water.js';
import { rectangle } from './lib/terrain-fixtures.mjs';

const flatTrail = (overrides = {}) => ({
  name: 'test', terrainBlocks: [rectangle(0, 320, 3000, 620)], fallY: 820,
  start: { x: 120, y: null, facing: 1 }, goal: 2800, apples: [], spikes: [], ...overrides
});
// Ground at 320, then a pit from x 600 to 1000 whose floor is at 440.
const pitTrail = water => flatTrail({
  terrainBlocks: [rectangle(0, 320, 600, 620, 'grass', 'a'), rectangle(600, 440, 1000, 620, 'grass', 'b'), rectangle(1000, 320, 3000, 620, 'grass', 'c')],
  water,
});
const hold = (steps, input) => Array.from({ length: steps }, () => ({ facing: 1, leanInput: 0, accelerating: false, braking: false, ...input }));
const warnings = trail => validateTrail(trail).filter(message => message.type === 'warning').map(message => message.text);
const errors = trail => validateTrail(trail).filter(message => message.type === 'error').map(message => message.text);

// Format: sizes default and clamp, and normalized trails always carry a list.
{
  assert.deepEqual(normalizeWater({ x: 10, y: 20 }), { x: 10, y: 20, width: WATER_SIZE.width, depth: WATER_SIZE.depth });
  assert.deepEqual(normalizeWater({ x: 0, y: 0, width: 2, depth: 1 }), { x: 0, y: 0, width: WATER_SIZE.minWidth, depth: WATER_SIZE.minDepth });
  assert.deepEqual(normalizeTrail(createBlankTrail()).water, []);
  assert.deepEqual(normalizeTrail(flatTrail()).water, [], 'trails without water get an empty list');
  const wet = normalizeTrail(flatTrail({ water: [{ x: 400, y: 288, width: 500, depth: 32 }] }));
  assert.deepEqual(normalizeTrail(wet), wet, 'water normalizes idempotently');
  assert.ok(!deepWater(WATER_WIPEOUT_DEPTH) && deepWater(WATER_WIPEOUT_DEPTH + 1));
}

// Queries: the body is open water only where there is no terrain.
{
  const bodies = [{ x: 100, y: 100, width: 100, depth: 50 }];
  assert.ok(waterAt(bodies, 150, 120));
  assert.ok(!waterAt(bodies, 150, 99) && !waterAt(bodies, 250, 120));
  // A wheel resting on the floor is immersed by the full depth, never more.
  assert.equal(wheelImmersion(bodies, 150, 140, 10), 50);
}

// The hash only changes when a trail actually has water, so existing trails and
// their leaderboards keep their ids.
{
  const plain = normalizeTrail(flatTrail());
  assert.equal(trailHash(plain), trailHash({ ...plain, water: undefined }));
  assert.notEqual(trailHash(plain), trailHash({ ...plain, water: [{ x: 400, y: 288, width: 500, depth: 32 }] }));
}

// Validation: buried water and water over the start are flagged, bad sizes are errors.
{
  assert.ok(warnings(normalizeTrail(flatTrail({ water: [{ x: 60, y: 280, width: 200, depth: 60 }] }))).some(text => /start/i.test(text)));
  assert.ok(warnings(normalizeTrail(flatTrail({ water: [{ x: 1000, y: 400, width: 200, depth: 60 }] }))).some(text => /inside terrain/i.test(text)));
  assert.ok(errors({ ...normalizeTrail(flatTrail()), water: [{ x: 400, y: NaN, width: 100, depth: 30 }] }).length > 0);
  assert.deepEqual(warnings(normalizeTrail(pitTrail([{ x: 600, y: 330, width: 400, depth: 110 }]))).filter(text => /water/i.test(text)), []);
}

// A shallow ford is ridden through, but slows the bike down.
{
  const run = water => simulateRun(flatTrail({ water }), hold(400, { accelerating: true }));
  const dry = run([]);
  const ford = run([{ x: 400, y: 320 - WATER_WIPEOUT_DEPTH, width: 500, depth: WATER_WIPEOUT_DEPTH }]);
  assert.notEqual(ford.ride.status, 'crashed', 'a ford no deeper than the threshold is rideable');
  assert.ok(ford.ride.rear.x < dry.ride.rear.x - 20, 'water slows the bike');
}

// Riding into deep water wipes the rider out, and the rider floats at the surface.
{
  const trail = pitTrail([{ x: 600, y: 330, width: 400, depth: 110 }]);
  const { ride, events } = simulateRun(trail, hold(400, { accelerating: true }), { settleSteps: 600 });
  assert.equal(ride.status, 'crashed');
  assert.equal(ride.crashCause, 'water');
  const crash = events.find(event => event.type === 'crash');
  assert.ok(crash.x > 600 && crash.x < 1000, 'the wipe-out happens in the water');
  assert.ok(events.some(event => event.type === 'splash' && !event.rider), 'the bike splashes in');
  assert.ok(events.some(event => event.type === 'splash' && event.rider), 'the rider splashes in');
  const points = ride.ragdoll.list;
  const centre = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  assert.ok(Math.abs(centre - 330) < 10, `the rider floats at the surface (centre ${centre.toFixed(1)})`);
  assert.ok(points.every(point => point.y < 440 - 4), 'no part of the rider sinks to the floor');
}

// Water is deterministic, down to every ragdoll joint.
{
  const trail = pitTrail([{ x: 600, y: 330, width: 400, depth: 110 }]);
  const run = () => simulateRun(trail, hold(400, { accelerating: true }), { settleSteps: 240 }).ride.ragdoll.list.map(p => [p.x, p.y]);
  assert.deepEqual(run(), run());
}

console.log('Water tests passed.');
