// Database access for the Netlify functions. The schema migrates itself on the
// first query of each function instance, so there is nothing to run by hand.
import { neon } from '@neondatabase/serverless';

let sql = null;
let ready = null;

// Idempotent. A pre-accounts `runs` table (no replay column) holds unverified
// times, so it is renamed out of the way and kept, rather than deleted.
const SCHEMA = `
do $$
begin
  perform pg_advisory_xact_lock(727274);
  if exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'runs')
     and not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'runs' and column_name = 'replay') then
    execute format('alter table runs rename to %I', 'runs_legacy_' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;

  create table if not exists players (
    id uuid constraint players_pkey primary key,
    name text not null,
    name_key text not null constraint players_name_key_unique unique,
    rider text not null default 'male',
    save jsonb,
    save_updated_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table if not exists credentials (
    id text constraint credentials_pkey primary key,
    player_id uuid not null constraint credentials_player_fkey references players(id) on delete cascade,
    public_key text not null,
    counter bigint not null default 0,
    transports text[] not null default '{}',
    created_at timestamptz not null default now(),
    last_used_at timestamptz
  );
  create index if not exists credentials_player_idx on credentials (player_id);

  create table if not exists runs (
    trail text not null,
    player_id uuid not null constraint runs_verified_player_fkey references players(id) on delete cascade,
    rider text not null,
    time_ms integer not null,
    replay jsonb not null,
    updated_at timestamptz not null default now(),
    constraint runs_verified_pkey primary key (trail, player_id)
  );
  create index if not exists runs_verified_rank_idx on runs (trail, time_ms, updated_at);
end $$`;

/** Swaps the database for tests. `fake` must work as a tagged template and have `.query(text, params)`. */
export function useSql(fake) {
  sql = fake;
  ready = null;
}

/** The tagged-template SQL client, with the schema in place. */
export async function db() {
  sql ??= neon(process.env.DATABASE_URL);
  ready ??= sql.query(SCHEMA).catch(error => { ready = null; throw error; });
  await ready;
  return sql;
}
