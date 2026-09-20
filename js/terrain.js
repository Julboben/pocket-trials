import { lerp } from './config.js';

export function terrainAt(level, x) {
  const points = level.points;
  let y = points[0][1];
  let slope = 0;
  if (x > points[0][0]) {
    const segment = points.findIndex((point, index) => index > 0 && x <= point[0]);
    if (segment < 0) {
      y = points[points.length - 1][1];
    } else {
      const start = points[segment - 1];
      const end = points[segment];
      const amount = (x - start[0]) / (end[0] - start[0]);
      y = lerp(start[1], end[1], (1 - Math.cos(amount * Math.PI)) / 2);
      slope = (end[1] - start[1]) * Math.PI * Math.sin(amount * Math.PI) / (2 * (end[0] - start[0]));
    }
  }
  const solid = !(level.gaps || []).some(gap => x > gap[0] && x < gap[1]);
  return { y, slope, solid };
}
