// Selecting, moving, nudging, duplicating and deleting things.
import { canFlip } from "../drawing.js";
import { moveBlock, nextId, removeBoundaryNodes } from "../terrain-geometry.js";
import {
  blocks,
  boundariesOf,
  boundaryAt,
  boundaryEntries,
  freshBlockCopy,
  isBackWall,
  replaceBlock,
  replaceBoundary,
  selectedBlocks,
  withBoundary,
} from "./blocks.js";
import { pushHistory } from "./history.js";
import {
  selectedPosition,
  syncInspector,
  updateSelectedPosition,
} from "./inspector.js";
import { finishY, groundY, objectY, render } from "./render.js";
import { editor } from "./state.js";
import { showStatus } from "./status.js";
import {
  propTypeOptions,
  renderToolSettings,
  saveToolSettings,
  setTool,
  toolSettings,
} from "./tools.js";

let lastNudge = 0;

/** Move the selection with the arrow keys. Held or rapid presses are one undo step. */
export function nudgeSelection(key, big) {
  const position = selectedPosition();
  if (!position) return;
  const step = big ? 10 : 1;
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  if (!dx && !dy) return;
  const now = performance.now();
  if (now - lastNudge > 600) pushHistory();
  lastNudge = now;
  updateSelectedPosition(position[0] + dx, position[1] + dy);
  syncInspector();
  render();
}

/**
 * Copy blocks, apples, props, spikes and block points in place. A copied
 * point is inserted right after its original, as a corner.
 */
function duplicateItems(items) {
  const lists = OBJECT_LISTS();
  const copies = [];
  for (const item of items.filter((item) => item.type === "block")) {
    const copy = blocks()[item.index] && freshBlockCopy(blocks()[item.index]);
    if (!copy) continue;
    editor.trail.terrainBlocks = [...blocks(), copy];
    copies.push({ type: "block", index: blocks().length - 1 });
  }
  for (const item of items) {
    const list = lists[item.type];
    if (!list?.[item.index]) continue;
    list.push(structuredClone(list[item.index]));
    copies.push({ type: item.type, index: list.length - 1 });
  }
  // Points, one ring at a time.
  const rings = new Map();
  for (const point of items.filter((item) => item.type === "point")) {
    const key = `${point.blockIndex}:${point.boundaryIndex}`;
    if (!rings.has(key)) rings.set(key, { ...point, indices: [] });
    rings.get(key).indices.push(point.index);
  }
  for (const ring of rings.values()) {
    const boundary = boundaryAt(ring);
    if (!boundary) continue;
    const nodes = boundary.nodes.slice();
    const sorted = [...new Set(ring.indices)].sort((a, b) => a - b);
    // Highest first, so each insertion leaves the lower indices where they are.
    for (const index of [...sorted].reverse())
      nodes.splice(index + 1, 0, {
        ...structuredClone(nodes[index]),
        id: nextId("n"),
        mode: "corner",
        in: null,
      });
    replaceBoundary(ring.blockIndex, ring.boundaryIndex, { ...boundary, nodes });
    // Each copy moves down by one for every selected point before it.
    sorted.forEach((index, order) =>
      copies.push({
        type: "point",
        blockIndex: ring.blockIndex,
        regionIndex: ring.regionIndex,
        boundaryIndex: ring.boundaryIndex,
        index: index + 1 + order,
      }),
    );
  }
  return makeSelection(copies);
}

/** Duplicate what an Alt-drag started on, and return the copy's selection. */
export function duplicateTarget(hit) {
  if (!hit) return null;
  const item =
    hit.kind === "blockEdge"
      ? { type: "block", index: hit.blockIndex }
      : itemFromHit(hit);
  // Alt-dragging part of a group copies the whole group.
  if (item && inGroup(item)) return duplicateItems(editor.selection.items);
  if (item) return duplicateItems([item]);
  // Start, finish and curve handles aren't duplicated.
  return null;
}

/** Step through prop types: the Prop tool's type, or else the selected prop's. */
export function cyclePropType(direction) {
  const types = propTypeOptions().map(([value]) => value);
  const next = (current) =>
    types[(types.indexOf(current) + direction + types.length) % types.length];
  if (editor.tool === "prop") {
    toolSettings.prop.type = next(toolSettings.prop.type);
    saveToolSettings();
    renderToolSettings();
  } else if (editor.selection?.kind === "prop") {
    const prop = editor.trail.props[editor.selection.index];
    pushHistory();
    prop.type = next(prop.type);
    if (prop.type === "sign" && typeof prop.text !== "string") prop.text = "";
    syncInspector();
  } else return;
  render();
}

/** Flip the Prop tool's next prop, or else the selected prop. */
export function toggleFlip() {
  if (editor.tool === "prop") {
    toolSettings.prop.flip = !toolSettings.prop.flip;
    saveToolSettings();
    renderToolSettings();
  } else if (
    editor.selection?.kind === "prop" &&
    canFlip(editor.trail.props[editor.selection.index].type)
  ) {
    pushHistory();
    const prop = editor.trail.props[editor.selection.index];
    if (prop.flip) delete prop.flip;
    else prop.flip = true;
    syncInspector();
  } else return;
  render();
}

// ---- Mixed selection: block points, apples, props and spikes -------------

export const OBJECT_LISTS = () => ({
  apple: editor.trail.apples,
  prop: editor.trail.props,
  spike: editor.trail.spikes,
});

export function sameItem(a, b) {
  if (a.type !== b.type || a.index !== b.index) return false;
  return (
    a.type !== "point" ||
    (a.blockIndex === b.blockIndex && a.boundaryIndex === b.boundaryIndex)
  );
}

/** The selectable item a hit refers to, or null (edges, rings, handles). */
export function itemFromHit(hit) {
  if (!hit) return null;
  if (hit.kind === "start" || hit.kind === "goal") return { type: hit.kind };
  if (hit.kind === "block") return { type: "block", index: hit.blockIndex };
  if (hit.kind === "blockPoint") {
    const { blockIndex, regionIndex, boundaryIndex, index } = hit;
    return { type: "point", blockIndex, regionIndex, boundaryIndex, index };
  }
  return OBJECT_LISTS()[hit.kind] ? { type: hit.kind, index: hit.index } : null;
}

/** The current selection as a list of items. */
export function selectionItems() {
  if (editor.selection?.kind === "items") return editor.selection.items.slice();
  const item = itemFromHit(editor.selection);
  return item ? [item] : [];
}

export function inGroup(item) {
  return (
    editor.selection?.kind === "items" &&
    editor.selection.items.some((other) => sameItem(other, item))
  );
}

/**
 * A selection for a list of items: nothing, the item itself, or a group.
 * Duplicates go, and so do points of a block that is in the group whole.
 */
export function makeSelection(list) {
  const whole = new Set(
    list.filter((item) => item.type === "block").map((item) => item.index),
  );
  const items = [];
  for (const item of list)
    if (
      !(item.type === "point" && whole.has(item.blockIndex)) &&
      !items.some((other) => sameItem(other, item))
    )
      items.push(item);
  if (!items.length) return null;
  if (items.length > 1) return { kind: "items", items };
  const [item] = items;
  if (item.type === "block")
    return { kind: "block", blockIndex: item.index, regionIndex: 0 };
  if (item.type === "point") {
    const { blockIndex, regionIndex, boundaryIndex, index } = item;
    return { kind: "blockPoint", blockIndex, regionIndex, boundaryIndex, index };
  }
  if (item.type === "start" || item.type === "goal") return { kind: item.type };
  return { kind: item.type, index: item.index };
}

export function blocksSelection(indices) {
  return makeSelection(indices.map((index) => ({ type: "block", index })));
}

export function groupTitle(items) {
  const picked = items.filter((item) => item.type === "block");
  if (picked.length !== items.length) return `${items.length} ITEMS`;
  return picked.every((item) => isBackWall(blocks()[item.index]))
    ? `${picked.length} BACK WALLS`
    : `${picked.length} BLOCKS`;
}

/** Every point of a block, outer rings first. */
export function blockNodes(block) {
  return boundariesOf(block).flatMap((boundary) => boundary.nodes);
}

export function itemPosition(item) {
  if (item.type === "block") {
    const nodes = blocks()[item.index] ? blockNodes(blocks()[item.index]) : [];
    if (!nodes.length) return null;
    return [
      nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
    ];
  }
  if (item.type === "point") {
    const node = boundaryAt(item)?.nodes[item.index];
    return node ? [node.x, node.y] : null;
  }
  if (item.type === "start") {
    const { x, y } = editor.trail.start;
    return [x, Number.isFinite(y) ? y : groundY(x) - 12];
  }
  if (item.type === "goal") return [editor.trail.goal, finishY()];
  const object = OBJECT_LISTS()[item.type][item.index];
  if (!object) return null;
  if (item.type === "spike") return [object.x, object.y];
  return [object.x, objectY(object, item.type === "apple" ? 60 : 0)];
}

export function itemsCentre(items) {
  const positions = items.map(itemPosition).filter(Boolean);
  if (!positions.length) return null;
  return [
    positions.reduce((sum, [x]) => sum + x, 0) / positions.length,
    positions.reduce((sum, [, y]) => sum + y, 0) / positions.length,
  ];
}

/** Move the whole group so its centre lands on (x, y). */
export function moveItems(x, y) {
  const items = editor.selection.items;
  const centre = itemsCentre(items);
  if (!centre) return;
  const dx = x - centre[0],
    dy = y - centre[1];
  // Every object's height is read before any point moves, so a ground-anchored
  // object doesn't jump when the ground under it moves in the same drag.
  const before = items.map(itemPosition);
  items.forEach((item, i) => {
    if (item.type === "block") {
      if (blocks()[item.index])
        replaceBlock(item.index, moveBlock(blocks()[item.index], dx, dy));
      return;
    }
    if (item.type === "point") {
      const node = boundaryAt(item)?.nodes[item.index];
      if (!node) return;
      node.x += dx;
      node.y += dy;
      if (node.in) node.in = [node.in[0] + dx, node.in[1] + dy];
      if (node.out) node.out = [node.out[0] + dx, node.out[1] + dy];
      return;
    }
    if (!before[i]) return;
    // Like dragging one on its own, this fixes a ground-anchored object's height.
    if (item.type === "start") {
      editor.trail.start.x = before[i][0] + dx;
      editor.trail.start.y = before[i][1] + dy;
      return;
    }
    if (item.type === "goal") {
      editor.trail.goal = before[i][0] + dx;
      editor.trail.finishY = before[i][1] + dy;
      return;
    }
    const object = OBJECT_LISTS()[item.type][item.index];
    if (!object) return;
    object.x = before[i][0] + dx;
    object.y = before[i][1] + dy;
  });
}

/**
 * Everything inside the box between two world points: blocks that are wholly
 * inside, points of the others, and apples, props and spikes.
 */
function itemsInBox(from, to) {
  const left = Math.min(from.x, to.x),
    right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y),
    bottom = Math.max(from.y, to.y);
  const inside = ([x, y]) =>
    x >= left && x <= right && y >= top && y <= bottom;
  const found = [];
  for (const [blockIndex, block] of blocks().entries()) {
    const nodes = blockNodes(block);
    if (nodes.length && nodes.every((node) => inside([node.x, node.y]))) {
      found.push({ type: "block", index: blockIndex });
      continue;
    }
    boundaryEntries(block).forEach(
      ({ boundary, regionIndex }, boundaryIndex) => {
        boundary.nodes.forEach((node, index) => {
          if (inside([node.x, node.y]))
            found.push({
              type: "point",
              blockIndex,
              regionIndex,
              boundaryIndex,
              index,
            });
        });
      },
    );
  }
  for (const [type, list] of Object.entries(OBJECT_LISTS())) {
    list.forEach((_, index) => {
      const item = { type, index };
      const position = itemPosition(item);
      if (position && inside(position)) found.push(item);
    });
  }
  for (const item of [{ type: "start" }, { type: "goal" }])
    if (inside(itemPosition(item))) found.push(item);
  return found;
}

export function finishMarquee() {
  const items = [...editor.marquee.base];
  for (const item of itemsInBox(editor.marquee.from, editor.marquee.to))
    if (!items.some((other) => sameItem(other, item))) items.push(item);
  editor.selection = makeSelection(items);
}

/**
 * Delete a group. Objects go highest index first, so earlier indices stay
 * valid. A ring left with fewer than three points is removed whole: a cave
 * fills in, and an outer ring takes its solid with it. Blocks go last, all at
 * once, so the points above still find theirs.
 */
export function deleteItems(items) {
  const removed = new Set(
    items.filter((item) => item.type === "block").map((item) => item.index),
  );
  for (const [type, list] of Object.entries(OBJECT_LISTS())) {
    const indices = items
      .filter((item) => item.type === type)
      .map((item) => item.index);
    for (const index of indices.sort((a, b) => b - a)) list.splice(index, 1);
  }
  const byBlock = new Map();
  for (const point of items.filter((item) => item.type === "point")) {
    if (removed.has(point.blockIndex)) continue;
    if (!byBlock.has(point.blockIndex))
      byBlock.set(point.blockIndex, new Map());
    const rings = byBlock.get(point.blockIndex);
    if (!rings.has(point.boundaryIndex))
      rings.set(point.boundaryIndex, []);
    rings.get(point.boundaryIndex).push(point.index);
  }
  for (const [blockIndex, rings] of byBlock) {
    let block = blocks()[blockIndex];
    if (!block) continue;
    // Highest ring first, so removing one never shifts the index of the next.
    for (const boundaryIndex of [...rings.keys()].sort((a, b) => b - a)) {
      const boundary = boundariesOf(block)[boundaryIndex];
      if (!boundary) continue;
      const indices = rings.get(boundaryIndex);
      block =
        boundary.nodes.length - indices.length < 3
          ? withBoundary(block, boundaryIndex, null)
          : withBoundary(block, boundaryIndex, {
              ...removeBoundaryNodes(boundary, indices),
              id: boundary.id,
            });
    }
    if (block.regions.length) replaceBlock(blockIndex, block);
    else removed.add(blockIndex);
  }
  if (removed.size)
    editor.trail.terrainBlocks = blocks().filter((_, index) => !removed.has(index));
}

export function deleteSelection() {
  if (!editor.selection || ["goal", "start"].includes(editor.selection.kind)) return;
  const kind = editor.selection.kind;
  if (kind === "items") {
    pushHistory();
    deleteItems(editor.selection.items);
    editor.selection = null;
    syncInspector();
    render();
    return;
  }
  if (kind === "blockHandle") {
    // Deleting a curve handle straightens that side of the point.
    const boundary = boundaryAt(editor.selection);
    if (!boundary?.nodes[editor.selection.index]) return;
    pushHistory();
    const nodes = boundary.nodes.map((node, index) =>
      index === editor.selection.index ? { ...node, [editor.selection.side]: null } : node,
    );
    replaceBoundary(editor.selection.blockIndex, editor.selection.boundaryIndex, {
      ...boundary,
      nodes,
    });
    editor.selection = { ...editor.selection, kind: "blockPoint" };
  } else if (kind === "blockPoint" || kind === "blockEdge") {
    // Removing a node from a ring is only safe while the ring can still close.
    const boundary = boundaryAt(editor.selection);
    if (!boundary) return;
    if (boundary.nodes.length <= 3) {
      showStatus(
        "warning",
        "A ring needs at least three points. Delete the whole ring instead (Alt-click it).",
      );
      return;
    }
    pushHistory();
    replaceBoundary(editor.selection.blockIndex, editor.selection.boundaryIndex, {
      ...removeBoundaryNodes(boundary, [editor.selection.index]),
      id: boundary.id,
    });
    editor.selection = {
      kind: "block",
      blockIndex: editor.selection.blockIndex,
      regionIndex: 0,
    };
  } else if (kind === "blockBoundary") {
    // Deleting a cave fills it back in; deleting an outer boundary removes
    // that piece of solid, and the block with it if it was the last piece.
    const block = blocks()[editor.selection.blockIndex];
    if (!block || !boundaryAt(editor.selection)) return;
    pushHistory();
    const next = withBoundary(block, editor.selection.boundaryIndex, null);
    if (next.regions.length) {
      replaceBlock(editor.selection.blockIndex, next);
      editor.selection = {
        kind: "block",
        blockIndex: editor.selection.blockIndex,
        regionIndex: 0,
      };
    } else {
      editor.trail.terrainBlocks = blocks().filter(
        (_, index) => index !== editor.selection.blockIndex,
      );
      editor.selection = null;
    }
  } else if (kind === "block") {
    pushHistory();
    const removed = new Set(selectedBlocks());
    editor.trail.terrainBlocks = blocks().filter((_, index) => !removed.has(index));
    editor.selection = null;
  } else if (kind === "apple") {
    pushHistory();
    editor.trail.apples.splice(editor.selection.index, 1);
    editor.selection = null;
  } else if (kind === "prop") {
    pushHistory();
    editor.trail.props.splice(editor.selection.index, 1);
    editor.selection = null;
  } else if (kind === "spike") {
    pushHistory();
    editor.trail.spikes.splice(editor.selection.index, 1);
    editor.selection = null;
  } else return;
  syncInspector();
  render();
}

/** Every block, apple, prop and spike, and the start and finish. */
export function selectAll() {
  const items = blocks().map((_, index) => ({ type: "block", index }));
  for (const [type, list] of Object.entries(OBJECT_LISTS()))
    list.forEach((_, index) => items.push({ type, index }));
  items.push({ type: "start" }, { type: "goal" });
  editor.selection = makeSelection(items);
  setTool("select");
  syncInspector();
  render();
}
