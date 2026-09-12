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

function ribbon(center: Polyline, halfWidth: number): Polygon {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(center.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m, ny = dx / m;
    left.push([center[i][0] + nx * halfWidth, center[i][1] + ny * halfWidth]);
    right.push([center[i][0] - nx * halfWidth, center[i][1] - ny * halfWidth]);
  }
  return left.concat(right.reverse());
}

// how much beach a port town is allowed between its wall and the water. Measured: the towns whose
// docks DO get drawn stand a median 3.7 and at most 31 units from the water, and makeHarbor probes
// 36 outward, so a strand inside that band keeps every port town on its own waterfront.
const STRAND = 16;

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
 */
export function buildWater(rng: Rng, kind: WaterKind, bounds: { w: number; h: number }, seaBearing?: number, townReach?: number): Water {
  const { w, h } = bounds;
  if (kind === "none") return { kind, bodies: [], bridges: [] };

  if (kind === "sea") {
    const side = randInt(rng, 0, 3); // 0 right, 1 bottom, 2 left, 3 top
    const noise = createNoise2D(rng);
    const depth = (0.24 + rng() * 0.1) * (side % 2 === 0 ? w : h);
    // a port town stands ON its water: the shore comes no further out than a strand beyond the
    // wall, however deep the draw was. The draw itself is untouched, so the rng stream does not move.
    const cap = townReach === undefined ? Infinity : townReach + STRAND;
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
      const off = Math.min((side % 2 === 0 ? w : h) / 2 - depth, cap); // the same cap on the fallback side-of-the-plate shore
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
      const inland = Math.min(R / 2 - depth, cap);  // where the waterline sits, pulled in to the town
      const stretch = (2 * reach) / R;          // keep the waves the size they were on a plate edge
      const shore: Point[] = [];
      for (let i = 0; i <= K * 2; i++) {
        const u01 = i / (K * 2);
        const along = -reach + u01 * 2 * reach;
        let n = 0;
        for (let o = 0; o < OCTAVES.length; o++) {
          n += noise(u01 * OCTAVES[o][0] * stretch, seaBearing * 1.7 + o * 37.3) * amp * OCTAVES[o][1];
        }
        const off = inland + n;
        shore.push([cx + ux * off + vx * along, cy + uy * off + vy * along]);
      }
      const far = reach * 2;
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

  if (kind === "lake") {
    const cx = w * (0.35 + rng() * 0.3), cy = h * (0.35 + rng() * 0.3);
    const r = 28 + rng() * 22;
    const poly: Polygon = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.4);
      poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return { kind, bodies: [poly], bridges: [] };
  }

  // river / meander: a winding centre line crossing the map, turned into a ribbon
  const vertical = kind === "river" ? rng() < 0.5 : true;
  const center: Polyline = [];
  const steps = 12;
  const amp = kind === "meander" ? 70 : 40;
  const base = vertical ? w * (0.4 + rng() * 0.2) : h * (0.4 + rng() * 0.2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = Math.sin(t * Math.PI * (kind === "meander" ? 3 : 2)) * amp * (0.75 + rng() * 0.5);
    if (vertical) center.push([base + off, t * h]);
    else center.push([t * w, base + off]);
  }
  const poly = ribbon(center, kind === "meander" ? 16 : 11);
  return { kind, bodies: [poly], bridges: [] };
}

export function inWater(water: Water, p: Point): boolean {
  for (const body of water.bodies) if (pointInPolygon(p, body)) return true;
  return false;
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
