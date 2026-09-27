import { curveAt, seatedSurfaceAt } from "./terrain.js";

const GROUND_ALIGNED_PROP_SPANS = {
  fence: [-24, 22],
  rock: [-16, 18],
  boulder: [-22, 22],
};

export function propAlignmentSlope(level, prop) {
  const span = GROUND_ALIGNED_PROP_SPANS[prop.type];
  if (!span) return 0;
  const surface = seatedSurfaceAt(level, prop.x, prop.y);
  if (!surface) return 0;
  const points = surface.platform?.points || level.points;
  const [left, right] = span;
  return (
    (curveAt(points, prop.x + right).y - curveAt(points, prop.x + left).y) /
    (right - left)
  );
}

export function propDrawAngle(type, slope = 0) {
  return GROUND_ALIGNED_PROP_SPANS[type] && Number.isFinite(slope)
    ? Math.atan(slope)
    : 0;
}

// How far the camera can climb while the sun still sinks a little in the sky;
// above that it holds its place so it stays in view on tall levels.
const SUN_CLIMB_LIMIT = 600;
// Vertical spacing, in cloud-parallax space, of the cloud rows repeated above
// the first one as the camera climbs.
const CLOUD_ROW_SPACING = 180;

export function sunLight({ width, cameraX = 0, cameraY = 0, weather = {} }) {
  const sunshine = Math.max(0, Math.min(1, weather.sun ?? 1));
  const cloudiness = Math.max(0, Math.min(1, weather.clouds ?? 0.35));
  return {
    x: width * 0.77 - cameraX * 0.015,
    y: 85 - Math.max(cameraY, -SUN_CLIMB_LIMIT) * 0.08,
    sunshine,
    strength: sunshine * (1 - cloudiness * 0.55),
  };
}

export function sunShadowOffset({
  bikeX,
  bikeY,
  sunX,
  sunY,
  height = 0,
  strength = 1,
}) {
  const slant = (sunX - bikeX) / Math.max(Math.abs(sunY - bikeY), 48);
  const reach = 10 + Math.max(0, height) * 0.05;
  const offset = -slant * strength * reach;
  if (!offset) return 0;
  return Math.max(-14, Math.min(14, offset));
}

export function propGroundOffset(level, prop) {
  const surface = seatedSurfaceAt(level, prop.x, prop.y);
  if (!surface) return () => 0;
  const points = surface.platform?.points || level.points;
  const originY = Number.isFinite(prop.y) ? prop.y : surface.y;
  return (localX) => curveAt(points, prop.x + localX).y - originY;
}

// World units per art pixel. Gameplay art snaps to this grid; far parallax uses twice it.
export const ART_PIXEL = 2;

export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

export const RIDER_PALETTES = {
  max: {
    jacket: "#e8e5d9",
    jacketLight: "#fff8e7",
    trousers: "#29464e",
    helmet: "#f4a442",
    helmetLight: "#ffd078",
    skin: "#bd7954",
  },
  Maxine: {
    jacket: "#d86f82",
    jacketLight: "#ef9aa8",
    trousers: "#39435d",
    helmet: "#63aa98",
    helmetLight: "#a8dfcf",
    skin: "#bd7954",
  },
};
export const riderPalette = (rider) =>
  RIDER_PALETTES[rider] || RIDER_PALETTES.max;

// Selectable bike models drawn by createGameArt().drawBike. Every model keeps
// the same seat, peg, and handlebar positions so any rider fits any bike.
export const BIKE_MODELS = ["elasto", "classic"];
export const DEFAULT_BIKE = "elasto";

const ELASTO_COLORS = {
  green: "#3aa63c",
  greenLight: "#8fdc6e",
  greenDark: "#1f6b2c",
  white: "#eef1e8",
  silver: "#c3cbcd",
  silverDark: "#727c80",
  black: "#1b2124",
  red: "#d63b2c",
  orange: "#f08a3a",
  tire: "#16191b",
  tread: "#3a4246",
  rim: "#5d676b",
  spoke: "#39424a",
  hub: "#8e989c",
  hubLight: "#c9d0d2",
};

const NUMBER_EIGHT = "111101111101111";

function parseColor(color) {
  const hex = color.replace("#", "");
  const value =
    hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return [0, 2, 4, 6].map((offset) =>
    offset < value.length ? parseInt(value.slice(offset, offset + 2), 16) : 255,
  );
}

// A translucent colour painted over an opaque one, as an opaque [r, g, b].
export function compositeColor(color, over) {
  const [r, g, b, a] = parseColor(color);
  const [br, bg, bb] = parseColor(over);
  const alpha = a / 255;
  return [
    r * alpha + br * (1 - alpha),
    g * alpha + bg * (1 - alpha),
    b * alpha + bb * (1 - alpha),
  ].map(Math.round);
}

// Snaps every pixel of a rendered sprite or chunk to fully opaque palette
// colours or full transparency, removing the canvas anti-aliasing. Returns
// false when nothing opaque remains.
export function quantizeToPalette(context, width, height, palette) {
  const colors = palette.map((color) =>
    typeof color === "string" ? parseColor(color).slice(0, 3) : color,
  );
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const nearest = new Map();
  let opaque = false;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < 128) {
      data[offset + 3] = 0;
      continue;
    }
    opaque = true;
    const key =
      (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    let match = nearest.get(key);
    if (!match) {
      let best = Infinity;
      for (const color of colors) {
        const dr = color[0] - data[offset],
          dg = color[1] - data[offset + 1],
          db = color[2] - data[offset + 2];
        const distance = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (distance < best) {
          best = distance;
          match = color;
        }
      }
      nearest.set(key, match);
    }
    data[offset] = match[0];
    data[offset + 1] = match[1];
    data[offset + 2] = match[2];
    data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return opaque;
}

// 3x5 bitmap glyphs, rows top to bottom.
const GLYPHS = {
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "110101101101101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  0: "111101101101111",
  1: "010110010010111",
  2: "110001010100111",
  3: "110001010001110",
  4: "101101111001001",
  5: "111100110001110",
  6: "011100111101111",
  7: "111001010010010",
  8: "111101111101111",
  9: "111101111001110",
  " ": "000000000000000",
  "→": "010001111001010",
  "/": "001001010100100",
  ".": "000000000000010",
  "!": "010010010000010",
  "+": "000010111010000",
  "-": "000000111000000",
  ":": "000010000010000",
  "×": "000101010101000",
  "#": "101111101111101",
};

export function pixelTextWidth(text, pixel = ART_PIXEL) {
  return text.length ? (text.length * 4 - 1) * pixel : 0;
}

export function createDrawingTools(ctx) {
  function line(points, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((point, index) =>
      index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]),
    );
    ctx.stroke();
  }

  function circle(x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function pixelRect(x, y, width, height, color, pixel = 2) {
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(x / pixel) * pixel,
      Math.round(y / pixel) * pixel,
      Math.max(pixel, Math.round(width / pixel) * pixel),
      Math.max(pixel, Math.round(height / pixel) * pixel),
    );
  }

  function pixelPath(points, color, thickness = 1, pixel = 2) {
    ctx.fillStyle = color;
    const radius = Math.floor(thickness / 2);
    for (let segment = 1; segment < points.length; segment++) {
      let x0 = Math.round(points[segment - 1][0] / pixel);
      let y0 = Math.round(points[segment - 1][1] / pixel);
      const x1 = Math.round(points[segment][0] / pixel);
      const y1 = Math.round(points[segment][1] / pixel);
      const dx = Math.abs(x1 - x0),
        sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0),
        sy = y0 < y1 ? 1 : -1;
      let error = dx + dy;
      while (true) {
        ctx.fillRect(
          (x0 - radius) * pixel,
          (y0 - radius) * pixel,
          thickness * pixel,
          thickness * pixel,
        );
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

  // One fillRect per row; the centre snaps to the pixel grid.
  function drawPixelDisc(x, y, radius, color, pixel = 4) {
    ctx.fillStyle = color;
    const cells = Math.ceil(radius / pixel);
    const cx = Math.round(x / pixel) * pixel,
      cy = Math.round(y / pixel) * pixel;
    for (let py = -cells; py <= cells; py++) {
      const span = Math.floor(Math.sqrt(cells * cells - py * py));
      ctx.fillRect(
        cx - span * pixel,
        cy + py * pixel,
        (span * 2 + 1) * pixel,
        pixel,
      );
    }
  }

  // `x` is the anchor for `align`, `y` the top of the glyphs.
  function drawPixelText(
    text,
    x,
    y,
    color,
    { pixel = ART_PIXEL, align = "center" } = {},
  ) {
    const value = String(text).toUpperCase();
    const width = pixelTextWidth(value, pixel);
    let left =
      align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    left = Math.round(left / pixel) * pixel;
    const top = Math.round(y / pixel) * pixel;
    ctx.fillStyle = color;
    for (let index = 0; index < value.length; index++) {
      const glyph = GLYPHS[value[index]] || GLYPHS["#"];
      const glyphLeft = left + index * 4 * pixel;
      for (let cell = 0; cell < 15; cell++) {
        if (glyph[cell] === "1")
          ctx.fillRect(
            glyphLeft + (cell % 3) * pixel,
            top + Math.floor(cell / 3) * pixel,
            pixel,
            pixel,
          );
      }
    }
  }

  function drawPixelSpring(x1, y1, x2, y2, color) {
    const dx = x2 - x1,
      dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length,
      ny = dx / length;
    const points = [[x1, y1]];
    for (let index = 1; index < 6; index++) {
      const amount = index / 6;
      const offset = (index % 2 ? 1 : -1) * 2.5;
      points.push([
        x1 + dx * amount + nx * offset,
        y1 + dy * amount + ny * offset,
      ]);
    }
    points.push([x2, y2]);
    pixelPath(points, color, 1);
  }

  return {
    line,
    circle,
    pixelRect,
    pixelPath,
    drawPixelDisc,
    drawPixelSpring,
    drawPixelText,
  };
}

const APPLE_SPRITE = [
  ".....S.LL..",
  ".....SLL...",
  "..RRRSRRR..",
  ".RRRRRRRRR.",
  "RRHRRRRRRRR",
  "RHRRRRRRRRD",
  "RHRRRRRRRRD",
  "RRRRRRRRRRD",
  ".RRRRRRRRD.",
  "..RRDRRDD..",
];
const APPLE_COLORS = {
  R: "#ed774e",
  D: "#c9573a",
  H: "#ffc295",
  S: "#617144",
  L: "#567a4e",
};

const BACKGROUND_STRIP_WIDTH = 512;
const BACKGROUND_STRIP_TOP = 120;
const BACKGROUND_STRIP_HEIGHT = 400;
const BACKGROUND_STRIP_LIMIT = 64;
const BIKE_SPRITE_REACH = 80;

export function createGameArt(ctx) {
  const { pixelRect, pixelPath, drawPixelDisc, drawPixelText } =
    createDrawingTools(ctx);
  const TAU = Math.PI * 2;
  const spikeSprites = new Map();
  const backgroundStrips = new Map();
  let bikeSprite = null;

  // Moving sprites sit at their exact position rounded to whole device pixels,
  // so they glide instead of stepping a full art pixel at a time.
  function translateToDevice(x, y) {
    const scale = ctx.getTransform().a || 1;
    ctx.translate(Math.round(x * scale) / scale, Math.round(y * scale) / scale);
  }

  function drawApple(x, y, { glow = true } = {}) {
    if (glow) {
      drawPixelDisc(x, y, 15, "#fbf0ce50", ART_PIXEL);
    }
    const left = Math.round(x / ART_PIXEL) * ART_PIXEL - 11;
    const top = Math.round(y / ART_PIXEL) * ART_PIXEL - 12;
    for (let row = 0; row < APPLE_SPRITE.length; row++) {
      const line = APPLE_SPRITE[row];
      for (let column = 0; column < line.length; column++) {
        const color = APPLE_COLORS[line[column]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(
          left + column * ART_PIXEL - 1,
          top + row * ART_PIXEL,
          ART_PIXEL,
          ART_PIXEL,
        );
      }
    }
  }

  function drawFlag(x, y, unlocked, remaining = 0) {
    pixelRect(x - 2, y - 108, 4, 108, "#304a42", 2);
    pixelRect(x - 4, y - 112, 8, 6, "#ed9150", 2);
    const size = 8;
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 4; col++) {
        pixelRect(
          x + 2 + col * size,
          y - 104 + row * size,
          size,
          size,
          (row + col) % 2 ? (unlocked ? "#28483a" : "#758477") : "#f2e9cf",
          2,
        );
      }
    const text = unlocked
      ? "FINISH"
      : `${remaining} APPLE${remaining === 1 ? "" : "S"}`;
    const width = pixelTextWidth(text);
    pixelRect(x - width / 2 - 4, y - 62, width + 8, 16, "#f4e9d1", 2);
    drawPixelText(text, x, y - 59, "#365345");
  }

  function starPath(context, points, outer, inner) {
    context.beginPath();
    for (let index = 0; index < points * 2; index++) {
      const angle = (index * Math.PI) / points;
      const radius = index % 2 ? inner : outer;
      if (index)
        context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else context.moveTo(radius, 0);
    }
    context.closePath();
  }

  // The rotating star is rendered once per radius, snapped to its palette, and
  // then rotated with nearest-neighbour sampling so it stays pixel-sharp.
  function spikeSprite(radius) {
    const key = radius.toFixed(2);
    if (spikeSprites.has(key)) return spikeSprites.get(key);
    const reach = Math.ceil((radius + 4) / ART_PIXEL) * ART_PIXEL;
    const size = (reach / ART_PIXEL) * 2;
    const canvas = createCanvas(size, size);
    const context = canvas.getContext("2d");
    context.setTransform(
      1 / ART_PIXEL,
      0,
      0,
      1 / ART_PIXEL,
      size / 2,
      size / 2,
    );
    const points = Math.max(7, Math.min(12, Math.round(radius * 0.4)));
    const core = radius * 0.56;
    starPath(context, points, radius + 2, core);
    context.fillStyle = "#263b36";
    context.fill();
    starPath(context, points, radius - 0.5, core * 0.9);
    context.fillStyle = "#b9c4af";
    context.fill();
    const tools = createDrawingTools(context);
    for (let index = 0; index < points; index++) {
      const spoke = (index * TAU) / points;
      tools.pixelPath(
        [
          [Math.cos(spoke) * core * 0.7, Math.sin(spoke) * core * 0.7],
          [Math.cos(spoke) * (radius - 4), Math.sin(spoke) * (radius - 4)],
        ],
        "#e8ecd9",
        1,
        ART_PIXEL,
      );
    }
    quantizeToPalette(context, size, size, ["#263b36", "#b9c4af", "#e8ecd9"]);
    const sprite = { canvas, reach };
    spikeSprites.set(key, sprite);
    return sprite;
  }

  function drawSpike(x, y, radius = 18, angle = 0) {
    const core = radius * 0.56;
    const cx = Math.round(x / ART_PIXEL) * ART_PIXEL,
      cy = Math.round(y / ART_PIXEL) * ART_PIXEL;
    const sprite = spikeSprite(radius);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(
      sprite.canvas,
      -sprite.reach,
      -sprite.reach,
      sprite.reach * 2,
      sprite.reach * 2,
    );
    ctx.restore();
    drawPixelDisc(cx, cy, core + 1.5, "#263b36", ART_PIXEL);
    drawPixelDisc(cx, cy, core - 0.5, "#c7442f", ART_PIXEL);
    drawPixelDisc(
      cx - core * 0.15,
      cy - core * 0.15,
      core * 0.65,
      "#ed7050",
      ART_PIXEL,
    );
    pixelRect(
      cx - core * 0.55,
      cy - core * 0.6,
      Math.max(2, core * 0.35),
      Math.max(2, core * 0.25),
      "#ffc295",
      2,
    );
    pixelRect(cx - 2, cy - 2, 4, 4, "#263b36", 2);
    pixelRect(
      cx + Math.cos(angle) * core * 0.45 - 1,
      cy + Math.sin(angle) * core * 0.45 - 1,
      2,
      2,
      "#7c2b24",
      2,
    );
  }

  function drawElastoWheel(point) {
    const c = ELASTO_COLORS;
    ctx.save();
    translateToDevice(point.x, point.y);
    for (let y = -6; y <= 6; y++)
      for (let x = -6; x <= 6; x++) {
        const distance = Math.hypot(x, y);
        if (distance <= 6.5 && distance >= 4.9)
          pixelRect(x * 2, y * 2, 2, 2, c.tire);
        else if (distance < 4.9 && distance >= 4)
          pixelRect(x * 2, y * 2, 2, 2, c.rim);
      }
    const spin = point.spin || 0;
    const treadPhase = Math.round(spin / (TAU / 32)) * (TAU / 32);
    for (let i = 0; i < 8; i++) {
      const tread = treadPhase + (i * TAU) / 8;
      pixelRect(
        Math.round(Math.cos(tread) * 5.6) * 2,
        Math.round(Math.sin(tread) * 5.6) * 2,
        2,
        2,
        c.tread,
      );
    }
    const spokePhase = Math.round(spin / (TAU / 24)) * (TAU / 24);
    for (let i = 0; i < 6; i++) {
      const spoke = spokePhase + (i * TAU) / 6;
      pixelPath(
        [
          [0, 0],
          [Math.cos(spoke) * 8, Math.sin(spoke) * 8],
        ],
        c.spoke,
        1,
      );
    }
    pixelRect(-4, -2, 8, 4, c.hub);
    pixelRect(-2, -4, 4, 8, c.hub);
    pixelRect(-2, -2, 4, 4, c.hubLight);
    ctx.restore();
  }

  function drawClassicWheel(point) {
    ctx.save();
    translateToDevice(point.x, point.y);
    const cx = 0,
      cy = 0;
    for (let y = -6; y <= 6; y++)
      for (let x = -6; x <= 6; x++) {
        const distance = Math.hypot(x, y);
        if (distance <= 6.5 && distance >= 4.7)
          pixelRect(cx + x * 2, cy + y * 2, 2, 2, "#203332");
        else if (distance < 4.7 && distance >= 3.5)
          pixelRect(cx + x * 2, cy + y * 2, 2, 2, "#b9c4af");
      }
    const phase = (Math.round((point.spin || 0) / (Math.PI / 4)) * Math.PI) / 4;
    for (let i = 0; i < 4; i++) {
      const spoke = phase + (i * Math.PI) / 2;
      pixelPath(
        [
          [cx, cy],
          [cx + Math.cos(spoke) * 8, cy + Math.sin(spoke) * 8],
        ],
        "#657a70",
        1,
      );
    }
    pixelRect(cx - 2, cy - 2, 4, 4, "#f1cb91");
    ctx.restore();
  }

  function mountainY(worldX, layer) {
    return (
      layer.base +
      Math.sin(worldX * layer.frequency + 1.7) * layer.amp +
      Math.sin(worldX * layer.frequency * 2.1) * 10
    );
  }

  // Parallax layers are static in their own scroll space, so each is cached as
  // 512-unit strips that are blitted at the layer's scroll offset.
  function backgroundStrip(layer, layerIndex, index, trees) {
    const key = `${layer.color}|${layerIndex}|${index}`;
    if (backgroundStrips.has(key)) {
      const strip = backgroundStrips.get(key);
      backgroundStrips.delete(key);
      backgroundStrips.set(key, strip);
      return strip;
    }
    const canvas = createCanvas(
      BACKGROUND_STRIP_WIDTH / ART_PIXEL,
      BACKGROUND_STRIP_HEIGHT / ART_PIXEL,
    );
    const context = canvas.getContext("2d");
    const left = index * BACKGROUND_STRIP_WIDTH;
    context.setTransform(
      1 / ART_PIXEL,
      0,
      0,
      1 / ART_PIXEL,
      -left / ART_PIXEL,
      -BACKGROUND_STRIP_TOP / ART_PIXEL,
    );
    const tools = createDrawingTools(context);
    const bottom = BACKGROUND_STRIP_TOP + BACKGROUND_STRIP_HEIGHT;
    context.fillStyle = layer.color;
    for (
      let worldX = left - 8;
      worldX < left + BACKGROUND_STRIP_WIDTH;
      worldX += 8
    ) {
      const y = Math.round(mountainY(worldX, layer) / 4) * 4;
      context.fillRect(worldX, y, 8, bottom - y);
    }
    if (trees) {
      for (
        let tree = Math.floor((left - 30) / 100);
        tree <= Math.ceil((left + BACKGROUND_STRIP_WIDTH + 30) / 100);
        tree++
      ) {
        const x = tree * 100;
        const y = Math.round(mountainY(x, layer) / 4) * 4;
        tools.pixelRect(x - 2, y - 28, 4, 28, "#708b78", 4);
        tools.drawPixelDisc(x, y - 34, 14, "#78977b", 4);
        tools.drawPixelDisc(x - 10, y - 29, 10, "#78977b", 4);
        tools.drawPixelDisc(x + 10, y - 28, 10, "#78977b", 4);
      }
    }
    backgroundStrips.set(key, canvas);
    if (backgroundStrips.size > BACKGROUND_STRIP_LIMIT)
      backgroundStrips.delete(backgroundStrips.keys().next().value);
    return canvas;
  }

  /**
   * `smooth` is for contexts that map world units to many device pixels: shapes
   * keep their pixel grid but are placed at their exact scroll position.
   */
  function drawBackground({
    width,
    height,
    palette,
    cameraX = 0,
    cameraY = 0,
    full = true,
    smooth = false,
  }) {
    // Offsets land on whole device pixels so pixel rows never blend at their seams.
    const deviceScale = smooth ? ctx.getTransform().a : 1 / ART_PIXEL;
    const snap = (value) => Math.round(value * deviceScale) / deviceScale;
    // Draws pixel-snapped art around (x, y), then shifts it by the snapping error.
    const placed = (x, y, grid, draw) => {
      if (!smooth) {
        draw(x, y);
        return;
      }
      const gx = Math.round(x / grid) * grid,
        gy = Math.round(y / grid) * grid;
      ctx.save();
      ctx.translate(snap(x - gx), snap(y - gy));
      draw(gx, gy);
      ctx.restore();
    };
    const weather = palette.weather || {};
    const rain = Math.max(0, Math.min(1, Number(weather.rain) || 0));
    const lightning = Math.max(0, Math.min(1, Number(weather.lightning) || 0));
    const cloudiness = Math.max(0, Math.min(1, weather.clouds ?? 0.35));
    const light = sunLight({ width, cameraX, cameraY, weather });
    const storminess = Math.max(rain, lightning);

    ctx.fillStyle = palette.sky;
    ctx.fillRect(0, 0, width, height);
    if (light.sunshine > 0) {
      ctx.save();
      ctx.globalAlpha = light.strength;
      placed(light.x, light.y, 4, (x, y) =>
        drawPixelDisc(x, y, 28 + light.sunshine * 8, palette.sun, 4),
      );
      ctx.restore();
    }
    if (cloudiness > 0) {
      const spacing = 300 - cloudiness * 190;
      const scale = 0.62 + cloudiness * 0.65;
      const firstCloud = Math.floor((cameraX * 0.07) / spacing) - 1;
      const cloudColor = storminess > 0.15 ? "#bdc8c3" : "#f8f7e9";
      ctx.save();
      ctx.globalAlpha = 0.42 + cloudiness * 0.5;
      const cloudShift = -cameraY * 0.08;
      // Row 0 is the original band; rows above it only exist once the camera climbs.
      const lastRow = Math.max(
        0,
        Math.floor((cloudShift + 64 + 60) / CLOUD_ROW_SPACING),
      );
      const firstRow = Math.max(
        0,
        Math.ceil((cloudShift + 64 - height - 60) / CLOUD_ROW_SPACING),
      );
      for (let row = firstRow; row <= lastRow; row++) {
        const rowY = 64 - row * CLOUD_ROW_SPACING + cloudShift;
        const rowX = row * 137;
        for (
          let index = firstCloud - 1;
          index < firstCloud + Math.ceil(width / spacing) + 2;
          index++
        ) {
          const seed = index + row * 7;
          placed(
            index * spacing + 55 + (rowX % spacing) - cameraX * 0.07,
            rowY + Math.sin(seed * 4) * 22,
            4,
            (x, y) => {
              pixelRect(x, y, 54 * scale, 6 * scale, cloudColor, 4);
              pixelRect(
                x + 12 * scale,
                y - 6 * scale,
                24 * scale,
                6 * scale,
                cloudColor,
                4,
              );
              pixelRect(
                x + 30 * scale,
                y + 6 * scale,
                42 * scale,
                6 * scale,
                cloudColor,
                4,
              );
            },
          );
        }
      }
      ctx.restore();
    }

    if (full) {
      const layers = [
        {
          color: palette.mountain,
          base: 201,
          amp: 37,
          frequency: 0.009,
          parallax: 0.16,
        },
        {
          color: "#8ea997",
          base: 247,
          amp: 24,
          frequency: 0.015,
          parallax: 0.29,
        },
      ];
      layers.forEach((layer, layerIndex) => {
        const offsetX = snap(cameraX * layer.parallax);
        const offsetY = snap(cameraY * layer.parallax);
        const first = Math.floor(offsetX / BACKGROUND_STRIP_WIDTH);
        const last = Math.floor((offsetX + width) / BACKGROUND_STRIP_WIDTH);
        const stripTop = BACKGROUND_STRIP_TOP - offsetY;
        const below = stripTop + BACKGROUND_STRIP_HEIGHT;
        if (stripTop < height && below > 0)
          for (let index = first; index <= last; index++) {
            ctx.drawImage(
              backgroundStrip(layer, layerIndex, index, layerIndex === 1),
              index * BACKGROUND_STRIP_WIDTH - offsetX,
              stripTop,
              BACKGROUND_STRIP_WIDTH,
              BACKGROUND_STRIP_HEIGHT,
            );
          }
        if (below < height) {
          ctx.fillStyle = layer.color;
          ctx.fillRect(0, below, width, height - below);
        }
      });
    }
    if (storminess > 0) {
      ctx.fillStyle = `rgba(38, 55, 62, ${storminess * 0.2})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  function rectDownTo(x, top, width, color, pixel, groundOffset) {
    for (let column = 0; column < width; column += pixel) {
      const bottom = groundOffset(x + column + pixel / 2);
      if (bottom <= top) continue;
      pixelRect(x + column, top, pixel, bottom - top, color, pixel);
    }
  }

  function rectAboveGround(x, y, width, height, color, pixel, groundOffset) {
    for (let column = 0; column < width; column += pixel) {
      const bottom = Math.min(y + height, groundOffset(x + column + pixel / 2));
      if (bottom <= y) continue;
      pixelRect(x + column, y, pixel, bottom - y, color, pixel);
    }
  }

  function drawProp(type, x, y, alpha = 1, slope = 0, groundOffset = () => 0) {
    ctx.save();
    ctx.translate(Math.round(x / 2) * 2, Math.round(y / 2) * 2);
    ctx.rotate(propDrawAngle(type, slope));
    ctx.globalAlpha = alpha;
    if (type === "tree") {
      rectDownTo(-4, -44, 8, "#66543f", 2, groundOffset);
      drawPixelDisc(-8, -52, 14, "#477158", 2);
      drawPixelDisc(8, -56, 16, "#568061", 2);
      drawPixelDisc(0, -70, 12, "#618b66", 2);
    } else if (type === "pine") {
      rectDownTo(-2, -46, 6, "#66543f", 2, groundOffset);
      pixelRect(-18, -58, 36, 12, "#477158", 2);
      pixelRect(-12, -68, 24, 10, "#4e785c", 2);
      pixelRect(-6, -76, 16, 8, "#568061", 2);
      pixelRect(-2, -82, 8, 6, "#618b66", 2);
    } else if (type === "fence") {
      pixelRect(-22, -26, 4, 26, "#856d4f", 2);
      pixelRect(18, -26, 4, 26, "#856d4f", 2);
      pixelRect(-24, -20, 46, 4, "#aa8a60", 2);
      pixelRect(-24, -10, 46, 4, "#aa8a60", 2);
    } else if (type === "rock") {
      pixelRect(-16, -8, 34, 8, "#697872", 2);
      pixelRect(-10, -14, 22, 6, "#7f8d83", 2);
      pixelRect(-4, -18, 10, 4, "#aeb5a7", 2);
    } else if (type === "boulder") {
      pixelRect(-22, -12, 44, 12, "#697872", 2);
      pixelRect(-16, -22, 34, 10, "#7f8d83", 2);
      pixelRect(-10, -30, 24, 8, "#8b978c", 2);
      pixelRect(-6, -36, 16, 6, "#a2ab9e", 2);
      pixelRect(-2, -40, 8, 4, "#aeb5a7", 2);
    } else if (type === "flowers") {
      for (let index = -2; index <= 2; index++) {
        const offset = index * 6,
          height = 8 + (Math.abs(index) % 2) * 4,
          drop = groundOffset(offset + 1);
        pixelRect(offset, -height + drop, 2, height, "#58784d", 2);
        pixelRect(
          offset - 2,
          -height - 4 + drop,
          6,
          4,
          index % 2 ? "#f1b95d" : "#e8755b",
          2,
        );
      }
    } else if (type === "stump") {
      rectDownTo(-10, -14, 20, "#806244", 2, groundOffset);
      rectAboveGround(-10, -16, 20, 4, "#c39664", 2, groundOffset);
      rectAboveGround(-4, -16, 8, 2, "#76573d", 2, groundOffset);
    } else if (type === "crystal") {
      pixelPath(
        [
          [-14, groundOffset(-14)],
          [-8, -28],
          [0, -40],
          [8, -24],
          [14, groundOffset(14)],
        ],
        "#83d1ce",
        3,
      );
      pixelPath(
        [
          [0, -36],
          [0, -4],
        ],
        "#d9ffff",
        1,
      );
    }
    ctx.restore();
  }

  function bikeCanvas() {
    if (bikeSprite) return bikeSprite;
    const size = (BIKE_SPRITE_REACH * 2) / ART_PIXEL;
    const canvas = createCanvas(size, size);
    const context = canvas.getContext("2d");
    bikeSprite = { canvas, context, size, tools: createDrawingTools(context) };
    return bikeSprite;
  }

  // The frame and rider are drawn axis-aligned into a scratch sprite, where every
  // rectangle lands on whole art pixels, and the sprite is then rotated onto the
  // scene with nearest-neighbour sampling instead of rotating each rectangle.
  // Frames are drawn facing right with the rear axle at (-half, 0) and the front
  // axle at (half, 0). Parts joined to an axle use `path`; parts on the sprung
  // body use `bodyPoint`, `bodyRect`, and `bodyPath` so they pitch and drop.
  function drawClassicFrame({
    path,
    spring,
    half,
    bodyPoint,
    bodyRect,
    bodyPath,
    brakePressure,
  }) {
    const backMount = bodyPoint(-9, -15),
      frontMount = bodyPoint(12, -23);
    const crank = bodyPoint(-3, -1);

    path(
      [[-half, 0], bodyPoint(-7, -18), bodyPoint(13, -17), [half, 0]],
      "#d95832",
      2,
    );
    path([[-half, 0], crank, [half, 0]], "#ed7842", 2);
    path([[-half, 0], backMount], "#819084", 1);
    path([[half, 0], frontMount], "#b9c4af", 2);
    spring(-half, 0, backMount[0], backMount[1], "#f0b45f");
    spring(half, 0, frontMount[0], frontMount[1], "#f0b45f");

    bodyRect(-9, -20, 24, 4, "#ee6f3f");
    bodyRect(-17, -24, 14, 4, "#263a35");
    bodyRect(-20, -27, 5, 5, brakePressure > 0.08 ? "#ff6045" : "#713c35", 2);
    if (brakePressure > 0.6) bodyRect(-19, -26, 2, 2, "#ffd0a2", 2);
    bodyPath(
      [
        [10, -23],
        [18, -26],
        [24, -26],
      ],
      "#263a35",
      2,
    );
    bodyRect(-9, -8, 12, 10, "#435a52");
    bodyRect(-5, -4, 10, 6, "#2f463d");
    bodyRect(-3, -2, 6, 6, "#edb466");
  }

  function drawElastoFrame({
    path,
    spring,
    half,
    bodyPoint,
    bodyRect,
    bodyPath,
    brakePressure,
  }) {
    const c = ELASTO_COLORS;
    const pivot = bodyPoint(-4, -6),
      shockTop = bodyPoint(-12, -18),
      forkTop = bodyPoint(14, -22);
    const shockBase = [-half + (pivot[0] + half) * 0.45, pivot[1] * 0.45];
    const forkSlider = [half + (forkTop[0] - half) * 0.45, forkTop[1] * 0.45];

    spring(shockBase[0], shockBase[1], shockTop[0], shockTop[1], c.orange);
    path([[-half, 0], pivot], c.silver, 2);
    path(
      [
        [-half, 2],
        [pivot[0], pivot[1] + 2],
      ],
      c.silverDark,
      1,
    );

    bodyRect(-8, -14, 14, 12, c.silverDark);
    bodyRect(-6, -14, 10, 4, c.silver);
    bodyRect(-4, -4, 8, 4, c.black);
    bodyPath(
      [
        [14, -22],
        [6, -14],
        [4, -4],
      ],
      c.black,
      2,
    );

    bodyRect(-20, -22, 12, 14, c.white);
    for (let cell = 0; cell < 15; cell++) {
      if (NUMBER_EIGHT[cell] === "1")
        bodyRect(
          -18 + (cell % 3) * 2,
          -20 + Math.floor(cell / 3) * 2,
          2,
          2,
          c.black,
        );
    }
    bodyRect(-22, -26, 20, 4, c.black);
    bodyRect(-20, -26, 12, 2, c.silverDark);
    bodyPath(
      [
        [-18, -28],
        [-28, -30],
      ],
      c.green,
      2,
    );
    bodyPath(
      [
        [-18, -26],
        [-28, -28],
      ],
      c.white,
      1,
    );
    bodyPath(
      [
        [-18, -24],
        [-28, -26],
      ],
      c.red,
      1,
    );
    bodyRect(-32, -32, 4, 4, brakePressure > 0.08 ? "#ff6045" : "#713c35");
    if (brakePressure > 0.6) bodyRect(-32, -32, 2, 2, "#ffd0a2");

    bodyRect(-4, -28, 18, 8, c.green);
    bodyRect(-2, -28, 12, 2, c.greenLight);
    bodyRect(-4, -22, 18, 2, c.greenDark);
    bodyRect(6, -22, 10, 8, c.white);
    bodyRect(8, -18, 8, 2, c.green);

    path([[half, 0], forkTop], c.black, 2);
    path([[half, 0], forkSlider], c.silver, 2);
    path(
      [
        [half - 8, -14],
        [half - 2, -16],
        [half + 6, -14],
      ],
      c.green,
      2,
    );
    path(
      [
        [half - 6, -12],
        [half + 4, -12],
      ],
      c.greenDark,
      1,
    );
    bodyPath(
      [
        [14, -22],
        [16, -26],
        [22, -26],
      ],
      c.black,
      2,
    );
    bodyRect(-4, -4, 4, 2, c.black);
  }

  const BIKES = {
    elasto: { wheel: drawElastoWheel, frame: drawElastoFrame },
    classic: { wheel: drawClassicWheel, frame: drawClassicFrame },
  };

  function drawBike({
    rear,
    front,
    mx,
    my,
    angle,
    length,
    flipVisual = 1,
    facing = 1,
    brakePressure = 0,
    state = "ready",
    leanVisual = 0,
    rider = "max",
    bike = DEFAULT_BIKE,
  }) {
    const model = BIKES[bike] || BIKES[DEFAULT_BIKE];
    model.wheel(rear);
    model.wheel(front);
    const pixelAngle = Math.round(angle / (TAU / 32)) * (TAU / 32);
    const sprite = bikeCanvas();
    const { context, size } = sprite;
    const {
      pixelRect: rect,
      pixelPath: path,
      drawPixelSpring: spring,
    } = sprite.tools;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size, size);
    context.setTransform(
      1 / ART_PIXEL,
      0,
      0,
      1 / ART_PIXEL,
      size / 2,
      size / 2,
    );

    const half = length / 2;
    const backCompression =
      facing > 0 ? rear.compression || 0 : front.compression || 0;
    const frontCompression =
      facing > 0 ? front.compression || 0 : rear.compression || 0;
    const bodyDrop = (backCompression + frontCompression) * 0.4;
    const bodyPitch = (frontCompression - backCompression) * 0.0096;
    const pc = Math.cos(bodyPitch),
      ps = Math.sin(bodyPitch);
    const bodyPoint = (x, y) => [x * pc - y * ps, x * ps + y * pc + bodyDrop];

    // Body parts pitch with the suspension by moving each piece's centre, so
    // the pieces themselves stay on the pixel grid.
    const drop = Math.round(bodyDrop / 2) * 2;
    const bodyRect = (x, y, width, height, color, pixel = 2) => {
      const cx = x + width / 2,
        cy = y + height / 2;
      rect(
        cx * pc - cy * ps - width / 2,
        cx * ps + cy * pc - height / 2 + drop,
        width,
        height,
        color,
        pixel,
      );
    };
    const bodyPath = (points, color, thickness) =>
      path(
        points.map(([x, y]) => [x * pc - y * ps, x * ps + y * pc + drop]),
        color,
        thickness,
      );
    model.frame({
      path,
      spring,
      half,
      bodyPoint,
      bodyRect,
      bodyPath,
      brakePressure,
    });

    if (state !== "ragdoll") {
      const shift = Math.round(leanVisual * 4.5) * 2;
      const colors = riderPalette(rider);

      bodyPath(
        [
          [-8 + shift, -24],
          [4 + shift * 0.45, -14],
          [-2, -3],
        ],
        colors.trousers,
        3,
      );
      bodyRect(-5, -6, 10, 4, "#233630");
      bodyPath(
        [
          [-8 + shift, -25],
          [1 + shift, -37],
        ],
        "#263b36",
        5,
      );
      bodyPath(
        [
          [-7 + shift, -25],
          [2 + shift, -37],
        ],
        colors.jacket,
        3,
      );
      bodyRect(-6 + shift, -38, 14, 12, colors.jacket);
      bodyRect(-4 + shift, -38, 10, 4, colors.jacketLight);
      bodyPath(
        [
          [3 + shift, -35],
          [11 + shift * 0.45, -30],
          [20, -25],
        ],
        colors.skin,
        2,
      );
      bodyPath(
        [
          [2 + shift, -36],
          [10 + shift * 0.45, -31],
        ],
        colors.jacketLight,
        2,
      );

      bodyRect(0 + shift, -46, 8, 8, colors.skin);
      bodyRect(-4 + shift, -52, 14, 12, "#263b36");
      bodyRect(-2 + shift, -52, 12, 10, colors.helmet);
      bodyRect(0 + shift, -52, 8, 4, colors.helmetLight);
      bodyRect(6 + shift, -48, 8, 4, "#234844");
      bodyRect(8 + shift, -42, 6, 2, "#efb36b");
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    translateToDevice(mx, my);
    ctx.rotate(pixelAngle);
    ctx.scale(flipVisual, 1);
    ctx.drawImage(
      sprite.canvas,
      -BIKE_SPRITE_REACH,
      -BIKE_SPRITE_REACH,
      BIKE_SPRITE_REACH * 2,
      BIKE_SPRITE_REACH * 2,
    );
    ctx.restore();
  }

  function drawRagdoll(points, rider) {
    const p = points,
      colors = riderPalette(rider);
    pixelPath(
      [
        [p.foot.x, p.foot.y],
        [p.knee.x, p.knee.y],
        [p.hip.x, p.hip.y],
      ],
      colors.trousers,
      3,
    );
    pixelPath(
      [
        [p.hip.x, p.hip.y],
        [p.shoulder.x, p.shoulder.y],
      ],
      colors.jacket,
      4,
    );
    pixelPath(
      [
        [p.shoulder.x, p.shoulder.y],
        [p.elbow.x, p.elbow.y],
      ],
      colors.jacketLight,
      2,
    );
    pixelPath(
      [
        [p.elbow.x, p.elbow.y],
        [p.hand.x, p.hand.y],
      ],
      colors.skin,
      2,
    );
    pixelPath(
      [
        [p.shoulder.x, p.shoulder.y],
        [p.head.x, p.head.y],
      ],
      colors.skin,
      2,
    );

    pixelRect(p.head.x - 7, p.head.y - 7, 14, 14, "#263b36", 2);
    pixelRect(p.head.x - 5, p.head.y - 7, 12, 10, colors.helmet, 2);
    pixelRect(p.head.x + 3, p.head.y - 3, 8, 4, "#234844", 2);
  }

  return {
    drawApple,
    drawFlag,
    drawBike,
    drawRagdoll,
    drawProp,
    drawSpike,
    drawBackground,
    drawPixelText,
  };
}
