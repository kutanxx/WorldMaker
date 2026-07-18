import type { World } from "../types/world";
import type { Province } from "./provinces";

type GridLike = Pick<World["grid"], "count" | "neighbors">;

const SOL_INIT = 0.5;
const SOL_RISE = 0.03, SOL_DECAY = 0.02;
const CONQUEST_SOL = 0.7;
const CONSOLIDATE_BONUS = 0.1; // a "consolidate" player turn adds this to each owned province's solidarity
const ATTACK_EXHAUST = 0.3;    // a conquest drops the attacking front province's solidarity — aggression exposes you
const EMPTY_TARGETS: ReadonlySet<number> = new Set();
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

// the next-tick solidarity buffer: frontier provinces (adjacent to a different owner) rise, interior decay,
// clamp [0,1]. Pure — returns a fresh array without mutating `s` (the attack preview reuses it).
function computeSteppedSol(s: ProvinceSimState): Float32Array {
  const { n, provOwner, adj } = s;
  const nextSol = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const o = provOwner[p];
    if (o < 0) { nextSol[p] = 0; continue; }
    let frontier = false;
    for (const q of adj[p]) if (provOwner[q] !== o) { frontier = true; break; }
    const sv = s.provSol[p] + (frontier ? SOL_RISE : -SOL_DECAY);
    nextSol[p] = sv < 0 ? 0 : sv > 1 ? 1 : sv;
  }
  return nextSol;
}

// double-buffered solidarity update (behaviour unchanged; shared by the AI step and the player step).
function stepSolidarity(s: ProvinceSimState): void {
  s.provSol = computeSteppedSol(s);
}

// the player's front province for attacking `targetProv`: its highest-solidarity own neighbour (tie → lowest
// id), using the provided solidarity buffer. -1 if the player doesn't border the target.
function playerFront(s: ProvinceSimState, playerId: number, targetProv: number, sol: ArrayLike<number>): number {
  let bestSol = -Infinity, front = -1;
  for (const q of s.adj[targetProv]) {
    if (s.provOwner[q] !== playerId) continue;
    const v = sol[q];
    if (v > bestSol || (v === bestSol && (front < 0 || q < front))) { bestSol = v; front = q; }
  }
  return front;
}

// why an attack turns out the way it does — the dominant factor separating attacker from defender.
export type AttackReason = "realm-strong" | "realm-weak" | "target-shaky" | "target-stable" | "near" | "too-far" | "even";
export interface AttackOdds { win: boolean; atk: number; def: number; reason: AttackReason; breakable: boolean; }

// Full breakdown of the player attacking `targetProv` this turn: attacker vs defender strength and the dominant
// REASON for the verdict. Deterministic and EXACT — shares the stepped solidarity / aggregate / strength /
// CONTEST_THRESH that stepPlayerTurn runs, so it never lies. null if the player can't reach the target.
export function explainAttack(s: ProvinceSimState, playerId: number, targetProv: number): AttackOdds | null {
  const stepped = computeSteppedSol(s);
  const front = playerFront(s, playerId, targetProv, stepped);
  if (front < 0) return null;
  const tmp: ProvinceSimState = { ...s, provSol: stepped };
  const agg = pAggregate(tmp);
  const o = s.provOwner[targetProv];
  const atk = strength(tmp, agg, playerId, targetProv, front);
  const def = o < 0 ? 0 : strength(tmp, agg, o, targetProv, targetProv);
  const win = atk > def * CONTEST_THRESH;
  // decompose attacker-minus-defender into named terms; the largest-magnitude one explains the verdict
  const defAvg = o < 0 ? 0 : agg[o].avg;
  const defSol = o < 0 ? 0 : stepped[targetProv];
  const pcap = s.capitalProv[playerId], ocap = o >= 0 ? s.capitalProv[o] : -1;
  const myDist = pcap >= 0 ? centroidDist(s.provinces[targetProv], s.provinces[pcap]) : 0;
  const theirDist = ocap >= 0 ? centroidDist(s.provinces[targetProv], s.provinces[ocap]) : myDist;
  const terms: [AttackReason, AttackReason, number][] = [
    ["realm-strong", "realm-weak", W_ASA * (agg[playerId].avg - defAvg)],
    ["target-shaky", "target-stable", W_LOCAL * (stepped[front] - defSol)],
    ["near", "too-far", -W_DIST * (myDist - theirDist)],
  ];
  terms.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
  const [pos, neg, val] = terms[0];
  const reason: AttackReason = Math.abs(val) < 1e-6 ? "even" : val >= 0 ? pos : neg;
  // "breakable": could a FULLY cohesive realm (avg + front solidarity → 1) take this now? If yes, consolidating
  // opens it; if even a maxed realm loses, the defender is too strong for now (wait for it to weaken).
  const bestAtk = W_ASA * 1 + W_LOCAL * 1 + W_POWER * Math.sqrt(Math.min(agg[playerId].cells, SIZE_CAP)) - W_DIST * myDist;
  const breakable = bestAtk > def * CONTEST_THRESH;
  return { win, atk, def, reason, breakable };
}

// Would the player CAPTURE `targetProv` this turn? Convenience wrapper over explainAttack (null if unreachable).
export function predictCapture(s: ProvinceSimState, playerId: number, targetProv: number): boolean | null {
  const odds = explainAttack(s, playerId, targetProv);
  return odds ? odds.win : null;
}

type AttackerPick = { attacker: number; frontProv: number } | null;

// double-buffered contest: for each province p (owner o) an attacker is chosen by `pick(p, o, agg)`; if
// atk > def·CONTEST_THRESH the whole province flips. Reads pre-turn ownership + stepped solidarity, writes a
// fresh owner buffer, then resets conquered provinces to CONQUEST_SOL. Returns the conquered province ids.
interface Conquest { prov: number; attacker: number; front: number; }

function contestPass(s: ProvinceSimState, pick: (p: number, o: number, agg: PAgg[]) => AttackerPick): Conquest[] {
  const agg = pAggregate(s);
  const nextOwner = s.provOwner.slice();
  const conquered: Conquest[] = [];
  for (let p = 0; p < s.n; p++) {
    const o = s.provOwner[p];
    const chosen = pick(p, o, agg);
    if (!chosen) continue;
    const atk = strength(s, agg, chosen.attacker, p, chosen.frontProv);
    const def = o < 0 ? 0 : strength(s, agg, o, p, p);
    if (atk > def * CONTEST_THRESH) { nextOwner[p] = chosen.attacker; conquered.push({ prov: p, attacker: chosen.attacker, front: chosen.frontProv }); }
  }
  s.provOwner = nextOwner;
  for (const c of conquered) s.provSol[c.prov] = CONQUEST_SOL; // a fresh conquest is cohesive
  return conquered;
}

function recomputeAlive(s: ProvinceSimState): void {
  for (let id = 0; id < s.alive.length; id++) {
    s.alive[id] = s.capitalProv[id] >= 0 && s.provOwner[s.capitalProv[id]] === id;
  }
}

// attacker chooser: p's strongest LIVE adjacent enemy by agg.avg. `excludePlayer` (an id, or -1 for none) is
// never chosen as an aggressor — the player only attacks its explicit targets, never auto-initiates.
function aiAttacker(s: ProvinceSimState, excludePlayer: number) {
  return (p: number, o: number, agg: PAgg[]): AttackerPick => {
    let attacker = -1, frontProv = -1, bestAvg = -Infinity;
    for (const q of s.adj[p]) {
      const po = s.provOwner[q];
      if (po < 0 || po === o || po === excludePlayer || !s.alive[po]) continue;
      if (agg[po].avg > bestAvg) { bestAvg = agg[po].avg; attacker = po; frontProv = q; }
    }
    return attacker < 0 ? null : { attacker, frontProv };
  };
}

export function stepProvinceSim(s: ProvinceSimState): void {
  stepSolidarity(s);
  contestPass(s, aiAttacker(s, -1)); // -1 = no player; every nation may auto-initiate
  recomputeAlive(s);
  s.tick++;
}

export interface PlayerStepEvents {
  conquests: { prov: number; from: number; to: number }[];
  eliminated: number[];
}

// provinces the player may attack this turn: not player-owned, and adjacent to some player-owned province.
// Enemy (alive or already-eliminated) and unowned wilderness all qualify — so no land is stranded.
export function armableTargets(s: ProvinceSimState, playerId: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < s.n; p++) {
    if (s.provOwner[p] === playerId) continue;
    let borders = false;
    for (const q of s.adj[p]) if (s.provOwner[q] === playerId) { borders = true; break; }
    if (borders) out.push(p);
  }
  return out;
}

// one player turn: rng-free. Solidarity step, then a single double-buffered contest where the player attacks
// its explicit `targets` (from its highest-solidarity adjacent front province) and every OTHER province is
// auto-contested by its strongest live non-player enemy. Then alive-recompute + tick++. Returns the events.
export function stepPlayerTurn(
  s: ProvinceSimState, playerId: number, targets: ReadonlySet<number>,
  opts: { consolidate?: boolean } = {},
): PlayerStepEvents {
  const prevOwner = s.provOwner.slice();
  const prevAlive = s.alive.slice();
  stepSolidarity(s);
  // a "consolidate" turn: the player forgoes attacking and instead shores up ONLY the provinces it selected
  // (passed in `targets`), not the whole realm — so it can't blanket-shield every front. Applied before the
  // contest so it also defends better this tick. AI nations still act.
  if (opts.consolidate) {
    for (const p of targets) if (p >= 0 && p < s.n && s.provOwner[p] === playerId) {
      const sv = s.provSol[p] + CONSOLIDATE_BONUS;
      s.provSol[p] = sv > 1 ? 1 : sv;
    }
  }
  const playerTargets: ReadonlySet<number> = opts.consolidate ? EMPTY_TARGETS : targets;
  const ai = aiAttacker(s, playerId); // AI excludes the player from auto-initiating
  const conquered = contestPass(s, (p, o, agg) => {
    if (o !== playerId && playerTargets.has(p)) {
      const front = playerFront(s, playerId, p, s.provSol); // s.provSol is already the stepped buffer here
      if (front >= 0) return { attacker: playerId, frontProv: front };
    }
    return ai(p, o, agg);
  });
  // committing an assault exhausts the province you attacked FROM — its solidarity drops, so blitzing on many
  // fronts leaves them weak and exposed to a counterattack next turn (the "push vs hold" tension). Player only.
  for (const c of conquered) if (c.attacker === playerId) {
    const v = s.provSol[c.front] - ATTACK_EXHAUST;
    s.provSol[c.front] = v < 0 ? 0 : v;
  }
  recomputeAlive(s);
  s.tick++;
  const conquests = conquered.map((c) => ({ prov: c.prov, from: prevOwner[c.prov], to: s.provOwner[c.prov] }));
  const eliminated: number[] = [];
  for (let id = 0; id < s.alive.length; id++) if (prevAlive[id] && !s.alive[id]) eliminated.push(id);
  return { conquests, eliminated };
}
