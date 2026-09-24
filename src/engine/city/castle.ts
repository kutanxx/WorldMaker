// The lord's urban castle: integrated at the town wall with its own inner enceinte,
// a gate to the town and a postern to the countryside (research: Wikipedia "Urban castle").
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { insetEdges, centroid, pointInPolygon, polysOverlap, area, clipToConvex, pointSegDist, segmentsIntersect, bbox } from "../geometry";

export interface Castle {
  innerWall: Polygon;      // the enceinte: the inner ward's ring of wall
  towers: Point[];         // the enceinte's corners (the renderer spaces towers along them)
  gate: Point;             // the way in from the town: the outer curtain's gate at a great seat
  innerGate: Point | null; // a great seat's second gate, through the enceinte into the inner ward
  postern: Point | null;   // a small door in the wall side, where the castle is part of the town wall
  keep: Polygon;           // the donjon
  annexes: Polygon[];      // hall, chapel, lodgings — built against the inside of the enceinte
  scale: number;           // ornament scale — 1 at a market town's seat, larger at a great one
  outerWall: Polygon | null;         // great seats only: an outer curtain with a bailey inside it
  gatehouse: [Point, Point] | null;  // great seats only: the towers flanking the gate
  approach: Polyline | null;         // the lane from the gate out to the street the castle stands on
}

const TOUCH = 14; // ward counts as "at the wall" if a vertex is this close to the boundary ring
const GREAT_SIZE = 5;  // a lord's seat this big, or a capital's at any size, is a GREAT castle
const BASE_KR = 4.3;   // the donjon half-width of a size-3 market town: the unit the ornament is in
const KEEP_OFFSET = 0.35; // how far the donjon sits from the yard's middle toward its refuge corner
const WALL_CLEAR = 3.4;   // buildings stand this far off the enceinte -- it is drawn 4.4 wide
const OUTER_INSET = 2;    // a great seat's outer curtain stands this far back from its streets
const BAILEY_MIN = 8;     // ...and the enceinte at least this far behind the curtain: a yard, not a seam
const ON_WALL = 0.5;      // an edge of the castle whose middle is this close to the town's outline IS the town wall

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function edgeDist(p: Point, poly: Polygon): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

// a point is "clear inside" a ring when it is inside it and at least `clear` off every edge of it —
// exact for the non-convex rings a castle gets where it takes a stretch of the town's outline
const clearInside = (p: Point, ring: Polygon, clear: number) => pointInPolygon(p, ring) && edgeDist(p, ring) >= clear;

// consecutive vertices the clipper left on top of each other carry no edge and no normal
function tidy(poly: Polygon): Polygon {
  const out: Polygon = [];
  for (const p of poly) if (!out.length || dist(p, out[out.length - 1]) > 1e-6) out.push(p);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-6) out.pop();
  return out;
}

/**
 * The ward pulled in by `d` from its own edges — its streets — and then cut to the town.
 *
 * ★ The cut is the whole point. A ward is a Voronoi cell clipped to a DISC, and the town's wall is
 * not one: measured over 12 worlds, a castle ward stood a median 29% outside the town it belonged
 * to, and the castle was built from the whole cell and then drawn through a clip to the wall. So a
 * median 26% of each enceinte and 44% of each outer curtain were simply cut off (102 of 125
 * castles), 51 keeps lost a corner or more to the clip and two vanished entirely, and in 90 castles
 * the town wall ran straight through the yard. Cut first, and the edges that lie on the town's
 * outline are not pulled in at all: there the castle's wall IS the town wall, which is what an
 * urban castle is.
 */
function ringOf(ward: Polygon, boundary: Polygon, d: number): Polygon {
  const pulled = d > 0 ? insetEdges(ward, d) : ward;
  if (pulled.length < 3) return [];
  const cut = tidy(clipToConvex(boundary, pulled));
  return cut.length >= 3 && area(cut) > 1 ? cut : [];
}

const onWall = (a: Point, b: Point, boundary: Polygon) =>
  edgeDist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], boundary) < ON_WALL;

/** the point of a ring farthest from its edges (sampled), and how far that is */
export function deepest(ring: Polygon): { at: Point; depth: number } {
  const b = bbox(ring);
  const step = Math.max(0.75, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 24);
  let at = centroid(ring), depth = pointInPolygon(at, ring) ? edgeDist(at, ring) : -1;
  for (let y = b.minY + step / 2; y < b.maxY; y += step) for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    const p: Point = [x, y];
    if (!pointInPolygon(p, ring)) continue;
    const d = edgeDist(p, ring);
    if (d > depth) { depth = d; at = p; }
  }
  return { at, depth };
}

/** the edge whose middle is nearest `target`, among those `ok` allows (all of them if none are) */
function nearestEdge(poly: Polygon, target: Point, ok: (a: Point, b: Point) => boolean = () => true): { mid: Point; ux: number; uy: number; i: number } {
  let best = { mid: poly[0], ux: 1, uy: 0, i: 0 }, bd = Infinity;
  for (const strict of [true, false]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (strict && !ok(a, b)) continue;
      const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = dist(m, target);
      if (d < bd) {
        const len = dist(a, b) || 1;
        bd = d; best = { mid: m, ux: (b[0] - a[0]) / len, uy: (b[1] - a[1]) / len, i };
      }
    }
    if (bd < Infinity) break;
  }
  return best;
}

export function makeCastle(
  rng: Rng, ward: Polygon, townCenter: Point, boundary: Polygon, size: number, isCapital = false,
): Castle | null {
  // A great seat is set back behind TWO walls: the ward's own edge becomes an outer curtain and the
  // enceinte withdraws, leaving an outer bailey between them. A lesser seat keeps its single ring.
  const great = isCapital || size >= GREAT_SIZE;
  const kr0 = 2.5 + size * 0.6;
  // The ground the castle actually has: its ward as the plate draws it, cut to the town.
  const ground = ringOf(ward, boundary, 0);
  const site = ground.length >= 3 ? ground : ward;
  // The enceinte is sized by the TOWN, not by the ward it stands in. Measured over thirty seeds,
  // the castle ward grows only 1.17x from a size-3 town to a size-6 one while the town itself grows
  // 1.375x -- wards are Voronoi cells and there are 8 + 3*size of them, so each one is a SHRINKING
  // share of a growing town. So the ward only bounds the castle: the enceinte encloses a yard that
  // grows with the lord, and a small seat sits inside its grounds while a great one fills them.
  // The yard grows FASTER than the town (5 + 3.7*size against a town radius of 60 + 12*size), with
  // a floor, or a small seat's yard closes on its own donjon.
  const wardR = Math.sqrt(area(site) / Math.PI);
  const minYard = (kr0 * Math.SQRT2 + WALL_CLEAR) / (1 - KEEP_OFFSET);
  const yardR = Math.min(Math.max(5 + size * 3.7, minYard), Math.max(6, wardR - (great ? BAILEY_MIN : 3)));
  const floor = Math.max(1.5, Math.min(size >= 3 ? 3 : 4, wardR * 0.18));
  // the yard has to hold the donjon with its set-back from the rampart all round
  const holdsKeep = (ring: Polygon) => ring.length >= 3 && deepest(ring).depth >= WALL_CLEAR + kr0 * Math.SQRT2;
  // How far the enceinte stands back from the streets. Its area falls as it withdraws, so this is a
  // bisection for the yard the lord is owed — bounded by the one that still holds his tower. The
  // wall side is not withdrawn (see ringOf), which is why a flat "ward radius minus yard radius"
  // no longer answers it.
  const want = Math.PI * yardR * yardR;
  let lo = floor, hi = Math.max(floor, wardR);
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    const r = ringOf(ward, boundary, mid);
    if (r.length >= 3 && area(r) >= want && holdsKeep(r)) lo = mid; else hi = mid;
  }
  let d = lo;
  let inner = ringOf(ward, boundary, d);
  if (!holdsKeep(inner)) {
    // nothing withdrawn holds the keep: stand the enceinte as close to the streets as it may
    inner = ringOf(ward, boundary, floor);
    d = floor;
  }
  if (inner.length < 3) return null;
  // A curtain is only a curtain if there is a bailey behind it. The two rings are parallel on the
  // town side, so the bailey is exactly the difference of their withdrawals — measured before this,
  // 71 of 96 great seats had the two walls under six units apart, drawn nearly on top of each other.
  // Where the ward cannot hold both a full-sized donjon and two rings, the second ring wins and the
  // tower gives a quarter: the rings are what say "great" (the old rule dropped the curtain instead,
  // and against the ward as the town actually draws it that took it from a third of great seats).
  let outerWall: Polygon | null = null;
  if (great) {
    const back = OUTER_INSET + BAILEY_MIN;
    const deeper = d >= back ? inner : ringOf(ward, boundary, back);
    const outer = ringOf(ward, boundary, OUTER_INSET);
    const holdsSmallerKeep = deeper.length >= 3 && deepest(deeper).depth >= WALL_CLEAR + 0.75 * kr0 * Math.SQRT2;
    if (outer.length >= 3 && holdsSmallerKeep) { inner = deeper; d = Math.max(d, back); outerWall = outer; }
  }
  const wc = centroid(inner);
  if (!pointInPolygon(wc, site) && !pointInPolygon(deepest(inner).at, site)) return null;

  const wallSide = (a: Point, b: Point) => onWall(a, b, boundary);
  const townSide = (a: Point, b: Point) => !wallSide(a, b);
  // the way in faces the town, through a wall that is the castle's own and not the town's
  const innerEdge = nearestEdge(inner, townCenter, townSide);
  const outerEdge = outerWall ? nearestEdge(outerWall, townCenter, townSide) : null;
  const gateEdge = outerEdge ?? innerEdge;
  const gate = gateEdge.mid;
  const innerGate = outerEdge ? innerEdge.mid : null;

  // A postern opens in the wall side, where the castle's wall is the town's and the country is on
  // the other side of it: the middle of the longest run of it. A castle standing clear of the wall
  // keeps the old rule, a door on the side that comes nearest to it.
  let postern: Point | null = null;
  {
    let best = 0;
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i], b = inner[(i + 1) % inner.length];
      if (!wallSide(a, b)) continue;
      const len = dist(a, b);
      if (len > best && len > 4) { best = len; postern = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    }
    if (!postern) {
      let minToWall = Infinity, wallPt: Point = boundary[0];
      for (const v of ward) for (const b of boundary) {
        const dd = dist(v, b);
        if (dd < minToWall) { minToWall = dd; wallPt = b; }
      }
      if (minToWall < TOUCH) postern = nearestEdge(inner, wallPt).mid;
    }
  }

  // The donjon stands at the refuge corner — the part of the yard farthest from the way in — and
  // square to the gate's wall, so tower and enceinte read as one plan rather than a box dropped on
  // a yard at a random angle. Everything inside keeps WALL_CLEAR off the rampart: the enceinte is
  // drawn as a 4.4-wide band with drum towers on it, and a donjon tested only for being "inside the
  // polygon" came out lying across its own wall.
  const core = deepest(inner).at;
  let far: Point = inner[0], fd = -1;
  for (const v of inner) { const dd = dist(v, innerEdge.mid); if (dd > fd) { fd = dd; far = v; } }
  const kux = innerEdge.ux, kuy = innerEdge.uy;
  const squareAt = (c: Point, r: number): Polygon => [
    [c[0] - kux * r + kuy * r, c[1] - kuy * r - kux * r],
    [c[0] + kux * r + kuy * r, c[1] + kuy * r - kux * r],
    [c[0] + kux * r - kuy * r, c[1] + kuy * r + kux * r],
    [c[0] - kux * r - kuy * r, c[1] - kuy * r + kux * r],
  ];
  const fits = (sq: Polygon) => sq.every((p) => clearInside(p, inner, WALL_CLEAR));
  let keep: Polygon | null = null, kr = kr0;
  // the donjon grows with the town it guards, but never outgrows the yard it stands in
  for (; kr > 1 && !keep; kr *= 0.9) {
    for (const t of [KEEP_OFFSET, 0.28, 0.2, 0.1, 0]) {
      const c: Point = [core[0] + (far[0] - core[0]) * t, core[1] + (far[1] - core[1]) * t];
      const sq = squareAt(c, kr);
      if (fits(sq)) { keep = sq; break; }
    }
    if (keep) break;
  }
  if (!keep) { kr = 1; keep = squareAt(core, kr); }
  // Everything else the eye reads as "castle" -- turrets, wall towers, the gate, the halls -- is in
  // units of the donjon: a great keep carries great towers.
  const scale = kr / BASE_KR;

  // The household's buildings lean on the inside of the curtain, as a castle's halls do: a hall is
  // roofed off the wall rather than set loose in the yard, which is also what keeps the yard open.
  // A bigger bailey holds more of them: hall, chapel, kitchens, lodgings.
  const annexes: Polygon[] = [];
  if (size >= 3) {
    const n = 1 + Math.round((size - 3) * 0.9) + (rng() < 0.5 ? 1 : 0);
    const lengths = Array.from({ length: n }, () => 3.2 * scale * (1 + rng() * 0.6));
    const depth = 2.4 * scale;
    const door = innerGate ?? gate;
    // Stands along the wall, a twenty-fourth of the way round at a time, the back of the court —
    // farthest from the way in — first. A ring cut from a Voronoi ward can have its length in one
    // edge or spread over many short ones, so a stand is anywhere along it, facing its own stretch.
    const edges = inner.map((a, i) => ({ a, b: inner[(i + 1) % inner.length] }));
    const perim = edges.reduce((t, e) => t + dist(e.a, e.b), 0);
    const stands: { at: Point; ux: number; uy: number; back: number }[] = [];
    for (let k = 0; k < 24; k++) {
      let s = (perim * (k + 0.5)) / 24;
      for (const e of edges) {
        const len = dist(e.a, e.b);
        if (s > len) { s -= len; continue; }
        const ux = (e.b[0] - e.a[0]) / (len || 1), uy = (e.b[1] - e.a[1]) / (len || 1);
        const at: Point = [e.a[0] + ux * s, e.a[1] + uy * s];
        stands.push({ at, ux, uy, back: dist(at, door) });
        break;
      }
    }
    stands.sort((x, y) => y.back - x.back);
    for (const st of stands) {
      if (annexes.length >= n) break;
      // whichever normal points into the yard
      const probe: Point = [st.at[0] - st.uy * 1.5, st.at[1] + st.ux * 1.5];
      const [nx, ny] = pointInPolygon(probe, inner) ? [-st.uy, st.ux] : [st.uy, -st.ux];
      const half = lengths[annexes.length];
      const base: Point = [st.at[0] + nx * WALL_CLEAR, st.at[1] + ny * WALL_CLEAR];
      const rect: Polygon = [
        [base[0] - st.ux * half, base[1] - st.uy * half],
        [base[0] + st.ux * half, base[1] + st.uy * half],
        [base[0] + st.ux * half + nx * depth, base[1] + st.uy * half + ny * depth],
        [base[0] - st.ux * half + nx * depth, base[1] - st.uy * half + ny * depth],
      ];
      if (!rect.every((p) => clearInside(p, inner, WALL_CLEAR - 0.6))) continue;
      if (polysOverlap(rect, keep) || annexes.some((an) => polysOverlap(rect, an))) continue;
      // the way in stays open
      if (rect.some((p) => dist(p, door) < 4 * scale)) continue;
      annexes.push(rect);
    }
  }

  // a great castle is entered through a gatehouse, not a doorway: two towers flanking the opening
  const reach = 3.2 * scale;
  const gatehouse: [Point, Point] | null = great
    ? [[gate[0] + gateEdge.ux * reach, gate[1] + gateEdge.uy * reach],
       [gate[0] - gateEdge.ux * reach, gate[1] - gateEdge.uy * reach]]
    : null;

  // The gate faced a strip of the castle's own grounds and nothing else: the street the ward stands
  // on is `d` further out. A lane runs from the gate straight out to it.
  let approach: Polyline | null = null;
  {
    const ring = outerWall ?? inner;
    const probe: Point = [gate[0] + gateEdge.uy * 1, gate[1] - gateEdge.ux * 1];
    const out: [number, number] = pointInPolygon(probe, ring) ? [-gateEdge.uy, gateEdge.ux] : [gateEdge.uy, -gateEdge.ux];
    let end: Point | null = null;
    for (let s = 1; s <= 40; s += 0.5) {
      const p: Point = [gate[0] + out[0] * s, gate[1] + out[1] * s];
      if (!pointInPolygon(p, ward) || !pointInPolygon(p, boundary)) { end = p; break; }
    }
    if (end && dist(end, gate) >= 3) approach = [gate, end];
  }

  return { innerWall: inner, towers: [...inner], gate, innerGate, postern, keep, annexes, scale, outerWall, gatehouse, approach };
}

function segDist(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/**
 * Where the castle's name stands: the most open spot of the ground the castle has, clear of its
 * donjon always and of its walls, halls and gate as far as the ground allows. A name is modelled as
 * the capsule its glyphs fill — `hw` either side of the point along the baseline (between a Korean
 * "성채" and an English "Castle" at the plate's 7 units), `hh` above and below the middle of the line.
 *
 * It used to walk out from the yard until it had just left the enceinte — so it stood ON the wall,
 * 2 units off its line against a 4.4-wide stroke, on all 125 castles of twelve worlds. A yard rarely
 * has a name's worth of open court once its donjon and halls stand in it (a capital's inner ward is
 * some 30 units across), so this does not demand a perfectly clear spot: it takes the clearest one,
 * with the yard preferred by a little — a name inside the enceinte says "this enclosure".
 */
export function castleLabelAt(c: Castle, ground: Polygon, blocked: (p: Point) => boolean, hw = 9, hh = 4): Point | null {
  const rings: [Polygon, number][] = [[c.innerWall, 2.4]];
  if (c.outerWall) rings.push([c.outerWall, 1.9]);
  const solids: Polygon[] = [c.keep, ...c.annexes];
  const points: Point[] = [c.gate, ...(c.innerGate ? [c.innerGate] : []), ...(c.gatehouse ?? [])];
  const [keep, ...halls] = solids;
  // how far the capsule stands clear of everything but the donjon (negative: it overlaps), or null
  // where it may not stand at all — on the donjon, or out of the castle's ground
  const clearance = (p: Point): number | null => {
    const a: Point = [p[0] - hw + hh, p[1] - 1.5], b: Point = [p[0] + hw - hh, p[1] - 1.5];
    if (!pointInPolygon(a, ground) || !pointInPolygon(b, ground)) return null;
    if (pointInPolygon(a, keep) || pointInPolygon(b, keep)) return null;
    for (let i = 0; i < keep.length; i++) if (segDist(a, b, keep[i], keep[(i + 1) % keep.length]) < hh + 1.5) return null;
    let m = Infinity;
    for (const [ring, half] of rings) for (let i = 0; i < ring.length; i++) m = Math.min(m, segDist(a, b, ring[i], ring[(i + 1) % ring.length]) - half);
    for (const s of halls) {
      if (pointInPolygon(a, s) || pointInPolygon(b, s)) { m = Math.min(m, -hh); continue; }
      for (let i = 0; i < s.length; i++) m = Math.min(m, segDist(a, b, s[i], s[(i + 1) % s.length]));
    }
    for (const q of points) m = Math.min(m, pointSegDist(q, a, b) - 3 * c.scale);
    // and the ground's own edge — the street, or the town wall
    for (let i = 0; i < ground.length; i++) m = Math.min(m, segDist(a, b, ground[i], ground[(i + 1) % ground.length]) - 2);
    return m - hh;
  };
  // What standing inside the enceinte is worth, in units of clearance; past CLEAR a spot is as good
  // as open, and the one nearer the middle of the yard wins, so a name centres in its court.
  const YARD = 1.5, CLEAR = 2;
  const middle = deepest(c.innerWall).at;
  const b = bbox(ground);
  let best: Point | null = null, bestScore = -Infinity;
  for (let y = b.minY + 1; y < b.maxY; y += 1.5) for (let x = b.minX + 1; x < b.maxX; x += 1.5) {
    const p: Point = [x, y];
    if (blocked(p)) continue;
    const cl = clearance(p);
    if (cl === null) continue;
    const score = Math.min(cl, CLEAR) + (pointInPolygon(p, c.innerWall) ? YARD : 0) - 0.02 * dist(p, middle);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}
