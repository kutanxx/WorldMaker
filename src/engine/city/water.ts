import type { Rng } from "../rng";
import { randInt } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon, clipToConvex } from "../geometry";
import type { WaterKind } from "./archetypes";
import { createNoise2D } from "simplex-noise";

export interface Water {
  kind: WaterKind;
  bodies: Polygon[];
  bridges: [Point, Point][];
}

function ribbon(center: Polyline, halfWidth: number | ((i: number) => number), roundHead = false): Polygon {
  const left: Point[] = [];
  const right: Point[] = [];
  const half = typeof halfWidth === "number" ? () => halfWidth : halfWidth;
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(center.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m, ny = dx / m, hw = half(i);
    left.push([center[i][0] + nx * hw, center[i][1] + ny * hw]);
    right.push([center[i][0] - nx * hw, center[i][1] - ny * hw]);
  }
  // a rounded head: half a circle round the first point, from its right bank back round to its left
  const head: Point[] = [];
  if (roundHead && center.length > 1) {
    const [c0, c1] = center, m = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) || 1;
    const tx = (c1[0] - c0[0]) / m, ty = (c1[1] - c0[1]) / m, hw = half(0);
    for (let k = 1; k < 12; k++) {
      const phi = (k / 12) * Math.PI;   // from the right bank (ty, -tx), round behind it, to the left
      head.push([c0[0] + (Math.cos(phi) * ty - Math.sin(phi) * tx) * hw, c0[1] + (-Math.cos(phi) * tx - Math.sin(phi) * ty) * hw]);
    }
  }
  return left.concat(right.reverse(), head);
}

// ★ Where a port's shore runs: through the edge of the town's reach, so the town's seaward side is on
// the water. It was capped a strand (16) BEYOND that reach — but the wall wanders inside its nominal
// reach (0.8 to 1.14 of it), so the waterline stood a median 14 and up to 42 units off the quay: over
// twelve worlds 82 of 139 ports touched the sea nowhere, and their piers ran a median 60% of their
// length over the beach. At 0.8 of the reach the wall's seaward corners are in the water and are
// set on the bank (see makeBoundary); the sea takes some 5% of the town's disc.
const SHORE_IN = 0.8;

// Where the world's river rises at a town (see world.ts), the plate's rises there too, in a spring this
// share of the town's reach upstream of its middle, a pool this much wider than the stream it gives.
const SPRING_AT = 0.5, SPRING_POOL = 1.8;

// A stream, a river and a great river (see riverSize) are drawn this much as wide as a river always
// was — the world map's own proportions, 0.9, 1.5 and 2.1.
const SIZE_WIDTH = [0.6, 1, 1.4];

// A straight coast half a world cell off a port fills this much of the compass two cells out (see
// seaArc); a port's shore runs straight across its bearing where the world's sea fills as much as that.
export const SEA_ARC_STRAIGHT = 0.84 * Math.PI;
// ...and opens no narrower than this into a bay, nor wider round a headland than the whole less this;
// the head of a bay, or a headland's nose, is rounded over this share of the town's reach
const SEA_OPEN_MIN = Math.PI / 3, BAY_ROUND = 0.5;

/**
 * How the shore runs off a port's flanks (see buildWater): out along its bearing at this slope on both
 * sides into a bay, back past the town at a negative one round a headland; 0 straight across. The sea
 * opens from the town as the world's does, scaled so a straight coast opens a half circle.
 */
function shoreBend(seaArc?: number): number {
  if (seaArc === undefined) return 0;
  const open = Math.max(SEA_OPEN_MIN, Math.min(2 * Math.PI - SEA_OPEN_MIN, (Math.PI * seaArc) / SEA_ARC_STRAIGHT));
  const bend = 1 / Math.tan(open / 2);
  return Math.abs(bend) < 1e-9 ? 0 : bend;
}

/**
 * What the world says of the water at a town: how far its river turns there, whether it rises there,
 * and how big the world map draws it there (0 a stream, 1 a river, 2 a great river; a river where it
 * does not say); and for a port, how much of the compass round it is sea (see seaArc).
 */
export interface WaterSite { turn?: number; rises?: boolean; size?: 0 | 1 | 2; seaArc?: number }

/**
 * @param seaBearing which way the open water lies, in the world's own frame (atan2, +x east,
 * +y south — the plate's north is the world's north). The sea used to be `randInt(rng, 0, 3)`:
 * one of four edges, drawn from the town's own rng and owing nothing to the world the town stands
 * in. An outside review found a town on the EAST coast of its continent drawing the sea to the
 * WEST, harbour and all, and every coastal plate it opened had the water on the left. Omitted (a
 * test fixture, a world that cannot say), it falls back to the drawn side.
 * @param townReach how far the town's wall stands from the plate centre. The waterline is drawn
 * from the town's own rng (`depth`) and knew nothing about how big the town is, so on a small plate
 * the sea could be laid down beyond the fields: measured over 12 seeds, 18 of 139 towns that the
 * world calls PORTS had their wall 26–48 units from the water, and `makeHarbor`'s 36-unit probe
 * could not find a seaward edge — so those plates carried a district named Harbour with no quay,
 * no breakwater and no boats, under a header calling the place a port town. The waterline is now
 * pulled in to within a strand of the wall. Omitted, the shore sits wherever it was drawn.
 * @param riverBearing which way the world's river runs through the town (same frame). A river was
 * drawn north-south or east-west on a coin toss, and 30 of 57 river towns over twelve worlds had it
 * more than 45 degrees off the river the world map draws through them. Omitted, the toss decides.
 */
export function buildWater(
  rng: Rng, kind: WaterKind, bounds: { w: number; h: number }, seaBearing?: number, townReach?: number, riverBearing?: number,
  course: WaterSite = {},
): Water {
  const { w, h } = bounds;
  if (kind === "none") return { kind, bodies: [], bridges: [] };

  if (kind === "sea") {
    const side = randInt(rng, 0, 3); // 0 right, 1 bottom, 2 left, 3 top
    const noise = createNoise2D(rng);
    const depth = (0.24 + rng() * 0.1) * (side % 2 === 0 ? w : h);
    // a port town stands ON its water: with the town's reach known, the shore runs where SHORE_IN
    // puts it, however deep the draw was. The draw itself is untouched, so the rng stream does not move.
    const shoreAt = (drawn: number) => (townReach === undefined ? drawn : townReach * SHORE_IN);
    // The shore is summed octaves, not one wave. A single low-frequency wave sampled 13 times gave
    // a waterfront 1% longer than a straight line, sitting beside a world map whose coastline is 6%
    // longer per voronoi edge -- at the plate's scale that reads as the edge of a colour band. Three
    // octaves put bays, headlands and coves on the same shore. K is high enough that even the top
    // octave gets ~3 samples per period (below that it aliases into a sawtooth).
    const K = 96, amp = 13;
    const OCTAVES: [number, number][] = [[3.2, 1], [7.5, 0.55], [17, 0.3], [36, 0.16]];
    const edge: Point[] = [];
    for (let i = 0; i <= K; i++) {
      const t = i / K;
      let n = 0;
      for (let o = 0; o < OCTAVES.length; o++) n += noise(t * OCTAVES[o][0], side * 1.7 + o * 37.3) * amp * OCTAVES[o][1];
      const off = shoreAt((side % 2 === 0 ? w : h) / 2 - depth); // the same on the fallback side-of-the-plate shore
      if (side === 0) edge.push([w / 2 + off + n, t * h]);
      else if (side === 1) edge.push([t * w, h / 2 + off + n]);
      else if (side === 2) edge.push([w / 2 - off + n, t * h]);
      else edge.push([t * w, h / 2 - off + n]);
    }
    if (seaBearing !== undefined) {
      // The shore runs across the bearing rather than along a chosen edge: laid out in the rotated
      // frame, carried well past the plate on both flanks, then cut back to the plate so nothing is
      // painted out over the legend strip beside it. Same noise, same depth, same rng draws —
      // only the direction is no longer the town's own invention.
      const ux = Math.cos(seaBearing), uy = Math.sin(seaBearing);
      const vx = -uy, vy = ux;
      const R = Math.min(w, h), cx = w / 2, cy = h / 2;
      const reach = Math.hypot(w, h);           // enough to cross the plate at any angle
      const inland = shoreAt(R / 2 - depth);  // where the waterline sits
      const stretch = (2 * reach) / R;          // keep the waves the size they were on a plate edge
      // ...and runs the way the world's coast runs: out to sea on both flanks round a bay, back past the
      // town round a headland, straight across where the world's sea fills as much as a straight coast's
      const bend = shoreBend(course.seaArc), round = (townReach ?? 90) * BAY_ROUND;
      const far = reach * 2;
      const shore: Point[] = [];
      for (let i = 0; i <= K * 2; i++) {
        const u01 = i / (K * 2);
        const along = -reach + u01 * 2 * reach;
        let n = 0;
        for (let o = 0; o < OCTAVES.length; o++) {
          n += noise(u01 * OCTAVES[o][0] * stretch, seaBearing * 1.7 + o * 37.3) * amp * OCTAVES[o][1];
        }
        const off = bend ? Math.min(far * 0.95, inland + n + bend * (Math.hypot(along, round) - round)) : inland + n;
        shore.push([cx + ux * off + vx * along, cy + uy * off + vy * along]);
      }
      const open: Polygon = [
        ...shore,
        [cx + ux * far + vx * reach, cy + uy * far + vy * reach],
        [cx + ux * far - vx * reach, cy + uy * far - vy * reach],
      ];
      const plate: Polygon = [[0, 0], [w, 0], [w, h], [0, h]];
      const clipped = clipToConvex(open, plate);
      if (clipped.length >= 3) return { kind, bodies: [clipped], bridges: [] };
    }
    let polygon: Polygon;
    if (side === 0) polygon = [[w, 0], ...edge, [w, h]];
    else if (side === 1) polygon = [[0, h], ...edge, [w, h]];
    else if (side === 2) polygon = [[0, 0], ...edge, [0, h]];
    else polygon = [[0, 0], ...edge, [w, 0]];
    return { kind, bodies: [polygon], bridges: [] };
  }

  const plate: Polygon = [[0, 0], [w, 0], [w, h], [0, h]];
  const onPlate = (poly: Polygon): Polygon[] => { const c = clipToConvex(poly, plate); return c.length >= 3 ? [c] : [poly]; };

  if (kind === "lake") {
    // ★ Beside the town, not in it. The lake was dropped anywhere in the middle half of the plate,
    // so it stood inside the walls more often than not: the streets ran across it on long bridges,
    // parish churches stood in the water, and a cathedral ward it drowned went without its church.
    // A lake the world map does not draw is the plate's own invention; it should at least be where
    // a town is ON a lake — against its wall, the wall following the shore. Same draws, same order.
    const a1 = rng(), a2 = rng();
    const r = 34 + rng() * 26;
    const reach = townReach ?? 90;
    // its near shore about where the wall runs (the wall itself wanders a fifth either side)
    const ang = a1 * Math.PI * 2, d = reach + r * (0.85 + a2 * 0.2);
    const cx = w / 2 + Math.cos(ang) * d, cy = h / 2 + Math.sin(ang) * d;
    const poly: Polygon = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.4);
      poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return { kind, bodies: onPlate(poly), bridges: [] };
  }

  // river / meander / loop: a winding centre line crossing the plate, turned into a ribbon. The
  // draws are the ones the river always made, in the order it made them.
  const wide = SIZE_WIDTH[course.size ?? 1];
  const vertical = kind === "river" ? rng() < 0.5 : true;
  const baseDraw = rng();
  const jit: number[] = [];
  for (let i = 0; i <= 12; i++) jit.push(0.75 + rng() * 0.5);
  const flow = riverBearing ?? (vertical ? Math.PI / 2 : 0);
  const ux = Math.cos(flow), uy = Math.sin(flow);

  if (kind === "loop") {
    // A town in the river's bend, the way Toledo and Besançon sit in theirs: the river comes in from
    // upstream, turns up round the town and back, and leaves downstream, leaving one neck of land as
    // the way in. It used to be a sine wave laid straight through the middle of the plate, which
    // cut the town in two and put its "bridges" lengthwise in the channel.
    const R = (townReach ?? 90) + 24;
    // Which bank of the river the loop swings out to. Drawn as a V round the town, the river comes in on
    // one side of its chord and leaves on the other, turned some 60 degrees — so it swings out against
    // the way the world's river turns there, where the world says; on the draw where it cannot.
    const bulge = course.turn !== undefined ? (course.turn < 0 ? 1 : -1) : baseDraw < 0.5 ? 1 : -1;
    const vx = -uy * bulge, vy = ux * bulge;
    const at = (u: number, v: number): Point => [w / 2 + ux * u * R + vx * v * R, h / 2 + uy * u * R + vy * v * R];
    const wob = (i: number) => 1 + (jit[i] - 1) * 0.2;   // the drawn jitter, as a few percent of reach
    let path: Point[] = [
      at(-3.4, -2.6), at(-1.6, -1.6), at(-0.55, -1.08),
      at(-1.0 * wob(2), -0.35 * wob(2)), at(-1.0 * wob(3), 0.45 * wob(3)), at(-0.45 * wob(4), 1.0 * wob(4)),
      at(0.45 * wob(5), 1.0 * wob(5)), at(1.0 * wob(6), 0.45 * wob(6)), at(1.0 * wob(7), -0.35 * wob(7)),
      at(0.55, -1.08), at(1.6, -1.6), at(3.4, -2.6),
    ];
    // corner cutting (Chaikin) until the bends are curves
    for (let k = 0; k < 3; k++) {
      const next: Point[] = [path[0]];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      next.push(path[path.length - 1]);
      path = next;
    }
    return { kind, bodies: onPlate(ribbon(path, 14 * wide)), bridges: [] };
  }

  // A river (or a marsh's channel) runs the way the world's river runs, crossing the plate at any
  // angle: laid along the flow, carried past the plate's corners, cut back to the plate.
  const amp = kind === "meander" ? 70 : 40, waves = kind === "meander" ? 3 : 2, half = (kind === "meander" ? 16 : 11) * wide;
  const vx = -uy, vy = ux;
  const side = Math.min(w, h), far = Math.hypot(w, h) / 2 + 24;
  const v0 = (baseDraw - 0.5) * 0.2 * side;          // where it passes the middle: 0.4..0.6 of the plate
  const jitAt = (t: number) => {
    const x = Math.max(0, Math.min(12, t * 12)), i = Math.min(11, Math.floor(x)), f = x - i;
    return jit[i] * (1 - f) + jit[i + 1] * f;
  };
  const center: Polyline = [];
  const N = 60;
  // ...from its spring, where it rises at the town: nothing runs in from the edge of the plate above it
  const spring = course.rises ? -(townReach ?? 90) * SPRING_AT : -Infinity;
  for (let i = 0; i <= N; i++) {
    const along = -far + (2 * far * i) / N;
    if (along < spring) continue;
    const t = (along + side / 2) / side;              // 0..1 across the plate, as the waves were laid
    const off = v0 + Math.sin(t * Math.PI * waves) * amp * jitAt(t);
    center.push([w / 2 + ux * along + vx * off, h / 2 + uy * along + vy * off]);
  }
  if (!course.rises) return { kind, bodies: onPlate(ribbon(center, half)), bridges: [] };
  // the spring a pool wider than the stream, narrowing to it over the first two stretches below it
  const pool = (i: number) => half * (1 + (SPRING_POOL - 1) * Math.max(0, 1 - i / 2));
  return { kind, bodies: onPlate(ribbon(center, pool, true)), bridges: [] };
}

/**
 * A water body laid over a grid: each cell is known to be all water, all dry, or crossed by the
 * shore — and only a point in a shore cell needs the exact test.
 *
 * ★ Speed, not a new answer. A river is a ribbon of some 120 vertices and a meander's loop of some
 * 190 (360 before its corners were cut three times rather than four), and once houses were kept
 * dry corner by corner and roads walked for their crossings, the
 * point-in-polygon test behind `inWater` was 70% of generating a plate (56 plates took 2.45s, a
 * capital 252ms). A cell no edge touches is on one side of the shore throughout, so its centre
 * answers for all of it; a point outside the body's box is outside the body. The plates come out
 * byte for byte the same (city.test's byte-lock).
 */
interface Raster { x0: number; y0: number; cs: number; nx: number; ny: number; cells: Uint8Array }
const CELL = 6;
const rasters = new WeakMap<Polygon, Raster>();
// does the segment a-b touch the closed box [x0,x1]x[y0,y1]? (Liang-Barsky, the box a hair larger)
function touches(a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean {
  const E = 1e-7;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - (x0 - E)], [dx, (x1 + E) - a[0]], [-dy, a[1] - (y0 - E)], [dy, (y1 + E) - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
function rasterOf(poly: Polygon): Raster {
  const had = rasters.get(poly);
  if (had) return had;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const x0 = minX - CELL, y0 = minY - CELL;
  const nx = Math.ceil((maxX - x0) / CELL) + 2, ny = Math.ceil((maxY - y0) / CELL) + 2;
  const cells = new Uint8Array(nx * ny);   // 0 not yet known, 1 dry, 2 water, 3 the shore runs through it
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - x0) / CELL) - 1), i1 = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0]) - x0) / CELL) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - y0) / CELL) - 1), j1 = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1]) - y0) / CELL) + 1);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const k = j * nx + ii;
      if (cells[k] === 3) continue;
      if (touches(a, b, x0 + ii * CELL, y0 + j * CELL, x0 + (ii + 1) * CELL, y0 + (j + 1) * CELL)) cells[k] = 3;
    }
  }
  const r = { x0, y0, cs: CELL, nx, ny, cells };
  rasters.set(poly, r);
  return r;
}
function inBody(poly: Polygon, p: Point): boolean {
  const r = rasterOf(poly);
  const ix = Math.floor((p[0] - r.x0) / r.cs), iy = Math.floor((p[1] - r.y0) / r.cs);
  if (!(ix >= 0 && iy >= 0 && ix < r.nx && iy < r.ny)) return false;   // outside the body's box: outside it
  const k = iy * r.nx + ix;
  const c = r.cells[k];
  if (c === 3) return pointInPolygon(p, poly);
  if (c === 0) r.cells[k] = pointInPolygon([r.x0 + (ix + 0.5) * r.cs, r.y0 + (iy + 0.5) * r.cs], poly) ? 2 : 1;
  return r.cells[k] === 2;
}

export function inWater(water: Water, p: Point): boolean {
  for (const body of water.bodies) if (inBody(body, p)) return true;
  return false;
}

/**
 * Does a (small) polygon touch the water — exactly `water.bodies.some((b) => polysOverlap(poly, b))`,
 * asked the fast way round: its own corners through the grid, and only the shore's corners and
 * edges that come within its box.
 */
export function overlapsWater(water: Water, poly: Polygon): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const AIR = 1e-6;
  for (const body of water.bodies) {
    const r = rasterOf(body);
    if (maxX < r.x0 || maxY < r.y0 || minX > r.x0 + r.nx * r.cs || minY > r.y0 + r.ny * r.cs) continue;
    for (const p of poly) if (inBody(body, p)) return true;
    for (let i = 0; i < body.length; i++) {
      const a = body[i], b = body[(i + 1) % body.length];
      if (Math.max(a[0], b[0]) < minX - AIR || Math.min(a[0], b[0]) > maxX + AIR || Math.max(a[1], b[1]) < minY - AIR || Math.min(a[1], b[1]) > maxY + AIR) continue;
      if (a[0] >= minX - AIR && a[0] <= maxX + AIR && a[1] >= minY - AIR && a[1] <= maxY + AIR && pointInPolygon(a, poly)) return true;
      for (let j = 0; j < poly.length; j++) if (segmentsCross(a, b, poly[j], poly[(j + 1) % poly.length])) return true;
    }
  }
  return false;
}
// the proper crossing test polysOverlap uses (geometry.segmentsIntersect)
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, s: Point) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

const STEP = 2;    // the road is walked at this spacing, so a crossing is found where the water is
const LANDING = 5; // a bridge carries a little way onto each bank; it does not stop at the waterline
const CARRY = 40;  // how far a road that ends in the water is followed on, looking for the far bank
// two crossings this close, end for end, are the same crossing: parallel streets a few units apart
// each earn a bridge and the pair is drawn all but on top of itself. The gap between bridges is
// bimodal -- 4.5 units at the 5th percentile against 92 at the median -- so the line falls between.
const SAME_CROSSING = 12;

/**
 * The crossings a set of roads make over the water, each as the span of one bridge.
 *
 * This used to compare the two ENDPOINTS of each road segment and, on the first pair that
 * disagreed, call the whole segment a bridge — then stop looking at that road. A road segment is
 * as long as the road wanted it to be, so measured over twenty seeds the median bridge came out 51
 * units long with 28% of itself over water, more than a third of them past 60 units, and a few
 * spanning no water at all. It also missed every crossing a road made WITHIN one segment, since
 * both of those endpoints sit on land, and gave a road that crossed twice a single bridge.
 *
 * So the road is walked at a fixed spacing instead, and each unbroken run of wet steps becomes one
 * bridge: from a landing on the near bank to a landing on the far one. Where the run reaches the
 * end of the road the crossing is carried on along the road's own heading until it reaches dry
 * ground — a road usually stops AT the bank because that is where the street network was clipped,
 * not because the crossing is imaginary. If it finds no far bank within CARRY it is a lane running
 * down into the water, a slipway rather than a bridge, and carries none.
 */
export function waterBridges(roads: Polyline[], water: Water): [Point, Point][] {
  const bridges: [Point, Point][] = [];
  if (!water.bodies.length) return bridges;
  const gap = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const same = (a: Point, b: Point, c: Point, d: Point) =>
    Math.min(gap(a, c) + gap(b, d), gap(a, d) + gap(b, c)) < SAME_CROSSING;
  for (const r of roads) {
    const walk: Point[] = [];
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
      for (let k = 0; k < n; k++) walk.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (r.length) walk.push(r[r.length - 1]);
    // step back (dir -1) or on (dir +1) along the walk until LANDING of road has been covered
    const abutment = (from: number, dir: -1 | 1): Point => {
      let i = from, gone = 0;
      while (gone < LANDING) {
        const j = i + dir;
        if (j < 0 || j >= walk.length) break;
        gone += Math.hypot(walk[j][0] - walk[i][0], walk[j][1] - walk[i][1]);
        i = j;
      }
      return walk[i];
    };
    // the road has run out: keep going on its last heading until the far bank, then land on it
    const carryOn = (from: number, dir: -1 | 1): Point | null => {
      const prev = walk[from - dir];
      if (!prev) return null;
      const dx = walk[from][0] - prev[0], dy = walk[from][1] - prev[1];
      const m = Math.hypot(dx, dy);
      if (!m) return null;
      const ux = (dx / m) * STEP, uy = (dy / m) * STEP;
      let p: Point = walk[from];
      for (let gone = 0; gone <= CARRY; gone += STEP) {
        p = [p[0] + ux, p[1] + uy];
        if (!inWater(water, p)) return [p[0] + (ux / STEP) * LANDING, p[1] + (uy / STEP) * LANDING];
      }
      return null;
    };
    let i = 0;
    while (i < walk.length) {
      if (!inWater(water, walk[i])) { i++; continue; }
      let j = i;
      while (j + 1 < walk.length && inWater(water, walk[j + 1])) j++;
      const near = i > 0 ? abutment(i, -1) : carryOn(i, -1);
      const far = j < walk.length - 1 ? abutment(j, 1) : carryOn(j, 1);
      if (near && far && !bridges.some(([a, b]) => same(a, b, near, far))) bridges.push([near, far]);
      i = j + 1;
    }
  }
  return bridges;
}
