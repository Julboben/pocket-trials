import { lerp } from './config.js';

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

export function platformCollisionAt(level, x, y, radius) {
  let best = null;
  for (const platform of level.platforms || []) {
    const points = platformPolygon(platform);
    const start = platform.points[0][0] - radius;
    const end = platform.points[platform.points.length - 1][0] + radius;
    if (x < start || x > end) continue;
    const inside = pointInsidePolygon(points, x, y);
    let nearest = null;
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy || 1;
      const amount = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared));
      const nearestX = a[0] + dx * amount, nearestY = a[1] + dy * amount;
      const distance = Math.hypot(x - nearestX, y - nearestY);
      if (!nearest || distance < nearest.distance) nearest = { distance, nearestX, nearestY, dx, dy };
    }
    if (!nearest || (!inside && nearest.distance >= radius)) continue;
    let nx, ny;
    if (nearest.distance > .001) {
      nx = (x - nearest.nearestX) / nearest.distance;
      ny = (y - nearest.nearestY) / nearest.distance;
      if (inside) { nx *= -1; ny *= -1; }
    } else {
      const length = Math.hypot(nearest.dx, nearest.dy) || 1;
      nx = nearest.dy / length; ny = -nearest.dx / length;
    }
    const penetration = inside ? radius + nearest.distance : radius - nearest.distance;
    if (!best || penetration > best.penetration) {
      best = { y: nearest.nearestY, slope: nearest.dx ? nearest.dy / nearest.dx : 0, solid: true, material: platform.material || level.terrain || 'grass', platform, nx, ny, penetration };
    }
  }
  return best;
}

export function gapCollisionAt(level, x, y, radius) {
  let best = null;
  const bottom = level.fallY || 620;
  for (const gap of level.gaps || []) {
    const walls = [
      { x: gap[0], normalX: 1, active: x >= gap[0] },
      { x: gap[1], normalX: -1, active: x <= gap[1] }
    ];
    for (const wall of walls) {
      if (!wall.active || Math.abs(x - wall.x) >= radius) continue;
      const top = curveAt(level.points, wall.x).y;
      const nearestY = Math.max(top, Math.min(bottom, y));
      const dx = x - wall.x, dy = y - nearestY;
      const distance = Math.hypot(dx, dy);
      if (distance >= radius) continue;
      const nx = distance > .001 ? dx / distance : wall.normalX;
      const ny = distance > .001 ? dy / distance : 0;
      const penetration = radius - distance;
      if (!best || penetration > best.penetration) {
        best = { y: nearestY, slope: 0, solid: true, material: level.terrain || 'grass', gap, nx, ny, penetration };
      }
    }
  }
  return best;
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
