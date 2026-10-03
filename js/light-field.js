// The ambient light field: how much sky light reaches each point of a trail,
// baked once per trail and time of day, since terrain never moves.
//
// Air open to the sky gets full light, which fades in through air only (so
// rock blocks it) into cave mouths and under ledges. Rock takes the light of
// the air at its surface, and deeper in, the sky light soaking down from the
// top of its column or in from a nearby face. How far that soaks is set by the
// time of day, so ground stays bright by day and sinks into darkness at
// night, while caves are dark at any time.
import { terrainGeometry, terrainSurfacesAt } from "./terrain.js";

// World units per texel; the field is smoothed when it is drawn.
export const LIGHT_UNIT = 4;
// Larger trails are baked coarser to bound the bake time and memory.
const MAX_TEXELS = 2_500_000;
// Room around the terrain, in world units: enough for the fades to settle.
const MARGIN = { side: 64, above: 16, below: 160 };
// Rock this close to air takes the air's light; deeper, the soaked sky light.
const LIP = 10;
const ROCK_BLEND = 16;
// How deep into rock a moving light still reaches.
const SKIN = 10;
// Enclosed air smaller than this (world units²) is lit like the rock around
// it, so window cut-outs and small hollows don't read as caves.
const POCKET_AREA = 24_000;
// Air thinner than this (world units) between rock above and below, like the
// slit under a ledge resting on the ground, is lit as rock too.
const THIN_GAP = 24;
// How far deep rock light is blurred (world units, run twice), smoothing the
// creases of the distance sweeps.
const DEEP_BLUR = 24;
// Bounce: the sky light air sees spreads on through air, fading over this
// many world units, so open shade under a ledge stays light. It never passes
// through rock, so caves seeing no sky anywhere near stay dark.
const BOUNCE_REACH = 300;
const DIAGONAL = Math.SQRT2;
// Directions sky light arrives from, in radians from straight up. Air that
// sees enough of the sky, like the space under a floating ledge, is lit even
// when it is far from open air; a cave sees almost none of it.
const SKY_RAYS = Array.from({ length: 13 }, (_, n) => ((n - 6) / 6) * 1.45);

const smooth = (v) => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

/**
 * Bakes the light field for a trail. `soak` is how far sky light reaches down
 * through rock and `reach` how far it fades in sideways through air, both in
 * world units; `open` is the share of the sky air must see to be fully lit. Returns null for a trail without terrain blocks, else
 * { x, y, unit, width, height, light, cover }: `light` is 0…1 per texel, and
 * `cover` 0…1 is how much rock hides a moving light there.
 * @param {any} trail
 * @param {{ soak: number, reach: number, open?: number }} options
 */
export function bakeLightField(trail, { soak, reach, open = 0.35 }, unit = LIGHT_UNIT) {
  const bounds = terrainGeometry(trail)?.bounds;
  if (!bounds) return null;
  let x, y, width, height;
  for (;;) {
    x = Math.floor((bounds.left - MARGIN.side) / unit) * unit;
    y = Math.floor((bounds.top - MARGIN.above) / unit) * unit;
    width = Math.ceil((bounds.right + MARGIN.side - x) / unit);
    height = Math.ceil((bounds.bottom + MARGIN.below - y) / unit);
    if (width * height <= MAX_TEXELS) break;
    unit *= 2;
  }
  const size = width * height;
  const solid = new Uint8Array(size);
  const dist = new Float32Array(size).fill(Infinity);
  const tops = new Float64Array(width).fill(Infinity);
  // Below all the terrain is treated as more rock, so the ground doesn't end
  // in a lit band when the camera looks under it.
  const floorRow = Math.max(0, Math.ceil((bounds.bottom - y) / unit - 0.5));

  for (let c = 0; c < width; c++) {
    const surfaces = terrainSurfacesAt(trail, x + (c + 0.5) * unit);
    for (let s = 0; s < surfaces.length; s++) {
      if (!surfaces[s].entering) continue;
      const from = surfaces[s].y,
        to = s + 1 < surfaces.length ? surfaces[s + 1].y : Infinity;
      if (tops[c] === Infinity) tops[c] = from;
      const r0 = Math.max(0, Math.ceil((from - y) / unit - 0.5));
      const r1 = Math.min(height - 1, Math.floor((to - y) / unit - 0.5));
      for (let r = r0; r <= r1; r++) solid[r * width + c] = 1;
    }
    for (let r = floorRow; r < height; r++) solid[r * width + c] = 1;
    fillThinGaps(solid, width, height, c, Math.floor(THIN_GAP / unit));
    // Air above the column's topmost rock is open to the sky.
    const open = Math.min(height, Math.ceil((tops[c] - y) / unit - 0.5));
    for (let r = 0; r < open; r++) if (!solid[r * width + c]) dist[r * width + c] = 0;
  }

  // Air: distance, through air only, to air open to the sky.
  for (let r = 0; r < height; r++)
    for (let c = 0, i = r * width; c < width; c++, i++) {
      if (solid[i]) continue;
      let d = dist[i];
      if (c > 0 && !solid[i - 1] && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
      if (r > 0) {
        const j = i - width;
        if (!solid[j] && dist[j] + 1 < d) d = dist[j] + 1;
        if (c > 0 && !solid[j - 1] && dist[j - 1] + DIAGONAL < d) d = dist[j - 1] + DIAGONAL;
        if (c < width - 1 && !solid[j + 1] && dist[j + 1] + DIAGONAL < d) d = dist[j + 1] + DIAGONAL;
      }
      dist[i] = d;
    }
  for (let r = height - 1; r >= 0; r--)
    for (let c = width - 1, i = r * width + c; c >= 0; c--, i--) {
      if (solid[i]) continue;
      let d = dist[i];
      if (c < width - 1 && !solid[i + 1] && dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
      if (r < height - 1) {
        const j = i + width;
        if (!solid[j] && dist[j] + 1 < d) d = dist[j] + 1;
        if (c < width - 1 && !solid[j + 1] && dist[j + 1] + DIAGONAL < d) d = dist[j + 1] + DIAGONAL;
        if (c > 0 && !solid[j - 1] && dist[j - 1] + DIAGONAL < d) d = dist[j - 1] + DIAGONAL;
      }
      dist[i] = d;
    }

  fillSmallPockets(solid, dist, width, Math.ceil(POCKET_AREA / (unit * unit)));

  const view = skyView(solid, width, height);
  const bounce = new Float32Array(size);
  for (let i = 0; i < size; i++) if (!solid[i]) bounce[i] = Math.min(1, view[i] / open);
  spreadThroughAir(bounce, solid, width, height, unit / BOUNCE_REACH);
  const light = new Float32Array(size);
  const near = new Float32Array(size).fill(Infinity),
    nearLight = new Float32Array(size),
    soaked = new Float32Array(size);
  const sideFade = unit / reach;
  for (let i = 0; i < size; i++) {
    if (solid[i]) continue;
    const lit = Math.max(1 - smooth(dist[i] * sideFade), smooth(bounce[i]));
    light[i] = nearLight[i] = soaked[i] = lit;
    near[i] = 0;
  }

  // Rock: the nearest air's light, and the sky light soaking in through rock.
  const fade = unit / soak,
    diagonalFade = DIAGONAL * fade;
  const relax = (i, j, cost, loss) => {
    if (near[j] + cost < near[i]) {
      near[i] = near[j] + cost;
      nearLight[i] = nearLight[j];
    }
    const through = soaked[j] - loss;
    if (through > soaked[i]) soaked[i] = through;
  };
  for (let r = 0; r < height; r++)
    for (let c = 0, i = r * width; c < width; c++, i++) {
      if (!solid[i]) continue;
      if (c > 0) relax(i, i - 1, 1, fade);
      if (r > 0) {
        relax(i, i - width, 1, fade);
        if (c > 0) relax(i, i - width - 1, DIAGONAL, diagonalFade);
        if (c < width - 1) relax(i, i - width + 1, DIAGONAL, diagonalFade);
      }
    }
  for (let r = height - 1; r >= 0; r--)
    for (let c = width - 1, i = r * width + c; c >= 0; c--, i--) {
      if (!solid[i]) continue;
      if (c < width - 1) relax(i, i + 1, 1, fade);
      if (r < height - 1) {
        relax(i, i + width, 1, fade);
        if (c < width - 1) relax(i, i + width + 1, DIAGONAL, diagonalFade);
        if (c > 0) relax(i, i + width - 1, DIAGONAL, diagonalFade);
      }
    }

  // Deep in rock: the sky light from straight above, through every block in
  // the column, or soaked in from the nearest face, whichever is brighter.
  const deep = new Float32Array(size);
  for (let r = 0; r < height; r++) {
    const wy = y + (r + 0.5) * unit;
    for (let c = 0, i = r * width; c < width; c++, i++) {
      if (!solid[i]) {
        deep[i] = light[i];
        continue;
      }
      const above = tops[c] === Infinity ? 1 : 1 - (wy - tops[c]) / soak;
      deep[i] = Math.max(0, Math.min(1, Math.max(soaked[i], above)));
    }
  }
  const blur = Math.max(1, Math.round(DEEP_BLUR / unit));
  boxBlur(deep, width, height, blur);
  boxBlur(deep, width, height, blur);

  const cover = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    if (!solid[i]) continue;
    const depth = near[i] * unit;
    const edge = nearLight[i];
    light[i] = Math.max(0, Math.min(1, edge + (deep[i] - edge) * smooth((depth - LIP) / ROCK_BLEND)));
    cover[i] = near[i] === Infinity ? 1 : smooth(depth / SKIN);
  }
  return { x, y, unit, width, height, light, cover };
}

// The share of the sky (0…1) each air texel sees, over SKY_RAYS. Each ray is
// swept across the grid once: steep rays row by row from the top, shallow
// ones column by column from the side they come from, sampling the texel the
// ray passed through before with linear interpolation. Off the grid is sky.
function skyView(solid, width, height) {
  const view = new Float32Array(width * height);
  let previous = new Float32Array(Math.max(width, height)),
    current = new Float32Array(previous.length);
  for (const angle of SKY_RAYS) {
    const slope = Math.tan(angle);
    if (Math.abs(slope) <= 1) {
      // Up one row, across `slope` columns.
      previous.fill(1);
      for (let r = 0; r < height; r++) {
        for (let c = 0, i = r * width; c < width; c++, i++) {
          if (solid[i]) {
            current[c] = 0;
            continue;
          }
          const x = c + slope,
            c0 = Math.floor(x),
            f = x - c0;
          const a = c0 >= 0 && c0 < width ? previous[c0] : 1,
            b = c0 + 1 >= 0 && c0 + 1 < width ? previous[c0 + 1] : 1;
          current[c] = a + (b - a) * f;
          view[i] += current[c];
        }
        [previous, current] = [current, previous];
      }
    } else {
      // Across one column towards the light, up `rise` rows.
      const rise = 1 / Math.abs(slope),
        step = slope > 0 ? 1 : -1;
      previous.fill(1);
      for (let n = 0, c = step > 0 ? width - 1 : 0; n < width; n++, c -= step) {
        for (let r = 0, i = c; r < height; r++, i += width) {
          if (solid[i]) {
            current[r] = 0;
            continue;
          }
          const above = r > 0 ? previous[r - 1] : 1;
          current[r] = previous[r] + (above - previous[r]) * rise;
          view[i] += current[r];
        }
        [previous, current] = [current, previous];
      }
    }
  }
  const scale = 1 / SKY_RAYS.length;
  for (let i = 0; i < view.length; i++) view[i] *= scale;
  return view;
}

// Air runs in column `c` no taller than `limit` texels, with rock above and
// below, become rock.
function fillThinGaps(solid, width, height, c, limit) {
  let r = 0;
  while (r < height && !solid[r * width + c]) r++;
  while (r < height) {
    while (r < height && solid[r * width + c]) r++;
    const start = r;
    while (r < height && !solid[r * width + c]) r++;
    if (r < height && r - start <= limit) for (let k = start; k < r; k++) solid[k * width + c] = 1;
  }
}

// Spreads each air texel's value to its air neighbours, losing `loss` per
// texel travelled; two chamfer sweeps, like the distance through air.
function spreadThroughAir(values, solid, width, height, loss) {
  const diagonal = loss * DIAGONAL;
  const pull = (i, j, cost) => {
    if (!solid[j] && values[j] - cost > values[i]) values[i] = values[j] - cost;
  };
  for (let r = 0; r < height; r++)
    for (let c = 0, i = r * width; c < width; c++, i++) {
      if (solid[i]) continue;
      if (c > 0) pull(i, i - 1, loss);
      if (r > 0) {
        pull(i, i - width, loss);
        if (c > 0) pull(i, i - width - 1, diagonal);
        if (c < width - 1) pull(i, i - width + 1, diagonal);
      }
    }
  for (let r = height - 1; r >= 0; r--)
    for (let c = width - 1, i = r * width + c; c >= 0; c--, i--) {
      if (solid[i]) continue;
      if (c < width - 1) pull(i, i + 1, loss);
      if (r < height - 1) {
        pull(i, i + width, loss);
        if (c < width - 1) pull(i, i + width + 1, diagonal);
        if (c > 0) pull(i, i + width - 1, diagonal);
      }
    }
}

// A box blur of `radius` texels, rows then columns, in place.
function boxBlur(values, width, height, radius) {
  const line = new Float32Array(Math.max(width, height));
  const scale = 1 / (radius * 2 + 1);
  const blurLine = (start, stride, length) => {
    for (let k = 0, i = start; k < length; k++, i += stride) line[k] = values[i];
    const last = length - 1;
    let sum = line[0] * (radius + 1);
    for (let k = 1; k <= radius; k++) sum += line[k < last ? k : last];
    for (let k = 0, i = start; k < length; k++, i += stride) {
      values[i] = sum * scale;
      const add = k + radius + 1,
        drop = k - radius;
      sum += line[add < last ? add : last] - line[drop > 0 ? drop : 0];
    }
  };
  for (let r = 0; r < height; r++) blurLine(r * width, 1, width);
  for (let c = 0; c < width; c++) blurLine(c, width, height);
}

// Enclosed air (still at an infinite distance from the sky) in pockets
// smaller than `limit` texels becomes rock for lighting.
function fillSmallPockets(solid, dist, width, limit) {
  const size = solid.length;
  const seen = new Uint8Array(size);
  const stack = new Int32Array(size);
  const pocket = [];
  let top = 0;
  const visit = (j) => {
    if (j < 0 || j >= size || solid[j] || seen[j]) return;
    seen[j] = 1;
    stack[top++] = j;
  };
  for (let start = 0; start < size; start++) {
    if (solid[start] || seen[start] || dist[start] !== Infinity) continue;
    pocket.length = 0;
    visit(start);
    while (top) {
      const i = stack[--top];
      if (pocket.length <= limit) pocket.push(i);
      const c = i % width;
      if (c > 0) visit(i - 1);
      if (c < width - 1) visit(i + 1);
      visit(i - width);
      visit(i + width);
    }
    if (pocket.length <= limit) for (const i of pocket) solid[i] = 1;
  }
}

/** The baked light (0…1) at a world point; open sky outside the field. */
export function lightFieldAt(field, wx, wy) {
  if (!field) return 1;
  const c = Math.floor((wx - field.x) / field.unit),
    r = Math.floor((wy - field.y) / field.unit);
  if (c < 0 || c >= field.width || r < 0) return 1;
  return field.light[Math.min(r, field.height - 1) * field.width + c];
}
