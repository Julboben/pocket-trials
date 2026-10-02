// The editor's source, every module in js/editor/ joined, for tests that check
// the code itself rather than run it.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../../js/editor/', import.meta.url);

export const editorSource = () => readdirSync(dir)
  .filter(name => name.endsWith('.js'))
  .sort()
  .map(name => readFileSync(new URL(name, dir), 'utf8'))
  .join('\n');
