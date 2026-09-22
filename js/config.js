// Core dimensions and simulation timing.
export const STEP = 1 / 120;
export const RADIUS = 12;
export const WHEELBASE = 50;
export const TAU = Math.PI * 2;

// Handling values. These are intentionally centralized for feel-tuning.
export const GRAVITY = 380;
export const MAX_POINT_SPEED = 760;
export const UPHILL_TORQUE_BOOST = 1.4;

// Constraint and contact solver tuning.
export const BIKE_SOLVER_ITERATIONS = 7;
export const BIKE_VELOCITY_ITERATIONS = 3;
export const XPBD_CHASSIS_COMPLIANCE = 0.000001;
export const XPBD_CHASSIS_AREA_COMPLIANCE = 0.000001;
export const XPBD_SUSPENSION_COMPLIANCE = 0.0014;
export const XPBD_SUSPENSION_DAMPING = .9;
export const XPBD_LONGITUDINAL_COMPLIANCE = 0.00004;
export const XPBD_LONGITUDINAL_DAMPING = .55;
export const XPBD_CROSS_LINK_COMPLIANCE = 0.0001;
export const XPBD_CROSS_LINK_DAMPING = .35;
export const SUSPENSION_REST_LENGTH = 20;
export const SUSPENSION_TRAVEL = 16;
export const XPBD_WHEELBASE_SLACK = 6;
export const WHEEL_INERTIA = .5;
export const WHEEL_FRICTION = .92;
// Physical controls. All drive, brake, and lean forces come from tire torque
// and the chassis rather than direct wheel pushes.
export const XPBD_CHASSIS_MOUNT_INVERSE_MASS = .65;
export const XPBD_CHASSIS_TOP_INVERSE_MASS = .5;
// Gives roughly 400 px/s² of hooked-up low-speed acceleration. Grip below is
// high enough that this torque reaches the ground instead of spinning the
// driven wheel. Top speed is 340.
export const XPBD_MOTOR_ANGULAR_ACCELERATION = 708;
export const XPBD_MAX_DRIVE_SPEED = 340;
// Slightly under full reaction so throttle does not flip the bike backward.
// Steep climbs add extra drive torque, and that extra is discounted here.
export const XPBD_MOTOR_REACTION_SCALE = .86;
export const XPBD_UPHILL_REACTION_REDUCTION = .4;
export const XPBD_RIDER_GROUND_ANGULAR_ACCELERATION = 26;
export const XPBD_RIDER_AIR_ANGULAR_ACCELERATION = 12;
export const XPBD_THROTTLE_LEAN_ASSIST = .12;
export const XPBD_THROTTLE_INPUT_RESPONSE = 1.1;
export const XPBD_LEAN_INPUT_RESPONSE = 5.8;
export const XPBD_UPHILL_FORWARD_LEAN_REDUCTION = 0;
export const XPBD_UPHILL_FORWARD_LEAN_MOTOR_BOOST = .25;
// Small nose-down bias while climbing under throttle. It grows with the
// slope, so a steep face is harder to loop without removing the wheelie.
export const XPBD_UPHILL_ANTI_WHEELIE_ACCELERATION = 9;
// Brake dive follows travel speed, capped at 1.2 × full-lean pitch.
export const XPBD_BRAKE_REACTION_SCALE = .85;
export const XPBD_BRAKE_REACTION_LIMIT = 39.36;
export const XPBD_BRAKE_RATE = 64;
// Brake grip stays moderate. Drive grip is high enough that hitting the gas
// hooks the tire up instead of spinning it out.
export const XPBD_CONTACT_LOAD_SCALE = 4.5;
export const XPBD_DRIVE_LOAD_SCALE = 12;
export const XPBD_UPHILL_CONTACT_LOAD_SCALE = 16;
export const XPBD_ROLLING_LOAD_SCALE = 1.35;
// Two wheel impulses are distributed over the full vehicle mass, so these
// values produce 105 / 18 px/s² center-of-mass coast losses.
export const XPBD_COAST_RESISTANCE_LOW_SPEED = 372;
export const XPBD_COAST_RESISTANCE_HIGH_SPEED = 64;
export const XPBD_COAST_SPEED_REFERENCE = 140;
export const XPBD_CONTACT_RESTITUTION_SCALE = .03;
export const CONTACT_GROUNDED_NORMAL = -.35;
export const CONTACT_RESTITUTION_SPEED = 35;
export const TERRAIN_SAMPLE_SPACING = 2;

export const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
export const lerp = (start, end, amount) => start + (end - start) * amount;
