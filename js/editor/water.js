// Water bodies in the editor: drawing them with the Water tool, and where
// their handle sits. A body is grabbed and moved by the middle of its surface.
import { WATER_SIZE, WATER_WIPEOUT_DEPTH, deepWater } from "../water.js";
import { editor, waters } from "./state.js";
import { toolSettings } from "./tools.js";

/** Screen pixels a Water drag must cover to draw a body rather than click one in. */
const CLICK_SIZE = 6;

/** The handle of a body: the middle of its surface. */
export function waterHandle(body) {
  return [body.x + body.width / 2, body.y];
}

/** Move a body so its handle lands on (x, y). */
export function moveWaterTo(body, x, y) {
  body.x = x - body.width / 2;
  body.y = y;
}

const tidy = (value) => Math.round(value * 10) / 10;

/** A width or depth for a body, clamped to the smallest allowed. */
export function waterSize(value, key) {
  const min = key === "width" ? WATER_SIZE.minWidth : WATER_SIZE.minDepth;
  const number = Number(value);
  return tidy(Math.max(min, Number.isFinite(number) ? number : WATER_SIZE[key]));
}

/**
 * Add a body from a finished Water drag: the dragged rectangle, or for a
 * click, a body of the tool's size whose surface is centred on the click.
 * Selects the new body.
 */
export function commitWater(shape) {
  const [sx, sy] = shape.points[0];
  const [ex, ey] = shape.points[2];
  const clicked =
    Math.abs(ex - sx) * editor.zoom < CLICK_SIZE &&
    Math.abs(ey - sy) * editor.zoom < CLICK_SIZE;
  const width = clicked
    ? waterSize(toolSettings.water.width, "width")
    : waterSize(Math.abs(ex - sx), "width");
  const depth = clicked
    ? waterSize(toolSettings.water.depth, "depth")
    : waterSize(Math.abs(ey - sy), "depth");
  const body = clicked
    ? { x: tidy(sx - width / 2), y: tidy(sy), width, depth }
    : { x: tidy(Math.min(sx, ex)), y: tidy(Math.min(sy, ey)), width, depth };
  waters().push(body);
  editor.selection = { kind: "water", index: waters().length - 1 };
  return body;
}

/** What a body of this depth does to a rider, for the inspector and tool panel. */
export function waterDepthHint(depth) {
  return deepWater(depth)
    ? `Deep: deeper than ${WATER_WIPEOUT_DEPTH}, so riding in wipes the rider out, who floats.`
    : `Shallow: up to ${WATER_WIPEOUT_DEPTH} deep, a ford the bike can ride through, slowed down.`;
}
