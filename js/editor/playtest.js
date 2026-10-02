// The in-editor play test overlay.
import { store } from "../local-store.js";
import { validateTrail } from "../trail-schema.js";
import { PLAYTEST_EXIT_MESSAGE, PLAYTEST_TRAIL_KEY } from "../trails.js";
import { $, canvas } from "./dom.js";
import { cancelPendingShape, endPointer } from "./input.js";
import { editor } from "./state.js";
import { refuse, showStatus } from "./status.js";

const playtestFrame = /** @type {HTMLIFrameElement} */ ($("playtest-frame"));

export const playtestOpen = () => !$("playtest").hidden;

export function openPlaytest() {
  const errors = validateTrail(editor.trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("play testing", errors)) return;
  try {
    store().setItem(PLAYTEST_TRAIL_KEY, JSON.stringify(editor.trail));
  } catch (error) {
    showStatus("error", `Could not start the play test: ${error.message}`);
    return;
  }
  cancelPendingShape();
  endPointer();
  editor.spaceHeld = false;
  $("playtest-name").textContent = editor.trail.name.toUpperCase();
  $("playtest").hidden = false;
  playtestFrame.src = "./index.html?playtest=1";
  playtestFrame.focus();
}

export function closePlaytest() {
  if (!playtestOpen()) return;
  $("playtest").hidden = true;
  playtestFrame.src = "about:blank";
  canvas.focus({ preventScroll: true });
}

export function bindPlaytest() {
  playtestFrame.addEventListener("load", () => {
    if (playtestOpen()) playtestFrame.focus();
  });

  window.addEventListener("message", (event) => {
    if (
      event.origin === window.location.origin &&
      event.source === playtestFrame.contentWindow &&
      event.data?.type === PLAYTEST_EXIT_MESSAGE
    )
      closePlaytest();
  });

  $("play-test").addEventListener("click", openPlaytest);

  $("close-playtest").addEventListener("click", closePlaytest);
}
