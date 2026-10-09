import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function readJson(path) {
  return JSON.parse(readFileSync(root + path, 'utf8'));
}

// Loads trails exactly as the browser does: raw JSON from the catalog.
export function loadCatalogTrails(source = 'official') {
  // Custom trails are git-ignored and have their own local catalog.
  const catalogPath = source === 'custom' ? 'trails/custom-catalog.json' : 'trails/catalog.json';
  if (!existsSync(root + catalogPath)) return [];
  return readJson(catalogPath).trails
    .filter(entry => entry.source === source)
    .map(entry => ({ ...entry, trail: readJson('trails/' + entry.file) }));
}

export const repoRoot = root;
