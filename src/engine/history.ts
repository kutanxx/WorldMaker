import { OCEAN } from "./terrain";
import type { World } from "../types/world";
import { mulberry32, deriveSeed } from "./rng";
import { makeNameGen } from "./names";

const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
const W_POWER = 0.01, W_LOCAL = 1.0, W_DIST = 0.006, CONTEST_THRESH = 1.08;
const HISTORY_SALT = 9001;
const FRAG_MIN_CELLS = 150, FRAG_MAX_AVGSOL = 0.40, FRAG_PROB = 0.08, FRAG_CLUSTER = 30;
const CITY_MIN_CELLS = 40, CITY_MIN_AVGSOL = 0.42, CITY_PROB = 0.14;
const HPALETTE = ["#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6", "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8"];

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

export function simulateHistory(world: World, worldSeed: number): History {
  const { grid, terrain, polityOf } = world;
  const n = grid.count;
  const neighbors = grid.neighbors;
  const px = (i: number) => grid.points[i * 2];
  const py = (i: number) => grid.points[i * 2 + 1];
  const dist = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b));

  const owner = Int32Array.from(polityOf);
  const rng = mulberry32(deriveSeed(worldSeed, HISTORY_SALT));
  const nameGen = makeNameGen(mulberry32(deriveSeed(worldSeed, HISTORY_SALT + 1)));
  let solidarity = new Float32Array(n);
  for (let c = 0; c < n; c++) solidarity[c] = owner[c] >= 0 ? SOL_INIT : 0;

  const polities: HistoryPolity[] = world.polities.map((p) => ({
    id: p.id, name: p.name, color: p.color, capital: p.capital,
    foundedYear: 0, endedYear: null, origin: "initial" as const,
  }));
  const capitals: number[] = polities.map((p) => p.capital);
  const alive: boolean[] = polities.map(() => true);

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
    // --- conquest: a polity whose capital falls is eliminated and annexed ---
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o]) continue;
      const capOwner = owner[capitals[o]];
      if (capOwner >= 0 && capOwner !== o) {
        for (let c = 0; c < n; c++) if (owner[c] === o) owner[c] = capOwner; // annex remainder
        alive[o] = false; polities[o].endedYear = year;
        events.push({ year, type: "conquer", text: `${year}년, ${polities[capOwner].name}이(가) ${polities[o].name}을(를) 정복`, polityId: capOwner, otherId: o, cell: capitals[o] });
      }
    }
    // --- fragmentation: one large, low-solidarity polity may shed a border cluster ---
    const agg2 = aggregate();
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o] || agg2[o].cells < FRAG_MIN_CELLS) continue;
      if (agg2[o].power / agg2[o].cells >= FRAG_MAX_AVGSOL) continue;
      if (rng() > FRAG_PROB) continue;
      // seed = a border cell of o that is not the capital
      let seed = -1;
      for (let c = 0; c < n; c++) {
        if (owner[c] !== o || c === capitals[o]) continue;
        if (neighbors[c].some((nb) => terrain[nb] !== OCEAN && owner[nb] !== o)) { seed = c; break; }
      }
      if (seed < 0) continue;
      // grow a bounded cluster within o's cells (BFS), excluding the capital
      const cluster: number[] = [seed]; const inCluster = new Set([seed]);
      for (let qi = 0; qi < cluster.length && cluster.length < FRAG_CLUSTER; qi++) {
        for (const nb of neighbors[cluster[qi]]) {
          if (owner[nb] === o && nb !== capitals[o] && !inCluster.has(nb)) { inCluster.add(nb); cluster.push(nb); if (cluster.length >= FRAG_CLUSTER) break; }
        }
      }
      if (cluster.length < 6) continue;
      const newId = polities.length;
      polities.push({ id: newId, name: nameGen.nation(), color: HPALETTE[newId % HPALETTE.length], capital: seed, foundedYear: year, endedYear: null, origin: "fragment" });
      capitals.push(seed); alive.push(true);
      for (const c of cluster) owner[c] = newId;
      events.push({ year, type: "fragment", text: `${year}년, 내란이 ${polities[o].name}을(를) 갈라 ${polities[newId].name} 탄생`, polityId: o, otherId: newId, cell: seed });
      break; // at most one fragmentation per tick
    }
    // --- new city: one large, stable polity may found a lore city ---
    for (let o = 0; o < agg2.length; o++) {
      if (!alive[o] || agg2[o].cells < CITY_MIN_CELLS) continue;
      if (agg2[o].power / agg2[o].cells < CITY_MIN_AVGSOL) continue;
      if (rng() > CITY_PROB) continue;
      events.push({ year, type: "newCity", text: `${year}년, ${polities[o].name}이(가) ${nameGen.place()} 건설`, polityId: o, cell: capitals[o] });
      break; // at most one per tick
    }
    snapshots.push({ year, owner: owner.slice() });
  }

  return { years: TICKS * YEARS_PER_TICK, polities, events, snapshots };
}
