// End-to-end tests for the online API (netlify/functions) against an in-memory
// Postgres (PGlite) and a software passkey authenticator: schema setup,
// passkey sign-up and login, cloud saves, and server-side run verification.
// Needs the npm dependencies: run `npm ci` first.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as signData } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { useSql } from '../netlify/lib/db.mjs';
import { useTrailLoader } from '../netlify/lib/verify-run.mjs';
import { sign } from '../netlify/lib/auth.mjs';
import account from '../netlify/functions/account.mjs';
import leaderboard from '../netlify/functions/leaderboard.mjs';
import { trailHash } from '../js/trail-hash.js';
import { RIDE_VERSION } from '../js/ride.js';
import { loadCatalogTrails, readJson } from './lib/trails.mjs';

process.env.AUTH_SECRET = randomBytes(32).toString('hex');
delete process.env.RP_ID;

const SITE = 'https://h.julben.dk';
const RP_ID = 'julben.dk';

// --- Database ---------------------------------------------------------------

const pg = new PGlite();
const sql = (strings, ...values) => pg.sql(strings, ...values).then(result => result.rows);
sql.query = (text, params) => pg.query(text, params).then(result => result.rows);
useSql(sql);

const officialTrails = loadCatalogTrails('official');
const trails = new Map(officialTrails.map(entry => [entry.id, entry.trail]));
// Tests pick trails by catalog position, so renaming a trail never breaks them.
const [firstTrail, secondTrail, thirdTrail] = officialTrails;
assert.ok(thirdTrail, 'online tests need at least three official trails');
useTrailLoader(async id => trails.get(id) ?? null);
const keyOf = id => {
  assert.ok(trails.has(id), `unknown official trail ${id}`);
  return `${id}@${trailHash(trails.get(id))}`;
};
const fixture = entry => readJson(`tests/replays/${entry.file.split('/').pop()}`);

// --- HTTP helpers -------------------------------------------------------------

async function call(handler, path, { method = 'POST', body, token, origin = SITE } = {}) {
  const headers = { 'content-type': 'application/json', origin };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await handler(new Request(SITE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const api = (action, options) => call(account, '/api/account/' + action, options);
const submit = (options) => call(leaderboard, '/api/leaderboard', options);
const board = trail => call(leaderboard, '/api/leaderboard?trail=' + encodeURIComponent(trail), { method: 'GET' });

// --- Software authenticator (ES256, "none" attestation) -------------------------

const b64url = bytes => Buffer.from(bytes).toString('base64url');
const sha256 = data => createHash('sha256').update(data).digest();

function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([major << 5 | n]);
    if (n < 256) return Buffer.from([major << 5 | 24, n]);
    const out = Buffer.alloc(3); out[0] = major << 5 | 25; out.writeUInt16BE(n, 1); return out;
  };
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

function createAuthenticator(rpID = RP_ID) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  let counter = 0;
  const counterBytes = () => { const out = Buffer.alloc(4); out.writeUInt32BE(counter); return out; };
  return {
    id: b64url(credentialId),
    register(options, origin = SITE) {
      assert.equal(options.rp.id, rpID);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const length = Buffer.alloc(2); length.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([sha256(rpID), Buffer.from([0x45]), counterBytes(), Buffer.alloc(16), length, credentialId, coseKey]);
      return {
        id: b64url(credentialId), rawId: b64url(credentialId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(cbor({ fmt: 'none', attStmt: {}, authData })), transports: ['internal'] },
      };
    },
    login(options, origin = SITE) {
      assert.equal(options.rpId, rpID);
      counter++;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha256(rpID), Buffer.from([0x05]), counterBytes()]);
      const signature = signData('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      return {
        id: b64url(credentialId), rawId: b64url(credentialId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) },
      };
    },
  };
}

async function registerRider(name, authenticator = createAuthenticator(), rider = 'male') {
  const options = await api('register-options', { body: { name } });
  assert.equal(options.status, 200, JSON.stringify(options.body));
  const response = authenticator.register(options.body.options);
  return api('register', { body: { state: options.body.state, response, rider } });
}

async function loginRider(authenticator) {
  const options = await api('login-options', { body: {} });
  assert.equal(options.status, 200);
  assert.deepEqual(options.body.options.allowCredentials ?? [], [], 'login offers every passkey (discoverable)');
  return api('login', { body: { state: options.body.state, response: authenticator.login(options.body.options) } });
}

// --- Schema ---------------------------------------------------------------------

const firstTrailKey = keyOf(firstTrail.id);
{
  const { status, body } = await board(firstTrailKey);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.runs, []);
  useSql(sql);   // a fresh instance runs the schema again, which must be a no-op
  assert.equal((await board(firstTrailKey)).status, 200);
  // A rider imported from the pre-accounts board: no passkey, no replay.
  await sql`insert into players (id, name, name_key, rider) values (${crypto.randomUUID()}, 'julben', 'julben', 'female')`;
  await sql`insert into runs (trail, player_id, rider, time_ms) select ${firstTrailKey}, id, 'female', 6908 from players where name_key = 'julben'`;
  assert.deepEqual((await board(firstTrailKey)).body.runs.map(run => [run.name, run.time]), [['julben', 6.908]]);
}

// --- Sign-up ------------------------------------------------------------------

const julian = createAuthenticator();
let julianToken;
{
  assert.equal((await api('register-options', { body: { name: '<script>' } })).status, 400, 'markup is not a valid name');
  assert.equal((await api('register-options', { body: { name: 'A'.repeat(17) } })).status, 400, 'names are at most 16 characters');
  assert.equal((await api('register-options', { body: { name: 'Admin' } })).status, 400, 'reserved names are blocked');
  assert.equal((await api('register-options', { body: { name: 'shithead' } })).status, 400, 'offensive names are blocked');
  assert.equal((await api('register-options', { body: { name: 'Julian' }, origin: 'https://evil.example' })).status, 400, 'foreign origins are refused');

  const { status, body } = await registerRider('  Julian  ', julian, 'female');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.player.name, 'Julian');
  assert.equal(body.player.rider, 'female');
  julianToken = body.token;

  for (const lookalike of ['julian', 'JULIAN', 'Jülian', 'Ju_lian', 'Ju lian']) {
    const result = await api('register-options', { body: { name: lookalike } });
    assert.equal(result.status, 409, `${lookalike} counts as the taken name Julian`);
    assert.equal(result.body.error, 'name taken');
  }

  // Two people racing for one name: the second insert loses.
  const a = await api('register-options', { body: { name: 'Racer' } });
  const b = await api('register-options', { body: { name: 'racer' } });
  assert.equal((await api('register', { body: { state: a.body.state, response: createAuthenticator().register(a.body.options) } })).status, 200);
  assert.equal((await api('register', { body: { state: b.body.state, response: createAuthenticator().register(b.body.options) } })).status, 409);

  // A response for one challenge can't be used with another.
  const first = await api('register-options', { body: { name: 'Mallory' } });
  const second = await api('register-options', { body: { name: 'Mallory' } });
  const response = createAuthenticator().register(first.body.options);
  assert.equal((await api('register', { body: { state: second.body.state, response } })).status, 400, 'challenge mismatch is rejected');
  assert.equal((await api('register', { body: { state: first.body.state + 'x', response } })).status, 400, 'tampered state is rejected');
  const expired = sign({ type: 'register', challenge: first.body.options.challenge, name: 'Mallory', player: crypto.randomUUID(), rpID: RP_ID, origin: SITE }, -1);
  assert.equal((await api('register', { body: { state: expired, response } })).status, 400, 'expired state is rejected');
  const forged = createAuthenticator().register(first.body.options, 'https://evil.julben.dk.example');
  assert.equal((await api('register', { body: { state: first.body.state, response: forged } })).status, 400, 'passkey origin must match');
}

// --- Claiming an imported name -------------------------------------------------

{
  const owner = createAuthenticator();
  const { status, body } = await registerRider('JulBen', owner, 'male');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.player.name, 'JulBen');
  assert.equal((await board(firstTrailKey)).body.runs[0].name, 'JulBen', 'the claimer gets the old times');
  assert.equal((await api('register-options', { body: { name: 'julben' } })).status, 409, 'claimed names are taken');
  const login = await loginRider(owner);
  assert.equal(login.status, 200);
  assert.deepEqual(login.body.runs, [], 'imported runs have no ghost to restore');
}

// --- Login --------------------------------------------------------------------

{
  const { status, body } = await loginRider(julian);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.player.name, 'Julian');
  assert.equal(body.save, null);
  assert.deepEqual(body.runs, []);
  assert.equal((await loginRider(createAuthenticator())).status, 404, 'unknown passkeys are refused');

  const options = await api('login-options', { body: {} });
  const response = julian.login(options.body.options);
  response.response.signature = b64url(randomBytes(70));
  assert.equal((await api('login', { body: { state: options.body.state, response } })).status, 400, 'bad signatures are refused');
}

// --- Run verification ---------------------------------------------------------

await sql`delete from runs where replay is null`;   // start from an empty board

const firstKey = keyOf(firstTrail.id);
const firstTrailRun = fixture(firstTrail);
const run = (replay = firstTrailRun) => ({ inputs: replay.inputs, seed: replay.seed, physics: RIDE_VERSION });
{
  assert.equal((await submit({ body: { trail: firstKey, rider: 'female', run: run() } })).status, 401, 'runs need a signed-in rider');
  assert.equal((await submit({ body: { trail: firstKey, run: run() }, token: julianToken + 'x' })).status, 401, 'forged tokens are refused');
  const otherPlayer = sign({ type: 'session', player: crypto.randomUUID() }, 60).replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
  assert.equal((await submit({ body: { trail: firstKey, run: run() }, token: otherPlayer })).status, 401, 'tokens signed with another key are refused');

  // A client claiming a time gets the simulated one instead.
  const { status, body } = await submit({ body: { trail: firstKey, rider: 'female', run: run(), time: 1 }, token: julianToken });
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(Math.abs(body.time - firstTrailRun.outcome.elapsed) < 0.001, `server time ${body.time} matches the replay`);
  assert.equal(body.rank, 1);
  assert.equal(body.total, 1);
  assert.equal(body.runs[0].name, 'Julian');
  assert.equal(body.runs[0].rider, 'female');

  // Cutting inputs off before the finish line.
  const short = structuredClone(firstTrailRun.inputs);
  short[short.length - 1][0] = 1;
  short.splice(-3);
  assert.equal((await submit({ body: { trail: firstKey, run: run({ ...firstTrailRun, inputs: short }) }, token: julianToken })).status, 422, 'unfinished runs are refused');
  assert.equal((await submit({ body: { trail: firstKey.replace(/@.*/, '@00000000'), run: run() }, token: julianToken })).status, 409, 'stale trail versions are refused');
  assert.equal((await submit({ body: { trail: firstKey, run: { ...run(), physics: RIDE_VERSION - 1 } }, token: julianToken })).status, 409, 'old physics versions are refused');
  assert.equal((await submit({ body: { trail: keyOf(secondTrail.id), run: run() }, token: julianToken })).status, 422, 'inputs from another trail do not finish it');
  for (const inputs of [[], [[1, 1, 2, 1, 0]], [[0, 1, 0, 1, 0]], [[1.5, 1, 0, 1, 0]], [[1, 0, 0, 1, 0]], [[1, 1, 0, 2, 0]], [[72001, 1, 0, 0, 0]], 'x']) {
    assert.equal((await submit({ body: { trail: firstKey, run: { ...run(), inputs } }, token: julianToken })).status, 400, `malformed inputs ${JSON.stringify(inputs)}`);
  }

  // A slower run keeps the best one and its ghost; a faster one replaces it.
  await sql`update runs set time_ms = 5000, replay = '{"marker":1}'::jsonb where trail = ${firstKey}`;
  const slower = await submit({ body: { trail: firstKey, rider: 'male', run: run() }, token: julianToken });
  assert.equal(slower.status, 200, JSON.stringify(slower.body));
  assert.equal(slower.body.best, 5);
  assert.equal(slower.body.improved, false);
  assert.equal(slower.body.runs[0].rider, 'female', 'the best run keeps its rider');
  assert.equal((await sql`select replay from runs where trail = ${firstKey}`)[0].replay.marker, 1);
  await sql`update runs set time_ms = 60000 where trail = ${firstKey}`;
  const faster = await submit({ body: { trail: firstKey, rider: 'female', run: run() }, token: julianToken });
  assert.equal(faster.body.improved, true);
  assert.equal(faster.body.runs.length, 1, 'one row per rider');

  const ghost = await call(leaderboard, '/api/leaderboard?ghost=1&trail=' + encodeURIComponent(firstKey), { method: 'GET' });
  assert.equal(ghost.status, 200);
  assert.equal(ghost.body.ghost.name, 'Julian');
  assert.equal(ghost.body.ghost.replay.physics, RIDE_VERSION);
  assert.ok(Math.abs(ghost.body.ghost.replay.time - firstTrailRun.outcome.elapsed) < 0.001, 'world ghost is the best replay');
  const none = await call(leaderboard, '/api/leaderboard?ghost=1&trail=' + encodeURIComponent(keyOf(thirdTrail.id)), { method: 'GET' });
  assert.equal(none.body.ghost, null, 'no ghost before anyone finishes');

  const listed = await board(firstKey);
  assert.equal(listed.body.runs[0].name, 'Julian');
  assert.equal((await board('trail:abcdef12')).status, 400, 'custom trails stay local');
}

// --- Cloud save and login restore ---------------------------------------------

{
  const save = { rider: 'female', createdAt: 1700000000000, trail: 1, unlocked: 2, bestTimes: { [firstKey]: 8.192, 'not-a-key': 3, [keyOf(secondTrail.id)]: -1 }, extra: 'x'.repeat(100) };
  assert.equal((await api('save', { method: 'PUT', body: { save } })).status, 401);
  assert.equal((await api('save', { method: 'POST', body: { save }, token: julianToken })).status, 405);
  assert.equal((await api('save', { method: 'PUT', body: { save }, token: julianToken })).status, 200);
  assert.equal((await api('save', { method: 'PUT', body: { save: { ...save, extra: 'x'.repeat(40_000) } }, token: julianToken })).status, 413);

  const { body } = await loginRider(julian);
  assert.deepEqual(body.save, { rider: 'female', createdAt: 1700000000000, trail: 1, unlocked: 2, bestTimes: { [firstKey]: 8.192 } }, 'only savegame fields are kept');
  assert.equal(body.runs.length, 1);
  const { trail, ghost } = body.runs[0];
  assert.equal(trail, firstKey);
  assert.equal(ghost.physics, RIDE_VERSION);
  assert.ok(Math.abs(ghost.time - firstTrailRun.outcome.elapsed) < 0.001);
  assert.equal(ghost.splits.length, firstTrailRun.outcome.apples, 'ghost has a split per apple');
  assert.ok(Number.isInteger(ghost.startStep) && ghost.startStep >= 0);
  assert.equal(ghost.inputs.reduce((sum, row) => sum + row[0], 0), firstTrailRun.steps, 'ghost keeps the inputs up to the finish');
}

// --- Passkeys on other hosts ----------------------------------------------------

{
  const preview = 'https://deploy-preview-1--hjulben.netlify.app';
  const options = await call(account, '/api/account/login-options', { body: {}, origin: preview });
  assert.equal(options.status, 400, 'the API refuses origins other than its own host');
  const local = new Request('http://localhost:8888/api/account/login-options', { method: 'POST', headers: { origin: 'http://localhost:8888' }, body: '{}' });
  const localOptions = await (await account(local)).json();
  assert.equal(localOptions.options.rpId, 'localhost', 'other hosts use their own rpID');
}

// --- Not configured -------------------------------------------------------------

{
  const secret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  assert.equal((await api('login-options', { body: {} })).status, 503);
  process.env.AUTH_SECRET = secret;
}

await pg.close();
console.log('Online API tests passed.');
