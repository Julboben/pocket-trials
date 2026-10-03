// The ambient light field: open sky is lit, rock blocks light, caves stay dark
// at any time of day, and ground stays bright by day but darkens with depth
// at night.
import assert from 'node:assert/strict';
import { rectangle, blockTrail } from './lib/terrain-fixtures.mjs';

const { bakeLightField, lightFieldAt } = await import('../js/light-field.js');
const { glareStrength } = await import('../js/lighting.js');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (!condition) { failures++; console.log('FAIL', label, detail); }
  else console.log('ok  ', label);
};

const NOON = { soak: 1400, reach: 190, open: 0.3 };
const NIGHT = { soak: 100, reach: 130, open: 0.45 };

// Ground from y 300 down to 900; a roof over it from x 600 to 1000, closed on
// the right, makes a cave open to the left. A box at x 1100 holds a small
// sealed hollow.
const blocks = [
  rectangle(0, 300, 1400, 900, 'grass', 'ground'),
  rectangle(600, 100, 1000, 200, 'stone', 'roof'),
  rectangle(980, 200, 1000, 300, 'stone', 'wall'),
  rectangle(1100, 150, 1200, 200, 'stone', 'box-top'),
  rectangle(1100, 240, 1200, 300, 'stone', 'box-bottom'),
  rectangle(1100, 200, 1130, 240, 'stone', 'box-left'),
  rectangle(1170, 200, 1200, 240, 'stone', 'box-right'),
];
const trail = blockTrail(blocks);
const noon = bakeLightField(trail, NOON);
const night = bakeLightField(trail, NIGHT);
assert.ok(noon && night, 'a trail with blocks bakes a field');

const at = (field, x, y) => lightFieldAt(field, x, y);
const cover = (field, x, y) => {
  const c = Math.floor((x - field.x) / field.unit), r = Math.floor((y - field.y) / field.unit);
  return field.cover[r * field.width + c];
};

check('open sky is fully lit', at(noon, 200, 200) === 1 && at(night, 200, 200) === 1);
check('outside the field is open sky', at(noon, -5000, 0) === 1 && at(noon, 200, -5000) === 1);
check('the cave mouth is lit', at(noon, 590, 260) > 0.9, at(noon, 590, 260));
check('deep in the cave is dark at noon', at(noon, 950, 260) < 0.15, at(noon, 950, 260));
check('deep in the cave is dark at night', at(night, 950, 260) < 0.15, at(night, 950, 260));
check('the roof blocks the sky', at(noon, 800, 80) === 1 && at(noon, 800, 240) < 0.6, at(noon, 800, 240));
check('ground surface is lit', at(noon, 200, 304) > 0.95 && at(night, 200, 304) > 0.95);
check('deep ground stays bright at noon', at(noon, 200, 800) > 0.6, at(noon, 200, 800));
check('deep ground is dark at night', at(night, 200, 600) < 0.05, at(night, 200, 600));
check('ground darkens with depth at night', at(night, 200, 320) > at(night, 200, 360) && at(night, 200, 360) > at(night, 200, 420));
check('a small sealed hollow is lit like the rock around it', at(noon, 1150, 220) > 0.8, at(noon, 1150, 220));
check('the field is all 0…1', noon.light.every((v) => v >= 0 && v <= 1) && night.light.every((v) => v >= 0 && v <= 1));
check('air never hides lights', cover(noon, 200, 200) === 0 && cover(noon, 800, 260) === 0);
check('rock hides lights below its skin', cover(noon, 200, 400) === 1 && cover(noon, 200, 302) < 0.5);
check('below the terrain is dark at night', at(night, 200, 1000) < 0.05, at(night, 200, 1000));
check('a trail without blocks has no field', bakeLightField(blockTrail([]), NOON) === null && lightFieldAt(null, 0, 0) === 1);

// Open air under a wide floating ledge sees most of the sky, so it stays lit
// by day instead of reading as a cave.
const ledgeTrail = blockTrail([
  rectangle(0, 300, 1400, 900, 'grass', 'ground'),
  rectangle(500, 100, 900, 140, 'stone', 'ledge'),
]);
const ledgeNoon = bakeLightField(ledgeTrail, NOON);
check('air under a floating ledge is lit at noon', at(ledgeNoon, 700, 250) > 0.9 && at(ledgeNoon, 700, 160) > 0.45, `${at(ledgeNoon, 700, 250)} ${at(ledgeNoon, 700, 160)}`);
check('ground under a floating ledge is lit at noon', at(ledgeNoon, 700, 304) > 0.6, at(ledgeNoon, 700, 304));

const sky = (timeOfDay, weather) => glareStrength({ timeOfDay, weather });
check('a bright clear noon sun glares', sky('noon', { sun: 1, clouds: 0.15 }) > 0.9);
check('a cloudy or weak sun does not glare', sky('noon', { sun: 0.7, clouds: 0.35 }) === 0 && sky('noon', { sun: 1, clouds: 1 }) === 0);
check('rain puts the glare out', sky('noon', { sun: 1, clouds: 0.15, rain: 1 }) === 0);
check('the moon never glares', sky('night', { sun: 1, clouds: 0 }) === 0);

// A huge trail is baked coarser rather than with ever more texels.
const wide = bakeLightField(blockTrail([rectangle(0, 300, 60000, 3000, 'grass', 'wide')]), NIGHT);
check('huge trails are baked coarser', wide.unit > 4 && wide.width * wide.height <= 2_500_000, `${wide.unit} ${wide.width}x${wide.height}`);

if (failures) {
  console.log(`\n${failures} lighting check(s) failed`);
  process.exit(1);
}
console.log('\nAll lighting checks passed.');
