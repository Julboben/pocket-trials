import { lerp, TERRAIN_SAMPLE_SPACING } from './config.js';
import { sweepCircleSegment } from './physics.js';

export function curveAt(points, x) {
  let y = points[0][1];
  let slope = 0;
  if (x > points[0][0]) {
    const segment = points.findIndex((point, index) => index > 0 && x <= point[0]);
    if (segment < 0) {
      y = points[points.length - 1][1];
    } else {
      const start = points[segment - 1];
      const end = points[segment];
      const amount = (x - start[0]) / (end[0] - start[0]);
      y = lerp(start[1], end[1], (1 - Math.cos(amount * Math.PI)) / 2);
      slope = (end[1] - start[1]) * Math.PI * Math.sin(amount * Math.PI) / (2 * (end[0] - start[0]));
    }
  }
  return { y, slope };
}

export function terrainSurfacesAt(level, x) {
  const surfaces = [];
  const base = curveAt(level.points, x);
  const baseSolid = !(level.gaps || []).some(gap => x > gap[0] && x < gap[1]);
  if (baseSolid) surfaces.push({ ...base, solid: true, material: level.terrain || 'grass', platform: null });

  for (const platform of level.platforms || []) {
    const start = platform.points[0][0];
    const end = platform.points[platform.points.length - 1][0];
    if (x < start || x > end) continue;
    surfaces.push({ ...curveAt(platform.points, x), solid: true, material: platform.material || level.terrain || 'grass', platform });
  }
  return surfaces.sort((a, b) => a.y - b.y);
}

const platformPolygons = new WeakMap();
const terrainGeometryCache = new WeakMap();

export function invalidateTerrain(level) {
  terrainGeometryCache.delete(level);
}

export function pathSegments(path) {
  const points = path.points || [];
  const segments = [];
  for (let index = 1; index < points.length; index++) segments.push([points[index - 1], points[index]]);
  if (path.closed && points.length > 2) segments.push([points.at(-1), points[0]]);
  return segments;
}

export function pathBounds(path) {
  const radius = (path.thickness || 32) / 2;
  const xs = path.points.map(point => point[0]);
  const ys = path.points.map(point => point[1]);
  return {
    left: Math.min(...xs) - radius,
    right: Math.max(...xs) + radius,
    top: Math.min(...ys) - radius,
    bottom: Math.max(...ys) + radius
  };
}

export function invalidatePlatform(platform) {
  platformPolygons.delete(platform);
}

export function platformUndersideAt(platform, x) {
  return curveAt(platform.bottom, x).y;
}

export function platformPolygon(platform) {
  if (platformPolygons.has(platform)) return platformPolygons.get(platform);
  const start = platform.points[0][0];
  const end = platform.points[platform.points.length - 1][0];
  const bottomStart = platform.bottom[0][0];
  const bottomEnd = platform.bottom.at(-1)[0];
  const polygon = [];
  for (let x = start; x < end; x += 4) polygon.push([x, curveAt(platform.points, x).y]);
  polygon.push([end, curveAt(platform.points, end).y]);
  for (let x = bottomEnd; x > bottomStart; x -= 4) polygon.push([x, platformUndersideAt(platform, x)]);
  polygon.push([bottomStart, platformUndersideAt(platform, bottomStart)]);
  platformPolygons.set(platform, polygon);
  return polygon;
}

function pointInsidePolygon(polygon, x, y) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[previous];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

export function pointInPlatform(platform, x, y) {
  return pointInsidePolygon(platformPolygon(platform), x, y);
}


export function terrainSegmentAt(points, x) {
  if (x <= points[0][0] || x > points.at(-1)[0]) return null;
  const index = points.findIndex((point, pointIndex) => pointIndex > 0 && x <= point[0]);
  if (index < 1) return null;
  const start = points[index - 1], end = points[index];
  return { index, start, end, slope: (end[1] - start[1]) / (end[0] - start[0]) };
}

export function terrainSegmentSlopeAt(points, x) {
  return terrainSegmentAt(points, x)?.slope || 0;
}


function sampleSurface(points, start, end, spacing = TERRAIN_SAMPLE_SPACING) {
  const samples = [[start, curveAt(points, start).y]];
  for (let x = start + spacing; x < end; x += spacing) samples.push([x, curveAt(points, x).y]);
  samples.push([end, curveAt(points, end).y]);
  return samples;
}

function collisionGeometry(level) {
  if (terrainGeometryCache.has(level)) return terrainGeometryCache.get(level);
  const bottom = Math.max(level.fallY || 620, ...level.points.map(point => point[1])) + 200;
  const firstX = level.points[0][0];
  const lastX = level.points.at(-1)[0];
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

  const bodies = ranges.map(([start, end]) => ({
    kind: 'ground',
    material: level.terrain || 'grass',
    polygon: [...sampleSurface(level.points, start, end), [end, bottom], [start, bottom]]
  }));
  for (const platform of level.platforms || []) {
    bodies.push({
      kind: 'platform',
      material: platform.material || level.terrain || 'grass',
      platform,
      polygon: platformPolygon(platform)
    });
  }
  for (const path of level.paths || []) {
    bodies.push({
      kind: 'path',
      material: path.material || level.terrain || 'grass',
      path,
      segments: pathSegments(path),
      pathRadius: (path.thickness || 32) / 2,
      bounds: pathBounds(path)
    });
  }
  for (const body of bodies) {
    if (!body.bounds) {
      const xs = body.polygon.map(point => point[0]);
      const ys = body.polygon.map(point => point[1]);
      body.bounds = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    }
    buildEdgeIndex(body);
  }
  terrainGeometryCache.set(level, bodies);
  return bodies;
}

const EDGE_BUCKET_WIDTH = 64;

// Edges are stored flat as [ax, ay, bx, by] and bucketed by x so a query only
// visits edges whose x-range overlaps it. Bucket lists stay in ascending edge
// order, and ties resolve to the lowest edge index, matching a full scan.
function buildEdgeIndex(body) {
  const pairs = body.segments || body.polygon.map((point, index) => [point, body.polygon[(index + 1) % body.polygon.length]]);
  const edges = new Float64Array(pairs.length * 4);
  const origin = Math.min(...pairs.map(([a, b]) => Math.min(a[0], b[0])));
  const buckets = [];
  pairs.forEach(([a, b], index) => {
    edges.set([a[0], a[1], b[0], b[1]], index * 4);
    const first = Math.floor((Math.min(a[0], b[0]) - origin) / EDGE_BUCKET_WIDTH);
    const last = Math.floor((Math.max(a[0], b[0]) - origin) / EDGE_BUCKET_WIDTH);
    for (let bucket = first; bucket <= last; bucket++) (buckets[bucket] ||= []).push(index);
  });
  body.edges = edges;
  body.edgeCount = pairs.length;
  body.edgeOrigin = origin;
  body.edgeBuckets = buckets;
}

function bucketRange(body, left, right) {
  const last = body.edgeBuckets.length - 1;
  return [
    Math.max(0, Math.floor((left - body.edgeOrigin) / EDGE_BUCKET_WIDTH)),
    Math.min(last, Math.floor((right - body.edgeOrigin) / EDGE_BUCKET_WIDTH))
  ];
}

function insideIndexedPolygon(body, x, y) {
  const [bucket] = bucketRange(body, x, x);
  const indices = body.edgeBuckets[bucket];
  if (!indices || x < body.edgeOrigin) return false;
  const edges = body.edges;
  let inside = false;
  for (const index of indices) {
    const offset = index * 4;
    const x1 = edges[offset], y1 = edges[offset + 1], x2 = edges[offset + 2], y2 = edges[offset + 3];
    if ((x1 > x) !== (x2 > x) && y < (y2 - y1) * (x - x1) / (x2 - x1) + y1) inside = !inside;
  }
  return inside;
}

function nearestEdge(body, x, y, left, right, all = false) {
  const edges = body.edges;
  let best = null, bestIndex = -1;
  const visit = index => {
    const offset = index * 4;
    const ax = edges[offset], ay = edges[offset + 1];
    const dx = edges[offset + 2] - ax, dy = edges[offset + 3] - ay;
    const lengthSquared = dx * dx + dy * dy || 1;
    const amount = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
    const nearestX = ax + dx * amount, nearestY = ay + dy * amount;
    const distance = Math.hypot(x - nearestX, y - nearestY);
    if (!best || distance < best.distance || (distance === best.distance && index < bestIndex)) {
      best = { distance, nearestX, nearestY, dx, dy };
      bestIndex = index;
    }
  };
  if (all) {
    for (let index = 0; index < body.edgeCount; index++) visit(index);
    return best;
  }
  const [first, last] = bucketRange(body, left, right);
  for (let bucket = first; bucket <= last; bucket++) {
    const indices = body.edgeBuckets[bucket];
    if (indices) for (const index of indices) visit(index);
  }
  return best;
}

function circlePolygonContact(body, x, y, radius) {
  const { bounds } = body;
  if (x < bounds.left - radius || x > bounds.right + radius || y < bounds.top - radius || y > bounds.bottom + radius) return null;
  const inside = insideIndexedPolygon(body, x, y);
  let nearest = nearestEdge(body, x, y, x - radius, x + radius);
  if (inside && (!nearest || nearest.distance >= radius)) nearest = nearestEdge(body, x, y, 0, 0, true);
  if (!nearest || (!inside && nearest.distance >= radius)) return null;

  let nx, ny;
  if (nearest.distance > .0001) {
    nx = (x - nearest.nearestX) / nearest.distance;
    ny = (y - nearest.nearestY) / nearest.distance;
    if (inside) { nx *= -1; ny *= -1; }
  } else {
    const length = Math.hypot(nearest.dx, nearest.dy) || 1;
    nx = nearest.dy / length;
    ny = -nearest.dx / length;
  }
  return {
    kind: body.kind,
    y: nearest.nearestY,
    slope: Math.abs(nearest.dx) > .0001 ? nearest.dy / nearest.dx : 0,
    solid: true,
    material: body.material,
    platform: body.platform || null,
    nx,
    ny,
    tangentX: nearest.dx / (Math.hypot(nearest.dx, nearest.dy) || 1),
    tangentY: nearest.dy / (Math.hypot(nearest.dx, nearest.dy) || 1),
    pointX: nearest.nearestX,
    pointY: nearest.nearestY,
    penetration: inside ? radius + nearest.distance : radius - nearest.distance
  };
}

function circlePathContact(body, x, y, radius) {
  const { bounds, pathRadius } = body;
  const reach = radius + pathRadius;
  if (x < bounds.left - radius || x > bounds.right + radius || y < bounds.top - radius || y > bounds.bottom + radius) return null;
  const nearest = nearestEdge(body, x, y, x - reach, x + reach);
  if (!nearest || nearest.distance >= reach) return null;
  let nx, ny;
  if (nearest.distance > .0001) {
    nx = (x - nearest.nearestX) / nearest.distance;
    ny = (y - nearest.nearestY) / nearest.distance;
  } else {
    const length = Math.hypot(nearest.dx, nearest.dy) || 1;
    nx = nearest.dy / length;
    ny = -nearest.dx / length;
  }
  return {
    kind: body.kind,
    y: nearest.nearestY,
    slope: Math.abs(nearest.dx) > .0001 ? nearest.dy / nearest.dx : 0,
    solid: true,
    material: body.material,
    path: body.path,
    nx,
    ny,
    tangentX: nearest.dx / (Math.hypot(nearest.dx, nearest.dy) || 1),
    tangentY: nearest.dy / (Math.hypot(nearest.dx, nearest.dy) || 1),
    pointX: nearest.nearestX + nx * pathRadius,
    pointY: nearest.nearestY + ny * pathRadius,
    penetration: reach - nearest.distance
  };
}

export function terrainCollisionsAt(level, x, y, radius) {
  const contacts = [];
  for (const body of collisionGeometry(level)) {
    const contact = body.segments ? circlePathContact(body, x, y, radius) : circlePolygonContact(body, x, y, radius);
    if (contact) contacts.push(contact);
  }
  return contacts.length > 1 ? contacts.sort((a, b) => b.penetration - a.penetration) : contacts;
}

export function terrainSweepCollision(level, fromX, fromY, toX, toY, radius) {
  let earliest = null, earliestBody = null, earliestIndex = -1;
  const motionX = toX - fromX, motionY = toY - fromY;
  for (const body of collisionGeometry(level)) {
    const sweepRadius = radius + (body.pathRadius || 0);
    const sweepLeft = Math.min(fromX, toX) - sweepRadius;
    const sweepRight = Math.max(fromX, toX) + sweepRadius;
    const sweepTop = Math.min(fromY, toY) - sweepRadius;
    const sweepBottom = Math.max(fromY, toY) + sweepRadius;
    if (sweepRight < body.bounds.left || sweepLeft > body.bounds.right || sweepBottom < body.bounds.top || sweepTop > body.bounds.bottom) continue;
    const edges = body.edges;
    const [first, last] = bucketRange(body, sweepLeft, sweepRight);
    for (let bucket = first; bucket <= last; bucket++) {
      const indices = body.edgeBuckets[bucket];
      if (!indices) continue;
      for (const index of indices) {
        const offset = index * 4;
        const hit = sweepCircleSegment(fromX, fromY, toX, toY, sweepRadius, edges[offset], edges[offset + 1], edges[offset + 2], edges[offset + 3]);
        if (!hit) continue;
        if (earliest && (hit.time > earliest.time
          || (hit.time === earliest.time && (earliestBody !== body || index >= earliestIndex)))) continue;
        // Ignore an edge when motion is away from its candidate normal.
        if (motionX * hit.nx + motionY * hit.ny >= 0) continue;
        earliest = hit;
        earliestBody = body;
        earliestIndex = index;
      }
    }
  }
  if (!earliest) return null;
  const offset = earliestIndex * 4, edges = earliestBody.edges;
  const dx = edges[offset + 2] - edges[offset], dy = edges[offset + 3] - edges[offset + 1];
  const length = Math.hypot(dx, dy) || 1;
  return {
    ...earliest,
    kind: earliestBody.kind,
    material: earliestBody.material,
    platform: earliestBody.platform || null,
    path: earliestBody.path || null,
    slope: Math.abs(dx) > .0001 ? dy / dx : 0,
    tangentX: dx / length,
    tangentY: dy / length,
    penetration: 0,
    swept: true
  };
}

export function terrainAt(level, x, referenceY = null) {
  if (referenceY === null) {
    const base = curveAt(level.points, x);
    const solid = !(level.gaps || []).some(gap => x > gap[0] && x < gap[1]);
    return { ...base, solid, material: level.terrain || 'grass', platform: null };
  }

  const surfaces = terrainSurfacesAt(level, x);
  const surface = surfaces.find(candidate => candidate.y >= referenceY - .5);
  return surface || { y: level.fallY || 620, slope: 0, solid: false, material: level.terrain || 'grass', platform: null };
}

function surfaceCurve(level, surface) {
  const points = surface.platform?.points || level.points;
  const contains = sampleX => surface.platform
    ? sampleX >= points[0][0] && sampleX <= points.at(-1)[0]
    : sampleX >= level.points[0][0] && sampleX <= level.points.at(-1)[0] && !(level.gaps || []).some(gap => sampleX > gap[0] && sampleX < gap[1]);
  return { points, contains };
}

export function groundShadowSamples(level, x, referenceY, width, step = 2, center = x) {
  const surface = terrainAt(level, x, referenceY);
  if (!surface.solid || !(width > 0)) return [];
  const { points, contains } = surfaceCurve(level, surface);
  const origin = Number.isFinite(center) ? center : x;
  const start = origin - width;
  const end = origin + width;
  const segments = [];
  let segment = [];
  for (let sampleX = start; sampleX <= end; sampleX += step) {
    if (!contains(sampleX)) {
      if (segment.length) segments.push(segment);
      segment = [];
      continue;
    }
    segment.push({ x: sampleX, ...curveAt(points, sampleX) });
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export function seatedSurfaceAt(level, x, y, tolerance = 12) {
  if (y == null || !Number.isFinite(y)) {
    const ground = terrainAt(level, x);
    return ground.solid ? ground : null;
  }
  let nearest = null;
  for (const surface of terrainSurfacesAt(level, x)) {
    const distance = Math.abs(surface.y - y);
    if (distance > tolerance || (nearest && distance >= Math.abs(nearest.y - y))) continue;
    nearest = surface;
  }
  return nearest;
}
