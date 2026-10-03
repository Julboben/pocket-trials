// What is under the pointer.
import { edgeCurve, isCurvedEdge, pointInRegion } from "../terrain-geometry.js";
import { blockSelected, blocks, boundaryEntries, isBackWall } from "./blocks.js";
import {
  finishY,
  groundY,
  isActiveNode,
  objectY,
  syncTerrain,
} from "./render.js";
import { editor } from "./state.js";

/**
 * Selection priority, highest first: the visible curve handles of the active
 * node, then points, then boundary edges, then the solid body of a block.
 * Clicking empty cave space matches nothing, and clicking a nested island
 * selects the island rather than the block around it, because the topmost
 * solid under the cursor wins. With `wholeBoundary`, a point or edge selects
 * the whole ring it belongs to instead.
 *
 * Back walls sit behind the terrain, so terrain wins over them: their points
 * and edges lose a tie to the terrain's, and their bodies are only hit where
 * no terrain is. A selected back wall is grabbed like terrain.
 */
export function hitTest(point, { wholeBoundary = false } = {}) {
  syncTerrain();
  const threshold = 13 / editor.zoom;
  let best = null;
  const consider = (value, x, y, rank) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance > threshold) return;
    // A lower rank wins outright; within a rank the nearer point wins.
    if (
      best &&
      (rank > best.rank || (rank === best.rank && distance >= best.distance))
    )
      return;
    best = { selection: value, distance, rank };
  };

  for (const [blockIndex, block] of blocks().entries()) {
    const behind = isBackWall(block) && !blockSelected(blockIndex) ? 0.5 : 0;
    boundaryEntries(block).forEach(
      ({ boundary, regionIndex }, boundaryIndex) => {
        boundary.nodes.forEach((node, index) => {
          const base = { blockIndex, regionIndex, boundaryIndex, index };
          if (wholeBoundary) {
            const next = boundary.nodes[(index + 1) % boundary.nodes.length];
            const hit = edgeHit(node, next, point);
            consider(
              { kind: "blockBoundary", blockIndex, regionIndex, boundaryIndex },
              hit.x,
              hit.y,
              1 + behind,
            );
            return;
          }
          if (isActiveNode(blockIndex, boundaryIndex, index)) {
            for (const side of ["in", "out"]) {
              const handle = node[side];
              if (handle)
                consider(
                  { ...base, kind: "blockHandle", side },
                  handle[0],
                  handle[1],
                  0 + behind,
                );
            }
          }
          consider({ ...base, kind: "blockPoint" }, node.x, node.y, 1 + behind);
          // The edge leaving this node, so a double-click can insert into it.
          const next = boundary.nodes[(index + 1) % boundary.nodes.length];
          const hit = edgeHit(node, next, point);
          if (hit.distance <= threshold)
            consider({ ...base, kind: "blockEdge", t: hit.t }, hit.x, hit.y, 2 + behind);
        });
      },
    );
  }
  if (wholeBoundary) return best?.selection || ringAt(point);

  editor.trail.apples.forEach((apple, index) =>
    consider({ kind: "apple", index }, apple.x, objectY(apple, 60), 1),
  );
  editor.trail.props.forEach((prop, index) =>
    consider({ kind: "prop", index }, prop.x, objectY(prop), 1),
  );
  editor.trail.spikes.forEach((spike, index) =>
    consider({ kind: "spike", index }, spike.x, spike.y, 1),
  );
  const startY = Number.isFinite(editor.trail.start.y)
    ? editor.trail.start.y
    : groundY(editor.trail.start.x) - 12;
  consider({ kind: "start" }, editor.trail.start.x, startY, 1);
  consider({ kind: "goal" }, editor.trail.goal, finishY(), 1);
  if (best) return best.selection;

  // Bodies: a spike's own disc, then the topmost solid block under the cursor.
  for (let index = editor.trail.spikes.length - 1; index >= 0; index--) {
    const spike = editor.trail.spikes[index];
    if (Math.hypot(point.x - spike.x, point.y - spike.y) <= spike.radius)
      return { kind: "spike", index };
  }
  for (const blockIndex of frontToBack()) {
    const block = blocks()[blockIndex];
    const regionIndex = block.regions.findIndex((region) =>
      pointInRegion(region, point.x, point.y),
    );
    if (regionIndex >= 0) return { kind: "block", blockIndex, regionIndex };
  }
  return null;
}

/**
 * Block indices from the frontmost down: a selected back wall, then the
 * terrain topmost first, then the other back walls.
 */
function frontToBack() {
  const order = [...blocks().keys()].reverse();
  const rank = (index) =>
    isBackWall(blocks()[index]) ? (blockSelected(index) ? 0 : 2) : 1;
  return order.sort((a, b) => rank(a) - rank(b));
}

/**
 * The ring under a point away from any edge: the cave it is inside, or else
 * the outer boundary of the topmost solid region it is inside.
 */
function ringAt(point) {
  const inside = (boundary) =>
    pointInRegion({ outer: boundary, inner: [] }, point.x, point.y);
  const body = hitTest(point);
  // A block in front of the cave, such as an island inside it, wins.
  for (const blockIndex of frontToBack()) {
    if (body?.kind === "block" && blockIndex === body.blockIndex) break;
    const entries = boundaryEntries(blocks()[blockIndex]);
    const hole = entries.findIndex(
      (entry) => entry.hole >= 0 && inside(entry.boundary),
    );
    if (hole >= 0)
      return {
        kind: "blockBoundary",
        blockIndex,
        regionIndex: entries[hole].regionIndex,
        boundaryIndex: hole,
      };
  }
  if (body?.kind !== "block") return null;
  const boundaryIndex = boundaryEntries(blocks()[body.blockIndex]).findIndex(
    (entry) => entry.regionIndex === body.regionIndex && entry.hole < 0,
  );
  return {
    kind: "blockBoundary",
    blockIndex: body.blockIndex,
    regionIndex: body.regionIndex,
    boundaryIndex,
  };
}

/** The closest point on an edge, following the curve when the edge is curved. */
export function edgeHit(node, next, point) {
  if (!isCurvedEdge(node, next)) {
    const dx = next.x - node.x,
      dy = next.y - node.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount =
      lengthSquared > 1e-9
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - node.x) * dx + (point.y - node.y) * dy) /
                lengthSquared,
            ),
          )
        : 0;
    return {
      x: node.x + dx * amount,
      y: node.y + dy * amount,
      t: amount,
      distance: Math.hypot(
        point.x - node.x - dx * amount,
        point.y - node.y - dy * amount,
      ),
    };
  }
  const control = edgeCurve(node, next);
  let best = { distance: Infinity, x: node.x, y: node.y, t: 0 };
  for (let step = 0; step <= 24; step++) {
    const t = step / 24;
    const x =
      control[0][0] +
      3 * t * (1 - t) * (1 - t) * (control[1][0] - control[0][0]) +
      3 * t * t * (1 - t) * (control[2][0] - control[1][0]) +
      t * t * t * (control[3][0] - control[2][0]);
    const y =
      control[0][1] +
      3 * t * (1 - t) * (1 - t) * (control[1][1] - control[0][1]) +
      3 * t * t * (1 - t) * (control[2][1] - control[1][1]) +
      t * t * t * (control[3][1] - control[2][1]);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < best.distance) best = { distance, x, y, t };
  }
  return best;
}
