// Copy, cut and paste, including between trails.
import { moveBlock } from "../terrain-geometry.js";
import {
  blocks,
  boundaryEntries,
  freshBlockCopy,
  selectedBlocks,
} from "./blocks.js";
import { canvas } from "./dom.js";
import { pushHistory } from "./history.js";
import { syncInspector } from "./inspector.js";
import { playtestOpen } from "./playtest.js";
import { render } from "./render.js";
import {
  OBJECT_LISTS,
  blockNodes,
  deleteItems,
  itemPosition,
  makeSelection,
  selectionItems,
} from "./selection.js";
import { editor } from "./state.js";
import { showStatus } from "./status.js";
import { setTool } from "./tools.js";
import { pointerWorld, viewportSize } from "./view.js";

// ---- Copy, cut and paste --------------------------------------------------
// The clipboard holds plain JSON, so a copy can be pasted into another trail,
// another tab or a later session.

const CLIPBOARD_FORMAT = "hjulben-editor-clipboard-v1";

const CLIPBOARD_LISTS = { apple: "apples", prop: "props", spike: "spikes" };

/**
 * What the selection copies: whole blocks, apples, props and spikes. A block
 * whose every point is selected counts as the whole block; loose points,
 * handles, the start and the finish aren't copied.
 */
function copyableSelection() {
  const items = selectionItems();
  const blockIndices = new Set(
    editor.selection?.kind === "block" || editor.selection?.kind === "items"
      ? selectedBlocks()
      : [],
  );
  const points = items.filter((item) => item.type === "point");
  blocks().forEach((block, blockIndex) => {
    const total = blockNodes(block).length;
    const picked = points.filter((point) => point.blockIndex === blockIndex);
    if (total && picked.length >= total) blockIndices.add(blockIndex);
  });
  return {
    blockIndices: [...blockIndices].sort((a, b) => a - b),
    objects: items.filter((item) => CLIPBOARD_LISTS[item.type]),
  };
}

function describeCopy({ blocks: copiedBlocks, apples, props, spikes }) {
  return [
    [copiedBlocks.length, "block"],
    [apples.length, "apple"],
    [props.length, "prop"],
    [spikes.length, "spike"],
  ]
    .filter(([count]) => count)
    .map(([count, name]) => `${count} ${name}${count === 1 ? "" : "s"}`)
    .join(", ");
}

/** The clipboard payload for a copyable selection, or null when it's empty. */
function clipboardPayload({ blockIndices, objects }) {
  if (!blockIndices.length && !objects.length) return null;
  const payload = { format: CLIPBOARD_FORMAT, centre: [0, 0], blocks: [] };
  for (const list of Object.values(CLIPBOARD_LISTS)) payload[list] = [];
  const xs = [],
    ys = [];
  for (const index of blockIndices) {
    const block = blocks()[index];
    payload.blocks.push(structuredClone(block));
    for (const { boundary } of boundaryEntries(block))
      for (const node of boundary.nodes) {
        xs.push(node.x);
        ys.push(node.y);
      }
  }
  for (const item of objects) {
    const object = OBJECT_LISTS()[item.type][item.index];
    if (!object) continue;
    payload[CLIPBOARD_LISTS[item.type]].push(structuredClone(object));
    const [x, y] = itemPosition(item);
    xs.push(x);
    ys.push(y);
  }
  // The middle of the copied area lands under the cursor on paste.
  payload.centre = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  return payload;
}

function readClipboard(text) {
  try {
    const data = JSON.parse(text);
    if (data?.format !== CLIPBOARD_FORMAT) return null;
    if (!data.centre?.every?.(Number.isFinite)) return null;
    const lists = ["blocks", ...Object.values(CLIPBOARD_LISTS)];
    if (!lists.every((list) => Array.isArray(data[list]))) return null;
    return data;
  } catch {
    return null;
  }
}

/** Under the cursor when it's over the canvas, else the middle of the view. */
function pastePoint() {
  if (editor.pointerClient) return pointerWorld(editor.pointerClient);
  const { width, height } = viewportSize();
  return { x: editor.cameraX + width / 2 / editor.zoom, y: editor.cameraY + height / 2 / editor.zoom };
}

function pasteClipboard(data) {
  const target = pastePoint();
  const dx = Math.round(target.x - data.centre[0]);
  const dy = Math.round(target.y - data.centre[1]);
  const pastedBlocks = data.blocks
    .map((block) => freshBlockCopy(moveBlock(block, dx, dy)))
    .filter(Boolean);
  // Ground-anchored objects (no y) stay anchored, to the ground where they land.
  const pastedObjects = Object.entries(CLIPBOARD_LISTS).flatMap(
    ([type, list]) =>
      data[list]
        .filter((object) => Number.isFinite(object?.x))
        .map((object) => ({
          type,
          object: {
            ...structuredClone(object),
            x: object.x + dx,
            y: Number.isFinite(object.y) ? object.y + dy : null,
          },
        })),
  );
  if (!pastedBlocks.length && !pastedObjects.length) return;
  pushHistory();
  const firstBlock = blocks().length;
  editor.trail.terrainBlocks = [...blocks(), ...pastedBlocks];
  const items = pastedBlocks.map((_, i) => ({
    type: "block",
    index: firstBlock + i,
  }));
  for (const { type, object } of pastedObjects) {
    const list = OBJECT_LISTS()[type];
    list.push(object);
    items.push({ type, index: list.length - 1 });
  }
  editor.selection = makeSelection(items);
  setTool("select");
  syncInspector();
  render();
  showStatus("info", `Pasted ${describeCopy(data)}.`);
}

export function typingInField() {
  const active = document.activeElement;
  return (
    active?.tagName === "TEXTAREA" ||
    (active?.tagName === "INPUT" &&
      !["checkbox", "radio", "button", "range", "color"].includes(
        active.type,
      )) ||
    Boolean(active?.isContentEditable)
  );
}

/** Copy and paste belong to the editor unless a text field or text selection has them. */
function clipboardIsOurs() {
  return (
    !playtestOpen() && !typingInField() && !document.getSelection()?.toString()
  );
}

function copyToClipboard(event, cut) {
  if (!clipboardIsOurs() || !editor.selection) return;
  event.preventDefault();
  const copied = copyableSelection();
  const payload = clipboardPayload(copied);
  if (!payload) {
    showStatus(
      "warning",
      "Nothing to copy. Select blocks, apples, props or spikes; points, the start and the finish can't be copied.",
    );
    return;
  }
  event.clipboardData.setData("text/plain", JSON.stringify(payload));
  if (cut) {
    pushHistory();
    deleteItems(copied.objects);
    const removed = new Set(copied.blockIndices);
    editor.trail.terrainBlocks = blocks().filter((_, index) => !removed.has(index));
    editor.selection = null;
    syncInspector();
    render();
  }
  showStatus("info", `${cut ? "Cut" : "Copied"} ${describeCopy(payload)}.`);
}

export function bindClipboard() {
  document.addEventListener("copy", (event) => copyToClipboard(event, false));

  document.addEventListener("cut", (event) => copyToClipboard(event, true));

  document.addEventListener("paste", (event) => {
    if (!clipboardIsOurs()) return;
    const data = readClipboard(event.clipboardData?.getData("text/plain") || "");
    if (!data) return;
    event.preventDefault();
    pasteClipboard(data);
    canvas.focus({ preventScroll: true });
  });
}
