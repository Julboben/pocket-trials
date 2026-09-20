# Pocket Trials level format

Levels are defined in `js/levels.js`. The world uses Canvas coordinates:

- `x` increases to the right.
- `y` increases downward.
- A smaller `y` value therefore means higher terrain.
- Distances are expressed in world-space pixels.
- The bike starts with its wheels near `x = 65` and `x = 115`.

## Complete example

```js
{
  name: 'Example Trail',
  label: 'EXAMPLE TRAIL / 08',
  goal: 1800,
  terrain: 'grass',

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
      thickness: 52,
      material: 'brick'
    }
  ],

  apples: [300, 700, 1100, 1450, 1700],

  props: [
    { x: 250, type: 'tree', layer: 'back' },
    { x: 650, type: 'rock', layer: 'front' }
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
    thickness: 52,
    material: 'brick'
  }
]
```

Each platform supports collision on:

- Its curved top
- Both side walls
- Its underside
- Its corner points

A level can contain any number of platforms, including multiple platforms over the same base-ground region. Platform points follow the same coordinate and smoothing rules as main terrain points.

Keep at least one wheel diameter of visual separation between a platform and the ground. Larger clearances are preferable when the player is expected to pass underneath.

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

Apples are currently defined by horizontal position:

```js
apples: [300, 700, 1100, 1450, 1700]
```

Their vertical position is calculated from the base terrain when the level loads. Keep apples out of gaps. An apple can appear near an elevated platform when the platform runs close above the base surface, but explicit platform-relative collectible placement is not yet part of the format.

## Props

```js
props: [
  { x: 250, type: 'tree', layer: 'back' },
  { x: 650, type: 'rock', layer: 'front' }
]
```

Available prop types are `tree`, `fence`, `rock`, `flowers`, `stump`, and `crystal`. Props currently anchor to the base terrain. `layer` may be `back` or `front`.

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
- `island`: legacy visual shaping for a base-ground segment enclosed by gaps. Use `platforms` for new elevated geometry.

## Recommended authoring workflow

1. Build the base route with `points` and no gaps.
2. Ride it in both directions and verify every slope is recoverable.
3. Add gaps one at a time, beginning around `80–100` units wide.
4. Add elevated platforms and test their tops, undersides, walls, and both corners.
5. Place apples only after the route is stable.
6. Add props, materials, and weather last so they do not hide gameplay problems.
7. Test at low speed, full speed, and after imperfect landings—not only with an ideal run.

## Suggested future improvement

The current arrays are compact but become difficult to maintain as levels grow. A small visual level editor would be the best next step. It could provide draggable terrain points, platform previews, collision outlines, material selectors, and automatic validation.

Before building a full editor, the format could also be improved by giving platforms stable IDs and allowing objects to attach to a surface:

```js
platforms: [
  { id: 'upper-route', points: [[1050, 220], [1380, 215]], thickness: 52, material: 'brick' }
],
collectibles: [
  { x: 1200, surface: 'upper-route', offset: 60 }
]
```

That would make apples and props easier to place reliably on elevated routes after terrain edits.
