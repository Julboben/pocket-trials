// Scene lighting. Everything drawn is multiplied by a light map: the ambient
// light field, baked once per trail and time of day (see light-field.js), plus
// moving lights stamped on each frame in banded pixel-art steps (props, the
// bike's headlight and tail light). Lights add to the ambient
// light, only reach the skin of the rock, and saturate in daylight, so by day
// open ground looks just as it is drawn while caves stay dark.
import {
  ART_PIXEL,
  craneLightOn,
  createCanvas,
  lanternFlicker,
  mushroomPulse,
  propWallFit,
  sunLight,
  timeOfDayPalette,
} from "./drawing.js";
import { bakeLightField, lightFieldAt, lightReach } from "./light-field.js";
import { terrainAt, terrainGeometry } from "./terrain.js";
import { LANTERN_CENTRE } from "./cave-props.js";
import { CRANE_LIGHTS, LAMP_HEAD } from "./city-props.js";

// Per time of day: the light open sky gives, the light deep in a cave, how far
// sky light soaks down through rock and fades in sideways through air, and how
// much of the sky air must see to be fully lit (see light-field.js).
const AMBIENT = {
  morning: { sky: [255, 243, 230], cave: [70, 68, 80], soak: 900, reach: 170, open: 0.32 },
  noon: { sky: [255, 255, 255], cave: [78, 80, 94], soak: 1400, reach: 190, open: 0.3 },
  evening: { sky: [244, 210, 188], cave: [50, 42, 58], soak: 260, reach: 150, open: 0.38 },
  night: { sky: [122, 136, 192], cave: [24, 28, 46], soak: 100, reach: 130, open: 0.45 },
};
const FLASH = [170, 185, 215];
// Rain greys the light: the sky's colour is pulled this far towards white.
const RAIN_SOFTEN = 0.35;
// Below this much ambient light, lamps and crane lights switch on.
const DARK_BELOW = 0.5;
// Shadows: rays are cast from each light this many world units apart at its
// edge, and light goes this far into the rock it hits (the skin the cover
// mask fades out).
const RAY_SPACING = 6,
  SHADOW_SKIN = 12;
// Field texels per culling tile, for skipping the pass in full daylight.
const TILE = 16;
// Radius fraction → brightness; hard steps keep the pixel-art look.
const BANDS = [
  [0.3, 1],
  [0.5, 0.7],
  [0.72, 0.42],
  [1, 0.18],
];
const LANTERN = [255, 196, 118],
  GLOW = [90, 210, 196],
  LAMP = [255, 222, 160],
  CRANE = [232, 117, 91],
  HEADLIGHT = [255, 244, 212],
  TAIL = [255, 60, 50];

// Where the bike art draws its lamps, in the sprite's local units: +x
// towards the front wheel, -y up from the frame.
const BIKE_HEADLIGHT = [17, -19],
  BIKE_TAIL_LIGHT = [-30, -30];

// Strong sun: above this strength (see sunLight) the sun glares and casts
// rays, growing to full at SUN_GLARE + SUN_GLARE_RANGE.
const SUN_GLARE = 0.6,
  SUN_GLARE_RANGE = 0.3;
// Sun rays: [angle offset from straight at the view's centre, beam half-width,
// length as a fraction of the view's diagonal, brightness].
const SUN_RAYS = [
  [-0.42, 0.05, 1.1, 0.8],
  [-0.2, 0.09, 1.25, 1],
  [0.02, 0.04, 0.95, 0.7],
  [0.22, 0.07, 1.2, 0.9],
  [0.45, 0.05, 0.9, 0.6],
];

const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;

/** The lighting settings for a trail's time of day and weather. */
export function ambientFor(trail) {
  const preset = AMBIENT[trail.timeOfDay] || AMBIENT.noon;
  const rain = Math.max(0, Math.min(1, Number(trail.weather?.rain) || 0)) * RAIN_SOFTEN;
  return {
    ...preset,
    sky: preset.sky.map((value) => Math.round(value + (255 - value) * rain)),
    glow: Boolean(timeOfDayPalette(trail).glow),
  };
}

/**
 * How strongly the sun glares on a trail, 0…1: only a bright, mostly clear
 * daytime sun does, and rain or storms put it out.
 */
export function glareStrength(trail) {
  const { weather = {} } = trail;
  if (timeOfDayPalette(trail).moon) return 0;
  const { strength } = sunLight({ width: 0, weather, timeOfDay: trail.timeOfDay });
  const storm = Math.max(Number(weather.rain) || 0, Number(weather.lightning) || 0);
  const glare = ((strength - SUN_GLARE) / SUN_GLARE_RANGE) * (1 - Math.min(1, storm));
  return Math.max(0, Math.min(1, glare));
}

const hexRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

export function createLighting() {
  let canvas = null,
    context = null,
    lightCanvas = null,
    lightContext = null,
    cols = 0,
    rows = 0;
  let glareCanvas = null,
    glareContext = null,
    headlights = true;
  const bakes = new WeakMap();
  const sprites = new Map();

  function ensure(width, height) {
    if (canvas && cols === width && rows === height) return;
    cols = width;
    rows = height;
    canvas = createCanvas(cols, rows);
    context = canvas.getContext("2d");
    lightCanvas = createCanvas(cols, rows);
    lightContext = lightCanvas.getContext("2d");
    glareCanvas = null;
  }

  /** Switches the bike's headlight and tail light on or off. */
  function setHeadlights(on) {
    headlights = Boolean(on);
  }

  /**
   * Bakes a trail's light, or returns the cached bake while its terrain, time
   * of day and weather are unchanged. Call it when a ride starts so the first
   * frame doesn't pay for the bake.
   */
  function prepare(trail) {
    const geometry = terrainGeometry(trail);
    const { weather = {} } = trail;
    const key = `${trail.timeOfDay}|${weather.rain || 0}|${weather.lightning || 0}|${weather.sun ?? 1}|${weather.clouds ?? 0.35}`;
    let entry = bakes.get(trail);
    if (!entry || entry.geometry !== geometry || entry.key !== key) {
      entry = bake(trail, ambientFor(trail));
      entry.geometry = geometry;
      entry.key = key;
      bakes.set(trail, entry);
    }
    return entry;
  }

  function bake(trail, ambient) {
    const field = bakeLightField(trail, ambient);
    const entry = {
      ambient,
      field,
      glare: glareStrength(trail),
      shade: null,
      sky: rgb(ambient.sky),
      alwaysOn: ambient.sky.some((value) => value < 255),
      image: null,
      flash: null,
      cover: null,
      tiles: null,
      tileCols: 0,
      props: null,
    };
    if (field) {
      const { width, height, light, cover } = field;
      const lightning = Boolean(trail.weather?.lightning);
      const image = new ImageData(width, height),
        coverImage = new ImageData(width, height),
        flashImage = lightning ? new ImageData(width, height) : null,
        shadeImage = entry.glare > 0 ? new ImageData(width, height) : null;
      const tileCols = Math.ceil(width / TILE);
      const tiles = new Uint8Array(tileCols * Math.ceil(height / TILE));
      const { sky, cave } = ambient;
      for (let i = 0, at = 0; i < light.length; i++, at += 4) {
        const level = light[i];
        image.data[at] = cave[0] + (sky[0] - cave[0]) * level;
        image.data[at + 1] = cave[1] + (sky[1] - cave[1]) * level;
        image.data[at + 2] = cave[2] + (sky[2] - cave[2]) * level;
        image.data[at + 3] = 255;
        coverImage.data[at + 3] = cover[i] * 255;
        if (shadeImage) shadeImage.data[at + 3] = (1 - level) * 255;
        if (flashImage) {
          const strength = 0.25 + level * 0.75;
          flashImage.data[at] = FLASH[0] * strength;
          flashImage.data[at + 1] = FLASH[1] * strength;
          flashImage.data[at + 2] = FLASH[2] * strength;
          flashImage.data[at + 3] = 255;
        }
        if (level < 0.998) {
          const c = i % width,
            r = (i - c) / width;
          tiles[Math.floor(r / TILE) * tileCols + Math.floor(c / TILE)] = 1;
        }
      }
      entry.image = toCanvas(image);
      entry.cover = toCanvas(coverImage);
      entry.flash = flashImage && toCanvas(flashImage);
      entry.shade = shadeImage && toCanvas(shadeImage);
      entry.tiles = tiles;
      entry.tileCols = tileCols;
    }
    entry.props = propLights(trail, entry);
    return entry;
  }

  function toCanvas(image) {
    const target = createCanvas(image.width, image.height);
    target.getContext("2d").putImageData(image, 0, 0);
    return target;
  }

  function darkAt(entry, x, y) {
    return entry.ambient.glow || lightFieldAt(entry.field, x, y) < DARK_BELOW;
  }

  /** Whether it is dark enough at a world point for lamps to be on. */
  function isDark(trail, x, y) {
    return darkAt(prepare(trail), x, y);
  }

  // Lights that never move, worked out once per bake. `kind` picks how each
  // flickers, pulses or blinks.
  function propLights(trail, entry) {
    const lights = [];
    for (const prop of trail.props || []) {
      const { type } = prop;
      if (type !== "lantern" && type !== "lamp" && type !== "mushrooms" && type !== "crane") continue;
      const ground = terrainAt(trail, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      const y = Number.isFinite(prop.y) ? prop.y : ground.y;
      const dir = prop.flip ? -1 : 1;
      if (type === "lantern") {
        const fit = propWallFit(trail, prop);
        const cy = y + (fit?.body || 0) + LANTERN_CENTRE;
        lights.push({ kind: type, phase: prop.x, x: prop.x, y: cy, radius: 150, color: LANTERN, core: 12 });
      } else if (type === "mushrooms") {
        lights.push({ kind: type, phase: prop.x, x: prop.x, y: y - 6, radius: 64, color: GLOW, strength: 0.8 });
      } else if (type === "lamp") {
        const hx = prop.x + dir * LAMP_HEAD.x,
          hy = y + LAMP_HEAD.y;
        if (!darkAt(entry, hx, hy)) continue;
        lights.push({ x: hx, y: hy, radius: 170, color: LAMP, angle: Math.PI / 2, spread: 0.42 });
        lights.push({ x: hx, y: hy, radius: 40, color: LAMP, strength: 0.6, core: 6 });
      } else {
        if (!darkAt(entry, prop.x, y + CRANE_LIGHTS[0][1])) continue;
        CRANE_LIGHTS.forEach(([lx, ly], index) =>
          lights.push({ kind: type, phase: index, x: prop.x + dir * lx, y: y + ly, radius: 40, color: CRANE, strength: 0.7, core: 4 }),
        );
      }
    }
    return lights;
  }

  // `flip` is the animated facing, -1…1. The lights sit where the bike art
  // draws its lamps, placed with the same transform as the sprite: centred
  // between the wheels, turned to the frame in 32 steps and mirrored by
  // `flip`, so they stay on the bike through flips, loops and 180s in the air.
  // The beam itself turns with the frame's true angle, not the 32 steps: a
  // long beam jumping a step at a time is hard to steer by.
  function bikeLights(ride, flip, lights) {
    if (ride.ragdoll) return;
    const { rear, front } = ride;
    const mx = (rear.x + front.x) / 2,
      my = (rear.y + front.y) / 2;
    const step = (Math.PI * 2) / 32;
    const frame = Math.atan2(front.y - rear.y, front.x - rear.x);
    const angle = Math.round(frame / step) * step;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const at = ([lx, ly]) => ({ x: mx + cos * flip * lx - sin * ly, y: my + sin * flip * lx + cos * ly });
    const facing = flip < 0 ? -1 : 1;
    const turn = Math.abs(flip);
    if (!headlights) return;
    lights.push(
      {
        ...at(BIKE_HEADLIGHT),
        radius: 230,
        color: HEADLIGHT,
        strength: turn,
        angle: Math.atan2(Math.sin(frame) * facing, Math.cos(frame) * facing),
        spread: 0.3,
        core: 5,
      },
      { ...at(BIKE_TAIL_LIGHT), radius: 22, color: TAIL, strength: 0.7 * turn, core: 2 },
    );
  }

  function strengthOf(item, time) {
    const base = item.strength ?? 1;
    if (item.kind === "lantern") return base * lanternFlicker(item.phase, time);
    if (item.kind === "mushrooms") return base * mushroomPulse(item.phase, time);
    if (item.kind === "crane") return craneLightOn(item.phase, time) ? base : 0;
    return base;
  }

  // A light at full strength, cached by size, colour and beam width. A beam
  // points along +x from the sprite's centre.
  function sprite(radius, color, spread = 0) {
    const r = Math.max(1, Math.round(radius / ART_PIXEL));
    const key = `${r}|${color}|${spread}`;
    let cached = sprites.get(key);
    if (cached) return cached;
    const image = createCanvas(r * 2, r * 2);
    const g = image.getContext("2d");
    if (spread) {
      g.beginPath();
      g.moveTo(r, r);
      g.arc(r, r, r, -spread, spread);
      g.closePath();
      g.clip();
    }
    const gradient = g.createRadialGradient(r, r, 0, r, r, r);
    const [cr, cg, cb] = color;
    let from = 0;
    for (const [to, level] of BANDS) {
      const stop = `rgba(${cr},${cg},${cb},${level})`;
      gradient.addColorStop(from, stop);
      gradient.addColorStop(to, stop);
      from = Math.min(1, to + 0.0001);
    }
    gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = gradient;
    g.fillRect(0, 0, r * 2, r * 2);
    cached = { image, r };
    sprites.set(key, cached);
    return cached;
  }

  // The area a light reaches before the terrain blocks it, as a world-space
  // polygon [x, y, x, y, …], or null when nothing blocks it.
  function lightShape(field, { x, y, radius, spread = 0, angle = 0 }) {
    // A beam's polygon is a touch wider than the beam so its edges aren't clipped.
    const arc = spread ? spread * 2 + 0.04 : Math.PI * 2;
    const count = Math.max(8, Math.min(180, Math.ceil((arc * radius) / RAY_SPACING)));
    const from = spread ? angle - spread - 0.02 : 0;
    const points = spread ? [x, y] : [];
    let blocked = false;
    for (let i = 0; i < (spread ? count + 1 : count); i++) {
      const a = from + (arc * i) / count,
        dx = Math.cos(a),
        dy = Math.sin(a);
      const reach = lightReach(field, x, y, dx, dy, radius, SHADOW_SKIN);
      if (reach < radius) blocked = true;
      points.push(x + dx * reach, y + dy * reach);
    }
    return blocked ? points : null;
  }

  // Lights are cut to what they can reach, so they cast shadows; prop lights
  // never move, so their shape is worked out once, the first time they're seen.
  function stamp(item, strength, left, top, field) {
    const { image, r } = sprite(item.radius, item.color, item.spread);
    const px = Math.round((item.x - left) / ART_PIXEL),
      py = Math.round((item.y - top) / ART_PIXEL);
    if (px + r < 0 || py + r < 0 || px - r > cols || py - r > rows) return false;
    if (item.shape === undefined) item.shape = lightShape(field, item);
    const shape = item.shape;
    if (shape) {
      lightContext.save();
      lightContext.beginPath();
      for (let k = 0; k < shape.length; k += 2)
        lightContext.lineTo((shape[k] - left) / ART_PIXEL, (shape[k + 1] - top) / ART_PIXEL);
      lightContext.closePath();
      lightContext.clip();
    }
    lightContext.globalAlpha = Math.min(1, strength);
    if (item.spread) {
      lightContext.setTransform(1, 0, 0, 1, px, py);
      lightContext.rotate(item.angle);
      lightContext.drawImage(image, -r, -r);
      lightContext.setTransform(1, 0, 0, 1, 0, 0);
    } else lightContext.drawImage(image, px - r, py - r);
    if (shape) lightContext.restore();
    return true;
  }

  // Draws one of the baked layers for the view; below the field its bottom
  // row carries on down, and anything else outside it is open sky.
  function drawField(target, image, field, left, top) {
    const { unit } = field;
    const scale = unit / ART_PIXEL;
    const sx = (left - field.x) / unit,
      sy = (top - field.y) / unit;
    const x0 = Math.max(0, Math.floor(sx) - 1),
      x1 = Math.min(field.width, Math.ceil(sx + cols / scale) + 1);
    if (x1 <= x0) return;
    const y0 = Math.max(0, Math.floor(sy) - 1),
      y1 = Math.min(field.height, Math.ceil(sy + rows / scale) + 1);
    const dx = (x0 - sx) * scale,
      dw = (x1 - x0) * scale;
    if (y1 > y0) target.drawImage(image, x0, y0, x1 - x0, y1 - y0, dx, (y0 - sy) * scale, dw, (y1 - y0) * scale);
    const bottom = Math.max(0, (field.height - 1 - sy) * scale);
    if (bottom < rows) target.drawImage(image, x0, field.height - 1, x1 - x0, 1, dx, bottom, dw, rows - bottom);
  }

  // Whether any of the view isn't in full daylight.
  function viewIsLit(entry, left, top) {
    const { field, tiles, tileCols } = entry;
    if (!field) return false;
    const span = field.unit * TILE;
    const c0 = Math.max(0, Math.floor((left - field.x) / span)),
      c1 = Math.min(tileCols - 1, Math.floor((left + cols * ART_PIXEL - field.x) / span));
    const tileRows = tiles.length / tileCols;
    const r0 = Math.min(tileRows - 1, Math.max(0, Math.floor((top - field.y) / span))),
      r1 = Math.min(tileRows - 1, Math.max(0, Math.floor((top + rows * ART_PIXEL - field.y) / span)));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (tiles[r * tileCols + c]) return true;
    return false;
  }

  /**
   * Multiplies everything already drawn by the light map, then adds a small
   * bloom on each light's source, and the glare of a strong sun. Draws in
   * world space; `width` and `height` are the view's size in world units.
   * Returns false when the view is in full daylight and the scene needed no
   * shading.
   */
  function draw(ctx, options) {
    const { trail, cameraX, cameraY, width, height } = options;
    const entry = prepare(trail);
    const left = Math.floor(cameraX / ART_PIXEL) * ART_PIXEL,
      top = Math.floor(cameraY / ART_PIXEL) * ART_PIXEL;
    ensure(Math.ceil(width / ART_PIXEL) + 2, Math.ceil(height / ART_PIXEL) + 2);
    const lit = (entry.alwaysOn || viewIsLit(entry, left, top)) && shadeScene(ctx, entry, options, left, top);
    if (entry.glare > 0) drawGlare(ctx, entry, options, left, top);
    return lit;
  }

  function shadeScene(ctx, entry, { ride, flash = 0, time = 0, flip = 1 }, left, top) {
    const { field } = entry;

    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.fillStyle = entry.sky;
    context.fillRect(0, 0, cols, rows);
    context.imageSmoothingEnabled = true;
    if (field) drawField(context, entry.image, field, left, top);
    if (flash > 0 && entry.flash) {
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = Math.min(1, flash);
      drawField(context, entry.flash, field, left, top);
      context.globalAlpha = 1;
    }

    const lights = [...entry.props];
    bikeLights(ride, flip, lights);

    lightContext.setTransform(1, 0, 0, 1, 0, 0);
    lightContext.globalCompositeOperation = "source-over";
    lightContext.globalAlpha = 1;
    lightContext.clearRect(0, 0, cols, rows);
    lightContext.globalCompositeOperation = "lighter";
    lightContext.imageSmoothingEnabled = false;
    const cores = [];
    let stamped = 0;
    for (const item of lights) {
      const strength = strengthOf(item, time);
      if (strength <= 0 || !stamp(item, strength, left, top, field)) continue;
      stamped++;
      if (item.core) cores.push(item, strength);
    }
    if (stamped) {
      if (field) {
        // Moving lights only reach the skin of the rock.
        lightContext.globalCompositeOperation = "destination-out";
        lightContext.globalAlpha = 1;
        lightContext.imageSmoothingEnabled = true;
        drawField(lightContext, entry.cover, field, left, top);
      }
      context.globalCompositeOperation = "lighter";
      context.drawImage(lightCanvas, 0, 0);
      context.globalCompositeOperation = "source-over";
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(canvas, left, top, cols * ART_PIXEL, rows * ART_PIXEL);
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < cores.length; index += 2) {
      const item = cores[index],
        strength = cores[index + 1];
      const x = Math.round(item.x / 2) * 2,
        y = Math.round(item.y / 2) * 2;
      ctx.fillStyle = rgb(item.color);
      for (const [scale, alpha] of [[1, 0.25], [0.5, 0.35]]) {
        ctx.globalAlpha = Math.min(1, alpha * strength);
        ctx.beginPath();
        ctx.arc(x, y, item.core * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return true;
  }

  // The glare of a strong sun: a halo round it and slow rays fanning down
  // across the view, kept out of caves and rock by the baked shade. It fades
  // when the sun's place in the world is dark, as when the view is deep in a
  // cave. Screened on top so it only ever brightens.
  function drawGlare(ctx, entry, { trail, cameraX, cameraY, width, height, time = 0 }, left, top) {
    const sun = sunLight({ width, cameraX, cameraY, weather: trail.weather, timeOfDay: trail.timeOfDay });
    const sx = cameraX + sun.x,
      sy = cameraY + sun.y;
    const seen = entry.field ? Math.max(0, lightFieldAt(entry.field, sx, sy) * 2 - 1) : 1;
    const glare = entry.glare * seen;
    if (glare <= 0.01) return;
    if (!glareCanvas) {
      glareCanvas = createCanvas(cols, rows);
      glareContext = glareCanvas.getContext("2d");
    }
    const g = glareContext;
    const color = hexRgb(timeOfDayPalette(trail).sun || "#fff2c8");
    const [cr, cg, cb] = color;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, cols, rows);
    g.globalCompositeOperation = "lighter";
    g.imageSmoothingEnabled = false;
    const ox = (sx - left) / ART_PIXEL,
      oy = (sy - top) / ART_PIXEL;
    const toward = Math.atan2(height * 0.6 - sun.y, width * 0.5 - sun.x);
    const diagonal = Math.hypot(cols, rows);
    SUN_RAYS.forEach(([offset, spread, length, level], index) => {
      const angle = toward + offset + Math.sin(time * 0.21 + index * 2.3) * 0.025;
      const pulse = 0.7 + 0.3 * Math.sin(time * 0.55 + index * 1.7);
      const reach = length * diagonal;
      const gradient = g.createRadialGradient(ox, oy, 0, ox, oy, reach);
      let from = 0;
      for (const [to, band] of BANDS) {
        const stop = `rgba(${cr},${cg},${cb},${band * level})`;
        gradient.addColorStop(from, stop);
        gradient.addColorStop(to, stop);
        from = Math.min(1, to + 0.0001);
      }
      gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.globalAlpha = pulse;
      g.fillStyle = gradient;
      g.beginPath();
      g.moveTo(ox, oy);
      g.arc(ox, oy, reach, angle - spread, angle + spread);
      g.closePath();
      g.fill();
    });
    g.globalAlpha = 1;
    const halo = sprite(150, color);
    g.drawImage(halo.image, Math.round(ox - halo.r), Math.round(oy - halo.r));
    if (entry.shade) {
      g.globalCompositeOperation = "destination-out";
      g.imageSmoothingEnabled = true;
      drawField(g, entry.shade, entry.field, left, top);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.24 * glare;
    ctx.drawImage(glareCanvas, left, top, cols * ART_PIXEL, rows * ART_PIXEL);
    ctx.restore();
  }

  return { prepare, isDark, draw, setHeadlights };
}
