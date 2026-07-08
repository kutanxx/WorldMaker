import type { World } from "../types/world";
import { initSim, stepSim, aggregate, buildStraitLinks, STRAIT_HOPS, TICKS, YEARS_PER_TICK, type SimState, type Stance, type HistoryEvent } from "./historySim";
import { applyIntervention, type Action } from "./intervention";

export interface TurnResult { year: number; defeated: boolean; finished: boolean; events: HistoryEvent[]; message: string; actionCode?: string; actionData?: Record<string, string | number> }
export interface Scorecard { cells: number; peakCells: number; rank: number; nations: number; survivedYears: number; alive: boolean; citiesFounded: number; citiesHeld: number }

export function playerCells(s: SimState): number {
  let n = 0;
  for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) n++;
  return n;
}

export function initPlaySim(world: World, seed: number, playerPolity: number, stance: Stance): SimState {
  const s = initSim(world, seed);
  s.playerPolity = playerPolity;
  s.stance = stance;
  s.straitLinks = buildStraitLinks(world.grid, world.terrain, STRAIT_HOPS); // enable amphibious warfare (all nations)
  s.peakCells = playerCells(s);
  return s;
}

export function setStance(s: SimState, stance: Stance): void {
  s.stance = stance; // free lever, separate from the one action/turn
}

export function playTurn(s: SimState, action: Action | null): TurnResult {
  let message = "", actionCode: string | undefined, actionData: Record<string, string | number> | undefined;
  if (action) { const r = applyIntervention(s, action); message = r.message; actionCode = r.code; actionData = r.data; }
  const before = s.events.length;
  stepSim(s);
  const cells = playerCells(s);
  if (cells > s.peakCells) s.peakCells = cells;
  const defeated = !s.alive[s.playerPolity];
  return {
    year: s.tick * YEARS_PER_TICK,
    defeated,
    finished: defeated || s.tick >= TICKS,
    events: s.events.slice(before),
    message,
    actionCode,
    actionData,
  };
}

export function scorecard(s: SimState): Scorecard {
  const agg = aggregate(s);
  const mine = agg[s.playerPolity]?.cells ?? 0;
  const alive = s.alive[s.playerPolity];
  let rank = 1, nations = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o]) continue;
    nations++;
    if (agg[o].cells > mine) rank++;
  }
  let citiesHeld = 0;
  for (const fc of s.foundedCities) if (s.owner[fc] === s.playerPolity) citiesHeld++;
  // a defeated realm is not counted among the living, so it has no rank (0 = unranked) — otherwise
  // rank counts every living nation above its 0 cells and reports the impossible "N+1 of N".
  return { cells: mine, peakCells: s.peakCells, rank: alive ? rank : 0, nations, survivedYears: s.tick * YEARS_PER_TICK, alive, citiesFounded: s.foundedCities.size, citiesHeld };
}

// --- victory conditions (play layer; measurement-seeded, tunable) ---
export const PROSPER_CITIES = 6;    // held founded cities for the prosperity path
export const PROSPER_COH = 0.55;    // avg cohesion floor for prosperity
export const PROSPER_STREAK = 3;    // consecutive turns the prosperity gate must hold

export interface VictoryProgress {
  rivalsLeft: number;      // living initial rivals (excludes the player)
  initialRivals: number;   // count of initial polities other than the player
  cities: number;          // player-held founded cities
  cohesionOk: boolean;     // avg cohesion >= PROSPER_COH
  year: number;            // s.tick * YEARS_PER_TICK
  conquest: boolean;       // every initial rival eliminated (and there was >=1)
  prosperityGate: boolean; // cities >= PROSPER_CITIES && cohesionOk (the per-turn gate)
}

export function victoryProgress(s: SimState): VictoryProgress {
  const agg = aggregate(s);
  let initialRivals = 0, rivalsLeft = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (o === s.playerPolity || s.polities[o].origin !== "initial") continue;
    initialRivals++;
    if (s.alive[o]) rivalsLeft++;
  }
  let cities = 0;
  for (const fc of s.foundedCities) if (s.owner[fc] === s.playerPolity) cities++;
  const cohesionOk = (agg[s.playerPolity]?.avg ?? 0) >= PROSPER_COH;
  return {
    rivalsLeft, initialRivals, cities, cohesionOk,
    year: s.tick * YEARS_PER_TICK,
    conquest: initialRivals >= 1 && rivalsLeft === 0,
    prosperityGate: cities >= PROSPER_CITIES && cohesionOk,
  };
}
