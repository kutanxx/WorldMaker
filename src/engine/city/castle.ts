// The lord's urban castle: integrated at the town wall with its own inner enceinte,
// a gate to the town and a postern to the countryside (research: Wikipedia "Urban castle").
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { insetEdges, centroid, pointInPolygon, polysOverlap, area, clipToConvex, pointSegDist, segmentsIntersect, bbox, splitByLine } from "../geometry";

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
// A castle's walls stand back from the street along each side of its ward by half that street's
// drawn width, half their own, and a little air: a main street is drawn 4.6 wide and a lane 2.6, the
// enceinte 4.4 and the outer curtain 3.4. They stood a flat 3 and 2 back, and the lines lay on the
// street's edge — the curtain on 56 of 80 great seats. (A flat 4.8, the main street's figure, cleared
// them all but cost 19 great seats their second ring, when most sides of a castle are lanes.)
const MAIN_HALF = 2.3, LANE_HALF = 1.3, AIR = 0.3;
const ENCEINTE_HALF = 2.2, CURTAIN_HALF = 1.7;
const BAILEY_MIN = 8;     // ...and the enceinte at least this far behind the curtain: a yard, not a seam
const HALL_SIZES = [1, 0.75]; // a household building at full size, or a lesser one where that does not fit
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
function ringOf(ward: Polygon, boundary: Polygon, d: number | number[]): Polygon {
  const pulled = (typeof d === "number" ? d > 0 : d.some((x) => x > 0)) ? insetEdges(ward, d) : ward;
  if (pulled.length < 3) return [];
  const cut = tidy(clipToConvex(boundary, pulled));
  return cut.length >= 3 && area(cut) > 1 ? cut : [];
}

// a street this far inside the ward runs through it, not along its edge
const ON_EDGE = 0.25;

/**
 * The ward as its streets are DRAWN. A main street is eased round every corner it turns
 * (`chainRoads`), and where it turns round the castle's own ward the eased corner is a chord across
 * that ward's corner: an enceinte kept its distance from the ward's edges stood as little as 3.8 off
 * the street itself, its 4.4-wide wall on the road's edge, on 7 castles of twelve worlds. Each stretch
 * of drawn street that runs inside the ward cuts the ward back to it — the larger side is the castle's.
 */
function wardOfStreets(ward: Polygon, streets: Polyline[]): Polygon {
  let out = ward;
  const b = bbox(ward);
  const runsInside = (a: Point, c: Point) => {
    const n = Math.max(2, Math.ceil(dist(a, c)));   // a sample every unit
    for (let k = 0; k <= n; k++) {
      const p: Point = [a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n];
      if (pointInPolygon(p, out) && edgeDist(p, out) > ON_EDGE) return true;
    }
    return false;
  };
  for (const r of streets) for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i], c = r[i + 1];
    if (Math.max(a[0], c[0]) < b.minX || Math.min(a[0], c[0]) > b.maxX
      || Math.max(a[1], c[1]) < b.minY || Math.min(a[1], c[1]) > b.maxY) continue;
    if (!runsInside(a, c)) continue;
    const parts = splitByLine(out, a, c).map(tidy).filter((p) => p.length >= 3);
    if (parts.length === 2) out = area(parts[0]) >= area(parts[1]) ? parts[0] : parts[1];
  }
  return out;
}

// a street this close to a side of the ward is drawn along it
const ON_SIDE = 0.6;

/** the half-width of the street drawn along each side of the ward: a main street's, or a lane's
 *  where only a lane runs there — or where none does, which asks the same of a wall. A side is a main
 *  street's too where one comes in to either of its ends: the castle's corner there stands off it. */
function sideStreets(ward: Polygon, main: Polyline[]): number[] {
  const nearMain = (p: Point) =>
    main.some((r) => { for (let k = 0; k + 1 < r.length; k++) if (pointSegDist(p, r[k], r[k + 1]) < ON_SIDE) return true; return false; });
  const atCorner = ward.map(nearMain);
  return ward.map((a, i) => {
    const j = (i + 1) % ward.length, b = ward[j];
    const along = [0.25, 0.5, 0.75].some((t) => nearMain([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
    return along || atCorner[i] || atCorner[j] ? MAIN_HALF : LANE_HALF;
  });
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

/** whether a ring is at least `need` deep anywhere — `deepest(ring).depth >= need`, stopping at the first
 *  point that shows it (the same points, in the same order) */
function reaches(ring: Polygon, need: number): boolean {
  if (ring.length < 3) return false;
  const c = centroid(ring);
  if (pointInPolygon(c, ring) && edgeDist(c, ring) >= need) return true;
  const b = bbox(ring);
  const step = Math.max(0.75, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 24);
  for (let y = b.minY + step / 2; y < b.maxY; y += step) for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    const p: Point = [x, y];
    if (pointInPolygon(p, ring) && edgeDist(p, ring) >= need) return true;
  }
  return false;
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
  rng: Rng, cell: Polygon, townCenter: Point, boundary: Polygon, size: number, isCapital = false,
  streets: { main: Polyline[]; minor: Polyline[] } = { main: [], minor: [] },
): Castle | null {
  const ward = wardOfStreets(cell, [...streets.main, ...streets.minor]);
  // how far each wall must stand off each side of the ward, for the street drawn along it
  const halves = sideStreets(ward, streets.main);
  const encFloor = halves.map((h) => h + ENCEINTE_HALF + AIR);
  const curtain = halves.map((h) => h + CURTAIN_HALF + AIR);
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
  // the enceinte withdrawn by d, but never nearer a street than that street's drawn edge allows
  const at = (d: number) => encFloor.map((f) => Math.max(f, d));
  const floor = Math.min(...encFloor);
  // the yard has to hold the donjon with its set-back from the rampart all round
  const holdsKeep = (ring: Polygon) => reaches(ring, WALL_CLEAR + kr0 * Math.SQRT2);
  // How far the enceinte stands back from the streets. Its area falls as it withdraws, so this is a
  // bisection for the yard the lord is owed — bounded by the one that still holds his tower. The
  // wall side is not withdrawn (see ringOf), which is why a flat "ward radius minus yard radius"
  // no longer answers it.
  const want = Math.PI * yardR * yardR;
  let lo = floor, hi = Math.max(floor, wardR);
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    const r = ringOf(ward, boundary, at(mid));
    if (r.length >= 3 && area(r) >= want && holdsKeep(r)) lo = mid; else hi = mid;
  }
  let d = lo;
  let inner = ringOf(ward, boundary, at(d));
  if (!holdsKeep(inner)) {
    // nothing withdrawn holds the keep: stand the enceinte as close to the streets as it may
    inner = ringOf(ward, boundary, encFloor);
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
    const back = curtain.map((c) => c + BAILEY_MIN);
    const withdrawn = at(d);
    const deeper = withdrawn.every((w, i) => w >= back[i]) ? inner : ringOf(ward, boundary, withdrawn.map((w, i) => Math.max(w, back[i])));
    const outer = ringOf(ward, boundary, curtain);
    const holdsSmallerKeep = reaches(deeper, WALL_CLEAR + 0.75 * kr0 * Math.SQRT2);
    if (outer.length >= 3 && holdsSmallerKeep) { inner = deeper; outerWall = outer; }
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
      const base: Point = [st.at[0] + nx * WALL_CLEAR, st.at[1] + ny * WALL_CLEAR];
      // A lesser building where the hall does not fit: a size-6 seat's donjon, 12 across, left no
      // stretch of its yard a full-sized hall could stand on, and the greatest seat had none at all.
      for (const f of HALL_SIZES) {
        const half = lengths[annexes.length] * f, deep = depth * f;
        const rect: Polygon = [
          [base[0] - st.ux * half, base[1] - st.uy * half],
          [base[0] + st.ux * half, base[1] + st.uy * half],
          [base[0] + st.ux * half + nx * deep, base[1] + st.uy * half + ny * deep],
          [base[0] - st.ux * half + nx * deep, base[1] - st.uy * half + ny * deep],
        ];
        if (!rect.every((p) => clearInside(p, inner, WALL_CLEAR - 0.6))) continue;
        if (polysOverlap(rect, keep) || annexes.some((an) => polysOverlap(rect, an))) continue;
        // the way in stays open
        if (rect.some((p) => dist(p, door) < 4 * scale)) continue;
        annexes.push(rect);
        break;
      }
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

// the middle of a name's line, above its baseline (see castleLabelAt)
const MID = 2.5;

function segDist(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/**
 * Where the castle's name stands: the most open spot of the ground the castle has, clear of its
 * donjon always and of its walls, halls and gate as far as the ground allows. A name is modelled as
 * the capsule its glyphs fill — `hw` either side of the point along the baseline (between a Korean
 * "성채" and an English "Castle" at the plate's 7 units), `hh` above and below the middle of the line.
 * The middle of the line is MID above the baseline the point gives: measured on the page, "성채" at 7
 * units stands 7.1 above its baseline and 2.1 below it, and a middle taken 1.5 up let the tops of the
 * glyphs onto a wall above them.
 *
 * It used to walk out from the yard until it had just left the enceinte — so it stood ON the wall,
 * 2 units off its line against a 4.4-wide stroke, on all 125 castles of twelve worlds. A yard rarely
 * has a name's worth of open court once its donjon and halls stand in it (a capital's inner ward is
 * some 30 units across), so this does not demand a perfectly clear spot: it takes the clearest one,
 * with the yard preferred by a little — a name inside the enceinte says "this enclosure".
 */
export function castleLabelAt(c: Castle, ground: Polygon, blocked: (p: Point) => boolean, hw = 9, hh = 4.6): Point | null {
  const rings: [Polygon, number][] = [[c.innerWall, 2.4]];
  if (c.outerWall) rings.push([c.outerWall, 1.9]);
  const solids: Polygon[] = [c.keep, ...c.annexes];
  const points: Point[] = [c.gate, ...(c.innerGate ? [c.innerGate] : []), ...(c.gatehouse ?? [])];
  const [keep, ...halls] = solids;
  // how far the capsule stands clear of everything but the donjon (negative: it overlaps), or null
  // where it may not stand at all — on the donjon, or out of the castle's ground
  const clearance = (p: Point): number | null => {
    const a: Point = [p[0] - hw + hh, p[1] - MID], b: Point = [p[0] + hw - hh, p[1] - MID];
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
  for (let y = b.minY + 1; y < b.maxY; y += 2) for (let x = b.minX + 1; x < b.maxX; x += 2) {
    const p: Point = [x, y];
    if (blocked(p)) continue;
    const cl = clearance(p);
    if (cl === null) continue;
    const score = Math.min(cl, CLEAR) + (pointInPolygon(p, c.innerWall) ? YARD : 0) - 0.02 * dist(p, middle);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}
