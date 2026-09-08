// Turning a heap of street segments into roads you could walk down.
//
// The main streets come out of classifyStreets as one two-point segment per ward edge, in no
// order: the shortest path from each gate to the middle, cut up into the pieces it was assembled
// from. Drawn that way each piece gets its own round cap, and where two pieces meet at a ward
// corner the road simply stops and restarts at an angle. Measured over twelve seeds, 45% of the
// junctions a main road passes through turned by more than 60 degrees and a tenth by more than
// 150 -- and a clean Voronoi vertex has three edges 120 degrees apart, so 60 is the most a road
// can honestly turn there. The rest was bookkeeping showing through: gate stubs laid along a
// street that was already there (14.9% of main segments lie on top of another), and runs broken
// at every corner so nothing ever read as one road.
import type { Point, Polyline } from "../geometry";
import { pointSegDist } from "../geometry";

const KEY = (p: Point) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`;
const SAME = 1;        // a centreline this close to another road is the same road
const COVERED = 0.6;   // ...and this much of it being so makes the shorter one redundant
const JOIN = 100;      // a run carries on through a junction if it bends less than this
const EASE = 3.5;      // how far back from a corner the turn is taken
const STEP = 2.5;      // the doorstep left at a gate whose stub duplicated the street behind it

/** true if `seg`'s interior mostly lies on one of `others` (a duplicate stretch of road) */
function coveredBy(seg: Polyline, others: Polyline[]): boolean {
  const [a, b] = [seg[0], seg[seg.length - 1]];
  const N = 9;
  let on = 0;
  for (let k = 1; k <= N; k++) {
    const t = k / (N + 1);
    const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (const o of others) {
      let hit = false;
      for (let i = 0; i < o.length - 1 && !hit; i++) hit = pointSegDist(p, o[i], o[i + 1]) < SAME;
      if (hit) { on++; break; }
    }
  }
  return on >= N * COVERED;
}

const heading = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const bend = (h1: number, h2: number) => {
  let d = Math.abs(h2 - h1) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return (d * 180) / Math.PI;
};

/**
 * Take the corner off a run: each interior vertex becomes a short chord across the turn, cut back
 * at most EASE (and never more than a third of either arm, so a short arm is not swallowed). The
 * two ends stay exactly where they were, because they are where the road meets a gate or a square.
 */
function ease(run: Polyline): Polyline {
  if (run.length < 3) return run;
  const out: Polyline = [run[0]];
  for (let i = 1; i < run.length - 1; i++) {
    const p = run[i], a = run[i - 1], b = run[i + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ca = Math.min(EASE, la / 3), cb = Math.min(EASE, lb / 3);
    if (la < 1e-6 || lb < 1e-6) { out.push(p); continue; }
    out.push([p[0] + ((a[0] - p[0]) / la) * ca, p[1] + ((a[1] - p[1]) / la) * ca]);
    out.push([p[0] + ((b[0] - p[0]) / lb) * cb, p[1] + ((b[1] - p[1]) / lb) * cb]);
  }
  out.push(run[run.length - 1]);
  return out;
}

/**
 * Stitch two-point street segments into continuous roads: drop the stretches drawn twice, walk
 * each run from one of its ends, carry straight on through junctions (taking the least-bending
 * continuation, and stopping rather than doubling back), and ease the corners.
 *
 * Polylines that already have more than two points — a bridge carried bank to bank, say — are
 * roads already and pass through untouched.
 */
export function chainRoads(roads: Polyline[], anchors: Point[] = []): Polyline[] {
  const ready: Polyline[] = roads.filter((r) => r.length !== 2);
  const segs = roads.filter((r) => r.length === 2);
  // longest first, so a short stub laid along a street is the one dropped, not the street
  segs.sort((x, y) =>
    Math.hypot(y[1][0] - y[0][0], y[1][1] - y[0][1]) - Math.hypot(x[1][0] - x[0][0], x[1][1] - x[0][1]));
  const anchored = (p: Point) => anchors.some((g) => Math.hypot(g[0] - p[0], g[1] - p[1]) < 1);
  const kept: Polyline[] = [];
  for (const s of segs) {
    if (!coveredBy(s, [...kept, ...ready])) { kept.push(s); continue; }
    // A gate's stub is the town's door onto the network and cannot simply be deleted; when it is
    // laid along a street that already runs there, the gate is on that street anyway, so all it
    // needs is a doorstep. Trimmed to STEP, it keeps the road's end at the gate without drawing a
    // second copy of the street behind it.
    for (const [i, j] of [[0, 1], [1, 0]]) {
      if (!anchored(s[i])) continue;
      const dx = s[j][0] - s[i][0], dy = s[j][1] - s[i][1], m = Math.hypot(dx, dy) || 1;
      const t = Math.min(STEP, m) / m;
      kept.push([s[i], [s[i][0] + dx * t, s[i][1] + dy * t]]);
      break;
    }
  }

  const at = new Map<string, Point>();
  const adj = new Map<string, number[]>();
  kept.forEach((s, i) => {
    const ka = KEY(s[0]), kb = KEY(s[1]);
    if (ka === kb) return;
    at.set(ka, s[0]); at.set(kb, s[1]);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push(i);
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push(i);
  });
  const used = new Array(kept.length).fill(false);
  const other = (i: number, k: string) => (KEY(kept[i][0]) === k ? KEY(kept[i][1]) : KEY(kept[i][0]));

  const walk = (start: string, first: number): Polyline => {
    const run: Polyline = [at.get(start)!];
    let node = start, edge = first;
    for (;;) {
      used[edge] = true;
      const next = other(edge, node);
      run.push(at.get(next)!);
      const inbound = heading(at.get(node)!, at.get(next)!);
      let best = -1, bestBend = JOIN;
      for (const e of adj.get(next) ?? []) {
        if (used[e]) continue;
        const b = bend(inbound, heading(at.get(next)!, at.get(other(e, next))!));
        if (b < bestBend) { bestBend = b; best = e; }
      }
      if (best < 0) return run;
      node = next; edge = best;
    }
  };

  const out: Polyline[] = [...ready];
  // start where a road ends or forks; only then pick up whatever ring is left over
  for (const pass of [0, 1]) {
    for (const [k, es] of adj) {
      if (pass === 0 && es.length === 2) continue;
      for (const e of es) if (!used[e]) out.push(ease(walk(k, e)));
    }
  }
  return out;
}
