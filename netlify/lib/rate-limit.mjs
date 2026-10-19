// Fixed-window rate limits kept in Postgres, since function instances share
// nothing else. A run submission replays up to ten minutes of physics, so a
// player gets a handful a minute; passkey ceremonies are limited per address.
import { HttpError } from './auth.mjs';

/**
 * Counts a hit for `key` and throws 429 once there have been more than `max`
 * in the current `windowSeconds` window.
 * @param {(strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>} sql
 */
export async function rateLimit(sql, key, max, windowSeconds) {
  const [row] = await sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`;
  if (row.count > max) throw new HttpError(429, 'too many requests');
  // Windows that ended long ago are of no use; now and then they are cleared out.
  if (Math.random() < 0.01) await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
}

/** The caller's address, for limits on requests that have no signed-in player. */
export const clientAddress = (req, context) =>
  context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
