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
