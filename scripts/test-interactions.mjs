// Interactions: the interact key acts on the nearest ready thing in reach, and
// on nothing further away.
import assert from 'node:assert/strict';
import { INTERACT_REACH, nearestInteraction } from '../js/interactions.js';

const spot = (x, y = 300, extra = {}) => ({ x, y, hint: 60, ready: true, ...extra });

assert.equal(nearestInteraction([], 0, 0), null, 'nothing to use');
assert.equal(nearestInteraction([spot(100)], null, null), null, 'no rider');
assert.equal(nearestInteraction([spot(100 + INTERACT_REACH.x + 1)], 100, 300), null, 'too far to the side');
assert.equal(nearestInteraction([spot(100, 300 + INTERACT_REACH.y + 1)], 100, 300), null, 'too far below');
assert.ok(nearestInteraction([spot(100 - INTERACT_REACH.x)], 100, 300), 'right at the edge of reach');
{
  const near = spot(130), nearer = spot(80);
  assert.equal(nearestInteraction([near, nearer], 100, 300), nearer, 'the nearest one');
  assert.equal(nearestInteraction([near, { ...nearer, ready: false }], 100, 300), near, 'skips one that is not ready');
}
assert.ok(nearestInteraction([spot(250, 300, { reach: { x: 200, y: 10 } })], 100, 300), 'its own reach');

console.log('Interaction tests passed.');
