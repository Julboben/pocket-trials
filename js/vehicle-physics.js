import {
  STEP, RADIUS, WHEELBASE, GRAVITY, MAX_POINT_SPEED, UPHILL_TORQUE_BOOST,
  BIKE_SOLVER_ITERATIONS, BIKE_VELOCITY_ITERATIONS,
  XPBD_CHASSIS_COMPLIANCE, XPBD_CHASSIS_AREA_COMPLIANCE,
  XPBD_SUSPENSION_COMPLIANCE, XPBD_SUSPENSION_DAMPING,
  XPBD_LONGITUDINAL_COMPLIANCE, XPBD_LONGITUDINAL_DAMPING,
  XPBD_CROSS_LINK_COMPLIANCE, XPBD_CROSS_LINK_DAMPING,
  SUSPENSION_REST_LENGTH, SUSPENSION_TRAVEL, XPBD_WHEELBASE_SLACK,
  WHEEL_INERTIA, WHEEL_FRICTION,
  XPBD_CHASSIS_MOUNT_INVERSE_MASS, XPBD_CHASSIS_TOP_INVERSE_MASS,
  XPBD_MOTOR_ANGULAR_ACCELERATION, XPBD_MAX_DRIVE_SPEED, XPBD_MOTOR_REACTION_SCALE,
  XPBD_RIDER_GROUND_ANGULAR_ACCELERATION, XPBD_RIDER_AIR_ANGULAR_ACCELERATION,
  XPBD_THROTTLE_LEAN_ASSIST, XPBD_THROTTLE_INPUT_RESPONSE, XPBD_LEAN_INPUT_RESPONSE,
  XPBD_UPHILL_FORWARD_LEAN_REDUCTION, XPBD_UPHILL_FORWARD_LEAN_MOTOR_BOOST,
  XPBD_UPHILL_ANTI_WHEELIE_ACCELERATION, XPBD_BRAKE_REACTION_SCALE, XPBD_BRAKE_REACTION_LIMIT,
  XPBD_BRAKE_RATE, XPBD_CONTACT_LOAD_SCALE, XPBD_DRIVE_LOAD_SCALE, XPBD_UPHILL_CONTACT_LOAD_SCALE, XPBD_ROLLING_LOAD_SCALE,
  XPBD_COAST_RESISTANCE_LOW_SPEED, XPBD_COAST_RESISTANCE_HIGH_SPEED,
  XPBD_COAST_SPEED_REFERENCE, XPBD_CONTACT_RESTITUTION_SCALE,
  CONTACT_GROUNDED_NORMAL, CONTACT_RESTITUTION_SPEED,
  clamp, lerp
} from './config.js';
import {
  createDistanceConstraint, createAreaConstraint, signedTriangleArea,
  resetConstraintMultiplier, solveXpbdConstraint, dampingPerIteration,
  dampDistanceConstraint, riderTorqueMultiplier, riderTerrainTorqueScale,
  advanceAfterTimeOfImpact, solveWheelContactVelocity
} from './physics.js';
import { terrainAt, terrainCollisionsAt, terrainSweepCollision } from './terrain.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createVersion2Vehicle(rear, front) {
  const mountY = (rear.y + front.y) / 2 - SUSPENSION_REST_LENGTH;
  const makePoint = (x, y, inverseMass) => ({ x, y, ox: x, oy: y, inverseMass, grounded: false, contact: null, radius: 4 });
  const chassis = {
    rearMount: makePoint(rear.x, mountY, XPBD_CHASSIS_MOUNT_INVERSE_MASS),
    frontMount: makePoint(front.x, mountY, XPBD_CHASSIS_MOUNT_INVERSE_MASS),
    top: makePoint((rear.x + front.x) / 2, mountY - 22, XPBD_CHASSIS_TOP_INVERSE_MASS)
  };
  const diagonal = Math.hypot(WHEELBASE, SUSPENSION_REST_LENGTH);
  const wheelbaseLimit = createDistanceConstraint(rear, front, WHEELBASE, {
    compliance: 0,
    damping: XPBD_CROSS_LINK_DAMPING,
    minLength: WHEELBASE - XPBD_WHEELBASE_SLACK,
    maxLength: WHEELBASE + XPBD_WHEELBASE_SLACK
  });
  const constraints = [
    createDistanceConstraint(chassis.rearMount, chassis.frontMount, WHEELBASE, { compliance: XPBD_CHASSIS_COMPLIANCE, damping: 1 }),
    createDistanceConstraint(chassis.rearMount, chassis.top, Math.hypot(WHEELBASE / 2, 22), { compliance: XPBD_CHASSIS_COMPLIANCE, damping: 1 }),
    createDistanceConstraint(chassis.frontMount, chassis.top, Math.hypot(WHEELBASE / 2, 22), { compliance: XPBD_CHASSIS_COMPLIANCE, damping: 1 }),
    createAreaConstraint(chassis.rearMount, chassis.frontMount, chassis.top, { compliance: XPBD_CHASSIS_AREA_COMPLIANCE }),
    createDistanceConstraint(rear, front, WHEELBASE, { compliance: XPBD_LONGITUDINAL_COMPLIANCE, damping: XPBD_LONGITUDINAL_DAMPING }),
    createDistanceConstraint(rear, chassis.rearMount, SUSPENSION_REST_LENGTH, { compliance: XPBD_SUSPENSION_COMPLIANCE, damping: XPBD_SUSPENSION_DAMPING }),
    createDistanceConstraint(front, chassis.frontMount, SUSPENSION_REST_LENGTH, { compliance: XPBD_SUSPENSION_COMPLIANCE, damping: XPBD_SUSPENSION_DAMPING }),
    createDistanceConstraint(rear, chassis.frontMount, diagonal, { compliance: XPBD_CROSS_LINK_COMPLIANCE, damping: XPBD_CROSS_LINK_DAMPING }),
    createDistanceConstraint(front, chassis.rearMount, diagonal, { compliance: XPBD_CROSS_LINK_COMPLIANCE, damping: XPBD_CROSS_LINK_DAMPING }),
    // Limits run after the compliant links so every solver iteration ends in a
    // valid travel range rather than allowing a later cross-link to violate it.
    createDistanceConstraint(rear, chassis.rearMount, SUSPENSION_REST_LENGTH, { compliance: 0, minLength: SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL, maxLength: SUSPENSION_REST_LENGTH + SUSPENSION_TRAVEL }),
    createDistanceConstraint(front, chassis.frontMount, SUSPENSION_REST_LENGTH, { compliance: 0, minLength: SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL, maxLength: SUSPENSION_REST_LENGTH + SUSPENSION_TRAVEL })
  ];
  return { rear, front, chassis, constraints, wheelbaseLimit };
}

function integratePoint(point, accelerationX = 0, accelerationY = GRAVITY) {
  let vx = (point.x - point.ox) * .9998;
  let vy = (point.y - point.oy) * .9998;
  const speed = Math.hypot(vx, vy);
  if (speed > MAX_POINT_SPEED * STEP) { vx *= MAX_POINT_SPEED * STEP / speed; vy *= MAX_POINT_SPEED * STEP / speed; }
  point.ox = point.x; point.oy = point.y;
  point.x += vx + accelerationX * STEP * STEP;
  point.y += vy + accelerationY * STEP * STEP;
  point.grounded = false;
  point.contact = null;
}

function centerOfMass(points) {
  let mass = 0, x = 0, y = 0;
  for (const point of points) {
    const pointMass = 1 / point.inverseMass;
    mass += pointMass; x += point.x * pointMass; y += point.y * pointMass;
  }
  return { x: x / mass, y: y / mass, mass };
}

function angularAccelerations(points, angularAcceleration) {
  const center = centerOfMass(points);
  return points.map(point => ({
    point,
    ax: -(point.y - center.y) * angularAcceleration,
    ay: (point.x - center.x) * angularAcceleration
  }));
}

function momentOfInertia(points) {
  const center = centerOfMass(points);
  return points.reduce((sum, point) => {
    const dx = point.x - center.x, dy = point.y - center.y;
    return sum + (dx * dx + dy * dy) / point.inverseMass;
  }, 0) || 1;
}

function resolveContact(point, contact, wheelName, hooks) {
  if (!contact || (contact.penetration <= 0 && !contact.swept)) return;
  const { nx, ny, penetration } = contact;
  const beforeX = point.x, beforeY = point.y;
  let vx = point.x - point.ox, vy = point.y - point.oy;
  const beforeVx = vx, beforeVy = vy;
  const intoSurface = vx * nx + vy * ny;
  if (intoSurface < 0) {
    const impactSpeed = -intoSurface / STEP;
    point.impactSpeed = Math.max(point.impactSpeed || 0, impactSpeed);
    const restitution = impactSpeed > CONTACT_RESTITUTION_SPEED
      ? clamp(.08 + impactSpeed / 1200, .08, .22) * XPBD_CONTACT_RESTITUTION_SCALE
      : 0;
    vx -= nx * intoSurface * (1 + restitution);
    vy -= ny * intoSurface * (1 + restitution);
    if (ny < CONTACT_GROUNDED_NORMAL && impactSpeed > 12) {
      point.compression = clamp((point.compression || 0) + (impactSpeed - 12) * .065, 0, 16);
      point.springVelocity = (point.springVelocity || 0) + impactSpeed * .018;
    }
  }
  point.x += nx * penetration;
  point.y += ny * penetration;
  point.ox = point.x - vx;
  point.oy = point.y - vy;
  point.contact = contact;
  point.material = contact.material;
  if (ny < CONTACT_GROUNDED_NORMAL) point.grounded = true;
  hooks.contact?.({ wheel: wheelName, contact, beforeX, beforeY, beforeVx, beforeVy, point, afterVx: vx, afterVy: vy });
}

function collideWheel(level, point, wheelName, hooks, sweep = true) {
  if (sweep) {
    const intendedVx = point.x - point.ox, intendedVy = point.y - point.oy;
    const hit = terrainSweepCollision(level, point.ox, point.oy, point.x, point.y, RADIUS);
    if (hit) {
      point.x = hit.x + hit.nx * .01;
      point.y = hit.y + hit.ny * .01;
      point.ox = point.x - intendedVx;
      point.oy = point.y - intendedVy;
      resolveContact(point, hit, wheelName, hooks);
      advanceAfterTimeOfImpact(point, hit.time);
    }
  }
  for (const contact of terrainCollisionsAt(level, point.x, point.y, RADIUS)) resolveContact(point, contact, wheelName, hooks);
  if (point.x < RADIUS) {
    const vx = Math.max(0, point.x - point.ox);
    point.x = RADIUS;
    point.ox = point.x - vx;
  }
}

export function stepVersion2Vehicle(vehicle, level, controls, hooks = {}) {
  const { rear, front, chassis, constraints, wheelbaseLimit } = vehicle;
  const { facing, throttle, brakePressure, leanControl, accelerating, braking, coasting } = controls;
  if (vehicle.lastFacing !== undefined && vehicle.lastFacing !== facing) {
    for (const point of [rear, front]) {
      const vx = (point.x - point.ox) / STEP;
      const vy = (point.y - point.oy) / STEP;
      if (point.contact) {
        const tx = -point.contact.ny, ty = point.contact.nx;
        point.angularVelocity = (vx * tx + vy * ty) / RADIUS;
      } else {
        point.angularVelocity = vx / RADIUS;
      }
    }
  }
  vehicle.lastFacing = facing;
  const grounded = rear.grounded || front.grounded;
  rear.impactSpeed = 0; front.impactSpeed = 0;
  const midpointX = (rear.x + front.x) / 2;
  const midpointY = Math.min(rear.y, front.y) - RADIUS;
  const slope = terrainAt(level, midpointX, midpointY).slope;
  const uphill = clamp(-slope * facing, 0, 1);
  const drivenWheel = facing > 0 ? rear : front;
  const wheelSurfaceSpeed = Math.abs(drivenWheel.angularVelocity * RADIUS);
  const speedRatio = clamp(wheelSurfaceSpeed / XPBD_MAX_DRIVE_SPEED, 0, 1);
  const torqueCurve = speedRatio >= 1 ? 0 : .28 + .72 * (1 - speedRatio);
  const forwardLean = clamp(leanControl * facing, 0, 1);
  const climbTorque = 1 + uphill * UPHILL_TORQUE_BOOST * (1 - speedRatio);
  const uphillLeanDriveBoost = 1 + uphill * forwardLean * XPBD_UPHILL_FORWARD_LEAN_MOTOR_BOOST;
  const uphillGripBlend = clamp(uphill * (1 + forwardLean * 2), 0, 1);
  const angularDrive = facing * XPBD_MOTOR_ANGULAR_ACCELERATION * throttle * torqueCurve * climbTorque * uphillLeanDriveBoost;
  const riderAssist = riderTorqueMultiplier(leanControl, facing, throttle, accelerating, XPBD_THROTTLE_LEAN_ASSIST);
  const riderTerrainScale = grounded
    ? riderTerrainTorqueScale(leanControl, facing, uphill, XPBD_UPHILL_FORWARD_LEAN_REDUCTION)
    : 1;
  const riderAngularAcceleration = leanControl * (grounded
    ? XPBD_RIDER_GROUND_ANGULAR_ACCELERATION
    : XPBD_RIDER_AIR_ANGULAR_ACCELERATION) * riderAssist * riderTerrainScale;
  const antiWheelieAngularAcceleration = grounded
    ? facing * uphill * throttle * XPBD_UPHILL_ANTI_WHEELIE_ACCELERATION * (1 - forwardLean * .35)
    : 0;
  const wheelMoment = WHEEL_INERTIA * RADIUS * RADIUS;
  const chassisPoints = Object.values(chassis);
  const chassisInertia = momentOfInertia(chassisPoints);
  const bikePoints = [rear, front, ...chassisPoints];
  const bikeInertia = momentOfInertia(bikePoints);
  const motorReactionTorque = -angularDrive * wheelMoment * XPBD_MOTOR_REACTION_SCALE;
  const rollingSpin = (point) => {
    const spin = point.angularVelocity || 0;
    if (!point.contact) return spin;
    const tx = -point.contact.ny;
    const ty = point.contact.nx;
    const groundSpin = ((point.x - point.ox) * tx + (point.y - point.oy) * ty) / STEP / RADIUS;
    return Math.abs(groundSpin) > Math.abs(spin) ? groundSpin : spin;
  };
  const diveWheel = facing > 0 ? front : rear;
  const brakingWheelAcceleration = braking && diveWheel.grounded
    ? -(rollingSpin(rear) + rollingSpin(front)) * XPBD_BRAKE_RATE * brakePressure
    : 0;
  const brakeReactionLimit = XPBD_BRAKE_REACTION_LIMIT * bikeInertia;
  const brakeReactionTorque = clamp(
    -brakingWheelAcceleration * wheelMoment * XPBD_BRAKE_REACTION_SCALE,
    -brakeReactionLimit,
    brakeReactionLimit
  );
  const reactionAlpha = (motorReactionTorque + brakeReactionTorque) / bikeInertia;
  const motorReactionAcceleration = motorReactionTorque / bikeInertia;
  const brakeReactionAcceleration = brakeReactionTorque / bikeInertia;
  const reactionAccelerations = new Map(
    angularAccelerations(bikePoints, reactionAlpha)
      .map(({ point, ax, ay }) => [point, { ax, ay }])
  );
  const riderAccelerations = angularAccelerations(
    bikePoints,
    riderAngularAcceleration + antiWheelieAngularAcceleration
  );
  const dynamics = {
    angularDrive,
    climbTorque,
    uphillLeanDriveBoost,
    uphillGripBlend,
    riderAssist,
    riderTerrainScale,
    riderAngularAcceleration,
    antiWheelieAngularAcceleration,
    motorReactionAcceleration,
    brakeReactionAcceleration,
    chassisReactionAngularAcceleration: motorReactionAcceleration + brakeReactionAcceleration,
    chassisInertia,
    wheelbase: distance(rear, front),
    wheelbaseVelocity: (((front.x - front.ox) - (rear.x - rear.ox)) * (front.x - rear.x)
      + ((front.y - front.oy) - (rear.y - rear.oy)) * (front.y - rear.y)) / (distance(rear, front) || 1) / STEP,
    chassisArea: signedTriangleArea(chassis.rearMount, chassis.frontMount, chassis.top),
    rearSuspensionLength: distance(rear, chassis.rearMount),
    frontSuspensionLength: distance(front, chassis.frontMount)
  };
  hooks.dynamics?.(dynamics);

  for (const { point, ax, ay } of riderAccelerations) {
    const reaction = reactionAccelerations.get(point);
    integratePoint(point, ax + (reaction?.ax || 0), GRAVITY + ay + (reaction?.ay || 0));
  }
  constraints.forEach(resetConstraintMultiplier);
  resetConstraintMultiplier(wheelbaseLimit);
  hooks.afterIntegration?.();

  const solverWheels = facing < 0 ? [[front, 'front'], [rear, 'rear']] : [[rear, 'rear'], [front, 'front']];
  const solverConstraints = constraints;
  for (const [point, name] of solverWheels) collideWheel(level, point, name, hooks);
  for (let iteration = 0; iteration < BIKE_SOLVER_ITERATIONS; iteration++) {
    hooks.iteration?.(iteration);
    for (const constraint of solverConstraints) {
      const correction = solveXpbdConstraint(constraint, STEP);
      hooks.constraint?.(correction);
    }
    for (const [point, name] of solverWheels) collideWheel(level, point, name, hooks, false);
    const wheelbaseCorrection = solveXpbdConstraint(wheelbaseLimit, STEP);
    hooks.constraint?.(wheelbaseCorrection);
    for (const [point, name] of solverWheels) collideWheel(level, point, name, hooks, false);
    hooks.contactsResolved?.();
  }

  const driveLoadScale = lerp(
    XPBD_ROLLING_LOAD_SCALE,
    lerp(XPBD_DRIVE_LOAD_SCALE, XPBD_UPHILL_CONTACT_LOAD_SCALE, uphillGripBlend),
    throttle
  );
  const applyWheelTraction = (point, name, { drive }) => {
    if (!point.contact) return;
    const impactSpeed = Math.max(0, -((point.x - point.ox) * point.contact.nx + (point.y - point.oy) * point.contact.ny) / STEP);
    const restitution = drive && impactSpeed > CONTACT_RESTITUTION_SPEED
      ? clamp(.08 + impactSpeed / 1200, .08, .22) * XPBD_CONTACT_RESTITUTION_SCALE
      : 0;
    const pointVx = (point.x - point.ox) / STEP, pointVy = (point.y - point.oy) / STEP;
    const tx = -point.contact.ny, ty = point.contact.nx;
    const contactSpeed = pointVx * tx + pointVy * ty;
    const coastResistance = lerp(
      XPBD_COAST_RESISTANCE_LOW_SPEED,
      XPBD_COAST_RESISTANCE_HIGH_SPEED,
      clamp(Math.abs(contactSpeed) / XPBD_COAST_SPEED_REFERENCE, 0, 1)
    ) * (contactSpeed * point.contact.slope < 0 ? .18 : 1);
    const result = solveWheelContactVelocity(point, point.contact, {
      dt: STEP,
      radius: RADIUS,
      restitution,
      friction: WHEEL_FRICTION,
      angularDrive: drive && point === drivenWheel ? angularDrive : 0,
      angularBrake: drive && braking ? XPBD_BRAKE_RATE * brakePressure : 0,
      inertia: WHEEL_INERTIA,
      restingNormalAcceleration: GRAVITY * (braking ? XPBD_CONTACT_LOAD_SCALE : point === drivenWheel ? driveLoadScale : XPBD_ROLLING_LOAD_SCALE),
      freeRolling: drive && !braking && (point !== drivenWheel || throttle < .01),
      rollingResistance: drive && coasting ? coastResistance : 0
    });
    point.angularVelocity = clamp(point.angularVelocity, -XPBD_MAX_DRIVE_SPEED / RADIUS, XPBD_MAX_DRIVE_SPEED / RADIUS);
    if (drive) hooks.traction?.(name, result, point);
  };
  for (const [point, name] of solverWheels) {
    if (!point.contact) {
      const rolling = ((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP * RADIUS);
      point.angularVelocity += (point === drivenWheel ? angularDrive : 0) * STEP;
      point.angularVelocity += (rolling - point.angularVelocity) * (1 - Math.exp(-8 * STEP));
      if (braking) point.angularVelocity *= Math.max(0, 1 - XPBD_BRAKE_RATE * brakePressure * STEP);
      point.angularVelocity = clamp(point.angularVelocity, -XPBD_MAX_DRIVE_SPEED / RADIUS, XPBD_MAX_DRIVE_SPEED / RADIUS);
      point.spin += point.angularVelocity * STEP;
      continue;
    }
    applyWheelTraction(point, name, { drive: true });
  }
  for (let iteration = 0; iteration < BIKE_VELOCITY_ITERATIONS; iteration++) {
    for (const constraint of [...solverConstraints, wheelbaseLimit]) {
      dampDistanceConstraint(constraint, dampingPerIteration(constraint.damping, BIKE_VELOCITY_ITERATIONS));
    }
  }
  // Constraint damping moves the wheels after the drive impulse. While on the
  // gas, match the tire to the ground again so the wheel does not spin out.
  if (throttle > .01 && !braking) {
    for (const [point, name] of solverWheels) applyWheelTraction(point, name, { drive: false });
  }
  hooks.iteration?.(-1);
  return dynamics;
}

export function version2VehicleMetrics(vehicle) {
  const points = [vehicle.rear, vehicle.front, ...Object.values(vehicle.chassis)];
  const center = centerOfMass(points);
  return {
    center,
    speedX: ((vehicle.rear.x - vehicle.rear.ox) + (vehicle.front.x - vehicle.front.ox)) / (2 * STEP),
    speedY: ((vehicle.rear.y - vehicle.rear.oy) + (vehicle.front.y - vehicle.front.oy)) / (2 * STEP),
    pitch: Math.atan2(vehicle.front.y - vehicle.rear.y, vehicle.front.x - vehicle.rear.x),
    wheelbase: distance(vehicle.rear, vehicle.front),
    rearSuspensionLength: distance(vehicle.rear, vehicle.chassis.rearMount),
    frontSuspensionLength: distance(vehicle.front, vehicle.chassis.frontMount),
    chassisArea: signedTriangleArea(vehicle.chassis.rearMount, vehicle.chassis.frontMount, vehicle.chassis.top)
  };
}

export function createVersion2Simulation({ vehicle, level, facing = 1, hooks = {} }) {
  let currentFacing = facing < 0 ? -1 : 1;
  let throttle = 0;
  let brakePressure = 0;
  let leanControl = 0;

  function step({ throttle: throttleInput = 0, brake = 0, lean = 0, flip = false } = {}) {
    if (flip) currentFacing *= -1;

    const throttleTarget = clamp(Number(throttleInput) || 0, 0, 1);
    const brakeTarget = clamp(Number(brake) || 0, 0, 1);
    const accelerating = throttleTarget > 0 && brakeTarget === 0;
    const braking = brakeTarget > 0;
    const coasting = !accelerating && !braking;
    throttle = lerp(
      throttle,
      accelerating ? throttleTarget : 0,
      1 - Math.exp(-((accelerating ? throttleTarget : 0) > throttle ? XPBD_THROTTLE_INPUT_RESPONSE : 4) * STEP)
    );
    brakePressure = lerp(
      brakePressure,
      brakeTarget,
      1 - Math.exp(-(braking ? 10 : 14) * STEP)
    );
    leanControl = lerp(
      leanControl,
      clamp(Number(lean) || 0, -1, 1),
      1 - Math.exp(-XPBD_LEAN_INPUT_RESPONSE * STEP)
    );

    const contactEvents = [];
    const traction = {};
    const dynamics = stepVersion2Vehicle(vehicle, level, {
      facing: currentFacing,
      throttle,
      brakePressure,
      leanControl,
      accelerating,
      braking,
      coasting
    }, {
      ...hooks,
      contact(value) {
        contactEvents.push(value);
        hooks.contact?.(value);
      },
      traction(wheelName, result, point) {
        traction[wheelName] = result;
        hooks.traction?.(wheelName, result, point);
      }
    });
    const metrics = version2VehicleMetrics(vehicle);

    return {
      facing: currentFacing,
      input: { throttle: throttleInput, brake, lean, flip },
      controls: { throttle, brakePressure, leanControl },
      wheels: { rear: vehicle.rear, front: vehicle.front },
      chassis: vehicle.chassis,
      suspension: {
        rearLength: metrics.rearSuspensionLength,
        frontLength: metrics.frontSuspensionLength,
        restLength: SUSPENSION_REST_LENGTH,
        travel: SUSPENSION_TRAVEL
      },
      contacts: {
        rear: vehicle.rear.contact,
        front: vehicle.front.contact,
        events: contactEvents
      },
      forces: { ...dynamics, traction },
      metrics
    };
  }

  return {
    vehicle,
    level,
    step,
    get facing() { return currentFacing; },
    get state() {
      const metrics = version2VehicleMetrics(vehicle);
      return {
        facing: currentFacing,
        controls: { throttle, brakePressure, leanControl },
        wheels: { rear: vehicle.rear, front: vehicle.front },
        chassis: vehicle.chassis,
        suspension: {
          rearLength: metrics.rearSuspensionLength,
          frontLength: metrics.frontSuspensionLength,
          restLength: SUSPENSION_REST_LENGTH,
          travel: SUSPENSION_TRAVEL
        },
        contacts: { rear: vehicle.rear.contact, front: vehicle.front.contact },
        metrics
      };
    }
  };
}
