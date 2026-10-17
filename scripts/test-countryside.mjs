// Countryside and Copenhagen props: the grass sways downwind and is pushed
// flat by a passing rider, Dannebrog ripples only while time runs, and the
// lean-forward drawing is painted on the rock like the other tutorials. All
// of it is visual only and still at time 0.
import assert from 'node:assert/strict';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { rectangle } from './lib/terrain-fixtures.mjs';
import { PAINTED_PROPS, canFlip, canRotate, paintedBounds } from '../js/drawing.js';
import { flagRipple } from '../js/countryside-props.js';
import { GRASS_BRUSH, fireFrame, grassLean } from '../js/forest-props.js';

const COUNTRYSIDE_PROPS = ['tent', 'grass', 'flagpole', 'christiania-bike', 'bench', 'fireplace', 'tutorial-lean-forward'];

// Every new prop is a known type; the drawing is painted on the rock.
{
  const trail = normalizeTrail({
    name: 'test', finish: { x: 2800, y: null }, apples: [], spikes: [],
    terrainBlocks: [rectangle(0, 320, 3000, 620, 'stone', 'ground')],
    start: { x: 120, y: null, facing: 1 },
    props: COUNTRYSIDE_PROPS.map((type, index) => ({ type, x: 400 + index * 160, y: null, layer: 'back' })),
  });
  const warnings = validateTrail(trail).filter((m) => m.type === 'warning').map((m) => m.text);
  assert.ok(!warnings.some((text) => /unknown type/.test(text)), warnings.join('\n'));
  assert.ok(PAINTED_PROPS.has('tutorial-lean-forward') && canRotate('tutorial-lean-forward'));
  assert.ok(paintedBounds('tutorial-lean-forward')[3] > 0, 'it reaches below its anchor');
  for (const type of ['tent', 'grass', 'flagpole', 'christiania-bike', 'bench', 'fireplace']) assert.ok(canFlip(type), `${type} can flip`);
}

// Grass leans downwind, harder in a strong wind, and holds its lean at time 0.
{
  assert.ok(grassLean(0, 0.5, -1, 0.3, 0) < 0, 'leans left with the wind blowing left');
  assert.ok(grassLean(0, 0.5, 1, 0.3, 0) > 0, 'and right when flipped');
  assert.ok(grassLean(0, 1, -1, 0.3, 0) < grassLean(0, 0.2, -1, 0.3, 0), 'further in a strong wind');
  assert.equal(grassLean(0, 0.5, -1, 0.3, 4), grassLean(0, 0.5, -1, 0.7, 4), 'still at time 0');
  const sway = new Set(Array.from({ length: 20 }, (_, i) => grassLean(1 + i * 0.1, 0.5, -1, 0.3, 0).toFixed(3)));
  assert.ok(sway.size > 5, 'it sways while time runs');
}

// A rider brushing through pushes the blades flat away from them.
{
  const calm = grassLean(0, 0.25, -1, 0, 0);
  assert.ok(grassLean(0, 0.25, -1, 0, 0, -4, -20) > 0.8, 'pushed right by a rider just to its left');
  assert.ok(grassLean(0, 0.25, -1, 0, 0, 4, -20) < -0.8, 'pushed left by a rider just to its right');
  assert.equal(grassLean(0, 0.25, -1, 0, 0, GRASS_BRUSH.x + 2, -20), calm, 'untouched when the rider is clear');
  assert.equal(grassLean(0, 0.25, -1, 0, 0, 2, -GRASS_BRUSH.y - 10), calm, 'or high above it');
  assert.ok(Math.abs(grassLean(3, 1, -1, 0, 0, 0.5, -10)) <= 1.4, 'never bent further than flat');
}

// The flag lies flat at the pole and at time 0, and ripples otherwise.
{
  for (let column = 0; column < 20; column++) assert.ok(flagRipple(0, 1, 0.4, column) === 0);
  assert.ok(flagRipple(2.3, 1, 0.4, 0) === 0, 'held at the pole');
  const ripples = Array.from({ length: 20 }, (_, column) => flagRipple(2.3, 1, 0.4, column));
  assert.ok(ripples.some((value) => value !== 0) && ripples.every((value) => value % 2 === 0), 'ripples on the art grid');
}

// The fireplace's flames hold still at time 0 and flicker out of step otherwise.
{
  assert.deepEqual(fireFrame(0, 0.2), fireFrame(0, 0.9), 'still at time 0');
  assert.ok(fireFrame(0, 0).every((tongue) => tongue.lick === 0));
  const frames = Array.from({ length: 30 }, (_, i) => fireFrame(1 + i * 0.04, 0.2));
  assert.ok(new Set(frames.map((frame) => frame[1].height)).size > 1, 'the flames rise and fall');
  assert.ok(frames.some((frame) => frame[0].height !== frame[2].height - 2), 'each tongue in its own time');
  assert.ok(frames.flat().every((tongue) => tongue.height % 2 === 0 && tongue.lick % 2 === 0), 'on the art grid');
}

console.log('Countryside props: all checks passed.');
