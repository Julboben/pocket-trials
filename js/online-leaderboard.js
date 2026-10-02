// Talks to the online leaderboard. Everything fails quietly so the game
// keeps working offline (and on GitHub Pages) with the local board.
import { isSandbox } from './local-store.js';

const API = '/api/leaderboard';
const REFRESH_MS = 30_000;
export const ONLINE_LEADERBOARD_EVENT = 'hjulben:online-leaderboard';

// Official trails only ('official:<id>@<hash>'); custom trails ('trail:<hash>') stay local.
const TRAIL_RE = /^official:[a-z0-9][a-z0-9-]{0,55}@[0-9a-f]{8}$/;

const boards = new Map();     // trailKey -> runs[]
const lastFetch = new Map();  // trailKey -> timestamp
const pending = new Set();    // trailKeys with a fetch in flight

export const isOnlineTrail = trail => typeof trail === 'string' && TRAIL_RE.test(trail);

const cleanName = raw => String(raw ?? '')
  .replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);

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

/**
 * @param {string} trail
 * @param {{ time: number, rider: string, name: string, playerId: string }} run
 * @returns {Promise<{rank:number,total:number,best:number,improved:boolean}|null>}
 */
export async function submitOnlineRun(trail, { time, rider, name, playerId }) {
  // Sandbox riders are throwaway, so they never reach the shared board.
  if (typeof window === 'undefined' || isSandbox() || !isOnlineTrail(trail) || !name || !playerId) return null;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trail, time, rider, name, playerId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    boards.set(trail, toRuns(data.runs));
    lastFetch.set(trail, Date.now());
    announce(trail);
    return data;
  } catch (_) {
    return null;
  }
}
