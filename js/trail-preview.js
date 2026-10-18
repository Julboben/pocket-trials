// Where a trail's thumbnail in the trail list looks, and the ground sampling
// it is worked out from. No drawing here, so the editor can frame the
// thumbnail without loading the game's renderer.
import { terrainAt, terrainSurfacesAt } from './terrain.js';

/** The topmost surface height at `x`, or null over a gap. */
export function surfaceY(trail, x) {
  const ground = terrainAt(trail, x);
  return ground?.solid === false || !Number.isFinite(ground?.y) ? null : ground.y;
}

/**
 * A trail's thumbnail in the trail list: a fixed view of `width` × `height`
 * world units with no rider, the same zoom on every trail.
 */
export const TRAIL_PREVIEW = { width: 576, height: 192, scale: 2 };

/**
 * The middle of a trail's thumbnail: where its author framed it in the
 * editor (`trail.preview`), else its most eventful stretch, with the ground a
 * little below the middle.
 * @returns {{ x: number, y: number }}
 */
export function trailPreviewCentre(trail) {
  if (trail.preview) return { x: trail.preview.x, y: trail.preview.y };
  const highlight = findHighlight(trail, TRAIL_PREVIEW.width);
  return { x: highlight.x, y: highlight.y - TRAIL_PREVIEW.height * 0.05 };
}

/** The world area a trail's thumbnail shows. */
export function trailPreviewFrame(trail) {
  const { x, y } = trailPreviewCentre(trail);
  const { width, height } = TRAIL_PREVIEW;
  return { left: x - width / 2, top: y - height / 2, width, height };
}

/**
 * The most eventful `width`-wide stretch of a trail between its start and
 * finish: the most climbing and dropping, with gaps counting extra. Stretches
 * showing the start are passed over, as the start looks alike on every trail.
 * @returns {{ x: number, y: number }} the stretch's centre, at its median ground height
 */
export function findHighlight(trail, width) {
  const step = 8, points = surfaceProfile(trail, step);
  const span = Math.max(1, Math.round(width / step));
  let best = null;
  for (let first = 0; first + span <= points.length; first += 2) {
    const window = points.slice(first, first + span);
    let score = 0, previous = null;
    const heights = [];
    for (const { y } of window) {
      if (y === null) { score += 6; previous = null; continue; }
      if (previous !== null) score += Math.abs(y - previous);
      previous = y; heights.push(y);
    }
    if (!heights.length) continue;
    const x = (window[0].x + window[window.length - 1].x) / 2;
    if (Math.abs(x - trail.start.x) < width * .6) score *= .25;
    heights.sort((a, b) => a - b);
    if (!best || score > best.score) best = { score, x, y: heights[heights.length >> 1] };
  }
  return best ? { x: best.x, y: best.y } : { x: trail.start.x, y: surfaceY(trail, trail.start.x) ?? 0 };
}

/**
 * Samples the ground along the route from start to finish, in x order. At each
 * step it follows the floor nearest the last one, so a cave's floor rather
 * than its roof, and up walls; `y` is null over gaps.
 */
export function surfaceProfile(trail, step = 8) {
  const direction = trail.finish.x >= trail.start.x ? 1 : -1;
  const count = Math.floor(Math.abs(trail.finish.x - trail.start.x) / step);
  const points = [];
  let previous = trail.start.y ?? surfaceY(trail, trail.start.x);
  for (let index = 0; index <= count; index++) {
    const x = trail.start.x + direction * index * step;
    let y = null;
    for (const surface of terrainSurfacesAt(trail, x)) {
      if (!surface.entering) continue;
      if (y === null || previous === null || Math.abs(surface.y - previous) < Math.abs(y - previous)) y = surface.y;
    }
    if (y !== null) previous = y;
    points.push({ x, y });
  }
  return direction > 0 ? points : points.reverse();
}
