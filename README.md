# Pocket Trials

Pocket Trials is a small side-scrolling motorcycle trials game inspired by the physics-driven handling of **Elasto Mania**. Build momentum over rolling terrain, shift the rider's weight, control wheelies and stoppies, collect every apple, and reach the finish flag without putting the rider's helmet into the ground.

The current version is a dependency-free browser prototype built with native JavaScript modules, Canvas rendering, and custom Verlet-style bike physics.

## Features

- Momentum-driven motorcycle handling
- Rear-wheel-only throttle
- Progressive throttle and speed-dependent torque
- Combined braking with dynamic front-wheel bias
- Rider weight transfer, wheelies, and stoppies
- Independent front and rear suspension animation
- Impact-sensitive suspension compression and landing rebound
- Live post-crash rider ragdoll simulation with a detached, coasting bike
- Direction flipping with an animated rider and bike transition
- Code-drawn pixel presentation with smooth terrain, mountains, and apples for readability
- Responsive mobile and expanded desktop layouts with optional fullscreen play
- Keyboard and touch controls
- Two selectable riders: Max and Maxine
- Layered foreground and background scenery
- Terrain-colored wheel spray, brake lights, and fading ground skid marks
- Procedural engine, braking, wheel-landing, aerial trick, collectible, crash, flip, finish, dashboard, and rain sound effects
- Collectibles, finish gates, timers, and best times
- Persisted settings and level progression
- Seven progressively longer trails with gaps and multiple elevated rideable platforms
- Grass, dirt, rock, snow, and brick terrain materials
- Per-trail rain and lightning configuration with procedural ambience and distance-aware thunder

## Play

Run a local static server from the project directory:

```sh
npm run dev
```

This generates `levels/catalog.json`, watches the level folders for changes, and starts `live-server`. Add or edit a JSON file while the command is running and the catalog is regenerated automatically; the development server then reloads the page.

A local server is required because the game uses native JavaScript modules. No dependency installation or application build is required.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Gas | `Up Arrow` or `W` | Gas button |
| Brake | `Down Arrow` or `S` | Brake button |
| Lean backward / forward | `Left Arrow` / `Right Arrow` or `A` / `D` | Lean buttons |
| Flip riding direction | `Space` | — |
| Restart trail | `R` | Compact restart button in the game viewport |
| Pause / resume | — | Pause button |
| Open / close the main menu | `Escape` | In-game menu button |
| Toggle fullscreen | Fullscreen button | Fullscreen button |
| Navigate dashboard controls | Arrow keys or `W` / `A` / `S` / `D` | Tap a menu item |
| Activate the focused menu action | `Enter` or `Space` | Tap a menu item |

Lean labels adjust to the direction the rider is facing.

## Trails

1. **The Orchard** — gentle rollers that teach throttle rhythm and basic balance.
2. **Rolling Country** — longer hills that teach momentum management and crest control.
3. **High Hopes** — steep climbs and bigger landings that reward early weight shifts.
4. **Skybound** — two committed jumps, including a floating-island crossing.
5. **Brake Point** — sharp drops and deep bowls that teach controlled braking and recovery.
6. **Long Way Up** — a sustained technical climb combining momentum and wheelie control.
7. **Elastic Summit** — a long final exam combining climbs, braking, landings, gaps, and stacked platforms.

Each trail requires collecting all five apples before the finish gate will open. Completing a trail unlocks the next one. Selecting a trail starts it immediately, and its number and name remain visible as a lower-left course marker.

## Level editor

Open the visual editor from **Level Editor** on the main dashboard or navigate directly to `editor.html`. The initial editor supports:

- Loading every official and custom trail, with its source clearly labeled
- Dragging ground and platform control points
- Adding ground points, elevated platforms, gaps, freely positioned apples, start points, props, and finish positions
- Moving complete platforms by dragging their filled bodies
- Moving or removing props and changing their type and foreground/background layer
- Choosing the start position and left/right facing direction
- Selecting base and platform materials
- Editing sun, cloud, rain, and lightning values
- Trackpad navigation: two-finger scrolling pans and pinch gestures zoom around the pointer
- Mouse navigation: wheel panning, `Ctrl`/`Cmd` + wheel zooming, and middle-button or `Space`-drag panning
- Undo and redo
- Continuous level validation
- Browser-local drafts
- JSON and JavaScript module export

Editor drafts do not overwrite level files. Official trails live in `levels/official/`; locally authored trails belong in `levels/custom/`. Both use the exact JSON format produced by **Export JSON**. Source classification comes from the generated catalog and folder—not from a user-editable property inside the level. See [`LEVEL_FORMAT.md`](./LEVEL_FORMAT.md) for the full schema and design guidelines.

## Settings and saved data

The dashboard's Settings view includes:

- Full or reduced scenery
- Visible or hidden on-screen controls
- Sound effects on or off

The game opens on a dedicated dashboard before any level is loaded or rendered. Settings, level selection, and an illustrated How to Play guide are full dashboard views rather than separate modals. Control instructions are centralized in the guide instead of being repeated around the gameplay interface. It provides three independent savegame slots. The main dashboard shows only the active career, while the Load Game view contains slot selection and deletion. New Game always uses an empty slot; when all slots are occupied, one must be explicitly deleted first. A rider is chosen when a slot is created and is permanently tied to that save.

Preferences and all three rider profiles—including each slot's current trail, unlocks, and best times—are stored in browser `localStorage`.

Current storage keys:

- `pocket-trials-settings-v1`
- `pocket-trials-saves-v2`
- `pocket-trials-active-slot-v1`

The former single-save keys are read once to migrate an existing career into slot 1.

Clearing site data resets settings, progression, and recorded times.

## Project structure

```text
.
├── index.html          # Game markup and module entry point
├── css/
│   ├── game.css        # Game and dashboard presentation
│   └── editor.css      # Visual level editor presentation
├── levels/
│   ├── official/       # Shipped career trails
│   ├── custom/         # Locally authored standalone trails
│   └── catalog.json    # Generated level index
├── scripts/            # Catalog generator and development watcher
├── js/
│   ├── main.js         # Game loop, simulation, rendering, input, and UI orchestration
│   ├── physics.js      # Reusable bike-constraint physics helpers
│   ├── physics-debug.js # Opt-in physics tracing and console export
│   ├── editor.js       # Visual editor tools, canvas interaction, and import/export
│   ├── level-schema.js # Level defaults, normalization, and validation
│   ├── audio.js        # Procedural Web Audio effects
│   ├── config.js       # Shared constants and math helpers
│   ├── drawing.js      # Shared canvas primitives and reusable game-art renderers
│   ├── levels.js       # Terrain materials and generated-catalog loader
│   ├── storage.js      # Preferences, progression, and best times
│   └── terrain.js      # Heightfield and collision sampling
├── editor.html         # Standalone visual level editor
├── LEVEL_FORMAT.md     # Level schema and authoring guide
├── PHYSICS_NEXT_STEPS.md # Physics stabilization and upgrade plan
└── README.md           # Project documentation
```

The prototype intentionally has no runtime dependencies.

## Design tokens

Shared interface colors, spacing, corner radii, typography, and pixel-shadow values are defined as CSS custom properties in `css/game.css`. Trail-specific canvas colors live under `levels/official/` and `levels/custom/`, shared terrain materials and catalog loading live in `js/levels.js`, and simulation constants live in `js/config.js`.

## Technical overview

### Physics

The bike uses two Verlet-integrated wheel points connected by an elastic distance constraint. The simulation runs at a fixed 120 Hz step and includes:

- Gravity and terrain-normal collision resolution
- Rear-wheel traction
- Progressive throttle pressure
- Speed-dependent engine torque
- Slope-aware climbing torque
- Front-biased combined braking
- Rider lean torque and weight transfer
- Momentum preservation in the air and on the ground
- Impact-dependent restitution
- Independent visual suspension state for each wheel

The physics are deliberately game-oriented rather than a complete real-world motorcycle simulation.

### Terrain and levels

Trails use smooth curves defined by control points. Wheel collision tessellates those curves into closed terrain polygons and resolves against the nearest edge or corner, including steep faces. A level can also define any number of elevated solid platforms with independent curved points, thickness, and terrain material. Platform tops, undersides, side walls, and corners participate in collision, and gaps are represented by real breaks with solid cliff walls. Levels can also define collectibles, props, visual colors, a finish position, and weather.

See [`LEVEL_FORMAT.md`](./LEVEL_FORMAT.md) for the complete schema, coordinate system, examples, and design guidelines. The staged collision, suspension, traction, and loop roadmap is documented in [`PHYSICS_NEXT_STEPS.md`](./PHYSICS_NEXT_STEPS.md). Configure rain and lightning independently with `weather: { rain: 0–1, lightning: 0–1 }`. Either property can be omitted, so a trail may have rain, lightning, both, or clear weather.

### Rendering

Everything is rendered with the Canvas 2D API. The gameplay and illustrated How to Play guide share the same rider, bike, apple, and finish-flag renderers, so visual updates remain synchronized. Rendered elements include:

- Terrain and floating islands
- Modular pixel bike, rider, wheels, and suspension
- Smooth vector apples and pixel finish gates
- Layered pixel props and particles
- Smooth terrain and floating islands with anchored pixel mountain silhouettes
- Layered pixel foreground and atmospheric scenery shared by gameplay and the dashboard
- Pixel ground-following shadows

The logical viewport and camera framing adapt to mobile and desktop dimensions.

## Development notes

The game is currently a **design and physics prototype**. Its most important asset is the accumulated handling behavior: throttle response, braking, rider lean, suspension, momentum, and camera feel.

To investigate a sudden physics launch, open the game with `?physicsDebug=1` and reproduce it. The console automatically prints the detected spike as expanded JSON. Run `pocketTrialsPhysicsDebug.dumpSpike()` to print it again or `pocketTrialsPhysicsDebug.copySpike()` to copy it. The rolling trace keeps the latest 360 simulation frames; `dump()` and `copy()` expose the latest 120. Traces include wheel velocities, steep-segment probes, every wheelbase correction, and collision responses.

When changing physics values, validate at least these cases:

1. Starting from rest on a moderate hill
2. Building enough speed to clear a crest
3. Countering an uphill wheelie by leaning forward
4. Braking hard on flat and downhill terrain
5. Landing on one wheel and then both wheels
6. Reversing direction and riding back through a level
7. Crossing the gap in Skybound

## Upcoming features

- [x] Sound Effects
- [x] Different terrain types (grass, dirt, rock, snow, and brick)
- [x] Splatter behind the bike when you drive on different terrain
- [x] Add weather effects (rain, lightning, and procedural ambience)
- [ ] Add import / export of savegames
- [ ] New physics engine with support for overhangs, loops, caves, and fully polygonal ground

## Possible Godot migration

If Pocket Trials grows into a larger game, migrating to **Godot 4** is recommended. The browser version should remain available as the handling reference during that rewrite.

A Godot version would benefit from:

- Visual scene and level editing
- Reusable scenes for bikes, riders, props, apples, and finish gates
- Physics and collision debugging tools
- Animation tooling
- Audio and controller support
- Easier desktop, mobile, and web exports
- Cleaner organization as the number of levels and systems grows

The migration would be a rewrite rather than an automatic conversion. Generic rigid-body joints may not reproduce the current feel, so the existing handling values and test cases should be treated as a gameplay specification.

A likely Godot structure would include:

```text
scenes/
├── bike/
├── riders/
├── levels/
├── props/
└── ui/

scripts/
├── bike_controller.gd
├── suspension.gd
├── level_manager.gd
├── save_manager.gd
└── settings_manager.gd

resources/
├── bike_handling.tres
└── level_data/
```

## Roadmap ideas

- Sound effects and music
- Gamepad support
- More trails and terrain features
- Moving and interactive obstacles
- Improved rider animation
- Ghost runs and replays
- Online or local leaderboards
- Additional bikes and cosmetic customization
- A visual level-building workflow

## Inspiration

Pocket Trials is inspired by the momentum, balance, and risk-reward handling of **Elasto Mania**. It is an original prototype and is not affiliated with or endorsed by the creators of Elasto Mania.
