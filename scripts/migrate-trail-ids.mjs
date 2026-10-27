// One-off: moves the database to trail ids without the file's number
// ('official:05-windmill-hill' becomes 'official:windmill-hill', see
// catalogId in scripts/generate-trail-catalog.mjs). Run it once when that
// change is deployed, then delete this script.
//
//   DATABASE_URL=... node scripts/migrate-trail-ids.mjs           what would change, nothing written
//   DATABASE_URL=... node scripts/migrate-trail-ids.mjs --apply   change it
//
// The online leaderboard (`runs`): each run moves to the new id. Where a
// player has several runs that land on one new id, they keep the fastest:
// a run under the new id from a browser already on it, or runs from older
// versions of the career, when the same trail had another number. Signed-in riders' cloud saves (`players.save`): best times and
// nisse finds move to the new ids, keeping the better of two. Everything is
// written in one transaction, so it lands whole or not at all; a save the
// player changed while this ran is left out and reported, and running the
// script again picks it up. It changes nothing a second time.
//
// The dry run also lists riders whose open trails, now worked out from the
// trails they finished (unlockedOf in js/state.js), would be fewer than the
// place their save had reached, so nobody loses a trail unnoticed.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { repoRoot } from './lib/trails.mjs';

const OLD_ID = /^(official|bonus):\d+-/;
const renamed = key => key.replace(OLD_ID, '$1:');
const apply = process.argv.includes('--apply');
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to the database to migrate.');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const official = JSON.parse(readFileSync(repoRoot + 'trails/catalog.json', 'utf8')).trails
  .filter(entry => entry.source === 'official').map(entry => entry.id);
if (official.some(id => OLD_ID.test(id))) {
  console.error('trails/catalog.json still has numbered ids: run npm run trails first.');
  process.exit(1);
}

/** Moves an object's keys to the new ids; where two land on one, `keep` picks the value. */
function moveKeys(object, keep) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return { value: object, moved: 0 };
  const value = {};
  let moved = 0;
  for (const [key, entry] of Object.entries(object)) {
    const next = renamed(key);
    if (next !== key) moved++;
    value[next] = next in value ? keep(value[next], entry) : entry;
  }
  return { value, moved };
}

// The same rule as unlockedOf in js/state.js, on the catalog's order.
function openTrails(bestTimes) {
  const keys = Object.keys(bestTimes || {});
  let open = 0;
  official.forEach((id, index) => {
    if (keys.some(key => key.startsWith(id + '@'))) open = Math.max(open, Math.min(index + 1, official.length - 1));
  });
  return open;
}

// --- The leaderboard -------------------------------------------------------------

const runs = await sql`select trail, player_id, time_ms from runs where trail ~ '^(official|bonus):[0-9]+-'`;
// Runs that land on the same new id for one player: all but the fastest go.
const extra = await sql`
  select count(*)::int as count from (
    select row_number() over (partition by regexp_replace(trail, '^(official|bonus):[0-9]+-', '\\1:'), player_id
                              order by time_ms, updated_at) as rank
    from runs) ranked
  where rank > 1`;
console.log(`Leaderboard: ${runs.length} runs to move to the new ids; ${extra[0].count} slower runs that land on the same id as a faster one by the same player go.`);

// --- Cloud saves -----------------------------------------------------------------

const players = await sql`select id, name, save, save_updated_at::text as stamp from players where save is not null`;
const changes = [];
for (const player of players) {
  const best = moveKeys(player.save.bestTimes, (a, b) => Math.min(a, b));
  // A nisse find is the time it was found: the earlier one stands.
  const nisse = moveKeys(player.save.nisse, (a, b) => Math.min(a, b));
  if (!best.moved && !nisse.moved) continue;
  const save = { ...player.save, bestTimes: best.value, nisse: nisse.value };
  changes.push({ player, save, moved: best.moved + nisse.moved });
  const reached = Math.floor(Number(player.save.unlocked)) || 0;
  const open = openTrails(save.bestTimes);
  if (open < reached) console.log(`  ${player.name}: had reached trail ${reached + 1}, will have trails up to ${open + 1} open (the ones after aren't finished).`);
}
console.log(`Cloud saves: ${changes.length} of ${players.length} to update (${changes.reduce((sum, change) => sum + change.moved, 0)} best times and nisse finds moved).`);

if (!apply) {
  console.log('Dry run: nothing written. Run again with --apply to migrate.');
  process.exit(0);
}

const pattern = '^(official|bonus):[0-9]+-';
const results = await sql.transaction([
  // Of the runs a player has that land on one new id, only the fastest stays
  // (the earliest of equal times), so the renaming can't clash.
  sql`delete from runs r using (
        select trail, player_id, row_number() over (partition by regexp_replace(trail, ${pattern}, '\\1:'), player_id
                                                    order by time_ms, updated_at) as rank
        from runs) ranked
      where r.trail = ranked.trail and r.player_id = ranked.player_id and ranked.rank > 1`,
  sql`update runs set trail = regexp_replace(trail, ${pattern}, '\\1:') where trail ~ ${pattern}`,
  ...changes.map(({ player, save }) => sql`
    update players set save = ${JSON.stringify(save)}::jsonb
    where id = ${player.id} and save_updated_at is not distinct from ${player.stamp}::timestamptz
    returning id`),
]);
const updated = results.slice(2).filter(rows => rows.length).length;
console.log(`Migrated: the leaderboard, and ${updated} of ${changes.length} cloud saves.`);
if (updated < changes.length) console.log('Some saves changed while this ran: run it again to move them too.');
