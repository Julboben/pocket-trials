// Rabbits: the ground they hop along, their white coat on snow, hopping
// about their anchor, and bounding off when startled.
import assert from 'node:assert/strict';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { rectangle } from './lib/terrain-fixtures.mjs';
import { propSpan, propWallFit, rabbitPropAt } from '../js/drawing.js';
import { corgiGround } from '../js/corgi-props.js';
import { SNOW } from '../js/mountain-props.js';
import {
  RABBIT_BOUND,
  RABBIT_BOUND_HEIGHT,
  RABBIT_FLEE,
  RABBIT_HOP,
  RABBIT_HOP_TIME,
  RABBIT_RANGE,
  RABBIT_SPELL,
  RABBIT_STEP,
  RABBIT_WANDER,
  drawRabbit,
  rabbitFlee,
  rabbitIdle,
  rabbitPhase,
} from '../js/rabbit-props.js';

// Ground at 320 from 0 to 3000, with a wall rising to 200 from x 1000 to 1100.
const trail = (props) => normalizeTrail({
  name: 'test', finish: { x: 2800, y: null }, apples: [], spikes: [],
  terrainBlocks: [rectangle(0, 320, 3000, 620, 'grass', 'ground'), rectangle(1000, 200, 1100, 320, 'concrete', 'wall')],
  start: { x: 120, y: null, facing: 1 }, props,
});
const prop = (type, x, extra = {}) => ({ type, x, y: null, layer: 'back', ...extra });
const flat = { left: Array(RABBIT_RANGE / RABBIT_STEP + 1).fill(0), right: Array(RABBIT_RANGE / RABBIT_STEP + 1).fill(0) };

// It traces the ground either way, up to its range or a wall.
{
  const rabbit = prop('rabbit', 900);
  const fit = propWallFit(trail([rabbit]), rabbit);
  assert.equal(fit.left.length, RABBIT_RANGE / RABBIT_STEP + 1);
  assert.ok(fit.left.every((dy) => dy === 0), 'flat ground');
  assert.ok(fit.right.length * RABBIT_STEP <= 100 + RABBIT_STEP, 'the wall stops it');
  const [rise] = propSpan('rabbit', fit);
  assert.ok(rise >= 30 + RABBIT_BOUND_HEIGHT, 'culling covers a bound');
}

// On snow it wears the mountain hare's white coat.
{
  const rabbit = prop('rabbit', 900);
  assert.equal(propWallFit(trail([rabbit]), rabbit).material, 'grass');
  const snowy = normalizeTrail({
    name: 'test', finish: { x: 2800, y: null }, apples: [], spikes: [],
    terrainBlocks: [rectangle(0, 320, 3000, 620, 'snow', 'ground')],
    start: { x: 120, y: null, facing: 1 }, props: [rabbit],
  });
  assert.equal(propWallFit(snowy, rabbit).material, 'snow');
  const colours = (snow) => {
    const seen = new Set();
    drawRabbit({ pixelRect: (x, y, w, h, colour) => seen.add(colour) }, 'sit', snow);
    return seen;
  };
  assert.ok(colours(true).has(SNOW.base) && !colours(false).has(SNOW.base), 'white on snow, brown elsewhere');
}

// At time 0 it sits still at its anchor, facing the way it was placed.
{
  assert.deepEqual(rabbitIdle(0, 0.3, flat, 1), { dx: 0, dy: 0, dir: 1, pose: 'sit' });
  assert.equal(rabbitIdle(0, 0.3, flat, -1).dir, -1);
}

// Its longest run of hops, across the whole patch, ends well within a spell.
assert.ok(Math.ceil((RABBIT_WANDER * 2) / RABBIT_HOP) * RABBIT_HOP_TIME < RABBIT_SPELL - 0.5);

// It hops about its patch: within reach, never far in one frame, never into
// the ground, and through all its poses.
for (const phase of [0, 0.17, 0.5, 0.83]) {
  const fit = { left: flat.left, right: [0, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20, -22, -24, -26, -26, -26] };
  const reach = (fit.right.length - 1) * RABBIT_STEP;
  const poses = new Set();
  let last = null, moved = 0;
  for (let time = 0.01; time < 120; time += 1 / 60) {
    const at = rabbitIdle(time, phase, fit, 1);
    poses.add(at.pose);
    assert.ok(at.dx >= -RABBIT_WANDER && at.dx <= Math.min(RABBIT_WANDER, reach), `within its patch (${at.dx})`);
    assert.ok(at.dy <= corgiGround(fit, at.dx) + 1e-9, 'never below the ground');
    if (last) {
      assert.ok(Math.abs(at.dx - last.dx) <= RABBIT_HOP / (RABBIT_HOP_TIME * 60) + 2, `no jumps (${last.dx} to ${at.dx} at ${time.toFixed(2)})`);
      moved += Math.abs(at.dx - last.dx);
    }
    last = at;
  }
  assert.ok(moved > 200, `it gets about (${moved.toFixed(0)} units in two minutes)`);
  for (const pose of ['sit', 'nibble', 'alert', 'crouch', 'stretch']) assert.ok(poses.has(pose), `phase ${phase} ${pose}`);
}

// Every rabbit hops differently.
assert.notEqual(rabbitPhase(400), rabbitPhase(900));

// Startled, it freezes, then bounds away from the rider and fades out.
{
  const still = rabbitFlee(flat, 20, -1, 0);
  assert.deepEqual([still.dx, still.dy, still.alpha, still.hidden], [20, 0, 1, false]);
  const mid = rabbitFlee(flat, 20, -1, 0.5);
  assert.ok(mid.dx < 20 - RABBIT_BOUND && mid.dir === -1 && mid.dy <= 0, 'it bounds away');
  assert.ok(rabbitFlee(flat, 20, -1, 1.2).alpha < 1, 'it fades out');
  assert.ok(rabbitFlee(flat, 20, -1, RABBIT_FLEE).hidden, 'and is gone');
  let peak = 0;
  for (let age = 0; age < RABBIT_FLEE; age += 0.01) peak = Math.min(peak, rabbitFlee(flat, 0, 1, age).dy);
  assert.ok(peak <= -RABBIT_BOUND_HEIGHT + 1, 'in high leaps');
}

// A wall stops it, and it crouches there.
{
  const fit = { left: flat.left, right: [0, 0, 0, 0, 0, 0] };
  const stuck = rabbitFlee(fit, 0, 1, 1);
  assert.equal(stuck.dx, 20, 'the wall stops it');
  assert.equal(stuck.pose, 'crouch');
}

// It is startled from wherever it has hopped to.
{
  const rabbit = prop('rabbit', 600);
  const t = trail([rabbit]);
  const at = rabbitPropAt(t, rabbit, 7.3);
  const idle = rabbitIdle(7.3, rabbitPhase(600), propWallFit(t, rabbit), 1);
  assert.equal(at.x, 600 + idle.dx);
  assert.equal(at.from, idle.dx);
  assert.equal(at.y, 320 + idle.dy);
}

// It is a known prop type.
{
  const warnings = validateTrail(trail([prop('rabbit', 600)])).filter((m) => m.type === 'warning');
  assert.ok(!warnings.some((m) => /unknown type/.test(m.text)), warnings.map((m) => m.text).join('\n'));
}

console.log('Rabbit tests passed.');
