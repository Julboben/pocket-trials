// Apples are taken exactly when the drawn wheels or the rider's hitbox touch the drawn apple.
import assert from "node:assert/strict";
import { appleBob, playerTouchesApple } from "../js/apple.js";
import { FRAME_REACH } from "../js/finish.js";

// At x = 0 and time = 0 the apple does not bob, so its pixels sit at a fixed
// place: the leftmost column spans x -12..-10 over y -4..4.
const apple = { x: 0, y: 0 };
assert.equal(appleBob(apple, 0), 0);

// The tyre's rightmost pixels span x +12..+14 from the hub, over y -4..+6.
const player = (rearX, rearY = 0, extra = {}) => ({
  rear: { x: rearX, y: rearY },
  front: { x: rearX - 50, y: rearY },
  frameReach: FRAME_REACH,
  probes: [],
  ...extra,
});

// A wheel overlapping the apple by part of a pixel takes it.
assert.equal(playerTouchesApple(apple, 0, player(-25)), true, "a wheel overlapping by one unit");
assert.equal(playerTouchesApple(apple, 0, player(-24)), true, "a wheel overlapping by two units");
// A wheel stopping right at the apple's edge, or short of it, does not.
assert.equal(playerTouchesApple(apple, 0, player(-26)), false, "a wheel touching only the edge");
assert.equal(playerTouchesApple(apple, 0, player(-30)), false, "a wheel short of the apple");
// The tyre is round: its corner pixels are empty, so a diagonal near miss is no touch.
assert.equal(playerTouchesApple(apple, 0, player(-23, -16)), false, "a diagonal near miss");

// A fast wheel passing through the apple within one step still takes it.
const sweeping = player(40, 0);
sweeping.rear.px = -40;
sweeping.rear.py = 0;
sweeping.front = { x: 200, y: 0 };
assert.equal(playerTouchesApple(apple, 0, sweeping), true, "a wheel sweeping through");

// Only the rider's hitbox counts: a head probe touching the apple takes it,
// but empty space above the bike that used to count no longer does.
const far = player(-200);
assert.equal(
  playerTouchesApple(apple, 0, { ...far, probes: [{ x: 0, y: -14, radius: 6 }] }),
  true,
  "the head touching the apple",
);
assert.equal(
  playerTouchesApple(apple, 0, { ...far, probes: [{ x: 0, y: -26, radius: 6 }] }),
  false,
  "the head above the apple",
);

// The frame between the axles counts as part of the bike.
assert.equal(
  playerTouchesApple(apple, 0, { rear: { x: -60, y: 9 }, front: { x: 60, y: 9 }, frameReach: FRAME_REACH, probes: [] }),
  true,
  "the frame crossing just below the apple",
);

// The bob moves the pickup with the drawn apple.
const time = 0.6283185307179586; // sin(2.5 t) = 1: the apple sinks 2 units
assert.ok(Math.abs(appleBob(apple, time) - 2) < 1e-9);
assert.equal(playerTouchesApple(apple, 0, player(-25, 9)), false, "a wheel below the resting apple");
assert.equal(playerTouchesApple(apple, time, player(-25, 9)), true, "a wheel touching the bobbing apple");

console.log("Apple tests passed.");
