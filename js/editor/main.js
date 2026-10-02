// Trail editor entry point: sets up the initial state, wires the page's
// controls, and draws the first frame.
import { store } from "../local-store.js";
import {
  cloneTrail,
  createBlankTrail,
  normalizeTrail,
  trailToModule,
  validateTrail,
} from "../trail-schema.js";
import { detectDevServer, terrainMaterials, trailEntries } from "../trails.js";
import { bindClipboard } from "./clipboard.js";
import { $, wrap } from "./dom.js";
import { pushHistory, redo, undo, updateHistoryButtons } from "./history.js";
import { bindInput } from "./input.js";
import { bindInspector, syncInspector } from "./inspector.js";
import { bindPlaytest } from "./playtest.js";
import { GAME_ART_KEY, render } from "./render.js";
import { editor } from "./state.js";
import { flash, refuse } from "./status.js";
import { TOOL_KEY_LABELS, segmentSelects, setTab, setTool } from "./tools.js";
import {
  DRAFT_PREFIX,
  buildPicker,
  createCustomTrail,
  currentEntry,
  deleteTrail,
  download,
  loadTrailData,
  saveTrail,
  selectEntry,
  storedTrailIndex,
  updateTrailControls,
} from "./trails.js";
import { focusOnStart, resize, updateZoom } from "./view.js";

editor.trailIndex = storedTrailIndex();

editor.trail = loadTrailData(editor.trailIndex);

editor.gameArt = (() => {
  try {
    return store().getItem(GAME_ART_KEY) === "1";
  } catch (_) {
    return false;
  }
})();

bindClipboard();

bindPlaytest();

buildPicker();

for (const name of Object.keys(terrainMaterials)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name.toUpperCase();
  $("selection-material").append(option);
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
  const copy = cloneTrail(editor.trail);
  copy.name = `${editor.trail.name} Copy`;
  copy.label = `${copy.name.toUpperCase()} / ${String(trailEntries.length + 1).padStart(2, "0")}`;
  createCustomTrail(copy);
});

$("delete-trail").addEventListener("click", deleteTrail);

$("undo").addEventListener("click", undo);

$("redo").addEventListener("click", redo);

$("zoom-in").addEventListener("click", () => {
  editor.zoom = Math.min(2.5, editor.zoom * 1.2);
  updateZoom();
});

$("zoom-out").addEventListener("click", () => {
  editor.zoom = Math.max(0.35, editor.zoom / 1.2);
  updateZoom();
});

bindInput();

bindInspector();

$("game-art").checked = editor.gameArt;

$("game-art").addEventListener("change", (event) => {
  editor.gameArt = event.target.checked;
  try {
    store().setItem(GAME_ART_KEY, editor.gameArt ? "1" : "0");
  } catch (_) {}
  render();
});

$("save-draft").addEventListener("click", () => {
  store().setItem(DRAFT_PREFIX + currentEntry().id, JSON.stringify(editor.trail));
  flash($("save-draft"), "SAVED");
});

$("export-json").addEventListener("click", () => {
  const errors = validateTrail(editor.trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("exporting", errors)) return;
  download(
    `${editor.trail.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
    JSON.stringify(editor.trail, null, 2) + "\n",
    "application/json",
  );
});

$("export-js").addEventListener("click", () => {
  const errors = validateTrail(editor.trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("exporting", errors)) return;
  download(
    `${editor.trail.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.js`,
    trailToModule(editor.trail),
    "text/javascript",
  );
});

$("import-json").addEventListener("click", () => {
  try {
    pushHistory();
    editor.trail = normalizeTrail(JSON.parse($("trail-json").value), editor.trailIndex);
    editor.selection = null;
    editor.focusPending = true;
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
  editor.devServer = available;
  updateTrailControls();
  document.querySelector(".editor-shell").removeAttribute("data-booting");
});
