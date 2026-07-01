import { OCEAN } from "./terrain";
import type { World } from "../types/world";

const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
const W_POWER = 0.01, W_LOCAL = 1.0, W_DIST = 0.004, CONTEST_THRESH = 1.05;

interface Agg { cells: number; power: number; }

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
  const px = (i: number) => grid.points[i * 2];
  const py = (i: number) => grid.points[i * 2 + 1];
  const dist = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b));

  const owner = Int32Array.from(polityOf);
  let solidarity = new Float32Array(n);
  for (let c = 0; c < n; c++) solidarity[c] = owner[c] >= 0 ? SOL_INIT : 0;

  const polities: HistoryPolity[] = world.polities.map((p) => ({
    id: p.id, name: p.name, color: p.color, capital: p.capital,
    foundedYear: 0, endedYear: null, origin: "initial" as const,
  }));
  const capitals: number[] = polities.map((p) => p.capital);

  const events: HistoryEvent[] = [];
  for (const p of polities) events.push({ year: 0, type: "found", text: `0년, ${p.name} 건국`, polityId: p.id, cell: p.capital });

  const snapshots: HistorySnapshot[] = [{ year: 0, owner: owner.slice() }];

  const aggregate = (): Agg[] => {
    const a: Agg[] = polities.map(() => ({ cells: 0, power: 0 }));
    for (let c = 0; c < n; c++) { const o = owner[c]; if (o >= 0) { a[o].cells++; a[o].power += solidarity[c]; } }
    return a;
  };

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
    // --- border contests (double-buffered) ---
    const agg = aggregate();
    const nextOwner = owner.slice();
    for (let c = 0; c < n; c++) {
      if (terrain[c] === OCEAN) continue;
      const o = owner[c];
      let best = -1, bestPow = -Infinity, bestCell = -1;
      for (const nb of neighbors[c]) {
        if (terrain[nb] === OCEAN) continue;
        const p = owner[nb];
        if (p < 0 || p === o) continue;
        if (agg[p].power > bestPow) { bestPow = agg[p].power; best = p; bestCell = nb; }
      }
      if (best < 0) continue; // no claimant neighbour
      const attack = agg[best].power * W_POWER + solidarity[bestCell] * W_LOCAL - dist(c, capitals[best]) * W_DIST;
      const defend = o < 0 ? 0 : agg[o].power * W_POWER + solidarity[c] * W_LOCAL - dist(c, capitals[o]) * W_DIST;
      if (attack > defend * CONTEST_THRESH) nextOwner[c] = best;
    }
    owner.set(nextOwner);
    snapshots.push({ year, owner: owner.slice() });
  }

  return { years: TICKS * YEARS_PER_TICK, polities, events, snapshots };
}
