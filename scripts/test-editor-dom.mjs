// Drives the real editor module against a stub DOM, one child process per level
// shape.
//
// This exists because the bugs it catches were invisible to everything else. A
// malformed data path that throws, and a canvas call made with arguments the
// canvas rejects, cannot be seen in a source review, and a test that
// reimplements the editor's logic only verifies the copy. Importing the real
// module is the only way to see them.
//
// The child runs per level shape because levels.js caches the catalog at import
// time, so two boots in one process would silently share a level.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bootPath = fileURLToPath(new URL('./lib/editor-boot.mjs', import.meta.url));

let failures = 0;
const check = (label, condition) => {
  if (!condition) { failures++; console.log('FAIL', label); }
  else console.log('ok  ', label);
};

const boot = kind => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [bootPath], {
    env: { ...process.env, TSC_ENV_LEVEL: kind },
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
// A trail that still carries the older terrain, with blocks on top of it.
// ---------------------------------------------------------------------------
{
  const report = await boot('legacy');

  check('the editor loads a level with both kinds of terrain',
    report.loaded.terrainBlocks.length === 1 && Array.isArray(report.loaded.points));

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
}

// ---------------------------------------------------------------------------
// A trail whose older terrain has been cleared: no ground line at all. Drawing
// the legacy ground in that state used to crash, and only a genuinely cleared
// level reaches it.
// ---------------------------------------------------------------------------
{
  const report = await boot('blocks');
  check('the cleared trail really has no ground line', report.loaded.points === undefined);
  check('the cleared trail still has its blocks', report.loaded.terrainBlocks.length === 1);
  check('a block-only trail still draws its block', report.evenodd && report.gameArt);
  check('a block-only trail raises no errors at all', report.errors.length === 0);
  for (const error of report.errors) console.log('     ' + error);
}

// The legacy drawing path must be skipped outright on a cleared trail. Asserted
// from the source, because baseRanges() also guards on the missing ground line
// and so the path can never actually be reached by a bad draw call: removing the
// guard changes nothing observable at runtime, but it is the guard that says a
// cleared trail has no legacy terrain to draw.
{
  const source = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');
  const legacy = source.slice(source.indexOf('function drawLegacyTerrain'), source.indexOf('function drawTerrain'));
  check('the legacy draw path bails out on a cleared trail', /if \(!hasLegacyTerrain\(level\)\) return;/.test(legacy));
  const ranges = source.slice(source.indexOf('function baseRanges'), source.indexOf('function drawSurfaceTop'));
  check('the ground ranges tolerate a missing ground line', /!Array\.isArray\(level\.points\)/.test(ranges));
}

// ---------------------------------------------------------------------------
// CLEAR LEGACY TERRAIN, offered for whichever level is open.
// ---------------------------------------------------------------------------
{
  const legacy = await boot('legacy');
  check('CLEAR LEGACY TERRAIN is offered for a level that has it', legacy.clearOffered === true,
    `(offered: ${legacy.clearOffered})`);
  check('it says what is still present', /\d+ ground points/.test(legacy.clearSummary || ''),
    `("${legacy.clearSummary}")`);
  check('it refuses without confirmation', legacy.refusedWithoutConfirm === true);
  check('confirming removes the ground line', legacy.pointsAfter === undefined);
  check('confirming keeps the blocks', legacy.blocksAfter === legacy.blocksBefore,
    `(${legacy.blocksBefore} -> ${legacy.blocksAfter})`);
  check('the offer disappears once cleared', legacy.clearedOffered === true);
  check('the level still renders after clearing', legacy.rendersAfterClear);
}
// A cleared trail is a block-only level, so the offer must be hidden. The
// predicate is also checked directly, because it gates the button and once
// returned an array length instead of a boolean.
{
  const blocks = await boot('blocks');
  check('CLEAR LEGACY TERRAIN is not offered for a cleared level', blocks.clearOffered === false,
    `(offered: ${blocks.clearOffered})`);
  check('the predicate is a plain boolean', blocks.hasLegacy === false,
    `(returned ${JSON.stringify(blocks.hasLegacy)})`);
  check('a cleared level reports no legacy terrain', blocks.hasLegacyType === 'boolean',
    `(type ${blocks.hasLegacyType})`);

  // A two-point ground line is the smallest valid legacy terrain, and is the
  // case a predicate written to ignore short ground lines gets wrong.
  const bare = await boot('bare');
  check('CLEAR LEGACY TERRAIN is offered for a two-point ground line', bare.clearOffered === true,
    `(offered: ${bare.clearOffered})`);
  check('a two-point ground line is reported as legacy terrain', bare.hasLegacy === true,
    `(returned ${JSON.stringify(bare.hasLegacy)})`);
  check('the predicate stays a boolean on short ground', bare.hasLegacyType === 'boolean',
    `(type ${bare.hasLegacyType})`);
  check('it names the ground points it found', /\d+ ground points/.test(bare.clearSummary || ''),
    `("${bare.clearSummary}")`);

  // Islands and paths are legacy terrain too, with no ground line at all. A
  // predicate that only looked for a ground line missed these entirely.
  const island = await boot('island');
  check('CLEAR LEGACY TERRAIN is offered for islands and paths only', island.clearOffered === true,
    `(offered: ${island.clearOffered})`);
  check('islands are reported', /island/.test(island.clearSummary || ''), `("${island.clearSummary}")`);
  check('paths are reported', /path/.test(island.clearSummary || ''), `("${island.clearSummary}")`);

  // A ground line with a gap: the old predicate returned the gap count, so the
  // offer was gated on a number rather than a boolean.
  const gapped = await boot('gapped');
  check('a gapped ground line is reported as a boolean', gapped.hasLegacyType === 'boolean',
    `(type ${gapped.hasLegacyType})`);
  check('a gapped ground line offers the clear', gapped.hasLegacy === true,
    `(returned ${JSON.stringify(gapped.hasLegacy)})`);
  check('gaps are named in the summary', /gap/.test(gapped.clearSummary || ''), `("${gapped.clearSummary}")`);
}

// ---------------------------------------------------------------------------
// A refusal to play test has to be visible and has to say what is wrong.
// ---------------------------------------------------------------------------
{
  const report = await boot('badgoal');
  check('play testing is refused when the level does not validate', report.refused === true);
  check('the refusal names the actual problem', report.refusalNamed === true, `("${report.refusalText}")`);
  check('the refusal counts the errors', report.refusalCounted === true, `("${report.refusalText}")`);
  check('the refusal is the first thing in the list', report.refusalIsFirst === true);
  check('the play-test button says how many errors', /\d+ ERROR/.test(report.buttonFlash || ''), `("${report.buttonFlash}")`);
  check('the playtest panel did not open', report.playtestClosed === true);
  check('the level itself was not modified', report.jsonUnchanged === true);
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
}

console.log(failures ? `\n${failures} failing` : '\nEditor DOM tests passed.');
process.exit(failures ? 1 : 0);
