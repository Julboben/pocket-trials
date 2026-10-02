// PROTOTYPE light map, enabled with ?lighting=1. The scene is multiplied by a
// light map: ambient light baked once per trail (terrain never moves), plus
// moving lights stamped on each frame in banded pixel-art steps.
//
// Ambient: air open to the sky gets full sky light, which fades in through air
// only (so rock blocks it) into cave mouths and under ledges. Rock takes the
// light of the air at its surface, and deeper in, the sky light soaking down
// from the top of its column or in from a nearby face. How far that soaks is
// set by the time of day, so ground stays bright by day and sinks into
// darkness at night, while caves are dark at any time.
import { ART_PIXEL, createCanvas, propWallFit } from "./drawing.js";
import { terrainAt, terrainGeometry, terrainSurfacesAt } from "./terrain.js";
import { LANTERN_CENTRE } from "./cave-props.js";
import { LAMP_HEAD } from "./city-props.js";

// `soak` is how far sky light reaches down through rock, in world units.
const AMBIENT = {
  morning: { sky: [255, 243, 230], cave: [70, 68, 80], soak: 900 },
  noon: { sky: [255, 255, 255], cave: [78, 80, 94], soak: 1400 },
  evening: { sky: [236, 200, 182], cave: [50, 42, 58], soak: 260 },
  night: { sky: [122, 136, 192], cave: [24, 28, 46], soak: 100 },
};
const FLASH = [170, 185, 215];
// World units per baked texel; smoothed when drawn.
const BAKE_UNIT = 4;
const BAKE_MARGIN = { side: 240, above: 900, below: 200 };
// How far sky light fades in sideways through air (cave mouths, under ledges).
const SIDE_FADE = 130;
// Rock this close to air takes the air's light; deeper, the soaked sky light.
const LIP = 10;
const ROCK_BLEND = 16;
// How deep into rock a moving light still reaches.
const SKIN = 10;
// Radius fraction → brightness; hard steps keep the pixel-art look.
const BANDS = [
  [0.3, 1],
  [0.5, 0.7],
  [0.72, 0.42],
  [1, 0.18],
];
const DIAGONAL = Math.SQRT2;

const smooth = (v) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

// Two-pass chamfer sweep over a grid. `step(i, j, cost)` relaxes texel i from
// its already-visited neighbour j; `active[i]` says which texels are updated.
function chamfer(width, height, active, step) {
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (!active[i]) continue;
      if (c > 0) step(i, i - 1, 1);
      if (r > 0) {
        step(i, i - width, 1);
        if (c > 0) step(i, i - width - 1, DIAGONAL);
        if (c < width - 1) step(i, i - width + 1, DIAGONAL);
      }
    }
  for (let r = height - 1; r >= 0; r--)
    for (let c = width - 1; c >= 0; c--) {
      const i = r * width + c;
      if (!active[i]) continue;
      if (c < width - 1) step(i, i + 1, 1);
      if (r < height - 1) {
        step(i, i + width, 1);
        if (c < width - 1) step(i, i + width + 1, DIAGONAL);
        if (c > 0) step(i, i + width - 1, DIAGONAL);
      }
    }
}

function bakeAmbient(trail, preset) {
  const bounds = terrainGeometry(trail)?.bounds;
  if (!bounds) return null;
  const x = Math.floor((bounds.left - BAKE_MARGIN.side) / BAKE_UNIT) * BAKE_UNIT,
    y = Math.floor((bounds.top - BAKE_MARGIN.above) / BAKE_UNIT) * BAKE_UNIT;
  const width = Math.ceil((bounds.right + BAKE_MARGIN.side - x) / BAKE_UNIT),
    height = Math.ceil((bounds.bottom + BAKE_MARGIN.below - y) / BAKE_UNIT);
  const size = width * height;
  const rock = new Uint8Array(size),
    air = new Uint8Array(size);
  const dist = new Float32Array(size).fill(Infinity);
  const tops = new Float64Array(width);
  for (let c = 0; c < width; c++) {
    const surfaces = terrainSurfacesAt(trail, x + (c + 0.5) * BAKE_UNIT);
    const spans = [];
    for (let i = 0; i < surfaces.length; i++)
      if (surfaces[i].entering) spans.push([surfaces[i].y, surfaces[i + 1]?.y ?? Infinity]);
    const topmost = (tops[c] = spans.length ? spans[0][0] : Infinity);
    for (let r = 0; r < height; r++) {
      const wy = y + (r + 0.5) * BAKE_UNIT,
        i = r * width + c;
      rock[i] = spans.some(([from, to]) => wy >= from && wy <= to) ? 1 : 0;
      air[i] = 1 - rock[i];
      if (air[i] && wy < topmost) dist[i] = 0;
    }
  }
  // Air: distance, through air only, to air open to the sky.
  chamfer(width, height, air, (i, j, cost) => {
    if (air[j] && dist[j] + cost < dist[i]) dist[i] = dist[j] + cost;
  });
  const lit = new Float32Array(size);
  for (let i = 0; i < size; i++) if (air[i]) lit[i] = 1 - smooth((dist[i] * BAKE_UNIT) / SIDE_FADE);
  // Rock: the nearest air's light, and the sky light soaking down through it.
  const near = new Float32Array(size).fill(Infinity),
    nearLight = new Float32Array(size),
    soaked = new Float32Array(size);
  for (let i = 0; i < size; i++)
    if (air[i]) {
      near[i] = 0;
      nearLight[i] = soaked[i] = lit[i];
    }
  const fade = BAKE_UNIT / preset.soak;
  chamfer(width, height, rock, (i, j, cost) => {
    if (near[j] + cost < near[i]) {
      near[i] = near[j] + cost;
      nearLight[i] = nearLight[j];
    }
    const through = soaked[j] - cost * fade;
    if (through > soaked[i]) soaked[i] = through;
  });
  const ambient = createCanvas(width, height),
    flash = createCanvas(width, height),
    occlusion = createCanvas(width, height);
  const images = [ambient, flash, occlusion].map((canvas) =>
    canvas.getContext("2d").createImageData(width, height),
  );
  const [ambientData, flashData, occlusionData] = images.map((image) => image.data);
  for (let i = 0; i < size; i++) {
    let light = lit[i];
    if (rock[i]) {
      const depth = near[i] * BAKE_UNIT;
      // Sky light from straight above, through every block in the column.
      const below = y + (Math.floor(i / width) + 0.5) * BAKE_UNIT - tops[i % width];
      const deep = Math.max(soaked[i], 1 - below / preset.soak);
      light = nearLight[i] + (deep - nearLight[i]) * smooth((depth - LIP) / ROCK_BLEND);
      occlusionData[i * 4 + 3] = Math.round(255 * smooth(depth / SKIN));
    }
    const at = i * 4;
    for (let k = 0; k < 3; k++) {
      ambientData[at + k] = preset.sky[k] * light + preset.cave[k] * (1 - light);
      flashData[at + k] = FLASH[k] * (0.25 + light * 0.75);
    }
    ambientData[at + 3] = flashData[at + 3] = 255;
  }
  [ambient, flash, occlusion].forEach((canvas, n) =>
    canvas.getContext("2d").putImageData(images[n], 0, 0),
  );
  return { x, y, width, height, ambient, flash, occlusion };
}

export function createLighting() {
  let canvas = null,
    context = null,
    lightCanvas = null,
    lightContext = null,
    cols = 0,
    rows = 0;
  const bakes = new WeakMap();

  function ensure(width, height) {
    if (canvas && cols === width && rows === height) return;
    cols = width;
    rows = height;
    canvas = createCanvas(cols, rows);
    context = canvas.getContext("2d");
    lightCanvas = createCanvas(cols, rows);
    lightContext = lightCanvas.getContext("2d");
  }

  function bakeFor(trail, preset) {
    const geometry = terrainGeometry(trail);
    let entry = bakes.get(trail);
    if (!entry || entry.geometry !== geometry || entry.preset !== preset) {
      entry = { geometry, preset, bake: bakeAmbient(trail, preset) };
      bakes.set(trail, entry);
    }
    return entry.bake;
  }

  function drawBaked(target, image, bake, left, top) {
    const scale = BAKE_UNIT / ART_PIXEL;
    target.drawImage(
      image,
      (bake.x - left) / ART_PIXEL,
      (bake.y - top) / ART_PIXEL,
      bake.width * scale,
      bake.height * scale,
    );
  }

  function bandedGradient(x, y, radius, [r, g, b], strength) {
    const gradient = lightContext.createRadialGradient(x, y, 0, x, y, radius);
    let from = 0;
    for (const [to, level] of BANDS) {
      const color = `rgba(${r},${g},${b},${Math.min(1, level * strength)})`;
      gradient.addColorStop(from, color);
      gradient.addColorStop(to, color);
      from = Math.min(1, to + 0.0001);
    }
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    return gradient;
  }

  // World-space light; `cone` is { angle, spread } for a beam.
  function light(left, top, { x, y, radius, color, strength = 1, cone = null }) {
    const px = (x - left) / ART_PIXEL,
      py = (y - top) / ART_PIXEL,
      pr = radius / ART_PIXEL;
    if (strength <= 0 || px + pr < 0 || py + pr < 0 || px - pr > cols || py - pr > rows) return;
    lightContext.save();
    if (cone) {
      lightContext.beginPath();
      lightContext.moveTo(px, py);
      lightContext.arc(px, py, pr, cone.angle - cone.spread, cone.angle + cone.spread);
      lightContext.closePath();
      lightContext.clip();
    }
    lightContext.fillStyle = bandedGradient(px, py, pr, color, strength);
    lightContext.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    lightContext.restore();
  }

  function propLights(trail, time) {
    const lights = [];
    const dark = trail.timeOfDay === "night" || trail.timeOfDay === "evening";
    for (const prop of trail.props || []) {
      if (!["lantern", "lamp", "mushrooms"].includes(prop.type)) continue;
      const ground = terrainAt(trail, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      const y = Number.isFinite(prop.y) ? prop.y : ground.y;
      if (prop.type === "lantern") {
        const fit = propWallFit(trail, prop);
        const flicker = time ? [1, 0.92, 0.97, 0.88][Math.floor(time * 6 + prop.x) % 4] : 1;
        const cy = y + (fit?.body || 0) + LANTERN_CENTRE;
        lights.push({ x: prop.x, y: cy, radius: 150, color: [255, 196, 118], strength: flicker, core: 12 });
      } else if (prop.type === "mushrooms") {
        lights.push({ x: prop.x, y: y - 6, radius: 64, color: [90, 210, 196], strength: 0.8 });
      } else if (dark) {
        const hx = prop.x + (prop.flip ? -1 : 1) * LAMP_HEAD.x,
          hy = y + LAMP_HEAD.y;
        lights.push({ x: hx, y: hy, radius: 170, color: [255, 222, 160], cone: { angle: Math.PI / 2, spread: 0.42 } });
        lights.push({ x: hx, y: hy, radius: 40, color: [255, 222, 160], strength: 0.6, core: 6 });
      }
    }
    return lights;
  }

  // `flip` is the animated facing, -1…1: the headlight and tail light swap
  // wheels with it and dim while the bike turns.
  function bikeLights(ride, flip) {
    if (ride.ragdoll) return [];
    const { rear, front } = ride;
    const nose = flip >= 0 ? front : rear,
      tail = flip >= 0 ? rear : front;
    const length = Math.hypot(nose.x - tail.x, nose.y - tail.y) || 1;
    const fx = (nose.x - tail.x) / length,
      fy = (nose.y - tail.y) / length;
    // Up from the frame, whichever way the bike faces.
    const ux = fy * Math.sign(fx || 1),
      uy = -fx * Math.sign(fx || 1);
    const turn = Math.abs(flip);
    return [
      {
        x: (rear.x + front.x) / 2 + ux * 20,
        y: (rear.y + front.y) / 2 + uy * 20,
        radius: 70,
        color: [200, 205, 220],
        strength: 0.45,
      },
      {
        x: nose.x + ux * 22 - fx * 4,
        y: nose.y + uy * 22 - fy * 4,
        radius: 230,
        color: [255, 244, 212],
        strength: turn,
        cone: { angle: Math.atan2(fy, fx), spread: 0.3 },
        core: 5,
      },
      {
        x: tail.x + ux * 18 - fx * 6,
        y: tail.y + uy * 18 - fy * 6,
        radius: 22,
        color: [255, 60, 50],
        strength: 0.7 * turn,
      },
    ];
  }

  /**
   * Multiplies everything already drawn by the light map, then adds a small
   * bloom on each light's source. Draws in world space.
   */
  function draw(ctx, { trail, ride, cameraX, cameraY, width, height, flash = 0, time = 0, flip = 1 }) {
    const preset = AMBIENT[trail.timeOfDay] || AMBIENT.noon;
    const bake = bakeFor(trail, preset);
    const left = Math.floor(cameraX / ART_PIXEL) * ART_PIXEL,
      top = Math.floor(cameraY / ART_PIXEL) * ART_PIXEL;
    ensure(Math.ceil(width / ART_PIXEL) + 2, Math.ceil(height / ART_PIXEL) + 2);

    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.fillStyle = `rgb(${preset.sky.join(",")})`;
    context.fillRect(0, 0, cols, rows);
    context.imageSmoothingEnabled = true;
    if (bake) drawBaked(context, bake.ambient, bake, left, top);
    if (flash > 0 && bake) {
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = Math.min(1, flash);
      drawBaked(context, bake.flash, bake, left, top);
      context.globalAlpha = 1;
    }

    const lights = [
      ...propLights(trail, time),
      ...bikeLights(ride, flip),
      ...ride.apples
        .filter((apple) => !apple.taken)
        .map((apple) => ({ x: apple.x, y: apple.y, radius: 34, color: [255, 176, 150], strength: 0.7 })),
    ];
    lightContext.globalCompositeOperation = "source-over";
    lightContext.clearRect(0, 0, cols, rows);
    lightContext.globalCompositeOperation = "lighter";
    for (const item of lights) light(left, top, item);
    if (bake) {
      // Moving lights only reach the skin of the rock.
      lightContext.globalCompositeOperation = "destination-out";
      lightContext.imageSmoothingEnabled = true;
      drawBaked(lightContext, bake.occlusion, bake, left, top);
    }
    context.globalCompositeOperation = "lighter";
    context.drawImage(lightCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(canvas, left, top, cols * ART_PIXEL, rows * ART_PIXEL);
    ctx.globalCompositeOperation = "screen";
    for (const item of lights) {
      if (!item.core) continue;
      const [cr, cg, cb] = item.color;
      for (const [scale, alpha] of [[1, 0.25], [0.5, 0.35]]) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * (item.strength ?? 1)})`;
        ctx.beginPath();
        ctx.arc(Math.round(item.x / 2) * 2, Math.round(item.y / 2) * 2, item.core * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  return { draw };
}
