import { OCEAN } from "./terrain";
import type { SimState } from "./historySim";
import { aggregate, contestStrength, CONQUEST_SOL, AMPHIB_MULT, CONTEST_THRESH, CITY_MIN_GAP, PEACE_TICKS, YEARS_PER_TICK, type Agg } from "./historySim";

export type Action =
  | { type: "attack"; cell: number }
  | { type: "invest"; scope: "nation" | "border" }
  | { type: "foundCity"; cell: number }
  | { type: "peace"; polity: number };
// `message` is the EN fallback; `code` + `data` let the UI render a localised (KO/EN) log line.
export interface InterventionResult { ok: boolean; message: string; code?: string; data?: Record<string, string | number> }
export interface BorderTarget { cell: number; owner: number; ownerName: string; capturable: boolean; sea?: boolean }

export const ATTACK_EDGE = 1.0; // even fight goes to the player (their edge is picking the cell)
export const ATTACK_FOLLOW_MAX = 3; // max extra cells a breakthrough carries beyond the picked cell
export const INVEST_DELTA = 0.15; // invest gain factor: sol += DELTA·(1−sol) — diminishing returns
// so spamming invest on an already-cohesive realm stops being the auto-win button (balance pass)

// a player cell counts as "border" if it touches an enemy/unclaimed LAND cell (a frontier under pressure)
function isBorderCell(s: SimState, cell: number): boolean {
  for (const nb of s.grid.neighbors[cell]) {
    if (s.terrain[nb] === OCEAN) continue;
    if (s.owner[nb] !== s.playerPolity) return true;
  }
  return false;
}

// the player-owned neighbour of `cell` with the highest solidarity — the strongest launching point,
// or -1 if `cell` is not adjacent to the player.
function launchCell(s: SimState, cell: number): number {
  let best = -1, bestSol = -Infinity;
  for (const nb of s.grid.neighbors[cell]) {
    if (s.owner[nb] === s.playerPolity && s.solidarity[nb] > bestSol) { bestSol = s.solidarity[nb]; best = nb; }
  }
  return best;
}

// the strongest player-owned coastal cell that can reach `cell` across a strait, or -1. straitLinks is
// symmetric, so the cells reachable FROM `cell` include the player coast that can launch AT it.
function seaLaunchCell(s: SimState, cell: number): number {
  const links = s.straitLinks?.[cell];
  if (!links) return -1;
  let best = -1, bestSol = -Infinity;
  for (const c of links) {
    if (s.owner[c] === s.playerPolity && s.solidarity[c] > bestSol) { bestSol = s.solidarity[c]; best = c; }
  }
  return best;
}

// enemy land cells adjacent to the player's territory (the attack list)
export function borderTargets(s: SimState): BorderTarget[] {
  if (s.playerPolity < 0) return [];
  const agg = aggregate(s);
  const seen = new Set<number>();
  const out: BorderTarget[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    for (const nb of s.grid.neighbors[c]) {
      if (s.terrain[nb] === OCEAN) continue;
      const o = s.owner[nb];
      if (o < 0 || o === s.playerPolity || seen.has(nb)) continue;
      seen.add(nb);
      const solCell = c; // c is a player neighbour of nb by construction
      const atk = contestStrength(s, agg, s.playerPolity, nb, solCell);
      const def = contestStrength(s, agg, o, nb, nb);
      out.push({ cell: nb, owner: o, ownerName: s.polities[o].name, capturable: atk * ATTACK_EDGE >= def });
    }
  }
  // amphibious targets: enemy coastal cells reachable across a strait, weakened by the sea crossing
  if (s.straitLinks) {
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] !== s.playerPolity) continue;
      for (const nb of s.straitLinks[c]) {
        const o = s.owner[nb];
        if (o < 0 || o === s.playerPolity || seen.has(nb)) continue;
        seen.add(nb);
        const atk = contestStrength(s, agg, s.playerPolity, nb, c) * AMPHIB_MULT;
        const def = contestStrength(s, agg, o, nb, nb);
        out.push({ cell: nb, owner: o, ownerName: s.polities[o].name, capturable: atk * ATTACK_EDGE >= def, sea: true });
      }
    }
  }
  return out;
}

export interface HostileNeighbor { id: number; name: string; trucedUntil: number }

// adjacent non-free enemy polities (over land or strait) — the "sue for peace" list.
// free cities never attack, so peace with them is meaningless.
export function hostileNeighbors(s: SimState): HostileNeighbor[] {
  if (s.playerPolity < 0) return [];
  const ids = new Set<number>();
  for (const t of borderTargets(s)) ids.add(t.owner);
  const out: HostileNeighbor[] = [];
  for (const id of ids) {
    if (s.polities[id].free) continue;
    out.push({ id, name: s.polities[id].name, trucedUntil: s.truces.get(id) ?? 0 });
  }
  return out.sort((a, b) => a.id - b.id);
}

export interface FoundTarget { cell: number; sol: number }

// player-owned land cells far enough from every existing city (world cities + already-founded),
// best (most cohesive) first — the UI shows the head of this list.
export function foundCityTargets(s: SimState): FoundTarget[] {
  if (s.playerPolity < 0) return [];
  const px = (i: number) => s.grid.points[i * 2], py = (i: number) => s.grid.points[i * 2 + 1];
  const sites = [...s.cityCells.map((c) => c.cell), ...s.foundedCities];
  const out: FoundTarget[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    let ok = true;
    for (const sc of sites) {
      if (Math.hypot(px(c) - px(sc), py(c) - py(sc)) < CITY_MIN_GAP) { ok = false; break; }
    }
    if (ok) out.push({ cell: c, sol: s.solidarity[c] });
  }
  return out.sort((a, b) => b.sol - a.sol);
}

// resolves a WON attack in place: flips the target, then the breakthrough — the assault carries
// into adjacent cells of the SAME defender that also lose the same contest (honest low-agency:
// only cells the player could take anyway), capped at 1+ATTACK_FOLLOW_MAX. Returns every captured
// cell, target first. The ONLY writer of attack captures, so the UI's preview cannot drift from it.
function resolveCapture(s: SimState, target: number, def: number, amphib: boolean, agg: Agg[]): number[] {
  s.owner[target] = s.playerPolity;
  s.solidarity[target] = CONQUEST_SOL;
  const cells = [target];
  for (const nb of s.grid.neighbors[target]) {
    if (cells.length >= 1 + ATTACK_FOLLOW_MAX) break;
    if (s.terrain[nb] === OCEAN || s.owner[nb] !== def) continue;
    const fAtk = contestStrength(s, agg, s.playerPolity, nb, target) * (amphib ? AMPHIB_MULT : 1);
    const fDef = contestStrength(s, agg, def, nb, nb);
    if (fAtk * ATTACK_EDGE >= fDef) {
      s.owner[nb] = s.playerPolity;
      s.solidarity[nb] = CONQUEST_SOL;
      cells.push(nb);
    }
  }
  return cells;
}

// what an attack on `cell` would capture RIGHT NOW (empty when it would be repulsed/invalid) —
// the UI's region highlight. Runs the REAL resolution on the live state, then restores every
// touched cell, so the preview is exact by construction.
export function predictCapture(s: SimState, cell: number): number[] {
  if (s.playerPolity < 0) return [];
  const def = s.owner[cell];
  if (def < 0 || def === s.playerPolity) return [];
  const landCell = launchCell(s, cell);
  const amphib = landCell < 0;
  const solCell = amphib ? seaLaunchCell(s, cell) : landCell;
  if (solCell < 0) return [];
  const agg = aggregate(s);
  const atkStr = contestStrength(s, agg, s.playerPolity, cell, solCell) * (amphib ? AMPHIB_MULT : 1);
  if (atkStr * ATTACK_EDGE < contestStrength(s, agg, def, cell, cell)) return [];
  const touched = [cell, ...s.grid.neighbors[cell]];
  const savedOwner = touched.map((c) => s.owner[c]);
  const savedSol = touched.map((c) => s.solidarity[c]);
  const cells = resolveCapture(s, cell, def, amphib, agg);
  touched.forEach((c, i) => { s.owner[c] = savedOwner[i]; s.solidarity[c] = savedSol[i]; });
  return cells;
}

export function applyIntervention(s: SimState, action: Action): InterventionResult {
  if (action.type === "attack") {
    const target = action.cell;
    const def = s.owner[target];
    if (def < 0 || def === s.playerPolity) return { ok: false, message: "Not an enemy cell.", code: "notEnemy" };
    if (s.truces.has(def)) s.truces.delete(def); // aggression voids the truce
    const landCell = launchCell(s, target);
    const amphib = landCell < 0;
    const solCell = amphib ? seaLaunchCell(s, target) : landCell; // fall back to a sea crossing
    if (solCell < 0) return { ok: false, message: "Not reachable from your territory.", code: "unreachable" };
    const agg = aggregate(s);
    const atkStr = contestStrength(s, agg, s.playerPolity, target, solCell) * (amphib ? AMPHIB_MULT : 1);
    const defStr = contestStrength(s, agg, def, target, target);
    const name = s.polities[def].name;
    if (atkStr * ATTACK_EDGE >= defStr) {
      const captured = resolveCapture(s, target, def, amphib, agg).length;
      s.attacksByPlayer.set(def, s.tick); // grudge ledger: the player struck this polity
      const how = amphib ? "Landed on and captured" : "Captured";
      const what = captured > 1 ? `${captured} cells` : "a cell";
      return { ok: true, message: `${how} ${what} from ${name}.`, code: amphib ? "landed" : "captured", data: { name, n: captured } };
    }
    return { ok: false, message: `Attack on ${name} was repulsed.`, code: "repulsed", data: { name } };
  }
  if (action.type === "invest") {
    let n = 0;
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] !== s.playerPolity) continue;
      if (action.scope === "border" && !isBorderCell(s, c)) continue;
      s.solidarity[c] = Math.min(1, s.solidarity[c] + INVEST_DELTA * (1 - s.solidarity[c]));
      n++;
    }
    const where = action.scope === "border" ? "the frontier" : "the realm";
    return { ok: true, message: `Invested in ${where}: cohesion raised on ${n} cells.`, code: "invested", data: { scope: action.scope, n } };
  }
  if (action.type === "foundCity") {
    const cell = action.cell;
    if (!foundCityTargets(s).some((t) => t.cell === cell))
      return { ok: false, message: "Not a viable city site.", code: "badSite" };
    const name = s.nameGen.place();
    s.foundedCities.add(cell);
    const year = s.tick * YEARS_PER_TICK;
    s.events.push({ year, type: "newCity", text: `${year}년, ${s.polities[s.playerPolity].name}이(가) ${name} 건설`, polityId: s.playerPolity, cell });
    return { ok: true, message: `Founded the city of ${name}.`, code: "founded", data: { name } };
  }
  if (action.type === "peace") {
    const p = action.polity;
    if (!hostileNeighbors(s).some((h) => h.id === p))
      return { ok: false, message: "Not a hostile neighbour.", code: "notHostile" };
    s.truces.set(p, s.tick + PEACE_TICKS);
    const name = s.polities[p].name;
    const years = PEACE_TICKS * YEARS_PER_TICK;
    return { ok: true, message: `Made peace with ${name} for ${years} years.`, code: "peaceMade", data: { name, years } };
  }
  return { ok: false, message: "Unknown action." };
}

export type FrontKind = "push" | "threat";
export interface FrontEdge { cell: number; enemy: number; kind: FrontKind }

// classify each player-vs-enemy LAND border edge: "threat" if the enemy could take the player's cell
// (the sim's own contest rule), else "push" if the player could take the enemy cell (the dropdown's
// rule). Threat wins when both apply. Pure read of state — never called on the pure-history path.
export function frontEdges(s: SimState): FrontEdge[] {
  if (s.playerPolity < 0) return [];
  const agg = aggregate(s);
  const out: FrontEdge[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    const myDef = contestStrength(s, agg, s.playerPolity, c, c);
    for (const nb of s.grid.neighbors[c]) {
      if (s.terrain[nb] === OCEAN) continue;
      const e = s.owner[nb];
      if (e < 0 || e === s.playerPolity) continue;
      const enemyAtk = contestStrength(s, agg, e, c, nb);
      if (enemyAtk > myDef * CONTEST_THRESH) { out.push({ cell: c, enemy: nb, kind: "threat" }); continue; }
      const myAtk = contestStrength(s, agg, s.playerPolity, nb, c);
      const enemyDef = contestStrength(s, agg, e, nb, nb);
      if (myAtk * ATTACK_EDGE >= enemyDef) out.push({ cell: c, enemy: nb, kind: "push" });
    }
  }
  return out;
}
