// Smoke tests for the trail-building tools: scripts/playtest.mjs solves,
// probes and checks a trail, and scripts/render-trail.mjs draws it. They run
// the scripts as an author would, on small inline trails, so a change to the
// physics, the bot or the renderer that breaks them is caught here. The
// render test needs Chrome and is skipped without it, like the console test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRide, stepRide } from '../js/ride.js';
import { decodeInputs } from '../js/replay-codec.js';
import { normalizeTrail } from '../js/trail-schema.js';
import { chromePath } from './lib/chrome.mjs';
import { playtestRunPath, repoRoot } from './lib/trails.mjs';
import { rectangle } from './lib/terrain-fixtures.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'hjulben-playtest-'));
// The id the scripts give the fixture, from its file name; its saved run goes in .playtest/.
const ID = 'test-playtest-fixture';
const file = path.join(dir, `${ID}.json`);
const run = (script, ...args) => execFileSync(process.execPath, [`scripts/${script}`, file, ...args], {
  cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
});

// A flat field between two walls. The apple is ahead of the start and the
// finish behind it, so the trail can only be finished by turning around.
const trail = {
  name: 'Playtest fixture',
  terrainBlocks: [
    rectangle(-300, 320, 2300, 700, 'grass', 'ground'),
    rectangle(-300, 0, 0, 700, 'grass', 'west-wall'),
    rectangle(2000, 0, 2300, 700, 'grass', 'east-wall'),
  ],
  start: { x: 400, y: null, facing: 1 },
  finish: { x: 150, y: 270 },
  apples: [{ x: 900, y: null }],
  props: [{ x: 700, y: null, type: 'tree', layer: 'back' }, { x: 1100, y: null, type: 'bush', layer: 'front' }],
  spikes: [],
};
writeFileSync(file, JSON.stringify(trail));

try {
  // --check validates and surveys without solving.
  const check = run('playtest.mjs', '--check');
  assert.match(check, /Validation: ok/);
  assert.match(check, /1: 900,\d+, 60 above the surface below it/, 'apples are listed with their height');
  assert.doesNotMatch(check, /Solving/, '--check does not solve');

  // An overlong description is cut off when a trail loads, so it is reported.
  writeFileSync(file, JSON.stringify({ ...trail, description: 'x'.repeat(2100) }));
  assert.match(run('playtest.mjs', '--check'), /WARNING: The description is 2100 characters/);

  // The same warning about several blocks is one line, listing them.
  writeFileSync(file, JSON.stringify({ ...trail, terrainBlocks: [
    ...trail.terrainBlocks, rectangle(500, 400, 540, 410, 'grass', 'patch-a'), rectangle(600, 400, 640, 410, 'grass', 'patch-b'),
  ] }));
  const grouped = run('playtest.mjs', '--check');
  assert.match(grouped, /WARNING x2: Block N is buried inside terrain of the same material \(grass\).* \(blocks 4, 5\)/, 'repeated warnings are grouped');
  assert.doesNotMatch(grouped, /WARNING: Block 4/, 'and not listed one by one');
  writeFileSync(file, JSON.stringify(trail));

  // The bot solves the trail one apple at a time, turning around on the way back.
  const solved = run('playtest.mjs', '--fresh', '--minutes', '0.5', '--trials', '2');
  assert.match(solved, /Stretch 1: .* to apple 1 at 900,\d+ in [\d.]+ s/);
  assert.match(solved, /Stretch 2: .* to the finish at 150,248 in [\d.]+ s/);
  assert.match(solved, /turns [1-9]/, 'the way back takes a turn');
  assert.match(solved, /forgiveness: \d+% of reruns/);
  assert.match(solved, /Result: the bot finished in [\d.]+ s/);
  const saved = JSON.parse(readFileSync(playtestRunPath(ID), 'utf8'));
  assert.equal(saved.stretches.length, 2, 'the run is saved stretch by stretch');
  assert.ok(saved.inputs, 'a finished run is saved whole as well');
  // The bot can overshoot an apple; the saved run must still ride as the
  // stretches were solved, from the start without a stop.
  const replay = createRide(normalizeTrail(trail));
  for (const input of decodeInputs(saved.inputs)) if (replay.status === 'running') stepRide(replay, input);
  assert.equal(replay.status, 'won', 'the saved run replays to the finish');
  assert.match(run('playtest.mjs', '--trials', '0'), /saved run from the last playtest/, 'the saved run is tried first');

  // Without turning around, the finish behind the start can't be reached.
  const unturned = run('playtest.mjs', '--fresh', '--without', 'turn', '--minutes', '0.05', '--trials', '0');
  assert.match(unturned, /Stretch 2: FAILED to reach the finish/);
  assert.match(unturned, /Result: NOT finished; the bot took 1 of 1 apples/);

  // A scripted probe prints a trace and rides where the script says.
  const scripted = run('playtest.mjs', '--probe', '400,ground,1,0', '--script', 'gas 0.5; gas fwd 0.1; gas 0.5; turn; brake 0.3', '--every', '0.5');
  assert.match(scripted, /Probe: bike at 400,\d+, facing right/);
  assert.match(scripted, /^\s+0\.50\s+\d+/m, 'trace lines every --every seconds');
  const [, endX, status] = /End: (\d+),\d+, (\w+)\./.exec(scripted);
  assert.ok(Number(endX) > 450, 'gas moves the bike ahead');
  assert.equal(status, 'running');

  // A probe with a goal lets the bot find its own way and prints its inputs as a script.
  const goal = run('playtest.mjs', '--probe', '400,ground,-1,0', '--goal', 'reach:1200,290', '--minutes', '0.5', '--trials', '0');
  assert.match(goal, /Reached 1200,290 in [\d.]+ s/);
  assert.match(goal, /inputs, in the --script format: .*turn/, 'facing left, the bot turns to reach a place to the right');

  if (!chromePath) console.log('Playtest tests passed; render tests skipped: Chrome not found (set CHROME_PATH).');
  else {
    const out = path.join(dir, 'renders') + '/';
    const isPng = name => readFileSync(out + name).subarray(1, 4).toString() === 'PNG';
    const rendered = execFileSync(process.execPath, ['scripts/render-trail.mjs', file, '--out', out], { cwd: repoRoot, encoding: 'utf8' });
    assert.match(rendered, /Route from the last playtest \([\d.]+ s, finished\)/, 'the saved run is drawn');
    const images = readdirSync(out).sort();
    assert.ok(images.includes('overview.png'));
    assert.ok(images.some(name => /^section-01_x-?\d+--?\d+\.png$/.test(name)), 'section names hold their x range');
    assert.ok(images.every(isPng));
    execFileSync(process.execPath, ['scripts/render-trail.mjs', file, '--out', out, '--view', '300,0,880,500', '--props', '--route'], { cwd: repoRoot });
    assert.ok(existsSync(out + 'view-300_0_880x500.png') && isPng('view-300_0_880x500.png'), '--view draws one view');
    console.log('Playtest and render tests passed.');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(playtestRunPath(ID), { force: true });
}
