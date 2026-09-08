import { Delaunay } from "d3-delaunay";
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { clipToConvex, area } from "../geometry";
import type { StreetField } from "./archetypes";

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

// Where these points land decides everything downstream: they are Voronoi'd into the wards, and the
// shared cell edges ARE the streets. Scattering them uniformly in a disc — which is what every kind
// of town used to get — gives the wheel of wedges radiating from a centre that made every plan read
// the same. The archetype's `streetField` names four kinds of plan; this is where it becomes one.
function discSites(rng: Rng, cx: number, cy: number, radius: number, count: number): Point[] {
  const sites: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * radius * 0.92;
    sites.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return sites;
}

// A planned town: the points sit on a lattice, so their cells come out four-sided and the streets
// between them meet at right angles. The lattice carries its own heading — otherwise every grid
// town on the map would align to the page — and the points are jittered by a fraction of the
// spacing, which keeps the blocks from being mechanically identical without losing the grid.
function gridSites(rng: Rng, cx: number, cy: number, radius: number, count: number): Point[] {
  const heading = rng() * Math.PI * 0.5; // a quarter turn covers every distinct lattice orientation
  const step = radius * Math.sqrt(Math.PI / count); // spacing that fits about `count` points in the disc
  const JITTER = 0.05;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const reach = Math.ceil(radius / step) + 1;
  const sites: Point[] = [];
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const lx = i * step + (rng() - 0.5) * 2 * JITTER * step;
      const ly = j * step + (rng() - 0.5) * 2 * JITTER * step;
      const x = cx + lx * cos - ly * sin, y = cy + lx * sin + ly * cos;
      if (Math.hypot(x - cx, y - cy) <= radius * 0.92) sites.push([x, y]);
    }
  }
  return sites;
}

export function generateWards(
  rng: Rng, cx: number, cy: number, radius: number, count: number, field: StreetField = "organic",
): WardCell[] {
  const sites = field === "grid" ? gridSites(rng, cx, cy, radius, count) : discSites(rng, cx, cy, radius, count);
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([cx - radius, cy - radius, cx + radius, cy + radius]);
  const disc = discPolygon(cx, cy, radius, 48);
  const wards: WardCell[] = [];
  for (let i = 0; i < sites.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    const poly = clipToConvex(cell.map(([x, y]) => [x, y] as Point), disc);
    // drop degenerate clipped cells (< 1 sq unit)
    if (poly.length >= 3 && area(poly) > 1) wards.push({ polygon: poly, site: sites[i] });
  }
  return wards;
}
