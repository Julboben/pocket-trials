// @ts-check
// Woodland critters. Like every prop they sit on the 2-unit art grid, have no
// outlines, and are lit from the right: shaded on the left and underneath.
// A squirrel sits on the ground until the rider comes close, then runs along
// the ground to the nearest tree it can reach, up the trunk and into the crown,
// where it hides (see drawing.js for how it finds its tree and path). With no
// tree in reach it dashes off and is gone. Everything here is decoration and
// never touches the simulation.

// How far a squirrel looks for a tree, and how far it traces the ground either
// side, in world units; the ground is traced every SQUIRREL_STEP units.
export const SQUIRREL_RANGE = 240;
export const SQUIRREL_STEP = 4;
// The biggest step up or down it takes in one stride.
export const SQUIRREL_STEP_UP = 16;
// How long it freezes before it bolts, and how fast it runs and climbs.
const SQUIRREL_FREEZE = 0.12;
const SQUIRREL_RUN = 160;
const SQUIRREL_CLIMB = 110;
// How far past the leaves it climbs, so it is fully hidden.
export const SQUIRREL_LENGTH = 24;
// With no tree it dashes off and fades out over this long, in seconds.
export const SQUIRREL_FLEE = 0.9;
// The longest a startled squirrel can take to hide: the furthest run and the
// tallest climb, with time to spare.
export const SQUIRREL_HIDE_MAX = 5;

const RED = {
  dark: "#8a4a2c",
  body: "#b8643a",
  light: "#d98b52",
  tail: "#c9733f",
  belly: "#f4e9d1",
  eye: "#3a403d",
  nut: "#806244",
};

/** The ground offset `distance` along a traced path (see SQUIRREL_STEP). */
function pathY(path, distance) {
  if (!path?.length) return 0;
  const at = Math.max(0, distance) / SQUIRREL_STEP;
  const i = Math.min(path.length - 1, Math.floor(at));
  const next = path[Math.min(path.length - 1, i + 1)];
  return path[i] + (next - path[i]) * (at - i);
}

/**
 * Where a squirrel startled `age` seconds ago is, from its anchor. `fit` holds
 * the ground traced `left` and `right` of it and the `tree` it hides in, if
 * any: its trunk `dx` and the `leaves` offset where the crown hides it. With no
 * tree it flees in `dir`, away from the rider. Returns its offset, which way it
 * faces, whether it is `climbing`, how opaque it is, and whether it has
 * `hidden` in the crown (or vanished).
 */
export function squirrelDash(fit, dir, age) {
  const t = Math.max(0, age - SQUIRREL_FREEZE);
  const tree = fit?.tree;
  if (!tree) {
    const path = dir < 0 ? fit?.left : fit?.right;
    const room = Math.max(0, ((path?.length ?? 1) - 1) * SQUIRREL_STEP);
    const run = Math.min(room, SQUIRREL_RUN * t);
    return {
      dx: dir * run,
      dy: pathY(path, run),
      dir,
      climbing: false,
      alpha: Math.max(0, 1 - age / SQUIRREL_FLEE),
      hidden: age >= SQUIRREL_FLEE,
    };
  }
  const side = tree.dx < 0 ? -1 : 1;
  const path = side < 0 ? fit.left : fit.right;
  const distance = Math.abs(tree.dx);
  const run = SQUIRREL_RUN * t;
  if (run < distance) {
    return { dx: side * run, dy: pathY(path, run), dir: side, climbing: false, alpha: 1, hidden: false };
  }
  const foot = pathY(path, distance);
  const top = Math.min(foot, tree.leaves - SQUIRREL_LENGTH);
  const climb = SQUIRREL_CLIMB * (t - distance / SQUIRREL_RUN);
  const dy = Math.max(top, foot - climb);
  return { dx: tree.dx, dy, dir: side, climbing: true, alpha: 1, hidden: dy <= top };
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

/**
 * A red squirrel sitting up with its feet at y = 0, facing right, its tail
 * curled up its back. Nibbling, it holds a nut to its mouth.
 */
export function drawSquirrelSitting({ pixelRect }, nibble = false) {
  const c = RED;
  // Bushy tail, curling up behind it.
  pixelRect(-14, -20, 2, 12, c.dark, 2);
  pixelRect(-12, -24, 6, 20, c.tail, 2);
  pixelRect(-10, -28, 6, 4, c.tail, 2);
  pixelRect(-6, -26, 2, 2, c.light, 2);
  pixelRect(-8, -24, 2, 2, c.light, 2);
  pixelRect(-6, -8, 2, 4, c.tail, 2);
  // Body, shaded on the left, pale belly.
  pixelRect(-4, -16, 10, 14, c.body, 2);
  pixelRect(-4, -16, 2, 14, c.dark, 2);
  pixelRect(2, -12, 4, 10, c.belly, 2);
  // Haunch and feet.
  pixelRect(-4, -6, 6, 4, c.dark, 2);
  pixelRect(-2, -2, 10, 2, c.dark, 2);
  // Head, dipped to the nut when nibbling.
  const hy = nibble ? -22 : -24;
  pixelRect(0, hy, 8, 8, c.body, 2);
  pixelRect(6, hy + 4, 4, 4, c.body, 2);
  pixelRect(4, hy, 4, 2, c.light, 2);
  pixelRect(0, hy - 4, 2, 4, c.dark, 2);
  pixelRect(4, hy + 2, 2, 2, c.eye, 2);
  pixelRect(10, hy + 4, 2, 2, c.dark, 2);
  if (nibble) {
    pixelRect(6, hy + 8, 4, 2, c.body, 2);
    pixelRect(10, hy + 8, 2, 2, c.nut, 2);
  } else {
    pixelRect(6, -12, 2, 4, c.body, 2);
  }
}

/**
 * A running squirrel with its feet at y = 0, facing right; `stretch` picks the
 * bounding frame: stretched out, or bunched up with its tail high.
 */
export function drawSquirrelRunning({ pixelRect }, stretch) {
  const c = RED;
  if (stretch) {
    // Tail streaming out behind.
    pixelRect(-24, -16, 6, 4, c.tail, 2);
    pixelRect(-24, -16, 2, 2, c.light, 2);
    pixelRect(-20, -12, 8, 4, c.tail, 2);
    pixelRect(-20, -8, 4, 2, c.dark, 2);
    // Body, legs reaching fore and aft.
    pixelRect(-12, -10, 16, 6, c.body, 2);
    pixelRect(-12, -10, 16, 2, c.light, 2);
    pixelRect(-6, -4, 8, 2, c.belly, 2);
    pixelRect(-14, -4, 4, 2, c.dark, 2);
    pixelRect(-16, -2, 4, 2, c.dark, 2);
    pixelRect(4, -4, 4, 2, c.dark, 2);
    pixelRect(6, -2, 4, 2, c.dark, 2);
    // Head.
    pixelRect(2, -14, 8, 6, c.body, 2);
    pixelRect(8, -12, 4, 4, c.body, 2);
    pixelRect(2, -16, 2, 2, c.dark, 2);
    pixelRect(6, -12, 2, 2, c.eye, 2);
    pixelRect(12, -12, 2, 2, c.dark, 2);
    return;
  }
  // Tail arched high over its back.
  pixelRect(-16, -22, 2, 10, c.dark, 2);
  pixelRect(-14, -24, 6, 14, c.tail, 2);
  pixelRect(-10, -26, 4, 2, c.light, 2);
  pixelRect(-10, -10, 4, 4, c.tail, 2);
  // Body, hunched, with its feet gathered under it.
  pixelRect(-8, -12, 12, 8, c.body, 2);
  pixelRect(-6, -14, 8, 2, c.light, 2);
  pixelRect(-8, -12, 2, 8, c.dark, 2);
  pixelRect(-2, -6, 6, 2, c.belly, 2);
  pixelRect(-6, -4, 4, 4, c.dark, 2);
  pixelRect(0, -4, 4, 4, c.dark, 2);
  // Head, low.
  pixelRect(2, -14, 8, 6, c.body, 2);
  pixelRect(8, -12, 4, 4, c.body, 2);
  pixelRect(2, -16, 2, 2, c.dark, 2);
  pixelRect(6, -12, 2, 2, c.eye, 2);
  pixelRect(12, -12, 2, 2, c.dark, 2);
}
