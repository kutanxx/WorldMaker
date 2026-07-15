import { OCEAN } from "./terrain";
import type { World } from "../types/world";
import { mulberry32, deriveSeed, type Rng } from "./rng";
import { makeNameGen, type NameGen } from "./names";

export const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002;
export const CONTEST_THRESH = 1.03;
const SIZE_CAP = 24;
const HISTORY_SALT = 9001;
const CIVILWAR_MIN_CELLS = 220, CIVILWAR_MAX_ASA = 0.42, CIVILWAR_PROB = 0.06, CIVILWAR_BIRTH_SOL = 0.7;
const FREE_REACH = 250, FREE_MAX_ASA = 0.5, FREE_PROB = 0.035, FREE_ZONE_PROB = 0.09;
const FREE_SOL = 0.85, FREE_CLUSTER = 5, FREE_MAX_ALIVE = 4;
const ECON_COUNT = 3, ECON_SOL_FLOOR = 0.55, ECON_BONUS = 0.12;
const GOLDEN_MIN_CELLS = 170, GOLDEN_MIN_ASA = 0.38;
const HPALETTE = ["#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6", "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8"];
const FREE_COLOR = "#b7b1a4";

// --- player stance (Phase 1): MODEST nudges, only active when playerPolity >= 0 (honest low-agency) ---
// Balance pass 2026-07-07 (bot-measured, see plans/…-phase2 session notes): defensive was WORSE
// than passing (0.6 self-nerf starved it), aggressive self-destructed (decay too harsh) — the
// triangle is retuned so every stance has a real job while staying honest (no protagonist buff).
// exported so the UI's stance tooltips render THESE numbers (a retune can never desync the copy)
export const STANCE_ATK_MULT = { aggressive: 1.35, defensive: 0.8, internal: 0.55 } as const; // player-as-attacker multiplier
export const STANCE_DEF_MULT = { aggressive: 1.0, defensive: 1.5, internal: 1.05 } as const;  // player-as-defender multiplier
export const STANCE_SOL_DELTA = { aggressive: -0.01, defensive: 0.005, internal: 0.02 } as const; // per-tick solidarity nudge on player cells
export const CONQUEST_SOL = CIVILWAR_BIRTH_SOL; // reuse the sim's fresh-conquest cohesion value
export type Stance = "aggressive" | "defensive" | "internal";

// --- foundCity anchors (Phase 2): a founded city is a PERMANENT but SMALL anchor — effects apply
// only while the player still owns the cell (honest low-agency: no nation-wide escape hatch) ---
export const CITY_SOL_FLOOR = 0.55;   // founded-city cell solidarity floor per tick (while owned)
export const CITY_POWER_BONUS = 0.08; // contest bonus at the founded cell + its neighbours (while owned)
export const CITY_MIN_GAP = 60;       // min map-distance from any existing city to found a new one
export const PEACE_TICKS = 3;         // a truce lasts 3 ticks = 30 years

// --- amphibious warfare (only in a game, playerPolity >= 0): coastal cells can contest enemy coastal
// cells across a narrow strait; the assault is weakened by the sea crossing. The pure history path
// builds no straitLinks so it never runs this — golden byte-identity holds. ---
const STRAIT_SEA_HOPS = 2;          // a "narrow strait" = at most this many ocean cells to cross
export const STRAIT_HOPS = STRAIT_SEA_HOPS;
export const AMPHIB_MULT = 0.85;    // attacker strength penalty for crossing water
export const EXPEDITION_MULT = 0.6;  // attacker penalty for crossing a SEA LANE (a costly naval expedition)

export const GRUDGE_TICKS = 5;  // 50y — grudges decay (Civ VI grievances); moved from standing.ts (import direction)
export const REVENGE_MULT = 1.2; // a grudge-holding polity strikes PLAYER cells this much harder while fresh

export const ASCENSION_CAP = 5;          // ladder ceiling — the annals ★ stays comparable
// per level per tick: every rival regenerates this much faster. 0.003 (was 0.005): at 0.005 the
// interior nudge (+0.005·L) cancels SOL_DECAY (0.02) at L=4 and reverses it at L=5, so large
// empires never fall below CIVILWAR_MAX_ASA — rival civil wars froze (sweep: 18/20 seeds→1/20 at
// A5) AND an aggressive player was unwinnable (20/20 deaths, 0 cells). 0.003 keeps interior decay
// negative at every level, so the world stays dynamic (A5 civil wars 12/20) and beatable, at the
// cost of a flatter A3–A5 lethality ramp. Diminishing-return forms were measured and INVERTED the
// ramp (A5 easier than A0), so the difficulty could not be decoupled from consolidation.
export const ASCENSION_SOL_DELTA = 0.003;

export interface Agg { cells: number; power: number; avg: number; }

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
  cityCells: { cell: number; name: string }[];
  tick: number;
  playerPolity: number; // -1 = pure history (default); else the player's polity id
  ascension: number;    // 0 = off (always 0 on the pure path); play sets 1..ASCENSION_CAP
  stance: Stance;       // inert when playerPolity < 0
  peakCells: number;    // max cells the player has held (scorecard); default 0
  truces: Map<number, number>;  // polityId -> tick until which they won't attack the player; default empty
  foundedCities: Set<number>;   // player-founded anchor cells (inert while not owned); default empty
  lastDilemma: number;          // tick of the last dilemma offer (cooldown); only the play UI reads it
  dilemmaFlags: Set<string>;    // dilemma chain/crisis markers (prophecy, hegemon); play UI only
  attacksOnPlayer: Map<number, number>; // polityId -> last tick it took player cells; play only
  attacksByPlayer: Map<number, number>; // polityId -> last tick the player took its cells; play only
  straitLinks?: number[][]; // per-cell coastal cells reachable across a narrow strait; only set in a game
  seaLanes: { a: number; b: number }[]; // expedition routes bridging disconnected landmasses; [] on the pure path
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
// founded-city anchor bonus at the contested cell + its neighbours — only for the player's polity
// and only while the player still owns the anchor (playerPolity === -1 ⇒ always 0 ⇒ golden safe)
function cityAnchorBonus(s: SimState, polity: number, distCell: number): number {
  if (polity !== s.playerPolity || s.foundedCities.size === 0) return 0;
  for (const fc of s.foundedCities) {
    if (s.owner[fc] !== s.playerPolity) continue; // captured anchor is inert
    if (fc === distCell || s.grid.neighbors[fc].includes(distCell)) return CITY_POWER_BONUS;
  }
  return 0;
}
export function contestStrength(s: SimState, agg: Agg[], polity: number, distCell: number, solCell: number): number {
  return agg[polity].avg * W_ASA + s.solidarity[solCell] * W_LOCAL
    + Math.min(Math.sqrt(agg[polity].cells), SIZE_CAP) * W_POWER
    - dist(s, distCell, s.capitals[polity]) * W_DIST + zoneBonus(s, polity)
    + cityAnchorBonus(s, polity, distCell);
}
export const W_CONSTS_FOR_TEST = { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP, STANCE_ATK_MULT };

// for each land cell, the coastal land cells reachable across ≤ `hops` ocean cells (a narrow strait).
// Pure geometry (no rng); symmetric by construction. Built once per game, never on the pure path.
export function buildStraitLinks(grid: World["grid"], terrain: number[], hops: number): number[][] {
  const n = grid.count;
  const links: number[][] = Array.from({ length: n }, () => []);
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN) continue;
    const seenOcean = new Set<number>();
    let frontier: number[] = [];
    for (const nb of grid.neighbors[c]) if (terrain[nb] === OCEAN) { seenOcean.add(nb); frontier.push(nb); }
    const found = new Set<number>();
    for (let d = 0; d < hops && frontier.length; d++) {
      const next: number[] = [];
      for (const o of frontier) {
        for (const nb of grid.neighbors[o]) {
          if (terrain[nb] === OCEAN) { if (!seenOcean.has(nb)) { seenOcean.add(nb); next.push(nb); } }
          else if (nb !== c) found.add(nb);
        }
      }
      frontier = next;
    }
    links[c] = [...found];
  }
  return links;
}
// Sea lanes (Risk-style expedition routes): the FEW dashed crossings that make every rival
// conquerable. Connects only reach-components that hold an initial capital, with a minimum
// spanning set of nearest-coast pairs. Pure geometry, rng-free, play-only (never on the pure path).
export function buildSeaLanes(
  grid: World["grid"], terrain: number[], straitLinks: number[][], capitals: number[],
): { a: number; b: number }[] {
  const n = grid.count;
  const comp = new Int32Array(n).fill(-1);
  let nc = 0;
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN || comp[c] >= 0) continue;
    const stack = [c];
    comp[c] = nc;
    while (stack.length) {
      const x = stack.pop()!;
      for (const nb of grid.neighbors[x]) if (terrain[nb] !== OCEAN && comp[nb] < 0) { comp[nb] = nc; stack.push(nb); }
      for (const nb of straitLinks[x]) if (comp[nb] < 0) { comp[nb] = nc; stack.push(nb); }
    }
    nc++;
  }
  const wanted = [...new Set(capitals.map((c) => comp[c]))];
  if (wanted.length <= 1) return [];
  // coastal cells per wanted component
  const coast = new Map<number, number[]>();
  for (const k of wanted) coast.set(k, []);
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN) continue;
    const k = comp[c];
    if (!coast.has(k)) continue;
    if (grid.neighbors[c].some((nb) => terrain[nb] === OCEAN)) coast.get(k)!.push(c);
  }
  // greedy MST: repeatedly join the two closest groups by their nearest coastal pair
  const px = (i: number) => grid.points[i * 2], py = (i: number) => grid.points[i * 2 + 1];
  const groups: number[][] = wanted.map((k) => coast.get(k)!);
  const lanes: { a: number; b: number }[] = [];
  while (groups.length > 1) {
    let best: { d: number; a: number; b: number; gi: number; gj: number } | null = null;
    for (let x = 0; x < groups.length; x++) {
      for (let y = x + 1; y < groups.length; y++) {
        for (const ca of groups[x]) {
          for (const cb of groups[y]) {
            const d = Math.hypot(px(ca) - px(cb), py(ca) - py(cb));
            const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
            if (!best || d < best.d || (d === best.d && (lo < Math.min(best.a, best.b) || (lo === Math.min(best.a, best.b) && hi < Math.max(best.a, best.b))))) {
              best = { d, a: lo, b: hi, gi: x, gj: y };
            }
          }
        }
      }
    }
    if (!best) break; // a wanted component had no coast (theoretical) — leave the rest unbridged
    lanes.push({ a: best.a, b: best.b });
    groups[best.gi] = groups[best.gi].concat(groups[best.gj]);
    groups.splice(best.gj, 1);
  }
  return lanes;
}
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

  return { grid, terrain, n, owner, solidarity, polities, capitals, alive, golden, rng, nameGen, events, snapshots, economicZones, zoneCells, cityCells, playerPolity: -1, ascension: 0, stance: "internal", peakCells: 0, truces: new Map(), foundedCities: new Set(), lastDilemma: -99, dilemmaFlags: new Set(), attacksOnPlayer: new Map(), attacksByPlayer: new Map(), tick: 0, seaLanes: [] };
}

// revenge (play only): a polity the player struck within the grudge window hits back harder
// at PLAYER cells. Callers sit inside playerPolity>=0 gates — the o===-1===playerPolity
// pure-path trap never reaches this, and no rng is drawn.
function revengeMult(s: SimState, attacker: number): number {
  const t = s.attacksByPlayer.get(attacker);
  return t !== undefined && s.tick - t < GRUDGE_TICKS ? REVENGE_MULT : 1;
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
    if (s.playerPolity >= 0 && o === s.playerPolity) sv += STANCE_SOL_DELTA[s.stance]; // gated stance nudge
    // ascension (play only): every rival regenerates faster — the ONE difficulty dial. Real
    // stored solidarity, so the border report and meters stay honest. Free polities returned
    // above; the playerPolity gate keeps the pure path byte-identical.
    if (s.playerPolity >= 0 && s.ascension > 0 && o !== s.playerPolity) sv += ASCENSION_SOL_DELTA * s.ascension;
    if (s.playerPolity >= 0 && o === s.playerPolity && s.foundedCities.has(c) && sv < CITY_SOL_FLOOR) sv = CITY_SOL_FLOOR; // owned anchor
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
      if (s.playerPolity >= 0 && o === s.playerPolity && s.truces.size > 0 && (s.truces.get(p) ?? 0) > s.tick) continue; // truce holds
      if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = nb; }
    }
    if (best < 0) continue;
    const attack = contestStrength(s, agg, best, c, bestCell);
    const defend = o < 0 ? 0 : contestStrength(s, agg, o, c, c);
    let atk = attack, def = defend;
    if (s.playerPolity >= 0) {
      if (best === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];   // player attacking
      if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, best); } // player defending; grudges bite
    }
    if (atk > def * CONTEST_THRESH) {
      nextOwner[c] = best;
      // grudge ledger (play only). The explicit gate is LOAD-BEARING: on the pure path
      // playerPolity is -1 and unclaimed cells have o === -1, so o === playerPolity is true.
      // The ledger is read live mid-loop (revengeMult): a grudge set at cell c multiplies
      // contests at later indices the SAME tick — deterministic, and intervention-driven
      // revenge lands the same turn; buffering would delay it a turn for no gain.
      if (s.playerPolity >= 0) {
        if (o === s.playerPolity) s.attacksOnPlayer.set(best, s.tick);
        else if (best === s.playerPolity && o >= 0) s.attacksByPlayer.set(o, s.tick);
      }
    }
  }
  // amphibious strait contests (only in a game; the pure path has no straitLinks so this is skipped).
  // Land contests take priority: only cells NOT already changing hands can be taken from the sea.
  const straitLinks = s.straitLinks;
  if (s.playerPolity >= 0 && straitLinks) {
    for (let c = 0; c < n; c++) {
      if (terrain[c] === OCEAN || nextOwner[c] !== owner[c]) continue;
      const o = owner[c];
      const links = straitLinks[c];
      if (!links.length) continue;
      let best = -1, bestAvg = -Infinity, bestCell = -1;
      for (const b of links) {
        const p = owner[b];
        if (p < 0 || p === o || s.polities[p].free) continue;
        if (o === s.playerPolity && s.truces.size > 0 && (s.truces.get(p) ?? 0) > s.tick) continue; // truce holds at sea too
        if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = b; }
      }
      if (best < 0) continue;
      let atk = contestStrength(s, agg, best, c, bestCell) * AMPHIB_MULT;
      let def = o < 0 ? 0 : contestStrength(s, agg, o, c, c);
      if (best === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];
      if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, best); }
      if (atk > def * CONTEST_THRESH) {
        nextOwner[c] = best;
        if (o === s.playerPolity) s.attacksOnPlayer.set(best, s.tick);
        else if (best === s.playerPolity && o >= 0) s.attacksByPlayer.set(o, s.tick);
      }
    }
  }
  // sea-lane expedition contests (play only): a lane's endpoints can strike each other, at the
  // expedition penalty. Symmetric — bots cross too, so island worlds stay politically alive.
  if (s.playerPolity >= 0 && s.seaLanes.length) {
    for (const { a, b } of s.seaLanes) {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        if (nextOwner[to] !== owner[to]) continue; // a land/strait contest already took it this tick
        const p = owner[from], o = owner[to];
        if (p < 0 || p === o || s.polities[p].free) continue;
        if (o === s.playerPolity && s.truces.size > 0 && (s.truces.get(p) ?? 0) > s.tick) continue; // truce holds
        let atk = contestStrength(s, agg, p, to, from) * EXPEDITION_MULT;
        let def = o < 0 ? 0 : contestStrength(s, agg, o, to, to);
        if (p === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];
        if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, p); }
        if (atk > def * CONTEST_THRESH) {
          nextOwner[to] = p;
          if (o === s.playerPolity) s.attacksOnPlayer.set(p, s.tick);
          else if (p === s.playerPolity && o >= 0) s.attacksByPlayer.set(o, s.tick);
        }
      }
    }
  }
  owner.set(nextOwner);

  // --- conquest: a polity whose capital falls is eliminated and annexed ---
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o]) continue;
    const capOwner = owner[s.capitals[o]];
    if (capOwner >= 0 && capOwner !== o) {
      for (let c = 0; c < n; c++) if (owner[c] === o) owner[c] = capOwner;
      s.alive[o] = false; s.polities[o].endedYear = year;
      s.events.push({ year, type: "conquer", text: `${year}년, ${s.polities[capOwner].name}이(가) ${s.polities[o].name}을(를) 정복`, polityId: capOwner, otherId: o, cell: s.capitals[o] });
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
    const names: string[] = [];
    for (let i = 1; i < allCaps.length; i++) {
      const id = s.polities.length;
      const nm = s.nameGen.nation();
      names.push(nm);
      s.polities.push({ id, name: nm, color: HPALETTE[id % HPALETTE.length], capital: allCaps[i], foundedYear: year, endedYear: null, origin: "fragment", free: false });
      s.capitals.push(allCaps[i]); s.alive.push(true); s.golden.push(false);
    }
    for (const c of cells) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < allCaps.length; i++) { const d = dist(s, c, allCaps[i]); if (d < bd) { bd = d; bi = i; } }
      owner[c] = capPolity[bi];
      s.solidarity[c] = CIVILWAR_BIRTH_SOL; // fresh cohesion so successors can stand on their own
    }
    s.events.push({ year, type: "civilwar", text: `${year}년, 내란이 ${s.polities[o].name}을(를) ${names.join("·")}(으)로 쪼갬`, polityId: o, cell: s.capitals[o] });
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
    s.events.push({ year, type: "independence", text: `${year}년, 자유도시 ${name} 독립 선포`, polityId: id, otherId: o, cell: c });
    break;
  }

  // --- golden age: a polity first reaching high cohesion + size ---
  const agg4 = aggregate(s);
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o] || s.golden[o] || s.polities[o].free) continue;
    if (agg4[o].cells >= GOLDEN_MIN_CELLS && agg4[o].avg >= GOLDEN_MIN_ASA) {
      s.golden[o] = true;
      s.events.push({ year, type: "goldenage", text: `${year}년, ${s.polities[o].name} 황금기 도래`, polityId: o, cell: s.capitals[o] });
      break;
    }
  }

  // --- new city: one large, stable polity may found a lore city ---
  for (let o = 0; o < agg4.length; o++) {
    if (!s.alive[o] || s.polities[o].free || agg4[o].cells < 40) continue;
    if (agg4[o].avg < 0.42) continue;
    if (s.rng() > 0.14) continue;
    s.events.push({ year, type: "newCity", text: `${year}년, ${s.polities[o].name}이(가) ${s.nameGen.place()} 건설`, polityId: o, cell: s.capitals[o] });
    break;
  }

  s.snapshots.push({ year, owner: owner.slice() });
  s.tick++;
}
