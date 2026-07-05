// Block-centric streets (Watabou-style): the city is partitioned into ward blocks and the
// streets are the gaps between them — i.e. the edges shared by two adjacent wards.
import type { Point, Polyline } from "../geometry";
import type { WardCell } from "./wards";

export interface StreetGraph {
  nodes: Point[];
  edges: [number, number][];
  segments: Polyline[];
}

const KEY = (p: Point) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`; // 0.25px snap grid

// an edge shared by exactly two ward polygons is an interior street; an edge on the city
// perimeter belongs to one ward (the wall side) and is not a street.
export function extractStreets(wards: WardCell[]): StreetGraph {
  const seen = new Map<string, { a: Point; b: Point; n: number }>();
  for (const w of wards) {
    const poly = w.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ka = KEY(a), kb = KEY(b);
      if (ka === kb) continue;
      const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      const rec = seen.get(key);
      if (rec) rec.n++;
      else seen.set(key, { a, b, n: 1 });
    }
  }
  const nodeIndex = new Map<string, number>();
  const nodes: Point[] = [];
  const nodeOf = (p: Point) => {
    const k = KEY(p);
    let idx = nodeIndex.get(k);
    if (idx === undefined) { idx = nodes.length; nodeIndex.set(k, idx); nodes.push(p); }
    return idx;
  };
  const edges: [number, number][] = [];
  const segments: Polyline[] = [];
  for (const { a, b, n } of seen.values()) {
    if (n !== 2) continue;
    const ia = nodeOf(a), ib = nodeOf(b);
    if (ia !== ib) { edges.push([ia, ib]); segments.push([a, b]); }
  }
  return { nodes, edges, segments };
}
