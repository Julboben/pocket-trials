// The selection and trail panels on the right.
import { canFlip } from "../drawing.js";
import {
  cubicPoint,
  edgeCurve,
  isCurvedEdge,
  moveBlock,
  setBoundaryEdge,
  setNodeMode,
} from "../terrain-geometry.js";
import { SPIKE_RADIUS, validateTrail } from "../trail-schema.js";
import {
  blocks,
  boundariesOf,
  boundaryAt,
  fillCavesWithBackWalls,
  isBackWall,
  realignSmooth,
  replaceBlock,
  replaceBoundary,
  selectedBlocks,
  selectedCaves,
} from "./blocks.js";
import { $ } from "./dom.js";
import { pushHistory, updateHistoryButtons } from "./history.js";
import { updateVersionChip } from "./drafts.js";
import { updateValidationBadge } from "./menu.js";
import { showStatus } from "./status.js";
import {
  finishY,
  groundY,
  objectY,
  render,
  syncTerrain,
} from "./render.js";
import {
  deleteSelection,
  groupTitle,
  itemsCentre,
  moveItems,
} from "./selection.js";
import { editor } from "./state.js";
import { saveToolSettings, toolSettings } from "./tools.js";

export function selectedPosition() {
  if (!editor.selection) return null;
  if (editor.selection.kind === "items") return itemsCentre(editor.selection.items);
  if (
    editor.selection.kind === "blockPoint" ||
    editor.selection.kind === "blockHandle" ||
    editor.selection.kind === "blockEdge"
  ) {
    const boundary = boundaryAt(editor.selection);
    if (!boundary) return null;
    const node = boundary.nodes[editor.selection.index];
    if (editor.selection.kind === "blockHandle") {
      const handle = node[editor.selection.side];
      return handle ? [handle[0], handle[1]] : [node.x, node.y];
    }
    if (editor.selection.kind === "blockEdge") {
      const next =
        boundary.nodes[(editor.selection.index + 1) % boundary.nodes.length];
      const [p0, c1, c2, p1] = edgeCurve(node, next);
      return cubicPoint(p0, c1, c2, p1, editor.selection.t);
    }
    return [node.x, node.y];
  }
  if (editor.selection.kind === "block" || editor.selection.kind === "blockBoundary") {
    const chosen = selectedBlocks()
      .map((index) => blocks()[index])
      .filter(Boolean);
    if (!chosen.length) return null;
    // The handle for blocks, or for one empty space, is the centre of their
    // nodes. A block covers every node it owns; a single boundary just its own.
    const nodes =
      editor.selection.kind === "blockBoundary"
        ? boundariesOf(chosen[0])[editor.selection.boundaryIndex]?.nodes || []
        : chosen.flatMap((block) =>
            boundariesOf(block).flatMap((boundary) => boundary.nodes),
          );
    if (!nodes.length) return null;
    return [
      nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length,
      nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length,
    ];
  }
  if (editor.selection.kind === "apple") {
    const apple = editor.trail.apples[editor.selection.index];
    return [apple.x, objectY(apple, 60)];
  }
  if (editor.selection.kind === "prop") {
    const prop = editor.trail.props[editor.selection.index];
    return [prop.x, objectY(prop)];
  }
  if (editor.selection.kind === "spike") {
    const spike = editor.trail.spikes[editor.selection.index];
    return [spike.x, spike.y];
  }
  if (editor.selection.kind === "start")
    return [
      editor.trail.start.x,
      Number.isFinite(editor.trail.start.y)
        ? editor.trail.start.y
        : groundY(editor.trail.start.x) - 12,
    ];
  if (editor.selection.kind === "goal") return [editor.trail.goal, finishY()];
  return null;
}

const BLOCK_KINDS = [
  "block",
  "blockPoint",
  "blockHandle",
  "blockEdge",
  "blockBoundary",
];

/**
 * Bring the side panel up to date with the trail. `live` is for a drag in
 * progress: the trail's JSON and validation are expensive on a big trail, so
 * they wait until the pointer pauses or is released.
 */
export function syncInspector({ live = false } = {}) {
  syncTerrain();
  $("trail-name").value = editor.trail.name;
  $("goal-x").value = Math.round(editor.trail.goal);
  $("fall-y").value = Math.round(editor.trail.fallY);
  $("time-of-day").value = editor.trail.timeOfDay || "noon";
  $("backdrop").value = editor.trail.backdrop || "hills";
  for (const key of ["sun", "clouds", "rain", "lightning"])
    $(`weather-${key}`).value = editor.trail.weather?.[key] ?? 0;
  const position = selectedPosition();
  $("selection-fields").hidden = !editor.selection;
  $("selection-title").textContent = !editor.selection
    ? "NOTHING SELECTED"
    : editor.selection.kind === "items"
      ? groupTitle(editor.selection.items)
      : editor.selection.kind === "block" &&
          isBackWall(blocks()[editor.selection.blockIndex])
        ? "BACK WALL"
        : editor.selection.kind.replace(/([A-Z])/g, " $1").toUpperCase();
  $("selection-empty").hidden = Boolean(editor.selection);
  if (position) {
    $("selection-x").value = Math.round(position[0]);
    $("selection-y").value = Math.round(position[1]);
  }
  // A group with blocks in it can change their material together.
  const isBlock =
    BLOCK_KINDS.includes(editor.selection?.kind) || selectedBlocks().length > 0;
  // The finish can be moved in y, so its Y row is shown. Every other object
  // with a fixed height is left as it was.
  $("selection-y-row").hidden = !editor.selection;
  $("selection-material-row").hidden = !isBlock;
  $("selection-block-layer-row").hidden = !isBlock;
  $("fill-back-walls").hidden = !selectedCaves().length;
  $("selection-edge-row").hidden = !["blockPoint", "blockEdge"].includes(
    editor.selection?.kind,
  );
  $("selection-node-row").hidden = !["blockPoint", "blockEdge"].includes(
    editor.selection?.kind,
  );
  $("selection-facing-row").hidden = editor.selection?.kind !== "start";
  $("selection-prop-type-row").hidden = editor.selection?.kind !== "prop";
  $("selection-layer-row").hidden = editor.selection?.kind !== "prop";
  $("selection-prop-text-row").hidden =
    editor.selection?.kind !== "prop" || editor.trail.props[editor.selection.index]?.type !== "sign";
  const selectedProp = editor.selection?.kind === "prop" ? editor.trail.props[editor.selection.index] : null;
  $("selection-flip-row").hidden = !selectedProp || !canFlip(selectedProp.type);
  if (selectedProp) $("selection-flip").value = String(Boolean(selectedProp.flip));
  $("selection-radius-row").hidden = editor.selection?.kind !== "spike";
  $("selection-spin-row").hidden = editor.selection?.kind !== "spike";
  $("delete-selection").hidden =
    !editor.selection || ["start", "goal"].includes(editor.selection.kind);
  if (isBlock) {
    const first = blocks()[selectedBlocks()[0]];
    $("selection-material").value = first?.material || "grass";
    $("selection-block-layer").value = isBackWall(first) ? "back" : "terrain";
    const boundary = boundaryAt(editor.selection);
    const node = boundary?.nodes[editor.selection.index];
    if (node && editor.selection.kind !== "blockHandle") {
      $("selection-edge").value = isCurvedEdge(
        node,
        boundary.nodes[(editor.selection.index + 1) % boundary.nodes.length],
      )
        ? "curve"
        : "straight";
      $("selection-node").value = node.mode;
    }
  }
  if (editor.selection?.kind === "start")
    $("selection-facing").value = String(editor.trail.start.facing);
  if (editor.selection?.kind === "prop") {
    $("selection-prop-type").value = editor.trail.props[editor.selection.index].type;
    $("selection-layer").value = editor.trail.props[editor.selection.index].layer;
    $("selection-prop-text").value = editor.trail.props[editor.selection.index].text || "";
  }
  if (editor.selection?.kind === "spike") {
    $("selection-radius").value = editor.trail.spikes[editor.selection.index].radius;
    $("selection-spin").value = editor.trail.spikes[editor.selection.index].spin;
  }
  if (live) {
    clearTimeout(pendingDetails);
    pendingDetails = setTimeout(syncDetails, 200);
  } else syncDetails();
  updateHistoryButtons();
}

let pendingDetails = null;

function syncDetails() {
  clearTimeout(pendingDetails);
  pendingDetails = null;
  const json = JSON.stringify(editor.trail, null, 2);
  $("trail-json").value = json;
  updateVersionChip(json);
  const messages = validateTrail(editor.trail);
  $("validation-list").replaceChildren(
    ...messages.map((message) => {
      const item = document.createElement("li");
      item.className = message.type;
      item.textContent = message.text;
      return item;
    }),
  );
  updateValidationBadge(messages);
}

/** Finish any JSON and validation a live drag left waiting. */
export function flushInspector() {
  if (pendingDetails !== null) syncDetails();
}

export function updateSelectedPosition(x, y) {
  if (!editor.selection) return;
  const kind = editor.selection.kind;
  if (kind === "items") {
    moveItems(x, y);
    return;
  }
  if (kind === "blockPoint" || kind === "blockHandle") {
    const boundary = boundaryAt(editor.selection);
    if (!boundary) return;
    const node = boundary.nodes[editor.selection.index];
    if (!node) return;
    if (kind === "blockHandle") node[editor.selection.side] = [x, y];
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
    if (node.mode === "smooth") realignSmooth(boundary, editor.selection.index);
  } else if (kind === "blockEdge") {
    // Dragging an edge stretches it: the handles follow so the curve keeps its
    // shape rather than collapsing into its chord.
    const boundary = boundaryAt(editor.selection);
    if (!boundary) return;
    const node = boundary.nodes[editor.selection.index];
    const next = boundary.nodes[(editor.selection.index + 1) % boundary.nodes.length];
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
  } else if (kind === "block") {
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
    const boundary = boundaryAt(editor.selection);
    if (!current || !boundary) return;
    const dx = x - current[0],
      dy = y - current[1];
    replaceBoundary(editor.selection.blockIndex, editor.selection.boundaryIndex, {
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
    editor.trail.apples[editor.selection.index].x = x;
    editor.trail.apples[editor.selection.index].y = y;
  } else if (kind === "prop") {
    editor.trail.props[editor.selection.index].x = x;
    editor.trail.props[editor.selection.index].y = y;
  } else if (kind === "spike") {
    editor.trail.spikes[editor.selection.index].x = x;
    editor.trail.spikes[editor.selection.index].y = y;
  } else if (kind === "start") {
    editor.trail.start.x = x;
    editor.trail.start.y = y;
  } else if (kind === "goal") {
    // The finish is a point: it can be moved in y as well as x, so a flag can
    // stand on a floating block or hang above a cave instead of being pinned to the
    // surface. Dragging it sets an explicit height, which the inspector can
    // clear to send it back to the ground.
    editor.trail.goal = x;
    editor.trail.finishY = y;
  }
}

function bindTrailInput(id, apply) {
  $(id).addEventListener("change", (event) => {
    pushHistory();
    apply(event.target.value);
    syncInspector();
    render();
  });
}

let propTextPending = false;

export function bindInspector() {
  bindTrailInput("trail-name", (value) => {
    editor.trail.name = value;
    editor.trail.label = `${value.toUpperCase()} / ${String(editor.trailIndex + 1).padStart(2, "0")}`;
  });

  bindTrailInput("goal-x", (value) => {
    editor.trail.goal = Number(value);
  });

  bindTrailInput("fall-y", (value) => {
    editor.trail.fallY = Number(value);
  });

  bindTrailInput("time-of-day", (value) => {
    editor.trail.timeOfDay = value;
  });

  bindTrailInput("backdrop", (value) => {
    if (value && value !== "hills") editor.trail.backdrop = value;
    else delete editor.trail.backdrop;
  });

  for (const key of ["sun", "clouds", "rain", "lightning"]) {
    $(`weather-${key}`).addEventListener("change", (event) => {
      pushHistory();
      editor.trail.weather[key] = Number(event.target.value);
      syncInspector();
      render();
    });
    $(`weather-${key}`).addEventListener("input", (event) => {
      editor.trail.weather[key] = Number(event.target.value);
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

  $("selection-material").addEventListener("change", (event) => {
    const material = event.target.value;
    if (BLOCK_KINDS.includes(editor.selection?.kind) || editor.selection?.kind === "items") {
      const chosen = selectedBlocks().filter((index) => blocks()[index]);
      if (!chosen.length) return;
      pushHistory();
      for (const index of chosen)
        replaceBlock(index, { ...blocks()[index], material });
      // The next block drawn uses the material last chosen.
      toolSettings.block.material = material;
      saveToolSettings();
    }
    syncInspector();
    render();
  });

  // Moving blocks between the terrain and the back walls; the next block drawn
  // goes on the layer last chosen.
  $("selection-block-layer").addEventListener("change", (event) => {
    const back = event.target.value === "back";
    const chosen = selectedBlocks().filter(
      (index) => blocks()[index] && isBackWall(blocks()[index]) !== back,
    );
    if (chosen.length) {
      pushHistory();
      for (const index of chosen) {
        const { layer, ...block } = blocks()[index];
        replaceBlock(index, back ? { ...block, layer: "back" } : block);
      }
      toolSettings.block.layer = back ? "back" : "terrain";
      saveToolSettings();
    }
    syncInspector();
    render();
  });

  $("fill-back-walls").addEventListener("click", () => {
    const added = fillCavesWithBackWalls();
    if (added)
      showStatus(
        "info",
        `Added ${added === 1 ? "a back wall" : `${added} back walls`}; ${added === 1 ? "the cave stays" : "the caves stay"} dark.`,
      );
    syncInspector();
    render();
  });

  $("selection-edge").addEventListener("change", (event) => {
    if (!["blockPoint", "blockEdge"].includes(editor.selection?.kind)) return;
    const boundary = boundaryAt(editor.selection);
    if (!boundary) return;
    pushHistory();
    const updated = setBoundaryEdge(
      boundary,
      editor.selection.index,
      event.target.value === "curve",
    );
    replaceBoundary(editor.selection.blockIndex, editor.selection.boundaryIndex, {
      ...updated,
      id: boundary.id,
    });
    syncInspector();
    render();
  });

  $("selection-node").addEventListener("change", (event) => {
    if (!["blockPoint", "blockEdge"].includes(editor.selection?.kind)) return;
    const boundary = boundaryAt(editor.selection);
    if (!boundary) return;
    pushHistory();
    const updated = setNodeMode(boundary, editor.selection.index, event.target.value);
    replaceBoundary(editor.selection.blockIndex, editor.selection.boundaryIndex, {
      ...updated,
      id: boundary.id,
    });
    syncInspector();
    render();
  });

  $("selection-facing").addEventListener("change", (event) => {
    if (editor.selection?.kind !== "start") return;
    pushHistory();
    editor.trail.start.facing = Number(event.target.value) < 0 ? -1 : 1;
    syncInspector();
    render();
  });

  $("selection-flip").addEventListener("change", (event) => {
    if (editor.selection?.kind !== "prop") return;
    const prop = editor.trail.props[editor.selection.index];
    if (!canFlip(prop.type)) return;
    pushHistory();
    if (event.target.value === "true") prop.flip = true;
    else delete prop.flip;
    syncInspector();
    render();
  });

  $("selection-prop-type").addEventListener("change", (event) => {
    if (editor.selection?.kind !== "prop") return;
    pushHistory();
    const prop = editor.trail.props[editor.selection.index];
    prop.type = event.target.value;
    if (prop.type === "sign" && typeof prop.text !== "string") prop.text = "";
    syncInspector();
    render();
  });

  $("selection-layer").addEventListener("change", (event) => {
    if (editor.selection?.kind !== "prop") return;
    pushHistory();
    editor.trail.props[editor.selection.index].layer =
      event.target.value === "front" ? "front" : "back";
    syncInspector();
    render();
  });

  $("selection-prop-text").addEventListener("focus", () => {
    if (editor.selection?.kind === "prop") propTextPending = true;
  });

  $("selection-prop-text").addEventListener("input", (event) => {
    if (editor.selection?.kind !== "prop") return;
    if (propTextPending) {
      pushHistory();
      propTextPending = false;
    }
    editor.trail.props[editor.selection.index].text = event.target.value;
    render();
  });

  $("selection-prop-text").addEventListener("change", () => syncInspector());

  $("selection-radius").addEventListener("change", (event) => {
    if (editor.selection?.kind !== "spike") return;
    pushHistory();
    editor.trail.spikes[editor.selection.index].radius = Math.max(
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
    if (editor.selection?.kind !== "spike") return;
    pushHistory();
    const spin = Number(event.target.value);
    editor.trail.spikes[editor.selection.index].spin = Number.isFinite(spin) ? spin : 0;
    syncInspector();
    render();
  });

  $("delete-selection").addEventListener("click", deleteSelection);
}
