// Tool definitions, keyboard letters, and the per-tool settings panel.
import { store } from "../local-store.js";
import { SPIKE_RADIUS } from "../trail-schema.js";
import { terrainMaterials } from "../trails.js";
import { $, canvas } from "./dom.js";
import { editor } from "./state.js";

const TOOL_SETTINGS_KEY = "hjulben-editor-tool-settings-v1";

const BASE_MATERIAL = "base";

export const propTypeOptions = () =>
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
    hint: "Click a block, a point on its edge, or an object to select it, and drag to move it; a selected point shows its curve handles. Drag from empty space to box-select, and Shift-click to add or remove. Alt-click selects a whole ring or cave. Empty cave space selects nothing, so a cave never picks the block around it. Press ? for every shortcut.",
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
      { key: "type", label: "Prop", type: "select", optionsFrom: "selection-prop-type" },
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
    hint: "Click to move the finish onto the floor under where you click, then drag it up or down to float it in the air. The run ends when the bike touches the flower.",
  },
};

const DEFAULT_TOOL_SETTINGS = {
  block: { material: BASE_MATERIAL },
  spike: { radius: SPIKE_RADIUS.default, spin: 1 },
  prop: { type: "tree", layer: "back", flip: false },
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
  KeyP: "prop",
  KeyG: "start",
  KeyF: "finish",
};

export const TOOL_KEY_LABELS = Object.fromEntries(
  Object.entries(TOOL_KEYS).map(([code, name]) => [name, code.slice(3)]),
);

// Tools that place a new object where you click, and show a preview of it.
export const PLACING_TOOLS = new Set(["apple", "spike", "prop"]);

export const toolSettings = (() => {
  try {
    const stored = JSON.parse(store().getItem(TOOL_SETTINGS_KEY) || "{}");
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

export function saveToolSettings() {
  try {
    store().setItem(TOOL_SETTINGS_KEY, JSON.stringify(toolSettings));
  } catch (_) {}
}

export function toolMaterial(name) {
  const material = toolSettings[name]?.material;
  return !material || material === BASE_MATERIAL || !terrainMaterials[material]
    ? editor.trail.terrain
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

export function segmentSelects(root) {
  root.querySelectorAll("select").forEach(segmentSelect);
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
      return label;
    }),
  );
  segmentSelects($("tool-settings-fields"));
}

export function setTool(next) {
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
}
