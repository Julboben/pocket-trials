// @ts-check
import { STEP, GRAVITY } from "./config.js";
import { collideFreePoint } from "./vehicle-physics.js";
import { atan2, cos, hypot, sin } from "./det-math.js";
import { RAGDOLL_WATER, RAGDOLL_WATER_RADIUS, applyWater } from "./water.js";

const RAGDOLL_CONTACT = { bounce: 0.12, friction: 0.16 };
const SOLVER_ITERATIONS = 6;
// Knees and elbows fold at most this far: the distance between the outer
// joints never drops below this share of the two limb lengths combined.
const MIN_FOLD = 0.38;

const POSE = {
  head: [3, -43],
  shoulder: [1, -35],
  hip: [-8, -24],
  elbow: [11, -30],
  hand: [19, -25],
  knee: [4, -14],
  foot: [-2, -3],
};
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
 * Throws the rider off the bike. `random` must return values in [0, 1) so the
 * same seed always produces the same crash.
 * @param {{ x: number, y: number, ox: number, oy: number }} rear
 * @param {{ x: number, y: number, ox: number, oy: number }} front
 * @param {number} facing
 * @param {() => number} random
 */
/**
 * Throws the rider off the bike.
 *
 * Pass the current drawBike visual state as the fifth argument.
 * Capture it BEFORE resetting lean, suspension, facing or crash state.
 *
 * `random` must return values in [0, 1) for deterministic crashes.
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

  const points = {};

  for (const [name, [lx, ly]] of Object.entries(pose)) {
    // First apply the rider's suspension transform.
    const bodyX = lx * pc - ly * ps;
    const bodyY = lx * ps + ly * pc + bodyDrop;

    // Then apply the same mirror and rotation as the bike sprite.
    const localX = bodyX * flipVisual;
    const x = mx + c * localX - s * bodyY;
    const y = my + s * localX + c * bodyY;

    const pvx = vx + (random() - 0.5) * 0.35;
    const pvy = vy - 1.1 + (random() - 0.5) * 0.25;

    points[name] = {
      x,
      y,
      ox: x - pvx,
      oy: y - pvy,
      radius: name === "head" ? 6 : 3,
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

  return {
    points,
    links,
    hinges,
    list: Object.values(points),
  };
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
    joint.ox += mirroredX - joint.x;
    joint.oy += mirroredY - joint.y;
    joint.x = mirroredX;
    joint.y = mirroredY;
  }
  const dx = b.x - a.x,
    dy = b.y - a.y,
    span = hypot(dx, dy) || 0.001;
  if (span < hinge.minSpan) {
    const push = ((hinge.minSpan - span) / span) * 0.5;
    a.x -= dx * push;
    a.y -= dy * push;
    b.x += dx * push;
    b.y += dy * push;
  }
}

/**
 * @param {any} ragdoll
 * @param {any} trail
 * @param {import('./types.js').Water[]} [water] normalized water bodies, which buoy the rider up
 */
export function stepRagdoll(ragdoll, trail, water = []) {
  if (water.length)
    for (const p of ragdoll.list)
      applyWater(p, Math.max(p.radius, RAGDOLL_WATER_RADIUS), water, RAGDOLL_WATER);
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
      const correction = ((d - link.length) / d) * 0.5;
      a.x += dx * correction;
      a.y += dy * correction;
      b.x -= dx * correction;
      b.y -= dy * correction;
    }
    for (const hinge of ragdoll.hinges) enforceHinge(ragdoll.points, hinge);
    for (const p of ragdoll.list)
      collideFreePoint(trail, p, iteration === 0, RAGDOLL_CONTACT);
  }
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
