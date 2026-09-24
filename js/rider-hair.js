const TAU = Math.PI * 2;
const HAIR_STEP = 1 / 120;
const HAIR_MAX_STEPS = 4;
const HAIR_LENGTHS = [4, 4, 4, 4, 4];
const HAIR_ROOT = [-6, -44];
const HAIR_REST = [-.55, .84];
const HAIR_STRANDS = [
  { offset: -1, reach: .7, width: 2, color: '#54362d' },
  { offset: 1, reach: 1, width: 2, color: '#54362d' },
  { offset: 0, reach: .9, width: 3, color: '#684438' }
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

// Maps rider-local coordinates onto a bike pose the same way drawBike does.
// Without `exact`, positions snap to the pixel grid drawBike renders on.
export function riderBodyFrame({ rear, front, facing = 1, flipVisual = facing, leanVisual = 0 }, exact = false) {
  const snap = (value, step) => exact ? value : Math.round(value / step) * step;
  const mx = snap((rear.x + front.x) / 2, 1);
  const my = snap((rear.y + front.y) / 2, 1);
  const pixelAngle = snap(Math.atan2(front.y - rear.y, front.x - rear.x), TAU / 32);
  const backCompression = (facing > 0 ? rear.compression : front.compression) || 0;
  const frontCompression = (facing > 0 ? front.compression : rear.compression) || 0;
  const bodyDrop = snap((backCompression + frontCompression) * .4, 2);
  const bodyPitch = (frontCompression - backCompression) * .0096;
  const shift = snap(leanVisual * 9, 2);
  const cosPitch = Math.cos(bodyPitch), sinPitch = Math.sin(bodyPitch);
  const cosAngle = Math.cos(pixelAngle), sinAngle = Math.sin(pixelAngle);
  const rotate = (localX, localY, drop) => {
    const pitchedX = localX * cosPitch - localY * sinPitch;
    const pitchedY = localX * sinPitch + localY * cosPitch + drop;
    const flippedX = pitchedX * flipVisual;
    return { x: cosAngle * flippedX - sinAngle * pitchedY, y: sinAngle * flippedX + cosAngle * pitchedY };
  };
  return {
    point(localX, localY) {
      const offset = rotate(localX + shift, localY, bodyDrop);
      return { x: mx + offset.x, y: my + offset.y };
    },
    direction(localX, localY) {
      const direction = rotate(localX, localY, 0);
      const length = Math.hypot(direction.x, direction.y) || 1;
      return { x: direction.x / length, y: direction.y / length };
    }
  };
}

export function hairRoot(pose, exact) {
  return riderBodyFrame(pose, exact).point(HAIR_ROOT[0], HAIR_ROOT[1]);
}

export function hairRestDirection(pose) {
  return riderBodyFrame(pose, true).direction(HAIR_REST[0], HAIR_REST[1]);
}

export function freeHairRestDirection(facing) {
  const length = Math.hypot(HAIR_REST[0], HAIR_REST[1]);
  return { x: HAIR_REST[0] * facing / length, y: HAIR_REST[1] / length };
}

export function hairBackSupport(pose) {
  const frame = riderBodyFrame(pose, true);
  const top = frame.point(-7, -39);
  const bottom = frame.point(-8, -27);
  const outside = frame.point(-9, -33);
  const inside = frame.point(-7, -33);
  const dx = outside.x - inside.x, dy = outside.y - inside.y;
  const length = Math.hypot(dx, dy) || 1;
  const bx = bottom.x - top.x, by = bottom.y - top.y;
  return { top, bx, by, lengthSquared: bx * bx + by * by || 1, nx: dx / length, ny: dy / length };
}

function pushOutOfBack(point, back) {
  const t = clamp(((point.x - back.top.x) * back.bx + (point.y - back.top.y) * back.by) / back.lengthSquared, 0, 1);
  const clearance = (point.x - back.top.x - back.bx * t) * back.nx + (point.y - back.top.y - back.by * t) * back.ny;
  if (clearance < 2) {
    point.x += back.nx * (2 - clearance);
    point.y += back.ny * (2 - clearance);
  }
}

function catmullRom(points, samplesPerSegment) {
  const curve = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let sample = 0; sample < samplesPerSegment; sample++) {
      const t = sample / samplesPerSegment, t2 = t * t, t3 = t2 * t;
      curve.push([0, 1].map(axis => .5 * (2 * p1[axis] + (p2[axis] - p0[axis]) * t
        + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2
        + (3 * p1[axis] - p0[axis] - 3 * p2[axis] + p3[axis]) * t3)));
    }
  }
  curve.push(points.at(-1));
  return curve;
}

export function createRiderHair(root, rest) {
  let { x, y } = root;
  const hair = {
    accumulator: 0,
    root: { ...root },
    points: HAIR_LENGTHS.map(length => {
      x += rest.x * length;
      y += rest.y * length + length * .3;
      return { x, y, px: x, py: y };
    })
  };

  function step(h, from, to, blend, rest, back, groundAt) {
    const anchor = { x: lerp(from.x, to.x, blend), y: lerp(from.y, to.y, blend) };
    const anchorVX = anchor.x - hair.root.x, anchorVY = anchor.y - hair.root.y;
    hair.root = anchor;
    const follow = 1 - Math.exp(-12 * h);
    const wind = 3.5 * h;
    const gravity = 620 * h * h;
    const points = hair.points;
    let parent = anchor, parentDirection = rest;
    points.forEach((point, index) => {
      const along = index / (points.length - 1);
      let vx = point.x - point.px, vy = point.y - point.py;
      vx = clamp(vx + (anchorVX - vx) * follow - anchorVX * wind, -5, 5);
      vy = clamp(vy + (anchorVY - vy) * follow - anchorVY * wind, -5, 5);
      point.px = point.x; point.py = point.y;
      point.x += vx;
      point.y += vy + gravity;
      let targetX = rest.x, targetY = rest.y;
      if (index > 0) {
        targetX = parentDirection.x * .85 + rest.x * .15;
        targetY = parentDirection.y * .85 + rest.y * .15;
        const targetLength = Math.hypot(targetX, targetY) || 1;
        targetX /= targetLength; targetY /= targetLength;
      }
      const stiffness = lerp(.045, .008, along);
      point.x += (parent.x + targetX * HAIR_LENGTHS[index] - point.x) * stiffness;
      point.y += (parent.y + targetY * HAIR_LENGTHS[index] - point.y) * stiffness;
      const dx = point.x - parent.x, dy = point.y - parent.y;
      const distance = Math.hypot(dx, dy) || 1;
      parentDirection = { x: dx / distance, y: dy / distance };
      parent = point;
    });
    for (let iteration = 0; iteration < 3; iteration++) {
      let chainParent = anchor;
      points.forEach((point, index) => {
        const dx = point.x - chainParent.x, dy = point.y - chainParent.y;
        const distance = Math.hypot(dx, dy) || 1;
        point.x = chainParent.x + dx / distance * HAIR_LENGTHS[index];
        point.y = chainParent.y + dy / distance * HAIR_LENGTHS[index];
        if (back) pushOutOfBack(point, back);
        chainParent = point;
      });
    }
    if (!groundAt) return;
    for (const point of points) {
      const ground = groundAt(point.x);
      if (ground.solid && point.y > ground.y - 2) {
        point.y = ground.y - 2;
        point.px = lerp(point.px, point.x, .5);
      }
    }
  }

  return {
    get root() { return hair.root; },
    update(dt, { root, rest, back = null, groundAt = null }) {
      if (dt <= 0) return;
      const steps = Math.min(HAIR_MAX_STEPS, Math.floor((hair.accumulator + dt) / HAIR_STEP));
      hair.accumulator = steps === HAIR_MAX_STEPS ? 0 : hair.accumulator + dt - steps * HAIR_STEP;
      if (!steps) return;
      const from = hair.root;
      for (let index = 1; index <= steps; index++) step(HAIR_STEP, from, root, index / steps, rest, back, groundAt);
    },
    // Runs the simulation with the rider held still, for posed illustrations.
    settle(seconds, state) {
      for (let elapsed = 0; elapsed < seconds; elapsed += HAIR_STEP) step(HAIR_STEP, hair.root, state.root, 1, state.rest, state.back, state.groundAt);
    },
    draw(pixelPath, drawnRoot) {
      const offsetX = drawnRoot.x - hair.root.x, offsetY = drawnRoot.y - hair.root.y;
      const controls = [[drawnRoot.x, drawnRoot.y], ...hair.points.map((point, index) => {
        const pinned = 1 - (index + 1) / hair.points.length;
        return [point.x + offsetX * pinned, point.y + offsetY * pinned];
      })];
      const spine = catmullRom(controls, 2);
      const last = spine.length - 1;
      const strands = HAIR_STRANDS.map(({ offset, reach, width }) => {
        const count = Math.max(2, Math.round(last * reach) + 1);
        return spine.slice(0, count).map((point, index) => {
          const previous = spine[Math.max(0, index - 1)], next = spine[Math.min(last, index + 1)];
          const tx = next[0] - previous[0], ty = next[1] - previous[1];
          const length = Math.hypot(tx, ty) || 1;
          const along = index / (count - 1);
          const spread = offset * (1 + 1.5 * Math.sin(Math.PI * along));
          return { x: point[0] - ty / length * spread, y: point[1] + tx / length * spread, width: Math.max(1, Math.round(width * (1 - along * .7))) };
        });
      });
      for (const pass of ['outline', 'fill']) strands.forEach((strand, strandIndex) => {
        for (let i = 1; i < strand.length; i++) {
          const a = strand[i - 1], b = strand[i];
          if (pass === 'outline') pixelPath([[a.x, a.y], [b.x, b.y]], '#2e1d19', a.width + 1, 2);
          else pixelPath([[a.x, a.y], [b.x, b.y]], HAIR_STRANDS[strandIndex].color, a.width, 2);
        }
      });
      const shine = strands[2];
      pixelPath(shine.slice(0, Math.ceil(shine.length * .35)).map(point => [point.x, point.y]), '#8c5d48', 1, 2);
    }
  };
}
