// Rider looks on the server: the same catalog as the game (js/cosmetics.js),
// so a look is checked against exactly the items the client offers.
import { keepIdentity, legacyLook, legacyRider, normalizeLook } from '../../js/cosmetics.js';

/**
 * The look a request or row stands for: its `look`, with any missing or
 * unknown item taken from its old `rider` ('male' or 'female'), so clients
 * and rows from before looks existed keep the rider they had. Only items every
 * rider owns are accepted for now; won items will be checked here too.
 */
export const lookOf = record => normalizeLook(record?.look, { fallback: legacyLook(record?.rider) });

/**
 * A look sent by a signed-in player, with the gender and skin they were
 * created with (`player` is their row): those are picked once, so a save or
 * run can't change them.
 */
export const playerLook = (record, player) => keepIdentity(lookOf(record), lookOf(player));

/** 'male' or 'female', still stored for clients from before looks existed. */
export { legacyRider };
