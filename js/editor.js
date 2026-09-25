import { levelEntries, terrainMaterials } from './levels.js';
import { curveAt, platformPolygon, pointInPlatform, invalidatePlatform, invalidateTerrain, pathBounds, pathSegments } from './terrain.js';
import { createDrawingTools, createGameArt, propAlignmentSlope, propGroundOffset } from './drawing.js';
import { cloneLevel, createBlankLevel, normalizeLevel, validateLevel, levelToModule, SPIKE_RADIUS } from './level-schema.js';

const $ = id => document.getElementById(id);
const canvas = $('editor-canvas');
const wrap = $('canvas-wrap');
const ctx = canvas.getContext('2d');
const art = createGameArt(ctx);
const tools = createDrawingTools(ctx);
const DRAFT_PREFIX = 'pocket-trials-editor-draft-v1-';
const levels = levelEntries.map(entry => entry.level);

let levelIndex = 0;
let level = loadLevelData(0);
let tool = 'select';
let selection = null;
let cameraX = 0;
let cameraY = 0;
let zoom = 1;
let dragging = false;
let panning = false;
let spaceHeld = false;
let pointerStart = null;
let gestureStartZoom = 1;
let gestureAnchor = null;
let history = [];
let future = [];

function loadLevelData(index) {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_PREFIX + levelEntries[index].id) || 'null');
    return normalizeLevel(draft || levels[index] || createBlankLevel(index), index);
  } catch (_) {
    return normalizeLevel(levels[index] || createBlankLevel(index), index);
  }
}

function snapshot() {
  return JSON.stringify(level);
}

function pushHistory() {
  history.push(snapshot());
  if (history.length > 80) history.shift();
  future = [];
  updateHistoryButtons();
}

function restore(serialized) {
  level = normalizeLevel(JSON.parse(serialized), levelIndex);
  selection = null;
  syncInspector();
  render();
}

function undo() {
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
  updateHistoryButtons();
}

function redo() {
  if (!future.length) return;
  history.push(snapshot());
  restore(future.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undo').disabled = history.length === 0;
  $('redo').disabled = future.length === 0;
}

function setTool(next) {
  tool = next;
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(bounds.width * dpr));
  canvas.height = Math.max(1, Math.round(bounds.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function viewportSize() {
  const bounds = canvas.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

function pointerWorld(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: cameraX + (event.clientX - bounds.left) / zoom,
    y: cameraY + (event.clientY - bounds.top) / zoom
  };
}

function baseRanges() {
  const ranges = [];
  const start = cameraX - 50;
  const end = cameraX + viewportSize().width / zoom + 50;
  let cursor = start;
  for (const gap of level.gaps || []) {
    if (gap[1] <= cursor || gap[0] >= end) continue;
    if (gap[0] > cursor) ranges.push([cursor, Math.min(gap[0], end)]);
    cursor = Math.max(cursor, gap[1]);
  }
  if (cursor < end) ranges.push([cursor, end]);
  return ranges;
}

function drawSurfaceTop(points, color, width = 3) {
  const start = points[0][0], end = points.at(-1)[0];
  ctx.beginPath(); ctx.moveTo(start, curveAt(points, start).y);
  for (let x = start + 4; x < end; x += 4) ctx.lineTo(x, curveAt(points, x).y);
  ctx.lineTo(end, curveAt(points, end).y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
}

function drawTerrain() {
  const material = terrainMaterials[level.terrain] || terrainMaterials.grass;
  const bottom = cameraY + viewportSize().height / zoom + 100;
  for (const [start, end] of baseRanges()) {
    ctx.beginPath(); ctx.moveTo(start, bottom); ctx.lineTo(start, curveAt(level.points, start).y);
    for (let x = start + 5; x < end; x += 5) ctx.lineTo(x, curveAt(level.points, x).y);
    ctx.lineTo(end, curveAt(level.points, end).y); ctx.lineTo(end, bottom); ctx.closePath();
    ctx.fillStyle = material.fill; ctx.fill();
  }
  for (const [start, end] of baseRanges()) drawSurfaceTop([[start, curveAt(level.points, start).y], ...level.points.filter(point => point[0] > start && point[0] < end), [end, curveAt(level.points, end).y]], material.surface, 5);

  for (const [pathIndex, path] of (level.paths || []).entries()) {
    const pathMaterial = terrainMaterials[path.material] || material;
    ctx.beginPath();
    path.points.forEach((point, index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point));
    if (path.closed) ctx.closePath();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = pathMaterial.edge; ctx.lineWidth = path.thickness + 7; ctx.stroke();
    ctx.strokeStyle = pathMaterial.surface; ctx.lineWidth = path.thickness + 3; ctx.stroke();
    ctx.strokeStyle = pathMaterial.fill; ctx.lineWidth = path.thickness; ctx.stroke();
    if (selection?.kind === 'path' && selection.pathIndex === pathIndex) {
      ctx.strokeStyle = '#fff3be'; ctx.lineWidth = 3 / zoom; ctx.setLineDash([8 / zoom, 5 / zoom]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  for (const [platformIndex, platform] of (level.platforms || []).entries()) {
    const platformMaterial = terrainMaterials[platform.material] || material;
    const polygon = platformPolygon(platform);
    ctx.beginPath(); polygon.forEach((point, index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point)); ctx.closePath();
    ctx.fillStyle = platformMaterial.fill; ctx.fill();
    ctx.strokeStyle = platformMaterial.edge; ctx.lineWidth = 3; ctx.stroke();
    drawSurfaceTop(platform.points, platformMaterial.surface, 5);
    if (selection?.kind === 'platform' && selection.platformIndex === platformIndex) {
      ctx.beginPath(); polygon.forEach((point, index) => index ? ctx.lineTo(...point) : ctx.moveTo(...point)); ctx.closePath();
      ctx.strokeStyle = '#fff3be'; ctx.lineWidth = 3 / zoom; ctx.setLineDash([8 / zoom, 5 / zoom]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function drawGrid(width, height) {
  const spacing = zoom < .65 ? 100 : 50;
  const left = Math.floor(cameraX / spacing) * spacing;
  const top = Math.floor(cameraY / spacing) * spacing;
  const right = cameraX + width / zoom;
  const bottom = cameraY + height / zoom;
  ctx.beginPath();
  for (let x = left; x <= right; x += spacing) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
  for (let y = top; y <= bottom; y += spacing) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
  ctx.strokeStyle = '#263b3d2c'; ctx.lineWidth = 1 / zoom; ctx.stroke();
}

function objectY(object, offset = 0) {
  return Number.isFinite(object.y) ? object.y : curveAt(level.points, object.x).y - offset;
}

function drawProps() {
  for (const prop of level.props || []) {
    art.drawProp(prop.type, prop.x, objectY(prop), prop.layer === 'front' ? 1 : .82, propAlignmentSlope(level, prop), propGroundOffset(level, prop));
  }
}

function drawSpikes() {
  for (const [index, spike] of level.spikes.entries()) {
    art.drawSpike(spike.x, spike.y, spike.radius);
    if (!isSelected('spike', index)) continue;
    ctx.beginPath(); ctx.arc(spike.x, spike.y, spike.radius * .8, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff3be'; ctx.lineWidth = 2 / zoom; ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawObjects() {
  drawSpikes();
  for (const apple of level.apples) art.drawApple(apple.x, objectY(apple, 60), { glow: false });
  art.drawFlag(level.goal, curveAt(level.points, level.goal).y, true);
  drawProps();
  const startY = Number.isFinite(level.start.y) ? level.start.y : curveAt(level.points, level.start.x).y - 12;
  ctx.save(); ctx.globalAlpha = .72;
  art.drawBike({
    rear: { x: level.start.x - 25, y: startY, spin: 0, compression: 0 },
    front: { x: level.start.x + 25, y: startY, spin: 0, compression: 0 },
    mx: level.start.x, my: startY, angle: 0, length: 50,
    facing: level.start.facing, flipVisual: level.start.facing, rider: 'max'
  });
  ctx.restore();
}

function isSelected(kind, index, platformIndex) {
  return selection?.kind === kind && selection.index === index && selection.platformIndex === platformIndex;
}

function drawHandles() {
  const radius = 5 / zoom;
  const drawHandle = (x, y, selected, color = '#ff8952') => {
    ctx.fillStyle = selected ? '#fff3be' : color;
    ctx.strokeStyle = '#17262b'; ctx.lineWidth = 2 / zoom;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };
  level.points.forEach((point, index) => drawHandle(point[0], point[1], isSelected('groundPoint', index)));
  (level.platforms || []).forEach((platform, platformIndex) => platform.points.forEach((point, index) => drawHandle(point[0], point[1], isSelected('platformPoint', index, platformIndex), '#83d1ce')));
  (level.paths || []).forEach((path, pathIndex) => path.points.forEach((point, index) => drawHandle(point[0], point[1], selection?.kind === 'pathPoint' && selection.pathIndex === pathIndex && selection.index === index, '#f0b45f')));
  for (const [index, gap] of (level.gaps || []).entries()) {
    for (const x of gap) drawHandle(x, curveAt(level.points, x).y, isSelected('gap', index), '#e65e56');
  }
  level.apples.forEach((apple, index) => drawHandle(apple.x, objectY(apple, 60), isSelected('apple', index), '#ef8150'));
  level.props.forEach((prop, index) => drawHandle(prop.x, objectY(prop), isSelected('prop', index), '#83d1ce'));
  level.spikes.forEach((spike, index) => drawHandle(spike.x, spike.y, isSelected('spike', index), '#e65e56'));
  const startY = Number.isFinite(level.start.y) ? level.start.y : curveAt(level.points, level.start.x).y - 12;
  drawHandle(level.start.x, startY, selection?.kind === 'start', '#c6dfa9');
  drawHandle(level.goal, curveAt(level.points, level.goal).y - 112, selection?.kind === 'goal', '#c6dfa9');
}

function render() {
  const { width, height } = viewportSize();
  if (!width || !height) return;
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  art.drawBackground({ width, height, palette: level, cameraX, cameraY, full: true });
  ctx.save();
  ctx.translate(-cameraX * zoom, -cameraY * zoom);
  ctx.scale(zoom, zoom);
  drawGrid(width, height);
  drawTerrain();
  drawObjects();
  drawHandles();
  ctx.restore();
}

function hitTest(point) {
  const threshold = 13 / zoom;
  let best = null;
  const consider = (selectionValue, x, y) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= threshold && (!best || distance < best.distance)) best = { selection: selectionValue, distance };
  };
  level.points.forEach((value, index) => consider({ kind: 'groundPoint', index }, value[0], value[1]));
  level.platforms.forEach((platform, platformIndex) => platform.points.forEach((value, index) => consider({ kind: 'platformPoint', platformIndex, index }, value[0], value[1])));
  level.paths.forEach((path, pathIndex) => path.points.forEach((value, index) => consider({ kind: 'pathPoint', pathIndex, index }, value[0], value[1])));
  level.gaps.forEach((gap, index) => consider({ kind: 'gap', index }, (gap[0] + gap[1]) / 2, curveAt(level.points, (gap[0] + gap[1]) / 2).y));
  level.apples.forEach((apple, index) => consider({ kind: 'apple', index }, apple.x, objectY(apple, 60)));
  level.props.forEach((prop, index) => consider({ kind: 'prop', index }, prop.x, objectY(prop)));
  level.spikes.forEach((spike, index) => consider({ kind: 'spike', index }, spike.x, spike.y));
  const startY = Number.isFinite(level.start.y) ? level.start.y : curveAt(level.points, level.start.x).y - 12;
  consider({ kind: 'start' }, level.start.x, startY);
  consider({ kind: 'goal' }, level.goal, curveAt(level.points, level.goal).y - 112);
  if (!best) {
    for (let index = level.spikes.length - 1; index >= 0; index--) {
      const spike = level.spikes[index];
      if (Math.hypot(point.x - spike.x, point.y - spike.y) <= spike.radius) return { kind: 'spike', index };
    }
    for (let pathIndex = level.paths.length - 1; pathIndex >= 0; pathIndex--) {
      const path = level.paths[pathIndex];
      const bounds = pathBounds(path);
      if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) continue;
      for (const [a, b] of pathSegments(path)) {
        const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy || 1;
        const amount = Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / lengthSquared));
        if (Math.hypot(point.x - a[0] - dx * amount, point.y - a[1] - dy * amount) <= path.thickness / 2) return { kind: 'path', pathIndex };
      }
    }
    for (let platformIndex = level.platforms.length - 1; platformIndex >= 0; platformIndex--) {
      if (pointInPlatform(level.platforms[platformIndex], point.x, point.y)) {
        return { kind: 'platform', platformIndex };
      }
    }
  }
  return best?.selection || null;
}

function selectedPosition() {
  if (!selection) return null;
  if (selection.kind === 'groundPoint') return level.points[selection.index];
  if (selection.kind === 'platformPoint') return level.platforms[selection.platformIndex].points[selection.index];
  if (selection.kind === 'pathPoint') return level.paths[selection.pathIndex].points[selection.index];
  if (selection.kind === 'path') {
    const points = level.paths[selection.pathIndex].points;
    return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
  }
  if (selection.kind === 'platform') {
    const points = level.platforms[selection.platformIndex].points;
    return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
  }
  if (selection.kind === 'apple') { const apple = level.apples[selection.index]; return [apple.x, objectY(apple, 60)]; }
  if (selection.kind === 'prop') { const prop = level.props[selection.index]; return [prop.x, objectY(prop)]; }
  if (selection.kind === 'spike') { const spike = level.spikes[selection.index]; return [spike.x, spike.y]; }
  if (selection.kind === 'start') return [level.start.x, Number.isFinite(level.start.y) ? level.start.y : curveAt(level.points, level.start.x).y - 12];
  if (selection.kind === 'gap') return [(level.gaps[selection.index][0] + level.gaps[selection.index][1]) / 2, curveAt(level.points, level.gaps[selection.index][0]).y];
  if (selection.kind === 'goal') return [level.goal, curveAt(level.points, level.goal).y - 112];
  return null;
}

function syncInspector() {
  $('level-name').value = level.name;
  $('base-material').value = level.terrain;
  $('goal-x').value = Math.round(level.goal);
  $('fall-y').value = Math.round(level.fallY);
  for (const key of ['sun', 'clouds', 'rain', 'lightning']) $(`weather-${key}`).value = level.weather?.[key] ?? 0;
  const position = selectedPosition();
  $('selection-fields').hidden = !selection;
  $('selection-title').textContent = selection ? selection.kind.replace(/([A-Z])/g, ' $1').toUpperCase() : 'LEVEL';
  if (position) {
    $('selection-x').value = Math.round(position[0]);
    $('selection-y').value = Math.round(position[1]);
  }
  const platformIndex = selection?.platformIndex;
  const pathIndex = selection?.pathIndex;
  const hasPlatform = Number.isInteger(platformIndex);
  const hasPath = Number.isInteger(pathIndex);
  $('selection-y-row').hidden = !selection || ['gap', 'goal'].includes(selection.kind);
  $('selection-material-row').hidden = !hasPlatform && !hasPath;
  $('selection-thickness-row').hidden = !hasPlatform && !hasPath;
  $('selection-closed-row').hidden = !hasPath;
  $('selection-facing-row').hidden = selection?.kind !== 'start';
  $('selection-prop-type-row').hidden = selection?.kind !== 'prop';
  $('selection-layer-row').hidden = selection?.kind !== 'prop';
  $('selection-radius-row').hidden = selection?.kind !== 'spike';
  $('selection-spin-row').hidden = selection?.kind !== 'spike';
  $('delete-selection').hidden = !selection || ['start', 'goal'].includes(selection.kind);
  if (hasPlatform || hasPath) {
    const body = hasPlatform ? level.platforms[platformIndex] : level.paths[pathIndex];
    $('selection-material').value = body.material;
    $('selection-thickness').value = body.thickness;
    if (hasPath) $('selection-closed').checked = body.closed;
  }
  if (selection?.kind === 'start') $('selection-facing').value = String(level.start.facing);
  if (selection?.kind === 'prop') {
    $('selection-prop-type').value = level.props[selection.index].type;
    $('selection-layer').value = level.props[selection.index].layer;
  }
  if (selection?.kind === 'spike') {
    $('selection-radius').value = level.spikes[selection.index].radius;
    $('selection-spin').value = level.spikes[selection.index].spin;
  }
  $('level-json').value = JSON.stringify(level, null, 2);
  const messages = validateLevel(level);
  $('validation-list').replaceChildren(...messages.map(message => {
    const item = document.createElement('li'); item.className = message.type; item.textContent = message.text; return item;
  }));
  updateHistoryButtons();
}

function updateSelectedPosition(x, y) {
  if (!selection) return;
  if (selection.kind === 'groundPoint') {
    const points = level.points, index = selection.index;
    const minimumX = index > 0 ? points[index - 1][0] + 10 : 0;
    const maximumX = index < points.length - 1 ? points[index + 1][0] - 10 : Infinity;
    points[index][0] = Math.max(minimumX, Math.min(maximumX, x));
    points[index][1] = y;
    invalidateTerrain(level);
  } else if (selection.kind === 'platformPoint') {
    const points = level.platforms[selection.platformIndex].points, index = selection.index;
    const minimumX = index > 0 ? points[index - 1][0] + 10 : 0;
    const maximumX = index < points.length - 1 ? points[index + 1][0] - 10 : Infinity;
    points[index][0] = Math.max(minimumX, Math.min(maximumX, x));
    points[index][1] = y;
    invalidatePlatform(level.platforms[selection.platformIndex]);
    invalidateTerrain(level);
  } else if (selection.kind === 'pathPoint') {
    const path = level.paths[selection.pathIndex];
    path.points[selection.index] = [x, y];
    invalidateTerrain(level);
  } else if (selection.kind === 'path') {
    const path = level.paths[selection.pathIndex];
    const current = selectedPosition();
    const dx = x - current[0], dy = y - current[1];
    path.points.forEach(point => { point[0] += dx; point[1] += dy; });
    invalidateTerrain(level);
  } else if (selection.kind === 'platform') {
    const platform = level.platforms[selection.platformIndex];
    const current = selectedPosition();
    const dx = x - current[0], dy = y - current[1];
    platform.points.forEach(point => { point[0] += dx; point[1] += dy; });
    invalidatePlatform(platform);
    invalidateTerrain(level);
  } else if (selection.kind === 'apple') {
    level.apples[selection.index].x = x; level.apples[selection.index].y = y;
  } else if (selection.kind === 'prop') {
    level.props[selection.index].x = x; level.props[selection.index].y = y;
  } else if (selection.kind === 'spike') {
    level.spikes[selection.index].x = x; level.spikes[selection.index].y = y;
  } else if (selection.kind === 'start') {
    level.start.x = x; level.start.y = y;
  } else if (selection.kind === 'gap') {
    const gap = level.gaps[selection.index], half = (gap[1] - gap[0]) / 2;
    gap[0] = x - half; gap[1] = x + half;
  } else if (selection.kind === 'goal') level.goal = x;
}

function addAt(point) {
  pushHistory();
  if (tool === 'ground') {
    level.points.push([point.x, point.y]); level.points.sort((a, b) => a[0] - b[0]);
    selection = { kind: 'groundPoint', index: level.points.findIndex(value => value[0] === point.x && value[1] === point.y) };
  } else if (tool === 'platform') {
    level.platforms.push({ points: [[point.x - 100, point.y], [point.x, point.y - 25], [point.x + 100, point.y]], thickness: 48, material: level.terrain });
    selection = { kind: 'platformPoint', platformIndex: level.platforms.length - 1, index: 1 };
  } else if (tool === 'path') {
    const pathIndex = selection?.pathIndex;
    if (Number.isInteger(pathIndex) && level.paths[pathIndex]) {
      const path = level.paths[pathIndex];
      path.points.push([point.x, point.y]);
      selection = { kind: 'pathPoint', pathIndex, index: path.points.length - 1 };
    } else {
      level.paths.push({ points: [[point.x - 60, point.y], [point.x, point.y - 60], [point.x + 60, point.y]], closed: false, thickness: 28, material: level.terrain });
      selection = { kind: 'pathPoint', pathIndex: level.paths.length - 1, index: 1 };
    }
    invalidateTerrain(level);
  } else if (tool === 'gap') {
    level.gaps.push([point.x - 50, point.x + 50]); level.gaps.sort((a, b) => a[0] - b[0]);
    selection = { kind: 'gap', index: level.gaps.findIndex(gap => point.x >= gap[0] && point.x <= gap[1]) };
  } else if (tool === 'apple') {
    level.apples.push({ x: point.x, y: point.y });
    selection = { kind: 'apple', index: level.apples.length - 1 };
  } else if (tool === 'start') {
    level.start = { x: point.x, y: point.y, facing: level.start?.facing || 1 };
    selection = { kind: 'start' };
  } else if (tool === 'prop') {
    level.props.push({ x: point.x, y: point.y, type: 'tree', layer: 'back' });
    selection = { kind: 'prop', index: level.props.length - 1 };
  } else if (tool === 'spike') {
    level.spikes.push({ x: point.x, y: point.y, radius: SPIKE_RADIUS.default, spin: 1 });
    selection = { kind: 'spike', index: level.spikes.length - 1 };
  } else if (tool === 'finish') {
    level.goal = point.x; selection = { kind: 'goal' };
  }
  setTool('select'); syncInspector(); render();
}

function deleteSelection() {
  if (!selection || ['goal', 'start'].includes(selection.kind)) return;
  pushHistory();
  if (selection.kind === 'groundPoint' && level.points.length > 2) level.points.splice(selection.index, 1);
  else if (selection.kind === 'platformPoint') {
    const platform = level.platforms[selection.platformIndex];
    if (platform.points.length > 2) platform.points.splice(selection.index, 1);
    else level.platforms.splice(selection.platformIndex, 1);
  } else if (selection.kind === 'platform') level.platforms.splice(selection.platformIndex, 1);
  else if (selection.kind === 'pathPoint') {
    const path = level.paths[selection.pathIndex];
    if (path.points.length > (path.closed ? 3 : 2)) path.points.splice(selection.index, 1);
    else level.paths.splice(selection.pathIndex, 1);
  } else if (selection.kind === 'path') level.paths.splice(selection.pathIndex, 1);
  else if (selection.kind === 'gap') level.gaps.splice(selection.index, 1);
  else if (selection.kind === 'apple') level.apples.splice(selection.index, 1);
  else if (selection.kind === 'prop') level.props.splice(selection.index, 1);
  else if (selection.kind === 'spike') level.spikes.splice(selection.index, 1);
  selection = null; syncInspector(); render();
}

function download(filename, content, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

for (const [index, entry] of levelEntries.entries()) {
  const option = document.createElement('option');
  option.value = index;
  option.textContent = `${entry.source === 'official' ? 'OFFICIAL' : 'CUSTOM'} / ${entry.level.name}`;
  $('level-picker').append(option);
}
for (const name of Object.keys(terrainMaterials)) {
  for (const select of [$('base-material'), $('selection-material')]) {
    const option = document.createElement('option'); option.value = name; option.textContent = name.toUpperCase(); select.append(option);
  }
}

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('level-picker').addEventListener('change', event => {
  levelIndex = Number(event.target.value); level = loadLevelData(levelIndex); selection = null; history = []; future = []; cameraX = 0; cameraY = 0; syncInspector(); render();
});
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('zoom-in').addEventListener('click', () => { zoom = Math.min(2.5, zoom * 1.2); updateZoom(); });
$('zoom-out').addEventListener('click', () => { zoom = Math.max(.35, zoom / 1.2); updateZoom(); });
function updateZoom() { $('zoom-label').textContent = Math.round(zoom * 100) + '%'; render(); }

canvas.addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    // Browsers expose trackpad pinch as a wheel event with Ctrl held.
    const before = pointerWorld(event);
    zoom = Math.max(.35, Math.min(2.5, zoom * Math.exp(-event.deltaY * .01)));
    const bounds = canvas.getBoundingClientRect();
    cameraX = before.x - (event.clientX - bounds.left) / zoom;
    cameraY = before.y - (event.clientY - bounds.top) / zoom;
    updateZoom();
    return;
  }
  // A normal two-finger trackpad gesture pans in both axes.
  const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
  cameraX += event.deltaX * deltaScale / zoom;
  cameraY += event.deltaY * deltaScale / zoom;
  render();
}, { passive: false });

canvas.addEventListener('gesturestart', event => {
  event.preventDefault();
  gestureStartZoom = zoom;
  gestureAnchor = pointerWorld(event);
});
canvas.addEventListener('gesturechange', event => {
  event.preventDefault();
  if (!gestureAnchor) return;
  zoom = Math.max(.35, Math.min(2.5, gestureStartZoom * event.scale));
  const bounds = canvas.getBoundingClientRect();
  cameraX = gestureAnchor.x - (event.clientX - bounds.left) / zoom;
  cameraY = gestureAnchor.y - (event.clientY - bounds.top) / zoom;
  updateZoom();
});
canvas.addEventListener('gestureend', event => { event.preventDefault(); gestureAnchor = null; });

canvas.addEventListener('pointerdown', event => {
  canvas.focus({ preventScroll: true });
  const point = pointerWorld(event);
  if (event.button === 1 || tool === 'pan' || spaceHeld) {
    panning = true; pointerStart = { clientX: event.clientX, clientY: event.clientY, cameraX, cameraY }; canvas.setPointerCapture(event.pointerId); return;
  }
  if (tool !== 'select') { addAt(point); return; }
  selection = hitTest(point);
  if (selection) { pushHistory(); dragging = true; canvas.setPointerCapture(event.pointerId); }
  syncInspector(); render();
});
canvas.addEventListener('pointermove', event => {
  if (panning && pointerStart) {
    cameraX = pointerStart.cameraX - (event.clientX - pointerStart.clientX) / zoom;
    cameraY = pointerStart.cameraY - (event.clientY - pointerStart.clientY) / zoom;
    render(); return;
  }
  if (!dragging || !selection) return;
  const point = pointerWorld(event); updateSelectedPosition(point.x, point.y); syncInspector(); render();
});
const endPointer = () => { dragging = false; panning = false; pointerStart = null; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && document.activeElement === canvas) { event.preventDefault(); deleteSelection(); return; }
  if (event.code === 'Space' && document.activeElement === canvas) { event.preventDefault(); spaceHeld = true; }
});
window.addEventListener('keyup', event => { if (event.code === 'Space') spaceHeld = false; });

function bindLevelInput(id, apply) {
  $(id).addEventListener('change', event => { pushHistory(); apply(event.target.value); syncInspector(); render(); });
}
bindLevelInput('level-name', value => { level.name = value; level.label = `${value.toUpperCase()} / ${String(levelIndex + 1).padStart(2, '0')}`; });
bindLevelInput('base-material', value => { level.terrain = value; });
bindLevelInput('goal-x', value => { level.goal = Number(value); });
bindLevelInput('fall-y', value => { level.fallY = Number(value); });
for (const key of ['sun', 'clouds', 'rain', 'lightning']) {
  $(`weather-${key}`).addEventListener('change', event => { pushHistory(); level.weather[key] = Number(event.target.value); syncInspector(); render(); });
  $(`weather-${key}`).addEventListener('input', event => { level.weather[key] = Number(event.target.value); render(); });
}
$('selection-x').addEventListener('change', event => { const position = selectedPosition(); if (!position) return; pushHistory(); updateSelectedPosition(Number(event.target.value), position[1]); syncInspector(); render(); });
$('selection-y').addEventListener('change', event => { const position = selectedPosition(); if (!position) return; pushHistory(); updateSelectedPosition(position[0], Number(event.target.value)); syncInspector(); render(); });
$('selection-material').addEventListener('change', event => {
  const body = Number.isInteger(selection?.platformIndex) ? level.platforms[selection.platformIndex] : level.paths[selection?.pathIndex];
  if (!body) return; pushHistory(); body.material = event.target.value; invalidateTerrain(level); syncInspector(); render();
});
$('selection-thickness').addEventListener('change', event => {
  const body = Number.isInteger(selection?.platformIndex) ? level.platforms[selection.platformIndex] : level.paths[selection?.pathIndex];
  if (!body) return; pushHistory(); body.thickness = Math.max(16, Number(event.target.value));
  if (Number.isInteger(selection?.platformIndex)) invalidatePlatform(body);
  invalidateTerrain(level); syncInspector(); render();
});
$('selection-closed').addEventListener('change', event => { if (!Number.isInteger(selection?.pathIndex)) return; pushHistory(); level.paths[selection.pathIndex].closed = event.target.checked; invalidateTerrain(level); syncInspector(); render(); });
$('selection-facing').addEventListener('change', event => { if (selection?.kind !== 'start') return; pushHistory(); level.start.facing = Number(event.target.value) < 0 ? -1 : 1; syncInspector(); render(); });
$('selection-prop-type').addEventListener('change', event => { if (selection?.kind !== 'prop') return; pushHistory(); level.props[selection.index].type = event.target.value; syncInspector(); render(); });
$('selection-layer').addEventListener('change', event => { if (selection?.kind !== 'prop') return; pushHistory(); level.props[selection.index].layer = event.target.value === 'front' ? 'front' : 'back'; syncInspector(); render(); });
$('selection-radius').addEventListener('change', event => {
  if (selection?.kind !== 'spike') return; pushHistory();
  level.spikes[selection.index].radius = Math.max(SPIKE_RADIUS.min, Math.min(SPIKE_RADIUS.max, Number(event.target.value) || SPIKE_RADIUS.default));
  syncInspector(); render();
});
$('selection-spin').addEventListener('change', event => {
  if (selection?.kind !== 'spike') return; pushHistory();
  const spin = Number(event.target.value);
  level.spikes[selection.index].spin = Number.isFinite(spin) ? spin : 0;
  syncInspector(); render();
});
$('delete-selection').addEventListener('click', deleteSelection);
$('save-draft').addEventListener('click', () => { localStorage.setItem(DRAFT_PREFIX + levelEntries[levelIndex].id, JSON.stringify(level)); $('save-draft').textContent = 'SAVED'; setTimeout(() => { $('save-draft').textContent = 'SAVE DRAFT'; }, 1000); });
$('export-json').addEventListener('click', () => download(`${level.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, JSON.stringify(level, null, 2) + '\n', 'application/json'));
$('export-js').addEventListener('click', () => download(`${level.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.js`, levelToModule(level), 'text/javascript'));
$('import-json').addEventListener('click', () => {
  try { pushHistory(); level = normalizeLevel(JSON.parse($('level-json').value), levelIndex); selection = null; syncInspector(); render(); }
  catch (error) {
    const item = document.createElement('li'); item.className = 'error'; item.textContent = `Invalid JSON: ${error.message}`;
    $('validation-list').replaceChildren(item);
  }
});

new ResizeObserver(resize).observe(wrap);
setTool('select'); syncInspector(); updateHistoryButtons(); resize();
