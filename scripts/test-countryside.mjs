// Countryside and Copenhagen props: the grass sways downwind and is pushed
// flat by a passing rider, Dannebrog ripples only while time runs, and the
// lean-forward drawing is painted on the rock like the other tutorials. All
// of it is visual only and still at time 0.
import assert from 'node:assert/strict';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { rectangle } from './lib/terrain-fixtures.mjs';
import { PAINTED_PROPS, WALL_PROPS, canFlip, canRotate, mossSurface, paintedBounds, propWallFit } from '../js/drawing.js';
import { FLAGPOLE, flagDroop, flagRipple } from '../js/countryside-props.js';
import { FIRE_TONGUES, GRASS_BRUSH, IVY, TREE_SWAY_MAX, grassLean, ivyLayout, ivyRustle, mossCushions, mossPlacement, treeSway } from '../js/forest-props.js';
import { fireFrame, fireTongues } from '../js/fire.js';

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
  const reach = (wind) => Math.max(...Array.from({ length: 20 }, (_, column) => Math.abs(flagRipple(2.3, wind, 0.4, column))));
  assert.ok(reach(1) > reach(0.1), 'it ripples harder in a gale');
}

// In still air the flag droops, more towards its end; in a gale it flies straight out.
{
  assert.equal(flagDroop(0.3, 0), 0, 'held at the pole');
  assert.ok(flagDroop(0, 19) > flagDroop(0, 5) && flagDroop(0, 19) > flagDroop(0.5, 19));
  for (let column = 0; column < 20; column++) assert.equal(flagDroop(1, column), 0);
  assert.ok(grassLean(0, 1, -1, 0.3, 0) < -0.8, 'a gale bends the grass well over');
  assert.ok(Math.abs(grassLean(0, 0, -1, 0.3, 0)) < 0.1, 'it stands nearly straight in still air');
}

// Fire (fire.js) is sized to its prop, holds still at time 0, and flickers
// out of step otherwise.
{
  for (const [width, height] of [[8, 16], [20, 22], [60, 50]]) {
    const tongues = fireTongues(width, height);
    assert.ok(tongues.length >= 1 && tongues.length <= Math.ceil(width / 8) + 1, `a fire ${width} across has a few tongues`);
    assert.equal(Math.max(...tongues.map((tongue) => tongue.height)), height, 'the tallest is as tall as the fire');
    assert.ok(tongues.every((tongue) => Math.abs(tongue.x) + tongue.half <= width / 2 + 4), 'they stay within its width');
    assert.ok(tongues.flatMap((tongue) => [tongue.x, tongue.height, tongue.half]).every((v) => v % 2 === 0), 'on the art grid');
  }
  assert.deepEqual(fireFrame(FIRE_TONGUES, 0, 0.2), fireFrame(FIRE_TONGUES, 0, 0.9), 'still at time 0');
  assert.ok(fireFrame(FIRE_TONGUES, 0, 0).every((tongue) => tongue.lick === 0));
  const frames = Array.from({ length: 30 }, (_, i) => fireFrame(FIRE_TONGUES, 1 + i * 0.04, 0.2));
  assert.ok(new Set(frames.map((frame) => frame[0].height)).size > 1, 'the flames rise and fall');
  assert.ok(frames.some((frame) => frame[0].height - FIRE_TONGUES[0].height !== frame[1].height - FIRE_TONGUES[1].height), 'each tongue in its own time');
  assert.ok(frames.flat().every((tongue) => tongue.height % 2 === 0 && tongue.lick % 2 === 0), 'on the art grid');
}

// The flagpole stands about 6 m tall at 27 units to the metre (PROPS_GUIDE.md).
{
  assert.ok(-FLAGPOLE.top >= 162 && -FLAGPOLE.top <= 216, 'a garden flagpole is 6 to 8 m');
  assert.ok(FLAGPOLE.top % 2 === 0, 'on the art grid');
}

// Ivy climbs a wall face as high as it goes, and no higher than IVY.max.
{
  assert.ok(WALL_PROPS.has('ivy') && !canFlip('ivy'), 'ivy is a wall prop');
  // A wall standing on the ground: its left face at x = 600, 80 tall.
  const wall = normalizeTrail({
    name: 'test', finish: { x: 2800, y: null }, apples: [], spikes: [],
    terrainBlocks: [rectangle(0, 320, 3000, 620, 'stone', 'ground'), rectangle(600, 240, 700, 320, 'stone', 'ground'),
      rectangle(1000, 0, 1100, 320, 'stone', 'ground')],
    start: { x: 120, y: null, facing: 1 }, props: [],
  });
  const low = propWallFit(wall, { type: 'ivy', x: 598, y: 320 });
  assert.equal(low.side, 1, 'the rock is on its right');
  assert.ok(low.rise >= 72 && low.rise <= 80, `climbs to the top of a low wall (${low.rise})`);
  const tall = propWallFit(wall, { type: 'ivy', x: 998, y: 320 });
  assert.equal(tall.rise, IVY.max, 'no higher than IVY.max up a tall wall');
  const open = propWallFit(wall, { type: 'ivy', x: 300, y: 320 });
  assert.equal(open.rise, 0, 'nothing to climb out in the open');
  const noise = (n) => (n * 0.618) % 1;
  for (const rise of [16, 60, IVY.max]) {
    const { stems, leaves } = ivyLayout(rise, noise);
    const top = Math.min(...leaves.map((leaf) => leaf.y), ...stems.map(([, y]) => y));
    assert.ok(top >= -rise - 8, `leaves stay near the top of a ${rise} climb`);
    assert.ok([...stems.flat(), ...leaves.flatMap((leaf) => [leaf.x, leaf.y])].every((v) => v % 2 === 0), 'on the art grid');
    assert.ok(leaves.every((leaf) => leaf.x >= -10 && leaf.x <= 24), 'hugging the face');
  }
  assert.ok(ivyRustle(0, 1, 0.3, 4) === 0, 'still at time 0');
  assert.ok(new Set(Array.from({ length: 20 }, (_, i) => ivyRustle(1 + i * 0.1, 0.8, 0.3, 4))).size > 1, 'stirs in the wind');
}

// Moss lies along the surface whichever way it faces: it finds the
// surface's normal and stands its cushions along it, on the art grid.
{
  const close = ([ax, ay], [bx, by]) => Math.abs(ax - bx) < 0.2 && Math.abs(ay - by) < 0.2;
  const s = Math.SQRT1_2;
  const cases = [
    ['a face looking right', (x) => x < 0, [1, 0]],
    ['a face looking left', (x) => x > 0, [-1, 0]],
    ['a hill rising to the right', (x, y) => y > -x, [-s, -s]],
    ['a flat top', (x, y) => y > 0, [0, -1]],
    ['an overhang', (x, y) => y < 0, [0, 1]],
  ];
  for (const [name, solid, expected] of cases) {
    const { normal, at } = mossSurface(solid, 0, 0);
    assert.ok(close(normal, expected), `${name}: faces ${normal.map((v) => v.toFixed(2))}`);
    assert.ok(Math.hypot(...at) <= 2, `${name}: already on the surface`);
  }
  // Clicked a little into the air above a top, it steps back down onto it.
  const above = mossSurface((x, y) => y > 0, 0, -9);
  assert.ok(close(above.normal, [0, -1]) && Math.abs(above.at[1] - 9) <= 2, `steps onto the surface (${above.at})`);
  assert.deepEqual(mossSurface(() => false, 0, 0), { normal: [0, -1], at: [0, 0] }, 'no rock near: it sits as on a top');
  // Along a slope the cushions follow the slope, not a vertical line.
  const placed = mossPlacement(mossCushions(() => 0.5), [-s, -s]);
  const first = placed[0], last = placed.at(-1);
  assert.ok(Math.sign(last.x - first.x) === -Math.sign(last.y - first.y) && Math.abs(last.x - first.x) > 10, 'it runs along the hill');
  assert.ok(placed.every(({ x, y }) => x % 2 === 0 && y % 2 === 0), 'on the art grid');
  assert.ok(!canRotate('moss'), 'it finds its own angle, so it is not turned by hand');
}

// A tree's crown bends in the wind: still in still air and at time 0, tipping
// a pixel now and then as a gust passes in a breeze, leaning and swaying
// downwind in a gale, and never further than TREE_SWAY_MAX.
{
  const over = (wind, downwind = -1) => {
    const tops = [];
    for (let t = 0.01; t < 120; t += 0.05) for (const x of [80, 210, 340]) tops.push(treeSway(t, wind, downwind, x, (x * 0.37) % 1));
    return { moving: tops.filter((top) => Math.abs(top) >= 1).length / tops.length, mean: tops.reduce((a, b) => a + b, 0) / tops.length, peak: Math.max(...tops.map(Math.abs)) };
  };
  assert.equal(treeSway(0, 1, -1, 100, 0.3), 0, 'still at time 0');
  assert.equal(over(0).peak, 0, 'still in still air');
  const breeze = over(0.25), gale = over(1);
  assert.ok(breeze.moving > 0.05 && breeze.moving < 0.35, `a breeze tips the tops now and then (${breeze.moving.toFixed(2)})`);
  assert.ok(gale.moving > 0.6, 'a gale keeps them moving');
  assert.ok(gale.mean < -0.5 && over(1, 1).mean > 0.5, 'and leans them downwind, either way');
  assert.ok(gale.peak <= TREE_SWAY_MAX && breeze.peak < 2, 'never past two art pixels; a breeze only one');
}

console.log('Countryside props: all checks passed.');
