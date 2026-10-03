// Rider names: what is allowed, and when two names count as the same.

// Letters, digits, space, _ . - (max 16). Same rule as the client, and safe for innerHTML.
const NAME_RE = /^[\p{L}\p{N} _.\-]{1,16}$/u;

// Compared as name keys, so case, accents and separators don't get around them.
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'system', 'server', 'official', 'hjulben',
  'rider', 'you', 'me', 'null', 'undefined', 'anonymous', 'guest', 'player', 'support',
]);
const OFFENSIVE = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'nazi', 'hitler', 'whore', 'kusse', 'fisse', 'luder', 'pikhoved'];

export const cleanName = raw => String(raw ?? '').trim().replace(/\s+/g, ' ');

export const validName = name => NAME_RE.test(name);

/** "Jülian", "julian" and "J_ulian" share one key, so only one of them can exist. */
export const nameKey = name => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ _.\-]/g, '');

export function blockedName(name) {
  const key = nameKey(name);
  return !key || RESERVED.has(key) || OFFENSIVE.some(word => key.includes(word));
}
