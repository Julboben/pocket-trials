// @ts-check
// The nisse: a Danish gnome hidden off the main line of a trail, one at most
// per trail. Like an apple it is taken when the player's hitbox touches the
// drawn sprite, inside the ride simulation, so ghosts and replays find it too;
// unlike an apple it is optional, so it never counts towards the finish and
// is never pointed out. Finding one is remembered per trail in the save (see
// cleanNisseFinds). Shared by the game, the editor and the server, so it stays
// free of the DOM.
import { ART, playerTouch } from "./player-shape.js";
import { spriteShape } from "./apple.js";

// About 20 × 24 world units, standing on its anchor and facing right: a red
// pointed hat pulled down to its nose, a white beard and a grey tunic. Lit
// from the right like every prop.
export const NISSE_SPRITE = [
  ".....H....",
  "....HHh...",
  "....RHHh..",
  "...RHHHh..",
  "..RHHHHHh.",
  ".RRHHHHHHh",
  "..dSSSSSN.",
  "..CBBBBBB.",
  ".gCBBBBBGG",
  ".gGCBBBGG.",
  "..gGGGGG..",
  "..KK..KK..",
];
export const NISSE_COLORS = {
  H: "#d63b2c", h: "#e8755b", R: "#a8322a",
  S: "#f0bb93", d: "#d99a72", N: "#e8755b",
  B: "#f4e9d1", C: "#b5bcae",
  G: "#697872", g: "#4a524d",
  K: "#4d3f2f",
};
/**
 * How far above the ground a nisse with no y of its own stands: on top of the
 * terrain's rim, which rises this far above its surface.
 */
export const NISSE_GROUND_LIFT = 4;
// The sprite's top-left corner relative to the nisse's anchor, where its
// feet stand, and its reach from the anchor.
const SPRITE_LEFT = -10;
const SPRITE_TOP = -24;
const REACH = 28;

/** The drawn nisse, as a shape the player can touch. */
const nisseShape = spriteShape(NISSE_SPRITE, SPRITE_LEFT, SPRITE_TOP, REACH);

/**
 * Whether the player touches the nisse.
 * @param {{ x: number, y: number }} nisse where its feet stand
 * @param {import("./player-shape.js").Player} player
 */
export function playerTouchesNisse(nisse, player) {
  return playerTouch(nisseShape(nisse), player) !== null;
}

/**
 * How far the tip of the nisse's hat flops at `seconds` on the scene clock:
 * 0 most of the time, and now and then -2 for a moment, as if it turned its
 * head. Each nisse flops at its own time; still at time 0.
 */
export function nisseWiggle(nisse, seconds) {
  if (!seconds) return 0;
  const phase = (((seconds + nisse.x * 0.017) % 4.2) + 4.2) % 4.2;
  return phase < 0.35 ? -2 : 0;
}

/**
 * The nisse with its feet at (x, y), snapped to the art grid, its hat tip
 * flopped by `wiggle` (see nisseWiggle). The tip is decoration only: the
 * hitbox is always the still sprite.
 */
export function drawNisse({ pixelRect }, x, y, wiggle = 0) {
  const left = Math.round(x / ART) * ART + SPRITE_LEFT;
  const top = Math.round(y / ART) * ART + SPRITE_TOP;
  NISSE_SPRITE.forEach((line, row) => {
    for (let column = 0; column < line.length; column++) {
      const key = line[column];
      if (key === ".") continue;
      const shift = row === 0 ? wiggle : 0;
      pixelRect(left + column * ART + shift, top + row * ART, ART, ART, NISSE_COLORS[key], ART);
    }
  });
}

// ------------------------------------------------------------- finds in a save

// Where a nisse has been found, keyed by trail (see nisseKey in state.js):
// an official or bonus trail by its id, so editing its terrain keeps the
// find, and a custom trail by its hash. Only official and bonus finds are
// kept in the cloud save.
const RANKED_KEY_RE = /^(official|bonus):[a-z0-9][a-z0-9-]{0,55}$/;
const CUSTOM_KEY_RE = /^trail:[0-9a-f]{8}$/;
const MAX_FINDS = 500;
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A save's nisse finds, trail key -> time found, with anything else dropped.
 * With `rankedOnly`, as the server keeps them, custom trails' finds go too.
 */
export function cleanNisseFinds(value, rankedOnly = false) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, time]) => (RANKED_KEY_RE.test(key) || (!rankedOnly && CUSTOM_KEY_RE.test(key)))
      && Number.isFinite(Number(time)) && Number(time) > 0)
    .slice(0, MAX_FINDS)
    .map(([key, time]) => [key, Number(time)]));
}

/** Both copies' finds, each at the earlier time: neither device loses one. */
export function mergeNisseFinds(a, b) {
  const merged = cleanNisseFinds(a);
  for (const [key, time] of Object.entries(cleanNisseFinds(b))) merged[key] = Math.min(time, merged[key] ?? Infinity);
  return cleanNisseFinds(merged);
}
