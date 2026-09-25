import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { RADIUS, STEP, WHEELBASE } from '../js/config.js';
import { createRide, stepRide, riderCollisionPoints, simulateRun } from '../js/ride.js';
import { decodeInputs, encodeInputs } from '../js/replay-codec.js';
import { terrainCollisionsAt, terrainAt } from '../js/terrain.js';
import { loadCatalogLevels, readJson, repoRoot } from './lib/levels.mjs';

const FINISH_TOLERANCE = .05;
const flatLevel = (overrides = {}) => ({
  name: 'test', points: [[0, 320], [3000, 320]], gaps: [], platforms: [], paths: [], terrain: 'grass', fallY: 820,
  start: { x: 120, y: null, facing: 1 }, goal: 2800, apples: [], spikes: [], ...overrides
});
const hold = (steps, input) => Array.from({ length: steps }, () => ({ facing: 1, leanInput: 0, accelerating: false, braking: false, ...input }));
const deepestPenetration = (level, points, radius) => Math.max(0, ...points.flatMap(point =>
  terrainCollisionsAt(level, point.x, point.y, radius ?? point.radius).map(contact => contact.penetration)));

// Recorded runs through every official trail must reproduce their outcome.
const entries = loadCatalogLevels('official');
for (const entry of entries) {
  const path = 'tests/replays/' + entry.file.split('/').pop();
  assert.ok(existsSync(repoRoot + path), `missing replay fixture ${path}; run node scripts/record-replays.mjs`);
  const replay = readJson(path);
  assert.equal(replay.trail, entry.id);
  const inputs = decodeInputs(replay.inputs);
  assert.equal(inputs.length, replay.steps, `${entry.id}: decoded step count`);
  assert.deepEqual(encodeInputs(inputs), replay.inputs, `${entry.id}: replay encoding round-trips`);

  const ride = createRide(entry.level, { seed: replay.seed });
  let worstPenetration = 0;
  for (const input of inputs) {
    stepRide(ride, input);
    const points = ride.vehicle.bikePoints;
    assert.ok(points.every(point => Number.isFinite(point.x + point.y + point.ox + point.oy)), `${entry.id}: state stays finite at step ${ride.steps}`);
    worstPenetration = Math.max(worstPenetration, deepestPenetration(entry.level, [ride.rear, ride.front], RADIUS));
    if (ride.status !== 'running') break;
  }
  assert.ok(worstPenetration < RADIUS * .75, `${entry.id}: wheels never tunnel into terrain (deepest ${worstPenetration.toFixed(2)})`);
  const { outcome } = replay;
  assert.equal(ride.status, outcome.status, `${entry.id}: outcome`);
  assert.equal(ride.collected, outcome.collected, `${entry.id}: apples collected`);
  assert.equal(ride.crashCause, outcome.crashCause, `${entry.id}: crash cause`);
  assert.ok(Math.abs(ride.elapsed - outcome.elapsed) <= FINISH_TOLERANCE,
    `${entry.id}: finish time ${ride.elapsed.toFixed(3)}s within ${FINISH_TOLERANCE}s of ${outcome.elapsed}s`);
  if (outcome.status === 'won') assert.equal(ride.collected, ride.apples.length, `${entry.id}: a win collects every apple`);
}

// Riding into a spike kills the rider and reports the cause.
{
  const level = flatLevel({ spikes: [{ x: 400, y: 300, radius: 18 }] });
  const { ride, events } = simulateRun(level, hold(600, { accelerating: true }));
  assert.equal(ride.status, 'crashed');
  assert.equal(ride.crashCause, 'spike');
  const crash = events.find(event => event.type === 'crash');
  assert.ok(crash && Math.abs(crash.x - 400) < 30, 'spike crash is reported at the spike');
}

// Same inputs and seed give the same crash, down to every ragdoll joint.
{
  const level = flatLevel({ spikes: [{ x: 400, y: 300, radius: 18 }] });
  const run = () => simulateRun(level, hold(600, { accelerating: true }), { settleSteps: 240 }).ride.ragdoll.list.map(p => [p.x, p.y]);
  assert.deepEqual(run(), run());
}

// Timer starts on first input, not on spawn.
{
  const ride = createRide(flatLevel());
  for (let step = 0; step < 120; step++) stepRide(ride, { facing: 1 });
  assert.equal(ride.elapsed, 0, 'idle bike does not run the clock');
  assert.ok(ride.time > .9);
  const events = stepRide(ride, { facing: 1, accelerating: true });
  assert.ok(events.some(event => event.type === 'start'));
  assert.ok(Math.abs(ride.elapsed - STEP) < 1e-9);
}

// Rider probes are anchored to the chassis and sit above the wheels at rest.
{
  const ride = createRide(flatLevel());
  for (let step = 0; step < 120; step++) stepRide(ride, { facing: 1 });
  const { head, hip } = riderCollisionPoints(ride);
  const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
  assert.ok(Math.abs(head.x - mx - 3) < 1.5 && my - head.y > 38 && my - head.y < 48, 'head probe above the bike');
  assert.ok(hip.y > head.y);
  for (const point of ride.vehicle.chassisPoints) { point.y -= (point.x - mx) * .2; point.oy = point.y; }
  const pitched = riderCollisionPoints(ride);
  assert.ok(Math.abs(pitched.head.x - head.x) > 3, 'probes follow chassis pitch');
}

// After a crash the ragdoll keeps knees and elbows bending the right way and
// the riderless bike stays on top of the ground.
{
  const level = flatLevel({ spikes: [{ x: 300, y: 300, radius: 18 }] });
  const { ride } = simulateRun(level, hold(600, { accelerating: true }), { settleSteps: 480 });
  assert.equal(ride.status, 'crashed');
  const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  for (const hinge of ride.ragdoll.hinges) {
    const { [hinge.a]: a, [hinge.joint]: joint, [hinge.b]: b } = ride.ragdoll.points;
    assert.ok(cross(a, joint, b) * hinge.side >= -1e-6, `${hinge.joint} bends forwards only`);
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= hinge.minSpan - .5, `${hinge.joint} respects the fold limit`);
  }
  assert.ok(ride.ragdoll.list.every(p => Number.isFinite(p.x + p.y)));
  assert.ok(deepestPenetration(level, ride.vehicle.chassisPoints) < 2, 'crashed chassis rests on the ground');
  const ground = terrainAt(level, ride.vehicle.chassis.top.x).y;
  assert.ok(ride.vehicle.chassisPoints.every(point => point.y < ground + 1), 'chassis did not sink through the ground');
}

// Falling below the trail ends the run.
{
  const level = flatLevel({ gaps: [[300, 3000]], points: [[0, 320], [3000, 320]], fallY: 700 });
  const { ride } = simulateRun(level, hold(900, { accelerating: true }));
  assert.equal(ride.crashCause, 'fall');
}

// The goal stays locked until every apple is collected.
{
  const level = flatLevel({ goal: 500, apples: [{ x: 1800, y: null }] });
  const { ride, events } = simulateRun(level, hold(360, { accelerating: true }));
  assert.ok(events.some(event => event.type === 'goalLocked' && event.missing === 1));
  assert.notEqual(ride.status, 'won');
}

assert.ok(WHEELBASE > 0);
console.log(`Replay regression tests passed (${entries.length} trails).`);
