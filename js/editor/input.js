// Pointer, gesture and keyboard handling on the canvas.
import {
  addAt,
  blocks,
  boundaryAt,
  commitShape,
  insertBlockNode,
  selectedBlocks,
  updateShapePoints,
} from "./blocks.js";
import { isCurvedEdge } from "../terrain-geometry.js";
import { typingInField } from "./clipboard.js";
import { $, canvas } from "./dom.js";
import { pushHistory, redo, snapshot, undo } from "./history.js";
import { hitTest } from "./hit-test.js";
import {
  endScale,
  scaleCursor,
  scaleHandleAt,
  scaling,
  startScale,
  updateScale,
} from "./scale.js";
import {
  flushInspector,
  selectedPosition,
  syncInspector,
  updateSelectedPosition,
} from "./inspector.js";
import { closePlaytest, openPlaytest, playtestOpen } from "./playtest.js";
import { render, renderView } from "./render.js";
import {
  blockNodes,
  cyclePropType,
  deleteSelection,
  duplicateTarget,
  finishMarquee,
  inGroup,
  itemFromHit,
  itemPosition,
  makeSelection,
  nudgeSelection,
  sameItem,
  selectAll,
  selectionItems,
  toggleFlip,
} from "./selection.js";
import { gridSpacing, snapToAngleAndGrid } from "./snap.js";
import { clampZoom, editor } from "./state.js";
import { showStatus } from "./status.js";
import { PLACING_TOOLS, TOOL_KEYS, setTool } from "./tools.js";
import { canSave, saveDraft, saveTrail } from "./trails.js";
import {
  focusOnStart,
  pointerWorld,
  updateZoom,
  zoomAtCenter,
} from "./view.js";

let dragging = false;

let panning = false;

let pointerStart = null;

let gestureStartZoom = 1;

let gestureAnchor = null;

// The trail as it was when a drag began. It becomes an undo step only once the
// drag actually moves something, so a plain click never leaves an empty one.
let dragSnapshot = null;

let dragOrigin = null;

let lastDragPointer = null;

let pendingKind = null;

// How far, in screen pixels, a press must move before it drags or scales, so
// the wobble of a click or double-click moves nothing.
const DRAG_SLOP = 3;

// Where a press that may become a drag or scale began, until it has moved
// further than DRAG_SLOP.
let pressClient = null;

/** Has the pointer moved far enough from the press to start dragging? */
function pastSlop(event) {
  if (!pressClient) return true;
  if (
    Math.hypot(event.clientX - pressClient.clientX, event.clientY - pressClient.clientY) <
    DRAG_SLOP
  )
    return false;
  pressClient = null;
  return true;
}

// Where the pointer is while a scale handle is dragged, so Alt and Shift can
// re-apply the scale without the pointer moving.
let scalePoint = null;

function applyScale(event) {
  const before = updateScale(scalePoint, { alt: event.altKey, shift: event.shiftKey });
  if (before) pushHistory(before);
  syncInspector({ live: true });
  render();
}

// An Alt press that becomes a duplicate once the mouse moves.
let altPress = null;

/**
 * The points a Shift-drag measures its angle from: the neighbours of a dragged
 * point along its ring, or the point a curve handle belongs to.
 */
function snapAnchors() {
  if (editor.selection?.kind !== "blockPoint" && editor.selection?.kind !== "blockHandle")
    return null;
  const boundary = boundaryAt(editor.selection);
  const node = boundary?.nodes[editor.selection.index];
  if (!boundary || !node) return null;
  if (editor.selection.kind === "blockHandle") return [node];
  const count = boundary.nodes.length;
  return [
    boundary.nodes[(editor.selection.index + count - 1) % count],
    boundary.nodes[(editor.selection.index + 1) % count],
  ].filter((other) => other !== node);
}

/**
 * What a Shift-drag of anything but a single point or handle snaps: the point
 * of the moving selection nearest where it was grabbed, so the corner you hold
 * lands on the grid. A curved edge bends instead of moving its points, so it
 * snaps by the grabbed spot itself.
 */
function snapReference(pointer, position) {
  const selection = editor.selection;
  let candidates = [];
  if (selection?.kind === "block")
    candidates = selectedBlocks().flatMap((index) =>
      blocks()[index] ? blockNodes(blocks()[index]) : [],
    );
  else if (selection?.kind === "blockBoundary")
    candidates = boundaryAt(selection)?.nodes || [];
  else if (selection?.kind === "blockEdge") {
    const boundary = boundaryAt(selection);
    const node = boundary?.nodes[selection.index];
    const next = boundary?.nodes[(selection.index + 1) % boundary.nodes.length];
    if (node && next && !isCurvedEdge(node, next)) candidates = [node, next];
  } else if (selection?.kind === "items")
    candidates = selection.items.flatMap((item) => {
      if (item.type === "block")
        return blocks()[item.index] ? blockNodes(blocks()[item.index]) : [];
      const at = itemPosition(item);
      return at ? [{ x: at[0], y: at[1] }] : [];
    });
  let best = position ? { x: position[0], y: position[1] } : null;
  let nearest = Infinity;
  for (const { x, y } of candidates) {
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    if (distance < nearest) {
      nearest = distance;
      best = { x, y };
    }
  }
  return best;
}

function startDragOrigin(pointer) {
  const position = selectedPosition();
  return { pointer, position, reference: snapReference(pointer, position) };
}

/** Move the dragged selection to where the pointer is, snapping it while Shift is held. */
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
  editor.snapGuide = null;
  const anchors = shift ? snapAnchors() : null;
  const reference = dragOrigin?.reference;
  if (shift && !anchors && origin && reference) {
    // The grabbed point snaps to the grid along an angle step from where it
    // started, and the whole selection moves with it.
    const moved = {
      x: reference.x + point.x - dragOrigin.pointer.x,
      y: reference.y + point.y - dragOrigin.pointer.y,
    };
    if (Math.hypot(moved.x - reference.x, moved.y - reference.y) > 1e-6) {
      const snapped = snapToAngleAndGrid(moved, [reference], gridSpacing(editor.zoom));
      x = origin[0] + snapped.x - reference.x;
      y = origin[1] + snapped.y - reference.y;
      if (snapped.anchor)
        editor.snapGuide = {
          from: reference,
          to: { x: snapped.x, y: snapped.y },
          angle: snapped.angle,
          length: snapped.length,
        };
    }
  } else if (anchors) {
    const snapped = snapToAngleAndGrid({ x, y }, anchors, gridSpacing(editor.zoom));
    x = snapped.x;
    y = snapped.y;
    if (snapped.anchor)
      editor.snapGuide = {
        from: snapped.anchor,
        to: { x, y },
        angle: snapped.angle,
        length: snapped.length,
      };
  }
  updateSelectedPosition(x, y);
  syncInspector({ live: true });
  render();
}

// Pressing or releasing Shift mid-drag turns snapping on or off straight away,
// without waiting for the pointer to move.
const onShiftChange = (event) => {
  if (scaling() && scalePoint && (event.key === "Shift" || event.key === "Alt")) {
    event.preventDefault();
    applyScale(event);
    return;
  }
  if (
    event.key !== "Shift" ||
    !dragging ||
    !editor.selection ||
    editor.pendingShape ||
    !lastDragPointer
  )
    return;
  dragSelectionTo(lastDragPointer, event.type === "keydown");
};

const SHAPE_KEYS = new Set(["Alt", "Shift", "Meta", "Control"]);

// Modifier keys change a Block or Cut drag straight away, without moving the mouse.
const onShapeModifier = (event) => {
  if (!editor.pendingShape || !SHAPE_KEYS.has(event.key)) return;
  event.preventDefault();
  editor.pendingShape.circle = event.metaKey || event.ctrlKey;
  editor.pendingShape.alt = event.altKey;
  editor.pendingShape.shift = event.shiftKey;
  updateShapePoints(editor.pendingShape);
  render();
};

/** Forget everything about the current press, so nothing keeps following the mouse. */
function resetPointerState() {
  dragging = false;
  panning = false;
  pointerStart = null;
  dragSnapshot = null;
  dragOrigin = null;
  lastDragPointer = null;
  editor.snapGuide = null;
  editor.marquee = null;
  altPress = null;
  scalePoint = null;
  pressClient = null;
  endScale();
}

export const endPointer = () => {
  if (editor.pendingShape) {
    const shape = editor.pendingShape;
    const kind = pendingKind;
    editor.pendingShape = null;
    pendingKind = null;
    resetPointerState();
    // Only a shape that changed something becomes an undo step, so a missed
    // cut neither leaves an empty step nor clears the redo history.
    const before = snapshot();
    if (
      commitShape(kind, shape.points, shape.closed, shape.alt, shape.circleShape)
    )
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
  if (scaling()) {
    resetPointerState();
    flushInspector();
    render();
    return;
  }
  if (editor.marquee) {
    finishMarquee();
    resetPointerState();
    syncInspector();
    render();
    return;
  }
  if (altPress) {
    // Alt-click without a drag keeps its old meaning: select the whole ring.
    editor.selection = hitTest(altPress.point, { wholeBoundary: true });
    resetPointerState();
    syncInspector();
    render();
    return;
  }
  const hadGuide = editor.snapGuide !== null;
  resetPointerState();
  flushInspector();
  if (hadGuide) render();
};

/** Drop a Block or Cut drag that is still being drawn, without applying it. */
export function cancelPendingShape() {
  if (!editor.pendingShape && !editor.marquee) return false;
  editor.pendingShape = null;
  pendingKind = null;
  resetPointerState();
  render();
  return true;
}

const shortcuts = /** @type {HTMLDialogElement} */ ($("shortcuts"));

export function bindInput() {
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Browsers expose trackpad pinch as a wheel event with Ctrl held.
        const before = pointerWorld(event);
        editor.zoom = clampZoom(editor.zoom * Math.exp(-event.deltaY * 0.01));
        const bounds = canvas.getBoundingClientRect();
        editor.cameraX = before.x - (event.clientX - bounds.left) / editor.zoom;
        editor.cameraY = before.y - (event.clientY - bounds.top) / editor.zoom;
        updateZoom();
        return;
      }
      // A normal two-finger trackpad gesture pans in both axes.
      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      editor.cameraX += (event.deltaX * deltaScale) / editor.zoom;
      editor.cameraY += (event.deltaY * deltaScale) / editor.zoom;
      renderView();
    },
    { passive: false },
  );

  canvas.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    gestureStartZoom = editor.zoom;
    gestureAnchor = pointerWorld(event);
  });

  canvas.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    if (!gestureAnchor) return;
    editor.zoom = clampZoom(gestureStartZoom * event.scale);
    const bounds = canvas.getBoundingClientRect();
    editor.cameraX = gestureAnchor.x - (event.clientX - bounds.left) / editor.zoom;
    editor.cameraY = gestureAnchor.y - (event.clientY - bounds.top) / editor.zoom;
    updateZoom();
  });

  canvas.addEventListener("gestureend", (event) => {
    event.preventDefault();
    gestureAnchor = null;
  });

  // Ctrl-click opens the context menu on a Mac; while drawing it means a circle.
  canvas.addEventListener("contextmenu", (event) => {
    if (editor.pendingShape) event.preventDefault();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button === 2) return;
    canvas.focus({ preventScroll: true });
    const point = pointerWorld(event);
    if (event.button === 1 || editor.tool === "pan" || editor.spaceHeld) {
      panning = true;
      pointerStart = {
        clientX: event.clientX,
        clientY: event.clientY,
        cameraX: editor.cameraX,
        cameraY: editor.cameraY,
      };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (editor.tool === "block" || editor.tool === "cut") {
      // Both tools draw a shape: start the drag and show it as it grows.
      pendingKind = editor.tool;
      editor.pendingShape = {
        raw: [[point.x, point.y]],
        end: [point.x, point.y],
        points: [],
        circle: event.metaKey || event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        closed: true,
        color: editor.tool === "cut" ? "#ff8952" : "#83d1ce",
        fill: editor.tool === "cut" ? "#ff895226" : "#83d1ce26",
      };
      updateShapePoints(editor.pendingShape);
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
      render();
      return;
    }
    if (editor.tool !== "select") {
      addAt(point);
      return;
    }
    const scaleHandle = scaleHandleAt(point);
    if (scaleHandle && startScale(scaleHandle, point, snapshot())) {
      pressClient = { clientX: event.clientX, clientY: event.clientY };
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
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
      editor.marquee = {
        from: point,
        to: point,
        base: event.shiftKey ? selectionItems() : [],
      };
      if (!event.shiftKey) editor.selection = null;
      canvas.setPointerCapture(event.pointerId);
      syncInspector();
      render();
      return;
    }
    // Shift-clicking a ring adds or removes its block.
    const toggled =
      hit?.kind === "blockBoundary"
        ? { type: "block", index: hit.blockIndex }
        : hitItem;
    if (event.shiftKey && toggled) {
      // Shift-click adds a block, point, apple, prop or spike, or takes it back out.
      const items = selectionItems();
      const at = items.findIndex((item) => sameItem(item, toggled));
      if (at >= 0) items.splice(at, 1);
      else items.push(toggled);
      editor.selection = makeSelection(items);
      syncInspector();
      render();
      return;
    } else if (!(hitItem && inGroup(hitItem))) {
      // Pressing something that's part of the group drags the whole group;
      // anything else selects what was hit.
      editor.selection = hit;
    }
    if (editor.selection) {
      pressClient = { clientX: event.clientX, clientY: event.clientY };
      dragSnapshot = snapshot();
      dragOrigin = startDragOrigin(point);
      dragging = true;
      canvas.setPointerCapture(event.pointerId);
    }
    syncInspector();
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    editor.pointerClient = { clientX: event.clientX, clientY: event.clientY };
    // No button held: the release was missed, so end the drag here.
    if ((dragging || panning || editor.marquee || altPress) && event.buttons === 0) {
      endPointer();
      return;
    }
    if (panning && pointerStart) {
      editor.cameraX =
        pointerStart.cameraX - (event.clientX - pointerStart.clientX) / editor.zoom;
      editor.cameraY =
        pointerStart.cameraY - (event.clientY - pointerStart.clientY) / editor.zoom;
      renderView();
      return;
    }
    if (PLACING_TOOLS.has(editor.tool) && !dragging) {
      editor.hoverPoint = pointerWorld(event);
      renderView();
    }
    if (editor.pendingShape) {
      const point = pointerWorld(event);
      const last = editor.pendingShape.raw.at(-1);
      // Sampled often enough to follow a curve, but not thousands of points.
      if (Math.hypot(point.x - last[0], point.y - last[1]) > 6 / editor.zoom)
        editor.pendingShape.raw.push([point.x, point.y]);
      editor.pendingShape.end = [point.x, point.y];
      editor.pendingShape.circle = event.metaKey || event.ctrlKey;
      editor.pendingShape.alt = event.altKey;
      editor.pendingShape.shift = event.shiftKey;
      updateShapePoints(editor.pendingShape);
      render();
      return;
    }
    if (editor.marquee) {
      editor.marquee.to = pointerWorld(event);
      renderView();
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
      editor.selection = copy;
      dragSnapshot = before;
      dragOrigin = startDragOrigin(press.point);
      dragging = true;
      lastDragPointer = { clientX: event.clientX, clientY: event.clientY };
      dragSelectionTo(lastDragPointer, event.shiftKey);
      return;
    }
    if (scaling()) {
      if (!pastSlop(event)) return;
      scalePoint = pointerWorld(event);
      applyScale(event);
      return;
    }
    if (editor.tool === "select" && !dragging && !panning) {
      const handle = scaleHandleAt(pointerWorld(event));
      canvas.style.cursor = handle ? scaleCursor(handle) : "default";
    }
    if (!dragging || !editor.selection || !pastSlop(event)) return;
    lastDragPointer = { clientX: event.clientX, clientY: event.clientY };
    dragSelectionTo(lastDragPointer, event.shiftKey);
  });

  window.addEventListener("keydown", onShiftChange);

  window.addEventListener("keyup", onShiftChange);

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
    if (editor.tool !== "select") return;
    const point = pointerWorld(event);
    const hit = hitTest(point, { preferEdges: true });
    // A double-click on an edge adds a point to it, keeping the edge's shape.
    if (hit?.kind === "blockEdge") {
      pushHistory();
      insertBlockNode(hit.boundaryIndex, hit.index, hit.t, hit.blockIndex);
      syncInspector();
      render();
    }
  });

  canvas.addEventListener("pointerup", endPointer);

  // A cancelled gesture discards a half-drawn shape instead of applying it.
  canvas.addEventListener("pointercancel", () => {
    if (!cancelPendingShape()) endPointer();
  });

  canvas.addEventListener("pointerleave", () => {
    editor.pointerClient = null;
    if (!editor.hoverPoint) return;
    editor.hoverPoint = null;
    renderView();
  });

  $("show-shortcuts").addEventListener("click", () => shortcuts.showModal());

  // Clicking the backdrop closes the list too.
  shortcuts.addEventListener("click", (event) => {
    if (event.target === shortcuts) shortcuts.close();
  });

  shortcuts.addEventListener("close", () => canvas.focus({ preventScroll: true }));

  window.addEventListener("keydown", (event) => {
    if (shortcuts.open) return;
    if (event.key === "?" && !typingInField() && !playtestOpen()) {
      event.preventDefault();
      shortcuts.showModal();
      return;
    }
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
      if (!event.shiftKey) openPlaytest();
      else {
        // Shift spawns the bike where the mouse is.
        const pointer = editor.pointerClient;
        const bounds = canvas.getBoundingClientRect();
        if (
          pointer &&
          pointer.clientX >= bounds.left &&
          pointer.clientX <= bounds.right &&
          pointer.clientY >= bounds.top &&
          pointer.clientY <= bounds.bottom
        )
          openPlaytest(pointerWorld(pointer));
        else showStatus("warning", "Point at the trail to choose where the bike starts.");
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
      event.preventDefault();
      if (!event.shiftKey) saveDraft();
      else if (canSave()) saveTrail();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.code === "KeyY") {
      event.preventDefault();
      redo();
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      (event.code === "KeyA" || event.code === "KeyD") &&
      !typingInField()
    ) {
      event.preventDefault();
      if (event.code === "KeyA") selectAll();
      else if (editor.selection) {
        editor.selection = null;
        syncInspector();
        render();
      }
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
      editor.spaceHeld = true;
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
      if (editor.tool === "select" && editor.selection) {
        editor.selection = null;
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
      zoomAtCenter(1 / editor.zoom);
      return;
    }
    if (event.key === "Home") {
      focusOnStart();
      render();
      return;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") editor.spaceHeld = false;
  });
}
