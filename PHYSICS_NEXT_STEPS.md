# Physics implementation status

The staged physics roadmap is implemented behind a version switch. Version 2 is the default; append `?physicsVersion=1` to compare the legacy solver. Physics traces remain available with `?physicsDebug=1`.

## Implemented foundation

- Fixed 120 Hz simulation
- Circle-versus-polygon edge and endpoint collision for ground, gap walls, and platforms
- Swept circle-versus-segment collision before static overlap correction for wheels and ragdoll points, plus swept rider crash probes
- Inverse-mass XPBD constraints whose multipliers reset once per substep
- Separate constraint compliance and velocity damping
- A physical non-collinear chassis triangle with rigid links
- Independent suspension links with compliance, damping, and travel limits
- Wheel angular velocity driven by throttle and braking
- Contact-point slip converted into coupled linear/angular friction impulses
- Ordered thick paths for loops and overhangs, shared by rendering, collision, validation, and editor handles
- Opt-in physics traces with `?physicsDebug=1`

## Physics versions

- **Version 1 (legacy):** wheelbase stiffness solver and direct linear drive. Use `?physicsVersion=1` for final regression comparisons.
- **Version 2 (default):** physical chassis, XPBD suspension, swept collision, angular traction, motor/brake reaction torque, and rider-applied chassis torque. It has an independent set of handling constants and does not use version 1's direct wheel forces or synthetic pitch terms.

Existing levels without a `physicsVersion` use version 2. A level may temporarily opt into `"physicsVersion": 1`; the URL query parameter takes precedence.

## Authored path format

The original `points` field remains an x-ordered heightfield, preserving all official trails. A separate `paths` array supports repeated x coordinates, vertical segments, movement back along x, overhangs, and closed loops. Each path is a solid rounded ribbon described by ordered centerline points, `thickness`, `material`, and `closed`.

See [`LEVEL_FORMAT.md`](./LEVEL_FORMAT.md) for the complete schema and editor workflow.

## Validation completed

The automated suite covers:

- Gap openings and cliff walls
- Steep polygon contacts
- Fast circle sweeps against thin segments and authored paths
- Closed-loop outer contact and empty centers
- Open path caps and decreasing-x overhangs
- Position-safe legacy constraints and predicted-position XPBD correction
- Inverse-mass XPBD correction
- Center-of-mass preservation in the legacy velocity pass
- Angular-to-linear traction transfer
- Full version 2 flat acceleration and braking-versus-coasting runs
- Stationary wheel lift and airborne rotation
- Mirrored left/right hill climbing
- Valley settling
- One-wheel landing and second-wheel recovery

The game and deterministic scenarios execute the same DOM-independent `js/vehicle-physics.js` step function. Run the complete suite with `npm test`.

## Manual handling pass still required

Physics constants are centralized in `js/config.js`, but feel tuning requires browser play-testing. Before removing version 1, ride every official trail in both directions and verify:

- Sharp crests and valleys
- Both sides of every gap
- Platform tops, corners, sides, and undersides
- Low-speed approaches and maximum-speed impacts
- Rider/head, chassis, and ragdoll contacts
- Full loops with enough approach speed and appropriately broad radii

Tune restitution, friction, suspension compliance/damping, and the grounded-normal threshold only after this matrix is reliable.

## Version 1 retirement

Keep `?physicsVersion=1` through one final regression pass. After every official trail has been checked in both directions:

1. Freeze the version 2 handling constants and record representative debug replays.
2. Remove the version switch, legacy integration/contact path, and version 1-only constants.
3. Rename version 2 types and APIs to unversioned vehicle-physics names.
4. Profile the default solver before optimizing; prioritize terrain contact queries and repeated constraint-array allocation only when measurements show they matter.
5. Keep the deterministic vehicle scenarios as the handling regression suite.
