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

export function platformPolygon(platform) {
  if (platformPolygons.has(platform)) return platformPolygons.get(platform);
  const start = platform.points[0][0];
  const end = platform.points[platform.points.length - 1][0];
  const thickness = platform.thickness || 48;
  const polygon = [];
  for (let x = start; x < end; x += 4) polygon.push([x, curveAt(platform.points, x).y]);
  polygon.push([end, curveAt(platform.points, end).y]);
  for (let x = end; x > start; x -= 8) polygon.push([x, curveAt(platform.points, x).y + thickness + Math.sin(x * .12) * 4]);
  polygon.push([start, curveAt(platform.points, start).y + thickness + Math.sin(start * .12) * 4]);
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
    if (body.bounds) continue;
    const xs = body.polygon.map(point => point[0]);
    const ys = body.polygon.map(point => point[1]);
    body.bounds = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }
  terrainGeometryCache.set(level, bodies);
  return bodies;
}

function circlePolygonContact(body, x, y, radius) {
  const { bounds, polygon } = body;
  if (x < bounds.left - radius || x > bounds.right + radius || y < bounds.top - radius || y > bounds.bottom + radius) return null;
  const inside = pointInsidePolygon(polygon, x, y);
  let nearest = null;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy || 1;
    const amount = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared));
    const nearestX = a[0] + dx * amount, nearestY = a[1] + dy * amount;
    const distance = Math.hypot(x - nearestX, y - nearestY);
    if (!nearest || distance < nearest.distance) nearest = { distance, nearestX, nearestY, dx, dy };
  }
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
  let nearest = null;
  for (const [a, b] of body.segments) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy || 1;
    const amount = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared));
    const nearestX = a[0] + dx * amount, nearestY = a[1] + dy * amount;
    const distance = Math.hypot(x - nearestX, y - nearestY);
    if (!nearest || distance < nearest.distance) nearest = { distance, nearestX, nearestY, dx, dy };
  }
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
  return collisionGeometry(level)
    .map(body => body.segments ? circlePathContact(body, x, y, radius) : circlePolygonContact(body, x, y, radius))
    .filter(Boolean)
    .sort((a, b) => b.penetration - a.penetration);
}

export function terrainSweepCollision(level, fromX, fromY, toX, toY, radius) {
  let earliest = null;
  for (const body of collisionGeometry(level)) {
    const sweepRadius = radius + (body.pathRadius || 0);
    const sweepLeft = Math.min(fromX, toX) - sweepRadius;
    const sweepRight = Math.max(fromX, toX) + sweepRadius;
    const sweepTop = Math.min(fromY, toY) - sweepRadius;
    const sweepBottom = Math.max(fromY, toY) + sweepRadius;
    if (sweepRight < body.bounds.left || sweepLeft > body.bounds.right || sweepBottom < body.bounds.top || sweepTop > body.bounds.bottom) continue;
    const segments = body.segments || body.polygon.map((point, index) => [point, body.polygon[(index + 1) % body.polygon.length]]);
    for (const [a, b] of segments) {
      const hit = sweepCircleSegment(fromX, fromY, toX, toY, sweepRadius, a[0], a[1], b[0], b[1]);
      if (!hit || (earliest && hit.time >= earliest.time)) continue;
      const motionX = toX - fromX, motionY = toY - fromY;
      // Ignore an edge when motion is away from its candidate normal.
      if (motionX * hit.nx + motionY * hit.ny >= 0) continue;
      earliest = {
        ...hit,
        kind: body.kind,
        material: body.material,
        platform: body.platform || null,
        path: body.path || null,
        slope: Math.abs(b[0] - a[0]) > .0001 ? (b[1] - a[1]) / (b[0] - a[0]) : 0,
        tangentX: (b[0] - a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1),
        tangentY: (b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1),
        penetration: 0,
        swept: true
      };
    }
  }
  return earliest;
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
