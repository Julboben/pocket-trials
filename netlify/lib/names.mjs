// Rider names: what is allowed, and when two names count as the same.
import { validRiderName } from '../../js/rider-name.js';

// Compared as name keys, so case, accents and separators don't get around them.
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'system', 'server', 'official', 'hjulben',
  'rider', 'you', 'me', 'null', 'undefined', 'anonymous', 'guest', 'player', 'support',
]);
const OFFENSIVE = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'nazi', 'hitler', 'whore', 'kusse', 'fisse', 'luder', 'pikhoved'];

export const cleanName = raw => String(raw ?? '').trim().replace(/\s+/g, ' ');

// Same rule as the client (js/rider-name.js), and safe for innerHTML.
export const validName = validRiderName;

const baseName = name => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** "Jülian", "julian" and "J_ulian" share one key, so only one of them can exist. "$Julian" is a different name. */
export const nameKey = name => baseName(name).replace(/[ _.\-]/g, '');

export function blockedName(name) {
  // Symbols are ignored here, so "f$uck" and "admin!" are still caught.
  const key = baseName(name).replace(/[^\p{L}\p{N}]/gu, '');
  return !key || RESERVED.has(key) || OFFENSIVE.some(word => key.includes(word));
}
