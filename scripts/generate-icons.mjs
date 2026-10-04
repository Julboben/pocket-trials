// Builds css/icons.css from the pixel art in icons/pixel-icons.mjs.
//
//   node scripts/generate-icons.mjs          rewrite css/icons.css if needed
//   node scripts/generate-icons.mjs --check  fail if it is out of date (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import icons from '../icons/pixel-icons.mjs';

const check = process.argv.includes('--check');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = join(root, 'css', 'icons.css');

function fail(message) {
  console.error(`icons: ${message}`);
  process.exit(1);
}

/** @returns {string[]} the rows of a grid, with the indentation removed */
function parseGrid(name, text) {
  const rows = text.split('\n').map(row => row.trim()).filter(Boolean);
  if (!rows.length) fail(`"${name}" is empty`);
  if (rows.some(row => row.length !== rows[0].length)) fail(`"${name}" has rows of different lengths`);
  return rows;
}

const mirror = rows => rows.map(row => [...row].reverse().join(''));
const rotate = rows => [...rows[0]].map((_, x) => rows.map(row => row[x]).reverse().join(''));

const resolved = new Map();
function resolve(name) {
  if (resolved.has(name)) return resolved.get(name);
  const entry = icons[name];
  if (!entry) fail(`unknown icon "${name}"`);
  let icon;
  if (typeof entry === 'string') icon = { rows: parseGrid(name, entry), palette: {} };
  else if (entry.grid) icon = { rows: parseGrid(name, entry.grid), palette: entry.palette || {} };
  else if (entry.mirror) {
    const source = resolve(entry.mirror);
    icon = { ...source, rows: mirror(source.rows) };
  } else if (entry.rotate) {
    const source = resolve(entry.rotate);
    let rows = source.rows;
    for (let turn = 0; turn < (entry.turns ?? 1); turn++) rows = rotate(rows);
    icon = { ...source, rows };
  } else fail(`"${name}" needs a grid, mirror or rotate`);
  for (const char of new Set(icon.rows.join(''))) {
    if (char !== '.' && char !== '#' && !(char in icon.palette)) fail(`"${name}" uses "${char}", which is not in its palette`);
  }
  if (icon.rows.join('').includes('#') && Object.keys(icon.palette).length) {
    fail(`"${name}" mixes # with palette colours; give every pixel a palette colour`);
  }
  resolved.set(name, icon);
  return icon;
}

/** One path per colour, one rectangle per horizontal run of pixels. */
function svg({ rows, palette }) {
  const runs = new Map();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const char = row[x];
      let end = x + 1;
      while (row[end] === char) end++;
      if (char !== '.') runs.set(char, (runs.get(char) || '') + `M${x} ${y}h${end - x}v1H${x}z`);
      x = end;
    }
  });
  const paths = [...runs].map(([char, d]) => `<path${palette[char] ? ` fill='${palette[char]}'` : ''} d='${d}'/>`).join('');
  const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${rows[0].length} ${rows.length}' shape-rendering='crispEdges'>${paths}</svg>`;
  return `url("data:image/svg+xml,${markup.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`;
}

const names = Object.keys(icons);
const urls = names.map(name => `    --icon-${name}: ${svg(resolve(name))};`);
const rules = names.map(name => {
  const { rows, palette } = resolve(name);
  const selector = `[data-icon="${name}"],\n[data-icon-before="${name}"]::before,\n[data-icon-after="${name}"]::after`;
  // Colour icons are drawn as they are; the rest are masks filled with the text colour.
  const colour = Object.keys(palette).length
    ? '\n    background: var(--icon) center / 100% 100% no-repeat;\n    -webkit-mask: none;\n    mask: none;'
    : '';
  return `${selector} {\n    --icon: var(--icon-${name});\n    --icon-w: ${rows[0].length};\n    --icon-h: ${rows.length};${colour}\n}`;
});

const css = `/* Generated from icons/pixel-icons.mjs by scripts/generate-icons.mjs; do not edit.
   Icons: ${names.join(', ')}. */
:root {
${urls.join('\n')}
}
[data-icon],
[data-icon-before]::before,
[data-icon-after]::after {
    display: inline-block;
    flex: none;
    width: calc(var(--icon-w) * var(--px, 2px));
    height: calc(var(--icon-h) * var(--px, 2px));
    vertical-align: middle;
    background: currentColor;
    -webkit-mask: var(--icon) center / 100% 100% no-repeat;
    mask: var(--icon) center / 100% 100% no-repeat;
}
[data-icon-before]::before {
    content: "";
    margin: -0.15em 0.6em 0 0;
}
[data-icon-after]::after {
    content: "";
    margin: -0.15em 0 0 0.6em;
}
${rules.join('\n')}
`;

let current = '';
try { current = readFileSync(cssPath, 'utf8').replaceAll('\r\n', '\n'); } catch {}
if (current === css) {
  console.log(`css/icons.css: up to date, ${names.length} icons`);
  process.exit(0);
}
if (check) fail('css/icons.css is out of date. Run `npm run icons` and commit the result.');
writeFileSync(cssPath, css);
console.log(`css/icons.css: updated, ${names.length} icons`);
