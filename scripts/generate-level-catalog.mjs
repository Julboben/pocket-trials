import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const levelsRoot = path.join(projectRoot, 'levels');
const sources = ['official', 'custom'];

export async function generateLevelCatalog() {
  const catalog = { schemaVersion: 1, levels: [] };
  for (const source of sources) {
    const directory = path.join(levelsRoot, source);
    const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const file of files) {
      const relativePath = `${source}/${file}`;
      let level;
      try {
        level = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      } catch (error) {
        throw new Error(`Could not parse levels/${relativePath}: ${error.message}`);
      }
      if (!level.name || typeof level.name !== 'string') throw new Error(`levels/${relativePath} needs a string name.`);
      catalog.levels.push({
        id: `${source}:${file.replace(/\.json$/i, '')}`,
        source,
        file: relativePath,
        name: level.name
      });
    }
  }
  await writeFile(path.join(levelsRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Generated levels/catalog.json with ${catalog.levels.length} levels.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generateLevelCatalog();
}
