import { OCEAN } from "./terrain";
import type { World } from "../types/world";
import { mulberry32, deriveSeed } from "./rng";
import { makeNameGen } from "./names";

const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
// border contest: asabiyya (avg cohesion) + local frontier + a saturating size edge − admin reach.
// asabiyya drives it (Turchin), but a cohesive core can absorb small neighbours within reach;
// sqrt(cells) saturates so it never runs away, and W_DIST caps how far an empire projects.
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002, CONTEST_THRESH = 1.03;
const HISTORY_SALT = 9001;
// civil war: a large, low-cohesion empire disintegrates into 2-3 successor states
const CIVILWAR_MIN_CELLS = 220, CIVILWAR_MAX_ASA = 0.42, CIVILWAR_PROB = 0.06;
// free cities: a city beyond admin reach (or an economic zone) declares independence
const FREE_REACH = 250, FREE_MAX_ASA = 0.5, FREE_PROB = 0.035, FREE_ZONE_PROB = 0.09;
const FREE_SOL = 0.85, FREE_CLUSTER = 5, FREE_MAX_ALIVE = 4;
// economic special zones
const ECON_COUNT = 3, ECON_SOL_FLOOR = 0.55, ECON_BONUS = 0.12;
// golden age milestone: a realm reaching its height (large + not yet in decline)
const GOLDEN_MIN_CELLS = 170, GOLDEN_MIN_ASA = 0.38;
const HPALETTE = ["#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6", "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8"];
const FREE_COLOR = "#b7b1a4";

interface Agg { cells: number; power: number; avg: number; }

export interface HistoryPolity {
  id: number; name: string; color: string;
  capital: number; foundedYear: number; endedYear: number | null;
  origin: "initial" | "fragment" | "free";
  free: boolean;
}
export type HistoryEventType = "found" | "newCity" | "conquer" | "civilwar" | "independence" | "staple" | "goldenage";
export interface HistoryEvent {
  year: number; type: HistoryEventType; text: string;
  polityId: number; otherId?: number; cell?: number;
}
export interface HistorySnapshot { year: number; owner: Int32Array; }
export interface EconomicZone { cell: number; name: string; }
export interface History {
  years: number;
  polities: HistoryPolity[];
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
  economicZones: EconomicZone[];
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
    foundedYear: 0, endedYear: null, origin: "initial" as const, free: false,
  }));
  const capitals: number[] = polities.map((p) => p.capital);
  const alive: boolean[] = polities.map(() => true);
  const golden: boolean[] = polities.map(() => false);

  const events: HistoryEvent[] = [];
  for (const p of polities) events.push({ year: 0, type: "found", text: `0년, ${p.name} 건국`, polityId: p.id, cell: p.capital });

  // economic zones: prefer coastal, then large cities (deterministic, no rng draw)
  const zoneCities = [...world.cities]
    .sort((a, b) => (Number(b.coastal) - Number(a.coastal)) || (b.size - a.size) || (a.id - b.id))
    .slice(0, ECON_COUNT);
  const economicZones: EconomicZone[] = zoneCities.map((c) => ({ cell: c.cell, name: c.name }));
  const zoneCells = new Set(economicZones.map((z) => z.cell));
  for (const z of economicZones) events.push({ year: 0, type: "staple", text: `0년, ${z.name} 자유무역항 지정`, polityId: owner[z.cell] >= 0 ? owner[z.cell] : -1, cell: z.cell });

  const snapshots: HistorySnapshot[] = [{ year: 0, owner: owner.slice() }];
  const cityCells = world.cities.map((c) => ({ cell: c.cell, name: c.name }));

  const aggregate = (): Agg[] => {
    const a: Agg[] = polities.map(() => ({ cells: 0, power: 0, avg: 0 }));
    for (let c = 0; c < n; c++) { const o = owner[c]; if (o >= 0) { a[o].cells++; a[o].power += solidarity[c]; } }
    for (const g of a) g.avg = g.cells > 0 ? g.power / g.cells : 0;
    return a;
  };
  const zoneBonus = (p: number): number => {
    let b = 0;
    for (const z of economicZones) if (owner[z.cell] === p) b += ECON_BONUS;
    return b;
  };
  // greedy farthest-point: pick `count` cells maximising min-distance to the chosen set
  const farthest = (cells: number[], seed: number, count: number): number[] => {
    const chosen = [seed]; const out: number[] = [];
    while (out.length < count) {
      let best = -1, bd = -1;
      for (const c of cells) {
        if (chosen.includes(c)) continue;
        let md = Infinity;
        for (const s of chosen) { const d = dist(c, s); if (d < md) md = d; }
        if (md > bd) { bd = md; best = c; }
      }
      if (best < 0) break;
      chosen.push(best); out.push(best);
    }
    return out;
  };

  for (let tick = 1; tick <= TICKS; tick++) {
    const year = tick * YEARS_PER_TICK;
    // --- solidarity update (double-buffered); free cells pinned high, zones floored ---
    const nextSol = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const o = owner[c];
      if (o < 0) { nextSol[c] = 0; continue; }
      if (polities[o].free) { nextSol[c] = FREE_SOL; continue; }
      let frontier = false;
      for (const nb of neighbors[c]) { if (terrain[nb] !== OCEAN && owner[nb] !== o) { frontier = true; break; } }
      let s = solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
      if (zoneCells.has(c) && s < ECON_SOL_FLOOR) s = ECON_SOL_FLOOR;
      nextSol[c] = s < 0 ? 0 : s > 1 ? 1 : s;
    }
    solidarity = nextSol;

    // --- border contests: asabiyya + local − admin reach (free polities never attack) ---
    const agg = aggregate();
    const nextOwner = owner.slice();
    for (let c = 0; c < n; c++) {
      if (terrain[c] === OCEAN) continue;
      const o = owner[c];
      let best = -1, bestAvg = -Infinity, bestCell = -1;
      for (const nb of neighbors[c]) {
        if (terrain[nb] === OCEAN) continue;
        const p = owner[nb];
        if (p < 0 || p === o || polities[p].free) continue;
        if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = nb; }
      }
      if (best < 0) continue;
      const attack = agg[best].avg * W_ASA + solidarity[bestCell] * W_LOCAL + Math.sqrt(agg[best].cells) * W_POWER - dist(c, capitals[best]) * W_DIST + zoneBonus(best);
      const defend = o < 0 ? 0 : agg[o].avg * W_ASA + solidarity[c] * W_LOCAL + Math.sqrt(agg[o].cells) * W_POWER - dist(c, capitals[o]) * W_DIST + zoneBonus(o);
      if (attack > defend * CONTEST_THRESH) nextOwner[c] = best;
    }
    owner.set(nextOwner);

    // --- conquest: a polity whose capital falls is eliminated and annexed ---
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o]) continue;
      const capOwner = owner[capitals[o]];
      if (capOwner >= 0 && capOwner !== o) {
        for (let c = 0; c < n; c++) if (owner[c] === o) owner[c] = capOwner;
        alive[o] = false; polities[o].endedYear = year;
        events.push({ year, type: "conquer", text: `${year}년, ${polities[capOwner].name}이(가) ${polities[o].name}을(를) 정복`, polityId: capOwner, otherId: o, cell: capitals[o] });
      }
    }

    // --- civil war: one large, low-cohesion empire disintegrates into 2-3 successors ---
    const agg2 = aggregate();
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o] || polities[o].free || agg2[o].cells < CIVILWAR_MIN_CELLS) continue;
      if (agg2[o].avg >= CIVILWAR_MAX_ASA) continue;
      if (rng() > CIVILWAR_PROB) continue;
      const cells: number[] = [];
      for (let c = 0; c < n; c++) if (owner[c] === o) cells.push(c);
      const extra = rng() < 0.5 ? 1 : 2; // 2 or 3 successor states total
      const newCaps = farthest(cells, capitals[o], extra);
      if (newCaps.length === 0) continue;
      const allCaps = [capitals[o], ...newCaps];
      const capPolity = allCaps.map((_, i) => (i === 0 ? o : polities.length + i - 1));
      const names: string[] = [];
      for (let i = 1; i < allCaps.length; i++) {
        const id = polities.length;
        const nm = nameGen.nation();
        names.push(nm);
        polities.push({ id, name: nm, color: HPALETTE[id % HPALETTE.length], capital: allCaps[i], foundedYear: year, endedYear: null, origin: "fragment", free: false });
        capitals.push(allCaps[i]); alive.push(true); golden.push(false);
      }
      for (const c of cells) {
        let bi = 0, bd = Infinity;
        for (let i = 0; i < allCaps.length; i++) { const d = dist(c, allCaps[i]); if (d < bd) { bd = d; bi = i; } }
        owner[c] = capPolity[bi];
      }
      events.push({ year, type: "civilwar", text: `${year}년, 내란이 ${polities[o].name}을(를) ${names.join("·")}(으)로 쪼갬`, polityId: o, cell: capitals[o] });
      break;
    }

    // --- free city: one city beyond admin reach (or an econ zone) declares independence ---
    const agg3 = aggregate();
    let aliveFree = 0;
    for (let o = 0; o < polities.length; o++) if (alive[o] && polities[o].free) aliveFree++;
    for (const { cell: c, name } of aliveFree < FREE_MAX_ALIVE ? cityCells : []) {
      const o = owner[c];
      if (o < 0 || !alive[o] || polities[o].free) continue;
      const isZone = zoneCells.has(c);
      const reachOk = dist(c, capitals[o]) > FREE_REACH;
      if (!isZone && !reachOk) continue;
      if (!isZone && agg3[o].avg >= FREE_MAX_ASA) continue;
      if (c === capitals[o]) continue; // a capital doesn't secede from itself
      if (rng() > (isZone ? FREE_ZONE_PROB : FREE_PROB)) continue;
      const cluster: number[] = [c]; const inC = new Set([c]);
      for (let qi = 0; qi < cluster.length && cluster.length < FREE_CLUSTER; qi++) {
        for (const nb of neighbors[cluster[qi]]) {
          if (owner[nb] === o && nb !== capitals[o] && !inC.has(nb)) { inC.add(nb); cluster.push(nb); if (cluster.length >= FREE_CLUSTER) break; }
        }
      }
      const id = polities.length;
      polities.push({ id, name, color: FREE_COLOR, capital: c, foundedYear: year, endedYear: null, origin: "free", free: true });
      capitals.push(c); alive.push(true); golden.push(false);
      for (const cc of cluster) owner[cc] = id;
      events.push({ year, type: "independence", text: `${year}년, 자유도시 ${name} 독립 선포`, polityId: id, otherId: o, cell: c });
      break;
    }

    // --- golden age: a polity first reaching high cohesion + size ---
    const agg4 = aggregate();
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o] || golden[o] || polities[o].free) continue;
      if (agg4[o].cells >= GOLDEN_MIN_CELLS && agg4[o].avg >= GOLDEN_MIN_ASA) {
        golden[o] = true;
        events.push({ year, type: "goldenage", text: `${year}년, ${polities[o].name} 황금기 도래`, polityId: o, cell: capitals[o] });
        break;
      }
    }

    // --- new city: one large, stable polity may found a lore city ---
    for (let o = 0; o < agg4.length; o++) {
      if (!alive[o] || polities[o].free || agg4[o].cells < 40) continue;
      if (agg4[o].avg < 0.42) continue;
      if (rng() > 0.14) continue;
      events.push({ year, type: "newCity", text: `${year}년, ${polities[o].name}이(가) ${nameGen.place()} 건설`, polityId: o, cell: capitals[o] });
      break;
    }

    snapshots.push({ year, owner: owner.slice() });
  }

  return { years: TICKS * YEARS_PER_TICK, polities, events, snapshots, economicZones };
}
