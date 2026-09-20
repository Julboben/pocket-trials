import { lerp, TERRAIN_SAMPLE_SPACING } from './config.js';

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
  for (const body of bodies) {
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
    penetration: inside ? radius + nearest.distance : radius - nearest.distance
  };
}

export function terrainCollisionsAt(level, x, y, radius) {
  return collisionGeometry(level)
    .map(body => circlePolygonContact(body, x, y, radius))
    .filter(Boolean)
    .sort((a, b) => b.penetration - a.penetration);
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
