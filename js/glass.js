// @ts-check
// Glass: terrain that can break during a ride. Each pane is judged by its
// bounding box: thickness is its shorter side and span its longer one. A
// thick pane is like any other terrain; a thin one shatters on
// a fast hit, and a thin pane that is also wide gives way under any weight.
//
// A ride on a trail with glass gets its own copy of the trail (`rideTerrain`),
// so a broken pane is gone for that ride alone: ghosts, restarts and the
// editor all keep the trail whole. Whether a pane breaks depends only on the
// simulation, so replays break the same panes on the same steps.
import {
  STEP,
  CONTACT_GROUNDED_NORMAL,
  GLASS_THIN_THICKNESS,
  GLASS_WIDE_SPAN,
  GLASS_SHATTER_SPEED,
  GLASS_BREAK_DRAG,
} from './config.js';
import { breakTerrainBlock, terrainGeometry } from './terrain.js';
import { trailTerrainBlocks } from './trail-schema.js';

export const GLASS = 'glass';

/**
 * The trail as one ride sees it: the trail itself when it has no glass,
 * otherwise a copy that can lose panes as they break.
 * @param {import('./types.js').Trail} trail
 * @returns {import('./types.js').Trail}
 */
export function rideTerrain(trail) {
  if (!trailTerrainBlocks(trail).some((block) => block.material === GLASS)) return trail;
  return { ...trail, terrainSource: trail, brokenBlocks: new Map() };
}

const panes = new WeakMap();

/** Every glass pane on the trail by block id, with its size class. */
function glassPanes(source) {
  const compiled = terrainGeometry(source);
  let byId = panes.get(compiled);
  if (byId) return byId;
  byId = new Map();
  for (const body of compiled?.bodies || []) {
    if (body.material !== GLASS) continue;
    const { left, right, top, bottom } = body.bounds;
    // A pane lies along its longer side, so an upright pane is a wall that
    // the bike can ride into.
    const width = right - left,
      height = bottom - top;
    byId.set(body.blockId, {
      bounds: { left, right, top, bottom },
      thin: Math.min(width, height) < GLASS_THIN_THICKNESS,
      wide: Math.max(width, height) > GLASS_WIDE_SPAN,
    });
  }
  panes.set(compiled, byId);
  return byId;
}

/**
 * Whether `contact` is with glass that gives way to something moving by
 * (`vx`, `vy`) this step, breaking the pane if this is what breaks it. True
 * also for a pane that broke earlier in the step: the caller ignores the
 * contact either way.
 */
export function shatterGlass(trail, contact, vx, vy) {
  if (contact?.material !== GLASS || !trail?.brokenBlocks) return false;
  if (trail.brokenBlocks.has(contact.blockId)) return true;
  const pane = glassPanes(trail.terrainSource).get(contact.blockId);
  if (!pane?.thin) return false;
  const speed = -(vx * contact.nx + vy * contact.ny) / STEP;
  const loaded = contact.ny < CONTACT_GROUNDED_NORMAL;
  if (speed < GLASS_SHATTER_SPEED && !(pane.wide && loaded)) return false;
  breakTerrainBlock(trail, contact.blockId, {
    x: contact.pointX ?? contact.x,
    y: contact.pointY ?? contact.y,
    speed: Math.max(0, speed),
    ...pane.bounds,
  });
  return true;
}

/**
 * `shatterGlass` for a Verlet point: a point that breaks a pane loses part of
 * its speed into it, and goes on through.
 */
export function passThroughGlass(trail, point, contact) {
  const vx = point.x - point.ox,
    vy = point.y - point.oy;
  const broken = trail?.brokenBlocks;
  const already = broken?.has(contact?.blockId);
  if (!shatterGlass(trail, contact, vx, vy)) return false;
  const into = vx * contact.nx + vy * contact.ny;
  if (!already && into < 0) {
    point.ox += contact.nx * into * GLASS_BREAK_DRAG;
    point.oy += contact.ny * into * GLASS_BREAK_DRAG;
  }
  return true;
}
