import { OCEAN } from "./terrain";
import { nationColor, FREE_COLOR } from "./palette";
import type { World } from "../types/world";
import { mulberry32, deriveSeed, type Rng } from "./rng";
import { makeNameGen, type NameGen } from "./names";

export const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
// W_DIST 0.002 -> 0.003 and SIZE_CAP 24 -> 20 together: one realm used to eat the continent (see
// "no realm swallows the world" in history.test.ts for the twelve-seed measurement). Size was the
// snowball — a big realm won contests because it was big, so it got bigger — and distance is its
// natural counterweight, since ground far from a capital is the ground an empire cannot hold.
// Both moved modestly rather than one drastically: size still pays up to 400 cells, and the reach
// penalty is half again what it was. Measured: the largest realm's share fell 65.6% -> 40.4%,
// worlds ending under a hegemon 8/12 -> 3/12, realms holding a twentieth of the land 2.9 -> 4.8.
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.003;
export const CONTEST_THRESH = 1.03;
const SIZE_CAP = 20;
const HISTORY_SALT = 9001;
const CIVILWAR_MIN_CELLS = 220, CIVILWAR_MAX_ASA = 0.42, CIVILWAR_PROB = 0.06, CIVILWAR_BIRTH_SOL = 0.7;
const FREE_REACH = 250, FREE_MAX_ASA = 0.5, FREE_PROB = 0.035, FREE_ZONE_PROB = 0.09;
const FREE_SOL = 0.85, FREE_CLUSTER = 5, FREE_MAX_ALIVE = 4;
const ECON_COUNT = 3, ECON_SOL_FLOOR = 0.55, ECON_BONUS = 0.12;
const GOLDEN_MIN_CELLS = 170, GOLDEN_MIN_ASA = 0.38;

export interface Agg { cells: number; power: number; avg: number; }

export interface HistoryPolity {
  id: number; name: string; color: string;
  capital: number; foundedYear: number; endedYear: number | null;
  origin: "initial" | "fragment" | "free";
  free: boolean;
}
export type HistoryEventType = "found" | "newCity" | "conquer" | "civilwar" | "independence" | "staple" | "goldenage";
export interface HistoryEvent {
  year: number; type: HistoryEventType;
  polityId: number; otherId?: number; cell?: number;
  /** a name the simulation coined that no id can recover: the city `newCity` founds,
      the free port `staple` designates */
  name?: string;
  /** the successor states a civil war split a realm into (ids into `polities`) */
  intoIds?: number[];
}
export interface HistorySnapshot { year: number; owner: Int32Array; }
export interface EconomicZone { cell: number; name: string; }
export interface History {
  years: number;
  polities: HistoryPolity[];
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
  economicZones: EconomicZone[];
  /** which town the chronicle founded, and when — the towns exist on the map from the start, but
      this is the year the history says they came to be, so the timeline can hold them back */
  cityFoundings: { cityId: number; year: number }[];
}

export interface SimState {
  grid: World["grid"];
  terrain: number[];
  n: number;
  owner: Int32Array;
  solidarity: Float32Array;
  polities: HistoryPolity[];
  capitals: number[];
  alive: boolean[];
  golden: boolean[];
  rng: Rng;
  nameGen: NameGen;
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
  economicZones: EconomicZone[];
  zoneCells: Set<number>;
  cityCells: { id: number; cell: number; name: string; isCapital: boolean }[];
  foundedTowns: Map<number, number>;   // cityId -> the year the chronicle founded it
  tick: number;
}

const px = (s: SimState, i: number) => s.grid.points[i * 2];
const py = (s: SimState, i: number) => s.grid.points[i * 2 + 1];
const dist = (s: SimState, a: number, b: number) => Math.hypot(px(s, a) - px(s, b), py(s, a) - py(s, b));


export function aggregate(s: SimState): Agg[] {
  const a: Agg[] = s.polities.map(() => ({ cells: 0, power: 0, avg: 0 }));
  for (let c = 0; c < s.n; c++) { const o = s.owner[c]; if (o >= 0) { a[o].cells++; a[o].power += s.solidarity[c]; } }
  for (const g of a) g.avg = g.cells > 0 ? g.power / g.cells : 0;
  return a;
}
function zoneBonus(s: SimState, p: number): number {
  let b = 0;
  for (const z of s.economicZones) if (s.owner[z.cell] === p) b += ECON_BONUS;
  return b;
}
export function contestStrength(s: SimState, agg: Agg[], polity: number, distCell: number, solCell: number): number {
  return agg[polity].avg * W_ASA + s.solidarity[solCell] * W_LOCAL
    + Math.min(Math.sqrt(agg[polity].cells), SIZE_CAP) * W_POWER
    - dist(s, distCell, s.capitals[polity]) * W_DIST + zoneBonus(s, polity);
}
export const W_CONSTS_FOR_TEST = { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP };

// greedy farthest-point: pick `count` cells maximising min-distance to the chosen set
function farthest(s: SimState, cells: number[], seed: number, count: number): number[] {
  const chosen = [seed]; const out: number[] = [];
  while (out.length < count) {
    let best = -1, bd = -1;
    for (const c of cells) {
      if (chosen.includes(c)) continue;
      let md = Infinity;
      for (const sc of chosen) { const d = dist(s, c, sc); if (d < md) md = d; }
      if (md > bd) { bd = md; best = c; }
    }
    if (best < 0) break;
    chosen.push(best); out.push(best);
  }
  return out;
}

export function initSim(world: World, worldSeed: number): SimState {
  const { grid, terrain, polityOf } = world;
  const n = grid.count;
  const owner = Int32Array.from(polityOf);
  const rng = mulberry32(deriveSeed(worldSeed, HISTORY_SALT));
  const nameGen = makeNameGen(mulberry32(deriveSeed(worldSeed, HISTORY_SALT + 1)));
  const solidarity = new Float32Array(n);
  for (let c = 0; c < n; c++) solidarity[c] = owner[c] >= 0 ? SOL_INIT : 0;

  const polities: HistoryPolity[] = world.polities.map((p) => ({
    id: p.id, name: p.name, color: p.color, capital: p.capital,
    foundedYear: 0, endedYear: null, origin: "initial" as const, free: false,
  }));
  const capitals: number[] = polities.map((p) => p.capital);
  const alive: boolean[] = polities.map(() => true);
  const golden: boolean[] = polities.map(() => false);

  const events: HistoryEvent[] = [];
  for (const p of polities) events.push({ year: 0, type: "found", polityId: p.id, cell: p.capital });

  // economic zones: prefer coastal, then large cities (deterministic, no rng draw)
  const zoneCities = [...world.cities]
    .sort((a, b) => (Number(b.coastal) - Number(a.coastal)) || (b.size - a.size) || (a.id - b.id))
    .slice(0, ECON_COUNT);
  const economicZones: EconomicZone[] = zoneCities.map((c) => ({ cell: c.cell, name: c.name }));
  const zoneCells = new Set(economicZones.map((z) => z.cell));
  for (const z of economicZones) events.push({ year: 0, type: "staple", name: z.name, polityId: owner[z.cell] >= 0 ? owner[z.cell] : -1, cell: z.cell });

  const snapshots: HistorySnapshot[] = [{ year: 0, owner: owner.slice() }];
  const cityCells = world.cities.map((c) => ({ id: c.id, cell: c.cell, name: c.name, isCapital: c.isCapital }));

  return { grid, terrain, n, owner, solidarity, polities, capitals, alive, golden, rng, nameGen, events, snapshots, economicZones, zoneCells, cityCells, foundedTowns: new Map(), tick: 0 };
}

export function stepSim(s: SimState): void {
  const year = (s.tick + 1) * YEARS_PER_TICK;
  const { n, owner, terrain } = s;      // owner is a live ref, mutated in place; never reassigned
  const neighbors = s.grid.neighbors;

  // --- solidarity update (double-buffered); free cells pinned high, zones floored ---
  const nextSol = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const o = owner[c];
    if (o < 0) { nextSol[c] = 0; continue; }
    if (s.polities[o].free) { nextSol[c] = FREE_SOL; continue; }
    let frontier = false;
    for (const nb of neighbors[c]) { if (terrain[nb] !== OCEAN && owner[nb] !== o) { frontier = true; break; } }
    let sv = s.solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
    if (s.zoneCells.has(c) && sv < ECON_SOL_FLOOR) sv = ECON_SOL_FLOOR;
    nextSol[c] = sv < 0 ? 0 : sv > 1 ? 1 : sv;
  }
  s.solidarity = nextSol;

  // --- border contests: asabiyya + local − admin reach (free polities never attack) ---
  const agg = aggregate(s);
  const nextOwner = owner.slice();
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN) continue;
    const o = owner[c];
    let best = -1, bestAvg = -Infinity, bestCell = -1;
    for (const nb of neighbors[c]) {
      if (terrain[nb] === OCEAN) continue;
      const p = owner[nb];
      if (p < 0 || p === o || s.polities[p].free) continue;
      if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = nb; }
    }
    if (best < 0) continue;
    const atk = contestStrength(s, agg, best, c, bestCell);
    const def = o < 0 ? 0 : contestStrength(s, agg, o, c, c);
    if (atk > def * CONTEST_THRESH) nextOwner[c] = best;
  }
  owner.set(nextOwner);

  // --- conquest: a polity whose capital falls is eliminated and annexed ---
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o]) continue;
    const capOwner = owner[s.capitals[o]];
    if (capOwner >= 0 && capOwner !== o) {
      for (let c = 0; c < n; c++) if (owner[c] === o) owner[c] = capOwner;
      s.alive[o] = false; s.polities[o].endedYear = year;
      s.events.push({ year, type: "conquer", polityId: capOwner, otherId: o, cell: s.capitals[o] });
    }
  }

  // --- civil war: one large, low-cohesion empire disintegrates into 2-3 successors ---
  const agg2 = aggregate(s);
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o] || s.polities[o].free || agg2[o].cells < CIVILWAR_MIN_CELLS) continue;
    if (agg2[o].avg >= CIVILWAR_MAX_ASA) continue;
    if (s.rng() > CIVILWAR_PROB) continue;
    const cells: number[] = [];
    for (let c = 0; c < n; c++) if (owner[c] === o) cells.push(c);
    const extra = s.rng() < 0.5 ? 1 : 2; // 2 or 3 successor states total
    const newCaps = farthest(s, cells, s.capitals[o], extra);
    if (newCaps.length === 0) continue;
    const allCaps = [s.capitals[o], ...newCaps];
    const capPolity = allCaps.map((_, i) => (i === 0 ? o : s.polities.length + i - 1));
    for (let i = 1; i < allCaps.length; i++) {
      const id = s.polities.length;
      const nm = s.nameGen.nation();
      s.polities.push({ id, name: nm, color: nationColor(id), capital: allCaps[i], foundedYear: year, endedYear: null, origin: "fragment", free: false });
      s.capitals.push(allCaps[i]); s.alive.push(true); s.golden.push(false);
    }
    for (const c of cells) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < allCaps.length; i++) { const d = dist(s, c, allCaps[i]); if (d < bd) { bd = d; bi = i; } }
      owner[c] = capPolity[bi];
      s.solidarity[c] = CIVILWAR_BIRTH_SOL; // fresh cohesion so successors can stand on their own
    }
    s.events.push({ year, type: "civilwar", intoIds: capPolity.slice(1), polityId: o, cell: s.capitals[o] });
    break;
  }

  // --- free city: one city beyond admin reach (or an econ zone) declares independence ---
  const agg3 = aggregate(s);
  let aliveFree = 0;
  for (let o = 0; o < s.polities.length; o++) if (s.alive[o] && s.polities[o].free) aliveFree++;
  for (const { cell: c, name } of aliveFree < FREE_MAX_ALIVE ? s.cityCells : []) {
    const o = owner[c];
    if (o < 0 || !s.alive[o] || s.polities[o].free) continue;
    const isZone = s.zoneCells.has(c);
    const reachOk = dist(s, c, s.capitals[o]) > FREE_REACH;
    if (!isZone && !reachOk) continue;
    if (!isZone && agg3[o].avg >= FREE_MAX_ASA) continue;
    if (c === s.capitals[o]) continue; // a capital doesn't secede from itself
    if (s.rng() > (isZone ? FREE_ZONE_PROB : FREE_PROB)) continue;
    const cluster: number[] = [c]; const inC = new Set([c]);
    for (let qi = 0; qi < cluster.length && cluster.length < FREE_CLUSTER; qi++) {
      for (const nb of neighbors[cluster[qi]]) {
        if (owner[nb] === o && nb !== s.capitals[o] && !inC.has(nb)) { inC.add(nb); cluster.push(nb); if (cluster.length >= FREE_CLUSTER) break; }
      }
    }
    const id = s.polities.length;
    s.polities.push({ id, name, color: FREE_COLOR, capital: c, foundedYear: year, endedYear: null, origin: "free", free: true });
    s.capitals.push(c); s.alive.push(true); s.golden.push(false);
    for (const cc of cluster) owner[cc] = id;
    s.events.push({ year, type: "independence", polityId: id, otherId: o, cell: c });
    break;
  }

  // --- golden age: a polity first reaching high cohesion + size ---
  const agg4 = aggregate(s);
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o] || s.golden[o] || s.polities[o].free) continue;
    if (agg4[o].cells >= GOLDEN_MIN_CELLS && agg4[o].avg >= GOLDEN_MIN_ASA) {
      s.golden[o] = true;
      s.events.push({ year, type: "goldenage", polityId: o, cell: s.capitals[o] });
      break;
    }
  }

  // --- new city: one large, stable polity may found a lore city ---
  for (let o = 0; o < agg4.length; o++) {
    if (!s.alive[o] || s.polities[o].free || agg4[o].cells < 40) continue;
    if (agg4[o].avg < 0.42) continue;
    if (s.rng() > 0.14) continue;
    // The draw is kept whatever happens to the name: this generator's count is what everything
    // downstream is built on, and skipping it would move the map.
    // The coined name is no longer used by anything — the town founded is always a real one — but
    // the DRAW is still spent, because the name generator's count is what everything downstream is
    // built on and skipping it would move the map.
    s.nameGen.place();
    // ...but the town founded is a REAL one. The chronicle used to coin a name and announce a place
    // the atlas never drew — 19 of 19 on seed 1 — so a reader was told about towns they could never
    // find. The realm founds the nearest of its own unfounded towns to its seat, chosen without
    // drawing. When the world has none left, NOTHING is recorded. That used to be impossible: the
    // coined name had to stand, because dropping the event would have moved the count the golden
    // anchor pinned. Breaking up the hegemon leaves more realms alive and founding, which exhausts
    // the real towns and put two phantoms back into seed 5's chronicle — and since that change
    // re-pins the anchor anyway, the only reason for keeping them went with it. The name draw is
    // still spent, which is what keeps the map identical.
    const seat = s.capitals[o];
    const sx = s.grid.points[seat * 2], sy = s.grid.points[seat * 2 + 1];
    // Its own ground first; failing that, the nearest unfounded town anywhere, which is a colony
    // and reads as one. Preferring its own means a realm settles inward before it reaches out.
    const nearestUnfounded = (mine: boolean) => {
      let best: { id: number; cell: number; name: string } | null = null, bd = Infinity;
      for (const c of s.cityCells) {
        if (c.isCapital || s.foundedTowns.has(c.id)) continue;
        if (mine && s.owner[c.cell] !== o) continue;
        const d = Math.hypot(s.grid.points[c.cell * 2] - sx, s.grid.points[c.cell * 2 + 1] - sy);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    };
    const take = nearestUnfounded(true) ?? nearestUnfounded(false);
    // `nearestUnfounded(false)` searches the whole world, so a null here means no realm anywhere
    // has a town left to found — there is nothing for the next one in the loop to find either.
    if (!take) break;
    s.foundedTowns.set(take.id, year);
    s.events.push({ year, type: "newCity", name: take.name, polityId: o, cell: take.cell });
    break;
  }

  s.snapshots.push({ year, owner: owner.slice() });
  s.tick++;
}
