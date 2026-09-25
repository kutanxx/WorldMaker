// The roads between the towns.
//
// The world drew none, and a town plate's roads left its gates wherever its own streets happened to
// meet the wall: over twelve worlds, the gap between a plate's nearest road out and each of its three
// nearest towns was a median 37 degrees — 39 for bearings drawn at random. The roads of a real town
// left it toward the places they went to, and were named for them: the Porta Romana of Florence, of
// Milan and of Viterbo, the Via Ostiense to Ostia.
//
// A road runs where travel is cheap: over land, round the mountains rather than over them, and up the
// gentle side of a rise. Each town's cheapest way over land to every other is measured on the mesh
// (Dijkstra), and two towns are joined when no third is nearer to both of them than they are to each
// other — the relative neighbourhood graph, the usual model of a road network. It reaches every town
// on a landmass, and no road runs past a town to the one beyond it. Each road leaves its town the way
// its route runs two cells out, the same reach the plate reads the sea and the high ground from.
//
// Terrain and heights only, and no rng, so the world it describes is unchanged.
//
// The way each road runs is kept too, once for the pair: the map draws it, and a reader's town list
// of neighbours measures along it.
import { MOUNTAIN, OCEAN } from "./terrain";
import type { Road } from "../types/world";

export interface RoadOut {
  /** the town it leads to (its id) */
  to: number;
  /** which way it leaves this town, in world radians (atan2: +x east, +y south) */
  bearing: number;
}

interface Mesh { count: number; points: ArrayLike<number>; neighbors: number[][] }

// a mountain cell costs this many times a lowland one to cross
const ROAD_MOUNTAIN = 3;
// ...and a step between two cells costs this much more per unit of height between them
const ROAD_CLIMB = 8;
// a road's bearing is the way its route runs this many cells out of the town
const ROAD_REACH = 2;

/**
 * The roads out of each town, in the order of `towns` (each list ordered by the town it leads to),
 * and every road once, along its way (ordered by its towns; a town's id is its place in `towns`).
 * `towns[i].cell` is the cell a town stands on; its position is that cell's point.
 */
export function roadsBetweenTowns(mesh: Mesh, heights: ArrayLike<number>, terrain: ArrayLike<number>, towns: { cell: number }[]): { out: RoadOut[][]; roads: Road[] } {
  const px = (c: number) => mesh.points[c * 2], py = (c: number) => mesh.points[c * 2 + 1];
  const weight = (c: number) => (terrain[c] === MOUNTAIN ? ROAD_MOUNTAIN : 1);
  const step = (a: number, b: number) =>
    Math.hypot(px(b) - px(a), py(b) - py(a)) * ((weight(a) + weight(b)) / 2) * (1 + ROAD_CLIMB * Math.abs(heights[b] - heights[a]));

  // Dijkstra over the land from one cell: the cost to every cell, and the way back from each
  const overLand = (from: number) => {
    const dist = new Float64Array(mesh.count).fill(Infinity);
    const prev = new Int32Array(mesh.count).fill(-1);
    dist[from] = 0;
    // binary min-heap of cells keyed by (cost, index) — the index tie-break keeps the order fixed
    const heap: number[] = [from];
    const less = (a: number, b: number) => dist[a] < dist[b] || (dist[a] === dist[b] && a < b);
    const up = (i: number) => {
      while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
    };
    const down = (i: number) => {
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < heap.length && less(heap[l], heap[s])) s = l;
        if (r < heap.length && less(heap[r], heap[s])) s = r;
        if (s === i) return;
        [heap[i], heap[s]] = [heap[s], heap[i]]; i = s;
      }
    };
    const done = new Uint8Array(mesh.count);
    while (heap.length) {
      const c = heap[0];
      const last = heap.pop()!;
      if (heap.length) { heap[0] = last; down(0); }
      if (done[c]) continue;
      done[c] = 1;
      for (const n of mesh.neighbors[c]) {
        if (terrain[n] === OCEAN || done[n]) continue;
        const d = dist[c] + step(c, n);
        if (d < dist[n]) { dist[n] = d; prev[n] = c; heap.push(n); up(heap.length - 1); }
      }
    }
    return { dist, prev };
  };

  const trees = towns.map((t) => overLand(t.cell));
  // one number for the pair, whichever end it is read from: a path summed from the other end can
  // differ in its last digit, and the graph below compares these costs against each other
  const cost = (a: number, b: number) => (a < b ? trees[a].dist[towns[b].cell] : trees[b].dist[towns[a].cell]);

  const out: RoadOut[][] = towns.map(() => []);
  const roads: Road[] = [];
  for (let a = 0; a < towns.length; a++) {
    for (let b = a + 1; b < towns.length; b++) {
      const ab = cost(a, b);
      if (!Number.isFinite(ab) || towns[a].cell === towns[b].cell) continue;
      let beaten = false;
      for (let c = 0; c < towns.length && !beaten; c++) {
        if (c === a || c === b) continue;
        beaten = Math.max(cost(a, c), cost(c, b)) < ab;
      }
      if (beaten) continue;
      out[a].push({ to: b, bearing: leaving(a, b) });
      out[b].push({ to: a, bearing: leaving(b, a) });
      const cells = route(a, b);
      let length = 0;
      for (let k = 0; k + 1 < cells.length; k++) length += Math.hypot(px(cells[k + 1]) - px(cells[k]), py(cells[k + 1]) - py(cells[k]));
      roads.push({ a, b, cells, length, effort: ab });
    }
  }
  return { out: out.map((list) => list.sort((x, y) => x.to - y.to)), roads };

  // the cells of the cheapest way from `a` to `b` over the land, a's own cell first
  function route(a: number, b: number): number[] {
    const { prev } = trees[a];
    const path: number[] = [];
    for (let c = towns[b].cell; c !== -1; c = prev[c]) path.push(c);
    return path.reverse();
  }

  // which way the road from `a` to `b` leaves `a`: toward the cell its route reaches ROAD_REACH cells out
  function leaving(a: number, b: number): number {
    const path = route(a, b);
    const to = path[Math.min(ROAD_REACH, path.length - 1)];
    const from = towns[a].cell;
    return Math.atan2(py(to) - py(from), px(to) - px(from));
  }
}

/**
 * Which roads are in use while only some towns stand — the ones on the cheapest way between two
 * standing towns, which may run through the sites of towns not founded yet (and a town is founded
 * on a road already there). A road leading only to towns not founded yet waits for them. As towns
 * are founded the ways between them only grow, so a road once in use stays in use, and when every
 * town stands every road is in use. `roads` are indexed as given; ties go to the lower-numbered town.
 */
export function roadsInUse(roads: readonly { a: number; b: number; effort: number }[], stands: (town: number) => boolean): boolean[] {
  const inUse = roads.map(() => false);
  const at = new Map<number, number[]>();       // town -> the roads it is an end of
  roads.forEach((r, k) => { for (const t of [r.a, r.b]) { const list = at.get(t); if (list) list.push(k); else at.set(t, [k]); } });
  const standing = [...at.keys()].filter(stands).sort((x, y) => x - y);
  for (const s of standing) {
    // Dijkstra over the towns from s: the cheapest way to each, and the road it was reached by
    const dist = new Map<number, number>([[s, 0]]);
    const via = new Map<number, number>();
    const open = new Set([s]);
    while (open.size) {
      let u = -1;
      for (const x of open) if (u < 0 || dist.get(x)! < dist.get(u)! || (dist.get(x) === dist.get(u) && x < u)) u = x;
      open.delete(u);
      for (const k of at.get(u)!) {
        const r = roads[k], o = r.a === u ? r.b : r.a, d = dist.get(u)! + r.effort;
        if (d < (dist.get(o) ?? Infinity)) { dist.set(o, d); via.set(o, k); open.add(o); }
      }
    }
    for (const t of standing) {
      if (t <= s) continue;
      for (let x = t; via.has(x) && x !== s; ) {
        const k = via.get(x)!;
        inUse[k] = true;
        x = roads[k].a === x ? roads[k].b : roads[k].a;
      }
    }
  }
  return inUse;
}
