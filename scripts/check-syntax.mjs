// Runs `node --check` on every script so a syntax error in browser-only code
// (which the Node tests never import) still fails CI.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/levels.mjs';

const roots = ['js', 'scripts', 'sw.js'];
const files = [];
function collect(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) collect(join(path, name));
  } else if (/\.(m?js)$/.test(path)) files.push(path);
}
for (const root of roots) collect(join(repoRoot, root));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed++;
    console.error(error.stderr?.toString() || error.message);
  }
}
if (failed) {
  console.error(`${failed} of ${files.length} files failed the syntax check.`);
  process.exit(1);
}
console.log(`Syntax check passed (${files.length} files).`);
