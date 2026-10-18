// The trail list's thumbnail: an author's framing (`preview`) is kept, never
// changes the trail's hash, and centres the thumbnail; without it the game
// frames the trail's most eventful stretch, as it always has.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTrail } from '../js/trail-schema.js';
import { trailHash } from '../js/trail-hash.js';
import { TRAIL_PREVIEW, findHighlight, trailPreviewCentre, trailPreviewFrame } from '../js/trail-preview.js';

const orchard = JSON.parse(readFileSync(new URL('../trails/official/01-the-orchard.json', import.meta.url), 'utf8'));
const plain = normalizeTrail(orchard);

// Kept as whole world units; anything broken is dropped, never half-kept.
assert.deepEqual(normalizeTrail({ ...orchard, preview: { x: 812.6, y: '240.2' } }).preview, { x: 813, y: 240 });
for (const broken of [null, 'here', { x: 1 }, { x: 'left', y: 4 }, { x: NaN, y: 0 }])
  assert.equal('preview' in normalizeTrail({ ...orchard, preview: broken }), false, `drops ${JSON.stringify(broken)}`);
assert.equal('preview' in plain, false, 'a trail without one has no field at all');

// Framing the thumbnail keeps the trail's times.
const framed = normalizeTrail({ ...orchard, preview: { x: 900, y: 200 } });
assert.equal(trailHash(framed), trailHash(plain), 'the preview is not part of the hash');

// The thumbnail centres on the framing.
assert.deepEqual(trailPreviewCentre(framed), { x: 900, y: 200 });
assert.deepEqual(trailPreviewFrame(framed), {
  left: 900 - TRAIL_PREVIEW.width / 2, top: 200 - TRAIL_PREVIEW.height / 2,
  width: TRAIL_PREVIEW.width, height: TRAIL_PREVIEW.height,
});

// Without one: the most eventful stretch, framed exactly as before the
// preview existed (the stretch's ground 55% of the way down the thumbnail).
const highlight = findHighlight(plain, TRAIL_PREVIEW.width);
const frame = trailPreviewFrame(plain);
assert.equal(frame.left + frame.width / 2, highlight.x);
assert.ok(Math.abs(frame.top + frame.height * 0.55 - highlight.y) < 1e-9, 'the ground sits 55% down, as before');
assert.notEqual(highlight.x, plain.start.x, 'it looks past the start');

console.log('Trail preview tests passed.');
