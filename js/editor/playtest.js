// The in-editor play test overlay.
import { store } from "../local-store.js";
import { validateTrail } from "../trail-schema.js";
import { PLAYTEST_EXIT_MESSAGE, PLAYTEST_TRAIL_GLOBAL, PLAYTEST_TRAIL_KEY } from "../trails.js";
import { offerUpdate } from "../update-prompt.js";
import { $, canvas } from "./dom.js";
import { cancelPendingShape, endPointer } from "./input.js";
import { editor } from "./state.js";
import { refuse } from "./status.js";

const playtestFrame = /** @type {HTMLIFrameElement} */ ($("playtest-frame"));

export const playtestOpen = () => !$("playtest").hidden;

/**
 * Ride the trail as it is now. With `spawn`, the bike starts there instead of
 * at the trail's start; the trail itself keeps its start.
 * @param {{ x: number, y: number } | null} [spawn]
 */
export function openPlaytest(spawn = null) {
  const trail = spawn
    ? { ...editor.trail, start: { ...editor.trail.start, x: spawn.x, y: spawn.y } }
    : editor.trail;
  const errors = validateTrail(trail).filter(
    (message) => message.type === "error",
  );
  if (errors.length && !refuse("play testing", errors)) return;
  window[PLAYTEST_TRAIL_GLOBAL] = JSON.stringify(trail);
  cancelPendingShape();
  endPointer();
  editor.spaceHeld = false;
  $("playtest-name").textContent = editor.trail.name.toUpperCase();
  $("playtest").hidden = false;
  // Debug mode follows the editor's own ?debug=1 into the play test.
  const debug = new URLSearchParams(window.location.search).get("debug") === "1";
  playtestFrame.src = `./index.html?playtest=1${debug ? "&debug=1" : ""}`;
  playtestFrame.focus();
}

export function closePlaytest() {
  if (!playtestOpen()) return;
  $("playtest").hidden = true;
  playtestFrame.src = "about:blank";
  canvas.focus({ preventScroll: true });
  // A release that came in during the play test asks now.
  offerUpdate();
}

export function bindPlaytest() {
  // Play tests used to hand the trail over in storage; a copy may be left there.
  try {
    store().removeItem(PLAYTEST_TRAIL_KEY);
  } catch (_) {}
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

  $("play-test").addEventListener("click", () => openPlaytest());

  $("close-playtest").addEventListener("click", closePlaytest);
}
