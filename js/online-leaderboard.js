// Talks to the online leaderboard. Everything fails quietly so the game
// keeps working offline (and on GitHub Pages) with the local board.
import { isSandbox, store } from './local-store.js';
import { cleanRiderName as cleanName } from './rider-name.js';
import { legacyRider, lookOf } from './cosmetics.js';
import { noteRenewal } from './account.js';

const API = '/api/leaderboard';
const REFRESH_MS = 30_000;
// How soon a board is asked for again after the server couldn't be reached.
const RETRY_MS = 5_000;
export const ONLINE_LEADERBOARD_EVENT = 'hjulben:online-leaderboard';

// Shipped trails only ('official:<id>@<hash>', 'bonus:<id>@<hash>'); custom trails ('trail:<hash>') stay local.
const TRAIL_RE = /^(official|bonus):[a-z0-9][a-z0-9-]{0,55}@[0-9a-f]{8}$/;

const boards = new Map();     // trailKey -> runs[]
const signatures = new Map(); // trailKey -> JSON of runs, to spot boards that didn't change
const lastFetch = new Map();  // trailKey -> timestamp of the last fetch that got an answer
const failed = new Map();     // trailKey -> timestamp of the last fetch that didn't
const pending = new Set();    // trailKeys with a fetch in flight

export const isOnlineTrail = trail => typeof trail === 'string' && TRAIL_RE.test(trail);

/**
 * How the world board for a trail stands: 'loading' before its first answer,
 * 'failed' when the server couldn't be reached last time (whatever is shown
 * is then the device's own board or an older world board), otherwise 'ok'.
 * @returns {'loading' | 'failed' | 'ok'}
 */
export function boardStatus(trail) {
  if (failed.has(trail) && (failed.get(trail) ?? 0) > (lastFetch.get(trail) ?? 0)) return 'failed';
  return boards.has(trail) ? 'ok' : 'loading';
}


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
  // A fetch that failed is tried again sooner, so a reconnect shows soon.
  const since = Math.max(lastFetch.get(trail) ?? 0, failed.get(trail) ?? 0);
  if (now - since < (boardStatus(trail) === 'failed' ? Math.min(RETRY_MS, maxAge) : maxAge)) return;
  pending.add(trail);
  const first = !boards.has(trail);
  const wasFailed = boardStatus(trail) === 'failed';
  let changed = false, answered = false;
  fetch(`${API}?trail=${encodeURIComponent(trail)}`, { signal: AbortSignal.timeout(5000) })
    .then(res => (res.ok ? res.json() : Promise.reject(res.status)))
    .then(data => { answered = true; changed = setBoard(trail, toRuns(data.runs)); })
    .catch(() => {})
    .finally(() => {
      pending.delete(trail);
      if (answered) { lastFetch.set(trail, Date.now()); failed.delete(trail); }
      else failed.set(trail, Date.now());
      // A board that stopped or started failing is shown differently too.
      if (changed || first || answered === wasFailed) announce(trail);
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
 * @typedef {{ inputs: number[][], seed: number, physics: number }} RunInputs
 * @typedef {{rank:number,total:number,time:number,best:number,improved:boolean,ahead?:{name:string,time:number}|null,behind?:{name:string,time:number}|null}} Standing
 */

/**
 * Sends a finished run's inputs; the server replays them to get the time.
 * `rejected` means the server won't have the run (its replay didn't finish,
 * it is too long, or the trail or game version is out of date), `failed`
 * that it couldn't be reached: the run is worth sending again.
 * @param {string} trail
 * @param {{ look: import('./cosmetics.js').Look, token: string, playerId?: string, run: RunInputs }} submission
 *   `look` is shown with the run; `rider` is still sent for servers from before looks.
 * @returns {Promise<Standing | { signedOut: true } | { rejected: true, reason: string } | { failed: true } | null>}
 */
export async function submitOnlineRun(trail, { look, token, playerId, run }) {
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
    if ([400, 409, 422].includes(res.status)) {
      const { error } = await res.json().catch(() => ({ error: '' }));
      return { rejected: true, reason: String(error || 'rejected') };
    }
    if (!res.ok) return { failed: true };
    const data = await res.json();
    noteRenewal(playerId ?? null, data);
    // A new world best also drops the old ghost when no board was cached to compare with.
    if (data.rank === 1 && data.improved) dropWorldGhost(trail);
    if (setBoard(trail, toRuns(data.runs))) announce(trail);
    lastFetch.set(trail, Date.now());
    failed.delete(trail);
    return data;
  } catch (_) {
    return { failed: true };
  }
}

// --- Runs waiting to be sent --------------------------------------------------
// A run finished offline, or whose upload broke off, is kept until the server
// takes it. Sending a run twice is harmless: the server keeps the fastest.

const PENDING_RUNS_KEY = 'hjulben-pending-runs-v1';
const MAX_PENDING_RUNS = 20;

function readPendingRuns() {
  try {
    const list = JSON.parse(store().getItem(PENDING_RUNS_KEY) || '[]');
    return Array.isArray(list) ? list.filter(item => item && isOnlineTrail(item.trail) && item.run && typeof item.playerId === 'string') : [];
  } catch (_) {
    return [];
  }
}

function writePendingRuns(list) {
  try {
    if (list.length) store().setItem(PENDING_RUNS_KEY, JSON.stringify(list));
    else store().removeItem(PENDING_RUNS_KEY);
  } catch (_) {}
}

/** Keeps a run to send later. A rider's older run on the same trail makes way for it. */
export function queuePendingRun(trail, { look, playerId, run }) {
  if (typeof window === 'undefined' || isSandbox() || !isOnlineTrail(trail) || !playerId) return;
  const list = readPendingRuns().filter(item => !(item.trail === trail && item.playerId === playerId));
  list.push({ trail, playerId, look, run, at: Date.now() });
  writePendingRuns(list.slice(-MAX_PENDING_RUNS));
}

export const pendingRunCount = () => readPendingRuns().length;

/** Forgets a rider's waiting runs, when the rider is gone. */
export function dropPendingRuns(playerId) {
  writePendingRuns(readPendingRuns().filter(item => item.playerId !== playerId));
}

let flushing = null;

/**
 * Sends every waiting run whose rider is signed in, one at a time.
 * `tokenFor` gives a rider's current session token, or null.
 * @param {(playerId: string) => string | null} tokenFor
 * @returns {Promise<number>} how many runs the server took
 */
export function flushPendingRuns(tokenFor) {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of readPendingRuns()) {
      const token = tokenFor(item.playerId);
      if (!token) continue;
      const result = await submitOnlineRun(item.trail, { look: item.look, token, playerId: item.playerId, run: item.run });
      // Still unreachable: the rest can wait too. A signed-out rider's runs
      // wait for their next login. Anything else is settled, taken or refused.
      if (result && 'failed' in result) break;
      if (result && 'signedOut' in result) continue;
      writePendingRuns(readPendingRuns().filter(other => !(other.trail === item.trail && other.playerId === item.playerId && other.at === item.at)));
      if (result && 'rank' in result) sent++;
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}
