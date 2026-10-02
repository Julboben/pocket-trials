// Terrain block geometry: boundaries, points, drawn shapes and cuts.
import { canFlip } from "../drawing.js";
import {
  cutBlock,
  edgeCurve,
  insertBoundaryNode,
  isCurvedEdge,
  normalizeBlocks,
  rectangleBlock,
} from "../terrain-geometry.js";
import { ctx } from "./dom.js";
import { pushHistory } from "./history.js";
import { syncInspector } from "./inspector.js";
import { groundY, render } from "./render.js";
import { blocksSelection } from "./selection.js";
import { gridSpacing } from "./snap.js";
import { editor } from "./state.js";
import { showStatus } from "./status.js";
import { setTool, toolMaterial, toolSettings } from "./tools.js";

/** The blocks being edited, normalized so every node and handle is well formed. */
export function blocks() {
  if (!editor.trail.terrainBlocks) editor.trail.terrainBlocks = [];
  return editor.trail.terrainBlocks;
}

/** A boundary as one canvas path, following its curves. */
export function traceBoundary(boundary) {
  const nodes = boundary.nodes;
  if (!nodes.length) return;
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const next = nodes[(index + 1) % nodes.length];
    if (isCurvedEdge(node, next)) {
      const [p0, c1, c2, p1] = edgeCurve(node, next);
      ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]);
    } else {
      ctx.lineTo(next.x, next.y);
    }
  }
  ctx.closePath();
}

/** A region's solid area as one path, with its caves as holes. */
export function traceRegion(region) {
  ctx.beginPath();
  traceBoundary(region.outer);
  for (const hole of region.inner) traceBoundary(hole);
}

/** The block indices the current selection covers, whole or in part. */
export function selectedBlocks() {
  if (editor.selection?.kind === "items")
    return editor.selection.items
      .filter((item) => item.type === "block")
      .map((item) => item.index);
  return Number.isInteger(editor.selection?.blockIndex) ? [editor.selection.blockIndex] : [];
}

export function blockSelected(blockIndex) {
  return (
    (editor.selection?.kind === "block" || editor.selection?.kind === "items") &&
    selectedBlocks().includes(blockIndex)
  );
}

/**
 * Every boundary of a block in one list, outer first within each region.
 * Selections store a boundary by its position in this list, so a block that
 * a cut has split into several regions still resolves to the right ring.
 */
export function boundaryEntries(block) {
  return block.regions.flatMap((region, regionIndex) => [
    { boundary: region.outer, regionIndex, hole: -1 },
    ...region.inner.map((boundary, hole) => ({ boundary, regionIndex, hole })),
  ]);
}

/** A copy of a block with one boundary replaced, or removed when `replacement` is null. */
export function withBoundary(block, boundaryIndex, replacement) {
  const entry = boundaryEntries(block)[boundaryIndex];
  if (!entry) return block;
  const regions = block.regions
    .map((region, regionIndex) => {
      if (regionIndex !== entry.regionIndex) return region;
      if (entry.hole < 0)
        return replacement ? { outer: replacement, inner: region.inner } : null;
      const inner = region.inner
        .map((hole, index) => (index === entry.hole ? replacement : hole))
        .filter(Boolean);
      return { outer: region.outer, inner };
    })
    .filter(Boolean);
  return { ...block, regions };
}

export function replaceBoundary(blockIndex, boundaryIndex, replacement) {
  const block = blocks()[blockIndex];
  if (block)
    replaceBlock(blockIndex, withBoundary(block, boundaryIndex, replacement));
}

/** Every boundary of a block, outer first, in region order. */
export function boundariesOf(block) {
  return block.regions.flatMap((region) => [region.outer, ...region.inner]);
}

export function boundaryAt(target) {
  const block = blocks()[target.blockIndex];
  if (!block) return null;
  return boundariesOf(block)[target.boundaryIndex] || null;
}

/** Replace one block at an index, returning a new block list. */
export function replaceBlock(index, block) {
  const next = blocks().slice();
  next[index] = block;
  editor.trail.terrainBlocks = next;
}

/** A smooth node keeps its handles collinear, so moving one moves the other. */
export function realignSmooth(boundary, index) {
  const node = boundary.nodes[index];
  if (!node.in || !node.out) return;
  const inLength = Math.hypot(node.in[0] - node.x, node.in[1] - node.y);
  const outLength = Math.hypot(node.out[0] - node.x, node.out[1] - node.y);
  if (inLength < 1e-6 || outLength < 1e-6) return;
  const dx = (node.in[0] - node.x) / inLength,
    dy = (node.in[1] - node.y) / inLength;
  node.out = [node.x - dx * outLength, node.y - dy * outLength];
}

/**
 * Insert a point into an edge, keeping the edge's shape. On a curved edge this
 * splits the Bézier rather than flattening it, so the outline does not change.
 */
export function insertBlockNode(boundaryIndex, nodeIndex, t, blockIndex) {
  const block = blocks()[blockIndex];
  const boundary = block && boundariesOf(block)[boundaryIndex];
  if (!boundary) return;
  replaceBoundary(blockIndex, boundaryIndex, {
    ...insertBoundaryNode(boundary, nodeIndex, t),
    id: boundary.id,
  });
  // The inserted node sits right after the one the edge started at.
  editor.selection = {
    kind: "blockPoint",
    blockIndex,
    boundaryIndex,
    index: nodeIndex + 1,
  };
}

export function addAt(point) {
  pushHistory();
  if (editor.tool === "apple") {
    editor.trail.apples.push({ x: point.x, y: point.y });
    editor.selection = { kind: "apple", index: editor.trail.apples.length - 1 };
  } else if (editor.tool === "start") {
    editor.trail.start = {
      x: point.x,
      y: point.y,
      facing: Number(toolSettings.start.facing) < 0 ? -1 : 1,
    };
    editor.selection = { kind: "start" };
  } else if (editor.tool === "prop") {
    const prop = {
      x: point.x,
      y: point.y,
      type: toolSettings.prop.type,
      layer: toolSettings.prop.layer === "front" ? "front" : "back",
    };
    if (prop.type === "sign") prop.text = "";
    if (toolSettings.prop.flip && canFlip(prop.type)) prop.flip = true;
    editor.trail.props.push(prop);
    editor.selection = { kind: "prop", index: editor.trail.props.length - 1 };
  } else if (editor.tool === "spike") {
    editor.trail.spikes.push({
      x: point.x,
      y: point.y,
      radius: toolSettings.spike.radius,
      spin: toolSettings.spike.spin,
    });
    editor.selection = { kind: "spike", index: editor.trail.spikes.length - 1 };
  } else if (editor.tool === "finish") {
    // Placed on the surface at the clicked x, ready to be dragged up or down.
    editor.trail.goal = point.x;
    editor.trail.finishY = groundY(point.x);
    editor.selection = { kind: "goal" };
  }
  // Start and finish are one of a kind, so those go back to Select; every
  // other tool stays active for the next click.
  if (editor.tool === "start" || editor.tool === "finish") setTool("select");
  syncInspector();
  render();
}

/** Drop points that barely change a freehand outline (Ramer–Douglas–Peucker). */
function simplifyOutline(points, tolerance) {
  if (points.length < 4) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a],
      [bx, by] = points[b];
    const dx = bx - ax,
      dy = by - ay,
      lengthSquared = dx * dx + dy * dy;
    let far = -1,
      farIndex = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = lengthSquared
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
        : 0;
      const distance = Math.hypot(px - ax - dx * t, py - ay - dy * t);
      if (distance > far) {
        far = distance;
        farIndex = i;
      }
    }
    if (far > tolerance) {
      keep[farIndex] = 1;
      stack.push([a, farIndex], [farIndex, b]);
    }
  }
  const out = points.filter((_, index) => keep[index]);
  // The drawing usually ends back near its start; don't keep both.
  const [fx, fy] = out[0],
    [lx, ly] = out.at(-1);
  if (out.length > 3 && Math.hypot(fx - lx, fy - ly) < tolerance * 3) out.pop();
  return out;
}

const signedArea = (points) =>
  points.reduce((sum, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    return sum + x * ny - nx * y;
  }, 0) / 2;

function snapToGrid([x, y]) {
  const g = gridSpacing(editor.zoom);
  return [Math.round(x / g) * g, Math.round(y / g) * g];
}

/**
 * What a Block or Cut drag will make, from its raw path and the keys held:
 * Alt draws a rectangle, Shift snaps to the grid.
 */
export function updateShapePoints(shape) {
  const snap = shape.shift ? snapToGrid : (point) => point;
  if (shape.alt) {
    const [sx, sy] = snap(shape.raw[0]);
    const [ex, ey] = snap(shape.end);
    shape.points = [[sx, sy], [ex, sy], [ex, ey], [sx, ey]];
    return;
  }
  const points = [];
  for (const raw of [...shape.raw, shape.end]) {
    const point = snap(raw);
    const last = points.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1])
      points.push(point);
  }
  // Snapped outlines drop points that only continue a straight grid line.
  shape.points = shape.shift ? simplifyOutline(points, 0.5) : points;
}

/**
 * Commit a drawn shape. A Block drag makes a new block in the drawn shape (or
 * a rectangle with `rect`); a Cut drag removes the drawn outline from a block.
 *
 * The kind is passed in rather than read from `pendingKind`, because the caller
 * has already cleared that state by the time it gets here.
 */
export function commitShape(kind, points, closed, rect = false) {
  if (points.length < 2) return false;
  if (kind === "block") {
    const xs = points.map((value) => value[0]),
      ys = points.map((value) => value[1]);
    const left = Math.min(...xs),
      right = Math.max(...xs);
    const top = Math.min(...ys),
      bottom = Math.max(...ys);
    if (right - left < 8 || bottom - top < 8) return false;
    const block = rectangleBlock(
      left,
      top,
      right,
      bottom,
      toolMaterial("block"),
    );
    if (!rect) {
      // Freehand: the drawn outline, with the rectangle's ids and winding.
      const outline = simplifyOutline(points, 3 / editor.zoom);
      if (outline.length < 3 || Math.abs(signedArea(outline)) < 64)
        return false;
      const outer = block.regions[0].outer;
      const template = outer.nodes[0];
      if (
        Math.sign(signedArea(outline)) !==
        Math.sign(
          signedArea(
            outer.nodes.map((node) => [node.x, node.y]),
          ),
        )
      )
        outline.reverse();
      block.regions[0].outer = {
        ...outer,
        nodes: outline.map(([x, y], index) => ({
          ...template,
          id: `${template.id}-${index}`,
          x,
          y,
          mode: "corner",
          in: null,
          out: null,
          edge: "straight",
        })),
      };
    }
    editor.trail.terrainBlocks = [
      ...blocks(),
      normalizeBlocks([block], editor.trail.terrain)[0],
    ];
    editor.selection = {
      kind: "block",
      blockIndex: editor.trail.terrainBlocks.length - 1,
      regionIndex: 0,
    };
    return true;
  }

  // A cut needs at least three corners. It applies to the selected blocks when
  // it overlaps any of them, so a cave can be cut into a block that sits under
  // another one; otherwise it applies to the topmost block it changes, so one
  // stroke never carves through every layer at once.
  if (!closed || points.length < 3) {
    showStatus("warning", "That cut was too small. Drag a larger outline.");
    return false;
  }
  const attempt = (blockIndex) => {
    const result = cutBlock(blocks()[blockIndex], points);
    if (result.changed)
      replaceBlock(
        blockIndex,
        normalizeBlocks([result.block], editor.trail.terrain)[0],
      );
    return result;
  };
  let reason = null;
  const selected = selectedBlocks().filter((index) => blocks()[index]);
  const changedSelected = selected.filter((index) => {
    const result = attempt(index);
    reason ||= result.reason;
    return result.changed;
  });
  if (changedSelected.length) {
    editor.selection = blocksSelection(changedSelected);
    return true;
  }
  for (let blockIndex = blocks().length - 1; blockIndex >= 0; blockIndex--) {
    if (selected.includes(blockIndex)) continue;
    const result = attempt(blockIndex);
    if (result.changed) {
      editor.selection = { kind: "block", blockIndex, regionIndex: 0 };
      return true;
    }
    reason ||= result.reason;
  }
  showStatus("warning", reason || "The cut did not overlap any block.");
  return false;
}

/** A copy of a block with fresh ids, so it's fully independent of the original. */
export function freshBlockCopy(block) {
  const strip = (boundary) => ({
    nodes: boundary.nodes.map(({ id, ...node }) => structuredClone(node)),
  });
  return normalizeBlocks(
    [
      {
        material: block.material,
        regions: block.regions.map((region) => ({
          outer: strip(region.outer),
          inner: region.inner.map(strip),
        })),
      },
    ],
    editor.trail.terrain,
  )[0];
}
