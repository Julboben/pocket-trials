import {
  trailEntries,
  terrainMaterials,
  detectDevServer,
  saveTrailFile,
  deleteTrailFile,
  uniqueCustomFile,
  saveBrowserTrail,
  deleteBrowserTrail,
  PLAYTEST_TRAIL_KEY,
  PLAYTEST_EXIT_MESSAGE,
} from "./trails.js";
import { invalidateTerrain } from "./terrain.js";
import {
  createDrawingTools,
  createGameArt,
  canFlip,
  propAlignmentSlope,
  propGroundOffset,
  propWallFit,
} from "./drawing.js";
import {
  cloneTrail,
  createBlankTrail,
  normalizeTrail,
  validateTrail,
  trailToModule,
  SPIKE_RADIUS,
  surfaceBelow,
  finishHeight,
  finishFlower,
} from "./trail-schema.js";
import { FINISH_FLOWER_RADIUS } from "./finish.js";
import {
  cutBlock,
  moveBlock,
  insertBoundaryNode,
  removeBoundaryNodes,
  setBoundaryEdge,
  setNodeMode,
  isCurvedEdge,
  pointInRegion,
  edgeCurve,
  rectangleBlock,
  normalizeBlocks,
  nextId,
} from "./terrain-geometry.js";
import { createTerrainRenderer } from "./terrain-render.js";
import { gridSpacing, snapToAngleAndGrid } from "./editor-snap.js";

const $ = (id) => document.getElementById(id);
const canvas = $("editor-canvas");
const wrap = $("canvas-wrap");
const ctx = canvas.getContext("2d");
const art = createGameArt(ctx);
const tools = createDrawingTools(ctx);
const DRAFT_PREFIX = "pocket-trials-editor-draft-v1-";
const CURRENT_TRAIL_KEY = "pocket-trials-editor-current-v1";

function storedTrailIndex() {
  try {
    const index = trailEntries.findIndex(
      (entry) => entry.id === localStorage.getItem(CURRENT_TRAIL_KEY),
    );
    return Math.max(0, index);
  } catch (_) {
    return 0;
  }
}

function rememberTrail() {
  try {
    localStorage.setItem(CURRENT_TRAIL_KEY, trailEntries[trailIndex].id);
  } catch (_) {}
}

let devServer = false;
let trailIndex = storedTrailIndex();
let trail = loadTrailData(trailIndex);
let tool = "select";
let selection = null;
let cameraX = 0;
let cameraY = 0;
let zoom = 1;
let dragging = false;
let panning = false;
let spaceHeld = false;
let pointerStart = null;
let gestureStartZoom = 1;
let gestureAnchor = null;
let history = [];
let future = [];
// The trail as it was when a drag began. It becomes an undo step only once the
// drag actually moves something, so a plain click never leaves an empty one.
let dragSnapshot = null;
let dragOrigin = null;
let lastDragPointer = null;
let snapGuide = null;
const terrainArt = createTerrainRenderer();
const GAME_ART_KEY = "pocket-trials-editor-game-art-v1";
let gameArt = (() => {
  try {
    return localStorage.getItem(GAME_ART_KEY) === "1";
  } catch (_) {
    return false;
  }
})();
// The Block or Cut drag currently in progress, drawn live so the author sees the
// shape before committing it.
let pendingShape = null;
let pendingKind = null;
// The Select tool's selection box while it is being dragged.
let marquee = null;
// An Alt press that becomes a duplicate once the mouse moves.
let altPress = null;

function loadTrailData(index) {
  const stored = trailEntries[index]?.trail;
  try {
    const draft = JSON.parse(
      localStorage.getItem(DRAFT_PREFIX + trailEntries[index].id) || "null",
    );
    return normalizeTrail(draft || stored || createBlankTrail(index), index);
  } catch (_) {
    return normalizeTrail(stored || createBlankTrail(index), index);
  }
}

function snapshot() {
  return JSON.stringify(trail);
}

function pushHistory(state = snapshot()) {
  history.push(state);
  if (history.length > 80) history.shift();
  future = [];
  updateHistoryButtons();
}

function restore(serialized) {
  trail = normalizeTrail(JSON.parse(serialized), trailIndex);
  selection = null;
  syncInspector();
  render();
}

function undo() {
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
  updateHistoryButtons();
}

function redo() {
  if (!future.length) return;
  history.push(snapshot());
  restore(future.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("undo").disabled = history.length === 0;
  $("redo").disabled = future.length === 0;
}

const TOOL_SETTINGS_KEY = "pocket-trials-editor-tool-settings-v1";
const BASE_MATERIAL = "base";
const propTypeOptions = () =>
  [...$("selection-prop-type").options].map((option) => [
    option.value,
    option.textContent,
  ]);
const materialOptions = () => [
  [BASE_MATERIAL, "Trail base material"],
  ...Object.keys(terrainMaterials).map((name) => [name, name.toUpperCase()]),
];

const TOOL_INFO = {
  select: {
    title: "Select",
    hint: "Click a block to move it, or a point on its edge to move just that point; a selected point shows its curve handles. Alt-click an edge or inside a cave to select that whole ring, and Shift-click blocks to select several. Hold Shift while dragging a point or curve handle to lock it to 15° steps from its neighbour and to the grid. Double-click an edge to add a point, Delete removes the selection, and Escape backs out. Empty cave space selects nothing, so a cave never picks the block around it. Shortcuts: V B C A S P G F H pick tools, arrows nudge (Shift ×10), Alt-drag duplicates what you drag (Alt-click still selects a whole ring), [ ] change prop type, = − 0 zoom, Home returns to the start. Drag from empty space (or Cmd/Ctrl-drag anywhere) to box-select points, apples, props and spikes; Shift adds to the selection, and Delete removes them all.",
  },
  pan: {
    title: "Pan",
    hint: "Drag to move the view. Hold Space or use the middle mouse button to pan with any tool.",
  },
  block: {
    title: "Block",
    hint: "Drag an outline to draw a new solid block in that shape. Hold Alt for a rectangle and Shift to snap to the grid; both can be switched mid-drag. It can be drawn anywhere, including inside another block's cave. The tool stays active; Esc returns to Select.",
    fields: [
      {
        key: "material",
        label: "Material",
        type: "select",
        options: materialOptions,
      },
    ],
  },
  cut: {
    title: "Cut",
    hint: "Drag an outline over a block to remove that shape from it. Hold Alt for a rectangle and Shift to snap to the grid. Inside solid it makes a cave, across an edge it opens an entrance, and all the way through it splits the block in two. It cuts the selected block, or else the topmost block it touches. Escape cancels.",
  },
  apple: {
    title: "Apple",
    hint: "Click to place an apple exactly where you click. Every apple must be collected to finish. The tool stays active; Esc returns to Select.",
  },
  spike: {
    title: "Spike",
    hint: "Click to place a spinning spike. Touching it with the wheels or rider is fatal. The tool stays active; Esc returns to Select.",
    fields: [
      {
        key: "radius",
        label: "Radius",
        type: "number",
        min: SPIKE_RADIUS.min,
        max: SPIKE_RADIUS.max,
        step: 1,
      },
      {
        key: "spin",
        label: "Spin (turns/s, negative = counter-clockwise)",
        type: "number",
        step: 0.1,
      },
    ],
  },
  prop: {
    title: "Prop",
    hint: "Click to place decorative scenery. Props do not collide. The tool stays active; Esc returns to Select.",
    fields: [
      { key: "type", label: "Prop", type: "select", options: propTypeOptions },
      {
        key: "layer",
        label: "Layer",
        type: "select",
        options: () => [
          ["back", "Back"],
          ["front", "Front"],
        ],
      },
      {
        key: "flip",
        label: "Flip",
        type: "toggle",
        options: () => [
          ["false", "Normal"],
          ["true", "Flipped"],
        ],
      },
    ],
  },
  start: {
    title: "Start",
    hint: "Click to move the start position. A trail always has exactly one start.",
    fields: [
      {
        key: "facing",
        label: "Facing",
        type: "select",
        options: () => [
          ["1", "Right"],
          ["-1", "Left"],
        ],
      },
    ],
  },
  finish: {
    title: "Finish",
    hint: "Click to move the finish onto the surface at that x, then drag it up or down to float it in the air. The run ends when the bike touches the flower.",
  },
};

const DEFAULT_TOOL_SETTINGS = {
  block: { material: BASE_MATERIAL },
  spike: { radius: SPIKE_RADIUS.default, spin: 1 },
  prop: { type: "tree", layer: "back", flip: false },
  start: { facing: "1" },
};

// Single-key tool shortcuts, used while the canvas has focus.
const TOOL_KEYS = {
  KeyV: "select",
  KeyH: "pan",
  KeyB: "block",
  KeyC: "cut",
  KeyA: "apple",
  KeyS: "spike",
  KeyP: "prop",
  KeyG: "start",
  KeyF: "finish",
};
const TOOL_KEY_LABELS = Object.fromEntries(
  Object.entries(TOOL_KEYS).map(([code, name]) => [name, code.slice(3)]),
);
// Tools that place a new object where you click, and show a preview of it.
const PLACING_TOOLS = new Set(["apple", "spike", "prop"]);
let hoverPoint = null;
let lastNudge = 0;

const toolSettings = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(TOOL_SETTINGS_KEY) || "{}");
    return Object.fromEntries(
      Object.entries(DEFAULT_TOOL_SETTINGS).map(([name, defaults]) => [
        name,
        { ...defaults, ...(stored[name] || {}) },
      ]),
    );
  } catch (_) {
    return structuredClone(DEFAULT_TOOL_SETTINGS);
  }
})();

function saveToolSettings() {
  try {
    localStorage.setItem(TOOL_SETTINGS_KEY, JSON.stringify(toolSettings));
  } catch (_) {}
}

function toolMaterial(name) {
  const material = toolSettings[name]?.material;
  return !material || material === BASE_MATERIAL || !terrainMaterials[material]
    ? trail.terrain
    : material;
}

function clampSetting(field, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return field.min ?? 0;
  return Math.max(
    field.min ?? -Infinity,
    Math.min(field.max ?? Infinity, number),
  );
}

// Dropdowns with fewer than three options are shown as a row of buttons. The
// real <select> stays in the page, hidden, so every existing listener and
// `.value = ...` keeps working; the buttons just mirror it.
// Only present in a real browser; without it, selects are left as they are.
const selectValue =
  (typeof HTMLSelectElement !== "undefined" &&
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")) ||
  null;

function segmentSelect(select) {
  if (!selectValue) return;
  const count = select.options.length;
  if (select.dataset.segmented || count === 0 || count >= 3) return;
  select.dataset.segmented = "1";
  const group = document.createElement("span");
  group.className = "segmented";
  group.setAttribute("role", "radiogroup");
  const buttons = [...select.options].map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.setAttribute("role", "radio");
    button.addEventListener("click", () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Hand focus back so the canvas shortcuts keep working.
      canvas.focus({ preventScroll: true });
    });
    group.append(button);
    return button;
  });
  const refresh = () => {
    const current = selectValue.get.call(select);
    for (const button of buttons) {
      const active = button.dataset.value === current;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    }
  };
  // Setting the value from code (syncInspector, tool settings) updates the buttons.
  Object.defineProperty(select, "value", {
    configurable: true,
    get: () => selectValue.get.call(select),
    set: (value) => {
      selectValue.set.call(select, value);
      refresh();
    },
  });
  select.style.display = "none";
  select.after(group);
  refresh();
}

function segmentSelects(root) {
  root.querySelectorAll("select").forEach(segmentSelect);
}

function renderToolSettings() {
  const info = TOOL_INFO[tool];
  const key = TOOL_KEY_LABELS[tool];
  $("tool-settings-title").textContent =
    info.title.toUpperCase() + (key ? ` · ${key}` : "");
  $("tool-hint").textContent = info.hint;
  $("tool-settings-fields").replaceChildren(
    ...(info.fields || []).map((field) => {
      const settings = toolSettings[tool] || {};
      const label = document.createElement("label");
      label.className = field.type === "checkbox" ? "checkbox-row" : "";
      let input;
      if (field.type === "select" || field.type === "toggle") {
        input = document.createElement("select");
        for (const [value, text] of field.options()) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          input.append(option);
        }
        input.value = String(
          field.type === "toggle"
            ? Boolean(settings[field.key])
            : settings[field.key],
        );
      } else {
        input = document.createElement("input");
        input.type = field.type;
        if (field.type === "checkbox")
          input.checked = Boolean(settings[field.key]);
        else {
          for (const attribute of ["min", "max", "step"])
            if (field[attribute] !== undefined)
              input[attribute] = field[attribute];
          input.value = settings[field.key];
        }
      }
      input.addEventListener("change", () => {
        settings[field.key] =
          field.type === "toggle"
            ? input.value === "true"
            : field.type === "checkbox"
              ? input.checked
              : field.type === "number"
                ? clampSetting(field, input.value)
                : input.value;
        if (field.type === "number") input.value = settings[field.key];
        saveToolSettings();
      });
      label.append(field.label, " ", input);
      return label;
    }),
  );
  segmentSelects($("tool-settings-fields"));
}

function setTool(next) {
  hoverPoint = null;
  tool = next;
  document
    .querySelectorAll("[data-tool]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.tool === tool),
    );
  canvas.style.cursor =
    tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
  renderToolSettings();
}

function setTab(name) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("panel-tools").hidden = name !== "tools";
  $("panel-trail").hidden = name !== "trail";
}

// The editor opens on the start, placed a little below the middle so the
// ground and the sky above it are both in view.
let focusPending = true;
function focusOnStart() {
  const { width, height } = viewportSize();
  if (!width || !height) return false;
  syncTerrain();
  const startY = Number.isFinite(trail.start.y)
    ? trail.start.y
    : groundY(trail.start.x) - 12;
  cameraX = trail.start.x - width / 2 / zoom;
  cameraY = startY - (height * 0.6) / zoom;
  focusPending = false;
  return true;
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(bounds.width * dpr));
  canvas.height = Math.max(1, Math.round(bounds.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (focusPending) focusOnStart();
  render();
}

function viewportSize() {
  const bounds = canvas.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

function pointerWorld(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: cameraX + (event.clientX - bounds.left) / zoom,
    y: cameraY + (event.clientY - bounds.top) / zoom,
  };
}

/** The blocks being edited, normalized so every node and handle is well formed. */
function blocks() {
  if (!trail.terrainBlocks) trail.terrainBlocks = [];
  return trail.terrainBlocks;
}

/** A boundary as one canvas path, following its curves. */
function traceBoundary(boundary) {
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
function traceRegion(region) {
  ctx.beginPath();
  traceBoundary(region.outer);
  for (const hole of region.inner) traceBoundary(hole);
}

/** The block indices the current selection covers, whole or in part. */
function selectedBlocks() {
  if (selection?.kind === "blocks") return selection.blockIndices;
  return Number.isInteger(selection?.blockIndex) ? [selection.blockIndex] : [];
}

function blockSelected(blockIndex) {
  return (
    (selection?.kind === "block" || selection?.kind === "blocks") &&
    selectedBlocks().includes(blockIndex)
  );
}

/**
 * Every boundary of a block in one list, outer first within each region.
 * Selections store a boundary by its position in this list, so a block that
 * a cut has split into several regions still resolves to the right ring.
 */
function boundaryEntries(block) {
  return block.regions.flatMap((region, regionIndex) => [
    { boundary: region.outer, regionIndex, hole: -1 },
    ...region.inner.map((boundary, hole) => ({ boundary, regionIndex, hole })),
  ]);
}

/** A copy of a block with one boundary replaced, or removed when `replacement` is null. */
function withBoundary(block, boundaryIndex, replacement) {
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

function replaceBoundary(blockIndex, boundaryIndex, replacement) {
  const block = blocks()[blockIndex];
  if (block)
    replaceBlock(blockIndex, withBoundary(block, boundaryIndex, replacement));
}

/**
 * The editor edits blocks in place while dragging, so the compiled terrain the
 * renderer, surface queries and validation share has to be told. A cheap
 * fingerprint of everything that shapes the terrain is compared each time it
 * is needed, and the trail is invalidated only when it has really changed.
 */
let terrainFingerprint = null;
function syncTerrain() {
  let hash = 0x811c9dc5;
  const mix = (value) => {
    hash = Math.imul(hash ^ (Math.round(value * 64) | 0), 0x01000193) >>> 0;
  };
  const text = (value) => {
    for (let index = 0; index < value.length; index++)
      mix(value.charCodeAt(index));
  };
  text(String(trail.terrain));
  mix(trail.fallY || 0);
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
  if (fingerprint !== terrainFingerprint) {
    terrainFingerprint = fingerprint;
    invalidateTerrain(trail);
  }
}

function drawBlocks() {
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
        (selection?.kind === "blockBoundary" &&
          selection.blockIndex === blockIndex &&
          selection.boundaryIndex === boundaryIndex);
      ctx.strokeStyle = highlighted
        ? "#fff3be"
        : gameArt
          ? "#17262b99"
          : material.edge;
      ctx.lineWidth = highlighted ? 3 / zoom : gameArt ? 1.5 / zoom : 2.5;
      if (highlighted) ctx.setLineDash([8 / zoom, 5 / zoom]);
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
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (shape.closed && shape.fill) {
    ctx.fillStyle = shape.fill;
    ctx.fill();
  }
}

function drawTerrain() {
  if (gameArt) {
    // The game's own renderer, fed the same compiled terrain the game rides.
    const { width, height } = viewportSize();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    terrainArt.draw(ctx, trail, cameraX, cameraY, width / zoom, height / zoom);
    ctx.restore();
  }
  drawBlocks();
  drawPendingShape(pendingShape);
}

function drawGrid(width, height) {
  const spacing = gridSpacing(zoom);
  const left = Math.floor(cameraX / spacing) * spacing;
  const top = Math.floor(cameraY / spacing) * spacing;
  const right = cameraX + width / zoom;
  const bottom = cameraY + height / zoom;
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
  ctx.lineWidth = 1 / zoom;
  ctx.stroke();
}

function objectY(object, offset = 0) {
  return Number.isFinite(object.y) ? object.y : groundY(object.x) - offset;
}

/** The ground height at an x: the topmost surface at or below `referenceY`. */
function groundY(x, referenceY = null) {
  const surface = surfaceBelow(trail, x, referenceY);
  return surface ? surface.y : trail.fallY || 620;
}

/**
 * Where the finish flag stands: an explicit height when the author has set one,
 * else the surface below it. Shared with the game so the flag is drawn where the
 * editor put it.
 */
function finishY() {
  return finishHeight(trail);
}

function drawProps(layer) {
  for (const prop of trail.props || []) {
    if (prop.layer !== layer) continue;
    art.drawProp(
      prop.type,
      prop.x,
      objectY(prop),
      1,
      propAlignmentSlope(trail, prop),
      propGroundOffset(trail, prop),
      prop.text,
      propWallFit(trail, prop),
      prop.flip,
    );
  }
}

function drawSpikes() {
  for (const [index, spike] of trail.spikes.entries()) {
    art.drawSpike(spike.x, spike.y, spike.radius);
    if (!isSelected("spike", index)) continue;
    ctx.beginPath();
    ctx.arc(spike.x, spike.y, spike.radius * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff3be";
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawObjects() {
  drawSpikes();
  for (const apple of trail.apples)
    art.drawApple(apple.x, objectY(apple, 60), { glow: false });
  art.drawFlag(trail.goal, finishY(), true, 0);
  if (selection?.kind === "goal") {
    // The petals the bike has to touch.
    const flower = finishFlower(trail);
    ctx.beginPath();
    ctx.arc(flower.x, flower.y, FINISH_FLOWER_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff3be";
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawProps("front");
  const startY = Number.isFinite(trail.start.y)
    ? trail.start.y
    : groundY(trail.start.x) - 12;
  ctx.save();
  ctx.globalAlpha = 0.72;
  art.drawBike({
    rear: { x: trail.start.x - 25, y: startY, spin: 0, compression: 0 },
    front: { x: trail.start.x + 25, y: startY, spin: 0, compression: 0 },
    mx: trail.start.x,
    my: startY,
    angle: 0,
    length: 50,
    facing: trail.start.facing,
    flipVisual: trail.start.facing,
    rider: "male",
  });
  ctx.restore();
}

function isSelected(kind, index) {
  if (selection?.kind === "items")
    return selection.items.some(
      (item) => item.type === kind && item.index === index,
    );
  return selection?.kind === kind && selection.index === index;
}

/** Is this the node whose curve handles are showing: the selected point, or the owner of the selected handle? */
function isActiveNode(blockIndex, boundaryIndex, nodeIndex) {
  return (
    (selection?.kind === "blockPoint" || selection?.kind === "blockHandle") &&
    selection.blockIndex === blockIndex &&
    selection.boundaryIndex === boundaryIndex &&
    selection.index === nodeIndex
  );
}

/** Is this particular node or handle the current selection? */
function isBlockPart(blockIndex, boundaryIndex, nodeIndex, side = null) {
  if (selection?.kind === "items")
    return (
      side === null &&
      selection.items.some(
        (item) =>
          item.type === "point" &&
          item.blockIndex === blockIndex &&
          item.boundaryIndex === boundaryIndex &&
          item.index === nodeIndex,
      )
    );
  if (
    selection?.kind !== "blockPoint" &&
    selection?.kind !== "blockHandle" &&
    selection?.kind !== "blockBoundary"
  )
    return false;
  if (
    selection.blockIndex !== blockIndex ||
    selection.boundaryIndex !== boundaryIndex
  )
    return false;
  if (selection.kind === "blockBoundary") return true;
  if (selection.index !== nodeIndex) return false;
  return selection.kind !== "blockHandle" || selection.side === side;
}

function drawHandles() {
  const radius = 5 / zoom;
  const drawHandle = (x, y, selected, color = "#ff8952") => {
    ctx.fillStyle = selected ? "#fff3be" : color;
    ctx.strokeStyle = "#17262b";
    ctx.lineWidth = 2 / zoom;
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
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();
          drawHandle(
            handle[0],
            handle[1],
            selection.kind === "blockHandle" && selection.side === side,
            "#e65e56",
          );
        }
      });
    });
  }
  trail.apples.forEach((apple, index) =>
    drawHandle(
      apple.x,
      objectY(apple, 60),
      isSelected("apple", index),
      "#ef8150",
    ),
  );
  trail.props.forEach((prop, index) =>
    drawHandle(prop.x, objectY(prop), isSelected("prop", index), "#83d1ce"),
  );
  trail.spikes.forEach((spike, index) =>
    drawHandle(spike.x, spike.y, isSelected("spike", index), "#e65e56"),
  );
  const startY = Number.isFinite(trail.start.y)
    ? trail.start.y
    : groundY(trail.start.x) - 12;
  drawHandle(trail.start.x, startY, selection?.kind === "start", "#c6dfa9");
  drawHandle(trail.goal, finishY(), selection?.kind === "goal", "#c6dfa9");
}

function render() {
  const { width, height } = viewportSize();
  if (!width || !height) return;
  syncTerrain();
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  art.drawBackground({
    width,
    height,
    palette: trail,
    cameraX,
    cameraY,
    full: true,
  });
  ctx.save();
  ctx.translate(-cameraX * zoom, -cameraY * zoom);
  ctx.scale(zoom, zoom);
  drawGrid(width, height);
  drawProps("back");
  drawTerrain();
  drawObjects();
  drawPlacementPreview();
  art.drawTimeTint(trail, cameraX, cameraY, width / zoom, height / zoom);
  drawHandles();
  drawSnapGuide();
  drawMarquee();
  ctx.restore();
}

/** While a Shift-drag is snapping, show the line it is locked to and its angle and length. */
function drawSnapGuide() {
  if (!snapGuide) return;
  const { from, to, angle, length } = snapGuide;
  ctx.save();
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = "#fff3be";
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 8 / zoom, 0, Math.PI * 2);
  ctx.strokeStyle = "#fff3be";
  ctx.stroke();
  ctx.font = `${12 / zoom}px system-ui, sans-serif`;
  const label = `${Math.round(angle * 10) / 10}\u00b0 \u00b7 ${Math.round(length)}`;
  const x = to.x + 12 / zoom,
    y = to.y - 12 / zoom;
  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = "#17262b";
  ctx.strokeText(label, x, y);
  ctx.fillStyle = "#fff3be";
  ctx.fillText(label, x, y);
  ctx.restore();
}

/**
 * Selection priority, highest first: the visible curve handles of the active
 * node, then points, then boundary edges, then the solid body of a block.
 * Clicking empty cave space matches nothing, and clicking a nested island
 * selects the island rather than the block around it, because the topmost
 * solid under the cursor wins. With `wholeBoundary`, a point or edge selects
 * the whole ring it belongs to instead.
 */
function hitTest(point, { wholeBoundary = false } = {}) {
  syncTerrain();
  const threshold = 13 / zoom;
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
              1,
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
                  0,
                );
            }
          }
          consider({ ...base, kind: "blockPoint" }, node.x, node.y, 1);
          // The edge leaving this node, so a double-click can insert into it.
          const next = boundary.nodes[(index + 1) % boundary.nodes.length];
          const hit = edgeHit(node, next, point);
          if (hit.distance <= threshold)
            consider({ ...base, kind: "blockEdge", t: hit.t }, hit.x, hit.y, 2);
        });
      },
    );
  }
  if (wholeBoundary) return best?.selection || ringAt(point);

  trail.apples.forEach((apple, index) =>
    consider({ kind: "apple", index }, apple.x, objectY(apple, 60), 1),
  );
  trail.props.forEach((prop, index) =>
    consider({ kind: "prop", index }, prop.x, objectY(prop), 1),
  );
  trail.spikes.forEach((spike, index) =>
    consider({ kind: "spike", index }, spike.x, spike.y, 1),
  );
  const startY = Number.isFinite(trail.start.y)
    ? trail.start.y
    : groundY(trail.start.x) - 12;
  consider({ kind: "start" }, trail.start.x, startY, 1);
  consider({ kind: "goal" }, trail.goal, finishY(), 1);
  if (best) return best.selection;

  // Bodies: a spike's own disc, then the topmost solid block under the cursor.
  for (let index = trail.spikes.length - 1; index >= 0; index--) {
    const spike = trail.spikes[index];
    if (Math.hypot(point.x - spike.x, point.y - spike.y) <= spike.radius)
      return { kind: "spike", index };
  }
  for (let blockIndex = blocks().length - 1; blockIndex >= 0; blockIndex--) {
    const block = blocks()[blockIndex];
    const regionIndex = block.regions.findIndex((region) =>
      pointInRegion(region, point.x, point.y),
    );
    if (regionIndex >= 0) return { kind: "block", blockIndex, regionIndex };
  }
  return null;
}

/**
 * The ring under a point away from any edge: the cave it is inside, or else
 * the outer boundary of the topmost solid region it is inside.
 */
function ringAt(point) {
  const inside = (boundary) =>
    pointInRegion({ outer: boundary, inner: [] }, point.x, point.y);
  const body = hitTest(point);
  // A block drawn above the cave, such as an island inside it, wins.
  const lowest = body?.kind === "block" ? body.blockIndex : -1;
  for (
    let blockIndex = blocks().length - 1;
    blockIndex > lowest;
    blockIndex--
  ) {
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
function edgeHit(node, next, point) {
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

function selectedPosition() {
  if (!selection) return null;
  if (selection.kind === "items") return itemsCentre(selection.items);
  if (
    selection.kind === "blockPoint" ||
    selection.kind === "blockHandle" ||
    selection.kind === "blockEdge"
  ) {
    const boundary = boundaryAt(selection);
    if (!boundary) return null;
    const node = boundary.nodes[selection.index];
    if (selection.kind === "blockHandle") {
      const handle = node[selection.side];
      return handle ? [handle[0], handle[1]] : [node.x, node.y];
    }
    if (selection.kind === "blockEdge") {
      const next =
        boundary.nodes[(selection.index + 1) % boundary.nodes.length];
      const hit = edgeHit(node, next, { x: node.x, y: node.y });
      const control = edgeCurve(node, next);
      const t = selection.t;
      return [
        control[0][0] +
          3 * t * (1 - t) * (1 - t) * (control[1][0] - control[0][0]) +
          3 * t * t * (1 - t) * (control[2][0] - control[1][0]) +
          t * t * t * (control[3][0] - control[2][0]),
        control[0][1] +
          3 * t * (1 - t) * (1 - t) * (control[1][1] - control[0][1]) +
          3 * t * t * (1 - t) * (control[2][1] - control[1][1]) +
          t * t * t * (control[3][1] - control[2][1]),
      ];
    }
    return [node.x, node.y];
  }
  if (
    selection.kind === "block" ||
    selection.kind === "blockBoundary" ||
    selection.kind === "blocks"
  ) {
    const chosen = selectedBlocks()
      .map((index) => blocks()[index])
      .filter(Boolean);
    if (!chosen.length) return null;
    // The handle for blocks, or for one empty space, is the centre of their
    // nodes. A block covers every node it owns; a single boundary just its own.
    const nodes =
      selection.kind === "blockBoundary"
        ? boundariesOf(chosen[0])[selection.boundaryIndex]?.nodes || []
        : chosen.flatMap((block) =>
            boundariesOf(block).flatMap((boundary) => boundary.nodes),
          );
    if (!nodes.length) return null;
    return [
      nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
    ];
  }
  if (selection.kind === "apple") {
    const apple = trail.apples[selection.index];
    return [apple.x, objectY(apple, 60)];
  }
  if (selection.kind === "prop") {
    const prop = trail.props[selection.index];
    return [prop.x, objectY(prop)];
  }
  if (selection.kind === "spike") {
    const spike = trail.spikes[selection.index];
    return [spike.x, spike.y];
  }
  if (selection.kind === "start")
    return [
      trail.start.x,
      Number.isFinite(trail.start.y)
        ? trail.start.y
        : groundY(trail.start.x) - 12,
    ];
  if (selection.kind === "goal") return [trail.goal, finishY()];
  return null;
}

const BLOCK_KINDS = [
  "block",
  "blocks",
  "blockPoint",
  "blockHandle",
  "blockEdge",
  "blockBoundary",
];

/** Every boundary of a block, outer first, in region order. */
function boundariesOf(block) {
  return block.regions.flatMap((region) => [region.outer, ...region.inner]);
}

function boundaryAt(target) {
  const block = blocks()[target.blockIndex];
  if (!block) return null;
  return boundariesOf(block)[target.boundaryIndex] || null;
}

function syncInspector() {
  syncTerrain();
  $("trail-name").value = trail.name;
  $("base-material").value = trail.terrain;
  $("goal-x").value = Math.round(trail.goal);
  $("fall-y").value = Math.round(trail.fallY);
  $("time-of-day").value = trail.timeOfDay || "noon";
  $("backdrop").value = trail.backdrop || "hills";
  for (const key of ["sun", "clouds", "rain", "lightning"])
    $(`weather-${key}`).value = trail.weather?.[key] ?? 0;
  const position = selectedPosition();
  $("selection-fields").hidden = !selection;
  $("selection-title").textContent = !selection
    ? "NOTHING SELECTED"
    : selection.kind === "blocks"
      ? `${selection.blockIndices.length} BLOCKS`
      : selection.kind === "items"
        ? `${selection.items.length} ITEMS`
        : selection.kind.replace(/([A-Z])/g, " $1").toUpperCase();
  $("selection-empty").hidden = Boolean(selection);
  if (position) {
    $("selection-x").value = Math.round(position[0]);
    $("selection-y").value = Math.round(position[1]);
  }
  const isBlock = BLOCK_KINDS.includes(selection?.kind);
  // The finish can be moved in y, so its Y row is shown. Every other object
  // with a fixed height is left as it was.
  $("selection-y-row").hidden = !selection;
  $("selection-material-row").hidden = !isBlock;
  $("selection-edge-row").hidden = !["blockPoint", "blockEdge"].includes(
    selection?.kind,
  );
  $("selection-node-row").hidden = !["blockPoint", "blockEdge"].includes(
    selection?.kind,
  );
  $("selection-facing-row").hidden = selection?.kind !== "start";
  $("selection-prop-type-row").hidden = selection?.kind !== "prop";
  $("selection-layer-row").hidden = selection?.kind !== "prop";
  $("selection-prop-text-row").hidden =
    selection?.kind !== "prop" || trail.props[selection.index]?.type !== "sign";
  const selectedProp = selection?.kind === "prop" ? trail.props[selection.index] : null;
  $("selection-flip-row").hidden = !selectedProp || !canFlip(selectedProp.type);
  if (selectedProp) $("selection-flip").value = String(Boolean(selectedProp.flip));
  $("selection-radius-row").hidden = selection?.kind !== "spike";
  $("selection-spin-row").hidden = selection?.kind !== "spike";
  // Only the finish has a meaningful "put it back on the ground" action, since
  // every other object is either placed by hand or already ground-anchored.
  $("selection-snap-row").hidden = selection?.kind !== "goal";
  $("selection-snap").checked = !Number.isFinite(trail.finishY);
  $("delete-selection").hidden =
    !selection || ["start", "goal"].includes(selection.kind);
  if (isBlock) {
    $("selection-material").value =
      blocks()[selectedBlocks()[0]]?.material || trail.terrain;
    const boundary = boundaryAt(selection);
    const node = boundary?.nodes[selection.index];
    if (node && selection.kind !== "blockHandle") {
      $("selection-edge").value = isCurvedEdge(
        node,
        boundary.nodes[(selection.index + 1) % boundary.nodes.length],
      )
        ? "curve"
        : "straight";
      $("selection-node").value = node.mode;
    }
  }
  if (selection?.kind === "start")
    $("selection-facing").value = String(trail.start.facing);
  if (selection?.kind === "prop") {
    $("selection-prop-type").value = trail.props[selection.index].type;
    $("selection-layer").value = trail.props[selection.index].layer;
    $("selection-prop-text").value = trail.props[selection.index].text || "";
  }
  if (selection?.kind === "spike") {
    $("selection-radius").value = trail.spikes[selection.index].radius;
    $("selection-spin").value = trail.spikes[selection.index].spin;
  }
  $("trail-json").value = JSON.stringify(trail, null, 2);
  const messages = validateTrail(trail);
  $("validation-list").replaceChildren(
    ...messages.map((message) => {
      const item = document.createElement("li");
      item.className = message.type;
      item.textContent = message.text;
      return item;
    }),
  );
  updateHistoryButtons();
}

/** Replace one block at an index, returning a new block list. */
function replaceBlock(index, block) {
  const next = blocks().slice();
  next[index] = block;
  trail.terrainBlocks = next;
}

function updateSelectedPosition(x, y) {
  if (!selection) return;
  const kind = selection.kind;
  if (kind === "items") {
    moveItems(x, y);
    return;
  }
  if (kind === "blockPoint" || kind === "blockHandle") {
    const boundary = boundaryAt(selection);
    if (!boundary) return;
    const node = boundary.nodes[selection.index];
    if (!node) return;
    if (kind === "blockHandle") node[selection.side] = [x, y];
    else {
      const dx = x - node.x,
        dy = y - node.y;
      node.x = x;
      node.y = y;
      // Handles are absolute points, so they have to travel with their point
      // or the curve changes shape as the point is dragged.
      if (node.in) node.in = [node.in[0] + dx, node.in[1] + dy];
      if (node.out) node.out = [node.out[0] + dx, node.out[1] + dy];
    }
    if (node.mode === "smooth") realignSmooth(boundary, selection.index);
  } else if (kind === "blockEdge") {
    // Dragging an edge stretches it: the handles follow so the curve keeps its
    // shape rather than collapsing into its chord.
    const boundary = boundaryAt(selection);
    if (!boundary) return;
    const node = boundary.nodes[selection.index];
    const next = boundary.nodes[(selection.index + 1) % boundary.nodes.length];
    const before = selectedPosition();
    const dx = x - before[0],
      dy = y - before[1];
    if (isCurvedEdge(node, next)) {
      node.out = [node.out[0] + dx, node.out[1] + dy];
      next.in = [next.in[0] + dx, next.in[1] + dy];
    } else {
      // A straight edge moves as a whole, carrying any handles of its ends.
      for (const end of [node, next]) {
        end.x += dx;
        end.y += dy;
        if (end.in) end.in = [end.in[0] + dx, end.in[1] + dy];
        if (end.out) end.out = [end.out[0] + dx, end.out[1] + dy];
      }
    }
  } else if (kind === "block" || kind === "blocks") {
    const current = selectedPosition();
    if (!current) return;
    for (const index of selectedBlocks()) {
      if (blocks()[index])
        replaceBlock(
          index,
          moveBlock(blocks()[index], x - current[0], y - current[1]),
        );
    }
  } else if (kind === "blockBoundary") {
    // Dragging a whole ring moves just that ring. For a cave, its old place
    // fills in and its new place opens up; for an outer boundary, the solid
    // moves while its caves stay where they are.
    const current = selectedPosition();
    const boundary = boundaryAt(selection);
    if (!current || !boundary) return;
    const dx = x - current[0],
      dy = y - current[1];
    replaceBoundary(selection.blockIndex, selection.boundaryIndex, {
      ...boundary,
      nodes: boundary.nodes.map((node) => ({
        ...node,
        x: node.x + dx,
        y: node.y + dy,
        in: node.in ? [node.in[0] + dx, node.in[1] + dy] : null,
        out: node.out ? [node.out[0] + dx, node.out[1] + dy] : null,
      })),
    });
  } else if (kind === "apple") {
    trail.apples[selection.index].x = x;
    trail.apples[selection.index].y = y;
  } else if (kind === "prop") {
    trail.props[selection.index].x = x;
    trail.props[selection.index].y = y;
  } else if (kind === "spike") {
    trail.spikes[selection.index].x = x;
    trail.spikes[selection.index].y = y;
  } else if (kind === "start") {
    trail.start.x = x;
    trail.start.y = y;
  } else if (kind === "goal") {
    // The finish is a point: it can be moved in y as well as x, so a flag can
    // stand on a floating block or hang above a cave instead of being pinned to the
    // surface. Dragging it sets an explicit height, which the inspector can
    // clear to send it back to the ground.
    trail.goal = x;
    trail.finishY = y;
  }
}

/** A smooth node keeps its handles collinear, so moving one moves the other. */
function realignSmooth(boundary, index) {
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
function insertBlockNode(boundaryIndex, nodeIndex, t, blockIndex) {
  const block = blocks()[blockIndex];
  const boundary = block && boundariesOf(block)[boundaryIndex];
  if (!boundary) return;
  replaceBoundary(blockIndex, boundaryIndex, {
    ...insertBoundaryNode(boundary, nodeIndex, t),
    id: boundary.id,
  });
  // The inserted node sits right after the one the edge started at.
  selection = {
    kind: "blockPoint",
    blockIndex,
    boundaryIndex,
    index: nodeIndex + 1,
  };
}

function addAt(point) {
  pushHistory();
  if (tool === "apple") {
    trail.apples.push({ x: point.x, y: point.y });
    selection = { kind: "apple", index: trail.apples.length - 1 };
  } else if (tool === "start") {
    trail.start = {
      x: point.x,
      y: point.y,
      facing: Number(toolSettings.start.facing) < 0 ? -1 : 1,
    };
    selection = { kind: "start" };
  } else if (tool === "prop") {
    const prop = {
      x: point.x,
      y: point.y,
      type: toolSettings.prop.type,
      layer: toolSettings.prop.layer === "front" ? "front" : "back",
    };
    if (prop.type === "sign") prop.text = "";
    if (toolSettings.prop.flip && canFlip(prop.type)) prop.flip = true;
    trail.props.push(prop);
    selection = { kind: "prop", index: trail.props.length - 1 };
  } else if (tool === "spike") {
    trail.spikes.push({
      x: point.x,
      y: point.y,
      radius: toolSettings.spike.radius,
      spin: toolSettings.spike.spin,
    });
    selection = { kind: "spike", index: trail.spikes.length - 1 };
  } else if (tool === "finish") {
    // Placed on the surface at the clicked x, ready to be dragged up or down.
    trail.goal = point.x;
    trail.finishY = groundY(point.x);
    selection = { kind: "goal" };
  }
  // Start and finish are one of a kind, so those go back to Select; every
  // other tool stays active for the next click.
  if (tool === "start" || tool === "finish") setTool("select");
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
  const g = gridSpacing(zoom);
  return [Math.round(x / g) * g, Math.round(y / g) * g];
}

/**
 * What a Block or Cut drag will make, from its raw path and the keys held:
 * Alt draws a rectangle, Shift snaps to the grid.
 */
function updateShapePoints(shape) {
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
function commitShape(kind, points, closed, rect = false) {
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
      const outline = simplifyOutline(points, 3 / zoom);
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
    trail.terrainBlocks = [
      ...blocks(),
      normalizeBlocks([block], trail.terrain)[0],
    ];
    selection = {
      kind: "block",
      blockIndex: trail.terrainBlocks.length - 1,
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
        normalizeBlocks([result.block], trail.terrain)[0],
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
    selection =
      changedSelected.length > 1
        ? { kind: "blocks", blockIndices: changedSelected }
        : { kind: "block", blockIndex: changedSelected[0], regionIndex: 0 };
    return true;
  }
  for (let blockIndex = blocks().length - 1; blockIndex >= 0; blockIndex--) {
    if (selected.includes(blockIndex)) continue;
    const result = attempt(blockIndex);
    if (result.changed) {
      selection = { kind: "block", blockIndex, regionIndex: 0 };
      return true;
    }
    reason ||= result.reason;
  }
  showStatus("warning", reason || "The cut did not overlap any block.");
  return false;
}

/** Zoom by a factor, keeping the middle of the view where it is. */
function zoomAtCenter(factor) {
  const { width, height } = viewportSize();
  const centerX = cameraX + width / 2 / zoom;
  const centerY = cameraY + height / 2 / zoom;
  zoom = Math.max(0.35, Math.min(2.5, zoom * factor));
  cameraX = centerX - width / 2 / zoom;
  cameraY = centerY - height / 2 / zoom;
  updateZoom();
}

/** Move the selection with the arrow keys. Held or rapid presses are one undo step. */
function nudgeSelection(key, big) {
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

/** A copy of a block with fresh ids, so it's fully independent of the original. */
function freshBlockCopy(block) {
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
    trail.terrain,
  )[0];
}

function duplicateBlocks(indices) {
  const copies = indices
    .map((index) => freshBlockCopy(blocks()[index]))
    .filter(Boolean);
  const first = blocks().length;
  trail.terrainBlocks = [...blocks(), ...copies];
  const added = copies.map((_, i) => first + i);
  return added.length > 1
    ? { kind: "blocks", blockIndices: added }
    : { kind: "block", blockIndex: added[0], regionIndex: 0 };
}

/**
 * Copy apples, props, spikes and block points in place. A copied point is
 * inserted right after its original, as a corner.
 */
function duplicateItems(items) {
  const lists = OBJECT_LISTS();
  const copies = [];
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
function duplicateTarget(hit) {
  if (!hit) return null;
  const item = itemFromHit(hit);
  // Alt-dragging part of a group copies the whole group.
  if (
    item &&
    selection?.kind === "items" &&
    selection.items.some((other) => sameItem(other, item))
  )
    return duplicateItems(selection.items);
  const onBlock = hit.kind === "block" || hit.kind === "blockEdge";
  if (
    onBlock &&
    selection?.kind === "blocks" &&
    selection.blockIndices.includes(hit.blockIndex)
  )
    return duplicateBlocks(selection.blockIndices);
  if (onBlock) return duplicateBlocks([hit.blockIndex]);
  if (item) return duplicateItems([item]);
  // Start, finish and curve handles aren't duplicated.
  return null;
}

/** Step through prop types: the Prop tool's type, or else the selected prop's. */
function cyclePropType(direction) {
  const types = propTypeOptions().map(([value]) => value);
  const next = (current) =>
    types[(types.indexOf(current) + direction + types.length) % types.length];
  if (tool === "prop") {
    toolSettings.prop.type = next(toolSettings.prop.type);
    saveToolSettings();
    renderToolSettings();
  } else if (selection?.kind === "prop") {
    const prop = trail.props[selection.index];
    pushHistory();
    prop.type = next(prop.type);
    if (prop.type === "sign" && typeof prop.text !== "string") prop.text = "";
    syncInspector();
  } else return;
  render();
}

/** A faded copy of what the current tool will place, under the cursor. */
function drawPlacementPreview() {
  if (!hoverPoint || !PLACING_TOOLS.has(tool)) return;
  const { x, y } = hoverPoint;
  if (tool === "prop") {
    const prop = { x, y, type: toolSettings.prop.type, layer: "back" };
    art.drawProp(
      prop.type,
      x,
      y,
      0.5,
      propAlignmentSlope(trail, prop),
      propGroundOffset(trail, prop),
      "",
      propWallFit(trail, prop),
      toolSettings.prop.flip,
    );
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  if (tool === "apple") art.drawApple(x, y, { glow: false });
  else art.drawSpike(x, y, toolSettings.spike.radius);
  ctx.restore();
}

/** Flip the Prop tool's next prop, or else the selected prop. */
function toggleFlip() {
  if (tool === "prop") {
    toolSettings.prop.flip = !toolSettings.prop.flip;
    saveToolSettings();
    renderToolSettings();
  } else if (
    selection?.kind === "prop" &&
    canFlip(trail.props[selection.index].type)
  ) {
    pushHistory();
    const prop = trail.props[selection.index];
    if (prop.flip) delete prop.flip;
    else prop.flip = true;
    syncInspector();
  } else return;
  render();
}

// ---- Mixed selection: block points, apples, props and spikes -------------

const OBJECT_LISTS = () => ({
  apple: trail.apples,
  prop: trail.props,
  spike: trail.spikes,
});

function sameItem(a, b) {
  if (a.type !== b.type || a.index !== b.index) return false;
  return (
    a.type !== "point" ||
    (a.blockIndex === b.blockIndex && a.boundaryIndex === b.boundaryIndex)
  );
}

/** The selectable item a hit refers to, or null (blocks, edges, start, finish). */
function itemFromHit(hit) {
  if (!hit) return null;
  if (hit.kind === "blockPoint") {
    const { blockIndex, regionIndex, boundaryIndex, index } = hit;
    return { type: "point", blockIndex, regionIndex, boundaryIndex, index };
  }
  return OBJECT_LISTS()[hit.kind] ? { type: hit.kind, index: hit.index } : null;
}

/** The current selection as a list of items. */
function selectionItems() {
  if (selection?.kind === "items") return selection.items.slice();
  const item = itemFromHit(selection);
  return item ? [item] : [];
}

/** A selection for a list of items: nothing, the item itself, or a group. */
function makeSelection(items) {
  if (!items.length) return null;
  if (items.length > 1) return { kind: "items", items };
  const [item] = items;
  if (item.type === "point") {
    const { blockIndex, regionIndex, boundaryIndex, index } = item;
    return { kind: "blockPoint", blockIndex, regionIndex, boundaryIndex, index };
  }
  return { kind: item.type, index: item.index };
}

function itemPosition(item) {
  if (item.type === "point") {
    const node = boundaryAt(item)?.nodes[item.index];
    return node ? [node.x, node.y] : null;
  }
  const object = OBJECT_LISTS()[item.type][item.index];
  if (!object) return null;
  if (item.type === "spike") return [object.x, object.y];
  return [object.x, objectY(object, item.type === "apple" ? 60 : 0)];
}

function itemsCentre(items) {
  const positions = items.map(itemPosition).filter(Boolean);
  if (!positions.length) return null;
  return [
    positions.reduce((sum, [x]) => sum + x, 0) / positions.length,
    positions.reduce((sum, [, y]) => sum + y, 0) / positions.length,
  ];
}

/** Move the whole group so its centre lands on (x, y). */
function moveItems(x, y) {
  const items = selection.items;
  const centre = itemsCentre(items);
  if (!centre) return;
  const dx = x - centre[0],
    dy = y - centre[1];
  // Every object's height is read before any point moves, so a ground-anchored
  // object doesn't jump when the ground under it moves in the same drag.
  const before = items.map(itemPosition);
  items.forEach((item, i) => {
    if (item.type === "point") {
      const node = boundaryAt(item)?.nodes[item.index];
      if (!node) return;
      node.x += dx;
      node.y += dy;
      if (node.in) node.in = [node.in[0] + dx, node.in[1] + dy];
      if (node.out) node.out = [node.out[0] + dx, node.out[1] + dy];
      return;
    }
    const object = OBJECT_LISTS()[item.type][item.index];
    if (!object || !before[i]) return;
    // Like dragging one on its own, this fixes a ground-anchored object's height.
    object.x = before[i][0] + dx;
    object.y = before[i][1] + dy;
  });
}

/** Every point, apple, prop and spike inside the box between two world points. */
function itemsInBox(from, to) {
  const left = Math.min(from.x, to.x),
    right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y),
    bottom = Math.max(from.y, to.y);
  const inside = ([x, y]) =>
    x >= left && x <= right && y >= top && y <= bottom;
  const found = [];
  for (const [blockIndex, block] of blocks().entries()) {
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
  return found;
}

function finishMarquee() {
  const items = [...marquee.base];
  for (const item of itemsInBox(marquee.from, marquee.to))
    if (!items.some((other) => sameItem(other, item))) items.push(item);
  selection = makeSelection(items);
}

/**
 * Delete a group. Objects go highest index first, so earlier indices stay
 * valid. A ring left with fewer than three points is removed whole: a cave
 * fills in, and an outer ring takes its solid with it.
 */
function deleteItems(items) {
  for (const [type, list] of Object.entries(OBJECT_LISTS())) {
    const indices = items
      .filter((item) => item.type === type)
      .map((item) => item.index);
    for (const index of indices.sort((a, b) => b - a)) list.splice(index, 1);
  }
  const byBlock = new Map();
  for (const point of items.filter((item) => item.type === "point")) {
    if (!byBlock.has(point.blockIndex))
      byBlock.set(point.blockIndex, new Map());
    const rings = byBlock.get(point.blockIndex);
    if (!rings.has(point.boundaryIndex))
      rings.set(point.boundaryIndex, []);
    rings.get(point.boundaryIndex).push(point.index);
  }
  const emptied = new Set();
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
    else emptied.add(blockIndex);
  }
  if (emptied.size)
    trail.terrainBlocks = blocks().filter(
      (_, index) => !emptied.has(index),
    );
}

function drawMarquee() {
  if (!marquee) return;
  const x = Math.min(marquee.from.x, marquee.to.x),
    y = Math.min(marquee.from.y, marquee.to.y);
  const w = Math.abs(marquee.to.x - marquee.from.x),
    h = Math.abs(marquee.to.y - marquee.from.y);
  ctx.fillStyle = "#fff3be22";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#fff3be";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function deleteSelection() {
  if (!selection || ["goal", "start"].includes(selection.kind)) return;
  const kind = selection.kind;
  if (kind === "items") {
    pushHistory();
    deleteItems(selection.items);
    selection = null;
    syncInspector();
    render();
    return;
  }
  if (kind === "blockHandle") {
    // Deleting a curve handle straightens that side of the point.
    const boundary = boundaryAt(selection);
    if (!boundary?.nodes[selection.index]) return;
    pushHistory();
    const nodes = boundary.nodes.map((node, index) =>
      index === selection.index ? { ...node, [selection.side]: null } : node,
    );
    replaceBoundary(selection.blockIndex, selection.boundaryIndex, {
      ...boundary,
      nodes,
    });
    selection = { ...selection, kind: "blockPoint" };
  } else if (kind === "blockPoint" || kind === "blockEdge") {
    // Removing a node from a ring is only safe while the ring can still close.
    const boundary = boundaryAt(selection);
    if (!boundary) return;
    if (boundary.nodes.length <= 3) {
      showStatus(
        "warning",
        "A ring needs at least three points. Delete the whole ring instead (Alt-click it).",
      );
      return;
    }
    pushHistory();
    replaceBoundary(selection.blockIndex, selection.boundaryIndex, {
      ...removeBoundaryNodes(boundary, [selection.index]),
      id: boundary.id,
    });
    selection = {
      kind: "block",
      blockIndex: selection.blockIndex,
      regionIndex: 0,
    };
  } else if (kind === "blockBoundary") {
    // Deleting a cave fills it back in; deleting an outer boundary removes
    // that piece of solid, and the block with it if it was the last piece.
    const block = blocks()[selection.blockIndex];
    if (!block || !boundaryAt(selection)) return;
    pushHistory();
    const next = withBoundary(block, selection.boundaryIndex, null);
    if (next.regions.length) {
      replaceBlock(selection.blockIndex, next);
      selection = {
        kind: "block",
        blockIndex: selection.blockIndex,
        regionIndex: 0,
      };
    } else {
      trail.terrainBlocks = blocks().filter(
        (_, index) => index !== selection.blockIndex,
      );
      selection = null;
    }
  } else if (kind === "block" || kind === "blocks") {
    pushHistory();
    const removed = new Set(selectedBlocks());
    trail.terrainBlocks = blocks().filter((_, index) => !removed.has(index));
    selection = null;
  } else if (kind === "apple") {
    pushHistory();
    trail.apples.splice(selection.index, 1);
    selection = null;
  } else if (kind === "prop") {
    pushHistory();
    trail.props.splice(selection.index, 1);
    selection = null;
  } else if (kind === "spike") {
    pushHistory();
    trail.spikes.splice(selection.index, 1);
    selection = null;
  } else return;
  syncInspector();
  render();
}

function download(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

// The trail picker groups its options natively: official trails first, then
// custom ones split by where they are stored. The group heading says which is
// which, so each option needs only its name. Option values stay the entry's
// index in trailEntries, which is what selectEntry() expects.
function buildPicker() {
  const picker = $("trail-picker");
  const entries = trailEntries.map((entry, index) => ({ entry, index }));
  const groups = [
    ["OFFICIAL", (entry) => entry.source === "official"],
    ["CUSTOM · FILE", (entry) => entry.source === "custom" && entry.storage !== "browser"],
    ["CUSTOM · BROWSER", (entry) => entry.source === "custom" && entry.storage === "browser"],
  ];
  picker.replaceChildren(
    ...groups
      .map(([label, matches]) => [
        label,
        entries.filter(({ entry }) => matches(entry)),
      ])
      .filter(([, items]) => items.length)
      .map(([label, items]) => {
        const group = document.createElement("optgroup");
        group.label = label;
        for (const { entry, index } of items) {
          const option = document.createElement("option");
          option.value = index;
          option.textContent = entry.trail.name;
          group.append(option);
        }
        return group;
      }),
  );
  picker.value = String(trailIndex);
}

function currentEntry() {
  return trailEntries[trailIndex];
}

function canSave(entry = currentEntry()) {
  return entry?.storage === "browser" || (devServer && Boolean(entry?.file));
}

function updateTrailControls() {
  const entry = currentEntry();
  $("save-trail").hidden = !canSave(entry);
  $("delete-trail").hidden =
    entry?.source !== "custom" || (entry.storage !== "browser" && !devServer);
  $("save-status").textContent =
    entry?.storage === "browser"
      ? "Saved in this browser"
      : devServer
        ? `Dev server · trails/${entry?.file}`
        : "Read-only here · duplicate or export to keep changes";
}

/**
 * Swap a button's label briefly, then put it back.
 *
 * The label is remembered as text rather than as markup, so flashing a button
 * that contains a glyph does not strip it out of the header.
 */
function flash(button, text) {
  if (!button) return;
  const original = button.dataset.label || button.textContent.trim();
  button.dataset.label = original;
  const label = button.querySelector("span");
  if (label) label.textContent = text;
  else button.textContent = text;
  setTimeout(() => {
    if (label) label.textContent = original;
    else button.textContent = original;
  }, 1400);
}

/**
 * Refuse an action, naming what has to be fixed.
 *
 * The message is shown at the top of the validation list and repeated on the
 * button itself, because a refusal that is only recorded at the bottom of a long
 * sidebar reads as the editor silently doing nothing. It is also returned, so
 * the caller can decide not to continue.
 */
function refuse(action, errors) {
  const reasons = errors.map((message) => message.text);
  const first = reasons[0] || "the trail does not validate";
  const extra = reasons.length > 1 ? ` (+${reasons.length - 1} more)` : "";
  const text = `Fix ${reasons.length || "the"} validation error${reasons.length === 1 ? "" : "s"} before ${action}: ${first}${extra}`;
  showStatus("error", text);
  flash(
    $("play-test"),
    `${reasons.length} ERROR${reasons.length === 1 ? "" : "S"}`,
  );
  // The validation list is the last thing in the sidebar and easy to miss, so
  // it is brought into view and given attention.
  const list = $("validation-list");
  list.closest("section")?.scrollIntoView({ block: "nearest" });
  list.closest("section")?.classList.add("attention");
  setTimeout(
    () => list.closest("section")?.classList.remove("attention"),
    4000,
  );
  return false;
}

function showStatus(type, text) {
  const item = document.createElement("li");
  item.className = type;
  item.textContent = text;
  $("validation-list").prepend(item);
}

function selectEntry(index) {
  trailIndex = index;
  trail = loadTrailData(trailIndex);
  selection = null;
  history = [];
  future = [];
  focusPending = true;
  focusOnStart();
  rememberTrail();
  buildPicker();
  updateTrailControls();
  syncInspector();
  render();
}

async function persist(entry, data) {
  if (entry.storage === "browser") return saveBrowserTrail(data, entry.key);
  return saveTrailFile(entry.file, data);
}

async function saveTrail() {
  const entry = currentEntry();
  if (!canSave(entry)) return;
  const errors = validateTrail(trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("saving", errors)) return;
  try {
    await persist(entry, trail);
    localStorage.removeItem(DRAFT_PREFIX + entry.id);
    buildPicker();
    updateTrailControls();
    flash($("save-trail"), "SAVED");
  } catch (error) {
    showStatus("error", `Could not save: ${error.message}`);
  }
}

// Dev creates a file in trails/custom; otherwise the trail is stored in this browser.
async function createCustomTrail(data) {
  try {
    const entry = devServer
      ? await saveTrailFile(uniqueCustomFile(data.name), data)
      : saveBrowserTrail(data);
    selectEntry(trailEntries.indexOf(entry));
  } catch (error) {
    showStatus("error", `Could not create the trail: ${error.message}`);
  }
}

async function deleteTrail() {
  const entry = currentEntry();
  if (
    entry?.source !== "custom" ||
    !window.confirm(`Delete “${entry.trail.name}”? This cannot be undone.`)
  )
    return;
  try {
    if (entry.storage === "browser") deleteBrowserTrail(entry.key);
    else await deleteTrailFile(entry.file);
    localStorage.removeItem(DRAFT_PREFIX + entry.id);
    selectEntry(0);
  } catch (error) {
    showStatus("error", `Could not delete: ${error.message}`);
  }
}

const playtestFrame = /** @type {HTMLIFrameElement} */ ($("playtest-frame"));
const playtestOpen = () => !$("playtest").hidden;

function openPlaytest() {
  const errors = validateTrail(trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("play testing", errors)) return;
  try {
    localStorage.setItem(PLAYTEST_TRAIL_KEY, JSON.stringify(trail));
  } catch (error) {
    showStatus("error", `Could not start the play test: ${error.message}`);
    return;
  }
  cancelPendingShape();
  endPointer();
  spaceHeld = false;
  $("playtest-name").textContent = trail.name.toUpperCase();
  $("playtest").hidden = false;
  playtestFrame.src = "./index.html?playtest=1";
  playtestFrame.focus();
}

function closePlaytest() {
  if (!playtestOpen()) return;
  $("playtest").hidden = true;
  playtestFrame.src = "about:blank";
  canvas.focus({ preventScroll: true });
}

playtestFrame.addEventListener("load", () => {
  if (playtestOpen()) playtestFrame.focus();
});
window.addEventListener("message", (event) => {
  if (
    event.origin === window.location.origin &&
    event.source === playtestFrame.contentWindow &&
    event.data?.type === PLAYTEST_EXIT_MESSAGE
  )
    closePlaytest();
});
$("play-test").addEventListener("click", openPlaytest);
$("close-playtest").addEventListener("click", closePlaytest);

buildPicker();
for (const name of Object.keys(terrainMaterials)) {
  for (const select of [$("base-material"), $("selection-material")]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name.toUpperCase();
    select.append(option);
  }
}

// Two-option dropdowns are shown as button rows; this must run after the
// material dropdowns above are filled, so those stay dropdowns.
segmentSelects(document);

document
  .querySelectorAll("[data-tool]")
  .forEach((button) =>
    button.addEventListener("click", () => setTool(button.dataset.tool)),
  );
// Hover tooltips naming each tool's shortcut.
document.querySelectorAll("[data-tool]").forEach((button) => {
  const key = TOOL_KEY_LABELS[button.dataset.tool];
  if (key) button.title = `${button.textContent.trim()} (${key})`;
});
document
  .querySelectorAll("[data-tab]")
  .forEach((button) =>
    button.addEventListener("click", () => setTab(button.dataset.tab)),
  );
$("trail-picker").addEventListener("change", (event) =>
  selectEntry(Number(event.target.value)),
);
$("save-trail").addEventListener("click", saveTrail);
$("new-trail").addEventListener("click", () =>
  createCustomTrail(
    normalizeTrail(createBlankTrail(trailEntries.length), trailEntries.length),
  ),
);
$("duplicate-trail").addEventListener("click", () => {
  const copy = cloneTrail(trail);
  copy.name = `${trail.name} Copy`;
  copy.label = `${copy.name.toUpperCase()} / ${String(trailEntries.length + 1).padStart(2, "0")}`;
  createCustomTrail(copy);
});
$("delete-trail").addEventListener("click", deleteTrail);
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("zoom-in").addEventListener("click", () => {
  zoom = Math.min(2.5, zoom * 1.2);
  updateZoom();
});
$("zoom-out").addEventListener("click", () => {
  zoom = Math.max(0.35, zoom / 1.2);
  updateZoom();
});
function updateZoom() {
  $("zoom-label").textContent = Math.round(zoom * 100) + "%";
  render();
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      // Browsers expose trackpad pinch as a wheel event with Ctrl held.
      const before = pointerWorld(event);
      zoom = Math.max(
        0.35,
        Math.min(2.5, zoom * Math.exp(-event.deltaY * 0.01)),
      );
      const bounds = canvas.getBoundingClientRect();
      cameraX = before.x - (event.clientX - bounds.left) / zoom;
      cameraY = before.y - (event.clientY - bounds.top) / zoom;
      updateZoom();
      return;
    }
    // A normal two-finger trackpad gesture pans in both axes.
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    cameraX += (event.deltaX * deltaScale) / zoom;
    cameraY += (event.deltaY * deltaScale) / zoom;
    render();
  },
  { passive: false },
);

canvas.addEventListener("gesturestart", (event) => {
  event.preventDefault();
  gestureStartZoom = zoom;
  gestureAnchor = pointerWorld(event);
});
canvas.addEventListener("gesturechange", (event) => {
  event.preventDefault();
  if (!gestureAnchor) return;
  zoom = Math.max(0.35, Math.min(2.5, gestureStartZoom * event.scale));
  const bounds = canvas.getBoundingClientRect();
  cameraX = gestureAnchor.x - (event.clientX - bounds.left) / zoom;
  cameraY = gestureAnchor.y - (event.clientY - bounds.top) / zoom;
  updateZoom();
});
canvas.addEventListener("gestureend", (event) => {
  event.preventDefault();
  gestureAnchor = null;
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 2) return;
  canvas.focus({ preventScroll: true });
  const point = pointerWorld(event);
  if (event.button === 1 || tool === "pan" || spaceHeld) {
    panning = true;
    pointerStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX,
      cameraY,
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (tool === "block" || tool === "cut") {
    // Both tools draw a shape: start the drag and show it as it grows.
    pendingKind = tool;
    pendingShape = {
      raw: [[point.x, point.y]],
      end: [point.x, point.y],
      points: [],
      alt: event.altKey,
      shift: event.shiftKey,
      closed: true,
      color: tool === "cut" ? "#ff8952" : "#83d1ce",
      fill: tool === "cut" ? "#ff895226" : "#83d1ce26",
    };
    updateShapePoints(pendingShape);
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    render();
    return;
  }
  if (tool !== "select") {
    addAt(point);
    return;
  }
  // Alt-press: a drag duplicates what's under the cursor; a plain click
  // (decided on release) still selects the whole ring.
  if (
    event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey
  ) {
    altPress = {
      point,
      clientX: event.clientX,
      clientY: event.clientY,
      hit: hitTest(point),
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  const hit = hitTest(point, { wholeBoundary: event.altKey });
  const hitItem = itemFromHit(hit);
  // Dragging from empty space (or anywhere with Cmd/Ctrl) draws a selection box.
  if (!event.altKey && (!hit || event.metaKey || event.ctrlKey)) {
    marquee = {
      from: point,
      to: point,
      base: event.shiftKey ? selectionItems() : [],
    };
    if (!event.shiftKey) selection = null;
    canvas.setPointerCapture(event.pointerId);
    syncInspector();
    render();
    return;
  }
  if (event.shiftKey && hitItem) {
    // Shift-click adds a point, apple, prop or spike, or takes it back out.
    const items = selectionItems();
    const at = items.findIndex((item) => sameItem(item, hitItem));
    if (at >= 0) items.splice(at, 1);
    else items.push(hitItem);
    selection = makeSelection(items);
    syncInspector();
    render();
    return;
  } else if (
    event.shiftKey &&
    (hit?.kind === "block" || hit?.kind === "blockBoundary")
  ) {
    // Shift-click adds a block to the selection, or takes it back out.
    const chosen = new Set(selectedBlocks());
    if (chosen.has(hit.blockIndex) && BLOCK_KINDS.includes(selection?.kind))
      chosen.delete(hit.blockIndex);
    else chosen.add(hit.blockIndex);
    const indices = [...chosen].sort((a, b) => a - b);
    selection =
      indices.length > 1
        ? { kind: "blocks", blockIndices: indices }
        : indices.length
          ? { kind: "block", blockIndex: indices[0], regionIndex: 0 }
          : null;
  } else if (
    hitItem &&
    selection?.kind === "items" &&
    selection.items.some((item) => sameItem(item, hitItem))
  ) {
    // Pressing an item that's part of the group drags the whole group.
  } else if (
    !(
      hit?.kind === "block" &&
      selection?.kind === "blocks" &&
      selection.blockIndices.includes(hit.blockIndex)
    )
  ) {
    // Pressing on a block that is already part of a multi-selection drags
    // the whole selection; anything else selects what was hit.
    selection = hit;
  }
  if (selection) {
    dragSnapshot = snapshot();
    dragOrigin = { pointer: point, position: selectedPosition() };
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  }
  syncInspector();
  render();
});
canvas.addEventListener("pointermove", (event) => {
  // No button held: the release was missed, so end the drag here.
  if ((dragging || panning || marquee || altPress) && event.buttons === 0) {
    endPointer();
    return;
  }
  if (panning && pointerStart) {
    cameraX =
      pointerStart.cameraX - (event.clientX - pointerStart.clientX) / zoom;
    cameraY =
      pointerStart.cameraY - (event.clientY - pointerStart.clientY) / zoom;
    render();
    return;
  }
  if (PLACING_TOOLS.has(tool) && !dragging) {
    hoverPoint = pointerWorld(event);
    render();
  }
  if (pendingShape) {
    const point = pointerWorld(event);
    const last = pendingShape.raw.at(-1);
    // Sampled often enough to follow a curve, but not thousands of points.
    if (Math.hypot(point.x - last[0], point.y - last[1]) > 6 / zoom)
      pendingShape.raw.push([point.x, point.y]);
    pendingShape.end = [point.x, point.y];
    pendingShape.alt = event.altKey;
    pendingShape.shift = event.shiftKey;
    updateShapePoints(pendingShape);
    render();
    return;
  }
  if (marquee) {
    marquee.to = pointerWorld(event);
    render();
    return;
  }
  if (altPress) {
    // Wait for a real drag, so an Alt-click stays a click.
    if (
      Math.hypot(
        event.clientX - altPress.clientX,
        event.clientY - altPress.clientY,
      ) < 4
    )
      return;
    const press = altPress;
    altPress = null;
    // One undo step covers both the copy and the move.
    const before = snapshot();
    const copy = duplicateTarget(press.hit);
    if (!copy) return;
    selection = copy;
    dragSnapshot = before;
    dragOrigin = { pointer: press.point, position: selectedPosition() };
    dragging = true;
    lastDragPointer = { clientX: event.clientX, clientY: event.clientY };
    dragSelectionTo(lastDragPointer, event.shiftKey);
    return;
  }
  if (!dragging || !selection) return;
  lastDragPointer = { clientX: event.clientX, clientY: event.clientY };
  dragSelectionTo(lastDragPointer, event.shiftKey);
});

/**
 * The points a Shift-drag measures its angle from: the neighbours of a dragged
 * point along its ring, or the point a curve handle belongs to.
 */
function snapAnchors() {
  if (selection?.kind !== "blockPoint" && selection?.kind !== "blockHandle")
    return null;
  const boundary = boundaryAt(selection);
  const node = boundary?.nodes[selection.index];
  if (!boundary || !node) return null;
  if (selection.kind === "blockHandle") return [node];
  const count = boundary.nodes.length;
  return [
    boundary.nodes[(selection.index + count - 1) % count],
    boundary.nodes[(selection.index + 1) % count],
  ].filter((other) => other !== node);
}

/** Move the dragged selection to where the pointer is, snapping points and handles while Shift is held. */
function dragSelectionTo(pointer, shift) {
  if (dragSnapshot) {
    pushHistory(dragSnapshot);
    dragSnapshot = null;
  }
  // The selection moves by as much as the pointer has, so grabbing a block
  // away from its centre does not make it jump.
  const point = pointerWorld(pointer);
  const origin = dragOrigin?.position;
  let x = origin ? origin[0] + point.x - dragOrigin.pointer.x : point.x;
  let y = origin ? origin[1] + point.y - dragOrigin.pointer.y : point.y;
  snapGuide = null;
  const anchors = shift ? snapAnchors() : null;
  if (anchors) {
    const snapped = snapToAngleAndGrid({ x, y }, anchors, gridSpacing(zoom));
    x = snapped.x;
    y = snapped.y;
    if (snapped.anchor)
      snapGuide = {
        from: snapped.anchor,
        to: { x, y },
        angle: snapped.angle,
        length: snapped.length,
      };
  }
  updateSelectedPosition(x, y);
  syncInspector();
  render();
}

// Pressing or releasing Shift mid-drag turns snapping on or off straight away,
// without waiting for the pointer to move.
const onShiftChange = (event) => {
  if (
    event.key !== "Shift" ||
    !dragging ||
    !selection ||
    pendingShape ||
    !lastDragPointer
  )
    return;
  dragSelectionTo(lastDragPointer, event.type === "keydown");
};
window.addEventListener("keydown", onShiftChange);
window.addEventListener("keyup", onShiftChange);

// Alt and Shift change a Block or Cut drag straight away, without moving the mouse.
const onShapeModifier = (event) => {
  if (!pendingShape || (event.key !== "Alt" && event.key !== "Shift")) return;
  event.preventDefault();
  pendingShape.alt = event.altKey;
  pendingShape.shift = event.shiftKey;
  updateShapePoints(pendingShape);
  render();
};
window.addEventListener("keydown", onShapeModifier);
window.addEventListener("keyup", onShapeModifier);

// On Windows a lone Alt press can move focus to the browser's menu bar;
// keep it on the canvas.
for (const type of ["keydown", "keyup"])
  window.addEventListener(type, (event) => {
    if (event.key === "Alt" && document.activeElement === canvas)
      event.preventDefault();
  });
canvas.addEventListener("dblclick", (event) => {
  if (tool !== "select") return;
  const point = pointerWorld(event);
  const hit = hitTest(point);
  // A double-click on an edge adds a point to it, keeping the edge's shape.
  if (hit?.kind === "blockEdge") {
    pushHistory();
    insertBlockNode(hit.boundaryIndex, hit.index, hit.t, hit.blockIndex);
    syncInspector();
    render();
  }
});

/** Forget everything about the current press, so nothing keeps following the mouse. */
function resetPointerState() {
  dragging = false;
  panning = false;
  pointerStart = null;
  dragSnapshot = null;
  dragOrigin = null;
  lastDragPointer = null;
  snapGuide = null;
  marquee = null;
  altPress = null;
}

const endPointer = () => {
  if (pendingShape) {
    const shape = pendingShape;
    const kind = pendingKind;
    pendingShape = null;
    pendingKind = null;
    resetPointerState();
    // Only a shape that changed something becomes an undo step, so a missed
    // cut neither leaves an empty step nor clears the redo history.
    const before = snapshot();
    if (commitShape(kind, shape.points, shape.closed, shape.alt))
      pushHistory(before);
    else if (kind === "block")
      showStatus(
        "warning",
        "That was too small to be a block. Drag a larger shape.",
      );
    syncInspector();
    render();
    return;
  }
  if (marquee) {
    finishMarquee();
    resetPointerState();
    syncInspector();
    render();
    return;
  }
  if (altPress) {
    // Alt-click without a drag keeps its old meaning: select the whole ring.
    selection = hitTest(altPress.point, { wholeBoundary: true });
    resetPointerState();
    syncInspector();
    render();
    return;
  }
  const hadGuide = snapGuide !== null;
  resetPointerState();
  if (hadGuide) render();
};

/** Drop a Block or Cut drag that is still being drawn, without applying it. */
function cancelPendingShape() {
  if (!pendingShape && !marquee) return false;
  pendingShape = null;
  pendingKind = null;
  resetPointerState();
  render();
  return true;
}
canvas.addEventListener("pointerup", endPointer);
// A cancelled gesture discards a half-drawn shape instead of applying it.
canvas.addEventListener("pointercancel", () => {
  if (!cancelPendingShape()) endPointer();
});
canvas.addEventListener("pointerleave", () => {
  if (!hoverPoint) return;
  hoverPoint = null;
  render();
});

window.addEventListener("keydown", (event) => {
  if (playtestOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePlaytest();
    }
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    // Blurring commits a field that is still being typed in through its change handler.
    event.preventDefault();
    /** @type {HTMLElement} */ (document.activeElement)?.blur?.();
    openPlaytest();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
    event.preventDefault();
    if (canSave()) saveTrail();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.code === "KeyY") {
    event.preventDefault();
    redo();
    return;
  }

  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    document.activeElement === canvas
  ) {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (event.code === "Space" && document.activeElement === canvas) {
    event.preventDefault();
    spaceHeld = true;
  }
  if (
    document.activeElement !== canvas ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  if (event.key === "Escape") {
    // Escape backs out one step: an unfinished shape, then the tool, then the selection.
    if (cancelPendingShape()) return;
    if (tool === "select" && selection) {
      selection = null;
      syncInspector();
      render();
      return;
    }
  }
  if (event.key === "Escape") {
    setTool("select");
    render();
    return;
  }
  if (TOOL_KEYS[event.code] && !event.shiftKey) {
    setTool(TOOL_KEYS[event.code]);
    render();
    return;
  }
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    nudgeSelection(event.key, event.shiftKey);
    return;
  }
  if (event.key === "[" || event.key === "]") {
    cyclePropType(event.key === "]" ? 1 : -1);
    return;
  }
  if (event.code === "KeyX") {
    toggleFlip();
    return;
  }
  if (event.key === "=" || event.key === "+") {
    zoomAtCenter(1.2);
    return;
  }
  if (event.key === "-") {
    zoomAtCenter(1 / 1.2);
    return;
  }
  if (event.key === "0") {
    zoomAtCenter(1 / zoom);
    return;
  }
  if (event.key === "Home") {
    focusOnStart();
    render();
    return;
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") spaceHeld = false;
});

function bindTrailInput(id, apply) {
  $(id).addEventListener("change", (event) => {
    pushHistory();
    apply(event.target.value);
    syncInspector();
    render();
  });
}
bindTrailInput("trail-name", (value) => {
  trail.name = value;
  trail.label = `${value.toUpperCase()} / ${String(trailIndex + 1).padStart(2, "0")}`;
});
bindTrailInput("base-material", (value) => {
  const previous = trail.terrain;
  if (value === previous) return;
  trail.terrain = value;
  // Blocks carry their own material, so the renderer never reads the trail's
  // base. Any block still sitting on the old base follows the change; blocks
  // deliberately set to something else keep it.
  const next = blocks().map((block) =>
    block.material === previous ? { ...block, material: value } : block,
  );
  if (next.some((block, index) => block !== blocks()[index]))
    trail.terrainBlocks = next;
});
bindTrailInput("goal-x", (value) => {
  trail.goal = Number(value);
});
bindTrailInput("fall-y", (value) => {
  trail.fallY = Number(value);
});

bindTrailInput("time-of-day", (value) => {
  trail.timeOfDay = value;
});

bindTrailInput("backdrop", (value) => {
  if (value && value !== "hills") trail.backdrop = value;
  else delete trail.backdrop;
});
for (const key of ["sun", "clouds", "rain", "lightning"]) {
  $(`weather-${key}`).addEventListener("change", (event) => {
    pushHistory();
    trail.weather[key] = Number(event.target.value);
    syncInspector();
    render();
  });
  $(`weather-${key}`).addEventListener("input", (event) => {
    trail.weather[key] = Number(event.target.value);
    render();
  });
}
$("selection-x").addEventListener("change", (event) => {
  const position = selectedPosition();
  if (!position) return;
  pushHistory();
  updateSelectedPosition(Number(event.target.value), position[1]);
  syncInspector();
  render();
});
$("selection-y").addEventListener("change", (event) => {
  const position = selectedPosition();
  if (!position) return;
  pushHistory();
  updateSelectedPosition(position[0], Number(event.target.value));
  syncInspector();
  render();
});
$("selection-snap").addEventListener("change", (event) => {
  if (selection?.kind !== "goal") return;
  pushHistory();
  // Unchecked pins the finish in the air at its current height; checked sends
  // it back to whatever surface is under the finish.
  trail.finishY = event.target.checked ? null : finishY();
  syncInspector();
  render();
});
$("selection-material").addEventListener("change", (event) => {
  const material = event.target.value;
  if (BLOCK_KINDS.includes(selection?.kind)) {
    const chosen = selectedBlocks().filter((index) => blocks()[index]);
    if (!chosen.length) return;
    pushHistory();
    for (const index of chosen)
      replaceBlock(index, { ...blocks()[index], material });
  }
  syncInspector();
  render();
});
$("selection-edge").addEventListener("change", (event) => {
  if (!["blockPoint", "blockEdge"].includes(selection?.kind)) return;
  const boundary = boundaryAt(selection);
  if (!boundary) return;
  pushHistory();
  const updated = setBoundaryEdge(
    boundary,
    selection.index,
    event.target.value === "curve",
  );
  replaceBoundary(selection.blockIndex, selection.boundaryIndex, {
    ...updated,
    id: boundary.id,
  });
  syncInspector();
  render();
});
$("selection-node").addEventListener("change", (event) => {
  if (!["blockPoint", "blockEdge"].includes(selection?.kind)) return;
  const boundary = boundaryAt(selection);
  if (!boundary) return;
  pushHistory();
  const updated = setNodeMode(boundary, selection.index, event.target.value);
  replaceBoundary(selection.blockIndex, selection.boundaryIndex, {
    ...updated,
    id: boundary.id,
  });
  syncInspector();
  render();
});
$("selection-facing").addEventListener("change", (event) => {
  if (selection?.kind !== "start") return;
  pushHistory();
  trail.start.facing = Number(event.target.value) < 0 ? -1 : 1;
  syncInspector();
  render();
});
$("selection-flip").addEventListener("change", (event) => {
  if (selection?.kind !== "prop") return;
  const prop = trail.props[selection.index];
  if (!canFlip(prop.type)) return;
  pushHistory();
  if (event.target.value === "true") prop.flip = true;
  else delete prop.flip;
  syncInspector();
  render();
});

$("selection-prop-type").addEventListener("change", (event) => {
  if (selection?.kind !== "prop") return;
  pushHistory();
  const prop = trail.props[selection.index];
  prop.type = event.target.value;
  if (prop.type === "sign" && typeof prop.text !== "string") prop.text = "";
  syncInspector();
  render();
});
$("selection-layer").addEventListener("change", (event) => {
  if (selection?.kind !== "prop") return;
  pushHistory();
  trail.props[selection.index].layer =
    event.target.value === "front" ? "front" : "back";
  syncInspector();
  render();
});
let propTextPending = false;
$("selection-prop-text").addEventListener("focus", () => {
  if (selection?.kind === "prop") propTextPending = true;
});
$("selection-prop-text").addEventListener("input", (event) => {
  if (selection?.kind !== "prop") return;
  if (propTextPending) {
    pushHistory();
    propTextPending = false;
  }
  trail.props[selection.index].text = event.target.value;
  render();
});
$("selection-prop-text").addEventListener("change", () => syncInspector());
$("selection-radius").addEventListener("change", (event) => {
  if (selection?.kind !== "spike") return;
  pushHistory();
  trail.spikes[selection.index].radius = Math.max(
    SPIKE_RADIUS.min,
    Math.min(
      SPIKE_RADIUS.max,
      Number(event.target.value) || SPIKE_RADIUS.default,
    ),
  );
  syncInspector();
  render();
});
$("selection-spin").addEventListener("change", (event) => {
  if (selection?.kind !== "spike") return;
  pushHistory();
  const spin = Number(event.target.value);
  trail.spikes[selection.index].spin = Number.isFinite(spin) ? spin : 0;
  syncInspector();
  render();
});
$("delete-selection").addEventListener("click", deleteSelection);
$("game-art").checked = gameArt;
$("game-art").addEventListener("change", (event) => {
  gameArt = event.target.checked;
  try {
    localStorage.setItem(GAME_ART_KEY, gameArt ? "1" : "0");
  } catch (_) {}
  render();
});
$("save-draft").addEventListener("click", () => {
  localStorage.setItem(DRAFT_PREFIX + currentEntry().id, JSON.stringify(trail));
  flash($("save-draft"), "SAVED");
});
$("export-json").addEventListener("click", () => {
  const errors = validateTrail(trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("exporting", errors)) return;
  download(
    `${trail.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
    JSON.stringify(trail, null, 2) + "\n",
    "application/json",
  );
});

$("export-js").addEventListener("click", () => {
  const errors = validateTrail(trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("exporting", errors)) return;
  download(
    `${trail.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.js`,
    trailToModule(trail),
    "text/javascript",
  );
});
$("import-json").addEventListener("click", () => {
  try {
    pushHistory();
    trail = normalizeTrail(JSON.parse($("trail-json").value), trailIndex);
    selection = null;
    focusPending = true;
    focusOnStart();
    syncInspector();
    render();
  } catch (error) {
    const item = document.createElement("li");
    item.className = "error";
    item.textContent = `Invalid JSON: ${error.message}`;
    $("validation-list").replaceChildren(item);
  }
});

new ResizeObserver(resize).observe(wrap);
setTool("select");
syncInspector();
updateHistoryButtons();
updateTrailControls();
resize();
// The save controls depend on the dev server, so reveal once that is known.
detectDevServer().then((available) => {
  devServer = available;
  updateTrailControls();
  document.querySelector(".editor-shell").removeAttribute("data-booting");
});
