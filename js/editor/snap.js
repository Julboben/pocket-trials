// Shift-drag snapping for the trail editor: a dragged point is locked to
// fixed angle steps around a neighbouring point, and to the grid.

export const SNAP_ANGLE_STEP = 15;

/** The spacing of the grid lines the editor draws, so what you see is what snaps. */
export function gridSpacing(zoom) {
  // Coarser when zoomed out, so lines stay at least ~35px apart on screen.
  if (zoom < .18) return 500;
  if (zoom < .35) return 200;
  if (zoom < .65) return 100;
  // Finer when zoomed right in, for placing things precisely.
  if (zoom >= 4) return 10;
  return zoom >= 2 ? 25 : 50;
}

/**
 * Snap a point onto the grid, and onto an angle ray from a nearby anchor.
 *
 * With anchors, the direction from each anchor to the pointer is rounded to
 * the nearest angle step. The point then slides along that ray to the nearest
 * grid line it crosses, so the result sits on the ray and on a grid line. Of
 * the anchors, the one whose result is nearest the pointer is used. Without
 * anchors the point simply snaps to the nearest grid intersection.
 *
 * @param {{x: number, y: number}} target where the pointer wants the point
 * @param {Array<{x: number, y: number}>} anchors points the angle is measured from
 * @param {number} spacing grid spacing in world units
 * @param {number} [angleStep] angle increment in degrees
 * @returns {{x: number, y: number, anchor: {x: number, y: number} | null, angle: number, length: number}}
 */
export function snapToAngleAndGrid(target, anchors, spacing, angleStep = SNAP_ANGLE_STEP) {
  const gridPoint = {
    x: Math.round(target.x / spacing) * spacing,
    y: Math.round(target.y / spacing) * spacing,
  };
  let best = null;
  for (const anchor of anchors) {
    const dx = target.x - anchor.x, dy = target.y - anchor.y;
    if (Math.hypot(dx, dy) < 1e-6) continue;
    const step = angleStep * Math.PI / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    // Exact zeros keep horizontal and vertical rays perfectly straight.
    const clean = value => Math.abs(value) < 1e-9 ? 0 : value;
    const ux = clean(Math.cos(angle)), uy = clean(Math.sin(angle));
    // Distance along the ray that is closest to the pointer (always positive
    // here, since the ray is within half a step of the pointer's direction).
    const along = dx * ux + dy * uy;
    let x, y;
    if (Math.abs(ux) >= Math.abs(uy)) {
      x = Math.round((anchor.x + along * ux) / spacing) * spacing;
      // Never fold back through the anchor or collapse onto it.
      if ((x - anchor.x) * ux <= 0) x = (ux > 0 ? Math.floor(anchor.x / spacing) + 1 : Math.ceil(anchor.x / spacing) - 1) * spacing;
      y = anchor.y + (x - anchor.x) * uy / ux;
    } else {
      y = Math.round((anchor.y + along * uy) / spacing) * spacing;
      if ((y - anchor.y) * uy <= 0) y = (uy > 0 ? Math.floor(anchor.y / spacing) + 1 : Math.ceil(anchor.y / spacing) - 1) * spacing;
      x = anchor.x + (y - anchor.y) * ux / uy;
    }
    const distance = Math.hypot(x - target.x, y - target.y);
    if (!best || distance < best.distance) {
      const degrees = angle * 180 / Math.PI;
      best = { x, y, anchor, angle: clean(Math.round(degrees * 1000) / 1000), length: Math.hypot(x - anchor.x, y - anchor.y), distance };
    }
  }
  if (!best) return { ...gridPoint, anchor: null, angle: 0, length: 0 };
  return { x: best.x, y: best.y, anchor: best.anchor, angle: best.angle, length: best.length };
}
