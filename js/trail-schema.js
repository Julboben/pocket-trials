import { terrainMaterials } from "./materials.js";
import { terrainAt, terrainGeometry } from "./terrain.js";
import { hypot } from "./det-math.js";
import {
  signLines,
  SIGN_LINE_CHARACTERS,
  SIGN_MAX_LINES,
  TIMES_OF_DAY,
  DEFAULT_TIME_OF_DAY,
  BACKDROPS,
} from "./drawing.js";
import { RADIUS, WHEELBASE } from "./config.js";
import { FINISH_FLOWER_LIFT, bikeTouchesFlower } from "./finish.js";
import {
  normalizeBlocks as normalizeTerrainBlocks,
  validateBlocks as validateTerrainBlocks,
  regionBounds,
} from "./terrain-geometry.js";
/** Blocks for a brand new trail: one rectangular slab to build on. */
export function createBlankTerrainBlocks(trail = {}) {
  return normalizeTerrainBlocks(
    [
      {
        id: "block-1",
        material: trail.terrain || "grass",
        regions: [
          {
            outer: {
              id: "boundary-1",
              nodes: [
                {
                  id: "n1",
                  x: 0,
                  y: 320,
                  mode: "corner",
                  in: null,
                  out: null,
                  edge: "straight",
                },
                {
                  id: "n2",
                  x: 420,
                  y: 300,
                  mode: "corner",
                  in: null,
                  out: null,
                  edge: "straight",
                },
                {
                  id: "n3",
                  x: 900,
                  y: 336,
                  mode: "corner",
                  in: null,
                  out: null,
                  edge: "straight",
                },
                {
                  id: "n4",
                  x: 1400,
                  y: 300,
                  mode: "corner",
                  in: null,
                  out: null,
                  edge: "straight",
                },
                {
                  id: "n5",
                  x: 1400,
                  y: 580,
                  mode: "corner",
                  in: null,
                  out: null,
                  edge: "straight",
                },
                {
                  id: "n6",
                  x: 0,
                  y: 580,
                  mode: "corner",
                  in: null,
                  out: null,
                  edge: "straight",
                },
              ],
            },
            inner: [],
          },
        ],
      },
    ],
    trail.terrain || "grass",
  );
}

export const cloneTrail = (trail) => JSON.parse(JSON.stringify(trail));

export function createBlankTrail(index = 0) {
  const number = String(index + 1).padStart(2, "0");
  return {
    name: "New Trail",
    label: `NEW TRAIL / ${number}`,
    goal: 1200,
    description: "",
    start: { x: 90, y: null, facing: 1 },
    terrainBlocks: createBlankTerrainBlocks(),
    apples: [
      { x: 260, y: null },
      { x: 470, y: null },
      { x: 710, y: null },
      { x: 930, y: null },
      { x: 1100, y: null },
    ],
    props: [],
    spikes: [],
    weather: { sun: 1, clouds: 0.2 },
    fallY: 620,
  };
}

/** The terrain blocks on a trail, normalized. */
export function trailTerrainBlocks(trail) {
  return normalizeTerrainBlocks(trail?.terrainBlocks, trail?.terrain || "grass") || [];
}

/**
 * Where the finish stands, in world units.
 *
 * A finish is a point, not just an x. `trail.finishY` holds an explicit height
 * once the author has placed it somewhere other than the ground, and null means
 * "stand on whatever surface is here". That is what lets a finish sit on a
 * floating block, or high above a cave, instead of being pinned to the ground.
 *
 * The finish is a flower that floats a little above that anchor; the run ends
 * when the bike touches it, wherever the bike comes from.
 */
export function finishHeight(trail) {
  if (Number.isFinite(trail?.finishY)) return trail.finishY;
  return (
    surfaceBelow(trail, trail?.goal ?? 0, null)?.y ?? (trail?.fallY || 620)
  );
}

/** The centre of the finish flower, which is what the bike has to touch. */
export function finishFlower(trail) {
  return { x: trail.goal, y: finishHeight(trail) - FINISH_FLOWER_LIFT };
}

/**
 * The topmost solid surface at or below `referenceY`. This is the single
 * answer to "where does something at this x rest". It reads the trail's
 * cached geometry, so it is cheap to call per object.
 */
export function surfaceBelow(trail, x, referenceY = null) {
  const surface = terrainAt(trail, x, referenceY);
  return surface?.solid ? surface : null;
}

/** A surface's height at an x, falling back to the trail's kill plane. */
function groundHeight(trail, x) {
  const surface = surfaceBelow(trail, x, null);
  return surface ? surface.y : trail.fallY || 620;
}

export const SPIKE_RADIUS = { min: 8, max: 64, default: 18 };
/**
 * Normalize a spike. `groundY` is the surface height at the spike's x, used
 * when the spike has no y of its own.
 */
export function normalizeSpike(spike, groundY = null) {
  const radius = Math.max(
    SPIKE_RADIUS.min,
    Math.min(SPIKE_RADIUS.max, Number(spike?.radius) || SPIKE_RADIUS.default),
  );
  const x = Number(spike?.x) || 0;
  const explicit = Number.isFinite(Number(spike?.y)) && spike?.y !== null;
  const surface = !explicit && Number.isFinite(groundY) ? groundY : 620;
  const y = explicit ? Number(spike.y) : surface - radius;
  const spin = Number(spike?.spin);
  return { x, y, radius, spin: Number.isFinite(spin) ? spin : 1 };
}

export function normalizeTrail(input, index = 0) {
  const fallback = createBlankTrail(index);
  const trail = { ...fallback, ...cloneTrail(input || {}) };
  trail.name = String(trail.name || fallback.name);
  trail.label = String(
    trail.label ||
      `${trail.name.toUpperCase()} / ${String(index + 1).padStart(2, "0")}`,
  );
  trail.goal = Number(trail.goal) || fallback.goal;
  // The finish is a point. A null finishY means it stands on the surface below,
  // which is what a plain ground finish wants; a number pins it in the air.
  // The null check has to come first: Number(null) is 0, which would silently
  // pin every ground finish to the top of the world.
  trail.finishY =
    trail.finishY === null || trail.finishY === undefined
      ? null
      : Number.isFinite(Number(trail.finishY))
        ? Number(trail.finishY)
        : null;
  trail.fallY = Number(trail.fallY) || fallback.fallY;
  // `terrain` was the trail's base material. Blocks carry their own now, so it
  // only fills in blocks saved without a material, below.
  if (!terrainMaterials[trail.terrain]) delete trail.terrain;
  // The old colour fields: the background comes from timeOfDay and backdrop,
  // and wheel spray from each block's material.
  delete trail.sky;
  delete trail.sun;
  delete trail.mountain;
  delete trail.spray;
  // Terrain comes from the input only: a trail without blocks has no terrain,
  // which validation reports, rather than silently getting the blank slab.
  trail.terrainBlocks =
    normalizeTerrainBlocks(input?.terrainBlocks, trail.terrain) || [];
  // Every block now has a material, so the base is only kept where the trail
  // hash still needs it: when it differs from the first block's material.
  if (trail.terrain === trail.terrainBlocks[0]?.material) delete trail.terrain;
  const start = trail.start || fallback.start;
  trail.start = {
    x: Number(start.x) || 90,
    y:
      start.y === null || start.y === undefined
        ? null
        : Number.isFinite(Number(start.y))
          ? Number(start.y)
          : null,
    facing: Number(start.facing) < 0 ? -1 : 1,
  };
  trail.apples = Array.isArray(trail.apples)
    ? trail.apples.map((apple) => ({
        x: Number(apple.x) || 0,
        y: apple.y === null ? null : Number(apple.y),
      }))
    : [];
  trail.props = Array.isArray(trail.props)
    ? trail.props.map((prop) => ({
        x: Number(prop.x) || 0,
        y:
          prop.y === null || prop.y === undefined
            ? null
            : Number.isFinite(Number(prop.y))
              ? Number(prop.y)
              : null,
        type: String(prop.type || "tree"),
        layer: prop.layer === "front" ? "front" : "back",
        text:
          prop.type === "sign" && typeof prop.text === "string"
            ? prop.text
            : undefined,
        flip: prop.flip === true ? true : undefined,
      }))
    : [];
  trail.spikes = Array.isArray(trail.spikes)
    ? trail.spikes.map((spike) =>
        normalizeSpike(
          spike,
          surfaceBelow(trail, Number(spike?.x) || 0, null)?.y ?? null,
        ),
      )
    : [];
  trail.weather = { ...fallback.weather, ...(trail.weather || {}) };
  // Noon is the default look; an unrecognised value falls back to it too.
  if (!TIMES_OF_DAY.includes(trail.timeOfDay))
    trail.timeOfDay = DEFAULT_TIME_OF_DAY;
  // Hills is the default, so it isn't stored.
  if (!BACKDROPS.includes(trail.backdrop) || trail.backdrop === "hills")
    delete trail.backdrop;
  const medals = normalizeMedals(trail.medals);
  if (medals) trail.medals = medals;
  else delete trail.medals;
  return trail;
}

export const MEDALS = ["gold", "silver", "bronze"];

/** Target times in seconds; invalid or incomplete tables are dropped. */
export function normalizeMedals(medals) {
  if (!medals || typeof medals !== "object") return null;
  const times = MEDALS.map((name) => Number(medals[name]));
  if (!times.every((time) => Number.isFinite(time) && time > 0)) return null;
  return { gold: times[0], silver: times[1], bronze: times[2] };
}

/** @returns {'gold' | 'silver' | 'bronze' | null} */
export function medalFor(medals, time) {
  if (!medals) return null;
  return MEDALS.find((name) => time <= medals[name]) || null;
}

/**
 * Would the bike, standing where it starts, already be touching the finish
 * flower? Then the run would end before the rider could move.
 */
function startTouchesFinish(trail) {
  const { x, y, facing } = trail.start;
  const wheelY = Number.isFinite(y) ? y : terrainAt(trail, x, null).y - RADIUS;
  const rear = { x: x - WHEELBASE / 2, y: wheelY },
    front = { x: x + WHEELBASE / 2, y: wheelY };
  // A rider sits about 43 units above the axles, slightly forward.
  const probes = [
    { x: x + 3 * (facing < 0 ? -1 : 1), y: wheelY - 43, radius: 6 },
    { x, y: wheelY - 30, radius: 5 },
  ];
  return bikeTouchesFlower(finishFlower(trail), { rear, front, probes });
}

export function validateTrail(trail) {
  const messages = [];
  const error = (text) => messages.push({ type: "error", text });
  const warning = (text) => messages.push({ type: "warning", text });
  if (!trail.name.trim()) error("The trail needs a name.");

  // Block geometry is validated first, and against the trail's other blocks so
  // a fully buried block is reported.
  const blocks = trailTerrainBlocks(trail);
  for (const message of validateTerrainBlocks(blocks)) messages.push(message);
  const compiled = blocks.length ? terrainGeometry(trail) : null;
  if (compiled) {
    // A block with no surface left on the union's boundary is entirely inside
    // other terrain, which usually means a surrounding block was moved over it.
    const exposed = new Set(
      compiled.bodies
        .filter((body) => body.liveCount > 0)
        .map((body) => body.blockIndex),
    );
    blocks.forEach((block, index) => {
      if (!exposed.has(index))
        warning(
          `Block ${index + 1} is completely buried inside other terrain, so it has no effect.`,
        );
    });
    const edges = compiled.bodies.reduce(
      (total, body) => total + body.edgeCount,
      0,
    );
    if (edges > 40000)
      warning(
        `The terrain is very detailed (${edges} edges after curves are flattened) and may be slow on older devices.`,
      );
  }

  if (!blocks.length) error("A trail needs terrain: add at least one block.");
  // The finish may sit on either side of the start, so it is checked against
  // both ends of the terrain rather than against a position to the right.
  const firstX = blocks.length
    ? Math.min(
        ...blocks.flatMap((block) =>
          block.regions.map((region) => regionBounds(region).left),
        ),
      )
    : Infinity;
  const finalX = blocks.length
    ? Math.max(
        ...blocks.flatMap((block) =>
          block.regions.map((region) => regionBounds(region).right),
        ),
      )
    : -Infinity;
  // A finish off the end of the terrain is already reported by the range check
  // below, so the "no terrain under it" check must not repeat the same problem.
  let finishOffTerrain = false;
  if (Number.isFinite(firstX) && trail.goal <= firstX) {
    finishOffTerrain = true;
    error(
      `The finish at x ${Math.round(trail.goal)} is before the start of the terrain (x ${Math.round(firstX)}). Move it onto the trail, or extend the blocks.`,
    );
  } else if (Number.isFinite(finalX) && trail.goal >= finalX) {
    finishOffTerrain = true;
    error(
      `The finish at x ${Math.round(trail.goal)} is past the end of the terrain (x ${Math.round(finalX)}). Move it onto the trail, or extend the blocks.`,
    );
  }
  if (Number.isFinite(trail.start?.x) && startTouchesFinish(trail)) {
    error(
      "The finish flower touches the bike at the start, so the trail would end at once. Move the finish away from the start.",
    );
  }
  if (!Number.isFinite(trail.start?.x))
    error("The trail needs a valid start position.");
  for (const [index, prop] of (trail.props || []).entries()) {
    if (
      ![
        "tree",
        "pine",
        "bush",
        "fence",
        "rock",
        "boulder",
        "flowers",
        "stump",
        "cactus",
        "crystal",
        "sign",
        "vines",
        "roots",
        "moss",
        "sapling",
        "pine-small",
        "cactus-small",
        "pebbles",
        "crates",
        "ladder",
        "wheelbarrow",
        "scarecrow",
        "beehive",
        "tyre",
        "cone",
        "barrier",
        "dumpster",
        "lamp",
        "bird",
        "graffiti",
        "crane",
        "scaffolding",
        "hanging-roots",
        "stalactites",
        "mushrooms",
        "minecart",
        "beams",
        "drip",
        "lantern",
        "bats",
      ].includes(prop.type)
    )
      warning(`Prop ${index + 1} has an unknown type “${prop.type}”.`);
    if (prop.type === "sign") {
      if (typeof prop.text !== "string")
        warning(
          `Sign ${index + 1} needs its text as a string; use “” for a blank sign.`,
        );
      else if (
        signLines(prop.text).join("").replace(/\s/g, "").length <
        prop.text.replace(/\s/g, "").length
      )
        warning(
          `Sign ${index + 1} text doesn't fit in ${SIGN_MAX_LINES} lines of ${SIGN_LINE_CHARACTERS} characters and will be cut off.`,
        );
      else if (/[^A-Z0-9 →\/.!+:\-×#']/.test(prop.text.toUpperCase()))
        warning(
          `Sign ${index + 1} text contains characters the pixel font cannot draw.`,
        );
    }
  }
  for (const [index, spike] of (trail.spikes || []).entries()) {
    if (!Number.isFinite(spike.x) || !Number.isFinite(spike.y))
      error(`Spike ${index + 1} must have finite coordinates.`);
    if (!(spike.radius >= SPIKE_RADIUS.min && spike.radius <= SPIKE_RADIUS.max))
      error(
        `Spike ${index + 1} radius must be between ${SPIKE_RADIUS.min} and ${SPIKE_RADIUS.max}.`,
      );
    const startY = Number.isFinite(trail.start?.y)
      ? trail.start.y
      : groundHeight(trail, trail.start.x) - 12;
    if (hypot(spike.x - trail.start.x, spike.y - startY) < spike.radius + 70)
      warning(`Spike ${index + 1} is very close to the start position.`);
    for (const apple of trail.apples || []) {
      const appleY = Number.isFinite(apple.y)
        ? apple.y
        : groundHeight(trail, apple.x) - 60;
      if (hypot(spike.x - apple.x, spike.y - appleY) < spike.radius + 10)
        warning(
          `Spike ${index + 1} overlaps the apple at x ${Math.round(apple.x)}.`,
        );
    }
  }
  if (trail.medals !== undefined) {
    const times = MEDALS.map((name) => Number(trail.medals?.[name]));
    if (!times.every((time) => Number.isFinite(time) && time > 0))
      error(
        "Medal times need positive gold, silver and bronze values in seconds.",
      );
    else if (!(times[0] <= times[1] && times[1] <= times[2]))
      error("Medal times must get slower from gold to silver to bronze.");
  }
  for (const key of ["sun", "clouds", "rain", "lightning"]) {
    const value = trail.weather?.[key];
    if (
      value !== undefined &&
      (!Number.isFinite(Number(value)) || value < 0 || value > 1)
    )
      error(`Weather.${key} must be between 0 and 1.`);
  }
  // An object resting on "whatever is here" can be left over open air by an
  // edit. Checked last, so a broken finish or terrain, which
  // usually causes it, is the first thing reported.
  if (compiled) {
    const noGround = (x) => !terrainAt(trail, x, null).solid;
    if (trail.start?.y === null && noGround(trail.start.x))
      error(
        "The ground-anchored start has no terrain under it. Drag the start onto a block.",
      );
    for (const apple of trail.apples || []) {
      if (apple.y === null && noGround(apple.x))
        error(
          `Ground-anchored apple at x ${Math.round(apple.x)} has no terrain under it.`,
        );
    }
    if (
      !finishOffTerrain &&
      !Number.isFinite(trail.finishY) &&
      noGround(trail.goal)
    )
      error(
        "The ground-anchored finish has no terrain under it. Drag it onto a block, or lift it into the air.",
      );
  }
  if (!messages.length)
    messages.push({ type: "ok", text: "Trail data is valid." });
  return messages;
}

export function trailToModule(trail) {
  return `export default ${JSON.stringify(trail, null, 2)};\n`;
}
