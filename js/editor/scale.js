// Scale handles around the selected blocks: corners keep the proportions, so a
// circle stays a circle and a square a square, and sides stretch one way.
import { scaleBlock } from "../terrain-geometry.js";
import { blocks, replaceBlock, selectedBlocks } from "./blocks.js";
import { blockNodes } from "./selection.js";
import { gridSpacing } from "./snap.js";
import { editor } from "./state.js";

// Screen pixels between the blocks and their handles, so a corner point and a
// corner handle can both be grabbed.
const PAD = 12;
const HIT = 7;
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

/** The blocks that scale handles act on: a selection of only whole blocks. */
function targets() {
  if (editor.tool !== "select") return [];
  const kind = editor.selection?.kind;
  if (kind === "block") return selectedBlocks().filter((index) => blocks()[index]);
  if (kind !== "items" || editor.selection.items.some((item) => item.type !== "block"))
    return [];
  return selectedBlocks().filter((index) => blocks()[index]);
}

/** The box around some blocks' points and curve handles, which contains their curves. */
function boxOf(list) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const block of list)
    for (const node of blockNodes(block))
      for (const [x, y] of [[node.x, node.y], node.in, node.out].filter(Boolean)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

/** The selection's box and its eight handles, in world units, or null. */
export function scaleFrame() {
  const indices = targets();
  if (!indices.length) return null;
  const box = boxOf(indices.map((index) => blocks()[index]));
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
  const indices = targets();
  const originals = indices.map((index) => blocks()[index]);
  const box = boxOf(originals);
  if (!box) return false;
  active = { handle, start: point, indices, originals, box, before, moved: false };
  return true;
}

/**
 * Scale to where the pointer is. Alt scales about the centre, and Shift puts
 * the dragged side on the grid. Returns the undo snapshot the first time
 * anything changes, so the caller can push it.
 */
export function updateScale(point, { alt = false, shift = false } = {}) {
  if (!active) return null;
  const { handle, start, indices, originals, box } = active;
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
  // Corners keep the proportions: the side dragged further decides.
  if (hx && hy) sx = sy = Math.max(sx, sy);
  indices.forEach((index, i) =>
    replaceBlock(index, scaleBlock(originals[i], px, py, sx, sy)),
  );
  if (active.moved) return null;
  active.moved = true;
  return active.before;
}

export function endScale() {
  active = null;
}
