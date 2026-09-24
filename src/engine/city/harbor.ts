import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon, pointSegDist, segmentsIntersect } from "../geometry";
import type { Water } from "./water";
import { inWater } from "./water";

export interface Boat { at: Point; angle: number }
export interface Harbor {
  breakwater: Polyline; // shore → out into the sea → elbow sheltering the basin
  lighthouse: Point;    // breakwater tip
  piers: Polyline[];    // short jetties from the shore into the sheltered water
  boats: Boat[];        // moored boats
  quay: Polyline;       // the waterfront line (contiguous seaward boundary run)
  wharves: Polygon[];   // warehouse blocks lining the quay, protruding to the waterfront
}

// an edge of the town is on the waterfront when the sea is this close outside it
const QUAY_REACH = 8;
// piers stand this far apart along the quay, and this clear of each other and of the mole, where the
// water is within PIER_BANK of the quay; a warehouse keeps this clear of a pier or the mole, and a boat this
const PIER_GAP = 14, PIER_CLEAR = 3.5, PIER_BANK = 6, RUN_CLEAR = 1.2, BOAT_CLEAR = 1.8;

// how near two runs of line come (0 where they cross)
function runGap(r1: Polyline, r2: Polyline): number {
  const o = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  let g = Infinity;
  for (let i = 0; i + 1 < r1.length; i++) for (let j = 0; j + 1 < r2.length; j++) {
    const a = r1[i], b = r1[i + 1], c = r2[j], d = r2[j + 1];
    if ((o(c, d, a) > 0) !== (o(c, d, b) > 0) && (o(a, b, c) > 0) !== (o(a, b, d) > 0)) return 0;
    g = Math.min(g, pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
  }
  return g;
}


// longest cyclic run of `true` (the contiguous shore run), as boundary indices
function longestRun(flags: boolean[]): number[] {
  const n = flags.length;
  if (flags.every((f) => f)) return flags.map((_, i) => i);
  let start = 0;
  while (flags[start]) start = (start + 1) % n; // begin just after a gap so a run isn't split at the seam
  let best: number[] = [], cur: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (flags[i]) cur.push(i);
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

export function makeHarbor(
  rng: Rng, water: Water, boundary: Polygon, center: Point,
): Harbor | null {
  if (water.kind !== "sea") return null;

  // seaward EDGES: the stretch of the town's edge that stands on the water. The town now comes down
  // to its shore (see SHORE_IN), so the quay is the run whose edges have the sea a few units out —
  // it used to be any edge with sea within 36, which took in the town's flanks, and the harbour
  // hung off the middle of all that. A town the sea only nears keeps the old, longer reach.
  const n = boundary.length;
  const facing = (reachOut: number) => boundary.map((a, i) => {
    const b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dx = m[0] - center[0], dy = m[1] - center[1], dl = Math.hypot(dx, dy) || 1;
    for (let d = 2; d <= reachOut; d += 2) if (inWater(water, [m[0] + (dx / dl) * d, m[1] + (dy / dl) * d])) return true;
    return false;
  });
  let runEdges = longestRun(facing(QUAY_REACH));
  if (runEdges.length < 1) runEdges = longestRun(facing(36));
  if (runEdges.length < 1) return null;
  // quay vertices = each run edge's start vertex, plus the last edge's end vertex
  const quay: Polyline = [...runEdges.map((e) => boundary[e]), boundary[(runEdges[runEdges.length - 1] + 1) % n]];
  if (quay.length < 2) return null;

  // the harbour stands at the middle of the quay — ON it, halfway along; the average of its corners
  // lies inside the town wherever the quay curves, and the piers were run out from there
  const along = (f: number): Point => {
    const lens = quay.slice(1).map((p, i) => Math.hypot(p[0] - quay[i][0], p[1] - quay[i][1]));
    let rest = f * lens.reduce((t, l) => t + l, 0);
    for (let i = 0; i < lens.length; i++) {
      if (rest <= lens[i] || i === lens.length - 1) {
        const t = lens[i] ? Math.min(1, rest / lens[i]) : 0;
        return [quay[i][0] + (quay[i + 1][0] - quay[i][0]) * t, quay[i][1] + (quay[i + 1][1] - quay[i][1]) * t];
      }
      rest -= lens[i];
    }
    return quay[0];
  };
  const anchor: Point = along(0.5);
  let dx = anchor[0] - center[0], dy = anchor[1] - center[1];
  const dl = Math.hypot(dx, dy) || 1;
  const dir: Point = [dx / dl, dy / dl];
  const tan: Point = [-dir[1], dir[0]];
  const inSea = (p: Point) => inWater(water, p);

  // march from a quay point outward until it meets the sea (bridges the small land gap where
  // the town edge stops short of the shore), returning the first water point.
  const reachWater = (from: Point): Point | null => {
    for (let d = 0; d <= 40; d += 3) {
      const q: Point = [from[0] + dir[0] * d, from[1] + dir[1] * d];
      if (inSea(q)) return q;
    }
    return null;
  };

  // Breakwater: out along dir, then an elbow along the shore tangent to enclose a basin.
  // ★ From the SHORE, not from the town's edge: a port town stands up to a strand back from its
  // water, and a mole started at the wall ran its first stretch across the beach — 128 of 139
  // harbours over twelve worlds had a breakwater lying over dry land, and 12 had their lighthouse on
  // it. It starts where the water does now, and its arm and head stand in the water: the other side
  // if this one runs aground, a shorter arm if neither will.
  const reach = 26 + rng() * 12;
  const span = 16 + rng() * 10;
  const side = rng() < 0.5 ? 1 : -1;
  const shore = reachWater(anchor);
  const from: Point = shore ?? [anchor[0] + dir[0] * 3, anchor[1] + dir[1] * 3];
  const wet = (a: Point, b: Point) => {
    for (let k = 1; k <= 8; k++) if (!inSea([a[0] + ((b[0] - a[0]) * k) / 8, a[1] + ((b[1] - a[1]) * k) / 8])) return false;
    return true;
  };
  let breakwater: Polyline | null = null;
  for (let f = 1; f >= 0.45 && !breakwater; f -= 0.15) {
    const out = (shore ? reach - 3 : reach) * f;
    const mid: Point = [from[0] + dir[0] * out, from[1] + dir[1] * out];
    if (!wet(from, mid)) continue;
    for (const sd of [side, -side]) {
      const tip: Point = [mid[0] + tan[0] * sd * span * f, mid[1] + tan[1] * sd * span * f];
      if (wet(mid, tip)) { breakwater = [from, mid, tip]; break; }
    }
  }
  // no arm stands in the water at all (a shore too twisted to shelter): a short mole straight out
  if (!breakwater) breakwater = [from, [from[0] + dir[0] * 12, from[1] + dir[1] * 12]];
  const mid = breakwater[1];
  const tip = breakwater[breakwater.length - 1];

  // Piers stand in the basin the mole shelters: from the quay itself, 14 apart along it on the side
  // the mole's arm turns to, each run straight out from the town. They stood 14 either side of the
  // harbour's middle along one tangent — off a curved quay, a median 60% of their length over the
  // beach — and the middle one lay along the mole's own first arm, which starts there too.
  const piers: Polyline[] = [];
  const boats: Boat[] = [];
  const angle = Math.atan2(dir[1], dir[0]);
  const bside = (tip[0] - mid[0]) * tan[0] + (tip[1] - mid[1]) * tan[1] >= 0 ? 1 : -1;
  const quayLen = quay.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - quay[i][0], p[1] - quay[i][1]), 0);
  for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) {
    if (piers.length >= 3) break;
    const f = 0.5 + (k * PIER_GAP) / (quayLen || 1);
    if (f < 0.06 || f > 0.94) continue;
    const base = along(f);
    // on the sheltered side of the mole, and not beside it
    if (((base[0] - anchor[0]) * tan[0] + (base[1] - anchor[1]) * tan[1]) * bside < PIER_GAP * 0.5) continue;
    const ox = base[0] - center[0], oy = base[1] - center[1], ol = Math.hypot(ox, oy) || 1;
    const out: Point = [ox / ol, oy / ol];
    // where the quay stands on the water: a pier is run out across its bank, not along a beach
    let shore: Point | null = null;
    for (let d = 0; d <= PIER_BANK && !shore; d += 1) { const q: Point = [base[0] + out[0] * d, base[1] + out[1] * d]; if (inSea(q)) shore = q; }
    if (!shore) continue;
    const len = 8 + rng() * 6;
    const end: Point = [shore[0] + out[0] * len, shore[1] + out[1] * len];
    // clear of the mole and of the piers already built (a quay that turns runs them together)
    if (runGap([base, end], breakwater) < PIER_CLEAR || piers.some((pr) => runGap([base, end], pr) < PIER_CLEAR)) continue;
    piers.push([base, end]); // quay → over the bank → into the water
    boats.push({ at: [end[0] - out[1] * 2.5, end[1] + out[0] * 2.5], angle: Math.atan2(out[1], out[0]) });
  }
  // a couple of boats riding in the sheltered basin — on whichever side the arm was built
  for (let i = 0; i < 2; i++) {
    const p: Point = [mid[0] - dir[0] * (4 + i * 6) + tan[0] * bside * (4 + rng() * 4), mid[1] - dir[1] * (4 + i * 6) + tan[1] * bside * (4 + rng() * 4)];
    if (inSea(p)) boats.push({ at: p, angle: angle + (rng() - 0.5) * 0.6 });
  }

  // wharves: warehouse blocks lining the quay, nudged toward the water so the docks read as
  // protruding from the town's seaward edge (Watabou: the seafront blocks ARE the docks). A pier or
  // the mole runs out from the quay where a warehouse would stand, and the warehouse gives way to it.
  const wharves: Polygon[] = [];
  const runs: Polyline[] = [...piers, breakwater];
  const onRun = (poly: Polygon) => runs.some((r) => {
    for (let i = 0; i + 1 < r.length; i++) for (const p of poly) if (pointSegDist(p, r[i], r[i + 1]) < RUN_CLEAR) return true;
    for (const q of r) if (pointInPolygon(q, poly) || poly.some((p, j) => pointSegDist(q, p, poly[(j + 1) % poly.length]) < RUN_CLEAR)) return true;
    // (a pier straight through the middle of a block has neither: it crosses two of its walls)
    for (let i = 0; i + 1 < r.length; i++) for (let j = 0; j < poly.length; j++) if (segmentsIntersect(r[i], r[i + 1], poly[j], poly[(j + 1) % poly.length])) return true;
    return false;
  });
  const step = Math.max(1, Math.floor((quay.length - 1) / 6)); // up to ~6 warehouses
  for (let t = 0; t + 1 < quay.length; t += step) {
    const a2 = quay[t], b2 = quay[t + 1];
    const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
    const alx = b2[0] - a2[0], aly = b2[1] - a2[1], al = Math.hypot(alx, aly) || 1;
    const ux = alx / al, uy = aly / al;                 // along-shore tangent
    const cx = mx + dir[0] * 3, cy = my + dir[1] * 3;   // nudge seaward so it protrudes
    const hwid = 4.5, hdep = 3;
    const block: Polygon = [
      [cx - ux * hwid - dir[0] * hdep, cy - uy * hwid - dir[1] * hdep],
      [cx + ux * hwid - dir[0] * hdep, cy + uy * hwid - dir[1] * hdep],
      [cx + ux * hwid + dir[0] * hdep, cy + uy * hwid + dir[1] * hdep],
      [cx - ux * hwid + dir[0] * hdep, cy - uy * hwid + dir[1] * hdep],
    ];
    if (!onRun(block)) wharves.push(block);
  }
  // a boat rides on the water, not on a pier, the mole or a warehouse
  const moored = boats.filter((b) =>
    !runs.some((r) => r.some((q, i) => i + 1 < r.length && pointSegDist(b.at, q, r[i + 1]) < BOAT_CLEAR))
    && !wharves.some((wf) => pointInPolygon(b.at, wf)));

  return { breakwater, lighthouse: tip, piers, boats: moored, quay, wharves };
}
