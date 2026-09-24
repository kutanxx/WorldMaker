// The streets of a town that has water in it.
//
// A town's streets are the edges its Voronoi wards share, and the wards know nothing of the river:
// laid over a channel, the mesh put streets IN it. The main road from a gate took whatever edges
// were shortest, and where those ran along the channel the bridge drawn over them ran along it too —
// lengthwise in the river, 60 to 115 units long — while streets carried on across the water at any
// angle and a crossing came wherever the mesh happened to cut the bank. Measured over twelve worlds:
// 91 pairs of bridges under 25 units apart, bridges up to 115 long on a river 22 wide.
//
// So the water is taken out of the network before any road is chosen: a street in the water is no
// street, and a street that meets it stops at the bank. The banks are then joined the way a town
// builds its bridges — as few as keep the town one place, each crossing square and short, and a
// big town a few more, well apart.
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon, pointSegDist, bbox } from "../geometry";
import type { StreetGraph } from "./blockStreets";
import type { Water } from "./water";
import { inWater } from "./water";

const STEP = 2;           // a street is walked at this spacing to find where it is wet
const MIN_ANGLE = 55;     // a crossing turns at least this far from the bank it leaves (degrees)
const MAX_SPAN = 48;      // ...and spans no more water than this
const STUB_MIN = 4;       // a street cut back to the bank is kept if this much of it is left
const JOIN_REACH = 80;    // two bank streets this far apart may be joined across the water
const JOIN_GAP = 40;      // no bridge that joins the banks within this of another bridge
const EXTRA_GAP = 70;     // ...and none built for its own sake within this of another
const BRIDGE_SPAN = 95;   // a town gets one bridge for about this much of its breadth, at least one

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** the wet runs of the segment a→b, as distances along it */
function wetRuns(a: Point, b: Point, water: Water): [number, number][] {
  const L = dist(a, b), n = Math.max(1, Math.ceil(L / STEP));
  const runs: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const t = k / n, p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const wet = inWater(water, p);
    if (wet && start < 0) start = t * L;
    if (!wet && start >= 0) { runs.push([start, t * L]); start = -1; }
  }
  if (start >= 0) runs.push([start, L]);
  return runs;
}

/** the direction of the shore nearest p: the bank's own line, which a river's flow runs along */
function bankDirection(p: Point, water: Water): [number, number] {
  let bd = Infinity, dir: [number, number] = [1, 0];
  for (const body of water.bodies) for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const d = pointSegDist(p, a, b);
    if (d < bd) { bd = d; const L = dist(a, b) || 1; dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; }
  }
  return dir;
}

/** degrees between a line and a direction, folded into 0..90 */
function angleTo(a: Point, b: Point, dir: [number, number]): number {
  const L = dist(a, b) || 1;
  const c = Math.abs(((b[0] - a[0]) * dir[0] + (b[1] - a[1]) * dir[1]) / L);
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
}

/**
 * A crossing of the water from a to b a town would build a bridge for: dry at both ends, over the
 * water once, square to the bank, and no longer over the water than a river is wide.
 */
export function squareCrossing(a: Point, b: Point, water: Water): boolean {
  if (inWater(water, a) || inWater(water, b)) return false;
  const runs = wetRuns(a, b, water);
  if (runs.length !== 1) return false;
  const [s, e] = runs[0];
  if (e - s > MAX_SPAN) return false;
  const L = dist(a, b) || 1, t = (s + e) / 2 / L;
  const mid: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return angleTo(a, b, bankDirection(mid, water)) >= MIN_ANGLE;
}

/**
 * The street graph with the water taken out of it, and the cut-back streets that now end at a bank
 * (`stubs`, drawn as streets but no part of any route). `bridging` joins the banks of a river; a
 * town on the sea or a lake has no far bank to join.
 */
export function streetsOverWater(graph: StreetGraph, water: Water, town: Polygon, bridging: boolean): { graph: StreetGraph; stubs: Polyline[] } {
  if (!water.bodies.length) return { graph, stubs: [] };
  const { nodes } = graph;
  const edges: [number, number][] = [];
  const segments: Polyline[] = [];
  const stubs: Polyline[] = [];
  const keep = (i: number, j: number) => { edges.push([i, j]); segments.push([nodes[i], nodes[j]]); };
  // What is left of a wet street on each bank, if a street's worth is left. It stops at the last
  // DRY sample: stopped between a dry sample and a wet one, a street could end a hair inside the
  // water, and the bridge-finder carries a road that ends in the water on across it — three false
  // bridges on one town of seed 1.
  const cutBack = (a: Point, b: Point) => {
    const runs = wetRuns(a, b, water);
    const L = dist(a, b) || 1, gap = L / Math.max(1, Math.ceil(L / STEP));
    const first = runs[0][0] - gap, last = runs[runs.length - 1][1];
    const at = (s: number): Point => [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L];
    if (first >= STUB_MIN) stubs.push([a, at(first)]);
    if (last < L && L - last >= STUB_MIN) stubs.push([b, at(last)]);
  };
  const inTown = (p: Point) => pointInPolygon(p, town);
  // streets that cross the water square: candidates for a bridge, not bridges yet
  const crossing: [number, number][] = [];
  for (const [i, j] of graph.edges) {
    const a = nodes[i], b = nodes[j];
    if (!wetRuns(a, b, water).length) { keep(i, j); continue; }
    if (bridging && inTown([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) && squareCrossing(a, b, water)) crossing.push([i, j]);
    else cutBack(a, b);
  }
  if (!bridging) return { graph: { nodes, edges, segments }, stubs };

  // the pieces the water has cut the town into
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const [i, j] of edges) parent[find(i)] = find(j);
  const nearWater = (p: Point) => {
    for (const body of water.bodies) for (let k = 0; k < body.length; k++) if (pointSegDist(p, body[k], body[(k + 1) % body.length]) < JOIN_REACH / 2) return true;
    return false;
  };
  const onStreet = new Set<number>();
  for (const [i, j] of [...edges, ...crossing]) { onStreet.add(i); onStreet.add(j); }
  const banks = nodes.map((_, i) => i).filter((i) => onStreet.has(i) && inTown(nodes[i]) && !inWater(water, nodes[i]) && nearWater(nodes[i]));
  // every way across: a street that crosses square, or two bank streets a short square span apart
  const ways: { i: number; j: number; L: number; street: boolean }[] = crossing.map(([i, j]) => ({ i, j, L: dist(nodes[i], nodes[j]), street: true }));
  for (let x = 0; x < banks.length; x++) for (let y = x + 1; y < banks.length; y++) {
    const L = dist(nodes[banks[x]], nodes[banks[y]]);
    if (L <= JOIN_REACH) ways.push({ i: banks[x], j: banks[y], L, street: false });
  }
  ways.sort((p, q) => p.L - q.L || p.i - q.i || p.j - q.j);
  const bridges: Point[] = [];
  const built = new Set<string>();
  const valid = new Map<string, boolean>();
  const ok = (w: { i: number; j: number; street: boolean }) => {
    const k = `${w.i},${w.j}`;
    if (!valid.has(k)) {
      const a = nodes[w.i], b = nodes[w.j];
      valid.set(k, inTown([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) && (w.street || squareCrossing(a, b, water)));
    }
    return valid.get(k)!;
  };
  const build = (w: { i: number; j: number }) => {
    keep(w.i, w.j);
    built.add(`${w.i},${w.j}`);
    bridges.push([(nodes[w.i][0] + nodes[w.j][0]) / 2, (nodes[w.i][1] + nodes[w.j][1]) / 2]);
    parent[find(w.i)] = find(w.j);
  };
  const midOf = (w: { i: number; j: number }): Point => [(nodes[w.i][0] + nodes[w.j][0]) / 2, (nodes[w.i][1] + nodes[w.j][1]) / 2];
  // 1. as few as keep the town one place: the shortest crossing between each two pieces not yet joined
  for (const w of ways) {
    if (find(w.i) === find(w.j) || bridges.some((m) => dist(m, midOf(w)) < JOIN_GAP) || !ok(w)) continue;
    build(w);
  }
  // 2. a big town builds a few more, well apart: streets that already cross square, shortest first
  const tb = bbox(town);
  const allowed = Math.max(1, Math.round(Math.max(tb.maxX - tb.minX, tb.maxY - tb.minY) / BRIDGE_SPAN));
  for (const w of ways) {
    if (bridges.length >= allowed) break;
    if (!w.street || built.has(`${w.i},${w.j}`) || bridges.some((m) => dist(m, midOf(w)) < EXTRA_GAP)) continue;
    build(w);
  }
  // the square streets that got no bridge stop at the water, like any other
  for (const [i, j] of crossing) if (!built.has(`${i},${j}`)) cutBack(nodes[i], nodes[j]);
  return { graph: { nodes, edges, segments }, stubs };
}
