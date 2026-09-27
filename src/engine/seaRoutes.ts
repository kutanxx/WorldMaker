// The sea routes between the ports.
//
// The roads stop at the shore (worldRoads.ts): an island's towns had no way to anywhere, and the only
// way across a gulf was the road round it. A ship sails where the sea is the better way — where no road
// joins two ports, or the road is more than half as long again as the voyage. Asked, the reader chose
// that from a preview of two rules drawn on worlds 1 and 11: the other, every port joined to its sea
// neighbours by the roads' own rule, gave 128 routes over twelve worlds that wound dashed loops round
// whole islands and ran beside the coast roads; this gives 40.
//
// Each port's way over the water to every other is measured on the mesh (Dijkstra over the sea's
// cells; a port's own cell is where a voyage starts or ends, never a way through). That way runs from
// cell centre to cell centre half a cell off the shore, and drawn as it is it read as a dotted second
// coastline — so the course is the way pulled straight: from each point, the farthest later point the
// straight leg to which stays over the water, so a ship sails straight legs between headlands. Two
// ports are sea neighbours when no third port is nearer to both of them by sea (the relative
// neighbourhood graph, as the roads), and a pair of them keeps its route where the sea is the better way.
//
// Terrain, the mesh and the roads only, and no rng, so the world it describes is unchanged.
import { OCEAN } from "./terrain";
import { waysInUse } from "./worldRoads";
import type { SeaRoute } from "../types/world";

interface Mesh { count: number; points: ArrayLike<number>; neighbors: number[][]; polygons: number[][][] }

// a ship is taken where no road joins two ports, or the road is more than this many times the voyage
const SEA_BETTER = 1.5;
// a leg of a course is tested for water this often along it (map units)
const LEG_STEP = 1;

/**
 * The sea routes, each once for its pair (ordered by its ports; a town's id is its place in `towns`).
 * `roads` are the world's roads, for how far two ports are by land and which ways a traveller takes.
 */
export function seaRoutesBetweenPorts(
  mesh: Mesh, terrain: ArrayLike<number>, towns: { cell: number; coastal: boolean }[],
  roads: readonly { a: number; b: number; length: number; effort: number }[],
): SeaRoute[] {
  const px = (c: number) => mesh.points[c * 2], py = (c: number) => mesh.points[c * 2 + 1];
  // the cell a point lies in, walked to from a cell near it: a cell whose neighbours are all further from
  // the point than it is holds the point (the mesh's neighbours are its Delaunay edges)
  const walk = (c: number, x: number, y: number) => {
    for (;;) {
      let best = c, bd = (px(c) - x) ** 2 + (py(c) - y) ** 2;
      for (const n of mesh.neighbors[c]) { const d = (px(n) - x) ** 2 + (py(n) - y) ** 2; if (d < bd) { bd = d; best = n; } }
      if (best === c) return c;
      c = best;
    }
  };
  // where two neighbouring cells meet: the middle of the edge they share (a step from one cell's centre to
  // it and on to the other's stays inside the two cells, which a straight step between the centres may not)
  const between = (c: number, n: number): [number, number] => {
    const shared = mesh.polygons[c].filter((p) => mesh.polygons[n].some((q) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6));
    return shared.length >= 2
      ? [(shared[0][0] + shared[1][0]) / 2, (shared[0][1] + shared[1][1]) / 2]
      : [(px(c) + px(n)) / 2, (py(c) + py(n)) / 2];
  };
  const ports = towns.map((t, i) => (t.coastal ? i : -1)).filter((i) => i >= 0);
  const portCell = new Set(ports.map((i) => towns[i].cell));

  // Dijkstra over the water from a port's cell: the cost to every cell, and the way back from each
  const overSea = (from: number) => {
    const dist = new Float64Array(mesh.count).fill(Infinity);
    const prev = new Int32Array(mesh.count).fill(-1);
    const done = new Uint8Array(mesh.count);
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
    while (heap.length) {
      const c = heap[0];
      const last = heap.pop()!;
      if (heap.length) { heap[0] = last; down(0); }
      if (done[c]) continue;
      done[c] = 1;
      if (c !== from && terrain[c] !== OCEAN) continue;   // a port ends a voyage; it is no way through
      for (const n of mesh.neighbors[c]) {
        if (done[n] || (terrain[n] !== OCEAN && !portCell.has(n))) continue;
        const d = dist[c] + Math.hypot(px(n) - px(c), py(n) - py(c));
        if (d < dist[n]) { dist[n] = d; prev[n] = c; heap.push(n); up(heap.length - 1); }
      }
    }
    return { dist, prev };
  };
  const trees = new Map(ports.map((p) => [p, overSea(towns[p].cell)]));
  // one number for the pair, whichever end it is read from (see worldRoads.ts)
  const way = (a: number, b: number) => (a < b ? trees.get(a)!.dist[towns[b].cell] : trees.get(b)!.dist[towns[a].cell]);

  // a straight leg stays over the water: every LEG_STEP along it lies in a sea cell, or in the cell of
  // one of the two ports it joins (`from` is a cell near its start, to walk from)
  const overWater = (from: number, x1: number, y1: number, x2: number, y2: number, ends: Set<number>) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / LEG_STEP));
    let c = from;
    for (let k = 0; k <= n; k++) {
      c = walk(c, x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n);
      if (terrain[c] !== OCEAN && !ends.has(c)) return false;
    }
    return true;
  };

  // the course from port a to port b (a < b): the way over the water — from centre to centre through the
  // middle of each edge crossed — pulled straight, each leg running on for as long as it stays over water
  const course = (a: number, b: number): [number, number][] => {
    const cells: number[] = [];
    for (let c = towns[b].cell; c !== -1; c = trees.get(a)!.prev[c]) cells.push(c);
    cells.reverse();
    const pts: [number, number][] = [], near: number[] = [];
    cells.forEach((c, k) => {
      if (k > 0) { pts.push(between(cells[k - 1], c)); near.push(c); }
      pts.push([px(c), py(c)]); near.push(c);
    });
    const ends = new Set([towns[a].cell, towns[b].cell]);
    const out: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; ) {
      let j = i + 1;
      while (j + 1 < pts.length && overWater(near[i], pts[i][0], pts[i][1], pts[j + 1][0], pts[j + 1][1], ends)) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  };

  // how far two towns are by road: Dijkstra over the road network, by road length
  const byRoad = (from: number) => {
    const dist = new Map<number, number>([[from, 0]]);
    const open = new Set([from]);
    while (open.size) {
      let u = -1;
      for (const x of open) if (u < 0 || dist.get(x)! < dist.get(u)! || (dist.get(x) === dist.get(u) && x < u)) u = x;
      open.delete(u);
      for (const r of roads) {
        if (r.a !== u && r.b !== u) continue;
        const o = r.a === u ? r.b : r.a, d = dist.get(u)! + r.length;
        if (d < (dist.get(o) ?? Infinity)) { dist.set(o, d); open.add(o); }
      }
    }
    return dist;
  };
  const land = new Map(ports.map((p) => [p, byRoad(p)]));

  // sea neighbours by the way over the water, kept where the sea is the better way; the voyage is the
  // course drawn, never longer than the way it was pulled from
  const kept: SeaRoute[] = [];
  for (const a of ports) for (const b of ports) {
    if (b <= a || towns[b].cell === towns[a].cell) continue;
    const ab = way(a, b);
    if (!Number.isFinite(ab)) continue;
    if (ports.some((c) => c !== a && c !== b && Math.max(way(a, c), way(c, b)) < ab)) continue;
    if (!((land.get(a)!.get(b) ?? Infinity) > SEA_BETTER * ab)) continue;
    const points = course(a, b);
    let length = 0;
    for (let k = 0; k + 1 < points.length; k++) length += Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1]);
    kept.push({ a, b, points, length });
  }

  // ...and a route no traveller would take — on no cheapest way between two towns even with every town
  // standing, by the rule the map shows a year's ways by (waysInUse) — is left out: it would never be
  // drawn (1 of 41 over twelve worlds)
  const used = waysInUse(roads, kept, () => true).sea;
  return kept.filter((_, k) => used[k]);
}
