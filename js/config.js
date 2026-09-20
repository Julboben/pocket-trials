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
export const BIKE_CONSTRAINT_STIFFNESS = .43;
export const CONTACT_GROUNDED_NORMAL = -.35;
export const CONTACT_RESTITUTION_SPEED = 35;
export const TERRAIN_SAMPLE_SPACING = 2;

export const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
export const lerp = (start, end, amount) => start + (end - start) * amount;
