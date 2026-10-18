// @ts-check
// Danish countryside props: Dannebrog flying from a white garden flagpole,
// streaming out downwind and rippling in the wind. Like every prop it sits on
// the 2-unit art grid, has no outlines and is lit from the right. It is drawn
// live, its pole running down to the ground; `downwind` is the direction the
// wind blows in the prop's own frame (-1 left, 1 right), so a flipped flag
// still flies the right way.

import { STEEL } from "./city-props.js";
import { HUT_LIGHT } from "./mountain-props.js";

const WHITE = { dark: "#b5bcae", base: "#f4e9d1", light: "#fffdf4" };
const YELLOW = { dark: "#d9953a", base: "#f1b95d", light: "#ffe39a" };
/** Dannebrog's red. */
const RED = { dark: "#a8322a", base: "#d63b2c", light: "#e8755b" };
const BLADES = { dark: "#477158", base: "#58784d", light: "#618b66" };

const snap = (value) => Math.round(value / 2) * 2;

// ------------------------------------------------------------------ flagpole

/**
 * The flagpole's height, about 6.3 m, and the flag's size in 2-unit cells,
 * about 1.5 × 1 m: the size of flag a 6 m garden pole flies.
 */
export const FLAGPOLE = { top: -170, columns: 20, rows: 14 };
// Dannebrog's white cross: the columns and rows it runs along.
const CROSS = { columns: [6, 7], rows: [6, 7] };

/**
 * How far each column of the flag lifts or drops as it ripples (0 at the
 * pole), at `time` in a `wind` of 0…1: lazily in a breeze, snapping fast and
 * hard in a gale. Still at time 0.
 */
export function flagRipple(time, wind, phase, column) {
  if (!time) return 0;
  return snap(Math.sin(time * (2 + wind * 6) - column * 0.35 + phase * Math.PI * 2) * Math.min(column, 8) * (0.1 + wind * 0.45));
}

/**
 * How far a flag's column hangs below the pole's top, `column` cells out
 * from it: a flag droops in still air, more the further out, and stands
 * straight out in a gale.
 */
export function flagDroop(wind, column) {
  return snap(column * 1.6 * (1 - Math.min(1, Math.max(0, wind))) ** 2);
}

/**
 * Dannebrog on a white garden flagpole: the pole down to the ground, its gilt
 * knob, the halyard tied off at a cleat, and the flag flying out `downwind`
 * (-1 left, 1 right) from the top, its cross towards the pole, rippling
 * with `time` and `wind`.
 */
export function drawFlagpole({ pixelRect }, groundOffset, time = 0, wind = 0.25, phase = 0, downwind = -1) {
  const ground = snap(groundOffset(0));
  const { top, columns, rows } = FLAGPOLE;
  pixelRect(-2, top, 2, ground - top, WHITE.dark, 2);
  pixelRect(0, top, 2, ground - top, WHITE.light, 2);
  // The knob.
  pixelRect(-4, top - 6, 6, 6, YELLOW.base, 2);
  pixelRect(-4, top - 6, 2, 6, YELLOW.dark, 2);
  pixelRect(0, top - 6, 2, 2, YELLOW.light, 2);
  // The halyard, and the cleat it's tied off on.
  pixelRect(2, top + 2, 2, -top - 40, WHITE.base, 2);
  pixelRect(2, -38, 4, 2, STEEL.base, 2);
  pixelRect(2, -40, 2, 2, STEEL.light, 2);
  // A little bed of grass round its foot.
  pixelRect(-6, ground - 2, 12, 2, BLADES.dark, 2);
  pixelRect(-4, ground - 4, 2, 2, BLADES.base, 2);
  pixelRect(4, ground - 4, 2, 2, BLADES.light, 2);
  // The flag.
  const hoist = downwind < 0 ? -2 : 2;
  for (let column = 0; column < columns; column++) {
    const cx = downwind < 0 ? hoist - (column + 1) * 2 : hoist + column * 2;
    const cy = top + 2 + flagDroop(wind, column) + flagRipple(time, wind, phase, column);
    const lift = flagRipple(time, wind, phase, column + 1) - flagRipple(time, wind, phase, column);
    for (let row = 0; row < rows; row++) {
      const white = CROSS.columns.includes(column) || CROSS.rows.includes(row);
      // Folds facing up catch the light, folds facing down are in shade.
      const shade = row === rows - 1 || lift > 0, lit = row === 0 || lift < 0;
      const tone = white
        ? shade ? WHITE.dark : lit ? WHITE.light : WHITE.base
        : shade ? RED.dark : lit ? RED.light : RED.base;
      pixelRect(cx, cy + row * 2, 2, 2, tone, 2);
    }
  }
}

// ------------------------------------------------------------------ windmill

/**
 * A Danish windmill (a "hollandsk mølle"): where its sails turn, how long
 * they are, and where the sprite hands over to the base that follows the
 * ground. About 9 m to the hub and 240 to the tip of a sail at the top, a
 * tall structure drawn tall enough not to look like a toy (PROPS_GUIDE.md).
 */
export const MILL = { hub: { x: 0, y: -158 }, sail: 82, bodyBottom: -10 };
const MILL_WALL = { shade: "#b5bcae", base: "#f4e9d1", light: "#fffdf4", line: "#e8e5d9" };
const MILL_WOOD = { dark: "#4d3f2f", base: "#66543f", light: "#856d4f", tip: "#aa8a60" };
const MILL_CAP = { dark: "#3a403d", base: "#4a524d", light: "#5b645e" };
const MILL_SAIL = { stock: "#4d3f2f", frame: "#f4e9d1", bar: "#b5bcae" };
const MILL_INK = "#182321";

/**
 * The mill's tower, without its sails: a whitewashed brick base with a door,
 * a wooden gallery with a railing round it, a dark shingled octagonal tower
 * narrowing upward with a window, and a boat-shaped tarred cap. Lit from the
 * right: the tower's left face is in shade, its right face lit. Down to
 * MILL.bodyBottom; the base below it follows the ground (drawMillBase).
 */
export function drawMillTower({ pixelRect }) {
  // Whitewashed base, slightly narrowing upward, with faint courses.
  for (let y = -40; y < MILL.bodyBottom; y += 2) {
    const half = 32 + Math.round((y + 40) / 15) * 2;
    pixelRect(-half, y, half * 2, 2, (y + 40) % 8 === 6 ? MILL_WALL.line : MILL_WALL.base, 2);
    pixelRect(-half, y, 4, 2, MILL_WALL.shade, 2);
    pixelRect(half - 2, y, 2, 2, MILL_WALL.light, 2);
  }
  // An arched door and a small window.
  pixelRect(-8, -32, 14, 22, MILL_WOOD.dark, 2);
  pixelRect(-6, -34, 10, 2, MILL_WOOD.dark, 2);
  for (const x of [-6, -2, 2]) pixelRect(x, -30, 2, 20, MILL_WOOD.base, 2);
  pixelRect(16, -32, 6, 6, MILL_INK, 2);
  pixelRect(16, -32, 6, 2, MILL_WALL.shade, 2);
  // The shingled tower: three faces of the octagon, narrowing upward, with a
  // darker course every few shingles.
  const towerBottom = -42, towerTop = -146;
  for (let y = towerTop; y < towerBottom; y += 2) {
    const t = (y - towerTop) / (towerBottom - towerTop);
    const half = Math.round((16 + 12 * t) / 2) * 2;
    const inner = Math.round((half * 0.45) / 2) * 2;
    const course = (y - towerTop) % 8 === 6;
    pixelRect(-half, y, half - inner, 2, course ? MILL_INK : MILL_WOOD.dark, 2);
    pixelRect(-inner, y, inner * 2, 2, course ? MILL_WOOD.dark : MILL_WOOD.base, 2);
    pixelRect(inner, y, half - inner, 2, course ? MILL_WOOD.base : MILL_WOOD.light, 2);
  }
  // A window high on the tower, framed in white.
  pixelRect(-6, -116, 10, 12, MILL_WALL.base, 2);
  pixelRect(-4, -114, 6, 8, MILL_INK, 2);
  pixelRect(-4, -110, 6, 2, MILL_WALL.shade, 2);
  // The gallery: a deck round the tower, and its railing.
  pixelRect(-46, -44, 92, 4, MILL_WOOD.light, 2);
  pixelRect(-46, -44, 92, 2, MILL_WOOD.tip, 2);
  pixelRect(-46, -40, 92, 2, MILL_WOOD.dark, 2);
  for (let x = -46; x <= 44; x += 10) pixelRect(x, -54, 2, 10, x < 0 ? MILL_WOOD.base : MILL_WOOD.light, 2);
  pixelRect(-46, -56, 92, 2, MILL_WOOD.tip, 2);
  // The cap: boat-shaped and tarred, with a finial on top.
  for (let y = -168; y < towerTop; y += 2) {
    const t = (y + 168) / (towerTop + 168);
    const half = Math.max(2, Math.round((22 * Math.sqrt(t)) / 2) * 2);
    pixelRect(-half, y, half * 2, 2, MILL_CAP.base, 2);
    pixelRect(-half, y, Math.max(2, half / 2), 2, MILL_CAP.dark, 2);
    pixelRect(half - 4, y, 2, 2, MILL_CAP.light, 2);
  }
  pixelRect(-24, towerTop, 48, 2, MILL_CAP.dark, 2);
  pixelRect(-2, -172, 4, 4, MILL_CAP.light, 2);
}

/** The base below the sprite, down to the ground under each column. */
export function drawMillBase({ pixelRect }, groundOffset) {
  for (let x = -32; x < 32; x += 2) {
    const ground = Math.round(groundOffset(x + 1) / 2) * 2;
    if (ground <= MILL.bodyBottom) continue;
    const color = x < -28 ? MILL_WALL.shade : x >= 30 ? MILL_WALL.light : MILL_WALL.base;
    pixelRect(x, MILL.bodyBottom, 2, ground - MILL.bodyBottom, color, 2);
  }
}

/**
 * How far the sails have turned at `time`, in radians, anticlockwise as
 * Danish mills turn: slowly, a few turns a minute in a breeze and about a
 * turn every four seconds in a gale (`wind` 0…1), easing with the gusts.
 * Still at time 0, at its own angle (`phase` 0…1) so mills differ.
 */
export function millAngle(time, wind = 0.25, phase = 0) {
  const start = phase * Math.PI * 2;
  if (!(time > 0)) return start;
  const w = Math.max(0, Math.min(1, Number(wind) || 0));
  const speed = 0.08 + w * 1.5;
  // The gust term's rate of change never exceeds the base speed.
  const gust = speed * 0.3 * Math.sin(time * 0.5 + phase * 9);
  return start - (time * speed + gust);
}

/**
 * The four sails turned to `angle`, round the hub at MILL.hub: each a stock
 * with a white lattice frame on its trailing side, and the hub over them.
 */
export function drawMillSails({ pixelRect, pixelPath, drawPixelDisc }, angle) {
  const { x: hx, y: hy } = MILL.hub;
  for (let i = 0; i < 4; i++) {
    const a = angle + (i * Math.PI) / 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    // The frame trails behind the stock as the sails turn anticlockwise.
    const vx = uy, vy = -ux;
    const at = (r, side = 0) => [hx + ux * r + vx * side, hy + uy * r + vy * side];
    const inner = 18, outer = MILL.sail - 2, width = 12;
    // Cross bars, the outer rail and the ends of the frame.
    for (let r = inner; r <= outer; r += 8) pixelPath([at(r), at(r, width)], MILL_SAIL.bar, 1, 2);
    pixelPath([at(inner, width), at(outer, width)], MILL_SAIL.frame, 1, 2);
    pixelPath([at(outer), at(outer, width)], MILL_SAIL.frame, 1, 2);
    // The stock, from the hub to the tip.
    pixelPath([at(4), at(MILL.sail)], MILL_SAIL.stock, 2, 2);
  }
  drawPixelDisc(hx, hy, 5, MILL_CAP.dark, 2);
  drawPixelDisc(hx + 1, hy - 1, 2, MILL_CAP.light, 2);
}

// ----------------------------------------------------------------- farmhouse

/**
 * A Danish half-timbered farmhouse (a "bindingsværk" længe), long side on:
 * the walls' half-width, the thatch's eaves and ridge, where the sprite hands
 * over to the tarred plinth that follows the ground, and the top of the
 * chimney, where its smoke leaves. About 8.5 m long, with a door and windows
 * at true scale under a steep, hipped thatched roof.
 */
export const FARMHOUSE = { half: 114, eaves: -66, ridge: -148, bodyBottom: -14, chimney: { x: 20, y: -174 } };
/** The windows' frames, in the bays between the posts; the glass is inset 2. */
export const FARMHOUSE_WINDOWS = [-82, -54, 2, 30, 58].map((left) => ({ left, top: -58, width: 24, height: 26 }));
/** The middle of window `index`, where its lamplight comes from. */
export const farmhouseWindowCentre = (index) => {
  const { left, top, width, height } = FARMHOUSE_WINDOWS[index];
  return [left + width / 2, top + height / 2];
};
export const FARMHOUSE_BOUNDS = [-128, FARMHOUSE.chimney.y - 2, 128, FARMHOUSE.bodyBottom];

const LIME = { shade: "#b5bcae", base: "#f4e9d1", light: "#fffdf4" };
// Yellow ochre, the other Danish farmhouse wash.
const OCHRE = { shade: "#d9953a", base: "#f1b95d", light: "#ffe39a" };
const TIMBER = { dark: "#4d3f2f", light: "#66543f" };
const THATCH = { dark: "#806244", base: "#aa8a60", light: "#c39664", streak: "#856d4f" };
const DOOR = { dark: "#477158", base: "#568061", light: "#618b66" };
const TAR = MILL_CAP;
const FARM_GLASS = { dark: "#3f6f78", base: "#568f98" };
const GRANITE = { dark: "#697872", base: "#8b978c", light: "#a2ab9e" };

/**
 * Which of the farmhouse's windows have a lamp lit behind them after dark,
 * for a house at world `x`: most of them, never fewer than two, the same
 * ones every night.
 */
export function farmhouseLitWindows(x) {
  const lit = FARMHOUSE_WINDOWS.map((_, index) => {
    const s = Math.sin(x * 12.9898 + index * 78.233) * 43758.5453;
    return s - Math.floor(s) > 0.3;
  });
  if (lit.filter(Boolean).length < 2) lit[1] = lit[3] = true;
  return lit;
}

/**
 * The farmhouse, down to FARMHOUSE.bodyBottom: dark timber framing with
 * limewashed walls (`ochre` 0) or yellow-ochre ones (`ochre` 1), five
 * white-framed windows (their glass by drawFarmhouseWindowGlass), a green
 * plank door, braces in the end bays, and a thick hipped thatched roof with
 * crossed ridge poles and a whitewashed chimney. The plinth is live.
 */
export function drawFarmhouse({ pixelRect, pixelPath }, ochre = 0) {
  const { half, eaves, ridge, bodyBottom, chimney } = FARMHOUSE;
  const wall = ochre ? OCHRE : LIME;
  const top = eaves;
  // The wash, in shade under the eaves and along the left end, lit at the right.
  pixelRect(-half, top, half * 2, bodyBottom - top, wall.base, 2);
  pixelRect(-half, top, half * 2, 4, wall.shade, 2);
  pixelRect(half - 2, top + 4, 2, bodyBottom - top - 4, wall.light, 2);
  // Posts every bay, lit on their right edge.
  for (let x = -half; x < half; x += 28) {
    pixelRect(x, top, 4, bodyBottom - top, TIMBER.dark, 2);
    pixelRect(x + 2, top + 4, 2, bodyBottom - top - 4, TIMBER.light, 2);
  }
  // The sill beam, and a rail across each bay with a shadow under it: a mid
  // rail in plain bays, a lintel and a sill round each window.
  const rail = (left, y) => {
    pixelRect(left, y, 24, 4, TIMBER.dark, 2);
    pixelRect(left, y, 24, 2, TIMBER.light, 2);
    pixelRect(left, y + 4, 24, 2, wall.shade, 2);
  };
  pixelRect(-half, bodyBottom - 4, half * 2, 4, TIMBER.dark, 2);
  pixelRect(-half, bodyBottom - 4, half * 2, 2, TIMBER.light, 2);
  const windows = new Set(FARMHOUSE_WINDOWS.map((w) => w.left));
  for (let left = -half + 4; left < half; left += 28) {
    if (left === -26) continue;
    if (windows.has(left)) {
      rail(left, -62);
      rail(left, -32);
    } else rail(left, -44);
  }
  // Braces in the end bays, from the sill up to the posts at the corners.
  pixelPath([[-108, bodyBottom - 6], [-90, -60]], TIMBER.dark, 2, 2);
  pixelPath([[108, bodyBottom - 6], [90, -60]], TIMBER.dark, 2, 2);
  // White window frames with their glazing bars.
  for (const [index, w] of FARMHOUSE_WINDOWS.entries()) {
    pixelRect(w.left, w.top, w.width, w.height, LIME.light, 2);
    pixelRect(w.left, w.top, 2, w.height, LIME.shade, 2);
    drawFarmhouseWindowGlass({ pixelRect }, index, 0);
  }
  // The door: green planks with a small window, ledges and a brass handle.
  const door = { left: -26, top: -62, width: 24 };
  pixelRect(door.left, door.top, door.width, bodyBottom - door.top, DOOR.base, 2);
  for (let x = door.left + 4; x < door.left + door.width; x += 4) pixelRect(x, door.top, 2, bodyBottom - door.top, DOOR.light, 2);
  pixelRect(door.left, door.top, 2, bodyBottom - door.top, DOOR.dark, 2);
  pixelRect(door.left, -36, door.width, 2, DOOR.dark, 2);
  pixelRect(door.left, -22, door.width, 2, DOOR.dark, 2);
  pixelRect(door.left + 6, door.top + 6, 12, 10, LIME.light, 2);
  pixelRect(door.left + 8, door.top + 8, 8, 6, FARM_GLASS.dark, 2);
  pixelRect(door.left + 12, door.top + 8, 2, 2, FARM_GLASS.base, 2);
  pixelRect(door.left + 18, -42, 2, 4, YELLOW.base, 2);
  pixelRect(door.left + 18, -42, 2, 2, YELLOW.light, 2);
  // The thatch: a steep slope between two hips, shaded along the left hip
  // and lit along the right, laid in courses, with the thick cut edge of the
  // straw along the eaves.
  const ridgeHalf = 72;
  for (let y = ridge; y < eaves; y += 2) {
    const reach = snap(ridgeHalf + ((y - ridge) * (128 - ridgeHalf)) / (eaves - 2 - ridge));
    for (let x = -reach; x < reach; x += 2) {
      const hip = x < -reach + 6 ? -1 : x >= reach - 6 ? 1 : 0;
      const course = (y - ridge) % 12 === 10;
      const fleck = (((x * 7 + y * 3) % 26) + 26) % 26 === 0;
      let color = hip < 0 ? THATCH.dark : hip > 0 ? THATCH.light : fleck ? THATCH.light : THATCH.base;
      if (course) color = hip > 0 ? THATCH.base : THATCH.streak;
      if (y >= eaves - 6) color = (x + 128) % 6 === 0 ? THATCH.base : THATCH.streak;
      if (y === eaves - 2) color = THATCH.dark;
      pixelRect(x, y, 2, 2, color, 2);
    }
  }
  // The ridge: a dark cap of heather, held down by crossed poles.
  pixelRect(-ridgeHalf - 2, ridge - 4, ridgeHalf * 2 + 4, 6, TIMBER.dark, 2);
  pixelRect(-ridgeHalf, ridge - 4, ridgeHalf * 2 + 2, 2, TIMBER.light, 2);
  for (let x = -ridgeHalf + 8; x <= ridgeHalf - 8; x += 16) {
    if (Math.abs(x - chimney.x) < 14) continue;
    pixelPath([[x - 4, ridge + 2], [x + 4, ridge - 10]], TIMBER.dark, 1, 2);
    pixelPath([[x + 4, ridge + 2], [x - 4, ridge - 10]], TIMBER.light, 1, 2);
  }
  // A whitewashed chimney astride the ridge, with a tarred cap.
  pixelRect(chimney.x - 6, chimney.y + 4, 12, ridge - chimney.y - 2, LIME.base, 2);
  pixelRect(chimney.x - 6, chimney.y + 4, 2, ridge - chimney.y - 2, LIME.shade, 2);
  pixelRect(chimney.x + 4, chimney.y + 4, 2, ridge - chimney.y - 2, LIME.light, 2);
  pixelRect(chimney.x - 8, chimney.y, 16, 4, TAR.base, 2);
  pixelRect(chimney.x - 8, chimney.y, 4, 4, TAR.dark, 2);
  pixelRect(chimney.x + 4, chimney.y, 4, 2, TAR.light, 2);
}

/**
 * The glass of window `index`: dark with a glint of sky by day (`lit` 0), or
 * warm lamplight after dark (`lit` > 0, a flicker 0.88…1), crossed by its
 * white glazing bars: two casements, three panes high.
 */
export function drawFarmhouseWindowGlass({ pixelRect }, index, lit = 1) {
  const w = FARMHOUSE_WINDOWS[index];
  const left = w.left + 2, top = w.top + 2, width = w.width - 4, height = w.height - 4;
  if (lit > 0) {
    pixelRect(left, top, width, height, HUT_LIGHT.glass, 2);
    pixelRect(left + 2, top + height - 6, width - 4, 4, lit < 0.95 ? HUT_LIGHT.glass : HUT_LIGHT.core, 2);
  } else {
    pixelRect(left, top, width, height, FARM_GLASS.dark, 2);
    pixelRect(left + width - 6, top, 4, 2, FARM_GLASS.base, 2);
    pixelRect(left + width - 4, top + 2, 2, 2, FARM_GLASS.base, 2);
    pixelRect(left + 2, top + 12, 2, 2, FARM_GLASS.base, 2);
  }
  // A stout middle post, and a bar across each casement.
  pixelRect(left + 8, top, 4, height, LIME.light, 2);
  pixelRect(left + 8, top, 2, height, LIME.base, 2);
  pixelRect(left, top + 6, width, 2, LIME.light, 2);
  pixelRect(left, top + 14, width, 2, LIME.light, 2);
}

/**
 * The live part, down to the ground: a tarred fieldstone plinth under the
 * walls, a granite step at the door, and hollyhocks against the end walls.
 */
export function drawFarmhouseBase({ pixelRect }, groundOffset) {
  const { half, bodyBottom } = FARMHOUSE;
  for (let x = -half - 2; x < half + 2; x += 2) {
    const ground = snap(groundOffset(x + 1));
    if (ground <= bodyBottom) continue;
    const color = x < -half + 2 ? TAR.dark : x >= half ? TAR.light : (x + 120) % 14 === 0 ? TAR.dark : TAR.base;
    pixelRect(x, bodyBottom, 2, ground - bodyBottom, color, 2);
    pixelRect(x, bodyBottom, 2, 2, x < -half + 2 ? TAR.base : TAR.light, 2);
  }
  // The step, a granite block at the threshold, down to the ground.
  for (let x = -30; x < 2; x += 2) {
    const ground = snap(groundOffset(x + 1));
    if (ground <= bodyBottom + 2) continue;
    pixelRect(x, bodyBottom + 2, 2, ground - bodyBottom - 2, x < -26 ? GRANITE.dark : x >= -2 ? GRANITE.light : GRANITE.base, 2);
    pixelRect(x, bodyBottom + 2, 2, 2, GRANITE.light, 2);
  }
  // Hollyhocks: tall stems with leaves low down and flowers up the top.
  for (const [x, height] of [[-104, 50], [-96, 58], [92, 46], [100, 38]]) {
    const ground = snap(groundOffset(x + 1));
    pixelRect(x, ground - height, 2, height, BLADES.dark, 2);
    pixelRect(x - 4, ground - 10, 4, 4, BLADES.base, 2);
    pixelRect(x + 2, ground - 16, 4, 4, BLADES.light, 2);
    for (let y = ground - height; y < ground - height / 2; y += 6) {
      pixelRect(x - 2, y, 6, 4, RED.base, 2);
      pixelRect(x + 2, y, 2, 2, RED.light, 2);
      pixelRect(x, y + 2, 2, 2, YELLOW.light, 2);
    }
  }
}
