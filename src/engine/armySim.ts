import type { World } from "../types/world";
import { buildProvinceAdj } from "./provinceSim";
import { OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE } from "./biome";

// --- tunable constants (the whole balance surface of the prototype lives here) ---
export const LEVY_FRAC = 0.2;      // max share of a province's population one levy takes
export const REGROW_FRAC = 0.03;   // share of basePop regained per turn
export const UPKEEP_FRAC = 0.03;   // share of an army lost per turn (use it or lose it)
export const MILITIA_FRAC = 0.2;   // share of a province's population that defends it in battle
export const WIN_LOSS_MULT = 0.6;  // winner's losses as a share of the loser's effective strength
export const CITY_BONUS = 0.5;     // population multiplier added per city in the province
export const POP_SCALE = 20;      // people per "cell-unit" — sets the game's numeric scale so levies
                                  // and upkeep survive integer floors and read like real armies

// population potential by biome: rich plains, empty mountains
export const BIOME_POP: Record<number, number> = {
  [OCEAN]: 0, [GRASSLAND]: 1.0, [TEMPERATE_FOREST]: 0.8, [TROPICAL]: 0.7,
  [TAIGA]: 0.5, [WETLAND]: 0.5, [TUNDRA]: 0.3, [DESERT]: 0.3, [ALPINE]: 0.25,
};

// defensibility by biome. Below 1.0 = the ATTACKER is favoured (open ground), so defence
// never simply pays and the map cannot stalemate.
export const BIOME_DEF: Record<number, number> = {
  [OCEAN]: 1.0, [GRASSLAND]: 0.85, [DESERT]: 0.9, [TUNDRA]: 1.0, [TROPICAL]: 1.15,
  [TEMPERATE_FOREST]: 1.2, [TAIGA]: 1.2, [WETLAND]: 1.35, [ALPINE]: 1.6,
};

export interface Army { prov: number; nation: number; men: number }

export interface ArmyState {
  world: World;
  n: number;
  owner: Int32Array;      // province -> nation id (-1 unowned)
  pop: Float64Array;      // province -> current population
  basePop: Float64Array;  // province -> population ceiling
  armies: Army[];
  adj: number[][];
  turn: number;
}

// a province's population ceiling, derived from the generated world: size x biome x cities.
export function basePopOf(world: World, provId: number): number {
  const p = world.provinces[provId];
  if (!p) return 0;
  let cities = 0;
  for (const c of world.cities) if (world.provinceOf[c.cell] === provId) cities++;
  return p.cells * (BIOME_POP[p.biome] ?? 0) * (1 + CITY_BONUS * cities) * POP_SCALE;
}

// each province's majority owner over its cells (ties -> lower id; unowned -> -1)
function majorityOwner(world: World, nProv: number): Int32Array {
  const tally: Map<number, number>[] = Array.from({ length: nProv }, () => new Map<number, number>());
  for (let c = 0; c < world.provinceOf.length; c++) {
    const p = world.provinceOf[c];
    if (p < 0 || p >= nProv) continue;
    const o = world.polityOf[c];
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

export function initArmySim(world: World): ArmyState {
  const n = world.provinces.length;
  const owner = majorityOwner(world, n);
  // a nation must not start capital-less: force each capital's province to its polity
  for (const pol of world.polities) {
    const cap = world.provinceOf[pol.capital];
    if (cap >= 0) owner[cap] = pol.id;
  }
  const basePop = new Float64Array(n);
  const pop = new Float64Array(n);
  for (let p = 0; p < n; p++) { basePop[p] = basePopOf(world, p); pop[p] = basePop[p]; }
  const adj = buildProvinceAdj(world.provinceOf, world.provinces, world.grid);
  return { world, n, owner, pop, basePop, armies: [], adj, turn: 0 };
}

export function armyAt(s: ArmyState, prov: number, nation: number): Army | undefined {
  return s.armies.find((a) => a.prov === prov && a.nation === nation);
}

// men one levy can raise from a province right now
export function maxLevy(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * LEVY_FRAC);
}

// raise men from an owned province: the population really leaves the land.
export function levy(s: ArmyState, prov: number, nation: number): number {
  if (prov < 0 || prov >= s.n || s.owner[prov] !== nation) return 0;
  const men = maxLevy(s, prov);
  if (men <= 0) return 0;
  s.pop[prov] -= men;
  const a = armyAt(s, prov, nation);
  if (a) a.men += men; else s.armies.push({ prov, nation, men });
  return men;
}

// a mobilised army bleeds every turn — you must use it or lose it (the anti-turtle force).
export function applyUpkeep(s: ArmyState): void {
  for (const a of s.armies) a.men -= Math.max(1, Math.floor(a.men * UPKEEP_FRAC));
  s.armies = s.armies.filter((a) => a.men > 0);
}

export function regrow(s: ArmyState): void {
  for (let p = 0; p < s.n; p++) {
    const v = s.pop[p] + s.basePop[p] * REGROW_FRAC;
    s.pop[p] = v > s.basePop[p] ? s.basePop[p] : v;
  }
}

// the province's own people take up arms when attacked. Computed at battle time, so a province
// hollowed out by over-levying really is defenceless. Militia cannot move.
export function militiaOf(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * MILITIA_FRAC);
}

// effective defence of `prov` against `attacker`: every non-attacker army standing there plus the
// militia, all multiplied by how defensible the terrain is.
export function defenceOf(s: ArmyState, prov: number, attacker: number): number {
  let men = 0;
  for (const a of s.armies) if (a.prov === prov && a.nation !== attacker) men += a.men;
  const mult = BIOME_DEF[s.world.provinces[prov].biome] ?? 1;
  return (men + militiaOf(s, prov)) * mult;
}

export interface BattleResult { won: boolean; atk: number; def: number; attackerLosses: number; captured: boolean }

function resolve(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  const army = armyAt(s, prov, nation);
  if (!army || !s.adj[prov]?.includes(target)) return null;
  if (s.owner[target] === nation) return { won: true, atk: army.men, def: 0, attackerLosses: 0, captured: false };
  const atk = army.men;
  const def = defenceOf(s, target, nation);
  const won = atk > def;
  // the min() clamp guards future tuning of WIN_LOSS_MULT: if it were ever raised to >= 1,
  // losses could otherwise exceed the attacking force and drive `men` negative. At today's
  // constants a win always implies atk >= 1, so the clamp is a no-op in practice.
  const attackerLosses = won ? Math.min(atk, Math.round(def * WIN_LOSS_MULT)) : atk;
  return { won, atk, def, attackerLosses, captured: won };
}

// PURE forecast of a move — same arithmetic the real move runs, so the preview can never lie.
export function previewMove(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  return resolve(s, prov, nation, target);
}

// march or attack. On a win the army occupies the target (and the land, with its population, changes
// hands — that population is levyable next turn, which is what makes attacking compound).
export function moveArmy(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  const r = resolve(s, prov, nation, target);
  if (!r) return null;
  const army = armyAt(s, prov, nation)!;
  if (!r.won) {                                   // wiped out
    s.armies = s.armies.filter((a) => a !== army);
    return r;
  }
  // losses, then relocate the survivors onto the target
  army.men -= r.attackerLosses;
  const militiaLost = r.captured ? militiaOf(s, target) : 0;
  s.armies = s.armies.filter((a) => a !== army);
  if (r.captured) {
    s.armies = s.armies.filter((a) => a.prov !== target);  // the defenders are destroyed
    s.pop[target] = Math.max(0, s.pop[target] - militiaLost);
    s.owner[target] = nation;
  }
  if (army.men > 0) {
    const there = armyAt(s, target, nation);
    if (there) there.men += army.men; else s.armies.push({ prov: target, nation, men: army.men });
  }
  return r;
}

// Deliberately dumb AI: enough for the world to push back while we test whether the loop is fun.
// Each non-player nation levies once from its most populous province, then marches its biggest army
// at the weakest adjacent enemy province it can actually beat. Deterministic: ties break on lower id.
export function aiTurn(s: ArmyState, playerNation: number): void {
  const nations = [...new Set([...s.owner].filter((o) => o >= 0 && o !== playerNation))].sort((a, b) => a - b);
  for (const nation of nations) {
    // 1. levy from the most populous owned province
    let best = -1;
    for (let p = 0; p < s.n; p++) {
      if (s.owner[p] !== nation) continue;
      if (best < 0 || s.pop[p] > s.pop[best]) best = p;
    }
    if (best >= 0) levy(s, best, nation);
    // 2. march the biggest army at the weakest beatable adjacent enemy province
    let army: Army | undefined;
    for (const a of s.armies) {
      if (a.nation !== nation) continue;
      if (!army || a.men > army.men || (a.men === army.men && a.prov < army.prov)) army = a;
    }
    if (!army) continue;
    let target = -1, targetDef = Infinity;
    for (const q of s.adj[army.prov]) {
      if (s.owner[q] === nation) continue;
      const d = defenceOf(s, q, nation);
      if (d < army.men && (d < targetDef || (d === targetDef && q < target))) { targetDef = d; target = q; }
    }
    if (target >= 0) moveArmy(s, army.prov, nation, target);
  }
}

export function endTurn(s: ArmyState, playerNation: number): void {
  aiTurn(s, playerNation);
  applyUpkeep(s);
  regrow(s);
  s.turn++;
}
