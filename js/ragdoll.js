// @ts-check
import { STEP, GRAVITY } from "./config.js";
import { collideFreePoint, collideWithBike } from "./vehicle-physics.js";
import { atan2, cos, hypot, sin } from "./det-math.js";
import { RAGDOLL_WATER, RAGDOLL_WATER_RADIUS, applyWater } from "./water.js";

// `grip` lets a resting body hold on slopes up to about 35 degrees.
const RAGDOLL_CONTACT = { bounce: 0.12, friction: 0.16, grip: 0.7 };
const SOLVER_ITERATIONS = 6;
// Share of the relative swing between linked joints lost each step, so limbs
// stop flailing once the body has landed.
const LINK_DAMPING = 0.025;
// The body sleeps once every joint has moved less than this (px per step)
// for SLEEP_STEPS steps, and wakes when the bike runs into it.
const SLEEP_SPEED = 0.02;
const SLEEP_STEPS = 60;
// Rough share of the rider's weight at each joint; the torso carries most.
const MASS = {
  head: 0.55,
  shoulder: 1.6,
  hip: 1.8,
  elbow: 0.4,
  hand: 0.3,
  knee: 0.9,
  foot: 0.5,
};
const DEGREE = Math.PI / 180;
const TURN = Math.PI * 2;
// Most a joint limit swings the body back in one solver pass, in radians.
const MAX_LIMIT_STEP = 0.08;
// How far the head tips against the spine, and the thigh swings against the
// torso, in degrees: [a, joint, b, least, most]. Angles are measured facing
// right, negative tipping forwards; seated, the hip sits at -90.
/** @type {Array<[string, string, string, number, number]>} */
const ANGLE_LIMITS = [
  ["hip", "shoulder", "head", -70, 30],
  ["shoulder", "hip", "knee", -150, 25],
];
// Knees and elbows fold at most this far: the distance between the outer
// joints never drops below this share of the two limb lengths combined.
const MIN_FOLD = 0.38;

const LINKS = [
  ["head", "shoulder"],
  ["shoulder", "hip"],
  ["shoulder", "elbow"],
  ["elbow", "hand"],
  ["hip", "knee"],
  ["knee", "foot"],
];
const HINGES = [
  ["shoulder", "elbow", "hand"],
  ["hip", "knee", "foot"],
];

const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/**
 * Throws the rider off the bike.
 *
 * Pass the current drawBike visual state as the fifth argument.
 * Capture it BEFORE resetting lean, suspension, facing or crash state.
 *
 * `random` must return values in [0, 1) for deterministic crashes. Each joint
 * keeps the bike's velocity at its position, spin included, so a rider thrown
 * mid-flip is flung outwards rather than dropped.
 *
 * @param {{ x: number, y: number, ox: number, oy: number, compression?: number }} rear
 * @param {{ x: number, y: number, ox: number, oy: number, compression?: number }} front
 * @param {number} facing
 * @param {() => number} random
 * @param {{
 *   mx?: number,
 *   my?: number,
 *   angle?: number,
 *   flipVisual?: number,
 *   leanVisual?: number
 * }} [visual]
 */
export function createRagdoll(rear, front, facing, random, visual = {}) {
  const mx = visual.mx ?? (rear.x + front.x) / 2;
  const my = visual.my ?? (rear.y + front.y) / 2;

  const angle = visual.angle ?? atan2(front.y - rear.y, front.x - rear.x);

  // Match drawBike's visible rotation, rather than the unsnapped angle.
  const angleStep = (Math.PI * 2) / 32;
  const pixelAngle = Math.round(angle / angleStep) * angleStep;
  const c = cos(pixelAngle);
  const s = sin(pixelAngle);

  // This must match the value passed to drawBike().
  const flipVisual = visual.flipVisual ?? facing;
  const shift = Math.round((visual.leanVisual ?? 0) * 4.5) * 2;

  // Same suspension calculations as drawBike().
  const backCompression =
    facing > 0 ? rear.compression || 0 : front.compression || 0;
  const frontCompression =
    facing > 0 ? front.compression || 0 : rear.compression || 0;

  const bodyDrop =
    Math.round(((backCompression + frontCompression) * 0.4) / 2) * 2;
  const bodyPitch = (frontCompression - backCompression) * 0.0096;
  const pc = cos(bodyPitch);
  const ps = sin(bodyPitch);

  // Joint anchors from the first redesigned rider.
  // The head anchor is the helmet's center, not the neck.
  const pose = {
    head: [3 + shift, -46],
    shoulder: [2 + shift, -36],
    hip: [-8 + shift, -24],
    elbow: [11 + shift * 0.45, -30],
    hand: [20, -25],
    knee: [4 + shift * 0.45, -14],
    foot: [-2, -3],
  };

  const vx = (rear.x - rear.ox + (front.x - front.ox)) / 2;
  const vy = (rear.y - rear.oy + (front.y - front.oy)) / 2;
  const centerX = (rear.x + front.x) / 2,
    centerY = (rear.y + front.y) / 2;
  const axisX = front.x - rear.x,
    axisY = front.y - rear.y;
  const spin =
    (axisX * (front.y - front.oy - (rear.y - rear.oy)) -
      axisY * (front.x - front.ox - (rear.x - rear.ox))) /
    (axisX * axisX + axisY * axisY || 1);

  const points = {};

  for (const [name, [lx, ly]] of Object.entries(pose)) {
    // First apply the rider's suspension transform.
    const bodyX = lx * pc - ly * ps;
    const bodyY = lx * ps + ly * pc + bodyDrop;

    // Then apply the same mirror and rotation as the bike sprite.
    const localX = bodyX * flipVisual;
    const x = mx + c * localX - s * bodyY;
    const y = my + s * localX + c * bodyY;

    const pvx = vx - spin * (y - centerY) + (random() - 0.5) * 0.35;
    const pvy = vy + spin * (x - centerX) - 1.1 + (random() - 0.5) * 0.25;

    points[name] = {
      x,
      y,
      ox: x - pvx,
      oy: y - pvy,
      radius: name === "head" ? 6 : 3,
      inverseMass: 1 / MASS[name],
    };
  }

  // Visual metadata only; it does not affect the constraint solver.
  points.head.drawFacing = flipVisual < 0 ? -1 : 1;

  const links = LINKS.map(([a, b]) => ({
    a,
    b,
    length: hypot(points[b].x - points[a].x, points[b].y - points[a].y),
  }));

  const hinges = HINGES.map(([a, joint, b]) => {
    const upper = hypot(
      points[joint].x - points[a].x,
      points[joint].y - points[a].y,
    );
    const lower = hypot(
      points[b].x - points[joint].x,
      points[b].y - points[joint].y,
    );

    return {
      a,
      joint,
      b,
      side: Math.sign(cross(points[a], points[joint], points[b])) || 1,
      minSpan: (upper + lower) * MIN_FOLD,
    };
  });

  const angleLimits = ANGLE_LIMITS.map(([a, joint, b, least, most]) => ({
    a,
    joint,
    b,
    mirror: flipVisual < 0 ? -1 : 1,
    least: least * DEGREE,
    most: most * DEGREE,
  }));

  return {
    points,
    links,
    hinges,
    angleLimits,
    list: Object.values(points),
    still: 0,
    asleep: false,
  };
}

const rotateAbout = (point, center, angle) => {
  const c = cos(angle),
    s = sin(angle);
  const dx = point.x - center.x,
    dy = point.y - center.y;
  point.x = center.x + dx * c - dy * s;
  point.y = center.y + dx * s + dy * c;
};

// Swings the outer joints back inside the allowed turn at the middle joint,
// the lighter end moving more. The turn wraps at half a circle, so a joint
// folded past it is sent back to the nearer limit, not the long way round, and
// each pass moves it a little so a tangled body unfolds over a few steps
// instead of being flung apart.
function enforceAngleLimit(points, limit) {
  const a = points[limit.a],
    joint = points[limit.joint],
    b = points[limit.b];
  const ux = joint.x - a.x,
    uy = joint.y - a.y,
    vx = b.x - joint.x,
    vy = b.y - joint.y;
  const turn = atan2(ux * vy - uy * vx, ux * vx + uy * vy) * limit.mirror;
  if (turn >= limit.least && turn <= limit.most) return;
  const pastMost = (turn - limit.most + TURN) % TURN,
    beforeLeast = (limit.least - turn + TURN) % TURN;
  const excess = pastMost <= beforeLeast ? pastMost : -beforeLeast;
  const correction =
    Math.max(-MAX_LIMIT_STEP, Math.min(MAX_LIMIT_STEP, excess)) * limit.mirror;
  const share = a.inverseMass / (a.inverseMass + b.inverseMass);
  rotateAbout(a, joint, correction * share);
  rotateAbout(b, joint, -correction * (1 - share));
}

// Bleeds off part of the relative velocity across each link, keeping the
// pair's shared momentum.
function dampLinks(ragdoll) {
  for (const link of ragdoll.links) {
    const a = ragdoll.points[link.a],
      b = ragdoll.points[link.b];
    const dvx = b.x - b.ox - (a.x - a.ox),
      dvy = b.y - b.oy - (a.y - a.oy);
    const total = a.inverseMass + b.inverseMass;
    const shareA = (LINK_DAMPING * a.inverseMass) / total,
      shareB = (LINK_DAMPING * b.inverseMass) / total;
    a.ox -= dvx * shareA;
    a.oy -= dvy * shareA;
    b.ox += dvx * shareB;
    b.oy += dvy * shareB;
  }
}

// A knee or elbow that bends backwards is mirrored across the line through
// its neighbours; a limb folded too tightly is pushed back open.
function enforceHinge(points, hinge) {
  const a = points[hinge.a],
    joint = points[hinge.joint],
    b = points[hinge.b];
  if (cross(a, joint, b) * hinge.side < 0) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      lengthSq = dx * dx + dy * dy || 0.001;
    const t = ((joint.x - a.x) * dx + (joint.y - a.y) * dy) / lengthSq;
    const footX = a.x + dx * t,
      footY = a.y + dy * t;
    const mirroredX = 2 * footX - joint.x,
      mirroredY = 2 * footY - joint.y;
    // Keep only the joint's speed along the limb; carrying its speed across
    // would drive it back through the line every step.
    const length = Math.sqrt(lengthSq);
    const alongX = dx / length,
      alongY = dy / length;
    const along = (joint.x - joint.ox) * alongX + (joint.y - joint.oy) * alongY;
    joint.x = mirroredX;
    joint.y = mirroredY;
    joint.ox = mirroredX - alongX * along;
    joint.oy = mirroredY - alongY * along;
  }
  const dx = b.x - a.x,
    dy = b.y - a.y,
    span = hypot(dx, dy) || 0.001;
  if (span < hinge.minSpan) {
    const push = (hinge.minSpan - span) / span / (a.inverseMass + b.inverseMass);
    a.x -= dx * push * a.inverseMass;
    a.y -= dy * push * a.inverseMass;
    b.x += dx * push * b.inverseMass;
    b.y += dy * push * b.inverseMass;
  }
}

// Joints that start inside the bike (feet on the pegs, seat) only collide with
// it once they have come clear, so the throw does not explode off the seat.
function collideRagdollWithBike(ragdoll, vehicle) {
  let touched = false;
  for (const p of ragdoll.list) {
    if (!p.clearOfBike) {
      p.clearOfBike = !collideWithBike(vehicle, p, p.inverseMass, false);
      continue;
    }
    if (collideWithBike(vehicle, p, p.inverseMass)) touched = true;
  }
  return touched;
}

/**
 * @param {any} ragdoll
 * @param {any} trail
 * @param {import('./types.js').Water[]} [water] normalized water bodies, which buoy the rider up
 * @param {import('./types.js').Vehicle} [vehicle] the crashed bike, which the rider bumps into
 */
export function stepRagdoll(ragdoll, trail, water = [], vehicle = null) {
  if (ragdoll.asleep) {
    if (!vehicle || !collideRagdollWithBike(ragdoll, vehicle)) {
      for (const p of ragdoll.list) {
        p.ox = p.x;
        p.oy = p.y;
      }
      return;
    }
    ragdoll.asleep = false;
    ragdoll.still = 0;
  }
  let floating = false;
  if (water.length)
    for (const p of ragdoll.list)
      if (
        applyWater(p, Math.max(p.radius, RAGDOLL_WATER_RADIUS), water, RAGDOLL_WATER)
      )
        floating = true;
  for (const p of ragdoll.list) {
    const vx = (p.x - p.ox) * 0.996,
      vy = (p.y - p.oy) * 0.996;
    p.ox = p.x;
    p.oy = p.y;
    p.x += vx;
    p.y += vy + GRAVITY * STEP * STEP;
  }
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
    for (const link of ragdoll.links) {
      const a = ragdoll.points[link.a],
        b = ragdoll.points[link.b];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = hypot(dx, dy) || 0.001;
      const correction =
        (d - link.length) / d / (a.inverseMass + b.inverseMass);
      a.x += dx * correction * a.inverseMass;
      a.y += dy * correction * a.inverseMass;
      b.x -= dx * correction * b.inverseMass;
      b.y -= dy * correction * b.inverseMass;
    }
    for (const hinge of ragdoll.hinges) enforceHinge(ragdoll.points, hinge);
    for (const limit of ragdoll.angleLimits)
      enforceAngleLimit(ragdoll.points, limit);
    if (vehicle) collideRagdollWithBike(ragdoll, vehicle);
    for (const p of ragdoll.list)
      collideFreePoint(trail, p, iteration === 0, RAGDOLL_CONTACT);
  }
  dampLinks(ragdoll);
  const moving = ragdoll.list.some(
    (p) =>
      Math.abs(p.x - p.ox) > SLEEP_SPEED || Math.abs(p.y - p.oy) > SLEEP_SPEED,
  );
  ragdoll.still = moving || floating ? 0 : ragdoll.still + 1;
  if (ragdoll.still >= SLEEP_STEPS) ragdoll.asleep = true;
}

export function ragdollCenter(ragdoll) {
  let x = 0,
    y = 0;
  for (const p of ragdoll.list) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ragdoll.list.length, y: y / ragdoll.list.length };
}
