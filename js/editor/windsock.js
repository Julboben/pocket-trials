// The windsock in the trail panel's Wind group: it shows the trail's wind as
// the game blows it, so the author can see how hard it blows and which way
// without playtesting. It hangs limp in a calm, streams out straight in a
// gale, and flutters as it blows. With reduced motion it holds still.
import { resolveWeather, windSign } from "../weather.js";

const PIXEL = 2;
const POLE = { inset: 8, top: 6 };
// The sock's bands from the hoop out, alternating orange and white, each
// narrower than the last.
const BANDS = [
  { length: 10, width: 12, color: "#e0702f", shade: "#a8501f" },
  { length: 9, width: 10, color: "#f4e9d1", shade: "#c9bfa8" },
  { length: 9, width: 9, color: "#e0702f", shade: "#a8501f" },
  { length: 8, width: 7, color: "#f4e9d1", shade: "#c9bfa8" },
  { length: 8, width: 6, color: "#e0702f", shade: "#a8501f" },
];

const snap = (value) => Math.round(value / PIXEL) * PIXEL;

/** Draws the windsock for `weather` (resolved) at `time` seconds. */
function drawWindsock(context, weather, time) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  const downwind = windSign(weather);
  const strength = weather.wind;
  // The pole stands on the upwind side, so the sock streams across the canvas.
  const poleX = downwind < 0 ? width - POLE.inset - PIXEL : POLE.inset;
  context.fillStyle = "#697872";
  context.fillRect(poleX, POLE.top, PIXEL, height - POLE.top);
  context.fillStyle = "#aeb5a7";
  context.fillRect(poleX, POLE.top - PIXEL, PIXEL, PIXEL);
  // Limp, the sock hangs nearly straight down; in a gale it is level.
  const droop = (1 - strength) ** 1.4 * 1.3;
  let x = poleX + PIXEL / 2,
    y = POLE.top + 2;
  BANDS.forEach((band, index) => {
    const flutter = time ? Math.sin(time * 9 - index * 0.9) * (0.04 + strength * 0.08) * (index + 1) : 0;
    const angle = droop + flutter + index * 0.04 * (1 - strength);
    const along = [downwind * Math.cos(angle), Math.sin(angle)];
    const across = [-along[1], along[0]];
    for (let s = 0; s < band.length; s += 1) {
      for (let w = -band.width / 2; w < band.width / 2; w += 1) {
        context.fillStyle = w > band.width / 4 ? band.shade : band.color;
        context.fillRect(
          snap(x + along[0] * s + across[0] * w * downwind),
          snap(y + along[1] * s + across[1] * w * downwind),
          PIXEL,
          PIXEL,
        );
      }
    }
    x += along[0] * band.length;
    y += along[1] * band.length;
  });
}

/**
 * Keeps the windsock on `canvas` blowing in the weather from `getWeather()`,
 * redrawing each frame while it is on screen.
 */
export function startWindsock(canvas, getWeather) {
  const context = canvas.getContext?.("2d");
  if (!context) return;
  const still = Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const frame = (now) => {
    if (canvas.offsetParent)
      drawWindsock(context, resolveWeather(getWeather()), still ? 0 : now / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
