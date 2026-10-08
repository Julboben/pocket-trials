import {
  compileTerrain, terrainContacts, terrainSweep, terrainSurfaceBelow, terrainSurfaces,
  terrainShadowSamples, terrainRaycast,
} from './terrain-runtime.js';
import { isBackWall, trailTerrainBlocks, trailBackWalls } from './trail-schema.js';

const geometryCache = new WeakMap();
const backWallCache = new WeakMap();

/**
 * Forget a trail's compiled terrain. Anything that edits a trail's geometry in
 * place must call this before the next query; the game never edits a trail
 * while it is being ridden, so it only matters to the editor.
 */
export function invalidateTerrain(trail) {
  geometryCache.delete(trail);
  backWallCache.delete(trail);
}

/**
 * The compiled terrain of a trail, or null when it has no blocks.
 *
 * Compiled once per trail and reused by physics, queries, and rendering until
 * the trail is invalidated. A ride's copy of a trail with glass (see
 * glass.js) shares its source's terrain until a pane breaks.
 */
export function terrainGeometry(trail) {
  if (trail?.brokenBlocks && !trail.brokenBlocks.size) return terrainGeometry(trail.terrainSource);
  if (!trail || !Array.isArray(trail.terrainBlocks) || !trail.terrainBlocks.length) return null;
  const cached = geometryCache.get(trail);
  if (cached) return cached;
  if (trail.terrainBlocks.every(isBackWall)) return null;
  const compiled = compileTerrain({ terrainBlocks: trailTerrainBlocks(trail), brokenBlocks: trail.brokenBlocks });
  geometryCache.set(trail, compiled);
  return compiled;
}

/** How far below the lowest terrain the bike is considered lost. */
export const FALL_MARGIN = 200;
const NO_TERRAIN_FALL_Y = 620;

/**
 * The height below which the bike is lost: a little under the lowest solid
 * terrain, so it follows the trail wherever it is built. It reads the intact
 * source terrain, so breaking a glass pane never moves it mid-ride.
 */
export function fallLine(trail) {
  const bottom = terrainGeometry(trail?.terrainSource || trail)?.bounds.bottom;
  return Number.isFinite(bottom) ? bottom + FALL_MARGIN : NO_TERRAIN_FALL_Y;
}

/**
 * Takes a block out of a ride's copy of a trail, recording `info` about how
 * it went. The next query compiles the terrain without it.
 */
export function breakTerrainBlock(trail, blockId, info) {
  trail.brokenBlocks.set(blockId, info);
  geometryCache.delete(trail);
}

/**
 * The compiled back walls of a trail, or null when it has none. Back walls are
 * scenery behind the rider: nothing collides with them, but they close a cave
 * off from the sky behind it, so it stays dark.
 */
export function backWallGeometry(trail) {
  if (trail?.terrainSource) return backWallGeometry(trail.terrainSource);
  if (!trail || !Array.isArray(trail.terrainBlocks)) return null;
  if (backWallCache.has(trail)) return backWallCache.get(trail);
  const walls = trailBackWalls(trail);
  const compiled = walls.length ? compileTerrain({ terrainBlocks: walls }) : null;
  backWallCache.set(trail, compiled);
  return compiled;
}

export function terrainSurfacesAt(trail, x) {
  const blocks = terrainGeometry(trail);
  if (!blocks) return [];
  return terrainSurfaces(blocks, x).map(surface => ({
    y: surface.y, slope: surface.slope, solid: true, material: surface.material,
    entering: surface.entering, blockId: surface.blockId,
  }));
}

export function terrainCollisionsAt(trail, x, y, radius) {
  const blocks = terrainGeometry(trail);
  return blocks ? terrainContacts(blocks, x, y, radius) : [];
}

export function terrainSweepCollision(trail, fromX, fromY, toX, toY, radius) {
  const blocks = terrainGeometry(trail);
  return blocks ? terrainSweep(blocks, fromX, fromY, toX, toY, radius) : null;
}

/** Where a line first enters the terrain, or null; see terrainRaycast. */
export function terrainRaycastAt(trail, fromX, fromY, toX, toY) {
  const blocks = terrainGeometry(trail);
  return blocks ? terrainRaycast(blocks, fromX, fromY, toX, toY) : null;
}

/**
 * The topmost surface at or below `referenceY` at x. With no reference it is
 * the topmost surface at that x, which is what a start position or a
 * ground-anchored prop settles onto.
 */
export function terrainAt(trail, x, referenceY = null) {
  const blocks = terrainGeometry(trail);
  const surface = blocks && terrainSurfaceBelow(blocks, x, referenceY);
  if (surface) return { y: surface.y, slope: surface.slope, solid: true, material: surface.material };
  return { y: fallLine(trail), slope: 0, solid: false, material: 'grass' };
}

export function groundShadowSamples(trail, x, referenceY, width, step = 2, center = x) {
  const blocks = terrainGeometry(trail);
  return blocks ? terrainShadowSamples(blocks, x, referenceY, width, step, center) : [];
}

export function seatedSurfaceAt(trail, x, y, tolerance = 12) {
  if (y == null || !Number.isFinite(y)) {
    const ground = terrainAt(trail, x);
    return ground.solid ? ground : null;
  }
  let nearest = null;
  for (const surface of terrainSurfacesAt(trail, x)) {
    const distance = Math.abs(surface.y - y);
    if (distance > tolerance || (nearest && distance >= Math.abs(nearest.y - y))) continue;
    nearest = surface;
  }
  return nearest;
}
