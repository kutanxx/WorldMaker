// The lord's urban castle: integrated at the town wall with its own inner enceinte,
// a gate to the town and a postern to the countryside (research: Wikipedia "Urban castle").
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { insetPolygon, centroid, pointInPolygon, polysOverlap } from "../geometry";

export interface Castle {
  innerWall: Polygon;      // inset of the ward polygon
  towers: Point[];         // innerWall vertices
  gate: Point;             // innerWall edge midpoint nearest the town center
  postern: Point | null;   // innerWall edge midpoint nearest the town wall, if the ward touches it
  keep: Polygon;           // big donjon at the ward interior
  annexes: Polygon[];      // hall/chapel, size>=3 only
}

const TOUCH = 14; // ward counts as "at the wall" if a vertex is this close to the boundary ring

function nearestEdgeMid(poly: Polygon, target: Point): Point {
  let best: Point = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = Math.hypot(m[0] - target[0], m[1] - target[1]);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

export function makeCastle(rng: Rng, ward: Polygon, townCenter: Point, boundary: Polygon, size: number): Castle | null {
  const inner = insetPolygon(ward, size >= 3 ? 3 : 4);
  if (inner.length < 3) return null;
  const wc = centroid(inner);
  if (!pointInPolygon(wc, ward)) return null;      // degenerate inset (concave ward)
  const gate = nearestEdgeMid(inner, townCenter);
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
  const kc: Point = [wc[0] + (far[0] - wc[0]) * 0.45, wc[1] + (far[1] - wc[1]) * 0.45];
  // The donjon grows with the town it guards. This was a two-step switch -- 3 below size 3 and 4.2
  // at or above it -- so measured over fifteen seeds the keep came out at exactly two areas, 36 and
  // 71, and a size-6 royal capital's tower was identical to a size-3 market town's. The bailey did
  // grow, because the ward it sits in scales with the town, but the tower a reader reads as THE
  // castle did not.
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
  let kr = 2.5 + size * 0.6;
  while (kr > 2 && !squareAt(kr).every((p) => pointInPolygon(p, inner))) kr *= 0.9;
  const keep: Polygon = squareAt(kr);
  const annexes: Polygon[] = [];
  if (size >= 3) {
    const n = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      // try a few angles so a second annex doesn't land on the first (or the keep) — the halls
      // shared the bailey but never occupied the same footprint
      for (let attempt = 0; attempt < 6; attempt++) {
        const a = rng() * Math.PI * 2;
        const ac: Point = [wc[0] + Math.cos(a) * kr * 2.2, wc[1] + Math.sin(a) * kr * 2.2];
        if (!pointInPolygon(ac, inner)) continue;
        const rect: Polygon = [
          [ac[0] - 3, ac[1] - 2], [ac[0] + 3, ac[1] - 2], [ac[0] + 3, ac[1] + 2], [ac[0] - 3, ac[1] + 2],
        ];
        if (polysOverlap(rect, keep) || annexes.some((an) => polysOverlap(rect, an))) continue;
        annexes.push(rect);
        break;
      }
    }
  }
  return { innerWall: inner, towers: [...inner], gate, postern, keep, annexes };
}
