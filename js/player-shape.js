// @ts-check
// The player's hitbox for touching things: the tyres as drawn, the frame
// between the axles, and the rider's head, shoulder and hip. Apples and
// spikes describe their own drawn shape and ask whether the player touches it.
import { distanceToSegment } from "./finish.js";
import { hypot } from "./det-math.js";

export const ART = 2;

/**
 * @typedef {{
 *   x: number, y: number, reach: number,
 *   overlapsPixel(left: number, top: number): boolean,
 *   distanceTo(x: number, y: number): number,
 *   segmentDistance(ax: number, ay: number, bx: number, by: number): number,
 * }} Shape
 * A drawn shape: `reach` bounds it around (x, y); `overlapsPixel` tests a
 * 2 × 2 art pixel by its top-left corner; distances are 0 inside the shape.
 *
 * @typedef {{
 *   rear: { x: number, y: number, px?: number, py?: number },
 *   front: { x: number, y: number, px?: number, py?: number },
 *   frameReach: number,
 *   probes: Array<{ x: number, y: number, radius: number }>,
 * }} Player
 */

// The tyre as drawn: the art pixels within 6.5 of the hub, each drawn from
// (2i, 2j) to (2i + 2, 2j + 2) relative to the wheel's centre.
const WHEEL_CELLS = 6;
const inWheel = (i, j) => Math.hypot(i, j) <= 6.5;
/** The tyre's outer pixels; anything reaching the tyre crosses them first. */
const WHEEL_EDGE = [];
for (let j = -WHEEL_CELLS; j <= WHEEL_CELLS; j++)
  for (let i = -WHEEL_CELLS; i <= WHEEL_CELLS; i++)
    if (inWheel(i, j) && !(inWheel(i - 1, j) && inWheel(i + 1, j) && inWheel(i, j - 1) && inWheel(i, j + 1)))
      WHEEL_EDGE.push([i * ART, j * ART]);
const WHEEL_REACH = (WHEEL_CELLS + 1) * ART * Math.SQRT2;
// Swept wheels are sampled at most this far apart, under half a pixel.
const SWEEP_STEP = 0.75;

/** Distance from a point to an axis-aligned rectangle; 0 inside it. */
export function distanceToRect(px, py, left, top, right, bottom) {
  return hypot(Math.max(left - px, 0, px - right), Math.max(top - py, 0, py - bottom));
}

/** Whether segments AB and CD properly cross. */
export function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Distance from a segment to an axis-aligned rectangle; 0 when they meet. */
export function segmentToRect(ax, ay, bx, by, left, top, right, bottom) {
  if (distanceToRect(ax, ay, left, top, right, bottom) === 0 || distanceToRect(bx, by, left, top, right, bottom) === 0)
    return 0;
  if (segmentsCross(ax, ay, bx, by, left, top, right, bottom) || segmentsCross(ax, ay, bx, by, right, top, left, bottom))
    return 0;
  return Math.min(
    distanceToSegment(left, top, ax, ay, bx, by),
    distanceToSegment(right, top, ax, ay, bx, by),
    distanceToSegment(left, bottom, ax, ay, bx, by),
    distanceToSegment(right, bottom, ax, ay, bx, by),
    distanceToRect(ax, ay, left, top, right, bottom),
    distanceToRect(bx, by, left, top, right, bottom),
  );
}

/** Whether the drawn tyre centred at (wx, wy) overlaps the shape. */
function wheelTouches(shape, wx, wy) {
  if (hypot(wx - shape.x, wy - shape.y) > shape.reach + WHEEL_REACH) return null;
  // A shape small enough to sit inside the tyre has its centre inside it.
  if (inWheel(Math.floor((shape.x - wx) / ART), Math.floor((shape.y - wy) / ART))) return { x: shape.x, y: shape.y };
  for (const [ox, oy] of WHEEL_EDGE) {
    const left = wx + ox, top = wy + oy;
    if (hypot(left + ART / 2 - shape.x, top + ART / 2 - shape.y) > shape.reach + ART) continue;
    if (shape.overlapsPixel(left, top)) return { x: left + ART / 2, y: top + ART / 2 };
  }
  return null;
}

/**
 * Where the player touches the shape, or null. Wheels are swept along this
 * step's travel so a fast bike cannot skip past.
 *
 * @param {Shape} shape
 * @param {Player} player
 * @returns {{ x: number, y: number } | null}
 */
export function playerTouch(shape, player) {
  const { rear, front } = player;
  for (const wheel of [rear, front]) {
    const fromX = wheel.px ?? wheel.x, fromY = wheel.py ?? wheel.y;
    if (distanceToSegment(shape.x, shape.y, fromX, fromY, wheel.x, wheel.y) > shape.reach + WHEEL_REACH) continue;
    const samples = Math.max(1, Math.ceil(hypot(wheel.x - fromX, wheel.y - fromY) / SWEEP_STEP));
    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      const touch = wheelTouches(shape, fromX + (wheel.x - fromX) * t, fromY + (wheel.y - fromY) * t);
      if (touch) return touch;
    }
  }
  for (const probe of player.probes) {
    if (hypot(probe.x - shape.x, probe.y - shape.y) > shape.reach + probe.radius) continue;
    if (shape.distanceTo(probe.x, probe.y) < probe.radius) return { x: probe.x, y: probe.y };
  }
  if (distanceToSegment(shape.x, shape.y, rear.x, rear.y, front.x, front.y) < shape.reach + player.frameReach &&
    shape.segmentDistance(rear.x, rear.y, front.x, front.y) < player.frameReach) {
    const dx = front.x - rear.x, dy = front.y - rear.y;
    const t = Math.max(0, Math.min(1, ((shape.x - rear.x) * dx + (shape.y - rear.y) * dy) / (dx * dx + dy * dy || 1)));
    return { x: rear.x + dx * t, y: rear.y + dy * t };
  }
  return null;
}
