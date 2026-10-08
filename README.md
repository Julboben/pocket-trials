# Hjulben

Hjulben is a small side-scrolling motorcycle trials game inspired by the physics-driven handling of **Elasto Mania**. Build momentum over rolling terrain, shift the rider's weight, control wheelies and stoppies, collect every apple, and reach the finish flag without putting the rider's helmet into the ground.

The current version is a dependency-free browser prototype built with native JavaScript modules, Canvas rendering, and custom Verlet-style bike physics.

## Features

- Momentum-driven motorcycle handling
- Rear-wheel-only throttle
- Progressive throttle and speed-dependent torque
- Combined braking with dynamic front-wheel bias
- Rider weight transfer, wheelies, and stoppies
- Independent front and rear suspension animation
- Impact-sensitive suspension compression and landing rebound
- Live post-crash rider ragdoll that keeps the bike's spin when thrown, with a weighted body, limited neck, hip, elbow and knee joints, ground grip, and collisions with the crashed bike, which keeps colliding with the ground and can still hang from a ledge; a hard enough hit to the head knocks the helmet off, which tumbles, rolls, floats and bumps into the bike on its own, leaving the rider bare-headed
- Direction flipping with an animated rider and bike transition
- Code-drawn pixel presentation with smooth terrain, mountains, and apples for readability
- Responsive mobile and expanded desktop layouts with optional fullscreen play
- Keyboard, touch, and gamepad controls with remappable keys
- Ghost of your best run, or the world's best, with split deltas at each apple
- Results screen with rank, personal best, flips, and gold/silver/bronze medal targets
- The run timer starts on your first input
- Installable as an offline-capable web app
- Two rider styles and a custom rider name
- Elasto Mania-style pixel dirt bike, with the original Pocket Classic bike kept for future biker customization
- Layered foreground and background scenery
- Pixel lighting at every time of day: ground stays bright by day and sinks into darkness at night, caves closed off by a back wall are dark at any hour while open hollows let the sky through, a headlight you can switch off that stays on the bike through flips and loops, lanterns, lamps, glowing mushrooms, and lightning light the way
- Terrain-colored wheel spray, brake lights, and fading ground skid marks
- Procedural engine, braking, wheel-landing, aerial trick, collectible, crash, flip, finish, dashboard, and rain sound effects
- Collectibles, finish gates, timers, and best times
- Persisted settings and trail progression
- Seven progressively longer trails with gaps, caves, and floating blocks to ride across
- Bonus trails outside the career, often made by other riders, with their own best times and world boards, some unlocked by finishing trails or winning gold medals
- Grass, dirt, sand, concrete, stone, snow, brick, and glass terrain materials
- Per-trail rain, snow, and lightning configuration with procedural rain and storm-wind ambience and distance-aware thunder
- Water you can ride through: shallow fords drag the bike and slow it down, deeper water wipes the rider out, and the ragdoll floats on the surface with splashes, wakes and sound; water lilies, reeds, seaweed, fish that dart off and ducks that take off when you come close
- Squirrels that run to the nearest tree, climb it and hide in the crown when you come close

## Play

Run a local static server from the project directory:

```sh
npm run dev
```

This starts a small dependency-free Node server at `http://127.0.0.1:8080` (override with `PORT=…`). It generates `trails/catalog.json`, regenerates it when a trail JSON file changes, and lets the editor save trails straight into `trails/official/`, `trails/bonus/` and `trails/custom/`. It never reloads the page on its own, so a running game is not interrupted; refresh manually after changing code.

A local server is required because the game uses native JavaScript modules and fetches trail JSON, which browsers block on `file://`. Any static server also works for playing, for example on a static host, but only `npm run dev` enables saving trail files from the editor.

## Controls

| Action                           | Keyboard                                  | Touch                                       |
| -------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Gas                              | `Up Arrow` or `W`                         | Gas button                                  |
| Brake                            | `Down Arrow` or `S`                       | Brake button                                |
| Lean backward / forward          | `Left Arrow` / `Right Arrow` or `A` / `D` | Lean buttons                                |
| Flip riding direction            | `Space`                                   | —                                           |
| Headlight on / off               | `L` (remappable)                          | Lights button in the control area           |
| Restart trail                    | `R`                                       | Retry under the crash notice, or in the menu |
| Pause / resume                   | `P`                                       | Pause button                                |
| Open / close the main menu       | `Escape`                                  | In-game menu button                         |
| Toggle fullscreen                | `F` (remappable)                          | Fullscreen On/Off in Settings               |
| Navigate dashboard controls      | Arrow keys or `W` / `A` / `S` / `D`       | Tap a menu item                             |
| Activate the focused menu action | `Enter` or `Space`                        | Tap a menu item                             |

Lean labels adjust to the direction the rider is facing. Every keyboard action can be rebound under **Settings → Keys**. Holding restart freezes the bike until you let go, so you can line up a clean start.

Gamepads use the standard mapping: `RT` or `A` for gas, `LT` or `X` for brake, the left stick or d-pad to lean, `B` to turn around, d-pad up for the headlight, `Y` to restart, and `Start` to pause. In menus, the d-pad or stick moves the selection, `A` confirms, and `B` goes back.

## Trails

1. **The Orchard** — gentle rollers that teach throttle rhythm and basic balance.
2. **Apple Valley** — growing rollers and a big hill that teach carrying momentum, and a small hop to reach the flower.
3. **Windfall** — turning around: ride away to build speed, turn, and launch back to an apple high behind you.
4. **Splinter Ridge** — longer, steeper woodland hills that teach momentum management and crest control.
5. **High Hopes** — steep climbs and bigger landings that reward early weight shifts.
6. **Skybound** — two committed jumps across a narrow middle section.
7. **Brake Point** — sharp drops and deep bowls that teach controlled braking and recovery.
8. **Long Way Up** — a sustained technical climb combining momentum and wheelie control.
9. **Elastic Summit** — a long final exam combining climbs, braking, landings, gaps, and stacked ledges.

The planned full career is laid out in [`TRAILS_PLAN.md`](./TRAILS_PLAN.md).

Each trail requires collecting every apple before the finish gate will open. Completing a trail unlocks the next one. Selecting a trail starts it immediately, and its number and name remain visible as a lower-left course marker.

## Trail editor

Open the visual editor from **Trail Editor** on the main dashboard or navigate directly to `editor.html`. The left column has two tabs:

- **Tools**: tools grouped into Navigate, Terrain, Objects, and Course. Picking a tool shows its settings (for example block material, spike radius and spin, water width and depth, or prop type) before anything is placed. New objects use those settings, which are remembered between sessions. `V` or `Escape` selects, and `H` pans.
- **Trail**: trail name, finish and fall positions, and weather.

The inspector on the right edits the current selection. The editor supports:

- Loading every official, bonus and custom trail, with its source clearly labeled
- Drawing terrain blocks and cutting caves, entrances, and gaps into them, freehand or, holding `Alt`, as rectangles and, holding `Cmd`/`Ctrl`, as circles; `Shift` snaps to the grid
- Drawing and cutting back walls: the Block and Cut tools have a **Layer** picker (Terrain or Back wall), the inspector switches a selected block between layers, and **Fill caves with back walls** closes off the selected block's caves
- Dragging block points and curve handles, switching edges between straight and curved, and moving whole blocks (once selected, a block drags from anywhere inside it; `Esc` or `Cmd`/`Ctrl`+`D` deselects, and `Shift`-click adds or removes a block, point or object); holding `Shift` snaps the point or corner you hold to 15° steps and the grid
- Scaling selected blocks with the handles around them: corners keep the proportions, so a circle stays a circle, sides stretch one way, `Alt` scales from the centre and `Shift` snaps to the grid
- Double-clicking a block edge to insert a point
- Placing freely positioned apples, start points, props, and finish positions
- Moving or removing props and changing their type and foreground/background layer
- Placing spinning spike hazards and editing their radius and spin speed
- Drawing water bodies with the **Water** tool (`W`): drag a rectangle, or click to drop one of the tool's size. Drag a body by the middle of its surface, resize it with the scale handles, and set its width and depth in the inspector, which says whether it is a rideable ford or deep enough to wipe the rider out
- Choosing the start position and left/right facing direction
- Selecting the base and per-block materials
- Editing sun, cloud, fog, rain, snow, and lightning values
- Trackpad navigation: two-finger scrolling pans and pinch gestures zoom around the pointer
- Mouse navigation: wheel panning, `Ctrl`/`Cmd` + wheel zooming, and middle-button or `Space`-drag panning
- Undo and redo
- Copy, cut and paste (`Cmd`/`Ctrl` + `C`, `X`, `V`) for blocks, apples, props, spikes and water. The copy goes to the system clipboard, so it can be pasted into another trail or tab; it lands under the cursor, or in the middle of the view.
- Box-select picks up whole blocks along with points and objects; `Shift`-click adds or removes one (for example a prop inside a selected block), `Cmd`/`Ctrl` + `A` selects everything, and `Cmd`/`Ctrl` + `D` selects nothing. Undo and redo restore the selection too.
- Play testing in place (`Cmd`/`Ctrl` + `Enter`); add `Shift` to start the bike where the mouse is, without moving the trail's start
- Press `?` (or **Keyboard shortcuts** in the **⋯** menu) for a list of every shortcut.
- Continuous trail validation, listed in the **⋯** menu, which shows a badge when there are errors or warnings
- Browser-local draft history (**Save draft** in the header, `Cmd`/`Ctrl` + `S`): up to 12 timestamped drafts per trail. The editor opens the newest draft unless the trail was saved after it. The label next to the trail picker shows which version is open (original, published, or a draft) and whether it has edits since; click it to open **Versions**, where you can open any draft, delete drafts, or revert to the published trail (undoable). **Save draft** is greyed out until the trail changes from the open version, and **Publish** until it differs from the published trail. The inspector panel is hidden until something is selected.
- Autosave: unsaved edits are kept in the browser a second after each change, and when the tab is closed, hidden or switched to another trail. Reopening the trail restores them on top of the version they were made to, with one undo step back to that version. The autosave is a single slot per trail, separate from the drafts, and is cleared when you save a draft or publish.
- JSON import, plus JSON and JavaScript module export (**Import / export** in the **⋯** menu, which warns when validation errors would block an export)
- **New** (+) and **Duplicate** next to the trail picker, plus **Publish** (`Cmd`/`Ctrl` + `Shift` + `S`) and **Delete** in the **⋯** menu

Where **Publish** writes depends on how the editor is served:

- Under `npm run dev`, official, bonus and file-based custom trails are written directly to their JSON file, and new trails are created in `trails/custom/`. For an official or bonus trail the menu item reads **Overwrite official file…** or **Overwrite bonus file…** and asks for confirmation first.
- On any other server, official and file-based trails are read-only. **New** and **Duplicate** create custom trails stored in the browser (localStorage), which then appear under **Custom Trails** in the game. Players can also add trails with **Import trail** in the game's trail menu.

Editor drafts do not overwrite trail files. Official trails live in `trails/official/`, bonus trails in `trails/bonus/`, and locally authored trails belong in `trails/custom/`. Both use the exact JSON format produced by **Export JSON**. Source classification comes from the generated catalog and folder—not from a user-editable property inside the trail. See [`TRAIL_FORMAT.md`](./TRAIL_FORMAT.md) for the full schema and design guidelines.

## Settings and saved data

The dashboard's Settings view includes:

- Full or reduced scenery
- Visible or hidden on-screen controls
- Sound effects on or off, and master volume
- Screen shake (off by default when the system prefers reduced motion)
- Vibration on landings and crashes (on devices that support it)
- Ghost: your best run, the world's best (falls back to yours offline, and races whichever is faster), or off
- Keyboard bindings
- Fullscreen mode

The game opens on a dedicated dashboard before any trail is loaded or rendered. Settings, trail selection, and an illustrated How to Play guide are full dashboard views rather than separate modals. Control instructions are centralized in the guide instead of being repeated around the gameplay interface. It provides three independent savegame slots. The dashboard has one orange call to action: Resume Ride while a ride is paused, otherwise Continue for the active rider, or Start Riding on a first visit, which goes straight to naming a rider. The Riders view lists every slot: pick a rider to make it active, use an empty slot to create a new one, or delete a rider to free its slot. Saves are never overwritten. A rider is chosen when a slot is created and is permanently tied to that save.

Preferences and all three rider profiles—including each slot's current trail, unlocks, and best times—are stored in browser `localStorage`.

Current storage keys:

- `hjulben-settings-v1`
- `hjulben-saves-v2`
- `hjulben-active-slot-v1`
- `hjulben-leaderboard-v1`
- `hjulben-ghost-v1:<trail>` (inputs of the best run, re-simulated as the ghost)

The dashboard's Leaderboard view ranks the ten fastest finishes per official, bonus and custom trail across all savegames on the device. Runs remain on the board after their savegame is deleted. Every trail is keyed by a hash of what decides a run (terrain, start, finish, apples, spikes, and water), and official and bonus trails also by their id (`official:<id>@<hash>`, `bonus:<id>@<hash>`). Editing a trail's gameplay starts fresh leaderboards, ghosts and best times, online and local, while renaming it or changing its props keeps them.

Clearing site data resets settings, progression, and recorded times. Online riders can get theirs back by logging in (see below).

## Online riders and the world leaderboard

When creating a rider, players choose **Online** (the default) or **Offline**:

- **Online** riders sign up with a **passkey** (fingerprint, face or device PIN). No email or password is involved. The name is reserved for them on the world leaderboard. Names are unique regardless of case, accents, spaces, `_`, `.` and `-`, and offensive or reserved names are refused. Progress is backed up to the server. After clearing site data, or on another device with the same passkey (synced through iCloud, Google or a password manager), **Log in with passkey** on the dashboard or in Riders restores the save, best times and ghosts.
- **Offline** riders stay in the browser and never appear on the world board. **Go Online** in Riders claims the name later and uploads the rider's best runs.

The world board doesn't trust times sent by the browser. A finished run is sent as its recorded inputs. The server replays them through the same deterministic simulation (`js/ride.js`) against the official or bonus trail, checks that it finishes, and uses its own time. It keeps each rider's best run per trail, and its replay becomes the ghost when restoring a save.

Server code lives in `netlify/functions/` (`account.mjs`, `leaderboard.mjs`) and `netlify/lib/`. It uses Neon Postgres and keeps no server-side sessions: logins and passkey challenges are HMAC-signed tokens.

Setup on Netlify:

- `DATABASE_URL`: the Neon connection string.
- `AUTH_SECRET`: a random secret of at least 32 characters, e.g. `openssl rand -base64 48`. Changing it signs everyone out, but they can log back in with their passkey.
- `RP_ID` (optional, default `julben.dk`): the domain passkeys belong to. They work on that domain and every subdomain, such as `h.julben.dk`. Changing it makes existing passkeys unusable.

Tables are created automatically on first use. A rider without a passkey (for example, one imported by hand from an older board) is unclaimed: the first person to create an online rider with that name takes it over, times included. Runs without a replay show on the board but can't be a ghost. Passkeys don't work on `*.netlify.app` deploy previews of the production domain (each preview host has its own), nor in `npm run dev`, which has no functions.

## Project structure

```text
.
├── index.html          # Game markup and module entry point
├── css/
│   ├── game.css        # Game and dashboard presentation
│   ├── editor.css      # Visual trail editor presentation
│   └── icons.css       # Generated pixel icons (from icons/pixel-icons.mjs)
├── icons/
│   └── pixel-icons.mjs # Every UI icon and the logo, drawn as ASCII pixel art
├── design/             # Unused design drafts kept for later (not cached by the game)
├── trails/
│   ├── official/       # Shipped career trails
│   ├── bonus/          # Shipped extra trails outside the career, unlocked by progress
│   ├── custom/         # Locally authored standalone trails
│   └── catalog.json    # Generated trail index
├── netlify/            # Serverless API: passkey accounts, cloud saves, verified leaderboard
├── scripts/            # Catalog generator, dev server, tests, and replay recorder
├── tests/replays/      # One recorded replay per official trail (regression fixtures)
├── js/
│   ├── main.js         # Entry point and service worker registration
│   ├── game.js         # State machine, fixed-step loop, and event handling
│   ├── ride.js         # DOM-free ride simulation: rider probes, spikes, apples, goal, crash
│   ├── ragdoll.js      # Jointed post-crash rider ragdoll
│   ├── det-math.js     # Deterministic sin/cos/atan2/exp/log, identical in every JS engine
│   ├── render.js       # Canvas rendering of the world, bike, ghost, and effects
│   ├── lighting.js     # Light map: baked ambient light plus moving lights, multiplied over the scene
│   ├── light-field.js  # DOM-free ambient light bake from the terrain
│   ├── camera.js       # Camera follow and screen shake
│   ├── effects.js      # Particles, skid marks, and weather
│   ├── fps-meter.js    # Frame-rate readout for ?fps=1
│   ├── input.js        # Keyboard, touch, and gamepad input with remapping
│   ├── state.js        # Shared session state and preferences
│   ├── ui/             # Dashboard menu and in-game overlay/results
│   ├── vehicle-physics.js # Wheel, suspension, and chassis simulation
│   ├── physics.js      # Reusable bike-constraint physics helpers
│   ├── physics-debug.js # Opt-in physics tracing and console export
│   ├── editor/         # Trail editor modules (main.js is the entry, state.js the shared state)
│   ├── trail-schema.js # Trail defaults, normalization, and validation
│   ├── audio.js        # Procedural Web Audio effects
│   ├── config.js       # Shared constants and math helpers
│   ├── drawing.js      # Shared canvas primitives and reusable game-art renderers
│   ├── trails.js       # Terrain materials and generated-catalog loader
│   ├── storage.js      # Preferences, progression, and best times
│   ├── account.js      # Passkey sign-up/login and cloud save sync
│   ├── online-leaderboard.js # World leaderboard client
│   └── terrain.js      # Heightfield and collision sampling
├── editor.html         # Standalone visual trail editor
├── TRAIL_FORMAT.md     # trail schema and authoring guide
├── PHYSICS_NEXT_STEPS.md # Physics stabilization and upgrade plan
└── README.md           # Project documentation
```

The game itself intentionally has no runtime dependencies. Only the Netlify functions use npm packages.

## Design tokens

Shared interface colors, spacing, corner radii, typography, and pixel-shadow values are defined as CSS custom properties in `css/game.css`. Trail-specific canvas colors live under `trails/official/` and `trails/custom/`, shared terrain materials and catalog loading live in `js/trails.js`, and simulation constants live in `js/config.js`.

UI icons are drawn as ASCII grids in `icons/pixel-icons.mjs` (`#` takes the text colour; other letters map to the icon's own palette). Run `npm run icons` to regenerate `css/icons.css`, then use one with `<span data-icon="clock"></span>`, or add one to a label with `data-icon-before`/`data-icon-after`. Set `--px` to scale it (keep it a whole number). The `logo` icon also generates the favicon and app icons (`icons/icon.svg`, `icons/icon-maskable.svg`, `icons/apple-touch-icon.png`).

## Technical overview

### Physics

The bike connects Verlet-integrated wheels through compliant suspension to a rigid XPBD chassis triangle. The simulation runs at a fixed 120 Hz step and includes:

- Gravity, static overlap correction, and swept circle collision
- Angular wheel dynamics and contact-slip traction
- Progressive throttle pressure
- Speed-dependent engine torque
- Slope-aware climbing torque
- Front-biased combined braking
- Rider lean torque and weight transfer
- Momentum preservation in the air and on the ground
- Impact-dependent restitution
- Independent physical and visual suspension state for each wheel

The physics are deliberately game-oriented rather than a complete real-world motorcycle simulation.

### Terrain and trails

Terrain is a list of `terrainBlocks`: connected pieces of solid bounded by straight or curved edges, which may contain caves. Blocks can be any shape, so they cover rolling ground, floating ledges, overhangs, and loops. Each block is compiled into polygons once, and rendering, collision, validation, and the editor all use that same geometry. Wheel collision resolves against the nearest edge or corner, including steep faces and undersides, and gaps are simply breaks between blocks. Trails can also define collectibles, props, visual colors, a finish position, and weather.

See [`TRAIL_FORMAT.md`](./TRAIL_FORMAT.md) for the complete schema, coordinate system, examples, and design guidelines. The staged collision, suspension, traction, and loop roadmap is documented in [`PHYSICS_NEXT_STEPS.md`](./PHYSICS_NEXT_STEPS.md). Configure rain and lightning independently with `weather: { rain: 0–1, lightning: 0–1 }`. Either property can be omitted, so a trail may have rain, lightning, both, or clear weather.

### Rendering

Everything is rendered with the Canvas 2D API. The gameplay and illustrated How to Play guide share the same rider, bike, apple, and finish-flag renderers, so visual updates remain synchronized. Rendered elements include:

- Terrain blocks, caves, and floating ledges
- Back walls: scenery behind the terrain that keeps caves dark
- Modular pixel bike, rider, wheels, and suspension. Bike models are listed in `BIKE_MODELS` in `js/drawing.js` and chosen with the `bike` option of `drawBike`. `elasto` is the default and `classic` is the original bike
- Smooth vector apples and pixel finish gates
- Layered pixel props and particles
- Pixel terrain with anchored pixel mountain silhouettes
- Layered pixel foreground and atmospheric scenery shared by gameplay and the dashboard
- Pixel ground-following shadows

The logical viewport and camera framing adapt to mobile and desktop dimensions.

## Development notes

The game is currently a **design and physics prototype**. Its most important asset is the accumulated handling behavior: throttle response, braking, rider lean, suspension, momentum, and camera feel.

`sw.js`'s file list, `js/version.js`, `css/icons.css`, the app icons and `TRAIL_AUTHORING_CONTEXT.md` (the trail spec, schema, materials and example trails bundled for trail authors) are generated: run `npm run sw`, `npm run icons` and `npm run context` after changing their sources. `npm test` fails while any of them is out of date.

To test as a brand-new player on `localhost`, open the game or editor with `?sandbox`. All data then lives in that tab's `sessionStorage`: your real saves are never read or changed, online submits are skipped, and a SANDBOX badge shows at the bottom. The sandbox survives reloads, the editor, and playtests. Use `?sandbox=reset` to start fresh again and `?sandbox=off` to go back to your real data.

To check performance, open the game with `?fps=1`: a small readout shows frames per second, the average time each frame's work takes, and the slowest frame gap, refreshed twice a second.

To investigate physics, open the game with `?physicsDebug=1`. The overlay shows particles, constraints, contact normals, and center of mass. The console automatically prints detected spikes as expanded JSON. Run `hjulbenPhysicsDebug.dumpSpike()` or `copySpike()` for the latest spike, and `dump()` or `copy()` for the latest 120 frames. Record deterministic input with `startRecording()` and `stopRecording()`, then replay the returned array with `replay(inputs)`; call `stopReplay()` to return to live controls. Traces include wheel velocities, angular/contact state, torque components, suspension lengths, chassis area, constraints, traction, and collision responses.

`npm test` also runs the DOM-independent vehicle harness in `scripts/test-vehicle-physics.mjs`. It exercises flat acceleration, braking versus coasting, stationary wheel lift, air rotation, mirrored hills, valley settling, and one-wheel landing through the exact `js/vehicle-physics.js` code used by the game.

`scripts/test-replays.mjs` replays one recorded run per official trail through `js/ride.js` and checks that the finish time, apples, and crash outcome are unchanged, with no NaN values and no terrain tunnelling. After an intentional handling change, re-record the fixtures with `npm run replays`. A search bot drives each trail and writes `tests/replays/*.json`. The simulation only uses `js/det-math.js` for transcendental functions, so a replay recorded in Node plays back bit-for-bit in the browser. Don't use `Math.sin`, `Math.atan2`, `Math.exp`, and similar functions in simulation code, because their last-digit results differ between JavaScript engines.

Run `npm run check` (syntax), `npm run typecheck` (JSDoc types in `// @ts-check` files), and `npm test` before pushing. After `npm ci`, `npm run test:online` tests the online API against an in-memory Postgres (PGlite) using a software passkey. It covers sign-up, unique names, login, cloud saves, and rejection of tampered runs. CI runs all of these.

When changing physics values, validate at least these cases:

1. Starting from rest on a moderate hill
2. Building enough speed to clear a crest
3. Countering an uphill wheelie by leaning forward
4. Braking hard on flat and downhill terrain
5. Landing on one wheel and then both wheels
6. Reversing direction and riding back through a trail
7. Crossing the gap in Skybound

## Roadmap ideas

- [ ] Music
- [ ] Add import / export of savegames
- [ ] Add animation to props like with the water props
- [ ] Biker customization: choose your bike (the original Pocket Classic bike is already drawn as the `classic` model), and later colors and gear
- [ ] Add background: Coast (a sea horizon with an island) and Canyon (layered cliff walls with rock spires) each only need a new entry in backdropLayers and BACKDROP_COLORS, plus an option in the dropdown.
- [ ] More offical trails
- [ ] Moving and interactive obstacles
- [ ] Improved rider animation
- [ ] Additional bikes and cosmetic customization
- [ ] Grip. Right now every material has the same grip, because WHEEL_FRICTION is a single value. If you want sand to feel softer or more slippery, per-material grip can be added. It would change how runs replay, though, so you'd need to raise RIDE_VERSION and re-record the replays. Let me know if you want that.
- [ ] Map called Meteor Crater - you drive down a crater and then up again.
- [ ] Make the ragdoll controllable
- [x] Sound Effects
- [x] Different terrain types (grass, dirt, concrete, stone, snow, and brick)
- [x] Splatter behind the bike when you drive on different terrain
- [x] Add weather effects (rain, lightning, and procedural ambience)
- [x] Add day / night
- [x] Lighting engine (dark caves, night, headlight, prop lights)
- [x] Online highscore leaderboard
- [x] Drivable water bodies with adjustable depth: deep water wipes the rider out, and the ragdoll floats

## Inspiration

Hjulben is inspired by the momentum, balance, and risk-reward handling of **Elasto Mania**. It is an original prototype and is not affiliated with or endorsed by the creators of Elasto Mania.
