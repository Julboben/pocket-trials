// Core dimensions and simulation timing.
export const STEP = 1 / 120;
export const MAX_STEPS_PER_FRAME = 4;
export const RADIUS = 12;
export const WHEELBASE = 50;
export const TAU = Math.PI * 2;

// Handling values. These are intentionally centralized for feel-tuning.
export const GRAVITY = 380;
export const MAX_POINT_SPEED = 860;

// Constraint and contact solver tuning.
export const BIKE_SOLVER_ITERATIONS = 7;
export const BIKE_VELOCITY_ITERATIONS = 3;
export const XPBD_CHASSIS_COMPLIANCE = 0.000001;
export const XPBD_CHASSIS_AREA_COMPLIANCE = 0.000001;
// The spring carries the chassis on its own: sliders keep each wheel in line
// with its mount, so each wheel sinks on its own when it lands, by how hard
// that wheel hits: about 5 px below its resting sag from a 20 px drop, 9 px
// from 80 px and 11.5 px from 200 px. It bounces back one to three times and
// settles within about a second.
// Damping is the share of spring speed removed per step; near 1 locks it.
// Rebound is firmer so the spring does not catapult the bike upward.
export const XPBD_SUSPENSION_COMPLIANCE = 0.0036;
export const XPBD_SUSPENSION_DAMPING = .26;
export const XPBD_SUSPENSION_REBOUND_DAMPING = .42;
// Pulled past its rest length the spring is softer, as in Elasto Mania: a
// bike hooked on a ledge by one wheel hangs from that wheel's spring, which
// stretches about 11 px under the whole bike and bobs before it settles, while
// the free wheel droops about 5 px under its own weight.
export const XPBD_SUSPENSION_EXTENSION_COMPLIANCE = 0.012;
export const XPBD_SUSPENSION_SLIDER_COMPLIANCE = 0.0001;
export const SUSPENSION_REST_LENGTH = 20;
export const SUSPENSION_TRAVEL = 16;
// A stiffer second spring over the last part of travel, so the soft main
// spring keeps sinking further on harder landings instead of slamming into
// the travel limit, which would throw the bike back into the air.
export const SUSPENSION_BUMP_STOP_LENGTH = 10;
export const XPBD_SUSPENSION_BUMP_STOP_COMPLIANCE = 0.0003;
// The same on the way out: a firmer top-out spring over the last part of
// stretch catches a bike that drops onto one hooked wheel before the travel
// limit jerks it.
export const SUSPENSION_TOP_OUT_LENGTH = 32;
export const XPBD_SUSPENSION_TOP_OUT_COMPLIANCE = 0.002;
// A bottoming cone, as in a motocross fork or shock: past this much
// compression (px) the compression damping climbs, with the square of the
// way into that zone, to the bottoming value at full travel. Hard landings
// are slowed over the last part of the stroke instead of slamming the travel
// limit; ordinary bumps, squat and brake dive stay above the zone.
export const SUSPENSION_BOTTOMING_START = 9;
export const XPBD_SUSPENSION_BOTTOMING_DAMPING = .95;
export const WHEEL_INERTIA = .5;
// Tire grip is Coulomb friction on the real ground force each tire takes: a
// gripping tire holds up to WHEEL_FRICTION times its load, a slipping one
// pushes with WHEEL_SLIDE_FRICTION times it until it hooks up again. The motor
// can spin the tread at most WHEEL_DRIVE_SLIP (px/s) ahead of the ground.
export const WHEEL_FRICTION = 2.1;
export const WHEEL_SLIDE_FRICTION = 1.8;
export const WHEEL_DRIVE_SLIP = 90;
// Physical controls. All drive, brake, and lean forces come from tire torque
// and the chassis rather than direct wheel pushes.
export const XPBD_CHASSIS_MOUNT_INVERSE_MASS = .65;
export const XPBD_CHASSIS_TOP_INVERSE_MASS = .5;
// Gives roughly 400 px/s² of hooked-up low-speed acceleration. Grip below is
// high enough that this torque reaches the ground instead of spinning the
// driven wheel.
export const XPBD_MOTOR_ANGULAR_ACCELERATION = 808;
// Engine torque tapers linearly to 28% at this wheel speed and keeps thinning
// out above it without ever cutting off, so the bike has no top speed.
export const XPBD_TORQUE_FALLOFF_SPEED = 340;
// Full reaction: the torque that drives the rear wheel pushes the front up,
// on climbs as on flat ground. Held throttle on a hill of about 40° or more
// loops the bike over backward unless the rider leans forward.
export const XPBD_MOTOR_REACTION_SCALE = 1;
export const XPBD_RIDER_GROUND_ANGULAR_ACCELERATION = 28;
export const XPBD_RIDER_AIR_ANGULAR_ACCELERATION = 12;
// Ground lean fades out between these tilts (radians from the ground normal),
// so holding a lean pops a wheelie or stoppie instead of spinning the bike
// around its contact wheel.
export const XPBD_RIDER_LEVERAGE_FADE_START = 70 * Math.PI / 180;
export const XPBD_RIDER_LEVERAGE_FADE_END = 100 * Math.PI / 180;
// A held air lean steers the spin toward this rate (rad/s) instead of pushing
// with constant torque, so a flip turns at an even pace rather than speeding
// up as the bike goes over. The response (1/s) sets how quickly it gets there;
// XPBD_RIDER_AIR_ANGULAR_ACCELERATION caps the push.
export const XPBD_RIDER_MAX_AIR_SPIN = 8;
export const XPBD_RIDER_AIR_SPIN_RESPONSE = 3;
// Same for ground lean, so landing on one wheel mid-spin cannot re-pump the
// rotation into a cartwheel that throws the bike back into the air.
export const XPBD_RIDER_MAX_GROUND_SPIN = 3;
// When a wheel touches down, this share of bike spin above the threshold
// (rad/s) is absorbed, so a tumbling bike cannot cartwheel off its wheels.
export const XPBD_TOUCHDOWN_SPIN_THRESHOLD = 3;
export const XPBD_TOUCHDOWN_SPIN_ABSORPTION = .6;
export const XPBD_THROTTLE_LEAN_ASSIST = .12;
export const XPBD_THROTTLE_INPUT_RESPONSE = 1.1;
export const XPBD_LEAN_INPUT_RESPONSE = 5.8;
export const XPBD_UPHILL_FORWARD_LEAN_REDUCTION = 1.4;
// Nose-up tilt from the slope (radians) at which the front wheel counts as
// lifted: forward lean is back to full strength for pulling it down.
export const XPBD_UPHILL_FORWARD_LEAN_FULL_TILT = 12 * Math.PI / 180;
// Brake dive follows travel speed, capped at about twice full-lean pitch; the
// front suspension dives and takes up part of it. It only acts while rolling
// forward: braking a bike that rolls back must not lift its front wheel.
export const XPBD_BRAKE_REACTION_SCALE = 1;
export const XPBD_BRAKE_REACTION_LIMIT = 60;
export const XPBD_BRAKE_RATE = 64;
// Most wheel spin (rad/s²) a fully held brake removes. Enough to lock a
// rolling wheel within a few steps and hold it against full tire friction, so
// the bike skids to a stop, stays parked on slopes, and pivots on a locked
// front wheel in a stoppie.
export const XPBD_BRAKE_TORQUE = 720;
// Two wheel impulses are distributed over the full vehicle mass, so these
// values produce 105 / 18 px/s² center-of-mass coast losses.
export const XPBD_COAST_RESISTANCE_LOW_SPEED = 372;
export const XPBD_COAST_RESISTANCE_HIGH_SPEED = 64;
export const XPBD_COAST_SPEED_REFERENCE = 140;
export const XPBD_CONTACT_RESTITUTION_SCALE = .03;
export const CONTACT_GROUNDED_NORMAL = -.35;
export const CONTACT_RESTITUTION_SPEED = 35;

// Glass panes are measured as the rectangle with the same area and perimeter,
// so a pane's thickness and span don't change when it's tilted. A pane at least this thick
// never breaks. A thinner one has a strength, the hit speed into it (along
// the surface normal, px/s) it takes before it shatters: the reference
// strength for a pane of the reference thickness and span, rising with
// thickness and falling with the square root of the span. Resting weight
// counts as a hit of the weight impact, so only a pane weaker than that
// cannot carry the bike at all.
export const GLASS_THIN_THICKNESS = 16;
export const GLASS_REFERENCE_THICKNESS = 8;
export const GLASS_REFERENCE_SPAN = 96;
export const GLASS_REFERENCE_STRENGTH = 280;
export const GLASS_WEIGHT_IMPACT = 40;
// A hit that doesn't break a pane cracks it when it is harder than this share
// of the strength the pane has left, and the pane loses this share of the
// hit's speed from its strength. Resting weight never cracks glass. Hits this
// many seconds after a crack count as the same landing.
export const GLASS_CRACK_SHARE = .5;
export const GLASS_CRACK_LOSS = .5;
export const GLASS_CRACK_SETTLE = .25;
// Share of the speed into the pane that is lost going through it.
export const GLASS_BREAK_DRAG = .35;

export const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
export const lerp = (start, end, amount) => start + (end - start) * amount;
