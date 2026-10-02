// Button flashes and the toast over the canvas.
import { $ } from "./dom.js";

/**
 * Swap a button's label briefly, then put it back.
 *
 * The label is remembered as text rather than as markup, so flashing a button
 * that contains a glyph does not strip it out of the header.
 */
export function flash(button, text) {
  if (!button) return;
  const original = button.dataset.label || button.textContent.trim();
  button.dataset.label = original;
  const label = button.querySelector("span");
  if (label) label.textContent = text;
  else button.textContent = text;
  setTimeout(() => {
    if (label) label.textContent = original;
    else button.textContent = original;
  }, 1400);
}

/**
 * Refuse an action, naming what has to be fixed.
 *
 * The message pops up over the canvas and is repeated on the button itself,
 * because a refusal that is only recorded at the bottom of a long sidebar reads
 * as the editor silently doing nothing. It returns false, so the caller can
 * decide not to continue.
 */
export function refuse(action, errors) {
  const reasons = errors.map((message) => message.text);
  const first = reasons[0] || "the trail does not validate";
  const extra = reasons.length > 1 ? ` (+${reasons.length - 1} more)` : "";
  const text = `Fix ${reasons.length || "the"} validation error${reasons.length === 1 ? "" : "s"} before ${action}: ${first}${extra}`;
  showStatus("error", text);
  flash(
    $("play-test"),
    `${reasons.length} ERROR${reasons.length === 1 ? "" : "S"}`,
  );
  // The validation list is the last thing in the sidebar and easy to miss, so
  // it is brought into view and given attention.
  const list = $("validation-list");
  list.closest("section")?.scrollIntoView({ block: "nearest" });
  list.closest("section")?.classList.add("attention");
  setTimeout(
    () => list.closest("section")?.classList.remove("attention"),
    4000,
  );
  return false;
}

let toastTimer = null;

/** A short message over the canvas: what just happened, or why it didn't. */
export function showStatus(type, text) {
  const toast = $("editor-toast");
  toast.className = `editor-toast ${type}`;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      toast.hidden = true;
    },
    type === "error" ? 7000 : 3500,
  );
}
