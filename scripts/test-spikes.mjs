// Spikes kill exactly when the player's hitbox touches the drawn, spinning star.
import assert from "node:assert/strict";
import { FRAME_REACH } from "../js/finish.js";
import { playerTouch } from "../js/player-shape.js";
import { spikePoints, spikeShape } from "../js/spike.js";

// A radius-18 spike has 7 points; at time 0 one tip reaches (20, 0).
const spike = { x: 0, y: 0, radius: 18, spin: 1 };
assert.equal(spikePoints(spike.radius), 7);
const touches = (time, player) => playerTouch(spikeShape(spike, time), player) !== null;

// The tyre's leftmost pixels span x -12..-10 from the hub, over y -4..+6.
const wheelAt = (x, y = 0, extra = {}) => ({
  rear: { x, y },
  front: { x: x + 50, y },
  frameReach: FRAME_REACH,
  probes: [],
  ...extra,
});

// The tip kills: the tyre's edge pixel covers it.
assert.equal(touches(0, wheelAt(31)), true, "a tyre touching the tip");
// Just past the tip there is nothing drawn, so the rider survives.
assert.equal(touches(0, wheelAt(33)), false, "a tyre just past the tip");
// Half a point later a valley faces the tyre, and the same spot is safe.
assert.equal(touches(1 / 14, wheelAt(31)), false, "the tip has spun away");
// The pixel disc at the centre is part of the spike too: it reaches x = 14.
assert.equal(touches(1 / 14, wheelAt(25)), true, "a tyre touching the centre disc");

// A fast wheel passing straight through within one step still dies.
const sweeping = wheelAt(-100);
sweeping.rear = { x: -100, y: 0, px: 100, py: 0 };
sweeping.front = { x: -150, y: 0 };
assert.equal(touches(0, sweeping), true, "a wheel sweeping through");

// The rider's head kills on the drawn star, and survives just clear of it.
const far = wheelAt(-300);
assert.equal(touches(0, { ...far, probes: [{ x: 25, y: 0, radius: 6 }] }), true, "the head on the tip");
assert.equal(touches(0, { ...far, probes: [{ x: 27, y: 0, radius: 6 }] }), false, "the head clear of the tip");

// The frame between the axles counts as part of the bike.
assert.equal(
  touches(0, { rear: { x: -60, y: 18 }, front: { x: 60, y: 18 }, frameReach: FRAME_REACH, probes: [] }),
  true,
  "the frame grazing the bottom of the spike",
);
assert.equal(
  touches(0, { rear: { x: -60, y: 30 }, front: { x: 60, y: 30 }, frameReach: FRAME_REACH, probes: [] }),
  false,
  "the frame clear below the spike",
);

console.log("Spike tests passed.");
