// The lord's urban castle: integrated at the town wall with its own inner enceinte,
// a gate to the town and a postern to the countryside (research: Wikipedia "Urban castle").
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { insetPolygon, insetConvex, centroid, pointInPolygon, polysOverlap, area } from "../geometry";

export interface Castle {
  innerWall: Polygon;      // inset of the ward polygon
  towers: Point[];         // innerWall vertices
  gate: Point;             // innerWall edge midpoint nearest the town center
  postern: Point | null;   // innerWall edge midpoint nearest the town wall, if the ward touches it
  keep: Polygon;           // big donjon at the ward interior
  annexes: Polygon[];      // hall/chapel, size>=3 only
  scale: number;           // ornament scale — 1 at a market town's seat, larger at a great one
  outerWall: Polygon | null;         // great seats only: an outer curtain with a bailey inside it
  gatehouse: [Point, Point] | null;  // great seats only: the towers flanking the gate
}

const TOUCH = 14; // ward counts as "at the wall" if a vertex is this close to the boundary ring
const GREAT_SIZE = 5;  // a lord's seat this big, or a capital's at any size, is a GREAT castle
const BASE_KR = 4.3;   // the donjon half-width of a size-3 market town: the unit the ornament is in
const KEEP_OFFSET = 0.35; // how far the donjon sits from the yard's middle toward its refuge corner
const WALL_CLEAR = 3.4;   // buildings stand this far off the enceinte -- it is drawn 4.4 wide

// the midpoint of the edge nearest a target, and the unit vector ALONG that edge (a gatehouse's
// two towers flank the opening, so they need the run of the wall, not just the point on it)
function nearestEdge(poly: Polygon, target: Point): { mid: Point; ux: number; uy: number } {
  let best: Point = poly[0], bd = Infinity, bux = 1, buy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = Math.hypot(m[0] - target[0], m[1] - target[1]);
    if (d < bd) {
      bd = d; best = m;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      bux = dx / len; buy = dy / len;
    }
  }
  return { mid: best, ux: bux, uy: buy };
}
const nearestEdgeMid = (poly: Polygon, target: Point): Point => nearestEdge(poly, target).mid;

export function makeCastle(
  rng: Rng, ward: Polygon, townCenter: Point, boundary: Polygon, size: number, isCapital = false,
): Castle | null {
  // A great seat is set back behind TWO walls: the ward's own edge becomes an outer curtain and the
  // enceinte withdraws, leaving an outer bailey between them. A lesser seat keeps its single ring.
  const great = isCapital || size >= GREAT_SIZE;
  const kr0 = 2.5 + size * 0.6;
  // The withdrawal has to be in proportion to the ward, not a constant: a flat 9 off a ward some
  // 42 units across left the two rings 6.5 apart, and with a tower on every vertex of each the two
  // rows of them touched. A bailey is a yard you could muster in, so the enceinte pulls back by a
  // share of the ward's own reach.
  // ...and a LESSER seat withdraws too. Its enceinte used to be the ward inset by three, so its own
  // towers sat on the ward's edge -- where the town wall runs -- and the castle read as a large
  // empty pane of colour with a speck of keep in it, which is most of why every seat looked alike.
  //
  // The enceinte is sized by the TOWN, not by the ward it stands in. Measured over thirty seeds,
  // the castle ward grows only 1.17x from a size-3 town to a size-6 one while the town itself
  // grows 1.375x -- wards are Voronoi cells and there are 8 + 3*size of them, so each one is a
  // SHRINKING share of a growing town. Anything cut as a share of the ward therefore shrinks
  // relative to the plate, which is why the seat of a great capital covered exactly the same
  // fraction of its map as a market town's. So the ward only bounds the castle now: the enceinte
  // encloses a yard of its own that grows with the lord, and a small seat sits well inside its
  // grounds while a great one fills them.
  const wardR = Math.sqrt(Math.abs(area(ward)) / Math.PI);
  // The yard grows FASTER than the town (5 + 3.7*size against a town radius of 60 + 12*size), which
  // is the whole point: grown at the town's own rate it would hold the same share of every plate,
  // which is what it did. It is capped by the ward -- and a great seat keeps eight units of it back
  // for the bailey, because within one Voronoi cell you may have a wide yard or two rings of wall,
  // not both, and two rings are what says "great".
  // ...with a floor, or a small seat's yard closes on its own donjon: the yard has to hold the
  // keep's diagonal AND the set-back from the rampart AND the offset to the refuge corner, and
  // below that a size-2 keep came out SMALLER than a size-1 one, shrunk by the fit loop.
  const minYard = (kr0 * Math.SQRT2 + WALL_CLEAR) / (1 - KEEP_OFFSET);
  const yardR = Math.min(Math.max(5 + size * 3.7, minYard), Math.max(6, wardR - (great ? 8 : 3)));
  // insetConvex, not insetPolygon: the radial one pulls every vertex toward the centroid, which at
  // the shallow insets this code used to take was close enough, but at a withdrawal of fifteen or
  // twenty units it turns an irregular Voronoi ward into a scalene sliver rather than a smaller
  // copy of itself. Wards are convex, which is exactly what the edge-normal offset wants.
  // The withdrawal is as deep as the ward can bear, not a nominal distance: insetConvex now
  // guarantees the clearance it is asked for, so a ward that is not round gives back a smaller yard
  // than its radius suggests, and a size-3 seat's donjon was being shrunk to fit (keep 74 -> 49).
  // Back the inset off until the yard can actually hold the tower with its rampart set-back --
  // which is the same guarantee, asked as a question.
  // ...and the shallowest withdrawal has to bend for a small ward too. A flat three or four units
  // is nothing against a great capital's bailey and most of the yard of a hamlet's, where it left
  // a donjon of 9 where 38 was intended.
  const floor = Math.max(1.5, Math.min(size >= 3 ? 3 : 4, wardR * 0.18));
  const want = Math.max(floor, wardR - yardR);
  // the donjon does not sit in the middle of the yard but KEEP_OFFSET of the way to its refuge
  // corner, so the room it needs is its diagonal scaled by that, plus the set-back off the rampart
  const holdsKeep = (yd: Polygon) => insetConvex(yd, WALL_CLEAR + (kr0 * Math.SQRT2) / (1 - KEEP_OFFSET)).length >= 3;
  let inner = insetConvex(ward, Math.max(floor, want * 0.2));
  if (inner.length < 3) inner = insetPolygon(ward, floor);
  for (let f = 0.36; f <= 1.001; f += 0.16) {
    const cand = insetConvex(ward, Math.max(floor, want * f));
    if (cand.length < 3 || !holdsKeep(cand)) break;   // any deeper and the donjon no longer fits
    inner = cand;
  }
  // a curtain is only a curtain if there is a bailey behind it; where the enceinte already fills
  // the ward the two rings would be drawn on top of each other
  let outerWall: Polygon | null =
    great && inner.length >= 3 && wardR - yardR > 6 ? insetConvex(ward, 2) : null;
  if (inner.length < 3) { inner = insetPolygon(ward, size >= 3 ? 3 : 4); outerWall = null; }
  if (outerWall && outerWall.length < 3) outerWall = null;
  if (inner.length < 3) return null;
  const wc = centroid(inner);
  if (!pointInPolygon(wc, ward)) return null;      // degenerate inset (concave ward)
  const gateEdge = nearestEdge(inner, townCenter);
  const gate = gateEdge.mid;
  // postern: only if the ward actually touches the town wall ring
  let postern: Point | null = null;
  let minToWall = Infinity; let wallPt: Point = boundary[0];
  for (const v of ward) for (const b of boundary) {
    const d = Math.hypot(v[0] - b[0], v[1] - b[1]);
    if (d < minToWall) { minToWall = d; wallPt = b; }
  }
  if (minToWall < TOUCH) postern = nearestEdgeMid(inner, wallPt);
  // keep: a stout rect at the point of the inner ward farthest from the gate (deepest refuge)
  let far: Point = wc, fd = -1;
  for (const v of inner) { const d = Math.hypot(v[0] - gate[0], v[1] - gate[1]); if (d > fd) { fd = d; far = v; } }
  const kc: Point = [wc[0] + (far[0] - wc[0]) * KEEP_OFFSET, wc[1] + (far[1] - wc[1]) * KEEP_OFFSET];
  // The donjon grows with the town it guards. This was a two-step switch -- 3 below size 3 and 4.2
  // at or above it -- so measured over fifteen seeds the keep came out at exactly two areas, 36 and
  // 71, and a size-6 royal capital's tower was identical to a size-3 market town's. The bailey did
  // grow, because the ward it sits in scales with the town, but the tower a reader reads as THE
  // castle did not.
  // Buildings stand clear of the wall, they do not stand ON it. The enceinte is drawn as a 4.4-wide
  // band with drum towers on it, so a donjon tested only for being "inside the polygon" came out
  // lying across its own rampart. Everything inside is placed against this set-back line instead.
  const clearance = insetConvex(inner, WALL_CLEAR);
  const yard = clearance.length >= 3 ? clearance : inner;
  const theta = rng() * Math.PI; // drawn here as before, so no other draw in the town moves
  const kux = Math.cos(theta), kuy = Math.sin(theta);
  const squareAt = (r: number): Polygon => [
    [kc[0] - kux * r - -kuy * r, kc[1] - kuy * r - kux * r],
    [kc[0] + kux * r - -kuy * r, kc[1] + kuy * r - kux * r],
    [kc[0] + kux * r + -kuy * r, kc[1] + kuy * r + kux * r],
    [kc[0] - kux * r + -kuy * r, kc[1] - kuy * r + kux * r],
  ];
  // ...but never outgrows the bailey it stands in: a big town whose castle ward came out small
  // still gets a tower that fits inside its own wall.
  let kr = kr0;
  while (kr > 2 && !squareAt(kr).every((p) => pointInPolygon(p, yard))) kr *= 0.9;
  // ...and if even the smallest donjon will not fit at the refuge corner, it falls back to the
  // middle of the yard, where a polygon always has room. The shrink loop alone bottomed out at
  // kr = 2 and handed back a keep that was still outside its own wall (2 towns of 333).
  if (!squareAt(kr).every((p) => pointInPolygon(p, yard))) {
    kc[0] = wc[0]; kc[1] = wc[1];
    kr = kr0;
    while (kr > 1 && !squareAt(kr).every((p) => pointInPolygon(p, yard))) kr *= 0.9;
  }
  const keep: Polygon = squareAt(kr);
  // Everything else the eye reads as "castle" -- turrets, wall towers, the gate, the halls -- used
  // to be a constant, so a royal seat wore a market town's furniture. It is all in units of the
  // donjon now: a great keep carries great towers.
  const scale = kr / BASE_KR;
  const annexes: Polygon[] = [];
  if (size >= 3) {
    // a bigger bailey holds more of the household: hall, chapel, kitchens, lodgings
    const n = 1 + Math.round((size - 3) * 0.9) + (rng() < 0.5 ? 1 : 0);
    const a0 = rng() * Math.PI * 2;
    const ax = 3 * scale, ay = 2 * scale;
    for (let i = 0; i < n; i++) {
      // spread around the keep rather than scattered at random -- four halls drawn on independent
      // angles clump, and a clump reads as one building. Each tries a little further out in turn,
      // so a hall that will not fit beside the keep finds room against the wall instead.
      for (let attempt = 0; attempt < 6; attempt++) {
        // each attempt swings the angle as well as reaching further out: a yard is a Voronoi
        // polygon and can be narrow, and six attempts down ONE bearing all failed against the same
        // near edge, leaving a castle with no hall at all
        const a = a0 + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5 + attempt * 0.8;
        const rr = kr * (2.0 + attempt * 0.3);
        const ac: Point = [wc[0] + Math.cos(a) * rr, wc[1] + Math.sin(a) * rr];
        const rect: Polygon = [
          [ac[0] - ax, ac[1] - ay], [ac[0] + ax, ac[1] - ay], [ac[0] + ax, ac[1] + ay], [ac[0] - ax, ac[1] + ay],
        ];
        if (!rect.every((p) => pointInPolygon(p, yard))) continue;
        if (polysOverlap(rect, keep) || annexes.some((an) => polysOverlap(rect, an))) continue;
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
  return { innerWall: inner, towers: [...inner], gate, postern, keep, annexes, scale, outerWall, gatehouse };
}
