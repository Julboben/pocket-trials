// @ts-check
// The spinning spike: its drawn shape, shared by the ride and the renderer so
// a spike kills exactly when the player's hitbox touches the drawn star.
import { TAU } from "./config.js";
import { distanceToSegment } from "./finish.js";
import { ART, distanceToRect, segmentToRect, segmentsCross } from "./player-shape.js";
import { cos, hypot, sin } from "./det-math.js";

/** The star's valleys, as a share of the spike's radius. */
export const SPIKE_CORE = 0.56;
/** How far the star's dark outline reaches past the spike's radius. */
export const SPIKE_TIP = 2;

/** How many points the star has. */
export function spikePoints(radius) {
  return Math.max(7, Math.min(12, Math.round(radius * 0.4)));
}

/** The star's turn at `time` seconds, as the renderer rotates it. */
export function spikeAngle(spike, time) {
  return time * spike.spin * TAU;
}

/**
 * The rows of the pixel disc drawn over the star's centre (see
 * `drawPixelDisc`), as [left, top, right, bottom] relative to the centre.
 */
function discRows(radius) {
  const cells = Math.ceil((radius * SPIKE_CORE + 1.5) / ART);
  const rows = [];
  for (let row = -cells; row <= cells; row++) {
    const span = Math.floor(Math.sqrt(cells * cells - row * row));
    rows.push([-span * ART, row * ART, (span + 1) * ART, (row + 1) * ART]);
  }
  return rows;
}

function insidePolygon(vertices, x, y) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i], [xj, yj] = vertices[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function edgeDistance(vertices, x, y) {
  let best = Infinity;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++)
    best = Math.min(best, distanceToSegment(x, y, vertices[j][0], vertices[j][1], vertices[i][0], vertices[i][1]));
  return best;
}

function crossesEdge(vertices, ax, ay, bx, by) {
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++)
    if (segmentsCross(ax, ay, bx, by, vertices[j][0], vertices[j][1], vertices[i][0], vertices[i][1])) return true;
  return false;
}

/**
 * The drawn spike at `time`: the spinning star with its outline, and the
 * pixel disc at its centre, as a shape the player can touch.
 * @param {{ x: number, y: number, radius: number, spin: number }} spike
 * @param {number} time
 */
export function spikeShape(spike, time) {
  const cx = Math.round(spike.x / ART) * ART, cy = Math.round(spike.y / ART) * ART;
  const points = spikePoints(spike.radius);
  const outer = spike.radius + SPIKE_TIP, inner = spike.radius * SPIKE_CORE;
  const turn = spikeAngle(spike, time);
  const star = [];
  for (let index = 0; index < points * 2; index++) {
    const angle = (index * Math.PI) / points + turn;
    const r = index % 2 ? inner : outer;
    star.push([cx + cos(angle) * r, cy + sin(angle) * r]);
  }
  const disc = discRows(spike.radius).map(([l, t, r, b]) => [cx + l, cy + t, cx + r, cy + b]);
  const discReach = Math.max(
    ...disc.flatMap(([l, t, r, b]) => [hypot(l - cx, t - cy), hypot(r - cx, b - cy), hypot(l - cx, b - cy), hypot(r - cx, t - cy)]),
  );

  const inStar = (x, y) => insidePolygon(star, x, y);
  return {
    x: cx,
    y: cy,
    reach: Math.max(outer, discReach),
    overlapsPixel(left, top) {
      const right = left + ART, bottom = top + ART;
      for (const [l, t, r, b] of disc) if (left < r && right > l && top < b && bottom > t) return true;
      if (inStar(left, top) || inStar(right, top) || inStar(left, bottom) || inStar(right, bottom)) return true;
      if (inStar(left + ART / 2, top + ART / 2)) return true;
      for (const [x, y] of star) if (x > left && x < right && y > top && y < bottom) return true;
      return (
        crossesEdge(star, left, top, right, top) ||
        crossesEdge(star, right, top, right, bottom) ||
        crossesEdge(star, right, bottom, left, bottom) ||
        crossesEdge(star, left, bottom, left, top)
      );
    },
    distanceTo(x, y) {
      if (inStar(x, y)) return 0;
      let best = edgeDistance(star, x, y);
      for (const [l, t, r, b] of disc) best = Math.min(best, distanceToRect(x, y, l, t, r, b));
      return best;
    },
    segmentDistance(ax, ay, bx, by) {
      if (inStar(ax, ay) || inStar(bx, by) || crossesEdge(star, ax, ay, bx, by)) return 0;
      let best = Math.min(edgeDistance(star, ax, ay), edgeDistance(star, bx, by));
      for (const [x, y] of star) best = Math.min(best, distanceToSegment(x, y, ax, ay, bx, by));
      for (const [l, t, r, b] of disc) best = Math.min(best, segmentToRect(ax, ay, bx, by, l, t, r, b));
      return best;
    },
  };
}
