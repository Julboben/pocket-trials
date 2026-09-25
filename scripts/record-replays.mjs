// Records one replay per official trail with a search-based bot, so the
// regression tests have real full-trail runs to replay.
//
//   node scripts/record-replays.mjs            record every official trail
//   node scripts/record-replays.mjs 03         only trails whose id contains "03"
//   REPLAY_MAX_MINUTES=5 node scripts/...      search budget per trail (default 20)
//
// The bot tries each input combination held over a short horizon on a copy
// of the ride, keeps the best-scoring one for a few steps, and repeats. When
// every option ahead crashes it backs up a little and searches again.
import { mkdirSync, writeFileSync } from 'node:fs';
import { STEP, TAU } from '../js/config.js';
import { createRide, stepRide, simulateRun } from '../js/ride.js';
import { encodeInputs } from '../js/replay-codec.js';
import { terrainAt } from '../js/terrain.js';
import { loadCatalogLevels, repoRoot } from './lib/levels.mjs';

const DECISION_STEPS = 12;
const HORIZONS = [36, 90, 180];
const MAX_SECONDS = 150;
const BACKTRACK_DECISIONS = 4;
const MAX_BACKTRACKS = 3000;
const MAX_MINUTES = Number(process.env.REPLAY_MAX_MINUTES) || 20;
const OUT_DIR = repoRoot + 'tests/replays/';

const CANDIDATES = [];
for (const leanInput of [-1, -.5, 0, .5, 1]) {
  for (const [accelerating, braking] of [[true, false], [false, false], [false, true]]) {
    CANDIDATES.push({ leanInput, accelerating, braking });
  }
}

function cloneRide(ride) {
  const { level, random, ...rest } = ride;
  return { ...structuredClone(rest), level, random };
}

function target(ride) {
  const mx = (ride.rear.x + ride.front.x) / 2;
  let best = null;
  for (const apple of ride.apples) {
    if (apple.taken) continue;
    if (!best || Math.abs(apple.x - mx) < Math.abs(best.x - mx)) best = apple;
  }
  return best || { x: ride.level.goal + 40, y: terrainAt(ride.level, ride.level.goal).y - 30 };
}

function score(ride, goalTarget, crashedAt) {
  if (ride.status === 'won') return 1e9 - ride.elapsed;
  const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
  let value = ride.collected * 1e6;
  value -= Math.abs(goalTarget.x - mx) + Math.max(0, Math.abs(goalTarget.y - my) - 40) * .5;
  const angle = Math.atan2(ride.front.y - ride.rear.y, ride.front.x - ride.rear.x) * ride.facing;
  const ground = terrainAt(ride.level, mx, my);
  const tilt = Math.atan2(Math.sin(angle - Math.atan(ground.slope || 0)), Math.cos(angle - Math.atan(ground.slope || 0)));
  value -= Math.abs(tilt) * 25;
  if (crashedAt !== null) value -= 1e5 - crashedAt * 100;
  return value;
}

// Below both lips of a gap the fall is certain even before the crash triggers.
function doomed(ride) {
  const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
  for (const [from, to] of ride.level.gaps || []) {
    if (mx <= from || mx >= to) continue;
    const lip = Math.max(terrainAt(ride.level, from - 1).y, terrainAt(ride.level, to + 1).y);
    if (my > lip + 40) return true;
  }
  return false;
}

function evaluate(ride, facing, candidate, horizon) {
  const probe = cloneRide(ride);
  const goalTarget = target(ride);
  const input = { facing, ...candidate };
  let crashedAt = null;
  for (let step = 0; step < horizon; step++) {
    stepRide(probe, input);
    if (probe.status === 'crashed' || doomed(probe)) { crashedAt = step; break; }
    if (probe.status === 'won') break;
    if (probe.collected > ride.collected) break;
  }
  return { value: score(probe, goalTarget, crashedAt), crashed: crashedAt !== null };
}

function recordTrail(entry) {
  const level = entry.level;
  let ride = createRide(level);
  const inputs = [];
  // One frame per committed decision; each remembers the options that crashed from there.
  const stack = [{ ride: cloneRide(ride), length: 0, banned: new Set(), chosen: -1 }];
  const restore = frame => { ride = cloneRide(frame.ride); inputs.length = frame.length; };
  let backtracks = 0, deadEnds = 0, lastDeadEnd = -Infinity;
  // If the trail can't be finished, keep the run that got furthest.
  let furthest = { progress: -Infinity, inputs: [] };
  const started = Date.now();
  let reported = started;
  while (ride.status === 'running' && inputs.length < MAX_SECONDS / STEP) {
    const frame = stack[stack.length - 1];
    const mx = (ride.rear.x + ride.front.x) / 2;
    const progress = ride.collected * 1e5 + mx;
    if (progress > furthest.progress) furthest = { progress, inputs: inputs.slice() };
    const now = Date.now();
    if (now - reported > 30000) {
      reported = now;
      process.stderr.write(`  ${entry.id}: x ${mx.toFixed(0)}, ${ride.collected} apples, ${backtracks} backtracks, `
        + `furthest x ${(furthest.progress % 1e5).toFixed(0)}\n`);
    }
    if (now - started > MAX_MINUTES * 60000) break;
    const goalTarget = target(ride);
    const airborne = !ride.rear.grounded && !ride.front.grounded;
    const facing = !airborne && Math.abs(goalTarget.x - mx) > 30 ? Math.sign(goalTarget.x - mx) : ride.facing;
    let best = null;
    for (const [index, candidate] of CANDIDATES.entries()) {
      if (frame.banned.has(index)) continue;
      // A candidate is safe if holding it survives at least one horizon.
      const results = HORIZONS.map(horizon => evaluate(ride, facing, candidate, horizon));
      const safe = results.filter(result => !result.crashed);
      if (!safe.length) continue;
      const value = Math.max(...safe.map(result => result.value));
      if (!best || value > best.value) best = { index, candidate, value };
    }
    if (!best) {
      if (++backtracks > MAX_BACKTRACKS || stack.length === 1) break;
      // Repeated dead ends in the same stretch jump further back each time.
      deadEnds = frame.length - lastDeadEnd < 240 ? deadEnds + 1 : 0;
      lastDeadEnd = frame.length;
      const depth = BACKTRACK_DECISIONS * (1 + Math.min(deadEnds, 12));
      for (let pop = 0; pop < depth && stack.length > 1; pop++) stack.pop();
      const previous = stack[stack.length - 1];
      previous.banned.add(previous.chosen);
      restore(previous);
      continue;
    }
    frame.chosen = best.index;
    const input = { facing, ...best.candidate };
    for (let step = 0; step < DECISION_STEPS && ride.status === 'running'; step++) {
      stepRide(ride, input);
      inputs.push(input);
    }
    if (ride.status === 'crashed' || doomed(ride)) {
      backtracks++;
      frame.banned.add(best.index);
      restore(frame);
      continue;
    }
    stack.push({ ride: cloneRide(ride), length: inputs.length, banned: new Set(), chosen: -1 });
  }
  if (ride.status !== 'won' && furthest.inputs.length) return { inputs: furthest.inputs, backtracks };
  return { inputs, backtracks };
}

const filter = process.argv[2] || '';
mkdirSync(OUT_DIR, { recursive: true });
for (const entry of loadCatalogLevels('official')) {
  if (!entry.id.includes(filter)) continue;
  const started = Date.now();
  const { inputs, backtracks } = recordTrail(entry);
  const { ride, events } = simulateRun(entry.level, inputs);
  const flips = events.filter(event => event.type === 'flip').reduce((sum, event) => sum + event.count, 0);
  const replay = {
    trail: entry.id,
    recordedBy: 'scripts/record-replays.mjs',
    seed: 1,
    steps: inputs.length,
    outcome: {
      status: ride.status,
      elapsed: Math.round(ride.elapsed * 1000) / 1000,
      collected: ride.collected,
      apples: ride.apples.length,
      crashCause: ride.crashCause,
      flips
    },
    inputs: encodeInputs(inputs)
  };
  const name = entry.file.split('/').pop();
  writeFileSync(OUT_DIR + name, JSON.stringify(replay) + '\n');
  console.log(`${entry.id}: ${ride.status} in ${ride.elapsed.toFixed(2)}s, ${ride.collected}/${ride.apples.length} apples, `
    + `${replay.inputs.length} input runs, ${backtracks} backtracks, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
