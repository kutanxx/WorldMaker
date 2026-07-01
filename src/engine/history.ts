import { OCEAN } from "./terrain";
import type { World } from "../types/world";

const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;

export interface HistoryPolity {
  id: number; name: string; color: string;
  capital: number; foundedYear: number; endedYear: number | null;
  origin: "initial" | "fragment";
}
export type HistoryEventType = "found" | "newCity" | "conquer" | "fragment";
export interface HistoryEvent {
  year: number; type: HistoryEventType; text: string;
  polityId: number; otherId?: number; cell?: number;
}
export interface HistorySnapshot { year: number; owner: Int32Array; }
export interface History {
  years: number;
  polities: HistoryPolity[];
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
}

export function simulateHistory(world: World, _worldSeed: number): History {
  const { grid, terrain, polityOf } = world;
  const n = grid.count;
  const neighbors = grid.neighbors;

  const owner = Int32Array.from(polityOf);
  let solidarity = new Float32Array(n);
  for (let c = 0; c < n; c++) solidarity[c] = owner[c] >= 0 ? SOL_INIT : 0;

  const polities: HistoryPolity[] = world.polities.map((p) => ({
    id: p.id, name: p.name, color: p.color, capital: p.capital,
    foundedYear: 0, endedYear: null, origin: "initial" as const,
  }));

  const events: HistoryEvent[] = [];
  for (const p of polities) events.push({ year: 0, type: "found", text: `0년, ${p.name} 건국`, polityId: p.id, cell: p.capital });

  const snapshots: HistorySnapshot[] = [{ year: 0, owner: owner.slice() }];

  for (let tick = 1; tick <= TICKS; tick++) {
    const year = tick * YEARS_PER_TICK;
    // --- solidarity update (double-buffered) ---
    const nextSol = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const o = owner[c];
      if (o < 0) { nextSol[c] = 0; continue; }
      let frontier = false;
      for (const nb of neighbors[c]) { if (terrain[nb] !== OCEAN && owner[nb] !== o) { frontier = true; break; } }
      const s = solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
      nextSol[c] = s < 0 ? 0 : s > 1 ? 1 : s;
    }
    solidarity = nextSol;
    // (Task 2 inserts border contests here; Task 3 conquest; Task 4 fragment/newCity)
    snapshots.push({ year, owner: owner.slice() });
  }

  return { years: TICKS * YEARS_PER_TICK, polities, events, snapshots };
}
