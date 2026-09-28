import { TAU } from "./config.js";
import { terrainMaterials } from "./materials.js";
import {
  terrainAt,
  curveAt,
  platformPolygon,
  pathBounds,
  terrainGeometry,
} from "./terrain.js";
import {
  ART_PIXEL,
  createCanvas,
  createDrawingTools,
  compositeColor,
  quantizeToPalette,
  drawStartPennant,
} from "./drawing.js";
import {
  terrainBodySpans,
  mergeSpans,
  terrainColumnSpans,
  terrainBodyAt,
} from "./terrain-runtime.js";

// Static terrain is rasterised once into square world-space chunks and then
// blitted. Chunk corners sit on the art-pixel grid, so a snapped camera maps
// each chunk pixel to exactly one buffer pixel.
const CHUNK_SIZE = 512;
const CHUNK_PIXELS = CHUNK_SIZE / ART_PIXEL;
const CHUNK_LIMIT = 48;
const CHUNK_MARGIN = 24;
const BRICK_COLOR = "#4e2e2a99";
const SIGN_COLORS = ["#6d7862", "#e8e4ce", "#3c5e4b"];

const materialFor = (name) => terrainMaterials[name] || terrainMaterials.grass;

// ---------------------------------------------------------------------------
// Legacy terrain
//
// Trails that only use the old ground line, platforms and paths keep exactly
// the art they always had. Anything with blocks is drawn by the rasteriser
// below, which also draws that trail's legacy terrain as blocks.
// ---------------------------------------------------------------------------

function levelPalette(level) {
  const names = new Set([
    level.terrain,
    ...(level.platforms || []).map((platform) => platform.material),
    ...(level.paths || []).map((path) => path.material),
  ]);
  const colors = [...SIGN_COLORS];
  for (const name of names) {
    const material = materialFor(name);
    colors.push(
      material.fill,
      material.edge,
      material.surface,
      ...material.layers,
    );
    if (material.vegetation) colors.push(material.vegetation);
    colors.push(compositeColor(material.detail, material.fill));
    if (material.pattern === "brick")
      colors.push(compositeColor(BRICK_COLOR, material.fill));
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
    for (let x = start + 5; x < end; x += 5)
      context.lineTo(x, terrainAt(level, x).y);
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
    for (let x = Math.floor(start / 30) * 30 + offset; x < end; x += 30)
      context.fillRect(x, y, 2, 14);
  }
}

// A surface edge as one-art-pixel columns: a dark band around the curve with a
// lighter top line, replacing the old round-joined 7-unit stroke.
function drawSurfaceEdge(context, points, start, end, material) {
  const snap = (value) => Math.round(value / ART_PIXEL) * ART_PIXEL;
  const first = Math.floor(start / ART_PIXEL) * ART_PIXEL;
  for (let x = first; x < end; x += ART_PIXEL) {
    const left = Math.max(x, start),
      right = Math.min(x + ART_PIXEL, end);
    if (right <= left) continue;
    const y0 = curveAt(points, left).y,
      y1 = curveAt(points, right).y;
    const top = snap(Math.min(y0, y1)),
      bottom = snap(Math.max(y0, y1));
    context.fillStyle = material.edge;
    context.fillRect(x, top - 4, ART_PIXEL, bottom - top + 8);
    context.fillStyle = material.surface;
    context.fillRect(x, top - 2, ART_PIXEL, bottom - top + ART_PIXEL);
  }
}

function drawGround(context, level, left, right, top, bottom) {
  const material = materialFor(level.terrain);
  groundPath(context, level, left, right, bottom);
  context.fillStyle = material.fill;
  context.fill();
  context.save();
  groundPath(context, level, left, right, bottom);
  context.clip();
  if (material.pattern === "brick") {
    drawBrickPattern(context, left, right, top, bottom);
  } else {
    for (let i = 0; i < 4; i++) {
      context.beginPath();
      const first = Math.floor(left / 8) * 8;
      for (let x = first; x < right + 8; x += 8) {
        const y =
          terrainAt(level, x).y + 27 + i * 30 + Math.sin(x * 0.022 + i) * 5;
        if (x === first) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = material.layers[i % material.layers.length];
      context.lineWidth = 2;
      context.stroke();
    }
  }
  context.fillStyle = material.detail;
  for (let i = Math.floor(left / 31); i < Math.ceil(right / 31); i++) {
    const x = i * 31 + Math.sin(i * 18) * 9;
    const y = terrainAt(level, x).y + 16 + (Math.sin(i * 23) + 1) * 34;
    context.beginPath();
    context.ellipse(x, y, 2 + (((i % 3) + 3) % 3), 1.5, 0.3, 0, TAU);
    context.fill();
  }
  context.restore();

  for (const [start, end] of solidRanges(level, left, right))
    drawSurfaceEdge(context, level.points, start, end, material);

  if (material.vegetation) {
    const { pixelPath } = createDrawingTools(context);
    for (let i = Math.floor(left / 45); i < Math.ceil(right / 45); i++) {
      const x = i * 45 + Math.sin(i * 9) * 8,
        surface = terrainAt(level, x);
      if (!surface.solid) continue;
      pixelPath(
        [
          [x - 4, surface.y - 2],
          [x - 4, surface.y - 8],
          [x, surface.y - 4],
          [x + 2, surface.y - 10],
        ],
        material.vegetation,
        1,
        2,
      );
    }
  }
}

function drawAuthoredPath(context, path) {
  const material = materialFor(path.material);
  context.beginPath();
  path.points.forEach((point, index) =>
    index
      ? context.lineTo(point[0], point[1])
      : context.moveTo(point[0], point[1]),
  );
  if (path.closed) context.closePath();
  context.lineCap = "round";
  context.lineJoin = "round";
  const thickness = path.thickness || 32;
  context.strokeStyle = material.edge;
  context.lineWidth = thickness + 7;
  context.stroke();
  context.strokeStyle = material.surface;
  context.lineWidth = thickness + 3;
  context.stroke();
  context.strokeStyle = material.fill;
  context.lineWidth = thickness;
  context.stroke();
}

function platformPath(context, platform) {
  context.beginPath();
  platformPolygon(platform).forEach((point, index) =>
    index
      ? context.lineTo(point[0], point[1])
      : context.moveTo(point[0], point[1]),
  );
  context.closePath();
}

function platformBounds(platform) {
  const polygon = platformPolygon(platform);
  const xs = polygon.map((point) => point[0]),
    ys = polygon.map((point) => point[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function drawPlatform(context, platform) {
  const start = platform.points[0][0],
    end = platform.points.at(-1)[0];
  const { left, right, top, bottom } = platformBounds(platform);
  const material = materialFor(platform.material);
  platformPath(context, platform);
  context.fillStyle = material.fill;
  context.fill();
  context.save();
  platformPath(context, platform);
  context.clip();
  if (material.pattern === "brick") {
    drawBrickPattern(context, left, right, top, bottom + 8);
  } else {
    for (
      let offset = 16, index = 0;
      offset < bottom - top;
      offset += 16, index++
    ) {
      context.beginPath();
      for (let x = left; x <= right; x += 6) {
        const y = curveAt(platform.points, x).y + offset;
        if (x === left) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = material.layers[index % material.layers.length];
      context.lineWidth = 2;
      context.stroke();
    }
  }
  context.restore();
  drawSurfaceEdge(context, platform.points, start, end, material);

  // Same pixel-grass tufts as the ground, on the island's top curve. The ±8
  // padding covers the jitter so a tuft is never missed at an island edge.
  if (material.vegetation) {
    const { pixelPath } = createDrawingTools(context);
    for (
      let i = Math.floor((start - 8) / 45);
      i <= Math.floor((end + 8) / 45);
      i++
    ) {
      const x = i * 45 + Math.sin(i * 9) * 8;
      if (x < start || x > end) continue;
      const y = curveAt(platform.points, x).y;
      pixelPath(
        [
          [x - 4, y - 2],
          [x - 4, y - 8],
          [x, y - 4],
          [x + 2, y - 10],
        ],
        material.vegetation,
        1,
        2,
      );
    }
  }
}

// Highest point of the base ground curve between `left` and `right`.
function groundTop(level, left, right) {
  let top = Infinity;
  for (let x = left; x < right + 8; x += 8)
    top = Math.min(top, curveAt(level.points, Math.min(x, right)).y);
  return top;
}

// ---------------------------------------------------------------------------
// Start sign
// ---------------------------------------------------------------------------

/**
 * Where the start sign stands, or null when there is no ground for it. Legacy
 * trails always put it at x 28; block trails put it the same distance behind
 * the start, on the surface under the start rather than the topmost one.
 */
function startSignAnchor(level, blocks) {
  if (!blocks) {
    if (!Array.isArray(level.points) || level.points.length < 2) return null;
    return { x: 28, y: terrainAt(level, 28, null).y };
  }
  const start = level.start || { x: 90, y: null };
  const x = start.x - 62;
  const surface = terrainAt(
    level,
    x,
    Number.isFinite(start.y) ? start.y : null,
  );
  return surface.solid ? { x, y: surface.y } : null;
}

function drawStartSign(context, level, anchor) {
  // Look for the ground just above the anchor, so the pole's base follows
  // the slope it stands on.
  const reference = anchor.y - 16;
  drawStartPennant(context, anchor.x, anchor.y, (localX) => {
    const surface = terrainAt(level, anchor.x + localX, reference);
    return surface?.solid ? surface.y - anchor.y : 0;
  });
}

// ---------------------------------------------------------------------------
// Block terrain rasteriser
//
// Blocks are drawn straight from the compiled union that physics collides
// with: every art-pixel column asks for the union's solid spans at its centre,
// so what is drawn solid is exactly what the wheels touch. A span's top is a
// floor and gets the grass-and-edge rim; its bottom is a ceiling and a sharp
// sideways change between columns is a wall, and both get a thin edge. The
// fill details are measured from the floor above them, like the old ground.
// Colours are written straight into the pixel buffer from the palette, so no
// anti-aliasing ever has to be quantised away.
// ---------------------------------------------------------------------------

// Neighbouring columns whose floors are within this height of each other are
// the same sloped surface, and their rims are joined; further apart is a wall.
const RIM_JOIN = 12;
const TUFT_CLEARANCE = 14;
const TUFT_MAX_RISE = 6;

const opaque = (color) => compositeColor(color, "#000000");
const materialColorCache = new Map();

function materialColors(name) {
  const cached = materialColorCache.get(name);
  if (cached) return cached;
  const material = materialFor(name);
  const colors = {
    fill: opaque(material.fill),
    edge: opaque(material.edge),
    surface: opaque(material.surface),
    layers: material.layers.map(opaque),
    detail: compositeColor(material.detail, material.fill),
    brick:
      material.pattern === "brick"
        ? compositeColor(BRICK_COLOR, material.fill)
        : null,
    vegetation: material.vegetation ? opaque(material.vegetation) : null,
  };
  materialColorCache.set(name, colors);
  return colors;
}

/** The top of the span in `spans` nearest to `top` within the join distance, or null. */
function joinedTop(spans, top) {
  let best = null;
  for (const span of spans) {
    const distance = Math.abs(span.top - top);
    if (
      distance <= RIM_JOIN &&
      (best === null || distance < Math.abs(best - top))
    )
      best = span.top;
  }
  return best;
}

function solidIn(spans, y) {
  for (const span of spans) if (y >= span.top && y < span.bottom) return true;
  return false;
}

/** The body whose material shows at `y`: the latest block among those solid there. */
function bodyIn(bodySpans, y) {
  let best = null;
  for (const span of bodySpans) {
    if (
      y >= span.top &&
      y < span.bottom &&
      (!best || span.topBody.blockIndex > best.blockIndex)
    )
      best = span.topBody;
  }
  return best;
}

/**
 * Rasterise the compiled block terrain into an RGBA buffer covering
 * `width` × `height` art pixels from world (`originX`, `originY`). Pure, so it
 * can be tested without a canvas.
 *
 * @returns {{ data: Uint8ClampedArray, width: number, height: number, opaque: boolean }}
 */
export function rasterizeTerrainChunk(
  compiled,
  originX,
  originY,
  width,
  height,
  pixel = ART_PIXEL,
) {
  const data = new Uint8ClampedArray(width * height * 4);
  const result = { data, width, height, opaque: false };
  const worldRight = originX + width * pixel,
    worldBottom = originY + height * pixel;
  const bounds = compiled?.bounds;
  if (
    !compiled?.bodies.length ||
    bounds.right < originX - 16 ||
    bounds.left > worldRight + 16 ||
    bounds.bottom < originY - 16 ||
    bounds.top > worldBottom + 16
  )
    return result;

  // 0 air, 1 plain fill, 2 fill detail, 3 rim or foliage. Pebbles may only
  // replace fill, so the rims always stay crisp.
  const kind = new Uint8Array(width * height);
  const column0 = Math.round(originX / pixel),
    row0 = Math.round(originY / pixel);
  const rowAt = (y) => Math.ceil(y / pixel - row0 - 0.5);
  const put = (column, row, color, what) => {
    if (column < 0 || column >= width || row < 0 || row >= height) return;
    const index = row * width + column,
      offset = index * 4;
    kind[index] = what;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 255;
    result.opaque = true;
  };

  // One column either side, so walls and joined rims at the chunk's edges
  // match the neighbouring chunk exactly.
  const bodySpans = new Array(width + 2),
    spans = new Array(width + 2);
  for (let column = -1; column <= width; column++) {
    const own = terrainBodySpans(compiled, (column0 + column + 0.5) * pixel);
    bodySpans[column + 1] = own;
    spans[column + 1] = mergeSpans(own);
  }

  for (let column = 0; column < width; column++) {
    const x = (column0 + column + 0.5) * pixel;
    const own = bodySpans[column + 1],
      here = spans[column + 1];
    const left = spans[column],
      right = spans[column + 2];
    if (!here.length) continue;
    const single =
      own.length === 1 ? materialColors(own[0].topBody.material) : null;
    const strata = [0, 1, 2, 3].map(
      (i) => 27 + i * 30 + Math.sin(x * 0.022 + i) * 5,
    );
    let previousBottom = -Infinity;
    for (const span of here) {
      const above = previousBottom;
      previousBottom = span.bottom;
      if (span.bottom < originY - 8 || span.top > worldBottom + 8) continue;
      // A sloped floor's rim covers the height it climbs across the column,
      // taken as halfway to each neighbour, so the grass line never breaks.
      const leftTop = joinedTop(left, span.top),
        rightTop = joinedTop(right, span.top);
      const midLeft = leftTop === null ? span.top : (span.top + leftTop) / 2;
      const midRight = rightTop === null ? span.top : (span.top + rightTop) / 2;
      const rimTop = Math.min(span.top, midLeft, midRight);
      const rimBottom = Math.max(span.top, midLeft, midRight);
      const floor =
        single ||
        materialColors((bodyIn(own, span.top + 0.01) || span.topBody).material);

      // Rim overhanging the floor into the air, as the old ground's did.
      const airFirst = Math.max(0, rowAt(Math.max(rimTop - 4, above)));
      const airLast = Math.min(height, rowAt(span.top));
      for (let row = airFirst; row < airLast; row++) {
        const y = (row0 + row + 0.5) * pixel;
        put(column, row, y < rimTop - 2 ? floor.edge : floor.surface, 3);
      }

      const first = Math.max(0, rowAt(span.top)),
        last = Math.min(height, rowAt(span.bottom));
      for (let row = first; row < last; row++) {
        const y = (row0 + row + 0.5) * pixel;
        if (y < rimBottom + 2) {
          put(column, row, floor.surface, 3);
          continue;
        }
        if (y < rimBottom + 4) {
          put(column, row, floor.edge, 3);
          continue;
        }
        const colors =
          single || materialColors((bodyIn(own, y) || span.topBody).material);
        if (
          span.bottom - y < pixel ||
          !solidIn(left, y) ||
          !solidIn(right, y)
        ) {
          put(column, row, colors.edge, 3);
          continue;
        }
        let color = colors.fill,
          what = 1;
        if (colors.brick) {
          const course = Math.floor(y / 14);
          const joint = (((course % 2) + 2) % 2) * 15;
          if (y - course * 14 < 2 || (((x - joint) % 30) + 30) % 30 < 2) {
            color = colors.brick;
            what = 2;
          }
        } else {
          const depth = y - span.top;
          for (let i = 0; i < 4; i++) {
            if (Math.abs(depth - strata[i]) < 1) {
              color = colors.layers[i % colors.layers.length];
              what = 2;
              break;
            }
          }
        }
        put(column, row, color, what);
      }
    }
  }

  drawPebbles(
    compiled,
    originX,
    originY,
    worldRight,
    worldBottom,
    pixel,
    column0,
    row0,
    width,
    kind,
    put,
  );
  drawTufts(compiled, originX, worldRight, pixel, column0, row0, put);
  return result;
}

// Pebbles hang a fixed depth below the floor above them, like the old ground's.
function drawPebbles(
  compiled,
  originX,
  originY,
  worldRight,
  worldBottom,
  pixel,
  column0,
  row0,
  width,
  kind,
  put,
) {
  for (
    let i = Math.floor((originX - 16) / 31);
    i <= Math.ceil((worldRight + 16) / 31);
    i++
  ) {
    const cx = i * 31 + Math.sin(i * 18) * 9;
    const rx = 2 + (((i % 3) + 3) % 3),
      ry = 1.5;
    if (cx + rx < originX || cx - rx > worldRight) continue;
    for (const span of terrainColumnSpans(compiled, cx)) {
      const cy = span.top + 16 + (Math.sin(i * 23) + 1) * 34;
      if (
        cy + ry > span.bottom - 2 ||
        cy + ry < originY ||
        cy - ry > worldBottom
      )
        continue;
      const colors = materialColors(
        (terrainBodyAt(compiled, cx, cy) || span.topBody).material,
      );
      const cos = Math.cos(0.3),
        sin = Math.sin(0.3);
      for (
        let column = Math.floor((cx - rx) / pixel) - column0;
        column <= Math.ceil((cx + rx) / pixel) - column0;
        column++
      ) {
        for (
          let row = Math.floor((cy - rx) / pixel) - row0;
          row <= Math.ceil((cy + rx) / pixel) - row0;
          row++
        ) {
          const dx = (column0 + column + 0.5) * pixel - cx,
            dy = (row0 + row + 0.5) * pixel - cy;
          const u = dx * cos + dy * sin,
            v = dy * cos - dx * sin;
          if ((u / rx) ** 2 + (v / ry) ** 2 > 1) continue;
          if (column < 0 || column >= width || row < 0) continue;
          const what = kind[row * width + column];
          if (what === 1 || what === 2) put(column, row, colors.detail, 2);
        }
      }
    }
  }
}

// Grass tufts on every gentle, open floor of a material that grows them,
// including cave floors, drawn with the same pixel lines as the old ground's.
function drawTufts(compiled, originX, worldRight, pixel, column0, row0, put) {
  for (
    let i = Math.floor((originX - 16) / 45);
    i <= Math.ceil((worldRight + 16) / 45);
    i++
  ) {
    const x = i * 45 + Math.sin(i * 9) * 8;
    if (x < originX - 8 || x > worldRight + 8) continue;
    let above = -Infinity;
    for (const span of terrainColumnSpans(compiled, x)) {
      const clearance = span.top - above;
      above = span.bottom;
      if (clearance < TUFT_CLEARANCE) continue;
      const colors = materialColors(
        (terrainBodyAt(compiled, x, span.top + 0.5) || span.topBody).material,
      );
      if (!colors.vegetation) continue;
      const before = joinedTop(terrainColumnSpans(compiled, x - 3), span.top);
      const after = joinedTop(terrainColumnSpans(compiled, x + 3), span.top);
      if (
        before === null ||
        after === null ||
        Math.abs(after - before) > TUFT_MAX_RISE
      )
        continue;
      const y = span.top;
      pixelLine(
        [
          [x - 4, y - 2],
          [x - 4, y - 8],
          [x, y - 4],
          [x + 2, y - 10],
        ],
        pixel,
        column0,
        row0,
        colors.vegetation,
        put,
      );
    }
  }
}

// Bresenham between art pixels, matching `pixelPath` from the drawing tools.
function pixelLine(points, pixel, column0, row0, color, put) {
  for (let segment = 1; segment < points.length; segment++) {
    let x0 = Math.round(points[segment - 1][0] / pixel),
      y0 = Math.round(points[segment - 1][1] / pixel);
    const x1 = Math.round(points[segment][0] / pixel),
      y1 = Math.round(points[segment][1] / pixel);
    const dx = Math.abs(x1 - x0),
      sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0),
      sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      put(x0 - column0, y0 - row0, color, 3);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) {
        error += dy;
        x0 += sx;
      }
      if (twice <= dx) {
        error += dx;
        y0 += sy;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk cache
// ---------------------------------------------------------------------------

// A body's identity for invalidation: its material and exact flattened edges.
function bodySignature(body) {
  let hash = 0x811c9dc5;
  const mix = (value) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const char of body.material) mix(char.charCodeAt(0));
  mix(body.blockIndex);
  const edges = body.edges;
  for (let index = 0; index < body.edgeCount * 4; index++)
    mix(Math.round(edges[index] * 64) | 0);
  return `${hash}:${body.edgeCount}`;
}

/**
 * The world x ranges whose art may differ between two compiled terrains.
 * Fill details hang from the floor above them, so a change anywhere in a
 * column can move art far below it: whole columns are dirty, not just boxes.
 */
function changedColumns(before, after) {
  const signatures = (compiled) =>
    new Map(compiled.bodies.map((body) => [bodySignature(body), body]));
  const old = signatures(before),
    next = signatures(after);
  const ranges = [];
  for (const [signature, body] of old)
    if (!next.has(signature))
      ranges.push([body.bounds.left, body.bounds.right]);
  for (const [signature, body] of next)
    if (!old.has(signature)) ranges.push([body.bounds.left, body.bounds.right]);
  return ranges;
}

export function createTerrainRenderer() {
  let currentLevel = null;
  let currentGeometry = null;
  let chunks = new Map();
  let palette = [];

  function buildLegacyChunk(level, originX, originY) {
    const left = originX - CHUNK_MARGIN,
      right = originX + CHUNK_SIZE + CHUNK_MARGIN;
    const top = originY - CHUNK_MARGIN,
      bottom = originY + CHUNK_SIZE + CHUNK_MARGIN;
    const overlaps = (bounds) =>
      !(
        bounds.right + 8 < left ||
        bounds.left - 8 > right ||
        bounds.bottom + 8 < top ||
        bounds.top - 8 > bottom
      );
    const paths = (level.paths || []).filter((path) =>
      overlaps(pathBounds(path)),
    );
    const platforms = (level.platforms || []).filter((platform) =>
      overlaps(platformBounds(platform)),
    );
    const hasGround = Array.isArray(level.points) && level.points.length >= 2;
    // Tall levels have many chunks of open sky; skip them before allocating
    // or quantizing anything. Ground art reaches up to 12 units above its curve.
    const groundVisible =
      hasGround && groundTop(level, left, right) - 16 <= bottom;
    return null;
    const canvas = createCanvas(CHUNK_PIXELS, CHUNK_PIXELS);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.setTransform(
      1 / ART_PIXEL,
      0,
      0,
      1 / ART_PIXEL,
      -originX / ART_PIXEL,
      -originY / ART_PIXEL,
    );
    if (hasGround) drawGround(context, level, left, right, top, bottom);
    for (const path of paths) drawAuthoredPath(context, path);
    for (const platform of platforms) drawPlatform(context, platform);
    return quantizeToPalette(context, CHUNK_PIXELS, CHUNK_PIXELS, palette)
      ? canvas
      : null;
  }

  function buildBlockChunk(geometry, originX, originY) {
    const raster = rasterizeTerrainChunk(
      geometry,
      originX,
      originY,
      CHUNK_PIXELS,
      CHUNK_PIXELS,
    );
    if (!raster.opaque) return null;
    const canvas = createCanvas(CHUNK_PIXELS, CHUNK_PIXELS);
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(raster.data, CHUNK_PIXELS, CHUNK_PIXELS),
        0,
        0,
      );
    return canvas;
  }

  // On block trails the sign follows the start, which the editor moves
  // without touching the terrain, so it is drawn live rather than baked in.
  let signKey = "",
    signAnchor = null;
  function blockSign(level) {
    const key = `${level.start?.x}|${level.start?.y}`;
    if (key !== signKey) {
      signKey = key;
      signAnchor = startSignAnchor(level, currentGeometry);
    }
    return signAnchor;
  }

  function chunk(level, column, row) {
    const key = column + "," + row;
    if (chunks.has(key)) {
      const cached = chunks.get(key);
      chunks.delete(key);
      chunks.set(key, cached);
      return cached;
    }
    const originX = column * CHUNK_SIZE,
      originY = row * CHUNK_SIZE;
    const built = currentGeometry
      ? buildBlockChunk(currentGeometry, originX, originY)
      : buildLegacyChunk(level, originX, originY);
    chunks.set(key, built);
    if (chunks.size > CHUNK_LIMIT) chunks.delete(chunks.keys().next().value);
    return built;
  }

  // Draws every chunk overlapping the view. `ctx` must already map world units.
  // The compiled terrain is cached per level and replaced whenever the level is
  // invalidated, so an edit is noticed here without the caller doing anything,
  // and only the chunks in the columns it changed are drawn again.
  function draw(ctx, level, viewX, viewY, width, height) {
    if (level !== currentLevel) invalidate(level);
    else refresh(level);
    const firstColumn = Math.floor(viewX / CHUNK_SIZE),
      lastColumn = Math.floor((viewX + width) / CHUNK_SIZE);
    const firstRow = Math.floor(viewY / CHUNK_SIZE),
      lastRow = Math.floor((viewY + height) / CHUNK_SIZE);
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const image = chunk(level, column, row);
        if (image)
          ctx.drawImage(
            image,
            column * CHUNK_SIZE,
            row * CHUNK_SIZE,
            CHUNK_SIZE,
            CHUNK_SIZE,
          );
      }
    }
    const sign = currentGeometry
      ? blockSign(level)
      : startSignAnchor(level, null);
    if (sign) drawStartSign(ctx, level, sign);
  }

  function refresh(level) {
    const geometry = level ? terrainGeometry(level) : null;
    if (geometry === currentGeometry) return;
    if (!geometry || !currentGeometry) {
      invalidate(level);
      return;
    }
    const previous = currentGeometry;
    currentGeometry = geometry;
    signKey = "";
    invalidateColumns(changedColumns(previous, geometry));
  }

  /** Forget the chunks covering any of the given world x ranges, with rim margin. */
  function invalidateColumns(ranges) {
    for (const key of [...chunks.keys()]) {
      const column = Number(key.slice(0, key.indexOf(",")));
      const left = column * CHUNK_SIZE - CHUNK_MARGIN,
        right = (column + 1) * CHUNK_SIZE + CHUNK_MARGIN;
      if (ranges.some(([from, to]) => to >= left && from <= right))
        chunks.delete(key);
    }
  }

  function invalidate(level = null) {
    currentLevel = level;
    currentGeometry = level ? terrainGeometry(level) : null;
    chunks = new Map();
    signKey = "";
    palette = level && !currentGeometry ? levelPalette(level) : [];
  }

  return { draw, invalidate };
}
