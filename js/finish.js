// @ts-check
// The finish is a flower the bike has to touch, not a line it has to cross.
// Only geometry lives here so the ride, the level checks and the editor all
// agree on where the flower is and what counts as hitting it.
import { RADIUS } from './config.js';
import { hypot } from './det-math.js';

/** How far above its ground anchor the flower's centre floats. */
export const FINISH_FLOWER_LIFT = 22;
/** The reach of the flower's petals; touching them finishes the run. */
export const FINISH_FLOWER_RADIUS = 16;
// The frame between the axles counts as part of the bike, a little thicker than a line.
const FRAME_REACH = 6;

/**
 * The distance from a point to a segment.
 * @param {number} px @param {number} py
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 */
export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Whether any part of the bike or its rider is touching the flower. Wheels and
 * the frame are checked along the path they travelled this step, so a fast
 * bike cannot skip over the flower between two steps.
 *
 * @param {{ x: number, y: number }} flower the flower's centre
 * @param {{
 *   rear: { x: number, y: number, px?: number, py?: number },
 *   front: { x: number, y: number, px?: number, py?: number },
 *   probes?: Array<{ x: number, y: number, radius: number }>,
 * }} bike
 */
export function bikeTouchesFlower(flower, bike) {
  const { rear, front } = bike;
  for (const wheel of [rear, front]) {
    const fromX = wheel.px ?? wheel.x, fromY = wheel.py ?? wheel.y;
    if (distanceToSegment(flower.x, flower.y, fromX, fromY, wheel.x, wheel.y) < RADIUS + FINISH_FLOWER_RADIUS) return true;
  }
  if (distanceToSegment(flower.x, flower.y, rear.x, rear.y, front.x, front.y) < FRAME_REACH + FINISH_FLOWER_RADIUS) return true;
  for (const probe of bike.probes || []) {
    if (hypot(probe.x - flower.x, probe.y - flower.y) < probe.radius + FINISH_FLOWER_RADIUS) return true;
  }
  return false;
}
