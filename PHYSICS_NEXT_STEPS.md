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

- One recorded replay per official trail (`tests/replays/`), replayed through the DOM-free `js/ride.js` to check finish time, apples, crash outcome, NaN values, and tunnelling
- Seeded ragdoll determinism, elbow/knee hinge limits, and the crashed chassis resting on the ground
- Chassis-anchored rider probes that follow chassis pitch

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
2. Profile the solver before optimizing further. The terrain collision index, hot-path allocation, and curve lookup work are already done.
