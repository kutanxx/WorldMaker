import type { World } from "../types/world";
import { initSim, stepSim, aggregate, TICKS, YEARS_PER_TICK, type SimState, type Stance, type HistoryEvent } from "./historySim";
import { applyIntervention, type Action } from "./intervention";

export interface TurnResult { year: number; defeated: boolean; finished: boolean; events: HistoryEvent[]; message: string }
export interface Scorecard { cells: number; peakCells: number; rank: number; nations: number; survivedYears: number; alive: boolean }

export function playerCells(s: SimState): number {
  let n = 0;
  for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) n++;
  return n;
}

export function initPlaySim(world: World, seed: number, playerPolity: number, stance: Stance): SimState {
  const s = initSim(world, seed);
  s.playerPolity = playerPolity;
  s.stance = stance;
  s.peakCells = playerCells(s);
  return s;
}

export function setStance(s: SimState, stance: Stance): void {
  s.stance = stance; // free lever, separate from the one action/turn
}

export function playTurn(s: SimState, action: Action | null): TurnResult {
  let message = "";
  if (action) message = applyIntervention(s, action).message;
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
  };
}

export function scorecard(s: SimState): Scorecard {
  const agg = aggregate(s);
  const mine = agg[s.playerPolity]?.cells ?? 0;
  let rank = 1, nations = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o]) continue;
    nations++;
    if (agg[o].cells > mine) rank++;
  }
  return { cells: mine, peakCells: s.peakCells, rank, nations, survivedYears: s.tick * YEARS_PER_TICK, alive: s.alive[s.playerPolity] };
}
