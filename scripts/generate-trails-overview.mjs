// Writes TRAILS.md, the overview of the career: every official trail in its
// place, grouped by world, with what it teaches, what is new to look at, its
// description, its gold time and the replay bot's time, then the bonus
// trails. Everything comes from the trail files (their `lesson`, `alsoNew`
// and `world`), trails/worlds.json and the replays, so moving, adding or
// editing a trail updates it; nothing in it is kept by hand.
//
//   node scripts/generate-trails-overview.mjs           write TRAILS.md
//   node scripts/generate-trails-overview.mjs --check   fail if it is out of date
//
// scripts/generate-trail-catalog.mjs runs it too, so `npm run trails` and the
// dev server keep it current.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const outputPath = join(root, 'TRAILS.md');
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));

/** A trail's line: number, name, lesson, what's new, and its times. */
function trailLine(marker, entry, trail) {
  const replayPath = `tests/replays/${entry.id.slice(entry.id.indexOf(':') + 1)}.json`;
  const bot = existsSync(join(root, replayPath)) ? read(replayPath).outcome : null;
  const times = [
    Number.isFinite(trail.medals?.gold) && `gold ${trail.medals.gold} s`,
    bot?.status === 'won' && `bot ${bot.elapsed.toFixed(1)} s`,
  ].filter(Boolean);
  const parts = [
    `- **${marker}. ${trail.name}:**`,
    trail.lesson ?? '*What it teaches isn\'t written yet (`lesson`).*',
    trail.alsoNew && `*Also new:* ${trail.alsoNew}`,
    times.length && `(${times.join(', ')})`,
  ].filter(Boolean);
  const description = trail.description?.trim();
  return parts.join(' ') + (description ? `\n\n  > ${description.replace(/\s*\n\s*/g, ' ')}\n` : '\n');
}

export function trailsOverview() {
  const catalog = read('trails/catalog.json').trails;
  const worlds = read('trails/worlds.json').worlds;
  const about = new Map(worlds.map(world => [world.name, world.about]));
  const warnings = [];
  const lines = [
    '# Hjulben – Trails',
    '',
    'The career as it stands: every official trail in its place, grouped by world, with what it teaches, what is new to look at, its description, its gold time and the replay bot\'s time. How the career is designed, and the rules every trail follows, are in [TRAILS_GUIDE.md](TRAILS_GUIDE.md).',
    '',
    'Written by `scripts/generate-trails-overview.mjs` from the trail files, so don\'t edit it by hand: what a trail teaches, what is new in it and its world are its `lesson`, `alsoNew` and `world` (see "Other fields" in TRAIL_FORMAT.md), and each world\'s line is in `trails/worlds.json`. `npm run trails` and the dev server write it again when a trail changes.',
    '',
  ];
  const official = catalog.filter(entry => entry.source === 'official');
  const seen = new Set();
  let current;
  official.forEach((entry, index) => {
    const trail = read('trails/' + entry.file);
    const world = trail.world ?? null;
    if (world !== current) {
      current = world;
      if (world && !about.has(world)) warnings.push(`${trail.name} is in "${world}", which isn't in trails/worlds.json.`);
      if (seen.has(world)) warnings.push(`"${world ?? 'no world'}" comes back at ${trail.name}: its trails aren't together.`);
      seen.add(world);
      lines.push(`## ${world ?? 'Not in a world yet'}`, '');
      if (about.get(world)) lines.push(`*${about.get(world)}*`, '');
    }
    lines.push(trailLine(String(index + 1).padStart(2, '0'), entry, trail));
  });
  const bonus = catalog.filter(entry => entry.source === 'bonus');
  if (bonus.length) {
    lines.push('## Bonus trails', '');
    bonus.forEach((entry, index) => lines.push(trailLine(`B${String(index + 1).padStart(2, '0')}`, entry, read('trails/' + entry.file))));
  }
  for (const world of worlds) if (!seen.has(world.name)) warnings.push(`"${world.name}" in trails/worlds.json has no trails.`);
  if (warnings.length) lines.push('## To look at', '', ...warnings.map(warning => `- ${warning}`), '');
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', warnings };
}

/** Writes TRAILS.md when it has changed. Returns the warnings. */
export function writeTrailsOverview() {
  const { text, warnings } = trailsOverview();
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (text !== current) writeFileSync(outputPath, text);
  return warnings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
    if (trailsOverview().text !== current) {
      console.error('TRAILS.md is out of date. Run `npm run trails` and commit the result.');
      process.exit(1);
    }
    console.log('TRAILS.md: up to date');
  } else {
    const warnings = writeTrailsOverview();
    console.log(`TRAILS.md written${warnings.length ? `, with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to look at` : ''}.`);
  }
}
