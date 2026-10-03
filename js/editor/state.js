// Editor state shared across modules. Everything else lives in the module
// that owns it.
// How far the view can zoom out and in.
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 2.5;

/** Keep a zoom level within the editor's range. */
export function clampZoom(zoom) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

export const editor = {
  devServer: false,
  trailIndex: null,
  trail: null,
  tool: "select",
  selection: null,
  cameraX: 0,
  cameraY: 0,
  zoom: 1,
  spaceHeld: false,
  // The version the author opened: { kind: "saved" | "draft", at, base, edited },
  // where base is its pretty JSON, so edits since then can be told apart.
  version: null,
  history: [],
  future: [],
  snapGuide: null,
  gameArt: null,
  // The Block or Cut drag currently in progress, drawn live so the author sees the
  // shape before committing it.
  pendingShape: null,
  // The Select tool's selection box while it is being dragged.
  marquee: null,
  hoverPoint: null,
  // The editor opens on the start, placed a little below the middle so the
  // ground and the sky above it are both in view.
  focusPending: true,
  pointerClient: null,
};
