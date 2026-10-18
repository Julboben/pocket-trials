// Camera, zoom, the game art toggle and screen-to-world conversion.
import { store } from "../local-store.js";
import { $, canvas, ctx } from "./dom.js";
import {
  GAME_ART_KEY,
  GAME_ART_MIN_ZOOM,
  groundY,
  render,
  renderView,
  syncTerrain,
} from "./render.js";
import { clampZoom, editor } from "./state.js";

export function focusOnStart() {
  const { width, height } = viewportSize();
  if (!width || !height) return false;
  syncTerrain();
  const startY = Number.isFinite(editor.trail.start.y)
    ? editor.trail.start.y
    : groundY(editor.trail.start.x) - 12;
  editor.cameraX = editor.trail.start.x - width / 2 / editor.zoom;
  editor.cameraY = startY - (height * 0.6) / editor.zoom;
  editor.focusPending = false;
  return true;
}

export function resize() {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(bounds.width * dpr));
  canvas.height = Math.max(1, Math.round(bounds.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (editor.focusPending) focusOnStart();
  render();
}

export function viewportSize() {
  const bounds = canvas.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

export function pointerWorld(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: editor.cameraX + (event.clientX - bounds.left) / editor.zoom,
    y: editor.cameraY + (event.clientY - bounds.top) / editor.zoom,
  };
}

/** Move the view so a world position is in its middle, keeping the zoom. */
export function centerOn(x, y) {
  const { width, height } = viewportSize();
  editor.cameraX = x - width / 2 / editor.zoom;
  editor.cameraY = y - height / 2 / editor.zoom;
  editor.focusPending = false;
  renderView();
}

/** Zoom by a factor, keeping the middle of the view where it is. */
export function zoomAtCenter(factor) {
  const { width, height } = viewportSize();
  const centerX = editor.cameraX + width / 2 / editor.zoom;
  const centerY = editor.cameraY + height / 2 / editor.zoom;
  editor.zoom = clampZoom(editor.zoom * factor);
  editor.cameraX = centerX - width / 2 / editor.zoom;
  editor.cameraY = centerY - height / 2 / editor.zoom;
  updateZoom();
}

export function updateZoom() {
  $("zoom-label").textContent = Math.round(editor.zoom * 100) + "%";
  updateGameArtButton();
  renderView();
}

/** Draw the terrain with the game's own art, or as plain shapes, and remember it. */
export function setGameArt(on) {
  editor.gameArt = on;
  try {
    store().setItem(GAME_ART_KEY, on ? "1" : "0");
  } catch (_) {}
  updateGameArtButton();
  render();
}

export const toggleGameArt = () => setGameArt(!editor.gameArt);

// Below GAME_ART_MIN_ZOOM the art is not drawn even when it is on, so the
// button dims and says why rather than looking broken.
export function updateGameArtButton() {
  const button = $("game-art");
  const zoomedOut = editor.zoom < GAME_ART_MIN_ZOOM;
  button.setAttribute("aria-pressed", String(Boolean(editor.gameArt)));
  button.classList.toggle("zoomed-out", zoomedOut);
  button.title = !editor.gameArt
    ? "Show game art (Y)"
    : zoomedOut
      ? `Game art shows from ${Math.round(GAME_ART_MIN_ZOOM * 100)}% zoom (Y to hide)`
      : "Hide game art (Y)";
}
