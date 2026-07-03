import type { World } from "../types/world";
import { initSim, stepSim, TICKS, YEARS_PER_TICK } from "./historySim";
import type { History } from "./historySim";

export type {
  History, HistoryPolity, HistoryEvent, HistoryEventType, HistorySnapshot, EconomicZone,
} from "./historySim";

export function simulateHistory(world: World, worldSeed: number): History {
  const s = initSim(world, worldSeed);
  for (let t = 1; t <= TICKS; t++) stepSim(s);
  return {
    years: TICKS * YEARS_PER_TICK,
    polities: s.polities,
    events: s.events,
    snapshots: s.snapshots,
    economicZones: s.economicZones,
  };
}
