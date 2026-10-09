// Desert props: the tumbleweed's roll, the windmill in the wind, the heat
// haze and the vulture's circle. All of it is visual only and still at time 0.
import assert from 'node:assert/strict';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import { rectangle } from './lib/terrain-fixtures.mjs';
import { propSpan, propWallFit } from '../js/drawing.js';
import {
  TUMBLEWEED_RUN, TUMBLEWEED_STEP, VULTURE_HEIGHT, hazeShift, hazeStreaks,
  tumbleweedRoll, vultureOrbit, windStrength, windmillAngle,
} from '../js/desert-props.js';

// Ground at 320 from 0 to 3000, with a wall rising to 200 from x 1000 to 1100.
const trail = (props) => normalizeTrail({
  name: 'test', finish: { x: 2800, y: null }, apples: [], spikes: [],
  terrainBlocks: [rectangle(0, 320, 3000, 620, 'sand', 'ground'), rectangle(1000, 200, 1100, 320, 'concrete', 'wall')],
  start: { x: 120, y: null, facing: 1 }, props,
});
const prop = (type, x, extra = {}) => ({ type, x, y: null, layer: 'back', ...extra });

// The tumbleweed traces the ground the way it rolls, up to its run or a wall.
{
  const open = prop('tumbleweed', 1200);
  const fit = propWallFit(trail([open]), open);
  assert.equal(fit.path.length, TUMBLEWEED_RUN / TUMBLEWEED_STEP + 1);
  assert.ok(fit.path.every((dy) => dy === 0), 'flat ground');
  const walled = prop('tumbleweed', 900);
  assert.ok(propWallFit(trail([walled]), walled).path.length * TUMBLEWEED_STEP <= 100 + TUMBLEWEED_STEP, 'the wall stops it');
  const flipped = prop('tumbleweed', 1200, { flip: true });
  assert.ok(propWallFit(trail([flipped]), flipped).path.length * TUMBLEWEED_STEP <= 100 + TUMBLEWEED_STEP, 'flipped, it rolls left into the wall');
  const [rise, hang] = propSpan('tumbleweed', { path: [0, -30, -60, 10] });
  assert.ok(rise >= 60 + 24 && hang >= 10, 'culling covers the ball over the whole path');
}

// It sits still at time 0, rolls and fades in and out, and only rocks with no room.
{
  const path = Array(TUMBLEWEED_RUN / TUMBLEWEED_STEP + 1).fill(0);
  assert.deepEqual(tumbleweedRoll(path, 0), { distance: 0, dy: 0, angle: 0, lift: 0, alpha: 1 });
  const early = tumbleweedRoll(path, 0.5);
  const mid = tumbleweedRoll(path, 6);
  assert.ok(early.alpha < 1 && early.distance > 0, 'it fades in');
  assert.ok(mid.distance > early.distance && mid.alpha === 1 && mid.angle > early.angle, 'it rolls on');
  const short = tumbleweedRoll([0, 0, 0], 4);
  assert.equal(short.distance, 0);
  assert.equal(short.alpha, 1);
}

// The windmill turns one way only, faster in more wind; storms blow harder.
{
  let last = windmillAngle(0, 0.2);
  for (let t = 0.1; t < 30; t += 0.1) {
    const angle = windmillAngle(t, 0.2);
    assert.ok(angle >= last, `monotonic at ${t.toFixed(1)}`);
    last = angle;
  }
  assert.ok(windmillAngle(20, 1) - windmillAngle(0, 1) > windmillAngle(20, 0.1) - windmillAngle(0, 0.1));
  const calm = windStrength({});
  const storm = windStrength({ clouds: 1, rain: 1, lightning: 1 });
  assert.ok(calm > 0 && calm < storm && storm <= 1);
}

// The heat haze is still at time 0 and only shimmers by a pixel either way.
{
  for (let row = 0; row < 44; row += 2) assert.equal(hazeShift(row, 0), 0);
  for (let t = 0.1; t < 5; t += 0.37) {
    for (let row = 0; row < 44; row += 2) assert.ok([-1, 0, 1].includes(hazeShift(row, t)));
  }
  assert.ok(Array.isArray(hazeStreaks(1.3)));
}

// The vulture sits at the centre of its circle at time 0 and circles it after.
{
  const still = vultureOrbit(0);
  assert.equal(still.dx, 0);
  assert.equal(still.dy, 0);
  const xs = Array.from({ length: 40 }, (_, i) => vultureOrbit(i * 0.3).dx);
  assert.ok(Math.min(...xs) < -40 && Math.max(...xs) > 40, 'it circles both ways');
  const high = prop('vulture', 600);
  assert.equal(propWallFit(trail([high]), high).centre, -VULTURE_HEIGHT);
  const placed = prop('vulture', 600, { y: 100 });
  assert.equal(propWallFit(trail([placed]), placed).centre, 0);
}

// They are all known prop types.
{
  const types = ['skull', 'tumbleweed', 'car-wreck', 'water-tower', 'windmill', 'heat-haze', 'vulture'];
  const warnings = validateTrail(trail(types.map((type, i) => prop(type, 300 + i * 80))))
    .filter((m) => m.type === 'warning');
  assert.ok(!warnings.some((m) => /unknown type/.test(m.text)), warnings.map((m) => m.text).join('\n'));
}

console.log('Desert tests passed.');
