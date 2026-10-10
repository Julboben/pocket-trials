// Still scenes for the menu, drawn by the game's own renderer: the trail's real
// terrain, props, background, lighting, bike and rider. Nothing here has art of
// its own, so the menu follows any change to the rider, bike or trails.
import { RADIUS, STEP, WHEELBASE } from './config.js';
import { createRenderer } from './render.js';
import { createRide, stepRide } from './ride.js';
import { createEffects } from './effects.js';
import { terrainAt, terrainGeometry, terrainSurfacesAt } from './terrain.js';
import { finishHeight } from './trail-schema.js';

// How long a resting bike settles onto its suspension, as at the start of a ride.
const SETTLE_STEPS = Math.round(0.5 / STEP);

let scene = null;

function shared() {
  if (!scene) {
    const canvas = document.createElement('canvas');
    scene = { canvas, renderer: createRenderer(canvas), effects: createEffects() };
  }
  return scene;
}

/** The topmost surface height at `x`, or null over a gap. */
function surfaceY(trail, x) {
  const ground = terrainAt(trail, x);
  return ground?.solid === false || !Number.isFinite(ground?.y) ? null : ground.y;
}

/**
 * A ride standing still at `x` (the bike's midpoint). With `air` the bike
 * hovers that far above `ground` (the ground under it by default), wheels level.
 */
export function posedRide(trail, { x = trail.start.x, facing = trail.start.facing, air = 0, lean = 0, ground = null } = {}) {
  const atStart = x === trail.start.x && !air;
  let y = atStart ? trail.start.y : null;
  if (air) {
    const below = ground ?? Math.min(...[x - WHEELBASE / 2, x + WHEELBASE / 2].map(at => surfaceY(trail, at) ?? Infinity));
    y = (Number.isFinite(below) ? below : trail.start.y ?? 0) - RADIUS - air;
  }
  const start = { x, y, facing };
  let ride = createRide(trail, { start });
  if (!air) {
    // Settle with the brake held, so a bike on a slope stays where it is put.
    for (let step = 0; step < SETTLE_STEPS && ride.status === 'running'; step++) stepRide(ride, { braking: true });
    if (ride.status !== 'running') ride = createRide(trail, { start });
    ride.brakePressure = 0;
    ride.started = false;
  }
  ride.leanVisual = lean;
  return ride;
}

/**
 * Draws `trail` with `ride` onto `target`, resizing it to fit.
 * @param {HTMLCanvasElement} target
 * @param {{
 *   trail: any, ride?: any, look?: import('./cosmetics.js').Look | null, full?: boolean, headlights?: boolean,
 *   width: number, height: number, scale?: number,
 *   focus?: { x: number, y: number }, anchor?: [number, number]
 * }} options  A view of `width` × `height` world units, `scale` device pixels per
 *   art pixel. `focus` (the bike's axles by default) lands at `anchor`, as
 *   fractions of the view.
 * @returns {{ x: number, y: number, worldToDevice: number }} the camera used
 */
export function drawScene(target, {
  trail, ride = posedRide(trail), look = null, full = true, headlights = true,
  width, height, scale = 4, focus = null, anchor = [0.5, 0.72]
}) {
  const { canvas, renderer, effects } = shared();
  renderer.setViewport(width, height, scale);
  renderer.reset(trail, ride.facing);
  renderer.setHeadlights(headlights);
  renderer.settleHair(ride, look);
  effects.reset(trail);
  const point = focus || { x: (ride.rear.x + ride.front.x) / 2, y: (ride.rear.y + ride.front.y) / 2 };
  const view = { x: point.x - renderer.width * anchor[0], y: point.y - renderer.height * anchor[1] };
  const camera = { follow() {}, view: () => view };
  renderer.draw({ ride, ghost: null, camera, effects, look, state: 'ready', full, now: 0, dt: 0, debug: false });
  target.width = canvas.width;
  target.height = canvas.height;
  const context = target.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(canvas, 0, 0);
  return { ...view, worldToDevice: canvas.width / renderer.width };
}

/**
 * Draws only `ride`'s bike and rider onto `target`, over `backdrop` (see the
 * renderer's drawFigure), framed as in drawScene. For menu scenes with a
 * setting of their own instead of the trail.
 * @param {HTMLCanvasElement} target
 * @param {{
 *   ride: any, look?: import('./cosmetics.js').Look | null, backdrop?: ((ctx: CanvasRenderingContext2D, view: { x: number, y: number, width: number, height: number }) => void) | null,
 *   width: number, height: number, scale?: number, focus?: { x: number, y: number }, anchor?: [number, number]
 * }} options
 */
export function drawFigure(target, { ride, look = null, backdrop = null, width, height, scale = 4, focus = null, anchor = [0.5, 0.72] }) {
  const { canvas, renderer } = shared();
  renderer.setViewport(width, height, scale);
  renderer.reset(ride.trail, ride.facing);
  renderer.settleHair(ride, look);
  const point = focus || { x: (ride.rear.x + ride.front.x) / 2, y: (ride.rear.y + ride.front.y) / 2 };
  const view = { x: point.x - renderer.width * anchor[0], y: point.y - renderer.height * anchor[1] };
  renderer.drawFigure({ ride, look, view, backdrop });
  target.width = canvas.width;
  target.height = canvas.height;
  const context = target.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(canvas, 0, 0);
}

/**
 * A ride parked far outside the trail, for scenes of the trail alone: nothing
 * of the bike, its shadow or its lights reaches the view.
 */
export function parkedRide(trail) {
  const left = terrainGeometry(trail)?.bounds.left ?? 0;
  return createRide(trail, { start: { x: Math.min(left, trail.start.x) - 100000, y: 0, facing: 1 } });
}

/**
 * The most eventful `width`-wide stretch of a trail between its start and
 * finish: the most climbing and dropping, with gaps counting extra. Stretches
 * showing the start are passed over, as the start looks alike on every trail.
 * @returns {{ x: number, y: number }} the stretch's centre, at its median ground height
 */
export function findHighlight(trail, width) {
  const step = 8, points = surfaceProfile(trail, step);
  const span = Math.max(1, Math.round(width / step));
  let best = null;
  for (let first = 0; first + span <= points.length; first += 2) {
    const window = points.slice(first, first + span);
    let score = 0, previous = null;
    const heights = [];
    for (const { y } of window) {
      if (y === null) { score += 6; previous = null; continue; }
      if (previous !== null) score += Math.abs(y - previous);
      previous = y; heights.push(y);
    }
    if (!heights.length) continue;
    const x = (window[0].x + window[window.length - 1].x) / 2;
    if (Math.abs(x - trail.start.x) < width * .6) score *= .25;
    heights.sort((a, b) => a - b);
    if (!best || score > best.score) best = { score, x, y: heights[heights.length >> 1] };
  }
  return best ? { x: best.x, y: best.y } : { x: trail.start.x, y: surfaceY(trail, trail.start.x) ?? 0 };
}

/**
 * Samples the ground along the route from start to finish, in x order. At each
 * step it follows the floor nearest the last one, so a cave's floor rather
 * than its roof, and up walls; `y` is null over gaps.
 */
function surfaceProfile(trail, step = 8) {
  const direction = trail.finish.x >= trail.start.x ? 1 : -1;
  const count = Math.floor(Math.abs(trail.finish.x - trail.start.x) / step);
  const points = [];
  let previous = trail.start.y ?? surfaceY(trail, trail.start.x);
  for (let index = 0; index <= count; index++) {
    const x = trail.start.x + direction * index * step;
    let y = null;
    for (const surface of terrainSurfacesAt(trail, x)) {
      if (!surface.entering) continue;
      if (y === null || previous === null || Math.abs(surface.y - previous) < Math.abs(y - previous)) y = surface.y;
    }
    if (y !== null) previous = y;
    points.push({ x, y });
  }
  return direction > 0 ? points : points.reverse();
}

/**
 * The steepest rideable climb on the first trail that has one, facing uphill.
 * @returns {{ trail: any, x: number, facing: number } | null}
 */
export function findClimb(trailList, minSlope = 0.35, maxSlope = 0.8) {
  for (const trail of trailList) {
    let best = null;
    for (const { x } of surfaceProfile(trail)) {
      const rear = surfaceY(trail, x - WHEELBASE / 2), front = surfaceY(trail, x + WHEELBASE / 2);
      if (rear === null || front === null) continue;
      const slope = (rear - front) / WHEELBASE;
      if (Math.abs(slope) < minSlope || Math.abs(slope) > maxSlope) continue;
      if (!best || Math.abs(slope) > best.slope) best = { trail, x, facing: Math.sign(slope), slope: Math.abs(slope) };
    }
    if (best) return best;
  }
  return null;
}

/**
 * The biggest drop-off on the first trail that has one, where a rider takes
 * off: `x` is just past the lip, facing the drop.
 * @returns {{ trail: any, x: number, lip: number, facing: number } | null}
 */
export function findJump(trailList, minDrop = 40) {
  for (const trail of trailList) {
    let best = null;
    for (const { x, y } of surfaceProfile(trail)) {
      // Only out in the open, where a posed bike stands on the route.
      if (y === null || y !== surfaceY(trail, x)) continue;
      for (const facing of [1, -1]) {
        const beyond = surfaceY(trail, x + facing * 40);
        const drop = beyond === null ? Infinity : beyond - y;
        if (drop >= minDrop && (!best || Math.min(drop, 400) > best.drop))
          best = { trail, x: x + facing * WHEELBASE * 0.6, lip: y, facing, drop: Math.min(drop, 400) };
      }
    }
    if (best) return best;
  }
  return null;
}

/** A rider arriving at the finish of `trail` with every apple collected. */
export function finishScene(trail) {
  const goal = { x: trail.finish.x, y: finishHeight(trail) };
  const facing = goal.x >= trail.start.x ? 1 : -1;
  const ride = posedRide(trail, { x: goal.x - facing * 70, facing });
  for (const apple of ride.apples) apple.taken = true;
  ride.collected = ride.apples.length;
  return { ride, focus: { x: goal.x - facing * 35, y: goal.y } };
}
