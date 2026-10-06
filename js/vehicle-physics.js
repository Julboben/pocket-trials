import {
  STEP,
  RADIUS,
  WHEELBASE,
  GRAVITY,
  MAX_POINT_SPEED,
  BIKE_SOLVER_ITERATIONS,
  BIKE_VELOCITY_ITERATIONS,
  XPBD_CHASSIS_COMPLIANCE,
  XPBD_CHASSIS_AREA_COMPLIANCE,
  XPBD_SUSPENSION_COMPLIANCE,
  XPBD_SUSPENSION_DAMPING,
  XPBD_SUSPENSION_REBOUND_DAMPING,
  XPBD_LONGITUDINAL_COMPLIANCE,
  XPBD_LONGITUDINAL_DAMPING,
  XPBD_SUSPENSION_SLIDER_COMPLIANCE,
  XPBD_CROSS_LINK_DAMPING,
  SUSPENSION_REST_LENGTH,
  SUSPENSION_TRAVEL,
  XPBD_WHEELBASE_SLACK,
  SUSPENSION_BUMP_STOP_LENGTH,
  XPBD_SUSPENSION_BUMP_STOP_COMPLIANCE,
  WHEEL_INERTIA,
  WHEEL_FRICTION,
  XPBD_CHASSIS_MOUNT_INVERSE_MASS,
  XPBD_CHASSIS_TOP_INVERSE_MASS,
  XPBD_MOTOR_ANGULAR_ACCELERATION,
  XPBD_TORQUE_FALLOFF_SPEED,
  XPBD_MOTOR_REACTION_SCALE,
  XPBD_RIDER_GROUND_ANGULAR_ACCELERATION,
  XPBD_RIDER_AIR_ANGULAR_ACCELERATION,
  XPBD_RIDER_LEVERAGE_FADE_START,
  XPBD_RIDER_LEVERAGE_FADE_END,
  XPBD_RIDER_MAX_AIR_SPIN,
  XPBD_RIDER_AIR_SPIN_RESPONSE,
  XPBD_RIDER_MAX_GROUND_SPIN,
  XPBD_TOUCHDOWN_SPIN_THRESHOLD,
  XPBD_TOUCHDOWN_SPIN_ABSORPTION,
  XPBD_THROTTLE_LEAN_ASSIST,
  XPBD_THROTTLE_INPUT_RESPONSE,
  XPBD_LEAN_INPUT_RESPONSE,
  XPBD_UPHILL_FORWARD_LEAN_REDUCTION,
  XPBD_UPHILL_FORWARD_LEAN_FULL_TILT,
  XPBD_BRAKE_REACTION_SCALE,
  XPBD_BRAKE_REACTION_LIMIT,
  XPBD_BRAKE_RATE,
  XPBD_BRAKE_TORQUE,
  XPBD_CONTACT_LOAD_SCALE,
  XPBD_DRIVE_LOAD_SCALE,
  XPBD_UPHILL_CONTACT_LOAD_SCALE,
  XPBD_ROLLING_LOAD_SCALE,
  XPBD_COAST_RESISTANCE_LOW_SPEED,
  XPBD_COAST_RESISTANCE_HIGH_SPEED,
  XPBD_COAST_SPEED_REFERENCE,
  XPBD_CONTACT_RESTITUTION_SCALE,
  CONTACT_GROUNDED_NORMAL,
  CONTACT_RESTITUTION_SPEED,
  clamp,
  lerp,
} from "./config.js";
import {
  createDistanceConstraint,
  createAreaConstraint,
  createSliderConstraint,
  createAxisLimitConstraint,
  signedTriangleArea,
  resetConstraintMultiplier,
  solveXpbdConstraint,
  dampingPerIteration,
  dampDistanceConstraint,
  riderTorqueMultiplier,
  riderTerrainTorqueScale,
  riderTiltTorqueScale,
  riderSpinTorqueScale,
  advanceAfterTimeOfImpact,
  solveWheelContactVelocity,
} from "./physics.js";
import {
  terrainAt,
  terrainCollisionsAt,
  terrainSweepCollision,
} from "./terrain.js";
import { passThroughGlass, shatterGlass } from "./glass.js";
import { atan2, exp, hypot } from "./det-math.js";

const distance = (a, b) => hypot(a.x - b.x, a.y - b.y);
const CRASHED_CHASSIS_CONTACT = { bounce: 0.1, friction: 0.35 };
const CHASSIS_TOP_HEIGHT = 22;
// chassis.top is a mass point floating well above the drawn seat and bars, so
// a crashed bike collides through probes on the drawn outline instead. Each is
// [offset along the mounts, height above the mount line]; the mount line sits
// SUSPENSION_REST_LENGTH above the axles, and the seat and bars ~27 above.
const CRASHED_FRAME_PROBES = [
  [-20, 6],
  [0, 7],
  [20, 6],
];
const CRASHED_FRAME_PROBE_RADIUS = 3;

export function createVehicle(rear, front) {
  const mountY = (rear.y + front.y) / 2 - SUSPENSION_REST_LENGTH;
  const makePoint = (x, y, inverseMass) => ({
    x,
    y,
    ox: x,
    oy: y,
    inverseMass,
    grounded: false,
    contact: null,
    radius: 4,
  });
  const chassis = {
    rearMount: makePoint(rear.x, mountY, XPBD_CHASSIS_MOUNT_INVERSE_MASS),
    frontMount: makePoint(front.x, mountY, XPBD_CHASSIS_MOUNT_INVERSE_MASS),
    top: makePoint(
      (rear.x + front.x) / 2,
      mountY - CHASSIS_TOP_HEIGHT,
      XPBD_CHASSIS_TOP_INVERSE_MASS,
    ),
  };
  const wheelbaseLimit = createDistanceConstraint(rear, front, WHEELBASE, {
    compliance: 0,
    damping: XPBD_CROSS_LINK_DAMPING,
    minLength: WHEELBASE - XPBD_WHEELBASE_SLACK,
    maxLength: WHEELBASE + XPBD_WHEELBASE_SLACK,
  });
  const constraints = [
    createDistanceConstraint(chassis.rearMount, chassis.frontMount, WHEELBASE, {
      compliance: XPBD_CHASSIS_COMPLIANCE,
      damping: 1,
    }),
    createDistanceConstraint(
      chassis.rearMount,
      chassis.top,
      hypot(WHEELBASE / 2, 22),
      { compliance: XPBD_CHASSIS_COMPLIANCE, damping: 1 },
    ),
    createDistanceConstraint(
      chassis.frontMount,
      chassis.top,
      hypot(WHEELBASE / 2, 22),
      { compliance: XPBD_CHASSIS_COMPLIANCE, damping: 1 },
    ),
    createAreaConstraint(chassis.rearMount, chassis.frontMount, chassis.top, {
      compliance: XPBD_CHASSIS_AREA_COMPLIANCE,
    }),
    createDistanceConstraint(rear, front, WHEELBASE, {
      compliance: XPBD_LONGITUDINAL_COMPLIANCE,
      damping: XPBD_LONGITUDINAL_DAMPING,
    }),
    createDistanceConstraint(rear, chassis.rearMount, SUSPENSION_REST_LENGTH, {
      compliance: XPBD_SUSPENSION_COMPLIANCE,
      damping: XPBD_SUSPENSION_DAMPING,
      reboundDamping: XPBD_SUSPENSION_REBOUND_DAMPING,
    }),
    createDistanceConstraint(
      front,
      chassis.frontMount,
      SUSPENSION_REST_LENGTH,
      {
        compliance: XPBD_SUSPENSION_COMPLIANCE,
        damping: XPBD_SUSPENSION_DAMPING,
        reboundDamping: XPBD_SUSPENSION_REBOUND_DAMPING,
      },
    ),
    createDistanceConstraint(
      rear,
      chassis.rearMount,
      SUSPENSION_BUMP_STOP_LENGTH,
      {
        compliance: XPBD_SUSPENSION_BUMP_STOP_COMPLIANCE,
        minLength: SUSPENSION_BUMP_STOP_LENGTH,
      },
    ),
    createDistanceConstraint(
      front,
      chassis.frontMount,
      SUSPENSION_BUMP_STOP_LENGTH,
      {
        compliance: XPBD_SUSPENSION_BUMP_STOP_COMPLIANCE,
        minLength: SUSPENSION_BUMP_STOP_LENGTH,
      },
    ),
    createSliderConstraint(
      rear,
      chassis.rearMount,
      chassis.rearMount,
      chassis.frontMount,
      { compliance: XPBD_SUSPENSION_SLIDER_COMPLIANCE },
    ),
    createSliderConstraint(
      front,
      chassis.frontMount,
      chassis.rearMount,
      chassis.frontMount,
      { compliance: XPBD_SUSPENSION_SLIDER_COMPLIANCE },
    ),
    // Limits run after the compliant links so every solver iteration ends in a
    // valid travel range rather than allowing a later slider to violate it.
    createDistanceConstraint(rear, chassis.rearMount, SUSPENSION_REST_LENGTH, {
      compliance: 0,
      minLength: SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL,
      maxLength: SUSPENSION_REST_LENGTH + SUSPENSION_TRAVEL,
    }),
    createDistanceConstraint(
      front,
      chassis.frontMount,
      SUSPENSION_REST_LENGTH,
      {
        compliance: 0,
        minLength: SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL,
        maxLength: SUSPENSION_REST_LENGTH + SUSPENSION_TRAVEL,
      },
    ),
    createAxisLimitConstraint(
      rear,
      chassis.rearMount,
      chassis.rearMount,
      chassis.frontMount,
      chassis.top,
      SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL,
    ),
    createAxisLimitConstraint(
      front,
      chassis.frontMount,
      chassis.rearMount,
      chassis.frontMount,
      chassis.top,
      SUSPENSION_REST_LENGTH - SUSPENSION_TRAVEL,
    ),
  ];
  const chassisPoints = [chassis.rearMount, chassis.frontMount, chassis.top];
  // The physical pieces between the points: suspension legs and frame edges.
  const frameLinks = [
    [rear, chassis.rearMount],
    [front, chassis.frontMount],
    [chassis.rearMount, chassis.frontMount],
    [chassis.rearMount, chassis.top],
    [chassis.frontMount, chassis.top],
  ];
  const crashedFrameProbes = CRASHED_FRAME_PROBES.map(([along, height]) =>
    createFrameProbe(chassisPoints, along, height),
  );
  const bikePoints = [rear, front, ...chassisPoints];
  return {
    rear,
    front,
    chassis,
    constraints,
    wheelbaseLimit,
    chassisPoints,
    crashedFrameProbes,
    frameLinks,
    bikePoints,
    dampedConstraints: [...constraints, wheelbaseLimit],
    wheelOrder: {
      forward: [
        [rear, "rear"],
        [front, "front"],
      ],
      backward: [
        [front, "front"],
        [rear, "rear"],
      ],
    },
    riderAccelerations: new Float64Array(bikePoints.length * 2),
    reactionAccelerations: new Float64Array(bikePoints.length * 2),
    traction: { options: {} },
  };
}

function integratePoint(point, accelerationX = 0, accelerationY = GRAVITY) {
  let vx = (point.x - point.ox) * 0.9998;
  let vy = (point.y - point.oy) * 0.9998;
  const speed = hypot(vx, vy);
  if (speed > MAX_POINT_SPEED * STEP) {
    vx *= (MAX_POINT_SPEED * STEP) / speed;
    vy *= (MAX_POINT_SPEED * STEP) / speed;
  }
  point.ox = point.x;
  point.oy = point.y;
  point.x += vx + accelerationX * STEP * STEP;
  point.y += vy + accelerationY * STEP * STEP;
  point.grounded = false;
  point.contact = null;
}

function centerOfMass(points) {
  let mass = 0,
    x = 0,
    y = 0;
  for (const point of points) {
    const pointMass = 1 / point.inverseMass;
    mass += pointMass;
    x += point.x * pointMass;
    y += point.y * pointMass;
  }
  return { x: x / mass, y: y / mass, mass };
}

// Writes interleaved [ax, ay] pairs, one per point, into `out`.
function angularAccelerations(points, angularAcceleration, out) {
  const center = centerOfMass(points);
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    out[index * 2] = -(point.y - center.y) * angularAcceleration;
    out[index * 2 + 1] = (point.x - center.x) * angularAcceleration;
  }
  return out;
}

// Rider lean is a weight shift, so it can tip the bike around a wheel that is
// on the ground but cannot pull that wheel off it. With one wheel down, the
// part of the spin that would lift that wheel off its contact is removed from
// every point; motion along the ground is left alone. Rear and front are the
// first two entries of `accelerations`.
function keepPivotPlanted(accelerations, rear, front) {
  if (rear.grounded === front.grounded) return;
  const pivot = rear.grounded ? rear : front;
  if (!pivot.contact) return;
  const { nx, ny } = pivot.contact;
  const pivotIndex = pivot === rear ? 0 : 2;
  const lift =
    accelerations[pivotIndex] * nx + accelerations[pivotIndex + 1] * ny;
  if (lift <= 0) return;
  for (let index = 0; index < accelerations.length; index += 2) {
    accelerations[index] -= lift * nx;
    accelerations[index + 1] -= lift * ny;
  }
}

function rollingSpin(point) {
  const spin = point.angularVelocity || 0;
  if (!point.contact) return spin;
  const tx = -point.contact.ny;
  const ty = point.contact.nx;
  const groundSpin =
    ((point.x - point.ox) * tx + (point.y - point.oy) * ty) / STEP / RADIUS;
  return Math.abs(groundSpin) > Math.abs(spin) ? groundSpin : spin;
}

// `state` is the per-vehicle scratch filled once per step by stepVehicle.
function applyWheelTraction(point, name, drive, state, hooks) {
  if (!point.contact) return;
  const {
    drivenWheel,
    angularDrive,
    braking,
    brakePressure,
    coasting,
    throttle,
    driveLoadScale,
    options,
  } = state;
  const impactSpeed = Math.max(
    0,
    -(
      (point.x - point.ox) * point.contact.nx +
      (point.y - point.oy) * point.contact.ny
    ) / STEP,
  );
  const restitution =
    drive && impactSpeed > CONTACT_RESTITUTION_SPEED
      ? clamp(0.08 + impactSpeed / 1200, 0.08, 0.22) *
        XPBD_CONTACT_RESTITUTION_SCALE
      : 0;
  const pointVx = (point.x - point.ox) / STEP,
    pointVy = (point.y - point.oy) / STEP;
  const tx = -point.contact.ny,
    ty = point.contact.nx;
  const contactSpeed = pointVx * tx + pointVy * ty;
  const coastResistance =
    lerp(
      XPBD_COAST_RESISTANCE_LOW_SPEED,
      XPBD_COAST_RESISTANCE_HIGH_SPEED,
      clamp(Math.abs(contactSpeed) / XPBD_COAST_SPEED_REFERENCE, 0, 1),
    ) * (contactSpeed * point.contact.slope < 0 ? 0.18 : 1);
  options.dt = STEP;
  options.radius = RADIUS;
  options.restitution = restitution;
  options.friction = WHEEL_FRICTION;
  options.angularDrive = drive && point === drivenWheel ? angularDrive : 0;
  options.angularBrake =
    drive && braking ? XPBD_BRAKE_TORQUE * brakePressure : 0;
  options.inertia = WHEEL_INERTIA;
  options.restingNormalAcceleration =
    GRAVITY *
    (braking
      ? XPBD_CONTACT_LOAD_SCALE
      : point === drivenWheel
        ? driveLoadScale
        : XPBD_ROLLING_LOAD_SCALE);
  options.freeRolling =
    drive && !braking && (point !== drivenWheel || throttle < 0.01);
  options.rollingResistance = drive && coasting ? coastResistance : 0;
  const result = solveWheelContactVelocity(point, point.contact, options);
  point.brakeHold = result.held ? result.frictionLimit * STEP : 0;
  point.angularVelocity = clamp(
    point.angularVelocity,
    -MAX_POINT_SPEED / RADIUS,
    MAX_POINT_SPEED / RADIUS,
  );
  if (drive) hooks.traction?.(name, result, point);
}

function momentOfInertia(points) {
  const center = centerOfMass(points);
  return (
    points.reduce((sum, point) => {
      const dx = point.x - center.x,
        dy = point.y - center.y;
      return sum + (dx * dx + dy * dy) / point.inverseMass;
    }, 0) || 1
  );
}

function angularMomentum(points) {
  const center = centerOfMass(points);
  let momentum = 0;
  for (const point of points) {
    const vx = (point.x - point.ox) / STEP,
      vy = (point.y - point.oy) / STEP;
    momentum +=
      ((point.x - center.x) * vy - (point.y - center.y) * vx) /
      point.inverseMass;
  }
  return momentum;
}

// Rigid-body spin in rad/s, positive in the same sense as angularAccelerations.
function angularVelocity(points, inertia) {
  return angularMomentum(points) / inertia;
}

// Adds a pure rotation about the centre of mass; forward speed is kept.
function addSpin(points, spin) {
  const center = centerOfMass(points);
  const turn = spin * STEP;
  for (const point of points) {
    point.ox -= -(point.y - center.y) * turn;
    point.oy -= (point.x - center.x) * turn;
  }
}

// Only wheels touch the terrain, so a fast-spinning bike that lands on one
// wheel pivots around it and is thrown back up. The rider soaks up spin beyond
// the threshold instead; this is a pure rotation, so forward speed is kept.
function absorbTouchdownSpin(points, inertia) {
  const spin = angularVelocity(points, inertia);
  const excess =
    Math.sign(spin) *
    Math.max(0, Math.abs(spin) - XPBD_TOUCHDOWN_SPIN_THRESHOLD);
  if (!excess) return;
  addSpin(points, -excess * XPBD_TOUCHDOWN_SPIN_ABSORPTION);
}

function chassisUp(chassis) {
  const baseX = (chassis.rearMount.x + chassis.frontMount.x) / 2;
  const baseY = (chassis.rearMount.y + chassis.frontMount.y) / 2;
  const length = hypot(chassis.top.x - baseX, chassis.top.y - baseY) || 1;
  return {
    x: (chassis.top.x - baseX) / length,
    y: (chassis.top.y - baseY) / length,
  };
}

// Signed chassis tilt from the ground normal, positive when the nose is raised.
function noseUpTilt({ rear, front, chassis }, facing) {
  const contact = rear.contact || front.contact;
  if (!contact) return 0;
  const up = chassisUp(chassis);
  return (
    atan2(
      up.x * contact.ny - up.y * contact.nx,
      up.x * contact.nx + up.y * contact.ny,
    ) * facing
  );
}

function riderGroundLeverage({ rear, front, chassis }) {
  const contact = rear.contact || front.contact;
  if (!contact) return 1;
  const up = chassisUp(chassis);
  return riderTiltTorqueScale(
    up.x,
    up.y,
    contact.nx,
    contact.ny,
    XPBD_RIDER_LEVERAGE_FADE_START,
    XPBD_RIDER_LEVERAGE_FADE_END,
  );
}

// Leaning forward shifts the rider's weight along the bike, and only the
// trail part of that shift tips it. With the nose raised by angle a the part
// is cos(a), so on a near-vertical face gravity loops the bike over however
// far the rider leans.
function forwardLeanWeightShift({ chassis }, facing, leanControl) {
  if (leanControl * facing <= 0) return 1;
  const up = chassisUp(chassis);
  if (up.x * facing >= 0) return 1;
  return clamp(-up.y, 0, 1);
}

// A braked wheel that gripped last step is held where it stood, within one
// step of tire friction. Pushing a wheel out of a slope moves it a little
// downhill each step, which velocity friction alone cannot undo.
function holdBrakedWheel(point) {
  if (!point.brakeHold || !point.contact) return;
  const tx = -point.contact.ny,
    ty = point.contact.nx;
  const drift = (point.x - point.holdX) * tx + (point.y - point.holdY) * ty;
  if (Math.abs(drift) > point.brakeHold) {
    point.brakeHold = 0;
    return;
  }
  point.x -= tx * drift;
  point.y -= ty * drift;
}

function resolveContact(point, contact, wheelName, hooks) {
  if (!contact || (contact.penetration <= 0 && !contact.swept)) return;
  const { nx, ny, penetration } = contact;
  const beforeX = point.x,
    beforeY = point.y;
  let vx = point.x - point.ox,
    vy = point.y - point.oy;
  const beforeVx = vx,
    beforeVy = vy;
  const intoSurface = vx * nx + vy * ny;
  if (intoSurface < 0) {
    const impactSpeed = -intoSurface / STEP;
    point.impactSpeed = Math.max(point.impactSpeed || 0, impactSpeed);
    const restitution =
      impactSpeed > CONTACT_RESTITUTION_SPEED
        ? clamp(0.08 + impactSpeed / 1200, 0.08, 0.22) *
          XPBD_CONTACT_RESTITUTION_SCALE
        : 0;
    vx -= nx * intoSurface * (1 + restitution);
    vy -= ny * intoSurface * (1 + restitution);
  }
  point.x += nx * penetration;
  point.y += ny * penetration;
  point.ox = point.x - vx;
  point.oy = point.y - vy;
  point.contact = contact;
  point.material = contact.material;
  if (ny < CONTACT_GROUNDED_NORMAL) point.grounded = true;
  hooks.contact?.({
    wheel: wheelName,
    contact,
    beforeX,
    beforeY,
    beforeVx,
    beforeVy,
    point,
    afterVx: vx,
    afterVy: vy,
  });
}

// Sweeps a point from where it was, again after each pane of glass it breaks
// on the way, so it still stops at whatever is behind the glass.
function sweepPoint(trail, point, radius) {
  const fromX = point.ox,
    fromY = point.oy;
  let hit = terrainSweepCollision(trail, fromX, fromY, point.x, point.y, radius);
  while (hit && passThroughGlass(trail, point, hit))
    hit = terrainSweepCollision(trail, fromX, fromY, point.x, point.y, radius);
  return hit;
}

function collideWheel(trail, point, wheelName, hooks, sweep = true) {
  if (sweep) {
    const hit = sweepPoint(trail, point, RADIUS);
    const intendedVx = point.x - point.ox,
      intendedVy = point.y - point.oy;
    if (hit) {
      point.x = hit.x + hit.nx * 0.01;
      point.y = hit.y + hit.ny * 0.01;
      point.ox = point.x - intendedVx;
      point.oy = point.y - intendedVy;
      resolveContact(point, hit, wheelName, hooks);
      advanceAfterTimeOfImpact(point, hit.time);
    }
  }
  for (const contact of terrainCollisionsAt(trail, point.x, point.y, RADIUS))
    if (!passThroughGlass(trail, point, contact))
      resolveContact(point, contact, wheelName, hooks);
}

// Collision for loose points (ragdoll joints, a crashed chassis): bounce off
// the surface and lose some tangential speed, with no rolling or traction.
// `grip` adds Coulomb friction: each contact removes sliding speed in proportion
// to how hard the point presses on the surface, so a body can rest on a slope.
// The press counted is capped near a resting body's weight (about two steps of
// gravity), so a hard landing doesn't brake a slide dead and bodies still glide.
const GRIP_PRESS_LIMIT = 0.05;

function resolveFreeContact(point, contact, bounce, friction, grip = 0) {
  if (!contact || (contact.penetration <= 0 && !contact.swept)) return;
  const { nx, ny, penetration } = contact;
  let vx = point.x - point.ox,
    vy = point.y - point.oy;
  const normal = vx * nx + vy * ny;
  if (normal < 0) {
    vx -= nx * normal * (1 + bounce);
    vy -= ny * normal * (1 + bounce);
  }
  const tangentX = -ny,
    tangentY = nx,
    tangent = vx * tangentX + vy * tangentY;
  const press = Math.min(
    Math.max(0, -normal) + Math.max(0, penetration),
    GRIP_PRESS_LIMIT,
  );
  const slip =
    Math.sign(tangent) *
    Math.min(Math.abs(tangent), Math.max(Math.abs(tangent) * friction, grip * press));
  vx -= tangentX * slip;
  vy -= tangentY * slip;
  point.x += nx * penetration;
  point.y += ny * penetration;
  point.ox = point.x - vx;
  point.oy = point.y - vy;
  point.grounded = true;
}

export function collideFreePoint(
  trail,
  point,
  sweep,
  { bounce = 0.12, friction = 0.16, grip = 0 } = {},
) {
  if (sweep) {
    const swept = sweepPoint(trail, point, point.radius);
    const intendedVx = point.x - point.ox,
      intendedVy = point.y - point.oy;
    if (swept) {
      point.x = swept.x + swept.nx * 0.01;
      point.y = swept.y + swept.ny * 0.01;
      point.ox = point.x - intendedVx;
      point.oy = point.y - intendedVy;
      resolveFreeContact(point, swept, bounce, friction, grip);
      // Continue through the rest of the substep with the resolved velocity;
      // stopping at the time of impact would glue sliding points in place.
      advanceAfterTimeOfImpact(point, swept.time);
    }
  }
  for (const contact of terrainCollisionsAt(
    trail,
    point.x,
    point.y,
    point.radius,
  ))
    if (!passThroughGlass(trail, point, contact))
      resolveFreeContact(point, contact, bounce, friction, grip);
}

// A probe is an affine blend of the chassis points; contact corrections are
// spread over them by inverse mass, like an XPBD positional constraint.
function frameWeights(along, height) {
  const topWeight = height / CHASSIS_TOP_HEIGHT;
  const mountWeight = (1 - topWeight) / 2;
  return [
    mountWeight - along / WHEELBASE,
    mountWeight + along / WHEELBASE,
    topWeight,
  ];
}

function createFrameProbe(points, along, height) {
  const weights = frameWeights(along, height);
  const denominator = points.reduce(
    (sum, point, index) => sum + weights[index] ** 2 * point.inverseMass,
    0,
  );
  return {
    points,
    weights,
    shares: points.map(
      (point, index) => (weights[index] * point.inverseMass) / denominator,
    ),
  };
}

function blendProbe({ points, weights }, xKey, yKey) {
  let x = 0,
    y = 0;
  for (let index = 0; index < points.length; index++) {
    x += points[index][xKey] * weights[index];
    y += points[index][yKey] * weights[index];
  }
  return { x, y };
}

function resolveFrameProbeContact(probe, contact, bounce, friction) {
  const { x, y } = blendProbe(probe, "x", "y");
  const old = blendProbe(probe, "ox", "oy");
  const { nx, ny } = contact;
  const penetration = contact.swept
    ? (contact.x - x) * nx + (contact.y - y) * ny + 0.01
    : contact.penetration;
  if (penetration <= 0) return;
  const vx = x - old.x,
    vy = y - old.y;
  let dvx = 0,
    dvy = 0;
  const normal = vx * nx + vy * ny;
  if (normal < 0) {
    dvx -= nx * normal * (1 + bounce);
    dvy -= ny * normal * (1 + bounce);
  }
  const tangentX = -ny,
    tangentY = nx,
    tangent = (vx + dvx) * tangentX + (vy + dvy) * tangentY;
  dvx -= tangentX * tangent * friction;
  dvy -= tangentY * tangent * friction;
  const dx = nx * penetration,
    dy = ny * penetration;
  for (let index = 0; index < probe.points.length; index++) {
    const point = probe.points[index],
      share = probe.shares[index];
    if (!share) continue;
    point.x += dx * share;
    point.y += dy * share;
    point.ox += (dx - dvx) * share;
    point.oy += (dy - dvy) * share;
    point.grounded = true;
  }
}

function probeBreaksGlass(trail, probe, contact) {
  const from = blendProbe(probe, "ox", "oy");
  const to = blendProbe(probe, "x", "y");
  return shatterGlass(trail, contact, to.x - from.x, to.y - from.y);
}

function collideFrameProbe(trail, probe, sweep, { bounce, friction }) {
  if (sweep) {
    const from = blendProbe(probe, "ox", "oy");
    const to = blendProbe(probe, "x", "y");
    const sweepProbe = () =>
      terrainSweepCollision(
        trail,
        from.x,
        from.y,
        to.x,
        to.y,
        CRASHED_FRAME_PROBE_RADIUS,
      );
    let swept = sweepProbe();
    while (swept && probeBreaksGlass(trail, probe, swept)) swept = sweepProbe();
    if (swept) resolveFrameProbeContact(probe, swept, bounce, friction);
  }
  const { x, y } = blendProbe(probe, "x", "y");
  for (const contact of terrainCollisionsAt(
    trail,
    x,
    y,
    CRASHED_FRAME_PROBE_RADIUS,
  ))
    if (!probeBreaksGlass(trail, probe, contact))
      resolveFrameProbeContact(probe, contact, bounce, friction);
}

function collideCrashedChassis(vehicle, trail, sweep) {
  if (vehicle.framePassThrough) return;
  const { rearMount, frontMount } = vehicle.chassis;
  for (const point of [rearMount, frontMount])
    collideFreePoint(trail, point, sweep, CRASHED_CHASSIS_CONTACT);
  for (const probe of vehicle.crashedFrameProbes)
    collideFrameProbe(trail, probe, sweep, CRASHED_CHASSIS_CONTACT);
}

// The crashed bike as the thrown rider feels it: both wheels, plus capsules
// along the seat, the frame between the mounts, and the engine. Capsule ends
// are [offset along the mounts, height above the mount line], like the probes.
const BIKE_BODY_CAPSULES = [
  { from: frameWeights(-22, 6), to: frameWeights(22, 6), radius: 3 },
  { from: frameWeights(-25, 0), to: frameWeights(25, 0), radius: 4 },
  { from: frameWeights(-5, -12), to: frameWeights(3, -12), radius: 6 },
];

function nearestOnCapsule(chassisPoints, capsule, x, y) {
  let ax = 0,
    ay = 0,
    bx = 0,
    by = 0;
  for (let index = 0; index < 3; index++) {
    const point = chassisPoints[index];
    ax += point.x * capsule.from[index];
    ay += point.y * capsule.from[index];
    bx += point.x * capsule.to[index];
    by += point.y * capsule.to[index];
  }
  const dx = bx - ax,
    dy = by - ay,
    lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq),
  );
  return {
    x: ax + dx * t,
    y: ay + dy * t,
    weights: capsule.from.map(
      (weight, index) => weight + (capsule.to[index] - weight) * t,
    ),
  };
}

/**
 * Pushes a loose point (a ragdoll joint) out of the crashed bike and the bike
 * back from it, shared by inverse mass. With `apply` false it only reports
 * whether the point overlaps the bike.
 *
 * The overlap is undone without changing either body's speed, and only their
 * closing speed is then cancelled, as a dead hit. A joint caught between the
 * bike and the ground is pushed both ways every iteration, so turning those
 * pushes into speed would fire the rider or the bike into the air.
 * @returns {boolean} whether the point overlapped the bike
 */
export function collideWithBike(vehicle, point, inverseMass, apply = true) {
  const { rear, front, chassisPoints } = vehicle;
  let touched = false;
  const move = (target, x, y) => {
    target.x += x;
    target.y += y;
    target.ox += x;
    target.oy += y;
  };
  const push = (cx, cy, reach, bikePoints, weights) => {
    const dx = point.x - cx,
      dy = point.y - cy,
      distanceSq = dx * dx + dy * dy;
    if (distanceSq >= reach * reach) return;
    touched = true;
    if (!apply) return;
    const length = hypot(dx, dy);
    const nx = length > 1e-6 ? dx / length : 0,
      ny = length > 1e-6 ? dy / length : -1;
    let denominator = inverseMass;
    for (let index = 0; index < bikePoints.length; index++)
      denominator += weights[index] ** 2 * bikePoints[index].inverseMass;
    const lambda = (reach - length) / denominator;
    move(point, nx * lambda * inverseMass, ny * lambda * inverseMass);
    let closing = (point.x - point.ox) * nx + (point.y - point.oy) * ny;
    for (let index = 0; index < bikePoints.length; index++) {
      const bikePoint = bikePoints[index],
        share = lambda * weights[index] * bikePoint.inverseMass;
      move(bikePoint, -nx * share, -ny * share);
      closing -=
        weights[index] *
        ((bikePoint.x - bikePoint.ox) * nx + (bikePoint.y - bikePoint.oy) * ny);
    }
    if (closing >= 0) return;
    const impulse = -closing / denominator;
    point.ox -= nx * impulse * inverseMass;
    point.oy -= ny * impulse * inverseMass;
    for (let index = 0; index < bikePoints.length; index++) {
      const share = impulse * weights[index] * bikePoints[index].inverseMass;
      bikePoints[index].ox += nx * share;
      bikePoints[index].oy += ny * share;
    }
  };
  for (const wheel of [rear, front])
    push(wheel.x, wheel.y, RADIUS + point.radius, [wheel], [1]);
  if (!vehicle.framePassThrough)
    for (const capsule of BIKE_BODY_CAPSULES) {
      const nearest = nearestOnCapsule(chassisPoints, capsule, point.x, point.y);
      push(
        nearest.x,
        nearest.y,
        capsule.radius + point.radius,
        chassisPoints,
        nearest.weights,
      );
    }
  return touched;
}

// A link passes through terrain when a ray along it enters a surface from both
// ends; one end merely resting inside a surface does not count.
function linkCrossesTerrain(trail, a, b) {
  return (
    terrainSweepCollision(trail, a.x, a.y, b.x, b.y, 0) !== null &&
    terrainSweepCollision(trail, b.x, b.y, a.x, a.y, 0) !== null
  );
}

const overlapsTerrain = (trail, x, y, radius) =>
  terrainCollisionsAt(trail, x, y, radius).some(
    (contact) => contact.penetration > 0,
  );

function frameOverlapsTerrain(vehicle, trail) {
  const { rearMount, frontMount } = vehicle.chassis;
  return (
    [rearMount, frontMount].some((point) =>
      overlapsTerrain(trail, point.x, point.y, point.radius),
    ) ||
    vehicle.crashedFrameProbes.some((probe) => {
      const { x, y } = blendProbe(probe, "x", "y");
      return overlapsTerrain(trail, x, y, CRASHED_FRAME_PROBE_RADIUS);
    })
  );
}

// While riding only the wheels touch terrain, so the bike can hang with a
// wheel over a thin ledge and the frame under it. Once crashed the frame
// collides too and would hook the ledge, so while any link passes through
// terrain the frame keeps passing through it, as it does while riding, and the
// wheels keep rolling on the edge. The frame collides again once the bike is
// clear of the ledge and the frame is out of the ground.
function updateCrashedPassThrough(vehicle, trail) {
  const straddling = vehicle.frameLinks.some(([a, b]) =>
    linkCrossesTerrain(trail, a, b),
  );
  if (straddling) vehicle.framePassThrough = true;
  else if (vehicle.framePassThrough)
    vehicle.framePassThrough = frameOverlapsTerrain(vehicle, trail);
}

// `controls.crashed` hands the bike to physics alone: the chassis collides with
// the terrain so a riderless bike tips over and tumbles instead of sinking.
export function stepVehicle(vehicle, trail, controls, hooks = {}) {
  const { rear, front, chassis, constraints, wheelbaseLimit } = vehicle;
  const {
    facing,
    throttle,
    brakePressure,
    leanControl,
    accelerating,
    braking,
    coasting,
    crashed = false,
  } = controls;
  if (vehicle.lastFacing !== undefined && vehicle.lastFacing !== facing) {
    for (const point of [rear, front]) {
      const vx = (point.x - point.ox) / STEP;
      const vy = (point.y - point.oy) / STEP;
      if (point.contact) {
        const tx = -point.contact.ny,
          ty = point.contact.nx;
        point.angularVelocity = (vx * tx + vy * ty) / RADIUS;
      } else {
        point.angularVelocity = vx / RADIUS;
      }
    }
  }
  vehicle.lastFacing = facing;
  const grounded = rear.grounded || front.grounded;
  rear.impactSpeed = 0;
  front.impactSpeed = 0;
  const midpointX = (rear.x + front.x) / 2;
  const midpointY = Math.min(rear.y, front.y) - RADIUS;
  const slope = terrainAt(trail, midpointX, midpointY).slope;
  const uphill = clamp(-slope * facing, 0, 1);
  const drivenWheel = facing > 0 ? rear : front;
  const wheelSurfaceSpeed = Math.abs(drivenWheel.angularVelocity * RADIUS);
  const speedRatio = wheelSurfaceSpeed / XPBD_TORQUE_FALLOFF_SPEED;
  const torqueCurve =
    speedRatio >= 1 ? 0.28 / speedRatio : 0.28 + 0.72 * (1 - speedRatio);
  const forwardLean = clamp(leanControl * facing, 0, 1);
  const uphillGripBlend = clamp(uphill * (1 + forwardLean * 2), 0, 1);
  const angularDrive =
    facing * XPBD_MOTOR_ANGULAR_ACCELERATION * throttle * torqueCurve;
  const riderAssist = riderTorqueMultiplier(
    leanControl,
    facing,
    throttle,
    accelerating,
    XPBD_THROTTLE_LEAN_ASSIST,
  );
  const frontLift = grounded
    ? clamp(
        noseUpTilt(vehicle, facing) / XPBD_UPHILL_FORWARD_LEAN_FULL_TILT,
        0,
        1,
      )
    : 0;
  const riderTerrainScale = grounded
    ? riderTerrainTorqueScale(
        leanControl,
        facing,
        uphill,
        XPBD_UPHILL_FORWARD_LEAN_REDUCTION,
        frontLift,
      )
    : 1;
  const wheelMoment = WHEEL_INERTIA * RADIUS * RADIUS;
  const { chassisPoints, bikePoints } = vehicle;
  const chassisInertia = momentOfInertia(chassisPoints);
  const bikeInertia = momentOfInertia(bikePoints);
  const bikeSpin = angularVelocity(bikePoints, bikeInertia);
  const groundLean =
    leanControl *
    XPBD_RIDER_GROUND_ANGULAR_ACCELERATION *
    riderAssist *
    riderTerrainScale *
    riderGroundLeverage(vehicle) *
    forwardLeanWeightShift(vehicle, facing, leanControl);
  const airLeanLimit =
    Math.abs(leanControl) * XPBD_RIDER_AIR_ANGULAR_ACCELERATION * riderAssist;
  const airLean = clamp(
    (leanControl * XPBD_RIDER_MAX_AIR_SPIN - bikeSpin) *
      XPBD_RIDER_AIR_SPIN_RESPONSE,
    -airLeanLimit,
    airLeanLimit,
  );
  const riderAngularAcceleration = grounded
    ? groundLean *
      riderSpinTorqueScale(groundLean, bikeSpin, XPBD_RIDER_MAX_GROUND_SPIN)
    : airLean;
  const motorReactionTorque =
    -angularDrive * wheelMoment * XPBD_MOTOR_REACTION_SCALE;
  const diveWheel = facing > 0 ? front : rear;
  const brakingWheelAcceleration =
    braking && diveWheel.grounded
      ? -(rollingSpin(rear) + rollingSpin(front)) *
        XPBD_BRAKE_RATE *
        brakePressure
      : 0;
  const brakeReactionLimit = XPBD_BRAKE_REACTION_LIMIT * bikeInertia;
  const brakeReactionTorque = clamp(
    -brakingWheelAcceleration * wheelMoment * XPBD_BRAKE_REACTION_SCALE,
    -brakeReactionLimit,
    brakeReactionLimit,
  );
  const reactionAlpha =
    (motorReactionTorque + brakeReactionTorque) / bikeInertia;
  const motorReactionAcceleration = motorReactionTorque / bikeInertia;
  const brakeReactionAcceleration = brakeReactionTorque / bikeInertia;
  const reactionAccelerations = angularAccelerations(
    bikePoints,
    reactionAlpha,
    vehicle.reactionAccelerations,
  );
  const riderAccelerations = angularAccelerations(
    bikePoints,
    riderAngularAcceleration,
    vehicle.riderAccelerations,
  );
  keepPivotPlanted(riderAccelerations, rear, front);
  const dynamics = {
    angularDrive,
    uphillGripBlend,
    riderAssist,
    riderTerrainScale,
    riderAngularAcceleration,
    motorReactionAcceleration,
    brakeReactionAcceleration,
    chassisReactionAngularAcceleration:
      motorReactionAcceleration + brakeReactionAcceleration,
    chassisInertia,
    wheelbase: distance(rear, front),
    wheelbaseVelocity:
      ((front.x - front.ox - (rear.x - rear.ox)) * (front.x - rear.x) +
        (front.y - front.oy - (rear.y - rear.oy)) * (front.y - rear.y)) /
      (distance(rear, front) || 1) /
      STEP,
    chassisArea: signedTriangleArea(
      chassis.rearMount,
      chassis.frontMount,
      chassis.top,
    ),
    rearSuspensionLength: distance(rear, chassis.rearMount),
    frontSuspensionLength: distance(front, chassis.frontMount),
  };
  hooks.dynamics?.(dynamics);

  const wasRearGrounded = rear.grounded,
    wasFrontGrounded = front.grounded;
  for (const wheel of [rear, front]) {
    if (!braking || crashed) wheel.brakeHold = 0;
    if (wheel.brakeHold) {
      wheel.holdX = wheel.x;
      wheel.holdY = wheel.y;
    }
  }
  for (let index = 0; index < bikePoints.length; index++) {
    integratePoint(
      bikePoints[index],
      riderAccelerations[index * 2] + (reactionAccelerations[index * 2] || 0),
      GRAVITY +
        riderAccelerations[index * 2 + 1] +
        (reactionAccelerations[index * 2 + 1] || 0),
    );
  }
  for (const constraint of vehicle.dampedConstraints)
    resetConstraintMultiplier(constraint);
  hooks.afterIntegration?.();
  const momentumBeforeSolve = crashed ? 0 : angularMomentum(bikePoints);

  const solverWheels =
    facing < 0 ? vehicle.wheelOrder.backward : vehicle.wheelOrder.forward;
  if (crashed) updateCrashedPassThrough(vehicle, trail);
  for (const [point, name] of solverWheels) {
    collideWheel(trail, point, name, hooks);
    holdBrakedWheel(point);
  }
  if (crashed) collideCrashedChassis(vehicle, trail, true);
  for (let iteration = 0; iteration < BIKE_SOLVER_ITERATIONS; iteration++) {
    hooks.iteration?.(iteration);
    for (const constraint of constraints) {
      const correction = solveXpbdConstraint(constraint, STEP);
      hooks.constraint?.(correction);
    }
    for (const [point, name] of solverWheels) {
      collideWheel(trail, point, name, hooks, false);
      holdBrakedWheel(point);
    }
    const wheelbaseCorrection = solveXpbdConstraint(wheelbaseLimit, STEP);
    hooks.constraint?.(wheelbaseCorrection);
    for (const [point, name] of solverWheels) {
      collideWheel(trail, point, name, hooks, false);
      holdBrakedWheel(point);
    }
    if (crashed) collideCrashedChassis(vehicle, trail, false);
    hooks.contactsResolved?.();
  }
  // In the air nothing outside the bike can speed up its spin. The wheel
  // sliders are not momentum-conserving on their own; while the bike tumbles
  // fast they would keep feeding the spin.
  if (!crashed && !rear.contact && !front.contact) {
    const drift = angularMomentum(bikePoints) - momentumBeforeSolve;
    if (drift * momentumBeforeSolve > 0)
      addSpin(bikePoints, -drift / momentOfInertia(bikePoints));
  }
  if (
    (!wasRearGrounded && rear.grounded) ||
    (!wasFrontGrounded && front.grounded)
  )
    absorbTouchdownSpin(bikePoints, bikeInertia);

  const traction = vehicle.traction;
  traction.drivenWheel = drivenWheel;
  traction.angularDrive = angularDrive;
  traction.braking = braking;
  traction.brakePressure = brakePressure;
  traction.coasting = coasting;
  traction.throttle = throttle;
  traction.driveLoadScale = lerp(
    XPBD_ROLLING_LOAD_SCALE,
    lerp(
      XPBD_DRIVE_LOAD_SCALE,
      XPBD_UPHILL_CONTACT_LOAD_SCALE,
      uphillGripBlend,
    ),
    throttle,
  );
  for (const [point, name] of solverWheels) {
    if (!point.contact) {
      point.brakeHold = 0;
      const rolling =
        (rear.x - rear.ox + (front.x - front.ox)) / (2 * STEP * RADIUS);
      point.angularVelocity +=
        (point === drivenWheel ? angularDrive : 0) * STEP;
      point.angularVelocity +=
        (rolling - point.angularVelocity) * (1 - exp(-8 * STEP));
      if (braking) {
        const brakeLimit = XPBD_BRAKE_TORQUE * brakePressure * STEP;
        point.angularVelocity -= clamp(
          point.angularVelocity,
          -brakeLimit,
          brakeLimit,
        );
      }
      point.angularVelocity = clamp(
        point.angularVelocity,
        -MAX_POINT_SPEED / RADIUS,
        MAX_POINT_SPEED / RADIUS,
      );
      point.spin += point.angularVelocity * STEP;
      continue;
    }
    applyWheelTraction(point, name, true, traction, hooks);
  }
  for (let iteration = 0; iteration < BIKE_VELOCITY_ITERATIONS; iteration++) {
    for (const constraint of vehicle.dampedConstraints) {
      dampDistanceConstraint(
        constraint,
        dampingPerIteration(constraint.damping, BIKE_VELOCITY_ITERATIONS),
        dampingPerIteration(
          constraint.reboundDamping ?? constraint.damping,
          BIKE_VELOCITY_ITERATIONS,
        ),
      );
    }
  }
  // Constraint damping moves the wheels after the drive impulse. While on the
  // gas, match the tire to the ground again so the wheel does not spin out.
  if (throttle > 0.01 && !braking) {
    for (const [point, name] of solverWheels)
      applyWheelTraction(point, name, false, traction, hooks);
  }
  rear.compression = clamp(
    SUSPENSION_REST_LENGTH - distance(rear, chassis.rearMount),
    0,
    SUSPENSION_TRAVEL,
  );
  front.compression = clamp(
    SUSPENSION_REST_LENGTH - distance(front, chassis.frontMount),
    0,
    SUSPENSION_TRAVEL,
  );
  hooks.iteration?.(-1);
  return dynamics;
}

export function vehicleMetrics(vehicle) {
  const center = centerOfMass(vehicle.bikePoints);
  return {
    center,
    speedX:
      (vehicle.rear.x -
        vehicle.rear.ox +
        (vehicle.front.x - vehicle.front.ox)) /
      (2 * STEP),
    speedY:
      (vehicle.rear.y -
        vehicle.rear.oy +
        (vehicle.front.y - vehicle.front.oy)) /
      (2 * STEP),
    pitch: atan2(
      vehicle.front.y - vehicle.rear.y,
      vehicle.front.x - vehicle.rear.x,
    ),
    wheelbase: distance(vehicle.rear, vehicle.front),
    rearSuspensionLength: distance(vehicle.rear, vehicle.chassis.rearMount),
    frontSuspensionLength: distance(vehicle.front, vehicle.chassis.frontMount),
    chassisArea: signedTriangleArea(
      vehicle.chassis.rearMount,
      vehicle.chassis.frontMount,
      vehicle.chassis.top,
    ),
  };
}

export function createSimulation({ vehicle, trail, facing = 1, hooks = {} }) {
  let currentFacing = facing < 0 ? -1 : 1;
  let throttle = 0;
  let brakePressure = 0;
  let leanControl = 0;

  function step({
    throttle: throttleInput = 0,
    brake = 0,
    lean = 0,
    flip = false,
  } = {}) {
    if (flip) currentFacing *= -1;

    const throttleTarget = clamp(Number(throttleInput) || 0, 0, 1);
    const brakeTarget = clamp(Number(brake) || 0, 0, 1);
    const accelerating = throttleTarget > 0 && brakeTarget === 0;
    const braking = brakeTarget > 0;
    const coasting = !accelerating && !braking;
    throttle = lerp(
      throttle,
      accelerating ? throttleTarget : 0,
      1 -
        exp(
          -((accelerating ? throttleTarget : 0) > throttle
            ? XPBD_THROTTLE_INPUT_RESPONSE
            : 4) * STEP,
        ),
    );
    brakePressure = lerp(
      brakePressure,
      brakeTarget,
      1 - exp(-(braking ? 10 : 14) * STEP),
    );
    leanControl = lerp(
      leanControl,
      clamp(Number(lean) || 0, -1, 1),
      1 - exp(-XPBD_LEAN_INPUT_RESPONSE * STEP),
    );

    const contactEvents = [];
    const traction = {};
    const dynamics = stepVehicle(
      vehicle,
      trail,
      {
        facing: currentFacing,
        throttle,
        brakePressure,
        leanControl,
        accelerating,
        braking,
        coasting,
      },
      {
        ...hooks,
        contact(value) {
          contactEvents.push(value);
          hooks.contact?.(value);
        },
        traction(wheelName, result, point) {
          traction[wheelName] = result;
          hooks.traction?.(wheelName, result, point);
        },
      },
    );
    const metrics = vehicleMetrics(vehicle);

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
        travel: SUSPENSION_TRAVEL,
      },
      contacts: {
        rear: vehicle.rear.contact,
        front: vehicle.front.contact,
        events: contactEvents,
      },
      forces: { ...dynamics, traction },
      metrics,
    };
  }

  return {
    vehicle,
    trail,
    step,
    get facing() {
      return currentFacing;
    },
    get state() {
      const metrics = vehicleMetrics(vehicle);
      return {
        facing: currentFacing,
        controls: { throttle, brakePressure, leanControl },
        wheels: { rear: vehicle.rear, front: vehicle.front },
        chassis: vehicle.chassis,
        suspension: {
          rearLength: metrics.rearSuspensionLength,
          frontLength: metrics.frontSuspensionLength,
          restLength: SUSPENSION_REST_LENGTH,
          travel: SUSPENSION_TRAVEL,
        },
        contacts: { rear: vehicle.rear.contact, front: vehicle.front.contact },
        metrics,
      };
    },
  };
}
