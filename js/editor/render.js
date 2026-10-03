// Drawing the trail, selection handles and live previews onto the canvas.
import {
  PAINTED_PROPS,
  propAlignmentSlope,
  propGroundOffset,
  propWallFit,
} from "../drawing.js";
import { FINISH_FLOWER_RADIUS } from "../finish.js";
import { store } from "../local-store.js";
import { invalidateTerrain, terrainGeometry } from "../terrain.js";
import { terrainColumnSpans } from "../terrain-runtime.js";
import { finishFlower, finishHeight, surfaceBelow } from "../trail-schema.js";
import { terrainMaterials } from "../trails.js";
import {
  blockSelected,
  blocks,
  boundaryEntries,
  traceBoundary,
  traceRegion,
} from "./blocks.js";
import { $, art, canvas, ctx, terrainArt } from "./dom.js";
import { gridSpacing } from "./snap.js";
import { editor } from "./state.js";
import { PLACING_TOOLS, toolSettings } from "./tools.js";
import { viewportSize } from "./view.js";

export const GAME_ART_KEY = "hjulben-editor-game-art-v1";

/**
 * The editor edits blocks in place while dragging, so the compiled terrain the
 * renderer, surface queries and validation share has to be told. A cheap
 * fingerprint of everything that shapes the terrain is compared each time it
 * is needed, and the trail is invalidated only when it has really changed.
 */
let terrainFingerprint = null;
let terrainTrail = null;

export function syncTerrain() {
  // A redraw that only moved the view can't have changed the terrain.
  if (viewOnly && terrainTrail === editor.trail && terrainFingerprint !== null)
    return;
  let hash = 0x811c9dc5;
  const mix = (value) => {
    hash = Math.imul(hash ^ (Math.round(value * 64) | 0), 0x01000193) >>> 0;
  };
  const text = (value) => {
    for (let index = 0; index < value.length; index++)
      mix(value.charCodeAt(index));
  };
  mix(editor.trail.fallY || 0);
  for (const block of blocks()) {
    text(String(block.material));
    mix(block.regions.length);
    for (const region of block.regions) {
      for (const boundary of [region.outer, ...region.inner]) {
        mix(boundary.nodes.length);
        for (const node of boundary.nodes) {
          mix(node.x);
          mix(node.y);
          if (node.in) {
            mix(node.in[0]);
            mix(node.in[1]);
          }
          if (node.out) {
            mix(node.out[0]);
            mix(node.out[1]);
          }
          text(node.edge || "");
          text(node.mode || "");
        }
      }
    }
  }
  const fingerprint = `${hash}:${blocks().length}`;
  // Undo and loading swap in another trail object, whose terrain is not an edit.
  const sameTrail = terrainTrail === editor.trail;
  terrainTrail = editor.trail;
  if (fingerprint !== terrainFingerprint) {
    // Read while the compiled terrain is still the one on screen.
    const anchored =
      terrainFingerprint !== null && sameTrail ? groundAnchoredObjects() : [];
    terrainFingerprint = fingerprint;
    invalidateTerrain(editor.trail);
    keepCoveredObjectsInPlace(anchored);
  }
}

/**
 * Objects without a height of their own (the start, the finish, props and
 * apples) stand on the topmost surface at their x. Each is listed with the
 * floor it stands on now and a way to pin its height.
 */
function groundAnchoredObjects() {
  const trail = editor.trail;
  const found = [];
  const add = (x, pin) => {
    const floor = surfaceBelow(trail, x, null);
    if (floor) found.push({ x, floor: floor.y, pin });
  };
  if (trail.start && !Number.isFinite(trail.start.y))
    add(trail.start.x, (y) => (trail.start.y = y - 12));
  if (!Number.isFinite(trail.finishY))
    add(trail.goal, (y) => (trail.finishY = y));
  for (const prop of trail.props || [])
    if (!Number.isFinite(prop.y)) add(prop.x, (y) => (prop.y = y));
  for (const apple of trail.apples || [])
    if (!Number.isFinite(apple.y)) add(apple.x, (y) => (apple.y = y - 60));
  return found;
}

/**
 * Terrain that now covers a ground-anchored object, like a roof or a cave
 * ceiling dragged over it, would lift it onto the new top. Pin it to the floor
 * it was standing on instead. Ground raised or lowered beneath an object still
 * carries it along.
 */
function keepCoveredObjectsInPlace(anchored) {
  for (const { x, floor, pin } of anchored) {
    const y = restingY(x, floor);
    if (y !== null) pin(y);
  }
}

/**
 * The floor under a point: the top of the solid it is inside, else the first
 * surface below it. Null when there is none.
 */
export function floorUnder(x, y) {
  const compiled = terrainGeometry(editor.trail);
  if (!compiled || !Number.isFinite(y)) return null;
  for (const span of terrainColumnSpans(compiled, x)) {
    if (span.bottom < y - 0.5) continue;
    return span.top;
  }
  return null;
}

/**
 * Where something standing at (x, y) should rest. Null when the floor it is on
 * is the topmost surface, so it can stay ground-anchored; otherwise an explicit
 * height, so a roof or cave ceiling above it doesn't lift it onto the top.
 */
export function restingY(x, y) {
  const top = surfaceBelow(editor.trail, x, null);
  if (!top) return null;
  const floor = floorUnder(x, y - 1);
  if (floor !== null && Math.abs(floor - top.y) < 0.5) return null;
  return floor ?? y;
}

// Below this zoom the game art is too small to read and slow to draw, so the
// plain terrain is drawn instead.
const GAME_ART_MIN_ZOOM = 0.35;

function showGameArt() {
  return editor.gameArt && editor.zoom >= GAME_ART_MIN_ZOOM;
}

function drawBlocks() {
  const gameArt = showGameArt();
  for (const [blockIndex, block] of blocks().entries()) {
    const material = terrainMaterials[block.material] || terrainMaterials.grass;
    // With game art showing, the blocks are already drawn exactly as they
    // will be ridden, so only their outlines are added for editing.
    if (!gameArt) {
      for (const region of block.regions) {
        traceRegion(region);
        // Even-odd fill so a region's caves stay open.
        ctx.fillStyle = material.fill;
        ctx.fill("evenodd");
      }
    }
    // The outline is stroked one boundary at a time: stroke() takes no fill rule,
    // and tracing a whole region at once would also stroke the shared seam where
    // a cave meets its own outer boundary twice.
    const selected = blockSelected(blockIndex);
    boundaryEntries(block).forEach(({ boundary }, boundaryIndex) => {
      const highlighted =
        selected ||
        (editor.selection?.kind === "blockBoundary" &&
          editor.selection.blockIndex === blockIndex &&
          editor.selection.boundaryIndex === boundaryIndex);
      ctx.strokeStyle = highlighted
        ? "#fff3be"
        : gameArt
          ? "#17262b99"
          : material.edge;
      ctx.lineWidth = highlighted
        ? 3 / editor.zoom
        : gameArt
          ? 1.5 / editor.zoom
          : Math.max(2.5, 1.5 / editor.zoom);
      if (highlighted) ctx.setLineDash([8 / editor.zoom, 5 / editor.zoom]);
      ctx.beginPath();
      traceBoundary(boundary);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
}

/** The outline a drag is about to draw, or the cut preview, in a muted colour. */
function drawPendingShape(shape) {
  if (!shape || shape.points.length < 2) return;
  ctx.beginPath();
  shape.points.forEach(([x, y], index) =>
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
  );
  if (shape.closed) ctx.closePath();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = 2 / editor.zoom;
  ctx.setLineDash([6 / editor.zoom, 4 / editor.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (shape.closed && shape.fill) {
    ctx.fillStyle = shape.fill;
    ctx.fill();
  }
}

function drawTerrain() {
  if (showGameArt()) {
    // The game's own renderer, fed the same compiled terrain the game rides.
    const { width, height } = viewportSize();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    terrainArt.draw(ctx, editor.trail, editor.cameraX, editor.cameraY, width / editor.zoom, height / editor.zoom);
    ctx.restore();
  }
  // Graffiti is painted onto the rock, so it goes straight over the terrain.
  for (const prop of editor.trail.props || [])
    if (PAINTED_PROPS.has(prop.type)) art.drawWallPaint(editor.trail, prop);
  drawBlocks();
  drawPendingShape(editor.pendingShape);
}

function drawGrid(width, height) {
  const spacing = gridSpacing(editor.zoom);
  const left = Math.floor(editor.cameraX / spacing) * spacing;
  const top = Math.floor(editor.cameraY / spacing) * spacing;
  const right = editor.cameraX + width / editor.zoom;
  const bottom = editor.cameraY + height / editor.zoom;
  ctx.beginPath();
  for (let x = left; x <= right; x += spacing) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = top; y <= bottom; y += spacing) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.strokeStyle = "#263b3d2c";
  ctx.lineWidth = 1 / editor.zoom;
  ctx.stroke();
}

export function objectY(object, offset = 0) {
  return Number.isFinite(object.y) ? object.y : groundY(object.x) - offset;
}

/** The ground height at an x: the topmost surface at or below `referenceY`. */
export function groundY(x, referenceY = null) {
  const surface = surfaceBelow(editor.trail, x, referenceY);
  return surface ? surface.y : editor.trail.fallY || 620;
}

/**
 * Where the finish flag stands: an explicit height when the author has set one,
 * else the surface below it. Shared with the game so the flag is drawn where the
 * editor put it.
 */
export function finishY() {
  return finishHeight(editor.trail);
}

function drawProps(layer) {
  for (const prop of editor.trail.props || []) {
    if (prop.layer !== layer || PAINTED_PROPS.has(prop.type)) continue;
    art.drawProp(
      prop.type,
      prop.x,
      objectY(prop),
      1,
      propAlignmentSlope(editor.trail, prop),
      propGroundOffset(editor.trail, prop),
      prop.text,
      propWallFit(editor.trail, prop),
      prop.flip,
    );
  }
}

const GLOWING_PROPS = new Set(["lamp", "crane", "lantern", "mushrooms"]);

/** Street lamps and crane lights after dark; lanterns and mushrooms always. */
function drawPropGlows(dark) {
  for (const prop of editor.trail.props || []) {
    if (!GLOWING_PROPS.has(prop.type)) continue;
    art.drawPropGlow(
      prop.type,
      prop.x,
      objectY(prop),
      propGroundOffset(editor.trail, prop),
      prop.flip,
      0,
      { dark, trail: editor.trail, prop, fit: propWallFit(editor.trail, prop) },
    );
  }
}

function drawSpikes() {
  for (const [index, spike] of editor.trail.spikes.entries()) {
    art.drawSpike(spike.x, spike.y, spike.radius);
    if (!isSelected("spike", index)) continue;
    ctx.beginPath();
    ctx.arc(spike.x, spike.y, spike.radius * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff3be";
    ctx.lineWidth = 2 / editor.zoom;
    ctx.setLineDash([6 / editor.zoom, 4 / editor.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawObjects() {
  drawSpikes();
  for (const apple of editor.trail.apples)
    art.drawApple(apple.x, objectY(apple, 60));
  art.drawFlag(editor.trail.goal, finishY(), true, 0);
  if (editor.selection?.kind === "goal") {
    // The petals the bike has to touch.
    const flower = finishFlower(editor.trail);
    ctx.beginPath();
    ctx.arc(flower.x, flower.y, FINISH_FLOWER_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff3be";
    ctx.lineWidth = 2 / editor.zoom;
    ctx.setLineDash([6 / editor.zoom, 4 / editor.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawProps("front");
  const startY = Number.isFinite(editor.trail.start.y)
    ? editor.trail.start.y
    : groundY(editor.trail.start.x) - 12;
  ctx.save();
  ctx.globalAlpha = 0.72;
  art.drawBike({
    rear: { x: editor.trail.start.x - 25, y: startY, spin: 0, compression: 0 },
    front: { x: editor.trail.start.x + 25, y: startY, spin: 0, compression: 0 },
    mx: editor.trail.start.x,
    my: startY,
    angle: 0,
    length: 50,
    facing: editor.trail.start.facing,
    flipVisual: editor.trail.start.facing,
    rider: "male",
  });
  ctx.restore();
}

function isSelected(kind, index) {
  if (editor.selection?.kind === "items")
    return editor.selection.items.some(
      (item) => item.type === kind && item.index === index,
    );
  return editor.selection?.kind === kind && editor.selection.index === index;
}

/** Is this the node whose curve handles are showing: the selected point, or the owner of the selected handle? */
export function isActiveNode(blockIndex, boundaryIndex, nodeIndex) {
  return (
    (editor.selection?.kind === "blockPoint" || editor.selection?.kind === "blockHandle") &&
    editor.selection.blockIndex === blockIndex &&
    editor.selection.boundaryIndex === boundaryIndex &&
    editor.selection.index === nodeIndex
  );
}

/** Is this particular node or handle the current selection? */
function isBlockPart(blockIndex, boundaryIndex, nodeIndex, side = null) {
  if (editor.selection?.kind === "items")
    return (
      side === null &&
      editor.selection.items.some(
        (item) =>
          item.type === "point" &&
          item.blockIndex === blockIndex &&
          item.boundaryIndex === boundaryIndex &&
          item.index === nodeIndex,
      )
    );
  if (
    editor.selection?.kind !== "blockPoint" &&
    editor.selection?.kind !== "blockHandle" &&
    editor.selection?.kind !== "blockBoundary"
  )
    return false;
  if (
    editor.selection.blockIndex !== blockIndex ||
    editor.selection.boundaryIndex !== boundaryIndex
  )
    return false;
  if (editor.selection.kind === "blockBoundary") return true;
  if (editor.selection.index !== nodeIndex) return false;
  return editor.selection.kind !== "blockHandle" || editor.selection.side === side;
}

function drawHandles() {
  const radius = 5 / editor.zoom;
  const drawHandle = (x, y, selected, color = "#ff8952") => {
    ctx.fillStyle = selected ? "#fff3be" : color;
    ctx.strokeStyle = "#17262b";
    ctx.lineWidth = 2 / editor.zoom;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  for (const [blockIndex, block] of blocks().entries()) {
    boundaryEntries(block).forEach(({ boundary, hole }, boundaryIndex) => {
      boundary.nodes.forEach((node, index) => {
        drawHandle(
          node.x,
          node.y,
          isBlockPart(blockIndex, boundaryIndex, index),
          hole >= 0 ? "#83d1ce" : "#f0b45f",
        );
        // Curve handles are only drawn for the active node, so the canvas
        // stays readable, and only those can be grabbed.
        if (!isActiveNode(blockIndex, boundaryIndex, index)) return;
        for (const side of ["in", "out"]) {
          const handle = node[side];
          if (!handle) continue;
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(handle[0], handle[1]);
          ctx.strokeStyle = "#e65e5699";
          ctx.lineWidth = 1.5 / editor.zoom;
          ctx.stroke();
          drawHandle(
            handle[0],
            handle[1],
            editor.selection.kind === "blockHandle" && editor.selection.side === side,
            "#e65e56",
          );
        }
      });
    });
  }
  editor.trail.apples.forEach((apple, index) =>
    drawHandle(
      apple.x,
      objectY(apple, 60),
      isSelected("apple", index),
      "#ef8150",
    ),
  );
  editor.trail.props.forEach((prop, index) =>
    drawHandle(prop.x, objectY(prop), isSelected("prop", index), "#83d1ce"),
  );
  editor.trail.spikes.forEach((spike, index) =>
    drawHandle(spike.x, spike.y, isSelected("spike", index), "#e65e56"),
  );
  const startY = Number.isFinite(editor.trail.start.y)
    ? editor.trail.start.y
    : groundY(editor.trail.start.x) - 12;
  drawHandle(editor.trail.start.x, startY, isSelected("start"), "#c6dfa9");
  drawHandle(editor.trail.goal, finishY(), isSelected("goal"), "#c6dfa9");
}

let viewOnly = false;

/**
 * Redraw after only the view or a preview changed (panning, zooming, hovering,
 * box-selecting), skipping the check for terrain edits. Anything that edits the
 * trail must call render().
 */
export function renderView() {
  viewOnly = true;
  try {
    render();
  } finally {
    viewOnly = false;
  }
}

export function render() {
  // The inspector only has something to show for a selection.
  const inspector = $("inspector");
  const open = Boolean(editor.selection);
  if (inspector && inspector.classList.contains("open") !== open) {
    inspector.classList.toggle("open", open);
    inspector.inert = !open;
  }
  const { width, height } = viewportSize();
  if (!width || !height) return;
  syncTerrain();
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  art.drawBackground({
    width,
    height,
    palette: editor.trail,
    cameraX: editor.cameraX,
    cameraY: editor.cameraY,
    full: true,
  });
  ctx.save();
  ctx.translate(-editor.cameraX * editor.zoom, -editor.cameraY * editor.zoom);
  ctx.scale(editor.zoom, editor.zoom);
  drawGrid(width, height);
  drawProps("back");
  drawTerrain();
  drawObjects();
  drawPlacementPreview();
  drawPropGlows(
    art.drawTimeTint(editor.trail, editor.cameraX, editor.cameraY, width / editor.zoom, height / editor.zoom),
  );
  drawHandles();
  drawSnapGuide();
  drawMarquee();
  ctx.restore();
}

/** While a Shift-drag is snapping, show the line it is locked to and its angle and length. */
function drawSnapGuide() {
  if (!editor.snapGuide) return;
  const { from, to, angle, length } = editor.snapGuide;
  ctx.save();
  ctx.setLineDash([6 / editor.zoom, 4 / editor.zoom]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = "#fff3be";
  ctx.lineWidth = 1.5 / editor.zoom;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 8 / editor.zoom, 0, Math.PI * 2);
  ctx.strokeStyle = "#fff3be";
  ctx.stroke();
  ctx.font = `${12 / editor.zoom}px system-ui, sans-serif`;
  const label = `${Math.round(angle * 10) / 10}\u00b0 \u00b7 ${Math.round(length)}`;
  const x = to.x + 12 / editor.zoom,
    y = to.y - 12 / editor.zoom;
  ctx.lineWidth = 3 / editor.zoom;
  ctx.strokeStyle = "#17262b";
  ctx.strokeText(label, x, y);
  ctx.fillStyle = "#fff3be";
  ctx.fillText(label, x, y);
  ctx.restore();
}

/** A faded copy of what the current tool will place, under the cursor. */
function drawPlacementPreview() {
  if (!editor.hoverPoint || !PLACING_TOOLS.has(editor.tool)) return;
  const { x, y } = editor.hoverPoint;
  if (editor.tool === "prop") {
    const prop = { x, y, type: toolSettings.prop.type, layer: "back" };
    art.drawProp(
      prop.type,
      x,
      y,
      0.5,
      propAlignmentSlope(editor.trail, prop),
      propGroundOffset(editor.trail, prop),
      "",
      propWallFit(editor.trail, prop),
      toolSettings.prop.flip,
    );
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  if (editor.tool === "apple") art.drawApple(x, y);
  else art.drawSpike(x, y, toolSettings.spike.radius);
  ctx.restore();
}

function drawMarquee() {
  if (!editor.marquee) return;
  const x = Math.min(editor.marquee.from.x, editor.marquee.to.x),
    y = Math.min(editor.marquee.from.y, editor.marquee.to.y);
  const w = Math.abs(editor.marquee.to.x - editor.marquee.from.x),
    h = Math.abs(editor.marquee.to.y - editor.marquee.from.y);
  ctx.fillStyle = "#fff3be22";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#fff3be";
  ctx.lineWidth = 1.5 / editor.zoom;
  ctx.setLineDash([6 / editor.zoom, 4 / editor.zoom]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}
