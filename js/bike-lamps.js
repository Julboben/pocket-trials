// The bike's headlight and tail light. Each bike model lists its lamps as
// pixel art on the frame: drawn facing right with the rear axle at (-half, 0)
// and the front axle at (half, 0), -y up, on the 2-unit art grid. Lamps sit on
// the sprung body, so they pitch and drop with the suspension.
//
// drawing.js draws the lamps, and lighting.js shines the headlight and tail
// light from their lens pixels, so the glow always lands on the lamp. A new
// bike model only needs an entry in BIKE_LAMPS (test-cosmetics checks that
// every model has one).
//
// `x, y` are the top left of the lamp's rows (pieces on the body snap to the
// art grid when drawn); `rows` is pixel art: K housing, G / L / D the bike's
// paint (base, light, dark), h headlight lens, t tail-light lens, T its hot
// spot, which turns white-hot under hard braking.

export const BIKE_LAMPS = {
  // A motocross number plate on the forks with a small lamp low in it, and
  // the brake light at the tip of the rear fender.
  elasto: {
    head: {
      x: 16,
      y: -26,
      rows: [
        "LL ",
        "GGK",
        "GKh",
        "GKh",
        "DD ",
      ],
    },
    tail: { x: -36, y: -26, rows: ["T"] },
  },
  // A round lamp on the fork crown, and a block light behind the seat.
  classic: {
    head: {
      x: 14,
      y: -24,
      rows: [
        "KK ",
        "Khh",
        "Khh",
        "KK ",
      ],
    },
    tail: { x: -23, y: -24, rows: ["Tt", "tt"] },
  },
};

const BLACK = "#1b2124";
const HEAD_LENS = { off: "#8f9a92", on: "#fff1c4" };
const TAIL_LENS = { off: "#713c35", on: "#b8392c", brake: "#ff6045", hot: "#ffd0a2" };

/**
 * The colours a lamp's rows use, for the bike's paint, whether the lights are
 * on and how hard the brake is held. The brake light works with the lights off.
 */
export function lampColors(paint, { lights = false, brakePressure = 0 } = {}) {
  const braking = brakePressure > 0.08;
  const tail = braking ? TAIL_LENS.brake : lights ? TAIL_LENS.on : TAIL_LENS.off;
  return {
    K: BLACK,
    G: paint.base,
    L: paint.light,
    D: paint.dark,
    h: lights ? HEAD_LENS.on : HEAD_LENS.off,
    t: tail,
    T: brakePressure > 0.6 ? TAIL_LENS.hot : tail,
  };
}

const lensCache = new WeakMap();

/** The centre of a lamp's lens pixels (any of `keys`), in frame units. */
function lensCentre(lamp, keys) {
  let x = 0,
    y = 0,
    count = 0;
  lamp.rows.forEach((row, r) => {
    [...row].forEach((key, c) => {
      if (!keys.includes(key)) return;
      x += lamp.x + c * 2 + 1;
      y += lamp.y + r * 2 + 1;
      count++;
    });
  });
  return count ? [x / count, y / count] : [lamp.x, lamp.y];
}

/** Where a model's headlight and tail light shine from, in frame units, before the suspension moves them. */
export function lampLenses(lamps) {
  let lenses = lensCache.get(lamps);
  if (!lenses) {
    lenses = { head: lensCentre(lamps.head, "h"), tail: lensCentre(lamps.tail, "tT") };
    lensCache.set(lamps, lenses);
  }
  return lenses;
}

// Compression is drawn at about two thirds of its travel so the rider stays
// calm over bumps, but a stretched spring is drawn close to its full length:
// a bike hanging from one wheel lifts its body visibly off that wheel, forks
// and swingarm drawn out between them, as in Elasto Mania.
const STRETCH_GAIN = 1.5;
const visibleTravel = (compression) => (compression < 0 ? compression * STRETCH_GAIN : compression);

/**
 * How the sprung body sits on its suspension: how far it drops (negative when
 * the springs are stretched and it lifts away from the wheels) and how much it
 * pitches nose-down. `facing` picks which wheel is at the back.
 */
export function bodyPose(rear, front, facing) {
  const back = visibleTravel((facing > 0 ? rear.compression : front.compression) || 0);
  const ahead = visibleTravel((facing > 0 ? front.compression : rear.compression) || 0);
  return { drop: (back + ahead) * 0.4, pitch: (ahead - back) * 0.0096 };
}

/**
 * A point on the sprung body moved by the suspension, as drawBike places a
 * rigid piece of art: turned by the pitch and dropped by whole art pixels.
 */
export function posedBodyPoint([x, y], { drop, pitch }) {
  const c = Math.cos(pitch),
    s = Math.sin(pitch);
  return [x * c - y * s, x * s + y * c + Math.round(drop / 2) * 2];
}
