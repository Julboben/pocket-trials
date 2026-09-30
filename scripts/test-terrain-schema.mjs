// The level schema's block half: blocks coexisting with legacy terrain, being
// cleared to leave a block-only level, and feeding the gameplay identity.
//
// The legacy half of the schema is covered by test-level-schema.mjs.
import assert from 'node:assert/strict';
import {
  createBlankLevel, normalizeLevel, validateLevel, clearLegacyTerrain,
  levelTerrain, levelTerrainBlocks, surfaceBelow, hasLegacyTerrain,
  createBlankTerrainBlocks, TERRAIN_FORMAT_VERSION,
} from '../js/level-schema.js';
import { levelHash } from '../js/level-hash.js';
import { terrainSolidAt, terrainSurfaceBelow, compileTerrain } from '../js/terrain-runtime.js';
import { cutBlock } from '../js/terrain-geometry.js';

const errors = level => validateLevel(level).filter(m => m.type === 'error').map(m => m.text);

// A blank level is unchanged: it still has legacy ground and no blocks.
{
  const level = normalizeLevel(createBlankLevel());
  assert.ok(Array.isArray(level.points), 'a blank level keeps its legacy ground');
  assert.equal(level.terrainBlocks.length, 0, 'a blank level has no blocks yet');
  assert.deepEqual(errors(level), []);
  assert.equal(level.terrainVersion, 1, 'a level with no blocks is still version 1');
}

// Clearing the legacy terrain leaves a block-only level that still validates.
{
  const level = normalizeLevel(clearLegacyTerrain({
    ...createBlankLevel(),
    terrainBlocks: createBlankTerrainBlocks({ terrain: 'grass' }),
  }));
  assert.equal(level.points, undefined, 'cleared terrain drops the ground line');
  assert.equal(level.platforms, undefined, 'cleared terrain drops platforms');
  assert.equal(level.paths, undefined, 'cleared terrain drops paths');
  assert.equal(level.terrainBlocks.length, 1, 'cleared terrain keeps the blocks');
  assert.equal(level.terrainVersion, TERRAIN_FORMAT_VERSION, 'a block-only level is version 2');
  assert.deepEqual(errors(level), [], 'a block-only level validates');
  assert.equal(hasLegacyTerrain(level), false);

  const terrain = compileTerrain({ terrainBlocks: levelTerrain(level) });
  assert.ok(terrainSolidAt(terrain, 600, 400), 'the block is solid');
  assert.ok(!terrainSolidAt(terrain, 600, 100), 'the air above the block is empty');
  assert.ok(surfaceBelow(level, 600, null)?.y > 200, 'a surface query finds the block top');
}

// A block-only level can be carved into a cave, and the queries are cave-aware.
{
  const blocks = createBlankTerrainBlocks({ terrain: 'grass' });
  const holed = cutBlock(blocks[0], [[400, 340], [700, 340], [700, 460], [400, 460]]);
  assert.ok(holed.changed, 'a cut carves a cave');
  const level = normalizeLevel(clearLegacyTerrain({ ...createBlankLevel(), terrainBlocks: [holed.block] }));
  assert.deepEqual(errors(level), [], 'a cave validates');

  const terrain = compileTerrain({ terrainBlocks: levelTerrain(level) });
  // At x=550 the block's top edge is near y=310 and the cave runs 340 to 460.
  assert.ok(!terrainSolidAt(terrain, 550, 290), 'the air above the cave roof is empty');
  assert.ok(terrainSolidAt(terrain, 550, 330), 'the cave roof is solid');
  assert.ok(!terrainSolidAt(terrain, 550, 400), 'the cave interior is empty');
  assert.ok(terrainSolidAt(terrain, 550, 470), 'the cave floor is solid');
  assert.equal(terrainSurfaceBelow(terrain, 550, 420)?.y, 460, 'a query in the cave finds the cave floor');
  assert.ok(terrainSurfaceBelow(terrain, 550, 100)?.y < 320, 'a query above the cave finds the top');
}

// Blocks and legacy terrain coexist, which is what a half-rebuilt level needs.
{
  const level = normalizeLevel({
    ...createBlankLevel(),
    points: [[0, 700], [1600, 700]],
    terrainBlocks: createBlankTerrainBlocks({ terrain: 'grass' }),
  });
  assert.ok(Array.isArray(level.points), 'mixed terrain keeps the legacy ground');
  assert.equal(level.terrainBlocks.length, 1, 'mixed terrain keeps the blocks');
  assert.deepEqual(errors(level), [], 'mixed terrain validates');
  const terrain = compileTerrain({ terrainBlocks: levelTerrain(level) });
  assert.ok(terrainSolidAt(terrain, 1000, 750), 'the legacy ground is still solid');
  assert.ok(terrainSolidAt(terrain, 600, 400), 'the block is still solid');
}

// Normalization is idempotent, and clearing twice changes nothing.
{
  const once = normalizeLevel(clearLegacyTerrain({
    ...createBlankLevel(),
    terrainBlocks: createBlankTerrainBlocks({ terrain: 'rock' }),
  }));
  const twice = normalizeLevel(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once, 'block-only normalization is idempotent');
  assert.deepEqual(normalizeLevel(clearLegacyTerrain(twice)), once, 'clearing twice changes nothing');
}

// Malformed blocks are rejected rather than silently loaded.
{
  const degenerate = normalizeLevel(clearLegacyTerrain({
    ...createBlankLevel(),
    terrainBlocks: [{
      material: 'grass',
      regions: [{ outer: { nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }, inner: [] }],
    }],
  }));
  assert.ok(
    errors(degenerate).some(text => text.includes('encloses no area') || text.includes('coincident')),
    'a degenerate block is an error',
  );
}

// The gameplay identity follows block geometry, and follows the physics version.
{
  const level = normalizeLevel(clearLegacyTerrain({
    ...createBlankLevel(),
    terrainBlocks: createBlankTerrainBlocks(),
  }));
  const moved = JSON.parse(JSON.stringify(level));
  moved.terrainBlocks[0].regions[0].outer.nodes[1].x = 500;
  const other = normalizeLevel(clearLegacyTerrain(moved));

  assert.equal(levelHash(level), levelHash(normalizeLevel({ ...level, name: 'Other' })), 'renaming keeps the identity');
  assert.notEqual(levelHash(level), levelHash(other), 'moving a node changes the identity');
  assert.equal(levelHash(level), levelHash(normalizeLevel(clearLegacyTerrain({ ...level }))), 're-saving keeps the identity');
  assert.match(levelHash(level), /^[0-9a-f]{8}$/);
}

console.log('Block level schema tests passed.');
