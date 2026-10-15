// Apples are taken exactly when the drawn wheels or the rider's hitbox touch the drawn apple.
import assert from "node:assert/strict";
import { APPLE_SPRITE, appleShine, playerTouchesApple } from "../js/apple.js";
import { FRAME_REACH } from "../js/finish.js";

// Apples hold still: the leftmost column spans x -12..-10 over y -4..4.
const apple = { x: 0, y: 0 };

// The tyre's rightmost pixels span x +12..+14 from the hub, over y -4..+6.
const player = (rearX, rearY = 0, extra = {}) => ({
  rear: { x: rearX, y: rearY },
  front: { x: rearX - 50, y: rearY },
  frameReach: FRAME_REACH,
  probes: [],
  ...extra,
});

// A wheel overlapping the apple by part of a pixel takes it.
assert.equal(playerTouchesApple(apple, player(-25)), true, "a wheel overlapping by one unit");
assert.equal(playerTouchesApple(apple, player(-24)), true, "a wheel overlapping by two units");
// A wheel stopping right at the apple's edge, or short of it, does not.
assert.equal(playerTouchesApple(apple, player(-26)), false, "a wheel touching only the edge");
assert.equal(playerTouchesApple(apple, player(-30)), false, "a wheel short of the apple");
// The tyre is round: its corner pixels are empty, so a diagonal near miss is no touch.
assert.equal(playerTouchesApple(apple, player(-23, -16)), false, "a diagonal near miss");

// A fast wheel passing through the apple within one step still takes it.
const sweeping = player(40, 0);
sweeping.rear.px = -40;
sweeping.rear.py = 0;
sweeping.front = { x: 200, y: 0 };
assert.equal(playerTouchesApple(apple, sweeping), true, "a wheel sweeping through");

// Only the rider's hitbox counts: a head probe touching the apple takes it,
// but empty space above the bike that used to count no longer does.
const far = player(-200);
assert.equal(
  playerTouchesApple(apple, { ...far, probes: [{ x: 0, y: -14, radius: 6 }] }),
  true,
  "the head touching the apple",
);
assert.equal(
  playerTouchesApple(apple, { ...far, probes: [{ x: 0, y: -26, radius: 6 }] }),
  false,
  "the head above the apple",
);

// The frame between the axles counts as part of the bike.
assert.equal(
  playerTouchesApple(apple, { rear: { x: -60, y: 9 }, front: { x: 60, y: 9 }, frameReach: FRAME_REACH, probes: [] }),
  true,
  "the frame crossing just below the apple",
);

// The apple never moves, so whether a wheel touches it doesn't depend on when.
assert.equal(playerTouchesApple(apple, player(-25, 9)), false, "a wheel below the apple");

// The shine sweeps every diagonal of the sprite, then rests until the next sweep.
const diagonals = APPLE_SPRITE.length + APPLE_SPRITE[0].length - 1;
const seen = new Set();
for (let t = 0; t < 0.5; t += 0.001) seen.add(appleShine(apple, t));
for (let diagonal = 0; diagonal < diagonals; diagonal++) assert.ok(seen.has(diagonal), `the shine crosses diagonal ${diagonal}`);
assert.equal(appleShine(apple, 1.5), null, "no shine between sweeps");
assert.notEqual(appleShine({ x: 40, y: 0 }, 0), appleShine(apple, 0), "apples shine at their own times");

console.log("Apple tests passed.");
