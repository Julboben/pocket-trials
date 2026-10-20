// Tool definitions, keyboard letters, and the per-tool settings panel.
import { store } from "../local-store.js";
import { SPIKE_RADIUS } from "../trail-schema.js";
import { WATER_SIZE, WATER_WIPEOUT_DEPTH } from "../water.js";
import { terrainMaterials } from "../trails.js";
import { $, canvas } from "./dom.js";
import { renderObjects } from "./objects.js";
import { pickerSelect } from "./picker.js";
import { schedulePreviewThumbnail, stopEditingPreview } from "./preview.js";
import { segmentSelects } from "./segmented.js";
import { editor } from "./state.js";
import { refuseEdit } from "./status.js";
import { propThumbnail } from "./thumbnails.js";

/** The tools that only look around, so they work on a read-only trail too. */
export const NAVIGATION_TOOLS = new Set(["select", "pan"]);

const TOOL_SETTINGS_KEY = "hjulben-editor-tool-settings-v1";

export const propTypeOptions = () =>
  [...$("selection-prop-type").options].map((option) => [
    option.value,
    option.textContent,
  ]);

export const materialLabel = (name) => name[0].toUpperCase() + name.slice(1);

const materialOptions = () =>
  Object.keys(terrainMaterials).map((name) => [name, materialLabel(name)]);

export const BLOCK_LAYERS = [
  ["terrain", "Terrain"],
  ["back", "Back wall"],
];

const LAYER_FIELD = {
  key: "layer",
  label: "Layer",
  type: "select",
  options: () => BLOCK_LAYERS,
};

export const TOOL_INFO = {
  select: {
    title: "Select",
    hint: "Click a block, a point on its edge, or an object to select it, and drag to move it; a selected block drags from anywhere inside it, and Esc or Cmd/Ctrl+D deselects. Where points and objects overlap, click again to select the next one. Hold Shift to snap the point or corner you hold to 15° and the grid. A selected point shows its curve handles. Drag from empty space to box-select, and Shift-click to add or remove a block, point or object. Alt-click selects a whole ring or cave. Empty cave space selects nothing, so a cave never picks the block around it. The square handles around selected blocks scale them: corners keep the shape, sides stretch it, and Alt scales from the centre. The round handle above them rotates the selection, Shift snaps it to 15°, and R or Shift+R turns it 15° at a time. Press ? for every shortcut.",
  },
  pan: {
    title: "Pan",
    hint: "Drag to move the view. Hold Space or use the middle mouse button to pan with any tool.",
  },
  block: {
    title: "Block",
    hint: "Drag an outline to draw a new block in that shape: solid terrain, or a back wall, which is scenery behind the terrain that keeps a cave dark. Hold Alt for a rectangle, Cmd/Ctrl for a circle and Shift to snap to the grid; all can be switched mid-drag. It can be drawn anywhere, including inside another block's cave. The tool stays active; Esc returns to Select.",
    fields: [
      {
        key: "material",
        label: "Material",
        type: "select",
        options: materialOptions,
        // A list of content that may grow, so never a row of buttons.
        dropdown: true,
      },
      LAYER_FIELD,
    ],
  },
  cut: {
    title: "Cut",
    hint: "Drag an outline over a block to remove that shape from it. Hold Alt for a rectangle, Cmd/Ctrl for a circle and Shift to snap to the grid. Inside solid terrain it makes a cave, across an edge it opens an entrance, and all the way through it splits the block in two. It only cuts blocks on the chosen layer: the selected block, or else the topmost one it touches. The tool stays active; Esc returns to Select.",
    fields: [LAYER_FIELD],
  },
  apple: {
    title: "Apple",
    hint: "Click to place an apple exactly where you click. Every apple must be collected to finish. Switch Place to Nisse to hide the trail's one optional nisse instead: riders don't need it to finish, and placing it again moves it. The tool stays active; Esc returns to Select.",
    fields: [
      {
        key: "kind",
        label: "Place",
        type: "select",
        options: () => [
          ["apple", "Apple"],
          ["nisse", "Nisse"],
        ],
      },
    ],
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
  water: {
    title: "Water",
    hint: `Drag a rectangle to fill it with water, or click to drop a body of the size below with its surface where you click. Water fills the open air inside the rectangle and terrain stays dry, so a rectangle drawn over a pit fills the pit. Up to ${WATER_WIPEOUT_DEPTH} deep is a ford the bike rides through, slowed down; deeper water wipes the rider out and leaves them floating. Hold Shift to snap to the grid. Select a body to resize it with its handles or set its width and depth. The tool stays active; Esc returns to Select.`,
    fields: [
      {
        key: "width",
        label: "Width",
        type: "number",
        min: WATER_SIZE.minWidth,
        step: 1,
      },
      {
        key: "depth",
        label: `Depth (over ${WATER_WIPEOUT_DEPTH} wipes out)`,
        type: "number",
        min: WATER_SIZE.minDepth,
        step: 1,
      },
    ],
  },
  prop: {
    title: "Prop",
    hint: "Click to place decorative scenery. Props do not collide. X flips the next prop and R or Shift+R turns it 15°. The tool stays active; Esc returns to Select.",
    fields: [
      {
        key: "type",
        label: "Prop",
        type: "select",
        optionsFrom: "selection-prop-type",
        picker: { title: "Prop", thumbnail: propThumbnail },
      },
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
      {
        key: "rotation",
        label: "Rotation (°, clockwise)",
        type: "number",
        min: -180,
        max: 180,
        step: 1,
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
    hint: "Click to move the finish onto the floor under where you click, then drag it up or down to float it in the air. The run ends when the bike touches the flower.",
  },
};

const DEFAULT_TOOL_SETTINGS = {
  // The last material chosen is kept for the next block.
  block: { material: "grass", layer: "terrain" },
  cut: { layer: "terrain" },
  apple: { kind: "apple" },
  spike: { radius: SPIKE_RADIUS.default, spin: 1 },
  water: { width: WATER_SIZE.width, depth: WATER_SIZE.depth },
  prop: { type: "tree", layer: "back", flip: false, rotation: 0 },
  start: { facing: "1" },
};

// Single-key tool shortcuts, used while the canvas has focus.
export const TOOL_KEYS = {
  KeyV: "select",
  KeyH: "pan",
  KeyB: "block",
  KeyC: "cut",
  KeyA: "apple",
  KeyS: "spike",
  KeyW: "water",
  KeyP: "prop",
  KeyG: "start",
  KeyF: "finish",
};

// What to print for each tool's key. The shortcuts go by physical key (code),
// so on a non-QWERTY layout the letter on the key differs: where the browser
// can say what is printed on it (navigator.keyboard), the labels follow that,
// else they show the QWERTY letter.
export const TOOL_KEY_LABELS = Object.fromEntries(
  Object.entries(TOOL_KEYS).map(([code, name]) => [name, code.slice(3)]),
);

/**
 * Bring TOOL_KEY_LABELS in line with the keyboard's layout, where the browser
 * exposes it. Resolves to whether any label changed.
 */
export async function resolveToolKeyLabels() {
  const keyboard = /** @type {any} */ (globalThis.navigator)?.keyboard;
  if (typeof keyboard?.getLayoutMap !== "function") return false;
  let layout;
  try {
    layout = await keyboard.getLayoutMap();
  } catch (_) {
    return false;
  }
  let changed = false;
  for (const [code, name] of Object.entries(TOOL_KEYS)) {
    const key = layout?.get?.(code);
    if (typeof key !== "string" || key.length !== 1) continue;
    const label = key.toUpperCase();
    if (TOOL_KEY_LABELS[name] === label) continue;
    TOOL_KEY_LABELS[name] = label;
    changed = true;
  }
  return changed;
}

// Tools that place a new object where you click, and show a preview of it.
export const PLACING_TOOLS = new Set(["apple", "spike", "prop"]);

// Tools that show a preview under the cursor: the placing tools, and Water,
// whose click drops a body of the tool's size.
export const PREVIEW_TOOLS = new Set([...PLACING_TOOLS, "water"]);

export const toolSettings = (() => {
  try {
    const stored = JSON.parse(store().getItem(TOOL_SETTINGS_KEY) || "{}");
    const settings = Object.fromEntries(
      Object.entries(DEFAULT_TOOL_SETTINGS).map(([name, defaults]) => [
        name,
        { ...defaults, ...(stored[name] || {}) },
      ]),
    );
    return settings;
  } catch (_) {
    return structuredClone(DEFAULT_TOOL_SETTINGS);
  }
})();

export function saveToolSettings() {
  try {
    store().setItem(TOOL_SETTINGS_KEY, JSON.stringify(toolSettings));
  } catch (_) {}
}

/** Whether the Apple tool is set to place the trail's nisse. */
export function placingNisse() {
  return toolSettings.apple?.kind === "nisse";
}

/** The layer a Block or Cut drag works on: "terrain" or "back". */
export function toolLayer(name) {
  return toolSettings[name]?.layer === "back" ? "back" : "terrain";
}

export function toolMaterial(name) {
  const material = toolSettings[name]?.material;
  return terrainMaterials[material] ? material : "grass";
}

function clampSetting(field, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return field.min ?? 0;
  return Math.max(
    field.min ?? -Infinity,
    Math.min(field.max ?? Infinity, number),
  );
}

export function renderToolSettings() {
  const info = TOOL_INFO[editor.tool];
  const key = TOOL_KEY_LABELS[editor.tool];
  $("tool-settings-title").textContent =
    info.title.toUpperCase() + (key ? ` · ${key}` : "");
  $("tool-hint").textContent = info.hint;
  $("tool-settings-fields").replaceChildren(
    ...(info.fields || []).map((field) => {
      const settings = toolSettings[editor.tool] || {};
      const label = document.createElement("label");
      label.className = field.type === "checkbox" ? "checkbox-row" : "";
      let input;
      if (field.type === "select" || field.type === "toggle") {
        input = document.createElement("select");
        if (field.dropdown) input.dataset.dropdown = "";
        // Copies another select's options, groups included.
        if (field.optionsFrom)
          input.append(
            ...[...$(field.optionsFrom).children].map((node) =>
              node.cloneNode(true),
            ),
          );
        else
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
      if (field.picker) pickerSelect(input, field.picker);
      return label;
    }),
  );
  segmentSelects($("tool-settings-fields"));
}

export function setTool(next) {
  if (!NAVIGATION_TOOLS.has(next) && refuseEdit()) next = "select";
  editor.hoverPoint = null;
  editor.tool = next;
  document
    .querySelectorAll("[data-tool]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.tool === editor.tool),
    );
  canvas.style.cursor =
    editor.tool === "pan" ? "grab" : editor.tool === "select" ? "default" : "crosshair";
  renderToolSettings();
}

export function setTab(name) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("panel-tools").hidden = name !== "tools";
  $("panel-trail").hidden = name !== "trail";
  $("panel-objects").hidden = name !== "objects";
  // The preview frame belongs to the Trail tab; its thumbnail is drawn when shown.
  if (name !== "trail") stopEditingPreview();
  else schedulePreviewThumbnail();
  renderObjects();
}
