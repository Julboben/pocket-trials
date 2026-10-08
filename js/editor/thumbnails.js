// Small pictures of each prop for the prop picker, drawn with the game art.
import { createGameArt } from "../drawing.js";

// Big enough for the crane and the dripping water, with the anchor placed so
// ceiling props (drawn upwards) and hanging ones (drawn downwards) both fit.
const SCRATCH_SIZE = 640;
const ANCHOR_X = 320;
const ANCHOR_Y = 420;
const PADDING = 2;

let scratch = null;
const cache = new Map();

/** A data URL of the prop drawn on its own and cropped to its art, or null. */
export function propThumbnail(type) {
  if (cache.has(type)) return cache.get(type);
  if (!scratch) {
    const canvas = document.createElement("canvas");
    canvas.width = SCRATCH_SIZE;
    canvas.height = SCRATCH_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    scratch = { canvas, context, art: createGameArt(context) };
  }
  const { canvas, context, art } = scratch;
  let url = null;
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, SCRATCH_SIZE, SCRATCH_SIZE);
    art.drawProp(type, ANCHOR_X, ANCHOR_Y, 1, 0, () => 0, type === "sign" ? "SIGN" : "");
    const { data } = context.getImageData(0, 0, SCRATCH_SIZE, SCRATCH_SIZE);
    let left = SCRATCH_SIZE,
      top = SCRATCH_SIZE,
      right = -1,
      bottom = -1;
    for (let y = 0; y < SCRATCH_SIZE; y++)
      for (let x = 0; x < SCRATCH_SIZE; x++) {
        if (data[(y * SCRATCH_SIZE + x) * 4 + 3] === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    if (right >= 0) {
      const width = right - left + 1;
      const height = bottom - top + 1;
      const crop = document.createElement("canvas");
      crop.width = width + PADDING * 2;
      crop.height = height + PADDING * 2;
      crop
        .getContext("2d")
        .drawImage(canvas, left, top, width, height, PADDING, PADDING, width, height);
      url = crop.toDataURL();
    }
  } catch (_) {
    url = null;
  }
  cache.set(type, url);
  return url;
}
