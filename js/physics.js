import { acos, hypot, pow } from './det-math.js';
const EPSILON = 1e-8;

function inverseMass(point) {
  return point.inverseMass ?? 1;
}

function velocity(point) {
  return { x: point.x - point.ox, y: point.y - point.oy };
}

function setVelocity(point, vx, vy) {
  point.ox = point.x - vx;
  point.oy = point.y - vy;
}

export function constrainDistanceVelocity(a, b, damping = 1) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = hypot(dx, dy) || .001;
  const nx = dx / distance;
  const ny = dy / distance;
  const av = velocity(a), bv = velocity(b);
  const relativeNormalVelocity = (bv.x - av.x) * nx + (bv.y - av.y) * ny;
  const wa = inverseMass(a), wb = inverseMass(b), totalWeight = wa + wb;
  if (totalWeight <= EPSILON) return;
  const impulse = relativeNormalVelocity * damping / totalWeight;
  setVelocity(a, av.x + nx * impulse * wa, av.y + ny * impulse * wa);
  setVelocity(b, bv.x - nx * impulse * wb, bv.y - ny * impulse * wb);
}

// extensionCompliance, when given, replaces compliance while the link is
// stretched past its length, for a spring that is softer pulled than pushed.
export function createDistanceConstraint(a, b, length, { compliance = 0, extensionCompliance = compliance, damping = 0, reboundDamping = damping, minLength = null, maxLength = null } = {}) {
  return { type: 'distance', a, b, length, compliance, extensionCompliance, damping, reboundDamping, minLength, maxLength, lambda: 0 };
}

export function signedTriangleArea(a, b, c) {
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * .5;
}

export function createAreaConstraint(a, b, c, { compliance = 0, minArea = null, maxArea = null } = {}) {
  return { type: 'area', a, b, c, area: signedTriangleArea(a, b, c), compliance, minArea, maxArea, damping: 0, lambda: 0 };
}

// Keeps a wheel in line with its mount along the chassis axis, like a fork
// tube: the wheel can only travel in and out along its spring, so the spring
// alone carries the load instead of a rigid truss. The wheel's offset from
// the mount along `along` times the axis plus `across` times its normal is
// held at `target`; the default keeps it square below the mount.
export function createSliderConstraint(point, mount, axisStart, axisEnd, { compliance = 0, along = 1, across = 0, target = 0 } = {}) {
  return { type: 'slider', a: point, b: mount, axisStart, axisEnd, compliance, along, across, target, damping: 0, lambda: 0 };
}

// A suspension leg: the wheel's offset from its mount along a direction fixed
// to the chassis axis (`along` times the axis plus `across` times its normal,
// set by the caller), held at `rest` by a spring that is `compliance` soft
// when compressed and `extensionCompliance` soft when stretched. `lower` and
// `upper`, when given, make it a limit instead: it only acts outside
// rest + lower .. rest + upper. Measuring along the leg rather than straight
// from the mount keeps a raked fork's spring and stops true to its travel.
export function createLegConstraint(point, mount, axisStart, axisEnd, { compliance = 0, extensionCompliance = compliance, lower = null, upper = null, damping = 0, reboundDamping = damping } = {}) {
  return { type: 'leg', a: point, b: mount, axisStart, axisEnd, along: 0, across: 1, rest: 0, compliance, extensionCompliance, lower, upper, damping, reboundDamping, lambda: 0 };
}

// Keeps a wheel at least `minOffset` below its mount, measured across the
// chassis axis on the side away from `top`. A distance limit alone is a circle
// round the mount: on a hard hit the wheel can slip round it and come out
// above the frame, and the springs then throw the bike over.
export function createAxisLimitConstraint(point, mount, axisStart, axisEnd, top, minOffset) {
  return { type: 'axisLimit', a: point, b: mount, axisStart, axisEnd, top, minOffset, damping: 0, lambda: 0 };
}

// Pushes `a` and `b` apart along a direction fixed to the chassis axis. The
// two forces sit a leg's length apart, so on their own they would twist the
// bike with nothing to answer them: the gradient on the axis ends turns that
// twist back into the frame, like a fork tube bolted to it. The direction is
// `along` times the axis plus `across` times its normal (-uy, ux).
function solveAxisOffset(constraint, along, across, target, alpha) {
  const { a, b, axisStart: s, axisEnd: e } = constraint;
  const axisX = e.x - s.x, axisY = e.y - s.y;
  const axisLength = hypot(axisX, axisY) || EPSILON;
  const ux = axisX / axisLength, uy = axisY / axisLength;
  const dx = a.x - b.x, dy = a.y - b.y;
  const vx = ux * along + -uy * across, vy = uy * along + ux * across;
  const offset = dx * vx + dy * vy;
  // How the offset changes as the axis end moves: only turning the axis
  // matters, so it is across the axis, scaled by the lever d·v⊥ over length.
  const lever = -dx * vy + dy * vx;
  const ex = -uy * lever / axisLength, ey = ux * lever / axisLength;
  const points = [a, b, s, e];
  const gradients = [vx, vy, -vx, -vy, -ex, -ey, ex, ey];
  // A mount is usually also an axis end; merge so it is moved once.
  for (let i = 1; i < 4; i++) for (let j = 0; j < i; j++) {
    if (points[i] !== points[j]) continue;
    gradients[j * 2] += gradients[i * 2]; gradients[j * 2 + 1] += gradients[i * 2 + 1];
    gradients[i * 2] = 0; gradients[i * 2 + 1] = 0;
    break;
  }
  let weight = 0;
  for (let i = 0; i < 4; i++) weight += inverseMass(points[i]) * (gradients[i * 2] ** 2 + gradients[i * 2 + 1] ** 2);
  if (weight + alpha <= EPSILON) return { offset, deltaLambda: 0, ax: 0, ay: 0 };
  const deltaLambda = (target - offset - alpha * constraint.lambda) / (weight + alpha);
  constraint.lambda += deltaLambda;
  for (let i = 0; i < 4; i++) {
    const w = inverseMass(points[i]) * deltaLambda;
    points[i].x += gradients[i * 2] * w;
    points[i].y += gradients[i * 2 + 1] * w;
  }
  return { offset, deltaLambda, ax: gradients[0] * inverseMass(a) * deltaLambda, ay: gradients[1] * inverseMass(a) * deltaLambda };
}

export function solveXpbdAxisLimitConstraint(constraint) {
  const { a, b, axisStart, axisEnd, top, minOffset } = constraint;
  const axisX = axisEnd.x - axisStart.x, axisY = axisEnd.y - axisStart.y;
  const side = (top.x - (axisStart.x + axisEnd.x) / 2) * -axisY + (top.y - (axisStart.y + axisEnd.y) / 2) * axisX > 0 ? -1 : 1;
  const axisLength = hypot(axisX, axisY) || EPSILON;
  const offset = ((a.x - b.x) * -axisY + (a.y - b.y) * axisX) * side / axisLength;
  if (offset >= minOffset) return { distance: offset, correctionDistance: 0, correctionX: 0, correctionY: 0, lambda: constraint.lambda };
  const result = solveAxisOffset(constraint, 0, side, minOffset, 0);
  return { distance: offset, correctionDistance: result.deltaLambda, correctionX: result.ax, correctionY: result.ay, lambda: constraint.lambda };
}

// The leg's offset from its mount along its direction.
export function legOffset({ a, b, axisStart: s, axisEnd: e, along, across }) {
  const axisX = e.x - s.x, axisY = e.y - s.y;
  const axisLength = hypot(axisX, axisY) || EPSILON;
  const ux = axisX / axisLength, uy = axisY / axisLength;
  return (a.x - b.x) * (ux * along + -uy * across) + (a.y - b.y) * (uy * along + ux * across);
}

export function solveXpbdLegConstraint(constraint, dt) {
  const { rest, lower, upper } = constraint;
  const offset = legOffset(constraint);
  let target = rest;
  if (lower !== null && offset < rest + lower) target = rest + lower;
  else if (upper !== null && offset > rest + upper) target = rest + upper;
  else if (lower !== null || upper !== null) return { distance: offset, correctionDistance: 0, correctionX: 0, correctionY: 0, lambda: constraint.lambda };
  const compliance = offset > target ? constraint.extensionCompliance : constraint.compliance;
  const alpha = Math.max(0, compliance) / (dt * dt);
  const result = solveAxisOffset(constraint, constraint.along, constraint.across, target, alpha);
  return { distance: offset, correctionDistance: Math.abs(result.deltaLambda), correctionX: result.ax, correctionY: result.ay, lambda: constraint.lambda };
}

export function solveXpbdSliderConstraint(constraint, dt) {
  const alpha = Math.max(0, constraint.compliance) / (dt * dt);
  const result = solveAxisOffset(constraint, constraint.along, constraint.across, constraint.target, alpha);
  return { distance: result.offset, correctionDistance: Math.abs(result.deltaLambda), correctionX: result.ax, correctionY: result.ay, lambda: constraint.lambda };
}

export function resetConstraintMultiplier(constraint) {
  constraint.lambda = 0;
}

export function solveXpbdDistanceConstraint(constraint, dt) {
  const { a, b } = constraint;
  const dx = b.x - a.x, dy = b.y - a.y;
  const distance = hypot(dx, dy) || EPSILON;
  let target = constraint.length;
  if (constraint.minLength !== null && distance < constraint.minLength) target = constraint.minLength;
  else if (constraint.maxLength !== null && distance > constraint.maxLength) target = constraint.maxLength;
  else if (constraint.minLength !== null || constraint.maxLength !== null) return { distance, correctionDistance: 0, correctionX: 0, correctionY: 0, lambda: constraint.lambda };

  const c = distance - target;
  const wa = inverseMass(a), wb = inverseMass(b), weight = wa + wb;
  const compliance = c > 0 ? constraint.extensionCompliance ?? constraint.compliance : constraint.compliance;
  const alpha = Math.max(0, compliance) / (dt * dt);
  if (weight + alpha <= EPSILON) return { distance, correctionDistance: 0, correctionX: 0, correctionY: 0, lambda: constraint.lambda };
  const deltaLambda = (-c - alpha * constraint.lambda) / (weight + alpha);
  constraint.lambda += deltaLambda;
  const nx = dx / distance, ny = dy / distance;
  const ax = -nx * deltaLambda * wa, ay = -ny * deltaLambda * wa;
  const bx = nx * deltaLambda * wb, by = ny * deltaLambda * wb;

  // XPBD corrects predicted positions, so the correction must participate in
  // the reconstructed velocity; moving the old positions too preserves
  // constraint-violating velocities and causes the chassis to oscillate while
  // appearing position-correct.
  a.x += ax; a.y += ay;
  b.x += bx; b.y += by;
  return {
    distance,
    correctionDistance: Math.abs(deltaLambda),
    correctionX: ax,
    correctionY: ay,
    lambda: constraint.lambda
  };
}

export function dampingPerIteration(totalDamping, iterations) {
  const clamped = Math.max(0, Math.min(1, totalDamping));
  return iterations > 1 ? 1 - pow(1 - clamped, 1 / iterations) : clamped;
}

export function solveXpbdAreaConstraint(constraint, dt) {
  const { a, b, c } = constraint;
  const gradients = [
    { point: a, x: (b.y - c.y) * .5, y: (c.x - b.x) * .5 },
    { point: b, x: (c.y - a.y) * .5, y: (a.x - c.x) * .5 },
    { point: c, x: (a.y - b.y) * .5, y: (b.x - a.x) * .5 }
  ];
  const alpha = Math.max(0, constraint.compliance) / (dt * dt);
  const weight = gradients.reduce((sum, gradient) => {
    const w = inverseMass(gradient.point);
    return sum + w * (gradient.x * gradient.x + gradient.y * gradient.y);
  }, 0);
  if (weight + alpha <= EPSILON) return { distance: 0, correctionDistance: 0, correctionX: 0, correctionY: 0, lambda: constraint.lambda };
  const currentArea = signedTriangleArea(a, b, c);
  let targetArea = constraint.area;
  if (constraint.minArea !== null && currentArea < constraint.minArea) targetArea = constraint.minArea;
  else if (constraint.maxArea !== null && currentArea > constraint.maxArea) targetArea = constraint.maxArea;
  else if (constraint.minArea !== null || constraint.maxArea !== null) return { distance: Math.abs(currentArea), correctionDistance: 0, correctionX: 0, correctionY: 0, lambda: constraint.lambda };
  const value = currentArea - targetArea;
  const deltaLambda = (-value - alpha * constraint.lambda) / (weight + alpha);
  constraint.lambda += deltaLambda;
  for (const gradient of gradients) {
    const w = inverseMass(gradient.point);
    gradient.point.x += gradient.x * deltaLambda * w;
    gradient.point.y += gradient.y * deltaLambda * w;
  }
  return { distance: Math.abs(signedTriangleArea(a, b, c)), correctionDistance: Math.abs(deltaLambda), correctionX: 0, correctionY: 0, lambda: constraint.lambda };
}

export function solveXpbdConstraint(constraint, dt) {
  if (constraint.type === 'area') return solveXpbdAreaConstraint(constraint, dt);
  if (constraint.type === 'slider') return solveXpbdSliderConstraint(constraint, dt);
  if (constraint.type === 'leg') return solveXpbdLegConstraint(constraint, dt);
  if (constraint.type === 'axisLimit') return solveXpbdAxisLimitConstraint(constraint);
  return solveXpbdDistanceConstraint(constraint, dt);
}

// reboundDamping applies while the link is lengthening, like a shock absorber
// that is firmer on rebound than on compression.
export function dampDistanceConstraint(constraint, damping = constraint.damping, reboundDamping = damping) {
  if (constraint.type !== 'distance') return;
  let amount = damping;
  if (reboundDamping !== damping) {
    const { a, b } = constraint;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthening = ((b.x - b.ox) - (a.x - a.ox)) * dx + ((b.y - b.oy) - (a.y - a.oy)) * dy > 0;
    if (lengthening) amount = reboundDamping;
  }
  if (amount <= 0) return;
  constrainDistanceVelocity(constraint.a, constraint.b, Math.max(0, Math.min(1, amount)));
}

// The leg's damper: removes `damping` of the wheel's speed along the leg
// relative to its mount, or `reboundDamping` while the leg lengthens.
export function dampLegConstraint(constraint, damping = constraint.damping, reboundDamping = damping) {
  const { a, b, axisStart: s, axisEnd: e, along, across } = constraint;
  const axisX = e.x - s.x, axisY = e.y - s.y;
  const axisLength = hypot(axisX, axisY) || EPSILON;
  const ux = axisX / axisLength, uy = axisY / axisLength;
  const nx = ux * along + -uy * across, ny = uy * along + ux * across;
  const av = velocity(a), bv = velocity(b);
  const relative = (av.x - bv.x) * nx + (av.y - bv.y) * ny;
  const amount = Math.max(0, Math.min(1, relative > 0 ? reboundDamping : damping));
  const wa = inverseMass(a), wb = inverseMass(b), totalWeight = wa + wb;
  if (amount <= 0 || totalWeight <= EPSILON) return;
  const impulse = relative * amount / totalWeight;
  setVelocity(a, av.x - nx * impulse * wa, av.y - ny * impulse * wa);
  setVelocity(b, bv.x + nx * impulse * wb, bv.y + ny * impulse * wb);
}

function earliestRoot(a, b, c) {
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) < EPSILON) return null;
    const root = -c / b;
    return root >= 0 && root <= 1 ? root : null;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a), second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  return second >= 0 && second <= 1 ? second : null;
}

/** Earliest collision of a moving circle with a finite, two-sided segment. */
export function sweepCircleSegment(fromX, fromY, toX, toY, radius, ax, ay, bx, by) {
  const vx = toX - fromX, vy = toY - fromY;
  const sx = bx - ax, sy = by - ay;
  const length = hypot(sx, sy);
  if (length < EPSILON) {
    const rx = fromX - ax, ry = fromY - ay;
    const time = earliestRoot(vx * vx + vy * vy, 2 * (rx * vx + ry * vy), rx * rx + ry * ry - radius * radius);
    if (time === null) return null;
    const hx = fromX + vx * time, hy = fromY + vy * time;
    const normalLength = hypot(hx - ax, hy - ay) || 1;
    return { time, x: hx, y: hy, pointX: ax, pointY: ay, nx: (hx - ax) / normalLength, ny: (hy - ay) / normalLength };
  }

  const tx = sx / length, ty = sy / length;
  const normalX = -ty, normalY = tx;
  const relativeX = fromX - ax, relativeY = fromY - ay;
  const normalStart = relativeX * normalX + relativeY * normalY;
  const normalVelocity = vx * normalX + vy * normalY;
  let best = null;
  if (Math.abs(normalVelocity) > EPSILON) {
    for (const side of [-1, 1]) {
      const time = (side * radius - normalStart) / normalVelocity;
      if (time < 0 || time > 1) continue;
      const hx = fromX + vx * time, hy = fromY + vy * time;
      const along = (hx - ax) * tx + (hy - ay) * ty;
      if (along < 0 || along > length) continue;
      const candidate = { time, x: hx, y: hy, pointX: ax + tx * along, pointY: ay + ty * along, nx: normalX * side, ny: normalY * side };
      if (!best || candidate.time < best.time) best = candidate;
    }
  }

  for (const [px, py] of [[ax, ay], [bx, by]]) {
    const rx = fromX - px, ry = fromY - py;
    const time = earliestRoot(vx * vx + vy * vy, 2 * (rx * vx + ry * vy), rx * rx + ry * ry - radius * radius);
    if (time === null || (best && time >= best.time)) continue;
    const hx = fromX + vx * time, hy = fromY + vy * time;
    const normalLength = hypot(hx - px, hy - py) || 1;
    best = { time, x: hx, y: hy, pointX: px, pointY: py, nx: (hx - px) / normalLength, ny: (hy - py) / normalLength };
  }
  return best;
}

export function riderTorqueMultiplier(leanInput, facing, throttle, accelerating, assist = 1) {
  const backwardLean = Math.max(0, Math.min(1, -leanInput * facing));
  const activeThrottle = accelerating ? Math.max(0, Math.min(1, throttle)) : 0;
  return 1 + backwardLean * activeThrottle * assist;
}

// Uphill, the rider's weight sits far behind the front contact, so leaning
// forward cannot lever the rear wheel off the slope. frontLift (0..1) is how
// far the front wheel is raised; forward lean keeps full strength while it is
// pulling a lifted front wheel back down.
export function riderTerrainTorqueScale(leanInput, facing, uphill, reduction = 1.4, frontLift = 0) {
  const forwardLean = Math.max(0, Math.min(1, leanInput * facing));
  const uphillAmount = Math.max(0, Math.min(1, uphill));
  const rearLift = 1 - Math.max(0, Math.min(1, frontLift));
  return 1 - forwardLean * rearLift * Math.min(.9, uphillAmount * reduction);
}

// A rider balancing on one wheel has no leverage once the bike stands past
// upright, so ground lean fades out with the tilt of the chassis away from the
// ground normal instead of spinning the bike around its contact wheel.
export function riderTiltTorqueScale(upX, upY, normalX, normalY, fadeStart, fadeEnd) {
  const tilt = acos(Math.max(-1, Math.min(1, upX * normalX + upY * normalY)));
  if (tilt <= fadeStart) return 1;
  if (tilt >= fadeEnd) return 0;
  return 1 - (tilt - fadeStart) / (fadeEnd - fadeStart);
}

// Full lean torque up to 75% of maxSpin, fading to none at maxSpin. Torque
// against the current spin is never reduced.
export function riderSpinTorqueScale(angularAcceleration, angularVelocity, maxSpin) {
  if (angularAcceleration * angularVelocity <= 0 || !(maxSpin > 0)) return 1;
  return Math.max(0, Math.min(1, (maxSpin - Math.abs(angularVelocity)) / (maxSpin * .25)));
}

export function advanceAfterTimeOfImpact(point, time) {
  const remaining = Math.max(0, Math.min(1, 1 - time));
  const vx = point.x - point.ox, vy = point.y - point.oy;
  point.x += vx * remaining;
  point.y += vy * remaining;
  point.ox = point.x - vx;
  point.oy = point.y - vy;
}

/**
 * Applies a contact impulse to linear Verlet velocity and wheel angular velocity.
 * Tire grip is Coulomb friction on the real ground force: `normalLoad` is the
 * normal impulse (px/s) the contact already took this step. A tire that grips
 * holds up to `friction` times the load; once it slips it pushes with
 * `kineticFriction` times the load until the wheel matches the ground again.
 */
export function solveWheelContactVelocity(point, contact, {
  dt,
  radius,
  restitution = 0,
  friction = 0.9,
  kineticFriction = friction,
  angularDrive = 0,
  angularBrake = 0,
  angularDrag = .1,
  inertia = .5,
  normalLoad = 0,
  // Most the motor may spin the tire ahead of the ground (px/s of tread).
  maxDriveSlip = Infinity,
  freeRolling = false,
  rollingResistance = 0,
  // Tangent impulse this contact already gave this step; a later pass only
  // gets what is left of the friction limit.
  appliedImpulse = 0
}) {
  let vx = (point.x - point.ox) / dt;
  let vy = (point.y - point.oy) / dt;
  let omega = Number(point.angularVelocity) || 0;
  const normalSpeed = vx * contact.nx + vy * contact.ny;
  let normalImpulse = 0;
  if (normalSpeed < 0) {
    normalImpulse = -(1 + restitution) * normalSpeed;
    vx += contact.nx * normalImpulse;
    vy += contact.ny * normalImpulse;
  }
  const tx = -contact.ny, ty = contact.nx;
  const tangentialSpeed = vx * tx + vy * ty;
  const spunUp = omega + angularDrive * dt;
  if (angularDrive > 0) omega = Math.max(omega, Math.min(spunUp, (tangentialSpeed + maxDriveSlip) / radius));
  else if (angularDrive < 0) omega = Math.min(omega, Math.max(spunUp, (tangentialSpeed - maxDriveSlip) / radius));
  omega *= Math.max(0, 1 - angularDrag * dt);
  const slip = tangentialSpeed - omega * radius;
  if (freeRolling && angularDrive === 0 && angularBrake === 0) {
    const reduction = Math.max(-rollingResistance * dt, Math.min(rollingResistance * dt, tangentialSpeed));
    vx -= tx * reduction;
    vy -= ty * reduction;
    omega = (tangentialSpeed - reduction) / radius;
    setVelocity(point, vx * dt, vy * dt);
    point.angularVelocity = omega;
    point.spin = (point.spin || 0) + omega * dt;
    return { normalImpulse, tangentImpulse: reduction ? -reduction : 0, slip };
  }
  const load = Math.max(0, normalLoad) + normalImpulse;
  const frictionLimit = friction * load;
  const slideLimit = Math.min(frictionLimit, kineticFriction * load);
  // The tire grips while the whole impulse this step fits under static
  // friction; past that it slides and pushes with kinetic friction.
  const fitImpulse = requested => {
    const total = requested + appliedImpulse;
    const limit = Math.abs(total) <= frictionLimit ? frictionLimit : slideLimit;
    return Math.max(-limit, Math.min(limit, total)) - appliedImpulse;
  };
  const spinPerImpulse = 1 / Math.max(EPSILON, inertia * radius);
  // angularBrake is the most spin (rad/s²) the brake can take out. When that
  // is enough to hold the wheel still, the tire grips or skids on a locked
  // wheel, so a held brake stops the bike and keeps it parked on a slope.
  const brakeLimit = angularBrake * dt;
  const lockedImpulse = fitImpulse(-tangentialSpeed);
  let tangentImpulse, held = false;
  if (brakeLimit > 0 && Math.abs(lockedImpulse * spinPerImpulse - omega) <= brakeLimit) {
    tangentImpulse = lockedImpulse;
    omega = 0;
    held = Math.abs(tangentialSpeed + appliedImpulse) <= frictionLimit;
  } else {
    if (brakeLimit > 0) omega -= Math.max(-brakeLimit, Math.min(brakeLimit, omega));
    const requestedImpulse = -(tangentialSpeed - omega * radius) / (1 + 1 / Math.max(EPSILON, inertia));
    tangentImpulse = fitImpulse(requestedImpulse);
    omega -= tangentImpulse * spinPerImpulse;
  }
  vx += tx * tangentImpulse;
  vy += ty * tangentImpulse;
  setVelocity(point, vx * dt, vy * dt);
  point.angularVelocity = omega;
  point.spin = (point.spin || 0) + omega * dt;
  return { normalImpulse, tangentImpulse, slip, held, frictionLimit };
}
