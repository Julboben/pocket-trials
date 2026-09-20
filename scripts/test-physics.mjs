import assert from 'node:assert/strict';
import { constrainDistanceVelocity, solveDistanceConstraint } from '../js/physics.js';

const rear = { x: 0, y: 0, ox: -2, oy: 1 };
const front = { x: 40, y: 40, ox: 43, oy: 38 };
const beforeRearVelocity = [rear.x - rear.ox, rear.y - rear.oy];
const beforeFrontVelocity = [front.x - front.ox, front.y - front.oy];
const beforeCenterVelocity = [
  (beforeRearVelocity[0] + beforeFrontVelocity[0]) / 2,
  (beforeRearVelocity[1] + beforeFrontVelocity[1]) / 2
];

const approximatelyEqual = (actual, expected) => Math.abs(actual - expected) < 1e-9;

solveDistanceConstraint(rear, front, 50, .43);
assert.ok(
  approximatelyEqual(rear.x - rear.ox, beforeRearVelocity[0])
    && approximatelyEqual(rear.y - rear.oy, beforeRearVelocity[1]),
  'position correction must not become rear-wheel velocity'
);
assert.ok(
  approximatelyEqual(front.x - front.ox, beforeFrontVelocity[0])
    && approximatelyEqual(front.y - front.oy, beforeFrontVelocity[1]),
  'position correction must not become front-wheel velocity'
);

constrainDistanceVelocity(rear, front);
const afterCenterVelocity = [
  ((rear.x - rear.ox) + (front.x - front.ox)) / 2,
  ((rear.y - rear.oy) + (front.y - front.oy)) / 2
];
assert.ok(Math.abs(afterCenterVelocity[0] - beforeCenterVelocity[0]) < 1e-9, 'constraint must conserve horizontal center velocity');
assert.ok(Math.abs(afterCenterVelocity[1] - beforeCenterVelocity[1]) < 1e-9, 'constraint must conserve vertical center velocity');

const dx = front.x - rear.x;
const dy = front.y - rear.y;
const distance = Math.hypot(dx, dy);
const relativeAlongFrame = ((front.x - front.ox) - (rear.x - rear.ox)) * dx / distance
  + ((front.y - front.oy) - (rear.y - rear.oy)) * dy / distance;
assert.ok(Math.abs(relativeAlongFrame) < 1e-9, 'wheels must not separate along the bike frame');

console.log('Bike constraint tests passed.');
