// Inline terrain fixtures for the terrain, runtime and render tests, so
// they never depend on a trail file somebody is still editing in the editor.
import { normalizeBlocks } from '../../js/terrain-geometry.js';

/** The hand-drawn hook from the orchard copy: a spiral with a pocket under its peak. */
export const SPIRAL_NODES = [
  [330, -65], [246, -234], [361, -220], [384, -55], [545, -31], [621, -54], [599, -157],
  [447, -145], [502, -229], [549, -280], [682, -93], [685, -19], [599, 99], [526, 70], [408, 25],
];

export function polygonBlock(points, material = 'grass', id = 'block') {
  return normalizeBlocks([{
    id, material,
    outer: { nodes: points.map(([x, y], index) => ({ id: `${id}-n${index}`, x, y, edge: 'straight' })) }, inner: [],
  }], material)[0];
}

export function rectangle(left, top, right, bottom, material = 'grass', id = 'rect') {
  return polygonBlock([[left, top], [right, top], [right, bottom], [left, bottom]], material, id);
}

const base = () => ({
  name: 'Fixture', goal: 1400, fallY: 900,
  start: { x: 90, y: null, facing: 1 }, apples: [], props: [], spikes: [], weather: { sun: 1, clouds: 0 },
});

/** A trail made of the given blocks. */
export function blockTrail(blocks, extra = {}) {
  return { ...base(), finishY: null, terrainBlocks: blocks, ...extra };
}
