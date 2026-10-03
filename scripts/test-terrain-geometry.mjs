// The terrain model: one block type with outer and inner boundaries,
// curve-preserving cuts, point editing, and validation.
//
// The plan's acceptance criteria for the terrain model live here. Physics and
// rendering against the compiled result are in test-terrain-runtime.mjs.
import {
  rectangleBlock, cutBlock, normalizeBlock, regionRings, pointInRegion,
  regionArea, flattenBoundary, moveBlock, insertBoundaryNode, validateBlock, addInnerBoundary,
  createNode, createBoundary, createRegion, hitTestBlock, removeBoundaryNodes, setBoundaryEdge,
  setNodeMode, blockSolidArea, isCurvedEdge, scaleBlock,
} from "../js/terrain-geometry.js";
import { normalizeTrail, validateTrail } from "../js/trail-schema.js";

let failures = 0;
const check = (label, condition) => {
  if (!condition) { failures++; console.log("FAIL", label); }
  else console.log("ok  ", label);
};

// 1. Rectangle block basics.
const square = rectangleBlock(0, 0, 100, 100);
check("rectangle has one region", square.regions.length === 1);
check("rectangle area", Math.abs(regionArea(square.regions[0]) - 10000) < 1e-6);
check("point inside", pointInRegion(square.regions[0], 50, 50));
check("point outside", !pointInRegion(square.regions[0], 150, 50));
check("validates clean", validateBlock(square).length === 0);

// 2. A cut entirely inside solid becomes an inner boundary.
const holed = cutBlock(square, [[25, 25], [75, 25], [75, 75], [25, 75]]);
check("inner cut changed the block", holed.changed);
check("inner cut keeps one region", holed.block.regions.length === 1);
check("inner cut adds a hole", holed.block.regions[0].inner.length === 1);
const region = holed.block.regions[0];
check("cave is empty", !pointInRegion(region, 50, 50));
check("wall is solid", pointInRegion(region, 10, 50));
check("area dropped by the hole", Math.abs(regionArea(region) - 10000 + 2500) < 1e-6);
check("inner cut still valid", validateBlock(holed.block).length === 0);

// 3. A cut across the whole block splits it into two regions of the same block.
const split = cutBlock(square, [[45, -10], [55, -10], [55, 110], [45, 110]]);
check("cut through splits into two regions", split.changed && split.block.regions.length === 2);
check("split keeps the block id", split.block.id === square.id);
check("split regions are solid", split.block.regions.every(r => regionArea(r) > 0));
check("split is valid", validateBlock(split.block).length === 0);

// 4. A cut across the outside edge opens an entrance.
const entrance = cutBlock(square, [[-10, 30], [60, 30], [60, 45], [-10, 45]]);
check("edge cut changes the block", entrance.changed);
check("edge cut stays one region", entrance.block.regions.length === 1);
check("entrance is open", !pointInRegion(entrance.block.regions[0], 20, 37));
check("inside the notch is solid", pointInRegion(entrance.block.regions[0], 20, 60));
check("entrance is valid", validateBlock(entrance.block).length === 0);

// 5. A cut outside the block changes nothing and says so.
const missed = cutBlock(square, [[500, 500], [600, 500], [600, 600]]);
check("distant cut is refused", !missed.changed && typeof missed.reason === "string");
check("refused cut returns the same block", missed.block === square);

// 6. Curves survive a cut that misses them.
const curved = normalizeBlock({
  material: "grass",
  regions: [{
    outer: {
      id: "b1",
      nodes: [
        { id: "a", x: 0, y: 0, edge: "curve", out: [40, 80] },
        { id: "b", x: 100, y: 0, mode: "smooth", in: [60, 80], edge: "straight" },
        { id: "c", x: 100, y: 100, edge: "straight" },
        { id: "d", x: 0, y: 100, edge: "straight" },
      ],
    },
    inner: [],
  }],
});
const topBefore = flattenBoundary(curved.regions[0].outer).points[1][1];
// The authored curve runs from (0,0) to (100,0) with handles at y=80, so it
// bulges down to about y=60 in the middle.
check("curve bulges downward", Math.max(...flattenBoundary(curved.regions[0].outer).points.map(p => p[1])) > 40);
const nearMiss = cutBlock(curved, [[10, 200], [30, 200], [30, 220], [10, 220]]);
check("a cut below the block is refused", !nearMiss.changed);
const through = cutBlock(curved, [[40, -20], [60, -20], [60, 20], [40, 20]]);
check("a cut through the top changes the block", through.changed);
// The notch is taken out of the top edge and the surviving curve rejoins into
// one editable edge, so the block returns to its authored node count.
check("a dented block stays one region", through.block.regions.length === 1);
const dentBoundary = through.block.regions[0].outer;
check("the dented block returns to four nodes", dentBoundary.nodes.length === 4);
const dents = dentBoundary.nodes.filter((n, i) => isCurvedEdge(n, dentBoundary.nodes[(i + 1) % dentBoundary.nodes.length]));
check("the curve survives the notch", dents.length === 1);

// 7. Moving a block moves its caves with it.
const moved = moveBlock(holed.block, 500, 0);
check("moved block moved its outer", moved.regions[0].outer.nodes[0].x === 600);
const movedHoleX = moved.regions[0].inner[0].nodes[0].x;
check("moved block moved its hole", movedHoleX === 525);
check("moved cave is still empty", !pointInRegion(moved.regions[0], 550, 50));

// Scaling a block scales its caves and curve handles about the pivot.
const scaled = scaleBlock(holed.block, 0, 0, 2, 3);
const area = (block) => blockSolidArea(block);
check("scaled block covers the scaled area", Math.abs(area(scaled) - area(holed.block) * 6) < 1);
check("scaled block keeps its cave", scaled.regions[0].inner.length === holed.block.regions[0].inner.length);
const roundish = { ...holed.block, regions: [{ outer: { ...holed.block.regions[0].outer, nodes: [
  { ...holed.block.regions[0].outer.nodes[0], x: 10, y: 0, in: [10, -5], out: [10, 5] },
  ...holed.block.regions[0].outer.nodes.slice(1),
] }, inner: [] }] };
const curvedScaled = scaleBlock(roundish, 0, 0, 2, 2).regions[0].outer.nodes[0];
check("scaling moves curve handles", curvedScaled.in[1] === -10 && curvedScaled.out[0] === 20);

// 8. Validation catches malformed geometry.
check("non-finite is rejected", validateBlock({ material: "grass", regions: [{ outer: { nodes: [
  { x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 },
] }, inner: [] }] }).some(m => m.type === "error"));
check("degenerate ring is rejected", validateBlock({ material: "grass", regions: [{ outer: { nodes: [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
] }, inner: [] }] }).some(m => m.type === "error"));
check("hole outside its region is rejected", validateBlock({
  material: "grass",
  regions: [{ outer: { nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, inner: [
    { nodes: [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }] },
  ] }],
}).some(m => m.type === "error"));
const blockTrail = blocks => normalizeTrail({
  version: 2, name: "Buried", start: { x: 0, y: -40 }, goal: 60, finishY: -40,
  fallY: 1000, apples: [], terrainBlocks: blocks,
});
const buriedWarnings = blocks => validateTrail(blockTrail(blocks)).filter(m => /buried/.test(m.text));
check("a block inside a later block is buried", /^Block 1 /.test(buriedWarnings([square, rectangleBlock(-20, -20, 120, 120)])[0]?.text || ""));
check("a block inside an earlier block is buried", /^Block 2 /.test(buriedWarnings([rectangleBlock(-20, -20, 120, 120), square])[0]?.text || ""));
check("only the inner block is reported", buriedWarnings([rectangleBlock(-20, -20, 120, 120), square]).length === 1);
check("a visible block does not warn", buriedWarnings([square, rectangleBlock(500, 500, 600, 600)]).length === 0);
check("single block validation has no warnings", !validateBlock(square).some(m => m.type === "warning"));

// 9. Point editing.
const inserted = insertBoundaryNode(square.regions[0].outer, 0, 0.5);
check("insert adds a node", inserted.nodes.length === 5);
const shapeBefore = regionArea(square.regions[0]);
const shapeAfter = regionArea({ outer: inserted, inner: [] });
check("inserting on a straight edge preserves area", Math.abs(shapeAfter - shapeBefore) < 1e-6);
const removed = removeBoundaryNodes(inserted, [4]);
check("removing a node keeps the ring valid", removed.nodes.length === 4);

// 10. Curve controls.
const bent = setBoundaryEdge(square.regions[0].outer, 0, true);
check("edge can be curved", bent.nodes[0].out !== null && bent.nodes[1].in !== null);
const smoothed = setNodeMode(bent, 1, "smooth");
check("smooth aligns the handles", Math.abs(
  (smoothed.nodes[1].out[0] - smoothed.nodes[1].x) + (smoothed.nodes[1].in[0] - smoothed.nodes[1].x),
) < 1e-6);
const straightened = setBoundaryEdge(bent, 0, false);
check("edge can go back to straight", straightened.nodes[0].out === null);

// 11. Hit testing priority.
const hitCave = hitTestBlock(holed.block, 50, 50);
check("empty cave space selects nothing", hitCave === null);
const hitWall = hitTestBlock(holed.block, 12, 50);
check("solid selects the region", hitWall?.type === "region");
const hitNode = hitTestBlock(holed.block, 0, 0);
check("a corner node wins over the body", hitNode?.type === "node");

// 12. Blocks are independent: nesting is purely geometric.
const island = rectangleBlock(40, 40, 60, 60);
const withIsland = { blocks: [holed.block, island] };
check("the island floats in the cave's empty space", !pointInRegion(withIsland.blocks[0].regions[0], 50, 50));
check("island block is its own solid", pointInRegion(island.regions[0], 50, 50));
check("island area is independent", Math.abs(blockSolidArea(island) - 400) < 1e-6);
check("the island does not fill the cave", !pointInRegion(withIsland.blocks[0].regions[0], 50, 50));
check("the island is still its own solid", pointInRegion(withIsland.blocks[0].regions[0], 5, 5));

// 13. Cuts through curved edges keep the curve editable.
{
  const curved = normalizeBlock({
    material: "grass",
    regions: [{
      outer: {
        id: "b1",
        nodes: [
          { id: "a", x: 0, y: 0, edge: "curve", out: [40, 80] },
          { id: "b", x: 100, y: 0, in: [60, 80], edge: "straight" },
          { id: "c", x: 100, y: 100, edge: "straight" },
          { id: "d", x: 0, y: 100, edge: "straight" },
        ],
      },
      inner: [],
    }],
  });
  // The curve bulges down to about y=60 in the middle.
  check("a curve flattens to more than its endpoints",
    Math.max(...flattenBoundary(curved.regions[0].outer).points.map(p => p[1])) > 40);

  const through = cutBlock(curved, [[40, -20], [60, -20], [60, 20], [40, 20]]);
  check("a cut through a curve changes the block", through.changed);
  // A dent in the top edge is not a split, so the block keeps one region and
  // rejoins the curve into a single editable edge.
  check("a dented block stays one region", through.block.regions.length === 1);
  check("the dented block returns to four nodes", through.block.regions[0].outer.nodes.length === 4);
  const dented = through.block.regions[0].outer;
  check("the curve survives the notch",
    dented.nodes.filter((node, index) => isCurvedEdge(node, dented.nodes[(index + 1) % dented.nodes.length])).length === 1);
  check("the notch is empty", !pointInRegion(through.block.regions[0], 50, 0));
  check("the body below the notch is solid", pointInRegion(through.block.regions[0], 50, 80));
  check("left of the notch the rock is solid", pointInRegion(through.block.regions[0], 20, 60));
  check("above the curve is air", !pointInRegion(through.block.regions[0], 20, 20));

  // A cut entirely in the air above the block, even overlapping its bounds, does
  // nothing and leaves the very same block object in place.
  const above = cutBlock(curved, [[40, -100], [60, -100], [60, -60], [40, -60]]);
  check("a cut in the air above the block is refused", !above.changed);
  check("a refused cut returns the identical block", above.block === curved);

  // Repeated cuts stay stable.
  let block = curved;
  for (const cut of [[[20, -20], [30, -20], [30, 20], [20, 20]], [[70, -20], [80, -20], [80, 20], [70, 20]]]) {
    const result = cutBlock(block, cut);
    if (result.changed) block = result.block;
  }
  const again = cutBlock(block, [[45, 40], [55, 40], [55, 60], [45, 60]]);
  check("repeated cuts stay valid", again.changed);
  check("repeated cuts never produce a zero-area region",
    again.changed && again.block.regions.every(region => regionArea(region) > 0));
}

// 14. A small cut must not turn a block into hundreds of nodes.
{
  const count = block => block.regions.reduce((total, region) =>
    total + [region.outer, ...region.inner].reduce((sum, boundary) => sum + boundary.nodes.length, 0), 0);
  const make = () => normalizeBlock({
    material: "grass",
    regions: [{
      outer: {
        id: "b1",
        nodes: [
          { id: "a", x: 0, y: 0, edge: "curve", out: [40, 80] },
          { id: "b", x: 100, y: 0, in: [60, 80], edge: "straight" },
          { id: "c", x: 100, y: 100, edge: "straight" },
          { id: "d", x: 0, y: 100, edge: "straight" },
        ],
      },
      inner: [],
    }],
  });
  check("an authored block has four nodes", count(make()) === 4);

  // A curve that flattens into dozens of segments must still come back as one
  // editable edge after a cut.
  const heavy = normalizeBlock({
    material: "grass",
    regions: [{
      outer: {
        id: "b1",
        nodes: [
          { id: "a", x: 0, y: 0, edge: "curve", out: [10, 300] },
          { id: "b", x: 400, y: 0, in: [390, 300], edge: "straight" },
          { id: "c", x: 400, y: 300, edge: "straight" },
          { id: "d", x: 0, y: 300, edge: "straight" },
        ],
      },
      inner: [],
    }],
  });
  check("a heavy curve flattens into many segments", flattenBoundary(heavy.regions[0].outer).points.length > 40);
  const gash = cutBlock(heavy, [[190, 200], [210, 200], [210, 260], [190, 260]]);
  check("a heavily subdivided curve survives a cut", gash.changed);
  check("a heavy curve stays a manageable node count", gash.changed && count(gash.block) < 60);
}

console.log(failures ? `\n${failures} failing` : "\nTerrain geometry tests passed.");
process.exit(failures ? 1 : 0);
