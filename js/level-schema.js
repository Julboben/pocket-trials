import { terrainMaterials } from "./materials.js";
import {
  curveAt,
  platformUndersideAt,
  terrainAt,
  terrainGeometry,
  invalidateTerrain,
} from "./terrain.js";
import { hypot } from "./det-math.js";
import { SIGN_MAX_CHARACTERS } from "./drawing.js";
import { RADIUS, WHEELBASE } from "./config.js";
import { FINISH_FLOWER_LIFT, bikeTouchesFlower } from "./finish.js";
import {
  normalizeBlocks as normalizeTerrainBlocks,
  validateBlocks as validateTerrainBlocks,
  regionBounds,
} from "./terrain-geometry.js";
import { legacyTerrainBlocks } from "./terrain-legacy.js";

// The unified block format is additive: a level may carry `terrainBlocks` and
// keep its legacy ground, gaps, platforms and paths. The two are resolved into
// one set of solids at load time, so a half-rebuilt level stays playable.
export const TERRAIN_FORMAT_VERSION = 2;

/** Blocks for a brand new level: one rectangular slab to build on. */
export function createBlankTerrainBlocks(level = {}) {
  return normalizeTerrainBlocks(
    [
      {
        id: "block-1",
        material: level.terrain || "grass",
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
    level.terrain || "grass",
  );
}

export const cloneLevel = (level) => JSON.parse(JSON.stringify(level));

export function createBlankLevel(index = 0) {
  const number = String(index + 1).padStart(2, "0");
  return {
    name: "New Trail",
    label: `NEW TRAIL / ${number}`,
    goal: 1200,
    terrain: "grass",
    description: "",
    start: { x: 90, y: null, facing: 1 },
    points: [
      [0, 320],
      [180, 320],
      [420, 270],
      [680, 330],
      [940, 280],
      [1320, 300],
    ],
    gaps: [],
    platforms: [],
    paths: [],
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
    sky: "#eae9d9",
    sun: "#f2c082",
    mountain: "#b7c8b1",
    spray: ["#6f8b59", "#9c8b68", "#c5b496"],
  };
}

/**
 * The unified blocks on a level, normalized. Levels that predate the block
 * format simply have none, and keep their legacy terrain.
 */
export function levelTerrainBlocks(level) {
  return level?.terrainBlocks
    ? normalizeTerrainBlocks(level.terrainBlocks, level.terrain || "grass")
    : [];
}

/**
 * Where the finish stands, in world units.
 *
 * A finish is a point, not just an x. `level.finishY` holds an explicit height
 * once the author has placed it somewhere other than the ground, and null means
 * "stand on whatever surface is here". That is what lets a finish sit on a
 * platform, or high above a cave, instead of being pinned to the ground line.
 *
 * The finish is a flower that floats a little above that anchor; the run ends
 * when the bike touches it, wherever the bike comes from.
 */
export function finishHeight(level) {
  if (Number.isFinite(level?.finishY)) return level.finishY;
  return (
    surfaceBelow(level, level?.goal ?? 0, null)?.y ?? (level?.fallY || 620)
  );
}

/** The centre of the finish flower, which is what the bike has to touch. */
export function finishFlower(level) {
  return { x: level.goal, y: finishHeight(level) - FINISH_FLOWER_LIFT };
}

/**
 * Whether a level still carries the older ground, gaps, islands and paths.
 *
 * This is what decides whether the editor offers CLEAR LEGACY TERRAIN and
 * whether the legacy ground is drawn at all, so it must be a plain boolean and
 * must mean one thing: are any of those fields present at all.
 */
export function hasLegacyTerrain(level) {
  if (!level) return false;
  if (Array.isArray(level.points) && level.points.length >= 2) return true;
  return ["gaps", "platforms", "paths"].some(
    (key) => Array.isArray(level[key]) && level[key].length > 0,
  );
}

/**
 * The combined solids of a level: any legacy terrain still present, converted
 * to blocks, followed by the level's own blocks. This is the one geometry the
 * runtime, the editor, and validation all read, so a half-rebuilt level
 * behaves consistently everywhere. Later blocks win where materials overlap,
 * so hand-built blocks always show over the legacy terrain they replace.
 *
 * The legacy part is a live view for reading and collision only. It is never
 * written back to the file unless the author migrates it explicitly with
 * `migrateLegacyTerrain`, so a level's authored legacy shape is not silently
 * rewritten.
 */
export function levelTerrain(level) {
  return cachedLegacyBlocks(level).concat(levelTerrainBlocks(level));
}

// Converting paths to outlines is the slow part of compiling a half-rebuilt
// level, and the editor recompiles on every drag frame while the legacy part
// never changes, so the conversion is kept until its inputs do. Legacy arrays
// are only ever replaced, never edited in place, except for island and path
// materials, which are part of the key.
const legacyBlockCache = new WeakMap();

function cachedLegacyBlocks(level) {
  if (!hasLegacyTerrain(level)) return [];
  const arrays = [level.points, level.gaps, level.platforms, level.paths];
  const key = [
    level.terrain,
    level.fallY,
    ...(level.platforms || []).map((platform) => platform.material),
    ...(level.paths || []).map(
      (path) => `${path.material}:${path.thickness}:${path.closed}`,
    ),
  ].join("|");
  const cached = legacyBlockCache.get(level);
  if (
    cached &&
    cached.key === key &&
    cached.arrays.every((value, index) => value === arrays[index])
  )
    return cached.blocks;
  const blocks = legacyTerrainBlocks(level);
  legacyBlockCache.set(level, { arrays, key, blocks });
  return blocks;
}

/**
 * The topmost solid surface at or below `referenceY`, using whichever terrain
 * the level actually has. This is the single answer to "where does something
 * at this x rest", so objects behave the same on legacy ground and on blocks.
 * It reads the level's cached geometry, so it is cheap to call per object.
 */
export function surfaceBelow(level, x, referenceY = null) {
  const surface = terrainAt(level, x, referenceY);
  return surface?.solid ? surface : null;
}

/** A surface's height at an x, falling back to the level's kill plane. */
function groundHeight(level, x) {
  const surface = surfaceBelow(level, x, null);
  return surface ? surface.y : level.fallY || 620;
}

// How far a ground-anchored object may move during migration before it is
// pinned to its old height instead. Well under an art pixel.
const MIGRATION_TOLERANCE = 0.5;

/**
 * Turn a level's legacy ground, gaps, islands and paths into ordinary editable
 * blocks, keeping everything the rider touches where it was.
 *
 * The converted blocks are the same shapes the runtime already rides on a
 * level that carries both, so migrating never moves the terrain. Objects that
 * stand on "whatever surface is here" (apples, props and the start with no y,
 * and a finish with no height) are checked against the migrated terrain: any
 * that would land somewhere else, such as under a path that used to be
 * ignored by surface queries, is pinned at the height it had before.
 *
 * @returns {object} a new, normalized level; the input is not modified
 */
export function migrateLegacyTerrain(level, index = 0) {
  if (!hasLegacyTerrain(level)) return normalizeLevel(level, index);
  const before = normalizeLevel(level, index);
  const next = cloneLevel(before);
  next.terrainBlocks = cloneLevel(levelTerrain(before));
  for (const key of ["points", "gaps", "platforms", "paths"]) delete next[key];
  next.terrainVersion = TERRAIN_FORMAT_VERSION;
  const after = normalizeLevel(next, index);

  const heightBefore = (x) => terrainAt(before, x, null);
  const heightAfter = (x) => terrainAt(after, x, null);
  const same = (x) => {
    const a = heightBefore(x),
      b = heightAfter(x);
    return (
      a.solid === b.solid &&
      (!a.solid || Math.abs(a.y - b.y) <= MIGRATION_TOLERANCE)
    );
  };

  after.apples = before.apples.map((apple) => {
    if (Number.isFinite(apple.y) || same(apple.x)) return { ...apple };
    return { ...apple, y: heightBefore(apple.x).y - 60 };
  });
  after.props = before.props.map((prop) => {
    if (Number.isFinite(prop.y) || same(prop.x)) return { ...prop };
    const ground = heightBefore(prop.x);
    return ground.solid ? { ...prop, y: ground.y } : { ...prop };
  });
  if (!Number.isFinite(before.start.y)) {
    const wheels = [
      before.start.x - WHEELBASE / 2,
      before.start.x + WHEELBASE / 2,
    ];
    if (!wheels.every(same)) {
      after.start = {
        ...before.start,
        y: Math.min(...wheels.map((x) => heightBefore(x).y)) - RADIUS,
      };
    }
  }
  if (!Number.isFinite(before.finishY) && !same(before.goal))
    after.finishY = finishHeight(before);
  // The legacy spikes were already resolved to explicit heights by normalization.
  after.spikes = before.spikes.map((spike) => ({ ...spike }));
  invalidateTerrain(after);
  return after;
}

/** Remove every piece of legacy terrain from a level, so the level is described
 * entirely by its blocks. The editor calls this when the author has rebuilt the
 * terrain by hand and no longer wants the old shape.
 *
 * @returns {object} a new level; the input is not modified
 */
export function clearLegacyTerrain(level) {
  const next = { ...level };
  delete next.points;
  delete next.gaps;
  delete next.platforms;
  delete next.paths;
  next.terrainVersion = TERRAIN_FORMAT_VERSION;
  return next;
}

export const SPIKE_RADIUS = { min: 8, max: 64, default: 18 };
export const PLATFORM_MIN_THICKNESS = 8;
export const PLATFORM_MIN_GAP = 4;

export const PLATFORM_DEFAULT_THICKNESS = 48;

// Bottom points mirror the top at a uniform depth, so every top corner gets a matching bottom corner.
export function uniformUnderside(
  points,
  thickness = PLATFORM_DEFAULT_THICKNESS,
) {
  return points.map(([x, y]) => [x, y + thickness]);
}

/**
 * Normalize a spike. `groundPoints` is the legacy ground curve, which a trail
 * rebuilt from blocks does not have; `groundY` is the surface height at the
 * spike's x from the combined terrain, used when the spike has no y of its own.
 */
export function normalizeSpike(spike, groundPoints, groundY = null) {
  const radius = Math.max(
    SPIKE_RADIUS.min,
    Math.min(SPIKE_RADIUS.max, Number(spike?.radius) || SPIKE_RADIUS.default),
  );
  const x = Number(spike?.x) || 0;
  const explicit = Number.isFinite(Number(spike?.y)) && spike?.y !== null;
  const surface = explicit
    ? null
    : groundY !== null && Number.isFinite(groundY)
      ? groundY
      : groundPoints
        ? curveAt(groundPoints, x).y
        : null;
  const y = explicit ? Number(spike.y) : (surface ?? 620) - radius;
  const spin = Number(spike?.spin);
  return { x, y, radius, spin: Number.isFinite(spin) ? spin : 1 };
}

export function normalizeLevel(input, index = 0) {
  const fallback = createBlankLevel(index);
  const level = { ...fallback, ...cloneLevel(input || {}) };
  level.name = String(level.name || fallback.name);
  level.label = String(
    level.label ||
      `${level.name.toUpperCase()} / ${String(index + 1).padStart(2, "0")}`,
  );
  level.goal = Number(level.goal) || fallback.goal;
  // The finish is a point. A null finishY means it stands on the surface below,
  // which is what a plain ground finish wants; a number pins it in the air.
  // The null check has to come first: Number(null) is 0, which would silently
  // pin every ground finish to the top of the world.
  level.finishY =
    level.finishY === null || level.finishY === undefined
      ? null
      : Number.isFinite(Number(level.finishY))
        ? Number(level.finishY)
        : null;
  level.fallY = Number(level.fallY) || fallback.fallY;
  level.terrain = terrainMaterials[level.terrain] ? level.terrain : "grass";
  // The block format is additive. A level may carry blocks and legacy terrain at
  // once while the author rebuilds it by hand, and normalization keeps both
  // readable until the legacy terrain is explicitly cleared.
  // A level that mentions no legacy terrain at all keeps those fields absent
  // rather than being given a default ground line it never had. A level that
  // mentions them at all, even with unusable data, keeps them so the existing
  // recovery behaviour still applies.
  const usesLegacyTerrain = ["points", "gaps", "platforms", "paths"].some(
    (key) => input?.[key] !== undefined,
  );
  // The version reflects the format actually in use: a level with no blocks is
  // still a version 1 trail, whether or not it also carries legacy terrain.
  level.terrainVersion =
    Array.isArray(level.terrainBlocks) && level.terrainBlocks.length
      ? TERRAIN_FORMAT_VERSION
      : 1;
  level.terrainBlocks = levelTerrainBlocks(level);
  if (!usesLegacyTerrain) {
    for (const key of ["points", "gaps", "platforms", "paths"])
      delete level[key];
  } else {
    level.points =
      Array.isArray(level.points) && level.points.length >= 2
        ? level.points
            .map((point) => [Number(point[0]), Number(point[1])])
            .sort((a, b) => a[0] - b[0])
        : fallback.points;
    level.gaps = Array.isArray(level.gaps)
      ? level.gaps.map((gap) =>
          [Number(gap[0]), Number(gap[1])].sort((a, b) => a - b),
        )
      : [];
    level.platforms = Array.isArray(level.platforms)
      ? level.platforms
          .map((platform) => {
            const sorted = (points) =>
              (points || [])
                .map((point) => [Number(point[0]), Number(point[1])])
                .sort((a, b) => a[0] - b[0]);
            return {
              ...platform,
              points: sorted(platform.points),
              bottom: sorted(platform.bottom),
              material: terrainMaterials[platform.material]
                ? platform.material
                : level.terrain,
            };
          })
          .filter(
            (platform) =>
              platform.points.length >= 2 && platform.bottom.length >= 2,
          )
      : [];
    level.paths = Array.isArray(level.paths)
      ? level.paths
          .map((path) => ({
            ...path,
            points: (path.points || []).map((point) => [
              Number(point[0]),
              Number(point[1]),
            ]),
            closed: Boolean(path.closed),
            thickness: Math.max(16, Number(path.thickness) || 32),
            material: terrainMaterials[path.material]
              ? path.material
              : level.terrain,
          }))
          .filter((path) => path.points.length >= (path.closed ? 3 : 2))
      : [];
  }
  const start = level.start || fallback.start;
  level.start = {
    x: Number(start.x) || 90,
    y:
      start.y === null || start.y === undefined
        ? null
        : Number.isFinite(Number(start.y))
          ? Number(start.y)
          : null,
    facing: Number(start.facing) < 0 ? -1 : 1,
  };
  level.apples = Array.isArray(level.apples)
    ? level.apples.map((apple) => ({
        x: Number(apple.x) || 0,
        y: apple.y === null ? null : Number(apple.y),
      }))
    : [];
  level.props = Array.isArray(level.props)
    ? level.props.map((prop) => ({
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
      }))
    : [];
  level.spikes = Array.isArray(level.spikes)
    ? level.spikes.map((spike) =>
        normalizeSpike(
          spike,
          level.points || null,
          surfaceBelow(level, Number(spike?.x) || 0, null)?.y ?? null,
        ),
      )
    : [];
  level.weather = { ...fallback.weather, ...(level.weather || {}) };
  const medals = normalizeMedals(level.medals);
  if (medals) level.medals = medals;
  else delete level.medals;
  return level;
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
function startTouchesFinish(level) {
  const { x, y, facing } = level.start;
  const wheelY = Number.isFinite(y) ? y : terrainAt(level, x, null).y - RADIUS;
  const rear = { x: x - WHEELBASE / 2, y: wheelY },
    front = { x: x + WHEELBASE / 2, y: wheelY };
  // A rider sits about 43 units above the axles, slightly forward.
  const probes = [
    { x: x + 3 * (facing < 0 ? -1 : 1), y: wheelY - 43, radius: 6 },
    { x, y: wheelY - 30, radius: 5 },
  ];
  return bikeTouchesFlower(finishFlower(level), { rear, front, probes });
}

export function validateLevel(level) {
  const messages = [];
  const error = (text) => messages.push({ type: "error", text });
  const warning = (text) => messages.push({ type: "warning", text });
  if (!level.name.trim()) error("The trail needs a name.");
  if (!terrainMaterials[level.terrain])
    error(`Unknown base material “${level.terrain}”.`);

  // Block geometry is validated first, and against the level's other blocks so
  // a fully buried block is reported.
  const blocks = levelTerrainBlocks(level);
  for (const message of validateTerrainBlocks(blocks)) messages.push(message);
  const compiled = blocks.length ? terrainGeometry(level) : null;
  if (compiled) {
    // A block with no surface left on the union's boundary is entirely inside
    // other terrain, which usually means a surrounding block was moved over it.
    const exposed = new Set(
      compiled.bodies
        .filter((body) => body.liveCount > 0)
        .map((body) => body.blockIndex),
    );
    const offset = compiled.blockCount - blocks.length;
    blocks.forEach((block, index) => {
      if (!exposed.has(offset + index))
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

  if (!Array.isArray(level.points) && !blocks.length)
    error("A trail needs terrain: either blocks or a ground line.");
  if (Array.isArray(level.points) && level.points.length < 2)
    error("Ground requires at least two control points.");
  for (
    let index = 1;
    Array.isArray(level.points) && index < level.points.length;
    index++
  ) {
    const [previousX, previousY] = level.points[index - 1];
    const [x, y] = level.points[index];
    if (x <= previousX)
      error(
        `Ground point ${index + 1} must be to the right of point ${index}.`,
      );
    if (x - previousX < 70 && Math.abs(y - previousY) > 70)
      warning(`Ground segment ${index}–${index + 1} is very steep.`);
  }
  // The finish may sit on either side of the start, so it is checked against
  // both ends of the terrain rather than against a position to the right.
  const blockLeft = blocks.length
    ? Math.min(
        ...blocks.flatMap((block) =>
          block.regions.map((region) => regionBounds(region).left),
        ),
      )
    : Infinity;
  const blockRight = blocks.length
    ? Math.max(
        ...blocks.flatMap((block) =>
          block.regions.map((region) => regionBounds(region).right),
        ),
      )
    : -Infinity;
  const firstX = Math.min(level.points?.[0]?.[0] ?? Infinity, blockLeft);
  const lastPointX = level.points?.at(-1)?.[0];
  const finalX = Math.max(
    Number.isFinite(lastPointX) ? lastPointX : -Infinity,
    blockRight,
  );
  if (Number.isFinite(firstX) && level.goal <= firstX) {
    error(
      `The finish at x ${Math.round(level.goal)} is before the start of the terrain (x ${Math.round(firstX)}). Move it onto the trail, or extend the blocks.`,
    );
  } else if (Number.isFinite(finalX) && level.goal >= finalX) {
    // Naming the extent makes this actionable: on a trail built from blocks the
    // old wording referred to a ground point that no longer exists.
    error(
      `The finish at x ${Math.round(level.goal)} is past the end of the terrain (x ${Math.round(finalX)}). Move it onto the trail, or extend the blocks.`,
    );
  }
  if (Number.isFinite(level.start?.x) && startTouchesFinish(level)) {
    error(
      "The finish flower touches the bike at the start, so the trail would end at once. Move the finish away from the start.",
    );
  }
  for (const [index, gap] of (level.gaps || []).entries()) {
    if (gap[1] <= gap[0]) error(`Gap ${index + 1} has an invalid range.`);
    if (gap[1] - gap[0] > 160)
      warning(`Gap ${index + 1} is wider than 160 units and may be difficult.`);
    if (
      !Number.isFinite(level.finishY) &&
      level.goal > gap[0] &&
      level.goal < gap[1]
    )
      error(`The finish is inside gap ${index + 1}.`);
  }
  for (const [index, path] of (level.paths || []).entries()) {
    if (!terrainMaterials[path.material])
      error(`Path ${index + 1} has an unknown material.`);
    if (!Number.isFinite(path.thickness) || path.thickness < 16)
      error(`Path ${index + 1} thickness must be at least 16.`);
    if (
      !Array.isArray(path.points) ||
      path.points.length < (path.closed ? 3 : 2)
    )
      error(`Path ${index + 1} needs at least ${path.closed ? 3 : 2} points.`);
    for (let pointIndex = 0; pointIndex < path.points.length; pointIndex++) {
      const point = path.points[pointIndex];
      if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1]))
        error(
          `Path ${index + 1} point ${pointIndex + 1} must contain finite coordinates.`,
        );
      if (
        pointIndex > 0 &&
        hypot(
          point[0] - path.points[pointIndex - 1][0],
          point[1] - path.points[pointIndex - 1][1],
        ) < 1
      )
        error(`Path ${index + 1} has coincident consecutive points.`);
    }
    if (
      path.closed &&
      path.points.length > 2 &&
      hypot(
        path.points[0][0] - path.points.at(-1)[0],
        path.points[0][1] - path.points.at(-1)[1],
      ) < 1
    )
      error(
        `Path ${index + 1} is closed automatically; remove its repeated final point.`,
      );
  }
  for (const [index, platform] of (level.platforms || []).entries()) {
    if (!terrainMaterials[platform.material])
      error(`Platform ${index + 1} has an unknown material.`);
    if (platform.points.length < 2)
      error(`Platform ${index + 1} needs at least two points.`);
    for (
      let pointIndex = 1;
      pointIndex < platform.points.length;
      pointIndex++
    ) {
      if (platform.points[pointIndex][0] <= platform.points[pointIndex - 1][0])
        error(`Platform ${index + 1} points are not ordered.`);
    }
    if (!Array.isArray(platform.bottom) || platform.bottom.length < 2) {
      error(`Platform ${index + 1} needs at least two underside points.`);
      continue;
    }
    for (
      let pointIndex = 1;
      pointIndex < platform.bottom.length;
      pointIndex++
    ) {
      if (platform.bottom[pointIndex][0] <= platform.bottom[pointIndex - 1][0])
        error(`Platform ${index + 1} underside points are not ordered.`);
    }
    const start = platform.points[0][0],
      end = platform.points.at(-1)[0];
    for (let x = start; x <= end; x += 8) {
      const underside = platformUndersideAt(platform, x);
      if (underside - curveAt(platform.points, x).y < PLATFORM_MIN_GAP) {
        error(
          `Platform ${index + 1} underside crosses its top near x ${Math.round(x)}.`,
        );
        break;
      }
    }
    for (const [x] of [...platform.points, ...platform.bottom]) {
      if (
        Array.isArray(level.points) &&
        platformUndersideAt(platform, x) >= curveAt(level.points, x).y - 8
      ) {
        warning(
          `Platform ${index + 1} comes close to or intersects the ground near x ${Math.round(x)}.`,
        );
        break;
      }
    }
  }
  if (!Number.isFinite(level.start?.x))
    error("The level needs a valid start position.");
  if (
    level.start?.y === null &&
    (level.gaps || []).some(
      (gap) => level.start.x > gap[0] && level.start.x < gap[1],
    )
  )
    error("The ground-anchored start position is inside a gap.");
  for (const apple of level.apples || []) {
    if (
      apple.y === null &&
      (level.gaps || []).some((gap) => apple.x > gap[0] && apple.x < gap[1])
    )
      error(
        `Ground-anchored apple at x ${Math.round(apple.x)} is inside a gap.`,
      );
  }
  for (const [index, prop] of (level.props || []).entries()) {
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
        "ledge",
        "moss",
      ].includes(prop.type)
    )
      warning(`Prop ${index + 1} has an unknown type “${prop.type}”.`);
    if (prop.type === "sign") {
      if (typeof prop.text !== "string")
        warning(
          `Sign ${index + 1} needs its text as a string; use “” for a blank sign.`,
        );
      else if (prop.text.length > SIGN_MAX_CHARACTERS)
        warning(
          `Sign ${index + 1} text is longer than ${SIGN_MAX_CHARACTERS} characters and will be cut off.`,
        );
      else if (/[^A-Z0-9 →\/.!+:\-×#]/.test(prop.text.toUpperCase()))
        warning(
          `Sign ${index + 1} text contains characters the pixel font cannot draw.`,
        );
    }
    if (
      prop.y === null &&
      (level.gaps || []).some((gap) => prop.x > gap[0] && prop.x < gap[1])
    )
      error(`Ground-anchored prop ${index + 1} is inside a gap.`);
  }
  for (const [index, spike] of (level.spikes || []).entries()) {
    if (!Number.isFinite(spike.x) || !Number.isFinite(spike.y))
      error(`Spike ${index + 1} must have finite coordinates.`);
    if (!(spike.radius >= SPIKE_RADIUS.min && spike.radius <= SPIKE_RADIUS.max))
      error(
        `Spike ${index + 1} radius must be between ${SPIKE_RADIUS.min} and ${SPIKE_RADIUS.max}.`,
      );
    const startY = Number.isFinite(level.start?.y)
      ? level.start.y
      : groundHeight(level, level.start.x) - 12;
    if (hypot(spike.x - level.start.x, spike.y - startY) < spike.radius + 70)
      warning(`Spike ${index + 1} is very close to the start position.`);
    for (const apple of level.apples || []) {
      const appleY = Number.isFinite(apple.y)
        ? apple.y
        : groundHeight(level, apple.x) - 60;
      if (hypot(spike.x - apple.x, spike.y - appleY) < spike.radius + 10)
        warning(
          `Spike ${index + 1} overlaps the apple at x ${Math.round(apple.x)}.`,
        );
    }
  }
  if (level.medals !== undefined) {
    const times = MEDALS.map((name) => Number(level.medals?.[name]));
    if (!times.every((time) => Number.isFinite(time) && time > 0))
      error(
        "Medal times need positive gold, silver and bronze values in seconds.",
      );
    else if (!(times[0] <= times[1] && times[1] <= times[2]))
      error("Medal times must get slower from gold to silver to bronze.");
  }
  for (const key of ["sun", "clouds", "rain", "lightning"]) {
    const value = level.weather?.[key];
    if (
      value !== undefined &&
      (!Number.isFinite(Number(value)) || value < 0 || value > 1)
    )
      error(`Weather.${key} must be between 0 and 1.`);
  }
  // On a block trail an object resting on "whatever is here" can be left over
  // open air by an edit. Checked last, so a broken finish or terrain, which
  // usually causes it, is the first thing reported.
  if (compiled) {
    const noGround = (x) => !terrainAt(level, x, null).solid;
    if (level.start?.y === null && noGround(level.start.x))
      error(
        "The ground-anchored start has no terrain under it. Drag the start onto a block.",
      );
    for (const apple of level.apples || []) {
      if (apple.y === null && noGround(apple.x))
        error(
          `Ground-anchored apple at x ${Math.round(apple.x)} has no terrain under it.`,
        );
    }
    if (!Number.isFinite(level.finishY) && noGround(level.goal))
      error(
        "The ground-anchored finish has no terrain under it. Drag it onto a block, or lift it into the air.",
      );
  }
  if (!messages.length)
    messages.push({ type: "ok", text: "Level data is valid." });
  return messages;
}

export function levelToModule(level) {
  return `export default ${JSON.stringify(level, null, 2)};\n`;
}
