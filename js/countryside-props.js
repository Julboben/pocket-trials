// @ts-check
// Danish countryside props: Dannebrog flying from a white garden flagpole,
// streaming out downwind and rippling in the wind. Like every prop it sits on
// the 2-unit art grid, has no outlines and is lit from the right. It is drawn
// live, its pole running down to the ground; `downwind` is the direction the
// wind blows in the prop's own frame (-1 left, 1 right), so a flipped flag
// still flies the right way.

import { STEEL } from "./city-props.js";

const WHITE = { dark: "#b5bcae", base: "#f4e9d1", light: "#fffdf4" };
const YELLOW = { dark: "#d9953a", base: "#f1b95d", light: "#ffe39a" };
/** Dannebrog's red. */
const RED = { dark: "#a8322a", base: "#d63b2c", light: "#e8755b" };
const BLADES = { dark: "#477158", base: "#58784d", light: "#618b66" };

const snap = (value) => Math.round(value / 2) * 2;

// ------------------------------------------------------------------ flagpole

/**
 * The flagpole's height, about 6.3 m, and the flag's size in 2-unit cells,
 * about 1.5 × 1 m: the size of flag a 6 m garden pole flies.
 */
export const FLAGPOLE = { top: -170, columns: 20, rows: 14 };
// Dannebrog's white cross: the columns and rows it runs along.
const CROSS = { columns: [6, 7], rows: [6, 7] };

/**
 * How far each column of the flag lifts or drops as it ripples (0 at the
 * pole), at `time` in a `wind` of 0…1: lazily in a breeze, snapping fast and
 * hard in a gale. Still at time 0.
 */
export function flagRipple(time, wind, phase, column) {
  if (!time) return 0;
  return snap(Math.sin(time * (2 + wind * 6) - column * 0.35 + phase * Math.PI * 2) * Math.min(column, 8) * (0.1 + wind * 0.45));
}

/**
 * How far a flag's column hangs below the pole's top, `column` cells out
 * from it: a flag droops in still air, more the further out, and stands
 * straight out in a gale.
 */
export function flagDroop(wind, column) {
  return snap(column * 1.6 * (1 - Math.min(1, Math.max(0, wind))) ** 2);
}

/**
 * Dannebrog on a white garden flagpole: the pole down to the ground, its gilt
 * knob, the halyard tied off at a cleat, and the flag flying out `downwind`
 * (-1 left, 1 right) from the top, its cross towards the pole, rippling
 * with `time` and `wind`.
 */
export function drawFlagpole({ pixelRect }, groundOffset, time = 0, wind = 0.25, phase = 0, downwind = -1) {
  const ground = snap(groundOffset(0));
  const { top, columns, rows } = FLAGPOLE;
  pixelRect(-2, top, 2, ground - top, WHITE.dark, 2);
  pixelRect(0, top, 2, ground - top, WHITE.light, 2);
  // The knob.
  pixelRect(-4, top - 6, 6, 6, YELLOW.base, 2);
  pixelRect(-4, top - 6, 2, 6, YELLOW.dark, 2);
  pixelRect(0, top - 6, 2, 2, YELLOW.light, 2);
  // The halyard, and the cleat it's tied off on.
  pixelRect(2, top + 2, 2, -top - 40, WHITE.base, 2);
  pixelRect(2, -38, 4, 2, STEEL.base, 2);
  pixelRect(2, -40, 2, 2, STEEL.light, 2);
  // A little bed of grass round its foot.
  pixelRect(-6, ground - 2, 12, 2, BLADES.dark, 2);
  pixelRect(-4, ground - 4, 2, 2, BLADES.base, 2);
  pixelRect(4, ground - 4, 2, 2, BLADES.light, 2);
  // The flag.
  const hoist = downwind < 0 ? -2 : 2;
  for (let column = 0; column < columns; column++) {
    const cx = downwind < 0 ? hoist - (column + 1) * 2 : hoist + column * 2;
    const cy = top + 2 + flagDroop(wind, column) + flagRipple(time, wind, phase, column);
    const lift = flagRipple(time, wind, phase, column + 1) - flagRipple(time, wind, phase, column);
    for (let row = 0; row < rows; row++) {
      const white = CROSS.columns.includes(column) || CROSS.rows.includes(row);
      // Folds facing up catch the light, folds facing down are in shade.
      const shade = row === rows - 1 || lift > 0, lit = row === 0 || lift < 0;
      const tone = white
        ? shade ? WHITE.dark : lit ? WHITE.light : WHITE.base
        : shade ? RED.dark : lit ? RED.light : RED.base;
      pixelRect(cx, cy + row * 2, 2, 2, tone, 2);
    }
  }
}

// ------------------------------------------------------------------ windmill

/**
 * A Danish windmill (a "hollandsk mølle"): where its sails turn, how long
 * they are, and where the sprite hands over to the base that follows the
 * ground. About 9 m to the hub and 240 to the tip of a sail at the top, a
 * tall structure drawn tall enough not to look like a toy (PROPS_GUIDE.md).
 */
export const MILL = { hub: { x: 0, y: -158 }, sail: 82, bodyBottom: -10 };
const MILL_WALL = { shade: "#b5bcae", base: "#f4e9d1", light: "#fffdf4", line: "#e8e5d9" };
const MILL_WOOD = { dark: "#4d3f2f", base: "#66543f", light: "#856d4f", tip: "#aa8a60" };
const MILL_CAP = { dark: "#3a403d", base: "#4a524d", light: "#5b645e" };
const MILL_SAIL = { stock: "#4d3f2f", frame: "#f4e9d1", bar: "#b5bcae" };
const MILL_INK = "#182321";

/**
 * The mill's tower, without its sails: a whitewashed brick base with a door,
 * a wooden gallery with a railing round it, a dark shingled octagonal tower
 * narrowing upward with a window, and a boat-shaped tarred cap. Lit from the
 * right: the tower's left face is in shade, its right face lit. Down to
 * MILL.bodyBottom; the base below it follows the ground (drawMillBase).
 */
export function drawMillTower({ pixelRect }) {
  // Whitewashed base, slightly narrowing upward, with faint courses.
  for (let y = -40; y < MILL.bodyBottom; y += 2) {
    const half = 32 + Math.round((y + 40) / 15) * 2;
    pixelRect(-half, y, half * 2, 2, (y + 40) % 8 === 6 ? MILL_WALL.line : MILL_WALL.base, 2);
    pixelRect(-half, y, 4, 2, MILL_WALL.shade, 2);
    pixelRect(half - 2, y, 2, 2, MILL_WALL.light, 2);
  }
  // An arched door and a small window.
  pixelRect(-8, -32, 14, 22, MILL_WOOD.dark, 2);
  pixelRect(-6, -34, 10, 2, MILL_WOOD.dark, 2);
  for (const x of [-6, -2, 2]) pixelRect(x, -30, 2, 20, MILL_WOOD.base, 2);
  pixelRect(16, -32, 6, 6, MILL_INK, 2);
  pixelRect(16, -32, 6, 2, MILL_WALL.shade, 2);
  // The shingled tower: three faces of the octagon, narrowing upward, with a
  // darker course every few shingles.
  const towerBottom = -42, towerTop = -146;
  for (let y = towerTop; y < towerBottom; y += 2) {
    const t = (y - towerTop) / (towerBottom - towerTop);
    const half = Math.round((16 + 12 * t) / 2) * 2;
    const inner = Math.round((half * 0.45) / 2) * 2;
    const course = (y - towerTop) % 8 === 6;
    pixelRect(-half, y, half - inner, 2, course ? MILL_INK : MILL_WOOD.dark, 2);
    pixelRect(-inner, y, inner * 2, 2, course ? MILL_WOOD.dark : MILL_WOOD.base, 2);
    pixelRect(inner, y, half - inner, 2, course ? MILL_WOOD.base : MILL_WOOD.light, 2);
  }
  // A window high on the tower, framed in white.
  pixelRect(-6, -116, 10, 12, MILL_WALL.base, 2);
  pixelRect(-4, -114, 6, 8, MILL_INK, 2);
  pixelRect(-4, -110, 6, 2, MILL_WALL.shade, 2);
  // The gallery: a deck round the tower, and its railing.
  pixelRect(-46, -44, 92, 4, MILL_WOOD.light, 2);
  pixelRect(-46, -44, 92, 2, MILL_WOOD.tip, 2);
  pixelRect(-46, -40, 92, 2, MILL_WOOD.dark, 2);
  for (let x = -46; x <= 44; x += 10) pixelRect(x, -54, 2, 10, x < 0 ? MILL_WOOD.base : MILL_WOOD.light, 2);
  pixelRect(-46, -56, 92, 2, MILL_WOOD.tip, 2);
  // The cap: boat-shaped and tarred, with a finial on top.
  for (let y = -168; y < towerTop; y += 2) {
    const t = (y + 168) / (towerTop + 168);
    const half = Math.max(2, Math.round((22 * Math.sqrt(t)) / 2) * 2);
    pixelRect(-half, y, half * 2, 2, MILL_CAP.base, 2);
    pixelRect(-half, y, Math.max(2, half / 2), 2, MILL_CAP.dark, 2);
    pixelRect(half - 4, y, 2, 2, MILL_CAP.light, 2);
  }
  pixelRect(-24, towerTop, 48, 2, MILL_CAP.dark, 2);
  pixelRect(-2, -172, 4, 4, MILL_CAP.light, 2);
}

/** The base below the sprite, down to the ground under each column. */
export function drawMillBase({ pixelRect }, groundOffset) {
  for (let x = -32; x < 32; x += 2) {
    const ground = Math.round(groundOffset(x + 1) / 2) * 2;
    if (ground <= MILL.bodyBottom) continue;
    const color = x < -28 ? MILL_WALL.shade : x >= 30 ? MILL_WALL.light : MILL_WALL.base;
    pixelRect(x, MILL.bodyBottom, 2, ground - MILL.bodyBottom, color, 2);
  }
}

/**
 * How far the sails have turned at `time`, in radians, anticlockwise as
 * Danish mills turn: slowly, a few turns a minute in a breeze and about a
 * turn every four seconds in a gale (`wind` 0…1), easing with the gusts.
 * Still at time 0, at its own angle (`phase` 0…1) so mills differ.
 */
export function millAngle(time, wind = 0.25, phase = 0) {
  const start = phase * Math.PI * 2;
  if (!(time > 0)) return start;
  const w = Math.max(0, Math.min(1, Number(wind) || 0));
  const speed = 0.08 + w * 1.5;
  // The gust term's rate of change never exceeds the base speed.
  const gust = speed * 0.3 * Math.sin(time * 0.5 + phase * 9);
  return start - (time * speed + gust);
}

/**
 * The four sails turned to `angle`, round the hub at MILL.hub: each a stock
 * with a white lattice frame on its trailing side, and the hub over them.
 */
export function drawMillSails({ pixelRect, pixelPath, drawPixelDisc }, angle) {
  const { x: hx, y: hy } = MILL.hub;
  for (let i = 0; i < 4; i++) {
    const a = angle + (i * Math.PI) / 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    // The frame trails behind the stock as the sails turn anticlockwise.
    const vx = uy, vy = -ux;
    const at = (r, side = 0) => [hx + ux * r + vx * side, hy + uy * r + vy * side];
    const inner = 18, outer = MILL.sail - 2, width = 12;
    // Cross bars, the outer rail and the ends of the frame.
    for (let r = inner; r <= outer; r += 8) pixelPath([at(r), at(r, width)], MILL_SAIL.bar, 1, 2);
    pixelPath([at(inner, width), at(outer, width)], MILL_SAIL.frame, 1, 2);
    pixelPath([at(outer), at(outer, width)], MILL_SAIL.frame, 1, 2);
    // The stock, from the hub to the tip.
    pixelPath([at(4), at(MILL.sail)], MILL_SAIL.stock, 2, 2);
  }
  drawPixelDisc(hx, hy, 5, MILL_CAP.dark, 2);
  drawPixelDisc(hx + 1, hy - 1, 2, MILL_CAP.light, 2);
}
