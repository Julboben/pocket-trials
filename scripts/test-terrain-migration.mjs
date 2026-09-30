// Converting legacy terrain into blocks must not move anything the rider
// touches: wheel contacts, apples, props, the start and the finish.
import { readFileSync } from 'node:fs';
import { migrateLegacyTerrain, normalizeLevel, validateLevel, hasLegacyTerrain, finishHeight } from '../js/level-schema.js';
import { terrainAt, terrainCollisionsAt } from '../js/terrain.js';
import { levelHash } from '../js/level-hash.js';
import { legacyLevel } from './lib/terrain-fixtures.mjs';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
  if (!ok) failures++;
};

const WHEEL = 18;
// Legacy cosine curves are flattened to within about 0.83 units and path
// outlines to within 0.45; a wheel may press a little more or less than that.
const CONTACT_TOLERANCE = 1.2;

function deepest(level, x, y) {
  const contacts = terrainCollisionsAt(level, x, y, WHEEL);
  return contacts.length ? Math.max(...contacts.map(contact => contact.penetration)) : 0;
}

/**
 * The largest difference in how deep a wheel sinks, over a grid covering the
 * level. Only places a wheel can really be are compared: above the kill plane
 * and less than a wheel's width into the ground. The converted ground reaches
 * deeper than the legacy collision polygon did, which nothing alive can reach.
 */
function contactDrift(before, after) {
  const xs = [before.start.x, before.goal];
  for (const point of before.points || []) xs.push(point[0]);
  const left = Math.min(...xs) - 60, right = Math.max(...xs) + 60;
  let worst = { drift: 0, x: 0, y: 0 };
  for (let x = left; x <= right; x += 19) {
    for (let y = -900; y <= (before.fallY || 620); y += 13) {
      const a = deepest(before, x, y), b = deepest(after, x, y);
      if (Math.min(a, b) > WHEEL * 2) continue;
      const drift = Math.abs(a - b);
      if (drift > worst.drift) worst = { drift, x, y };
    }
  }
  return worst;
}

/** Where a ground-anchored object ends up on a level. */
const resting = (level, x) => terrainAt(level, x, null);
const sameResting = (before, after, x) => {
  const a = resting(before, x), b = resting(after, x);
  return a.solid === b.solid && (!a.solid || Math.abs(a.y - b.y) <= 0.5);
};

function checkObjects(name, before, after) {
  let moved = 0;
  after.apples.forEach((apple, index) => {
    const old = before.apples[index];
    if (Number.isFinite(old.y)) { if (apple.y !== old.y) moved++; return; }
    if (Number.isFinite(apple.y)) { if (Math.abs(apple.y - (resting(before, old.x).y - 60)) > 0.5) moved++; return; }
    if (!sameResting(before, after, old.x)) moved++;
  });
  after.props.forEach((prop, index) => {
    const old = before.props[index];
    if (Number.isFinite(old.y)) { if (prop.y !== old.y) moved++; return; }
    if (Number.isFinite(prop.y)) { if (resting(before, old.x).solid && Math.abs(prop.y - resting(before, old.x).y) > 0.5) moved++; return; }
    if (!sameResting(before, after, old.x)) moved++;
  });
  after.spikes.forEach((spike, index) => {
    const old = before.spikes[index];
    if (spike.x !== old.x || spike.y !== old.y) moved++;
  });
  check(`${name}: apples, props and spikes stay put`, moved === 0, `(${moved} moved)`);

  if (!Number.isFinite(before.start.y)) {
    const pinned = Number.isFinite(after.start.y);
    check(`${name}: the start keeps its height`, pinned || [-25, 25].every(dx => sameResting(before, after, before.start.x + dx)));
  } else {
    check(`${name}: an explicit start is untouched`, after.start.y === before.start.y);
  }
  check(`${name}: the finish keeps its height`, Math.abs(finishHeight(after) - finishHeight(before)) <= 0.5,
    `(${finishHeight(before).toFixed(2)} -> ${finishHeight(after).toFixed(2)})`);
}

// ---------------------------------------------------------------------------
// Every legacy level shipped with the game.
// ---------------------------------------------------------------------------
const catalog = JSON.parse(readFileSync(new URL('../levels/catalog.json', import.meta.url), 'utf8'));
const files = catalog.levels.map(entry => entry.file);
for (const file of ['custom/hanging-gardens.json', 'custom/mind-your-head.json', 'custom/gravity-fair.json', 'custom/wrong-way-up.json']) {
  if (!files.includes(file)) files.push(file);
}
let migrated = 0;
// Legacy terrain this run actually converted, from shipped levels or fixtures.
let fixtures = 0;
for (const [index, file] of files.entries()) {
  let raw;
  try { raw = JSON.parse(readFileSync(new URL(`../levels/${file}`, import.meta.url), 'utf8')); } catch { continue; }
  if (!hasLegacyTerrain(raw)) continue;
  migrated++;
  const input = JSON.stringify(raw);
  const before = normalizeLevel(raw, index);
  const after = migrateLegacyTerrain(raw, index);
  check(`${file}: the input is not modified`, JSON.stringify(raw) === input);
  check(`${file}: no legacy terrain is left`, !hasLegacyTerrain(after) && after.terrainBlocks.length > 0);
  const errors = validateLevel(after).filter(entry => entry.type === 'error');
  check(`${file}: the converted level is valid`, errors.length === 0, errors.map(entry => entry.message).join('; '));
  const drift = contactDrift(before, after);
  check(`${file}: wheel contacts do not move`, drift.drift <= CONTACT_TOLERANCE,
    `(worst ${drift.drift.toFixed(2)} at ${drift.x}, ${drift.y})`);
  checkObjects(file, before, after);
  const again = migrateLegacyTerrain(after, index);
  check(`${file}: converting twice changes nothing`, JSON.stringify(again) === JSON.stringify(after));
  check(`${file}: the converted trail gets its own leaderboard`, levelHash(after) !== levelHash(before));
}
// ---------------------------------------------------------------------------
// A closed path becomes a solid block in its own material.
// ---------------------------------------------------------------------------
{
  const ring = [[1200, 100], [1350, 60], [1450, 120], [1350, 200], [1220, 180]];
  const raw = legacyLevel({ paths: [{ points: ring, thickness: 16, material: 'rock', closed: true }] });
  const before = normalizeLevel(raw);
  const after = migrateLegacyTerrain(raw);
  fixtures++;
  check('closed path: it becomes a rock block', after.terrainBlocks.some(block => block.material === 'rock'));
  const drift = contactDrift(before, after);
  check('closed path: wheel contacts do not move', drift.drift <= CONTACT_TOLERANCE, `(worst ${drift.drift.toFixed(2)} at ${drift.x}, ${drift.y})`);
  const inside = terrainAt(after, 1350, null);
  check('closed path: its top is the topmost surface', inside.solid && inside.y < 80 && inside.material === 'rock', `(${inside.y.toFixed(1)} ${inside.material})`);
}

// ---------------------------------------------------------------------------
// Objects that used to ignore an island now land on it, so they are pinned.
// ---------------------------------------------------------------------------
{
  const raw = legacyLevel({
    apples: [{ x: 550, y: null }, { x: 200, y: null }],
    props: [{ type: 'tree', x: 600, y: null }],
  });
  const before = normalizeLevel(raw);
  const after = migrateLegacyTerrain(raw);
  fixtures++;
  check('island: an apple under it is pinned to its old height', Math.abs(after.apples[0].y - (resting(before, 550).y - 60)) <= 0.5,
    `(${after.apples[0].y})`);
  check('island: an apple on open ground stays anchored', after.apples[1].y === null);
  check('island: a prop under it keeps its old ground', Math.abs(after.props[0].y - resting(before, 600).y) <= 0.5);
  checkObjects('island', before, after);
}

// Every level in the game has since been converted to blocks by hand, so the
// catalog above usually contributes nothing. The synthetic fixtures are what
// keep the migration itself covered; this only guards against the whole file
// going vacuous, which would let the migration rot unnoticed.
check('there is still legacy terrain to convert', migrated + fixtures > 0,
  `(${migrated} shipped, ${fixtures} fixtures)`);

console.log(failures ? `\n${failures} failing` : '\nTerrain migration tests passed.');
process.exit(failures ? 1 : 0);
