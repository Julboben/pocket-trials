// Records one replay per official trail with a search-based bot, so the
// regression tests have real full-trail runs to replay.
//
//   node scripts/record-replays.mjs            record trails whose replay is stale
//   node scripts/record-replays.mjs 03         only trails whose id contains "03"
//   node scripts/record-replays.mjs --force    re-record even replays that still work
//   node scripts/record-replays.mjs --explore  skip the greedy bot and go straight to the explorer
//   REPLAY_MAX_MINUTES=5 node scripts/...      search budget per trail (default 20)
//
// A trail the bot can't figure out can be taught with a human run: save the
// ghost (localStorage `hjulben-ghost-v1:<trail id>@<hash>`) or the output of
// `hjulbenGame.dumpRun()` as tests/replays/human/<trail file>.json. A human
// run that still finishes becomes the replay as is. One that stopped
// finishing, like an old replay broken by a physics change, is repaired
// where it breaks (see repairRun), and failing that guides the explorer.
//
// An existing replay is kept (its outcome refreshed) while it still finishes
// the trail, so editing one trail or tweaking physics only re-records the
// trails that broke. A replay that never finished is kept until its trail
// changes, since the bot would most likely fail again.
//
// The bot tries each input combination held over a short horizon on a copy
// of the ride, keeps the best-scoring one for a few steps, and repeats. When
// every option ahead crashes it backs up a little and searches again. If it
// can't finish a trail, the explorer (see exploreTrail) takes over: it finds
// routes that turn around, roll back for a run-up or launch off kickers.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { simulateRun } from '../js/ride.js';
import { decodeInputs, encodeInputs } from '../js/replay-codec.js';
import { MAX_MINUTES, exploreTrail, recordTrail, repairRun } from './lib/replay-bot.mjs';
import { loadCatalogTrails, repoRoot } from './lib/trails.mjs';

const OUT_DIR = repoRoot + 'tests/replays/';
const HUMAN_DIR = OUT_DIR + 'human/';

const args = process.argv.slice(2);
const force = args.includes('--force');
const exploreOnly = args.includes('--explore');
const filter = args.find(arg => !arg.startsWith('--')) || '';
const trailHash = trail => createHash('sha256').update(JSON.stringify(trail)).digest('hex').slice(0, 16);

function outcomeOf(trail, inputs, seed = 1) {
  const { ride, events } = simulateRun(trail, inputs, { seed });
  const flips = events.filter(event => event.type === 'flip').reduce((sum, event) => sum + event.count, 0);
  return {
    ride,
    outcome: {
      status: ride.status,
      elapsed: Math.round(ride.elapsed * 1000) / 1000,
      collected: ride.collected,
      apples: ride.apples.length,
      crashCause: ride.crashCause,
      flips
    }
  };
}

// Returns the existing replay's inputs if they are still worth keeping.
function reusable(entry, path, hash, references) {
  if (force || !existsSync(path)) return null;
  let replay;
  try { replay = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (replay.trail !== entry.id) return null;
  const inputs = decodeInputs(replay.inputs);
  const { ride, outcome } = outcomeOf(entry.trail, inputs, replay.seed);
  if (ride.status === 'won') return { inputs: inputs.slice(0, ride.steps), reason: 'still finishes' };
  // A human run added since might finish where the bot couldn't.
  const unchanged = !references.length && replay.trailHash === hash && replay.outcome?.status !== 'won'
    && JSON.stringify(outcome) === JSON.stringify(replay.outcome);
  return unchanged ? { inputs, reason: 'never finished, trail unchanged (--force to retry)' } : null;
}

mkdirSync(OUT_DIR, { recursive: true });
const officialTrails = loadCatalogTrails('official');
// Drop replays left behind when an official trail is renamed or removed.
const expected = new Set(officialTrails.map(entry => entry.file.split('/').pop()));
for (const file of readdirSync(OUT_DIR)) {
  if (!file.endsWith('.json') || expected.has(file)) continue;
  unlinkSync(OUT_DIR + file);
  console.log(`${file}: removed, no official trail uses it`);
}
// Runs that once finished the trail: a human run, and the replay if it did.
function referencesFor(file, path) {
  const references = [];
  for (const [source, run] of [['human run', HUMAN_DIR + file], ['previous replay', path]]) {
    if (!existsSync(run)) continue;
    let data;
    try { data = JSON.parse(readFileSync(run, 'utf8')); } catch { console.log(`  ${run}: unreadable, skipped`); continue; }
    if (source === 'previous replay' && data.outcome?.status !== 'won') continue;
    if (Array.isArray(data.inputs) && data.inputs.length) references.push({ source, inputs: decodeInputs(data.inputs) });
  }
  return references;
}

// If nothing finishes, the reference that gets furthest is better than an empty replay.
function furthest(entry, references) {
  let best = { inputs: [], backtracks: 0 }, bestProgress = -Infinity;
  for (const { inputs } of references) {
    const { ride } = outcomeOf(entry.trail, inputs);
    const progress = ride.collected * 1e5 + ride.elapsed;
    if (progress > bestProgress) { bestProgress = progress; best = { inputs: inputs.slice(0, ride.steps), backtracks: 0 }; }
  }
  return best;
}

let kept = 0, recorded = 0;
for (const entry of officialTrails) {
  if (!entry.id.includes(filter)) continue;
  const started = Date.now();
  const file = entry.file.split('/').pop();
  const path = OUT_DIR + file;
  const hash = trailHash(entry.trail);
  const references = referencesFor(file, path);
  const reuse = reusable(entry, path, hash, references);
  let result = reuse;
  for (const { source, inputs } of reuse ? [] : references) {
    const { ride } = outcomeOf(entry.trail, inputs);
    if (ride.status === 'won') { result = { inputs: inputs.slice(0, ride.steps), backtracks: 0, source }; break; }
  }
  // A reference that stopped finishing is patched where it breaks.
  for (const { source, inputs } of result ? [] : references) {
    console.log(`  ${entry.id}: repairing the ${source}`);
    const repaired = repairRun(entry, inputs, { minutes: MAX_MINUTES / references.length });
    if (repaired.done) { result = { ...repaired, source: `repaired ${source}` }; break; }
  }
  // The greedy bot can't use a reference, so a trail that has one goes straight to the explorer.
  if (!result && !exploreOnly && !references.length) result = recordTrail(entry);
  if (!result || (!reuse && outcomeOf(entry.trail, result.inputs).ride.status !== 'won')) {
    if (result) console.log(`  ${entry.id}: the greedy bot didn't finish, exploring`);
    else if (references.length) console.log(`  ${entry.id}: exploring, guided by the ${references.map(ref => ref.source).join(' and ')}`);
    result = exploreTrail(entry, references.map(ref => ref.inputs)) || result || furthest(entry, references);
  }
  const { inputs, backtracks } = result;
  const { ride, outcome } = outcomeOf(entry.trail, inputs);
  const replay = {
    trail: entry.id,
    recordedBy: 'scripts/record-replays.mjs',
    seed: 1,
    trailHash: hash,
    steps: inputs.length,
    outcome,
    inputs: encodeInputs(inputs)
  };
  const text = JSON.stringify(replay) + '\n';
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  const summary = `${ride.status} in ${ride.elapsed.toFixed(2)}s, ${ride.collected}/${ride.apples.length} apples`;
  if (reuse) {
    kept++;
    console.log(`${entry.id}: kept, ${reuse.reason} (${summary})`);
    continue;
  }
  recorded++;
  if (result.source) {
    console.log(`${entry.id}: recorded from the ${result.source}, ${summary}`);
    continue;
  }
  console.log(`${entry.id}: recorded, ${summary}, ${replay.inputs.length} input runs, `
    + `${backtracks} backtracks, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
console.log(`${recorded} recorded, ${kept} kept.`);
