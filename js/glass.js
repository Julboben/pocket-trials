// @ts-check
// Glass: terrain that can break during a ride. Each pane is judged by its
// thickness and span, measured from its shape at whatever angle it lies
// (`paneSize`). A thick pane is like any other terrain; a thin one has a strength worked out
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
import { ringArea } from './terrain-geometry.js';
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

/**
 * A pane's thickness and span: the sides of the rectangle with the same area
 * and perimeter. That is exact for a rectangle at any angle, and a bent or
 * curved strip measures as the straight strip it would unroll into. A shape
 * too round for any rectangle to match is measured as a square.
 * @param {number[][][]} rings outer ring first, then holes
 */
export function paneSize(rings) {
  let area = 0,
    perimeter = 0;
  rings.forEach((ring, index) => {
    area += Math.abs(ringArea(ring)) * (index ? -1 : 1);
    for (let point = 0; point < ring.length; point++) {
      const [ax, ay] = ring[point],
        [bx, by] = ring[(point + 1) % ring.length];
      perimeter += Math.hypot(bx - ax, by - ay);
    }
  });
  area = Math.max(area, 0);
  const half = perimeter / 2;
  const discriminant = half * half - 4 * area;
  if (discriminant <= 0) return { thickness: Math.sqrt(area), span: Math.sqrt(area) };
  const thickness = (half - Math.sqrt(discriminant)) / 2;
  return { thickness, span: half - thickness };
}

/** Whether a point is inside a ring, by the even-odd rule. */
function insideRing(ring, x, y) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index],
      [bx, by] = ring[previous];
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
  }
  return inside;
}

const insidePane = (pane, x, y) =>
  insideRing(pane.rings[0], x, y) && !pane.rings.slice(1).some((hole) => insideRing(hole, x, y));

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
    const { thickness, span } = paneSize(body.rings);
    byId.set(body.blockId, {
      bounds: { left, right, top, bottom },
      rings: body.rings,
      thickness,
      span,
      strength: glassStrength(thickness, span),
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
      const [cx, cy] = intoPane(pane, x, y, contact.nx, contact.ny);
      trail.glassCracks.push({
        blockId: contact.blockId,
        x: cx,
        y: cy,
        speed,
        severity: Math.min(1, speed / pane.strength),
      });
    }
    return false;
  }
  breakTerrainBlock(trail, contact.blockId, { x, y, speed, ...pane.bounds, rings: pane.rings });
  return true;
}

// The first point inside the pane going in from (x, y) against the outward
// normal: contacts lie on the surface, and swept ones at the wheel's centre.
function intoPane(pane, x, y, nx, ny) {
  for (let step = 1; step <= 40; step++)
    if (insidePane(pane, x - nx * step, y - ny * step)) return [x - nx * step, y - ny * step];
  return [x, y];
}

/** A pane on a ride's trail, for drawing its cracks. */
export function glassPane(trail, blockId) {
  return trail?.terrainSource ? glassPanes(trail.terrainSource).get(blockId) ?? null : null;
}

/** Whether (x, y) is inside the glass outlined by `rings` (outer ring first, then holes). */
export const inGlass = (rings, x, y) => insidePane({ rings }, x, y);

const crackShapes = new WeakMap();

/**
 * The lines of a crack as polylines in world units, kept inside the pane.
 * Harder hits crack further and in more directions. The shape is seeded by
 * where the hit was, so it is the same every time it is drawn.
 */
export function crackLines(crack, pane) {
  const cached = crackShapes.get(crack);
  if (cached) return cached;
  let seed = (Math.round(crack.x * 7) * 73856093) ^ (Math.round(crack.y * 7) * 19349663);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rays = 3 + Math.round(crack.severity * 3);
  const reach = 8 + crack.severity * 32;
  const lines = [];
  for (let ray = 0; ray < rays; ray++) {
    let angle = ((ray + random() * 0.6) / rays) * TAU;
    let x = crack.x,
      y = crack.y;
    const line = [[x, y]];
    // Each segment runs on until it would leave the glass, and the ray ends there.
    for (let segment = 0, length = reach * (0.6 + random() * 0.6); segment < 3; segment++) {
      angle += (random() - 0.5) * 0.9;
      const dx = Math.cos(angle),
        dy = Math.sin(angle);
      let run = 0;
      while (run < length / 3 && insidePane(pane, x + dx * (run + 1), y + dy * (run + 1))) run++;
      if (!run) break;
      x += dx * run;
      y += dy * run;
      line.push([x, y]);
      if (run < length / 3) break;
    }
    if (line.length > 1) lines.push(line);
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
