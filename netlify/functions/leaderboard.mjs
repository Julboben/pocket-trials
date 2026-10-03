// Online leaderboard API.
//   GET  /api/leaderboard?trail=ID                                   -> { runs }
//   POST /api/leaderboard  { trail, rider, run }  (Bearer token)     -> { rank, total, time, best, improved, runs }
// `run` is the ride's recorded inputs ({ inputs, seed, physics }). The server
// replays them and takes the time from its own simulation, never the client's.
import { db } from '../lib/db.mjs';
import { HttpError, json, respond, readBody, requirePlayer } from '../lib/auth.mjs';
import { TRAIL_RE, verifyRun } from '../lib/verify-run.mjs';

const TOP = 10;
const RIDERS = new Set(['male', 'female']);

async function top(sql, trail) {
  const rows = await sql`
    select p.name, r.rider, r.time_ms, r.updated_at
    from runs r join players p on p.id = r.player_id
    where r.trail = ${trail}
    order by r.time_ms asc, r.updated_at asc
    limit ${TOP}`;
  return rows.map(r => ({
    name: r.name, rider: r.rider, time: r.time_ms / 1000, date: new Date(r.updated_at).getTime(),
  }));
}

async function list(req) {
  const trail = new URL(req.url).searchParams.get('trail') ?? '';
  if (!TRAIL_RE.test(trail)) throw new HttpError(400, 'bad trail');
  return json({ runs: await top(await db(), trail) });
}

async function submit(req) {
  const playerId = requirePlayer(req);
  const body = await readBody(req, 1_000_000);
  const trail = String(body.trail ?? '');
  const rider = RIDERS.has(body.rider) ? body.rider : 'male';
  const { timeMs, replay } = await verifyRun(trail, body.run, new URL(req.url).origin);

  const sql = await db();
  const [player] = await sql`select 1 from players where id = ${playerId}`;
  if (!player) throw new HttpError(401, 'not signed in');

  // Keep only each player's best run per trail, with its replay for the ghost.
  const [best] = await sql`
    insert into runs (trail, player_id, rider, time_ms, replay)
    values (${trail}, ${playerId}, ${rider}, ${timeMs}, ${JSON.stringify(replay)}::jsonb)
    on conflict (trail, player_id) do update set
      rider      = case when excluded.time_ms < runs.time_ms then excluded.rider else runs.rider end,
      replay     = case when excluded.time_ms < runs.time_ms then excluded.replay else runs.replay end,
      updated_at = case when excluded.time_ms < runs.time_ms then now() else runs.updated_at end,
      time_ms    = least(runs.time_ms, excluded.time_ms)
    returning time_ms`;

  const [{ rank, total }] = await sql`
    select (count(*) filter (where time_ms < ${best.time_ms}))::int + 1 as rank,
           count(*)::int as total
    from runs where trail = ${trail}`;

  return json({
    rank, total,
    time: timeMs / 1000,
    best: best.time_ms / 1000,
    improved: best.time_ms === timeMs,
    runs: await top(sql, trail),
  });
}

export default req => respond(async () => {
  if (req.method === 'GET') return list(req);
  if (req.method === 'POST') return submit(req);
  throw new HttpError(405, 'method not allowed');
});

export const config = { path: '/api/leaderboard' };
