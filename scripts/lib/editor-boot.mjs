// Boots the real editor against a stub DOM, drives a set of gestures, and
// writes a JSON report to stdout.
//
// It runs as its own process because levels.js caches the level catalog at
// import time: two boots in one process would silently share a level, so the
// parent starts one child per level shape.
import { buildDom, createContextStub, installGlobals } from './editor-harness.mjs';
import { loadLevelShape } from './editor-fixture.mjs';

const kind = process.env.TSC_ENV_LEVEL || 'legacy';
const { html, level } = loadLevelShape(kind);

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
dom.element('level-picker');

globalThis.fetch = async url => (String(url).includes('catalog.json')
  ? { ok: true, json: async () => ({ schemaVersion: 1, levels: [{ id: 't1', file: 'custom/t1.json', name: 'Test' }] }) }
  : { ok: true, json: async () => level });

// Window listeners are recorded so keyboard shortcuts can be driven.
const windowListeners = new Map();
globalThis.addEventListener = (type, handler) => {
  if (!windowListeners.has(type)) windowListeners.set(type, []);
  windowListeners.get(type).push(handler);
};

await import('../../js/editor.js');

const fire = (type, extra = {}) => canvas.dispatch(type, { pointerId: 1, button: 0, clientX: 0, clientY: 0, ...extra });
const world = (x, y) => ({ clientX: x, clientY: y });
const key = (keyName, extra = {}) => {
  document.activeElement = canvas;
  for (const handler of windowListeners.get('keydown') || []) handler({ key: keyName, code: '', preventDefault() {}, ...extra });
};
const current = () => JSON.parse(document.getElementById('level-json').value);
const toolButton = name => [...document.querySelectorAll('[data-tool]')].find(button => button.dataset.tool === name);
const drag = (from, to, extra = {}) => {
  fire('pointerdown', { ...world(...from), ...extra });
  fire('pointermove', { ...world(...to), ...extra });
  fire('pointerup');
};

// Precise interactions on a plain slab, reported on their own because the
// generic gestures below scramble the level.
if (kind === 'interact') {
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
  toolButton('block').click();
  drag([1000, 300], [1200, 500]);
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
  out.errors = [];
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const report = { loaded: JSON.parse(document.getElementById('level-json').value), errors: [] };

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

// The CLEAR LEGACY TERRAIN affordance: whether it is offered for this level,
// and whether pressing it actually removes the older terrain.
{
  const actions = document.getElementById('legacy-terrain-actions');
  const button = document.getElementById('clear-legacy-terrain');
  report.clearOffered = actions.hidden === false;
  report.clearSummary = document.getElementById('legacy-terrain-summary').textContent;
  // The predicate is checked directly: it gates this button, and it once
  // returned an array length rather than a boolean.
  const { hasLegacyTerrain } = await import('../../js/level-schema.js');
  const editorLevel = JSON.parse(document.getElementById('level-json').value);
  report.hasLegacy = hasLegacyTerrain(editorLevel);
  report.hasLegacyType = typeof report.hasLegacy;
  if (report.clearOffered) {
    // confirm() is a browser dialog the stub does not have.
    let confirmed = false;
    globalThis.confirm = () => confirmed;
    const before = JSON.parse(document.getElementById('level-json').value);
    report.blocksBefore = before.terrainBlocks.length;
    button.click();
    report.refusedWithoutConfirm = Array.isArray(JSON.parse(document.getElementById('level-json').value).points);
    confirmed = true;
    button.click();
    const after = JSON.parse(document.getElementById('level-json').value);
    report.pointsAfter = after.points;
    report.blocksAfter = after.terrainBlocks.length;
    report.clearedOffered = document.getElementById('legacy-terrain-actions').hidden === true;
    context.calls.length = 0;
    fire('pointerdown', world(300, 200));
    fire('pointermove', world(420, 300));
    fire('pointerup');
    report.rendersAfterClear = context.calls.length > 0;
  }
}

// A refusal has to be visible, and it has to say what is wrong. A trail whose
// finish sits past the end of its terrain is the case that arises when the
// older ground is cleared before the blocks reach the old finish.
if (process.env.TSC_ENV_LEVEL === 'badgoal') {
  const button = document.getElementById('play-test');
  const before = document.getElementById('level-json').value.length;
  button.click();
  const items = [...document.getElementById('validation-list').children].map(node => node.textContent);
  report.refused = items.some(text => text.includes('before play testing'));
  report.refusalText = items.find(text => text.includes('before play testing')) || '';
  report.refusalIsFirst = items[0]?.includes('before play testing') === true;
  // It has to name the actual problem, not just "fix the validation errors".
  report.refusalNamed = /past the end of the terrain/.test(report.refusalText);
  report.refusalCounted = /\b1 validation error\b/.test(report.refusalText);
  report.buttonFlash = button.textContent;
  report.playtestClosed = document.getElementById('playtest').hidden === true;
  report.jsonUnchanged = document.getElementById('level-json').value.length === before;
}

process.stdout.write(JSON.stringify(report));
// The editor holds timers and listeners open, so the report is written and the
// process ends explicitly rather than waiting for a clean exit.
process.exit(0);
