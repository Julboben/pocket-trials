# Pocket Trials: level authoring context

This document gives you everything you need to create levels for Pocket Trials, a 2D side-scrolling bike trials game. It bundles the level format spec, the validation code, the list of materials, and three official levels as examples.

## Your task

Create new levels as a single JSON file each, following the format below.

- Read the spec first, then check your output against `validateLevel` in `js/level-schema.js`. If the spec and the code disagree, follow the code.
- Coordinates use the Canvas convention: `x` increases to the right and `y` increases **downward**, so a smaller `y` means higher terrain.
- Only use material names defined in `js/materials.js`.
- Output plain JSON (no comments, no trailing commas). The file will be saved in `levels/custom/`.
- You cannot playtest. Keep gaps, slopes and jumps conservative (start gaps around 80–100 units wide) and treat medal times as rough estimates.

## Contents

1. `LEVEL_FORMAT.md`: Level format specification
2. `js/level-schema.js`: Schema, normalization and validation rules (the code is authoritative if it disagrees with the spec)
3. `js/materials.js`: Valid terrain materials
4. `levels/custom/README.md`: Where custom level files go and how they are loaded
5. `levels/official/01-the-orchard.json`: Example level: easy
6. `levels/official/04-skybound.json`: Example level: medium
7. `levels/official/07-elastic-summit.json`: Example level: advanced

---

## `LEVEL_FORMAT.md`

Level format specification.

````markdown
# Pocket Trials level format

All trails use the same JSON schema. Shipped career trails live in `levels/official/`, while locally authored standalone trails live in `levels/custom/`. The editor's JSON export can be placed directly in `levels/custom/`.

`npm run dev` watches both folders and regenerates `levels/catalog.json` whenever a JSON file changes. The browser loads that catalog through `js/levels.js`, so new files appear after the next page refresh. Trails saved or imported in the browser outside dev mode are kept in localStorage and listed alongside the file-based custom trails.

A level cannot declare itself official inside its JSON. The generated catalog assigns source from the containing folder: official trails participate in career progression and official best times; custom trails are clearly labeled and never alter career progress.

The world uses Canvas coordinates:

- `x` increases to the right.
- `y` increases downward.
- A smaller `y` value therefore means higher terrain.
- Distances are expressed in world-space pixels.
- With the default start at `x = 90`, the bike's wheels begin near `x = 65` and `x = 115`.

## Complete example

```js
{
  name: 'Example Trail',
  label: 'EXAMPLE TRAIL / 08',
  goal: 1800,
  terrain: 'grass',
  start: { x: 90, y: null, facing: 1 },

  points: [
    [0, 320],
    [180, 320],
    [340, 260],
    [520, 330],
    [760, 280],
    [1950, 280]
  ],

  gaps: [
    [780, 900]
  ],

  platforms: [
    {
      points: [[1050, 220], [1210, 185], [1380, 215]],
      bottom: [[1070, 260], [1210, 250], [1360, 250]],
      material: 'brick'
    }
  ],

  paths: [
    {
      points: [[1500, 300], [1600, 180], [1710, 100], [1800, 220], [1740, 340]],
      closed: true,
      thickness: 28,
      material: 'dirt'
    }
  ],

  apples: [
    { x: 300, y: null },
    { x: 700, y: 190 },
    { x: 1100, y: null },
    { x: 1450, y: 150 },
    { x: 1700, y: null }
  ],

  props: [
    { x: 250, y: null, type: 'tree', layer: 'back' },
    { x: 650, y: 245, type: 'rock', layer: 'front' }
  ],

  spikes: [
    { x: 1250, y: 150, radius: 18, spin: 1 }
  ],

  weather: {
    sun: 0.25,
    clouds: 0.9,
    rain: 0.5,
    lightning: 0.35
  },

  fallY: 580,
  sky: '#e6e5d7',
  sun: '#e9aa78',
  mountain: '#aebdb0',
  spray: ['#846d55', '#aa8b68', '#c8aa82']
}
```

## Main terrain: `points`

`points` defines the continuous ground surface:

```js
points: [[0, 320], [200, 320], [360, 250], [520, 330]]
```

The renderer creates a smooth cosine curve between consecutive points. Every point must have a larger `x` value than the point before it.

- Increase the horizontal distance between points for broad, gentle hills.
- Reduce the horizontal distance for sharper transitions.
- Reduce `y` to create a hill or ramp.
- Increase `y` to create a valley or drop.
- Keep the opening section relatively flat so both wheels spawn safely.
- Keep a final point beyond `goal`, otherwise the finish can sit at the edge of the terrain.

As a starting guideline, horizontal spans of `140–190` are forgiving. Spans below roughly `100` combined with large height changes can create abrupt or difficult geometry.

## Start: `start`

`start` controls the bike's initial midpoint and riding direction:

```js
start: { x: 90, y: null, facing: 1 }
```

- `x` is the horizontal midpoint between the wheels.
- `y` is the wheel-axle height. Use `null` to place both wheels automatically on the base terrain, or a number for an explicit airborne or platform-height start.
- `facing` is `1` for right and `-1` for left.

The editor's **Start** tool places an explicit start position. Select the start marker to move it or change its facing in the inspector. A level always has one start, so it cannot be deleted.

## Finish: `goal`

`goal` is the horizontal position of the finish flag:

```js
goal: 1800
```

It should be:

- Beyond every required apple.
- Before the final terrain point.
- On solid base terrain rather than inside a gap.

## Gaps: `gaps`

Each gap removes a section of the main terrain:

```js
gaps: [[780, 900], [1420, 1550]]
```

The two values are the left and right edges. Gap edges have solid vertical walls and solid corner collision. A rider can ride off the upper lip normally, but can collide with the cliff face after falling into the gap.

For introductory jumps, start around `80–100` units wide. Wider gaps should have a clear downhill approach or launch ramp and a forgiving landing below the takeoff height.

## Elevated platforms: `platforms`

Platforms are independent solid terrain bodies above the main ground:

```js
platforms: [
  {
    points: [[1050, 220], [1210, 185], [1380, 215]],
    bottom: [[1070, 260], [1210, 250], [1360, 250]],
    material: 'brick'
  }
]
```

`points` is the top edge and `bottom` is the underside. Both need at least two points ordered by x.

Each platform supports collision on:

- Its curved top
- Both side walls
- Its underside
- Its corner points

A level can contain any number of platforms, including multiple platforms over the same base-ground region. Platform points follow the same coordinate and smoothing rules as main terrain points.

### Underside: `bottom`

- `bottom` uses the same smoothing as `points`.
- The first and last top points are the top corners; the first and last bottom points are the bottom corners. Side walls connect them, so corners at different x values produce slanted walls.
- The underside must stay at least 4 units below the top. Validation reports an error when it crosses.
In the editor, the **Island** tool's **Starting thickness** sets the depth of new islands. Double-click an island's top or underside to add a point to that edge, or pick the **Island** tool while an island is selected and click to add points; press `Escape` to return to **Select**. Each edge keeps at least two points.

Keep at least one wheel diameter of visual separation between a platform and the ground. Larger clearances are preferable when the player is expected to pass underneath.

## Authored paths, loops, and overhangs: `paths`

`paths` defines solid ribbons in authored traversal order. Unlike base `points` and platform points, path points are never sorted by x, so a path can be vertical, double back, or close into a loop:

```js
paths: [
  {
    points: [[900, 310], [1040, 190], [1120, 80], [1230, 170], [1190, 310], [1040, 370]],
    closed: true,
    thickness: 28,
    material: 'dirt'
  }
]
```

- `points` describes the centerline of the ribbon and requires at least two points, or three for a closed path.
- `closed: true` connects the last point back to the first. Do not repeat the first point at the end.
- `thickness` is the full solid width and must be at least 16.
- Open paths have solid rounded endpoints; closed paths leave their center empty.
- Rendering and collision use the same ordered line segments, thickness, joins, and end caps.
- `gaps` apply only to base terrain. Use multiple open paths when a path needs a break.
- Objects with `y: null` still anchor to the base heightfield. Give starts, apples, and props an explicit `y` when placing them near a path.
- Leave generous room in tight bends. A centerline radius smaller than roughly the path thickness plus one wheel radius can be difficult or impossible to ride cleanly.

The editor's **Path / loop** tool creates an open path. Select a path or one of its points to move it, edit its material and thickness, or toggle **Closed loop**. Path points move freely in both axes and retain authored order.

## Terrain materials

Set the base material with:

```js
terrain: 'grass'
```

Set a platform material independently with its `material` property. Available presets are:

| Material | Intended character |
| --- | --- |
| `grass` | Green surface with soil underneath |
| `dirt` | Warm loose-earth trail |
| `rock` | Grey, hard mountain terrain |
| `snow` | Pale surface and cool subsurface |
| `brick` | Brick pattern with a green rideable edge |

Material definitions live in `terrainMaterials` at the top of `js/levels.js`. Each preset controls fill, internal layers or pattern, edge colors, vegetation, and wheel-spray colors.

## Apples

Each apple has a horizontal and optional vertical position:

```js
apples: [
  { x: 300, y: null },
  { x: 700, y: 190 }
]
```

A numeric `y` is the apple's center and allows it to be placed freely in the world, including over gaps or platforms. `y: null` anchors the apple 60 units above the base terrain; do not put a ground-anchored apple inside a gap. The editor's **Apple** tool always places an apple at the exact clicked position.


## Props

```js
props: [
  { x: 250, y: null, type: 'tree', layer: 'back' },
  { x: 650, y: 245, type: 'rock', layer: 'front' }
]
```

Available prop types are `tree`, `fence`, `rock`, `boulder`, `flowers`, `stump`, and `crystal`. `y: null` anchors a prop to the base terrain; a numeric `y` places its ground/contact origin explicitly. `layer` may be `back` or `front`: `back`-layer props are drawn behind the terrain as well as the gameplay, while `front`-layer props are drawn in front of the gameplay.

Use the editor's **Prop** tool to place a prop. Select it to drag it, edit its type and layer in the inspector, or remove it with **Delete Selection**, `Delete`, or `Backspace`.

## Spikes

Spikes are spinning spiked balls, similar to the killers in Elasto Mania. Touching one with either wheel or the rider's body ends the run.

```js
spikes: [
  { x: 820, y: 240, radius: 18, spin: 1 },
  { x: 1300, y: 150, radius: 30, spin: -0.5 }
]
```

- `x` and `y` are the center of the spike in world space. A missing or `null` `y` rests the spike on the base terrain.
- `radius` is the distance from the center to the spike tips, between `8` and `64` (default `18`). Only the inner 80% is lethal, so grazing a tip is forgiven.
- `spin` is rotations per second. Positive values spin clockwise, negative values spin counter-clockwise, and `0` keeps the spike still. Spin is purely visual and does not change the hit area.

Spikes float freely and do not collide with terrain. Use the editor's **Spike** tool to place one at the clicked position; the inspector edits its radius and spin, and the selected spike shows its lethal area as a dashed circle. Leave at least one bike length of clearance around the start position.

## Weather

Weather values are independent and range from `0` to `1`:

```js
weather: {
  sun: 0.8,
  clouds: 0.25,
  rain: 0.4,
  lightning: 0.2
}
```

- `sun`: sun size and visibility.
- `clouds`: cloud quantity, size, and opacity.
- `rain`: rain density, screen tint, and ambient rain volume.
- `lightning`: strike frequency, flash strength, and thunder strength.

Any property may be omitted. This supports clear skies, sunny skies with scattered clouds, overcast weather, rain without lightning, lightning without rain, and full storms.

## Other fields

- `fallY`: vertical position at which the bike is considered lost. Increase it for deep gaps.
- `sky`, `sun`, and `mountain`: level palette colors.
- `spray`: fallback wheel-particle colors. Material-specific spray takes priority.
- `description`: design notes for the trail. It is not currently shown during gameplay.

## Medals

```js
medals: { gold: 11, silver: 14.5, bronze: 19 }
```

These optional target times are in seconds. The results screen and level cards award the best medal whose time the run beats or matches. Times must be positive and ordered `gold ≤ silver ≤ bronze`. Any medal can be left out, and an invalid `medals` object is dropped during normalization. The official trails' gold times are based on the replay bot's finishing times in `tests/replays/`.

## Recommended authoring workflow

1. Build the base route with `points` and no gaps.
2. Ride it in both directions and verify every slope is recoverable.
3. Add gaps one at a time, beginning around `80–100` units wide.
4. Add elevated platforms and authored paths; test tops, undersides, walls, corners, and path caps in both directions.
5. Place apples only after the route is stable.
6. Add props, materials, and weather last so they do not hide gameplay problems.
7. Test at low speed, full speed, and after imperfect landings—not only with an ideal run.

## Visual editor

Open `editor.html` or choose **Level Editor** from the game dashboard. Individual points can be dragged to reshape a platform. Clicking and dragging inside a platform's filled body moves the complete platform while preserving its shape. The inspector edits its material.

The **Apple**, **Start**, and **Prop** tools place those objects at the exact clicked world position. Select an object to move it numerically or by dragging; the inspector also changes start direction and prop type/layer. Apples and props can be removed, while the required start and finish markers can only be moved.

## Suggested future format improvement

Platforms could eventually receive stable IDs so objects can attach to a surface:

```js
platforms: [
  { id: 'upper-route', points: [[1050, 220], [1380, 215]], bottom: [[1050, 270], [1380, 265]], material: 'brick' }
],
collectibles: [
  { x: 1200, surface: 'upper-route', offset: 60 }
]
```

That would let apples and props follow an elevated surface automatically after its shape changes. Explicit world-space placement already works, but it intentionally remains fixed when nearby terrain is edited.
````

---

## `js/level-schema.js`

Schema, normalization and validation rules (the code is authoritative if it disagrees with the spec).

````js
import { terrainMaterials } from './materials.js';
import { curveAt, platformUndersideAt } from './terrain.js';
import { hypot } from './det-math.js';

export const cloneLevel = level => JSON.parse(JSON.stringify(level));

export function createBlankLevel(index = 0) {
  const number = String(index + 1).padStart(2, '0');
  return {
    name: 'New Trail',
    label: `NEW TRAIL / ${number}`,
    goal: 1200,
    terrain: 'grass',
    description: '',
    start: { x: 90, y: null, facing: 1 },
    points: [[0, 320], [180, 320], [420, 270], [680, 330], [940, 280], [1320, 300]],
    gaps: [],
    platforms: [],
    paths: [],
    apples: [
      { x: 260, y: null },
      { x: 470, y: null },
      { x: 710, y: null },
      { x: 930, y: null },
      { x: 1100, y: null }
    ],
    props: [],
    spikes: [],
    weather: { sun: 1, clouds: .2 },
    fallY: 620,
    sky: '#eae9d9',
    sun: '#f2c082',
    mountain: '#b7c8b1',
    spray: ['#6f8b59', '#9c8b68', '#c5b496']
  };
}

export const SPIKE_RADIUS = { min: 8, max: 64, default: 18 };
export const PLATFORM_MIN_THICKNESS = 8;
export const PLATFORM_MIN_GAP = 4;

export const PLATFORM_DEFAULT_THICKNESS = 48;

// Bottom points mirror the top at a uniform depth, so every top corner gets a matching bottom corner.
export function uniformUnderside(points, thickness = PLATFORM_DEFAULT_THICKNESS) {
  return points.map(([x, y]) => [x, y + thickness]);
}

export function normalizeSpike(spike, groundPoints) {
  const radius = Math.max(SPIKE_RADIUS.min, Math.min(SPIKE_RADIUS.max, Number(spike?.radius) || SPIKE_RADIUS.default));
  const x = Number(spike?.x) || 0;
  const y = Number.isFinite(Number(spike?.y)) && spike?.y !== null ? Number(spike.y) : curveAt(groundPoints, x).y - radius;
  const spin = Number(spike?.spin);
  return { x, y, radius, spin: Number.isFinite(spin) ? spin : 1 };
}

export function normalizeLevel(input, index = 0) {
  const fallback = createBlankLevel(index);
  const level = { ...fallback, ...cloneLevel(input || {}) };
  level.name = String(level.name || fallback.name);
  level.label = String(level.label || `${level.name.toUpperCase()} / ${String(index + 1).padStart(2, '0')}`);
  level.goal = Number(level.goal) || fallback.goal;
  level.fallY = Number(level.fallY) || fallback.fallY;
  level.terrain = terrainMaterials[level.terrain] ? level.terrain : 'grass';
  level.points = Array.isArray(level.points) && level.points.length >= 2
    ? level.points.map(point => [Number(point[0]), Number(point[1])]).sort((a, b) => a[0] - b[0])
    : fallback.points;
  level.gaps = Array.isArray(level.gaps)
    ? level.gaps.map(gap => [Number(gap[0]), Number(gap[1])].sort((a, b) => a - b))
    : [];
  level.platforms = Array.isArray(level.platforms) ? level.platforms.map(platform => {
    const sorted = points => (points || []).map(point => [Number(point[0]), Number(point[1])]).sort((a, b) => a[0] - b[0]);
    return {
      ...platform,
      points: sorted(platform.points),
      bottom: sorted(platform.bottom),
      material: terrainMaterials[platform.material] ? platform.material : level.terrain
    };
  }).filter(platform => platform.points.length >= 2 && platform.bottom.length >= 2) : [];
  level.paths = Array.isArray(level.paths) ? level.paths.map(path => ({
    ...path,
    points: (path.points || []).map(point => [Number(point[0]), Number(point[1])]),
    closed: Boolean(path.closed),
    thickness: Math.max(16, Number(path.thickness) || 32),
    material: terrainMaterials[path.material] ? path.material : level.terrain
  })).filter(path => path.points.length >= (path.closed ? 3 : 2)) : [];
  const start = level.start || fallback.start;
  level.start = {
    x: Number(start.x) || 90,
    y: start.y === null || start.y === undefined ? null : (Number.isFinite(Number(start.y)) ? Number(start.y) : null),
    facing: Number(start.facing) < 0 ? -1 : 1
  };
  level.apples = Array.isArray(level.apples) ? level.apples.map(apple => ({
    x: Number(apple.x) || 0,
    y: apple.y === null ? null : Number(apple.y)
  })) : [];
  level.props = Array.isArray(level.props) ? level.props.map(prop => ({
    x: Number(prop.x) || 0,
    y: prop.y === null || prop.y === undefined ? null : (Number.isFinite(Number(prop.y)) ? Number(prop.y) : null),
    type: String(prop.type || 'tree'),
    layer: prop.layer === 'front' ? 'front' : 'back'
  })) : [];
  level.spikes = Array.isArray(level.spikes) ? level.spikes.map(spike => normalizeSpike(spike, level.points)) : [];
  level.weather = { ...fallback.weather, ...(level.weather || {}) };
  const medals = normalizeMedals(level.medals);
  if (medals) level.medals = medals; else delete level.medals;
  return level;
}

export const MEDALS = ['gold', 'silver', 'bronze'];

/** Target times in seconds; invalid or incomplete tables are dropped. */
export function normalizeMedals(medals) {
  if (!medals || typeof medals !== 'object') return null;
  const times = MEDALS.map(name => Number(medals[name]));
  if (!times.every(time => Number.isFinite(time) && time > 0)) return null;
  return { gold: times[0], silver: times[1], bronze: times[2] };
}

/** @returns {'gold' | 'silver' | 'bronze' | null} */
export function medalFor(medals, time) {
  if (!medals) return null;
  return MEDALS.find(name => time <= medals[name]) || null;
}

export function validateLevel(level) {
  const messages = [];
  const error = text => messages.push({ type: 'error', text });
  const warning = text => messages.push({ type: 'warning', text });
  if (!level.name.trim()) error('The trail needs a name.');
  if (!terrainMaterials[level.terrain]) error(`Unknown base material “${level.terrain}”.`);
  if (!Array.isArray(level.points) || level.points.length < 2) error('Ground requires at least two control points.');
  for (let index = 1; index < level.points.length; index++) {
    const [previousX, previousY] = level.points[index - 1];
    const [x, y] = level.points[index];
    if (x <= previousX) error(`Ground point ${index + 1} must be to the right of point ${index}.`);
    if (x - previousX < 70 && Math.abs(y - previousY) > 70) warning(`Ground segment ${index}–${index + 1} is very steep.`);
  }
  const finalX = level.points.at(-1)?.[0] || 0;
  if (level.goal <= 115 || level.goal >= finalX) error('The finish must be after the start and before the final ground point.');
  for (const [index, gap] of (level.gaps || []).entries()) {
    if (gap[1] <= gap[0]) error(`Gap ${index + 1} has an invalid range.`);
    if (gap[1] - gap[0] > 160) warning(`Gap ${index + 1} is wider than 160 units and may be difficult.`);
    if (level.goal > gap[0] && level.goal < gap[1]) error(`The finish is inside gap ${index + 1}.`);
  }
  for (const [index, path] of (level.paths || []).entries()) {
    if (!terrainMaterials[path.material]) error(`Path ${index + 1} has an unknown material.`);
    if (!Number.isFinite(path.thickness) || path.thickness < 16) error(`Path ${index + 1} thickness must be at least 16.`);
    if (!Array.isArray(path.points) || path.points.length < (path.closed ? 3 : 2)) error(`Path ${index + 1} needs at least ${path.closed ? 3 : 2} points.`);
    for (let pointIndex = 0; pointIndex < path.points.length; pointIndex++) {
      const point = path.points[pointIndex];
      if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) error(`Path ${index + 1} point ${pointIndex + 1} must contain finite coordinates.`);
      if (pointIndex > 0 && hypot(point[0] - path.points[pointIndex - 1][0], point[1] - path.points[pointIndex - 1][1]) < 1) error(`Path ${index + 1} has coincident consecutive points.`);
    }
    if (path.closed && path.points.length > 2 && hypot(path.points[0][0] - path.points.at(-1)[0], path.points[0][1] - path.points.at(-1)[1]) < 1) error(`Path ${index + 1} is closed automatically; remove its repeated final point.`);
  }
  for (const [index, platform] of (level.platforms || []).entries()) {
    if (!terrainMaterials[platform.material]) error(`Platform ${index + 1} has an unknown material.`);
    if (platform.points.length < 2) error(`Platform ${index + 1} needs at least two points.`);
    for (let pointIndex = 1; pointIndex < platform.points.length; pointIndex++) {
      if (platform.points[pointIndex][0] <= platform.points[pointIndex - 1][0]) error(`Platform ${index + 1} points are not ordered.`);
    }
    if (!Array.isArray(platform.bottom) || platform.bottom.length < 2) {
      error(`Platform ${index + 1} needs at least two underside points.`);
      continue;
    }
    for (let pointIndex = 1; pointIndex < platform.bottom.length; pointIndex++) {
      if (platform.bottom[pointIndex][0] <= platform.bottom[pointIndex - 1][0]) error(`Platform ${index + 1} underside points are not ordered.`);
    }
    const start = platform.points[0][0], end = platform.points.at(-1)[0];
    for (let x = start; x <= end; x += 8) {
      const underside = platformUndersideAt(platform, x);
      if (underside - curveAt(platform.points, x).y < PLATFORM_MIN_GAP) {
        error(`Platform ${index + 1} underside crosses its top near x ${Math.round(x)}.`);
        break;
      }
    }
    for (const [x] of [...platform.points, ...platform.bottom]) {
      if (platformUndersideAt(platform, x) >= curveAt(level.points, x).y - 8) {
        warning(`Platform ${index + 1} comes close to or intersects the ground near x ${Math.round(x)}.`);
        break;
      }
    }
  }
  if (!Number.isFinite(level.start?.x)) error('The level needs a valid start position.');
  if (level.start?.y === null && (level.gaps || []).some(gap => level.start.x > gap[0] && level.start.x < gap[1])) error('The ground-anchored start position is inside a gap.');
  for (const apple of level.apples || []) {
    if (apple.x >= level.goal) warning(`Apple at x ${Math.round(apple.x)} is at or beyond the finish.`);
    if (apple.y === null && (level.gaps || []).some(gap => apple.x > gap[0] && apple.x < gap[1])) error(`Ground-anchored apple at x ${Math.round(apple.x)} is inside a gap.`);
  }
  for (const [index, prop] of (level.props || []).entries()) {
    if (!['tree', 'fence', 'rock', 'boulder', 'flowers', 'stump', 'crystal'].includes(prop.type)) warning(`Prop ${index + 1} has an unknown type “${prop.type}”.`);
    if (prop.y === null && (level.gaps || []).some(gap => prop.x > gap[0] && prop.x < gap[1])) error(`Ground-anchored prop ${index + 1} is inside a gap.`);
  }
  for (const [index, spike] of (level.spikes || []).entries()) {
    if (!Number.isFinite(spike.x) || !Number.isFinite(spike.y)) error(`Spike ${index + 1} must have finite coordinates.`);
    if (!(spike.radius >= SPIKE_RADIUS.min && spike.radius <= SPIKE_RADIUS.max)) error(`Spike ${index + 1} radius must be between ${SPIKE_RADIUS.min} and ${SPIKE_RADIUS.max}.`);
    const startY = Number.isFinite(level.start?.y) ? level.start.y : curveAt(level.points, level.start.x).y - 12;
    if (hypot(spike.x - level.start.x, spike.y - startY) < spike.radius + 70) warning(`Spike ${index + 1} is very close to the start position.`);
    for (const apple of level.apples || []) {
      const appleY = Number.isFinite(apple.y) ? apple.y : curveAt(level.points, apple.x).y - 60;
      if (hypot(spike.x - apple.x, spike.y - appleY) < spike.radius + 10) warning(`Spike ${index + 1} overlaps the apple at x ${Math.round(apple.x)}.`);
    }
  }
  if (level.medals !== undefined) {
    const times = MEDALS.map(name => Number(level.medals?.[name]));
    if (!times.every(time => Number.isFinite(time) && time > 0)) error('Medal times need positive gold, silver and bronze values in seconds.');
    else if (!(times[0] <= times[1] && times[1] <= times[2])) error('Medal times must get slower from gold to silver to bronze.');
  }
  for (const key of ['sun', 'clouds', 'rain', 'lightning']) {
    const value = level.weather?.[key];
    if (value !== undefined && (!Number.isFinite(Number(value)) || value < 0 || value > 1)) error(`Weather.${key} must be between 0 and 1.`);
  }
  if (!messages.length) messages.push({ type: 'ok', text: 'Level data is valid.' });
  return messages;
}

export function levelToModule(level) {
  return `export default ${JSON.stringify(level, null, 2)};\n`;
}
````

---

## `js/materials.js`

Valid terrain materials.

````js
export const terrainMaterials = {
  grass: {
    fill: '#c5b496', layers: ['#d3c2a2', '#b7a687'], detail: '#ac9c806e',
    edge: '#375d4d', surface: '#6f8b59', vegetation: '#628455',
    spray: ['#6f8b59','#9c8b68','#c5b496']
  },
  dirt: {
    fill: '#ad825e', layers: ['#c69a70', '#906b50'], detail: '#76543f66',
    edge: '#654735', surface: '#9c714f', vegetation: null,
    spray: ['#886044','#ad825e','#d0a47b']
  },
  rock: {
    fill: '#727a78', layers: ['#89918d', '#606866'], detail: '#4d565466',
    edge: '#3f4d4b', surface: '#9aa49e', vegetation: null,
    spray: ['#626b69','#858e8a','#aeb5ad']
  },
  snow: {
    fill: '#aebbc0', layers: ['#cbd5d6', '#929fa5'], detail: '#74838a55',
    edge: '#687a7e', surface: '#eef3ed', vegetation: null,
    spray: ['#d8e2df','#edf2eb','#aebcc0']
  },
  brick: {
    fill: '#8d493d', layers: ['#a65a49', '#71392f'], detail: '#492b29aa', pattern: 'brick',
    edge: '#433534', surface: '#74a35a', vegetation: null,
    spray: ['#754239','#9a5748','#bd7961']
  }
};
````

---

## `levels/custom/README.md`

Where custom level files go and how they are loaded.

````markdown
# Custom Levels

Drop your own trail files into this folder to play them locally.

## Adding a level

With `npm run dev` running, click **New** or **Duplicate** in the **Level Editor**. The trail is written here directly, and **Save** keeps it up to date. Refresh the game to see it under **CUSTOM TRAILS**.

You can also add a file by hand:

1. Build a trail in the **Level Editor** and click **Export JSON**.
2. Save the exported file here, e.g. `levels/custom/my-trail.json`.
3. With `npm run dev` running, the catalog regenerates automatically. Without the dev server, run `npm run levels` once to rebuild `levels/catalog.json`.

Trails created or imported without the dev server, for example on a deployed copy, are stored in the browser instead of this folder.

## Rules

- Only `.json` files are picked up. Files load in natural filename order, so a numeric prefix like `01-` controls ordering.
- Each file needs a string `name`; everything else follows the same schema as the official trails. See [`LEVEL_FORMAT.md`](../../LEVEL_FORMAT.md).
- The level ID is `custom:<filename>`, so renaming a file makes it a different level.
- Custom trails are labeled as custom and never affect career progression or official best times. A level can't mark itself as official; the folder decides.

## Git

The contents of this folder are git-ignored (except this README), so your trails stay local to your machine.
````

---

## `levels/official/01-the-orchard.json`

Example level: easy.

````json
{
  "name": "The Orchard",
  "label": "THE ORCHARD / 01",
  "goal": 2380,
  "terrain": "grass",
  "description": "Learn the rhythm: build speed on gentle rollers, lean forward on climbs, and settle the bike before each landing.",
  "medals": {
    "gold": 11,
    "silver": 14.5,
    "bronze": 19
  },
  "start": {
    "x": 90,
    "y": null,
    "facing": 1
  },
  "points": [
    [
      0,
      320
    ],
    [
      180,
      320
    ],
    [
      320,
      292
    ],
    [
      455,
      322
    ],
    [
      610,
      276
    ],
    [
      760,
      320
    ],
    [
      920,
      300
    ],
    [
      1060,
      257
    ],
    [
      1215,
      323
    ],
    [
      1375,
      286
    ],
    [
      1515,
      321
    ],
    [
      1665,
      267
    ],
    [
      1815,
      318
    ],
    [
      1960,
      294
    ],
    [
      2110,
      326
    ],
    [
      2245,
      304
    ],
    [
      2490,
      304
    ]
  ],
  "apples": [
    {
      "x": 300,
      "y": null
    },
    {
      "x": 760,
      "y": null
    },
    {
      "x": 1050,
      "y": null
    },
    {
      "x": 1645,
      "y": null
    },
    {
      "x": 2190,
      "y": null
    }
  ],
  "props": [
    {
      "x": 215,
      "y": null,
      "type": "fence",
      "layer": "back"
    },
    {
      "x": 520,
      "y": null,
      "type": "tree",
      "layer": "back"
    },
    {
      "x": 825,
      "y": null,
      "type": "flowers",
      "layer": "front"
    },
    {
      "x": 1180,
      "y": null,
      "type": "stump",
      "layer": "front"
    },
    {
      "x": 1450,
      "y": null,
      "type": "fence",
      "layer": "back"
    },
    {
      "x": 1900,
      "y": null,
      "type": "tree",
      "layer": "back"
    },
    {
      "x": 2250,
      "y": null,
      "type": "flowers",
      "layer": "front"
    }
  ],
  "weather": {
    "sun": 1,
    "clouds": 0.15
  },
  "sky": "#eae9d9",
  "sun": "#f2c082",
  "mountain": "#b7c8b1",
  "spray": [
    "#6f8b59",
    "#9c8b68",
    "#c5b496"
  ]
}
````

---

## `levels/official/04-skybound.json`

Example level: medium.

````json
{
  "name": "Skybound",
  "label": "SKYBOUND / 04",
  "goal": 3020,
  "terrain": "grass",
  "description": "Commit to the jumps. Build speed before each lip, stay calm in the air, and line both wheels up with the far-side slope.",
  "medals": {
    "gold": 14.5,
    "silver": 19,
    "bronze": 25
  },
  "start": {
    "x": 90,
    "y": null,
    "facing": 1
  },
  "points": [
    [
      0,
      320
    ],
    [
      180,
      320
    ],
    [
      350,
      286
    ],
    [
      500,
      322
    ],
    [
      660,
      270
    ],
    [
      800,
      315
    ],
    [
      950,
      245
    ],
    [
      1045,
      292
    ],
    [
      1210,
      258
    ],
    [
      1370,
      292
    ],
    [
      1510,
      292
    ],
    [
      1650,
      332
    ],
    [
      1810,
      264
    ],
    [
      1950,
      318
    ],
    [
      2090,
      230
    ],
    [
      2225,
      301
    ],
    [
      2380,
      267
    ],
    [
      2520,
      324
    ],
    [
      2680,
      242
    ],
    [
      2825,
      307
    ],
    [
      2960,
      280
    ],
    [
      3150,
      280
    ]
  ],
  "gaps": [
    [
      950,
      1045
    ],
    [
      1510,
      1650
    ]
  ],
  "fallY": 560,
  "apples": [
    {
      "x": 345,
      "y": null
    },
    {
      "x": 790,
      "y": null
    },
    {
      "x": 1210,
      "y": null
    },
    {
      "x": 2080,
      "y": null
    },
    {
      "x": 2670,
      "y": null
    }
  ],
  "weather": {
    "sun": 0.82,
    "clouds": 0.24
  },
  "props": [
    {
      "x": 230,
      "y": null,
      "type": "fence",
      "layer": "back"
    },
    {
      "x": 590,
      "y": null,
      "type": "flowers",
      "layer": "front"
    },
    {
      "x": 860,
      "y": null,
      "type": "rock",
      "layer": "front"
    },
    {
      "x": 1140,
      "y": null,
      "type": "crystal",
      "layer": "back"
    },
    {
      "x": 1415,
      "y": null,
      "type": "tree",
      "layer": "back"
    },
    {
      "x": 1880,
      "y": null,
      "type": "fence",
      "layer": "back"
    },
    {
      "x": 2290,
      "y": null,
      "type": "crystal",
      "layer": "back"
    },
    {
      "x": 2760,
      "y": null,
      "type": "rock",
      "layer": "front"
    }
  ],
  "sky": "#eae9d9",
  "sun": "#f6d48d",
  "mountain": "#b7c8b1",
  "spray": [
    "#8d806b",
    "#b4a58a",
    "#d2c3a2"
  ]
}
````

---

## `levels/official/07-elastic-summit.json`

Example level: advanced.

````json
{
  "name": "Elastic Summit",
  "label": "ELASTIC SUMMIT / 07",
  "goal": 4080,
  "terrain": "rock",
  "description": "The final exam: rolling speed, precise braking, steep climbs, controlled airtime, and enough patience to finish in one piece.",
  "start": {
    "x": 90,
    "y": null,
    "facing": 1
  },
  "points": [
    [
      0,
      320
    ],
    [
      180,
      320
    ],
    [
      335,
      268
    ],
    [
      475,
      338
    ],
    [
      645,
      228
    ],
    [
      795,
      326
    ],
    [
      950,
      282
    ],
    [
      1090,
      195
    ],
    [
      1235,
      342
    ],
    [
      1390,
      260
    ],
    [
      1547.43359375,
      181.1015625
    ],
    [
      1826.0546875,
      328.08203125
    ],
    [
      1990,
      246
    ],
    [
      2130,
      325
    ],
    [
      2290,
      205
    ],
    [
      2440,
      346
    ],
    [
      2590,
      275
    ],
    [
      2869.671875,
      270.0625
    ],
    [
      3040,
      252
    ],
    [
      3180,
      176
    ],
    [
      3330,
      340
    ],
    [
      3480,
      286
    ],
    [
      3652.12890625,
      283.80078125
    ],
    [
      3760,
      326
    ],
    [
      3910,
      262
    ],
    [
      4200,
      262
    ]
  ],
  "gaps": [
    [
      1655.46484375,
      1689.16796875
    ],
    [
      2652.55078125,
      2890
    ]
  ],
  "platforms": [
    {
      "points": [
        [
          1159.76953125,
          86.95182291666667
        ],
        [
          1299.76953125,
          54.95182291666667
        ],
        [
          1469.76953125,
          80.95182291666667
        ]
      ],
      "material": "brick",
      "bottom": [
        [
          1159.76953125,
          138.95182291666669
        ],
        [
          1299.76953125,
          106.95182291666667
        ],
        [
          1469.76953125,
          132.95182291666669
        ]
      ]
    },
    {
      "points": [
        [
          2672.3372395833335,
          280.0065104166667
        ],
        [
          2850.16015625,
          269.96484375
        ]
      ],
      "material": "grass",
      "bottom": [
        [
          2672.3372395833335,
          338.0065104166667
        ],
        [
          2761.921875,
          339.2890625
        ],
        [
          2863.14453125,
          326.68359375
        ]
      ]
    },
    {
      "points": [
        [
          3283.6848958333335,
          163.65364583333334
        ],
        [
          3433.6848958333335,
          133.65364583333334
        ],
        [
          3621.35546875,
          180.30078125
        ]
      ],
      "material": "snow",
      "bottom": [
        [
          3284.25,
          219.26953125
        ],
        [
          3433.6848958333335,
          187.65364583333334
        ],
        [
          3728.98046875,
          212.0546875
        ]
      ]
    }
  ],
  "paths": [],
  "apples": [
    {
      "x": 330,
      "y": null
    },
    {
      "x": 1232.6953125,
      "y": 288.32421875
    },
    {
      "x": 2280,
      "y": null
    },
    {
      "x": 3496.45703125,
      "y": 254.47265625
    },
    {
      "x": 3671.96875,
      "y": 128.35546875
    }
  ],
  "props": [
    {
      "x": 235,
      "y": null,
      "type": "fence",
      "layer": "back"
    },
    {
      "x": 565,
      "y": null,
      "type": "rock",
      "layer": "front"
    },
    {
      "x": 885,
      "y": null,
      "type": "tree",
      "layer": "back"
    },
    {
      "x": 1290,
      "y": null,
      "type": "flowers",
      "layer": "front"
    },
    {
      "x": 1799.046875,
      "y": 332.80859375,
      "type": "crystal",
      "layer": "back"
    },
    {
      "x": 2200,
      "y": null,
      "type": "stump",
      "layer": "front"
    },
    {
      "x": 2505,
      "y": null,
      "type": "fence",
      "layer": "back"
    },
    {
      "x": 2960,
      "y": null,
      "type": "crystal",
      "layer": "back"
    },
    {
      "x": 3400,
      "y": null,
      "type": "tree",
      "layer": "back"
    },
    {
      "x": 3830,
      "y": null,
      "type": "rock",
      "layer": "front"
    }
  ],
  "spikes": [],
  "weather": {
    "sun": 0.06,
    "clouds": 1,
    "rain": 0.72,
    "lightning": 0.65
  },
  "fallY": 570,
  "sky": "#e5e2d6",
  "sun": "#efa56f",
  "mountain": "#a9b5aa",
  "spray": [
    "#6d6c62",
    "#928675",
    "#b9a68c"
  ]
}
````
