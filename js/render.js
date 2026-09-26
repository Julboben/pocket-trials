// Scene rendering. Everything is drawn straight onto the screen canvas, scaled
// so one art pixel covers a whole number of device pixels. Art stays on its
// pixel grid, while the camera and moving sprites are placed to the nearest
// device pixel so scrolling and riding stay smooth.
import { RADIUS, TAU, clamp, lerp } from './config.js';
import { ART_PIXEL, createDrawingTools, createGameArt, propAlignmentSlope, propGroundOffset, sunLight, sunShadowOffset } from './drawing.js';
import { terrainAt, groundShadowSamples } from './terrain.js';
import { createTerrainRenderer } from './terrain-render.js';
import { vehicleMetrics } from './vehicle-physics.js';
import { ragdollCenter } from './ragdoll.js';
import { createRiderHair, hairRoot, hairRestDirection, freeHairRestDirection, hairBackSupport } from './rider-hair.js';
import { reducedMotion } from './state.js';

const SCENERY_SHADOWS = {
  tree: { width: 16, alpha: .15, thickness: 3, lift: 36 },
  crystal: { width: 10, alpha: .14, thickness: 3, lift: 28 },
  boulder: { width: 24, alpha: .15, thickness: 3, lift: 24 }
};
const GHOST_ALPHA = .38;

/** @param {HTMLCanvasElement} canvas */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const { pixelRect, pixelPath, drawPixelText } = createDrawingTools(ctx);
  const gameArt = createGameArt(ctx);
  const terrainRenderer = createTerrainRenderer();
  const popups = [];
  let W = 380, H = 410, pixelScale = 1;
  let hair = null, flipVisual = 1, level = null, cameraX = 0, cameraY = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const worldScale = clamp(rect.width / 760, 1, 1.45);
    const targetWidth = Math.max(320, rect.width / worldScale);
    const targetHeight = Math.max(340, rect.height / worldScale);
    const deviceWidth = Math.round(rect.width * dpr), deviceHeight = Math.round(rect.height * dpr);
    pixelScale = Math.max(1, Math.min(
      Math.floor(deviceWidth / (targetWidth / ART_PIXEL)),
      Math.floor(deviceHeight / (targetHeight / ART_PIXEL))
    ));
    canvas.width = deviceWidth;
    canvas.height = deviceHeight;
    W = Math.ceil(deviceWidth / pixelScale) * ART_PIXEL;
    H = Math.ceil(deviceHeight / pixelScale) * ART_PIXEL;
  }

  function reset(nextLevel, facing) {
    level = nextLevel;
    hair = null;
    flipVisual = facing;
    popups.length = 0;
  }

  /** Floating pixel text in world space, e.g. "+1 FLIP". */
  function popup(text, x, y, color = '#fff3be') {
    popups.push({ text, x, y, color, life: 1.2, max: 1.2 });
  }

  const inView = (x, margin) => x >= cameraX - margin && x <= cameraX + W + margin;

  function drawShadowBlob(samples, centerX, width, alpha, thickness) {
    for (const sample of samples) {
      const along = (sample.x - centerX) / width;
      if (Math.abs(along) > 1) continue;
      const envelope = Math.sqrt(Math.max(0, 1 - along * along));
      const height = Math.max(2, thickness * envelope);
      pixelRect(sample.x - 1, sample.y - height + 1, 2, height, 'rgba(31,53,39,' + (alpha * (.45 + .55 * envelope)) + ')', 2);
    }
  }

  const appleDrawY = (apple, now) => apple.y + (reducedMotion ? 0 : Math.sin(now * .0025 + apple.x) * 2);

  function drawSceneryShadow(x, y, light, { width, alpha, thickness, lift = 0 }) {
    const ground = terrainAt(level, x, y);
    if (!ground.solid) return;
    const height = Math.max(0, ground.y - y) + lift;
    const offset = sunShadowOffset({ bikeX: x - cameraX, bikeY: y - cameraY, sunX: light.x, sunY: light.y, height, strength: light.strength });
    const center = x + offset;
    drawShadowBlob(groundShadowSamples(level, x, y, width, 2, center).flat(), center, width, alpha, thickness);
  }

  function drawSceneryShadows(ride, now, full) {
    if (!full) return;
    const light = sunLight({ width: W, cameraX, cameraY, weather: level.weather });
    for (const prop of level.props || []) {
      const spec = SCENERY_SHADOWS[prop.type];
      if (!spec || !inView(prop.x, 80)) continue;
      const ground = terrainAt(level, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      drawSceneryShadow(prop.x, Number.isFinite(prop.y) ? prop.y : ground.y, light, spec);
    }
    for (const apple of ride.apples) {
      if (apple.taken || !inView(apple.x, 40)) continue;
      drawSceneryShadow(apple.x, appleDrawY(apple, now), light, { width: 8, alpha: .18, thickness: 3 });
    }
  }

  function drawProps(layer, full) {
    for (const prop of level.props || []) {
      if (prop.layer !== layer || (!full && prop.type === 'tree') || !inView(prop.x, 70)) continue;
      const ground = terrainAt(level, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      const y = Number.isFinite(prop.y) ? prop.y : ground.y;
      gameArt.drawProp(prop.type, prop.x, y, layer === 'front' ? 1 : .82, propAlignmentSlope(level, prop), propGroundOffset(level, prop));
    }
  }

  function drawSkidMarks(skidMarks) {
    for (const mark of skidMarks) {
      const length = mark.length * mark.direction;
      ctx.globalAlpha = clamp(mark.life / mark.max, 0, 1) * .42;
      pixelPath([[mark.x - length, mark.y - mark.slope * length], [mark.x, mark.y]], '#263b36', 1, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles(particles, splatter) {
    for (const p of particles) {
      if (Boolean(p.splatter) !== splatter) continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      pixelRect(p.x, p.y, p.size || 4, p.size || 4, p.color, 2);
    }
    ctx.globalAlpha = 1;
  }

  function riderPose(ride, flip = flipVisual) {
    return { rear: ride.rear, front: ride.front, facing: ride.facing, flipVisual: flip, leanVisual: ride.leanVisual };
  }

  function currentHairRoot(ride, exact) {
    if (ride.ragdoll) {
      const head = ride.ragdoll.points.head;
      return { x: head.x - ride.facing * 6, y: head.y };
    }
    return hairRoot(riderPose(ride), exact);
  }

  function updateHair(ride, rider, dt) {
    if (rider !== 'Maxine') { hair = null; return; }
    const root = currentHairRoot(ride, true);
    const rest = ride.ragdoll ? freeHairRestDirection(ride.facing) : hairRestDirection(riderPose(ride));
    if (!hair || Math.hypot(root.x - hair.root.x, root.y - hair.root.y) > 60) hair = createRiderHair(root, rest);
    hair.update(dt, { root, rest, back: ride.ragdoll ? null : hairBackSupport(riderPose(ride)), groundAt: x => terrainAt(level, x) });
  }

  function bikeGeometry(ride) {
    const { rear, front } = ride;
    return {
      mx: (rear.x + front.x) / 2, my: (rear.y + front.y) / 2,
      angle: Math.atan2(front.y - rear.y, front.x - rear.x),
      length: Math.hypot(front.x - rear.x, front.y - rear.y)
    };
  }

  function drawBike(ride, rider, flip, state) {
    const geometry = bikeGeometry(ride);
    const { mx, my } = geometry;
    const ground = terrainAt(level, mx, my);
    if (ground.solid) {
      const light = sunLight({ width: W, cameraX, cameraY, weather: level.weather });
      const heightAboveGround = Math.max(0, ground.y - my - RADIUS);
      const shadowAlpha = clamp(.22 - heightAboveGround / 700, .035, .22);
      const shadowWidth = clamp(35 - heightAboveGround * .07, 13, 35);
      const offset = sunShadowOffset({ bikeX: mx - cameraX, bikeY: my - cameraY, sunX: light.x, sunY: light.y, height: heightAboveGround, strength: light.strength });
      const center = mx + offset;
      const samples = groundShadowSamples(level, mx, my, shadowWidth, 2, center).flat();
      drawShadowBlob(samples, center, shadowWidth, shadowAlpha, 4);
      drawShadowBlob(samples, center + Math.sign(offset) * 3, shadowWidth * .7, shadowAlpha * .55, 2);
    }
    gameArt.drawBike({
      rear: ride.rear, front: ride.front, ...geometry, flipVisual: flip, facing: ride.facing,
      brakePressure: ride.brakePressure, state, leanVisual: ride.leanVisual, rider
    });
  }

  function drawGhost(ghost, rider) {
    if (!ghost || !inView((ghost.rear.x + ghost.front.x) / 2, 80)) return;
    ctx.globalAlpha = GHOST_ALPHA;
    gameArt.drawBike({
      rear: ghost.rear, front: ghost.front, ...bikeGeometry(ghost), flipVisual: ghost.facing, facing: ghost.facing,
      brakePressure: ghost.brakePressure, state: ghost.ragdoll ? 'ragdoll' : 'running', leanVisual: ghost.leanVisual, rider
    });
    if (ghost.ragdoll) gameArt.drawRagdoll(ghost.ragdoll.points, rider);
    ctx.globalAlpha = 1;
  }

  function drawPopups(dt) {
    for (const item of popups) {
      item.life -= dt;
      item.y -= dt * 30;
      ctx.globalAlpha = clamp(item.life / item.max * 2, 0, 1);
      drawPixelText(item.text, item.x, item.y, item.color, { pixel: 2, align: 'center' });
    }
    ctx.globalAlpha = 1;
    for (let index = popups.length - 1; index >= 0; index--) if (popups[index].life <= 0) popups.splice(index, 1);
  }

  function drawWeather(weather) {
    const rainIntensity = clamp(Number(level.weather?.rain) || 0, 0, 1);
    if (!rainIntensity && weather.flash <= 0) return;
    ctx.save();
    if (rainIntensity) {
      const count = Math.round((45 + rainIntensity * 95) * clamp(W / 760, .7, 1.5));
      const motion = reducedMotion ? 0 : weather.time * 720;
      ctx.fillStyle = `rgba(33, 52, 61, ${.04 + rainIntensity * .08})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(205, 225, 224, ${.22 + rainIntensity * .3})`;
      for (let index = 0; index < count; index++) {
        const seedX = (index * 97.31) % (W + 80);
        const seedY = (index * 53.17) % (H + 100);
        const speed = .72 + (index % 7) * .055;
        const y = (seedY + motion * speed) % (H + 70) - 35;
        const rainWidth = W + 80;
        const rawX = seedX - motion * .13 + y * .08;
        const x = ((rawX % rainWidth) + rainWidth) % rainWidth - 40;
        // A slanted streak as two offset one-pixel columns.
        const length = 7 + rainIntensity * 8 + (index % 4);
        const half = Math.max(1, Math.round(length / 2 / ART_PIXEL)) * ART_PIXEL;
        const left = Math.round(x / ART_PIXEL) * ART_PIXEL, top = Math.round(y / ART_PIXEL) * ART_PIXEL;
        ctx.fillRect(left, top, ART_PIXEL, half);
        ctx.fillRect(left - ART_PIXEL, top + half, ART_PIXEL, half);
      }
    }
    if (weather.flash > 0) {
      ctx.fillStyle = `rgba(225, 239, 237, ${weather.flash * .28})`;
      ctx.fillRect(0, 0, W, H);
      if (weather.flash > .3 && !reducedMotion) {
        const proximity = 1 - weather.distance;
        const startX = weather.x * W;
        const bolt = [[startX, 0]];
        for (let step = 1; step <= 6; step++) bolt.push([startX + Math.sin(weather.x * 91 + step * 7.3) * 16, step * H * .085]);
        pixelPath(bolt, `rgba(246, 244, 204, ${weather.flash})`, proximity > .5 ? 2 : 1);
      }
    }
    ctx.restore();
  }

  function drawPhysicsOverlay(vehicle) {
    const { chassis } = vehicle;
    ctx.save();
    ctx.globalAlpha = .85;
    ctx.lineWidth = 1;
    for (const constraint of vehicle.dampedConstraints) {
      if (constraint.type !== 'distance') continue;
      ctx.strokeStyle = constraint.minLength !== null || constraint.maxLength !== null ? '#f0b45f' : '#83d1ce';
      ctx.beginPath(); ctx.moveTo(constraint.a.x, constraint.a.y); ctx.lineTo(constraint.b.x, constraint.b.y); ctx.stroke();
    }
    for (const point of Object.values(chassis)) {
      ctx.fillStyle = '#fff3be'; ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, TAU); ctx.fill();
    }
    for (const point of [vehicle.rear, vehicle.front]) {
      if (!point.contact) continue;
      ctx.strokeStyle = '#e65e56'; ctx.beginPath(); ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + point.contact.nx * 24, point.y + point.contact.ny * 24); ctx.stroke();
    }
    const center = vehicleMetrics(vehicle).center;
    ctx.strokeStyle = '#ff8952'; ctx.beginPath();
    ctx.moveTo(center.x - 5, center.y); ctx.lineTo(center.x + 5, center.y);
    ctx.moveTo(center.x, center.y - 5); ctx.lineTo(center.x, center.y + 5); ctx.stroke();
    ctx.restore();
  }

  /** Where the camera should look: the bike, or the tumbling rider after a crash. */
  function focusOf(ride) {
    return ride.ragdoll ? ragdollCenter(ride.ragdoll) : vehicleMetrics(ride.vehicle).center;
  }

  /**
   * @param {{
   *   ride: any, ghost: any, camera: any, effects: any, rider: string, state: string,
   *   full: boolean, now: number, dt: number, debug: boolean
   * }} frame
   */
  function draw({ ride, ghost, camera, effects, rider, state, full, now, dt, debug }) {
    const paused = state === 'paused';
    const animationDt = paused ? 0 : dt;
    camera.follow(focusOf(ride), { facing: ride.facing, loose: Boolean(ride.ragdoll), width: W, height: H, dt });
    const flipSmoothing = reducedMotion ? 1 : 1 - Math.exp(-18 * dt);
    flipVisual = lerp(flipVisual, ride.facing, flipSmoothing);
    if (Math.abs(flipVisual - ride.facing) < .002) flipVisual = ride.facing;
    const worldToDevice = pixelScale / ART_PIXEL;
    const view = camera.view();
    // Whole device pixels, so art on the world's pixel grid never straddles a pixel.
    cameraX = Math.round(view.x * worldToDevice) / worldToDevice;
    cameraY = Math.round(view.y * worldToDevice) / worldToDevice;

    ctx.setTransform(worldToDevice, 0, 0, worldToDevice, 0, 0);
    ctx.imageSmoothingEnabled = false;
    gameArt.drawBackground({ width: W, height: H, palette: level, cameraX, cameraY, full, smooth: true });
    ctx.save(); ctx.translate(-cameraX, -cameraY);
    effects.update(animationDt);
    terrainRenderer.draw(ctx, level, cameraX, cameraY, W, H);
    drawSkidMarks(effects.skidMarks);
    drawSceneryShadows(ride, now, full);
    drawProps('back', full);
    drawParticles(effects.particles, true);
    if (inView(level.goal, 65)) gameArt.drawFlag(level.goal, terrainAt(level, level.goal).y, ride.collected === ride.apples.length, ride.apples.length - ride.collected);
    for (const spike of ride.spikes) {
      if (inView(spike.x, spike.radius + 10)) gameArt.drawSpike(spike.x, spike.y, spike.radius, reducedMotion ? 0 : ride.spikeTime * spike.spin * TAU);
    }
    for (const apple of ride.apples) if (!apple.taken && inView(apple.x, 30)) gameArt.drawApple(apple.x, appleDrawY(apple, now));
    drawGhost(ghost, rider);
    updateHair(ride, rider, animationDt);
    if (hair) hair.draw(pixelPath, currentHairRoot(ride, false));
    drawBike(ride, rider, flipVisual, ride.ragdoll ? 'ragdoll' : state);
    if (debug) drawPhysicsOverlay(ride.vehicle);
    if (ride.ragdoll) gameArt.drawRagdoll(ride.ragdoll.points, rider);
    drawProps('front', full);
    drawParticles(effects.particles, false);
    drawPopups(animationDt);
    effects.prune();
    ctx.restore();
    drawWeather(effects.weather);
  }

  return {
    resize, reset, draw, popup,
    get width() { return W; },
    get height() { return H; }
  };
}
