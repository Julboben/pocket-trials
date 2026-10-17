// @ts-check
// Woodland critters. Like every prop they sit on the 2-unit art grid, have no
// outlines, and are lit from the right: shaded on the left and underneath.
// A squirrel sits on the ground until the rider comes close, then runs along
// the ground to the nearest tree it can reach, up the trunk and into the crown,
// where it hides (see drawing.js for how it finds its tree and path). With no
// tree in reach it dashes off and is gone. A tent glows from the lantern inside
// it after dark, a fireplace burns in its ring of stones, and a tuft of grass
// sways downwind and bends flat as the rider brushes through it. Everything
// here is decoration and never touches the simulation.

import { STEEL } from "./city-props.js";
import { fireTongues } from "./fire.js";

// Camping kit: a tent's fabric, its guy ropes, the boots by its door and the
// fireplace's logs and ash.
const WOOD = { dark: "#4d3f2f", base: "#66543f", light: "#856d4f", tip: "#aa8a60", cut: "#c39664" };
const RUBBER = { dark: "#3a403d", light: "#5b645e" };
const ROPE = { dark: "#b5bcae", base: "#f4e9d1", light: "#fffdf4" };
const FABRIC = { dark: "#c9573a", base: "#ed774e", light: "#ffc295" };
const BLADES = { dark: "#477158", base: "#58784d", light: "#618b66", tip: "#86a56a" };
const INK = "#182321";

const snap = (value) => Math.round(value / 2) * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));



// The big pine's bough tiers, lowest first; the snowy pine shares them.
export const PINE_TIERS = [
  { top: -112, bottom: -26, halfWidth: 46 },
  { top: -140, bottom: -66, halfWidth: 34 },
  { top: -164, bottom: -104, halfWidth: 24 },
  { top: -182, bottom: -138, halfWidth: 14 },
];

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

// ---------------------------------------------------------------------- tent

/** The tent's apex, and how far either side its guy ropes are pegged. */
export const TENT = { apex: -44, half: 34, peg: 48 };
/** The middle of the tent's doorway, where its lantern's light comes from. */
export const TENT_DOOR_CENTRE = [0, -12];
/** The warm light of the lantern inside the tent. */
export const TENT_LIGHT = { glow: "#ffe39a", core: "#fff3be", flame: "#f1b95d" };

// The door's half width at a row `y` (0 at the ground).
const doorHalf = (y) => snap(Math.max(0, (y + 30) * 0.45));

/**
 * A ridge tent seen end on, about 68 wide and 44 tall: orange fabric shaded
 * on the left, a seam down from the ridge pole, the door flaps tied back
 * round a dark doorway, and a pair of boots left outside. The guy ropes and
 * their pegs are drawn live (drawTentRopes); the doorway glows after dark
 * (drawTentDoorGlow).
 */
export function drawTent({ pixelRect }) {
  const { apex, half } = TENT;
  for (let y = apex; y < 0; y += 2) {
    const w = snap(((y - apex) / -apex) * half);
    pixelRect(-w - 2, y, w + 2, 2, FABRIC.base, 2);
    pixelRect(0, y, w + 2, 2, FABRIC.light, 2);
    pixelRect(-w - 2, y, 2, 2, FABRIC.dark, 2);
    pixelRect(-2, y, 2, 2, FABRIC.dark, 2);
    // The doorway, with a rolled-up flap either side.
    const door = doorHalf(y);
    if (door) {
      pixelRect(-door, y, door * 2, 2, INK, 2);
      pixelRect(-door - 2, y, 2, 2, FABRIC.dark, 2);
      pixelRect(door, y, 2, 2, ROPE.base, 2);
    }
  }
  // The ridge pole's tip and the groundsheet's hem.
  pixelRect(-2, apex - 4, 4, 4, STEEL.base, 2);
  pixelRect(0, apex - 4, 2, 2, STEEL.light, 2);
  pixelRect(-half - 2, -2, half * 2 + 4, 2, FABRIC.dark, 2);
  // Tie-backs holding the flaps.
  pixelRect(-12, -14, 4, 2, ROPE.dark, 2);
  pixelRect(8, -14, 4, 2, ROPE.light, 2);
  // Boots by the door.
  for (const bx of [16, 24]) {
    pixelRect(bx, -8, 4, 6, WOOD.base, 2);
    pixelRect(bx, -4, 8, 2, WOOD.base, 2);
    pixelRect(bx + 2, -8, 2, 4, WOOD.light, 2);
    pixelRect(bx, -2, 8, 2, RUBBER.dark, 2);
  }
}

/**
 * The guy ropes from high on the tent out to pegs either side, each peg in
 * the ground under it (`groundOffset(localX)`).
 */
export function drawTentRopes({ pixelRect, pixelPath }, groundOffset) {
  const { peg } = TENT;
  for (const side of [-1, 1]) {
    const px = side * peg;
    const ground = snap(groundOffset(px));
    pixelPath([[side * 6, TENT.apex + 8], [px, ground - 4]], side < 0 ? ROPE.dark : ROPE.base, 1, 2);
    pixelRect(px - 2, ground - 6, 4, 2, STEEL.light, 2);
    pixelRect(px, ground - 4, 2, 4, STEEL.base, 2);
  }
}

/**
 * The doorway lit by the lantern inside, `flicker` 0.88…1 (lanternFlicker):
 * warm light filling it, brightest low down round the lantern.
 */
export function drawTentDoorGlow({ pixelRect }, flicker = 1) {
  for (let y = -30; y < 0; y += 2) {
    const door = doorHalf(y);
    if (!door) continue;
    pixelRect(-door, y, door * 2, 2, y > -14 ? TENT_LIGHT.core : TENT_LIGHT.glow, 2);
  }
  // A sleeping bag's shadow and the lantern on the floor.
  pixelRect(-10, -4, 12, 4, FABRIC.dark, 2);
  pixelRect(4, -10, 4, 6, TENT_LIGHT.flame, 2);
  pixelRect(4, flicker < 0.95 ? -10 : -12, 2, 2, TENT_LIGHT.core, 2);
}

// --------------------------------------------------------------------- grass

/** The tuft's blades: where each grows, how tall, and which green. */
export const GRASS_BLADES = [
  { x: -16, height: 10, color: "dark" }, { x: -12, height: 18, color: "base" }, { x: -10, height: 12, color: "light" },
  { x: -6, height: 22, color: "base" }, { x: -2, height: 14, color: "dark" }, { x: 0, height: 26, color: "light" },
  { x: 4, height: 16, color: "base" }, { x: 6, height: 20, color: "dark" }, { x: 10, height: 12, color: "light" },
  { x: 12, height: 18, color: "base" }, { x: 16, height: 8, color: "dark" },
];
/** How close the rider must pass, across and up or down, to brush a blade aside. */
export const GRASS_BRUSH = { x: 40, y: 50 };

/**
 * How far a blade leans, as sideways units per unit of height (negative is
 * left in the prop's frame): it leans `downwind` in the wind, sways while
 * `time` runs (still at 0), and is pushed flat away from a rider passing
 * through it. `riderDx`, `riderDy` are the rider's offset from the blade's
 * root in the prop's frame, or null.
 */
export function grassLean(time, wind, downwind, phase, bladeX, riderDx = null, riderDy = null) {
  // Nearly upright in still air, bent well over in a gale, and swaying
  // faster and further the harder it blows.
  let lean = downwind * (0.05 + wind * 0.85);
  if (time) lean += Math.sin(time * (1.6 + wind * 2.4) + bladeX * 0.25 + phase * Math.PI * 2) * (0.04 + wind * 0.22);
  if (Number.isFinite(riderDx) && Number.isFinite(riderDy)
    && Math.abs(riderDx) < GRASS_BRUSH.x && riderDy < 10 && riderDy > -GRASS_BRUSH.y) {
    const push = 1 - Math.abs(riderDx) / GRASS_BRUSH.x;
    lean = lean * (1 - push) + (riderDx > 0 ? -1 : 1) * push * 1.2;
  }
  return clamp(lean, -1.4, 1.4);
}

/**
 * A tuft of grass, each blade rising from the ground under it
 * (`groundOffset(localX)`) and bent over by `leanOf(blade)` (see grassLean),
 * more towards its tip. A blade bent far over gets shorter, so it lies down
 * rather than stretching.
 */
export function drawGrass({ pixelRect }, groundOffset, leanOf) {
  for (const blade of GRASS_BLADES) {
    const ground = snap(groundOffset(blade.x + 1));
    const lean = leanOf(blade);
    const height = snap(blade.height / Math.sqrt(1 + lean * lean * 0.6));
    for (let up = 0; up < height; up += 2) {
      const t = up / blade.height;
      const x = blade.x + snap(lean * up * t);
      const color = up >= height - 2 ? BLADES.tip : BLADES[blade.color];
      pixelRect(x, ground - up - 2, 2, 2, color, 2);
    }
  }
}

// ----------------------------------------------------------------- fireplace

/** Where the fire's flames rise from, and where its smoke starts. */
export const FIRE = { y: -6, smoke: -30 };
/** The fireplace's flames: a fire about 20 across and 22 tall (see fire.js). */
export const FIRE_TONGUES = fireTongues(20, 22);

/**
 * A fireplace out in the open, about 40 across (1.5 m): a ring of rounded
 * stones, shaded on the left, round a bed of ash and two crossed logs. Its
 * fire is drawn live from fire.js at FIRE.y, and the smoke by drawing.js.
 */
export function drawFireplace({ pixelRect }) {
  // Ash and the logs, crossed.
  pixelRect(-12, -4, 24, 2, RUBBER.light, 2);
  pixelRect(-10, -6, 14, 4, WOOD.base, 2);
  pixelRect(-10, -6, 14, 2, WOOD.light, 2);
  pixelRect(-10, -6, 2, 4, WOOD.cut, 2);
  pixelRect(-2, -8, 12, 4, WOOD.dark, 2);
  pixelRect(-2, -8, 12, 2, WOOD.base, 2);
  pixelRect(8, -8, 2, 4, WOOD.tip, 2);
  // The stones round it, the front row overlapping the logs' ends.
  const stones = [[-20, 6, 6], [-14, 8, 8], [-6, 6, 6], [0, 8, 8], [8, 6, 6], [14, 6, 8]];
  for (const [x, w, h] of stones) {
    pixelRect(x, -h, w, h, STEEL.base, 2);
    pixelRect(x + 2, -h - 2, w - 4, 2, STEEL.base, 2);
    pixelRect(x, -h, 2, h, STEEL.dark, 2);
    pixelRect(x + w - 4, -h - 2, 2, 2, STEEL.light, 2);
    pixelRect(x + w - 2, -h, 2, h - 2, STEEL.mid, 2);
    pixelRect(x, -2, w, 2, STEEL.dark, 2);
  }
}

// ---------------------------------------------------------------------- ivy

/** The tallest ivy grows up a face, and how tall it grows with no face to climb. */
export const IVY = { max: 120, alone: 64 };
// Ivy's deep, glossy greens, darker than the vines and moss, on woody stems.
const IVY_LEAF = { dark: "#365345", base: "#3d6452", mid: "#477158", light: "#618b66" };
const IVY_STEM = { dark: "#4d3f2f", base: "#66543f" };

/**
 * Where ivy's stems and leaves go as it climbs `rise` units up a face from its
 * anchor at (0, 0), drawn with the rock at -x and the open air at +x. Two
 * woody stems wander up the face, the second branching off low down; side
 * shoots reach out from them every 8 units with a leaf on the end, and more
 * leaves sit along the stems. `noise(n)` is a fixed 0…1 value per prop.
 * Returns { stems: [[x, y], …] cells, leaves: [{ x, y, tone, tip }] }, every
 * position on the art grid; `tip` marks the leaves the wind can stir.
 * @param {number} rise
 * @param {(n: number) => number} noise
 */
export function ivyLayout(rise, noise) {
  const height = snap(clamp(rise, 16, IVY.max));
  const stems = [], leaves = [];
  const tones = ["base", "mid", "dark", "mid"];
  const runs = [
    { from: 0, to: height, x: 0, n: 0 },
    { from: 10, to: snap(height * 0.8), x: 6, n: 1 },
    { from: 4, to: snap(height * 0.45), x: 10, n: 2 },
  ];
  for (const stem of runs) {
    const wobble = noise(stem.n) * 6;
    const at = (up) => stem.x + snap(Math.sin(up * 0.09 + wobble) * 2) + 2;
    for (let up = stem.from; up < stem.to; up += 2) {
      const x = at(up), y = -up - 2;
      stems.push([x, y]);
      // Leaves crowd the stem, alternating either side of it.
      if (up % 4 === 2) {
        const step = (up - 2) / 4 + stem.n;
        leaves.push({ x: x + (step % 2 ? 0 : -6), y: y - 4, tone: tones[step % 4], tip: false });
      }
      // Now and then a shoot out into the air, a leaf on its end.
      if (up % 12 === 8) {
        const reach = 4 + snap(noise(up + stem.n * 50) * 6);
        for (let dx = 2; dx < reach; dx += 2) stems.push([x + dx, y]);
        leaves.push({ x: x + reach - 2, y: y - 6, tone: up % 24 === 8 ? "light" : "mid", tip: true });
      }
    }
    // The leading leaf at the top of each stem.
    leaves.push({ x: at(stem.to) - 4, y: -stem.to - 6, tone: "light", tip: true });
  }
  return { stems, leaves };
}

/**
 * How far the ivy's outer leaves are stirred by the wind at `time`: hardly
 * at all in still air, a flutter of ±2 or ±4 in a gale, different for each
 * leaf. Still at time 0.
 */
export function ivyRustle(time, wind, phase, index) {
  if (!time) return 0;
  return snap(Math.sin(time * (2 + wind * 3) + index * 1.7 + phase * Math.PI * 2) * (0.2 + wind * 3.2));
}

/**
 * Ivy as laid out by ivyLayout: woody stems, then lobed leaves over them,
 * each shaded on its left and lit on its right, the outer ones nudged by
 * `rustle(index)` (see ivyRustle).
 */
export function drawIvy({ pixelRect }, layout, rustle = () => 0) {
  for (const [x, y] of layout.stems) pixelRect(x, y, 2, 2, x > 6 ? IVY_STEM.base : IVY_STEM.dark, 2);
  layout.leaves.forEach((leaf, index) => {
    const x = leaf.x + (leaf.tip ? rustle(index) : 0), y = leaf.y;
    const color = IVY_LEAF[leaf.tone];
    // A lobed leaf 8 across: two lobes on top, a broad middle, a stalk.
    pixelRect(x + 2, y, 4, 2, color, 2);
    pixelRect(x, y + 2, 8, 4, color, 2);
    pixelRect(x, y + 2, 2, 4, IVY_LEAF.dark, 2);
    pixelRect(x + 6, y + 2, 2, 2, leaf.tone === "dark" ? IVY_LEAF.base : IVY_LEAF.light, 2);
    pixelRect(x + 4, y, 2, 2, leaf.tone === "light" ? "#86a56a" : IVY_LEAF.light, 2);
    pixelRect(x + 4, y + 6, 2, 2, IVY_STEM.dark, 2);
  });
}
