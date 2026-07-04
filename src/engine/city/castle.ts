// The lord's urban castle: integrated at the town wall with its own inner enceinte,
// a gate to the town and a postern to the countryside (research: Wikipedia "Urban castle").
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { insetPolygon, centroid, pointInPolygon } from "../geometry";

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
  const kr = size >= 3 ? 4.2 : 3;
  const theta = rng() * Math.PI;
  const kux = Math.cos(theta), kuy = Math.sin(theta);
  const keep: Polygon = [
    [kc[0] - kux * kr - -kuy * kr, kc[1] - kuy * kr - kux * kr],
    [kc[0] + kux * kr - -kuy * kr, kc[1] + kuy * kr - kux * kr],
    [kc[0] + kux * kr + -kuy * kr, kc[1] + kuy * kr + kux * kr],
    [kc[0] - kux * kr + -kuy * kr, kc[1] - kuy * kr + kux * kr],
  ];
  const annexes: Polygon[] = [];
  if (size >= 3) {
    const n = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const ac: Point = [wc[0] + Math.cos(a) * kr * 2.2, wc[1] + Math.sin(a) * kr * 2.2];
      if (!pointInPolygon(ac, inner)) continue;
      annexes.push([
        [ac[0] - 3, ac[1] - 2], [ac[0] + 3, ac[1] - 2], [ac[0] + 3, ac[1] + 2], [ac[0] - 3, ac[1] + 2],
      ]);
    }
  }
  return { innerWall: inner, towers: [...inner], gate, postern, keep, annexes };
}
