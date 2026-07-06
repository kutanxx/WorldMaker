import { OCEAN } from "./terrain";
import type { SimState } from "./historySim";
import { aggregate, contestStrength, CONQUEST_SOL, AMPHIB_MULT, CONTEST_THRESH } from "./historySim";

export type Action =
  | { type: "attack"; cell: number }
  | { type: "invest"; scope: "nation" | "border" };
// `message` is the EN fallback; `code` + `data` let the UI render a localised (KO/EN) log line.
export interface InterventionResult { ok: boolean; message: string; code?: string; data?: Record<string, string | number> }
export interface BorderTarget { cell: number; owner: number; ownerName: string; capturable: boolean; sea?: boolean }

export const ATTACK_EDGE = 1.0; // even fight goes to the player (their edge is picking the cell)
export const ATTACK_FOLLOW_MAX = 3; // max extra cells a breakthrough carries beyond the picked cell
export const INVEST_DELTA = 0.15; // one-time cohesion boost from an invest action (then decays normally)

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

export function applyIntervention(s: SimState, action: Action): InterventionResult {
  if (action.type === "attack") {
    const target = action.cell;
    const def = s.owner[target];
    if (def < 0 || def === s.playerPolity) return { ok: false, message: "Not an enemy cell.", code: "notEnemy" };
    const landCell = launchCell(s, target);
    const amphib = landCell < 0;
    const solCell = amphib ? seaLaunchCell(s, target) : landCell; // fall back to a sea crossing
    if (solCell < 0) return { ok: false, message: "Not reachable from your territory.", code: "unreachable" };
    const agg = aggregate(s);
    const atkStr = contestStrength(s, agg, s.playerPolity, target, solCell) * (amphib ? AMPHIB_MULT : 1);
    const defStr = contestStrength(s, agg, def, target, target);
    const name = s.polities[def].name;
    if (atkStr * ATTACK_EDGE >= defStr) {
      s.owner[target] = s.playerPolity;
      s.solidarity[target] = CONQUEST_SOL;
      // breakthrough: the assault carries into adjacent cells of the SAME defender that also lose
      // the same contest (honest low-agency: only cells the player could take anyway) — a
      // well-picked attack reads as a real offensive instead of a single-cell nibble.
      let captured = 1;
      for (const nb of s.grid.neighbors[target]) {
        if (captured >= 1 + ATTACK_FOLLOW_MAX) break;
        if (s.terrain[nb] === OCEAN || s.owner[nb] !== def) continue;
        const fAtk = contestStrength(s, agg, s.playerPolity, nb, target) * (amphib ? AMPHIB_MULT : 1);
        const fDef = contestStrength(s, agg, def, nb, nb);
        if (fAtk * ATTACK_EDGE >= fDef) {
          s.owner[nb] = s.playerPolity;
          s.solidarity[nb] = CONQUEST_SOL;
          captured++;
        }
      }
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
      s.solidarity[c] = Math.min(1, s.solidarity[c] + INVEST_DELTA);
      n++;
    }
    const where = action.scope === "border" ? "the frontier" : "the realm";
    return { ok: true, message: `Invested in ${where}: cohesion raised on ${n} cells.`, code: "invested", data: { scope: action.scope, n } };
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
