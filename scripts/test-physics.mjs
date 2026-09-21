import assert from 'node:assert/strict';
import {
  GRAVITY, WHEELBASE, XPBD_RIDER_GROUND_ANGULAR_ACCELERATION,
  XPBD_RIDER_AIR_ANGULAR_ACCELERATION, XPBD_CHASSIS_MOUNT_INVERSE_MASS,
  XPBD_CHASSIS_TOP_INVERSE_MASS, XPBD_MOTOR_ANGULAR_ACCELERATION,
  XPBD_COAST_RESISTANCE_LOW_SPEED, XPBD_COAST_RESISTANCE_HIGH_SPEED,
  XPBD_SUSPENSION_COMPLIANCE, XPBD_SUSPENSION_DAMPING,
  XPBD_LONGITUDINAL_COMPLIANCE, XPBD_LONGITUDINAL_DAMPING
} from '../js/config.js';
import {
  constrainDistanceVelocity, solveDistanceConstraint, createDistanceConstraint,
  createAreaConstraint, signedTriangleArea, resetConstraintMultiplier,
  solveXpbdDistanceConstraint, solveXpbdConstraint, dampingPerIteration,
  dampDistanceConstraint, sweepCircleSegment, riderTorqueMultiplier,
  riderTerrainTorqueScale, advanceAfterTimeOfImpact, solveWheelContactVelocity
} from '../js/physics.js';

const rear = { x: 0, y: 0, ox: -2, oy: 1 };
const front = { x: 40, y: 40, ox: 43, oy: 38 };
const beforeRearVelocity = [rear.x - rear.ox, rear.y - rear.oy];
const beforeFrontVelocity = [front.x - front.ox, front.y - front.oy];
const beforeCenterVelocity = [
  (beforeRearVelocity[0] + beforeFrontVelocity[0]) / 2,
  (beforeRearVelocity[1] + beforeFrontVelocity[1]) / 2
];

const approximatelyEqual = (actual, expected) => Math.abs(actual - expected) < 1e-9;

assert.equal(riderTorqueMultiplier(-1, 1, 1, true, .45), 1.45, 'full throttle must moderately increase rearward lean authority');
assert.equal(riderTorqueMultiplier(1, 1, 1, true, .45), 1, 'throttle must not amplify forward lean');
assert.equal(riderTorqueMultiplier(1, -1, 1, true, .45), 1.45, 'rearward lean assist must follow flipped facing');
assert.equal(riderTorqueMultiplier(-1, 1, 1, false), 1, 'released throttle must not amplify lean');
assert.ok(
  XPBD_RIDER_GROUND_ANGULAR_ACCELERATION * WHEELBASE / 2 > GRAVITY,
  'ground rider torque must be capable of unloading a wheel from rest'
);
assert.ok(approximatelyEqual(XPBD_RIDER_GROUND_ANGULAR_ACCELERATION, 820 / (WHEELBASE / 2)), 'version 2 ground rotation must match version 1');
assert.ok(approximatelyEqual(XPBD_RIDER_AIR_ANGULAR_ACCELERATION, 300 / (WHEELBASE / 2)), 'version 2 air rotation must match version 1');
const v2Mass = 2 + 2 / XPBD_CHASSIS_MOUNT_INVERSE_MASS + 1 / XPBD_CHASSIS_TOP_INVERSE_MASS;
const lowSpeedDriveAcceleration = (XPBD_MOTOR_ANGULAR_ACCELERATION / 30) * 120 / v2Mass;
assert.ok(Math.abs(lowSpeedDriveAcceleration - 400) < 5, 'version 2 low-speed acceleration must match version 1');
assert.ok(Math.abs(2 * XPBD_COAST_RESISTANCE_LOW_SPEED / v2Mass - 105) < 1, 'version 2 low-speed coast loss must match version 1');
assert.ok(Math.abs(2 * XPBD_COAST_RESISTANCE_HIGH_SPEED / v2Mass - 18) < 1, 'version 2 high-speed coast loss must match version 1');
assert.equal(riderTerrainTorqueScale(-1, 1, 1), 1, 'uphill travel must not weaken rearward lean');
assert.ok(riderTerrainTorqueScale(1, 1, .5) < GRAVITY / (XPBD_RIDER_GROUND_ANGULAR_ACCELERATION * WHEELBASE / 2), 'forward lean on a steep uphill must remain below the static rear-wheel lift threshold');
assert.equal(riderTerrainTorqueScale(-1, -1, .5), 1 - .5 * 1.4, 'uphill forward-lean reduction must follow flipped facing');

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

const weightedA = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: 1 };
const weightedB = { x: 12, y: 0, ox: 12, oy: 0, inverseMass: .5 };
const xpbd = createDistanceConstraint(weightedA, weightedB, 10, { compliance: 0 });
resetConstraintMultiplier(xpbd);
solveXpbdDistanceConstraint(xpbd, 1 / 120);
assert.ok(approximatelyEqual(Math.hypot(weightedB.x - weightedA.x, weightedB.y - weightedA.y), 10), 'XPBD must satisfy a rigid distance');
assert.ok(Math.abs(weightedA.x) > Math.abs(weightedB.x - 12), 'XPBD correction must respect inverse mass');
assert.ok(!approximatelyEqual(weightedA.x - weightedA.ox, 0) && !approximatelyEqual(weightedB.x - weightedB.ox, 0), 'XPBD must reconstruct velocity from corrected predicted positions');
const centerVelocityBeforeProjection = ((weightedA.x - weightedA.ox) + 2 * (weightedB.x - weightedB.ox)) / 3;
dampDistanceConstraint(xpbd, 1);
const weightedRelativeVelocity = (weightedB.x - weightedB.ox) - (weightedA.x - weightedA.ox);
const centerVelocityAfterProjection = ((weightedA.x - weightedA.ox) + 2 * (weightedB.x - weightedB.ox)) / 3;
assert.ok(Math.abs(weightedRelativeVelocity) < 1e-9, 'rigid XPBD velocity projection must remove opposing link velocity');
assert.ok(approximatelyEqual(centerVelocityAfterProjection, centerVelocityBeforeProjection), 'velocity projection must conserve inverse-mass-weighted momentum');

const areaA = { x: -5, y: 0, ox: -5, oy: 0, inverseMass: 1 };
const areaB = { x: 5, y: 0, ox: 5, oy: 0, inverseMass: 1 };
const areaTop = { x: 0, y: -8, ox: 0, oy: -8, inverseMass: 1 };
const areaConstraint = createAreaConstraint(areaA, areaB, areaTop);
areaTop.y = 8;
resetConstraintMultiplier(areaConstraint);
for (let iteration = 0; iteration < 12; iteration++) solveXpbdConstraint(areaConstraint, 1 / 120);
assert.ok(signedTriangleArea(areaA, areaB, areaTop) < 0, 'signed-area constraint must restore chassis orientation after a mirror flip');

const springWheel = { x: 0, y: 14, ox: 0, oy: 14, inverseMass: 1 };
const springMount = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: .65 };
const suspensionSpring = createDistanceConstraint(springWheel, springMount, 18, {
  compliance: XPBD_SUSPENSION_COMPLIANCE,
  damping: XPBD_SUSPENSION_DAMPING
});
resetConstraintMultiplier(suspensionSpring);
solveXpbdDistanceConstraint(suspensionSpring, 1 / 120);
const sprungDistance = Math.hypot(springWheel.x - springMount.x, springWheel.y - springMount.y);
assert.ok(sprungDistance > 14 && sprungDistance < 18, 'suspension spring must restore throughout its travel without becoming rigid');

const softRear = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: 1 };
const softFront = { x: 46, y: 0, ox: 46, oy: 0, inverseMass: 1 };
const longitudinalSpring = createDistanceConstraint(softRear, softFront, 50, {
  compliance: XPBD_LONGITUDINAL_COMPLIANCE,
  damping: XPBD_LONGITUDINAL_DAMPING
});
resetConstraintMultiplier(longitudinalSpring);
solveXpbdDistanceConstraint(longitudinalSpring, 1 / 120);
const softenedDistance = softFront.x - softRear.x;
assert.ok(softenedDistance > 47 && softenedDistance < 50, 'longitudinal suspension must remain compliant instead of snapping to rest length');

const limitedRear = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: 1 };
const limitedFront = { x: 70, y: 0, ox: 70, oy: 0, inverseMass: 1 };
const wheelbaseLimit = createDistanceConstraint(limitedRear, limitedFront, 50, { minLength: 43, maxLength: 57 });
resetConstraintMultiplier(wheelbaseLimit);
solveXpbdDistanceConstraint(wheelbaseLimit, 1 / 120);
assert.ok(approximatelyEqual(limitedFront.x - limitedRear.x, 57), 'suspension geometry must enforce maximum wheel spread');
const perIteration = dampingPerIteration(.2, 3);
assert.ok(approximatelyEqual(1 - Math.pow(1 - perIteration, 3), .2), 'constraint damping must not grow when velocity iterations are added');

const sweep = sweepCircleSegment(0, 0, 20, 0, 2, 10, -5, 10, 5);
assert.ok(sweep, 'a fast circle must hit a thin segment');
assert.ok(approximatelyEqual(sweep.time, .4), 'sweep must return the earliest time of impact');
assert.ok(sweep.nx < -.99, 'sweep normal must face the incoming circle');
assert.equal(sweepCircleSegment(0, 10, 20, 10, 2, 10, -5, 10, 5), null, 'a separated sweep must miss');
const sweptPoint = { x: 10, y: 0, ox: 8, oy: 0 };
advanceAfterTimeOfImpact(sweptPoint, .25);
assert.ok(approximatelyEqual(sweptPoint.x, 11.5), 'swept collision must advance through the unused substep');
assert.ok(approximatelyEqual(sweptPoint.x - sweptPoint.ox, 2), 'remaining-time advancement must preserve resolved velocity');

const rolling = { x: 0, y: 0, ox: 0, oy: 0, angularVelocity: 10, spin: 0 };
const traction = solveWheelContactVelocity(rolling, { nx: 0, ny: -1 }, { dt: 1 / 120, radius: 2, friction: 1, inertia: .5 });
assert.ok(traction.tangentImpulse !== 0, 'wheel slip must create a tangential impulse');
assert.notEqual(rolling.x - rolling.ox, 0, 'angular motion must transfer into linear motion');
assert.ok(Math.abs(rolling.angularVelocity) < 10, 'traction must react back on wheel angular velocity');

const forwardWheel = { x: 0, y: 0, ox: 0, oy: 0, angularVelocity: 0, spin: 0 };
solveWheelContactVelocity(forwardWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  friction: 1,
  inertia: .5,
  angularDrive: 600,
  restingNormalAcceleration: 480 * 7
});
const reverseWheel = { x: 0, y: 0, ox: 0, oy: 0, angularVelocity: 0, spin: 0 };
solveWheelContactVelocity(reverseWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  friction: 1,
  inertia: .5,
  angularDrive: -600,
  restingNormalAcceleration: 480 * 7
});
assert.ok(reverseWheel.x - reverseWheel.ox < 0, 'negative wheel torque must drive left after flipping');
assert.ok(reverseWheel.angularVelocity < 0, 'negative wheel torque must preserve its world-space rotation sign');
assert.ok(approximatelyEqual(reverseWheel.x - reverseWheel.ox, -(forwardWheel.x - forwardWheel.ox)), 'forward and reverse traction must be mirror symmetric');
assert.ok(approximatelyEqual(reverseWheel.angularVelocity, -forwardWheel.angularVelocity), 'forward and reverse wheel spin must be mirror symmetric');

const freeWheel = { x: 0, y: 0, ox: -1, oy: 0, angularVelocity: 0, spin: 0 };
const freeRolling = solveWheelContactVelocity(freeWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  friction: 1,
  inertia: .5,
  freeRolling: true
});
assert.ok(approximatelyEqual(freeWheel.x - freeWheel.ox, 1), 'a free-rolling wheel must preserve tangential momentum');
assert.ok(approximatelyEqual(freeWheel.angularVelocity, 10), 'a free-rolling wheel must match angular speed to ground speed');
assert.equal(freeRolling.tangentImpulse, 0, 'a free-rolling wheel without resistance must not apply a tangential impulse');

const coastingWheel = { x: 0, y: 0, ox: -1, oy: 0, angularVelocity: 10, spin: 0 };
solveWheelContactVelocity(coastingWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  freeRolling: true,
  rollingResistance: 120
});
assert.ok(approximatelyEqual((coastingWheel.x - coastingWheel.ox) * 120, 119), 'rolling resistance must remove a bounded amount of speed');
assert.ok(approximatelyEqual(coastingWheel.angularVelocity * 12, 119), 'free wheel spin must follow the reduced rolling speed');

const brakingWheel = { x: 0, y: 0, ox: -1, oy: 0, angularVelocity: 10, spin: 0 };
solveWheelContactVelocity(brakingWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  friction: 1,
  inertia: .5,
  angularBrake: 60,
  restingNormalAcceleration: 480 * 7
});
assert.ok((brakingWheel.x - brakingWheel.ox) * 120 < 120, 'wheel braking must reduce linear ground speed');
assert.ok(brakingWheel.angularVelocity < 10, 'wheel braking must reduce angular speed');

console.log('Bike constraint, sweep, and traction tests passed.');
