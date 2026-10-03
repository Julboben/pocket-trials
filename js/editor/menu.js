// The header's "more" menu, the import/export dialog, and the validation badge.
import { $ } from "./dom.js";

function items() {
  return [...$("more-menu").querySelectorAll("[role=menuitem]")].filter(
    (item) => !item.hidden && !item.disabled,
  );
}

export function menuOpen() {
  return !$("more-menu").hidden;
}

export function openMenu({ focus = false } = {}) {
  $("more-menu").hidden = false;
  $("more-toggle").setAttribute("aria-expanded", "true");
  if (focus) items()[0]?.focus();
}

export function closeMenu({ restoreFocus = false } = {}) {
  if (!menuOpen()) return;
  $("more-menu").hidden = true;
  $("more-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("more-toggle").focus();
}

/** Point at the validation list, opening the menu it lives in. */
export function showValidation() {
  const dialog = /** @type {HTMLDialogElement} */ ($("data-dialog"));
  if (dialog.open) dialog.close?.();
  openMenu();
  const section = $("validation");
  section.classList.add("attention");
  setTimeout(() => section.classList.remove("attention"), 4000);
}

/** Show the error or warning count on the menu button and above the list. */
export function updateValidationBadge(messages) {
  const errors = messages.filter((message) => message.type === "error").length;
  const warnings = messages.filter((message) => message.type === "warning").length;
  const badge = $("more-badge");
  badge.hidden = !errors && !warnings;
  badge.textContent = String(errors || warnings);
  badge.classList.toggle("warning", !errors && warnings > 0);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "S"}`;
  const summary = [
    errors && plural(errors, "ERROR"),
    warnings && plural(warnings, "WARNING"),
  ].filter(Boolean);
  $("validation-summary").textContent = summary.length ? `· ${summary.join(" · ")}` : "";
  // Export refuses an invalid trail, so the dialog says so before it is tried.
  $("data-errors").hidden = !errors;
  $("data-errors-text").textContent = errors
    ? `${plural(errors, "ERROR")} · fix ${errors === 1 ? "it" : "them"} before exporting`
    : "";
  for (const id of ["export-json", "export-js"]) $(id).classList.toggle("blocked", errors > 0);
  $("more-toggle").setAttribute(
    "aria-label",
    summary.length ? `More actions (${summary.join(", ").toLowerCase()})` : "More actions",
  );
}

export function bindMenu() {
  const toggle = $("more-toggle");
  const menu = $("more-menu");
  const dialog = /** @type {HTMLDialogElement} */ ($("data-dialog"));

  toggle.addEventListener("click", (event) => {
    if (menuOpen()) closeMenu();
    else openMenu({ focus: event.detail === 0 });
  });

  // Picking an action closes the menu; the validation list below stays readable.
  menu.addEventListener("click", (event) => {
    if (event.target?.closest?.("[role=menuitem]")) closeMenu();
  });

  menu.addEventListener("keydown", (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (menuOpen() && !$("more").contains?.(event.target)) closeMenu();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen()) closeMenu();
  });

  $("open-data").addEventListener("click", () => dialog.showModal());
  $("data-errors-show").addEventListener("click", showValidation);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
