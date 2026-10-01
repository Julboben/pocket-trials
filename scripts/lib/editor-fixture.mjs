// The two trail shapes the editor DOM test boots against.
import { readFileSync } from 'node:fs';

const html = () => readFileSync(new URL('../../editor.html', import.meta.url), 'utf8');

const blockNodes = [
  { id: 'n1', x: 0, y: 300, mode: 'corner', in: null, out: null, edge: 'straight' },
  { id: 'n2', x: 800, y: 300, mode: 'corner', in: null, out: null, edge: 'straight' },
  { id: 'n3', x: 800, y: 600, mode: 'corner', in: null, out: null, edge: 'straight' },
  { id: 'n4', x: 0, y: 600, mode: 'corner', in: null, out: null, edge: 'straight' },
];

const base = () => ({
  name: 'Test', goal: 700, fallY: 900, terrain: 'grass',
  terrainBlocks: [{
    id: 'b1',
    material: 'grass',
    regions: [{ outer: { id: 'bo1', nodes: blockNodes }, inner: [] }],
  }],
  apples: [], props: [], spikes: [], weather: { sun: 1, clouds: 0 },
  start: { x: 90, y: null, facing: 1 },
});

/**
 * `blocks` is a plain block trail. `badgoal` is the same trail with its finish
 * well past the end of the terrain, so it does not validate. `interact` uses
 * the plain trail too, and drives precise gestures against it.
 */
export function loadTrailShape(kind) {
  const trail = base();
  if (kind === 'badgoal') Object.assign(trail, { goal: 3000 });
  return { html: html(), trail };
}
