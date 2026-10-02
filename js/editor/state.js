// Editor state shared across modules. Everything else lives in the module
// that owns it.
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
