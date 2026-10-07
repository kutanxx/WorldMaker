import type { World } from "../types/world";
import { initSim, stepSim, TICKS, YEARS_PER_TICK } from "./historySim";
import type { History } from "./historySim";

export type {
  History, HistoryPolity, HistoryEvent, HistoryEventType, HistorySnapshot, EconomicZone,
} from "./historySim";

/**
 * The capitals (cells) of the realms standing in `year`. A realm stands from the year it was founded to the
 * year it fell, not including that one: the simulation ends a realm in the year its capital is taken and
 * records the year's map after, and a realm born of a civil war or a secession is on its birth year's map.
 */
export function standingSeats(
  polities: readonly { capital: number; foundedYear: number; endedYear: number | null }[],
  year: number,
): Set<number> {
  const out = new Set<number>();
  for (const p of polities) {
    if (p.foundedYear <= year && (p.endedYear === null || p.endedYear > year)) out.add(p.capital);
  }
  return out;
}

export function simulateHistory(world: World, worldSeed: number): History {
  const s = initSim(world, worldSeed);
  for (let t = 1; t <= TICKS; t++) stepSim(s);
  return {
    years: TICKS * YEARS_PER_TICK,
    polities: s.polities,
    events: s.events,
    snapshots: s.snapshots,
    economicZones: s.economicZones,
    cityFoundings: [...s.foundedTowns].map(([cityId, year]) => ({ cityId, year })).sort((a, b) => a.year - b.year),
  };
}
