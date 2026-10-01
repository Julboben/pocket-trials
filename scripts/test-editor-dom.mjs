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
  check('the refusal is the first thing in the list', report.refusalIsFirst === true);
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
  check('a cut straight through splits the block into two regions', report.splitRegions === 2, `(${report.splitRegions})`);
  check('dragging a corner of the second region moves that corner', report.rightMoved === true);
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

console.log(failures ? `\n${failures} failing` : '\nEditor DOM tests passed.');
process.exit(failures ? 1 : 0);
