// @ts-check
// Things in the world the rider can interact with: the interact key (E by
// default, d-pad down on a gamepad, a tap on touch screens) acts on the
// nearest one in reach, and its key is shown over it only while the rider is
// that close. Interactions are decoration: they never touch the simulation,
// so replays are unaffected.
//
// To add one, give its prop type an entry in render.js's INTERACTIONS:
// `find(prop)` says where it is now and whether it can be used, and
// `act(prop)` does it and returns the sound and announcement for game.js.

/** How close the rider must be, either way and above or below, by default. */
export const INTERACT_REACH = { x: 64, y: 72 };

/**
 * @typedef {object} InteractionSpot
 * @property {number} x       Where it is in the world now.
 * @property {number} y       The ground it stands on.
 * @property {number} hint    How far above `y` to show the key, world units.
 * @property {boolean} ready  Whether it can be used right now.
 * @property {{ x: number, y: number }} [reach] How close the rider must be; INTERACT_REACH if left out.
 */

/**
 * The spot nearest the rider at (`riderX`, `riderY`) that is ready and within
 * its reach, or null. Each candidate is an InteractionSpot with anything
 * else the caller needs (such as its prop) carried along.
 * @template {InteractionSpot} T
 * @param {Iterable<T>} spots
 * @param {number | null} riderX
 * @param {number | null} riderY
 * @returns {T | null}
 */
export function nearestInteraction(spots, riderX, riderY) {
  if (!Number.isFinite(riderX) || !Number.isFinite(riderY)) return null;
  let best = null;
  let bestAway = Infinity;
  for (const spot of spots) {
    if (!spot?.ready) continue;
    const reach = spot.reach ?? INTERACT_REACH;
    const away = Math.abs(/** @type {number} */ (riderX) - spot.x);
    if (away > reach.x || Math.abs(/** @type {number} */ (riderY) - spot.y) > reach.y || away >= bestAway) continue;
    best = spot;
    bestAway = away;
  }
  return best;
}

/**
 * @typedef {object} InteractionResult
 * @property {string} [sound]     A one-shot sound in audio.js to play.
 * @property {string} [announce]  What to tell screen-reader users.
 */
