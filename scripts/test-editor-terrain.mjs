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

// Mirrors commitShape() in editor.js.
const commitCut = (blocks, points) => {
  const next = blocks.slice();
  let changed = false;
  for (const [index, block] of blocks.entries()) {
    const result = cutBlock(block, points);
    if (result.changed) { next[index] = normalizeBlocks([result.block], 'grass')[0]; changed = true; }
  }
  return { changed, blocks: next };
};

// 1. Drawing a block adds one block and nothing else.
{
  const trail = normalizeTrail(createBlankTrail());
  const before = trail.terrainBlocks.length;
  const block = normalizeBlocks([{ material: 'grass', regions: [{ outer: { nodes: [
    { x: 100, y: 100, edge: 'straight' }, { x: 300, y: 100, edge: 'straight' },
    { x: 300, y: 200, edge: 'straight' }, { x: 100, y: 200, edge: 'straight' },
  ] }, inner: [] }] }], 'grass')[0];
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

// 4. A cut all the way through splits the block into regions of the same block.
{
  const blocks = createBlankTerrainBlocks();
  const { changed, blocks: cut } = commitCut(blocks, [[690, 100], [710, 100], [710, 700], [690, 700]]);
  assert.ok(changed);
  assert.equal(cut.length, 1, 'a split does not create a new block');
  assert.ok(cut[0].regions.length > 1, 'the block now has two regions');
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
  const island = normalizeBlocks([{ material: 'rock', regions: [{ outer: { nodes: [
    { x: 500, y: 380, edge: 'straight' }, { x: 600, y: 380, edge: 'straight' },
    { x: 600, y: 430, edge: 'straight' }, { x: 500, y: 430, edge: 'straight' },
  ] }, inner: [] }] }], 'grass')[0];
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
  const island = normalizeBlocks([{ material: 'rock', regions: [{ outer: { nodes: [
    { x: 300, y: 380, edge: 'straight' }, { x: 420, y: 380, edge: 'straight' },
    { x: 420, y: 430, edge: 'straight' }, { x: 300, y: 430, edge: 'straight' },
  ] }, inner: [] }] }], 'grass')[0];
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

// Mirrors the base-material handler in editor.js: the trail's base changes and
// so does every block still sitting on the old base.
const applyBaseMaterial = (trail, value) => {
  const previous = trail.terrain;
  if (value === previous) return trail;
  const next = trail.terrainBlocks.map(block =>
    block.material === previous ? { ...block, material: value } : block,
  );
  if (!next.some((block, index) => block !== trail.terrainBlocks[index]))
    return { ...trail, terrain: value };
  return { ...trail, terrain: value, terrainBlocks: next };
};

// 8. Changing the base material repaints the ground blocks that use it.
{
  const trail = normalizeTrail({
    ...createBlankTrail(),
    terrain: 'grass',
    terrainBlocks: [
      { ...createBlankTerrainBlocks()[0], id: 'ground', material: 'grass' },
      { ...createBlankTerrainBlocks()[0], id: 'brickwork', material: 'brick' },
    ],
  });
  assert.equal(trail.terrainBlocks[0].material, 'grass', 'the trail starts on grass');

  const sandy = normalizeTrail(applyBaseMaterial(trail, 'sand'));
  assert.equal(sandy.terrain, 'sand', 'the base is the new material');
  assert.equal(sandy.terrainBlocks[0].material, 'sand', 'a block on the old base follows it');
  assert.equal(sandy.terrainBlocks[1].material, 'brick', 'a block set to brick keeps it');
  assert.equal(trail.terrainBlocks[0].material, 'grass', 'the original trail is untouched');

  // A trail with no blocks still changes its base, so new blocks pick it up.
  const bare = normalizeTrail(applyBaseMaterial(normalizeTrail({ ...createBlankTrail(), terrainBlocks: [] }), 'snow'));
  assert.equal(bare.terrain, 'snow', 'a blockless trail still takes the new base');
  assert.equal((bare.terrainBlocks || []).length, 0, 'and gains no blocks');
}

console.log('Editor terrain logic tests passed.');
