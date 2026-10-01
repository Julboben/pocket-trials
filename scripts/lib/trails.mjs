import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function readJson(path) {
  return JSON.parse(readFileSync(root + path, 'utf8'));
}

// Loads trails exactly as the browser does: raw JSON from the catalog.
export function loadCatalogLevels(source = 'official') {
  return readJson('levels/catalog.json').levels
    .filter(entry => entry.source === source)
    .map(entry => ({ ...entry, level: readJson('levels/' + entry.file) }));
}

export const repoRoot = root;
