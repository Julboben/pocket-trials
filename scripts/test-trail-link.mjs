import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { normalizeTrail } from '../js/trail-schema.js';
import { trailHash } from '../js/trail-hash.js';
import { decodeTrailLink, encodeTrailLink, readSharedTrail, trailLinkFromHash, trailShareUrl } from '../js/trail-link.js';
import { loadCatalogTrails } from './lib/trails.mjs';

const rejects = (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));

// Every shipped trail survives a link unchanged, down to its hash.
for (const entry of [...loadCatalogTrails('official'), ...loadCatalogTrails('bonus')]) {
  const trail = normalizeTrail(entry.trail);
  const packed = await encodeTrailLink(trail);
  assert.match(packed, /^1\.[A-Za-z0-9_-]+$/, `${entry.id} packs into URL-safe characters`);
  const opened = await readSharedTrail(`#trail=${packed}`);
  assert.deepEqual(opened, trail, `${entry.id} round-trips`);
  assert.equal(trailHash(opened), trailHash(trail), `${entry.id} keeps its hash`);
}

// The link opens the game, without the editor's query, and is found again in the hash.
{
  const trail = normalizeTrail(loadCatalogTrails('official')[0].trail);
  const url = new URL(await trailShareUrl(trail, 'https://example.com/game/?sandbox=1#old'));
  assert.equal(url.origin + url.pathname + url.search, 'https://example.com/game/');
  assert.equal(trailLinkFromHash(url.hash), await encodeTrailLink(trail));
  assert.equal(trailLinkFromHash(''), null);
  assert.equal(trailLinkFromHash('#other=1'), null);
  assert.equal(await readSharedTrail('#other=1'), null);
}

// Damaged, unknown or hostile links are refused with a message for the player.
{
  await rejects(decodeTrailLink('2.abc'), /newer version|damaged/);
  await rejects(decodeTrailLink('1.'), /newer version|damaged/);
  await rejects(decodeTrailLink('1.not base64!'), /damaged/);
  await rejects(decodeTrailLink('1.AAAA'), /damaged/);
  const notJson = deflateRawSync('{"name": ').toString('base64url');
  await rejects(decodeTrailLink(`1.${notJson}`), /damaged/);
  // A small link that inflates to more than a megabyte.
  const bomb = deflateRawSync(Buffer.alloc(4 << 20, 32)).toString('base64url');
  await rejects(decodeTrailLink(`1.${bomb}`), /too big/);
  // A trail that decodes but doesn't validate.
  const broken = await encodeTrailLink({ name: 'Broken', terrainBlocks: [] });
  await rejects(readSharedTrail(`#trail=${broken}`), /./);
}

console.log('trail link tests passed');
