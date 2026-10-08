import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trailsRoot = path.join(projectRoot, 'trails');
const sources = ['official', 'bonus', 'custom'];

export async function generateTrailCatalog() {
  const catalog = { schemaVersion: 1, trails: [] };
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
        throw new Error(`Could not parse trails/${relativePath}: ${error.message}`);
      }
      if (!trail.name || typeof trail.name !== 'string') throw new Error(`trails/${relativePath} needs a string name.`);
      catalog.trails.push({
        id: `${source}:${file.replace(/\.json$/i, '')}`,
        source,
        file: relativePath,
        name: trail.name
      });
    }
  }
  await writeFile(path.join(trailsRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Generated trails/catalog.json with ${catalog.trails.length} trails.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generateTrailCatalog();
}
