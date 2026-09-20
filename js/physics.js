export function solveDistanceConstraint(a, b, targetLength, stiffness) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || .001;
  const correction = ((distance - targetLength) / distance) * stiffness;
  const correctionX = dx * correction;
  const correctionY = dy * correction;

  // Move old and current positions together. This repairs the bike frame's
  // shape without turning the positional correction into artificial velocity.
  a.x += correctionX;
  a.y += correctionY;
  a.ox += correctionX;
  a.oy += correctionY;
  b.x -= correctionX;
  b.y -= correctionY;
  b.ox -= correctionX;
  b.oy -= correctionY;

  return {
    distance,
    correctionDistance: Math.abs(distance - targetLength) * stiffness,
    correctionX,
    correctionY
  };
}

export function constrainDistanceVelocity(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || .001;
  const nx = dx / distance;
  const ny = dy / distance;
  const avx = a.x - a.ox;
  const avy = a.y - a.oy;
  const bvx = b.x - b.ox;
  const bvy = b.y - b.oy;
  const relativeNormalVelocity = (bvx - avx) * nx + (bvy - avy) * ny;
  const impulse = relativeNormalVelocity * .5;

  const nextAvx = avx + nx * impulse;
  const nextAvy = avy + ny * impulse;
  const nextBvx = bvx - nx * impulse;
  const nextBvy = bvy - ny * impulse;
  a.ox = a.x - nextAvx;
  a.oy = a.y - nextAvy;
  b.ox = b.x - nextBvx;
  b.oy = b.y - nextBvy;
}
