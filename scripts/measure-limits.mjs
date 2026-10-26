// Measures what the bike can do, on small test pieces of terrain, with the
// game's own simulation: how fast it gets going, how far kickers throw it,
// how steep a slope it climbs and how tall a step it gets up. The results are
// a table in TRAIL_FORMAT.md ("What the bike can do"), so whoever builds a
// trail can design near the limits from the start, then measure their own
// jumps with scripts/playtest.mjs --probe.
//
//   node scripts/measure-limits.mjs           measure and write the table
//   node scripts/measure-limits.mjs --check   fail if the table is out of date
//
// The rider here holds the gas and keeps the bike in line with the ground
// under it (level in the air), leaning against it as it turns, and eases off
// the gas when the front lifts too far, as a steady player would; up a step
// it lifts the front first. A skilled one gets a little more out of the
// bike, so treat the numbers as what a good rider can count on, not the most
// anyone can do. A change to
// the physics changes them, and `npm test` fails until they are measured
// again.
import { readFileSync, writeFileSync } from 'node:fs';
import { STEP } from '../js/config.js';
import { bikeSpeed, createRide, stepRide } from '../js/ride.js';
import { terrainAt } from '../js/terrain.js';
import { normalizeTrail } from '../js/trail-schema.js';
import { polygonBlock, rectangle } from './lib/terrain-fixtures.mjs';
import { repoRoot } from './lib/trails.mjs';

const DOC = repoRoot + 'TRAIL_FORMAT.md';
const START = '<!-- limits:start (written by scripts/measure-limits.mjs) -->';
const END = '<!-- limits:end -->';
const GROUND = 300;

const mid = ride => ({ x: (ride.rear.x + ride.front.x) / 2, y: (ride.rear.y + ride.front.y) / 2 });
const airborne = ride => !ride.rear.grounded && !ride.front.grounded;
const degrees = radians => radians * 180 / Math.PI;

/** A trail of the given blocks, with walls far off at both ends. */
function piece(blocks) {
  return normalizeTrail({
    name: 'Limits',
    terrainBlocks: [rectangle(-4300, -3000, -4000, 900, 'grass', 'west'), rectangle(9000, -3000, 9300, 900, 'grass', 'east'), ...blocks],
    start: { x: 0, y: null, facing: 1 }, finish: { x: 8800, y: null }, apples: [], props: [], spikes: [],
  });
}

/** A ride standing at x on the piece, already moving right at `speed`. */
function rideFrom(trail, x, speed) {
  const ride = createRide(trail, { start: { x, y: null, facing: 1 } });
  for (const point of ride.vehicle.bikePoints) point.ox = point.x - speed * STEP;
  return ride;
}

/**
 * A steady rider: gas, with the bike's pitch (degrees, nose up) held to the
 * ground's just ahead, or level in the air, plus `lift` while it wants the
 * front up. Lean turns the bike hard, so it is damped by how fast the bike
 * already turns, and the gas comes off when the front is far too high.
 */
function rider(trail) {
  let last = 0;
  return (ride, lift = 0) => {
    const pitch = -degrees(Math.atan2(ride.front.y - ride.rear.y, ride.front.x - ride.rear.x));
    const turning = (pitch - last) / STEP;
    last = pitch;
    const { x, y } = mid(ride);
    const ground = airborne(ride) ? null : terrainAt(trail, x + 20, y - 30);
    const want = -degrees(Math.atan(ground?.slope || 0)) + lift;
    const error = pitch - want + turning * 0.1;
    return { facing: 1, accelerating: pitch - want < 20, braking: false, leanInput: Math.max(-1, Math.min(1, error / 20)) };
  };
}

/** Rides until `stop` says so, a crash, or `seconds` run out; `lift` says how far to lift the front. */
function ride(bike, seconds, stop, lift = () => 0) {
  const steady = rider(bike.trail);
  for (let step = 0; step < seconds / STEP && bike.status === 'running'; step++) {
    stepRide(bike, steady(bike, lift(bike)));
    if (stop?.(bike)) break;
  }
  return bike;
}

// --- Speed on flat ground -----------------------------------------------------

function acceleration() {
  const trail = piece([rectangle(-4000, GROUND, 9000, 900)]);
  const bike = createRide(trail, { start: { x: -3800, y: null, facing: 1 } });
  const steady = rider(trail);
  const times = { 200: null, 300: null, 400: null };
  let after = {};
  for (let step = 1; step <= 8 / STEP && bike.status === 'running'; step++) {
    stepRide(bike, steady(bike));
    const speed = bikeSpeed(bike);
    for (const target of Object.keys(times)) if (times[target] === null && speed >= Number(target)) times[target] = step * STEP;
    if (step === Math.round(2 / STEP)) after.two = { speed, distance: mid(bike).x + 3800 };
  }
  after.top = bikeSpeed(bike);
  return { times, after };
}

// --- Kickers ---------------------------------------------------------------------

/**
 * A kicker `height` tall at `angle` degrees, its lip at x 0, on flat ground
 * that carries on level beyond it: approached at `speed`, how long the bike
 * is in the air, how far past the lip it lands and how high it rises above
 * the lip.
 */
function kicker(angle, speed, height = 40) {
  const run = height / Math.tan(angle * Math.PI / 180);
  const trail = piece([
    polygonBlock([[-4000, GROUND], [-run, GROUND], [0, GROUND - height], [0, 900], [-4000, 900]], 'grass', 'approach'),
    rectangle(0, GROUND, 9000, 900, 'grass', 'landing'),
  ]);
  const bike = rideFrom(trail, -run - 250, speed);
  let launched = null, top = Infinity;
  ride(bike, 8, probe => {
    const { x, y } = mid(probe);
    if (!launched && airborne(probe) && x > -run) launched = { x, y };
    if (launched) top = Math.min(top, y);
    return launched && !airborne(probe) && x > 0;
  });
  if (!launched || bike.status !== 'running') return null;
  return { distance: Math.round(mid(bike).x), rise: Math.round((GROUND - height) - top - 22) };
}

// --- Slopes and steps -------------------------------------------------------------

/** Whether the bike gets up a slope of `angle` degrees and 300 units tall, from a standstill or a run-up. */
function climbs(angle, speed) {
  const rise = 300, run = rise / Math.tan(angle * Math.PI / 180);
  const trail = piece([
    polygonBlock([[-4000, GROUND], [0, GROUND], [run, GROUND - rise], [9000, GROUND - rise], [9000, 900], [-4000, 900]], 'grass', 'slope'),
  ]);
  const bike = rideFrom(trail, speed ? -600 : -60, speed);
  ride(bike, 10, probe => mid(probe).x > run + 120 && mid(probe).y < GROUND - rise);
  return bike.status === 'running' && mid(bike).x > run + 120;
}

// Where the front comes up before a step, and how far: [from, to, degrees].
// Getting up a step depends on the moment, so each is tried.
const LIFTS = [[-70, 10, 35], [-120, -20, 45], [-90, 0, 60]];

/** Whether the bike gets up a sheer step `height` tall, from a run-up at `speed`, lifting the front at some moment. */
function stepsUp(height, speed) {
  const trail = piece([
    rectangle(-4000, GROUND, 0, 900, 'grass', 'low'),
    rectangle(0, GROUND - height, 9000, 900, 'grass', 'high'),
  ]);
  return LIFTS.some(([from, to, lift]) => {
    const bike = rideFrom(trail, -500, speed);
    ride(bike, 8, probe => mid(probe).x > 150, probe => (mid(probe).x > from && mid(probe).x < to ? lift : 0));
    return bike.status === 'running' && mid(bike).x > 150;
  });
}

// --- The table ----------------------------------------------------------------------

function measure() {
  const lines = [];
  const { times, after } = acceleration();
  lines.push('**Speed on flat ground**, from a standstill with the gas held:', '');
  lines.push('| Reaches 200 | Reaches 300 | Reaches 400 | After 2 s | Top speed |', '|---|---|---|---|---|');
  const time = value => value === null ? 'never' : `${value.toFixed(1)} s`;
  lines.push(`| ${time(times[200])} | ${time(times[300])} | ${time(times[400])} | ${Math.round(after.two.speed)} units/s, ${Math.round(after.two.distance)} units on | ${Math.round(after.top)} units/s |`, '');

  const speeds = [200, 300, 400, 500];
  lines.push('**Kickers:** a 40-unit kicker, its lip at the end of flat ground that carries on level beyond it. Each cell is how far past the lip the bike lands, and how high it rises above the lip, at that approach speed:', '');
  lines.push(`| Kicker | ${speeds.map(speed => `${speed} units/s`).join(' | ')} |`, `|---|${speeds.map(() => '---').join('|')}|`);
  for (const angle of [15, 25, 35]) {
    const cells = speeds.map(speed => {
      const jump = kicker(angle, speed);
      return jump ? `${jump.distance} on, ${Math.max(0, jump.rise)} up` : 'crashes';
    });
    lines.push(`| ${angle}° | ${cells.join(' | ')} |`);
  }
  lines.push('');

  const slopes = [20, 25, 30, 35, 40, 45, 50, 55, 60];
  const steepest = speed => slopes.filter(angle => climbs(angle, speed)).pop() ?? null;
  const still = steepest(0), running = steepest(400);
  lines.push(`**Climbs:** a 300-unit-tall slope is climbed up to ${still === null ? 'less than 20' : still}° from a standstill at its foot, and up to ${running === null ? 'less than 20' : running}° with a run-up at 400 units/s (tried in steps of 5°). Steeper, the bike flips over backwards or stalls.`, '');

  const heights = [10, 20, 30, 40, 50, 60];
  const tallest = speed => heights.filter(height => stepsUp(height, speed)).pop() ?? null;
  const steps = [0, 200, 400].map(speed => ({ speed, height: tallest(speed) }));
  lines.push(`**Steps:** a sheer step is ridden up to ${steps.map(({ speed, height }) => `${height ?? 'less than 10'} units tall ${speed ? `at ${speed} units/s` : 'from a crawl'}`).join(', ')}, lifting the front just before it (tried in steps of 10). Taller than that, the rider's head hits the step: give it a ramp or a kicker.`);
  return lines.join('\n');
}

const table = measure();
const doc = readFileSync(DOC, 'utf8');
const from = doc.indexOf(START), to = doc.indexOf(END);
if (from < 0 || to < from) throw new Error(`TRAIL_FORMAT.md has no ${START} … ${END} markers`);
const updated = doc.slice(0, from + START.length) + '\n' + table + '\n' + doc.slice(to);
if (process.argv.includes('--check')) {
  if (updated !== doc) {
    console.error('TRAIL_FORMAT.md: the table of what the bike can do is out of date. Run `npm run limits` and commit the result.');
    process.exit(1);
  }
  console.log('TRAIL_FORMAT.md: the bike\'s limits are up to date');
} else {
  writeFileSync(DOC, updated);
  console.log(table);
}
