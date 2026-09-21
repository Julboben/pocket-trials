import assert from 'node:assert/strict';
import { STEP, RADIUS, WHEELBASE, lerp } from '../js/config.js';
import { curveAt } from '../js/terrain.js';
import { createVersion2Vehicle, stepVersion2Vehicle, version2VehicleMetrics } from '../js/vehicle-physics.js';

const flatLevel = (y = 320) => ({
  name: 'test', points: [[0, y], [1400, y]], gaps: [], platforms: [], paths: [], terrain: 'grass', fallY: y + 500
});

function createSimulation(level, { x = 180, y = null, facing = 1 } = {}) {
  const wheel = wheelX => {
    const wheelY = y ?? curveAt(level.points, wheelX).y - RADIUS;
    return {
      x: wheelX, y: wheelY, ox: wheelX, oy: wheelY, inverseMass: 1,
      grounded: y === null, contact: null, material: level.terrain,
      spin: 0, angularVelocity: 0, compression: 0, springVelocity: 0, impactSpeed: 0
    };
  };
  const rear = wheel(x - WHEELBASE / 2), front = wheel(x + WHEELBASE / 2);
  const vehicle = createVersion2Vehicle(rear, front);
  return { level, vehicle, facing, throttle: 0, brakePressure: 0, frames: [] };
}

function assertStructure(simulation) {
  const metrics = version2VehicleMetrics(simulation.vehicle);
  assert.ok(Object.values(metrics).every(value => typeof value !== 'number' || Number.isFinite(value)), 'vehicle state must remain finite');

  assert.ok(metrics.wheelbase >= 1 && metrics.wheelbase <= 120, `wheelbase diverged: ${metrics.wheelbase}`);
  assert.ok(metrics.rearSuspensionLength < 200, `rear suspension diverged: ${metrics.rearSuspensionLength}`);
  assert.ok(metrics.frontSuspensionLength < 200, `front suspension diverged: ${metrics.frontSuspensionLength}`);
  assert.ok(metrics.chassisArea < 0, 'chassis orientation must remain upright');
  return metrics;
}

function step(simulation, { throttle = false, brake = false, lean = 0 } = {}) {
  const throttleTarget = throttle && !brake ? 1 : 0;
  simulation.throttle = lerp(simulation.throttle, throttleTarget, 1 - Math.exp(-(throttleTarget > simulation.throttle ? 1.1 : 4) * STEP));
  simulation.brakePressure = lerp(simulation.brakePressure, brake ? 1 : 0, 1 - Math.exp(-(brake ? 10 : 14) * STEP));
  stepVersion2Vehicle(simulation.vehicle, simulation.level, {
    facing: simulation.facing,
    throttle: simulation.throttle,
    brakePressure: simulation.brakePressure,
    leanControl: lean,
    accelerating: throttle,
    braking: brake,
    coasting: !throttle && !brake
  });
  const metrics = assertStructure(simulation);
  simulation.frames.push({
    ...metrics,
    rearY: simulation.vehicle.rear.y,
    frontY: simulation.vehicle.front.y,
    rearGrounded: simulation.vehicle.rear.grounded,
    frontGrounded: simulation.vehicle.front.grounded
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
  const startX = version2VehicleMetrics(simulation.vehicle).center.x;
  run(simulation, 240, { throttle: true });
  const metrics = version2VehicleMetrics(simulation.vehicle);
  const speed = metrics.speedX;
  const travel = metrics.center.x - startX;
  assert.ok(speed > 120 && speed < 380, `flat acceleration speed outside useful range: ${speed}`);
  assert.ok(travel > 100, `flat acceleration travel too small: ${travel}`);
  return { speed, travel };
}

function brakingScenario(braking) {
  const simulation = createSimulation(flatLevel());
  run(simulation, 120, {});
  run(simulation, 240, { throttle: true });
  const startX = version2VehicleMetrics(simulation.vehicle).center.x;
  run(simulation, 90, braking ? { brake: true } : {});
  const metrics = version2VehicleMetrics(simulation.vehicle);
  return { speed: metrics.speedX, distance: metrics.center.x - startX };
}

function leanScenario() {
  const simulation = createSimulation(flatLevel(), { x: 220 });
  run(simulation, 120, {});
  let maxFrontClearance = 0;
  run(simulation, 120, () => ({ lean: -1 }));
  for (const frame of simulation.frames.slice(-120)) maxFrontClearance = Math.max(maxFrontClearance, 320 - RADIUS - frame.frontY);
  const frontClearance = 320 - RADIUS - simulation.vehicle.front.y;
  assert.ok(maxFrontClearance > 1 || frontClearance > 1, 'rearward lean must be able to unload the front wheel from rest');
  return { frontClearance, pitch: version2VehicleMetrics(simulation.vehicle).pitch };
}

function airScenario() {
  const simulation = createSimulation(flatLevel(800), { x: 300, y: 250 });
  simulation.vehicle.rear.grounded = false; simulation.vehicle.front.grounded = false;
  const initialPitch = version2VehicleMetrics(simulation.vehicle).pitch;
  run(simulation, 60, { lean: 1 });
  const pitchChange = version2VehicleMetrics(simulation.vehicle).pitch - initialPitch;
  assert.ok(Math.abs(pitchChange) > .25, `air rotation too weak: ${pitchChange}`);
  return { pitchChange };
}

function mirroredHillScenario() {
  const rightLevel = { ...flatLevel(), points: [[0, 320], [250, 320], [550, 220], [1000, 220]] };
  const leftLevel = { ...flatLevel(), points: [[0, 220], [450, 220], [750, 320], [1000, 320]] };
  const right = createSimulation(rightLevel, { x: 150, facing: 1 });
  const left = createSimulation(leftLevel, { x: 850, facing: -1 });
  run(right, 120, {}); run(left, 120, {});
  run(right, 300, { throttle: true, lean: 1 });
  run(left, 300, { throttle: true, lean: -1 });
  const rightMetrics = version2VehicleMetrics(right.vehicle);
  const leftMetrics = version2VehicleMetrics(left.vehicle);
  const rightProgress = rightMetrics.center.x - 150;
  const leftProgress = 850 - leftMetrics.center.x;
  assert.ok(rightProgress > 200 && leftProgress > 200, 'both directions must climb the mirrored hill');
  assert.ok(Math.abs(rightProgress - leftProgress) < 25, `mirrored hill progress differs too much: ${rightProgress} vs ${leftProgress}`);
  assert.ok(Math.abs(rightMetrics.speedX + leftMetrics.speedX) < 30, 'mirrored hill speeds must be approximately opposite');
  return { rightProgress, leftProgress, speedDifference: Math.abs(rightMetrics.speedX + leftMetrics.speedX) };
}

function valleyScenario() {
  const level = { ...flatLevel(), points: [[0, 260], [300, 260], [500, 330], [700, 260], [1000, 260]] };
  const simulation = createSimulation(level, { x: 350 });
  run(simulation, 1200, {});
  const early = simulation.frames.slice(240, 480).reduce((max, frame) => Math.max(max, Math.abs(frame.center.x - 500)), 0);
  const late = simulation.frames.slice(-240).reduce((max, frame) => Math.max(max, Math.abs(frame.center.x - 500)), 0);
  assert.ok(late < early, `valley oscillation must decay: early ${early}, late ${late}`);
  return { earlyExcursion: early, lateExcursion: late, finalSpeed: version2VehicleMetrics(simulation.vehicle).speedX };
}

function rotateVehicle(vehicle, angle, centerX, centerY) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const point of [vehicle.rear, vehicle.front, ...Object.values(vehicle.chassis)]) {
    const dx = point.x - centerX, dy = point.y - centerY;
    point.x = centerX + dx * c - dy * s;
    point.y = centerY + dx * s + dy * c;
    point.ox = point.x - 80 * STEP;
    point.oy = point.y - 180 * STEP;
    point.grounded = false;
    point.contact = null;
  }
}

function landingScenario() {
  const level = flatLevel(400);
  const simulation = createSimulation(level, { x: 300, y: 350 });
  rotateVehicle(simulation.vehicle, .28, 300, 350);
  let firstContact = null, bothContact = null, maxUpwardSpeed = 0;
  for (let index = 0; index < 180; index++) {
    const metrics = step(simulation, {});
    if (firstContact === null && (simulation.vehicle.rear.grounded || simulation.vehicle.front.grounded)) firstContact = index;
    if (bothContact === null && simulation.vehicle.rear.grounded && simulation.vehicle.front.grounded) bothContact = index;
    maxUpwardSpeed = Math.max(maxUpwardSpeed, -metrics.speedY);
  }
  assert.notEqual(firstContact, null, 'one-wheel landing must contact terrain');
  assert.notEqual(bothContact, null, 'one-wheel landing must recover both contacts');
  assert.ok(bothContact - firstContact < 60, `second wheel recovery too slow: ${bothContact - firstContact} steps`);
  assert.ok(maxUpwardSpeed < 140, `landing rebound too large: ${maxUpwardSpeed}`);
  return { firstContact, bothContact, maxUpwardSpeed };
}

const acceleration = accelerationScenario();
const braking = brakingScenario(true);
const coasting = brakingScenario(false);
assert.ok(Math.abs(braking.speed) < Math.abs(coasting.speed), 'braking must reduce speed more than coasting');
assert.ok(braking.distance < coasting.distance, 'braking distance must be shorter than coasting distance');
const results = {
  acceleration,
  braking,
  coasting,
  lean: leanScenario(),
  air: airScenario(),
  mirroredHill: mirroredHillScenario(),
  valley: valleyScenario(),
  landing: landingScenario()
};
console.log('Version 2 integrated scenarios passed.');
console.table(results);
