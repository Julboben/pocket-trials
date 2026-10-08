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
  fogAmount,
  fogColor,
  PAINTED_PROPS,
  paintedPropY,
  propAlignmentSlope,
  propGroundOffset,
  propSpan,
  propWallFit,
  sunLight,
  sunShadowOffset,
  waterPropAt,
} from "./drawing.js";
import { terrainAt, groundShadowSamples, terrainGeometry } from "./terrain.js";
import { finishHeight } from "./trail-schema.js";
import { waterBodies, waterColumns, surfaceWave } from "./water.js";
import { createTerrainRenderer } from "./terrain-render.js";
import { vehicleMetrics } from "./vehicle-physics.js";
import { ragdollCenter } from "./ragdoll.js";
import { appleBob } from "./apple.js";
import { spikeAngle } from "./spike.js";
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
import { WATER_PROPS, FISH_DART, FISH_RANGE } from "./water-props.js";
import { SQUIRREL_HIDE_MAX, SQUIRREL_RANGE } from "./forest-props.js";
import { crackLines, glassPane } from "./glass.js";

const GLASS_CRACK_COLOR = "#f6fffde6";

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
// World units around the hair root that the ghost's hair can reach.
const GHOST_HAIR_REACH = 40;
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
const PROP_REACH = {
  crane: 180,
  minecart: 150,
  bats: 220,
  fish: FISH_RANGE + 120,
  squirrel: SQUIRREL_RANGE + 40,
};
// Perched birds and ducks take off, roosting bats scatter, fish dart off and
// squirrels run for a tree when the rider comes within `x` and `y` of them;
// they are gone `flight` seconds later (a squirrel as soon as it has hidden).
const STARTLE = {
  bird: { x: 110, y: 140, flight: 2.5 },
  bats: { x: 160, y: 200, flight: 2.2 },
  duck: { x: 130, y: 140, flight: 2.5 },
  fish: { x: 90, y: 70, flight: FISH_DART },
  squirrel: { x: 140, y: 120, flight: SQUIRREL_HIDE_MAX },
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
  const backWallRenderer = createTerrainRenderer({ backWalls: true });
  const lighting = createLighting();
  const popups = [];
  let W = 380,
    H = 410,
    pixelScale = 1;
  /** The player's tyre dirt from the effects; the ghost's wheels stay clean. */
  let wheelDirt = null;
  let hair = null,
    ghostHair = null,
    flipVisual = 1,
    trail = null,
    cameraX = 0,
    cameraY = 0;
  let xrayMask = null,
    xrayRider = null,
    ghostHairLayer = null;
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

  /**
   * A fixed view of `width` × `height` world units with `scale` device pixels
   * per art pixel, for canvases that are not laid out on the page.
   */
  function setViewport(width, height, scale) {
    pixelScale = Math.max(1, Math.round(scale));
    W = Math.ceil(width / ART_PIXEL) * ART_PIXEL;
    H = Math.ceil(height / ART_PIXEL) * ART_PIXEL;
    canvas.width = (W / ART_PIXEL) * pixelScale;
    canvas.height = (H / ART_PIXEL) * pixelScale;
  }

  function reset(nextTrail, facing) {
    trail = nextTrail;
    hair = null;
    ghostHair = null;
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

  // The bob follows the ride clock, as the pickup does, so a touch is taken
  // exactly where the apple is drawn. It is gameplay, so it stays with
  // reduced motion.
  const appleDrawY = (apple, ride) => apple.y + appleBob(apple, ride.time);

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
      drawSceneryShadow(apple.x, appleDrawY(apple, ride), light, {
        width: 8,
        alpha: 0.18,
        thickness: 3,
      });
    }
  }

  // Perched birds, ducks, roosting bats, fish and squirrels take off, away
  // from the rider (a squirrel to its tree), once the rider comes close.
  // Purely visual: nothing here feeds back into the simulation.
  function startleProps(ride, focus, now) {
    if (flightRide !== ride) {
      flights.clear();
      flightRide = ride;
    }
    for (const prop of trail.props || []) {
      const reach = STARTLE[prop.type];
      if (!reach || flights.has(prop)) continue;
      let x = prop.x,
        y = Number.isFinite(prop.y) ? prop.y : terrainAt(trail, prop.x).y,
        from;
      if (prop.type === "bats") y += propWallFit(trail, prop)?.ceiling ?? 0;
      if (WATER_PROPS.has(prop.type)) {
        // A fish darts off from wherever it has swum to.
        ({ x, y, swim: from } = waterPropAt(trail, prop, propScene.time));
      }
      if (Math.abs(focus.x - x) < reach.x && Math.abs(focus.y - y) < reach.y)
        flights.set(prop, { start: now, dir: x >= focus.x ? 1 : -1, from });
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
  // { left, top, right, bottom }, and `wet` to water props (true) or the
  // others (false); returns how many props were drawn. Squirrels come last, so
  // one climbs up the front of its tree's trunk.
  function drawProps(layer, full, art = gameArt, area = null, wet = null) {
    let drawn = 0;
    const props = trail.props || [];
    for (const squirrels of [false, true])
    for (const prop of props) {
      if ((prop.type === "squirrel") !== squirrels) continue;
      const reach = PROP_REACH[prop.type] ?? 70;
      if (
        prop.layer !== layer ||
        (wet !== null && wet !== WATER_PROPS.has(prop.type)) ||
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
        // With reduced motion a startled animal is simply gone.
        if (reducedMotion || age > STARTLE[prop.type].flight) continue;
        scene = { ...propScene, flight: { age, dir: flight.dir, from: flight.from } };
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

  // Cracks belong to the ride, not the cached terrain, so they are drawn over it.
  function drawGlassCracks(rideTrail) {
    const cracks = rideTrail.glassCracks;
    if (!cracks?.length) return;
    for (const crack of cracks) {
      if (rideTrail.brokenBlocks.has(crack.blockId) || !inView(crack.x, 50, crack.y, 50)) continue;
      const pane = glassPane(rideTrail, crack.blockId);
      if (!pane) continue;
      for (const line of crackLines(crack, pane)) pixelPath(line, GLASS_CRACK_COLOR, 1, 2);
    }
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

  function currentHairRoot(ride, exact, flip = flipVisual) {
    if (ride.ragdoll) {
      const head = ride.ragdoll.points.head;
      return { x: head.x - ride.facing * 6, y: head.y };
    }
    return hairRoot(riderPose(ride, flip), exact);
  }

  function hairState(ride, flip) {
    const pose = riderPose(ride, flip);
    return {
      root: currentHairRoot(ride, true, flip),
      rest: ride.ragdoll
        ? freeHairRestDirection(ride.facing)
        : hairRestDirection(pose),
      back: ride.ragdoll ? null : hairBackSupport(pose),
      // The floor under each strand, not the topmost surface: under an
      // overhang the topmost one is above the rider, and clamping to it drew
      // the hair as a pole up to the peak.
      groundAt: (x, y) => terrainAt(trail, x, y - HAIR_GROUND_ALLOWANCE),
    };
  }

  /** Steps a hair simulation for `ride`; returns it, or null for riders without hair. */
  function updateHair(current, ride, rider, dt, flip = flipVisual) {
    if (rider !== "female") return null;
    const state = hairState(ride, flip);
    let next = current;
    if (
      !next ||
      Math.hypot(state.root.x - next.root.x, state.root.y - next.root.y) > 60
    )
      next = createRiderHair(state.root, state.rest);
    next.update(dt, state);
    return next;
  }

  /** Lets the rider's hair come to rest around a ride held still, for posed scenes. */
  function settleHair(ride, rider, seconds = 1.5) {
    flipVisual = ride.facing;
    hair = updateHair(null, ride, rider, 0);
    hair?.settle(seconds, hairState(ride, flipVisual));
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
    const ground = terrainAt(ride.trail, mx, my);
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
        ride.trail,
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
      dirt: wheelDirt,
    };
  }

  // The hair is many overlapping strokes, so drawing them straight at ghost
  // alpha stacks them up nearly opaque. Draw it solid off screen, then blend
  // the result once.
  function drawGhostHair(root) {
    const transform = ctx.getTransform();
    const x0 = Math.max(0, Math.floor(transform.a * (root.x - GHOST_HAIR_REACH) + transform.e));
    const y0 = Math.max(0, Math.floor(transform.d * (root.y - GHOST_HAIR_REACH) + transform.f));
    const x1 = Math.min(canvas.width, Math.ceil(transform.a * (root.x + GHOST_HAIR_REACH) + transform.e));
    const y1 = Math.min(canvas.height, Math.ceil(transform.d * (root.y + GHOST_HAIR_REACH) + transform.f));
    if (x1 <= x0 || y1 <= y0) return;
    const width = x1 - x0,
      height = y1 - y0;
    ghostHairLayer ??= xrayCanvas(width, height);
    fitLayer(ghostHairLayer, width, height);
    ghostHairLayer.context.setTransform(transform.a, 0, 0, transform.d, transform.e - x0, transform.f - y0);
    ghostHairLayer.context.imageSmoothingEnabled = false;
    ghostHair.draw(ghostHairLayer.tools.pixelPath, root);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.drawImage(ghostHairLayer.canvas, 0, 0, width, height, x0, y0, width, height);
    ctx.restore();
  }

  function drawGhost(ghost, rider, dt) {
    if (!ghost) {
      ghostHair = null;
      return;
    }
    // Simulated off screen too, so the hair has settled when the ghost
    // reappears; frozen with the ghost once it has finished.
    ghostHair = updateHair(ghostHair, ghost, rider, ghost.status === "won" ? 0 : dt, ghost.facing);
    if (
      !inView(
        (ghost.rear.x + ghost.front.x) / 2,
        80,
        (ghost.rear.y + ghost.front.y) / 2,
      )
    )
      return;
    if (ghostHair) drawGhostHair(currentHairRoot(ghost, false, ghost.facing));
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

  /**
   * Fog over the level, drawn before the riders: a sheet over the backdrop,
   * terrain, and pickups that thickens with `fog`, so at full fog the trail
   * is hard to make out. It thins softly towards the rider, so a little more
   * can be seen close by. `fogHaze` then lays a lighter veil over everything,
   * the rider included.
   */
  function drawFog(fog, focus, facing) {
    const thickness = fog ** 1.3;
    const outer = 0.97 * fog ** 1.6;
    const inner = 0.3 * thickness;
    // At full fog the view closes in to about 5 m (WHEELBASE is ~1.45 m).
    const near = 40 + (1 - fog) * 260;
    const far = 170 + (1 - fog) ** 1.5 * 500;
    const x = focus.x + facing * 25 * fog;
    const color = fogColor(trail);
    const gradient = ctx.createRadialGradient(x, focus.y, near, x, focus.y, far);
    for (let step = 0; step <= 4; step++) {
      const t = step / 4;
      const eased = t * t * (3 - 2 * t);
      gradient.addColorStop(t, withAlpha(color, inner + (outer - inner) * eased));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(cameraX, cameraY, W, H);
  }

  function withAlpha(hex, alpha) {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function fogHaze(fog) {
    ctx.globalAlpha = 0.3 * fog;
    ctx.fillStyle = fogColor(trail);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // How far a drop falls past the ground while its splash shows.
  const RAIN_SPLASH = ART_PIXEL * 10;

  // A stable pseudo-random value in [0, 1) for each drop and attribute.
  function rainHash(index, salt) {
    const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  /**
   * Rain streaks. The slider sets how many drops fall, not how faint they
   * are, so a little rain is just a few drops. Each drop has its own depth:
   * nearer drops are longer, brighter, faster, and shift more as the camera
   * moves, so the drops never line up into rows. A drop lands somewhere new
   * each time it falls past the bottom.
   */
  // The first terrain or water surface per world column, for rain to land on.
  const rainGround = new WeakMap();
  const RAIN_COLUMN = ART_PIXEL * 2;

  function rainGroundAt(x) {
    let cache = rainGround.get(trail);
    if (!cache)
      rainGround.set(trail, (cache = { columns: new Map(), water: waterBodies(trail) }));
    const column = Math.round(x / RAIN_COLUMN);
    let hit = cache.columns.get(column);
    if (hit === undefined) {
      const at = column * RAIN_COLUMN;
      const ground = terrainAt(trail, at);
      hit = { y: ground.solid ? ground.y : Infinity, water: false };
      for (const body of cache.water)
        if (at >= body.x && at <= body.x + body.width && body.y < hit.y)
          hit = { y: body.y, water: true };
      cache.columns.set(column, hit);
    }
    return hit;
  }

  function drawRain(intensity, time) {
    const scale = clamp((W * H) / (760 * 430), 0.6, 2.2);
    // Above about 0.6 the rain builds to a downpour: more, longer, faster
    // drops, driven at a steeper slant, under a darker sky.
    const storm = Math.max(0, (intensity - 0.6) / 0.4) ** 1.5;
    const count = Math.max(1, Math.round(scale * (160 * intensity ** 1.15 + 240 * storm)));
    const slant = 0.12 + storm * 0.16;
    const segments = storm > 0.4 ? 3 : 2;
    const motion = reducedMotion ? 0 : time * 720;
    const spanX = W + 80,
      spanY = H + 70;
    ctx.fillStyle = `rgba(33, 52, 61, ${intensity * 0.12 + storm * 0.1})`;
    ctx.fillRect(0, 0, W, H);
    for (let index = 0; index < count; index++) {
      const depth = 0.45 + rainHash(index, 1) * 0.75;
      const fall =
        rainHash(index, 2) * spanY +
        motion * (0.6 + rainHash(index, 3) * 0.25 + storm * 0.45) * depth -
        cameraY * depth;
      const cycle = Math.floor(fall / spanY);
      const y = fall - cycle * spanY - 35;
      const rawX =
        (rainHash(index, 4) + rainHash(index + cycle * 7919, 5)) * spanX -
        fall * slant -
        cameraX * depth;
      const x = (((rawX % spanX) + spanX) % spanX) - 40;
      ctx.fillStyle = `rgba(205, 225, 224, ${0.25 + depth * 0.3 + storm * 0.1})`;
      // A slanted streak as offset one-pixel columns.
      const length = (8 + intensity * 6 + storm * 14) * depth + rainHash(index, 6) * 4;
      const part = Math.max(1, Math.round(length / segments / ART_PIXEL)) * ART_PIXEL;
      const left = Math.round(x / ART_PIXEL) * ART_PIXEL,
        top = Math.round(y / ART_PIXEL) * ART_PIXEL;
      // Rain stops at the first terrain or water it reaches, with a splash.
      const worldX = left - ART_PIXEL / 2 + cameraX;
      const hit = rainGroundAt(worldX);
      const surface = hit.water ? hit.y + surfaceWave(worldX, propScene.time) : hit.y;
      const ground = Math.round((surface - cameraY) / ART_PIXEL) * ART_PIXEL;
      const age = top + part * segments - ground;
      if (age >= 0 && age < RAIN_SPLASH) {
        const phase = Math.floor((age / RAIN_SPLASH) * 2);
        const spread = ART_PIXEL * (1 + phase);
        if (hit.water) {
          // A plop that leaves a ripple spreading along the surface.
          if (!phase) ctx.fillRect(left - ART_PIXEL, ground - ART_PIXEL * 2, ART_PIXEL, ART_PIXEL);
          ctx.fillRect(left - spread - ART_PIXEL, ground - ART_PIXEL, ART_PIXEL * 2, ART_PIXEL);
          ctx.fillRect(left + spread - ART_PIXEL * 2, ground - ART_PIXEL, ART_PIXEL * 2, ART_PIXEL);
        } else {
          const lift = phase ? ART_PIXEL : ART_PIXEL * 2;
          ctx.fillRect(left - spread - ART_PIXEL, ground - lift, ART_PIXEL, ART_PIXEL);
          ctx.fillRect(left + spread - ART_PIXEL, ground - lift, ART_PIXEL, ART_PIXEL);
        }
      }
      if (top >= ground) continue;
      for (let segment = 0; segment < segments; segment++) {
        const from = top + segment * part;
        const size = Math.min(part, ground - from);
        if (size <= 0) break;
        ctx.fillRect(left - segment * ART_PIXEL, from, ART_PIXEL, size);
      }
    }
  }

  // How far a flake would have fallen past the ground while it rests there.
  const SNOW_SETTLE = ART_PIXEL * 14;

  /**
   * Snowflakes. Like rain, the slider sets how many fall, and from about 0.6
   * it builds to a blizzard: more, larger flakes driven sideways by the wind
   * under a white haze. Each flake sways as it falls, with nearer flakes
   * bigger, brighter, and faster. A flake rests briefly where it lands on
   * terrain and melts straight into water.
   */
  function drawSnow(intensity, time) {
    const scale = clamp((W * H) / (760 * 430), 0.6, 2.2);
    const storm = Math.max(0, (intensity - 0.6) / 0.4) ** 1.5;
    const count = Math.max(1, Math.round(scale * (150 * intensity ** 1.15 + 520 * storm)));
    const seconds = reducedMotion ? 0 : time;
    const wind = 0.12 + storm * 0.9;
    const spanX = W + 120,
      spanY = H + 40;
    if (storm) {
      ctx.fillStyle = `rgba(232, 238, 242, ${storm * 0.24})`;
      ctx.fillRect(0, 0, W, H);
    }
    for (let index = 0; index < count; index++) {
      const depth = 0.4 + rainHash(index, 11) * 0.8;
      const fall =
        rainHash(index, 12) * spanY +
        seconds * 55 * (0.7 + rainHash(index, 13) * 0.6) * depth * (1 + storm * 1.8) -
        cameraY * depth;
      const cycle = Math.floor(fall / spanY);
      const y = fall - cycle * spanY - 20;
      const sway =
        Math.sin(seconds * (0.9 + rainHash(index, 14)) + rainHash(index, 15) * 6.3) *
        10 *
        depth;
      const rawX =
        (rainHash(index, 16) + rainHash(index + cycle * 7919, 17)) * spanX -
        fall * wind +
        sway -
        cameraX * depth;
      const x = (((rawX % spanX) + spanX) % spanX) - 60;
      const size = (depth > 0.9 - storm * 0.35 ? 2 : 1) * ART_PIXEL;
      const left = Math.round(x / ART_PIXEL) * ART_PIXEL,
        top = Math.round(y / ART_PIXEL) * ART_PIXEL;
      const worldX = left + size / 2 + cameraX;
      const hit = rainGroundAt(worldX);
      const ground = Math.round((hit.y - cameraY) / ART_PIXEL) * ART_PIXEL;
      ctx.fillStyle = `rgba(246, 249, 250, ${0.45 + depth * 0.4})`;
      if (top + size > ground) {
        if (hit.water || top + size - ground > SNOW_SETTLE) continue;
        // Resting on the ground until it melts away.
        ctx.globalAlpha = 1 - (top + size - ground) / SNOW_SETTLE;
        ctx.fillRect(left, ground - ART_PIXEL, size, ART_PIXEL);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillRect(left, top, size, size);
    }
  }

  function drawWeather(weather) {
    const rainIntensity = clamp(Number(trail.weather?.rain) || 0, 0, 1);
    const snow = clamp(Number(trail.weather?.snow) || 0, 0, 1);
    const fog = fogAmount(trail.weather);
    if (!rainIntensity && !snow && !fog && weather.flash <= 0) return;
    ctx.save();
    if (fog) fogHaze(fog);
    if (rainIntensity) drawRain(rainIntensity, weather.time);
    if (snow) drawSnow(snow, weather.time);
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

  function drawGoal(ride) {
    if (!inView(trail.goal, 65)) return;
    const goalY = finishHeight(trail);
    if (inView(trail.goal, 65, goalY, 115))
      gameArt.drawFlag(
        trail.goal,
        goalY,
        ride.collected === ride.apples.length,
        reducedMotion ? 0 : ride.time,
      );
  }

  function drawApples(ride, now) {
    for (const apple of ride.apples) {
      if (apple.taken) continue;
      const appleY = appleDrawY(apple, ride);
      if (!inView(apple.x, 30, appleY)) continue;
      gameArt.drawApple(apple.x, appleY);
    }
  }

  function drawSpikes(ride) {
    for (const spike of ride.spikes) {
      if (!inView(spike.x, spike.radius + 10, spike.y)) continue;
      gameArt.drawSpike(
        spike.x,
        spike.y,
        spike.radius,
        // The spin is gameplay: the star kills where it is drawn.
        spikeAngle(spike, ride.spikeTime),
      );
    }
  }

  // Drawn over the bike and rider, so whatever is in the water looks wet;
  // terrain inside a body is left dry.
  function drawWater(ride) {
    if (!ride.water?.length) return;
    const compiled = terrainGeometry(trail);
    for (const body of ride.water) {
      if (
        body.x > cameraX + W ||
        body.x + body.width < cameraX ||
        body.y > cameraY + H ||
        body.y + body.depth < cameraY - 4
      )
        continue;
      gameArt.drawWater(body, waterColumns(compiled, body, ART_PIXEL), propScene.time);
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
    wheelDirt = effects.wheelDirt;
    backWallRenderer.draw(ctx, trail, cameraX, cameraY, W, H);
    drawProps("back", full);
    terrainRenderer.draw(ctx, ride.trail, cameraX, cameraY, W, H);
    drawGlassCracks(ride.trail);
    drawWallPaint();
    drawSkidMarks(effects.skidMarks);
    drawSceneryShadows(ride, now, full);
    drawParticles(effects.particles, true);
    drawGoal(ride);
    drawSpikes(ride);
    drawApples(ride, now);
    const fog = fogAmount(trail.weather);
    if (fog) drawFog(fog, focus, ride.facing);
    drawGhost(ghost, rider, animationDt);
    hair = updateHair(hair, ride, rider, ride.status === "won" ? 0 : animationDt);
    if (hair) hair.draw(pixelPath, currentHairRoot(ride, false));
    drawBike(ride, rider, flipVisual, ride.ragdoll ? "ragdoll" : state);
    if (debug) drawPhysicsOverlay(ride.vehicle);
    if (ride.ragdoll) gameArt.drawRagdoll(ride.ragdoll.points, rider);
    // Water props in front are drawn before the water, so what is under the
    // surface looks wet.
    drawProps("front", full, gameArt, null, true);
    drawWater(ride);
    drawProps("front", full, gameArt, null, false);
    drawXray(ride, rider, ride.ragdoll ? "ragdoll" : state, full);
    drawParticles(effects.particles, false);
    // Light the scene, then the glowing parts of props on top.
    lighting.draw(ctx, {
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
    drawPopups(animationDt);
    effects.prune();
    ctx.restore();
    drawWeather(effects.weather);
  }

  return {
    resize,
    setViewport,
    settleHair,
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
