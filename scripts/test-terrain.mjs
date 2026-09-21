import assert from 'node:assert/strict';
import { terrainCollisionsAt, terrainSweepCollision, pathSegments } from '../js/terrain.js';

const flatGapLevel = {
  points: [[0, 100], [300, 100]],
  gaps: [[100, 200]],
  platforms: [],
  terrain: 'grass',
  fallY: 300
};
const radius = 12;

assert.equal(terrainCollisionsAt(flatGapLevel, 150, 90, radius).length, 0, 'unified terrain geometry leaves the gap open');
assert.ok(terrainCollisionsAt(flatGapLevel, 104, 130, radius).some(contact => contact.kind === 'ground'), 'unified terrain geometry includes the left gap wall');
assert.ok(terrainCollisionsAt(flatGapLevel, 196, 130, radius).some(contact => contact.kind === 'ground'), 'unified terrain geometry includes the right gap wall');

const platformLevel = {
  points: [[0, 500], [400, 500]], gaps: [], terrain: 'grass', fallY: 700,
  platforms: [{ points: [[100, 200], [240, 200]], thickness: 40, material: 'rock' }]
};
assert.ok(terrainCollisionsAt(platformLevel, 170, 190, radius).some(contact => contact.kind === 'platform' && contact.ny < 0), 'platform top must collide');
assert.ok(terrainCollisionsAt(platformLevel, 90, 220, radius).some(contact => contact.kind === 'platform' && contact.nx < 0), 'platform side must collide');
assert.ok(terrainCollisionsAt(platformLevel, 170, 248, radius).some(contact => contact.kind === 'platform' && contact.ny > 0), 'platform underside must collide');
assert.ok(terrainCollisionsAt(platformLevel, 94, 194, radius).some(contact => contact.kind === 'platform'), 'platform corner must collide');
assert.ok(terrainSweepCollision(platformLevel, 170, 100, 170, 280, radius)?.kind === 'platform', 'maximum-speed approach must sweep into a platform');

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

const pathLevel = {
  ...flatGapLevel,
  points: [[0, 500], [300, 500]],
  fallY: 700,
  gaps: [],
  paths: [{
    points: [[40, 200], [100, 140], [160, 200], [100, 260]],
    closed: true,
    thickness: 20,
    material: 'rock'
  }]
};
assert.equal(pathSegments(pathLevel.paths[0]).length, 4, 'closed paths connect their final point to their first');
assert.ok(terrainCollisionsAt(pathLevel, 100, 128, 4).some(contact => contact.kind === 'path'), 'closed path outer boundary must collide');
assert.equal(terrainCollisionsAt(pathLevel, 100, 200, 4).filter(contact => contact.kind === 'path').length, 0, 'closed path center remains empty');
assert.ok(terrainSweepCollision(pathLevel, 100, 100, 100, 180, 4)?.kind === 'path', 'sweep must stop a fast circle at a thin authored path');

const overhangLevel = {
  ...flatGapLevel,
  points: [[0, 500], [300, 500]],
  fallY: 700,
  paths: [{ points: [[250, 180], [210, 130], [250, 80]], closed: false, thickness: 16, material: 'grass' }]
};
assert.ok(terrainCollisionsAt(overhangLevel, 208, 130, 6).some(contact => contact.kind === 'path'), 'paths may move backward along x');
assert.ok(terrainCollisionsAt(overhangLevel, 250, 70, 6).some(contact => contact.kind === 'path'), 'open path endpoints have solid caps');

console.log('Terrain polygon, path, and sweep collision tests passed.');
