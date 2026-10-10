// Online riders: passkey sign-up and login, and the cloud copy of a savegame.
//   POST /api/account/register-options  { name }                     -> { options, state }
//   POST /api/account/register          { state, response, look }    -> { token, player }
//   POST /api/account/login-options     {}                           -> { options, state }
//   POST /api/account/login             { state, response }          -> { token, player, save, runs }
//   PUT  /api/account/save              { save }  (Bearer token)     -> { ok }
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { db } from '../lib/db.mjs';
import {
  HttpError, json, respond, readBody, unsign, sessionToken, challengeToken, requirePlayer, relyingParty,
} from '../lib/auth.mjs';
import { cleanName, validName, nameKey, blockedName } from '../lib/names.mjs';
import { TRAIL_RE } from '../lib/verify-run.mjs';
import { lookOf, legacyRider, playerLook } from '../lib/looks.mjs';

const RP_NAME = 'Hjulben';

async function registerOptions(req) {
  const body = await readBody(req, 2_000);
  const name = cleanName(body.name);
  if (!validName(name)) throw new HttpError(400, 'invalid name');
  if (blockedName(name)) throw new HttpError(400, 'name not allowed');
  const sql = await db();
  // A name without a passkey (imported from the old board) is free to claim.
  const [existing] = await sql`
    select id, exists (select 1 from credentials c where c.player_id = players.id) as claimed
    from players where name_key = ${nameKey(name)}`;
  if (existing?.claimed) throw new HttpError(409, 'name taken');

  const { rpID, origin } = relyingParty(req);
  const playerId = existing?.id ?? randomUUID();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID,
    userName: name, userDisplayName: name,
    userID: Buffer.from(playerId.replaceAll('-', ''), 'hex'),
    challenge: randomBytes(32),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  const state = challengeToken({ type: 'register', challenge: options.challenge, name, player: playerId, rpID, origin });
  return json({ options, state });
}

async function register(req) {
  const body = await readBody(req, 20_000);
  const state = unsign(body.state, 'register');
  if (!state) throw new HttpError(400, 'expired, try again');

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: state.challenge,
      expectedOrigin: state.origin,
      expectedRPID: state.rpID,
      requireUserVerification: false,
    });
  } catch (_) {
    throw new HttpError(400, 'passkey rejected');
  }
  if (!verification.verified) throw new HttpError(400, 'passkey rejected');

  const { credential } = verification.registrationInfo;
  const look = lookOf(body);
  const rider = legacyRider(look);
  const sql = await db();
  let rows;
  try {
    // Takes over an unclaimed rider of the same name, keeping its times.
    rows = await sql`
      with player as (
        insert into players (id, name, name_key, rider, look)
        values (${state.player}, ${state.name}, ${nameKey(state.name)}, ${rider}, ${JSON.stringify(look)}::jsonb)
        on conflict (name_key) do update set name = excluded.name, rider = excluded.rider, look = excluded.look
          where not exists (select 1 from credentials c where c.player_id = players.id)
        returning id
      )
      insert into credentials (id, player_id, public_key, counter, transports)
      select ${credential.id}, id, ${Buffer.from(credential.publicKey).toString('base64url')}, ${credential.counter}, ${credential.transports ?? []}
      from player
      returning player_id`;
  } catch (error) {
    if (error?.code === '23505') throw new HttpError(409, 'name taken');
    throw error;
  }
  if (!rows.length) throw new HttpError(409, 'name taken');
  const playerId = rows[0].player_id;
  return json({ token: sessionToken(playerId), player: { id: playerId, name: state.name, rider, look } });
}

async function loginOptions(req) {
  const { rpID, origin } = relyingParty(req);
  // No allowCredentials: the browser offers every passkey this site owns.
  const options = await generateAuthenticationOptions({ rpID, challenge: randomBytes(32), userVerification: 'preferred' });
  return json({ options, state: challengeToken({ type: 'login', challenge: options.challenge, rpID, origin }) });
}

async function login(req) {
  const body = await readBody(req, 20_000);
  const state = unsign(body.state, 'login');
  if (!state) throw new HttpError(400, 'expired, try again');
  const credentialId = String(body.response?.id ?? '');
  const sql = await db();
  const [row] = await sql`
    select c.id, c.public_key, c.counter, c.transports, p.id as player_id, p.name, p.rider, p.look, p.save
    from credentials c join players p on p.id = c.player_id
    where c.id = ${credentialId}`;
  if (!row) throw new HttpError(404, 'unknown passkey');

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: state.challenge,
      expectedOrigin: state.origin,
      expectedRPID: state.rpID,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
        counter: Number(row.counter),
        transports: row.transports ?? [],
      },
      requireUserVerification: false,
    });
  } catch (_) {
    throw new HttpError(400, 'passkey rejected');
  }
  if (!verification.verified) throw new HttpError(400, 'passkey rejected');

  await sql`update credentials set counter = ${verification.authenticationInfo.newCounter}, last_used_at = now() where id = ${row.id}`;
  const runs = await sql`select trail, replay from runs where player_id = ${row.player_id} and replay is not null`;
  return json({
    token: sessionToken(row.player_id),
    player: { id: row.player_id, name: row.name, rider: row.rider, look: lookOf(row) },
    save: row.save ?? null,
    runs: runs.map(run => ({ trail: run.trail, ghost: run.replay })),
  });
}

/** Keeps only the fields a savegame has, so the column can't be used as free storage. */
function sanitizeSave(save) {
  if (!save || typeof save !== 'object') throw new HttpError(400, 'bad save');
  const int = (value, max) => Math.min(max, Math.max(0, Math.floor(Number(value)) || 0));
  const bestTimes = {};
  if (save.bestTimes && typeof save.bestTimes === 'object') {
    for (const [key, value] of Object.entries(save.bestTimes).slice(0, 200)) {
      const time = Number(value);
      if (TRAIL_RE.test(key) && Number.isFinite(time) && time > 0) bestTimes[key] = time;
    }
  }
  const look = lookOf(save);
  return {
    look,
    rider: legacyRider(look),
    createdAt: int(save.createdAt, Number.MAX_SAFE_INTEGER),
    trail: int(save.trail, 999),
    unlocked: int(save.unlocked, 999),
    bestTimes,
  };
}

async function putSave(req) {
  const playerId = requirePlayer(req);
  const body = await readBody(req, 32_000);
  const save = sanitizeSave(body.save);
  const sql = await db();
  const [player] = await sql`select look, rider from players where id = ${playerId}`;
  if (!player) throw new HttpError(401, 'not signed in');
  save.look = playerLook(save, player);
  save.rider = legacyRider(save.look);
  const rows = await sql`
    update players set save = ${JSON.stringify(save)}::jsonb, rider = ${save.rider},
      look = ${JSON.stringify(save.look)}::jsonb, save_updated_at = now()
    where id = ${playerId} returning id`;
  if (!rows.length) throw new HttpError(401, 'not signed in');
  return json({ ok: true });
}

const ROUTES = {
  'register-options': ['POST', registerOptions],
  'register': ['POST', register],
  'login-options': ['POST', loginOptions],
  'login': ['POST', login],
  'save': ['PUT', putSave],
};

export default (req, context) => respond(async () => {
  const action = context?.params?.action ?? new URL(req.url).pathname.split('/').pop();
  const route = ROUTES[action];
  if (!route) throw new HttpError(404, 'not found');
  if (req.method !== route[0]) throw new HttpError(405, 'method not allowed');
  return route[1](req);
});

export const config = { path: '/api/account/:action' };
