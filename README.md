# Pocket Trials

Pocket Trials is a small side-scrolling motorcycle trials game inspired by the physics-driven handling of **Elasto Mania**. Build momentum over rolling terrain, shift the rider's weight, control wheelies and stoppies, collect every apple, and reach the finish flag without putting the rider's helmet into the ground.

The current version is a dependency-free browser prototype implemented in a single HTML file with Canvas rendering and custom Verlet-style bike physics.

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
- Responsive mobile and desktop layouts
- Keyboard and touch controls
- Two selectable riders: Max and Maxine
- Layered foreground and background scenery
- Collectibles, finish gates, timers, and best times
- Persisted settings and level progression
- Four trails, including a floating-island jump

## Play

Open `index.html` directly in a modern browser, or run a local static server from the project directory:

```sh
npx live-server
```

Then open the URL printed by `live-server`.

No install or build step is required for the game itself.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Gas | `Up Arrow` or `W` | Gas button |
| Brake | `Down Arrow` or `S` | Brake button |
| Lean backward / forward | `Left Arrow` / `Right Arrow` or `A` / `D` | Lean buttons |
| Flip riding direction | `Space` | — |
| Restart trail | `R` | Compact restart button in the game viewport |
| Pause / resume | `Escape` | Pause button |
| Activate the primary menu action | `Enter` | Menu button |

Lean labels adjust to the direction the rider is facing.

## Trails

1. **The Orchard** — an introductory rolling trail.
2. **Rolling Country** — longer hills requiring better momentum management.
3. **High Hopes** — taller climbs and more demanding landings.
4. **Skybound** — a launch across a real terrain gap onto a floating island.

Each trail requires collecting all five apples before the finish gate will open. Completing a trail unlocks the next one.

## Settings and saved data

The settings menu includes:

- Rider selection

- Camera framing
- Full or reduced scenery
- Visible or hidden control hints

Preferences, the current trail, unlocked trails, and best times are stored in browser `localStorage`.

Current storage keys:

- `pocket-trials-settings-v1`
- `pocket-trials-progress-v1`
- `pocket-trials-v1-<level>` for per-level best times

Clearing site data resets settings, progression, and recorded times.

## Project structure

```text
.
├── index.html   # Game markup, styling, rendering, input, physics, and levels
└── README.md    # Project documentation
```

The prototype intentionally has no runtime dependencies.

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

Trails are smooth analytic heightfields defined by control points. Terrain derivatives provide wheel contact normals and slope information. Levels can also define collision-free gaps, floating islands, collectibles, props, visual colors, and a finish position.

### Rendering

Everything is rendered with the Canvas 2D API, including:

- Terrain and floating islands
- Modular pixel bike, rider, wheels, and suspension
- Smooth vector apples and pixel finish gates
- Layered pixel props and particles
- Smooth terrain and floating islands with anchored pixel mountain silhouettes
- Pixel foreground and atmospheric scenery
- Pixel ground-following shadows

The logical viewport and camera framing adapt to mobile and desktop dimensions.

## Development notes

The game is currently a **design and physics prototype**. Its most important asset is the accumulated handling behavior: throttle response, braking, rider lean, suspension, momentum, and camera feel.

When changing physics values, validate at least these cases:

1. Starting from rest on a moderate hill
2. Building enough speed to clear a crest
3. Countering an uphill wheelie by leaning forward
4. Braking hard on flat and downhill terrain
5. Landing on one wheel and then both wheels
6. Reversing direction and riding back through a level
7. Crossing the gap in Skybound

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
