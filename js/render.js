// Scene rendering. Everything is drawn straight onto the screen canvas, scaled
// so one art pixel covers a whole number of device pixels. Art stays on its
// pixel grid, while the camera and moving sprites are placed to the nearest
// device pixel so scrolling and riding stay smooth.
import { RADIUS, TAU, clamp, lerp } from "./config.js";
import {
  ART_PIXEL,
  createCanvas,
  createDrawingTools,
  createGameArt,
  PAINTED_PROPS,
  paintedPropY,
  propAlignmentSlope,
  propGroundOffset,
  propSpan,
  propWallFit,
  sunLight,
  sunShadowOffset,
} from "./drawing.js";
import { terrainAt, groundShadowSamples, terrainGeometry } from "./terrain.js";
import { finishHeight } from "./trail-schema.js";
import { createTerrainRenderer } from "./terrain-render.js";
import { vehicleMetrics } from "./vehicle-physics.js";
import { ragdollCenter } from "./ragdoll.js";
import {
  createRiderHair,
  hairRoot,
  hairRestDirection,
  freeHairRestDirection,
  hairBackSupport,
} from "./rider-hair.js";
import { reducedMotion } from "./state.js";
import { createLighting } from "./lighting.js";
import { CRANE_LIGHTS, LAMP_HEAD } from "./city-props.js";

/**
 * How far left the camera may look. Blocks can reach into negative x, and the
 * finish may be out there, so the camera follows the bike as far as the
 * terrain goes.
 */
function cameraLeftLimit(trail) {
  const blocks = terrainGeometry(trail);
  return blocks ? Math.min(0, blocks.bounds.left - 150) : 0;
}

const SCENERY_SHADOWS = {
  tree: { width: 16, alpha: 0.15, thickness: 3, lift: 36 },
  pine: { width: 14, alpha: 0.15, thickness: 3, lift: 38 },
  crystal: { width: 10, alpha: 0.14, thickness: 3, lift: 28 },
  boulder: { width: 24, alpha: 0.15, thickness: 3, lift: 24 },
  cactus: { width: 12, alpha: 0.15, thickness: 3, lift: 22 },
  "cactus-small": { width: 7, alpha: 0.15, thickness: 3, lift: 12 },
  sapling: { width: 10, alpha: 0.15, thickness: 3, lift: 20 },
  "pine-small": { width: 9, alpha: 0.15, thickness: 3, lift: 22 },
  crates: { width: 26, alpha: 0.15, thickness: 3, lift: 24 },
  wheelbarrow: { width: 18, alpha: 0.13, thickness: 3, lift: 14 },
  scarecrow: { width: 8, alpha: 0.15, thickness: 3, lift: 30 },
  beehive: { width: 14, alpha: 0.14, thickness: 3, lift: 20 },
  cone: { width: 7, alpha: 0.14, thickness: 3, lift: 8 },
  dumpster: { width: 30, alpha: 0.15, thickness: 3, lift: 20 },
  lamp: { width: 6, alpha: 0.15, thickness: 3, lift: 40 },
};
const GHOST_ALPHA = 0.38;
// Where a front prop hides the rider, the hidden part shows as a silhouette.
const XRAY_COLOR = "#fff3be";
const XRAY_ALPHA = 0.25;
// World units around the bike and rider that the x-ray layer covers.
const XRAY_REACH = 70;
// How far each prop's art reaches above its anchor, for culling.
const PROP_RISE = {
  tree: 186,
  pine: 188,
  sapling: 80,
  "pine-small": 92,
  "cactus-small": 60,
  ladder: 102,
  scarecrow: 114,
  lamp: 130,
  crane: 282,
  scaffolding: 146,
};
// How far each prop's art hangs below its anchor, for culling.
const PROP_HANG = { vines: 148, roots: 28, moss: 28, graffiti: 38 };
// How far each prop's art reaches either side of its anchor, for culling.
const PROP_REACH = { crane: 180, minecart: 150, bats: 220 };
// Perched birds take off, and roosting bats scatter, when the rider comes
// within `x` and `y` of them; they are gone `flight` seconds later.
const STARTLE = {
  bird: { x: 110, y: 140, flight: 2.5 },
  bats: { x: 160, y: 200, flight: 2.2 },
};
// Props that glow, and how far their light reaches either side, for culling.
const GLOW_REACH = { lamp: 70, crane: 180, lantern: 100, mushrooms: 40 };
// How far a hair strand may sink into a floor and still be lifted back onto it.
const HAIR_GROUND_ALLOWANCE = 8;

/** @param {HTMLCanvasElement} canvas */
export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const { pixelRect, pixelPath, drawPixelText } = createDrawingTools(ctx);
  const gameArt = createGameArt(ctx);
  const terrainRenderer = createTerrainRenderer();
  const lighting = createLighting();
  const popups = [];
  let W = 380,
    H = 410,
    pixelScale = 1;
  let hair = null,
    flipVisual = 1,
    trail = null,
    cameraX = 0,
    cameraY = 0;
  let xrayMask = null,
    xrayRider = null;
  // What props react to this frame; see drawProp.
  let propScene = { time: 0, riderX: null };
  let frameNow = 0;
  // Birds and bats that have taken off, with when and which way, for the
  // current ride.
  const flights = new Map();
  let flightRide = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const worldScale = clamp(rect.width / 760, 1, 1.45);
    const targetWidth = Math.max(320, rect.width / worldScale);
    const targetHeight = Math.max(340, rect.height / worldScale);
    const deviceWidth = Math.round(rect.width * dpr),
      deviceHeight = Math.round(rect.height * dpr);
    pixelScale = Math.max(
      1,
      Math.min(
        Math.floor(deviceWidth / (targetWidth / ART_PIXEL)),
        Math.floor(deviceHeight / (targetHeight / ART_PIXEL)),
      ),
    );
    canvas.width = deviceWidth;
    canvas.height = deviceHeight;
    W = Math.ceil(deviceWidth / pixelScale) * ART_PIXEL;
    H = Math.ceil(deviceHeight / pixelScale) * ART_PIXEL;
  }

  function reset(nextTrail, facing) {
    trail = nextTrail;
    hair = null;
    flipVisual = facing;
    popups.length = 0;
    lighting.prepare(trail);
  }

  /** Floating pixel text in world space, e.g. "+1 FLIP". */
  function popup(text, x, y, color = "#fff3be") {
    popups.push({ text, x, y, color, life: 1.2, max: 1.2 });
  }

  // `rise` is how far the art reaches above its anchor `y`.
  const inView = (x, margin, y = null, rise = margin) =>
    x >= cameraX - margin &&
    x <= cameraX + W + margin &&
    (y === null || (y + margin >= cameraY && y - rise <= cameraY + H));

  function drawShadowBlob(samples, centerX, width, alpha, thickness) {
    for (const sample of samples) {
      const along = (sample.x - centerX) / width;
      if (Math.abs(along) > 1) continue;
      const envelope = Math.sqrt(Math.max(0, 1 - along * along));
      const height = Math.max(2, thickness * envelope);
      pixelRect(
        sample.x - 1,
        sample.y - height + 1,
        2,
        height,
        "rgba(31,53,39," + alpha * (0.45 + 0.55 * envelope) + ")",
        2,
      );
    }
  }

  const appleDrawY = (apple, now) =>
    apple.y + (reducedMotion ? 0 : Math.sin(now * 0.0025 + apple.x) * 2);

  function drawSceneryShadow(
    x,
    y,
    light,
    { width, alpha, thickness, lift = 0 },
  ) {
    const ground = terrainAt(trail, x, y);
    if (!ground.solid) return;
    const height = Math.max(0, ground.y - y) + lift;
    const offset = sunShadowOffset({
      bikeX: x - cameraX,
      bikeY: y - cameraY,
      sunX: light.x,
      sunY: light.y,
      height,
      strength: light.strength,
    });
    const center = x + offset;
    drawShadowBlob(
      groundShadowSamples(trail, x, y, width, 2, center).flat(),
      center,
      width,
      alpha,
      thickness,
    );
  }

  function drawSceneryShadows(ride, now, full) {
    if (!full) return;
    const light = sunLight({
      width: W,
      cameraX,
      cameraY,
      weather: trail.weather,
      timeOfDay: trail.timeOfDay,
    });
    for (const prop of trail.props || []) {
      const spec = SCENERY_SHADOWS[prop.type];
      if (!spec || !inView(prop.x, 80)) continue;
      const ground = terrainAt(trail, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      drawSceneryShadow(
        prop.x,
        Number.isFinite(prop.y) ? prop.y : ground.y,
        light,
        spec,
      );
    }
    for (const apple of ride.apples) {
      if (apple.taken || !inView(apple.x, 40)) continue;
      drawSceneryShadow(apple.x, appleDrawY(apple, now), light, {
        width: 8,
        alpha: 0.18,
        thickness: 3,
      });
    }
  }

  // Perched birds and roosting bats take off, away from the rider, once the
  // rider comes close. Purely visual: nothing here feeds back into the
  // simulation.
  function startleProps(ride, focus, now) {
    if (flightRide !== ride) {
      flights.clear();
      flightRide = ride;
    }
    for (const prop of trail.props || []) {
      const reach = STARTLE[prop.type];
      if (!reach || flights.has(prop)) continue;
      let y = Number.isFinite(prop.y) ? prop.y : terrainAt(trail, prop.x).y;
      if (prop.type === "bats") y += propWallFit(trail, prop)?.ceiling ?? 0;
      if (Math.abs(focus.x - prop.x) < reach.x && Math.abs(focus.y - y) < reach.y)
        flights.set(prop, { start: now, dir: prop.x >= focus.x ? 1 : -1 });
    }
  }

  // Graffiti, painted onto the rock just after the terrain is drawn.
  function drawWallPaint() {
    for (const prop of trail.props || []) {
      if (!PAINTED_PROPS.has(prop.type) || !inView(prop.x, 70)) continue;
      const y = paintedPropY(trail, prop);
      if (y === null || !inView(prop.x, 70, y + 38, 64)) continue;
      gameArt.drawWallPaint(trail, prop);
    }
  }

  // The glowing parts of props, drawn over the lit scene: the lighting pass
  // casts their light. Street lamps and crane lights only once it is dark
  // around them; lanterns and mushrooms always.
  function drawPropGlows() {
    for (const prop of trail.props || []) {
      const reach = GLOW_REACH[prop.type];
      if (!reach || !inView(prop.x, reach)) continue;
      const ground = terrainAt(trail, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      const y = Number.isFinite(prop.y) ? prop.y : ground.y;
      const head = prop.type === "crane" ? CRANE_LIGHTS[0][1] : prop.type === "lamp" ? LAMP_HEAD.y : -10;
      const dark = lighting.isDark(trail, prop.x, y + head);
      if (!dark && (prop.type === "lamp" || prop.type === "crane")) continue;
      const fit = propWallFit(trail, prop);
      const [rise, hang] = propSpan(prop.type, fit) || [PROP_RISE[prop.type] ?? 90, 0];
      if (!inView(prop.x, reach, y + hang + reach, rise + hang + reach * 2)) continue;
      gameArt.drawPropGlow(
        prop.type,
        prop.x,
        y,
        propGroundOffset(trail, prop),
        prop.flip,
        propScene.time,
        { dark, trail, prop, fit, emissive: true },
      );
    }
  }

  // `area` limits drawing to props that can reach a world-space box
  // { left, top, right, bottom }; returns how many props were drawn.
  function drawProps(layer, full, art = gameArt, area = null) {
    let drawn = 0;
    for (const prop of trail.props || []) {
      const reach = PROP_REACH[prop.type] ?? 70;
      if (
        prop.layer !== layer ||
        PAINTED_PROPS.has(prop.type) ||
        (!full && (prop.type === "tree" || prop.type === "pine")) ||
        !inView(prop.x, reach) ||
        (area && (prop.x < area.left - reach || prop.x > area.right + reach))
      )
        continue;
      const ground = terrainAt(trail, prop.x);
      if (!ground.solid && !Number.isFinite(prop.y)) continue;
      const y = Number.isFinite(prop.y) ? prop.y : ground.y;
      const fit = propWallFit(trail, prop);
      const span = propSpan(prop.type, fit);
      const rise = span ? span[0] : PROP_RISE[prop.type] ?? 90;
      const hang = span ? span[1] : PROP_HANG[prop.type] ?? 0;
      if (!inView(prop.x, reach, y + hang, rise + hang)) continue;
      if (area && (y - rise > area.bottom || y + hang + 70 < area.top)) continue;
      let scene = propScene;
      const flight = flights.get(prop);
      if (flight) {
        const age = (frameNow - flight.start) / 1000;
        // With reduced motion a startled bird or bat is simply gone.
        if (reducedMotion || age > STARTLE[prop.type].flight) continue;
        scene = { ...propScene, flight: { age, dir: flight.dir } };
      }
      art.drawProp(
        prop.type,
        prop.x,
        y,
        1,
        propAlignmentSlope(trail, prop),
        propGroundOffset(trail, prop),
        prop.text,
        fit,
        prop.flip,
        scene,
      );
      drawn++;
    }
    return drawn;
  }

  function xrayCanvas(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return {
      canvas,
      context,
      art: createGameArt(context),
      tools: createDrawingTools(context),
    };
  }

  function fitLayer(layer, width, height) {
    if (layer.canvas.width < width || layer.canvas.height < height) {
      layer.canvas.width = Math.max(layer.canvas.width, width);
      layer.canvas.height = Math.max(layer.canvas.height, height);
    }
    layer.context.setTransform(1, 0, 0, 1, 0, 0);
    layer.context.globalCompositeOperation = "source-over";
    layer.context.clearRect(0, 0, width, height);
  }

  // Redraws the bike and rider into a scratch layer, keeps only the pixels a
  // front prop covers, and lays them over the scene as a flat silhouette.
  function drawXray(ride, rider, state, full) {
    const points = ride.ragdoll
      ? [ride.rear, ride.front, ...ride.ragdoll.list]
      : [ride.rear, ride.front];
    const area = {
      left: Math.min(...points.map((point) => point.x)) - XRAY_REACH,
      right: Math.max(...points.map((point) => point.x)) + XRAY_REACH,
      top: Math.min(...points.map((point) => point.y)) - XRAY_REACH,
      bottom: Math.max(...points.map((point) => point.y)) + XRAY_REACH,
    };
    const transform = ctx.getTransform();
    const x0 = Math.max(0, Math.floor(transform.a * area.left + transform.e));
    const y0 = Math.max(0, Math.floor(transform.d * area.top + transform.f));
    const x1 = Math.min(
      canvas.width,
      Math.ceil(transform.a * area.right + transform.e),
    );
    const y1 = Math.min(
      canvas.height,
      Math.ceil(transform.d * area.bottom + transform.f),
    );
    if (x1 <= x0 || y1 <= y0) return;
    const width = x1 - x0,
      height = y1 - y0;
    xrayMask ??= xrayCanvas(width, height);
    xrayRider ??= xrayCanvas(width, height);
    const place = (layer) => {
      fitLayer(layer, width, height);
      layer.context.setTransform(
        transform.a,
        0,
        0,
        transform.d,
        transform.e - x0,
        transform.f - y0,
      );
      layer.context.imageSmoothingEnabled = false;
    };

    place(xrayMask);
    if (!drawProps("front", full, xrayMask.art, area)) return;

    place(xrayRider);
    if (hair)
      hair.draw(xrayRider.tools.pixelPath, currentHairRoot(ride, false));
    xrayRider.art.drawBike(bikeDrawing(ride, rider, flipVisual, state));
    if (ride.ragdoll) xrayRider.art.drawRagdoll(ride.ragdoll.points, rider);

    const context = xrayRider.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(
      xrayMask.canvas,
      0,
      0,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    context.globalCompositeOperation = "source-in";
    context.fillStyle = XRAY_COLOR;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = XRAY_ALPHA;
    ctx.drawImage(xrayRider.canvas, 0, 0, width, height, x0, y0, width, height);
    ctx.restore();
  }

  function drawSkidMarks(skidMarks) {
    for (const mark of skidMarks) {
      const length = mark.length * mark.direction;
      ctx.globalAlpha = clamp(mark.life / mark.max, 0, 1) * 0.42;
      pixelPath(
        [
          [mark.x - length, mark.y - mark.slope * length],
          [mark.x, mark.y],
        ],
        "#263b36",
        1,
        2,
      );
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
    return {
      rear: ride.rear,
      front: ride.front,
      facing: ride.facing,
      flipVisual: flip,
      leanVisual: ride.leanVisual,
    };
  }

  function currentHairRoot(ride, exact) {
    if (ride.ragdoll) {
      const head = ride.ragdoll.points.head;
      return { x: head.x - ride.facing * 6, y: head.y };
    }
    return hairRoot(riderPose(ride), exact);
  }

  function updateHair(ride, rider, dt) {
    if (rider !== "female") {
      hair = null;
      return;
    }
    const root = currentHairRoot(ride, true);
    const rest = ride.ragdoll
      ? freeHairRestDirection(ride.facing)
      : hairRestDirection(riderPose(ride));
    if (!hair || Math.hypot(root.x - hair.root.x, root.y - hair.root.y) > 60)
      hair = createRiderHair(root, rest);
    hair.update(dt, {
      root,
      rest,
      back: ride.ragdoll ? null : hairBackSupport(riderPose(ride)),
      // The floor under each strand, not the topmost surface: under an
      // overhang the topmost one is above the rider, and clamping to it drew
      // the hair as a pole up to the peak.
      groundAt: (x, y) => terrainAt(trail, x, y - HAIR_GROUND_ALLOWANCE),
    });
  }

  function bikeGeometry(ride) {
    const { rear, front } = ride;
    return {
      mx: (rear.x + front.x) / 2,
      my: (rear.y + front.y) / 2,
      angle: Math.atan2(front.y - rear.y, front.x - rear.x),
      length: Math.hypot(front.x - rear.x, front.y - rear.y),
    };
  }

  function drawBike(ride, rider, flip, state) {
    const geometry = bikeGeometry(ride);
    const { mx, my } = geometry;
    const ground = terrainAt(trail, mx, my);
    if (ground.solid) {
      const light = sunLight({
        width: W,
        cameraX,
        cameraY,
        weather: trail.weather,
        timeOfDay: trail.timeOfDay,
      });
      const heightAboveGround = Math.max(0, ground.y - my - RADIUS);
      const shadowAlpha = clamp(0.22 - heightAboveGround / 700, 0.035, 0.22);
      const shadowWidth = clamp(35 - heightAboveGround * 0.07, 13, 35);
      const offset = sunShadowOffset({
        bikeX: mx - cameraX,
        bikeY: my - cameraY,
        sunX: light.x,
        sunY: light.y,
        height: heightAboveGround,
        strength: light.strength,
      });
      const center = mx + offset;
      const samples = groundShadowSamples(
        trail,
        mx,
        my,
        shadowWidth,
        2,
        center,
      ).flat();
      drawShadowBlob(samples, center, shadowWidth, shadowAlpha, 4);
      drawShadowBlob(
        samples,
        center + Math.sign(offset) * 3,
        shadowWidth * 0.7,
        shadowAlpha * 0.55,
        2,
      );
    }
    gameArt.drawBike(bikeDrawing(ride, rider, flip, state, geometry));
  }

  function bikeDrawing(
    ride,
    rider,
    flip,
    state,
    geometry = bikeGeometry(ride),
  ) {
    return {
      rear: ride.rear,
      front: ride.front,
      ...geometry,
      flipVisual: flip,
      facing: ride.facing,
      brakePressure: ride.brakePressure,
      state,
      leanVisual: ride.leanVisual,
      rider,
    };
  }

  function drawGhost(ghost, rider) {
    if (
      !ghost ||
      !inView(
        (ghost.rear.x + ghost.front.x) / 2,
        80,
        (ghost.rear.y + ghost.front.y) / 2,
      )
    )
      return;
    ctx.globalAlpha = GHOST_ALPHA;
    gameArt.drawBike({
      rear: ghost.rear,
      front: ghost.front,
      ...bikeGeometry(ghost),
      flipVisual: ghost.facing,
      facing: ghost.facing,
      brakePressure: ghost.brakePressure,
      state: ghost.ragdoll ? "ragdoll" : "running",
      leanVisual: ghost.leanVisual,
      rider,
    });
    if (ghost.ragdoll) gameArt.drawRagdoll(ghost.ragdoll.points, rider);
    ctx.globalAlpha = 1;
  }

  function drawPopups(dt) {
    for (const item of popups) {
      item.life -= dt;
      item.y -= dt * 30;
      ctx.globalAlpha = clamp((item.life / item.max) * 2, 0, 1);
      drawPixelText(item.text, item.x, item.y, item.color, {
        pixel: 2,
        align: "center",
      });
    }
    ctx.globalAlpha = 1;
    for (let index = popups.length - 1; index >= 0; index--)
      if (popups[index].life <= 0) popups.splice(index, 1);
  }

  function drawWeather(weather) {
    const rainIntensity = clamp(Number(trail.weather?.rain) || 0, 0, 1);
    if (!rainIntensity && weather.flash <= 0) return;
    ctx.save();
    if (rainIntensity) {
      const count = Math.round(
        (45 + rainIntensity * 95) * clamp(W / 760, 0.7, 1.5),
      );
      const motion = reducedMotion ? 0 : weather.time * 720;
      ctx.fillStyle = `rgba(33, 52, 61, ${0.04 + rainIntensity * 0.08})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(205, 225, 224, ${0.22 + rainIntensity * 0.3})`;
      for (let index = 0; index < count; index++) {
        const seedX = (index * 97.31) % (W + 80);
        const seedY = (index * 53.17) % (H + 100);
        const speed = 0.72 + (index % 7) * 0.055;
        const y = ((seedY + motion * speed) % (H + 70)) - 35;
        const rainWidth = W + 80;
        const rawX = seedX - motion * 0.13 + y * 0.08;
        const x = (((rawX % rainWidth) + rainWidth) % rainWidth) - 40;
        // A slanted streak as two offset one-pixel columns.
        const length = 7 + rainIntensity * 8 + (index % 4);
        const half =
          Math.max(1, Math.round(length / 2 / ART_PIXEL)) * ART_PIXEL;
        const left = Math.round(x / ART_PIXEL) * ART_PIXEL,
          top = Math.round(y / ART_PIXEL) * ART_PIXEL;
        ctx.fillRect(left, top, ART_PIXEL, half);
        ctx.fillRect(left - ART_PIXEL, top + half, ART_PIXEL, half);
      }
    }
    if (weather.flash > 0) {
      // The lighting pass lights the scene up; this adds the glare on top.
      ctx.fillStyle = `rgba(225, 239, 237, ${weather.flash * 0.14})`;
      ctx.fillRect(0, 0, W, H);
      if (weather.flash > 0.3 && !reducedMotion) {
        const proximity = 1 - weather.distance;
        const startX = weather.x * W;
        const bolt = [[startX, 0]];
        for (let step = 1; step <= 6; step++)
          bolt.push([
            startX + Math.sin(weather.x * 91 + step * 7.3) * 16,
            step * H * 0.085,
          ]);
        pixelPath(
          bolt,
          `rgba(246, 244, 204, ${weather.flash})`,
          proximity > 0.5 ? 2 : 1,
        );
      }
    }
    ctx.restore();
  }

  function drawPhysicsOverlay(vehicle) {
    const { chassis } = vehicle;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    for (const constraint of vehicle.dampedConstraints) {
      if (constraint.type !== "distance") continue;
      ctx.strokeStyle =
        constraint.minLength !== null || constraint.maxLength !== null
          ? "#f0b45f"
          : "#83d1ce";
      ctx.beginPath();
      ctx.moveTo(constraint.a.x, constraint.a.y);
      ctx.lineTo(constraint.b.x, constraint.b.y);
      ctx.stroke();
    }
    for (const point of Object.values(chassis)) {
      ctx.fillStyle = "#fff3be";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, TAU);
      ctx.fill();
    }
    for (const point of [vehicle.rear, vehicle.front]) {
      if (!point.contact) continue;
      ctx.strokeStyle = "#e65e56";
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(
        point.x + point.contact.nx * 24,
        point.y + point.contact.ny * 24,
      );
      ctx.stroke();
    }
    const center = vehicleMetrics(vehicle).center;
    ctx.strokeStyle = "#ff8952";
    ctx.beginPath();
    ctx.moveTo(center.x - 5, center.y);
    ctx.lineTo(center.x + 5, center.y);
    ctx.moveTo(center.x, center.y - 5);
    ctx.lineTo(center.x, center.y + 5);
    ctx.stroke();
    ctx.restore();
  }

  // With `darkOnly`, only where it is dark, to redraw over the lighting.
  function drawGoal(ride, darkOnly = false) {
    if (!inView(trail.goal, 65)) return;
    const goalY = finishHeight(trail);
    if (darkOnly && !lighting.isDark(trail, trail.goal, goalY - 40)) return;
    if (inView(trail.goal, 65, goalY, 115))
      gameArt.drawFlag(
        trail.goal,
        goalY,
        ride.collected === ride.apples.length,
        reducedMotion ? 0 : ride.time,
      );
  }

  function drawApples(ride, now, darkOnly = false) {
    for (const apple of ride.apples) {
      if (apple.taken) continue;
      const appleY = appleDrawY(apple, now);
      if (!inView(apple.x, 30, appleY)) continue;
      if (darkOnly && !lighting.isDark(trail, apple.x, appleY)) continue;
      gameArt.drawApple(apple.x, appleY);
    }
  }

  function drawSpikes(ride, darkOnly = false) {
    for (const spike of ride.spikes) {
      if (!inView(spike.x, spike.radius + 10, spike.y)) continue;
      if (darkOnly && !lighting.isDark(trail, spike.x, spike.y)) continue;
      gameArt.drawSpike(
        spike.x,
        spike.y,
        spike.radius,
        reducedMotion ? 0 : ride.spikeTime * spike.spin * TAU,
      );
    }
  }

  /** Where the camera should look: the bike, or the tumbling rider after a crash. */
  function focusOf(ride) {
    return ride.ragdoll
      ? ragdollCenter(ride.ragdoll)
      : vehicleMetrics(ride.vehicle).center;
  }

  /**
   * @param {{
   *   ride: any, ghost: any, camera: any, effects: any, rider: string, state: string,
   *   full: boolean, now: number, dt: number, debug: boolean
   * }} frame
   */
  function draw({
    ride,
    ghost,
    camera,
    effects,
    rider,
    state,
    full,
    now,
    dt,
    debug,
  }) {
    const paused = state === "paused";
    const animationDt = paused ? 0 : dt;
    const focus = focusOf(ride);
    // The ride is already interpolated for this frame, and nothing here feeds
    // back into the simulation, so replays are unaffected.
    propScene = {
      time: reducedMotion ? 0 : now / 1000,
      riderX: focus.x,
    };
    frameNow = now;
    startleProps(ride, focus, now);
    camera.follow(focus, {
      facing: ride.facing,
      loose: Boolean(ride.ragdoll),
      width: W,
      height: H,
      dt,
      fallY: trail.fallY || 620,
      minX: cameraLeftLimit(trail),
    });
    const flipSmoothing = reducedMotion ? 1 : 1 - Math.exp(-18 * dt);
    flipVisual = lerp(flipVisual, ride.facing, flipSmoothing);
    if (Math.abs(flipVisual - ride.facing) < 0.002) flipVisual = ride.facing;
    const worldToDevice = pixelScale / ART_PIXEL;
    const view = camera.view();
    // Whole device pixels, so art on the world's pixel grid never straddles a pixel.
    cameraX = Math.round(view.x * worldToDevice) / worldToDevice;
    cameraY = Math.round(view.y * worldToDevice) / worldToDevice;

    ctx.setTransform(worldToDevice, 0, 0, worldToDevice, 0, 0);
    ctx.imageSmoothingEnabled = false;
    gameArt.drawBackground({
      width: W,
      height: H,
      palette: trail,
      cameraX,
      cameraY,
      full,
      smooth: true,
    });
    ctx.save();
    ctx.translate(-cameraX, -cameraY);
    effects.update(animationDt);
    drawProps("back", full);
    terrainRenderer.draw(ctx, trail, cameraX, cameraY, W, H);
    drawWallPaint();
    drawSkidMarks(effects.skidMarks);
    drawSceneryShadows(ride, now, full);
    drawParticles(effects.particles, true);
    drawGoal(ride);
    drawSpikes(ride);
    drawApples(ride, now);
    drawGhost(ghost, rider);
    updateHair(ride, rider, animationDt);
    if (hair) hair.draw(pixelPath, currentHairRoot(ride, false));
    drawBike(ride, rider, flipVisual, ride.ragdoll ? "ragdoll" : state);
    if (debug) drawPhysicsOverlay(ride.vehicle);
    if (ride.ragdoll) gameArt.drawRagdoll(ride.ragdoll.points, rider);
    drawProps("front", full);
    drawXray(ride, rider, ride.ragdoll ? "ragdoll" : state, full);
    drawParticles(effects.particles, false);
    // Light the scene, then the glowing parts of props on top; where it is
    // dark, the finish, spikes and apples are drawn again so they stay easy
    // to see.
    const lit = lighting.draw(ctx, {
      trail,
      ride,
      cameraX,
      cameraY,
      width: W,
      height: H,
      flash: effects.weather.flash,
      time: propScene.time,
      flip: flipVisual,
    });
    drawPropGlows();
    if (lit) {
      drawGoal(ride, true);
      drawSpikes(ride, true);
      drawApples(ride, now, true);
    }
    drawPopups(animationDt);
    effects.prune();
    ctx.restore();
    drawWeather(effects.weather);
  }

  return {
    resize,
    reset,
    draw,
    popup,
    setHeadlights: lighting.setHeadlights,
    get width() {
      return W;
    },
    get height() {
      return H;
    },
  };
}
