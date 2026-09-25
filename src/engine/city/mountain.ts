import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon } from "../geometry";
import type { Archetype } from "./archetypes";

export interface MountainMass {
  polygon: Polygon;    // inner rim arc (city side) → outer canvas edge (wedge mass)
  innerEdge: Polyline; // city-facing rim arc, ordered by angle
  steep: boolean;      // spur/valleyPass = sharp cliff; hillside = gentle slope
}

interface MassSpec { dir: number; phi: number; steep: boolean }

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// The four archetypes the high ground produces; hilltopFortress was missing from this list, which
// is how the one kind named for its hill ended up as a walled town on a flat plain.
const MOUNTAIN_SHAPED = new Set<Archetype["id"]>(["hilltopFortress", "hillside", "spur", "valleyPass"]);

// the half-width of a spur's ridge, round the town
const SPUR_PHI = 0.55;

function massSpecs(rng: Rng, id: Archetype["id"], toward?: number): MassSpec[] {
  // (drawn whether or not the world says, so the stream behind it does not move)
  const drawn = rng() * Math.PI * 2;
  const base = toward ?? drawn;
  // One broad shoulder, not a collar. These masses run out to the edge of the plate, so a ring of
  // them would bury the fields, hamlets and mills that live outside the wall; a wide flank reads as
  // a fortress holding the end of a ridge and leaves the rest of the ground open.
  if (id === "hilltopFortress") return [{ dir: base, phi: 1.5, steep: true }];
  if (id === "hillside") return [{ dir: base, phi: 0.9, steep: false }];
  // A spur hangs off the high ground behind it: one narrow ridge running back into the mountains. It
  // was three wedges spaced round the town, which read as mountains on every side of it.
  if (id === "spur") return [{ dir: base, phi: SPUR_PHI, steep: true }];
  // valleyPass: two opposite valley walls
  return [{ dir: base, phi: 0.7, steep: true }, { dir: base + Math.PI, phi: 0.7, steep: true }];
}

/**
 * The high ground round a town, where the world has it (`site`): which way the mountain cells beside
 * the town's own lie, their share of its neighbours, and a stream of its own for the foothills'
 * outline. A mountain town's masses face that way; a town at the foot of mountains has them rise past
 * its fields on that side. Without a site, a mountain town draws its own direction as it always did.
 * `facing` is the way the ground a mountain town stands on rises (see relief.ts) — a valley's the
 * line its walls stand on — and where it is given, a mountain town's masses face it instead: the
 * mountain cells beside a town on a summit lie all round it, lower than it, and its ridge runs one way.
 */
export interface MountainSite { bearing?: number; share?: number; rng?: Rng; wet?: (p: Point) => boolean; facing?: number }

export function makeMountains(
  rng: Rng, archetype: Archetype, boundary: Polygon, center: Point, bounds: { w: number; h: number },
  site: MountainSite = {},
): MountainMass[] {
  if (!MOUNTAIN_SHAPED.has(archetype.id)) {
    return site.bearing !== undefined && site.share && site.rng ? foothills(site.rng, boundary, center, bounds, site.bearing, site.share, site.wet ?? (() => false)) : [];
  }
  // A town on its summit stands on its own hill (see makeHill); its rock is the ridge running on past
  // its fields, narrow, the way the world's high ground runs. It was one broad shoulder of rock against
  // its wall, 30-34% of its plate, which read as a town at the foot of a massif.
  if (archetype.id === "hilltopFortress" && site.facing !== undefined && site.rng) {
    return foothills(site.rng, boundary, center, bounds, site.facing, RIDGE_SHARE, site.wet ?? (() => false), RIDGE_GAP);
  }
  const specs = massSpecs(rng, archetype.id, site.facing ?? site.bearing);
  const noise = createNoise2D(rng);
  const vAng = boundary.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]));

  const masses: MountainMass[] = [];
  for (const spec of specs) {
    const inner: Point[] = [];
    for (let i = 0; i < boundary.length; i++) {
      if (Math.abs(wrap(vAng[i] - spec.dir)) <= spec.phi) inner.push(boundary[i]);
    }
    if (inner.length < 2) continue;
    inner.sort((a, b) =>
      wrap(Math.atan2(a[1] - center[1], a[0] - center[0]) - spec.dir) -
      wrap(Math.atan2(b[1] - center[1], b[0] - center[0]) - spec.dir));

    const outer: Point[] = [];
    for (const p of inner) {
      const dx = p[0] - center[0], dy = p[1] - center[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const tx = ux > 0 ? (bounds.w - 2 - p[0]) / ux : ux < 0 ? (2 - p[0]) / ux : Infinity;
      const ty = uy > 0 ? (bounds.h - 2 - p[1]) / uy : uy < 0 ? (2 - p[1]) / uy : Infinity;
      const reach = Math.max(6, Math.min(tx, ty)) * (0.7 + 0.3 * (noise(p[0] * 0.05, p[1] * 0.05) * 0.5 + 0.5));
      outer.push([p[0] + ux * reach, p[1] + uy * reach]);
    }
    masses.push({ polygon: inner.concat([...outer].reverse()), innerEdge: inner, steep: spec.steep });
  }
  return masses;
}

export function inMountains(masses: MountainMass[], p: Point): boolean {
  return masses.some((m) => pointInPolygon(p, m.polygon));
}

// the foothills begin this far past the town's wall — its gardens and near fields lie between — and
// keep at least this much of the plate where the town reaches nearly to its edge
const FOOT_GAP = 40, FOOT_MIN = 18;

// A hill-top town's slope runs this far out from its wall on its steep sides and this far toward its
// ridge, beginning this far outside the wall, drawn at this many bearings round it
const HILL_STEEP = 16, HILL_GENTLE = 44, HILL_GAP = 3, HILL_BEARINGS = 144;
// ...and its ridge runs on past the foot of it as narrow high ground (the foothills of a town with
// this share of mountain round it), beginning this far past its wall
const RIDGE_SHARE = 0.1, RIDGE_GAP = HILL_GAP + HILL_GENTLE + 8;

/**
 * A town on a summit stands ON its hill: the ground falls away from its wall all round — steep and
 * short on every side, long and gentle toward its ridge (`ridge`, the way the world's high ground runs
 * on). The slope is a band from its brow, just outside the wall, to its foot in the country, paired
 * bearing by bearing so it can be drawn as hachures down it. Walls, gates and roads cross it; fields,
 * hamlets and the country's landmarks keep off it. `band` is the slope as one polygon (its brow and its
 * foot joined by a seam), for a point test.
 */
export interface Hill { brow: Polyline; foot: Polyline; band: Polygon }

export function makeHill(boundary: Polygon, center: Point, bounds: { w: number; h: number }, ridge: number): Hill {
  // how far the town reaches along a bearing: where a ray from its middle leaves its outline
  const reachAt = (ux: number, uy: number) => {
    let best = 0;
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length];
      const ex = b[0] - a[0], ey = b[1] - a[1], den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const ax = a[0] - center[0], ay = a[1] - center[1];
      const t = (ax * ey - ay * ex) / den, s = (ax * uy - ay * ux) / den;
      if (t > 0 && s >= 0 && s <= 1) best = Math.max(best, t);
    }
    return best;
  };
  const brow: Point[] = [], foot: Point[] = [];
  for (let k = 0; k < HILL_BEARINGS; k++) {
    const a = (k / HILL_BEARINGS) * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
    const tx = ux > 1e-9 ? (bounds.w - center[0]) / ux : ux < -1e-9 ? -center[0] / ux : Infinity;
    const ty = uy > 1e-9 ? (bounds.h - center[1]) / uy : uy < -1e-9 ? -center[1] / uy : Infinity;
    const edge = Math.min(tx, ty) - 2;
    const toward = ((1 + Math.cos(a - ridge)) / 2) ** 2;   // 1 along the ridge, 0 away from it
    const rb = Math.min(reachAt(ux, uy) + HILL_GAP, edge - 1);
    const rf = Math.min(rb + HILL_STEEP + (HILL_GENTLE - HILL_STEEP) * toward, edge);
    brow.push([center[0] + ux * rb, center[1] + uy * rb]);
    foot.push([center[0] + ux * rf, center[1] + uy * rf]);
  }
  const band: Polygon = [...brow, brow[0], foot[0], ...foot.slice(1).reverse(), foot[0]];
  return { brow, foot, band };
}
// ...and stand this far off any water crossing their band
const WATER_CLEAR = 6;

/**
 * High ground rising past the fields of a town at the foot of mountains: a band between the town's
 * reach and the edge of the plate, across the arc the mountains fill (wider the more of the town's
 * neighbours they are), steep where they close round it. The town keeps its own form. Where a river
 * runs out through the band it cuts it: the band is drawn in pieces, one either side of the water.
 */
function foothills(rng: Rng, boundary: Polygon, center: Point, bounds: { w: number; h: number }, bearing: number, share: number, wet: (p: Point) => boolean, gap = FOOT_GAP): MountainMass[] {
  const noise = createNoise2D(rng);
  const phi = Math.min(1.5, 0.35 + share * 1.3);
  const radial = boundary.map((p) => ({ a: Math.atan2(p[1] - center[1], p[0] - center[0]), r: Math.hypot(p[0] - center[0], p[1] - center[1]) }));
  const farthest = Math.max(...radial.map((q) => q.r));
  const reachAt = (a: number) => radial.reduce((r, q) => (Math.abs(wrap(q.a - a)) < 0.3 ? Math.max(r, q.r) : r), 0) || farthest;
  const masses: MountainMass[] = [];
  let inner: Point[] = [], outer: Point[] = [];
  const close = () => {
    if (inner.length >= 3) masses.push({ polygon: inner.concat([...outer].reverse()), innerEdge: inner, steep: share >= 0.5 });
    inner = []; outer = [];
  };
  const K = 40;
  for (let k = 0; k <= K; k++) {
    const a = bearing - phi + (2 * phi * k) / K;
    const ux = Math.cos(a), uy = Math.sin(a);
    const tx = ux > 0.001 ? (bounds.w - 2 - center[0]) / ux : ux < -0.001 ? (2 - center[0]) / ux : Infinity;
    const ty = uy > 0.001 ? (bounds.h - 2 - center[1]) / uy : uy < -0.001 ? (2 - center[1]) / uy : Infinity;
    const edge = Math.min(tx, ty);
    const rIn = Math.min(edge - FOOT_MIN, reachAt(a) + gap + noise(ux * 1.6, uy * 1.6) * 10);
    // the band along this ray, from its foot to the edge of the plate: a ray the water crosses is a gap
    let dry = true;
    for (let r = rIn - WATER_CLEAR; r <= edge && dry; r += 3) if (wet([center[0] + ux * r, center[1] + uy * r])) dry = false;
    if (!dry) { close(); continue; }
    inner.push([center[0] + ux * rIn, center[1] + uy * rIn]);
    outer.push([center[0] + ux * edge, center[1] + uy * edge]);
  }
  close();
  return masses;
}
