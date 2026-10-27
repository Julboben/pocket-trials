// @ts-check
// Fireworks over the trail, for a new world record: rockets go up from
// behind the land in front of the camera and burst in the sky, drawn on the
// art's pixel grid in banded colours like the rest of the scene. The
// renderer draws them behind the terrain and lets each burst light up the
// scene. Purely cosmetic, outside the simulation, so it may use Math.random.
import { TAU } from './config.js';
import { ART_PIXEL } from './drawing.js';
import { reducedMotion } from './state.js';

/**
 * Each burst's colours, brightest first: a star burns down through them.
 * `light` is the colour it lights the scene with.
 */
const PALETTES = [
  { ramp: ['#fff6d0', '#ffd75e', '#e8964f', '#8a4a2a'], light: [255, 215, 94] },
  { ramp: ['#ffe0d8', '#ff6f5e', '#c8383a', '#6e1f2a'], light: [255, 111, 94] },
  { ramp: ['#e6f8ff', '#7fd3ff', '#3f86c8', '#24406e'], light: [127, 211, 255] },
  { ramp: ['#eaffdf', '#8be07a', '#3e9e52', '#1f5233'], light: [139, 224, 122] },
  { ramp: ['#f3e8ff', '#b78cff', '#7656c8', '#3c2c6e'], light: [183, 140, 255] },
  { ramp: ['#ffe6ee', '#ff6f91', '#c84070', '#6a2440'], light: [255, 111, 145] },
];
const ROCKET_RAMP = ['#fff3c4', '#f2b25c', '#a8582e'];
/** World units per second squared: rockets brake hard, stars drift down. */
const ROCKET_GRAVITY = 300, STAR_GRAVITY = 40;
/** How fast stars lose speed, per second: the burst opens, then hangs. */
const STAR_DRAG = 2.2;
/** How long (s) rockets keep going up; the last bursts burn out after. */
const SHOW_LENGTH = 4.2;
/** How far a burst lights the scene (world units). */
const LIGHT_RADIUS = 130;

/**
 * @typedef {{ x: number, y: number, life: number, max: number, light: any }} Burst
 * @typedef {{ x: number, y: number, vx: number, vy: number, px: number, py: number,
 *   life: number, max: number, ramp: string[], rocket?: boolean }} Star
 * @typedef {{ x: number, y: number, width: number, height: number }} View
 */

/**
 * @param {{ onLaunch?: (x: number, flight: number) => void, onBurst?: (x: number) => void }} [sounds]
 *   called as a rocket goes up, with how long (s) it climbs, and as it
 *   bursts, with where across the view (0 … 1), so the sound can come from there
 */
export function createFireworks({ onLaunch = () => {}, onBurst = () => {} } = {}) {
  /** @type {Star[]} */ let stars = [];
  /** @type {Burst[]} */ let bursts = [];
  let playing = false, time = 0, nextRocket = 0;

  /** @param {View} view */
  function launch(view) {
    const x = view.x + view.width * (.12 + Math.random() * .76);
    const y = view.y + view.height + 20;
    // High enough to burst in the top half of the view, clear of the land.
    const rise = y - (view.y + view.height * (.12 + Math.random() * .3));
    const vy = -Math.sqrt(2 * ROCKET_GRAVITY * rise);
    stars.push({
      x, y, px: x, py: y, vx: (Math.random() - .5) * 30, vy,
      life: 4, max: 4, ramp: ROCKET_RAMP, rocket: true,
    });
    onLaunch((x - view.x) / view.width, -vy / ROCKET_GRAVITY);
  }

  /** @param {number} x @param {number} y @param {View} view */
  function explode(x, y, view) {
    onBurst((x - view.x) / view.width);
    const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const ring = Math.random() < .3;
    const radius = 45 + Math.random() * 40;
    const count = ring ? 28 : 40 + Math.floor(Math.random() * 24);
    const max = 1.4 + Math.random() * .6;
    // The light lasts as long as the burst; lighting.js keeps its shape on it.
    bursts.push({ x, y, life: max, max, light: { x, y, radius: LIGHT_RADIUS, color: palette.light, strength: 1 } });
    for (let i = 0; i < count; i++) {
      const angle = TAU * (i + Math.random() * .3) / count;
      // Stars come to rest about speed / drag from the centre.
      const speed = radius * STAR_DRAG * (ring ? .95 + Math.random() * .1 : .35 + Math.random() * .65);
      const life = max * (.75 + Math.random() * .25);
      stars.push({ x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, max: life, ramp: palette.ramp });
    }
  }

  /** Starts a show, or carries on the one already going. */
  function play() {
    // A flashing sky is the kind of motion reduced-motion riders opt out of.
    if (reducedMotion) return;
    playing = true;
    time = 0; nextRocket = 0;
  }

  function stop() {
    playing = false;
    stars = []; bursts = [];
  }

  /** Whether anything is still in the sky, so the scene keeps being drawn. */
  const active = () => playing || stars.length > 0;

  /** @param {number} dt @param {View} view where the camera looks now */
  function update(dt, view) {
    if (!active()) return;
    time += dt;
    if (playing && time >= nextRocket) {
      launch(view);
      if (Math.random() < .3) launch(view);
      nextRocket = time + .3 + Math.random() * .35;
    }
    if (time >= SHOW_LENGTH) playing = false;
    const drag = Math.exp(-STAR_DRAG * dt);
    const next = [];
    for (const star of stars) {
      star.px = star.x; star.py = star.y;
      star.life -= dt;
      if (star.rocket) {
        star.vy += ROCKET_GRAVITY * dt;
        star.x += star.vx * dt; star.y += star.vy * dt;
        // A rocket bursts at the top of its climb.
        if (star.vy >= -15) { explode(star.x, star.y, view); continue; }
      } else {
        star.vx *= drag; star.vy = star.vy * drag + STAR_GRAVITY * dt;
        star.x += star.vx * dt; star.y += star.vy * dt;
      }
      if (star.life > 0) next.push(star);
    }
    stars = next;
    for (const burst of bursts) {
      burst.life -= dt;
      // A flash as it bursts, then the glow dies down with the stars.
      burst.light.strength = Math.max(0, burst.life / burst.max) ** 2 * 1.2;
    }
    bursts = bursts.filter(burst => burst.life > 0);
  }

  /** Snaps to the art's pixel grid. */
  const snap = (/** @type {number} */ value) => Math.round(value / ART_PIXEL) * ART_PIXEL;

  /**
   * Draws in world space, on the context the renderer has moved to the
   * camera: one art pixel per star, burning down through its colours in
   * steps with no blending, with a short darker tail.
   * @param {CanvasRenderingContext2D} ctx
   */
  function draw(ctx) {
    for (const star of stars) {
      const fade = star.life / star.max;
      const { ramp } = star;
      const step = star.rocket ? 0 : fade > .8 ? 0 : fade > .5 ? 1 : fade > .22 ? 2 : 3;
      // Dying stars twinkle out.
      if (step === 3 && Math.random() < .35) continue;
      const x = snap(star.x), y = snap(star.y);
      // The tail points back the way it came, two frames' travel long.
      const tx = snap(star.x + (star.px - star.x) * 3), ty = snap(star.y + (star.py - star.y) * 3);
      if (tx !== x || ty !== y) {
        ctx.fillStyle = ramp[Math.min(ramp.length - 1, step + 1)];
        ctx.fillRect(snap((x + tx) / 2), snap((y + ty) / 2), ART_PIXEL, ART_PIXEL);
        ctx.fillStyle = ramp[Math.min(ramp.length - 1, step + 2)];
        ctx.fillRect(tx, ty, ART_PIXEL, ART_PIXEL);
      }
      ctx.fillStyle = ramp[step];
      ctx.fillRect(x, y, ART_PIXEL, ART_PIXEL);
    }
  }

  /** Each burst as a light for lighting.js, so the scene glows at night. */
  const lights = () => bursts.map(burst => burst.light);

  return { play, stop, active, update, draw, lights };
}
