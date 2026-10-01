// Online leaderboard API: GET /api/leaderboard?trail=ID  |  POST /api/leaderboard
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const TOP = 10;
const TRAIL_RE = /^(official:)?[a-z0-9][a-z0-9-]{0,55}$/;   // official trails only; custom 'trail:<hash>' stays local
const NAME_RE = /^[\p{L}\p{N} _.\-]{1,16}$/u;       // safe to put in innerHTML
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RIDERS = new Set(['male', 'female']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function top(trail) {
  const rows = await sql`
    select name, rider, time_ms, updated_at from runs
    where trail = ${trail}
    order by time_ms asc, updated_at asc
    limit ${TOP}`;
  return rows.map(r => ({
    name: r.name, rider: r.rider, time: r.time_ms / 1000, date: new Date(r.updated_at).getTime(),
  }));
}

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const trail = new URL(req.url).searchParams.get('trail') ?? '';
      if (!TRAIL_RE.test(trail)) return json({ error: 'bad trail' }, 400);
      return json({ runs: await top(trail) });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

      const trail = String(body.trail ?? '');
      const playerId = String(body.playerId ?? '');
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
      const rider = RIDERS.has(body.rider) ? body.rider : 'male';
      const timeMs = Math.round(Number(body.time) * 1000);

      if (!TRAIL_RE.test(trail) || !UUID_RE.test(playerId) || !NAME_RE.test(name)) {
        return json({ error: 'invalid data' }, 400);
      }
      if (!Number.isInteger(timeMs) || timeMs < 1000 || timeMs > 3_600_000) {
        return json({ error: 'invalid time' }, 400);
      }

      // Keep only each player's best time per trail.
      const [best] = await sql`
        insert into runs (trail, player_id, name, rider, time_ms)
        values (${trail}, ${playerId}, ${name}, ${rider}, ${timeMs})
        on conflict (trail, player_id) do update set
          name       = excluded.name,
          rider      = case when excluded.time_ms < runs.time_ms then excluded.rider else runs.rider end,
          updated_at = case when excluded.time_ms < runs.time_ms then now() else runs.updated_at end,
          time_ms    = least(runs.time_ms, excluded.time_ms)
        returning time_ms`;

      const [{ rank, total }] = await sql`
        select (count(*) filter (where time_ms < ${best.time_ms}))::int + 1 as rank,
               count(*)::int as total
        from runs where trail = ${trail}`;

      return json({
        rank, total,
        best: best.time_ms / 1000,
        improved: best.time_ms === timeMs,
        runs: await top(trail),
      });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: 'server error' }, 500);
  }
};

export const config = { path: '/api/leaderboard' };
