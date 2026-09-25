// @ts-check
import { STEP, GRAVITY } from './config.js';
import { collideFreePoint } from './vehicle-physics.js';
import { atan2, cos, hypot, sin } from './det-math.js';

const RAGDOLL_CONTACT = { bounce: .12, friction: .16 };
const SOLVER_ITERATIONS = 6;
// Knees and elbows fold at most this far: the distance between the outer
// joints never drops below this share of the two limb lengths combined.
const MIN_FOLD = .38;

const POSE = {
  head: [3, -43], shoulder: [1, -35], hip: [-8, -24],
  elbow: [11, -30], hand: [19, -25], knee: [4, -14], foot: [-2, -3]
};
const LINKS = [['head', 'shoulder'], ['shoulder', 'hip'], ['shoulder', 'elbow'], ['elbow', 'hand'], ['hip', 'knee'], ['knee', 'foot']];
const HINGES = [['shoulder', 'elbow', 'hand'], ['hip', 'knee', 'foot']];

const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/**
 * Throws the rider off the bike. `random` must return values in [0, 1) so the
 * same seed always produces the same crash.
 * @param {{ x: number, y: number, ox: number, oy: number }} rear
 * @param {{ x: number, y: number, ox: number, oy: number }} front
 * @param {number} facing
 * @param {() => number} random
 */
export function createRagdoll(rear, front, facing, random) {
  const mx = (rear.x + front.x) / 2, my = (rear.y + front.y) / 2;
  const angle = atan2(front.y - rear.y, front.x - rear.x), c = cos(angle), s = sin(angle);
  const vx = ((rear.x - rear.ox) + (front.x - front.ox)) / 2;
  const vy = ((rear.y - rear.oy) + (front.y - front.oy)) / 2;
  const points = {};
  for (const [name, [lx, ly]] of Object.entries(POSE)) {
    const x = mx + c * lx * facing - s * ly, y = my + s * lx * facing + c * ly;
    const pvx = vx + (random() - .5) * .35, pvy = vy - 1.1 + (random() - .5) * .25;
    points[name] = { x, y, ox: x - pvx, oy: y - pvy, radius: name === 'head' ? 6 : 3 };
  }
  const links = LINKS.map(([a, b]) => ({ a, b, length: hypot(points[b].x - points[a].x, points[b].y - points[a].y) }));
  const hinges = HINGES.map(([a, joint, b]) => {
    const upper = hypot(points[joint].x - points[a].x, points[joint].y - points[a].y);
    const lower = hypot(points[b].x - points[joint].x, points[b].y - points[joint].y);
    return { a, joint, b, side: Math.sign(cross(points[a], points[joint], points[b])) || 1, minSpan: (upper + lower) * MIN_FOLD };
  });
  return { points, links, hinges, list: Object.values(points) };
}

// A knee or elbow that bends backwards is mirrored across the line through
// its neighbours; a limb folded too tightly is pushed back open.
function enforceHinge(points, hinge) {
  const a = points[hinge.a], joint = points[hinge.joint], b = points[hinge.b];
  if (cross(a, joint, b) * hinge.side < 0) {
    const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy || .001;
    const t = ((joint.x - a.x) * dx + (joint.y - a.y) * dy) / lengthSq;
    const footX = a.x + dx * t, footY = a.y + dy * t;
    const mirroredX = 2 * footX - joint.x, mirroredY = 2 * footY - joint.y;
    joint.ox += mirroredX - joint.x; joint.oy += mirroredY - joint.y;
    joint.x = mirroredX; joint.y = mirroredY;
  }
  const dx = b.x - a.x, dy = b.y - a.y, span = hypot(dx, dy) || .001;
  if (span < hinge.minSpan) {
    const push = (hinge.minSpan - span) / span * .5;
    a.x -= dx * push; a.y -= dy * push;
    b.x += dx * push; b.y += dy * push;
  }
}

export function stepRagdoll(ragdoll, level) {
  for (const p of ragdoll.list) {
    const vx = (p.x - p.ox) * .996, vy = (p.y - p.oy) * .996;
    p.ox = p.x; p.oy = p.y; p.x += vx; p.y += vy + GRAVITY * STEP * STEP;
  }
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
    for (const link of ragdoll.links) {
      const a = ragdoll.points[link.a], b = ragdoll.points[link.b];
      const dx = b.x - a.x, dy = b.y - a.y, d = hypot(dx, dy) || .001;
      const correction = (d - link.length) / d * .5;
      a.x += dx * correction; a.y += dy * correction; b.x -= dx * correction; b.y -= dy * correction;
    }
    for (const hinge of ragdoll.hinges) enforceHinge(ragdoll.points, hinge);
    for (const p of ragdoll.list) collideFreePoint(level, p, iteration === 0, RAGDOLL_CONTACT);
  }
}

export function ragdollCenter(ragdoll) {
  let x = 0, y = 0;
  for (const p of ragdoll.list) { x += p.x; y += p.y; }
  return { x: x / ragdoll.list.length, y: y / ragdoll.list.length };
}
