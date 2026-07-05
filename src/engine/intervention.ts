import { OCEAN } from "./terrain";
import type { SimState } from "./historySim";
import { aggregate, contestStrength, CONQUEST_SOL } from "./historySim";

export type Action = { type: "attack"; cell: number };
export interface InterventionResult { ok: boolean; message: string }
export interface BorderTarget { cell: number; owner: number; ownerName: string; capturable: boolean }

export const ATTACK_EDGE = 1.0; // even fight goes to the player (their edge is picking the cell)

// the player-owned neighbour of `cell` with the highest solidarity — the strongest launching point,
// or -1 if `cell` is not adjacent to the player.
function launchCell(s: SimState, cell: number): number {
  let best = -1, bestSol = -Infinity;
  for (const nb of s.grid.neighbors[cell]) {
    if (s.owner[nb] === s.playerPolity && s.solidarity[nb] > bestSol) { bestSol = s.solidarity[nb]; best = nb; }
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
  return out;
}

export function applyIntervention(s: SimState, action: Action): InterventionResult {
  if (action.type === "attack") {
    const target = action.cell;
    const def = s.owner[target];
    if (def < 0 || def === s.playerPolity) return { ok: false, message: "Not an enemy cell." };
    const solCell = launchCell(s, target);
    if (solCell < 0) return { ok: false, message: "Not on your border." };
    const agg = aggregate(s);
    const atkStr = contestStrength(s, agg, s.playerPolity, target, solCell);
    const defStr = contestStrength(s, agg, def, target, target);
    if (atkStr * ATTACK_EDGE >= defStr) {
      s.owner[target] = s.playerPolity;
      s.solidarity[target] = CONQUEST_SOL;
      return { ok: true, message: `Captured a cell from ${s.polities[def].name}.` };
    }
    return { ok: false, message: `Attack on ${s.polities[def].name} was repulsed.` };
  }
  return { ok: false, message: "Unknown action." };
}
