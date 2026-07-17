import type { World } from "../types/world";
import type { Province } from "./provinces";

type GridLike = Pick<World["grid"], "count" | "neighbors">;

const SOL_INIT = 0.5;
const SOL_RISE = 0.03, SOL_DECAY = 0.02;
const CONQUEST_SOL = 0.7;
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002, SIZE_CAP = 24, CONTEST_THRESH = 1.03;

export const PROVINCE_SIM_TICKS = 50;

export interface ProvinceSimState {
  provinces: Province[];
  n: number;
  provOwner: Int32Array;   // province → polity id (-1 unowned)
  provSol: Float32Array;   // province → solidarity [0,1]
  adj: number[][];         // province land-adjacency, index-aligned to provinces
  capitalProv: Int32Array; // polity id → its capital province id
  alive: boolean[];        // polity id → still holds its capital province
  tick: number;
}

export interface PAgg {
  cells: number;
  avg: number;
}

// two provinces are adjacent iff some land cell of one has a land-neighbour cell in the other.
export function buildProvinceAdj(
  provinceOf: ArrayLike<number>, provinces: Province[], grid: GridLike,
): number[][] {
  const adj: Set<number>[] = provinces.map(() => new Set<number>());
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c];
    if (p < 0) continue;
    for (const nb of grid.neighbors[c]) {
      const q = provinceOf[nb];
      if (q >= 0 && q !== p) { adj[p].add(q); adj[q].add(p); }
    }
  }
  return adj.map((s) => [...s].sort((a, b) => a - b));
}

// each province's majority owner over its cells (ties → lower id; unowned → -1)
function majorityOwner(provinceOf: ArrayLike<number>, nProv: number, owner: ArrayLike<number>): Int32Array {
  const tally: Map<number, number>[] = Array.from({ length: nProv }, () => new Map<number, number>());
  for (let c = 0; c < provinceOf.length; c++) {
    const p = provinceOf[c];
    if (p < 0 || p >= nProv) continue;
    const o = owner[c];
    if (o < 0) continue;
    tally[p].set(o, (tally[p].get(o) ?? 0) + 1);
  }
  const out = new Int32Array(nProv).fill(-1);
  for (let p = 0; p < nProv; p++) {
    let best = -1, bestN = 0;
    for (const [o, k] of tally[p]) if (k > bestN || (k === bestN && o < best)) { bestN = k; best = o; }
    out[p] = best;
  }
  return out;
}

export function initProvinceSim(world: World): ProvinceSimState {
  const { provinces, provinceOf, polities, grid } = world;
  const n = provinces.length;
  const provOwner = majorityOwner(provinceOf, n, world.polityOf);
  const capitalProv = new Int32Array(polities.length).fill(-1);
  // force each nation's capital province to itself so no nation starts capital-less (majority snap could
  // otherwise hand a capital's province to a neighbour). Capital-province collisions (two capitals in one
  // province) are last-write-wins — vanishingly rare on the ~100-province map; acceptable for SP1.
  for (const pol of polities) {
    const cap = provinceOf[pol.capital];
    capitalProv[pol.id] = cap;
    if (cap >= 0) provOwner[cap] = pol.id;
  }
  const provSol = new Float32Array(n);
  for (let p = 0; p < n; p++) provSol[p] = provOwner[p] >= 0 ? SOL_INIT : 0;
  const adj = buildProvinceAdj(provinceOf, provinces, grid);
  const alive = polities.map((pol) => capitalProv[pol.id] >= 0 && provOwner[capitalProv[pol.id]] === pol.id);
  return { provinces, n, provOwner, provSol, adj, capitalProv, alive, tick: 0 };
}

export function pAggregate(s: ProvinceSimState): PAgg[] {
  const k = s.capitalProv.length; // number of polities
  const cells = new Float64Array(k), wsol = new Float64Array(k);
  for (let p = 0; p < s.n; p++) {
    const o = s.provOwner[p];
    if (o < 0 || o >= k) continue;
    const c = s.provinces[p].cells;
    cells[o] += c;
    wsol[o] += s.provSol[p] * c;
  }
  const out: PAgg[] = [];
  for (let id = 0; id < k; id++) out.push({ cells: cells[id], avg: cells[id] > 0 ? wsol[id] / cells[id] : 0 });
  return out;
}

function centroidDist(a: Province, b: Province): number {
  return Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1]);
}

// mirrors the cell sim's contestStrength(polity, distCell, solCell) at province granularity.
function strength(s: ProvinceSimState, agg: PAgg[], polity: number, distProv: number, solProv: number): number {
  const cap = s.capitalProv[polity];
  const d = cap >= 0 ? centroidDist(s.provinces[distProv], s.provinces[cap]) : 0;
  return W_ASA * agg[polity].avg
    + W_LOCAL * s.provSol[solProv]
    + W_POWER * Math.sqrt(Math.min(agg[polity].cells, SIZE_CAP))
    - W_DIST * d;
}

export function stepProvinceSim(s: ProvinceSimState): void {
  const { n, provOwner, adj } = s;
  // 1. solidarity: frontier provinces (adjacent to a different owner) rise; interior provinces decay
  const nextSol = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const o = provOwner[p];
    if (o < 0) { nextSol[p] = 0; continue; }
    let frontier = false;
    for (const q of adj[p]) if (provOwner[q] !== o) { frontier = true; break; }
    const sv = s.provSol[p] + (frontier ? SOL_RISE : -SOL_DECAY);
    nextSol[p] = sv < 0 ? 0 : sv > 1 ? 1 : sv;
  }
  s.provSol = nextSol;
  // 2. contest & whole-province conquest (double-buffered). Each province meets its strongest LIVE
  // adjacent enemy; if the attacker beats the defender by the threshold, the whole province flips.
  const agg = pAggregate(s);
  const nextOwner = provOwner.slice();
  const conquered: number[] = [];
  for (let p = 0; p < n; p++) {
    const o = provOwner[p];
    let best = -1, bestAvg = -Infinity, bestQ = -1;
    for (const q of adj[p]) {
      const po = provOwner[q];
      if (po < 0 || po === o || !s.alive[po]) continue; // dead nations (no capital) don't initiate
      if (agg[po].avg > bestAvg) { bestAvg = agg[po].avg; best = po; bestQ = q; }
    }
    if (best < 0) continue;
    const atk = strength(s, agg, best, p, bestQ);
    const def = o < 0 ? 0 : strength(s, agg, o, p, p);
    if (atk > def * CONTEST_THRESH) { nextOwner[p] = best; conquered.push(p); }
  }
  s.provOwner = nextOwner;
  // fresh conquests reset to CONQUEST_SOL — applied AFTER the loop so contest reads the stable stepped
  // solidarity (no mid-loop mutation of provSol that a later province could read)
  for (const p of conquered) s.provSol[p] = CONQUEST_SOL;
  // a polity that lost its capital province is dead (stops initiating attacks next tick)
  for (let id = 0; id < s.alive.length; id++) {
    s.alive[id] = s.capitalProv[id] >= 0 && s.provOwner[s.capitalProv[id]] === id;
  }
  s.tick++;
}
