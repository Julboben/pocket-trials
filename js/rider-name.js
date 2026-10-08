// Rider names: which characters are allowed. Shared by the game and the server.
// Names go into innerHTML, so < > & " ' and ` must never be allowed.

export const NAME_MAX = 16;
export const NAME_SYMBOLS = ' _.-$!?#@*+~^=()[]';
export const NAME_HINT = 'Use 1–16 letters, numbers, spaces or _ . - $ ! ? # @ * + ~ ^ = ( ) [ ]';

const SYMBOL_CLASS = NAME_SYMBOLS.replace(/[\]\[\\^-]/g, '\\$&');
const NAME_RE = new RegExp(`^[\\p{L}\\p{N}${SYMBOL_CLASS}]{1,${NAME_MAX}}$`, 'u');
const DISALLOWED_RE = new RegExp(`[^\\p{L}\\p{N}${SYMBOL_CLASS}]`, 'gu');

/** The characters in `raw` that a name can't contain, without repeats. */
export const disallowedNameChars = raw => [...new Set(String(raw ?? '').match(DISALLOWED_RE) ?? [])];

/** Drops disallowed characters, collapses spaces and cuts to 16 characters. */
export const cleanRiderName = raw => String(raw ?? '')
  .replace(DISALLOWED_RE, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

export const validRiderName = name => NAME_RE.test(name);
