// Short dropdowns are shown as a row of buttons, one per option. Like the
// picker in picker.js, the real <select> stays in the page, hidden, so every
// existing listener and `.value = ...` keeps working; the buttons just mirror it.
// Only present in a real browser; without it, selects are left as they are.
import { canvas } from "./dom.js";

/** The most options a dropdown can have and still be shown as buttons. */
export const MAX_SEGMENTS = 3;

const selectValue =
  (typeof HTMLSelectElement !== "undefined" &&
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")) ||
  null;

/**
 * Show `select` as buttons if it has at most MAX_SEGMENTS options. Hidden
 * options, such as a "Mixed" placeholder, get no button: while one is chosen,
 * no button is lit. A select marked `data-dropdown`, a list of content that
 * may grow, such as the materials, or one already shown as a picker stays as
 * it is.
 */
export function segmentSelect(select) {
  if (!selectValue) return;
  if (select.dataset.segmented || select.dataset.picker || "dropdown" in select.dataset) return;
  const options = [...select.options].filter((option) => !option.hidden);
  if (options.length === 0 || options.length > MAX_SEGMENTS) return;
  select.dataset.segmented = "1";
  const group = document.createElement("span");
  group.className = "segmented";
  group.setAttribute("role", "radiogroup");
  const buttons = options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.textContent.replace(/\s+/g, " ").trim();
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

/** Segment every short dropdown inside `root`. */
export function segmentSelects(root) {
  root.querySelectorAll("select").forEach(segmentSelect);
}
