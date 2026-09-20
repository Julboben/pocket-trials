export const STEP = 1 / 120;
export const RADIUS = 12;
export const WHEELBASE = 50;
export const TAU = Math.PI * 2;

export const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
export const lerp = (start, end, amount) => start + (end - start) * amount;
