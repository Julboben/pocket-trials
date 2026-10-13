// Records one replay per official trail with a search-based bot, so the
// regression tests have real full-trail runs to replay.
//
//   node scripts/record-replays.mjs            record trails whose replay is stale
//   node scripts/record-replays.mjs 03         only trails whose id contains "03"
//   node scripts/record-replays.mjs --force    re-record even replays that still work
//   node scripts/record-replays.mjs --explore  skip the greedy bot and go straight to the explorer
//   REPLAY_MAX_MINUTES=5 node scripts/...      search budget per trail (default 20)
//
// An existing replay is kept (its outcome refreshed) while it still finishes
// the trail, so editing one trail or tweaking physics only re-records the
// trails that broke. A replay that never finished is kept until its trail
// changes, since the bot would most likely fail again.
//
// The bot tries each input combination held over a short horizon on a copy
// of the ride, keeps the best-scoring one for a few steps, and repeats. When
// every option ahead crashes it backs up a little and searches again. If it
// can't finish a trail, the explorer (see exploreTrail) takes over: it finds
// routes that turn around, roll back for a run-up or launch off kickers.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { STEP, TAU } from '../js/config.js';
import { createRide, stepRide, simulateRun } from '../js/ride.js';
import { decodeInputs, encodeInputs } from '../js/replay-codec.js';
import { terrainAt } from '../js/terrain.js';
import { loadCatalogTrails, repoRoot } from './lib/trails.mjs';

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
  const { trail, random, ...rest } = ride;
  return { ...structuredClone(rest), trail, random };
}

function target(ride) {
  const mx = (ride.rear.x + ride.front.x) / 2;
  let best = null;
  for (const apple of ride.apples) {
    if (apple.taken) continue;
    if (!best || Math.abs(apple.x - mx) < Math.abs(best.x - mx)) best = apple;
  }
  return best || { x: ride.trail.finish.x + 40, y: terrainAt(ride.trail, ride.trail.finish.x).y - 30 };
}

function score(ride, goalTarget, crashedAt) {
  if (ride.status === 'won') return 1e9 - ride.elapsed;
  const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
  let value = ride.collected * 1e6;
  value -= Math.abs(goalTarget.x - mx) + Math.max(0, Math.abs(goalTarget.y - my) - 40) * .5;
  const angle = Math.atan2(ride.front.y - ride.rear.y, ride.front.x - ride.rear.x) * ride.facing;
  const ground = terrainAt(ride.trail, mx, my);
  const tilt = Math.atan2(Math.sin(angle - Math.atan(ground.slope || 0)), Math.cos(angle - Math.atan(ground.slope || 0)));
  value -= Math.abs(tilt) * 25;
  if (crashedAt !== null) value -= 1e5 - crashedAt * 100;
  return value;
}

function evaluate(ride, facing, candidate, horizon) {
  const probe = cloneRide(ride);
  const goalTarget = target(ride);
  const input = { facing, ...candidate };
  let crashedAt = null;
  for (let step = 0; step < horizon; step++) {
    stepRide(probe, input);
    if (probe.status === 'crashed') { crashedAt = step; break; }
    if (probe.status === 'won') break;
    if (probe.collected > ride.collected) break;
  }
  return { value: score(probe, goalTarget, crashedAt), crashed: crashedAt !== null };
}

function recordTrail(entry) {
  const trail = entry.trail;
  let ride = createRide(trail);
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
    if (ride.status === 'crashed') {
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

// The explorer: a fallback for trails the greedy bot can't plan, where the
// way on leads away from the next apple first (roll back, turn around and
// launch, flip off a kicker, take the long way round). It keeps an archive
// of distinct situations, keyed by the apples taken, place, facing and speed,
// each with the quickest inputs found that reach it. It keeps going back to
// rarely tried situations and riding on from them with random held inputs,
// turning around now and then, until a run finishes. After the first finish
// it explores as long again, so quicker routes can replace the slow ones.
const EXPLORE_CELL = 48;
const EXPLORE_SPEED = 1.5;            // speed bucket size, in units per step
const EXPLORE_MAX_CELLS = 40000;
const EXPLORE_MIN_POLISH = 3000;      // iterations kept exploring after the first finish
const EXPLORE_REPEAT = .75;           // chance of holding the previous input
const EXPLORE_TURN = .08;             // chance of turning around at a decision
const EXPLORE_GAS = .6;               // chance a new input holds the throttle
const EXPLORE_HOLDS = [1, 2, 4];      // decisions a new input is held for, so climbs get sustained gas

function seededGenerator(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cellKey(ride) {
  const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
  const vx = (ride.rear.x - ride.rear.ox + ride.front.x - ride.front.ox) / 2;
  const speed = Math.max(-3, Math.min(3, Math.round(vx / EXPLORE_SPEED)));
  let taken = 0;
  ride.apples.forEach((apple, index) => { if (apple.taken) taken |= 1 << index; });
  return `${taken}|${ride.facing}|${Math.floor(mx / EXPLORE_CELL)}|${Math.floor(my / EXPLORE_CELL)}|${speed}`;
}

/** The inputs that led to a trajectory node, oldest first. */
function inputsOf(node) {
  const runs = [];
  for (; node; node = node.parent) runs.push(node);
  const inputs = [];
  for (const { input, count } of runs.reverse()) for (let step = 0; step < count; step++) inputs.push(input);
  return inputs;
}

function exploreTrail(entry) {
  const random = seededGenerator(1);
  const start = createRide(entry.trail);
  const cells = new Map();
  const list = [];
  let mostApples = 0;
  const visit = (ride, node, steps) => {
    const key = cellKey(ride);
    const cell = cells.get(key);
    if (cell) {
      if (steps < cell.steps) Object.assign(cell, { ride: cloneRide(ride), node, steps });
      return;
    }
    if (list.length >= EXPLORE_MAX_CELLS) return;
    const added = { ride: cloneRide(ride), node, steps, chosen: 0, apples: ride.collected };
    cells.set(key, added);
    list.push(added);
    mostApples = Math.max(mostApples, ride.collected);
  };
  visit(start, null, 0);
  // Rarely chosen cells are favoured, and cells holding the most apples so far most of all.
  const choose = () => {
    let total = 0;
    const weights = list.map(cell => {
      const weight = (cell.apples === mostApples ? 4 : 1) / Math.sqrt(1 + cell.chosen);
      total += weight;
      return weight;
    });
    let pick = random() * total;
    for (let index = 0; index < list.length; index++) if ((pick -= weights[index]) <= 0) return list[index];
    return list[list.length - 1];
  };
  let best = null, firstWin = 0, iterations = 0;
  const started = Date.now();
  let reported = started;
  while (Date.now() - started < MAX_MINUTES * 60000) {
    iterations++;
    if (best && iterations > firstWin * 2 + EXPLORE_MIN_POLISH) break;
    const cell = choose();
    cell.chosen++;
    const ride = cloneRide(cell.ride);
    let { node, steps } = cell;
    let input = node?.input ?? { facing: ride.facing, leanInput: 0, accelerating: true, braking: false };
    const decisions = 4 + Math.floor(random() * 13);
    for (let decision = 0; decision < decisions && ride.status === 'running'; decision++) {
      let hold = 1;
      if (random() > EXPLORE_REPEAT) {
        const throttle = random() < EXPLORE_GAS;
        const options = CANDIDATES.filter(candidate => candidate.accelerating === throttle);
        const { leanInput, accelerating, braking } = options[Math.floor(random() * options.length)];
        const facing = random() < EXPLORE_TURN ? -ride.facing : ride.facing;
        input = { facing, leanInput, accelerating, braking };
        hold = EXPLORE_HOLDS[Math.floor(random() * EXPLORE_HOLDS.length)];
      }
      let count = 0;
      while (count < DECISION_STEPS * hold && ride.status === 'running') { stepRide(ride, input); count++; }
      steps += count;
      node = { parent: node, input, count };
      if (ride.status === 'won') {
        if (!best || steps < best.steps) {
          best = { node, steps };
          if (!firstWin) firstWin = iterations;
          console.log(`  ${entry.id}: explorer finished in ${ride.elapsed.toFixed(2)}s after ${iterations} tries`);
        }
        break;
      }
      if (ride.status !== 'running' || steps * STEP > MAX_SECONDS) break;
      visit(ride, node, steps);
    }
    const now = Date.now();
    if (now - reported > 30000) {
      reported = now;
      process.stderr.write(`  ${entry.id}: explorer ${iterations} tries, ${list.length} places, `
        + `${mostApples}/${start.apples.length} apples${best ? `, best ${(best.steps * STEP).toFixed(2)}s` : ''}\n`);
    }
  }
  return best ? { inputs: inputsOf(best.node), backtracks: 0 } : null;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const exploreOnly = args.includes('--explore');
const filter = args.find(arg => !arg.startsWith('--')) || '';
const trailHash = trail => createHash('sha256').update(JSON.stringify(trail)).digest('hex').slice(0, 16);

function outcomeOf(trail, inputs, seed = 1) {
  const { ride, events } = simulateRun(trail, inputs, { seed });
  const flips = events.filter(event => event.type === 'flip').reduce((sum, event) => sum + event.count, 0);
  return {
    ride,
    outcome: {
      status: ride.status,
      elapsed: Math.round(ride.elapsed * 1000) / 1000,
      collected: ride.collected,
      apples: ride.apples.length,
      crashCause: ride.crashCause,
      flips
    }
  };
}

// Returns the existing replay's inputs if they are still worth keeping.
function reusable(entry, path, hash) {
  if (force || !existsSync(path)) return null;
  let replay;
  try { replay = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (replay.trail !== entry.id) return null;
  const inputs = decodeInputs(replay.inputs);
  const { ride, outcome } = outcomeOf(entry.trail, inputs, replay.seed);
  if (ride.status === 'won') return { inputs: inputs.slice(0, ride.steps), reason: 'still finishes' };
  const unchanged = replay.trailHash === hash && replay.outcome?.status !== 'won'
    && JSON.stringify(outcome) === JSON.stringify(replay.outcome);
  return unchanged ? { inputs, reason: 'never finished, trail unchanged (--force to retry)' } : null;
}

mkdirSync(OUT_DIR, { recursive: true });
const officialTrails = loadCatalogTrails('official');
// Drop replays left behind when an official trail is renamed or removed.
const expected = new Set(officialTrails.map(entry => entry.file.split('/').pop()));
for (const file of readdirSync(OUT_DIR)) {
  if (!file.endsWith('.json') || expected.has(file)) continue;
  unlinkSync(OUT_DIR + file);
  console.log(`${file}: removed, no official trail uses it`);
}
let kept = 0, recorded = 0;
for (const entry of officialTrails) {
  if (!entry.id.includes(filter)) continue;
  const started = Date.now();
  const path = OUT_DIR + entry.file.split('/').pop();
  const hash = trailHash(entry.trail);
  const reuse = reusable(entry, path, hash);
  let result = reuse || (exploreOnly ? null : recordTrail(entry));
  if (!reuse && (!result || outcomeOf(entry.trail, result.inputs).ride.status !== 'won')) {
    if (result) console.log(`  ${entry.id}: the greedy bot didn't finish, exploring`);
    result = exploreTrail(entry) || result || { inputs: [], backtracks: 0 };
  }
  const { inputs, backtracks } = result;
  const { ride, outcome } = outcomeOf(entry.trail, inputs);
  const replay = {
    trail: entry.id,
    recordedBy: 'scripts/record-replays.mjs',
    seed: 1,
    trailHash: hash,
    steps: inputs.length,
    outcome,
    inputs: encodeInputs(inputs)
  };
  const text = JSON.stringify(replay) + '\n';
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  const summary = `${ride.status} in ${ride.elapsed.toFixed(2)}s, ${ride.collected}/${ride.apples.length} apples`;
  if (reuse) {
    kept++;
    console.log(`${entry.id}: kept, ${reuse.reason} (${summary})`);
    continue;
  }
  recorded++;
  console.log(`${entry.id}: recorded, ${summary}, ${replay.inputs.length} input runs, `
    + `${backtracks} backtracks, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
console.log(`${recorded} recorded, ${kept} kept.`);
