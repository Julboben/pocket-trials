// @ts-check
// A trail's time of day: a whole hour, 0 (midnight) to 23, round a full day.
// The looks of a day are a handful of keyframes on the clock (night, dawn,
// morning, noon, evening and dusk); the sky's colours (drawing.js) and the
// light (lighting.js) each blend their own keyframes along the schedule here,
// so every hour in between is a mix of its neighbours. Exactly on a keyframe
// an hour looks just like it.

/** The hours in a day: a trail's hour is 0…HOURS - 1. */
export const HOURS = 24;

/** The hour a trail gets before one is chosen: noon. */
export const DEFAULT_HOUR = 12;

/** The editor's help points: the classic times of day, each on its hour. */
export const TIME_MARKS = [
  { id: "morning", name: "Morning", hour: 7 },
  { id: "noon", name: "Noon", hour: 12 },
  { id: "evening", name: "Evening", hour: 19 },
  { id: "night", name: "Night", hour: 0 },
];

/**
 * The day's keyframes, as [hour, look], in order round the clock. A look
 * held over several hours is listed at each end (noon from 10 to 16, night
 * from 22 to 4), and the clock wraps from the last back round to the first.
 */
export const DAY_KEYFRAMES = /** @type {const} */ ([
  [4, "night"],
  [6, "dawn"],
  [7, "morning"],
  [10, "noon"],
  [16, "noon"],
  [19, "evening"],
  [20, "dusk"],
  [22, "night"],
]);

/**
 * A trail's hour as a whole hour 0…23: a number is rounded and wrapped round
 * the clock (24 is midnight); anything else is noon.
 */
export function normalizeHour(value) {
  const hour = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(hour)) return DEFAULT_HOUR;
  return ((Math.round(hour) % HOURS) + HOURS) % HOURS;
}

/**
 * The two keyframe looks either side of `hour` and how far it is from the
 * first to the second, 0…1: { from, to, t }. On a keyframe, or between two of
 * the same look, `t` is 0 and `from` is the look itself.
 */
export function dayBlend(hour) {
  const h = normalizeHour(hour);
  const count = DAY_KEYFRAMES.length;
  for (let index = 0; index < count; index++) {
    const [start, from] = DAY_KEYFRAMES[index];
    const [next, to] = DAY_KEYFRAMES[(index + 1) % count];
    // The last keyframe wraps round midnight to the first.
    const end = next > start ? next : next + HOURS;
    const at = h >= start ? h : h + HOURS;
    if (at >= start && at < end) {
      const t = from === to ? 0 : (at - start) / (end - start);
      return { from, to, t };
    }
  }
  return { from: "noon", to: "noon", t: 0 };
}

/** Whether the hour is night: from 21:00, after dusk, to 5:00, before dawn. */
export function isNight(hour) {
  const h = normalizeHour(hour);
  return h >= 21 || h < 5;
}

/** What the time of day is called, for the editor: "Dawn", "Noon", "Night"… */
export function hourName(hour) {
  const h = normalizeHour(hour);
  if (h < 5 || h >= 21) return "Night";
  if (h < 7) return "Dawn";
  if (h < 11) return "Morning";
  if (h < 14) return "Noon";
  if (h < 18) return "Afternoon";
  if (h < 20) return "Evening";
  return "Dusk";
}

/** The hour on a clock, "07:00". */
export const clockTime = (hour) => `${String(normalizeHour(hour)).padStart(2, "0")}:00`;
