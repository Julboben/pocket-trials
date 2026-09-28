// The terrain renderer: block art is rasterised from the same compiled union
// that physics collides with, so these check the pixels against the physics,
// and the chunk cache against a stub canvas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDom, createContextStub, installGlobals } from './lib/editor-harness.mjs';
import { SPIRAL_NODES, polygonBlock, rectangle, blockLevel, legacyLevel } from './lib/terrain-fixtures.mjs';

const html = readFileSync(new URL('../editor.html', import.meta.url), 'utf8');
let failures = 0;
const check = (label, condition, detail = '') => {
  if (!condition) { failures++; console.log('FAIL', label, detail); }
  else console.log('ok  ', label);
};

buildDom(html);
const dom = installGlobals();
for (const match of html.matchAll(/\bid="([^"]+)"/g)) dom.element(match[1]);
const context = createContextStub();
// The legacy renderer quantizes through getImageData, so a stub has to report
// pixels that survive the palette step, or every chunk is discarded as null.
const pixels = new Uint8ClampedArray(4 * 256 * 256).fill(128);
context.getImageData = () => ({ data: pixels });
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() { return context; }
};
globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };

const { createTerrainRenderer, rasterizeTerrainChunk } = await import('../js/terrain-render.js');
const { normalizeLevel } = await import('../js/level-schema.js');
const { terrainGeometry, invalidateTerrain, terrainAt } = await import('../js/terrain.js');
const { terrainSolidAt } = await import('../js/terrain-runtime.js');
const { terrainMaterials } = await import('../js/materials.js');
const { cutBlock } = await import('../js/terrain-geometry.js');
const { compositeColor } = await import('../js/drawing.js');

const rgb = color => compositeColor(color, '#000000').join(',');
const pixelAt = (raster, left, top, x, y) => {
  const column = Math.floor((x - left) / 2), row = Math.floor((y - top) / 2);
  const offset = (row * raster.width + column) * 4;
  return raster.data[offset + 3] ? [...raster.data.slice(offset, offset + 3)].join(',') : null;
};

// 1. The spiral from the orchard copy, which drew floating grass bars and
// rims on its undersides in the game before the rasteriser.
{
  const level = normalizeLevel(blockLevel([polygonBlock(SPIRAL_NODES)]));
  const compiled = terrainGeometry(level);
  const left = 200, top = -320, width = 280, height = 240;
  const raster = rasterizeTerrainChunk(compiled, left, top, width, height);
  check('the spiral rasterises', raster.opaque);

  let uncovered = 0, stray = 0;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const x = left + column * 2 + 1, y = top + row * 2 + 1;
      const drawn = raster.data[(row * width + column) * 4 + 3] > 0;
      const solid = terrainSolidAt(compiled, x, y);
      // A pixel centre exactly on the outline is on the boundary either way.
      const onOutline = terrainSolidAt(compiled, x, y - 0.01) !== terrainSolidAt(compiled, x, y + 0.01)
        || terrainSolidAt(compiled, x - 0.01, y) !== terrainSolidAt(compiled, x + 0.01, y);
      if (solid && !drawn && !onOutline) uncovered++;
      // Art outside the solid is only the floor rim and grass tufts, which
      // stand on a floor at most a tuft's height below.
      if (drawn && !solid) {
        let near = false;
        for (let rise = 0; rise <= 12 && !near; rise += 2) near = terrainSolidAt(compiled, x, y + rise);
        if (!near) stray++;
      }
    }
  }
  check('every solid pixel is drawn', uncovered === 0, `(${uncovered} solid pixels left empty)`);
  check('nothing is drawn floating in the air', stray === 0, `(${stray} pixels away from any floor)`);

  const grass = terrainMaterials.grass;
  check('the pocket under the peak is open', pixelAt(raster, left, top, 500, -90) === null);
  // The peak's underside above the pocket is a ceiling: dark edge, never grass.
  const underside = pixelAt(raster, left, top, 520, -140);
  check('a ceiling gets an edge, not a grass rim', underside !== rgb(grass.surface), `(${underside})`);
  check('the air just under a ceiling stays empty', pixelAt(raster, left, top, 520, -134) === null);
  // The pocket floor is a floor: grass on top.
  const floorY = terrainAt(level, 500, -80).y;
  let rim = false;
  for (let y = floorY - 4; y < floorY + 4; y += 2) rim ||= pixelAt(raster, left, top, 500, y) === rgb(grass.surface);
  check('the pocket floor gets its grass rim', rim);
}

// 2. Chunks meet without seams: two halves rasterised apart match one whole.
{
  const level = normalizeLevel(blockLevel([polygonBlock(SPIRAL_NODES)]));
  const compiled = terrainGeometry(level);
  const whole = rasterizeTerrainChunk(compiled, 200, -320, 256, 240);
  const leftHalf = rasterizeTerrainChunk(compiled, 200, -320, 128, 240);
  const rightHalf = rasterizeTerrainChunk(compiled, 456, -320, 128, 240);
  let mismatched = 0;
  for (let row = 0; row < 240; row++) {
    for (let column = 0; column < 256; column++) {
      const half = column < 128 ? leftHalf : rightHalf, local = column % 128;
      for (let channel = 0; channel < 4; channel++) {
        if (whole.data[(row * 256 + column) * 4 + channel] !== half.data[(row * 128 + local) * 4 + channel]) { mismatched++; break; }
      }
    }
  }
  check('adjacent chunks match the whole exactly', mismatched === 0, `(${mismatched} pixels differ)`);
}

// 3. A cave stays open and its floor and roof are drawn.
{
  const carved = cutBlock(rectangle(0, 300, 800, 600, 'rock'), [[300, 360], [500, 360], [500, 460], [300, 460]]);
  assert.ok(carved.changed, 'the cave cut works');
  const compiled = terrainGeometry(normalizeLevel(blockLevel([carved.block])));
  const raster = rasterizeTerrainChunk(compiled, 256, 256, 160, 160);
  check('the middle of the cave is open', pixelAt(raster, 256, 256, 400, 410) === null);
  check('the rock around the cave is drawn', pixelAt(raster, 256, 256, 400, 480) !== null);
  check('the cave floor gets a surface rim', pixelAt(raster, 256, 256, 400, 461) === rgb(terrainMaterials.rock.surface));
}

// 4. Where two blocks overlap, the later block's material shows.
{
  const compiled = terrainGeometry(normalizeLevel(blockLevel([
    rectangle(0, 300, 500, 700, 'grass', 'a'), rectangle(300, 300, 800, 700, 'brick', 'b'),
  ])));
  const raster = rasterizeTerrainChunk(compiled, 0, 256, 400, 256);
  const brick = terrainMaterials.brick;
  const inOverlap = pixelAt(raster, 0, 256, 401, 403);
  check('the later block wins the overlap', [rgb(brick.fill), brick.pattern && compositeColor('#4e2e2a99', brick.fill).join(',')].includes(inOverlap), `(${inOverlap})`);
  check('the earlier block shows outside it', pixelAt(raster, 0, 256, 150, 403) !== inOverlap);
  // No wall is drawn along the buried seam at x 300.
  const seam = pixelAt(raster, 0, 256, 301, 451);
  check('no edge is drawn along a buried seam', seam !== rgb(brick.edge) && seam !== rgb(terrainMaterials.grass.edge), `(${seam})`);
}

// 5. The chunk cache: block trails blit rasterised chunks, legacy trails keep
// their canvas art, and sky costs nothing.
const drawCalls = (renderer, level, x, y, w, h) => {
  context.calls.length = 0;
  renderer.draw(context, level, x, y, w, h);
  return context.calls.map(call => call[0]);
};
{
  const renderer = createTerrainRenderer();
  const level = normalizeLevel(blockLevel([rectangle(0, 300, 800, 600)]));
  const names = drawCalls(renderer, level, 0, 0, 900, 600);
  check('a block trail puts rasterised pixels', names.includes('putImageData'));
  check('and blits its chunks', names.includes('drawImage'));
  check('without tracing canvas paths', !names.includes('bezierCurveTo') && !names.includes('fill'));
  check('its start sign is drawn live', names.includes('fillRect'));

  const again = drawCalls(renderer, level, 0, 0, 900, 600);
  check('a second frame reuses every chunk', !again.includes('putImageData'));

  // An edit in one place rebuilds only the chunks in the columns it touched.
  level.terrainBlocks.push(rectangle(1600, 200, 1700, 600, 'rock', 'far'));
  invalidateTerrain(level);
  drawCalls(renderer, level, 0, 0, 900, 600);
  const rebuilt = drawCalls(renderer, level, 0, 0, 900, 600).filter(name => name === 'putImageData').length;
  check('an edit far away leaves visible chunks cached', rebuilt === 0, `(${rebuilt} rebuilt)`);
  for (const node of level.terrainBlocks[0].regions[0].outer.nodes) node.y -= 40;
  invalidateTerrain(level);
  const moved = drawCalls(renderer, level, 0, 0, 900, 600).filter(name => name === 'putImageData').length;
  check('an edit in view rebuilds its chunks', moved > 0);
}
{
  const renderer = createTerrainRenderer();
  const names = drawCalls(renderer, normalizeLevel(legacyLevel()), 0, 0, 900, 600);
  check('a legacy trail keeps its canvas art', names.includes('fill') && names.includes('drawImage'));
  check('an empty sky chunk costs no blit', !drawCalls(renderer, normalizeLevel(legacyLevel()), 900, -4000, 600, 600).includes('drawImage'));
  const blocks = normalizeLevel(blockLevel([rectangle(0, 300, 800, 600)]));
  check('block sky costs no blit either', !drawCalls(createTerrainRenderer(), blocks, 0, -4000, 600, 600).includes('drawImage'));
  check('a trail with no terrain at all still draws', Array.isArray(drawCalls(createTerrainRenderer(), normalizeLevel(blockLevel([])), 0, 0, 600, 600)));
}

// Props must survive a trail that has no ground line at all.
{
  const { propAlignmentSlope, propGroundOffset } = await import('../js/drawing.js');
  const carved = cutBlock(rectangle(0, 300, 1200, 800), [[400, 340], [700, 340], [700, 460], [400, 460]]);
  const level = normalizeLevel(blockLevel([carved.block]));
  assert.equal(level.points, undefined, 'the trail really has no ground line');
  for (const prop of [
    { x: 550, y: null, type: 'fence' },
    { x: 550, y: 460, type: 'fence' },
    { x: 550, y: 460, type: 'tree' },
    { x: 550, y: 460, type: 'rock' },
    { x: 550, y: 100, type: 'bush' },
  ]) {
    let slope, offset;
    assert.doesNotThrow(() => { slope = propAlignmentSlope(level, prop); }, `slope for ${prop.type}`);
    assert.doesNotThrow(() => { offset = propGroundOffset(level, prop); }, `offset for ${prop.type}`);
    assert.ok(Number.isFinite(slope), `slope is a number for ${prop.type}`);
    assert.ok(Math.abs(offset(0)) < 1e-6, `a planted prop meets its ground for ${prop.type}`);
  }
  const onFloor = { x: 550, y: 460, type: 'fence' };
  const base = propGroundOffset(level, onFloor);
  assert.ok(Math.abs(base(-33) - base(33)) < 40, 'a fence on a flat cave floor has a level base');
  check('a prop on a block is not tilted by a surface far above it', Math.abs(propAlignmentSlope(level, onFloor)) < 0.5);
}

// A floating prop keeps a level base, so it reads as floating.
{
  const { propAlignmentSlope, propGroundOffset } = await import('../js/drawing.js');
  const level = normalizeLevel(blockLevel([rectangle(0, 400, 600, 700)]));
  const floating = { x: 300, y: 200, type: 'tree' };
  assert.equal(propAlignmentSlope(level, floating), 0, 'a floating prop is not tilted');
  const base = propGroundOffset(level, floating);
  assert.equal(base(-16), 0, 'and its base is level on the left');
  assert.equal(base(16), 0, 'and on the right');
}

// A finish is a point, not just an x: it can hang in the air, and the run
// still ends on its x.
{
  const { finishHeight: finishAt, validateLevel } = await import('../js/level-schema.js');
  const bare = blockLevel([rectangle(0, 300, 2000, 600)]);
  const onGround = normalizeLevel({ ...bare, goal: 1000, finishY: null });
  check('a ground finish snaps to the surface', Math.abs(finishAt(onGround) - 300) < 2, `(at ${finishAt(onGround)})`);
  const inAir = normalizeLevel({ ...bare, goal: 1000, finishY: 120 });
  check('a finish can be placed in the air', finishAt(inAir) === 120);
  const { finishY: _, ...withoutFinish } = bare;
  const missing = normalizeLevel({ ...withoutFinish, goal: 1000 });
  check('a missing finishY means ground, not y=0', Math.abs(finishAt(missing) - 300) < 2, `(at ${finishAt(missing)})`);
  check('a missing finishY normalizes to null', missing.finishY === null);
  check('normalizing twice is stable', normalizeLevel(JSON.parse(JSON.stringify(missing))).finishY === null);
  check('the editor and the game read one height', inAir.finishY === finishAt(inAir));
  const past = normalizeLevel({ ...bare, goal: 1000, finishY: 120, apples: [{ x: 1400, y: 120 }] });
  const apple = validateLevel(past).find(m => m.text.startsWith('Apple at x 1400'));
  check('an apple past an air finish is reported', /past the finish at x 1000/.test(apple?.text || ''), `("${apple?.text}")`);
  check('and says how to fix it', /Move the finish right/.test(apple?.text || ''));
  check('moving the finish past the apple clears it',
    !validateLevel(normalizeLevel({ ...past, goal: 1600 })).some(m => m.text.startsWith('Apple at x 1400')));
}

dom.restore();
console.log(failures ? `\n${failures} failing` : '\nTerrain render tests passed.');
process.exit(failures ? 1 : 0);
