# Physics implementation status

The staged physics roadmap is implemented in `js/vehicle-physics.js`: a physical chassis, XPBD suspension, swept collision, angular traction, motor/brake reaction torque, and rider-applied chassis torque. The original two-wheel distance-constraint solver has been removed. Physics traces remain available with `?physicsDebug=1`.

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
- Predicted-position XPBD correction
- Inverse-mass XPBD correction
- Center-of-mass preservation in the distance velocity projection
- Angular-to-linear traction transfer
- Full-vehicle flat acceleration and braking-versus-coasting runs
- Stationary wheel lift and airborne rotation
- Mirrored left/right hill climbing
- Valley settling
- One-wheel landing and second-wheel recovery

The game and deterministic scenarios execute the same DOM-independent `js/vehicle-physics.js` step function. Run the complete suite with `npm test`.

## Manual handling pass still required

Physics constants are centralized in `js/config.js`, but feel tuning requires browser play-testing. Ride every official trail in both directions and verify:

- Sharp crests and valleys
- Both sides of every gap
- Platform tops, corners, sides, and undersides
- Low-speed approaches and maximum-speed impacts
- Rider/head, chassis, and ragdoll contacts
- Full loops with enough approach speed and appropriately broad radii

Tune restitution, friction, suspension compliance/damping, and the grounded-normal threshold only after this matrix is reliable.

## Next steps

1. Record one representative debug replay per official trail and add them to the deterministic vehicle scenarios as the handling regression suite.
2. Profile the solver before optimizing; prioritize terrain contact queries and repeated constraint-array allocation only when measurements show they matter.
