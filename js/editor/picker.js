// Long dropdowns, such as the prop types and the trail picker, open a dialog
// with a search field and group filters instead of the native list. Like the
// segmented buttons in tools.js, the real <select> stays in the page, hidden,
// so every existing listener and `.value = ...` keeps working; the trigger
// button and the dialog just mirror it.
// Only present in a real browser; without it, selects are left as they are.
import { $, canvas } from "./dom.js";

const selectValue =
  (typeof HTMLSelectElement !== "undefined" &&
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")) ||
  null;

/** The dialog's state while it is open. */
let session = null;
let bound = false;

const clean = (text) => text.replace(/\s+/g, " ").trim();

function itemsOf(select) {
  return [...select.options].map((option) => ({
    value: option.value,
    text: clean(option.textContent),
    group: option.parentElement?.tagName === "OPTGROUP" ? option.parentElement.label : "",
  }));
}

// Every word typed has to appear in the name, the value or the group.
function matches(item, query) {
  const haystack = `${item.text} ${item.value} ${item.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function thumbnailImage(thumbnail, value) {
  const src = thumbnail?.(value);
  const image = document.createElement(src ? "img" : "span");
  image.className = "picker-thumb";
  image.setAttribute("aria-hidden", "true");
  if (src) {
    image.src = src;
    image.alt = "";
  }
  return image;
}

function optionNodes() {
  return [...$("picker-results").querySelectorAll(".picker-option")];
}

function setActive(value, scroll = true) {
  session.active = value;
  let activeId = "";
  for (const node of optionNodes()) {
    const active = node.dataset.value === value;
    node.classList.toggle("active", active);
    if (active) {
      activeId = node.id;
      if (scroll) node.scrollIntoView({ block: "nearest" });
    }
  }
  $("picker-search").setAttribute("aria-activedescendant", activeId);
}

function renderGroups() {
  const groups = [...new Set(session.items.map((item) => item.group).filter(Boolean))];
  const query = $("picker-search").value;
  const count = (group) =>
    session.items.filter((item) => (!group || item.group === group) && matches(item, query))
      .length;
  $("picker-groups").hidden = groups.length < 2;
  $("picker-groups").replaceChildren(
    ...[null, ...groups].map((group) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-group";
      const matching = count(group);
      button.classList.toggle("active", session.group === group);
      button.classList.toggle("empty", matching === 0);
      button.setAttribute("aria-pressed", String(session.group === group));
      const name = document.createElement("span");
      name.textContent = group ?? "All";
      const total = document.createElement("small");
      total.textContent = String(matching);
      button.append(name, total);
      button.addEventListener("click", () => {
        session.group = group;
        render();
        $("picker-search").focus();
      });
      return button;
    }),
  );
}

function renderResults() {
  const query = $("picker-search").value;
  const shown = session.items.filter(
    (item) => (!session.group || item.group === session.group) && matches(item, query),
  );
  const sections = [];
  for (const [index, item] of shown.entries()) {
    let section = sections.at(-1);
    if (!section || section.group !== item.group) {
      const node = document.createElement("div");
      node.className = "picker-section";
      node.setAttribute("role", "group");
      if (item.group) {
        const heading = document.createElement("h3");
        heading.id = `picker-group-${sections.length}`;
        heading.textContent = item.group;
        node.setAttribute("aria-labelledby", heading.id);
        node.append(heading);
      }
      const list = document.createElement("div");
      list.className = "picker-items";
      node.append(list);
      section = { group: item.group, node, list };
      sections.push(section);
    }
    const option = document.createElement("div");
    option.className = "picker-option";
    option.id = `picker-option-${index}`;
    option.dataset.value = item.value;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(item.value === session.current));
    if (session.thumbnail) option.append(thumbnailImage(session.thumbnail, item.value));
    const label = document.createElement("span");
    label.textContent = item.text;
    option.append(label);
    option.addEventListener("click", () => pick(item.value));
    section.list.append(option);
  }
  $("picker-results").replaceChildren(...sections.map((section) => section.node));
  $("picker-empty").hidden = shown.length > 0;
  const keep = shown.some((item) => item.value === session.active);
  setActive(keep ? session.active : (shown[0]?.value ?? null), keep);
}

function render() {
  renderGroups();
  renderResults();
}

// The nearest option above or below the active one, by where they are drawn,
// so the arrows walk the grid of props and the list of trails alike.
function nearestVertically(direction) {
  const nodes = optionNodes();
  const current = nodes.find((node) => node.dataset.value === session.active);
  if (!current) return nodes[0];
  const from = current.getBoundingClientRect();
  let best = null;
  let bestScore = Infinity;
  for (const node of nodes) {
    const box = node.getBoundingClientRect();
    const dy = (box.top - from.top) * direction;
    if (dy <= 1) continue;
    const score = dy * 10000 + Math.abs(box.left - from.left);
    if (score < bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

function onSearchKey(event) {
  const nodes = optionNodes();
  const index = nodes.findIndex((node) => node.dataset.value === session.active);
  let next = null;
  if (event.key === "ArrowDown" || event.key === "ArrowUp")
    next = nearestVertically(event.key === "ArrowDown" ? 1 : -1);
  else if (session.thumbnail && (event.key === "ArrowRight" || event.key === "ArrowLeft"))
    next = nodes[index + (event.key === "ArrowRight" ? 1 : -1)];
  else if (event.key === "Enter") {
    event.preventDefault();
    if (session.active !== null) pick(session.active);
    return;
  } else if (event.key === "Escape" && event.target.value) {
    // The first Escape clears the search, the next one closes.
    event.preventDefault();
    event.target.value = "";
    render();
    return;
  } else return;
  event.preventDefault();
  if (next) setActive(next.dataset.value);
}

function pick(value) {
  const { select } = session;
  /** @type {HTMLDialogElement} */ ($("picker")).close();
  if (selectValue.get.call(select) !== value) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Hand focus back so the canvas shortcuts keep working.
  canvas.focus({ preventScroll: true });
}

function bind() {
  if (bound) return;
  bound = true;
  const dialog = /** @type {HTMLDialogElement} */ ($("picker"));
  const search = $("picker-search");
  search.addEventListener("input", render);
  search.addEventListener("keydown", onSearchKey);
  // Typing a search must not trigger the editor's shortcuts.
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    session = null;
  });
}

function open(select, { title, thumbnail }) {
  const dialog = /** @type {HTMLDialogElement} */ ($("picker"));
  const current = selectValue.get.call(select);
  session = {
    select,
    thumbnail,
    items: itemsOf(select),
    current,
    active: current,
    group: null,
  };
  $("picker-title").textContent = `CHOOSE ${title.toUpperCase()}`;
  dialog.classList.toggle("picker-grid", Boolean(thumbnail));
  $("picker-keys").textContent =
    `Type to search · ${thumbnail ? "Arrows" : "↑ ↓"} to move · Enter to choose · Esc to close`;
  const search = /** @type {HTMLInputElement} */ ($("picker-search"));
  search.value = "";
  search.placeholder = `Search ${session.items.length} ${title.toLowerCase()}s`;
  dialog.showModal();
  render();
  search.focus();
}

/**
 * Show `select` as a button that opens the searchable picker. `title` names
 * one option ("Prop"); `thumbnail(value)` may return an image URL for each.
 */
export function pickerSelect(select, { title, thumbnail = null }) {
  if (!selectValue || select.dataset.picker) return;
  select.dataset.picker = "1";
  bind();
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "picker-trigger";
  trigger.title = `Search and choose a ${title.toLowerCase()}`;
  trigger.setAttribute("aria-haspopup", "dialog");
  const refresh = () => {
    const option = select.selectedOptions[0];
    const label = document.createElement("span");
    label.className = "picker-trigger-label";
    label.textContent = option ? clean(option.textContent) : "";
    trigger.replaceChildren(
      ...(thumbnail && option ? [thumbnailImage(thumbnail, option.value)] : []),
      label,
    );
  };
  // Setting the value from code (syncInspector, tool settings) updates the button.
  Object.defineProperty(select, "value", {
    configurable: true,
    get: () => selectValue.get.call(select),
    set: (value) => {
      selectValue.set.call(select, value);
      refresh();
    },
  });
  trigger.addEventListener("click", () => open(select, { title, thumbnail }));
  select.style.display = "none";
  select.after(trigger);
  refresh();
}
