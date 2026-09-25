import { terrainMaterials } from './materials.js';
import { curveAt, platformUndersideAt } from './terrain.js';
import { hypot } from './det-math.js';

export const cloneLevel = level => JSON.parse(JSON.stringify(level));

export function createBlankLevel(index = 0) {
  const number = String(index + 1).padStart(2, '0');
  return {
    name: 'New Trail',
    label: `NEW TRAIL / ${number}`,
    goal: 1200,
    terrain: 'grass',
    description: '',
    start: { x: 90, y: null, facing: 1 },
    points: [[0, 320], [180, 320], [420, 270], [680, 330], [940, 280], [1320, 300]],
    gaps: [],
    platforms: [],
    paths: [],
    apples: [
      { x: 260, y: null },
      { x: 470, y: null },
      { x: 710, y: null },
      { x: 930, y: null },
      { x: 1100, y: null }
    ],
    props: [],
    spikes: [],
    weather: { sun: 1, clouds: .2 },
    fallY: 620,
    sky: '#eae9d9',
    sun: '#f2c082',
    mountain: '#b7c8b1',
    spray: ['#6f8b59', '#9c8b68', '#c5b496']
  };
}

export const SPIKE_RADIUS = { min: 8, max: 64, default: 18 };
export const PLATFORM_MIN_THICKNESS = 8;
export const PLATFORM_MIN_GAP = 4;

export const PLATFORM_DEFAULT_THICKNESS = 48;

// Bottom points mirror the top at a uniform depth, so every top corner gets a matching bottom corner.
export function uniformUnderside(points, thickness = PLATFORM_DEFAULT_THICKNESS) {
  return points.map(([x, y]) => [x, y + thickness]);
}

export function normalizeSpike(spike, groundPoints) {
  const radius = Math.max(SPIKE_RADIUS.min, Math.min(SPIKE_RADIUS.max, Number(spike?.radius) || SPIKE_RADIUS.default));
  const x = Number(spike?.x) || 0;
  const y = Number.isFinite(Number(spike?.y)) && spike?.y !== null ? Number(spike.y) : curveAt(groundPoints, x).y - radius;
  const spin = Number(spike?.spin);
  return { x, y, radius, spin: Number.isFinite(spin) ? spin : 1 };
}

export function normalizeLevel(input, index = 0) {
  const fallback = createBlankLevel(index);
  const level = { ...fallback, ...cloneLevel(input || {}) };
  level.name = String(level.name || fallback.name);
  level.label = String(level.label || `${level.name.toUpperCase()} / ${String(index + 1).padStart(2, '0')}`);
  level.goal = Number(level.goal) || fallback.goal;
  level.fallY = Number(level.fallY) || fallback.fallY;
  level.terrain = terrainMaterials[level.terrain] ? level.terrain : 'grass';
  level.points = Array.isArray(level.points) && level.points.length >= 2
    ? level.points.map(point => [Number(point[0]), Number(point[1])]).sort((a, b) => a[0] - b[0])
    : fallback.points;
  level.gaps = Array.isArray(level.gaps)
    ? level.gaps.map(gap => [Number(gap[0]), Number(gap[1])].sort((a, b) => a - b))
    : [];
  level.platforms = Array.isArray(level.platforms) ? level.platforms.map(platform => {
    const sorted = points => (points || []).map(point => [Number(point[0]), Number(point[1])]).sort((a, b) => a[0] - b[0]);
    return {
      ...platform,
      points: sorted(platform.points),
      bottom: sorted(platform.bottom),
      material: terrainMaterials[platform.material] ? platform.material : level.terrain
    };
  }).filter(platform => platform.points.length >= 2 && platform.bottom.length >= 2) : [];
  level.paths = Array.isArray(level.paths) ? level.paths.map(path => ({
    ...path,
    points: (path.points || []).map(point => [Number(point[0]), Number(point[1])]),
    closed: Boolean(path.closed),
    thickness: Math.max(16, Number(path.thickness) || 32),
    material: terrainMaterials[path.material] ? path.material : level.terrain
  })).filter(path => path.points.length >= (path.closed ? 3 : 2)) : [];
  const start = level.start || fallback.start;
  level.start = {
    x: Number(start.x) || 90,
    y: start.y === null || start.y === undefined ? null : (Number.isFinite(Number(start.y)) ? Number(start.y) : null),
    facing: Number(start.facing) < 0 ? -1 : 1
  };
  level.apples = Array.isArray(level.apples) ? level.apples.map(apple => ({
    x: Number(apple.x) || 0,
    y: apple.y === null ? null : Number(apple.y)
  })) : [];
  level.props = Array.isArray(level.props) ? level.props.map(prop => ({
    x: Number(prop.x) || 0,
    y: prop.y === null || prop.y === undefined ? null : (Number.isFinite(Number(prop.y)) ? Number(prop.y) : null),
    type: String(prop.type || 'tree'),
    layer: prop.layer === 'front' ? 'front' : 'back'
  })) : [];
  level.spikes = Array.isArray(level.spikes) ? level.spikes.map(spike => normalizeSpike(spike, level.points)) : [];
  level.weather = { ...fallback.weather, ...(level.weather || {}) };
  const medals = normalizeMedals(level.medals);
  if (medals) level.medals = medals; else delete level.medals;
  return level;
}

export const MEDALS = ['gold', 'silver', 'bronze'];

/** Target times in seconds; invalid or incomplete tables are dropped. */
export function normalizeMedals(medals) {
  if (!medals || typeof medals !== 'object') return null;
  const times = MEDALS.map(name => Number(medals[name]));
  if (!times.every(time => Number.isFinite(time) && time > 0)) return null;
  return { gold: times[0], silver: times[1], bronze: times[2] };
}

/** @returns {'gold' | 'silver' | 'bronze' | null} */
export function medalFor(medals, time) {
  if (!medals) return null;
  return MEDALS.find(name => time <= medals[name]) || null;
}

export function validateLevel(level) {
  const messages = [];
  const error = text => messages.push({ type: 'error', text });
  const warning = text => messages.push({ type: 'warning', text });
  if (!level.name.trim()) error('The trail needs a name.');
  if (!terrainMaterials[level.terrain]) error(`Unknown base material “${level.terrain}”.`);
  if (!Array.isArray(level.points) || level.points.length < 2) error('Ground requires at least two control points.');
  for (let index = 1; index < level.points.length; index++) {
    const [previousX, previousY] = level.points[index - 1];
    const [x, y] = level.points[index];
    if (x <= previousX) error(`Ground point ${index + 1} must be to the right of point ${index}.`);
    if (x - previousX < 70 && Math.abs(y - previousY) > 70) warning(`Ground segment ${index}–${index + 1} is very steep.`);
  }
  const finalX = level.points.at(-1)?.[0] || 0;
  if (level.goal <= 115 || level.goal >= finalX) error('The finish must be after the start and before the final ground point.');
  for (const [index, gap] of (level.gaps || []).entries()) {
    if (gap[1] <= gap[0]) error(`Gap ${index + 1} has an invalid range.`);
    if (gap[1] - gap[0] > 160) warning(`Gap ${index + 1} is wider than 160 units and may be difficult.`);
    if (level.goal > gap[0] && level.goal < gap[1]) error(`The finish is inside gap ${index + 1}.`);
  }
  for (const [index, path] of (level.paths || []).entries()) {
    if (!terrainMaterials[path.material]) error(`Path ${index + 1} has an unknown material.`);
    if (!Number.isFinite(path.thickness) || path.thickness < 16) error(`Path ${index + 1} thickness must be at least 16.`);
    if (!Array.isArray(path.points) || path.points.length < (path.closed ? 3 : 2)) error(`Path ${index + 1} needs at least ${path.closed ? 3 : 2} points.`);
    for (let pointIndex = 0; pointIndex < path.points.length; pointIndex++) {
      const point = path.points[pointIndex];
      if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) error(`Path ${index + 1} point ${pointIndex + 1} must contain finite coordinates.`);
      if (pointIndex > 0 && hypot(point[0] - path.points[pointIndex - 1][0], point[1] - path.points[pointIndex - 1][1]) < 1) error(`Path ${index + 1} has coincident consecutive points.`);
    }
    if (path.closed && path.points.length > 2 && hypot(path.points[0][0] - path.points.at(-1)[0], path.points[0][1] - path.points.at(-1)[1]) < 1) error(`Path ${index + 1} is closed automatically; remove its repeated final point.`);
  }
  for (const [index, platform] of (level.platforms || []).entries()) {
    if (!terrainMaterials[platform.material]) error(`Platform ${index + 1} has an unknown material.`);
    if (platform.points.length < 2) error(`Platform ${index + 1} needs at least two points.`);
    for (let pointIndex = 1; pointIndex < platform.points.length; pointIndex++) {
      if (platform.points[pointIndex][0] <= platform.points[pointIndex - 1][0]) error(`Platform ${index + 1} points are not ordered.`);
    }
    if (!Array.isArray(platform.bottom) || platform.bottom.length < 2) {
      error(`Platform ${index + 1} needs at least two underside points.`);
      continue;
    }
    for (let pointIndex = 1; pointIndex < platform.bottom.length; pointIndex++) {
      if (platform.bottom[pointIndex][0] <= platform.bottom[pointIndex - 1][0]) error(`Platform ${index + 1} underside points are not ordered.`);
    }
    const start = platform.points[0][0], end = platform.points.at(-1)[0];
    for (let x = start; x <= end; x += 8) {
      const underside = platformUndersideAt(platform, x);
      if (underside - curveAt(platform.points, x).y < PLATFORM_MIN_GAP) {
        error(`Platform ${index + 1} underside crosses its top near x ${Math.round(x)}.`);
        break;
      }
    }
    for (const [x] of [...platform.points, ...platform.bottom]) {
      if (platformUndersideAt(platform, x) >= curveAt(level.points, x).y - 8) {
        warning(`Platform ${index + 1} comes close to or intersects the ground near x ${Math.round(x)}.`);
        break;
      }
    }
  }
  if (!Number.isFinite(level.start?.x)) error('The level needs a valid start position.');
  if (level.start?.y === null && (level.gaps || []).some(gap => level.start.x > gap[0] && level.start.x < gap[1])) error('The ground-anchored start position is inside a gap.');
  for (const apple of level.apples || []) {
    if (apple.x >= level.goal) warning(`Apple at x ${Math.round(apple.x)} is at or beyond the finish.`);
    if (apple.y === null && (level.gaps || []).some(gap => apple.x > gap[0] && apple.x < gap[1])) error(`Ground-anchored apple at x ${Math.round(apple.x)} is inside a gap.`);
  }
  for (const [index, prop] of (level.props || []).entries()) {
    if (!['tree', 'fence', 'rock', 'flowers', 'stump', 'crystal'].includes(prop.type)) warning(`Prop ${index + 1} has an unknown type “${prop.type}”.`);
    if (prop.y === null && (level.gaps || []).some(gap => prop.x > gap[0] && prop.x < gap[1])) error(`Ground-anchored prop ${index + 1} is inside a gap.`);
  }
  for (const [index, spike] of (level.spikes || []).entries()) {
    if (!Number.isFinite(spike.x) || !Number.isFinite(spike.y)) error(`Spike ${index + 1} must have finite coordinates.`);
    if (!(spike.radius >= SPIKE_RADIUS.min && spike.radius <= SPIKE_RADIUS.max)) error(`Spike ${index + 1} radius must be between ${SPIKE_RADIUS.min} and ${SPIKE_RADIUS.max}.`);
    const startY = Number.isFinite(level.start?.y) ? level.start.y : curveAt(level.points, level.start.x).y - 12;
    if (hypot(spike.x - level.start.x, spike.y - startY) < spike.radius + 70) warning(`Spike ${index + 1} is very close to the start position.`);
    for (const apple of level.apples || []) {
      const appleY = Number.isFinite(apple.y) ? apple.y : curveAt(level.points, apple.x).y - 60;
      if (hypot(spike.x - apple.x, spike.y - appleY) < spike.radius + 10) warning(`Spike ${index + 1} overlaps the apple at x ${Math.round(apple.x)}.`);
    }
  }
  if (level.medals !== undefined) {
    const times = MEDALS.map(name => Number(level.medals?.[name]));
    if (!times.every(time => Number.isFinite(time) && time > 0)) error('Medal times need positive gold, silver and bronze values in seconds.');
    else if (!(times[0] <= times[1] && times[1] <= times[2])) error('Medal times must get slower from gold to silver to bronze.');
  }
  for (const key of ['sun', 'clouds', 'rain', 'lightning']) {
    const value = level.weather?.[key];
    if (value !== undefined && (!Number.isFinite(Number(value)) || value < 0 || value > 1)) error(`Weather.${key} must be between 0 and 1.`);
  }
  if (!messages.length) messages.push({ type: 'ok', text: 'Level data is valid.' });
  return messages;
}

export function levelToModule(level) {
  return `export default ${JSON.stringify(level, null, 2)};\n`;
}
