// @ts-check
// Fire, for any prop that burns: a torch's flame, a fireplace, a bonfire. A
// fire is a row of flame tongues sized to the prop (fireTongues), flickering
// out of step with each other (fireFrame) and drawn as layered pixel flames,
// white-hot at the root and darkening to their tips, with sparks rising off
// them (drawFire). Like every prop it sits on the 2-unit art grid, has no
// outlines and is lit from the right. `time` 0 holds it still, and nothing is
// random, so a fire looks the same in every replay. A burning prop draws its
// fire in drawing.js's glow pass, so the flames stay bright after dark, and
// casts its light from lighting.js.

/** Fire's colours, from its dark edge to its white-hot core. */
export const FLAME = { dark: "#c9573a", base: "#ed774e", glow: "#f1b95d", light: "#ffe39a", core: "#fff3be" };

const snap = (value) => Math.round(value / 2) * 2;

/**
 * The tongues of a fire about `width` across and `height` tall, its base on
 * y = 0: the tallest in the middle, smaller ones either side, each
 * { x, height, half } (half its width at the root), on the art grid.
 */
export function fireTongues(width, height) {
  const count = Math.max(1, Math.round(width / 8));
  const spots = Array.from({ length: count }, (_, i) => (count === 1 ? 0 : (i / (count - 1)) * 2 - 1));
  // Shorter towards the sides, every other one a little shorter again.
  const rises = spots.map((t, i) => 1 - Math.abs(t) * 0.4 - (i % 2 ? 0.12 : 0));
  const tallest = Math.max(...rises);
  const half = Math.max(2, snap(Math.min(width / 2, (width / count) * 0.75 + 2)));
  // Spread so the outer tongues' roots reach the fire's edges and no further.
  const reach = Math.max(0, width / 2 - half);
  return spots.map((t, i) => ({
    x: t < 0 ? -snap(-t * reach) : snap(t * reach),
    height: Math.max(4, snap((height * rises[i]) / tallest)),
    half,
  }));
}

/**
 * The tongues as they stand at `time`: each rises and falls a little and its
 * tip licks to the side (0 or ±2), out of step with the others. Still at
 * time 0. `phase` is a fixed 0…1 value per fire.
 * @param {{ x: number, height: number, half: number }[]} tongues
 */
export function fireFrame(tongues, time, phase = 0) {
  return tongues.map((tongue, index) => {
    if (!time) return { ...tongue, lick: 0 };
    const frame = Math.floor(time * 8 + phase * 4 + index * 1.7) % 4;
    const swell = snap(tongue.height * 0.15) || 2;
    return {
      ...tongue,
      height: Math.max(4, tongue.height + [0, swell, -snap(swell / 2), snap(swell / 2)][frame]),
      lick: [0, 2, 0, -2][(frame + index) % 4],
    };
  });
}

/**
 * A fire as fireFrame shapes it, its base on y = 0: the outer tongues first
 * and the tallest last, each a point that leans with its lick, coloured in
 * layers from a white-hot core at the root out to a dark edge, shaded on the
 * left. A glowing bed joins their roots. While `time` runs, `sparks` (how
 * many) climb off it to `rise` above its tallest tongue and wink out. Out in
 * the open, a `wind` (0…1) bends the tips and carries the sparks `downwind`
 * (-1 left, 1 right), and they climb less high.
 * @param {{ x: number, height: number, half: number, lick: number }[]} frame
 */
export function drawFire({ pixelRect }, frame, time = 0, phase = 0, { sparks = 2, rise = 24, wind = 0, downwind = -1 } = {}) {
  const order = frame.map((tongue, index) => index).sort((a, b) => frame[a].height - frame[b].height);
  for (const index of order) {
    const { x: cx, height, half, lick } = frame[index];
    for (let up = 0; up < height; up += 2) {
      const t = up / height;
      // A teardrop: swelling from the root to its widest a quarter of the
      // way up, then drawing in to a point, its tip licking to the side.
      const profile = t < 0.25 ? 0.7 + t * 1.2 : ((1 - t) / 0.75) ** 1.1;
      const cells = Math.max(1, Math.round((half / 2) * profile));
      const centre = cx + snap(lick * t * t * 2 + downwind * wind * 10 * t * t);
      for (let c = -cells; c < cells; c++) {
        const u = Math.abs(c + 0.5) / cells;
        let color = FLAME.base;
        if (t < 0.2 && u < 0.35) color = FLAME.core;
        else if (t < 0.45 && u < 0.55) color = FLAME.light;
        else if (t < 0.7 && u < 0.8) color = FLAME.glow;
        // The tip and the left edge, away from the light, are darker.
        if (t > 0.85 || (c === -cells && t > 0.2)) color = FLAME.dark;
        pixelRect(centre + c * 2, -up - 2, 2, 2, color, 2);
      }
    }
  }
  // The glowing bed under the tongues.
  const left = Math.min(...frame.map((tongue) => tongue.x - tongue.half));
  const right = Math.max(...frame.map((tongue) => tongue.x + tongue.half));
  pixelRect(left, -2, right - left, 2, FLAME.glow, 2);
  pixelRect(left + 2, -2, right - left - 4, 2, FLAME.light, 2);
  if (!time || !sparks) return;
  const top = Math.max(...frame.map((tongue) => tongue.height));
  for (let i = 0; i < sparks; i++) {
    const life = (time * 0.8 + phase + i / sparks) % 1;
    const sx = snap(Math.sin((time + i * 2.1) * 1.9) * (right - left) * 0.25 + ((i % 2) * 2 - 1) * 2 + downwind * wind * life * 50);
    const sy = -top - snap(life * rise * (1 - wind * 0.5));
    if (life < 0.8) pixelRect(sx, sy, 2, 2, life < 0.4 ? FLAME.light : FLAME.glow, 2);
  }
}
