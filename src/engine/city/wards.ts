import { Delaunay } from "d3-delaunay";
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { clipToConvex, area } from "../geometry";

export interface WardCell {
  polygon: Polygon;
  site: Point;
}

export function discPolygon(cx: number, cy: number, r: number, segments = 32): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function generateWards(rng: Rng, cx: number, cy: number, radius: number, count: number): WardCell[] {
  const sites: Point[] = [];
  let guard = 0;
  while (sites.length < count && guard < count * 100) {
    guard++;
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * radius * 0.92;
    sites.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([cx - radius, cy - radius, cx + radius, cy + radius]);
  const disc = discPolygon(cx, cy, radius, 48);
  const wards: WardCell[] = [];
  for (let i = 0; i < sites.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    const poly = clipToConvex(cell.map(([x, y]) => [x, y] as Point), disc);
    if (poly.length >= 3 && area(poly) > 1) wards.push({ polygon: poly, site: sites[i] });
  }
  return wards;
}
