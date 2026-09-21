// Core dimensions and simulation timing.
export const STEP = 1 / 120;
export const RADIUS = 12;
export const WHEELBASE = 50;
export const TAU = Math.PI * 2;

// Handling values. These are intentionally centralized for feel-tuning.
export const GRAVITY = 380;
export const MAX_DRIVE_SPEED = 340;
export const MAX_POINT_SPEED = 760;
export const ENGINE_FORCE = 800;
export const BRAKE_FORCE = 1150;
export const GROUND_LEAN_TORQUE = 820;
export const AIR_LEAN_TORQUE = 300;
export const COAST_RESISTANCE_LOW_SPEED = 105;
export const COAST_RESISTANCE_HIGH_SPEED = 18;
export const COAST_SPEED_REFERENCE = 140;
export const UPHILL_TORQUE_BOOST = 1.4;

// Constraint and contact solver tuning.
export const BIKE_SOLVER_ITERATIONS = 7;
export const BIKE_VELOCITY_ITERATIONS = 3;
export const BIKE_CONSTRAINT_STIFFNESS = .43;
export const XPBD_CHASSIS_COMPLIANCE = 0.000001;
export const XPBD_CHASSIS_AREA_COMPLIANCE = 0.000001;
export const XPBD_SUSPENSION_COMPLIANCE = 0.00055;
export const XPBD_SUSPENSION_DAMPING = .67;
export const XPBD_LONGITUDINAL_COMPLIANCE = 0.00018;
export const XPBD_LONGITUDINAL_DAMPING = .08;
export const XPBD_CROSS_LINK_COMPLIANCE = 0.00024;
export const XPBD_CROSS_LINK_DAMPING = .06;
export const SUSPENSION_REST_LENGTH = 20;
export const SUSPENSION_TRAVEL = 13;
export const WHEEL_INERTIA = .5;
export const WHEEL_FRICTION = .92;
// Version 2 physical controls. Acceleration, top speed, rider lean, and
// throttle/brake pitch are tuned to version 1. The forces still come from
// tire torque and the chassis, not from version 1's direct wheel pushes.
export const XPBD_CHASSIS_MOUNT_INVERSE_MASS = .65;
export const XPBD_CHASSIS_TOP_INVERSE_MASS = .5;
// No-slip split of version 1's 400 px/s². Grip below is high enough that this
// torque reaches the ground instead of spinning the driven wheel. Top speed is 340.
export const XPBD_MOTOR_ANGULAR_ACCELERATION = 708;
export const XPBD_MAX_DRIVE_SPEED = 340;
// Full reaction torque. With version 1's drive strength this stays grounded
// on flat ground and still lifts the front on a climb.
export const XPBD_MOTOR_REACTION_SCALE = 1;
export const XPBD_RIDER_GROUND_ANGULAR_ACCELERATION = 26;
export const XPBD_RIDER_AIR_ANGULAR_ACCELERATION = 12;
export const XPBD_THROTTLE_LEAN_ASSIST = .12;
export const XPBD_THROTTLE_INPUT_RESPONSE = 1.1;
export const XPBD_LEAN_INPUT_RESPONSE = 5.8;
export const XPBD_UPHILL_FORWARD_LEAN_REDUCTION = 0;
export const XPBD_UPHILL_FORWARD_LEAN_MOTOR_BOOST = .25;
export const XPBD_UPHILL_ANTI_WHEELIE_ACCELERATION = 0;
// Brake dive follows travel speed, capped at version 1's 1.2 × full-lean pitch.
export const XPBD_BRAKE_REACTION_SCALE = .85;
export const XPBD_BRAKE_REACTION_LIMIT = 39.36;
// Produces approximately version 1's full-pressure braking deceleration.
export const XPBD_BRAKE_RATE = 64;
// Brake grip stays moderate. Drive grip is high enough that hitting the gas
// hooks the tire up instead of spinning it out the way a direct version 1 push does.
export const XPBD_CONTACT_LOAD_SCALE = 4.5;
export const XPBD_DRIVE_LOAD_SCALE = 12;
export const XPBD_UPHILL_CONTACT_LOAD_SCALE = 16;
export const XPBD_ROLLING_LOAD_SCALE = 1.35;
// Two wheel impulses are distributed over the full version 2 mass, so these
// values reproduce version 1's 105 / 18 px/s² center-of-mass coast losses.
export const XPBD_COAST_RESISTANCE_LOW_SPEED = 372;
export const XPBD_COAST_RESISTANCE_HIGH_SPEED = 64;
export const XPBD_COAST_SPEED_REFERENCE = COAST_SPEED_REFERENCE;
export const XPBD_CONTACT_RESTITUTION_SCALE = .12;
export const CONTACT_GROUNDED_NORMAL = -.35;
export const CONTACT_RESTITUTION_SPEED = 35;
export const TERRAIN_SAMPLE_SPACING = 2;

export const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
export const lerp = (start, end, amount) => start + (end - start) * amount;
