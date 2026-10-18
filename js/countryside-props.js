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
