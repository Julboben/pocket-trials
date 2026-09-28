import { readFileSync } from "node:fs";
import { normalizeLevel } from "../js/level-schema.js";
import { flattenBoundary } from "../js/terrain-geometry.js";
import { terrainAt } from "../js/terrain.js";
import { propAlignmentSlope, propGroundOffset } from "../js/drawing.js";

const raw = JSON.parse(readFileSync(new URL("../levels/custom/the-orchard-copy.json", import.meta.url)));
const level = normalizeLevel(raw);
const region = level.terrainBlocks[0].regions[0];
const pts = flattenBoundary(region.outer).points;

// 1. Strata: the game draws them at surface(x) + const. How jagged is that?
const inside = (x, y) => {
  let v = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) v = !v;
  }
  return v;
};
const topAt = (x) => { for (let y = -300; y <= 120; y += 1) if (inside(x, y)) return y; return null; };
console.log("top surface y across the block (strata follow this):");
let row = "  ";
for (let x = 260; x <= 680; x += 20) row += String(topAt(x) ?? "--").padStart(5);
console.log(row);
console.log("  x:      " + Array.from({length: 22}, (_, i) => String(260 + i * 20).padStart(5)).join(""));

// 2. Surface-edge bars: how long are the "horizontal" edges?
console.log("\nsurface-edge fillRects the game draws (x length, y):");
for (let i = 0; i < pts.length; i++) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
  if (Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1])) continue;
  const left = Math.min(a[0], b[0]), right = Math.max(a[0], b[0]);
  console.log(`  span x ${Math.round(left)}..${Math.round(right)} (${Math.round(right - left)} long) at y ${Math.round(a[1])}`);
}

// 3. Prop ground offsets: does anything stretch?
console.log("\nprop offsets (a stretched prop has a large spread):");
for (const prop of level.props) {
  const o = propGroundOffset(level, prop);
  const spread = Math.max(...[-20, 0, 20].map(x => o(x))) - Math.min(...[-20, 0, 20].map(x => o(x)));
  const slope = propAlignmentSlope(level, prop);
  if (spread > 1 || Math.abs(slope) > 0.01) {
    console.log(`  ${prop.type} at (${Math.round(prop.x)}, ${prop.y}) slope ${slope.toFixed(3)} offset spread ${spread.toFixed(1)}`);
  }
}
console.log("done");
