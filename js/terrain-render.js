import { TAU } from './config.js';
import { terrainMaterials } from './materials.js';
import { terrainAt, curveAt, platformPolygon, pathBounds } from './terrain.js';
import { ART_PIXEL, createCanvas, createDrawingTools, compositeColor, quantizeToPalette } from './drawing.js';

// Static terrain is rasterised once into square world-space chunks and then
// blitted. Chunk corners sit on the art-pixel grid, so a snapped camera maps
// each chunk pixel to exactly one buffer pixel.
const CHUNK_SIZE = 512;
const CHUNK_PIXELS = CHUNK_SIZE / ART_PIXEL;
const CHUNK_LIMIT = 48;
const CHUNK_MARGIN = 24;
const BRICK_COLOR = '#4e2e2a99';
const SIGN_COLORS = ['#6d7862', '#e8e4ce', '#3c5e4b'];

const materialFor = name => terrainMaterials[name] || terrainMaterials.grass;

function levelPalette(level) {
  const names = new Set([level.terrain, ...(level.platforms || []).map(platform => platform.material), ...(level.paths || []).map(path => path.material)]);
  const colors = [...SIGN_COLORS];
  for (const name of names) {
    const material = materialFor(name);
    colors.push(material.fill, material.edge, material.surface, ...material.layers);
    if (material.vegetation) colors.push(material.vegetation);
    colors.push(compositeColor(material.detail, material.fill));
    if (material.pattern === 'brick') colors.push(compositeColor(BRICK_COLOR, material.fill));
  }
  return colors;
}

function solidRanges(level, start, end) {
  const ranges = [];
  let cursor = start;
  for (const gap of level.gaps || []) {
    if (gap[1] <= cursor || gap[0] >= end) continue;
    if (gap[0] > cursor) ranges.push([cursor, Math.min(gap[0], end)]);
    cursor = Math.max(cursor, gap[1]);
    if (cursor >= end) break;
  }
  if (cursor < end) ranges.push([cursor, end]);
  return ranges;
}

function groundPath(context, level, left, right, bottom) {
  context.beginPath();
  for (const [start, end] of solidRanges(level, left, right)) {
    if (end <= start) continue;
    context.moveTo(start, bottom);
    context.lineTo(start, terrainAt(level, start).y);
    for (let x = start + 5; x < end; x += 5) context.lineTo(x, terrainAt(level, x).y);
    context.lineTo(end, terrainAt(level, end).y);
    context.lineTo(end, bottom);
    context.closePath();
  }
}

function drawBrickPattern(context, start, end, top, bottom) {
  context.fillStyle = BRICK_COLOR;
  for (let y = Math.floor(top / 14) * 14; y < bottom; y += 14) {
    context.fillRect(start, y, end - start, 2);
    const offset = (Math.floor(y / 14) % 2) * 15;
    for (let x = Math.floor(start / 30) * 30 + offset; x < end; x += 30) context.fillRect(x, y, 2, 14);
  }
}

// A surface edge as one-art-pixel columns: a dark band around the curve with a
// lighter top line, replacing the old round-joined 7-unit stroke.
function drawSurfaceEdge(context, points, start, end, material) {
  const snap = value => Math.round(value / ART_PIXEL) * ART_PIXEL;
  const first = Math.floor(start / ART_PIXEL) * ART_PIXEL;
  for (let x = first; x < end; x += ART_PIXEL) {
    const left = Math.max(x, start), right = Math.min(x + ART_PIXEL, end);
    if (right <= left) continue;
    const y0 = curveAt(points, left).y, y1 = curveAt(points, right).y;
    const top = snap(Math.min(y0, y1)), bottom = snap(Math.max(y0, y1));
    context.fillStyle = material.edge;
    context.fillRect(x, top - 4, ART_PIXEL, bottom - top + 8);
    context.fillStyle = material.surface;
    context.fillRect(x, top - 2, ART_PIXEL, bottom - top + ART_PIXEL);
  }
}

function drawGround(context, level, left, right, top, bottom) {
  const material = materialFor(level.terrain);
  groundPath(context, level, left, right, bottom);
  context.fillStyle = material.fill; context.fill();
  context.save(); groundPath(context, level, left, right, bottom); context.clip();
  if (material.pattern === 'brick') {
    drawBrickPattern(context, left, right, top, bottom);
  } else {
    for (let i = 0; i < 4; i++) {
      context.beginPath();
      const first = Math.floor(left / 8) * 8;
      for (let x = first; x < right + 8; x += 8) {
        const y = terrainAt(level, x).y + 27 + i * 30 + Math.sin(x * .022 + i) * 5;
        if (x === first) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = material.layers[i % material.layers.length]; context.lineWidth = 2; context.stroke();
    }
  }
  context.fillStyle = material.detail;
  for (let i = Math.floor(left / 31); i < Math.ceil(right / 31); i++) {
    const x = i * 31 + Math.sin(i * 18) * 9;
    const y = terrainAt(level, x).y + 16 + (Math.sin(i * 23) + 1) * 34;
    context.beginPath(); context.ellipse(x, y, 2 + (i % 3 + 3) % 3, 1.5, .3, 0, TAU); context.fill();
  }
  context.restore();

  for (const [start, end] of solidRanges(level, left, right)) drawSurfaceEdge(context, level.points, start, end, material);

  if (material.vegetation) {
    const { pixelPath } = createDrawingTools(context);
    for (let i = Math.floor(left / 45); i < Math.ceil(right / 45); i++) {
      const x = i * 45 + Math.sin(i * 9) * 8, surface = terrainAt(level, x);
      if (!surface.solid) continue;
      pixelPath([[x - 4, surface.y - 2],[x - 4, surface.y - 8],[x, surface.y - 4],[x + 2, surface.y - 10]], material.vegetation, 1, 2);
    }
  }
}

function drawAuthoredPath(context, path) {
  const material = materialFor(path.material);
  context.beginPath();
  path.points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
  if (path.closed) context.closePath();
  context.lineCap = 'round'; context.lineJoin = 'round';
  const thickness = path.thickness || 32;
  context.strokeStyle = material.edge; context.lineWidth = thickness + 7; context.stroke();
  context.strokeStyle = material.surface; context.lineWidth = thickness + 3; context.stroke();
  context.strokeStyle = material.fill; context.lineWidth = thickness; context.stroke();
}

function platformPath(context, platform) {
  context.beginPath();
  platformPolygon(platform).forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
  context.closePath();
}

function platformBounds(platform) {
  const polygon = platformPolygon(platform);
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

function drawPlatform(context, platform) {
  const start = platform.points[0][0], end = platform.points.at(-1)[0];
  const { left, right, top, bottom } = platformBounds(platform);
  const material = materialFor(platform.material);
  platformPath(context, platform); context.fillStyle = material.fill; context.fill();
  context.save(); platformPath(context, platform); context.clip();
  if (material.pattern === 'brick') {
    drawBrickPattern(context, left, right, top, bottom + 8);
  } else {
    for (let offset = 16, index = 0; offset < bottom - top; offset += 16, index++) {
      context.beginPath();
      for (let x = left; x <= right; x += 6) {
        const y = curveAt(platform.points, x).y + offset;
        if (x === left) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = material.layers[index % material.layers.length]; context.lineWidth = 2; context.stroke();
    }
  }
  context.restore();
  drawSurfaceEdge(context, platform.points, start, end, material);
}

function drawStartSign(context, level) {
  const { pixelRect, drawPixelText } = createDrawingTools(context);
  const y = terrainAt(level, 28).y;
  pixelRect(26, y - 48, 4, 48, '#6d7862', 2);
  pixelRect(8, y - 52, 42, 20, '#e8e4ce', 2);
  drawPixelText('GO →', 29, y - 47, '#3c5e4b');
}

export function createTerrainRenderer() {
  let currentLevel = null;
  let chunks = new Map();
  let palette = [];

  function buildChunk(level, column, row) {
    const originX = column * CHUNK_SIZE, originY = row * CHUNK_SIZE;
    const left = originX - CHUNK_MARGIN, right = originX + CHUNK_SIZE + CHUNK_MARGIN;
    const top = originY - CHUNK_MARGIN, bottom = originY + CHUNK_SIZE + CHUNK_MARGIN;
    const canvas = createCanvas(CHUNK_PIXELS, CHUNK_PIXELS);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.setTransform(1 / ART_PIXEL, 0, 0, 1 / ART_PIXEL, -originX / ART_PIXEL, -originY / ART_PIXEL);
    drawGround(context, level, left, right, top, bottom);
    for (const path of level.paths || []) {
      const bounds = pathBounds(path);
      if (bounds.right + 8 < left || bounds.left - 8 > right || bounds.bottom + 8 < top || bounds.top - 8 > bottom) continue;
      drawAuthoredPath(context, path);
    }
    for (const platform of level.platforms || []) {
      const bounds = platformBounds(platform);
      if (bounds.right + 8 < left || bounds.left - 8 > right || bounds.bottom + 8 < top || bounds.top - 8 > bottom) continue;
      drawPlatform(context, platform);
    }
    if (left < 60 && right > 0) drawStartSign(context, level);
    return quantizeToPalette(context, CHUNK_PIXELS, CHUNK_PIXELS, palette) ? canvas : null;
  }

  function chunk(level, column, row) {
    const key = column + ',' + row;
    if (chunks.has(key)) {
      const cached = chunks.get(key);
      chunks.delete(key); chunks.set(key, cached);
      return cached;
    }
    const built = buildChunk(level, column, row);
    chunks.set(key, built);
    if (chunks.size > CHUNK_LIMIT) chunks.delete(chunks.keys().next().value);
    return built;
  }

  // Draws every chunk overlapping the view. `ctx` must already map world units.
  function draw(ctx, level, viewX, viewY, width, height) {
    if (level !== currentLevel) invalidate(level);
    const firstColumn = Math.floor(viewX / CHUNK_SIZE), lastColumn = Math.floor((viewX + width) / CHUNK_SIZE);
    const firstRow = Math.floor(viewY / CHUNK_SIZE), lastRow = Math.floor((viewY + height) / CHUNK_SIZE);
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const image = chunk(level, column, row);
        if (image) ctx.drawImage(image, column * CHUNK_SIZE, row * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
      }
    }
  }

  function invalidate(level = null) {
    currentLevel = level;
    chunks = new Map();
    palette = level ? levelPalette(level) : [];
  }

  return { draw, invalidate };
}
