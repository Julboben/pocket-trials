// @ts-check
// Coda the corgi: a tri-colour Pembroke Welsh Corgi with a bushy black tail
// tipped white, like a fox's. He potters about near his anchor, sits, sniffs
// the ground and woofs now and then, and runs over to the rider when they come
// close, woofing and wagging, until they leave again. Told to sit (the
// interact key, see corgiSit), he sits and pants like a good dog.
//
// Like every prop it sits on the 2-unit art grid, has no outlines, and is lit
// from the right: shaded on the left and underneath. It faces right; drawing.js
// turns it to face left. It is drawn live every frame (it never stands still
// long enough to be worth a sprite), with each leg reaching down to the ground
// under it so it walks over slopes. drawing.js traces the ground it can walk
// on, like the squirrel's, into `fit` = { left, right }: the ground's y every
// CORGI_STEP units each way from the anchor, relative to it.
//
// The corgi moves in world directions, whichever way it was placed facing, like
// the fish and the squirrel. Because running to the rider depends on where the
// rider has been, its motion is a small state machine: corgiStep(state, input)
// is a pure function from one state to the next, and render.js keeps one state
// per corgi between frames, the way it keeps a startled animal's `flight`.
// The motion is decoration only and never touches the simulation. At time 0
// (the editor, thumbnails, reduced motion) it sits still at its anchor.

import { desertNoise } from "./desert-props.js";

/** Snaps a value onto the 2-unit art grid. */
const snap = (value) => Math.round(value / 2) * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A tri-colour Pembroke: a black saddle, rich tan points and white trim, all
// from colours already in the game.
const BLACK = { dark: "#263b36", base: "#3a403d", light: "#5b645e" };
const TAN = { dark: "#806244", shade: "#aa8a60", base: "#d9953a", light: "#f1b95d" };
const WHITE = { dark: "#97a08f", shade: "#b9c4af", base: "#f4e9d1", light: "#fffdf4" };
const EAR = "#c39664";
const NOSE = "#263b36";
const TONGUE = "#e8755b";
const TONGUE_SHADE = "#b9524a";
const COLLAR = { base: "#d63b2c", shade: "#a8322a", tag: "#f4c64e" };

/** A tiny repeatable noise in [0, 1) for a corgi's choices, from its phase. */
export const corgiNoise = desertNoise;

/** A corgi's fixed 0…1 phase, from where it is placed, so each one differs. */
export const corgiPhase = (x) => desertNoise(x, 41);

// ---------------------------------------------------------------------------
// The ground it walks on
// ---------------------------------------------------------------------------

/** Its path is traced every CORGI_STEP units either side of its anchor. */
export const CORGI_STEP = 4;
/** The largest step up or down it will walk over, in world units. */
export const CORGI_STEP_UP = 12;
/** How far either side of its anchor it can ever go, in world units. */
export const CORGI_RANGE = 220;
/** How far either side of its anchor it potters about when nobody is near. */
export const CORGI_WANDER = 80;

/** How far left (negative) and right of its anchor the corgi can go on `fit` = { left, right }. */
export function corgiReach(fit) {
  const left = ((fit?.left?.length ?? 1) - 1) * CORGI_STEP;
  const right = ((fit?.right?.length ?? 1) - 1) * CORGI_STEP;
  return { min: -left, max: right };
}

/**
 * The ground's y at `dx` from the anchor, relative to the anchor, read from
 * `fit` and interpolated between its samples. 0 without a fit.
 */
export function corgiGround(fit, dx) {
  const path = dx < 0 ? fit?.left : fit?.right;
  if (!path?.length) return 0;
  const at = Math.abs(dx) / CORGI_STEP;
  const i = Math.min(path.length - 1, Math.floor(at));
  const next = path[Math.min(path.length - 1, i + 1)];
  return path[i] + (next - path[i]) * Math.min(1, at - i);
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

/** Walking and running speeds, in units per second. */
export const CORGI_WALK = 24;
export const CORGI_RUN = 150;
/**
 * It notices a rider within CORGI_NOTICE units of itself (and CORGI_NOTICE_UP
 * above or below), and loses interest once they are CORGI_FORGET away.
 */
export const CORGI_NOTICE = 160;
export const CORGI_NOTICE_UP = 90;
export const CORGI_FORGET = 300;
/** How close to the rider it stops, so it greets them rather than sits under them. */
export const CORGI_GAP = 46;
/** How long one woof shows, in seconds. */
export const CORGI_WOOF = 0.32;
/** How long he stays sitting when told to, in seconds, unless the rider leaves. */
export const CORGI_STAY = 12;
/** How long the heart floats over his head after he is told to sit. */
export const CORGI_HEART = 1.4;
// Seconds per wandering choice, and the gap between woofs.
const WANDER_SPELL = 4.5;
const WOOF_GAP_IDLE = 0.45;
const WOOF_GAP_GREET = 1.4;
// Close enough to its target to stop walking.
const ARRIVED = 2;

/**
 * @typedef {object} CorgiState
 * @property {number} dx      Offset from its anchor along the ground, world units.
 * @property {number} dir     The way it faces in the world: 1 right, -1 left.
 * @property {"wander" | "greet" | "sit"} mode
 * @property {number} speed   How fast it is moving now, units per second.
 * @property {number} stride  Distance walked so far, which drives the leg cycle.
 * @property {number} woofAt  Game time of its last woof, or -Infinity.
 * @property {boolean} woofed True on the step a new woof starts (for a sound).
 * @property {number} still   Seconds it has stood at its current spot.
 * @property {number} sitAt   Game time it was last told to sit, or -Infinity.
 * @property {number} time    Game time of this state.
 */

/** A corgi's state before its first step: sitting at its anchor, facing `dir`. */
export function corgiStart(dir = 1) {
  return /** @type {CorgiState} */ ({
    dx: 0,
    dir: dir < 0 ? -1 : 1,
    mode: "wander",
    speed: 0,
    stride: 0,
    woofAt: -Infinity,
    woofed: false,
    still: 10,
    sitAt: -Infinity,
    time: 0,
  });
}

/**
 * Told to sit at `time`: he stops where he is and sits panting for
 * CORGI_STAY seconds, or until the rider leaves (see corgiStep).
 * @param {CorgiState} state
 * @returns {CorgiState}
 */
export function corgiSit(state, time) {
  return { ...(state ?? corgiStart()), mode: "sit", sitAt: time, speed: 0, still: 0 };
}

/**
 * What a wandering corgi is up to at `time`: the spot it heads for (an offset
 * from its anchor) and what it does once there ("sit", "sniff", "stand" or
 * "woof"). Fixed per spell of WANDER_SPELL seconds and per corgi (`phase`).
 */
export function corgiWander(time, phase, reach) {
  const spell = Math.floor(time / WANDER_SPELL + phase * 17);
  const n = (k) => corgiNoise(phase, spell * 7 + k);
  // Every other spell it stays put and does something where it is.
  const roam = n(1) < 0.65;
  const low = Math.max(reach.min, -CORGI_WANDER);
  const high = Math.min(reach.max, CORGI_WANDER);
  const target = roam ? snap(low + (high - low) * n(2)) : null;
  const pick = n(3);
  const action = pick < 0.3 ? "sit" : pick < 0.55 ? "sniff" : pick < 0.8 ? "stand" : "woof";
  return { target, action };
}

/**
 * The corgi's next state, `dt` seconds on. `riderDx` and `riderDy` are the
 * rider's offset from the corgi's anchor in world units (riderX - x and
 * riderY - y, null when there is no rider); `fit` is its ground and
 * `phase` a fixed 0…1 per prop. At time 0 it returns the start state.
 * @param {CorgiState} state
 * @param {{ time: number, dt: number, riderDx?: number | null, riderDy?: number | null, fit?: any, phase?: number }} input
 * @returns {CorgiState}
 */
export function corgiStep(state, { time, dt, riderDx = null, riderDy = null, fit = null, phase = 0 }) {
  if (!(time > 0)) return corgiStart(state?.dir ?? 1);
  const s = { ...(state ?? corgiStart()), woofed: false, time };
  dt = clamp(Number(dt) || 0, 0, 0.1);
  const reach = corgiReach(fit);
  const rider = Number.isFinite(riderDx) ? /** @type {number} */ (riderDx) : null;
  const away = rider === null ? Infinity : Math.abs(rider - s.dx);
  const up = Number.isFinite(riderDy) ? Math.abs(/** @type {number} */ (riderDy) - corgiGround(fit, s.dx)) : 0;
  const woof = () => {
    s.woofAt = time;
    s.woofed = true;
  };
  // Sitting as told, facing the rider, until he has sat long enough or they leave.
  if (s.mode === "sit") {
    if (time - s.sitAt <= CORGI_STAY && away <= CORGI_FORGET) {
      s.speed = 0;
      s.still += dt;
      if (rider !== null && Math.abs(rider - s.dx) > 2) s.dir = rider > s.dx ? 1 : -1;
      return s;
    }
    s.mode = "wander";
  }
  // Noticing and losing interest.
  if (s.mode === "wander" && away < CORGI_NOTICE && up < CORGI_NOTICE_UP) {
    s.mode = "greet";
    woof();
  } else if (s.mode === "greet" && (away > CORGI_FORGET || up > CORGI_NOTICE_UP * 1.5)) {
    s.mode = "wander";
  }
  let target = s.dx;
  let action = "stand";
  if (s.mode === "greet" && rider !== null) {
    // Run up to the rider, stopping a little short on its own side.
    const side = rider >= s.dx ? 1 : -1;
    target = clamp(rider - side * CORGI_GAP, reach.min, reach.max);
    // Already close enough: stand and greet rather than shuffle about.
    if (Math.abs(rider - s.dx) <= CORGI_GAP + 10 && Math.abs(rider - s.dx) >= CORGI_GAP - 10) target = s.dx;
  } else {
    const wander = corgiWander(time, phase, reach);
    // Staying put, but never outside its patch: after a greeting it trots home.
    target = wander.target ?? clamp(s.dx, Math.max(reach.min, -CORGI_WANDER), Math.min(reach.max, CORGI_WANDER));
    action = wander.action;
  }
  const gap = target - s.dx;
  const top = s.mode === "greet" ? CORGI_RUN : CORGI_WALK;
  if (Math.abs(gap) > ARRIVED) {
    // Speed up and slow down over a few strides, and never overshoot.
    s.speed = Math.min(top, s.speed + top * 4 * dt, Math.abs(gap) * 4 + 8);
    const move = Math.min(Math.abs(gap), s.speed * dt);
    s.dx += Math.sign(gap) * move;
    s.stride += move;
    s.dir = gap > 0 ? 1 : -1;
    s.still = 0;
  } else {
    s.speed = 0;
    s.still += dt;
    if (s.mode === "greet" && rider !== null) {
      // Face the rider and woof at them every so often.
      if (Math.abs(rider - s.dx) > 2) s.dir = rider > s.dx ? 1 : -1;
      if (time - s.woofAt > WOOF_GAP_GREET + corgiNoise(phase, Math.floor(time)) * 0.6) woof();
    } else if (action === "woof" && s.still > 0.4 && (s.still - 0.4) % 2.6 < 1 && time - s.woofAt > WOOF_GAP_IDLE) {
      // Woof-woof, then a pause.
      woof();
    }
  }
  s.dx = clamp(s.dx, reach.min, reach.max);
  return s;
}

/**
 * How to draw a corgi in `state`, with `phase` its fixed 0…1: its offset
 * `dx` from the anchor and the ground's `dy` there, the way it faces in the
 * world (`dir`), its `pose` ("sit", "stand", "sniff", "walk" or "run"), the
 * leg `frame` (0…3 walking, 0…1 running), whether it is mid-woof (`woof`),
 * its tail `wag` in art pixels (-1, 0 or 1), whether it is sitting and
 * panting as told (`pant`), and how far a heart over its head has floated,
 * 0…1, or null.
 * @param {CorgiState | null | undefined} state
 */
export function corgiPose(state, fit, phase = 0) {
  const s = state ?? corgiStart();
  const time = s.time || 0;
  const dx = snap(s.dx);
  const dy = snap(corgiGround(fit, s.dx));
  const woof = time > 0 && time - s.woofAt < CORGI_WOOF;
  const told = time > 0 && s.mode === "sit";
  let pose = "sit";
  if (told) pose = "sit";
  else if (s.speed > CORGI_WALK * 1.5) pose = "run";
  else if (s.speed > 0) pose = "walk";
  else if (time > 0 && s.mode === "greet") pose = "stand";
  else if (time > 0 && s.still > 0.2) {
    const { action } = corgiWander(time, phase, corgiReach(fit));
    pose = action === "sit" ? "sit" : action === "sniff" ? "sniff" : "stand";
  }
  // Legs: four frames a stride walking, two bounding frames running.
  // Panting, two breaths a second.
  const frame = told
    ? Math.floor(time * 5) % 2
    : pose === "run" ? Math.floor(s.stride / 14) % 2 : Math.floor(s.stride / 5) % 4;
  // The tail wags all the time it is happy, quickest when greeting or praised.
  const rate = s.mode === "greet" || told ? 14 : pose === "sit" ? 0 : 5;
  const wag = time > 0 && rate ? Math.round(Math.sin(time * rate + phase * 6)) : 0;
  const since = time - s.sitAt;
  const heart = told && since < CORGI_HEART ? since / CORGI_HEART : null;
  return { dx, dy, dir: s.dir, pose, frame, woof, wag, pant: told, heart };
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

/** Local bounds [left, top, right, bottom] of the art at its anchor, facing right. */
export const CORGI_BOUNDS = [-44, -56, 36, 2];

// Colours by key in the art grids below.
const KEYS = {
  K: BLACK.base,
  k: BLACK.light,
  D: BLACK.dark,
  T: TAN.base,
  t: TAN.shade,
  L: TAN.light,
  d: TAN.dark,
  W: WHITE.base,
  w: WHITE.shade,
  H: WHITE.light,
  E: EAR,
  N: NOSE,
  P: TONGUE,
  p: TONGUE_SHADE,
  R: COLLAR.base,
  r: COLLAR.shade,
  Y: COLLAR.tag,
};

/** Draws an art grid, one 2-unit pixel per character, its top left at (x, y). */
function drawGrid({ pixelRect }, x, y, rows) {
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      let end = c + 1;
      while (end < row.length && row[end] === row[c]) end++;
      const color = KEYS[row[c]];
      if (color) pixelRect(x + c * 2, y + r * 2, (end - c) * 2, 2, color, 2);
      c = end;
    }
  });
}

// The head facing right: big upright ears (the far one darker), a black cap,
// tan cheeks with a tan brow over the eye, and a white blaze down the muzzle.
const HEAD = [
  "D....K....",
  "DD..KK....",
  "DED.KEk...",
  "DEDKEEk...",
  ".KKKKKk...",
  ".KTTLTW...",
  ".tTTNTWLHN",
  ".tTTTTWWWw",
  "..wwTTwNw.",
];
// Mouth open mid-woof, tongue showing.
const HEAD_WOOF = [
  "D....K....",
  "DD..KK....",
  "DED.KEk...",
  "DEDKEEk...",
  ".KKKKKk...",
  ".KTTLTW...",
  ".tTTNTWLHN",
  ".tTTTTWNNN",
  "..wwTTwPPw",
  "......wWW.",
];
// Nose down to the ground.
const HEAD_SNIFF = [
  "D....K...",
  "DD..KK...",
  "DED.KEk..",
  "DEDKEEk..",
  ".KKKKKkW.",
  ".tTTLTWW.",
  ".tTTNTWWH",
  "..tTTTWWH",
  "...wwwWWN",
];
// Sitting and panting as told: a happy open mouth with the tongue lolling,
// in and out with each breath.
const HEAD_PANT = [
  [
    "D....K....",
    "DD..KK....",
    "DED.KEk...",
    "DEDKEEk...",
    ".KKKKKk...",
    ".KTTLTW...",
    ".tTTNTWLHN",
    ".tTTTTWWNN",
    "..wwTTwNPw",
    "......wpPw",
    ".......pP.",
  ],
  [
    "D....K....",
    "DD..KK....",
    "DED.KEk...",
    "DEDKEEk...",
    ".KKKKKk...",
    ".KTTLTW...",
    ".tTTNTWLHN",
    ".tTTTTWWNN",
    "..wwTTwNPw",
    "......wpP.",
  ],
];
const HEAD_AT = { x: 4, y: -32 };
const SNIFF_AT = { x: 10, y: -22 };

// The standing body, without its legs: a white ruff around the neck and
// chest, then the black saddle from behind the front legs right back to the
// tail, over tan sides, a white belly, and fluffy white
// "trousers" at the rump. The tail is drawn separately so it wags, and the
// mane and collar with the head.
const BODY = [
  "..................",
  ".kkkkkkkkkkkkWWWWH",
  ".KKKKKKKKKKKKwWWWH",
  ".KKKKKKKKKKKKwWWWH",
  ".tKKKKKKKKKKTwWWWW",
  "WtTTTKKKKKKTTTwWWW",
  "WWwTTTTTTTTTTTwWWW",
  ".wwwwWWWWWWWWWWww.",
];
const BODY_AT = { x: -24, y: -22 };
// Sitting: rump on the ground, chest up, a hind foot tucked forward.
const BODY_SIT = [
  "................",
  ".........wWWWWH.",
  "........wWWWWWWH",
  ".......kwWWWWWWH",
  "......kkkwWWWWWW",
  ".....kKKKKKwWWWW",
  "....kKKKKKKKwWWW",
  "...kKKKKKTTTTWW.",
  "..kKKKKKTTTTTTW.",
  "..KKKTTTTLLTTww.",
  ".WtTTTTTTLTTt...",
  "WWwwwTTTTTWWH...",
];
const SIT_AT = { x: -20, y: -24 };
// The bushy, fox-like tail: black like the saddle it carries on from, with a
// white tip. Standing it is held out behind, a little raised; sitting it lies
// on the ground. Its right end tucks under the rump. The tip half swishes up
// and down with the wag.
const TAIL = [
  "...kkkkk..",
  "wWWKKKKKKk",
  "wWWKKKKKKK",
  ".wwDDKKKKD",
  "....DDDD..",
];
const TAIL_AT = { x: -42, y: -24 };
const TAIL_SIT = [
  "...kkkkk..",
  "wWWKKKKKKk",
  "wWWKKKKKKK",
  ".wwDDDDDDD",
];
const TAIL_SIT_AT = { x: -36, y: -8 };
// Columns of a tail that swing with the wag (the tip end).
const TAIL_SWING = 5;

/** A tail grid at (x, y), its tip columns raised by `wag` art pixels. */
function drawTail(t, x, y, rows, wag) {
  drawGrid(t, x, y - wag * 2, rows.map((row) => row.slice(0, TAIL_SWING)));
  drawGrid(t, x + TAIL_SWING * 2, y, rows.map((row) => row.slice(TAIL_SWING)));
}

// A little heart that floats up over his head when he is praised.
const HEART = [".RR.RR.", "RHRRRRR", "RRRRRRr", ".RRRRr.", "..RRr..", "...r..."];

// The white ruff on his neck: drawn before the head, it fills the step
// between his back and the back of his head, so his outline carries on up
// his back to the ears instead of dipping in at the neck.
const MANE = ["wWW"];
const MANE_AT = { x: 2, y: -22 };
const MANE_SIT = [
  ".........",
  "......wwW",
  "....wWWWW",
  "...wWWWWW",
  "..wWWWWWW",
];
const MANE_SIT_AT = { x: -6, y: -30 };
// The red collar round his neck, drawn over the head: mostly lost in the
// ruff, it shows as a band slanting down under the chin, with its tag. With
// his nose down it runs behind the ears and under the head, tag and all.
const COLLAR_BAND = [
  "r..",
  ".RR",
  "..Y",
];
const COLLAR_AT = { x: 6, y: -16 };
const COLLAR_SIT_AT = { x: 2, y: -22 };
const COLLAR_SNIFF = [
  "r.",
  "R.",
  ".R",
];
const COLLAR_SNIFF_AT = { x: 6, y: -20 };

// Legs: x of each leg's left edge, far (shaded) or near, front or hind, and
// its place in the walk cycle.
const LEGS = [
  { x: -20, far: true, front: false, offset: 2 },
  { x: 0, far: true, front: true, offset: 0 },
  { x: -16, far: false, front: false, offset: 0 },
  { x: 4, far: false, front: true, offset: 2 },
];
// The underside of the standing body, where the legs start.
const LEG_TOP = -8;

/**
 * One short white corgi leg, 4 wide, from `top` down to the ground at `ground(x)`
 * with a white foot. `reach` moves the foot forward (+) or back and `lift`
 * raises it off the ground.
 */
function drawLeg({ pixelRect }, x, top, ground, far, reach = 0, lift = 0) {
  const foot = snap(ground(x + 2 + reach)) - lift;
  const half = snap(top + (foot - top) / 2);
  const step = snap(reach / 2);
  const [shade, base] = far ? [WHITE.dark, WHITE.shade] : [WHITE.shade, WHITE.base];
  // Upper leg, then the lower leg swinging toward the foot.
  if (half > top) {
    pixelRect(x, top, 2, half - top, shade, 2);
    pixelRect(x + 2, top, 2, half - top, base, 2);
  }
  if (foot - 2 > half) {
    pixelRect(x + step, half, 2, foot - 2 - half, shade, 2);
    pixelRect(x + step + 2, half, 2, foot - 2 - half, base, 2);
  }
  pixelRect(x + reach, foot - 2, 4, 2, far ? WHITE.shade : WHITE.base, 2);
  if (!far) pixelRect(x + reach + 2, foot - 2, 2, 2, WHITE.light, 2);
}

/** The woof: short lines bursting from the open mouth at (`mx`, `my`). */
function drawWoof({ pixelRect }, mx, my) {
  pixelRect(mx + 2, my - 6, 2, 2, WHITE.light, 2);
  pixelRect(mx + 4, my - 8, 2, 2, WHITE.light, 2);
  pixelRect(mx + 4, my, 4, 2, WHITE.light, 2);
  pixelRect(mx + 2, my + 6, 2, 2, WHITE.light, 2);
  pixelRect(mx + 4, my + 8, 2, 2, WHITE.light, 2);
}

/** The heart, `rise` 0…1 of the way up over the sitting head. */
function drawHeart(t, rise) {
  // It blinks out over its last fifth.
  if (rise > 0.8 && Math.floor(rise * 20) % 2) return;
  drawGrid(t, HEAD_AT.x, HEAD_AT.y - 20 - snap(rise * 12), HEART);
}

/** Where the woof comes from, in the corgi's local units (facing right, standing). */
export const CORGI_MOUTH = { x: HEAD_AT.x + 20, y: HEAD_AT.y + 15 };

/**
 * A tri-colour Pembroke corgi facing right, standing on the ground at
 * `ground(localX)` (relative to y = 0): `pose`, `frame`, `woof` and `wag`
 * come from corgiPose. About 50 long and 34 tall to the ear tips, next to a
 * 60-tall rider. Uses pixelRect only.
 */
export function drawCorgi(
  tools,
  { pose = "sit", frame = 0, woof = false, wag = 0, pant = false, heart = /** @type {number | null} */ (null) } = {},
  ground = (/** @type {number} */ _x) => 0,
) {
  const { pixelRect } = tools;
  // The body rides at the height of the ground under its middle; each leg
  // reaches the ground under its own foot.
  const base = snap(ground(0));
  const t = { pixelRect: (x, y, w, h, c) => pixelRect(x, y + base, w, h, c, 2) };
  const legGround = (lx) => ground(lx) - base;
  const head = woof ? HEAD_WOOF : HEAD;
  if (pose === "sit") {
    // The tail lies on the ground behind, wherever that is.
    const tailDrop = snap(legGround(TAIL_SIT_AT.x + 8));
    drawTail(t, TAIL_SIT_AT.x, TAIL_SIT_AT.y + tailDrop, TAIL_SIT, Math.max(0, wag));
    for (const leg of LEGS.filter((l) => l.front)) drawLeg(t, leg.x + 2, -10, legGround, leg.far);
    drawGrid(t, SIT_AT.x, SIT_AT.y, BODY_SIT);
    drawGrid(t, MANE_SIT_AT.x, MANE_SIT_AT.y, MANE_SIT);
    drawGrid(t, HEAD_AT.x - 2, HEAD_AT.y - 6, pant && !woof ? HEAD_PANT[frame % 2] : head);
    drawGrid(t, COLLAR_SIT_AT.x, COLLAR_SIT_AT.y, COLLAR_BAND);
    if (woof) drawWoof(t, CORGI_MOUTH.x - 2, CORGI_MOUTH.y - 6);
    if (heart !== null) drawHeart(t, heart);
    return;
  }
  const running = pose === "run";
  const walking = pose === "walk";
  // Running it bounds: stretched out and up, then gathered in.
  const lift = running ? (frame ? 0 : 2) : walking && frame % 2 ? 2 : 0;
  const swing = (leg) => {
    if (running) {
      const out = frame === 0;
      return { reach: leg.front ? (out ? 6 : -2) : out ? -6 : 2, up: out ? 2 : 0 };
    }
    if (!walking) return { reach: 0, up: 0 };
    const step = (frame + leg.offset) % 4;
    return { reach: [-2, 0, 2, 0][step], up: step === 3 ? 2 : 0 };
  };
  for (const leg of LEGS.filter((l) => l.far)) {
    const { reach, up } = swing(leg);
    drawLeg(t, leg.x, LEG_TOP - lift, legGround, true, reach, up);
  }
  drawTail(t, TAIL_AT.x, TAIL_AT.y - lift, TAIL, wag);
  drawGrid(t, BODY_AT.x, BODY_AT.y - lift, BODY);
  for (const leg of LEGS.filter((l) => !l.far)) {
    const { reach, up } = swing(leg);
    drawLeg(t, leg.x, LEG_TOP - lift, legGround, false, reach, up);
  }
  if (pose === "sniff") {
    drawGrid(t, SNIFF_AT.x, SNIFF_AT.y, HEAD_SNIFF);
    drawGrid(t, COLLAR_SNIFF_AT.x, COLLAR_SNIFF_AT.y, COLLAR_SNIFF);
  } else {
    const raise = woof ? 2 : 0;
    drawGrid(t, MANE_AT.x, MANE_AT.y - lift, MANE);
    drawGrid(t, HEAD_AT.x, HEAD_AT.y - lift - raise, head);
    drawGrid(t, COLLAR_AT.x, COLLAR_AT.y - lift, COLLAR_BAND);
    if (woof) drawWoof(t, CORGI_MOUTH.x, CORGI_MOUTH.y - lift - raise);
  }
}
