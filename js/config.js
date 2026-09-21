// Core dimensions and simulation timing.
export const STEP = 1 / 120;
export const RADIUS = 12;
export const WHEELBASE = 50;
export const TAU = Math.PI * 2;

// Handling values. These are intentionally centralized for feel-tuning.
export const GRAVITY = 480;
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
export const XPBD_SUSPENSION_COMPLIANCE = 0.00022;
export const XPBD_SUSPENSION_DAMPING = .35;
export const XPBD_LONGITUDINAL_COMPLIANCE = 0.00018;
export const XPBD_LONGITUDINAL_DAMPING = .08;
export const XPBD_CROSS_LINK_COMPLIANCE = 0.00012;
export const XPBD_CROSS_LINK_DAMPING = .08;
export const SUSPENSION_REST_LENGTH = 18;
export const SUSPENSION_TRAVEL = 10;
export const WHEEL_INERTIA = .5;
export const WHEEL_FRICTION = .92;
// Version 2 physical controls. These do not modify or derive behavior from
// the legacy direct-force handling model.
export const XPBD_CHASSIS_MOUNT_INVERSE_MASS = .65;
export const XPBD_CHASSIS_TOP_INVERSE_MASS = .5;
// Calibrated to version 1's ~400 px/s² low-speed center acceleration after
// accounting for the 7.08-unit total mass of the version 2 bike.
export const XPBD_MOTOR_ANGULAR_ACCELERATION = 710;
// Version 1's opposing wheel forces produce 820 / 25 = 32.8 rad/s² on the
// ground and 300 / 25 = 12 rad/s² in the air.
export const XPBD_RIDER_GROUND_ANGULAR_ACCELERATION = 32.8;
export const XPBD_RIDER_AIR_ANGULAR_ACCELERATION = 12;
export const XPBD_THROTTLE_LEAN_ASSIST = .45;
export const XPBD_UPHILL_FORWARD_LEAN_REDUCTION = 1.4;
// Produces approximately version 1's full-pressure braking deceleration.
export const XPBD_BRAKE_RATE = 64;
export const XPBD_CONTACT_LOAD_SCALE = 7;
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
