// Boots the real editor against a stub DOM, drives a set of gestures, and
// writes a JSON report to stdout.
//
// It runs as its own process because trails.js caches the trail catalog at
// import time: two boots in one process would silently share a trail, so the
// parent starts one child per trail shape.
import { buildDom, createContextStub, installGlobals } from './editor-harness.mjs';
import { loadTrailShape } from './editor-fixture.mjs';

const kind = process.env.TSC_ENV_TRAIL || 'blocks';
const { html, trail } = loadTrailShape(kind);

// buildDom installs the globals and parses the markup, so elements it created
// keep their markup state, such as the playtest dialog starting hidden.
const dom = buildDom(html);
for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
  if (!dom.has(match[1])) dom.element(match[1]);
}
const canvas = dom.element('editor-canvas');
const context = createContextStub();
canvas.getContext = () => context;
dom.element('canvas-wrap');
dom.element('trail-picker');

globalThis.fetch = async url => (String(url).includes('catalog.json')
  ? { ok: true, json: async () => ({ schemaVersion: 1, trails: [{ id: 't1', file: 'custom/t1.json', name: 'Test' }] }) }
  : { ok: true, json: async () => trail });

// Window listeners are recorded so keyboard shortcuts can be driven.
const windowListeners = new Map();
globalThis.addEventListener = (type, handler) => {
  if (!windowListeners.has(type)) windowListeners.set(type, []);
  windowListeners.get(type).push(handler);
};

await import('../../js/editor/main.js');

const fire = (type, extra = {}) => canvas.dispatch(type, { pointerId: 1, button: 0, clientX: 0, clientY: 0, ...extra });
// The editor opens centred on the start, so a screen position is only a world
// position once the camera is subtracted. The interact checks measure it first.
let cameraX = 0,
  cameraY = 0;
const world = (x, y) => ({ clientX: x - cameraX, clientY: y - cameraY });
const key = (keyName, extra = {}) => {
  document.activeElement = canvas;
  for (const handler of windowListeners.get('keydown') || []) handler({ key: keyName, code: '', preventDefault() {}, ...extra });
};
const current = () => JSON.parse(document.getElementById('trail-json').value);
const toolButton = name => [...document.querySelectorAll('[data-tool]')].find(button => button.dataset.tool === name);
const drag = (from, to, extra = {}) => {
  fire('pointerdown', { ...world(...from), ...extra });
  fire('pointermove', { ...world(...to), ...extra });
  fire('pointerup');
};

// Precise interactions on a plain slab, reported on their own because the
// generic gestures below scramble the trail.
if (kind === 'interact') {
  // Find the camera: an apple placed at screen 0,0 lands at the camera's world
  // position (zoom is 1). The placement is undone, so it leaves no trace.
  toolButton('apple').click();
  fire('pointerdown', { clientX: 0, clientY: 0 });
  fire('pointerup');
  const probe = current().apples.at(-1);
  cameraX = probe.x;
  cameraY = probe.y;
  document.getElementById('undo').click();
  toolButton('select').click();

  const out = {};
  const undo = document.getElementById('undo');
  fire('pointerdown', world(400, 450));
  fire('pointerup');
  out.clickLeavesNoUndo = undo.disabled === true;

  // A cut straight through the slab splits it into two regions of one block.
  toolButton('cut').click();
  fire('pointerdown', world(380, 250));
  for (const [x, y] of [[420, 250], [420, 650], [380, 650]]) fire('pointermove', world(x, y));
  fire('pointerup');
  out.splitRegions = current().terrainBlocks[0]?.regions.length;

  // The right-hand piece's top-right corner is in the second region. Dragging
  // it must move that corner and leave the left piece alone.
  // The tools stay active after a shape, so go back to Select before moving
  // corners, or the next drag draws another cut instead.
  toolButton('select').click();
  const before = current().terrainBlocks[0].regions;
  drag([800, 300], [830, 270]);
  const after = current().terrainBlocks[0].regions;
  const corners = regions => regions.map(region => region.outer.nodes.map(node => [Math.round(node.x), Math.round(node.y)]));
  out.leftUntouched = JSON.stringify(corners(before)[0]) === JSON.stringify(corners(after)[0]);
  out.rightMoved = corners(after)[1].some(([x, y]) => x === 830 && y === 270);

  // Escape abandons a cut that is still being drawn.
  toolButton('cut').click();
  const blocksBefore = JSON.stringify(current().terrainBlocks);
  fire('pointerdown', world(100, 350));
  for (const [x, y] of [[200, 350], [200, 450], [100, 450]]) fire('pointermove', world(x, y));
  key('Escape');
  fire('pointerup');
  out.escapeCancels = JSON.stringify(current().terrainBlocks) === blocksBefore;

  // Shift-click builds a multi-selection, and dragging it moves both blocks.
  // Alt makes a rectangle, since a plain two-point drag is a freehand line.
  toolButton('block').click();
  drag([1000, 300], [1200, 500], { altKey: true });
  toolButton('select').click();
  const count = current().terrainBlocks.length;
  drag([200, 450], [200, 450]);
  fire('pointerdown', { ...world(1100, 400), shiftKey: true });
  fire('pointerup');
  out.multiTitle = document.getElementById('selection-title').textContent;
  const leftBefore = current().terrainBlocks[0].regions[0].outer.nodes[0].x;
  const newBefore = current().terrainBlocks[count - 1].regions[0].outer.nodes[0].x;
  drag([1100, 400], [1150, 400]);
  out.multiMoved = current().terrainBlocks[0].regions[0].outer.nodes[0].x === leftBefore + 50
    && current().terrainBlocks[count - 1].regions[0].outer.nodes[0].x === newBefore + 50;
  key('Delete');
  out.multiDeleted = current().terrainBlocks.length === count - 2;

  // Shift-dragging a point locks it to 15 degree steps from a neighbour, and to the grid.
  toolButton('block').click();
  drag([100, 100], [300, 300], { altKey: true });
  toolButton('select').click();
  const ring = () => current().terrainBlocks.at(-1).regions[0].outer.nodes;
  const corner = () => ring().reduce((best, node) => Math.hypot(node.x - 300, node.y - 300) < Math.hypot(best.x - 300, best.y - 300) ? node : best);
  const cornerId = corner().id;
  const cornerIndex = ring().findIndex(node => node.id === cornerId);
  const grab = ring()[cornerIndex];
  const from = { x: grab.x, y: grab.y };
  fire('pointerdown', world(from.x, from.y));
  fire('pointermove', { ...world(from.x + 73, from.y + 12), shiftKey: true });
  const snapped = ring()[cornerIndex];
  const neighbours = [ring()[(cornerIndex + 3) % 4], ring()[(cornerIndex + 1) % 4]];
  const stepFrom = neighbour => {
    const angle = Math.atan2(snapped.y - neighbour.y, snapped.x - neighbour.x) * 180 / Math.PI / 15;
    return Math.abs(angle - Math.round(angle)) < 1e-6;
  };
  out.snapAngle = neighbours.some(stepFrom);
  out.snapGrid = snapped.x % 50 === 0 || snapped.y % 50 === 0;
  out.snapMoved = snapped.x !== from.x || snapped.y !== from.y;
  // Releasing Shift mid-drag gives the pointer its exact position back.
  for (const handler of windowListeners.get('keyup') || []) handler({ type: 'keyup', key: 'Shift', shiftKey: false, preventDefault() {} });
  out.releaseExact = ring()[cornerIndex].x === from.x + 73 && ring()[cornerIndex].y === from.y + 12;
  // Pressing it again snaps again.
  for (const handler of windowListeners.get('keydown') || []) handler({ type: 'keydown', key: 'Shift', shiftKey: true, preventDefault() {} });
  out.repressSnaps = ring()[cornerIndex].x === snapped.x && ring()[cornerIndex].y === snapped.y;
  fire('pointerup');
  // Without Shift the point goes exactly where the pointer does.
  const plainFrom = { ...ring()[cornerIndex] };
  fire('pointerdown', world(plainFrom.x, plainFrom.y));
  fire('pointermove', world(plainFrom.x + 7, plainFrom.y + 3));
  fire('pointerup');
  out.plainExact = ring()[cornerIndex].x === plainFrom.x + 7 && ring()[cornerIndex].y === plainFrom.y + 3;
  out.errors = [];
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// A roof or cave ceiling placed or dragged over something standing on the
// ground must not lift it onto the new top.
if (kind === 'covered') {
  toolButton('apple').click();
  fire('pointerdown', { clientX: 0, clientY: 0 });
  fire('pointerup');
  const probe = current().apples.at(-1);
  cameraX = probe.x;
  cameraY = probe.y;
  document.getElementById('undo').click();

  const out = { errors: [] };
  // A block drawn over the start.
  toolButton('block').click();
  drag([40, 150], [140, 220], { altKey: true });
  out.startY = current().start.y;
  // A block drawn away from everything, then dragged over the prop.
  drag([1000, 100], [1200, 200], { altKey: true });
  toolButton('select').click();
  drag([1100, 150], [550, 150]);
  out.propY = current().props[0].y;
  // Raising the ground under the finish still carries it along.
  drag([800, 300], [800, 250]);
  out.finishY = current().finishY;

  // A cave under the slab's top, from y 400 to 500.
  toolButton('cut').click();
  fire('pointerdown', world(400, 400));
  for (const [x, y] of [[700, 400], [700, 500], [400, 500]]) fire('pointermove', world(x, y));
  fire('pointerup');
  // The finish tool clicked inside the cave puts the finish on its floor.
  toolButton('finish').click();
  fire('pointerdown', world(650, 450));
  fire('pointerup');
  out.caveFinishY = current().finishY;
  // Lifted into the cave's air, then snapped back down to the cave floor.
  toolButton('select').click();
  drag([650, 500], [650, 420]);
  out.liftedFinishY = current().finishY;
  const snap = document.getElementById('selection-snap');
  snap.checked = true;
  snap.dispatch('change');
  out.snappedFinishY = current().finishY;
  out.snapChecked = snap.checked;

  // A ground-anchored prop copied and pasted into the cave lands on its floor.
  const docEvent = (type, data = '') => {
    let written = data;
    const clipboardData = { setData: (_, value) => { written = value; }, getData: () => written };
    for (const handler of document.listeners.get(type) || []) handler({ preventDefault() {}, clipboardData });
    return written;
  };
  // The slab's top slopes after the corner drag, so the prop stands at 284.375.
  fire('pointerdown', world(250, 284));
  fire('pointerup');
  const copied = docEvent('copy');
  fire('pointermove', world(600, 480));
  docEvent('paste', copied);
  out.pastedPropY = current().props.at(-1).y;
  out.props = current().props.length;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const report = { loaded: JSON.parse(document.getElementById('trail-json').value), errors: [] };

// A drag, so the editor actually renders rather than returning early. Game art
// is on by default: the terrain comes from the game's rasteriser.
context.calls.length = 0;
fire('pointerdown', world(400, 300));
fire('pointermove', world(410, 310));
report.gameArt = context.calls.some(call => call[0] === 'drawImage');
report.gameArtOutlined = context.calls.some(call => call[0] === 'stroke');
fire('pointerup');

// With game art off, blocks are drawn as flat editing fills.
const toggle = document.getElementById('game-art');
toggle.checked = false;
toggle.dispatch('change');
context.calls.length = 0;
fire('pointerdown', world(400, 300));
fire('pointermove', world(410, 310));
report.drew = context.calls.some(call => call[0] === 'beginPath') && context.calls.some(call => call[0] === 'fill');
report.evenodd = context.calls.some(call => call[0] === 'fill' && call[1] === 'evenodd');
report.closed = context.calls.some(call => call[0] === 'closePath');
// stroke() takes no arguments on a real canvas.
report.strokeHasArgs = context.calls.some(call => call[0] === 'stroke' && call.length > 1);
report.calls = context.calls.length;
fire('pointerup');

const run = (label, gesture) => {
  try { gesture(); }
  catch (error) { report.errors.push(`${label}: ${error.message}`); }
};

run('block', () => {
  fire('pointerdown', world(300, 200));
  fire('pointermove', world(500, 320));
  fire('pointerup');
});
run('cut', () => {
  fire('pointerdown', world(400, 340));
  fire('pointermove', world(700, 340));
  fire('pointermove', world(700, 460));
  fire('pointermove', world(400, 460));
  fire('pointerup');
});
run('select', () => {
  for (const [x, y] of [[300, 200], [500, 320], [550, 400], [0, 300], [100, 100], [700, 250], [400, 500]]) {
    fire('pointerdown', world(x, y));
    fire('pointermove', world(x + 3, y + 3));
    fire('pointerup');
  }
});
run('frames', () => {
  for (let x = 0; x < 900; x += 37) {
    fire('pointerdown', world(x, 250));
    fire('pointermove', world(x + 11, 280));
    fire('pointerup');
  }
});
run('camera', () => {
  fire('wheel', { deltaX: 10, deltaY: 10, deltaMode: 0, ctrlKey: false });
  fire('gesturestart', {});
  fire('gesturechange', { scale: 1.2 });
  fire('gestureend', {});
});
run('pinch', () => { fire('wheel', { deltaX: 0, deltaY: -10, deltaMode: 0, ctrlKey: true }); });

// A refusal has to be visible, and it has to say what is wrong, here for a
// trail whose finish sits past the end of its terrain.
if (process.env.TSC_ENV_TRAIL === 'badgoal') {
  const button = document.getElementById('play-test');
  const before = document.getElementById('trail-json').value.length;
  button.click();
  const toast = document.getElementById('editor-toast');
  report.refusalText = toast.textContent;
  report.refused = report.refusalText.includes('before play testing');
  report.refusalShown = toast.hidden === false;
  // It has to name the actual problem, not just "fix the validation errors".
  report.refusalNamed = /past the end of the terrain/.test(report.refusalText);
  report.refusalCounted = /\b1 validation error\b/.test(report.refusalText);
  report.buttonFlash = button.textContent;
  report.playtestClosed = document.getElementById('playtest').hidden === true;
  report.jsonUnchanged = document.getElementById('trail-json').value.length === before;
}

process.stdout.write(JSON.stringify(report));
// The editor holds timers and listeners open, so the report is written and the
// process ends explicitly rather than waiting for a clean exit.
process.exit(0);
