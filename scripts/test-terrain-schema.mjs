// The trail schema's terrain: blank trails, caves, normalization, malformed
// blocks, and the gameplay identity.
//
// Objects, spikes and the remaining validation are covered by
// test-trail-schema.mjs.
import assert from 'node:assert/strict';
import {
  createBlankTrail, normalizeTrail, validateTrail, trailTerrainBlocks,
  surfaceBelow, createBlankTerrainBlocks,
} from '../js/trail-schema.js';
import { trailHash } from '../js/trail-hash.js';
import { terrainSolidAt, terrainSurfaceBelow, compileTerrain } from '../js/terrain-runtime.js';
import { cutBlock } from '../js/terrain-geometry.js';

const errors = trail => validateTrail(trail).filter(m => m.type === 'error').map(m => m.text);

// A blank trail starts with one ground block and validates.
{
  const trail = normalizeTrail(createBlankTrail());
  assert.equal(trail.terrainBlocks.length, 1, 'a blank trail starts with a ground block');
  assert.deepEqual(errors(trail), [], 'a blank trail validates');

  const terrain = compileTerrain({ terrainBlocks: trailTerrainBlocks(trail) });
  assert.ok(terrainSolidAt(terrain, 600, 400), 'the block is solid');
  assert.ok(!terrainSolidAt(terrain, 600, 100), 'the air above the block is empty');
  assert.ok(surfaceBelow(trail, 600, null)?.y > 200, 'a surface query finds the block top');
}

// A trail without blocks has no terrain and is refused.
{
  const trail = normalizeTrail({ ...createBlankTrail(), terrainBlocks: [] });
  assert.ok(errors(trail).some(text => text.includes('needs terrain')), 'a trail with no blocks is an error');
}

// A block-only trail can be carved into a cave, and the queries are cave-aware.
{
  const blocks = createBlankTerrainBlocks({ terrain: 'grass' });
  const holed = cutBlock(blocks[0], [[400, 340], [700, 340], [700, 460], [400, 460]]);
  assert.ok(holed.changed, 'a cut carves a cave');
  const trail = normalizeTrail({ ...createBlankTrail(), terrainBlocks: [holed.block] });
  assert.deepEqual(errors(trail), [], 'a cave validates');

  const terrain = compileTerrain({ terrainBlocks: trailTerrainBlocks(trail) });
  // At x=550 the block's top edge is near y=310 and the cave runs 340 to 460.
  assert.ok(!terrainSolidAt(terrain, 550, 290), 'the air above the cave roof is empty');
  assert.ok(terrainSolidAt(terrain, 550, 330), 'the cave roof is solid');
  assert.ok(!terrainSolidAt(terrain, 550, 400), 'the cave interior is empty');
  assert.ok(terrainSolidAt(terrain, 550, 470), 'the cave floor is solid');
  assert.equal(terrainSurfaceBelow(terrain, 550, 420)?.y, 460, 'a query in the cave finds the cave floor');
  assert.ok(terrainSurfaceBelow(terrain, 550, 100)?.y < 320, 'a query above the cave finds the top');
}

// Normalization is idempotent.
{
  const once = normalizeTrail({
    ...createBlankTrail(),
    terrainBlocks: createBlankTerrainBlocks({ terrain: 'rock' }),
  });
  const twice = normalizeTrail(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once, 'block-only normalization is idempotent');
}

// Malformed blocks are rejected rather than silently loaded.
{
  const degenerate = normalizeTrail({
    ...createBlankTrail(),
    terrainBlocks: [{
      material: 'grass',
      regions: [{ outer: { nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }, inner: [] }],
    }],
  });
  assert.ok(
    errors(degenerate).some(text => text.includes('encloses no area') || text.includes('coincident')),
    'a degenerate block is an error',
  );
}

// The gameplay identity follows block geometry, and follows the physics version.
{
  const trail = normalizeTrail({
    ...createBlankTrail(),
    terrainBlocks: createBlankTerrainBlocks(),
  });
  const moved = JSON.parse(JSON.stringify(trail));
  moved.terrainBlocks[0].regions[0].outer.nodes[1].x = 500;
  const other = normalizeTrail(moved);

  assert.equal(trailHash(trail), trailHash(normalizeTrail({ ...trail, name: 'Other' })), 'renaming keeps the identity');
  assert.notEqual(trailHash(trail), trailHash(other), 'moving a node changes the identity');
  assert.equal(trailHash(trail), trailHash(normalizeTrail({ ...trail })), 're-saving keeps the identity');
  assert.match(trailHash(trail), /^[0-9a-f]{8}$/);
}

console.log('Block trail schema tests passed.');
