# Physics implementation status

The staged physics roadmap is implemented in `js/vehicle-physics.js`: a physical chassis, XPBD suspension, swept collision, angular traction, motor/brake reaction torque, and rider-applied chassis torque. The original two-wheel distance-constraint solver has been removed. Physics traces remain available with `?physicsDebug=1`.

## Implemented foundation

- Fixed 120 Hz simulation
- Circle-versus-polygon edge and corner collision against compiled terrain blocks
- Swept circle-versus-segment collision before static overlap correction for wheels and ragdoll points, plus swept rider crash probes
- Inverse-mass XPBD constraints whose multipliers reset once per substep
- Separate constraint compliance and velocity damping
- A physical non-collinear chassis triangle with rigid links
- Independent suspension links with compliance, damping, and travel limits
- No wheel-to-wheel link: as in Elasto Mania, each wheel hangs from the chassis on its own leg, so the wheelbase gives a few pixels on hard landings
- Elasto Mania-style suspension stretch: springs are softer pulled than pushed, with a top-out spring, so a bike hooked on a ledge by one wheel hangs visibly stretched from it and bobs before settling
- The drawn body, lamps, rider and hair sit exactly on the simulated chassis, with suspension travel interpolated between steps for high-refresh displays
- Tire grip is Coulomb friction on the real ground force: each wheel's normal impulse is summed from every contact correction in a step (including chassis weight passed through the suspension and landings), with static grip for a gripping tire and lower kinetic grip for a slipping one. Drive and re-traction passes share that budget, so a slow crawl tops out at about 57° with no slope-specific grip rules. The push that keeps a lone grounded wheel planted under rider lean is not weight and gives no grip
- The motor spins the tread at most a small slip ahead of the ground, and engine torque only tapers while the wheel turns forward, so the throttle hooks up to stop a bike sliding back down a hill
- Wheel angular velocity driven by throttle and braking
- Contact-point slip converted into coupled linear/angular friction impulses
- Block terrain for loops, caves, and overhangs, with one compiled geometry shared by rendering, collision, validation, and the editor
- Opt-in physics traces with `?physicsDebug=1`

## Terrain format

Terrain is a list of `terrainBlocks`. Each block has one or more solid regions, each with an outer boundary and optional cave boundaries, built from straight or curved edges. That supports overhangs, vertical faces, movement back along x, and closed loops.

See [`TRAIL_FORMAT.md`](./TRAIL_FORMAT.md) for the complete schema and editor workflow.

## Validation completed

The automated suite covers:

- Gap openings and cliff walls
- Floating block tops, sides, corners, and undersides
- Steep polygon contacts
- Fast circle sweeps into blocks
- Caves, nested blocks, and overhangs
- Predicted-position XPBD correction
- Inverse-mass XPBD correction
- Center-of-mass preservation in the distance velocity projection
- Angular-to-linear traction transfer
- Full-vehicle flat acceleration and braking-versus-coasting runs
- Stationary wheel lift and airborne rotation
- Mirrored left/right hill climbing
- Valley settling
- One-wheel landing and second-wheel recovery
- Hanging from a ledge by one wheel
- Steep hills: 45° climbable from a standstill, 58° and 60° stall low, 78° walls never
- A recorded gas-and-forward-lean attempt at a 64.5° hill stays at its foot
- Braking a bike sliding back down a 35° hill to a stop, then recovering on the throttle

- One recorded replay per official trail (`tests/replays/`), replayed through the DOM-free `js/ride.js` to check finish time, apples, crash outcome, NaN values, and tunnelling
- Seeded ragdoll determinism, elbow/knee hinge limits, neck/hip angle limits, ragdoll sleep, and the crashed chassis resting on the ground
- Chassis-anchored rider probes that follow chassis pitch; only the head crashes on terrain, while spikes hurt the head, shoulders and hips

The game and deterministic scenarios execute the same DOM-independent `js/ride.js` and `js/vehicle-physics.js` step functions. Run the complete suite with `npm test`.

## Cross-engine determinism

V8 in Chrome and V8 in Node return different last-digit results for `Math.sin`, `cos`, `atan2`, `exp`, `log`, and related functions. A one-ULP difference compounds into a different run within a few hundred steps. Simulation code therefore imports these functions from `js/det-math.js`, which implements them with only `+ − × ÷` and `sqrt` (both exactly rounded by IEEE 754), ported from fdlibm/musl. `scripts/test-det-math.mjs` checks their accuracy against `Math`. Keep `Math.*` transcendentals out of `ride.js`, `ragdoll.js`, `vehicle-physics.js`, `physics.js`, and `terrain.js`. They are fine in rendering code.

## Manual handling pass still required

Physics constants are centralized in `js/config.js`, but feel tuning requires browser play-testing. Ride every official trail in both directions and verify:

- Sharp crests and valleys
- Both sides of every gap
- Floating block tops, corners, sides, and undersides
- Low-speed approaches and maximum-speed impacts
- Rider/head, chassis, and ragdoll contacts
- Full loops with enough approach speed and appropriately broad radii

Tune restitution, friction, suspension compliance/damping, and the grounded-normal threshold only after this matrix is reliable.

## Next steps

1. Replace the bot-recorded fixtures with hand-ridden replays once handling tuning settles, since bot lines avoid some of the riskier features.

## Tried and rejected

- Looser wheel sliders (more wheel play along the frame). With no wheel-to-wheel link, the sliders are what hold the wheelbase. Raising `XPBD_SUSPENSION_SLIDER_COMPLIANCE` from 0.0001 to 0.0002 already stops the 45° climb (the bike loops out) and the 35° hill brake. A free play of 1–3 px with a stiff limit is worse: it breaks hanging from a ledge, stoppies and flat throttle. The wheelbase give from the removed link already supplies the elastic feel.

## Profiling (2026-10)

The official replays run at about 30 µs per step in Node on an M-series laptop, which is roughly 0.4% of one core at 120 Hz. Self time is spread out. `stepVehicle` takes about 19%, the constraint solvers together about 20%, and terrain contact and sweep queries about 20%. The rest is GC and ride bookkeeping.

- Solver passes: 5 position / 2 velocity passes pass the whole suite with almost the same metrics. They save only about 13% of step time, but frame flex on hard drops nearly doubles (0.3 → 0.53 px). 7 / 3 stays.
- `nearestLiveInBody` was the biggest single hotspot (12%). It now runs without allocations and skips the square root for pieces that are no closer. Results are bit-identical, and it costs about half as much.
- Physics is not where weak phones spend their frame budget. Profile rendering next.
