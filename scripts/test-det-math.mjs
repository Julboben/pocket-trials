import assert from 'node:assert/strict';
import * as det from '../js/det-math.js';

// Relative error in units of the last place of the reference value.
function ulps(actual, expected) {
  if (Object.is(actual, expected)) return 0;
  const spacing = Math.max(Number.MIN_VALUE, Math.abs(expected) * Number.EPSILON);
  return Math.abs(actual - expected) / spacing;
}

let seed = 7;
const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const samples = (count, low, high) => Array.from({ length: count }, () => low + (high - low) * random());

const cases = [
  ['sin', x => det.sin(x), Math.sin, samples(50000, -60, 60), 2],
  ['cos', x => det.cos(x), Math.cos, samples(50000, -60, 60), 2],
  ['exp', x => det.exp(x), Math.exp, samples(50000, -40, 40), 2],
  ['log', x => det.log(x), Math.log, samples(50000, 1e-6, 1e4), 2],
  ['atan', x => det.atan(x), Math.atan, samples(50000, -50, 50), 2],
  ['acos', x => det.acos(x), Math.acos, samples(50000, -1, 1), 4]
];
for (const [name, actual, expected, inputs, limit] of cases) {
  let worst = 0;
  for (const x of inputs) worst = Math.max(worst, ulps(actual(x), expected(x)));
  assert.ok(worst <= limit, `${name} within ${limit} ulp (worst ${worst.toFixed(2)})`);
}
{
  let worst = 0;
  for (let index = 0; index < 50000; index++) {
    const y = (random() - .5) * 100, x = (random() - .5) * 100;
    // atan2 near ±pi is compared by absolute error: its ulp there is large.
    worst = Math.max(worst, Math.abs(det.atan2(y, x) - Math.atan2(y, x)) / Number.EPSILON);
  }
  assert.ok(worst <= 4, `atan2 within 4 eps (worst ${worst.toFixed(2)})`);
}
{
  let worst = 0;
  for (let index = 0; index < 20000; index++) {
    const base = random() * 3, exponent = (random() - .5) * 8;
    worst = Math.max(worst, ulps(det.pow(base, exponent), Math.pow(base, exponent)));
  }
  assert.ok(worst <= 64, `pow within 64 ulp (worst ${worst.toFixed(2)})`);
}

// Special values.
assert.equal(det.sin(0), 0);
assert.equal(det.cos(0), 1);
assert.equal(det.exp(0), 1);
assert.equal(det.log(1), 0);
assert.equal(det.atan2(0, 1), 0);
assert.equal(det.atan2(0, -1), Math.PI);
assert.equal(det.atan2(1, 0), Math.PI / 2);
assert.equal(det.atan2(-1, 0), -Math.PI / 2);
assert.ok(Math.abs(det.atan2(-1e-300, -1) + Math.PI) < 1e-15);
assert.ok(Number.isNaN(det.sin(Infinity)) && Number.isNaN(det.log(-1)) && Number.isNaN(det.acos(2)));
assert.equal(det.exp(-1000), 0);
assert.equal(det.exp(1000), Infinity);
assert.equal(det.hypot(3, 4), 5);
assert.equal(det.pow(2, 0), 1);

console.log('Deterministic math tests passed.');
