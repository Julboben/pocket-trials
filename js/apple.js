// @ts-check
// The collectible apple: its sprite, its bob and what counts as touching it.
// The ride and the renderer share these, so an apple is taken exactly when the
// player's hitbox overlaps the drawn apple, and never before.
import { ART, distanceToRect, playerTouch, segmentToRect } from "./player-shape.js";
import { sin } from "./det-math.js";

export const APPLE_SPRITE = [
  ".....S.LL..",
  ".....SLL...",
  "..RRRSRRR..",
  ".RRRRRRRRR.",
  "RRHRRRRRRRR",
  "RHRRRRRRRRD",
  "RHRRRRRRRRD",
  "RRRRRRRRRRD",
  ".RRRRRRRRD.",
  "..RRDRRDD..",
];

// The sprite's top-left corner relative to the apple's grid-snapped centre.
const SPRITE_LEFT = -12;
const SPRITE_TOP = -12;
const COLUMNS = APPLE_SPRITE[0].length;
const ROWS = APPLE_SPRITE.length;
// The sprite's reach from the apple's centre.
const REACH = 16;

/** The apple's opaque pixels as offsets of their top-left corners. */
const APPLE_PIXELS = APPLE_SPRITE.flatMap((line, row) =>
  [...line].flatMap((cell, column) =>
    cell === "." ? [] : [[SPRITE_LEFT + column * ART, SPRITE_TOP + row * ART]],
  ),
);
const opaque = (column, row) =>
  column >= 0 && column < COLUMNS && row >= 0 && row < ROWS && APPLE_SPRITE[row][column] !== ".";

/** How far the apple floats above or below its resting centre at `time` seconds. */
export function appleBob(apple, time) {
  return sin(time * 2.5 + apple.x) * 2;
}

/** The world position the apple is drawn at, snapped to the art grid. */
export function appleDrawOrigin(apple, time) {
  return {
    x: Math.round(apple.x / ART) * ART,
    y: Math.round((apple.y + appleBob(apple, time)) / ART) * ART,
  };
}

/** The drawn apple at `time`, as a shape the player can touch. */
export function appleShape(apple, time) {
  const origin = appleDrawOrigin(apple, time);
  const left = origin.x + SPRITE_LEFT, top = origin.y + SPRITE_TOP;
  const pixels = () => APPLE_PIXELS.map(([ox, oy]) => [origin.x + ox, origin.y + oy]);
  return {
    x: origin.x,
    y: origin.y,
    reach: REACH,
    overlapsPixel(pl, pt) {
      // Apple column c spans [left + 2c, left + 2c + 2); it overlaps the pixel when within 2 of it.
      const c0 = Math.floor((pl - left) / ART), r0 = Math.floor((pt - top) / ART);
      for (let row = r0; row <= r0 + 1; row++) {
        if (Math.abs(top + row * ART - pt) >= ART) continue;
        for (let column = c0; column <= c0 + 1; column++)
          if (Math.abs(left + column * ART - pl) < ART && opaque(column, row)) return true;
      }
      return false;
    },
    distanceTo(x, y) {
      let best = Infinity;
      for (const [pl, pt] of pixels()) best = Math.min(best, distanceToRect(x, y, pl, pt, pl + ART, pt + ART));
      return best;
    },
    segmentDistance(ax, ay, bx, by) {
      let best = Infinity;
      for (const [pl, pt] of pixels()) best = Math.min(best, segmentToRect(ax, ay, bx, by, pl, pt, pl + ART, pt + ART));
      return best;
    },
  };
}

/**
 * Whether the player touches the apple at `time`.
 * @param {{ x: number, y: number }} apple
 * @param {number} time
 * @param {import("./player-shape.js").Player} player
 */
export function playerTouchesApple(apple, time, player) {
  return playerTouch(appleShape(apple, time), player) !== null;
}
