// Talks to the online leaderboard. Everything fails quietly so the game
// keeps working offline (and on GitHub Pages) with the local board.
import { isSandbox } from './local-store.js';
import { cleanRiderName as cleanName } from './rider-name.js';

const API = '/api/leaderboard';
const REFRESH_MS = 30_000;
export const ONLINE_LEADERBOARD_EVENT = 'hjulben:online-leaderboard';

// Official trails only ('official:<id>@<hash>'); custom trails ('trail:<hash>') stay local.
const TRAIL_RE = /^official:[a-z0-9][a-z0-9-]{0,55}@[0-9a-f]{8}$/;

const boards = new Map();     // trailKey -> runs[]
const lastFetch = new Map();  // trailKey -> timestamp
const pending = new Set();    // trailKeys with a fetch in flight

export const isOnlineTrail = trail => typeof trail === 'string' && TRAIL_RE.test(trail);


function toRuns(runs) {
  return (Array.isArray(runs) ? runs : [])
    .map(r => ({
      time: Number(r.time),
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

export function cachedOnlineBoard(trail) {
  return boards.get(trail) ?? null;
}

/** True while the first fetch for a trail is in flight, before there is anything to show. */
export function isOnlineBoardLoading(trail) {
  return pending.has(trail) && !boards.has(trail);
}

/** Fetches in the background (throttled) and fires ONLINE_LEADERBOARD_EVENT when the fetch settles. */
export function refreshOnlineBoard(trail, force = false) {
  if (typeof window === 'undefined' || !isOnlineTrail(trail)) return;
  const now = Date.now();
  if (!force && now - (lastFetch.get(trail) ?? 0) < REFRESH_MS) return;
  lastFetch.set(trail, now);
  pending.add(trail);
  fetch(`${API}?trail=${encodeURIComponent(trail)}`, { signal: AbortSignal.timeout(5000) })
    .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
    .then(data => { boards.set(trail, toRuns(data.runs)); })
    .catch(() => {})
    .finally(() => { pending.delete(trail); announce(trail); });
}

const worldGhosts = new Map();  // trailKey -> Promise<ghost | null>

/**
 * The world's fastest verified run on a trail, in ghost format plus who rode
 * it. Cached for the session, so restarts don't refetch it.
 * @param {string} trail
 * @returns {Promise<{ name: string, rider: string, time: number, splits: number[], startStep: number, seed: number, inputs: number[][], physics: number } | null>}
 */
export function fetchWorldGhost(trail) {
  if (typeof window === 'undefined' || isSandbox() || !isOnlineTrail(trail)) return Promise.resolve(null);
  if (!worldGhosts.has(trail)) {
    worldGhosts.set(trail, fetch(`${API}?ghost=1&trail=${encodeURIComponent(trail)}`, { signal: AbortSignal.timeout(8000) })
      .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(({ ghost }) => {
        const replay = ghost?.replay;
        if (!replay || !Number.isFinite(replay.time) || !Array.isArray(replay.inputs)) return null;
        return { ...replay, name: cleanName(ghost.name) || null, rider: ghost.rider === 'female' ? 'female' : 'male' };
      })
      .catch(() => { worldGhosts.delete(trail); return null; }));
  }
  return worldGhosts.get(trail);
}

/**
 * Sends a finished run's inputs; the server replays them to get the time.
 * @param {string} trail
 * @param {{ rider: string, token: string, run: { inputs: number[][], seed: number, physics: number } }} submission
 * @returns {Promise<{rank:number,total:number,time:number,best:number,improved:boolean}|{signedOut:true}|null>}
 */
export async function submitOnlineRun(trail, { rider, token, run }) {
  // Sandbox riders are throwaway, so they never reach the shared board.
  if (typeof window === 'undefined' || isSandbox() || !isOnlineTrail(trail) || !token) return null;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ trail, rider, run }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) return { signedOut: true };
    if (!res.ok) return null;
    const data = await res.json();
    if (data.rank === 1) worldGhosts.delete(trail);
    boards.set(trail, toRuns(data.runs));
    lastFetch.set(trail, Date.now());
    announce(trail);
    return data;
  } catch (_) {
    return null;
  }
}
