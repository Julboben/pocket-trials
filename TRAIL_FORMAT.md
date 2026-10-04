# Hjulben trail format

All trails use the same JSON schema. Shipped career trails live in `trails/official/`, while locally authored standalone trails live in `trails/custom/`. The editor's JSON export can be placed directly in `trails/custom/`.

`npm run dev` watches both folders and regenerates `trails/catalog.json` whenever a JSON file changes. The browser loads that catalog through `js/trails.js`, so new files appear after the next page refresh. Trails saved or imported in the browser outside dev mode are kept in localStorage and listed alongside the file-based custom trails.

A trail cannot declare itself official inside its JSON. The generated catalog assigns source from the containing folder: official trails participate in career progression and official best times; custom trails are clearly labeled and never alter career progress.

The world uses Canvas coordinates:

- `x` increases to the right.
- `y` increases downward.
- A smaller `y` value therefore means higher terrain.
- Distances are expressed in world-space pixels.
- There is no height limit. `y` may go as far negative as you like, and the camera follows the rider all the way up. Downward, the camera stops a little below `fallY`.
- With the default start at `x = 90`, the bike's wheels begin near `x = 65` and `x = 115`.

## Complete example

```js
{
  name: 'Example Trail',
  label: 'EXAMPLE TRAIL / 08',
  goal: 1800,
  start: { x: 90, y: null, facing: 1 },

  terrainBlocks: [
    {
      id: 'ground',
      material: 'grass',
      outer: { nodes: [
        { x: 0, y: 320 },
        { x: 180, y: 320, out: [260, 320] },
        { x: 340, y: 260, in: [280, 260], out: [400, 260], mode: 'smooth' },
        { x: 520, y: 330, in: [460, 330] },
        { x: 780, y: 280 },
        { x: 780, y: 700 },
        { x: 0, y: 700 }
      ] },
      inner: []
    },
    {
      id: 'far-side',
      material: 'grass',
      outer: { nodes: [{ x: 900, y: 290 }, { x: 1950, y: 290 }, { x: 1950, y: 700 }, { x: 900, y: 700 }] },
      inner: [
        { nodes: [{ x: 1300, y: 400 }, { x: 1600, y: 400 }, { x: 1600, y: 520 }, { x: 1300, y: 520 }] }
      ]
    },
    {
      id: 'ledge',
      material: 'brick',
      outer: { nodes: [{ x: 1050, y: 200 }, { x: 1380, y: 200 }, { x: 1360, y: 240 }, { x: 1070, y: 240 }] },
      inner: []
    }
  ],

  apples: [
    { x: 300, y: null },
    { x: 840, y: 190 },
    { x: 1200, y: null },
    { x: 1450, y: 470 },
    { x: 1700, y: null }
  ],

  props: [
    { x: 250, y: null, type: 'tree', layer: 'back' },
    { x: 650, y: null, type: 'rock', layer: 'front' }
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

  fallY: 800
}
```

The example has rolling ground, a gap between x 780 and 900, a far side with a cave in it, and a brick ledge floating above the far side.

## Terrain: `terrainBlocks`

`terrainBlocks` is the trail's terrain: a list of blocks. Each block is one connected piece of solid: a material, a closed outer boundary, and any number of caves.

```js
terrainBlocks: [
  {
    id: 'ground',
    material: 'sand',
    outer: boundary,
    inner: [cave, ...]
  }
]
```

- `id`: the block's identity, used for invalidation. Any stable string.
- `material`: one of the terrain materials. It drives the fill, strata, edge, surface and spray.
- `outer`: the boundary around the solid.
- `inner`: the caves inside it, each a boundary. Use `[]` for none.

Separate pieces of solid are separate blocks, even when they share a material. Cutting a block in two in the editor leaves two blocks.

A **boundary** is a ring of nodes. Do not repeat the first node at the end. Each node has:

- `id`, `x`, `y`.
- `mode`: `corner`, `smooth`, or `independent`. A `smooth` node keeps its two handles in line, so the surface bends through it; a `corner` keeps it angular.
- `in` and `out`: the curve handles for the edges either side, as absolute `[x, y]` world positions, or `null` for straight ones. An edge is curved when the node before it has an `out` handle or the node after it has an `in` handle.
- `edge`: `straight` or `curve`, describing the edge leaving the node. Normalization reconciles it with the handles.

Node and boundary ids only need to be unique within the trail, and hand-written coordinates are fine. Normalization fills in anything missing, so a minimal block only needs its `outer` nodes. A trail needs at least one block.

Blocks are drawn and collide in list order, and later blocks win where they overlap. Every edge collides: tops, undersides, walls, and corners, so blocks can be any shape, including overhangs, vertical faces, and loops.

Authoring guidelines:

- **Ground**: one wide block whose top edge is the route and whose bottom sits well below it. Keep the opening section relatively flat so both wheels spawn safely, and keep terrain beyond `goal`.
- **Slopes**: broad curved edges ride well. Spans of `140–190` units per hill are forgiving; short spans with large height changes create abrupt geometry.
- **Gaps**: a break between two blocks. The walls either side are solid, so a rider who falls in can hit the cliff face. Start around `80–100` units wide for introductory jumps; wider gaps need a clear launch ramp and a landing below the takeoff height.
- **Ledges and islands**: a separate block above the ground. Leave at least one wheel diameter between it and the ground, and more when the rider is expected to pass underneath.
- **Caves**: an `inner` boundary inside a block. The cave is open space with a solid roof and floor.
- **Loops**: a block with a cave, ridden around its inside. Leave generous room in tight bends; very tight radii are hard to ride cleanly.

### Back walls: `layer: "back"`

A block with `"layer": "back"` is a back wall. It sits in `terrainBlocks` in the same format as any other block, but it is scenery: nothing collides with it, it is drawn darkened behind the props and the terrain, it doesn't count as the trail's terrain and it doesn't change the trail's hash or medals. Back walls decide what is a cave. Air with no back wall behind it looks through to the sky at the back of the scene, so the hollow of a ring, the space under a ledge or a window in a building is lit like open air. Air in front of a back wall only gets the light that reaches in from open air, so give an enclosed cave a back wall to keep it dark:

```json
{ "id": "cave-back", "material": "rock", "layer": "back", "outer": { "id": "cave-back-boundary", "nodes": [
  { "x": 470, "y": 205 }, { "x": 1265, "y": 205 }, { "x": 1265, "y": 325 }, { "x": 470, "y": 325 }
] }, "inner": [] }
```

Let a back wall reach into the rock around the cave, so no gap shows at its edges, and stop it short of the cave mouth for daylight to fade in. Back walls never block lights, so lanterns and the headlight light them up. A trail needs at least one block that is not a back wall.

In the editor, pick **Back wall** as the **Layer** of the Block tool to draw back walls, and of the Cut tool to cut into back walls without touching the terrain. The inspector's **Layer** switches a selected block between terrain and back wall, and **Fill caves with back walls** adds a back wall in the exact shape of each cave (`inner` boundary) in the selection. Caves formed by separate blocks have no `inner` boundary, so draw their back wall with the Block tool. Back walls show with a dashed outline, and clicking a cave picks its back wall before the terrain around it.

Validation reports blocks that enclose no area, cross themselves, or are buried under other blocks, and objects that are left over open air.

## Start: `start`

`start` controls the bike's initial midpoint and riding direction:

```js
start: { x: 90, y: null, facing: 1 }
```

- `x` is the horizontal midpoint between the wheels.
- `y` is the wheel-axle height. Use `null` to place both wheels automatically on the topmost surface at `x`, or a number for an explicit airborne, ledge, or cave start.
- `facing` is `1` for right and `-1` for left.

The editor's **Start** tool places an explicit start position. Select the start marker to move it or change its facing in the inspector. A trail always has one start, so it cannot be deleted.

## Finish: `goal`

The finish is a flower at (goal, finishY), floating 22 units above that point. finishY: null means it stands on the surface below. The run ends when the bike or rider touches the flower, from any side, once every apple is collected. The finish may be left or right of the start.

## Terrain materials

Each block sets its own material with its `material` property. Available presets are:

| Material | Intended character                       |
| -------- | ---------------------------------------- |
| `grass`  | Green surface with soil underneath       |
| `dirt`   | Warm loose-earth trail                   |
| `sand`   | Pale warm sand, bare by default          |
| `rock`   | Grey, hard mountain terrain              |
| `snow`   | Pale surface and cool subsurface         |
| `brick`  | Brick pattern with a green rideable edge |

Material definitions live in `terrainMaterials` at the top of `js/materials.js`. Each preset controls fill, internal layers or pattern, edge colors, vegetation, and wheel-spray colors.

## Apples

Each apple has a horizontal and optional vertical position:

```js
apples: [
  { x: 300, y: null },
  { x: 700, y: 190 },
];
```

A numeric `y` is the apple's center and allows it to be placed freely in the world, including over gaps, on ledges, or in caves. `y: null` anchors the apple 60 units above the topmost surface at `x`; do not put a ground-anchored apple over a gap. The editor's **Apple** tool always places an apple at the exact clicked position.

## Props

```js
props: [
  { x: 250, y: null, type: "tree", layer: "back" },
  { x: 650, y: 245, type: "rock", layer: "front" },
  { x: 900, y: null, type: "sign", layer: "front", text: "SLOW →" },
];
```

Available prop types are `tree`, `pine`, `sapling`, `pine-small`, `bush`, `fence`, `rock`, `boulder`, `pebbles`, `flowers`, `stump`, `cactus`, `cactus-small`, `crystal`, `sign`, the wall props `vines`, `roots` and `moss`, the farm props `crates`, `apple` (a small decorative apple to hang in trees or fill crates and the wheelbarrow; it is not collected), `ladder`, `wheelbarrow`, `scarecrow`, `beehive` and `tyre`, the street props `cone`, `barrier`, `dumpster`, `lamp` and `bird`, the building-site props `crane` and `scaffolding`, the cave props `hanging-roots`, `stalactites`, `drip`, `lantern`, `bats`, `mushrooms`, `minecart` and `beams`, and `graffiti`. `y: null` anchors a prop to the topmost surface at `x`; a numeric `y` places its ground/contact origin explicitly. `layer` may be `back` or `front`: `back`-layer props are drawn behind the terrain as well as the gameplay, while `front`-layer props are drawn in front of the gameplay.

A `sign` prop carries an optional `text` string that is drawn on its board with the game's pixel font. Text is limited to 8 characters; supported characters are `A`–`Z`, `0`–`9`, space, and `→` `/` `.` `!` `+` `-` `:` `×`. Anything else draws as `#`, and longer text is cut off.

Use the editor's **Prop** tool to place a prop. Select it to drag it, edit its type and layer in the inspector — plus its text, for signs — or remove it with **Delete Selection**, `Delete`, or `Backspace`.

## Spikes

Spikes are spinning spiked balls, similar to the killers in Elasto Mania. Touching one with either wheel or the rider's body ends the run.

```js
spikes: [
  { x: 820, y: 240, radius: 18, spin: 1 },
  { x: 1300, y: 150, radius: 30, spin: -0.5 },
];
```

- `x` and `y` are the center of the spike in world space. A missing or `null` `y` rests the spike on the topmost surface at `x`.
- `radius` is the distance from the center to the spike tips, between `8` and `64` (default `18`). Only the inner 80% is lethal, so grazing a tip is forgiven.
- `spin` is rotations per second. Positive values spin clockwise, negative values spin counter-clockwise, and `0` keeps the spike still. Spin is purely visual and does not change the hit area.

Spikes float freely and do not collide with terrain. Use the editor's **Spike** tool to place one at the clicked position; the inspector edits its radius and spin, and the selected spike shows its lethal area as a dashed circle. Leave at least one bike length of clearance around the start position.

## Water

Water bodies are rectangles of water that the bike rides through. Water fills the open air inside the rectangle; terrain inside it stays solid, so a body drawn over a pit fills the pit up to its surface.

```js
water: [
  { x: 600, y: 330, width: 400, depth: 110 }
]
```

- `x` and `y` are the top-left corner in world space, so `y` is the water's surface.
- `width` and `depth` are the size, at least `16` and `8` (defaults `240` and `32`).
- Water up to `40` deep is a ford: the bike can ride through it, but the water drags on it and slows it down. A wheel in water deeper than `40`, measured from the surface to the wheel's bottom or the body's floor, wipes the rider out, as does the rider's head going under.
- After a crash the ragdoll floats: buoyancy lifts it to rest at the surface while the water damps its motion. The bike sinks.
- Riding or falling in splashes, and moving through water leaves a wake.

Use the editor's **Water** tool (`W`): drag a rectangle, or click to drop a body of the tool's size with its surface at the click. Drag a body by the middle of its surface, or click open water to select it. The inspector edits width (keeping the body centred) and depth (keeping the surface), and says whether the body is a ford or deep. The editor warns when water covers the start, or lies entirely inside terrain.

Trails without water may leave the field out. Water is part of the trail hash only when a trail has some.

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

- `sun`: sun size and visibility. A bright, mostly clear daytime sun glares, with a halo and slow rays across the view that stay out of caves: faintly from about `sun: 0.8` with `clouds: 0.25` at `noon`, fully at `sun: 1` with clear skies. Rain and lightning put the glare out.
- `clouds`: cloud quantity, size, and opacity.
- `rain`: rain density, screen tint, and ambient rain volume.
- `lightning`: strike frequency, flash strength, and thunder strength.

Any property may be omitted. This supports clear skies, sunny skies with scattered clouds, overcast weather, rain without lightning, lightning without rain, and full storms.

## Time of day and backdrop

```js
timeOfDay: 'evening',
backdrop: 'desert'
```

Both are optional, and each is independent of the other.

`timeOfDay` picks the sky, sun, hill and light colours, and how the scene is lit. Valid values are `morning`, `noon`, `evening` and `night`; anything else, or no value, falls back to `noon`. Evening and night also light the finish and the city windows.

Lighting comes from the terrain and its back walls (see below). Air open to the sky, above the terrain or with no back wall behind it, gets the time of day's light, which fades in through cave mouths and in from the edges of back walls, so a cave closed off by a back wall is dark at any time of day. Air in front of a back wall that sees enough of the sky, such as under a wide overhang, stays lit, with only a soft shade right beneath it. Rock takes the light at its surface and darkens with depth: hardly at all at `noon`, a little in the `morning`, more in the `evening`, and quickly at `night`. Thin slits under ledges, and small sealed hollows in front of a back wall, are lit like the rock around them. Lanterns, glowing mushrooms, lamps and crane lights and the bike's headlight and tail light cast light of their own, which only reaches the surface of the rock. Apples, spikes and the finish get no light of their own, so in the dark they are only seen where some light reaches them; it is up to the trail to light what the rider should see. Rain softens the light, and lightning lights up the whole scene.

`backdrop` picks the shapes of the two parallax layers behind the terrain. Valid values are `hills`, `mountains`, `forest`, `desert` and `city`; anything else, or no value, means `hills`, and `hills` is not stored.

The theme sets the shapes and the time of day sets the colours, so all combinations work.

## Props: `flip` and wall props

Props sit under `props`, alongside the `terrainBlocks` terrain.

Every prop may carry `flip: true`, which mirrors it left to right. It is omitted when the prop is not flipped. Signs cannot be flipped, because their text would come out mirrored.

Three props attach to a wall rather than standing on the ground, and grow toward the open air:

| Prop | Place it | It draws |
| --- | --- | --- |
| `vines` | Just past the top corner of a cliff | Leafy strands hanging down the face, as far as the drop to the floor below allows |
| `roots` | On a wall face | Twisted roots growing out of the rock and drooping down |
| `moss` | On a wall face | Moss clumps pressed against the rock, with a few drips |

They find the rock by sampling up to 22 units either side, so they can be clicked slightly into the rock or slightly into the air. They are decoration only — nothing collides with them.

The farm props are decoration as well. The `ladder` leans to the right, so put it just left of a tree trunk, or flip it to lean the other way. The `scarecrow` turns its head to watch the rider go past, and the bees around the `beehive` buzz in place; both are visual only and stay still with reduced motion. The `tyre` is half-buried and sits a little below its anchor, so its dirt blends into the ground.

The street and building-site props are decoration too. A `lamp` comes on in the `evening`, at `night` and wherever else it is dark, such as in a cave, shining a beam down from its head, and a `crane` shows blinking warning lights at the same times. A `bird` takes off and flies away when the rider comes close; with reduced motion it simply disappears. The `crane` is tall and meant for the `back` layer, and `scaffolding` is meant for the `front` layer, where the rider shows through it as a silhouette.

The cave props are decoration as well. `hanging-roots`, `stalactites`, `drip`, `lantern` and `bats` hang from a cave ceiling: each looks up to 160 units above its anchor for the nearest roof, so place it anywhere under the ceiling (with `y: null` it uses the roof of the first cave below the surface). A `drip` lets a drop swell, fall one pixel at a time and splash into a puddle on the floor below. A `lantern` hangs on a chain from the roof down to its anchor, or stands on the ground where there is no roof above it; it always glows and lights up the cave around it. `mushrooms` stand on the floor and glow too. `bats` scatter away from the rider when the rider comes close; with reduced motion they simply disappear. `beams` are a timber support set that reaches from the floor up to the roof, packed with boards where the roof is uneven, and a `minecart` sits on rails that run along the floor until they reach a wall or a drop, up to 120 units each way. The ceiling props and `beams` cannot be flipped.

`graffiti` is painted onto the rock itself rather than placed in front of or behind it, so its `layer` doesn't matter. Place it inside a block, ideally a `brick` one: its `y` is the middle of the piece (with `y: null` it sits 40 units below the surface), and any paint that would land in the open air or on the surface lip is left off. It cannot be flipped.

Sign text wraps at word boundaries onto up to 4 lines of 10 characters, and the board grows taller to fit, staying on its post. Anything longer is cut off, and the editor warns.

## Other fields

- `fallY`: vertical position at which the bike is considered lost. Increase it for deep gaps or trails that descend far. It also sets how low the camera can look.
- `description`: design notes for the trail. It is not currently shown during gameplay.

## Medals

```js
medals: { gold: 11, silver: 14.5, bronze: 19 }
```

These optional target times are in seconds. The results screen and trail cards award the best medal whose time the run beats or matches. Times must be positive and ordered `gold ≤ silver ≤ bronze`. Any medal can be left out, and an invalid `medals` object is dropped during normalization. The official trails' gold times are based on the replay bot's finishing times in `tests/replays/`.

## Recommended authoring workflow

1. Build the base route as one ground block, with no gaps.
2. Ride it in both directions and verify every slope is recoverable.
3. Cut gaps one at a time, beginning around `80–100` units wide.
4. Add ledges, caves, and loops; test tops, undersides, walls, and corners in both directions.
5. Place apples only after the route is stable.
6. Add props, materials, and weather last so they do not hide gameplay problems.
7. Test at low speed, full speed, and after imperfect landings—not only with an ideal run.

## Visual editor

Open `editor.html` or choose **Trail Editor** from the game dashboard. The **Block** tool draws a new block, and the **Cut** tool carves caves, entrances, and gaps out of existing blocks. Drag a block's points and curve handles to reshape it, or drag inside its filled body to move it whole. Double-click an edge to add a point. The inspector edits a block's material, whether an edge is straight or curved, and whether a point is a corner or smooth.

The **Apple**, **Start**, and **Prop** tools place those objects at the exact clicked world position, and the **Water** tool draws a water body as a rectangle. Select an object to move it numerically or by dragging; the inspector also changes start direction and prop type/layer. Apples and props can be removed, while the required start and finish markers can only be moved.

## Suggested future format improvement

Blocks already have stable ids, so objects could eventually attach to a block's surface:

```js
apples: [
  { x: 1200, surface: 'ledge', offset: 60 }
]
```

That would let apples and props follow a block automatically after its shape changes. Explicit world-space placement already works, but it intentionally remains fixed when nearby terrain is edited.
