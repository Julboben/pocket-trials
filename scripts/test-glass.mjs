import assert from 'node:assert/strict';
import { RADIUS, STEP, GLASS_SHATTER_SPEED, GRAVITY } from '../js/config.js';
import { createRide, stepRide } from '../js/ride.js';
import { terrainGeometry } from '../js/terrain.js';
import { blockTrail, rectangle } from './lib/terrain-fixtures.mjs';

const PANE_TOP = 300;
const GROUND = 600;

// A pane centred on x = 400 over open ground far below.
function paneTrail(width, thickness) {
  return blockTrail([
    rectangle(0, GROUND, 1400, GROUND + 200, 'grass', 'ground'),
    rectangle(400 - width / 2, PANE_TOP, 400 + width / 2, PANE_TOP + thickness, 'glass', 'pane'),
  ], { goal: 1300, start: { x: 400, y: null, facing: 1 } });
}

// Drop height in units for a given landing speed.
const dropFor = speed => speed * speed / (2 * GRAVITY);

function ride(trail, { drop = 0, seconds = 1.5 } = {}) {
  const start = { x: 400, y: drop ? PANE_TOP - RADIUS - drop : null, facing: 1 };
  const current = createRide(trail, { start });
  const shatters = [];
  for (let step = 0; step < Math.round(seconds / STEP); step++)
    for (const event of stepRide(current, {}))
      if (event.type === 'shatter') shatters.push({ ...event, step: current.steps });
  return { ride: current, shatters };
}

const wheelsBelowPane = current => current.rear.y > PANE_TOP + 20 && current.front.y > PANE_TOP + 20;

// A trail without glass is ridden as it is.
{
  const trail = blockTrail([rectangle(0, GROUND, 1400, GROUND + 200)]);
  assert.equal(createRide(trail).trail, trail, 'a trail without glass is not copied');
}

// Thick glass is plain terrain: it carries the bike and survives a big drop.
{
  const trail = paneTrail(200, 20);
  const resting = ride(trail);
  assert.equal(resting.shatters.length, 0, 'thick glass holds a resting bike');
  const dropped = ride(trail, { drop: dropFor(GLASS_SHATTER_SPEED * 1.6) });
  assert.equal(dropped.shatters.length, 0, 'thick glass survives a fast landing');
  assert.ok(!wheelsBelowPane(dropped.ride), 'the bike stays on thick glass');
}

// Thin, narrow glass holds the bike's weight and a gentle landing...
{
  const trail = paneTrail(80, 8);
  const resting = ride(trail);
  assert.equal(resting.shatters.length, 0, 'thin narrow glass holds a resting bike');
  assert.ok(!wheelsBelowPane(resting.ride), 'the bike rests on thin narrow glass');
  const gentle = ride(trail, { drop: dropFor(GLASS_SHATTER_SPEED * .6) });
  assert.equal(gentle.shatters.length, 0, 'thin narrow glass survives a slow landing');
}

// ...but shatters when hit fast, and the bike goes through, slowed.
{
  const trail = paneTrail(80, 8);
  const fast = ride(trail, { drop: dropFor(GLASS_SHATTER_SPEED * 1.3), seconds: 2.5 });
  assert.equal(fast.shatters.length, 1, 'a fast landing shatters thin glass');
  const [shatter] = fast.shatters;
  assert.equal(shatter.blockId, 'pane');
  assert.ok(shatter.speed >= GLASS_SHATTER_SPEED, `shattered at ${shatter.speed} px/s`);
  assert.deepEqual([shatter.left, shatter.right, shatter.top, shatter.bottom], [360, 440, PANE_TOP, PANE_TOP + 8]);
  assert.ok(wheelsBelowPane(fast.ride), 'the bike falls through the broken pane');
  assert.ok(fast.ride.trail.brokenBlocks.has('pane'));

  // Only that ride lost the pane: the trail and the next attempt keep it.
  assert.ok(terrainGeometry(trail).bodies.some(body => body.blockId === 'pane'), 'the trail keeps its glass');
  assert.ok(!terrainGeometry(fast.ride.trail).bodies.some(body => body.blockId === 'pane'), 'the ride lost its pane');
  assert.equal(createRide(trail).trail.brokenBlocks.size, 0, 'a retry starts with whole glass');

  // Breaking replays exactly.
  const again = ride(trail, { drop: dropFor(GLASS_SHATTER_SPEED * 1.3), seconds: 2.5 });
  assert.equal(again.shatters[0].step, shatter.step, 'glass breaks on the same step every time');
  assert.equal(again.ride.rear.x, fast.ride.rear.x);
  assert.equal(again.ride.rear.y, fast.ride.rear.y);
}

// Thin, wide glass gives way under the bike's weight alone.
{
  const trail = paneTrail(200, 8);
  const resting = ride(trail, { seconds: 2.5 });
  assert.equal(resting.shatters.length, 1, 'thin wide glass breaks under a resting bike');
  assert.ok(resting.shatters[0].step < 10, `broke on step ${resting.shatters[0].step}`);
  assert.ok(wheelsBelowPane(resting.ride), 'the bike drops through thin wide glass');
}

// An upright pane is a wall: riding into it fast breaks it, and the bike
// rides on through. Rolling into it slowly does not.
{
  const wallTrail = startX => blockTrail([
    rectangle(0, GROUND, 1400, GROUND + 200, 'grass', 'ground'),
    rectangle(700, 300, 708, GROUND, 'glass', 'wall'),
  ], { goal: 1300, start: { x: startX, y: null, facing: 1 } });
  const rideInto = (startX, input) => {
    const current = createRide(wallTrail(startX));
    const events = [];
    let reach = -Infinity;
    for (let step = 0; step < 5 / STEP && current.status === 'running'; step++) {
      events.push(...stepRide(current, input(current)));
      reach = Math.max(reach, current.front.x + RADIUS);
    }
    return { current, events, reach };
  };
  const fast = rideInto(100, () => ({ accelerating: true }));
  assert.ok(fast.events.some(event => event.type === 'shatter' && event.blockId === 'wall'), 'riding fast into a thin glass wall breaks it');
  assert.ok(fast.current.rear.x > 708, 'the bike rides on through the wall');
  // Throttle only until just short of the wall, then roll into it.
  const slow = rideInto(600, current => ({ accelerating: current.front.x < 670 }));
  assert.ok(slow.reach > 699, `the slow bike reaches the wall (${slow.reach})`);
  assert.ok(!slow.events.some(event => event.type === 'shatter'), 'rolling gently into a glass wall leaves it whole');
}

console.log('Glass tests passed.');
