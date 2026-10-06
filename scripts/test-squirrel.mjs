// Squirrels: finding a tree to hide in, the run and climb there, and fleeing
// when there is none.
import assert from 'node:assert/strict';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { rectangle } from './lib/terrain-fixtures.mjs';
import { SQUIRREL_TREES, propSpan, propWallFit } from '../js/drawing.js';
import { SQUIRREL_FLEE, SQUIRREL_HIDE_MAX, SQUIRREL_LENGTH, SQUIRREL_RANGE, SQUIRREL_STEP, squirrelDash } from '../js/forest-props.js';

// Ground at 320 from 0 to 3000, with a wall rising to 200 from x 1000 to 1100.
const trail = (props) => normalizeTrail({
  name: 'test', fallY: 820, goal: 2800, apples: [], spikes: [],
  terrainBlocks: [rectangle(0, 320, 3000, 620, 'grass', 'ground'), rectangle(1000, 200, 1100, 320, 'concrete', 'wall')],
  start: { x: 120, y: null, facing: 1 }, props,
});
const prop = (type, x, extra = {}) => ({ type, x, y: null, layer: 'back', ...extra });

// It traces the ground either way, up to its range or a wall.
{
  const squirrel = prop('squirrel', 900);
  const fit = propWallFit(trail([squirrel]), squirrel);
  assert.equal(fit.left.length, SQUIRREL_RANGE / SQUIRREL_STEP + 1);
  assert.ok(fit.left.every((dy) => dy === 0), 'flat ground');
  assert.ok(fit.right.length * SQUIRREL_STEP <= 100 + SQUIRREL_STEP, 'the wall stops it');
  assert.equal(fit.tree, null);
}

// It picks the nearest tree it can reach, and never one past a wall or out of range.
{
  const squirrel = prop('squirrel', 900);
  const props = [prop('tree', 1040), prop('tree', 1200), prop('tree', 600), prop('pine', 790), squirrel];
  const fit = propWallFit(trail(props), squirrel);
  assert.equal(fit.tree.dx, -110, 'the pine is the nearest one in reach');
  assert.equal(fit.tree.leaves, SQUIRREL_TREES.pine);
  // The fit follows the trees when one moves.
  props[3].x = 500;
  assert.equal(propWallFit(trail(props), squirrel).tree, null, 'all trees are out of reach');
  assert.ok(propSpan('squirrel', fit)[0] >= -SQUIRREL_TREES.pine + SQUIRREL_LENGTH, 'culling covers the climb');
}

// Startled, it freezes, runs to the trunk, climbs into the crown and hides there.
{
  const fit = { left: Array(61).fill(0), right: Array(61).fill(0), tree: { dx: 120, leaves: SQUIRREL_TREES.tree } };
  const still = squirrelDash(fit, -1, 0);
  assert.deepEqual([still.dx, still.dy, still.climbing, still.hidden], [0, 0, false, false]);
  const running = squirrelDash(fit, -1, 0.5);
  assert.ok(running.dx > 0 && running.dx < 120 && running.dir === 1, 'it runs to the tree, even toward the rider');
  let age = 0, climbed = false;
  for (; age < SQUIRREL_HIDE_MAX && !squirrelDash(fit, -1, age).hidden; age += 0.05) {
    const dash = squirrelDash(fit, -1, age);
    if (dash.climbing) {
      climbed = true;
      assert.equal(dash.dx, 120, 'it climbs the trunk');
    }
  }
  assert.ok(climbed && age < SQUIRREL_HIDE_MAX, `it hides in time (${age.toFixed(2)} s)`);
  assert.ok(squirrelDash(fit, -1, age).dy <= SQUIRREL_TREES.tree - SQUIRREL_LENGTH, 'fully above the leaf line');
  // The slowest hide, at the end of its range, still fits in its flight.
  const far = { ...fit, tree: { dx: -SQUIRREL_RANGE, leaves: SQUIRREL_TREES.pine - 100 } };
  assert.ok(squirrelDash(far, 1, SQUIRREL_HIDE_MAX).hidden);
}

// With no tree it dashes away from the rider and fades out, stopping at a wall.
{
  const fit = { left: Array(61).fill(0), right: [0, 0, 0], tree: null };
  const flee = squirrelDash(fit, -1, 0.5);
  assert.ok(flee.dx < 0 && flee.dir === -1 && flee.alpha < 1 && !flee.hidden);
  assert.equal(squirrelDash(fit, 1, 0.8).dx, 8, 'the wall stops it');
  assert.ok(squirrelDash(fit, -1, SQUIRREL_FLEE).hidden);
}

// It is a known prop type.
{
  const warnings = validateTrail(trail([prop('squirrel', 600)])).filter((m) => m.type === 'warning');
  assert.ok(!warnings.some((m) => /unknown type/.test(m.text)), warnings.map((m) => m.text).join('\n'));
}

console.log('Squirrel tests passed.');
