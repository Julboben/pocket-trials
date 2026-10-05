// @ts-check
// Cosmetic effects: particles, skid marks, terrain spray and weather timing.
// None of this feeds back into the simulation, so it may use Math.random.
import { STEP, RADIUS, TAU, clamp, lerp } from './config.js';
import { terrainMaterials } from './materials.js';
import { terrainAt } from './terrain.js';
import { WATER_COLORS, submergedFraction, waterAt } from './water.js';

const MAX_PARTICLES = 400;
const MAX_SKID_MARKS = 120;

// Compacts live entries to the front in place, keeping draw order, and drops
// the oldest entries beyond `limit`.
function removeExpired(list, limit) {
  let kept = 0;
  const overflow = Math.max(0, list.length - limit);
  for (let index = overflow; index < list.length; index++) {
    if (list[index].life > 0) list[kept++] = list[index];
  }
  list.length = kept;
}

export function createEffects() {
  /** @type {any[]} */ const particles = [];
  /** @type {any[]} */ const skidMarks = [];
  const weather = { time: 0, nextLightning: Infinity, flash: 0, x: .5, distance: .5 };
  let trail = null, sprayAccumulator = 0, skidAccumulator = 0, wakeAccumulator = 0;

  function reset(nextTrail) {
    trail = nextTrail;
    particles.length = 0; skidMarks.length = 0;
    sprayAccumulator = 0; skidAccumulator = 0; wakeAccumulator = 0;
    weather.time = 0; weather.flash = 0; weather.x = .5; weather.distance = .5;
    weather.nextLightning = trail.weather?.lightning ? 2.5 + Math.random() * 4 : Infinity;
  }

  function burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = TAU * i / count;
      const speed = 25 + Math.random() * 85;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 35, life: .65, max: .65, color });
    }
  }

  function dustPuff(wheel, impactSpeed) {
    const x = wheel.contact?.pointX ?? wheel.x;
    const y = (wheel.contact?.pointY ?? wheel.y + RADIUS) - 2;
    const spray = (terrainMaterials[wheel.material] || terrainMaterials.grass).spray;
    const count = Math.round(clamp(impactSpeed / 40, 3, 9));
    for (let index = 0; index < count; index++) {
      const side = index % 2 ? 1 : -1;
      const life = .3 + Math.random() * .25;
      particles.push({
        x: x + side * (2 + Math.random() * 6), y,
        vx: side * (30 + Math.random() * 50), vy: -(10 + Math.random() * 30),
        life, max: life, color: spray[index % spray.length], size: 2, drag: 5
      });
    }
  }

  function brakeMarks(ride, speed, braking) {
    const magnitude = Math.abs(speed);
    if (ride.status !== 'running' || !braking || magnitude < 24) { skidAccumulator = 0; return; }
    skidAccumulator += STEP;
    if (skidAccumulator < .045) return;
    skidAccumulator = 0;
    const direction = Math.sign(speed || ride.facing);
    for (const wheel of [ride.rear, ride.front]) {
      if (!wheel.grounded) continue;
      const ground = wheel.contact || terrainAt(trail, wheel.x, wheel.y - RADIUS);
      const length = clamp(magnitude * .035 * ride.brakePressure, 3, 10);
      skidMarks.push({
        x: ground.pointX ?? wheel.x, y: (ground.pointY ?? ground.y) - 1, slope: ground.slope,
        direction, length, life: 1.6, max: 1.6
      });
    }
  }

  function terrainSpray(ride, speed, braking) {
    if (ride.status !== 'running') return;
    const magnitude = Math.abs(speed);
    const wheel = ride.facing > 0 ? ride.rear : ride.front;
    if (!wheel.grounded || magnitude < 28 || (!braking && ride.throttle < .12)) {
      sprayAccumulator = Math.min(sprayAccumulator, .8);
      return;
    }
    const intensity = clamp(magnitude / 210, .15, 1) * (braking ? 1.5 : .8 + ride.throttle * .7);
    sprayAccumulator += intensity * STEP * 24;
    while (sprayAccumulator >= 1) {
      sprayAccumulator--;
      const direction = Math.sign(speed || ride.facing);
      const spray = (terrainMaterials[wheel.material] || terrainMaterials.grass).spray;
      const color = spray[Math.floor(Math.random() * spray.length)];
      const life = .28 + Math.random() * .32;
      particles.push({
        x: (wheel.contact?.pointX ?? wheel.x) - direction * (RADIUS - 2),
        y: (wheel.contact?.pointY ?? terrainAt(trail, wheel.x, wheel.y).y) - 2,
        vx: speed * .12 - direction * (35 + Math.random() * (braking ? 95 : 65)),
        vy: -(25 + Math.random() * (braking ? 90 : 55)),
        life, max: life, color, size: Math.random() < .7 ? 2 : 4, drag: 2.5, splatter: true
      });
    }
  }

  /** Droplets thrown up where something hits the water, more the harder it hits. */
  function splash(x, y, speed) {
    const count = Math.round(clamp(speed / 22, 5, 18));
    for (let index = 0; index < count; index++) {
      const side = index % 2 ? 1 : -1;
      const life = .35 + Math.random() * .35;
      particles.push({
        x: x + side * Math.random() * 10, y: y - 1,
        vx: side * (15 + Math.random() * 70), vy: -(40 + Math.random() * clamp(speed * .9, 60, 260)),
        life, max: life, color: WATER_COLORS.splash[index % WATER_COLORS.splash.length],
        size: Math.random() < .6 ? 2 : 4, drag: 1.5
      });
    }
  }

  /** Spray from wheels pushing through the water's surface. */
  function waterWake(ride, speed) {
    const bodies = ride.water;
    if (!bodies?.length || ride.status !== 'running') return;
    const magnitude = Math.abs(speed);
    let surface = null, x = 0;
    for (const wheel of [ride.rear, ride.front]) {
      const wet = submergedFraction(bodies, wheel.x, wheel.y, RADIUS);
      if (wet <= 0 || wet >= 1) continue;
      const body = waterAt(bodies, wheel.x, wheel.y + RADIUS);
      if (body) { surface = body.y; x = wheel.x; }
    }
    if (surface === null || magnitude < 30) { wakeAccumulator = 0; return; }
    wakeAccumulator += clamp(magnitude / 200, .2, 1.4) * STEP * 30;
    const direction = Math.sign(speed || ride.facing);
    while (wakeAccumulator >= 1) {
      wakeAccumulator--;
      const life = .3 + Math.random() * .3;
      particles.push({
        x: x - direction * Math.random() * RADIUS, y: surface - 1,
        vx: speed * .25 - direction * Math.random() * 40, vy: -(30 + Math.random() * magnitude * .35),
        life, max: life, color: WATER_COLORS.splash[Math.floor(Math.random() * 3)], size: 2, drag: 2
      });
    }
  }

  /** Advances weather by one step; returns a thunder strike when one happens. */
  function stepWeather() {
    weather.time += STEP;
    weather.flash = Math.max(0, weather.flash - STEP * 4.5);
    const intensity = clamp(Number(trail.weather?.lightning) || 0, 0, 1);
    if (!intensity || weather.time < weather.nextLightning) return null;
    weather.distance = Math.pow(Math.random(), .75);
    const proximity = 1 - weather.distance;
    weather.flash = (.4 + intensity * .35) * (.45 + proximity * .55);
    weather.x = .15 + Math.random() * .7;
    const interval = lerp(12, 4.5, intensity);
    weather.nextLightning = weather.time + interval * (.7 + Math.random() * .65);
    return { intensity, distance: weather.distance, x: weather.x };
  }

  function update(dt) {
    for (const mark of skidMarks) mark.life -= dt;
    for (const p of particles) {
      p.life -= dt;
      if (p.drag) p.vx *= Math.exp(-p.drag * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 210 * dt;
      if (p.splatter) {
        // The floor under the particle, so spray in a cave lands on the cave
        // floor instead of jumping onto the rock above it.
        const ground = terrainAt(trail, p.x, p.y - 6);
        if (ground.solid && p.y > ground.y - 1) {
          p.y = ground.y - 1;
          p.vx *= .45; p.vy = -Math.abs(p.vy) * .16;
          p.life = Math.min(p.life, .16);
        }
      }
    }
  }

  function prune() {
    removeExpired(particles, MAX_PARTICLES);
    removeExpired(skidMarks, MAX_SKID_MARKS);
  }

  return { particles, skidMarks, weather, reset, burst, dustPuff, brakeMarks, terrainSpray, splash, waterWake, stepWeather, update, prune };
}
