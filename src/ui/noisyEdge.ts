import type { Point } from "../engine/borders";

// Every outline on this map — the coast, a nation's border, the edge of a forest — is a chain of
// Voronoi cell edges, and a Voronoi cell edge is dead straight. Strung together at cell scale that
// reads as faceting: the one thing that says "generated" more loudly than anything else on the page.
//
// The standard answer is Amit Patel's "noisy edges" from mapgen2: replace each straight edge with a
// recursively midpoint-displaced curve. The catch that makes it work is that the curve must be
// computed ONCE PER EDGE, not once per cell — two cells share an edge, and if each wiggles it its
// own way the map leaks. So the endpoints are put in a canonical order before anything is computed,
// and the result is reversed for whichever cell walks the edge backwards. Both then draw the same
// line, and the tessellation stays watertight.
//
// Pure geometry, no rng: the displacement is a hash of the midpoint, so the same world always draws
// the same coast, and nothing here can shift a draw in the world generator.

// Two levels: each edge becomes four sub-segments. One level was measured and rejected — at the
// map's own zoom the single kink per edge still reads as a polygon. The cost is about three times
// the path data (236KB -> 679KB on the terrain view) and a view switch of 193ms at worst, which a
// static map can pay.
const DEPTH = 2;
const AMP = 0.22;     // peak displacement, as a fraction of the edge's length

// A deterministic value in [0, 1) from a point. Bit-mixing rather than trigonometry, so it does not
// band along axes the way the usual sin(dot) hash does.
function hash(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 64) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// The interior points of the curve from a to b, nearest a first. Endpoints are never returned —
// the caller already has them, and leaving them out keeps the joins exact.
function subdivide(a: Point, b: Point, depth: number): Point[] {
  if (depth <= 0) return [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const off = (hash(mx, my) * 2 - 1) * AMP * len;
  const m: Point = [mx - (dy / len) * off, my + (dx / len) * off];
  return [...subdivide(a, m, depth - 1), m, ...subdivide(m, b, depth - 1)];
}

/**
 * The interior points of the wobbled edge between `a` and `b`, in the order a → b.
 * `noisyEdge(a, b)` is always the reverse of `noisyEdge(b, a)`, which is what keeps two cells
 * sharing an edge from drawing two different lines.
 */
export function noisyEdge(a: Point, b: Point): Point[] {
  // canonical order: x first, then y. Whoever walks the edge the other way gets the same curve back.
  const flipped = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const pts = flipped ? subdivide(b, a, DEPTH) : subdivide(a, b, DEPTH);
  return flipped ? pts.reverse() : pts;
}
