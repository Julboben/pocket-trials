import { curveAt, seatedSurfaceAt } from "./terrain.js";

const GROUND_ALIGNED_PROP_SPANS = {
  bush: [-28, 28],
  fence: [-33, 33],
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
    jacketShade: "#b5bcae",
    panel: "#29464e",
    trousers: "#29464e",
    trousersLight: "#42616a",
    helmet: "#f4a442",
    helmetLight: "#ffd078",
    helmetShade: "#bd7034",
    stripe: "#fff8e7",
    skin: "#bd7954",
    skinLight: "#dfa078",
    gloves: "#304a42",
    boots: "#263b36",
    sole: "#657a70",
    visor: "#234844",
    visorLight: "#83bcb6",
  },
  Maxine: {
    jacket: "#d86f82",
    jacketLight: "#ef9aa8",
    jacketShade: "#a94f69",
    panel: "#59415c",
    trousers: "#39435d",
    trousersLight: "#596681",
    helmet: "#63aa98",
    helmetLight: "#a8dfcf",
    helmetShade: "#3c786e",
    stripe: "#fff8e7",
    skin: "#bd7954",
    skinLight: "#dfa078",
    gloves: "#59415c",
    boots: "#2b3347",
    sole: "#7c8897",
    visor: "#234844",
    visorLight: "#b0dfd4",
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

// Longest text a sign board can draw; the level schema warns when text exceeds it.
export const SIGN_MAX_CHARACTERS = 8;

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

// Tree canopies are drawn once into sprites, down to these heights above the
// ground anchor; the trunk below is drawn live so its base follows the slope.
// The canopy never reaches below them, and the ground at the trunk never
// rises above them.
const TREE_CANOPY_BOTTOM = -64;
const PINE_CANOPY_BOTTOM = -26;

function drawTreeCanopy({ pixelRect, pixelPath, drawPixelDisc }) {
  // Upper trunk, hidden behind the crown.
  pixelRect(-8, -114, 16, TREE_CANOPY_BOTTOM + 114, "#66543f", 2);
  pixelRect(2, -110, 6, TREE_CANOPY_BOTTOM + 110, "#856d4f", 2);
  pixelRect(6, -100, 2, TREE_CANOPY_BOTTOM + 100, "#aa8a60", 2);

  // Branch structure, drawn behind the foliage.
  pixelPath(
    [
      [-2, -72],
      [-8, -104],
      [-28, -128],
    ],
    "#66543f",
    3,
    2,
  );
  pixelPath(
    [
      [2, -84],
      [14, -112],
      [32, -130],
    ],
    "#66543f",
    3,
    2,
  );
  pixelPath(
    [
      [4, -88],
      [16, -112],
      [30, -128],
    ],
    "#856d4f",
    1,
    2,
  );

  // Dark rear foliage forms a connected, uneven silhouette.
  // Offset clusters keep the tree organic without shifting
  // the overall crown away from the trunk.
  drawPixelDisc(-30, -112, 28, "#477158", 2);
  drawPixelDisc(30, -112, 30, "#477158", 2);
  drawPixelDisc(-38, -132, 22, "#477158", 2);
  drawPixelDisc(38, -136, 22, "#477158", 2);
  drawPixelDisc(-18, -152, 24, "#477158", 2);
  drawPixelDisc(14, -154, 24, "#477158", 2);
  drawPixelDisc(0, -124, 34, "#477158", 2);

  // Main leaf masses overlap the rear silhouette,
  // leaving shadow pockets along the underside.
  drawPixelDisc(-30, -132, 24, "#4e785c", 2);
  drawPixelDisc(-10, -148, 26, "#4e785c", 2);
  drawPixelDisc(22, -144, 28, "#568061", 2);
  drawPixelDisc(36, -126, 20, "#568061", 2);
  drawPixelDisc(2, -124, 28, "#568061", 2);
  drawPixelDisc(-20, -112, 20, "#4e785c", 2);

  // Smaller sunlit clusters on the upper-right surfaces.
  // Broad patches read clearly at gameplay zoom.
  drawPixelDisc(14, -158, 16, "#618b66", 2);
  drawPixelDisc(34, -144, 12, "#618b66", 2);
  drawPixelDisc(12, -132, 14, "#618b66", 2);

  // A few chunky leaf accents, rather than scattered noise.
  pixelRect(-16, -152, 8, 4, "#568061", 2);
  pixelRect(-22, -148, 6, 4, "#568061", 2);
  pixelRect(28, -116, 8, 4, "#618b66", 2);
  pixelRect(22, -112, 6, 4, "#618b66", 2);
  pixelRect(-10, -104, 8, 4, "#568061", 2);

  // Top of the first bark detail; the rest is drawn with the lower trunk.
  pixelRect(-4, -68, 2, TREE_CANOPY_BOTTOM + 68, "#856d4f", 2);
}

function drawPineCanopy({ pixelRect }) {
  // Upper trunk, hidden behind the boughs.
  pixelRect(-6, -100, 12, PINE_CANOPY_BOTTOM + 100, "#66543f", 2);
  pixelRect(2, -100, 4, PINE_CANOPY_BOTTOM + 100, "#856d4f", 2);
  pixelRect(4, -96, 2, PINE_CANOPY_BOTTOM + 96, "#aa8a60", 2);

  // Broad lower boughs first; smaller tiers overlap them.
  // Each tier shares EXACTLY the same horizontal center.
  const tiers = [
    { top: -112, bottom: -26, halfWidth: 46 },
    { top: -140, bottom: -66, halfWidth: 34 },
    { top: -164, bottom: -104, halfWidth: 24 },
    { top: -182, bottom: -138, halfWidth: 14 },
  ];

  for (const { top, bottom, halfWidth } of tiers) {
    const rows = (bottom - top) / 2;

    for (let row = 0; row < rows; row++) {
      const t = row / (rows - 1);

      // A gently flared outline, not a stack of rectangles.
      const half = Math.max(
        2,
        Math.round((2 + (halfWidth - 2) * Math.pow(t, 1.15)) / 2) * 2,
      );

      const py = top + row * 2;
      const underside = row >= rows - 3;

      // Both sides use the same span: [-half, +half].
      for (let px = -half; px < half; px += 2) {
        const cellCenter = px + 1;
        const across = (cellCenter + half) / (half * 2);

        // Small, mirrored notches under the branch skirts.
        // Skip painting rather than erasing lower branches.
        const fromCenter = Math.abs(cellCenter);
        if (
          row === rows - 1 &&
          ((fromCenter > half * 0.28 && fromCenter < half * 0.46) ||
            (fromCenter > half * 0.66 && fromCenter < half * 0.82))
        ) {
          continue;
        }

        let color = "#4e785c";

        // Deep underside and shaded left flank.
        if (underside || across < 0.24) {
          color = "#477158";
        } else if (across > 0.55 && across < 0.9) {
          color = "#568061";
        }

        // A few grouped highlights, not random pixel noise.
        if (
          !underside &&
          row > 3 &&
          row % 9 < 2 &&
          across > 0.64 &&
          across < 0.84
        ) {
          color = "#618b66";
        }

        pixelRect(px, py, 2, 2, color, 2);
      }
    }
  }

  // Small highlight on the central leader.
  pixelRect(0, -180, 2, 6, "#618b66", 2);
}

function drawBushCanopy({ pixelRect, drawPixelDisc }) {
  // Low, broad shrub with overlapping leaf clusters.
  // Sprite bounds: x -32..32, y -44..0.

  // Connected shaded base.
  pixelRect(-28, -12, 56, 12, "#477158", 2);
  pixelRect(-30, -8, 60, 6, "#477158", 2);

  // Irregular outer silhouette.
  drawPixelDisc(-20, -16, 12, "#477158", 2);
  drawPixelDisc(18, -16, 12, "#477158", 2);
  drawPixelDisc(-10, -26, 14, "#477158", 2);
  drawPixelDisc(10, -28, 14, "#477158", 2);

  // Broad middle-green leaf masses.
  drawPixelDisc(-20, -18, 10, "#4e785c", 2);
  drawPixelDisc(-8, -26, 12, "#568061", 2);
  drawPixelDisc(10, -28, 12, "#568061", 2);
  drawPixelDisc(20, -18, 10, "#568061", 2);

  // Front foliage overlaps the rear clusters.
  drawPixelDisc(-10, -12, 10, "#4e785c", 2);
  drawPixelDisc(6, -14, 12, "#568061", 2);

  // Sunlight on the upper-right surfaces.
  drawPixelDisc(12, -32, 6, "#618b66", 2);
  drawPixelDisc(22, -20, 4, "#618b66", 2);
  drawPixelDisc(4, -18, 6, "#618b66", 2);

  // A few grouped leaf accents, not scattered noise.
  pixelRect(-14, -30, 6, 2, "#618b66", 2);
  pixelRect(-18, -26, 4, 2, "#568061", 2);
  pixelRect(10, -10, 6, 2, "#4e785c", 2);
  pixelRect(-4, -6, 6, 2, "#477158", 2);
}

// Local bounds [left, top, right, bottom] of each canopy sprite, in world units.
const CANOPY_SPRITES = {
  tree: { bounds: [-64, -182, 64, TREE_CANOPY_BOTTOM], draw: drawTreeCanopy },
  pine: { bounds: [-48, -186, 48, PINE_CANOPY_BOTTOM], draw: drawPineCanopy },
  bush: {
    bounds: [-32, -44, 32, 0],
    draw: drawBushCanopy,
  },
};
const canopySprites = new Map();

function canopySprite(type) {
  if (canopySprites.has(type)) return canopySprites.get(type);
  const {
    bounds: [left, top, right, bottom],
    draw,
  } = CANOPY_SPRITES[type];
  const canvas = createCanvas(
    (right - left) / ART_PIXEL,
    (bottom - top) / ART_PIXEL,
  );
  const context = canvas.getContext("2d");
  context.setTransform(
    1 / ART_PIXEL,
    0,
    0,
    1 / ART_PIXEL,
    -left / ART_PIXEL,
    -top / ART_PIXEL,
  );
  draw(createDrawingTools(context));
  const sprite = {
    canvas,
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
  canopySprites.set(type, sprite);
  return sprite;
}

// Generous local bounds [left, top, right] of each prop, in world units; the
// bottom follows the ground under it.
const PROP_EXTENTS = {
  tree: [-64, -184, 64],
  pine: [-48, -186, 48],
  bush: [-32, -44, 32],
  fence: [-42, -48, 42],
  rock: [-18, -20, 20],
  boulder: [-24, -42, 24],
  flowers: [-16, -22, 16],
  stump: [-12, -18, 12],
  crystal: [-16, -42, 16],
};

function propBounds(type, angle, groundOffset, text) {
  let [left, top, right] = PROP_EXTENTS[type] || [-64, -190, 64];
  if (type === "bush") {
    // Bound the intact, rotated sprite—not terrain-shifted columns.
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    const corners = [
      [left, top],
      [right, top],
      [left, 0],
      [right, 0],
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [px, py] of corners) {
      const rx = px * c - py * s;
      const ry = px * s + py * c;

      minX = Math.min(minX, rx);
      minY = Math.min(minY, ry);
      maxX = Math.max(maxX, rx);
      maxY = Math.max(maxY, ry);
    }

    return [minX - 4, minY - 4, maxX + 4, maxY + 4];
  }
  if (type === "sign") {
    const label = [...String(text || "")]
      .slice(0, SIGN_MAX_CHARACTERS)
      .join("");
    const half = Math.max(24, pixelTextWidth(label) + 8) / 2 + 2;
    [left, top, right] = [-half, -44, half];
  }
  let bottom = Math.max(
    0,
    groundOffset(left),
    groundOffset(0),
    groundOffset(right),
  );
  if (angle) {
    const reach = Math.max(-left, -top, right, bottom);
    [left, top, right, bottom] = [-reach, -reach, reach, reach];
  }
  return [left - 4, top - 4, right + 4, bottom + 4];
}

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
  const ragdollHelmetSprites = new Map();
  let bikeSprite = null;
  let propLayer = null;

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

  function drawCanopy(type) {
    const sprite = canopySprite(type);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sprite.canvas,
      sprite.left,
      sprite.top,
      sprite.width,
      sprite.height,
    );
  }

  // A translucent prop is drawn opaque into a scratch layer on the same device
  // pixel grid and then blended once, so overlapping shapes inside it do not
  // stack up into darker, more solid patches.
  function drawPropLayer(type, x, y, alpha, slope, groundOffset, text) {
    const transform = ctx.getTransform();
    if (transform.b || transform.c) return false;
    const [left, top, right, bottom] = propBounds(
      type,
      propDrawAngle(type, slope),
      groundOffset,
      text,
    );
    const anchorX = Math.round(x / 2) * 2,
      anchorY = Math.round(y / 2) * 2;
    const deviceX = (value) => transform.a * (anchorX + value) + transform.e;
    const deviceY = (value) => transform.d * (anchorY + value) + transform.f;
    const x0 = Math.max(0, Math.floor(Math.min(deviceX(left), deviceX(right))));
    const y0 = Math.max(0, Math.floor(Math.min(deviceY(top), deviceY(bottom))));
    const x1 = Math.min(
      ctx.canvas.width,
      Math.ceil(Math.max(deviceX(left), deviceX(right))),
    );
    const y1 = Math.min(
      ctx.canvas.height,
      Math.ceil(Math.max(deviceY(top), deviceY(bottom))),
    );
    if (x1 <= x0 || y1 <= y0) return true;
    const width = x1 - x0,
      height = y1 - y0;
    if (!propLayer) {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      propLayer = { canvas, context, art: createGameArt(context) };
    }
    const { canvas, context, art } = propLayer;
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.setTransform(
      transform.a,
      0,
      0,
      transform.d,
      transform.e - x0,
      transform.f - y0,
    );
    art.drawProp(type, x, y, 1, slope, groundOffset, text);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(canvas, 0, 0, width, height, x0, y0, width, height);
    ctx.restore();
    return true;
  }

  function drawProp(
    type,
    x,
    y,
    alpha = 1,
    slope = 0,
    groundOffset = () => 0,
    text = "",
  ) {
    if (
      alpha < 1 &&
      drawPropLayer(type, x, y, alpha, slope, groundOffset, text)
    )
      return;
    ctx.save();
    ctx.translate(Math.round(x / 2) * 2, Math.round(y / 2) * 2);
    ctx.rotate(propDrawAngle(type, slope));
    ctx.globalAlpha = alpha;
    if (type === "tree") {
      // Mature deciduous tree: approximately 124 units wide
      // and 180 units tall, centered over the ground anchor.
      // The trunk stays upright; its base follows the terrain.
      drawCanopy(type);

      // Main trunk with a shaded side and a narrow sunlit edge.
      const trunkTop = TREE_CANOPY_BOTTOM;
      rectDownTo(-8, trunkTop, 10, "#66543f", 2, groundOffset);
      rectDownTo(2, trunkTop, 4, "#856d4f", 2, groundOffset);
      rectDownTo(6, trunkTop, 2, "#aa8a60", 2, groundOffset);

      // Exposed bark details below the crown.
      rectAboveGround(
        -4,
        trunkTop,
        2,
        -54 - trunkTop,
        "#856d4f",
        2,
        groundOffset,
      );
      rectAboveGround(2, -44, 2, 10, "#66543f", 2, groundOffset);
      rectAboveGround(-4, -26, 2, 8, "#856d4f", 2, groundOffset);
    } else if (type === "pine") {
      // Local x = 0 is the shared trunk / canopy center.
      // Overall size: 92 units wide, 182 units tall.
      // Keep the tree upright; only its base follows the terrain.
      drawCanopy(type);

      // Trunk: centered, with shaded bark and a narrow lit edge.
      const trunkTop = PINE_CANOPY_BOTTOM;
      rectDownTo(-6, trunkTop, 8, "#66543f", 2, groundOffset);
      rectDownTo(2, trunkTop, 2, "#856d4f", 2, groundOffset);
      rectDownTo(4, trunkTop, 2, "#aa8a60", 2, groundOffset);

      // Subtle bark marks on the exposed lower trunk.
      rectAboveGround(-4, -22, 2, 8, "#856d4f", 2, groundOffset);
      rectAboveGround(0, -12, 2, 6, "#856d4f", 2, groundOffset);
    } else if (type === "bush") {
      // Draw the cached shrub intact.
      // drawProp() already applies the ground-alignment rotation.
      drawCanopy("bush");
    } else if (type === "fence") {
      // Larger fence: 80 units wide and 46 units tall.
      // Rails sit behind the posts; existing slope rotation is preserved.

      // Upper rail.
      pixelRect(-40, -34, 80, 6, "#856d4f", 2);
      pixelRect(-40, -34, 80, 2, "#aa8a60", 2);
      pixelRect(-40, -30, 80, 2, "#66543f", 2);

      // Lower rail.
      pixelRect(-40, -18, 80, 6, "#856d4f", 2);
      pixelRect(-40, -18, 80, 2, "#aa8a60", 2);
      pixelRect(-40, -14, 80, 2, "#66543f", 2);

      // Balanced posts, centered at x = -33 and +33.
      for (const postX of [-36, 30]) {
        pixelRect(postX, -42, 6, 42, "#856d4f", 2);

        // Stepped post cap.
        pixelRect(postX, -44, 6, 2, "#aa8a60", 2);
        pixelRect(postX + 2, -46, 2, 2, "#aa8a60", 2);

        // Lit edge and shaded side.
        pixelRect(postX, -42, 2, 40, "#aa8a60", 2);
        pixelRect(postX + 4, -42, 2, 42, "#66543f", 2);

        // Small fasteners where the rails meet each post.
        pixelRect(postX + 2, -32, 2, 2, "#66543f", 2);
        pixelRect(postX + 2, -16, 2, 2, "#66543f", 2);
      }

      // Sparse wood grain.
      pixelRect(-24, -32, 10, 2, "#66543f", 2);
      pixelRect(10, -32, 6, 2, "#66543f", 2);
      pixelRect(-14, -16, 8, 2, "#66543f", 2);
      pixelRect(20, -16, 4, 2, "#66543f", 2);
    } else if (type === "rock") {
      // Uneven silhouette, keeping the original footprint.
      pixelRect(-16, -6, 34, 6, "#697872", 2);
      pixelRect(-12, -12, 28, 8, "#697872", 2);
      pixelRect(-8, -16, 20, 8, "#7f8d83", 2);
      pixelRect(-4, -18, 10, 4, "#aeb5a7", 2);

      // Lit upper face and a darker right-hand fracture.
      pixelRect(-8, -14, 16, 4, "#8b978c", 2);
      pixelRect(-12, -10, 12, 4, "#7f8d83", 2);
      pixelRect(8, -12, 4, 8, "#697872", 2);
      pixelRect(12, -8, 4, 6, "#697872", 2);

      // Small angular highlight and a crack.
      pixelRect(-4, -16, 8, 2, "#aeb5a7", 2);
      pixelRect(2, -8, 2, 4, "#697872", 2);
      pixelRect(4, -4, 4, 2, "#697872", 2);
    } else if (type === "boulder") {
      // Asymmetric stone mass, within the original 44 × 40 bounds.
      pixelRect(-22, -10, 44, 10, "#697872", 2);
      pixelRect(-20, -18, 40, 12, "#697872", 2);
      pixelRect(-16, -28, 34, 18, "#7f8d83", 2);
      pixelRect(-10, -36, 24, 20, "#8b978c", 2);
      pixelRect(-2, -40, 8, 6, "#a2ab9e", 2);

      // Broad illuminated top plane.
      pixelRect(-8, -34, 20, 6, "#a2ab9e", 2);
      pixelRect(-12, -28, 18, 6, "#8b978c", 2);
      pixelRect(-2, -38, 8, 4, "#aeb5a7", 2);

      // Stepped shadow plane on the right.
      pixelRect(10, -30, 4, 10, "#7f8d83", 2);
      pixelRect(8, -20, 10, 8, "#697872", 2);
      pixelRect(4, -12, 16, 8, "#697872", 2);

      // Short fracture and a chipped lower face.
      pixelPath(
        [
          [-4, -24],
          [0, -20],
          [-2, -14],
        ],
        "#697872",
        1,
        2,
      );
      pixelRect(-14, -10, 8, 4, "#8b978c", 2);
      pixelRect(-10, -10, 4, 2, "#a2ab9e", 2);
    } else if (type === "flowers") {
      // Fixed variation: no random changes or flicker between frames.
      const flowers = [
        { x: -12, height: 8, color: "#e8755b" },
        { x: -6, height: 14, color: "#f1b95d" },
        { x: 0, height: 10, color: "#e8755b" },
        { x: 6, height: 16, color: "#f1b95d" },
        { x: 12, height: 8, color: "#e8755b" },
      ];

      for (const flower of flowers) {
        const base = groundOffset(flower.x + 1);
        const top = base - flower.height;

        pixelRect(flower.x, top, 2, flower.height, "#58784d", 2);

        // Leaves sit above each stem's local ground anchor.
        pixelRect(flower.x - 2, base - 6, 2, 2, "#477158", 2);
        pixelRect(flower.x + 2, base - 8, 2, 2, "#618b66", 2);

        // Compact cross-shaped blossom with a warm center.
        pixelRect(flower.x - 2, top - 2, 6, 2, flower.color, 2);
        pixelRect(flower.x, top - 4, 2, 6, flower.color, 2);
        pixelRect(flower.x, top - 2, 2, 2, "#f4e9d1", 2);
      }
    } else if (type === "stump") {
      // Flared base, still following the terrain column by column.
      rectDownTo(-10, -8, 20, "#66543f", 2, groundOffset);
      rectDownTo(-8, -14, 16, "#806244", 2, groundOffset);
      rectDownTo(4, -12, 4, "#856d4f", 2, groundOffset);

      // Bark ridges remain clipped to the local ground.
      rectAboveGround(-6, -12, 2, 10, "#66543f", 2, groundOffset);
      rectAboveGround(0, -10, 2, 8, "#66543f", 2, groundOffset);
      rectAboveGround(6, -10, 2, 8, "#aa8a60", 2, groundOffset);

      // Cut surface: stepped rim and a compact growth ring.
      rectAboveGround(-8, -16, 16, 4, "#c39664", 2, groundOffset);
      rectAboveGround(-10, -14, 20, 2, "#aa8a60", 2, groundOffset);
      rectAboveGround(-4, -16, 8, 2, "#76573d", 2, groundOffset);
      rectAboveGround(-2, -16, 4, 2, "#c39664", 2, groundOffset);
    } else if (type === "crystal") {
      // Solid shards painted in horizontal bands.
      // Ground clipping keeps their bases seated on uneven terrain.
      const shard = (center, top, halfWidth, lean) => {
        const bottom = Math.round(groundOffset(center) / 2) * 2;
        const height = bottom - top;
        if (height <= 0) return;

        for (let py = top; py < bottom; py += 2) {
          const t = (py - top) / height;

          // Pointed tip, broad shoulder, then a narrower buried base.
          const profile = t < 0.4 ? t / 0.4 : 1 - ((t - 0.4) / 0.6) * 0.35;

          const half = Math.max(2, Math.round((halfWidth * profile) / 2) * 2);
          const axis = center + Math.round((lean * (1 - t)) / 2) * 2;

          rectAboveGround(axis - half, py, half, 2, "#568f98", 2, groundOffset);
          rectAboveGround(axis, py, half, 2, "#83d1ce", 2, groundOffset);

          // A narrow bright facet below the tip.
          if (t > 0.1 && t < 0.8) {
            rectAboveGround(axis, py, 2, 2, "#d9ffff", 2, groundOffset);
          }
        }
      };

      // Side shards behind the taller central crystal.
      shard(-8, -26, 6, -2);
      shard(8, -24, 6, 2);
      shard(0, -40, 8, 0);
    } else if (type === "sign") {
      // Upright post carrying a small writable board.
      // The board sizes itself to the prop's `text` (clamped to
      // SIGN_MAX_CHARACTERS) and uses the same cream board and pixel
      // font as the finish flag.
      const label = [...String(text || "")]
        .slice(0, SIGN_MAX_CHARACTERS)
        .join("");
      const width = Math.max(24, pixelTextWidth(label) + 8);

      // Shaped post with a sunlit edge, matching the fence posts.
      rectDownTo(-2, -24, 4, "#856d4f", 2, groundOffset);
      rectDownTo(-2, -24, 2, "#aa8a60", 2, groundOffset);

      // Board: cream face with the level's signage green text.
      pixelRect(-width / 2, -40, width, 16, "#f4e9d1", 2);
      drawPixelText(label, 0, -37, "#365345");
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
      const outline = "#263b36";

      const hip = [-8 + shift, -24];
      const knee = [4 + shift * 0.45, -14];
      const ankle = [-2, -3];

      const shoulder = [2 + shift, -36];
      const elbow = [11 + shift * 0.45, -30];
      const hand = [20, -25];

      // Trousers: outlined silhouette with a narrow lit edge.
      bodyPath([hip, knee, ankle], outline, 4);
      bodyPath([hip, knee, ankle], colors.trousers, 3);

      bodyPath(
        [
          [-7 + shift, -25],
          [4 + shift * 0.45, -16],
        ],
        colors.trousersLight,
        1,
      );

      // Compact reinforced knee.
      bodyRect(2 + shift * 0.45, -16, 6, 4, colors.trousersLight);
      bodyRect(4 + shift * 0.45, -14, 4, 2, colors.panel);

      // Boot stays anchored at the existing foot / peg position.
      bodyRect(-5, -7, 6, 6, colors.boots);
      bodyRect(-5, -5, 10, 4, colors.boots);
      bodyRect(-5, -3, 10, 2, colors.sole);
      bodyRect(-3, -7, 4, 2, colors.trousersLight);

      // Jacket silhouette follows the existing leaning torso.
      bodyPath(
        [
          [-8 + shift, -25],
          [1 + shift, -37],
        ],
        outline,
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

      // Shadow down the back, bright shoulder, contrasting hem.
      bodyRect(-6 + shift, -36, 4, 10, colors.jacketShade);
      bodyRect(-4 + shift, -38, 10, 4, colors.jacketLight);
      bodyRect(-8 + shift, -28, 10, 4, colors.panel);
      bodyRect(-6 + shift, -28, 6, 2, colors.jacketShade);

      // Small collar and front seam.
      bodyRect(2 + shift, -40, 6, 4, colors.panel);
      bodyRect(4 + shift, -34, 2, 6, colors.jacketShade);
      bodyRect(-2 + shift, -34, 4, 2, colors.panel);

      // Arm silhouette; hand remains at the original handlebar.
      bodyPath([shoulder, elbow, hand], outline, 3);

      // Rolled jacket sleeve.
      bodyPath([shoulder, elbow], colors.jacket, 2);
      bodyPath(
        [
          [2 + shift, -37],
          [9 + shift * 0.45, -32],
        ],
        colors.jacketLight,
        1,
      );

      // Forearm, cuff and glove.
      bodyPath([elbow, hand], colors.skin, 2);
      bodyRect(9 + shift * 0.45, -32, 4, 4, colors.panel);
      bodyPath(
        [
          [13 + shift * 0.3, -29],
          [17, -27],
        ],
        colors.skinLight,
        1,
      );
      bodyRect(18, -28, 6, 4, colors.gloves);
      bodyRect(20, -28, 4, 2, colors.jacketLight);

      // Neck, partly tucked into the helmet and collar.
      bodyRect(0 + shift, -44, 8, 6, colors.skin);
      bodyRect(4 + shift, -42, 4, 2, colors.skinLight);

      // Stepped helmet shell: rounded without antialiasing.
      bodyRect(-4 + shift, -50, 16, 8, outline);
      bodyRect(-2 + shift, -52, 12, 12, outline);

      bodyRect(-2 + shift, -50, 12, 8, colors.helmet);
      bodyRect(0 + shift, -52, 8, 2, colors.helmetLight);
      bodyRect(-2 + shift, -50, 4, 4, colors.helmetLight);
      bodyRect(-2 + shift, -44, 8, 2, colors.helmetShade);

      // Shared racing stripe, different shell colors.
      bodyRect(4 + shift, -52, 2, 6, colors.stripe);

      // Goggle strap, dark frame and reflected sky.
      bodyRect(-2 + shift, -48, 8, 2, colors.panel);
      bodyRect(6 + shift, -48, 8, 6, outline);
      bodyRect(6 + shift, -48, 8, 4, colors.visor);
      bodyRect(8 + shift, -48, 4, 2, colors.visorLight);

      // Small forward peak and protective chin guard.
      bodyRect(6 + shift, -50, 10, 2, colors.helmet);
      bodyRect(8 + shift, -50, 6, 2, colors.helmetLight);
      bodyRect(6 + shift, -42, 8, 2, colors.helmetShade);
      bodyRect(10 + shift, -44, 4, 2, colors.helmet);
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

  // One tiny cached helmet per rider palette.
  // Rotating the sprite with nearest-neighbour sampling keeps it sharp.
  function ragdollHelmetSprite(colors) {
    if (ragdollHelmetSprites.has(colors)) {
      return ragdollHelmetSprites.get(colors);
    }

    const width = 24;
    const height = 16;
    const canvas = createCanvas(width / ART_PIXEL, height / ART_PIXEL);
    const context = canvas.getContext("2d");

    // Local helmet anchor is (0, 0).
    // Sprite bounds: x -10..14, y -8..8.
    context.setTransform(
      1 / ART_PIXEL,
      0,
      0,
      1 / ART_PIXEL,
      10 / ART_PIXEL,
      8 / ART_PIXEL,
    );

    const { pixelRect: rect } = createDrawingTools(context);
    const outline = "#263b36";

    // First redesign's helmet, relative to its center at (3, -46).
    rect(-7, -4, 16, 8, outline);
    rect(-5, -6, 12, 12, outline);

    rect(-5, -4, 12, 8, colors.helmet);
    rect(-3, -6, 8, 2, colors.helmetLight);
    rect(-5, -4, 4, 4, colors.helmetLight);
    rect(-5, 2, 8, 2, colors.helmetShade);

    rect(1, -6, 2, 6, colors.stripe);

    rect(-5, -2, 8, 2, colors.panel);
    rect(3, -2, 8, 6, outline);
    rect(3, -2, 8, 4, colors.visor);
    rect(5, -2, 4, 2, colors.visorLight);

    rect(3, -4, 10, 2, colors.helmet);
    rect(5, -4, 6, 2, colors.helmetLight);
    rect(3, 4, 8, 2, colors.helmetShade);
    rect(7, 2, 4, 2, colors.helmet);

    ragdollHelmetSprites.set(colors, canvas);
    return canvas;
  }

  function drawRagdoll(points, rider) {
    const p = points;
    const colors = riderPalette(rider);
    const outline = "#263b36";
    const facing = p.head.drawFacing ?? 1;

    const point = (joint) => [joint.x, joint.y];

    // A short section of a limb, useful for sleeves, cuffs and boots.
    const between = (a, b, amount) => [
      a.x + (b.x - a.x) * amount,
      a.y + (b.y - a.y) * amount,
    ];

    // The original shoulder-to-head vector is (1, -10).
    // Recover a body-oriented frame so the helmet tumbles with the rider.
    const headAngle =
      Math.atan2(p.head.y - p.shoulder.y, p.head.x - p.shoulder.x) -
      Math.atan2(-10, facing);

    const fc = Math.cos(headAngle);
    const fs = Math.sin(headAngle);

    const facingVector = [fc * facing, fs * facing];

    // TROUSERS
    pixelPath([point(p.hip), point(p.knee), point(p.foot)], outline, 4, 2);
    pixelPath(
      [point(p.hip), point(p.knee), point(p.foot)],
      colors.trousers,
      3,
      2,
    );

    const thighStart = between(p.hip, p.knee, 0.15);
    const thighEnd = between(p.hip, p.knee, 0.85);

    pixelPath(
      [
        [
          thighStart[0] + facingVector[0] * 2,
          thighStart[1] + facingVector[1] * 2,
        ],
        [thighEnd[0] + facingVector[0] * 2, thighEnd[1] + facingVector[1] * 2],
      ],
      colors.trousersLight,
      1,
      2,
    );

    pixelPath(
      [between(p.hip, p.knee, 0.88), between(p.knee, p.foot, 0.12)],
      colors.panel,
      2,
      2,
    );

    // BOOT
    // Its toe follows the lower leg instead of remaining screen-aligned.
    const shinX = p.foot.x - p.knee.x;
    const shinY = p.foot.y - p.knee.y;
    const shinLength = Math.hypot(shinX, shinY) || 1;
    const downX = shinX / shinLength;
    const downY = shinY / shinLength;

    const toeX = downY * facing;
    const toeY = -downX * facing;

    const heel = [p.foot.x - toeX * 2, p.foot.y - toeY * 2];
    const toe = [p.foot.x + toeX * 6, p.foot.y + toeY * 6];

    pixelPath(
      [between(p.knee, p.foot, 0.76), point(p.foot)],
      colors.boots,
      3,
      2,
    );
    pixelPath([heel, toe], colors.boots, 2, 2);
    pixelPath(
      [
        [heel[0] + downX * 2, heel[1] + downY * 2],
        [toe[0] + downX * 2, toe[1] + downY * 2],
      ],
      colors.sole,
      1,
      2,
    );

    // JACKET
    pixelPath([point(p.hip), point(p.shoulder)], outline, 5, 2);
    pixelPath([point(p.hip), point(p.shoulder)], colors.jacket, 4, 2);

    const backLower = between(p.hip, p.shoulder, 0.18);
    const backUpper = between(p.hip, p.shoulder, 0.82);

    pixelPath(
      [
        [
          backLower[0] - facingVector[0] * 2,
          backLower[1] - facingVector[1] * 2,
        ],
        [
          backUpper[0] - facingVector[0] * 2,
          backUpper[1] - facingVector[1] * 2,
        ],
      ],
      colors.jacketShade,
      2,
      2,
    );

    // Contrasting hem.
    pixelPath(
      [point(p.hip), between(p.hip, p.shoulder, 0.18)],
      colors.panel,
      3,
      2,
    );

    // Shoulder highlight.
    pixelPath(
      [between(p.hip, p.shoulder, 0.82), point(p.shoulder)],
      colors.jacketLight,
      3,
      2,
    );

    // NECK
    pixelPath([point(p.shoulder), point(p.head)], colors.skin, 2, 2);

    // ARM
    pixelPath(
      [point(p.shoulder), point(p.elbow), point(p.hand)],
      outline,
      3,
      2,
    );

    pixelPath([point(p.shoulder), point(p.elbow)], colors.jacket, 2, 2);
    pixelPath(
      [between(p.shoulder, p.elbow, 0.12), between(p.shoulder, p.elbow, 0.72)],
      colors.jacketLight,
      1,
      2,
    );

    pixelPath([point(p.elbow), point(p.hand)], colors.skin, 2, 2);
    pixelPath(
      [between(p.elbow, p.hand, 0.2), between(p.elbow, p.hand, 0.65)],
      colors.skinLight,
      1,
      2,
    );

    // Cuff.
    pixelPath(
      [between(p.shoulder, p.elbow, 0.85), point(p.elbow)],
      colors.panel,
      2,
      2,
    );

    // Glove and small highlight.
    pixelPath(
      [between(p.elbow, p.hand, 0.8), point(p.hand)],
      colors.gloves,
      2,
      2,
    );
    pixelRect(p.hand.x - 1, p.hand.y - 1, 2, 2, colors.jacketLight, 2);

    // HELMET
    // Cached and mirrored correctly; follows the head/shoulder axis.
    const sprite = ragdollHelmetSprite(colors);
    const rotationStep = TAU / 32;
    const pixelAngle = Math.round(headAngle / rotationStep) * rotationStep;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    translateToDevice(p.head.x, p.head.y);
    ctx.rotate(pixelAngle);
    ctx.scale(facing, 1);
    ctx.drawImage(sprite, -10, -8, 24, 16);
    ctx.restore();
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
