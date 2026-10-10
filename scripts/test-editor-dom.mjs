// Drives the real editor module against a stub DOM, one child process per trail
// shape.
//
// This exists because the bugs it catches were invisible to everything else. A
// malformed data path that throws, and a canvas call made with arguments the
// canvas rejects, cannot be seen in a source review, and a test that
// reimplements the editor's logic only verifies the copy. Importing the real
// module is the only way to see them.
//
// The child runs per trail shape because trails.js caches the catalog at import
// time, so two boots in one process would silently share a trail.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bootPath = fileURLToPath(new URL('./lib/editor-boot.mjs', import.meta.url));

let failures = 0;
const check = (label, condition) => {
  if (!condition) { failures++; console.log('FAIL', label); }
  else console.log('ok  ', label);
};

const boot = kind => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [bootPath], {
    env: { ...process.env, TSC_ENV_TRAIL: kind },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.on('close', () => {
    try { resolve(JSON.parse(out)); }
    catch (error) { reject(new Error(`${kind}: child produced no report (${error.message})`)); }
  });
  // The editor keeps timers open, so the child is killed once it has reported.
  setTimeout(() => child.kill('SIGKILL'), 30000).unref();
});

const reported = (report, label) => {
  const errors = report.errors.filter(error => error.startsWith(label));
  check(`${label} does not throw`, errors.length === 0);
  for (const error of errors) console.log('     ' + error);
};

// ---------------------------------------------------------------------------
// A block trail: drawing and the generic gestures.
// ---------------------------------------------------------------------------
{
  const report = await boot('blocks');

  check('the editor loads a block trail', report.loaded.terrainBlocks.length === 1);

  // The block must really be drawn, or nothing below proves anything.
  check('game art draws the terrain with the game renderer', report.gameArt);
  check('and outlines the blocks for editing', report.gameArtOutlined);
  check('a block is really drawn', report.drew);
  check('a block outline is stroked and closed', report.closed);
  // Caves stay open, which is what the even-odd rule is for.
  check('the block fill uses a fill rule', report.evenodd);
  // stroke() takes no arguments on a real canvas.
  check('stroke is never called with a fill rule', !report.strokeHasArgs);

  for (const label of ['block', 'cut', 'select', 'frames', 'camera', 'pinch']) {
    reported(report, label);
  }
  check('a block trail raises no errors at all', report.errors.length === 0);
}

// ---------------------------------------------------------------------------
// A refusal to play test has to be visible and has to say what is wrong.
// ---------------------------------------------------------------------------
{
  const report = await boot('badgoal');
  check('play testing is refused when the trail does not validate', report.refused === true);
  check('the refusal names the actual problem', report.refusalNamed === true, `("${report.refusalText}")`);
  check('the refusal counts the errors', report.refusalCounted === true, `("${report.refusalText}")`);
  check('the refusal pops up over the canvas', report.refusalShown === true);
  check('the play-test button says how many errors', /\d+ ERROR/.test(report.buttonFlash || ''), `("${report.buttonFlash}")`);
  check('the playtest panel did not open', report.playtestClosed === true);
  check('the trail itself was not modified', report.jsonUnchanged === true);
}

// ---------------------------------------------------------------------------
// Precise editing on a block trail.
// ---------------------------------------------------------------------------
{
  const report = await boot('interact');
  check('a click without a drag leaves no undo step', report.clickLeavesNoUndo === true);
  check('a cut straight through splits the block into two blocks', JSON.stringify(report.splitBlocks) === '["id,inner,material,outer","id,inner,material,outer"]', `(${JSON.stringify(report.splitBlocks)})`);
  check('clicking one piece selects only that block', !/BLOCKS/.test(report.splitSelectsOne || ''), `("${report.splitSelectsOne}")`);
  check('dragging a corner of the second piece moves that corner', report.rightMoved === true);
  check('and leaves the first region alone', report.leftUntouched === true);
  check('Escape abandons a cut being drawn', report.escapeCancels === true);
  check('Shift-click selects several blocks', /2 BLOCKS/.test(report.multiTitle || ''), `("${report.multiTitle}")`);
  check('dragging moves every selected block', report.multiMoved === true);
  check('Delete removes every selected block', report.multiDeleted === true);
  check('Shift-drag moves a point', report.snapMoved === true);
  check('Shift-drag locks a point to 15 degree steps from a neighbour', report.snapAngle === true);
  check('Shift-drag puts a point on a grid line', report.snapGrid === true);
  check('releasing Shift mid-drag restores the exact position', report.releaseExact === true);
  check('pressing Shift mid-drag snaps again', report.repressSnaps === true);
  check('dragging without Shift is not snapped', report.plainExact === true);
}

// ---------------------------------------------------------------------------
// A roof over something on the ground leaves it where it stood.
// ---------------------------------------------------------------------------
{
  const report = await boot('covered');
  check('a block drawn over the start leaves the start on its ground', report.startY === 288, `(${report.startY})`);
  check('a block dragged over a prop leaves the prop on its ground', report.propY === 300, `(${report.propY})`);
  check('raising the ground under the finish still carries it', report.finishY === null, `(${report.finishY})`);
  check('the finish tool clicked in a cave puts the finish on the cave floor', report.caveFinishY === 500, `(${report.caveFinishY})`);
  check('a finish lifted in the cave is pinned in the air', report.liftedFinishY === 420, `(${report.liftedFinishY})`);
  check('a selection box around the start selects it', /START/i.test(report.boxTitle || ''), `("${report.boxTitle}")`);
  check('select all moves the start', report.selectAllMovesStart === true);
  check('select all moves the finish', report.selectAllMovesFinish === true);
  check('a ground prop pasted into a cave lands on the cave floor', report.props === 3 && report.pastedPropY === 500, `(${report.props}, ${report.pastedPropY})`);
}

// ---------------------------------------------------------------------------
// Rotation: the handle, R and the inspector.
// ---------------------------------------------------------------------------
{
  const report = await boot('rotate');
  const json = JSON.stringify;
  check('a selected block shows the rotate handle and quarter-turn buttons', report.blockHandle === true && report.blockRowShown === true);
  check('dragging the handle a quarter turn turns the block about its centre', json(report.blockTurned) === json([250, 50, 550, 850]), `(${json(report.blockTurned)})`);
  check('one rotate drag is one undo step', report.oneUndo === true);
  check('the quarter-turn button turns the block', json(report.buttonTurned) === json([250, 50, 550, 850]), `(${json(report.buttonTurned)})`);
  check('a lone prop shows its Rotation field instead of the buttons', /PROP/i.test(report.propTitle || '') && report.propFieldShown === true && report.propButtonsHidden === true, `("${report.propTitle}")`);
  check('Shift snaps a prop to 15 degrees', report.snapped === 15, `(${report.snapped})`);
  check('without Shift a prop turns freely', Math.abs(report.free - 20) < 0.2, `(${report.free})`);
  check('undo restores an unrotated prop', report.undone === undefined, `(${report.undone})`);
  check('R turns a prop 15 degrees clockwise', report.keyR === 15, `(${report.keyR})`);
  check('Shift+R turns it back counter-clockwise', report.keyShiftR === -15, `(${report.keyShiftR})`);
  check('the Rotation field wraps to -180..180', report.fieldWrapped === -160, `(${report.fieldWrapped})`);
  check('a rotation of 0 is left out of the trail', report.fieldCleared === false);
  check('turning everything moves the start but keeps its facing', report.startMoved === true && report.startFacing === true);
  check('turning everything moves water but keeps it level', report.waterMoved === true && report.waterShape === true);
  check('turning everything turns the props', report.propTurned === 90, `(${report.propTurned})`);
  check('water alone has no rotate handle', /WATER/i.test(report.waterTitle || '') && report.waterHandle === null && report.waterRowHidden === true, `("${report.waterTitle}")`);
  check('rotating raises no errors', report.errors.length === 0);
}

// ---------------------------------------------------------------------------
// The Water tool draws, places and edits water bodies like the other tools.
// ---------------------------------------------------------------------------
{
  const report = await boot('water');
  const same = (body, expected) => JSON.stringify(body) === JSON.stringify(expected);
  check('a Water drag draws the dragged rectangle', same(report.drawn, { x: 1000, y: 200, width: 200, depth: 60 }), `(${JSON.stringify(report.drawn)})`);
  check('the new body is selected', report.drawnSelected === true);
  check('the inspector shows its depth', report.depthRowShown === true);
  check('a Water click drops a default body centred on the click', same(report.clicked, { x: 280, y: 250, width: 240, depth: 32 }), `(${JSON.stringify(report.clicked)})`);
  check('a body is dragged by the middle of its surface', report.moved?.x === 1050 && report.moved?.y === 180, `(${JSON.stringify(report.moved)})`);
  check('clicking open water selects the body', report.clickSelects === true);
  check('changing the depth keeps the surface', report.deepened?.depth === 120 && report.deepened?.y === 250, `(${JSON.stringify(report.deepened)})`);
  check('the hint says deep water wipes the rider out', /wipes the rider out/.test(report.deepHint || ''), `("${report.deepHint}")`);
  check('Delete removes the body and undo brings it back', report.afterDelete === 1 && report.afterUndo === 2, `(${report.afterDelete}, ${report.afterUndo})`);
  check('water editing raises no errors', report.errors.length === 0);
}

console.log(failures ? `\n${failures} failing` : '\nEditor DOM tests passed.');
process.exit(failures ? 1 : 0);
