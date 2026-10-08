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
import { WATER_SIZE, normalizeWater, waterAt, waterBodies, waterColumns } from "./water.js";
import { WATER_PROPS, SURFACE_PROPS, waterPropBody } from "./water-props.js";
import { FINISH_FLOWER_LIFT, bikeTouchesFlower } from "./finish.js";
import {
  normalizeBlocks as normalizeTerrainBlocks,
  validateBlocks as validateTerrainBlocks,
  regionBounds,
} from "./terrain-geometry.js";
/** Blocks for a brand new trail: one rectangular slab to build on. */
export function createBlankTerrainBlocks(material = "grass") {
  return normalizeTerrainBlocks(
    [
      {
        id: "block-1",
        material,
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
    water: [],
    weather: { sun: 1, clouds: 0.2 },
    fallY: 620,
  };
}

/** The terrain blocks on a trail, normalized. */
export function trailTerrainBlocks(trail) {
  return allTrailBlocks(trail).filter((block) => !isBackWall(block));
}

/** Is this block a back wall, scenery behind the terrain, rather than solid? */
export const isBackWall = (block) => block?.layer === "back";

/** The back walls on a trail, normalized: the blocks on the `back` layer. */
export function trailBackWalls(trail) {
  return allTrailBlocks(trail).filter(isBackWall);
}

function allTrailBlocks(trail) {
  return normalizeTerrainBlocks(trail?.terrainBlocks) || [];
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

export const AUTHOR_MAX_LENGTH = 40;

/** Who made the trail: one line of text, whitespace collapsed, or "". */
export function normalizeAuthor(author) {
  return typeof author === "string"
    ? author.replace(/\s+/g, " ").trim().slice(0, AUTHOR_MAX_LENGTH)
    : "";
}

export function normalizeTrail(input, index = 0) {
  const fallback = createBlankTrail(index);
  const trail = { ...fallback, ...cloneTrail(input || {}) };
  trail.name = String(trail.name || fallback.name);
  trail.label = String(
    trail.label ||
      `${trail.name.toUpperCase()} / ${String(index + 1).padStart(2, "0")}`,
  );
  // Credits are optional; an empty author is not stored.
  const author = normalizeAuthor(trail.author);
  if (author) trail.author = author;
  else delete trail.author;
  trail.description =
    typeof trail.description === "string" ? trail.description : "";
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
  // Terrain comes from the input only: a trail without blocks has no terrain,
  // which validation reports, rather than silently getting the blank slab.
  trail.terrainBlocks =
    normalizeTerrainBlocks(input?.terrainBlocks) || [];
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
  trail.water = Array.isArray(trail.water) ? trail.water.map(normalizeWater) : [];
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
  const unlock = normalizeUnlock(trail.unlock);
  if (unlock) trail.unlock = unlock;
  else delete trail.unlock;
  return trail;
}

export const UNLOCK_RULES = ["trails", "golds"];

/**
 * What a bonus trail asks of the career before it opens: `trails` official
 * trails finished and `golds` gold medals won on them. Zero or invalid counts
 * are dropped, and no rule left means the trail is always open.
 */
export function normalizeUnlock(unlock) {
  if (!unlock || typeof unlock !== "object") return null;
  const rules = Object.fromEntries(
    UNLOCK_RULES.map((rule) => [rule, Math.floor(Number(unlock[rule]))]).filter(
      ([, count]) => Number.isFinite(count) && count > 0,
    ),
  );
  return Object.keys(rules).length ? rules : null;
}

/**
 * Checks an unlock rule against a career's progress. `progress` is null
 * without a savegame, which keeps every rule-locked trail shut.
 * @param {{ trails?: number, golds?: number } | null | undefined} unlock
 * @param {{ trails: number, golds: number } | null} progress
 * @returns {{ open: boolean, hint: string }}
 */
export function unlockStatus(unlock, progress) {
  const rules = normalizeUnlock(unlock);
  if (!rules) return { open: true, hint: "" };
  const parts = [];
  if (rules.trails)
    parts.push(`FINISH ${rules.trails} TRAIL${rules.trails === 1 ? "" : "S"}`);
  if (rules.golds)
    parts.push(`WIN ${rules.golds} GOLD MEDAL${rules.golds === 1 ? "" : "S"}`);
  const open = Boolean(
    progress &&
      (progress.trails >= (rules.trails || 0)) &&
      (progress.golds >= (rules.golds || 0)),
  );
  return { open, hint: parts.join(" & ") + " TO UNLOCK" };
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

  // Block geometry is validated first, back walls included so blocks are
  // numbered as in the editor, and against the trail's other blocks so a fully
  // buried block is reported.
  const allBlocks = allTrailBlocks(trail);
  for (const message of validateTerrainBlocks(allBlocks)) messages.push(message);
  const blocks = allBlocks.filter((block) => !isBackWall(block));
  const number = allBlocks
    .map((block, index) => (isBackWall(block) ? -1 : index + 1))
    .filter((value) => value > 0);
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
          `Block ${number[index]} is completely buried inside other terrain, so it has no effect.`,
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
        ...blocks.map((block) => regionBounds(block).left),
      )
    : Infinity;
  const finalX = blocks.length
    ? Math.max(
        ...blocks.map((block) => regionBounds(block).right),
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
        "apple",
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
        "squirrel",
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
        ...WATER_PROPS,
      ].includes(prop.type)
    )
      warning(`Prop ${index + 1} has an unknown type “${prop.type}”.`);
    if (WATER_PROPS.has(prop.type) && prop.type !== "reeds") {
      const y = Number.isFinite(prop.y) ? prop.y : groundHeight(trail, prop.x);
      if (!waterPropBody(waterBodies(trail), prop.type, prop.x, y))
        warning(
          SURFACE_PROPS.has(prop.type)
            ? `Prop ${index + 1} (${prop.type}) floats on water, but there is no water surface at or just above it.`
            : `Prop ${index + 1} (${prop.type}) lives in water, but it is not in any water.`,
        );
    }
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
  for (const [index, body] of (trail.water || []).entries()) {
    const name = `Water ${index + 1}`;
    if (![body.x, body.y, body.width, body.depth].every(Number.isFinite)) {
      error(`${name} must have finite coordinates and size.`);
      continue;
    }
    if (body.width < WATER_SIZE.minWidth || body.depth < WATER_SIZE.minDepth)
      error(
        `${name} must be at least ${WATER_SIZE.minWidth} wide and ${WATER_SIZE.minDepth} deep.`,
      );
    const startY = Number.isFinite(trail.start?.y)
      ? trail.start.y
      : groundHeight(trail, trail.start.x) - 12;
    if (waterAt([body], trail.start.x, startY))
      warning(`${name} covers the start position.`);
    if (compiled && !waterColumns(compiled, body).length)
      warning(`${name} is completely inside terrain, so it has no effect.`);
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
  if (trail.unlock !== undefined) {
    const unlock = trail.unlock;
    const counts = unlock && typeof unlock === "object" && !Array.isArray(unlock)
      ? Object.entries(unlock)
      : null;
    if (!counts)
      error('Unlock must be an object such as { "trails": 3, "golds": 1 }.');
    else
      for (const [rule, count] of counts) {
        if (!UNLOCK_RULES.includes(rule))
          error(`Unlock.${rule} is not a rule. Use ${UNLOCK_RULES.join(" or ")}.`);
        else if (!Number.isInteger(count) || count < 0)
          error(`Unlock.${rule} must be a whole number of 0 or more.`);
      }
  }
  for (const key of ["sun", "clouds", "fog", "rain", "snow", "lightning"]) {
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
