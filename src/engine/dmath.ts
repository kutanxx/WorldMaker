// Mathematics that comes out the same in every browser.
//
// A world and its town plates are computed afresh wherever a link is opened, and the computation leans on
// sines, arctangents, logarithms and square roots. The language fixes + − × ÷ and Math.sqrt to the last bit
// (IEEE 754, round to nearest) but leaves Math.sin, cos, tan, atan, atan2, asin, acos, exp, log, pow, cbrt
// and hypot to each engine — and they differ: measured 2026-10-12, Node 24, Chrome 152 and Firefox 156 each
// disagreed with the other two in the last digit, and a town plate drawn in one had its houses elsewhere
// in another. These are the same functions written with nothing but the exact operations, after fdlibm (the
// algorithms and coefficients of Sun's freely distributable libm, as FreeBSD's msun carries them), so the
// same numbers come out of every engine. Accurate to within a unit or two in the last place.
//
// ⚠ Nothing in the engine may call Math.sin & co. directly (a test holds the engine to it), and nothing in
// here may either (dmath.test takes them away and runs every function).

// ── sin, cos, tan ───────────────────────────────────────────────────────────────────────────────────
// π/2 in three pieces, each exact in a double times any integer up to 2^20 (Cody–Waite), for the reduction
const PIO2_1 = 1.57079632673412561417e+00, PIO2_2 = 6.07710050630396597660e-11, PIO2_3 = 2.02226624871116645580e-21;
const INVPIO2 = 6.36619772367581382433e-01;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

// on [-π/4, π/4]
function kSin(x: number): number {
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}
function kCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}
// x = k·π/2 + r, |r| ≤ π/4 (to the precision three pieces of π/2 give — every angle a world draws)
function reduce(x: number): [number, number] {
  const k = Math.round(x * INVPIO2);
  const r = ((x - k * PIO2_1) - k * PIO2_2) - k * PIO2_3;
  return [k, r];
}
export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kSin(x);
  const [k, r] = reduce(x);
  switch (((k % 4) + 4) % 4) {
    case 0: return kSin(r);
    case 1: return kCos(r);
    case 2: return -kSin(r);
    default: return -kCos(r);
  }
}
export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kCos(x);
  const [k, r] = reduce(x);
  switch (((k % 4) + 4) % 4) {
    case 0: return kCos(r);
    case 1: return -kSin(r);
    case 2: return -kCos(r);
    default: return kSin(r);
  }
}
export function dtan(x: number): number {
  return dsin(x) / dcos(x);
}

// ── atan, atan2, asin, acos ─────────────────────────────────────────────────────────────────────────
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const neg = x < 0;
  let a = Math.abs(x), id = -1;
  if (a >= 7.378697629483821e19) return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3];   // 2^66
  if (a < 0.4375) {
    if (a < 1.862645149230957e-9) return x;                                                   // 2^-29
  } else if (a < 1.1875) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); }
  } else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); } else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) { const r = a - a * (s1 + s2); return neg ? -r : r; }
  const r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}
const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16, PI_O_2 = 1.5707963267948965580e+00;
export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (y === 0) return x > 0 || (x === 0 && !Object.is(x, -0)) ? y : (Object.is(y, -0) ? -PI : PI);
  if (x === 0) return y > 0 ? PI_O_2 : -PI_O_2;
  const z = datan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}
export function dasin(x: number): number {
  if (x === 1) return PI_O_2;
  if (x === -1) return -PI_O_2;
  return datan2(x, Math.sqrt((1 - x) * (1 + x)));
}
export function dacos(x: number): number {
  if (x === 1) return 0;
  if (x === -1) return PI;
  return datan2(Math.sqrt((1 - x) * (1 + x)), x);
}

// ── exp, log, pow, cbrt ─────────────────────────────────────────────────────────────────────────────
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
// 2^k, exactly: doubling and halving are exact
function pow2(k: number): number {
  let r = 1;
  if (k > 0) for (let i = 0; i < k; i++) r *= 2;
  else for (let i = 0; i < -k; i++) r *= 0.5;
  return r;
}
export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (x === 0) return 1;
  const k = Math.round(x * INVLN2);
  const hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  // (scaled in two steps so a k past the exponent's range cannot overflow the factor before the product)
  return k > 1000 || k < -1000 ? y * pow2(k >> 1) * pow2(k - (k >> 1)) : y * pow2(k);
}
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
  LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01, LG7 = 1.479819860511658591e-01;
const SQRT2 = 1.4142135623730951;
export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  if (x === 1) return 0;
  // x = m·2^k with m in [√2/2, √2): halving and doubling are exact
  let m = x, k = 0;
  while (m >= SQRT2) { m *= 0.5; k++; }
  while (m < SQRT2 / 2) { m *= 2; k--; }
  const f = m - 1, hfsq = 0.5 * f * f, s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6)), t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    // whole powers by squaring: exact where the product is, and the same everywhere
    let r = 1, b = x, n = Math.abs(y);
    while (n > 0) { if (n & 1) r *= b; b *= b; n >>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = dexp(y * dlog(-x));
    return y % 2 === 0 ? r : -r;
  }
  return dexp(y * dlog(x));
}
export function dcbrt(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const a = Math.abs(x);
  let t = dexp(dlog(a) / 3);
  t = t - (t * t * t - a) / (3 * t * t);          // one Newton step to the last digit
  return x < 0 ? -t : t;
}
export function dhypot(...xs: number[]): number {
  let s = 0;
  for (const v of xs) s += v * v;
  return Math.sqrt(s);
}

/** x², as a product: `x ** 2` is Math.pow, which the language leaves to the engine. */
export function sq(x: number): number {
  return x * x;
}

/** ⌊log₁₀ x⌋ for x > 0, found against powers of ten built by exact steps rather than a logarithm. */
export function dfloorLog10(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return NaN;
  let k = 0;
  if (x >= 1) { for (let p = 10; p <= x; p *= 10) k++; return k; }
  for (let y = x; y < 1; y *= 10) k--;
  return k;
}
