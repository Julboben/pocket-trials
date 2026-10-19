// Runs that couldn't be posted to the world board (js/online-leaderboard.js):
// kept on the device and sent when the server can be reached, with the
// server's answers stubbed.
import assert from 'node:assert/strict';

const items = new Map();
globalThis.localStorage = /** @type {any} */ ({
  getItem: key => items.get(key) ?? null,
  setItem: (key, value) => items.set(key, String(value)),
  removeItem: key => items.delete(key),
});
globalThis.window = /** @type {any} */ (new EventTarget());

/** What the next fetches answer: a status (0 means the network failed), and the body. */
const answers = [];
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.authorization ?? null });
  const next = answers.shift() ?? { status: 0 };
  if (!next.status) throw new TypeError('network');
  return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { 'content-type': 'application/json' } });
};

const board = await import('../js/online-leaderboard.js');
const trail = 'official:a@12345678';
const other = 'bonus:b@12345678';
const run = { inputs: [[10, 1, 0, 1, 0]], seed: 1, physics: 6 };
const look = { gender: 'male', skin: 'fair' };
const standing = { rank: 1, total: 1, time: 1, best: 1, improved: true, runs: [] };

// --- Submitting ---------------------------------------------------------------

{
  answers.push({ status: 0 });
  assert.deepEqual(await board.submitOnlineRun(trail, { look, token: 't', run }), { failed: true }, 'no network: worth sending again');
  answers.push({ status: 503 });
  assert.deepEqual(await board.submitOnlineRun(trail, { look, token: 't', run }), { failed: true }, 'a server error too');
  answers.push({ status: 422, body: { error: 'run does not finish' } });
  assert.deepEqual(await board.submitOnlineRun(trail, { look, token: 't', run }), { rejected: true, reason: 'run does not finish' });
  answers.push({ status: 401 });
  assert.deepEqual(await board.submitOnlineRun(trail, { look, token: 't', run }), { signedOut: true });
  answers.push({ status: 200, body: standing });
  assert.equal((await board.submitOnlineRun(trail, { look, token: 't', run })).rank, 1);
  assert.equal(await board.submitOnlineRun('trail:custom', { look, token: 't', run }), null, 'custom trails never go up');
  assert.equal(calls.at(-1).auth, 'Bearer t');
}

// --- Waiting runs -------------------------------------------------------------

{
  assert.equal(board.pendingRunCount(), 0);
  board.queuePendingRun(trail, { look, playerId: 'p1', run });
  board.queuePendingRun(trail, { look, playerId: 'p1', run: { ...run, seed: 2 } });
  board.queuePendingRun(other, { look, playerId: 'p2', run });
  board.queuePendingRun('trail:custom', { look, playerId: 'p1', run });
  assert.equal(board.pendingRunCount(), 2, 'one per rider and trail, and custom trails are never queued');
  assert.equal(JSON.parse(items.get('hjulben-pending-runs-v1'))[0].run.seed, 2, 'the newer run replaced the older');

  // The first rider's server can't be reached: everything waits.
  calls.length = 0;
  answers.push({ status: 0 });
  assert.equal(await board.flushPendingRuns(() => 'tok'), 0);
  assert.equal(calls.length, 1, 'a failure stops the flush, so the rest is tried later');
  assert.equal(board.pendingRunCount(), 2);

  // A signed-out rider's run waits for a login; a taken run is done with.
  calls.length = 0;
  answers.push({ status: 200, body: standing });
  assert.equal(await board.flushPendingRuns(id => (id === 'p1' ? 'tok' : null)), 1, 'only riders with a session are sent');
  assert.equal(calls.length, 1);
  assert.equal(board.pendingRunCount(), 1);
  assert.equal(JSON.parse(items.get('hjulben-pending-runs-v1'))[0].playerId, 'p2');

  // A run the server refuses is dropped: sending it again would not help.
  answers.push({ status: 409, body: { error: 'outdated trail' } });
  assert.equal(await board.flushPendingRuns(() => 'tok'), 0);
  assert.equal(board.pendingRunCount(), 0);

  board.queuePendingRun(trail, { look, playerId: 'p3', run });
  board.dropPendingRuns('p3');
  assert.equal(board.pendingRunCount(), 0, 'a deleted rider\'s runs go with them');
  assert.equal(items.has('hjulben-pending-runs-v1'), false, 'an empty queue takes no room');
}

console.log('Pending run tests passed.');
