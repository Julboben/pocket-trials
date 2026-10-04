// @ts-check
import { TERRAIN_COMPILER_VERSION } from './terrain-runtime.js';

// Identifies a trail by the geometry and rules that decide a run, so renaming
// or re-importing a trail keeps its leaderboard, while any edit that changes
// the ride starts a fresh one.
//
// The terrain compiler version is hashed too: a compiler change alters what the
// wheels touch, so old replays and scores must not carry over.
const GAMEPLAY_KEYS = ['terrainBlocks', 'start', 'goal', 'fallY', 'apples', 'spikes'];

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

/** FNV-1a over the canonical gameplay fields, as 8 hex digits. */
export function trailHash(trail) {
  /** @type {Record<string, unknown>} */
  const fields = Object.fromEntries(GAMEPLAY_KEYS.map(key => [key, trail?.[key]]));
  // Back walls are scenery, so they never change the hash.
  if (Array.isArray(fields.terrainBlocks))
    fields.terrainBlocks = fields.terrainBlocks.filter(block => block?.layer !== 'back');
  // The first block's material, under the key every published hash was made with.
  if (Array.isArray(fields.terrainBlocks)) fields.terrain = fields.terrainBlocks[0]?.material;
  fields.terrainCompiler = TERRAIN_COMPILER_VERSION;
  if (Number.isFinite(trail?.finishY)) fields.finishY = trail.finishY;
  // Like finishY, water is only hashed when a trail has some.
  if (Array.isArray(trail?.water) && trail.water.length) fields.water = trail.water;
  const text = canonical(fields);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
