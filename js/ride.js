// @ts-check
// The whole ride as a DOM-free simulation: bike, rider probes, spikes, apples,
// goal, falls and the ragdoll. The browser maps input into `stepRide` and
// reacts to the events it returns; Node tests and the replay bot drive it the
// same way.
import {
  STEP, RADIUS, WHEELBASE, TAU, SUSPENSION_REST_LENGTH,
  XPBD_THROTTLE_INPUT_RESPONSE, XPBD_LEAN_INPUT_RESPONSE,
  clamp, lerp
} from './config.js';
import { createVehicle, stepVehicle } from './vehicle-physics.js';
import { terrainAt, terrainCollisionsAt, terrainSweepCollision } from './terrain.js';
import { normalizeSpike } from './level-schema.js';
import { createRagdoll, stepRagdoll } from './ragdoll.js';
import { atan2, cos, exp, hypot, sin } from './det-math.js';

/** @typedef {import('./types.js').Level} Level */
/** @typedef {import('./types.js').RideInput} RideInput */
/** @typedef {import('./types.js').RideEvent} RideEvent */
/** @typedef {import('./types.js').Ride} Ride */

/**
 * Bump whenever a change makes old inputs replay differently, so stored
 * ghosts and replay fixtures from older physics are not trusted.
 */
export const RIDE_VERSION = 1;

/** @type {Array<[string, number, number, number]>} name, local x, local y, radius */
const RIDER_PROBES = [['head', 3, -43, 6], ['shoulder', 1, -34, 5], ['hip', -7, -23, 5]];
// Grace period after spawning before rider probes can crash the bike.
const SPAWN_GRACE = .2;
const GOAL_REACH = 20;

/** Small deterministic PRNG (mulberry32) so crashes replay identically. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWheel(level, x, startY) {
  const y = startY ?? terrainAt(level, x).y - RADIUS;
  return { x, y, ox: x, oy: y, inverseMass: 1, grounded: true, contact: null, material: level.terrain || 'grass', spin: 0, angularVelocity: 0, compression: 0, impactSpeed: 0 };
}

/**
 * @param {Level} level
 * @param {{ seed?: number }} [options]
 * @returns {Ride}
 */
export function createRide(level, { seed = 1 } = {}) {
  const { x: startX, y: startY, facing } = level.start;
  const rear = makeWheel(level, startX - WHEELBASE / 2, startY);
  const front = makeWheel(level, startX + WHEELBASE / 2, startY);
  /** @type {Ride} */
  const ride = {
    level, rear, front,
    vehicle: createVehicle(rear, front),
    apples: level.apples.map(apple => ({
      x: apple.x,
      y: Number.isFinite(apple.y) ? apple.y : terrainAt(level, apple.x).y - 60,
      taken: false
    })),
    spikes: (level.spikes || []).map(spike => normalizeSpike(spike, level.points)),
    seed,
    random: seededRandom(seed),
    status: 'running',
    started: false,
    time: 0, elapsed: 0, spikeTime: 0, collected: 0, steps: 0,
    facing, throttle: 0, brakePressure: 0, leanControl: 0, leanVisual: 0,
    ragdoll: null, crashCause: null,
    airRotation: 0, airTurnMilestone: 0, previousAirAngle: 0,
    lastGateNotice: -10,
    previousRiderContacts: null,
    splits: []
  };
  ride.previousRiderContacts = riderCollisionPoints(ride);
  return ride;
}

/**
 * Rider collision probes, anchored to the chassis: the base sits where the
 * axles would be at rest below the suspension mounts, so the rider follows
 * chassis pitch and suspension travel instead of the wheel line.
 * @param {Ride} ride
 */
export function riderCollisionPoints(ride) {
  const { rearMount, frontMount } = ride.vehicle.chassis;
  let ax = frontMount.x - rearMount.x, ay = frontMount.y - rearMount.y;
  const length = hypot(ax, ay) || 1;
  ax /= length; ay /= length;
  const downX = -ay, downY = ax;
  const baseX = (rearMount.x + frontMount.x) / 2 + downX * SUSPENSION_REST_LENGTH;
  const baseY = (rearMount.y + frontMount.y) / 2 + downY * SUSPENSION_REST_LENGTH;
  const shift = ride.leanVisual * 9, facing = ride.facing;
  /** @type {Record<string, { x: number, y: number, radius: number }>} */
  const probes = {};
  for (const [name, lx, ly, radius] of RIDER_PROBES) {
    const along = (lx + shift) * facing;
    probes[name] = { x: baseX + ax * along + downX * ly, y: baseY + ay * along + downY * ly, radius };
  }
  return probes;
}

// Only the solid core and inner part of each spike are lethal, so grazing a tip is forgiven.
function touchedSpike(spikes, points) {
  for (const spike of spikes) {
    for (const point of points) {
      const dx = point.x - spike.x, dy = point.y - spike.y, distance = hypot(dx, dy) || 1;
      if (distance < spike.radius * .8 + point.radius) {
        return { x: spike.x + dx / distance * spike.radius * .8, y: spike.y + dy / distance * spike.radius * .8 };
      }
    }
  }
  return null;
}

function crash(ride, cause, x, y, events) {
  ride.status = 'crashed';
  ride.crashCause = cause;
  ride.ragdoll = createRagdoll(ride.rear, ride.front, ride.facing, ride.random);
  events.push({ type: 'crash', cause, x, y });
}

function bikeMidpoint(ride) {
  return { x: (ride.rear.x + ride.front.x) / 2, y: (ride.rear.y + ride.front.y) / 2 };
}

export function bikeSpeed(ride) {
  const { rear, front } = ride;
  return ((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP);
}

function trackAirRotation(ride, wasAirborne, events) {
  const { rear, front } = ride;
  const airborne = !rear.grounded && !front.grounded;
  const bikeAngle = atan2(front.y - rear.y, front.x - rear.x);
  if (airborne) {
    if (!wasAirborne) {
      ride.airRotation = 0;
      ride.airTurnMilestone = 0;
    } else {
      ride.airRotation += atan2(sin(bikeAngle - ride.previousAirAngle), cos(bikeAngle - ride.previousAirAngle));
      const milestone = Math.floor(Math.abs(ride.airRotation) / Math.PI);
      if (milestone > ride.airTurnMilestone) {
        ride.airTurnMilestone = milestone;
        events.push({ type: 'airTurn', full: milestone % 2 === 0 });
      }
    }
  } else {
    // A flip counts on landing, allowing a little under-rotation.
    const flips = Math.floor(Math.abs(ride.airRotation) / TAU + .15);
    if (wasAirborne && flips > 0 && ride.status === 'running') events.push({ type: 'flip', count: flips, direction: Math.sign(ride.airRotation) });
    ride.airRotation = 0;
    ride.airTurnMilestone = 0;
  }
  ride.previousAirAngle = bikeAngle;
}

/**
 * Advances the ride by one fixed step.
 * @param {Ride} ride
 * @param {RideInput} [input]
 * @param {object} [hooks] physics-debug hooks passed to `stepVehicle`
 * @returns {RideEvent[]}
 */
export function stepRide(ride, input = {}, hooks = {}) {
  /** @type {RideEvent[]} */
  const events = [];
  if (ride.status === 'won') return events;
  const { level, rear, front } = ride;
  const running = ride.status === 'running';
  if (Number(input.facing)) ride.facing = input.facing < 0 ? -1 : 1;
  const leanInput = running ? clamp(Number(input.leanInput) || 0, -1, 1) : 0;
  const accelerating = running && Boolean(input.accelerating);
  const braking = running && Boolean(input.braking);
  if (running && !ride.started && (accelerating || braking || leanInput)) {
    ride.started = true;
    events.push({ type: 'start' });
  }
  for (const point of ride.vehicle.bikePoints) { point.px = point.x; point.py = point.y; }
  if (ride.ragdoll) for (const point of ride.ragdoll.list) { point.px = point.x; point.py = point.y; }
  ride.steps++;
  ride.time += STEP;
  ride.spikeTime += STEP;
  if (running && ride.started) ride.elapsed += STEP;

  ride.leanControl = lerp(ride.leanControl, leanInput, 1 - exp(-XPBD_LEAN_INPUT_RESPONSE * STEP));
  const coasting = !accelerating && !braking;
  const throttleTarget = accelerating && !braking ? 1 : 0;
  const throttleRate = throttleTarget > ride.throttle ? XPBD_THROTTLE_INPUT_RESPONSE : 4;
  ride.throttle = lerp(ride.throttle, throttleTarget, 1 - exp(-throttleRate * STEP));
  ride.brakePressure = lerp(ride.brakePressure, braking ? 1 : 0, 1 - exp(-(braking ? 10 : 14) * STEP));

  const wasRearGrounded = rear.grounded, wasFrontGrounded = front.grounded;
  rear.impactSpeed = 0; front.impactSpeed = 0;
  stepVehicle(ride.vehicle, level, {
    facing: ride.facing, throttle: ride.throttle, brakePressure: ride.brakePressure, leanControl: ride.leanControl,
    accelerating, braking, coasting, crashed: !running
  }, hooks);
  trackAirRotation(ride, !wasRearGrounded && !wasFrontGrounded, events);

  const landingImpact = Math.max(
    !wasRearGrounded && rear.grounded ? rear.impactSpeed : 0,
    !wasFrontGrounded && front.grounded ? front.impactSpeed : 0
  );
  if (landingImpact > 0) events.push({ type: 'land', impact: landingImpact });

  if (!running) {
    stepRagdoll(ride.ragdoll, level);
    return events;
  }

  const riderContacts = riderCollisionPoints(ride);
  const { head } = riderContacts;
  const { x: mx, y: my } = bikeMidpoint(ride);
  let riderObstacle = false;
  for (const name in riderContacts) {
    const point = riderContacts[name], previous = ride.previousRiderContacts?.[name];
    if ((previous && terrainSweepCollision(level, previous.x, previous.y, point.x, point.y, point.radius))
      || terrainCollisionsAt(level, point.x, point.y, point.radius)[0]) { riderObstacle = true; break; }
  }
  ride.previousRiderContacts = riderContacts;
  const spikeHit = touchedSpike(ride.spikes, [
    { x: rear.x, y: rear.y, radius: RADIUS },
    { x: front.x, y: front.y, radius: RADIUS },
    riderContacts.head, riderContacts.shoulder, riderContacts.hip
  ]);
  if (spikeHit) {
    crash(ride, 'spike', spikeHit.x, spikeHit.y, events);
    return events;
  }
  if (riderObstacle && ride.time > SPAWN_GRACE) {
    crash(ride, 'head', head.x, head.y, events);
    return events;
  }
  if (my > (level.fallY || 620)) {
    crash(ride, 'fall', head.x, head.y, events);
    return events;
  }

  for (const apple of ride.apples) {
    if (!apple.taken && (
      hypot(head.x - apple.x, head.y - apple.y) < 25 ||
      hypot(mx - apple.x, my - 18 - apple.y) < 34
    )) {
      apple.taken = true;
      ride.collected++;
      ride.splits.push(ride.elapsed);
      events.push({ type: 'apple', apple, collected: ride.collected, total: ride.apples.length, split: ride.elapsed });
    }
  }

  if (mx > level.goal - GOAL_REACH) {
    if (ride.collected === ride.apples.length) {
      ride.status = 'won';
      events.push({ type: 'win', time: ride.elapsed, x: mx, y: my });
    } else if (ride.time - ride.lastGateNotice > 5) {
      ride.lastGateNotice = ride.time;
      events.push({ type: 'goalLocked', missing: ride.apples.length - ride.collected });
    }
  }

  // Input is in screen direction; the rider pose leans relative to facing.
  ride.leanVisual = lerp(ride.leanVisual, leanInput * ride.facing, 1 - exp(-7 * STEP));
  return events;
}

/** All simulated points. */
export function ridePoints(ride) {
  const points = ride.vehicle.bikePoints.slice();
  if (ride.ragdoll) points.push(...ride.ragdoll.list);
  return points;
}

/**
 * Moves every point `alpha` of the way from its position before the latest
 * step to its current one, for drawing between fixed steps. Call the
 * returned function to put the simulation state back.
 * @param {Ride} ride
 * @param {number} alpha 0 … 1
 */
export function interpolateRide(ride, alpha) {
  const points = ridePoints(ride);
  const saved = new Float64Array(points.length * 2);
  points.forEach((point, index) => {
    saved[index * 2] = point.x; saved[index * 2 + 1] = point.y;
    if (alpha < 1 && point.px !== undefined) {
      point.x = point.px + (point.x - point.px) * alpha;
      point.y = point.py + (point.y - point.py) * alpha;
    }
  });
  return () => points.forEach((point, index) => { point.x = saved[index * 2]; point.y = saved[index * 2 + 1]; });
}

/**
 * Runs recorded inputs to completion and reports the outcome.
 * @param {Level} level
 * @param {RideInput[]} inputs
 */
export function simulateRun(level, inputs, { seed = 1, settleSteps = 0 } = {}) {
  const ride = createRide(level, { seed });
  const events = [];
  let maxSpeed = 0, finite = true;
  for (const input of inputs) {
    for (const event of stepRide(ride, input)) events.push({ ...event, step: ride.steps });
    maxSpeed = Math.max(maxSpeed, Math.abs(bikeSpeed(ride)));
    if (!Number.isFinite(ride.rear.x + ride.rear.y + ride.front.x + ride.front.y)) { finite = false; break; }
    if (ride.status !== 'running') break;
  }
  for (let step = 0; step < settleSteps && ride.status === 'crashed'; step++) stepRide(ride, {});
  return { ride, events, maxSpeed, finite };
}
