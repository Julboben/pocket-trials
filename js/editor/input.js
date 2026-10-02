// Pointer, gesture and keyboard handling on the canvas.
import {
  addAt,
  boundaryAt,
  commitShape,
  insertBlockNode,
  updateShapePoints,
} from "./blocks.js";
import { typingInField } from "./clipboard.js";
import { $, canvas } from "./dom.js";
import { pushHistory, redo, snapshot, undo } from "./history.js";
import { hitTest } from "./hit-test.js";
import {
  flushInspector,
  selectedPosition,
  syncInspector,
  updateSelectedPosition,
} from "./inspector.js";
import { closePlaytest, openPlaytest, playtestOpen } from "./playtest.js";
import { render, renderView } from "./render.js";
import {
  cyclePropType,
  deleteSelection,
  duplicateSelection,
  duplicateTarget,
  finishMarquee,
  inGroup,
  itemFromHit,
  makeSelection,
  nudgeSelection,
  sameItem,
  selectAll,
  selectionItems,
  toggleFlip,
} from "./selection.js";
import { gridSpacing, snapToAngleAndGrid } from "./snap.js";
import { editor } from "./state.js";
import { showStatus } from "./status.js";
import { PLACING_TOOLS, TOOL_KEYS, setTool } from "./tools.js";
import { canSave, saveTrail } from "./trails.js";
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
  editor.snapGuide = null;
  const anchors = shift ? snapAnchors() : null;
  if (anchors) {
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

// Alt and Shift change a Block or Cut drag straight away, without moving the mouse.
const onShapeModifier = (event) => {
  if (!editor.pendingShape || (event.key !== "Alt" && event.key !== "Shift")) return;
  event.preventDefault();
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
        editor.zoom = Math.max(
          0.35,
          Math.min(2.5, editor.zoom * Math.exp(-event.deltaY * 0.01)),
        );
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
    editor.zoom = Math.max(0.35, Math.min(2.5, gestureStartZoom * event.scale));
    const bounds = canvas.getBoundingClientRect();
    editor.cameraX = gestureAnchor.x - (event.clientX - bounds.left) / editor.zoom;
    editor.cameraY = gestureAnchor.y - (event.clientY - bounds.top) / editor.zoom;
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
      dragSnapshot = snapshot();
      dragOrigin = { pointer: point, position: selectedPosition() };
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
      dragOrigin = { pointer: press.point, position: selectedPosition() };
      dragging = true;
      lastDragPointer = { clientX: event.clientX, clientY: event.clientY };
      dragSelectionTo(lastDragPointer, event.shiftKey);
      return;
    }
    if (!dragging || !editor.selection) return;
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
    const hit = hitTest(point);
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
      (event.metaKey || event.ctrlKey) &&
      (event.code === "KeyA" || event.code === "KeyD") &&
      !typingInField()
    ) {
      event.preventDefault();
      if (event.code === "KeyA") selectAll();
      else duplicateSelection();
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
