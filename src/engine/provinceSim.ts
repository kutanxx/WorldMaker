import type { World } from "../types/world";
import type { Province } from "./provinces";

type GridLike = Pick<World["grid"], "count" | "neighbors">;
type LaneGrid = Pick<World["grid"], "count" | "neighbors" | "points" | "width" | "height">;

const SOL_INIT = 0.5;
const SOL_RISE = 0.03, SOL_DECAY = 0.02;
const CONQUEST_SOL = 0.7;
const CONSOLIDATE_BONUS = 0.1; // a "consolidate" player turn adds this to each owned province's solidarity
const ATTACK_EXHAUST = 0.1;    // a conquest drops the attacking front province's solidarity — aggression exposes you
const EMPTY_TARGETS: ReadonlySet<number> = new Set();
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002, SIZE_CAP = 24, CONTEST_THRESH = 1.03;
const LANE_HOP_CELLS = 3;   // a short-hop lane may cross up to this many cell-spacings of open water
const LANE_MAX_DEGREE = 3;  // Risk lesson: few connections per territory (chokepoints, not a mesh)
export const EXPEDITION_MULT = 0.6; // a lane crossing is a costly naval invasion — attacker strength is scaled by this

export const PROVINCE_SIM_TICKS = 50;

export interface ProvinceSimState {
  provinces: Province[];
  n: number;
  provOwner: Int32Array;   // province → polity id (-1 unowned)
  provSol: Float32Array;   // province → solidarity [0,1]
  adj: number[][];         // province land-adjacency, index-aligned to provinces
  laneAdj?: number[][];    // expedition sea lanes (province → lane partners); optional so land-only fixtures compile
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

// cells of province p that touch open sea (a neighbour cell is ocean, provinceOf < 0) — the crossing endpoints.
function wharfCells(provinceOf: ArrayLike<number>, nProv: number, grid: LaneGrid): number[][] {
  const out: number[][] = Array.from({ length: nProv }, () => []);
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c];
    if (p < 0) continue;
    for (const nb of grid.neighbors[c]) if (provinceOf[nb] < 0) { out[p].push(c); break; }
  }
  return out;
}

// nearest Euclidean distance between any wharf cell of a and any wharf cell of b (Infinity if either has none).
function wharfDist(a: number[], b: number[], points: ArrayLike<number>): number {
  let best = Infinity;
  for (const ca of a) for (const cb of b) {
    const dx = points[ca * 2] - points[cb * 2], dy = points[ca * 2 + 1] - points[cb * 2 + 1];
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

// Risk-style expedition lanes over open water. Deterministic, rng-free. `laneAdj[p]` = sorted unique partners.
// Two halves: (1) short-hop lanes between nearby coastal provinces (this task); (2) a connectivity fallback so
// every capital is reachable (Task 2). `capitals` = the distinct capital province ids (used only by the fallback).
export function buildSeaLanes(
  provinceOf: ArrayLike<number>, provinces: Province[], grid: LaneGrid, adj: number[][], capitals: number[],
): number[][] {
  const n = provinces.length;
  const lanes: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const wharf = wharfCells(provinceOf, n, grid);
  const coastal = provinces.filter((p) => wharf[p.id].length > 0).map((p) => p.id);
  const spacing = Math.sqrt((grid.width * grid.height) / Math.max(1, grid.count));
  const maxHop = LANE_HOP_CELLS * spacing;

  const landAdj: Set<number>[] = adj.map((a) => new Set(a));
  const add = (a: number, b: number) => { lanes[a].add(b); lanes[b].add(a); };

  // (1) short-hop candidates: coastal pairs, not land-adjacent, within maxHop. Add greedily by ascending distance,
  //     skipping a pair if either endpoint is already at the degree cap. Ties → lower (a,b) id.
  const cand: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < coastal.length; i++) for (let j = i + 1; j < coastal.length; j++) {
    const a = coastal[i], b = coastal[j];
    if (landAdj[a].has(b)) continue;
    const d = wharfDist(wharf[a], wharf[b], grid.points);
    if (d <= maxHop) cand.push({ a, b, d });
  }
  cand.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  for (const { a, b } of cand) {
    if (lanes[a].size >= LANE_MAX_DEGREE || lanes[b].size >= LANE_MAX_DEGREE) continue;
    add(a, b);
  }

  // (2) connectivity fallback: join every capital-bearing component into one, cheapest wharf pair first.
  // Component labels over adj ∪ lanes-so-far.
  const label = (): Int32Array => {
    const lab = new Int32Array(n).fill(-1);
    let next = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (lab[s0] >= 0) continue;
      const stack = [s0]; lab[s0] = next;
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of adj[u]) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
        for (const v of lanes[u]) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
      }
      next++;
    }
    return lab;
  };
  const capProvs = [...new Set(capitals.filter((c) => c >= 0))];
  // repeatedly connect the two distinct capital-components whose nearest coastal provinces are closest.
  for (;;) {
    const lab = label();
    const capLabels = [...new Set(capProvs.map((c) => lab[c]))];
    if (capLabels.length <= 1) break;
    let best: { a: number; b: number; d: number } | null = null;
    // consider only coastal provinces; find the closest cross-component wharf pair (ties → lower ids).
    for (let i = 0; i < coastal.length; i++) for (let j = i + 1; j < coastal.length; j++) {
      const a = coastal[i], b = coastal[j];
      if (lab[a] === lab[b]) continue;                       // same component already
      if (!capLabels.includes(lab[a]) || !capLabels.includes(lab[b])) continue; // both sides must carry a capital
      const d = wharfDist(wharf[a], wharf[b], grid.points);
      if (!best || d < best.d || (d === best.d && (a < best.a || (a === best.a && b < best.b)))) best = { a, b, d };
    }
    if (!best) break; // no coastal way to connect (all-inland capitals) — leave as is
    // intentionally ignores LANE_MAX_DEGREE: a lifeline must connect a stranded capital-component regardless of
    // the degree cap, which is only a soft guarantee for the short-hop lanes added in part (1) above.
    add(best.a, best.b);
  }

  return lanes.map((s) => [...s].sort((x, y) => x - y));
}

// lane partners of province p, tolerant of fixtures that predate laneAdj (→ land-only, no lanes).
function laneOf(s: ProvinceSimState, p: number): number[] { return s.laneAdj?.[p] ?? []; }

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
  const capitals = [...new Set([...capitalProv].filter((c) => c >= 0))];
  const laneAdj = buildSeaLanes(provinceOf, provinces, world.grid, adj, capitals);
  const alive = polities.map((pol) => capitalProv[pol.id] >= 0 && provOwner[capitalProv[pol.id]] === pol.id);
  return { provinces, n, provOwner, provSol, adj, laneAdj, capitalProv, alive, tick: 0 };
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
    if (!frontier) for (const q of laneOf(s, p)) if (provOwner[q] !== o) { frontier = true; break; }
    const sv = s.provSol[p] + (frontier ? SOL_RISE : -SOL_DECAY);
    nextSol[p] = sv < 0 ? 0 : sv > 1 ? 1 : sv;
  }
  return nextSol;
}

// double-buffered solidarity update (behaviour unchanged; shared by the AI step and the player step).
function stepSolidarity(s: ProvinceSimState): void {
  s.provSol = computeSteppedSol(s);
}

// the attacker's best own province bordering `target`, and whether the route is a lane (expedition). Land
// neighbours are preferred (no penalty); among a route class, highest solidarity wins (tie → lower id).
// front = -1 if the attacker doesn't reach the target at all.
function attackFront(s: ProvinceSimState, attacker: number, target: number, sol: ArrayLike<number>): { front: number; lane: boolean } {
  const pickBest = (ids: number[]): number => {
    let bestSol = -Infinity, front = -1;
    for (const q of ids) {
      if (s.provOwner[q] !== attacker) continue;
      const v = sol[q];
      if (v > bestSol || (v === bestSol && (front < 0 || q < front))) { bestSol = v; front = q; }
    }
    return front;
  };
  const land = pickBest(s.adj[target]);
  if (land >= 0) return { front: land, lane: false };
  const lane = pickBest(laneOf(s, target));
  return { front: lane, lane: lane >= 0 };
}

// why an attack turns out the way it does — the dominant factor separating attacker from defender.
export type AttackReason = "realm-strong" | "realm-weak" | "target-shaky" | "target-stable" | "near" | "too-far" | "even";
export interface AttackOdds { win: boolean; atk: number; def: number; reason: AttackReason; breakable: boolean; lane: boolean; }

// Full breakdown of the player attacking `targetProv` this turn: attacker vs defender strength and the dominant
// REASON for the verdict. Deterministic and EXACT — shares the stepped solidarity / aggregate / strength /
// CONTEST_THRESH that stepPlayerTurn runs, so it never lies. null if the player can't reach the target.
export function explainAttack(s: ProvinceSimState, playerId: number, targetProv: number): AttackOdds | null {
  const stepped = computeSteppedSol(s);
  const { front, lane } = attackFront(s, playerId, targetProv, stepped);
  if (front < 0) return null;
  const tmp: ProvinceSimState = { ...s, provSol: stepped };
  const agg = pAggregate(tmp);
  const o = s.provOwner[targetProv];
  const mult = lane ? EXPEDITION_MULT : 1;
  const atk = strength(tmp, agg, playerId, targetProv, front) * mult;
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
  const bestAtk = (W_ASA * 1 + W_LOCAL * 1 + W_POWER * Math.sqrt(Math.min(agg[playerId].cells, SIZE_CAP)) - W_DIST * myDist) * mult;
  const breakable = bestAtk > def * CONTEST_THRESH;
  return { win, atk, def, reason, breakable, lane };
}

// Would the player CAPTURE `targetProv` this turn? Convenience wrapper over explainAttack (null if unreachable).
export function predictCapture(s: ProvinceSimState, playerId: number, targetProv: number): boolean | null {
  const odds = explainAttack(s, playerId, targetProv);
  return odds ? odds.win : null;
}

type AttackerPick = { attacker: number; frontProv: number; lane: boolean } | null;

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
    const atk = strength(s, agg, chosen.attacker, p, chosen.frontProv) * (chosen.lane ? EXPEDITION_MULT : 1);
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
    let attacker = -1, frontProv = -1, lane = false, bestAvg = -Infinity;
    const consider = (q: number, viaLane: boolean) => {
      const po = s.provOwner[q];
      if (po < 0 || po === o || po === excludePlayer || !s.alive[po]) return;
      // strictly-better realm wins; on a tie, prefer the land route (viaLane === false).
      if (agg[po].avg > bestAvg || (agg[po].avg === bestAvg && lane && !viaLane)) {
        bestAvg = agg[po].avg; attacker = po; frontProv = q; lane = viaLane;
      }
    };
    for (const q of s.adj[p]) consider(q, false);
    for (const q of laneOf(s, p)) consider(q, true);
    return attacker < 0 ? null : { attacker, frontProv, lane };
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
    if (!borders) for (const q of laneOf(s, p)) if (s.provOwner[q] === playerId) { borders = true; break; }
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
      const { front, lane } = attackFront(s, playerId, p, s.provSol); // s.provSol is already the stepped buffer here
      if (front >= 0) return { attacker: playerId, frontProv: front, lane };
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

// --- Dilemmas: occasional choice cards for texture. rng-FREE — a dilemma appears only when the game STATE
// triggers it (a shaky province, a wavering neighbour, a periodic muster), so the sequence is deterministic.
// The engine golden tests never call these, so they stay untouched. The UI enforces a cooldown between offers.
export type ProvinceDilemmaCode = "restless" | "defector" | "muster";
export interface ProvinceDilemma { code: ProvinceDilemmaCode; prov: number } // prov = the province in question (-1 = none)

const DILEMMA_RESTLESS_MAX = 0.25; // your province is "restless" below this solidarity
const DILEMMA_DEFECTOR_MAX = 0.3;  // an enemy province may defect below this
const DILEMMA_MUSTER_EVERY = 12;   // a muster is called every this-many ticks

// the dilemma (if any) the current state calls for, by priority. Deterministic.
export function offerProvinceDilemma(s: ProvinceSimState, playerId: number): ProvinceDilemma | null {
  // 1. restless: your shakiest owned province, if it is very fragile
  let worst = -1, worstSol = DILEMMA_RESTLESS_MAX;
  for (let p = 0; p < s.n; p++) if (s.provOwner[p] === playerId && s.provSol[p] < worstSol) { worstSol = s.provSol[p]; worst = p; }
  if (worst >= 0) return { code: "restless", prov: worst };
  // 2. defector: a low-solidarity enemy province adjacent to you (never a nation's capital — no free kills)
  for (let p = 0; p < s.n; p++) {
    const o = s.provOwner[p];
    if (o < 0 || o === playerId || s.capitalProv[o] === p || s.provSol[p] >= DILEMMA_DEFECTOR_MAX) continue;
    for (const q of s.adj[p]) if (s.provOwner[q] === playerId) return { code: "defector", prov: p };
  }
  // 3. muster: periodic
  if (s.tick > 0 && s.tick % DILEMMA_MUSTER_EVERY === 0) return { code: "muster", prov: -1 };
  return null;
}

// apply a dilemma choice ("a" or "b") to the state. Mutates provSol / provOwner; rng-free, deterministic.
export function resolveProvinceDilemma(s: ProvinceSimState, playerId: number, d: ProvinceDilemma, choice: "a" | "b"): void {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (d.code === "restless") {
    if (choice === "a") { // garrison it — steady the province, but the capital gives up troops
      s.provSol[d.prov] = clamp(s.provSol[d.prov] + 0.2);
      const cap = s.capitalProv[playerId];
      if (cap >= 0) s.provSol[cap] = clamp(s.provSol[cap] - 0.05);
    } // "b": let it be — no change (it stays fragile)
  } else if (d.code === "defector") {
    if (choice === "a") { // accept fealty — gain the province, but it starts fragile
      s.provOwner[d.prov] = playerId;
      s.provSol[d.prov] = 0.25;
      recomputeAlive(s);
    } // "b": refuse — no change
  } else { // muster
    for (let p = 0; p < s.n; p++) {
      if (s.provOwner[p] !== playerId) continue;
      if (choice === "a") { // levy the frontier — border rises, interior gives up its garrison
        let frontier = false;
        for (const q of s.adj[p]) if (s.provOwner[q] !== playerId) { frontier = true; break; }
        s.provSol[p] = clamp(s.provSol[p] + (frontier ? 0.1 : -0.05));
      } else { // rest — a small steady gain everywhere
        s.provSol[p] = clamp(s.provSol[p] + 0.03);
      }
    }
  }
}
