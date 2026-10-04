// @ts-check
// Water: rectangles of still water that fill the open air inside them. The top
// of the rectangle is the surface; terrain inside it stays solid, so a body
// drawn over a pit fills the pit, and one drawn inside a cave floods the cave.
//
// Everything here that touches the simulation uses plain arithmetic and
// det-math only, so rides and replays stay deterministic.
import { GRAVITY, STEP, clamp } from "./config.js";
import { hypot } from "./det-math.js";
import { terrainColumnSpans } from "./terrain-runtime.js";

/** @typedef {import('./types.js').Water} Water */

/** Sizes in world units. A new body gets the defaults. */
export const WATER_SIZE = {
  minWidth: 16,
  minDepth: 8,
  width: 240,
  depth: 32,
};

/**
 * A wheel deeper than this below the surface wipes the rider out, so a body
 * up to this deep is a rideable ford and anything deeper is a hazard. It is
 * about where the water reaches the seat.
 */
export const WATER_WIPEOUT_DEPTH = 40;

// How water pushes on what is in it. Buoyancy is a share of gravity at full
// submersion: the bike sinks slowly, the rider floats. Drag slows anything in
// the water, more the faster it goes, so a rider dropping in hits it with a
// slap. Spin is how fast water brakes a wheel's rotation.
export const BIKE_WATER = { buoyancy: 0.35, drag: 1.1, quadratic: 0.0035, spin: 1.6 };
export const RAGDOLL_WATER = { buoyancy: 1.7, drag: 2.4, quadratic: 0.012, spin: 0 };

// Thickness the rider's limbs and the chassis present to the water, which
// sets how gently they settle at the surface.
export const RAGDOLL_WATER_RADIUS = 8;
export const CHASSIS_WATER_RADIUS = 8;

export const WATER_COLORS = {
  body: "#3f9fc466",
  deep: "#1f5f8a55",
  shine: "#8fd6e888",
  foam: "#e4f7f4cc",
  splash: ["#e4f7f4", "#8fd6e8", "#5fb4d4"],
};

// Speed into the water, in world units a second, that throws up a splash.
export const SPLASH_SPEED = 90;

/**
 * Normalize a water body. Missing or invalid sizes get the defaults, and sizes
 * below the minimum are raised to it.
 * @returns {Water}
 */
export function normalizeWater(body) {
  const size = (value, min, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.max(min, number) : fallback;
  };
  return {
    x: Number.isFinite(Number(body?.x)) ? Number(body.x) : 0,
    y: Number.isFinite(Number(body?.y)) ? Number(body.y) : 0,
    width: size(body?.width, WATER_SIZE.minWidth, WATER_SIZE.width),
    depth: size(body?.depth, WATER_SIZE.minDepth, WATER_SIZE.depth),
  };
}

/** A trail's water bodies, normalized. */
export function waterBodies(trail) {
  return Array.isArray(trail?.water) ? trail.water.map(normalizeWater) : [];
}

/** Can a body of this depth wipe the rider out? */
export const deepWater = (depth) => depth > WATER_WIPEOUT_DEPTH;

/** The body whose rectangle holds a point, or null. */
export function waterAt(bodies, x, y) {
  for (const body of bodies)
    if (
      x >= body.x &&
      x <= body.x + body.width &&
      y >= body.y &&
      y <= body.y + body.depth
    )
      return body;
  return null;
}

/**
 * How much of a disc is under water: 0 dry, 1 fully submerged, measured from
 * the surface down and cut off at the bottom of the body. The most submerged
 * body wins where bodies overlap.
 */
export function submergedFraction(bodies, x, y, radius) {
  let best = 0;
  for (const body of bodies) {
    if (x < body.x || x > body.x + body.width) continue;
    const below = clamp((y + radius - body.y) / (2 * radius), 0, 1);
    const above = clamp((body.y + body.depth - (y - radius)) / (2 * radius), 0, 1);
    best = Math.max(best, Math.min(below, above));
  }
  return best;
}

/**
 * Drag and buoyancy on a Verlet point, by changing its velocity (`x - ox`)
 * ahead of the next integration. Returns how submerged the point is.
 */
export function applyWater(point, radius, bodies, params) {
  const submerged = submergedFraction(bodies, point.x, point.y, radius);
  if (!submerged) return 0;
  let vx = point.x - point.ox,
    vy = point.y - point.oy;
  const speed = hypot(vx, vy) / STEP;
  const keep = Math.max(
    0,
    1 - STEP * submerged * (params.drag + params.quadratic * speed),
  );
  vx *= keep;
  vy = vy * keep - params.buoyancy * GRAVITY * submerged * STEP * STEP;
  point.ox = point.x - vx;
  point.oy = point.y - vy;
  if (params.spin && point.angularVelocity)
    point.angularVelocity *= Math.max(0, 1 - STEP * submerged * params.spin);
  return submerged;
}

/**
 * How far under the surface the bottom of a wheel is, in the body that holds
 * its centre, or 0 when it is not in water. The body's floor caps it, so a
 * body no deeper than the wipe-out depth can never wipe the rider out.
 */
export function wheelImmersion(bodies, x, y, radius) {
  let deepest = 0;
  for (const body of bodies) {
    if (x < body.x || x > body.x + body.width) continue;
    if (y < body.y || y > body.y + body.depth) continue;
    deepest = Math.max(deepest, Math.min(y + radius, body.y + body.depth) - body.y);
  }
  return deepest;
}

/**
 * The body whose surface a point crossed going down between two positions,
 * or null.
 */
export function surfaceCrossing(bodies, fromX, fromY, toX, toY) {
  for (const body of bodies)
    if (
      fromY < body.y &&
      toY >= body.y &&
      toX >= body.x &&
      toX <= body.x + body.width
    )
      return body;
  return null;
}

// ---- Drawing ---------------------------------------------------------------

/**
 * How far the drawn surface has risen (negative) or fallen at an x, in whole
 * art pixels: the ripples. Floating props ride them too.
 */
export function surfaceWave(x, time) {
  return (
    Math.round(
      Math.sin(x * 0.07 + time * 2.4) * 0.8 + Math.sin(x * 0.023 - time * 1.1) * 0.7,
    ) * 2
  );
}

// Which parts of a body are open water, column by column: the rectangle minus
// the terrain. Cached per compiled terrain, so it is only worked out again
// when the terrain or the body changes.

const columnCache = new WeakMap();
const NO_TERRAIN = {};
const CACHE_LIMIT = 96;

/**
 * Open-water segments of a body in columns `step` wide on the world's pixel
 * grid: `[{ x, segments: [[top, bottom], ...] }]`.
 * @param {any} compiled terrain from `terrainGeometry`, or null
 * @param {Water} body
 */
export function waterColumns(compiled, body, step = 2) {
  const owner = compiled || NO_TERRAIN;
  let cache = columnCache.get(owner);
  if (!cache) columnCache.set(owner, (cache = new Map()));
  const key = `${body.x},${body.y},${body.width},${body.depth},${step}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const columns = [];
  const top = body.y,
    bottom = body.y + body.depth;
  const first = Math.floor(body.x / step) * step;
  for (let x = first; x < body.x + body.width; x += step) {
    let segments = [[top, bottom]];
    const spans = compiled ? terrainColumnSpans(compiled, x + step / 2) : [];
    for (const span of spans) {
      if (span.bottom <= top || span.top >= bottom) continue;
      const next = [];
      for (const [a, b] of segments) {
        if (span.bottom <= a || span.top >= b) {
          next.push([a, b]);
          continue;
        }
        if (span.top > a) next.push([a, span.top]);
        if (span.bottom < b) next.push([span.bottom, b]);
      }
      segments = next;
    }
    segments = segments.filter(([a, b]) => b - a >= 1);
    if (segments.length) columns.push({ x, segments });
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, columns);
  return columns;
}
