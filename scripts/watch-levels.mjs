import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLevelCatalog } from './generate-level-catalog.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['official', 'custom'].map(source => path.join(projectRoot, 'levels', source));
let timer = null;

await generateLevelCatalog();
for (const directory of directories) {
  watch(directory, (_event, filename) => {
    if (!filename?.endsWith('.json')) return;
    clearTimeout(timer);
    timer = setTimeout(() => generateLevelCatalog().catch(error => console.error(error.message)), 80);
  });
}
console.log('Watching levels/official and levels/custom for JSON changes.');
