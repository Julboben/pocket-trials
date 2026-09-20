import assert from 'node:assert/strict';
import { terrainCollisionsAt } from '../js/terrain.js';

const flatGapLevel = {
  points: [[0, 100], [300, 100]],
  gaps: [[100, 200]],
  platforms: [],
  terrain: 'grass',
  fallY: 300
};
const radius = 12;

assert.equal(terrainCollisionsAt(flatGapLevel, 150, 90, radius).length, 0, 'unified terrain geometry leaves the gap open');
assert.ok(terrainCollisionsAt(flatGapLevel, 104, 130, radius).some(contact => contact.kind === 'ground'), 'unified terrain geometry includes the gap wall');

const tracedLevel = {
  points: [[920, 300], [1148.5430174715298, 246.67341209254306], [1158.5430174715298, 343.0070624265984], [1367.8132433826686, 409.877498201282]],
  gaps: [],
  platforms: [],
  terrain: 'grass',
  fallY: 620
};

for (const [x, y] of [[1148.536, 258.237], [1149.694, 267.09], [1136.074, 277.169], [1124.068, 286.557]]) {
  const contact = terrainCollisionsAt(tracedLevel, x, y, radius)[0];
  assert.ok(contact, 'the steep terrain must remain collidable');
  assert.ok(contact.nx > .9, 'steep contact must push primarily sideways along the actual terrain boundary');
  assert.ok(Math.abs(contact.ny * contact.penetration) < 3, 'steep contact must not snap the wheel upward');
}

console.log('Terrain collision tests passed.');
