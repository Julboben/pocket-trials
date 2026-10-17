// @ts-check
// The collectible apple: its sprite and what counts as touching it. The ride
// and the renderer share these, so an apple is taken exactly when the
// player's hitbox overlaps the drawn apple, and never before. Apples hold
// still, so their edge is easy to judge; a shine sweeping across them
// (drawing.js) keeps them lively without moving a pixel.
import { ART, distanceToRect, playerTouch, segmentToRect } from "./player-shape.js";

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

/**
 * A pixel sprite that can be touched: given its rows (any character but "."
 * is solid), where its top-left corner sits relative to its anchor, and how
 * far it reaches from the anchor, returns a function giving the drawn sprite
 * at an anchor (x, y), snapped to the art grid, as a shape the player can
 * touch (see player-shape.js). Shared by the apple and the nisse.
 * @param {string[]} sprite
 */
export function spriteShape(sprite, spriteLeft, spriteTop, reach) {
  const columns = sprite[0].length, rows = sprite.length;
  const offsets = sprite.flatMap((line, row) =>
    [...line].flatMap((cell, column) =>
      cell === "." ? [] : [[spriteLeft + column * ART, spriteTop + row * ART]],
    ),
  );
  const opaque = (column, row) =>
    column >= 0 && column < columns && row >= 0 && row < rows && sprite[row][column] !== ".";
  return ({ x, y }) => {
    const origin = { x: Math.round(x / ART) * ART, y: Math.round(y / ART) * ART };
    const left = origin.x + spriteLeft, top = origin.y + spriteTop;
    const pixels = () => offsets.map(([ox, oy]) => [origin.x + ox, origin.y + oy]);
    return {
      x: origin.x,
      y: origin.y,
      reach,
      overlapsPixel(pl, pt) {
        // Sprite column c spans [left + 2c, left + 2c + 2); it overlaps the pixel when within 2 of it.
        const c0 = Math.floor((pl - left) / ART), r0 = Math.floor((pt - top) / ART);
        for (let row = r0; row <= r0 + 1; row++) {
          if (Math.abs(top + row * ART - pt) >= ART) continue;
          for (let column = c0; column <= c0 + 1; column++)
            if (Math.abs(left + column * ART - pl) < ART && opaque(column, row)) return true;
        }
        return false;
      },
      distanceTo(px, py) {
        let best = Infinity;
        for (const [pl, pt] of pixels()) best = Math.min(best, distanceToRect(px, py, pl, pt, pl + ART, pt + ART));
        return best;
      },
      segmentDistance(ax, ay, bx, by) {
        let best = Infinity;
        for (const [pl, pt] of pixels()) best = Math.min(best, segmentToRect(ax, ay, bx, by, pl, pt, pl + ART, pt + ART));
        return best;
      },
    };
  };
}

/** The drawn apple, as a shape the player can touch. */
const appleShape = spriteShape(APPLE_SPRITE, SPRITE_LEFT, SPRITE_TOP, REACH);

/**
 * Whether the player touches the apple.
 * @param {{ x: number, y: number }} apple
 * @param {import("./player-shape.js").Player} player
 */
export function playerTouchesApple(apple, player) {
  return playerTouch(appleShape(apple), player) !== null;
}

// The shine crosses the apple every this many seconds, taking this long.
const SHINE_PERIOD = 2.8;
const SHINE_SWEEP = 0.5;

/**
 * Where the shine sweeping across the apple is at `seconds` on the scene
 * clock: a diagonal of the sprite (column + row), or null between sweeps.
 * Each apple sweeps at its own time, so a row of them doesn't flash at once.
 */
export function appleShine(apple, seconds) {
  const phase = (((seconds + apple.x * 0.013) % SHINE_PERIOD) + SHINE_PERIOD) % SHINE_PERIOD;
  if (phase >= SHINE_SWEEP) return null;
  return Math.floor((phase / SHINE_SWEEP) * (COLUMNS + ROWS + 1)) - 1;
}
