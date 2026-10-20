// @ts-check
// A wild rabbit: grey-brown with a white scut, or on snow a mountain hare in
// its white winter coat with black ear tips. It hops about near its anchor,
// a few short hops at a time, and between hops sits, nibbles the grass or sits
// up on its haunches to look about. When the rider comes close it freezes for
// a moment, then bounds off away from them in long leaps and is gone.
//
// Like every prop it sits on the 2-unit art grid, has no outlines, and is lit
// from the right: shaded on the left and underneath. It faces right; drawing.js
// turns it to face left. It is drawn live every frame, since it never stays
// still for long. It hops along the ground the same way Coda the corgi walks:
// drawing.js traces `fit` = { left, right } for it, the ground's y every
// RABBIT_STEP units each way from its anchor, and corgiGround and corgiReach
// read it.
//
// It moves in world directions, whichever way it was placed facing, like the
// squirrel. Its hopping is a pure function of time and a fixed per-prop phase,
// and render.js startles it like the other animals (see STARTLE there), so
// fleeing is a pure function of the flight's age. Decoration only: it never
// touches the simulation. At time 0 (the editor, thumbnails, reduced motion)
// it sits still at its anchor.

import { CORGI_STEP, corgiGround, corgiReach, drawGrid } from "./corgi-props.js";
import { desertNoise } from "./desert-props.js";
import { SNOW } from "./mountain-props.js";

/** Snaps a value onto the 2-unit art grid. */
const snap = (value) => Math.round(value / 2) * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** A rabbit's fixed 0…1 phase, from where it is placed, so each one differs. */
export const rabbitPhase = (x) => desertNoise(x, 53);

// ---------------------------------------------------------------------------
// The ground it hops on
// ---------------------------------------------------------------------------

/** Its path is traced every RABBIT_STEP units, the corgi's step, so corgiGround reads it. */
export const RABBIT_STEP = CORGI_STEP;
/** The largest step up or down it will hop over, in world units. */
export const RABBIT_STEP_UP = 12;
/** How far either side of its anchor it can ever go, fleeing, in world units. */
export const RABBIT_RANGE = 200;
/** How far either side of its anchor it hops about when nobody is near. */
export const RABBIT_WANDER = 60;

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

/** Seconds per spell: a run of hops to a new spot, then a rest there. */
export const RABBIT_SPELL = 3.6;
/** An idle hop: how far it goes, how long it takes and how high it rises. */
export const RABBIT_HOP = 14;
export const RABBIT_HOP_TIME = 0.28;
const HOP_HEIGHT = 8;
// Startled, it freezes for a moment, then bounds off in long leaps.
const FREEZE = 0.12;
/** A fleeing bound: how far it goes, how long it takes and how high it rises. */
export const RABBIT_BOUND = 34;
const BOUND_TIME = 0.24;
export const RABBIT_BOUND_HEIGHT = 16;
/** Seconds after it is startled until it is gone; it fades out over the second half. */
export const RABBIT_FLEE = 1.6;

/**
 * Where the rabbit rests in spell `spell`, as an offset from its anchor within
 * RABBIT_WANDER and `reach` ({ min, max }, see corgiReach). Now and then it
 * stays where it was for a spell or two.
 */
export function rabbitSpot(spell, phase, reach) {
  const low = Math.max(reach.min, -RABBIT_WANDER);
  const high = Math.min(reach.max, RABBIT_WANDER);
  let k = spell;
  for (let i = 0; i < 2 && desertNoise(phase, k * 7 + 1) < 0.35; i++) k--;
  return snap(low + (high - low) * desertNoise(phase, k * 7 + 2));
}

/**
 * Partway through one hop from offset `a` to `b`, `f` 0…1 of the way, rising
 * `height` at the top of the arc: its offset `dx`, its feet's height `dy`
 * (relative to the anchor, up is negative), the way it faces and its `pose`,
 * crouched to take off and land, stretched out in the air.
 */
function hopAt(fit, a, b, f, height) {
  const dx = a + (b - a) * f;
  const from = corgiGround(fit, a);
  const to = corgiGround(fit, b);
  // Over the line between take-off and landing, and never into a bump.
  const dy = Math.min(from + (to - from) * f, corgiGround(fit, dx)) - height * 4 * f * (1 - f);
  const pose = f < 0.2 || f > 0.8 ? "crouch" : "stretch";
  return { dx, dy, dir: b < a ? -1 : 1, pose };
}

/**
 * What a rabbit nobody has startled is doing at `time`: its offset `dx` from
 * the anchor, its feet's height `dy` (relative to the anchor, up is negative),
 * the way it faces in the world (`dir`) and its `pose`: "sit", "nibble",
 * "alert" (sat up on its haunches), or mid-hop "crouch" or "stretch". `phase`
 * is its fixed 0…1, `fit` its traced ground and `facing` the way it was placed
 * facing (1 right, -1 left), which it keeps at time 0.
 */
export function rabbitIdle(time, phase, fit, facing = 1) {
  if (!(time > 0)) return { dx: 0, dy: 0, dir: facing < 0 ? -1 : 1, pose: "sit" };
  const reach = corgiReach(fit);
  const clock = time / RABBIT_SPELL + phase * 13;
  const spell = Math.floor(clock);
  const into = (clock - spell) * RABBIT_SPELL;
  const n = (k) => desertNoise(phase, spell * 7 + k);
  // Each spell starts with a run of short hops from the last spot to this one.
  const from = rabbitSpot(spell - 1, phase, reach);
  const to = rabbitSpot(spell, phase, reach);
  const hops = Math.ceil(Math.abs(to - from) / RABBIT_HOP);
  if (into < hops * RABBIT_HOP_TIME) {
    const i = Math.floor(into / RABBIT_HOP_TIME);
    const step = (to - from) / hops;
    return hopAt(fit, from + step * i, from + step * (i + 1), into / RABBIT_HOP_TIME - i, HOP_HEIGHT);
  }
  // Then it rests, facing the way it came or, if it stayed put, either way.
  const dir = to !== from ? Math.sign(to - from) : n(4) < 0.5 ? -1 : 1;
  const rest = into - hops * RABBIT_HOP_TIME;
  const pick = n(3);
  let pose = "sit";
  // Nibbling, it looks up between mouthfuls; sitting up, it settles first.
  if (pick < 0.45) pose = rest > 0.3 && (rest * 1.4) % 1 > 0.3 ? "nibble" : "sit";
  else if (pick > 0.75) pose = rest > 0.4 && rest < RABBIT_SPELL - 1 ? "alert" : "sit";
  return { dx: to, dy: corgiGround(fit, to), dir, pose };
}

/**
 * Where a rabbit startled `age` seconds ago is, having been at offset `from`
 * when it was: it freezes, then bounds off in `dir` (away from the rider)
 * along its traced ground, stopping at a wall or drop, and fades out. Returns
 * its offset `dx`, its feet's height `dy`, the way it faces, its `pose` (as
 * rabbitIdle), how opaque it is (`alpha`) and whether it has gone (`hidden`).
 */
export function rabbitFlee(fit, from, dir, age) {
  const reach = corgiReach(fit);
  const start = clamp(from, reach.min, reach.max);
  const room = dir < 0 ? start - reach.min : reach.max - start;
  const bounds = Math.max(0, age - FREEZE) / BOUND_TIME;
  const i = Math.floor(bounds);
  const a = start + dir * Math.min(room, i * RABBIT_BOUND);
  const b = start + dir * Math.min(room, (i + 1) * RABBIT_BOUND);
  // Cornered by a wall or a drop, it crouches where it is.
  const hop = a === b
    ? { dx: a, dy: corgiGround(fit, a), dir, pose: "crouch" }
    : hopAt(fit, a, b, bounds - i, RABBIT_BOUND_HEIGHT);
  const alpha = clamp((RABBIT_FLEE - age) / (RABBIT_FLEE / 2), 0, 1);
  return { ...hop, dir: dir < 0 ? -1 : 1, alpha, hidden: age >= RABBIT_FLEE };
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

// Grey-brown agouti fur from the game's wood browns, a white scut and chest,
// and pink-tan inner ears. X and Y are the ear tips, far and near.
const BROWN = {
  D: "#4d3f2f",
  B: "#66543f",
  L: "#856d4f",
  T: "#aa8a60",
  W: "#f4e9d1",
  w: "#b9c4af",
  H: "#fffdf4",
  E: "#c39664",
  K: "#182321",
  X: "#4d3f2f",
  Y: "#66543f",
};
// The mountain hare's winter coat, in the snow's own colours so it blends in,
// shaded blue-grey on the left and inside its ears, with the black ear tips
// it keeps all year.
const WHITE = {
  ...BROWN,
  D: SNOW.deep,
  B: SNOW.base,
  L: SNOW.light,
  T: SNOW.light,
  W: SNOW.light,
  w: SNOW.shade,
  E: SNOW.shade,
  X: "#182321",
  Y: "#3a403d",
};

// Each pose: its rows, one 2-unit pixel per character, and the top left they
// are drawn from so the feet are at y = 0 and the body is centred on x = 0.
const POSES = {
  // Sitting hunched, ears up and swept back.
  sit: {
    x: -14,
    y: -30,
    rows: [
      "....XY.......",
      "....DBE......",
      ".....DBE.....",
      ".....DBE.....",
      "......DBE....",
      "......DBLLT..",
      ".....DBBBBLT.",
      "...DBBBBKBBLT",
      "..DBBBBBBBBBE",
      ".DBBLLBBBBWW.",
      "WDBBBBLBBLW..",
      "HWBBBBLBBLW..",
      "WDBBBLBBBLL..",
      ".DDBBBBBBwL..",
      "..DDDDDDwWw..",
    ],
  },
  // Nose down in the grass, ears laid back.
  nibble: {
    x: -14,
    y: -22,
    rows: [
      "...XY........",
      "...DBE.......",
      "....DBE......",
      "..DBBBBE.....",
      ".DBBBBBBLT...",
      "DBBBBBBBBBLT.",
      "WBBLLBBBBKBLT",
      "HDBBBBLBBBBBE",
      "WDBBBLBBBLBW.",
      ".DDBBBBBBwW..",
      "..DDDDDDw....",
    ],
  },
  // Sat up on its haunches, ears tall, a forepaw raised.
  alert: {
    x: -14,
    y: -34,
    rows: [
      "......XY.....",
      "......DBE....",
      "......DBE....",
      "......DBE....",
      "......DBE....",
      ".......DBLT..",
      "......DBBBLT.",
      "......BBKBBLT",
      "......DBBBBBE",
      ".....DBBBWW..",
      "....DBBBBLW..",
      "....DBBBBLWW.",
      "...DBBBBBBL..",
      "..WDBBBBBBL..",
      ".HWDBBBBBBL..",
      "..DDBBBBBBL..",
      "..DDDDDDDwWw.",
    ],
  },
  // Bunched up to take off or land, ears flat.
  crouch: {
    x: -14,
    y: -24,
    rows: [
      "...XY.........",
      "....DBE.......",
      ".....DBE......",
      "......DBE.....",
      "......DBBLT...",
      "...DBBBBBBBLT.",
      "..DBBBBBBKBBLT",
      ".DBBBBBBBBBBBE",
      "WDBBLLBBBBLWW.",
      "HWBBBBLBBBLW..",
      "WDDBBLBBBBwL..",
      ".DDDDDDDDwWw..",
    ],
  },
  // Stretched out in the air, hind legs kicked back and forepaws reaching.
  stretch: {
    x: -16,
    y: -22,
    rows: [
      "..........XY....",
      "..........DBE...",
      "...........DBE..",
      "...........DBLT.",
      "....DBBBBBDBBKLT",
      "..DBBBBBBBBBBBBE",
      "WDBBLLBBBBBBBWW.",
      "HWDBBBLBBBBBLW..",
      "WDDBBBBBBBBLW...",
      "DDD.DDDDDD.wW...",
      "DD..........wW..",
    ],
  },
};

/** Local bounds [left, top, right, bottom] of the sitting rabbit at its anchor, facing right. */
export const RABBIT_BOUNDS = [-14, -30, 12, 0];
/** How tall it stands at most, sat up with its ears tall, in world units. */
export const RABBIT_HEIGHT = 34;

/**
 * A wild rabbit facing right in `pose` (see rabbitIdle), its feet at y = 0
 * and its body centred on x = 0: about 26 long and 30 tall to the ear tips
 * sitting, next to a 66-tall rider. `snowy` gives it the mountain hare's white
 * winter coat. Uses pixelRect only.
 */
export function drawRabbit(tools, pose = "sit", snowy = false) {
  const art = POSES[pose] ?? POSES.sit;
  drawGrid(tools, art.x, art.y, art.rows, snowy ? WHITE : BROWN);
}
