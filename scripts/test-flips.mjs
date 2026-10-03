import assert from 'node:assert/strict';
import { trackAirRotation, LANDING_SETTLE_STEPS } from '../js/ride.js';

const deg = Math.PI / 180;

function rideAt(angle) {
  return {
    status: 'running',
    rear: { x: 0, y: 0, grounded: true },
    front: { x: 0, y: 0, grounded: true },
    airRotation: 0, airTurnMilestone: 0, previousAirAngle: angle, inJump: false, landingSteps: 0
  };
}

/** One step with the bike at `angle` and the given wheel contacts; returns flip events. */
function step(ride, angle, rearGrounded, frontGrounded) {
  ride.front.x = Math.cos(angle) * 40;
  ride.front.y = Math.sin(angle) * 40;
  ride.rear.grounded = rearGrounded;
  ride.front.grounded = frontGrounded;
  const events = [];
  trackAirRotation(ride, events);
  return events.filter(event => event.type === 'flip');
}

/** Takes off at `from` and rotates by `by` in 5° steps while airborne. */
function jump(from, by) {
  const ride = rideAt(from);
  step(ride, from, true, true);
  const count = Math.round(Math.abs(by) / (5 * deg));
  let angle = from;
  for (let index = 1; index <= count; index++) {
    angle = from + by * index / count;
    assert.deepEqual(step(ride, angle, false, false), []);
  }
  return { ride, angle };
}

// A backflip off a 45° kicker onto flat ground only turns 315°; it still counts.
{
  const { ride, angle } = jump(-45 * deg, -315 * deg);
  const flips = step(ride, angle, true, true);
  assert.equal(flips.length, 1);
  assert.equal(flips[0].count, 1);
}

// Off a steep 70° kicker onto a downslope: about 270° of rotation.
{
  const { ride, angle } = jump(-70 * deg, -270 * deg);
  assert.equal(step(ride, angle, true, true)[0]?.count, 1);
}

// Half a rotation is not a flip.
{
  const { ride, angle } = jump(0, -150 * deg);
  assert.deepEqual(step(ride, angle, true, true), []);
}

// Two rotations.
{
  const { ride, angle } = jump(0, 700 * deg);
  assert.equal(step(ride, angle, true, true)[0]?.count, 2);
}

// A brief wheel touch mid-flip keeps the rotation; the flip lands after it.
{
  const { ride, angle } = jump(0, -200 * deg);
  for (let index = 0; index < 4; index++) assert.deepEqual(step(ride, angle, true, false), []);
  let next = angle;
  for (let index = 0; index < 30; index++) assert.deepEqual(step(ride, next -= 5 * deg, false, false), []);
  assert.equal(step(ride, next, true, true)[0]?.count, 1);
}

// Rear-wheel-first landing: rocking down onto both wheels finishes the count.
{
  const { ride, angle } = jump(0, -290 * deg);
  let next = angle;
  for (let index = 0; index < 8; index++) assert.deepEqual(step(ride, next -= 5 * deg, true, false), []);
  assert.equal(step(ride, next, true, true)[0]?.count, 1);
}

// Riding away on one wheel still settles the landing after a moment.
{
  const { ride, angle } = jump(0, -330 * deg);
  let flips = [];
  for (let index = 0; index < LANDING_SETTLE_STEPS && !flips.length; index++) flips = step(ride, angle, true, false);
  assert.equal(flips[0]?.count, 1);
}

// Crashing before the bike settles cancels the flip.
{
  const { ride, angle } = jump(0, -330 * deg);
  step(ride, angle, true, false);
  ride.status = 'crashed';
  assert.deepEqual(step(ride, angle, true, true), []);
}

console.log('Flip detection tests passed.');
