import assert from 'node:assert/strict';
import {
  STEP, RADIUS, WHEELBASE, SUSPENSION_REST_LENGTH, SUSPENSION_TRAVEL, XPBD_RIDER_MAX_AIR_SPIN
} from '../js/config.js';
import { curveAt } from '../js/terrain.js';
import { createSimulation as createVehicleSimulation, createVehicle, vehicleMetrics } from '../js/vehicle-physics.js';

const flatLevel = (y = 320) => ({
  name: 'test', points: [[0, y], [1400, y]], gaps: [], platforms: [], paths: [], terrain: 'grass', fallY: y + 500
});

function createSimulation(level, { x = 180, y = null, facing = 1 } = {}) {
  const wheel = wheelX => {
    const wheelY = y ?? curveAt(level.points, wheelX).y - RADIUS;
    return {
      x: wheelX, y: wheelY, ox: wheelX, oy: wheelY, inverseMass: 1,
      grounded: y === null, contact: null, material: level.terrain,
      spin: 0, angularVelocity: 0, compression: 0, impactSpeed: 0
    };
  };
  const rear = wheel(x - WHEELBASE / 2), front = wheel(x + WHEELBASE / 2);
  const vehicle = createVehicle(rear, front);
  const simulation = createVehicleSimulation({ vehicle, level, facing });
  simulation.frames = [];
  return simulation;
}

function assertStructure(simulation) {
  const metrics = vehicleMetrics(simulation.vehicle);
  const points = [simulation.vehicle.rear, simulation.vehicle.front, ...Object.values(simulation.vehicle.chassis)];
  assert.ok(
    points.every(point => [point.x, point.y, point.ox, point.oy].every(Number.isFinite))
      && [metrics.center.x, metrics.center.y, metrics.center.mass, metrics.speedX, metrics.speedY, metrics.pitch,
        metrics.wheelbase, metrics.rearSuspensionLength, metrics.frontSuspensionLength, metrics.chassisArea].every(Number.isFinite),
    'vehicle state must remain finite'
  );

  assert.ok(
    metrics.wheelbase >= WHEELBASE - SUSPENSION_TRAVEL - .5
      && metrics.wheelbase <= WHEELBASE + SUSPENSION_TRAVEL + .5,
    `wheelbase left its travel range: ${metrics.wheelbase}`
  );
  assert.ok(
    metrics.rearSuspensionLength >= SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL - .5
      && metrics.rearSuspensionLength <= SUSPENSION_REST_LENGTH + SUSPENSION_TRAVEL + .5,
    `rear suspension left its travel range: ${metrics.rearSuspensionLength}`
  );
  assert.ok(
    metrics.frontSuspensionLength >= SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL - .5
      && metrics.frontSuspensionLength <= SUSPENSION_REST_LENGTH + SUSPENSION_TRAVEL + .5,
    `front suspension left its travel range: ${metrics.frontSuspensionLength}`
  );
  assert.ok(metrics.chassisArea < -100, `chassis orientation or area became invalid: ${metrics.chassisArea}`);
  return metrics;
}

function step(simulation, { throttle = false, brake = false, lean = 0, flip = false } = {}) {
  const result = simulation.step({
    throttle: throttle === true ? 1 : throttle,
    brake: brake === true ? 1 : brake,
    lean,
    flip
  });
  const metrics = assertStructure(simulation);
  const rearWheel = result.wheels.rear;
  const rearContact = result.contacts.rear;
  const driveSlip = rearContact
    ? Math.abs(((rearWheel.x - rearWheel.ox) * -rearContact.ny + (rearWheel.y - rearWheel.oy) * rearContact.nx) / STEP - rearWheel.angularVelocity * RADIUS)
    : 0;
  simulation.frames.push({
    ...metrics,
    rearX: result.wheels.rear.x,
    frontX: result.wheels.front.x,
    rearY: result.wheels.rear.y,
    frontY: result.wheels.front.y,
    rearGrounded: Boolean(result.contacts.rear),
    frontGrounded: Boolean(result.contacts.front),
    driveSlip
  });
  return metrics;
}

function run(simulation, count, controls) {
  for (let index = 0; index < count; index++) step(simulation, typeof controls === 'function' ? controls(index) : controls);
  return simulation;
}

function accelerationScenario() {
  const simulation = createSimulation(flatLevel());
  run(simulation, 120, {});
  const startX = vehicleMetrics(simulation.vehicle).center.x;
  const firstResult = simulation.step({ throttle: 1 });
  assert.deepEqual(Object.keys(firstResult.wheels).sort(), ['front', 'rear'], 'step result must expose both wheels');
  assert.deepEqual(Object.keys(firstResult.chassis).sort(), ['frontMount', 'rearMount', 'top'], 'step result must expose the chassis');
  assert.ok(firstResult.suspension.restLength > 0 && firstResult.suspension.travel > 0, 'step result must expose suspension configuration');
  assert.ok('contacts' in firstResult && 'forces' in firstResult, 'step result must expose contacts and forces');
  run(simulation, 239, { throttle: true });
  const metrics = vehicleMetrics(simulation.vehicle);
  const speed = metrics.speedX;
  const travel = metrics.center.x - startX;
  const accelerationFrames = simulation.frames.slice(-239);
  const maxFrontClearance = accelerationFrames.reduce(
    (maximum, frame) => Math.max(maximum, 320 - RADIUS - frame.frontY),
    0
  );
  const frontContactRatio = accelerationFrames.filter(frame => frame.frontGrounded).length / accelerationFrames.length;
  const rearContactRatio = accelerationFrames.filter(frame => frame.rearGrounded).length / accelerationFrames.length;
  const maxDriveSlip = accelerationFrames.reduce((maximum, frame) => Math.max(maximum, frame.driveSlip), 0);
  assert.ok(speed > 280 && speed < 345, `flat acceleration speed outside the tuned range: ${speed}`);
  assert.ok(maxDriveSlip < 8, `driven wheel spins out under throttle: ${maxDriveSlip}`);
  assert.ok(travel > 100, `flat acceleration travel too small: ${travel}`);
  assert.ok(maxFrontClearance < 8, `flat-ground throttle lifts the front wheel too far: ${maxFrontClearance}`);
  assert.ok(frontContactRatio > .65, `flat-ground throttle loses front contact too often: ${frontContactRatio}`);
  assert.ok(rearContactRatio > .95, `flat-ground throttle loses rear contact too often: ${rearContactRatio}`);
  return { speed, travel, maxFrontClearance, frontContactRatio, rearContactRatio };
}

function brakingScenario(braking) {
  const simulation = createSimulation(flatLevel());
  run(simulation, 120, {});
  run(simulation, 240, { throttle: true });
  const startX = vehicleMetrics(simulation.vehicle).center.x;
  run(simulation, 90, braking ? { brake: true } : {});
  const metrics = vehicleMetrics(simulation.vehicle);
  const maxRearClearance = simulation.frames.slice(-90).reduce(
    (maximum, frame) => Math.max(maximum, 320 - RADIUS - frame.rearY),
    0
  );
  if (braking) {
    assert.ok(maxRearClearance > 30 && maxRearClearance < 70, `braking stoppie outside the tuned range: ${maxRearClearance}`);
    assert.ok(metrics.pitch > .4 && metrics.pitch < 2.2, `brake dive pitch outside the tuned range: ${metrics.pitch}`);
  }
  return { speed: metrics.speedX, distance: metrics.center.x - startX, maxRearClearance, pitch: metrics.pitch };
}

function controlResponseScenario() {
  const simulation = createSimulation(flatLevel());
  run(simulation, 120, {});
  let result;
  for (let frame = 0; frame < 30; frame++) result = simulation.step({ throttle: 1, lean: 1 });
  assert.ok(result.controls.throttle > .2 && result.controls.throttle < .3, `throttle input ramp outside the tuned range: ${result.controls.throttle}`);
  assert.ok(result.controls.leanControl > .7 && result.controls.leanControl < .85, `lean input ramp outside the tuned range: ${result.controls.leanControl}`);
  return {
    throttleAfterQuarterSecond: result.controls.throttle,
    leanAfterQuarterSecond: result.controls.leanControl
  };
}

function leanScenario() {
  const exercise = lean => {
    const simulation = createSimulation(flatLevel(), { x: 220 });
    run(simulation, 120, {});
    const initialPitch = vehicleMetrics(simulation.vehicle).pitch;
    run(simulation, 90, { lean });
    const inputFrames = simulation.frames.slice(-90);
    return {
      pitchChange: vehicleMetrics(simulation.vehicle).pitch - initialPitch,
      maxFrontClearance: inputFrames.reduce(
        (maximum, frame) => Math.max(maximum, 320 - RADIUS - frame.frontY),
        0
      ),
      maxRearClearance: inputFrames.reduce(
        (maximum, frame) => Math.max(maximum, 320 - RADIUS - frame.rearY),
        0
      )
    };
  };
  const backward = exercise(-1);
  const forward = exercise(1);
  assert.ok(backward.pitchChange < -.8 && backward.pitchChange > -1.8, `rearward lean response outside the tuned range: ${backward.pitchChange}`);
  assert.ok(forward.pitchChange > .8 && forward.pitchChange < 1.8, `forward lean response outside the tuned range: ${forward.pitchChange}`);
  assert.ok(backward.maxFrontClearance > 30 && backward.maxFrontClearance < 70, `rearward lean front lift outside the tuned range: ${backward.maxFrontClearance}`);
  assert.ok(forward.maxRearClearance > 30 && forward.maxRearClearance < 70, `forward lean rear lift outside the tuned range: ${forward.maxRearClearance}`);
  return {
    backwardPitchChange: backward.pitchChange,
    forwardPitchChange: forward.pitchChange,
    maxFrontClearance: backward.maxFrontClearance,
    maxRearClearance: forward.maxRearClearance
  };
}

function airScenario() {
  const simulation = createSimulation(flatLevel(800), { x: 300, y: 250 });
  simulation.vehicle.rear.grounded = false; simulation.vehicle.front.grounded = false;
  const initialPitch = vehicleMetrics(simulation.vehicle).pitch;
  run(simulation, 60, { lean: 1 });
  const pitchChange = vehicleMetrics(simulation.vehicle).pitch - initialPitch;
  assert.ok(Math.abs(pitchChange) > .25 && Math.abs(pitchChange) < .9, `air rotation outside useful range: ${pitchChange}`);
  return { pitchChange };
}

function mirroredHillScenario() {
  const rightLevel = { ...flatLevel(), points: [[0, 320], [250, 320], [550, 220], [1000, 220]] };
  const leftLevel = { ...flatLevel(), points: [[0, 220], [450, 220], [750, 320], [1000, 320]] };
  const right = createSimulation(rightLevel, { x: 150, facing: 1 });
  const left = createSimulation(leftLevel, { x: 850, facing: -1 });
  run(right, 120, {}); run(left, 120, {});
  run(right, 300, { throttle: true, lean: .4 });
  run(left, 300, { throttle: true, lean: -.4 });
  const rightMetrics = vehicleMetrics(right.vehicle);
  const leftMetrics = vehicleMetrics(left.vehicle);
  const rightProgress = rightMetrics.center.x - 150;
  const leftProgress = 850 - leftMetrics.center.x;
  assert.ok(rightProgress > 200 && leftProgress > 200, 'both directions must climb the mirrored hill');
  assert.ok(Math.abs(rightProgress - leftProgress) < 25, `mirrored hill progress differs too much: ${rightProgress} vs ${leftProgress}`);
  assert.ok(Math.abs(rightMetrics.speedX + leftMetrics.speedX) < 30, 'mirrored hill speeds must be approximately opposite');
  return { rightProgress, leftProgress, speedDifference: Math.abs(rightMetrics.speedX + leftMetrics.speedX) };
}

function uphillThrottleScenario(lean = 0) {
  const level = { ...flatLevel(), points: [[0, 320], [250, 320], [550, 220], [1000, 220]] };
  const simulation = createSimulation(level, { x: 150 });
  run(simulation, 120, {});
  run(simulation, 300, { throttle: true, lean });
  const metrics = vehicleMetrics(simulation.vehicle);
  const inputFrames = simulation.frames.slice(-300);
  const slopeFrames = inputFrames.filter(frame => frame.center.x >= 250 && frame.center.x <= 550);
  const averageUphillSpeed = slopeFrames.reduce((sum, frame) => sum + frame.speedX, 0) / Math.max(1, slopeFrames.length);
  const topFrame = inputFrames.findIndex(frame => frame.center.x >= 550);
  const maxFrontClearance = slopeFrames.reduce(
    (maximum, frame) => Math.max(maximum, curveAt(level.points, frame.frontX).y - RADIUS - frame.frontY),
    0
  );
  assert.ok(metrics.center.x - 150 > 340, `uphill progress too small: ${metrics.center.x - 150}`);
  assert.ok(averageUphillSpeed > 180, `rear wheel cannot build useful uphill speed: ${averageUphillSpeed}`);
  assert.ok(maxFrontClearance < (lean > 0 ? 12 : 45), `uphill throttle flips the bike backward too easily: ${maxFrontClearance}`);
  return {
    progress: metrics.center.x - 150,
    speed: metrics.speedX,
    averageUphillSpeed,
    topFrame,
    maxFrontClearance
  };
}

function crestReleaseScenario() {
  const level = {
    ...flatLevel(),
    points: [[0, 320], [220, 320], [400, 230], [580, 320], [1200, 320]]
  };
  const simulation = createSimulation(level, { x: 100 });
  run(simulation, 120, {});
  run(simulation, 300, { throttle: true });
  const airborneFrames = simulation.frames.filter(frame => !frame.rearGrounded && !frame.frontGrounded).length;
  assert.ok(airborneFrames >= 3, `bike remained fastened to the terrain over a sharp crest: ${airborneFrames} airborne frames`);
  return { airborneFrames };
}

function valleyScenario() {
  const level = { ...flatLevel(), points: [[0, 260], [300, 260], [500, 330], [700, 260], [1000, 260]] };
  const simulation = createSimulation(level, { x: 350 });
  run(simulation, 1200, {});
  const early = simulation.frames.slice(240, 480).reduce((max, frame) => Math.max(max, Math.abs(frame.center.x - 500)), 0);
  const late = simulation.frames.slice(-240).reduce((max, frame) => Math.max(max, Math.abs(frame.center.x - 500)), 0);
  assert.ok(late < early, `valley oscillation must decay: early ${early}, late ${late}`);
  assert.ok(late < 45, `suspension must settle valley oscillation promptly: ${late}`);
  return { earlyExcursion: early, lateExcursion: late, finalSpeed: vehicleMetrics(simulation.vehicle).speedX };
}

function rotateVehicle(vehicle, angle, centerX, centerY) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const point of [vehicle.rear, vehicle.front, ...Object.values(vehicle.chassis)]) {
    const dx = point.x - centerX, dy = point.y - centerY;
    point.x = centerX + dx * c - dy * s;
    point.y = centerY + dx * s + dy * c;
    point.ox = point.x - 80 * STEP;
    point.oy = point.y - 240 * STEP;
    point.grounded = false;
    point.contact = null;
  }
}

function landingScenario() {
  const level = flatLevel(400);
  const simulation = createSimulation(level, { x: 300, y: 350 });
  rotateVehicle(simulation.vehicle, .4, 300, 350);
  let firstContact = null, firstWheel = null, bothContact = null, maxUpwardSpeed = 0;
  let minimumRearSuspension = Infinity, minimumFrontSuspension = Infinity;
  for (let index = 0; index < 180; index++) {
    const metrics = step(simulation, {});
    if (firstContact === null && (simulation.vehicle.rear.grounded || simulation.vehicle.front.grounded)) {
      firstContact = index;
      firstWheel = simulation.vehicle.front.grounded ? 'front' : 'rear';
    }
    if (bothContact === null && simulation.vehicle.rear.grounded && simulation.vehicle.front.grounded) bothContact = index;
    maxUpwardSpeed = Math.max(maxUpwardSpeed, -metrics.speedY);
    minimumRearSuspension = Math.min(minimumRearSuspension, metrics.rearSuspensionLength);
    minimumFrontSuspension = Math.min(minimumFrontSuspension, metrics.frontSuspensionLength);
  }
  const lateVerticalSpeed = simulation.frames.slice(-30).reduce((maximum, frame) => Math.max(maximum, Math.abs(frame.speedY)), 0);
  assert.notEqual(firstContact, null, 'one-wheel landing must contact terrain');
  assert.equal(firstWheel, 'front', 'positive-pitch landing must contact the front wheel first');
  assert.notEqual(bothContact, null, 'one-wheel landing must recover both contacts');
  assert.ok(bothContact - firstContact >= 3 && bothContact - firstContact <= 30, `second wheel recovery outside expected range: ${bothContact - firstContact} steps`);
  assert.ok(
    minimumFrontSuspension < SUSPENSION_REST_LENGTH - 10,
    `first wheel did not use enough suspension travel: ${minimumFrontSuspension}`
  );
  assert.ok(maxUpwardSpeed < 40, `landing rebound too large: ${maxUpwardSpeed}`);
  assert.ok(lateVerticalSpeed < .05, `landing did not settle promptly: ${lateVerticalSpeed}`);
  return {
    firstContact,
    firstWheel,
    bothContact,
    maxUpwardSpeed,
    minimumRearSuspension,
    minimumFrontSuspension,
    lateVerticalSpeed
  };
}

function flipKeepsTiresRollingScenario() {
  const simulation = createSimulation(flatLevel(), { x: 300 });
  run(simulation, 120, { throttle: true });
  step(simulation, { flip: true, throttle: true });
  const sameSign = (rear, front) => Math.sign(rear.angularVelocity) === Math.sign(front.angularVelocity) && rear.angularVelocity !== 0;
  assert.ok(sameSign(simulation.vehicle.rear, simulation.vehicle.front), 'a flip must not leave the tires spinning against each other');
  for (let index = 0; index < 40; index++) step(simulation, { throttle: true });
  assert.ok(sameSign(simulation.vehicle.rear, simulation.vehicle.front), 'tires must keep a shared roll direction after flipping');
}

function determinismAndFlipScenario() {
  const inputs = Array.from({ length: 240 }, (_, frame) => ({
    throttle: frame < 150 ? 1 : 0,
    brake: frame >= 180 ? 1 : 0,
    lean: frame < 80 ? -.5 : frame < 160 ? .35 : 0,
    flip: frame === 120
  }));
  const runInputs = () => {
    const simulation = createSimulation(flatLevel(), { x: 300 });
    for (const input of inputs) step(simulation, input);
    return {
      facing: simulation.facing,
      metrics: vehicleMetrics(simulation.vehicle),
      points: [simulation.vehicle.rear, simulation.vehicle.front, ...Object.values(simulation.vehicle.chassis)]
        .map(point => [point.x, point.y, point.ox, point.oy])
    };
  };
  const first = runInputs();
  const second = runInputs();
  assert.equal(first.facing, -1, 'flip input must reverse simulation facing');
  assert.deepEqual(first, second, 'identical inputs must produce an identical vehicle state');
  return { facing: first.facing, finalX: first.metrics.center.x, finalSpeed: first.metrics.speedX };
}

function landingSagScenario() {
  const sinkFrom = drop => {
    const simulation = createSimulation(flatLevel());
    run(simulation, 240, {});
    const rest = vehicleMetrics(simulation.vehicle);
    const restLength = (rest.rearSuspensionLength + rest.frontSuspensionLength) / 2;
    for (const point of [simulation.vehicle.rear, simulation.vehicle.front, ...Object.values(simulation.vehicle.chassis)]) {
      point.y -= drop; point.oy -= drop;
    }
    let shortest = Infinity;
    for (let index = 0; index < 240; index++) {
      const metrics = step(simulation, {});
      shortest = Math.min(shortest, (metrics.rearSuspensionLength + metrics.frontSuspensionLength) / 2);
    }
    return { rest: SUSPENSION_REST_LENGTH - restLength, sink: restLength - shortest };
  };
  const small = sinkFrom(20), medium = sinkFrom(80), large = sinkFrom(200);
  assert.ok(medium.rest > 2.5, `the chassis weight must visibly sag the suspension at rest: ${medium.rest}`);
  assert.ok(small.sink < medium.sink && medium.sink < large.sink, `harder landings must sink further: ${small.sink}, ${medium.sink}, ${large.sink}`);
  assert.ok(medium.sink > 8, `an 80 px drop must visibly compress the real suspension: ${medium.sink}`);
  return { restSag: medium.rest, sink20: small.sink, sink80: medium.sink, sink200: large.sink };
}

function heldLeanScenario() {
  const exercise = controls => {
    const simulation = createSimulation(flatLevel(), { x: 300 });
    run(simulation, 120, {});
    let previous = vehicleMetrics(simulation.vehicle).pitch, turned = 0, lateTurn = 0;
    for (let index = 0; index < 480; index++) {
      const { pitch } = step(simulation, controls);
      const change = Math.atan2(Math.sin(pitch - previous), Math.cos(pitch - previous));
      previous = pitch; turned += change;
      if (index >= 300) lateTurn += change;
    }
    return { turned: Math.abs(turned), lateTurn: Math.abs(lateTurn) };
  };
  const back = exercise({ lean: -1 }), forward = exercise({ lean: 1 });
  for (const [name, result] of [['back', back], ['forward', forward]]) {
    assert.ok(result.turned < Math.PI * 1.5, `holding lean ${name} must not spin the bike around: ${result.turned}`);
    assert.ok(result.lateTurn < .3, `holding lean ${name} must stop rotating once the bike tips over: ${result.lateTurn}`);
  }
  return { backTurned: back.turned, forwardTurned: forward.turned };
}

function droppedSimulation(height, tiltDegrees) {
  const level = flatLevel();
  const simulation = createSimulation(level, { x: 300, y: 320 - RADIUS - height });
  const points = [simulation.vehicle.rear, simulation.vehicle.front, ...Object.values(simulation.vehicle.chassis)];
  const cx = 300, cy = 320 - RADIUS - height, angle = tiltDegrees * Math.PI / 180;
  for (const point of points) {
    const rx = point.x - cx, ry = point.y - cy;
    point.x = cx + rx * Math.cos(angle) + ry * Math.sin(angle);
    point.y = cy - rx * Math.sin(angle) + ry * Math.cos(angle);
    point.ox = point.x; point.oy = point.y;
  }
  return simulation;
}

function steadyAirSpinScenario() {
  const simulation = createSimulation(flatLevel(3000), { x: 300, y: 100 });
  const rates = [];
  let previous = vehicleMetrics(simulation.vehicle).pitch;
  for (let index = 1; index <= 180; index++) {
    const { pitch } = step(simulation, { lean: 1 });
    rates.push(Math.atan2(Math.sin(pitch - previous), Math.cos(pitch - previous)) / STEP);
    previous = pitch;
  }
  const average = (from, to) => rates.slice(from, to).reduce((sum, rate) => sum + rate, 0) / (to - from);
  const atOneSecond = average(114, 126), atOneAndHalf = average(168, 180);
  assert.ok(atOneAndHalf - atOneSecond < .5, `a held air lean should settle into an even spin: ${atOneSecond} -> ${atOneAndHalf}`);
  assert.ok(atOneAndHalf < XPBD_RIDER_MAX_AIR_SPIN * 1.1, `air spin should not run past its target: ${atOneAndHalf}`);
  return { spinAtOneSecond: atOneSecond, spinAtOneAndHalfSeconds: atOneAndHalf };
}

function airLeanKeepsMomentumScenario() {
  const flight = lean => {
    const simulation = createSimulation(flatLevel(3000), { x: 300, y: 100 });
    const points = [simulation.vehicle.rear, simulation.vehicle.front, ...Object.values(simulation.vehicle.chassis)];
    for (const point of points) { point.ox = point.x - 300 * STEP; point.oy = point.y + 400 * STEP; }
    run(simulation, 120, { lean });
    return vehicleMetrics(simulation.vehicle).center;
  };
  const straight = flight(0);
  const drift = Math.max(...[1, -1].map(lean => {
    const center = flight(lean);
    return Math.hypot(center.x - straight.x, center.y - straight.y);
  }));
  assert.ok(drift < .5, `leaning in the air must not move the centre of mass: ${drift}`);
  return { centreDrift: drift };
}

function singleWheelLandingScenario() {
  const simulation = droppedSimulation(60, 25);
  let sink = 0, springBacks = 0, wasCompressing = false, previous = 0;
  for (let index = 0; index < 240; index++) {
    step(simulation, {});
    const compression = SUSPENSION_REST_LENGTH - vehicleMetrics(simulation.vehicle).rearSuspensionLength;
    sink = Math.max(sink, compression);
    const compressing = compression > previous + .02;
    if (wasCompressing && compression < previous - .02) springBacks++;
    if (compressing || compression < previous - .02) wasCompressing = compressing;
    previous = compression;
  }
  assert.ok(sink > 9, `the rear wheel must sink on its own spring when it lands first: ${sink}`);
  assert.ok(springBacks >= 1, `a single-wheel landing should spring back: ${springBacks}`);
  return { rearSink: sink, springBacks };
}

function steepClimbForwardLeanScenario() {
  const rise = Math.tan(40 * Math.PI / 180) * 300;
  const level = { ...flatLevel(600), points: [[0, 600], [250, 600], [550, 600 - rise], [1400, 600 - rise]] };
  const simulation = createSimulation(level, { x: 150 });
  run(simulation, 120, {});
  let maxRearLift = 0, minRelativePitch = Infinity;
  for (let index = 0; index < 420; index++) {
    const { rear, front } = simulation.vehicle;
    const middle = (rear.x + front.x) / 2;
    step(simulation, { throttle: true, lean: middle > 250 ? 1 : 0 });
    if (middle < 290 || middle > 510) continue;
    maxRearLift = Math.max(maxRearLift, curveAt(level.points, rear.x).y - RADIUS - rear.y);
    minRelativePitch = Math.min(minRelativePitch, -vehicleMetrics(simulation.vehicle).pitch * 180 / Math.PI - 40);
  }
  const progress = vehicleMetrics(simulation.vehicle).center.x - 150;
  assert.ok(maxRearLift < 12, `forward lean must not lever the rear wheel off a steep climb: ${maxRearLift}`);
  assert.ok(minRelativePitch > -35, `forward lean must not tip the bike over its front wheel on a climb: ${minRelativePitch}`);
  assert.ok(progress > 400, `forward lean must still let the bike climb: ${progress}`);
  return { maxRearLift, minRelativePitch, progress };
}
// Nothing but the rider holds the nose down on a climb: held throttle on a
// steep hill without leaning forward lifts the front until the bike loops.
function steepClimbLoopScenario() {
  const rise = Math.tan(45 * Math.PI / 180) * 300;
  const level = { ...flatLevel(600), points: [[0, 600], [250, 600], [550, 600 - rise], [1400, 600 - rise]] };
  const simulation = createSimulation(level, { x: 150 });
  run(simulation, 120, {});
  let maxNoseUp = -Infinity;
  for (let index = 0; index < 600; index++) {
    step(simulation, { throttle: true });
    const { rear } = simulation.vehicle;
    if (rear.x > 250 && rear.x < 550) maxNoseUp = Math.max(maxNoseUp, -vehicleMetrics(simulation.vehicle).pitch * 180 / Math.PI - 45);
  }
  assert.ok(maxNoseUp > 90, `held throttle must loop the bike on a 45° climb: nose rose ${maxNoseUp}° above the slope`);
  return { maxNoseUp };
}

// Leaning forward cannot hold the nose down on a near-vertical face.
function steepWallScenario() {
  const height = 600, base = 300;
  const level = { ...flatLevel(800), points: [[0, 800], [base, 800], [base + height / Math.tan(78 * Math.PI / 180), 800 - height], [1400, 800 - height]] };
  let highest = 0;
  for (const lean of [0, .5, 1]) {
    const simulation = createSimulation(level, { x: 200 });
    run(simulation, 60, {});
    // Without the rider's crash check a looped bike keeps sliding on its back,
    // so only count height while it is still the right way up.
    for (let index = 0; index < 720; index++) {
      const { rear, front } = simulation.vehicle;
      const { pitch } = step(simulation, { throttle: true, lean: front.x > base - 10 ? lean : 0 });
      if (Math.abs(pitch) > Math.PI * .85) break;
      highest = Math.max(highest, 800 - RADIUS - Math.min(rear.y, front.y));
    }
  }
  assert.ok(highest < height * .5, `a 78° wall must not be climbable, even leaning forward: reached ${highest} of ${height}`);
  return { highest };
}

const acceleration = accelerationScenario();
const braking = brakingScenario(true);
const coasting = brakingScenario(false);
const uphillThrottle = uphillThrottleScenario();
const uphillForwardLean = uphillThrottleScenario(.45);
assert.ok(Math.abs(braking.speed) < Math.abs(coasting.speed), 'braking must reduce speed more than coasting');
assert.ok(braking.distance < coasting.distance, 'braking distance must be shorter than coasting distance');
// The rear suspension squats under throttle, so plain throttle barely lifts
// the front on a climb; forward lean must still hold it at least as low.
assert.ok(
  uphillForwardLean.maxFrontClearance <= uphillThrottle.maxFrontClearance && uphillForwardLean.maxFrontClearance < 3,
  `forward lean must keep the front wheel down: ${uphillForwardLean.maxFrontClearance} vs ${uphillThrottle.maxFrontClearance}`
);
assert.ok(
  uphillForwardLean.progress > uphillThrottle.progress * .9,
  `forward lean must still climb: ${uphillForwardLean.progress} vs ${uphillThrottle.progress}`
);
const results = {
  acceleration,
  braking,
  coasting,
  controlResponse: controlResponseScenario(),
  lean: leanScenario(),
  air: airScenario(),
  mirroredHill: mirroredHillScenario(),
  uphillThrottle,
  uphillForwardLean,
  crestRelease: crestReleaseScenario(),
  valley: valleyScenario(),
  landing: landingScenario(),
  landingSag: landingSagScenario(),
  heldLean: heldLeanScenario(),
  steadyAirSpin: steadyAirSpinScenario(),
  airLeanKeepsMomentum: airLeanKeepsMomentumScenario(),
  singleWheelLanding: singleWheelLandingScenario(),
  steepClimbForwardLean: steepClimbForwardLeanScenario(),
  steepClimbLoop: steepClimbLoopScenario(),
  steepWall: steepWallScenario(),
  flipKeepsTiresRolling: flipKeepsTiresRollingScenario(),
  determinismAndFlip: determinismAndFlipScenario()
};
console.log('Vehicle integrated scenarios passed.');
console.table(results);
