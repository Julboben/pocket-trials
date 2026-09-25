import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { terrainCollisionsAt, terrainSweepCollision, pathSegments, seatedSurfaceAt, curveAt, groundShadowSamples } from '../js/terrain.js';
import { sunLight, sunShadowOffset } from '../js/drawing.js';
import { propAlignmentSlope, propDrawAngle, propGroundOffset } from '../js/drawing.js';

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

const hillLevel = {
  points: [[0, 100], [200, 300]],
  gaps: [[140, 180]],
  platforms: [{ points: [[40, 40], [160, 80]], thickness: 30, material: 'rock' }],
  terrain: 'grass',
  fallY: 500
};
const hillMid = curveAt(hillLevel.points, 100);
assert.ok(Math.abs(seatedSurfaceAt(hillLevel, 100, null).slope - hillMid.slope) < 1e-9, 'ground-anchored props sit on the base curve');
assert.equal(seatedSurfaceAt(hillLevel, 160, null), null, 'ground-anchored props inside a gap have no surface');
assert.equal(seatedSurfaceAt(hillLevel, 100, hillMid.y - 40), null, 'a prop floating above the hill stays unseated');
assert.equal(seatedSurfaceAt(hillLevel, 100, hillMid.y)?.y, hillMid.y, 'a prop resting on the hill uses that surface');
const platformY = curveAt(hillLevel.platforms[0].points, 80).y;
assert.equal(seatedSurfaceAt(hillLevel, 80, platformY).platform, hillLevel.platforms[0], 'a prop resting on a platform uses that platform');

const fence = { x: 100, y: null, type: 'fence' };
const tree = { x: 100, y: null, type: 'tree' };
const flowers = { x: 80, y: platformY, type: 'flowers' };
const rock = { x: 80, y: platformY, type: 'rock' };
assert.equal(propAlignmentSlope(hillLevel, tree), 0, 'trees stay upright');
assert.equal(propAlignmentSlope(hillLevel, flowers), 0, 'flowers stay upright');
assert.ok(propAlignmentSlope(hillLevel, fence) > .5, 'fences follow the hill under their footprint');
assert.ok(propAlignmentSlope(hillLevel, rock) > .3, 'rocks follow the platform under their footprint');
assert.equal(propDrawAngle('tree', 1), 0, 'upright props ignore slope when drawn');
assert.equal(propDrawAngle('stump', 1), 0, 'stumps stay upright');
assert.equal(propDrawAngle('crystal', 1), 0, 'crystals stay upright');
assert.ok(Math.abs(propDrawAngle('fence', 1) - Math.atan(1)) < 1e-9, 'fences rotate to the ground angle');

const rolling = JSON.parse(readFileSync(new URL('../levels/official/02-rolling-country.json', import.meta.url)));
const rollingFence = rolling.props.find(prop => prop.type === 'fence');
const rollingTree = rolling.props.find(prop => prop.type === 'tree');
assert.ok(Math.abs(propAlignmentSlope(rolling, rollingFence)) > .2, 'rolling-country fences sit on the hillside');
assert.equal(propAlignmentSlope(rolling, rollingTree), 0, 'rolling-country trees stay upright on the hillside');

const treeBase = propGroundOffset(hillLevel, tree);
const flowerBase = propGroundOffset(hillLevel, flowers);
const floatingTree = propGroundOffset(hillLevel, { x: 100, y: hillMid.y - 40, type: 'tree' });
assert.equal(treeBase(0), 0, 'an upright prop stays planted at its anchor');
assert.ok(treeBase(8) > treeBase(-8), 'tree trunks meet the downhill side of the hill');
assert.ok(flowerBase(6) > flowerBase(-6), 'each flower is planted on the slope under it');
assert.equal(floatingTree(8), 0, 'a floating prop keeps a level base');
assert.ok(propGroundOffset(rolling, rollingTree)(6) !== 0, 'rolling-country trees meet the hillside at the trunk');

const crest = {
  points: [[0, 200], [100, 100], [200, 200]],
  gaps: [[20, 40]],
  platforms: [],
  terrain: 'grass',
  fallY: 400
};
const crestShadow = groundShadowSamples(crest, 100, 80, 30).flat();
const crestCenter = crestShadow.find(sample => sample.x === 100);
const crestEdge = crestShadow.find(sample => sample.x === 70);
assert.ok(crestCenter && crestEdge, 'the shadow is sampled across the crest');
assert.ok(crestEdge.y > crestCenter.y, 'the shadow drops with the ground on either side of a hilltop');
const gapShadow = groundShadowSamples(crest, 50, 100, 40);
assert.equal(gapShadow.flat().some(sample => sample.x > 20 && sample.x < 40), false, 'the shadow does not cross a gap');
assert.equal(gapShadow.length, 2, 'the shadow breaks into the solid ground on either side of a gap');

const slopeShadow = groundShadowSamples(hillLevel, 100, hillMid.y - 20, 24).flat();
assert.ok(slopeShadow.at(-1).y > slopeShadow[0].y, 'the shadow follows a downhill slope');

const noon = sunLight({ width: 400, cameraX: 0, cameraY: 0, weather: { sun: 1, clouds: 0 } });
assert.ok(noon.x > 200, 'the sun sits in the right side of the sky');
assert.equal(sunLight({ width: 400, weather: { sun: 0, clouds: 1 } }).strength, 0, 'a hidden sun casts no sideways light');
const besideSun = sunShadowOffset({ bikeX: 120, bikeY: 280, sunX: noon.x, sunY: noon.y, height: 0, strength: noon.strength });
const airborne = sunShadowOffset({ bikeX: 120, bikeY: 280, sunX: noon.x, sunY: noon.y, height: 400, strength: noon.strength });
assert.ok(besideSun < 0, 'a sun on the right shifts the shadow to the left');
assert.ok(airborne < besideSun, 'jumping shifts the shadow a little farther from the sun');
assert.ok(Math.abs(airborne) <= 14, 'the shadow stays with the rider instead of sliding down the hill');
assert.equal(sunShadowOffset({ bikeX: 120, bikeY: 280, sunX: noon.x, sunY: noon.y, height: 400, strength: 0 }), 0, 'a hidden sun leaves the shadow centered');

const [buried] = terrainCollisionsAt(flatGapLevel, 60, 140, 4);
assert.ok(buried, 'a point buried far below the surface still collides');
assert.ok(Math.abs(buried.nx) < 1e-9 && Math.abs(buried.ny + 1) < 1e-9, 'a buried point is pushed out through the nearest edge, even when it is outside the query radius');
assert.ok(Math.abs(buried.penetration - 44) < 1e-9, 'a buried point reports its full depth');

console.log('Terrain polygon, path, and sweep collision tests passed.');
