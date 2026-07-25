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
  return p.cells * (BIOME_POP[p.biome] ?? 0) * (1 + CITY_BONUS * cities);
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
