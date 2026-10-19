import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trailsRoot = path.join(projectRoot, 'trails');
const sources = ['official', 'bonus', 'custom'];
// Custom trails are git-ignored, so they get their own (also ignored) catalog
// and the committed catalog.json is the same on every machine.
export const CUSTOM_CATALOG = 'custom-catalog.json';

/**
 * Writes trails/catalog.json and the custom catalog. A file that can't be
 * parsed, or has no name, is left out with a warning rather than stopping the
 * whole catalog: one broken file must not take every other trail with it.
 * Returns the warnings, one per skipped file.
 */
export async function generateTrailCatalog() {
  const catalog = { schemaVersion: 1, trails: [] };
  const customCatalog = { schemaVersion: 1, trails: [] };
  const warnings = [];
  for (const source of sources) {
    const directory = path.join(trailsRoot, source);
    await mkdir(directory, { recursive: true });
    const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const file of files) {
      const relativePath = `${source}/${file}`;
      let trail;
      try {
        trail = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      } catch (error) {
        warnings.push(`Skipped trails/${relativePath}: could not parse it (${error.message}).`);
        continue;
      }
      if (!trail || typeof trail.name !== 'string' || !trail.name.trim()) {
        warnings.push(`Skipped trails/${relativePath}: it needs a string name.`);
        continue;
      }
      (source === 'custom' ? customCatalog : catalog).trails.push({
        id: `${source}:${file.replace(/\.json$/i, '')}`,
        source,
        file: relativePath,
        name: trail.name
      });
    }
  }
  await writeFile(path.join(trailsRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(trailsRoot, CUSTOM_CATALOG), `${JSON.stringify(customCatalog, null, 2)}\n`);
  for (const warning of warnings) console.warn(warning);
  console.log(`Generated trails/catalog.json with ${catalog.trails.length} trails and trails/${CUSTOM_CATALOG} with ${customCatalog.trails.length}.`);
  return warnings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generateTrailCatalog();
}
