// Every `$('id')` in the editor must exist in editor.html, and every data-tool
// in the HTML must have an entry in TOOL_INFO. A mismatch would throw at load
// time in the browser, which the node test suite cannot catch.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../editor.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');

let failures = 0;
const fail = message => { failures++; console.log('FAIL', message); };

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const usedIds = new Set([...js.matchAll(/\$\((?:'([^']+)'|"([^"]+)")\)/g)]
  .map(match => match[1] || match[2]));

for (const id of usedIds) if (!htmlIds.has(id)) fail(`editor.js uses #${id}, which is not in editor.html`);
console.log(`ok   ${usedIds.size} element ids all exist`);

// Every tool button needs a TOOL_INFO entry and a default settings entry, or
// setTool() would show an undefined title.
const tools = [...html.matchAll(/data-tool="([^"]+)"/g)].map(match => match[1]);
const infoBlock = js.slice(js.indexOf('const TOOL_INFO = {'), js.indexOf('const DEFAULT_TOOL_SETTINGS'));
for (const tool of tools) {
  if (!new RegExp(`^  ${tool}:`, 'm').test(infoBlock)) fail(`tool "${tool}" has no TOOL_INFO entry`);
}
console.log(`ok   ${tools.length} tools all have tool info: ${tools.join(', ')}`);

// setTool is also reachable from the keyboard, so those must exist too.
for (const code of [...js.matchAll(/setTool\('([^']+)'\)/g)].map(match => match[1])) {
  if (!tools.includes(code)) fail(`setTool('${code}') is not a button in the HTML`);
}

// The new inspector controls must be wired up in both files.
for (const id of ['selection-edge', 'selection-node', 'clear-legacy-terrain', 'legacy-terrain-actions', 'legacy-terrain-note', 'legacy-terrain-summary']) {
  if (!htmlIds.has(id)) fail(`#${id} is missing from editor.html`);
  if (!usedIds.has(id)) fail(`#${id} is never referenced by editor.js`);
}
console.log('ok   the new block controls exist and are wired up');

console.log(failures ? `\n${failures} failing` : '\nEditor markup tests passed.');
process.exit(failures ? 1 : 0);
