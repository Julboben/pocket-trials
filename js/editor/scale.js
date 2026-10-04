// Scale handles around the selected blocks and water: corners keep the
// proportions, so a circle stays a circle and a square a square, and sides
// stretch one way. Water on its own is just a rectangle, so its corners
// resize it freely.
import { scaleBlock } from "../terrain-geometry.js";
import { WATER_SIZE } from "../water.js";
import { blocks, replaceBlock, selectedBlocks } from "./blocks.js";
import { blockNodes } from "./selection.js";
import { gridSpacing } from "./snap.js";
import { HIT_REACH, editor, waters } from "./state.js";

// Screen pixels a scale handle can be grabbed from, and its distance outside
// the blocks. The box holds every point, edge and curve handle, so a pointer
// that can grab a scale handle is always out of reach of those, and a
// double-click on an edge never lands on a scale handle.
const HIT = 7;
const PAD = HIT + HIT_REACH + 1;
// Smallest width or height a scale can shrink the selection to, in world units.
const MIN_SIZE = 8;

const HANDLES = [
  [-1, -1], [0, -1], [1, -1],
  [1, 0], [1, 1], [0, 1],
  [-1, 1], [-1, 0],
];

const CURSORS = {
  "-1,-1": "nwse-resize", "1,1": "nwse-resize",
  "1,-1": "nesw-resize", "-1,1": "nesw-resize",
  "0,-1": "ns-resize", "0,1": "ns-resize",
  "-1,0": "ew-resize", "1,0": "ew-resize",
};

let active = null;

/**
 * What scale handles act on: a selection of only whole blocks and water
 * bodies, as `{ blocks, water }` index lists, or null.
 */
function targets() {
  if (editor.tool !== "select") return null;
  const kind = editor.selection?.kind;
  let found = null;
  if (kind === "block") found = { blocks: selectedBlocks(), water: [] };
  else if (kind === "water") found = { blocks: [], water: [editor.selection.index] };
  else if (
    kind === "items" &&
    editor.selection.items.every((item) => item.type === "block" || item.type === "water")
  )
    found = {
      blocks: selectedBlocks(),
      water: editor.selection.items
        .filter((item) => item.type === "water")
        .map((item) => item.index),
    };
  if (!found) return null;
  found.blocks = found.blocks.filter((index) => blocks()[index]);
  found.water = found.water.filter((index) => waters()[index]);
  return found.blocks.length || found.water.length ? found : null;
}

/**
 * The box around some blocks' points and curve handles, which contains their
 * curves, and around some water bodies.
 */
function boxOf(list, bodies = []) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const add = (x, y) => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  for (const block of list)
    for (const node of blockNodes(block))
      for (const [x, y] of [[node.x, node.y], node.in, node.out].filter(Boolean))
        add(x, y);
  for (const body of bodies) {
    add(body.x, body.y);
    add(body.x + body.width, body.y + body.depth);
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

/**
 * One side of a water body scaled about a pivot, kept at least `min` long by
 * holding the end nearer the pivot.
 */
function scaleSpan(start, size, pivot, factor, min, side, alt) {
  let a = pivot + (start - pivot) * factor,
    b = pivot + (start + size - pivot) * factor;
  if (b - a < min) {
    if (alt) [a, b] = [(a + b - min) / 2, (a + b + min) / 2];
    else if (side < 0) a = b - min;
    else b = a + min;
  }
  return [a, b - a];
}

/** The selection's box and its eight handles, in world units, or null. */
export function scaleFrame() {
  const found = targets();
  if (!found) return null;
  const box = boxOf(
    found.blocks.map((index) => blocks()[index]),
    found.water.map((index) => waters()[index]),
  );
  if (!box) return null;
  const pad = PAD / editor.zoom;
  const frame = {
    left: box.left - pad,
    top: box.top - pad,
    right: box.right + pad,
    bottom: box.bottom + pad,
  };
  const mid = (a, b, side) => (side < 0 ? a : side > 0 ? b : (a + b) / 2);
  return {
    frame,
    handles: HANDLES.map(([hx, hy]) => ({
      hx,
      hy,
      x: mid(frame.left, frame.right, hx),
      y: mid(frame.top, frame.bottom, hy),
    })),
  };
}

/** The scale handle under a world point, or null. */
export function scaleHandleAt(point) {
  const shown = scaleFrame();
  if (!shown) return null;
  const reach = HIT / editor.zoom;
  return (
    shown.handles.find(
      (handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= reach,
    ) || null
  );
}

export function scaleCursor(handle) {
  return CURSORS[`${handle.hx},${handle.hy}`];
}

export const scaling = () => active !== null;

/** Start scaling from a handle; `before` becomes the undo step once something changes. */
export function startScale(handle, point, before) {
  const found = targets();
  if (!found) return false;
  const indices = found.blocks;
  const originals = indices.map((index) => blocks()[index]);
  const waterIndices = found.water;
  const waterOriginals = waterIndices.map((index) => ({ ...waters()[index] }));
  const box = boxOf(originals, waterOriginals);
  if (!box) return false;
  active = {
    handle,
    start: point,
    indices,
    originals,
    waterIndices,
    waterOriginals,
    box,
    before,
    moved: false,
  };
  return true;
}

/**
 * Scale to where the pointer is. Alt scales about the centre, and Shift puts
 * the dragged side on the grid. Returns the undo snapshot the first time
 * anything changes, so the caller can push it.
 */
export function updateScale(point, { alt = false, shift = false } = {}) {
  if (!active) return null;
  const { handle, start, indices, originals, waterIndices, waterOriginals, box } = active;
  const { hx, hy } = handle;
  const width = box.right - box.left,
    height = box.bottom - box.top;
  const cx = (box.left + box.right) / 2,
    cy = (box.top + box.bottom) / 2;
  // Where the dragged sides of the box have moved to.
  let x = (hx > 0 ? box.right : box.left) + point.x - start.x;
  let y = (hy > 0 ? box.bottom : box.top) + point.y - start.y;
  if (shift) {
    const g = gridSpacing(editor.zoom);
    x = Math.round(x / g) * g;
    y = Math.round(y / g) * g;
  }
  const px = alt ? cx : hx > 0 ? box.left : box.right;
  const py = alt ? cy : hy > 0 ? box.top : box.bottom;
  const factor = (to, pivot, from, size) =>
    Math.max(MIN_SIZE / Math.max(size, 1e-6), (to - pivot) / (from - pivot || 1));
  let sx = hx && width > 1e-6 ? factor(x, px, hx > 0 ? box.right : box.left, width) : 1;
  let sy = hy && height > 1e-6 ? factor(y, py, hy > 0 ? box.bottom : box.top, height) : 1;
  // Corners keep the proportions of blocks: the side dragged further decides.
  if (hx && hy && indices.length) sx = sy = Math.max(sx, sy);
  indices.forEach((index, i) =>
    replaceBlock(index, scaleBlock(originals[i], px, py, sx, sy)),
  );
  waterIndices.forEach((index, i) => {
    const body = waterOriginals[i];
    const [x, width] = scaleSpan(body.x, body.width, px, sx, WATER_SIZE.minWidth, hx, alt);
    const [y, depth] = scaleSpan(body.y, body.depth, py, sy, WATER_SIZE.minDepth, hy, alt);
    waters()[index] = { ...waters()[index], x, y, width, depth };
  });
  if (active.moved) return null;
  active.moved = true;
  return active.before;
}

export function endScale() {
  active = null;
}
