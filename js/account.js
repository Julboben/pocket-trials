// Online riders: passkey sign-up and login against /api/account, and the
// cloud copy of the savegame. Passkeys live in the OS keychain or password
// manager, so clearing site data never logs a rider out for good.
import { NAME_HINT } from './rider-name.js';

const API = '/api/account/';
const SAVE_SYNC_DELAY_MS = 1500;

export class AccountError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export const passkeysSupported = () => typeof window !== 'undefined' && window.isSecureContext
  && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials?.create);

// --- base64url <-> bytes (WebAuthn JSON uses base64url for every binary field)

const fromB64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const toB64url = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function call(action, body, { method = 'POST', token = null } = {}) {
  let res;
  try {
    res = await fetch(API + action, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch (_) {
    throw new AccountError('offline');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AccountError(data.error || 'server error', res.status);
  return data;
}

function passkeyError(error) {
  if (error instanceof AccountError) return error;
  // NotAllowedError covers both "cancelled" and "timed out" by design.
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return new AccountError('cancelled');
  if (error?.name === 'InvalidStateError') return new AccountError('passkey exists');
  return new AccountError('passkey failed');
}

async function createPasskey(options) {
  const credential = /** @type {any} */ (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: fromB64url(options.challenge),
      user: { ...options.user, id: fromB64url(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map(item => ({ ...item, id: fromB64url(item.id) })),
    },
  }));
  const { response } = credential;
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      attestationObject: toB64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  };
}

async function usePasskey(options) {
  const credential = /** @type {any} */ (await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: fromB64url(options.challenge),
      allowCredentials: (options.allowCredentials ?? []).map(item => ({ ...item, id: fromB64url(item.id) })),
    },
  }));
  const { response } = credential;
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      authenticatorData: toB64url(response.authenticatorData),
      signature: toB64url(response.signature),
      userHandle: response.userHandle ? toB64url(response.userHandle) : undefined,
    },
  };
}

/**
 * Claims `name` and creates a passkey for it.
 * @returns {Promise<{ token: string, player: { id: string, name: string, rider: string } }>}
 */
export async function registerRider(name, rider) {
  if (!passkeysSupported()) throw new AccountError('unsupported');
  try {
    const { options, state } = await call('register-options', { name });
    const response = await createPasskey(options);
    return await call('register', { state, response, rider });
  } catch (error) {
    throw passkeyError(error);
  }
}

/**
 * Signs in with any passkey this site owns.
 * @returns {Promise<{ token: string, player: { id: string, name: string, rider: string }, save: object | null, runs: { trail: string, ghost: object }[] }>}
 */
export async function loginRider() {
  if (!passkeysSupported()) throw new AccountError('unsupported');
  try {
    const { options, state } = await call('login-options', {});
    const response = await usePasskey(options);
    return await call('login', { state, response });
  } catch (error) {
    throw passkeyError(error);
  }
}

/** A short message for the player. */
export function accountErrorText(error) {
  switch (error?.message) {
    case 'name taken': return 'That name is taken. If it’s yours, log in with your passkey instead.';
    case 'name not allowed': return 'That name isn’t allowed. Please pick another.';
    case 'invalid name': return NAME_HINT + '.';
    case 'cancelled': return 'Passkey cancelled.';
    case 'passkey exists': return 'This device already has a passkey for that rider. Log in instead.';
    case 'unknown passkey': return 'That passkey isn’t linked to a rider here. Create a new online rider instead.';
    case 'unsupported': return 'This browser doesn’t support passkeys. You can still play offline.';
    case 'offline': return 'Couldn’t reach the server. Check your connection, or play offline.';
    case 'online accounts are not configured': return 'Online riders aren’t available right now. You can still play offline.';
    case 'expired, try again': return 'That took too long. Please try again.';
    default: return 'Something went wrong. Please try again.';
  }
}

// --- Cloud save ---------------------------------------------------------------

const pendingSaves = new Map();   // token -> { timer, save }
const lastSent = new Map();       // token -> payload JSON, so retries don't rewrite an unchanged save

function sendSave(save, keepalive = false) {
  const { rider, createdAt, trail, unlocked, bestTimes } = save;
  const body = JSON.stringify({ save: { rider, createdAt, trail, unlocked, bestTimes } });
  if (lastSent.get(save.token) === body) return;
  lastSent.set(save.token, body);
  fetch(API + 'save', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + save.token },
    body,
    keepalive,
  }).then(res => { if (!res.ok) lastSent.delete(save.token); }, () => lastSent.delete(save.token));
}

/** Uploads the savegame shortly after it last changed. Fails quietly; the next change retries. */
export function queueSaveSync(save) {
  if (!save?.token || typeof window === 'undefined') return;
  clearTimeout(pendingSaves.get(save.token)?.timer);
  const timer = setTimeout(() => {
    pendingSaves.delete(save.token);
    sendSave(save);
  }, SAVE_SYNC_DELAY_MS);
  pendingSaves.set(save.token, { timer, save });
}

if (typeof window !== 'undefined') {
  // Closing the tab right after a run must not lose it.
  window.addEventListener('pagehide', () => {
    for (const { timer, save } of pendingSaves.values()) {
      clearTimeout(timer);
      sendSave(save, true);
    }
    pendingSaves.clear();
  });
}
