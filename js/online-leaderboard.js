// Talks to the online leaderboard. Everything fails quietly so the game
// keeps working offline (and on GitHub Pages) with the local board.
import { isSandbox } from './local-store.js';
import { cleanRiderName as cleanName } from './rider-name.js';
import { legacyRider, lookOf } from './cosmetics.js';

const API = '/api/leaderboard';
const REFRESH_MS = 30_000;
export const ONLINE_LEADERBOARD_EVENT = 'hjulben:online-leaderboard';

// Shipped trails only ('official:<id>@<hash>', 'bonus:<id>@<hash>'); custom trails ('trail:<hash>') stay local.
const TRAIL_RE = /^(official|bonus):[a-z0-9][a-z0-9-]{0,55}@[0-9a-f]{8}$/;

const boards = new Map();     // trailKey -> runs[]
const signatures = new Map(); // trailKey -> JSON of runs, to spot boards that didn't change
const lastFetch = new Map();  // trailKey -> timestamp
const pending = new Set();    // trailKeys with a fetch in flight

export const isOnlineTrail = trail => typeof trail === 'string' && TRAIL_RE.test(trail);


function toRuns(runs) {
  return (Array.isArray(runs) ? runs : [])
    .map(r => ({
      time: Number(r.time),
      look: lookOf(r),
      rider: r.rider === 'female' ? 'female' : 'male',
      name: cleanName(r.name) || null,
      slot: null, saveId: null,
      date: Number(r.date) || null,
    }))
    .filter(r => Number.isFinite(r.time) && r.time > 0);
}

function announce(trail) {
  window.dispatchEvent(new CustomEvent(ONLINE_LEADERBOARD_EVENT, { detail: { trail } }));
}

/**
 * Stores a fresh board and returns whether it differs from the one before.
 * A new world best also drops the cached world ghost, so the next ride races it.
 */
function setBoard(trail, runs) {
  const signature = JSON.stringify(runs);
  if (signatures.get(trail) === signature) return false;
  const before = boards.get(trail)?.[0];
  if (before && (before.time !== runs[0]?.time || before.name !== runs[0]?.name)) dropWorldGhost(trail);
  boards.set(trail, runs);
  signatures.set(trail, signature);
  return true;
}

export function cachedOnlineBoard(trail) {
  return boards.get(trail) ?? null;
}

/** True while the first fetch for a trail is in flight, before there is anything to show. */
export function isOnlineBoardLoading(trail) {
  return pending.has(trail) && !boards.has(trail);
}

/**
 * Fetches in the background unless the board is younger than `maxAge` ms or
 * already on its way. Fires ONLINE_LEADERBOARD_EVENT when the board changed,
 * or when the first fetch settles so a loading board can stop waiting.
 */
export function refreshOnlineBoard(trail, maxAge = REFRESH_MS) {
  if (typeof window === 'undefined' || !isOnlineTrail(trail) || pending.has(trail)) return;
  const now = Date.now();
  if (now - (lastFetch.get(trail) ?? 0) < maxAge) return;
  lastFetch.set(trail, now);
  pending.add(trail);
  const first = !boards.has(trail);
  let changed = false;
  fetch(`${API}?trail=${encodeURIComponent(trail)}`, { signal: AbortSignal.timeout(5000) })
    .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
    .then(data => { changed = setBoard(trail, toRuns(data.runs)); })
    .catch(() => {})
    .finally(() => {
      pending.delete(trail);
      if (changed || first) announce(trail);
    });
}

const worldGhosts = new Map();  // trailKey -> Promise<ghost | null>
const settledGhosts = new Map(); // trailKey -> ghost | null, once its fetch has succeeded

function dropWorldGhost(trail) {
  worldGhosts.delete(trail);
  settledGhosts.delete(trail);
}

/** The cached world ghost: undefined until fetched (or after a new world best), null when there is none. */
export const settledWorldGhost = trail => settledGhosts.get(trail);

/**
 * The world's fastest verified run on a trail, in ghost format plus who rode
 * it. Cached until the board shows a new world best, so restarts don't refetch it.
 * @param {string} trail
 * @returns {Promise<{ name: string, look: import('./cosmetics.js').Look, rider: string, time: number, splits: number[], startStep: number, seed: number, inputs: number[][], physics: number } | null>}
 */
export function fetchWorldGhost(trail) {
  if (typeof window === 'undefined' || isSandbox() || !isOnlineTrail(trail)) return Promise.resolve(null);
  if (!worldGhosts.has(trail)) {
    const request = fetch(`${API}?ghost=1&trail=${encodeURIComponent(trail)}`, { signal: AbortSignal.timeout(8000) })
      .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(({ ghost }) => {
        const replay = ghost?.replay;
        const world = !replay || !Number.isFinite(replay.time) || !Array.isArray(replay.inputs) ? null
          : { ...replay, name: cleanName(ghost.name) || null, look: lookOf(ghost), rider: ghost.rider === 'female' ? 'female' : 'male' };
        // A new world best may have dropped this request while it was out.
        if (worldGhosts.get(trail) === request) settledGhosts.set(trail, world);
        return world;
      })
      .catch(() => { if (worldGhosts.get(trail) === request) worldGhosts.delete(trail); return null; });
    worldGhosts.set(trail, request);
  }
  return worldGhosts.get(trail);
}

/**
 * Sends a finished run's inputs; the server replays them to get the time.
 * @param {string} trail
 * @param {{ look: import('./cosmetics.js').Look, token: string, run: { inputs: number[][], seed: number, physics: number } }} submission
 *   `look` is shown with the run; `rider` is still sent for servers from before looks.
 * @returns {Promise<{rank:number,total:number,time:number,best:number,improved:boolean,ahead?:{name:string,time:number}|null,behind?:{name:string,time:number}|null}|{signedOut:true}|{rejected:true}|null>}
 */
export async function submitOnlineRun(trail, { look, token, run }) {
  // Sandbox riders are throwaway, so they never reach the shared board.
  if (typeof window === 'undefined' || isSandbox() || !isOnlineTrail(trail) || !token) return null;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ trail, look, rider: legacyRider(look), run }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) return { signedOut: true };
    // The server's replay of the inputs never reached the finish.
    if (res.status === 422) return { rejected: true };
    if (!res.ok) return null;
    const data = await res.json();
    // A new world best also drops the old ghost when no board was cached to compare with.
    if (data.rank === 1 && data.improved) dropWorldGhost(trail);
    if (setBoard(trail, toRuns(data.runs))) announce(trail);
    lastFetch.set(trail, Date.now());
    return data;
  } catch (_) {
    return null;
  }
}
