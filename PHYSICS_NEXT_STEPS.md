# Physics next steps

The wheel and ragdoll collision path now uses closed polygons generated from the same smooth terrain curves that are rendered. This replaced the former heightfield-only wheel collision and the temporary steep-drop exceptions.

## Current foundation

- Fixed 120 Hz simulation
- Circle-versus-polygon edge and endpoint collision for ground, gap walls, and platforms
- Position-safe wheelbase correction that does not turn constraint repair into velocity
- A separate velocity pass that prevents wheel separation while conserving center-of-mass velocity
- Opt-in physics traces with `?physicsDebug=1`

## Recommended order

### 1. Stabilize and tune the polygon collision

Test every official trail in both directions, especially:

- Sharp crests and valleys
- Both sides of every gap
- Platform tops, corners, sides, and undersides
- Low-speed approaches and maximum-speed impacts
- Rider/head and ragdoll contacts

Tune collision restitution and grounded-normal thresholds only after these cases are reliable.

### 2. Add swept circle collision

The current 120 Hz timestep prevents most tunneling, but custom levels and extreme crashes can still move a wheel through a thin edge in one step. Add swept circle-versus-segment tests and resolve the earliest time of impact before static overlap correction.

### 3. Introduce XPBD constraints

Replace the current wheelbase stiffness solver with persistent XPBD constraints:

- Reset each constraint multiplier once per substep.
- Use inverse-mass weighting.
- Separate compliance from damping.
- Keep rigid chassis links distinct from suspension links.

Do this behind a physics-version switch until handling matches or improves on the current official trails.

### 4. Add a physical chassis and suspension

Represent the chassis as a rigid body or a non-collinear particle triangle. Connect each wheel through constrained suspension geometry with travel limits. The wheelbase should no longer serve as both frame and suspension.

### 5. Add wheel angular dynamics and traction

Throttle and braking should change wheel angular velocity. Terrain friction should convert contact-point slip into linear and angular impulses. This is the largest remaining step toward authentic Elasto Mania-style handling.

### 6. Add authored paths for loops and overhangs

The current `points` terrain remains an x-ordered heightfield even though its collision is polygonal. Loops require a separate ordered path format that permits multiple points at the same x-coordinate and movement back along x. Rendering, collision, editor handles, and validation must all use that same path geometry.

## Loop support status

Loops are **not currently supported**. The polygon collision foundation is suitable for them, but the current level schema, curve interpolation, renderer, and editor all assume one ground height per x-coordinate.
