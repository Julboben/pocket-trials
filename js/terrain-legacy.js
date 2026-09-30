// Legacy terrain (ground line, gaps, islands, thick paths) expressed as unified
// terrain blocks.
//
// The same conversion serves two purposes. At runtime it lets a level that
// still carries legacy terrain next to its blocks be compiled as one world, and
// in the editor it is the migration that turns that legacy terrain into
// ordinary editable blocks. Because both use one conversion, migrating a
// half-rebuilt level does not move anything the rider can touch.
//
// Every conversion is deterministic and stays within a stated tolerance of the
// legacy shape it replaces.

import { cos, sin } from './det-math.js';
import { normalizeBlock } from './terrain-geometry.js';

/** Largest vertical distance between a legacy cosine curve and its Bézier. */
export const LEGACY_CURVE_TOLERANCE = 0.25;

/** Largest distance between a thick path's true outline and its polygon. */
export const LEGACY_PATH_TOLERANCE = 0.5;

// How far below the lowest ground point, or the kill plane, the converted
// ground block reaches. The legacy ground had no bottom at all; this is deep
// enough that nothing can ever be seen or ridden beneath it.
const GROUND_DEPTH = 400;

// Sample spacing of the path distance field. The outline is interpolated along
// grid edges, so its error is a small fraction of this even on tight caps.
const PATH_GRID = 2;

// ---------------------------------------------------------------------------
// Cosine curves
// ---------------------------------------------------------------------------

/** The legacy ground curve and its slope at x, matching terrain.js curveAt. */
function cosineAt(points, x) {
  if (x <= points[0][0]) return { y: points[0][1], slope: 0 };
  const last = points[points.length - 1];
  if (x >= last[0]) return { y: last[1], slope: 0 };
  let low = 1, high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (x <= points[middle][0]) high = middle; else low = middle + 1;
  }
  const start = points[low - 1], end = points[low];
  const width = end[0] - start[0];
  const amount = (x - start[0]) / width;
  return {
    y: start[1] + (end[1] - start[1]) * (1 - cos(amount * Math.PI)) / 2,
    slope: (end[1] - start[1]) * Math.PI * sin(amount * Math.PI) / (2 * width),
  };
}

/**
 * A legacy cosine curve between two x positions as Bézier pieces.
 *
 * Each piece is the cubic Hermite through the curve's end heights and slopes,
 * with its x handles at thirds so x is linear along the piece. A piece that
 * strays further than the tolerance from the true curve is halved, so steep
 * segments get an extra node and gentle ones stay a single edge.
 *
 * @returns {{ x: number, y: number, in: number[] | null, out: number[] | null }[]}
 */
export function cosineCurveNodes(points, start, end, tolerance = LEGACY_CURVE_TOLERANCE) {
  const breaks = [start, ...points.map(point => point[0]).filter(x => x > start && x < end), end];
  const pieces = [];
  const fit = (x0, x1, depth) => {
    const a = cosineAt(points, x0), b = cosineAt(points, x1);
    const third = (x1 - x0) / 3;
    const piece = {
      x0, x1, y0: a.y, y1: b.y,
      c1: [x0 + third, a.y + a.slope * third],
      c2: [x1 - third, b.y - b.slope * third],
    };
    if (depth < 10 && pieceError(points, piece) > tolerance) {
      const middle = (x0 + x1) / 2;
      fit(x0, middle, depth + 1);
      fit(middle, x1, depth + 1);
      return;
    }
    pieces.push(piece);
  };
  for (let index = 0; index + 1 < breaks.length; index++) {
    if (breaks[index + 1] - breaks[index] > 1e-9) fit(breaks[index], breaks[index + 1], 0);
  }
  const nodes = [];
  pieces.forEach((piece, index) => {
    const previous = pieces[index - 1];
    const flat = isFlat(piece);
    nodes.push({
      x: piece.x0, y: piece.y0,
      in: previous && !isFlat(previous) ? previous.c2 : null,
      out: flat ? null : piece.c1,
      edge: flat ? 'straight' : 'curve',
    });
  });
  const last = pieces[pieces.length - 1];
  if (last) nodes.push({ x: last.x1, y: last.y1, in: isFlat(last) ? null : last.c2, out: null, edge: 'straight' });
  return nodes;
}

// A piece whose handles sit on its chord is a straight line and is stored as one.
function isFlat(piece) {
  const dy = piece.y1 - piece.y0;
  return Math.abs(piece.c1[1] - (piece.y0 + dy / 3)) < 1e-9 && Math.abs(piece.c2[1] - (piece.y0 + dy * 2 / 3)) < 1e-9;
}

function pieceError(points, piece) {
  let worst = 0;
  for (let step = 1; step < 16; step++) {
    const t = step / 16, u = 1 - t;
    const y = u * u * u * piece.y0 + 3 * u * u * t * piece.c1[1] + 3 * u * t * t * piece.c2[1] + t * t * t * piece.y1;
    const x = piece.x0 + (piece.x1 - piece.x0) * t;
    worst = Math.max(worst, Math.abs(y - cosineAt(points, x).y));
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Ground and islands
// ---------------------------------------------------------------------------

function solidRanges(level) {
  const points = level.points;
  const firstX = points[0][0], lastX = points[points.length - 1][0];
  const gaps = (level.gaps || [])
    .map(([start, end]) => [Math.max(firstX, start), Math.min(lastX, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const ranges = [];
  let cursor = firstX;
  for (const [gapStart, gapEnd] of gaps) {
    if (gapStart > cursor) ranges.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < lastX) ranges.push([cursor, lastX]);
  return ranges;
}

/** The finite depth the converted ground reaches down to. */
export function legacyGroundBottom(level) {
  return Math.max(Number(level.fallY) || 620, ...level.points.map(point => point[1])) + GROUND_DEPTH;
}

function groundBlock(level) {
  const bottom = legacyGroundBottom(level);
  const regions = solidRanges(level).map(([start, end]) => ({
    outer: {
      nodes: [
        ...cosineCurveNodes(level.points, start, end),
        { x: end, y: bottom, edge: 'straight' },
        { x: start, y: bottom, edge: 'straight' },
      ],
    },
    inner: [],
  }));
  return regions.length ? { id: 'legacy-ground', material: level.terrain || 'grass', regions } : null;
}

/** Nodes of a curve walked right to left, with each node's handles swapped. */
function reversed(nodes) {
  return nodes.slice().reverse().map(node => ({
    x: node.x, y: node.y, in: node.out, out: node.in, edge: node.in ? 'curve' : 'straight',
  }));
}

function platformBlock(platform, index, level) {
  const top = platform.points, bottom = platform.bottom;
  if (!Array.isArray(top) || top.length < 2 || !Array.isArray(bottom) || bottom.length < 2) return null;
  const topNodes = cosineCurveNodes(top, top[0][0], top[top.length - 1][0]);
  const bottomNodes = reversed(cosineCurveNodes(bottom, bottom[0][0], bottom[bottom.length - 1][0]));
  // The closing sides are straight, so the last node of each curve leaves on a
  // straight edge.
  topNodes[topNodes.length - 1].edge = 'straight';
  bottomNodes[bottomNodes.length - 1].edge = 'straight';
  bottomNodes[bottomNodes.length - 1].out = null;
  return {
    id: `legacy-platform-${index}`,
    material: platform.material || level.terrain || 'grass',
    regions: [{ outer: { nodes: [...topNodes, ...bottomNodes] }, inner: [] }],
  };
}

// ---------------------------------------------------------------------------
// Thick paths
// ---------------------------------------------------------------------------

function pathSegmentsOf(path) {
  const points = path.points || [];
  const segments = [];
  for (let index = 1; index < points.length; index++) segments.push([points[index - 1], points[index]]);
  if (path.closed && points.length > 2) segments.push([points[points.length - 1], points[0]]);
  return segments;
}

function distanceToSegments(segments, x, y) {
  let best = Infinity;
  for (const [a, b] of segments) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 1e-12 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(x - a[0] - dx * amount, y - a[1] - dy * amount);
    if (distance < best) best = distance;
  }
  return best;
}

// Marching-squares cases: which cell edges the outline crosses, as pairs.
// Edges are 0 top, 1 right, 2 bottom, 3 left; corners are numbered clockwise
// from the top left, and a corner's bit is set when it is inside the path.
const CASES = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], null, [[0, 2]], [[3, 2]],
  [[2, 3]], [[0, 2]], null, [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], [],
];

/**
 * The filled outline of a thick path, with round caps and joins, as closed
 * polygons. The outline is traced from the exact distance field of the path's
 * centre line, interpolated along each grid edge, then simplified, so its
 * distance from the true outline stays within the path tolerance.
 *
 * @returns {number[][][]} closed rings, in no particular winding
 */
export function pathOutlineRings(path, tolerance = LEGACY_PATH_TOLERANCE) {
  const segments = pathSegmentsOf(path);
  if (!segments.length) return [];
  const radius = (path.thickness || 32) / 2;
  const xs = path.points.map(point => point[0]), ys = path.points.map(point => point[1]);
  const pad = radius + PATH_GRID * 2;
  const left = Math.floor((Math.min(...xs) - pad) / PATH_GRID) * PATH_GRID;
  const top = Math.floor((Math.min(...ys) - pad) / PATH_GRID) * PATH_GRID;
  const columns = Math.ceil((Math.max(...xs) + pad - left) / PATH_GRID) + 1;
  const rows = Math.ceil((Math.max(...ys) + pad - top) / PATH_GRID) + 1;
  // Each segment only updates the samples it can reach, so a long path costs
  // its own area rather than its bounding box times its length.
  const far = PATH_GRID * 4;
  const field = new Float64Array(columns * rows).fill(far);
  const reach = radius + far;
  for (const segment of segments) {
    const [a, b] = segment;
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - left) / PATH_GRID));
    const c1 = Math.min(columns - 1, Math.ceil((Math.max(a[0], b[0]) + reach - left) / PATH_GRID));
    const r0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - top) / PATH_GRID));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(a[1], b[1]) + reach - top) / PATH_GRID));
    for (let row = r0; row <= r1; row++) {
      for (let column = c0; column <= c1; column++) {
        const distance = distanceToSegments([segment], left + column * PATH_GRID, top + row * PATH_GRID) - radius;
        const offset = row * columns + column;
        if (distance < field[offset]) field[offset] = distance;
      }
    }
  }
  const value = (column, row) => field[row * columns + column];
  // One point per crossed grid edge, keyed so neighbouring cells share it.
  const points = new Map();
  const edgePoint = (column, row, edge) => {
    const [c0, r0, c1, r1] = edge === 0 ? [column, row, column + 1, row]
      : edge === 1 ? [column + 1, row, column + 1, row + 1]
        : edge === 2 ? [column, row + 1, column + 1, row + 1]
          : [column, row, column, row + 1];
    const id = `${c0},${r0},${c1},${r1}`;
    if (!points.has(id)) {
      const a = value(c0, r0), b = value(c1, r1);
      const t = a / (a - b);
      points.set(id, { id, x: left + (c0 + (c1 - c0) * t) * PATH_GRID, y: top + (r0 + (r1 - r0) * t) * PATH_GRID, links: [] });
    }
    return points.get(id);
  };
  for (let row = 0; row + 1 < rows; row++) {
    for (let column = 0; column + 1 < columns; column++) {
      const corners = [value(column, row), value(column + 1, row), value(column + 1, row + 1), value(column, row + 1)];
      const index = (corners[0] < 0 ? 1 : 0) | (corners[1] < 0 ? 2 : 0) | (corners[2] < 0 ? 4 : 0) | (corners[3] < 0 ? 8 : 0);
      let pairs = CASES[index];
      if (!pairs) {
        const centreInside = (corners[0] + corners[1] + corners[2] + corners[3]) / 4 < 0;
        pairs = (index === 5) === centreInside ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
      }
      for (const [from, to] of pairs) {
        const a = edgePoint(column, row, from), b = edgePoint(column, row, to);
        a.links.push(b); b.links.push(a);
      }
    }
  }
  const rings = [];
  const used = new Set();
  for (const start of points.values()) {
    if (used.has(start) || start.links.length !== 2) continue;
    const ring = [];
    let previous = null, current = start;
    for (let guard = points.size; guard > 0 && current && !used.has(current); guard--) {
      used.add(current);
      ring.push([current.x, current.y]);
      const next = current.links[0] === previous ? current.links[1] : current.links[0];
      previous = current;
      current = next;
    }
    if (ring.length >= 3) rings.push(simplifyRing(ring, tolerance));
  }
  return rings.filter(ring => ring.length >= 3);
}

/** Douglas–Peucker on a closed ring, keeping every point further than `tolerance`. */
function simplifyRing(ring, tolerance) {
  let far = 0, farDistance = -1;
  for (let index = 1; index < ring.length; index++) {
    const distance = Math.hypot(ring[index][0] - ring[0][0], ring[index][1] - ring[0][1]);
    if (distance > farDistance) { farDistance = distance; far = index; }
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [from, to] = stack.pop();
    const a = ring[from], b = ring[to % ring.length];
    let worst = -1, worstIndex = -1;
    for (let index = from + 1; index < to; index++) {
      const p = ring[index];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      const distance = length > 1e-12
        ? Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / length
        : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (distance > worst) { worst = distance; worstIndex = index; }
    }
    if (worst > tolerance) {
      keep[worstIndex] = 1;
      stack.push([from, worstIndex], [worstIndex, to]);
    }
  }
  return ring.filter((_, index) => keep[index]).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index], [x2, y2] = ring[previous];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function ringAreaOf(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index], [x2, y2] = ring[(index + 1) % ring.length];
    total += x1 * y2 - x2 * y1;
  }
  return Math.abs(total / 2);
}

/**
 * Group rings into regions by nesting: a ring inside an even number of others
 * is solid, and an odd one is a hole in the smallest solid ring around it. A
 * closed loop therefore keeps its open middle as an inner boundary.
 */
function ringsToRegions(rings) {
  const depth = rings.map((ring, index) => rings.filter((other, otherIndex) =>
    otherIndex !== index && ringContains(other, ring[0][0], ring[0][1])).length);
  const outers = rings.map((ring, index) => ({ ring, index, area: ringAreaOf(ring), holes: [] }))
    .filter(entry => depth[entry.index] % 2 === 0);
  rings.forEach((ring, index) => {
    if (depth[index] % 2 === 0) return;
    const owner = outers
      .filter(outer => ringContains(outer.ring, ring[0][0], ring[0][1]))
      .sort((a, b) => a.area - b.area)[0];
    if (owner) owner.holes.push(ring);
  });
  const toNodes = ring => ({ nodes: ring.map(([x, y]) => ({ x, y, edge: 'straight' })) });
  return outers.map(outer => ({ outer: toNodes(outer.ring), inner: outer.holes.map(toNodes) }));
}

function pathBlock(path, index, level) {
  const regions = ringsToRegions(pathOutlineRings(path));
  if (!regions.length) return null;
  return { id: `legacy-path-${index}`, material: path.material || level.terrain || 'grass', regions };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Give every boundary and node an id derived from its block, so conversion is repeatable. */
function stableIds(block) {
  let counter = 0;
  return {
    ...block,
    regions: block.regions.map((region, regionIndex) => ({
      outer: { id: `${block.id}-r${regionIndex}`, nodes: region.outer.nodes.map(node => ({ ...node, id: `${block.id}-n${counter++}` })) },
      inner: region.inner.map((hole, holeIndex) => ({
        id: `${block.id}-r${regionIndex}h${holeIndex}`,
        nodes: hole.nodes.map(node => ({ ...node, id: `${block.id}-n${counter++}` })),
      })),
    })),
  };
}

/**
 * A level's legacy terrain as normalized blocks, in the order the legacy
 * renderer drew it: ground, then paths, then islands. Later blocks win where
 * materials overlap, so that order is also the material priority.
 */
export function legacyTerrainBlocks(level) {
  if (!level) return [];
  const blocks = [];
  if (Array.isArray(level.points) && level.points.length >= 2) {
    const ground = groundBlock(level);
    if (ground) blocks.push(ground);
  }
  (level.paths || []).forEach((path, index) => {
    const block = Array.isArray(path?.points) && path.points.length >= 2 ? pathBlock(path, index, level) : null;
    if (block) blocks.push(block);
  });
  (level.platforms || []).forEach((platform, index) => {
    const block = platformBlock(platform, index, level);
    if (block) blocks.push(block);
  });
  return blocks.map(block => normalizeBlock(stableIds(block), level.terrain || 'grass'));
}
