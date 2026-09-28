// The runtime half of the unified terrain, reached the way the game reaches it:
// through terrain.js, which every existing consumer already calls.
import assert from 'node:assert/strict';
import { normalizeLevel } from '../js/level-schema.js';
import {
  terrainCollisionsAt, terrainSweepCollision, terrainAt, terrainSurfacesAt,
  groundShadowSamples, invalidateTerrain,
} from '../js/terrain.js';
import { RADIUS } from '../js/config.js';
import { cutBlock } from '../js/terrain-geometry.js';
import { SPIRAL_NODES, polygonBlock, rectangle, blockLevel, legacyLevel } from './lib/terrain-fixtures.mjs';

const spiral = () => polygonBlock(SPIRAL_NODES, 'grass', 'spiral');

// Legacy ground with a block drawn above it.
{
  const level = normalizeLevel(legacyLevel({ terrainBlocks: [spiral()] }));
  assert.equal(level.terrainBlocks.length, 1, 'the level has one block');
  assert.ok(Array.isArray(level.points), 'and still its legacy ground');

  const blockTop = terrainAt(level, 450, -1000);
  assert.ok(blockTop.solid, 'the block is solid where it was drawn');
  assert.ok(blockTop.y < 0, `the block is above the old ground (top at ${blockTop.y})`);

  const ground = terrainAt(level, 150, 300);
  assert.ok(ground.solid && Math.abs(ground.y - 320) < 4, `the old ground is still solid (${ground.y})`);

  const contact = terrainCollisionsAt(level, 560, terrainAt(level, 560, -1000).y - RADIUS + 4, RADIUS)[0];
  assert.ok(contact, 'a wheel resting on the block collides');
  assert.ok(contact.ny < -0.5, `and is pushed up out of it (ny ${contact.ny})`);
  assert.equal(contact.material, 'grass', 'the contact carries the block material');

  const sweep = terrainSweepCollision(level, 560, -400, 560, -200, RADIUS);
  assert.ok(sweep && sweep.ny < -0.5, 'a fast drop sweeps into the block and is stopped by it');

  assert.equal(terrainCollisionsAt(level, 1400, -600, RADIUS).length, 0, 'open air has no contact');
  const buried = terrainCollisionsAt(level, 200, 330, RADIUS)[0];
  assert.ok(buried && buried.ny < -0.5, `the old ground still pushes a body up out of it (${buried?.ny})`);

  const surfaces = terrainSurfacesAt(level, 560);
  assert.ok(surfaces.some(surface => surface.y < 0), 'the block contributes surfaces');
  assert.ok(surfaces.some(surface => surface.y > 200), 'and so does the ground below it');
  const shadow = groundShadowSamples(level, 560, -1000, 40, 2);
  assert.ok(shadow.flat().length > 0 && shadow.flat().every(sample => sample.y < 0), 'the shadow follows the block, not the ground');
}

// The spiral on its own, ridden from inside its pocket. The peak overhangs the
// rider there, so anything anchored to "the ground" must look below the rider
// rather than at the topmost surface.
{
  const level = normalizeLevel(blockLevel([spiral()], { start: { x: 500, y: -73, facing: 1 } }));
  assert.equal(level.points, undefined, 'the trail has no ground line');
  const peak = terrainAt(level, 500, null);
  assert.ok(peak.solid && peak.y < -150, `the topmost surface at x 500 is the peak (${peak.y})`);
  const floor = terrainAt(level, 500, -80);
  assert.ok(floor.solid && floor.y > -60 && floor.y < -30, `below the rider is the pocket floor (${floor.y})`);
  assert.equal(terrainCollisionsAt(level, 500, -80, RADIUS).length, 0, 'the rider in the pocket touches nothing');
  const resting = terrainCollisionsAt(level, 500, floor.y - RADIUS + 3, RADIUS);
  assert.equal(resting.length, 1, 'a wheel on the pocket floor has one contact');
  assert.ok(resting[0].ny < -0.9, 'pointing up');
  assert.equal(terrainCollisionsAt(level, 1400, 400, RADIUS).length, 0, 'empty space is empty');
}

// A cave cut into a block: floor, roof, and nothing touching a rider inside.
{
  const carved = cutBlock(rectangle(0, 300, 800, 600), [[300, 350], [500, 350], [500, 450], [300, 450]]);
  assert.ok(carved.changed && carved.block.regions[0].inner.length === 1, 'the cut becomes an inner boundary');
  const level = normalizeLevel(blockLevel([carved.block]));
  const floor = terrainAt(level, 400, 400);
  assert.ok(Math.abs(floor.y - 450) < 2, `the cave floor is found (${floor.y})`);
  assert.equal(terrainCollisionsAt(level, 400, 400, RADIUS).length, 0, 'a rider inside the cave has no contact');
  assert.ok(terrainCollisionsAt(level, 400, 358, RADIUS)[0]?.ny > 0.5, 'the cave roof pushes it down');
  assert.ok(terrainCollisionsAt(level, 400, 290, RADIUS)[0]?.ny < -0.5, 'while the block top still holds it up');
}

// Two overlapping blocks ride as one: the seam between them has no edge.
{
  const level = normalizeLevel(blockLevel([rectangle(0, 300, 500, 600, 'grass', 'a'), rectangle(400, 300, 900, 600, 'rock', 'b')]));
  const seam = terrainCollisionsAt(level, 450, 300 - RADIUS + 3, RADIUS);
  assert.equal(seam.length, 1, 'a wheel on the seam has one contact');
  assert.ok(seam[0].ny < -0.99, `and it points straight up (${seam[0].ny})`);
  assert.equal(terrainAt(level, 450, null).material, 'rock', 'the later block shows on top');
  assert.equal(terrainCollisionsAt(level, 450, 450, RADIUS).length, 1, 'a body deep inside is pushed to the nearest surface');
}

// A level with no blocks rides exactly as before.
{
  const legacy = normalizeLevel(legacyLevel());
  assert.equal(legacy.terrainBlocks.length, 0, 'the level really has no blocks');
  const surface = terrainAt(legacy, 150, null);
  assert.ok(surface.solid && Math.abs(surface.y - 320) < 1, `the legacy ground is solid at its height (${surface.y})`);
  assert.ok(terrainCollisionsAt(legacy, 150, surface.y - RADIUS + 4, RADIUS)[0]?.ny < -0.5, 'and collides');
  assert.equal(terrainCollisionsAt(legacy, 150, -900, RADIUS).length, 0, 'with open air above it');
  assert.equal(terrainAt(legacy, 1040, null).solid, false, 'and its gap is open');
}

// Editing a level in place and invalidating it recompiles its terrain.
{
  const level = normalizeLevel(blockLevel([rectangle(0, 300, 800, 600)]));
  assert.equal(terrainAt(level, 400, null).y, 300);
  for (const node of level.terrainBlocks[0].regions[0].outer.nodes) node.y -= 50;
  invalidateTerrain(level);
  assert.equal(terrainAt(level, 400, null).y, 250, 'an invalidated level recompiles its terrain');
}

console.log('Runtime terrain integration tests passed.');
