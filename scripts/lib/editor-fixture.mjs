// The two level shapes the editor DOM test boots against.
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
 * `legacy` is a trail that still carries the older ground, gaps, islands and
 * paths. `blocks` is one whose older terrain has been cleared, so it has no
 * ground line at all and is described entirely by blocks. `bare` is a minimal
 * two-point ground line, which is the smallest valid legacy terrain and the case
 * that catches a predicate written to ignore short ground lines.
 */
export function loadLevelShape(kind) {
  const level = base();
  if (kind === 'legacy') {
    Object.assign(level, { points: [[0, 700], [1600, 700]], gaps: [], platforms: [], paths: [] });
  } else if (kind === 'bare') {
    Object.assign(level, { points: [[0, 400], [1200, 400]] });
  } else if (kind === 'island') {
    // A trail that has only an island and a path, no ground line. Both are
    // legacy terrain, so the offer must appear; this is the case a predicate
    // that only looks for a ground line misses entirely.
    Object.assign(level, {
      platforms: [{ points: [[200, 300], [400, 300]], bottom: [[200, 340], [400, 340]], material: 'rock' }],
      paths: [{ points: [[500, 200], [600, 260]], closed: false, thickness: 24 }],
    });
  } else if (kind === 'gapped') {
    // A ground line with a gap, which is the shape that made the old predicate
    // return an array length instead of a boolean.
    Object.assign(level, { points: [[0, 400], [1200, 400]], gaps: [[400, 500]] });
  } else if (kind === 'badgoal') {
    // A block-only trail whose finish sits well past the end of the terrain,
    // which is what happens when the older ground is cleared before the blocks
    // have been rebuilt out to the old finish.
    Object.assign(level, { goal: 3000 });
  }
  return { html: html(), level };
}
