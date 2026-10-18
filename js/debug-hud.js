// The on-screen readout for `?debug=1`: what the ride, the bike, the engine,
// each wheel and the rider's crash probes are doing, refreshed ten times a
// second. Reading it never changes the ride.
import { ENGINE, GRAVITY, STEP, XPBD_MOTOR_ANGULAR_ACCELERATION, clamp } from './config.js';
import { riderCollisionPoints } from './ride.js';
import { terrainCollisionsAt } from './terrain.js';
import { vehicleMetrics } from './vehicle-physics.js';

const REFRESH_MS = 100;
/** How far (px) past a probe's edge the ground is looked for. */
const CLEARANCE_REACH = 30;

/**
 * Distance from a probe's edge to the nearest ground, negative inside it, or
 * null when the ground is further than CLEARANCE_REACH.
 * @param {any} trail
 * @param {{ x: number, y: number, radius: number }} probe
 */
export function probeClearance(trail, probe) {
  const reach = probe.radius + CLEARANCE_REACH;
  const contact = terrainCollisionsAt(trail, probe.x, probe.y, reach)[0];
  if (!contact) return null;
  return reach - contact.penetration - probe.radius;
}

const number = (value, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : '–');
const signed = (value, digits = 0) => (Number.isFinite(value) ? (value >= 0 ? ' ' : '') + value.toFixed(digits) : '–');

/** @param {Element} parent */
export function createDebugHud(parent) {
  const panel = document.createElement('pre');
  panel.className = 'debug-hud';
  panel.setAttribute('aria-hidden', 'true');
  parent.append(panel);
  let shownAt = 0;

  function wheelLine(name, wheel, restLoad) {
    const load = wheel.grounded ? (wheel.groundLoad || 0) / restLoad : 0;
    return `${name.padEnd(5)} ${wheel.grounded ? 'down' : 'air '} ${(wheel.grounded ? wheel.material || '' : '').padEnd(8)}`
      + ` comp ${signed(wheel.compression, 1).padStart(5)}  load ${number(load, 1).padStart(4)}×  spin ${signed(wheel.angularVelocity, 0).padStart(4)}`;
  }

  function probeLine(trail, probes) {
    return Object.entries(probes).map(([name, probe]) => {
      const clearance = probeClearance(trail, probe);
      const text = clearance === null ? 'clear' : clearance <= 0 ? `IN ${number(-clearance, 1)}` : `${number(clearance, 1)}px`;
      return `${name} ${text}`;
    }).join('  ');
  }

  return {
    /**
     * @param {{ ride: any, state: string, trailName: string, dynamics: any }} snapshot
     * @param {number} now
     */
    update({ ride, state, trailName, dynamics }, now) {
      if (now - shownAt < REFRESH_MS) return;
      shownAt = now;
      if (!ride) { panel.textContent = `${trailName || ''} · ${state}`; return; }
      const { vehicle } = ride;
      const metrics = vehicleMetrics(vehicle);
      let mass = 0;
      for (const point of vehicle.bikePoints) mass += 1 / point.inverseMass;
      const restLoad = mass * GRAVITY * STEP / 2;
      const engine = vehicle.engine;
      const revs = clamp((engine.rev - ENGINE.idle) / (ENGINE.redline - ENGINE.idle), 0, 1);
      const probes = riderCollisionPoints(ride);
      const headClearance = probeClearance(ride.trail, probes.head);
      const lines = [
        `${trailName || ''} · ${state}${ride.crashCause ? ` (${ride.crashCause})` : ''} · ${number(ride.elapsed, 2)} s · step ${ride.steps}`,
        `speed ${number(Math.hypot(metrics.speedX, metrics.speedY)).padStart(4)} px/s  pitch ${signed(-metrics.pitch * 180 / Math.PI).padStart(4)}°  facing ${ride.facing > 0 ? '→' : '←'}`,
        `gas ${number(ride.throttle, 2)}  brake ${number(ride.brakePressure, 2)}  lean ${signed(ride.leanControl, 2)}`
          + (dynamics && (ride.rear.grounded || ride.front.grounded)
            ? `  reaches ${number(dynamics.groundLeverage * 100)}%${dynamics.hanging ? ' HANGING' : ''}`
            : '  (air lean)'),
        `engine ${number(revs, 2)}  clutch ${number((engine.clutchTorque || 0) / XPBD_MOTOR_ANGULAR_ACCELERATION, 2)}`,
        wheelLine('rear', ride.rear, restLoad),
        wheelLine('front', ride.front, restLoad),
        probeLine(ride.trail, probes) + (headClearance !== null && headClearance <= 0 ? '  ← HEAD TOUCHING' : ''),
      ];
      panel.textContent = lines.join('\n');
    },
  };
}
