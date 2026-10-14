import assert from 'node:assert/strict';
import {
  GRAVITY, WHEELBASE, XPBD_RIDER_GROUND_ANGULAR_ACCELERATION,
  XPBD_RIDER_AIR_ANGULAR_ACCELERATION, XPBD_CHASSIS_MOUNT_INVERSE_MASS,
  XPBD_CHASSIS_TOP_INVERSE_MASS, XPBD_MOTOR_ANGULAR_ACCELERATION,
  XPBD_TORQUE_FALLOFF_SPEED, XPBD_MOTOR_REACTION_SCALE, XPBD_THROTTLE_LEAN_ASSIST,
  XPBD_UPHILL_FORWARD_LEAN_REDUCTION,
  XPBD_COAST_RESISTANCE_LOW_SPEED, XPBD_COAST_RESISTANCE_HIGH_SPEED,
  FORK_SUSPENSION
} from '../js/config.js';
import {
  constrainDistanceVelocity, createDistanceConstraint,
  createAreaConstraint, createSliderConstraint, createAxisLimitConstraint, signedTriangleArea, resetConstraintMultiplier,
  solveXpbdDistanceConstraint, solveXpbdConstraint, dampingPerIteration,
  dampDistanceConstraint, sweepCircleSegment, riderTorqueMultiplier,
  riderTerrainTorqueScale, riderSpinTorqueScale,
  advanceAfterTimeOfImpact, solveWheelContactVelocity
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

assert.equal(riderTorqueMultiplier(-1, 1, 1, true, XPBD_THROTTLE_LEAN_ASSIST), 1 + XPBD_THROTTLE_LEAN_ASSIST, 'full throttle must only slightly increase rearward lean authority');
assert.equal(riderTorqueMultiplier(1, 1, 1, true, XPBD_THROTTLE_LEAN_ASSIST), 1, 'throttle must not amplify forward lean');
assert.equal(riderTorqueMultiplier(1, -1, 1, true, XPBD_THROTTLE_LEAN_ASSIST), 1 + XPBD_THROTTLE_LEAN_ASSIST, 'rearward lean assist must follow flipped facing');
assert.equal(riderTorqueMultiplier(-1, 1, 1, false), 1, 'released throttle must not amplify lean');
const targetAirAlpha = 300 / (WHEELBASE / 2);
assert.ok(
  XPBD_RIDER_GROUND_ANGULAR_ACCELERATION > 20 && XPBD_RIDER_GROUND_ANGULAR_ACCELERATION < 820 / (WHEELBASE / 2),
  'ground rider torque must be strong enough to lift a wheel without becoming twitchy'
);
assert.ok(
  Math.abs(XPBD_RIDER_AIR_ANGULAR_ACCELERATION - targetAirAlpha) < .05,
  'air rotation must stay at the tuned handling target'
);
assert.equal(XPBD_TORQUE_FALLOFF_SPEED, 340, 'torque falloff speed must stay at the tuned handling target');
assert.ok(
  XPBD_MOTOR_REACTION_SCALE > 0 && XPBD_MOTOR_REACTION_SCALE <= 1,
  'motor reaction must stay within the physical wheel torque'
);
assert.ok(XPBD_UPHILL_FORWARD_LEAN_REDUCTION > 0, 'forward lean must not lever the rear wheel off a climb');
assert.equal(XPBD_MOTOR_REACTION_SCALE, 1, 'throttle reaction must be the full wheel torque, so steep climbs can loop the bike');
const vehicleMass = 2 + 2 / XPBD_CHASSIS_MOUNT_INVERSE_MASS + 1 / XPBD_CHASSIS_TOP_INVERSE_MASS;
const lowSpeedDriveAcceleration = (XPBD_MOTOR_ANGULAR_ACCELERATION / 30) * 120 / vehicleMass;
assert.ok(
  lowSpeedDriveAcceleration > 400 && lowSpeedDriveAcceleration < 460,
  'hooked-up low-speed acceleration must stay at the tuned handling target'
);
assert.ok(Math.abs(2 * XPBD_COAST_RESISTANCE_LOW_SPEED / vehicleMass - 105) < 1, 'low-speed coast loss must stay at 105 px/s²');
assert.ok(Math.abs(2 * XPBD_COAST_RESISTANCE_HIGH_SPEED / vehicleMass - 18) < 1, 'high-speed coast loss must stay at 18 px/s²');
assert.equal(riderTerrainTorqueScale(-1, 1, 1), 1, 'uphill travel must not weaken rearward lean');
assert.ok(riderTerrainTorqueScale(1, 1, .5) < GRAVITY / (XPBD_RIDER_GROUND_ANGULAR_ACCELERATION * WHEELBASE / 2), 'forward lean on a steep uphill must remain below the static rear-wheel lift threshold');
assert.equal(riderTerrainTorqueScale(-1, -1, .5), 1 - .5 * 1.4, 'uphill forward-lean reduction must follow flipped facing');
assert.equal(riderTerrainTorqueScale(1, 1, .5, 1.4, 1), 1, 'forward lean keeps full strength to pull a lifted front wheel down');
assert.equal(riderTerrainTorqueScale(1, 1, .5, 1.4, .5), 1 - .5 * .5 * 1.4, 'forward-lean reduction eases out as the front wheel lifts');

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
  compliance: FORK_SUSPENSION.compliance,
  damping: FORK_SUSPENSION.damping
});
resetConstraintMultiplier(suspensionSpring);
solveXpbdDistanceConstraint(suspensionSpring, 1 / 120);
const sprungDistance = Math.hypot(springWheel.x - springMount.x, springWheel.y - springMount.y);
assert.ok(sprungDistance > 14 && sprungDistance < 18, 'suspension spring must restore throughout its travel without becoming rigid');

const softRear = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: 1 };
const softFront = { x: 46, y: 0, ox: 46, oy: 0, inverseMass: 1 };
const longitudinalSpring = createDistanceConstraint(softRear, softFront, 50, {
  compliance: 0.00004,
  damping: .55
});
resetConstraintMultiplier(longitudinalSpring);
solveXpbdDistanceConstraint(longitudinalSpring, 1 / 120);
const softenedDistance = softFront.x - softRear.x;
assert.ok(softenedDistance > 47 && softenedDistance < 50, 'a compliant link must stay soft instead of snapping to rest length');

const limitedRear = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: 1 };
const limitedFront = { x: 70, y: 0, ox: 70, oy: 0, inverseMass: 1 };
const wheelbaseLimit = createDistanceConstraint(limitedRear, limitedFront, 50, { minLength: 43, maxLength: 57 });
resetConstraintMultiplier(wheelbaseLimit);
solveXpbdDistanceConstraint(wheelbaseLimit, 1 / 120);
assert.ok(approximatelyEqual(limitedFront.x - limitedRear.x, 57), 'a distance limit must enforce its maximum length');
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
const traction = solveWheelContactVelocity(rolling, { nx: 0, ny: -1 }, { dt: 1 / 120, radius: 2, friction: 1, inertia: .5, normalLoad: 4 });
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
  normalLoad: 480 * 7 / 120
});
const reverseWheel = { x: 0, y: 0, ox: 0, oy: 0, angularVelocity: 0, spin: 0 };
solveWheelContactVelocity(reverseWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  friction: 1,
  inertia: .5,
  angularDrive: -600,
  normalLoad: 480 * 7 / 120
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
  normalLoad: 480 * 7 / 120
});
assert.ok((brakingWheel.x - brakingWheel.ox) * 120 < 120, 'wheel braking must reduce linear ground speed');
assert.ok(brakingWheel.angularVelocity < 10, 'wheel braking must reduce angular speed');

const lockedWheel = { x: 0, y: 0, ox: -.05, oy: 0, angularVelocity: .5, spin: 0 };
const locked = solveWheelContactVelocity(lockedWheel, { nx: 0, ny: -1 }, {
  dt: 1 / 120,
  radius: 12,
  inertia: .5,
  angularBrake: 720,
  normalLoad: 480 * 4.5 / 120
});
assert.equal(lockedWheel.angularVelocity, 0, 'a strong enough brake locks a slow wheel');
assert.ok(approximatelyEqual(lockedWheel.x - lockedWheel.ox, 0), 'a locked wheel with grip to spare stops on the spot');
assert.ok(locked.held, 'a locked, gripping wheel reports that it is held');

const sliderStart = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: 0 };
const sliderEnd = { x: 50, y: 0, ox: 50, oy: 0, inverseMass: 0 };
const sliderMount = { x: 10, y: 0, ox: 10, oy: 0, inverseMass: 1 };
const sliderWheel = { x: 16, y: 20, ox: 16, oy: 20, inverseMass: 1 };
const slider = createSliderConstraint(sliderWheel, sliderMount, sliderStart, sliderEnd);
solveXpbdConstraint(slider, 1 / 120);
assert.ok(approximatelyEqual(sliderWheel.x, sliderMount.x), 'a rigid slider lines the wheel up with its mount along the axis');
assert.ok(approximatelyEqual(sliderWheel.x, 13) && approximatelyEqual(sliderWheel.y, 20), 'a slider only corrects along the axis and splits it by inverse mass');
sliderWheel.y = 4;
solveXpbdConstraint(slider, 1 / 120);
assert.ok(approximatelyEqual(sliderWheel.y, 4), 'a slider leaves travel across the axis free for the spring');

// A wheel hanging off a leg pushes on the frame a leg's length from the axis.
// The frame must take that as a twist, not invent spin out of nothing.
function spinMoment(points, before) {
  return points.reduce((sum, p, i) => sum + (before[i].x * (p.y - before[i].y) - before[i].y * (p.x - before[i].x)) / p.inverseMass, 0);
}
function pushMoment(points, before) {
  return points.reduce((sum, p, i) => [sum[0] + (p.x - before[i].x) / p.inverseMass, sum[1] + (p.y - before[i].y) / p.inverseMass], [0, 0]);
}
for (const make of [
  (wheel, rearMount, frontMount, top) => createSliderConstraint(wheel, frontMount, rearMount, frontMount, { compliance: .0001 }),
  (wheel, rearMount, frontMount, top) => createAxisLimitConstraint(wheel, frontMount, rearMount, frontMount, top, 30),
]) {
  const rearMount = { x: 0, y: 0, ox: 0, oy: 0, inverseMass: .5 };
  const frontMount = { x: 50, y: 0, ox: 50, oy: 0, inverseMass: .5 };
  const top = { x: 25, y: -22, ox: 25, oy: -22, inverseMass: .5 };
  const wheel = { x: 58, y: 26, ox: 58, oy: 26, inverseMass: 1 };
  const points = [wheel, rearMount, frontMount, top];
  const before = points.map(({ x, y }) => ({ x, y }));
  const constraint = make(wheel, rearMount, frontMount, top);
  for (let i = 0; i < 4; i++) solveXpbdConstraint(constraint, 1 / 120);
  const moved = Math.hypot(wheel.x - before[0].x, wheel.y - before[0].y);
  const [px, py] = pushMoment(points, before);
  assert.ok(moved > 1, `a ${constraint.type} constraint moves an off-line wheel`);
  assert.ok(Math.abs(px) < 1e-9 && Math.abs(py) < 1e-9, `a ${constraint.type} constraint adds no push to the bike`);
  assert.ok(Math.abs(spinMoment(points, before)) < .01, `a ${constraint.type} constraint adds no spin to the bike: ${spinMoment(points, before)}`);
}

assert.equal(riderSpinTorqueScale(-12, 3, 10), 1, 'lean against the current spin is never reduced');
assert.equal(riderSpinTorqueScale(12, 7, 10), 1, 'lean keeps full strength below three quarters of the spin cap');
assert.ok(approximatelyEqual(riderSpinTorqueScale(12, 8.75, 10), .5), 'lean fades over the last quarter of the spin cap');
assert.equal(riderSpinTorqueScale(-12, -10, 10), 0, 'lean adds no spin at the cap');

const reboundA = { x: 0, y: 0, ox: 0, oy: 0 };
const reboundB = { x: 20, y: 0, ox: 19, oy: 0 };
const rebound = createDistanceConstraint(reboundA, reboundB, 20, { damping: .2, reboundDamping: .8 });
dampDistanceConstraint(rebound, rebound.damping, rebound.reboundDamping);
assert.ok(approximatelyEqual(reboundB.x - reboundB.ox - (reboundA.x - reboundA.ox), .2), 'an extending link uses rebound damping');
const compressA = { x: 0, y: 0, ox: 0, oy: 0 };
const compressB = { x: 20, y: 0, ox: 21, oy: 0 };
const compress = createDistanceConstraint(compressA, compressB, 20, { damping: .2, reboundDamping: .8 });
dampDistanceConstraint(compress, compress.damping, compress.reboundDamping);
assert.ok(approximatelyEqual(compressB.x - compressB.ox - (compressA.x - compressA.ox), -.8), 'a compressing link uses the softer damping');

console.log('Bike constraint, sweep, and traction tests passed.');
