// @ts-check
// Desert props. Like every prop they sit on the 2-unit art grid, have no
// outlines, and are lit from the right: shaded on the left and underneath.
// Static parts are drawn once into sprites by drawing.js; the parts that move
// or follow the ground are drawn live from the functions exported here. The
// motion is decoration only and never touches the simulation, and with reduced
// motion (time 0) everything stands still.

import { STEEL } from "./city-props.js";

const WOOD = {
  dark: "#4d3f2f",
  base: "#66543f",
  plank: "#806244",
  light: "#856d4f",
  tip: "#aa8a60",
  cut: "#c39664",
};
const RUBBER = { dark: "#3a403d", base: "#4a524d", light: "#5b645e" };
// Sun-bleached bone, from the sign board's cream and the sand's shadows.
const BONE = { deep: "#c2a674", shade: "#d9b884", base: "#f4e9d1", light: "#fffdf4", socket: "#4d3f2f" };
// The sand terrain's own colours, so drifts blend into it.
const SAND = { deep: "#a98e61", dark: "#c2a674", base: "#d8c08e", light: "#e6d2a3", top: "#e9d8a8" };
// Rust from the brick reds, with flecks of the cone's orange.
const RUST = { deep: "#4d3f2f", dark: "#71392f", base: "#8d493d", light: "#a65a49", bright: "#c9573a" };
// What is left of the paint: the city props' teal.
const PAINT = { dark: "#3f6f78", base: "#568f98", light: "#83d1ce" };
// Dry twigs.
const TWIG = { dark: "#806244", base: "#aa8a60", light: "#c39664", tip: "#d9b884" };
// A turkey vulture: near-black plumage, silver flight feathers, a red head.
const VULTURE = { dark: "#263b36", base: "#3a403d", mid: "#4a524d", silver: "#8b978c", head: "#c9573a", beak: "#f4e9d1" };
// Heat haze: a pale glare, and the sky a mirage shows on the ground.
export const HAZE = { glare: "#fff3be", mirage: "#d9f1ee" };

const snap = (value) => Math.round(value / 2) * 2;

// Draws [x, y, width, height, colour] rectangles shifted by (dx, dy).
function rects({ pixelRect }, list, dx = 0, dy = 0) {
  for (const [x, y, width, height, color] of list) pixelRect(x + dx, y + dy, width, height, color, 2);
}

// A tiny repeatable noise in [0, 1) for per-prop variety.
export function desertNoise(x, n) {
  const s = Math.sin(n * 127.1 + x * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// Cow skull
// ---------------------------------------------------------------------------

/** 40 × 24: a bleached cow skull lying face-on in the sand, horns up. */
export function drawCowSkull(tools) {
  const b = BONE;
  rects(tools, [
    // Horns, curling up from the brow; the left one in shade.
    [-14, -18, 6, 4, b.shade],
    [-18, -20, 4, 4, b.shade],
    [-20, -24, 2, 4, WOOD.cut],
    [-18, -22, 2, 2, b.deep],
    [8, -18, 6, 4, b.base],
    [14, -20, 4, 4, b.light],
    [18, -24, 2, 4, WOOD.cut],
    [16, -22, 2, 2, b.base],
    [-14, -14, 4, 2, b.deep],
    [10, -14, 4, 2, b.shade],
    // Brow and cranium.
    [-8, -20, 16, 6, b.base],
    [-8, -20, 4, 6, b.shade],
    [2, -20, 6, 2, b.light],
    [0, -20, 2, 2, b.shade],
    // Face, with deep eye sockets.
    [-8, -14, 16, 6, b.base],
    [-8, -14, 2, 6, b.shade],
    [6, -14, 2, 6, b.light],
    [-6, -12, 4, 4, b.socket],
    [2, -12, 4, 4, b.socket],
    [-6, -12, 2, 2, RUBBER.dark],
    // Snout narrowing to the nose.
    [-6, -8, 12, 4, b.base],
    [-6, -8, 2, 4, b.shade],
    [4, -8, 2, 2, b.light],
    [-4, -4, 8, 4, b.base],
    [-4, -4, 2, 2, b.socket],
    [2, -4, 2, 2, b.socket],
    [-4, -2, 8, 2, b.shade],
    [-2, -2, 4, 2, b.deep],
  ]);
}

// ---------------------------------------------------------------------------
// Tumbleweed
// ---------------------------------------------------------------------------

export const TUMBLEWEED_RADIUS = 12;
// How far a tumbleweed rolls before it is blown out of sight, how fast, and
// how long it is gone before the next one rolls in, in units and seconds.
export const TUMBLEWEED_RUN = 360;
export const TUMBLEWEED_SPEED = 30;
export const TUMBLEWEED_REST = 2.5;
// Its path is traced every STEP units, and ends at a step up or down bigger
// than STEP_UP, or where the ground runs out.
export const TUMBLEWEED_STEP = 4;
export const TUMBLEWEED_STEP_UP = 14;
// How far it rolls while it fades in and out at either end of its run.
const TUMBLEWEED_FADE = 40;

// Twigs as polar polylines [radius, angle] around the ball's centre, from the
// back of the ball (drawn first, darkest) to the front.
const TWIGS = (() => {
  let seed = 17;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const twigs = [];
  for (let index = 0; index < 30; index++) {
    const start = random() * Math.PI * 2;
    const sweep = (0.9 + random() * 1.4) * (random() < 0.5 ? -1 : 1);
    const inner = index % 2 === 0;
    const points = [];
    for (let step = 0; step <= 4; step++) {
      const t = step / 4;
      const r = TUMBLEWEED_RADIUS * (inner ? 0.2 + random() * 0.5 : 0.7 + random() * 0.3);
      points.push([r, start + sweep * t]);
    }
    twigs.push({ points, layer: index < 12 ? 0 : index < 22 ? 1 : 2 });
  }
  return twigs;
})();

/**
 * A tumbleweed's ball of twigs centred on (0, 0), turned by `angle` radians.
 * Each twig is placed on the art grid after turning, so it stays crisp.
 */
export function drawTumbleweed({ pixelPath, pixelRect }, angle) {
  const colors = [TWIG.dark, TWIG.base, TWIG.light];
  for (const { points, layer } of TWIGS) {
    const turned = points.map(([r, a]) => [snap(Math.cos(a + angle) * r), snap(Math.sin(a + angle) * r)]);
    // Lit from the right: twigs on the sunny side are a shade lighter.
    const side = turned.reduce((sum, [x]) => sum + x, 0) / turned.length;
    const lit = Math.min(2, layer + (side > 3 ? 1 : 0));
    pixelPath(turned, side < -5 && lit > 0 ? colors[lit - 1] : colors[lit], 1, 2);
    const [tx, ty] = turned[turned.length - 1];
    if (layer === 2 && tx > 0 && ty < 0) pixelRect(tx, ty, 2, 2, TWIG.tip, 2);
  }
}

/**
 * Where a tumbleweed is `time` seconds into the trail. `path` is the ground
 * offset every TUMBLEWEED_STEP units along its run (see drawing.js); `phase`
 * staggers tumbleweeds. Returns how far along it is, its height offset, how
 * far it has turned, and how opaque it is. At time 0 it sits at its anchor.
 */
export function tumbleweedRoll(path, time, phase = 0) {
  const ground = (distance) => {
    if (!path?.length) return 0;
    const at = Math.max(0, distance) / TUMBLEWEED_STEP;
    const i = Math.min(path.length - 1, Math.floor(at));
    const next = path[Math.min(path.length - 1, i + 1)];
    return path[i] + (next - path[i]) * (at - i);
  };
  const run = Math.min(TUMBLEWEED_RUN, Math.max(0, ((path?.length ?? 1) - 1) * TUMBLEWEED_STEP));
  if (!(time > 0) || run < TUMBLEWEED_FADE * 2) {
    // Nowhere to roll: it rocks in the breeze where it lies.
    const rock = time > 0 ? Math.sin(time * 1.7 + phase * 6) * 0.25 : 0;
    return { distance: 0, dy: ground(0), angle: rock, lift: 0, alpha: 1 };
  }
  const period = run / TUMBLEWEED_SPEED + TUMBLEWEED_REST;
  const at = (time + phase * period) % period;
  const distance = Math.min(run, at * TUMBLEWEED_SPEED);
  if (at * TUMBLEWEED_SPEED > run) return { distance: run, dy: ground(run), angle: 0, lift: 0, alpha: 0 };
  // A little bounce every few turns as it catches on the ground.
  const lift = Math.abs(Math.sin((distance * Math.PI) / 44)) * 5;
  const fade = Math.min(1, distance / TUMBLEWEED_FADE, (run - distance) / TUMBLEWEED_FADE);
  return {
    distance,
    dy: ground(distance),
    angle: distance / TUMBLEWEED_RADIUS,
    lift,
    alpha: Math.max(0, fade),
  };
}

// ---------------------------------------------------------------------------
// Rusted car wreck
// ---------------------------------------------------------------------------

// The wreck sits this far below its anchor, so its sand drifts meet the ground.
export const WRECK_SINK = 2;
// Sand drifts against the wreck: [centre x, height, half width].
const WRECK_DRIFTS = [[-54, 18, 20], [-16, 10, 16], [36, 14, 22], [60, 8, 10]];

/** 128 × 44: an old rusted sedan, facing right, sunk to its axles in sand. */
export function drawCarWreck(tools) {
  const r = RUST;
  rects(tools, [
    // Roof and cabin.
    [-22, -42, 36, 2, r.light],
    [-26, -40, 44, 18, r.base],
    [-26, -40, 4, 18, r.dark],
    [-22, -42, 4, 2, r.base],
    [14, -40, 4, 2, r.bright],
    [18, -36, 2, 14, r.base],
    [20, -32, 2, 10, r.base],
    [-28, -34, 2, 12, r.dark],
    // Empty window frames and a last shard of glass.
    [-22, -36, 16, 10, RUBBER.dark],
    [-2, -36, 18, 10, RUBBER.dark],
    [16, -32, 2, 6, RUBBER.dark],
    [-6, -36, 4, 10, r.dark],
    [-22, -36, 2, 10, RUBBER.base],
    [12, -36, 2, 4, PAINT.light],
    [14, -34, 2, 2, PAINT.base],
    // Boot and bonnet.
    [-54, -26, 28, 4, r.base],
    [-54, -26, 28, 2, r.light],
    [20, -26, 34, 4, r.base],
    [20, -26, 34, 2, r.light],
    [44, -26, 4, 2, r.bright],
    // Body side.
    [-56, -22, 112, 18, r.base],
    [-56, -22, 4, 18, r.dark],
    [52, -22, 4, 18, r.light],
    [-56, -8, 112, 4, r.dark],
    // Door seams, a handle, the last of the paint and the rust holes.
    [-8, -22, 2, 16, r.dark],
    [20, -22, 2, 16, r.dark],
    [-2, -18, 4, 2, STEEL.mid],
    [-42, -20, 10, 4, PAINT.base],
    [-42, -20, 2, 4, PAINT.dark],
    [-36, -16, 4, 2, PAINT.dark],
    [28, -20, 6, 2, PAINT.base],
    [-46, -14, 4, 2, r.deep],
    [6, -12, 2, 4, r.deep],
    [36, -16, 4, 2, r.deep],
    [-20, -18, 6, 2, r.bright],
    [8, -20, 6, 2, r.bright],
    [42, -12, 4, 2, r.bright],
    // A trim strip and the headlamp socket.
    [-50, -12, 100, 2, r.light],
    [50, -20, 4, 4, RUBBER.dark],
    // Bumpers, pitted chrome.
    [56, -16, 6, 6, STEEL.base],
    [56, -16, 6, 2, STEEL.light],
    [-62, -16, 6, 6, STEEL.dark],
    [-62, -16, 6, 2, STEEL.base],
    // Wheel arches with the tops of the tyres showing.
    [-44, -10, 24, 6, RUBBER.dark],
    [-40, -12, 16, 2, RUBBER.dark],
    [-40, -8, 16, 4, RUBBER.base],
    [-34, -6, 4, 2, STEEL.base],
    [28, -10, 22, 6, RUBBER.dark],
    [32, -12, 14, 2, RUBBER.dark],
    [32, -8, 14, 4, RUBBER.base],
    [38, -6, 4, 2, STEEL.dark],
  ]);
  // Sand drifted up its sides: deepest against the boot on the windward
  // side and over the front wheel, tapering out past the bumpers.
  const s = SAND;
  const height = (x) => {
    const edge = Math.max(0, 70 - Math.abs(x)) * 1.5;
    const drifts = WRECK_DRIFTS.map(([at, top, half]) =>
      Math.abs(x - at) < half ? top * (0.5 + 0.5 * Math.cos((Math.PI * (x - at)) / half)) : 0,
    );
    return snap(Math.min(edge, Math.max(6, ...drifts)));
  };
  for (let x = -70; x < 70; x += 2) {
    const h = height(x);
    if (h <= 0) continue;
    const next = height(x + 2);
    const before = height(x - 2);
    // Lit from the right: slopes that fall away to the right catch the sun.
    const top = next < h ? s.top : before < h ? s.base : s.light;
    tools.pixelRect(x, WRECK_SINK - h, 2, h, s.base, 2);
    tools.pixelRect(x, WRECK_SINK - h, 2, 2, top, 2);
    if (before > h) tools.pixelRect(x, WRECK_SINK - h + 2, 2, 2, s.dark, 2);
    if (desertNoise(x, 3) > 0.8 && h > 4) tools.pixelRect(x, WRECK_SINK - 2, 2, 2, s.dark, 2);
  }
}

// ---------------------------------------------------------------------------
// Wooden water tower
// ---------------------------------------------------------------------------

// The tank and bracing are a sprite down to TOWER_BODY_BOTTOM; the legs and
// the ladder are drawn live below the platform so they follow the ground.
export const TOWER_PLATFORM = -106;
export const TOWER_BODY_BOTTOM = -20;
// Legs as [x, width, shaded]: the back pair is darker and narrower.
export const TOWER_LEGS = [
  [-30, 4, true],
  [-12, 2, true],
  [10, 2, true],
  [26, 4, false],
];
export const TOWER_LADDER = { left: 32, right: 40, top: -104, step: 10 };

/** The tank, roof, platform and cross-bracing of a 72 × 176 water tower. */
export function drawWaterTower(tools) {
  const { pixelPath } = tools;
  const w = WOOD;
  // Cross-bracing between the legs, behind them.
  for (const [top, bottom] of [[-102, -64], [-62, -24]]) {
    pixelPath([[-26, top], [-12, bottom]], w.dark, 1, 2);
    pixelPath([[-12, top], [-26, bottom]], w.dark, 1, 2);
    pixelPath([[-10, top], [10, bottom]], w.base, 1, 2);
    pixelPath([[10, top], [-10, bottom]], w.dark, 1, 2);
    pixelPath([[12, top], [26, bottom]], w.base, 1, 2);
    pixelPath([[26, top], [12, bottom]], w.plank, 1, 2);
  }
  rects(tools, [
    [-28, -64, 56, 2, w.base],
    [-28, -62, 56, 2, w.dark],
  ]);
  // Tank of upright staves, shaded left, lit right.
  const staves = [w.dark, w.base, w.base, w.plank, w.plank, w.light, w.light, w.plank, w.light, w.tip, w.light, w.tip];
  staves.forEach((color, index) => {
    const x = -30 + index * 5;
    rects(tools, [[snap(x), -150, 6, 44, color]]);
  });
  for (let x = -26; x < 30; x += 10) rects(tools, [[x, -150, 2, 44, w.dark]]);
  rects(tools, [[-30, -150, 2, 44, w.dark]]);
  // Iron hoops round the tank.
  for (const y of [-146, -130, -114]) {
    rects(tools, [
      [-32, y, 64, 2, STEEL.dark],
      [8, y, 22, 2, STEEL.base],
      [30, y, 2, 2, STEEL.mid],
    ]);
  }
  // Conical roof stepping up to a finial.
  rects(tools, [
    [-36, -152, 72, 2, w.dark],
    [-32, -156, 64, 4, w.plank],
    [-26, -160, 52, 4, w.plank],
    [-20, -164, 40, 4, w.light],
    [-12, -168, 24, 4, w.light],
    [-6, -172, 12, 4, w.tip],
    [-2, -176, 4, 4, STEEL.base],
    [-32, -156, 8, 4, w.base],
    [-26, -160, 8, 4, w.base],
    [-20, -164, 6, 4, w.base],
    [12, -160, 14, 2, w.tip],
    [8, -164, 12, 2, w.tip],
    [-36, -152, 72, 2, w.dark],
    [24, -156, 8, 2, w.tip],
  ]);
  // Platform under the tank, and the spout that swings down to fill a wagon.
  rects(tools, [
    [-38, -106, 76, 4, w.plank],
    [-38, -106, 76, 2, w.tip],
    [-38, -104, 4, 2, w.dark],
    [-24, -102, 4, 4, STEEL.dark],
    [-28, -98, 4, 12, STEEL.base],
    [-28, -98, 2, 12, STEEL.dark],
    [-32, -88, 6, 4, STEEL.base],
    [-32, -88, 6, 2, STEEL.mid],
  ]);
}

// ---------------------------------------------------------------------------
// Windmill water pump
// ---------------------------------------------------------------------------

// The rotor turns about ROTOR on the top of a lattice tower; the tower is a
// sprite down to WINDMILL_BODY_BOTTOM and its feet are drawn live.
export const ROTOR = { x: 0, y: -158, radius: 30, hub: 6 };
export const WINDMILL_BODY_BOTTOM = -12;
export const WINDMILL_FEET = [-22, 18];
const WINDMILL_BLADES = 12;

/** The lattice tower, pump and tail vane of a farm windmill, without its rotor. */
export function drawWindmillTower(tools) {
  const { pixelPath } = tools;
  // Legs taper from the feet to the head; girts and braces between them.
  const legAt = (y, side) => {
    const t = (WINDMILL_BODY_BOTTOM - y) / (WINDMILL_BODY_BOTTOM + 140);
    return side < 0 ? -22 + t * 16 : 18 - t * 14;
  };
  const levels = [-12, -44, -74, -100, -122, -140];
  for (let i = 0; i < levels.length - 1; i++) {
    const [low, high] = [levels[i], levels[i + 1]];
    pixelPath([[legAt(low, -1) + 2, low], [legAt(high, 1), high]], STEEL.dark, 1, 2);
    pixelPath([[legAt(low, 1), low], [legAt(high, -1) + 2, high]], STEEL.base, 1, 2);
  }
  for (const y of levels.slice(1))
    rects(tools, [[snap(legAt(y, -1)), y, snap(legAt(y, 1) - legAt(y, -1)) + 2, 2, STEEL.base]]);
  pixelPath([[-22, -12], [-6, -140]], STEEL.dark, 1, 2);
  pixelPath([[-20, -12], [-4, -140]], STEEL.base, 1, 2);
  pixelPath([[18, -12], [4, -140]], STEEL.mid, 1, 2);
  pixelPath([[20, -12], [6, -140]], STEEL.light, 1, 2);
  // The pump rod down the middle to the pump head and its spout.
  rects(tools, [
    [0, -140, 2, 120, RUBBER.base],
    [-4, -24, 10, 12, STEEL.base],
    [-4, -24, 2, 12, STEEL.dark],
    [4, -24, 2, 12, STEEL.mid],
    [-6, -26, 14, 2, STEEL.mid],
    [6, -20, 8, 2, STEEL.base],
    [12, -18, 2, 4, STEEL.dark],
    [12, -14, 2, 2, PAINT.light],
  ]);
  // Platform, gearbox and the tail vane pointing downwind.
  rects(tools, [
    [-12, -142, 24, 2, STEEL.mid],
    [-12, -140, 24, 2, STEEL.dark],
    [-4, -150, 8, 8, STEEL.base],
    [-4, -150, 2, 8, STEEL.dark],
    [2, -150, 2, 6, STEEL.light],
    [-48, -156, 44, 2, STEEL.base],
    [-48, -154, 44, 2, STEEL.dark],
    [-60, -170, 14, 26, STEEL.base],
    [-60, -170, 2, 26, STEEL.dark],
    [-48, -170, 2, 26, STEEL.light],
    [-58, -162, 10, 6, RUST.bright],
    [-58, -158, 10, 2, RUST.base],
  ]);
}

/**
 * The windmill's rotor turned `angle` radians about its hub at (0, 0): blades
 * between two rings, lit from the right.
 */
export function drawWindmillRotor({ pixelRect }, angle) {
  const { radius, hub } = ROTOR;
  const spacing = (Math.PI * 2) / WINDMILL_BLADES;
  // Scan the art grid once: each cell is a ring, a blade or open sky.
  for (let y = -radius; y <= radius; y += 2) {
    for (let x = -radius; x <= radius; x += 2) {
      const cx = x + 1;
      const cy = y + 1;
      const r = Math.hypot(cx, cy);
      if (r > radius + 1 || r < hub) continue;
      const a = Math.atan2(cy, cx);
      if (r > radius - 1.5) {
        pixelRect(x, y, 2, 2, Math.cos(a) > 0.4 ? STEEL.base : STEEL.dark, 2);
        continue;
      }
      if (Math.abs(r - (radius - 12)) < 1) {
        pixelRect(x, y, 2, 2, STEEL.dark, 2);
        continue;
      }
      // Offset from the nearest blade's centre line, as arc length.
      let offset = (a - angle) / spacing;
      offset = (offset - Math.round(offset)) * spacing * r;
      // Blades widen towards the rim, like the sheet-steel sails.
      const half = 1.2 + (r - hub) * 0.09;
      if (Math.abs(offset) > half) continue;
      const lit = Math.cos(a) > 0.2;
      const edge = offset < -half + 2;
      const color = lit ? (edge ? STEEL.mid : STEEL.light) : edge ? STEEL.dark : STEEL.base;
      pixelRect(x, y, 2, 2, color, 2);
    }
  }
  pixelRect(-4, -4, 8, 8, STEEL.dark, 2);
  pixelRect(0, -4, 4, 4, STEEL.mid, 2);
  pixelRect(-2, -2, 2, 2, RUBBER.dark, 2);
}

/**
 * How hard the wind blows on a trail, 0 … 1: a breeze in fair weather, more
 * under cloud, and a gale in rain, snow or a thunderstorm.
 */
export function windStrength(weather = {}) {
  const value = (key) => Math.max(0, Math.min(1, Number(weather?.[key]) || 0));
  const storm = Math.max(value("rain"), value("snow"), value("lightning"));
  return Math.min(1, 0.25 + value("clouds") * 0.2 + storm * 0.75);
}

/**
 * How far a windmill's rotor has turned at `time` in a `wind` of 0 … 1, with
 * gusts; `phase` keeps neighbouring windmills out of step. It always turns the
 * same way, faster in stronger wind, and stands still at time 0.
 */
export function windmillAngle(time, wind = 0.25, phase = 0) {
  if (!(time > 0)) return phase * Math.PI * 2;
  const speed = 0.8 + wind * 4.2;
  // The gust term's rate of change never exceeds the base speed.
  const gust = (speed * 0.35) * Math.sin(time * 0.6 + phase * 9);
  return time * speed + gust + phase * Math.PI * 2;
}

// ---------------------------------------------------------------------------
// Heat haze
// ---------------------------------------------------------------------------

// How wide and how high above the ground the haze shimmers.
export const HAZE_HALF = 80;
export const HAZE_RISE = 44;

/**
 * How far each row of the scene behind the haze is shifted at `time`, in art
 * pixels: -1, 0 or 1, strongest near the ground. `row` counts up from the
 * ground in 2-unit rows. Nothing moves at time 0.
 */
export function hazeShift(row, time, phase = 0) {
  if (!(time > 0)) return 0;
  const strength = 1 - row / (HAZE_RISE / 2);
  const wave = Math.sin(time * 5.1 + row * 0.9 + phase * 6) + 0.6 * Math.sin(time * 3.3 - row * 0.45);
  return Math.abs(wave) * strength > 0.7 ? Math.sign(wave) : 0;
}

/**
 * The faint glare streaks rising through the haze at `time`: each one's
 * x, its height above the ground, width and opacity.
 */
export function hazeStreaks(time, phase = 0) {
  const streaks = [];
  for (let i = 0; i < 7; i++) {
    const n = desertNoise(phase * 97 + i, 3);
    const speed = 6 + n * 6;
    const rise = ((time * speed + n * HAZE_RISE * 3) % HAZE_RISE + HAZE_RISE) % HAZE_RISE;
    const x = (desertNoise(phase * 97 + i, 5) * 2 - 1) * (HAZE_HALF - 16);
    const wobble = time > 0 ? Math.sin(time * 2 + i) * 4 : 0;
    const life = rise / HAZE_RISE;
    streaks.push({
      x: snap(x + wobble),
      y: -snap(4 + rise),
      width: snap(8 + desertNoise(phase * 97 + i, 7) * 16),
      alpha: 0.22 * Math.sin(Math.PI * life),
    });
  }
  return streaks;
}

// ---------------------------------------------------------------------------
// Vulture
// ---------------------------------------------------------------------------

// A vulture placed on the ground (no y) circles this high above it; one placed
// in the air circles round its anchor.
export const VULTURE_HEIGHT = 170;
// The circle it flies, seen from the side: an ellipse this wide and this tall.
export const VULTURE_ORBIT = { x: 80, y: 18 };
const VULTURE_PERIOD = 11;

/**
 * Where a circling vulture is at `time`, from the centre of its circle: its
 * offset, which way it faces, and whether it is banking at either end of the
 * turn, where it is seen head-on. `phase` staggers vultures.
 */
export function vultureOrbit(time, phase = 0) {
  // Still (editor, thumbnails, reduced motion): soaring right over its anchor.
  if (!(time > 0)) return { dx: 0, dy: 0, dir: 1, banking: false, flap: false };
  const angle = (time / VULTURE_PERIOD + phase) * Math.PI * 2;
  const dx = Math.cos(angle) * VULTURE_ORBIT.x;
  // Lower and nearer on the front of the circle.
  const dy = Math.sin(angle) * VULTURE_ORBIT.y;
  const heading = -Math.sin(angle);
  return {
    dx,
    dy,
    dir: heading < 0 ? -1 : 1,
    banking: Math.abs(heading) < 0.3,
    // A slow flap now and then; mostly it soars.
    flap: time > 0 && (time + phase * 13) % 7 < 0.6 ? Math.floor(time * 8) % 2 === 0 : false,
  };
}

/**
 * A vulture soaring side-on centred on (0, 0), facing right, its long wings
 * held up in a shallow V. `flap` drops them for a wingbeat.
 */
export function drawVultureSoaring(tools, flap = false) {
  const c = VULTURE;
  if (flap) {
    rects(tools, [
      [-12, -2, 10, 4, c.base],
      [-20, 2, 10, 2, c.base],
      [-22, 4, 6, 2, c.silver],
      [-14, 2, 4, 2, c.silver],
      [2, -2, 10, 4, c.mid],
      [10, 2, 10, 2, c.mid],
      [16, 4, 6, 2, c.silver],
      [10, 4, 4, 2, c.silver],
    ]);
  } else {
    rects(tools, [
      // Far wing, raised and in shade.
      [-10, -4, 8, 2, c.base],
      [-18, -6, 10, 2, c.base],
      [-24, -8, 8, 2, c.dark],
      [-26, -10, 4, 2, c.dark],
      [-22, -6, 4, 2, c.silver],
      [-14, -4, 4, 2, c.silver],
      // Near wing, raised, its silver flight feathers catching the sun.
      [2, -4, 8, 2, c.mid],
      [8, -6, 10, 2, c.mid],
      [16, -8, 8, 2, c.mid],
      [22, -10, 4, 2, c.base],
      [12, -4, 6, 2, c.silver],
      [18, -6, 4, 2, c.silver],
    ]);
  }
  rects(tools, [
    // Body and tail.
    [-8, -2, 14, 4, c.base],
    [-8, 0, 14, 2, c.dark],
    [-14, -2, 6, 2, c.base],
    [-16, 0, 6, 2, c.dark],
    // Bare red head and pale beak.
    [6, -4, 4, 4, c.head],
    [6, -2, 2, 2, RUST.base],
    [10, -2, 2, 2, c.beak],
  ]);
}

/** A vulture banking through the end of its turn, seen head-on, centred on (0, 0). */
export function drawVultureBanking(tools) {
  const c = VULTURE;
  rects(tools, [
    [-24, -8, 6, 2, c.dark],
    [-20, -6, 8, 2, c.base],
    [-14, -4, 10, 2, c.base],
    [-20, -4, 4, 2, c.silver],
    [4, -4, 10, 2, c.mid],
    [12, -6, 8, 2, c.mid],
    [18, -8, 6, 2, c.base],
    [16, -4, 4, 2, c.silver],
    [-4, -4, 8, 6, c.base],
    [-4, 0, 8, 2, c.dark],
    [-2, -8, 4, 4, c.head],
    [-2, -4, 4, 2, RUST.base],
    [0, -6, 2, 2, c.beak],
  ]);
}
