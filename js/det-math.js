// @ts-check
// Deterministic math for the simulation. Engines are free to implement
// Math.sin, Math.exp, Math.atan2 and friends differently (Chrome and Node
// already disagree in the last bit), and the ride is chaotic enough that one
// bit decides a run. These ports of the fdlibm/musl algorithms use only + - * /
// and sqrt, which IEEE 754 rounds identically everywhere, so replays and
// ghosts reproduce on every browser and in Node.
//
// Accuracy is within about one ulp of the correctly rounded result.

const TO_INT = 6755399441055744; // 1.5 * 2^52: adding and subtracting rounds to an integer
const roundToInt = x => (x + TO_INT) - TO_INT;

const scratch = new DataView(new ArrayBuffer(8));

/** x * 2^k for integer k in the normal range. */
function scale(x, k) {
  while (k > 1023) { x *= 8.98846567431158e307; k -= 1023; }
  while (k < -1022) { x *= 2.2250738585072014e-308; k += 1022; }
  scratch.setUint32(0, (k + 1023) << 20);
  scratch.setUint32(4, 0);
  return x * scratch.getFloat64(0);
}

// --- sin / cos ---------------------------------------------------------------

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function kernelSin(x, y) {
  const z = x * x, w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  return x - ((z * (.5 * y - v * r) - y) - v * S1);
}

function kernelCos(x, y) {
  const z = x * x, w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = .5 * z, one = 1 - hz;
  return one + (((1 - one) - hz) + (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const reduced = { n: 0, hi: 0, lo: 0 };

// Cody–Waite reduction by pi/2 with a 3-part constant; exact enough for
// |x| < 2^20 * pi/2, far beyond any angle the game produces.
function reducePio2(x) {
  const fn = roundToInt(x * INV_PIO2);
  let r = x - fn * PIO2_1;
  let w = fn * PIO2_2;
  let t = r;
  r = t - w;
  w = fn * PIO2_2T - ((t - r) - w);
  t = r;
  w = fn * PIO2_3;
  r = t - w;
  w = fn * PIO2_3T - ((t - r) - w);
  const hi = r - w;
  reduced.n = fn & 3;
  reduced.hi = hi;
  reduced.lo = (r - hi) - w;
}

export function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < .7853981633974483) return Math.abs(x) < 1e-8 ? x : kernelSin(x, 0);
  reducePio2(x);
  const { n, hi, lo } = reduced;
  return n === 0 ? kernelSin(hi, lo) : n === 1 ? kernelCos(hi, lo) : n === 2 ? -kernelSin(hi, lo) : -kernelCos(hi, lo);
}

export function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) < .7853981633974483) return Math.abs(x) < 1e-8 ? 1 : kernelCos(x, 0);
  reducePio2(x);
  const { n, hi, lo } = reduced;
  return n === 0 ? kernelCos(hi, lo) : n === 1 ? -kernelSin(hi, lo) : n === 2 ? -kernelCos(hi, lo) : kernelSin(hi, lo);
}

// --- atan / atan2 / acos -------------------------------------------------------

const ATAN_HI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

export function atan(x) {
  if (Number.isNaN(x)) return NaN;
  const sign = x < 0 || Object.is(x, -0) ? -1 : 1;
  let ax = Math.abs(x), id;
  if (ax >= 7.378697629483821e+19) return sign * (ATAN_HI[3] + ATAN_LO[3]);
  if (ax < .4375) {
    if (ax < 7.450580596923828e-9) return x;
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < .6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); } else { id = 1; ax = (ax - 1) / (ax + 1); }
  } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); } else { id = 3; ax = -1 / ax; }
  const z = ax * ax, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return sign * (ax - ax * (s1 + s2));
  return sign * (ATAN_HI[id] - ((ax * (s1 + s2) - ATAN_LO[id]) - ax));
}

const PI = 3.14159265358979311600e+00, PI_LO = 1.2246467991473531772e-16;

export function atan2(y, x) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return atan(y);
  const negativeY = y < 0 || Object.is(y, -0);
  const negativeX = x < 0 || Object.is(x, -0);
  if (y === 0) return negativeX ? (negativeY ? -PI : PI) : y;
  if (x === 0) return negativeY ? -PI / 2 : PI / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x);
  // |y/x| beyond 2^60 or below 2^-60 needs no polynomial.
  const ratio = Math.abs(y / x);
  let z;
  if (ratio > 1.152921504606847e18) z = PI / 2 + .5 * PI_LO;
  else if (negativeX && ratio < 8.673617379884035e-19) z = 0;
  else z = atan(ratio);
  if (!negativeX) return negativeY ? -z : z;
  return negativeY ? -(PI - (z - PI_LO)) : PI - (z - PI_LO);
}

export function acos(x) {
  if (Number.isNaN(x) || x > 1 || x < -1) return NaN;
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

// --- exp / log / pow ----------------------------------------------------------

const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;

export function exp(x) {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x;
  const k = roundToInt(x * INV_LN2);
  const hi = x - k * LN2_HI, lo = k * LN2_LO;
  const r = hi - lo;
  const rr = r * r;
  const c = r - rr * (P1 + rr * (P2 + rr * (P3 + rr * (P4 + rr * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return k === 0 ? y : scale(y, k);
}

const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
  LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;

export function log(x) {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k -= 54; }
  scratch.setFloat64(0, x);
  let high = scratch.getUint32(0);
  // Normalise the mantissa into [sqrt(2)/2, sqrt(2)).
  high += 0x3ff00000 - 0x3fe6a09e;
  k += (high >>> 20) - 0x3ff;
  high = (high & 0x000fffff) + 0x3fe6a09e;
  scratch.setUint32(0, high);
  const f = scratch.getFloat64(0) - 1;
  const hfsq = .5 * f * f;
  const s = f / (2 + f);
  const z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  return s * (hfsq + R) + k * LN2_LO - hfsq + f + k * LN2_HI;
}

/** Power for a positive base (all the simulation needs). */
export function pow(base, exponent) {
  if (exponent === 0) return 1;
  if (base === 1) return 1;
  if (!(base > 0)) return Math.pow(base, exponent);
  return exp(exponent * log(base));
}

export function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}
