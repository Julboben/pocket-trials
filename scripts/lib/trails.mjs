import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function readJson(path) {
  return JSON.parse(readFileSync(root + path, 'utf8'));
}

// Loads trails exactly as the browser does: raw JSON from the catalog.
export function loadCatalogTrails(source = 'official') {
  return readJson('trails/catalog.json').trails
    .filter(entry => entry.source === source)
    .map(entry => ({ ...entry, trail: readJson('trails/' + entry.file) }));
}

export const repoRoot = root;
