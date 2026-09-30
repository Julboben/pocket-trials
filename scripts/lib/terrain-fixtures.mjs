// Inline terrain fixtures for the runtime, render and migration tests, so
// they never depend on a level file somebody is still editing in the editor.
import { normalizeBlocks } from '../../js/terrain-geometry.js';

/** The hand-drawn hook from the orchard copy: a spiral with a pocket under its peak. */
export const SPIRAL_NODES = [
  [330, -65], [246, -234], [361, -220], [384, -55], [545, -31], [621, -54], [599, -157],
  [447, -145], [502, -229], [549, -280], [682, -93], [685, -19], [599, 99], [526, 70], [408, 25],
];

export function polygonBlock(points, material = 'grass', id = 'block') {
  return normalizeBlocks([{
    id, material,
    regions: [{ outer: { nodes: points.map(([x, y], index) => ({ id: `${id}-n${index}`, x, y, edge: 'straight' })) }, inner: [] }],
  }], material)[0];
}

export function rectangle(left, top, right, bottom, material = 'grass', id = 'rect') {
  return polygonBlock([[left, top], [right, top], [right, bottom], [left, bottom]], material, id);
}

const base = () => ({
  version: 2, name: 'Fixture', terrain: 'grass', goal: 1400, fallY: 900,
  start: { x: 90, y: null, facing: 1 }, apples: [], props: [], spikes: [], weather: { sun: 1, clouds: 0 },
});

/** A trail made only of blocks, with no legacy ground line. */
export function blockLevel(blocks, extra = {}) {
  return { ...base(), finishY: null, terrainBlocks: blocks, ...extra };
}

/** A legacy trail: rolling ground with a gap, an island and a path. */
export function legacyLevel(extra = {}) {
  return {
    ...base(),
    points: [[0, 320], [300, 320], [600, 280], [900, 340], [1200, 300], [1600, 320]],
    gaps: [[1000, 1080]],
    platforms: [{ points: [[400, 120], [550, 100], [700, 130]], bottom: [[400, 150], [550, 130], [700, 160]], material: 'dirt' }],
    paths: [{ points: [[1250, 150], [1400, 110], [1500, 160]], thickness: 24, material: 'rock' }],
    ...extra,
  };
}
