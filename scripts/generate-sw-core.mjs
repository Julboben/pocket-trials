// Regenerates the CACHE name and CORE list in sw.js from the files the game
// and editor can load, so the precache can't drift out of sync by hand.
//
//   node scripts/generate-sw-core.mjs          rewrite sw.js if needed
//   node scripts/generate-sw-core.mjs --check  fail if sw.js is out of date (CI)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const check = process.argv.includes('--check');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');

// Everything the two pages can request, besides the trail files (cached from
// the catalog) and the service worker itself.
const included = /\.(js|css|html|webmanifest)$|^icons\/.*\.(svg|png)$/;
// Top-level folders and files that are never served to players.
const skipTop = new Set(['sw.js', 'scripts', 'trails', 'tests', 'node_modules', 'dist', 'coverage', 'netlify']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    const path = relative(root, full).replaceAll('\\', '/');
    if (dir === root && skipTop.has(entry.name)) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (included.test(path)) out.push('./' + path);
  }
  return out;
}

// Plain string order, identical on every machine, so the cache name is too.
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const files = ['./', ...walk(root).sort(byPath)];

// A new cache name whenever the list or any file's content changes, so clients
// drop the old precache. Line endings are normalised so every OS gets the same hash.
const hash = createHash('sha256').update(files.join('\n'));
for (const file of files.slice(1)) {
  hash.update('\n' + readFileSync(join(root, file.slice(2)), 'utf8').replaceAll('\r\n', '\n'));
}
const digest = hash.digest('hex');
const cache = `hjulben-${digest.slice(0, 8)}`;

const block = [
  `const CACHE = '${cache}';`,
  'const CORE = [',
  ...files.map((file) => `  '${file}',`),
  '];',
].join('\n');

const current = sw.match(/const CACHE = '[^']*';\r?\nconst CORE = \[[\s\S]*?\r?\n\];/);
if (!current) {
  console.error('sw.js: could not find the CACHE/CORE block; has its shape changed?');
  process.exit(1);
}
if (current[0].replaceAll('\r\n', '\n') === block) {
  console.log(`sw.js: up to date, ${files.length} files, cache ${cache}`);
  process.exit(0);
}
if (check) {
  console.error('sw.js: CORE is out of date. Run `npm run sw` and commit the result.');
  process.exit(1);
}
writeFileSync(swPath, sw.replace(current[0], block));
console.log(`sw.js: updated, ${files.length} files, cache ${cache}`);
