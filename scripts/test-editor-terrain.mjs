// Exercises the editor's terrain logic headlessly, without a browser, by
// reimplementing only the pure decisions it makes. This catches the mistakes
// that syntax checking cannot: a cut that changes the wrong block, a move that
// drops a cave, a material change that misses a block.
import assert from 'node:assert/strict';
import {
  normalizeTrail, createBlankTrail, createBlankTerrainBlocks, trailTerrainBlocks,
} from '../js/trail-schema.js';
import { cutBlock, moveBlock, pointInRegion, regionArea, normalizeBlocks } from '../js/terrain-geometry.js';
import { compileTerrain, terrainSolidAt, terrainSurfaceBelow, terrainContacts } from '../js/terrain-runtime.js';
import { RADIUS } from '../js/config.js';

// Mirrors commitShape() in js/editor/blocks.js: each block a cut changes is
// replaced in place by its pieces, the largest first.
const commitCut = (blocks, points) => {
  let changed = false;
  const next = blocks.flatMap(block => {
    const result = cutBlock(block, points);
    if (!result.changed) return [block];
    changed = true;
    return normalizeBlocks(result.blocks, 'grass');
  });
  return { changed, blocks: next };
};

// 1. Drawing a block adds one block and nothing else.
{
  const trail = normalizeTrail(createBlankTrail());
  const before = trail.terrainBlocks.length;
  const block = normalizeBlocks([{ material: 'grass', outer: { nodes: [
    { x: 100, y: 100, edge: 'straight' }, { x: 300, y: 100, edge: 'straight' },
    { x: 300, y: 200, edge: 'straight' }, { x: 100, y: 200, edge: 'straight' },
  ] }, inner: [] }], 'grass')[0];
  trail.terrainBlocks = [...trail.terrainBlocks, block];
  assert.equal(trail.terrainBlocks.length, before + 1);
  const terrain = compileTerrain({ terrainBlocks: trailTerrainBlocks(trail) });
  assert.ok(terrainSolidAt(terrain, 200, 150), 'the new block is solid');
}

// 2. A cut inside solid opens a cave; the block stays one block.
{
  const trail = normalizeTrail(createBlankTrail());
  const { changed, blocks } = commitCut(trail.terrainBlocks, [[400, 340], [700, 340], [700, 460], [400, 460]]);
  assert.ok(changed, 'the cut changes the block');
  assert.equal(blocks.length, 1, 'a cave does not create a new block');
  const terrain = compileTerrain({ terrainBlocks: blocks });
  assert.ok(!terrainSolidAt(terrain, 550, 400), 'the cave is empty');
  assert.ok(terrainSolidAt(terrain, 550, 330), 'the cave roof is solid');
  assert.equal(terrainSurfaceBelow(terrain, 550, 420)?.y, 460, 'the cave floor is where a query lands');
}

// 3. A cut across an edge opens an entrance rather than making a hole.
{
  const blocks = createBlankTerrainBlocks();
  const { changed, blocks: cut } = commitCut(blocks, [[-60, 340], [200, 340], [200, 460], [-60, 460]]);
  assert.ok(changed);
  assert.equal(cut.length, 1);
  const terrain = compileTerrain({ terrainBlocks: cut });
  assert.ok(!terrainSolidAt(terrain, 50, 400), 'the entrance is open');
  assert.ok(terrainSolidAt(terrain, 900, 400), 'the rest of the block is untouched');
}

// 4. A cut all the way through leaves each piece as a block of its own; the
//    largest keeps the original block's id.
{
  const blocks = createBlankTerrainBlocks();
  const { changed, blocks: cut } = commitCut(blocks, [[690, 100], [710, 100], [710, 700], [690, 700]]);
  assert.ok(changed);
  assert.equal(cut.length, 2, 'a split makes two blocks');
  assert.equal(cut[0].id, blocks[0].id, 'the largest piece keeps the id');
  assert.notEqual(cut[1].id, blocks[0].id, 'the other piece gets its own id');
  const terrain = compileTerrain({ terrainBlocks: cut });
  assert.ok(terrainSolidAt(terrain, 400, 400) && terrainSolidAt(terrain, 1000, 400), 'both sides are solid');
  assert.ok(!terrainSolidAt(terrain, 700, 400), 'the split is a gap');
}

// 5. A cut that misses the blocks changes nothing and reports why.
{
  const blocks = createBlankTerrainBlocks();
  const { changed } = commitCut(blocks, [[5000, 5000], [5100, 5000], [5100, 5100]]);
  assert.equal(changed, false, 'a cut far from any block is refused');
}

// 6. Moving a block carries its caves with it, and leaves other blocks alone.
{
  const host = createBlankTerrainBlocks()[0];
  const { blocks } = commitCut([host], [[400, 340], [700, 340], [700, 460], [400, 460]]);
  const island = normalizeBlocks([{ material: 'rock', outer: { nodes: [
    { x: 500, y: 380, edge: 'straight' }, { x: 600, y: 380, edge: 'straight' },
    { x: 600, y: 430, edge: 'straight' }, { x: 500, y: 430, edge: 'straight' },
  ] }, inner: [] }], 'grass')[0];
  const before = compileTerrain({ terrainBlocks: [...blocks, island] });
  assert.ok(terrainSolidAt(before, 550, 400), 'the island is solid inside the cave');

  const movedHost = moveBlock(blocks[0], 0, -200);
  const after = compileTerrain({ terrainBlocks: [movedHost, island] });
  // The host moved up 200, so its top is near 110 and its cave is now 140 to
  // 260; the rock above the cave is 110 to 140 and below it 260 to 380.
  assert.ok(terrainSolidAt(after, 550, 125), 'the moved block is solid at its new height');
  assert.ok(!terrainSolidAt(after, 550, 200), 'the moved cave came with it');
  assert.ok(terrainSolidAt(after, 550, 300), 'the rock below the moved cave is solid');
  assert.ok(terrainSolidAt(after, 550, 400), 'the island stayed where it was');
}

// 7. A nested block in a cave is solid and no internal edge appears.
{
  const host = createBlankTerrainBlocks()[0];
  const { blocks } = commitCut([host], [[400, 340], [700, 340], [700, 460], [400, 460]]);
  const island = normalizeBlocks([{ material: 'rock', outer: { nodes: [
    { x: 300, y: 380, edge: 'straight' }, { x: 420, y: 380, edge: 'straight' },
    { x: 420, y: 430, edge: 'straight' }, { x: 300, y: 430, edge: 'straight' },
  ] }, inner: [] }], 'grass')[0];
  // The island straddles the cave's left wall, filling part of it.
  const terrain = compileTerrain({ terrainBlocks: [...blocks, island] });
  assert.ok(terrainSolidAt(terrain, 380, 405), 'the overlapping island is solid');
  assert.ok(terrainSolidAt(terrain, 410, 405), 'the island fills the cave wall it overlaps');
  assert.ok(!terrainSolidAt(terrain, 500, 400), 'the rest of the cave is still open');
  // The cave wall under the island is an internal seam and must not collide,
  // but the island's own face on the open side is a real surface.
  const deep = terrainContacts(terrain, 405, 405, 4);
  assert.ok(
    deep.every(contact => contact.pointX !== 400),
    'the buried cave wall produces no contact',
  );
  assert.ok(
    terrainContacts(terrain, 410, 405, 4).some(contact => contact.pointX === 420 && contact.nx > 0.5),
    "the island's open face pushes a body out of the island",
  );
}

console.log('Editor terrain logic tests passed.');
