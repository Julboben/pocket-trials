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
- A front fork and a rear shock that differ as on a motocross bike, each with a rising-rate spring in place of a stiff bump stop, and a bottoming cone (`FORK_SUSPENSION` and `SHOCK_SUSPENSION` in `js/config.js`):
  - The fork is linear until its air spring ramps up over the last 7 px of travel. Its lighter damping (0.22 compression, 0.38 rebound) lets it recover quickly for the next bump. It sags 3.4 px at rest
  - The shock's linkage makes it progressive over the whole stroke, from a soft start: it sags 5 px at rest, about a third of its travel as race sag is set, which leaves it droop to keep the tire on the ground as the weight comes off it. Firmer damping (0.28 compression, 0.55 rebound) keeps it from kicking the bike over the bars
  - From 9 px of compression each end's compression damping climbs with the square of the way into the zone, to 0.95 at full travel
  - With no bump stop to store the end of a landing and hand it back, a 200 px flat drop throws the chassis back up at about 31 px/s and a 350 px one at 33 px/s, where the stiff bump stop gave 42 and 66. Landing hard on one wheel, 200 px at 35°, no longer bucks the bike over the other wheel, and of 600 test drops with no rider input, 65 crash within 3 s instead of 163. With gas held the gain is small (309 instead of 335), as most of those crashes are throttle wheelies looping over after a clean landing. The cost is honest bottoming on the biggest flat drops: from 200 px (about 6 m at the bike's scale) the soft-started shock touches the travel limit for a few steps
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
- Hard landings: a gentle rebound from big flat drops with only brief bottoming, and no buck over the other wheel after landing hard on one
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

## Damper coupling

The suspension damper is a velocity pass after the contact and traction solve, and it is coupled to the tires correctly: its force reaches the ground through the wheel on the next contact solve, as a real damper pushes on the wheel and the wheel on the ground. Measured over 40–300 px drops, the ground force the tires record (`groundLoad`, which tire grip uses) matches the force the ground really gave the bike, from its change in momentum, within 0.1% on every step, with or without the bottoming cone. Stronger damping therefore does not take grip away. When a tuning change seems to, look at timing first: a locked bike rocks on its springs for a moment as it stops, which is why the 35° hill brake check looks for a stop held over a window rather than at one step.

## Next steps

1. Make the 45° climb check robust. Started from standstill at the foot of a 45° hill, the bike reaches the top from only 1 of 8 nearby start positions (270–300 px), with the old suspension as with the new, and the check uses that one. Any handling change can tip it, which makes it look like the change broke climbing. Checking a spread of start positions would test climbing itself.
2. Replace the bot-recorded fixtures with hand-ridden replays once handling tuning settles, since bot lines avoid some of the riskier features.

## Tried and rejected

- A rear shock as stiff at the start as the fork, with the rising rate on top. It sags less, runs out of droop as the bike rolls back off the foot of a hill and the weight comes off the rear, and the rear wheel lifts and spins freely. Only a softer start, as race sag is set on a real shock, kept it on the ground.
- Stopping the stroke before the travel limit with a steeper end ramp. Any spring stiff enough to keep a 200 px flat drop off the limit stores that landing and hands it back as a kick, and up to twice as many test drops crash. The bottoming cone cannot do it alone: the stroke lasts about 7 steps, and with the wheel on the ground most of the damper's push goes into the ground.
- Looser wheel sliders (more wheel play along the frame). With no wheel-to-wheel link, the sliders are what hold the wheelbase. Raising `XPBD_SUSPENSION_SLIDER_COMPLIANCE` from 0.0001 to 0.0002 already stops the 45° climb (the bike loops out) and the 35° hill brake. A free play of 1–3 px with a stiff limit is worse: it breaks hanging from a ledge, stoppies and flat throttle. The wheelbase give from the removed link already supplies the elastic feel.

## Profiling (2026-10)

The official replays run at about 30 µs per step in Node on an M-series laptop, which is roughly 0.4% of one core at 120 Hz. Self time is spread out. `stepVehicle` takes about 19%, the constraint solvers together about 20%, and terrain contact and sweep queries about 20%. The rest is GC and ride bookkeeping.

- Solver passes: 5 position / 2 velocity passes pass the whole suite with almost the same metrics. They save only about 13% of step time, but frame flex on hard drops nearly doubles (0.3 → 0.53 px). 7 / 3 stays.
- `nearestLiveInBody` was the biggest single hotspot (12%). It now runs without allocations and skips the square root for pieces that are no closer. Results are bit-identical, and it costs about half as much.
- Physics is not where weak phones spend their frame budget. Profile rendering next.
