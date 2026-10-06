// @ts-check
// Glass: terrain that can break during a ride. Each pane is judged by its
// bounding box: thickness is its shorter side and span its longer one. A
// thick pane is like any other terrain; a thin one has a strength worked out
// from its size (`glassStrength`) and shatters only when hit harder than that.
//
// A ride on a trail with glass gets its own copy of the trail (`rideTerrain`),
// so a broken pane is gone for that ride alone: ghosts, restarts and the
// editor all keep the trail whole. Whether a pane breaks depends only on the
// simulation, so replays break the same panes on the same steps.
import {
  STEP,
  CONTACT_GROUNDED_NORMAL,
  GLASS_THIN_THICKNESS,
  GLASS_REFERENCE_THICKNESS,
  GLASS_REFERENCE_SPAN,
  GLASS_REFERENCE_STRENGTH,
  GLASS_WEIGHT_IMPACT,
  GLASS_CRACK_SHARE,
  GLASS_CRACK_LOSS,
  GLASS_CRACK_SETTLE,
  GLASS_BREAK_DRAG,
  TAU,
} from './config.js';
import { breakTerrainBlock, terrainGeometry } from './terrain.js';
import { trailTerrainBlocks } from './trail-schema.js';

export const GLASS = 'glass';

// Both wheels of one landing hit a pane within this many steps of each other.
const GLASS_CRACK_SETTLE_STEPS = Math.round(GLASS_CRACK_SETTLE / STEP);

/**
 * The trail as one ride sees it: the trail itself when it has no glass,
 * otherwise a copy that can lose panes as they break.
 * @param {import('./types.js').Trail} trail
 * @returns {import('./types.js').Trail}
 */
export function rideTerrain(trail) {
  if (!trailTerrainBlocks(trail).some((block) => block.material === GLASS)) return trail;
  return {
    ...trail,
    terrainSource: trail,
    brokenBlocks: new Map(),
    paneStrength: new Map(),
    glassCracks: [],
    glassClock: 0,
  };
}

/**
 * The hit speed (px/s, into the pane) a pane takes before it shatters:
 * Infinity for thick glass, less the thinner and longer the pane is.
 */
export function glassStrength(thickness, span) {
  if (thickness >= GLASS_THIN_THICKNESS) return Infinity;
  return (
    GLASS_REFERENCE_STRENGTH *
    (thickness / GLASS_REFERENCE_THICKNESS) *
    Math.sqrt(GLASS_REFERENCE_SPAN / Math.max(span, 1))
  );
}

const panes = new WeakMap();

/** Every glass pane on the trail by block id, with its strength. */
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
      strength: glassStrength(Math.min(width, height), Math.max(width, height)),
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
  if (!pane || pane.strength === Infinity) return false;
  const speed = Math.max(0, -(vx * contact.nx + vy * contact.ny) / STEP);
  const loaded = contact.ny < CONTACT_GROUNDED_NORMAL;
  const impact = loaded ? Math.max(speed, GLASS_WEIGHT_IMPACT) : speed;
  // Hits within the settle time of a crack are one landing: they are measured
  // against the strength from before it, and the hardest decides the damage.
  const state = trail.paneStrength.get(contact.blockId);
  const settling = state && trail.glassClock <= state.until;
  const strength = !state ? pane.strength : settling ? state.before : state.strength;
  const x = contact.pointX ?? contact.x,
    y = contact.pointY ?? contact.y;
  if (impact <= strength) {
    if (speed > strength * GLASS_CRACK_SHARE) {
      const left = strength - speed * GLASS_CRACK_LOSS;
      trail.paneStrength.set(contact.blockId, settling
        ? { ...state, strength: Math.min(state.strength, left) }
        : { before: strength, strength: left, until: trail.glassClock + GLASS_CRACK_SETTLE_STEPS });
      trail.glassCracks.push({
        blockId: contact.blockId,
        x: Math.min(Math.max(x, pane.bounds.left), pane.bounds.right),
        y: Math.min(Math.max(y, pane.bounds.top), pane.bounds.bottom),
        speed,
        severity: Math.min(1, speed / pane.strength),
      });
    }
    return false;
  }
  breakTerrainBlock(trail, contact.blockId, { x, y, speed, ...pane.bounds });
  return true;
}

/** The pane a crack is in, for drawing it: its bounding box. */
export function paneBounds(trail, blockId) {
  return trail?.terrainSource ? glassPanes(trail.terrainSource).get(blockId)?.bounds ?? null : null;
}

const crackShapes = new WeakMap();

/**
 * The lines of a crack as polylines in world units, kept inside the pane.
 * Harder hits crack further and in more directions. The shape is seeded by
 * where the hit was, so it is the same every time it is drawn.
 */
export function crackLines(crack, bounds) {
  const cached = crackShapes.get(crack);
  if (cached) return cached;
  let seed = (Math.round(crack.x * 7) * 73856093) ^ (Math.round(crack.y * 7) * 19349663);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inside = (x, y) => [
    Math.min(Math.max(x, bounds.left + 1), bounds.right - 1),
    Math.min(Math.max(y, bounds.top + 1), bounds.bottom - 1),
  ];
  const rays = 3 + Math.round(crack.severity * 3);
  const reach = 8 + crack.severity * 32;
  const lines = [];
  for (let ray = 0; ray < rays; ray++) {
    let angle = ((ray + random() * 0.6) / rays) * TAU;
    let [x, y] = inside(crack.x, crack.y);
    const line = [[x, y]];
    for (let segment = 0, length = reach * (0.6 + random() * 0.6); segment < 3; segment++) {
      angle += (random() - 0.5) * 0.9;
      [x, y] = inside(x + Math.cos(angle) * length / 3, y + Math.sin(angle) * length / 3);
      line.push([x, y]);
    }
    lines.push(line);
  }
  crackShapes.set(crack, lines);
  return lines;
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
