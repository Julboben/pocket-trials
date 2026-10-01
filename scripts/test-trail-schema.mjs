import assert from 'node:assert/strict';
import { curveAt } from '../js/terrain.js';
import {
  SPIKE_RADIUS, createBlankLevel, normalizeLevel, normalizeSpike, validateLevel, medalFor, normalizeMedals
} from '../js/level-schema.js';
import { levelHash } from '../js/level-hash.js';
import { loadCatalogLevels } from './lib/levels.mjs';

const errors = level => validateLevel(level).filter(message => message.type === 'error').map(message => message.text);

// Every shipped trail validates, and normalizing is idempotent.
for (const entry of [...loadCatalogLevels('official'), ...loadCatalogLevels('custom')]) {
  const level = normalizeLevel(entry.level);
  assert.deepEqual(errors(level), [], `${entry.id} validates`);
  assert.deepEqual(normalizeLevel(level), level, `${entry.id} normalizes idempotently`);
}

// Spikes: ground-anchored spikes sit on the curve, radius is clamped, spin defaults to 1.
{
  const points = [[0, 300], [400, 200]];
  const anchored = normalizeSpike({ x: 200 }, points);
  assert.equal(anchored.radius, SPIKE_RADIUS.default);
  assert.equal(anchored.y, curveAt(points, 200).y - SPIKE_RADIUS.default);
  assert.equal(anchored.spin, 1);
  assert.equal(normalizeSpike({ x: 0, y: 10, radius: 999 }, points).radius, SPIKE_RADIUS.max);
  assert.equal(normalizeSpike({ x: 0, y: 10, radius: 1 }, points).radius, SPIKE_RADIUS.min);
  assert.equal(normalizeSpike({ x: 0, y: 10, spin: -0.5 }, points).spin, -0.5);
  assert.equal(normalizeSpike({ x: 0, y: null }, points).y, curveAt(points, 0).y - SPIKE_RADIUS.default);

  const level = normalizeLevel({ ...createBlankLevel(), spikes: [{ x: 700, y: 100, radius: 20 }] });
  level.spikes.push({ x: Number.NaN, y: 0, radius: 20, spin: 1 });
  assert.ok(errors(level).some(text => text.includes('finite coordinates')));
  level.spikes = [{ x: level.start.x + 10, y: curveAt(level.points, level.start.x).y - 20, radius: 20, spin: 1 }];
  assert.ok(validateLevel(level).some(message => message.type === 'warning' && message.text.includes('close to the start')));
}

// Import round-trip: export as JSON, parse, normalize — nothing is lost.
{
  const original = normalizeLevel({
    ...createBlankLevel(3),
    name: 'Round Trip',
    spikes: [{ x: 640, radius: 24, spin: -1 }],
    apples: [{ x: 500, y: null }, { x: 820, y: 180 }],
    medals: { gold: 20, silver: 30, bronze: 45 }
  }, 3);
  const imported = normalizeLevel(JSON.parse(JSON.stringify(original)), 3);
  assert.deepEqual(imported, original);
  assert.deepEqual(errors(imported), []);
  assert.equal(levelHash(imported), levelHash(original));
}

// Garbage input still produces a playable, valid level.
{
  const level = normalizeLevel({ name: 'Broken', points: 'nope', spikes: [{}], apples: [{ x: 'x' }], start: {} });
  assert.ok(level.points.length >= 2);
  assert.equal(level.spikes.length, 1);
  assert.ok(Number.isFinite(level.spikes[0].y));
  assert.equal(level.start.facing, 1);
}

// Medals.
{
  assert.equal(normalizeMedals({ gold: 10 }), null);
  assert.deepEqual(normalizeMedals({ gold: '10', silver: 12, bronze: 15 }), { gold: 10, silver: 12, bronze: 15 });
  const medals = { gold: 10, silver: 12, bronze: 15 };
  assert.equal(medalFor(medals, 9.5), 'gold');
  assert.equal(medalFor(medals, 12), 'silver');
  assert.equal(medalFor(medals, 14), 'bronze');
  assert.equal(medalFor(medals, 16), null);
  assert.equal(medalFor(undefined, 1), null);
  const level = normalizeLevel({ ...createBlankLevel(), medals: { gold: 30, silver: 20, bronze: 40 } });
  assert.ok(errors(level).some(text => text.includes('slower')));
}

// Content hashes identify a trail by its geometry, not its name or storage.
{
  const a = normalizeLevel(createBlankLevel(0));
  const b = normalizeLevel({ ...a, name: 'Renamed', label: 'X' });
  const c = normalizeLevel({ ...a, goal: a.goal - 10 });
  assert.equal(levelHash(a), levelHash(b));
  assert.notEqual(levelHash(a), levelHash(c));
  assert.match(levelHash(a), /^[0-9a-f]{8}$/);
}

console.log('Level schema tests passed.');
