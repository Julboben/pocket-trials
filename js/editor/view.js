// Camera, zoom and screen-to-world conversion.
import { $, canvas, ctx } from "./dom.js";
import { groundY, render, syncTerrain } from "./render.js";
import { editor } from "./state.js";

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

/** Zoom by a factor, keeping the middle of the view where it is. */
export function zoomAtCenter(factor) {
  const { width, height } = viewportSize();
  const centerX = editor.cameraX + width / 2 / editor.zoom;
  const centerY = editor.cameraY + height / 2 / editor.zoom;
  editor.zoom = Math.max(0.35, Math.min(2.5, editor.zoom * factor));
  editor.cameraX = centerX - width / 2 / editor.zoom;
  editor.cameraY = centerY - height / 2 / editor.zoom;
  updateZoom();
}

export function updateZoom() {
  $("zoom-label").textContent = Math.round(editor.zoom * 100) + "%";
  render();
}
