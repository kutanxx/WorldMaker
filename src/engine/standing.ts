import type { SimState } from "./historySim";
import { aggregate } from "./historySim";
import { frontEdges } from "./intervention";

// tuning knobs for the "how am I doing" readout (UI layer — NOT engine goldens)
export const STRENGTH_STRONG = 1.15; // cells / rivalAvg at/above this => "우세"
export const STRENGTH_WEAK = 0.7;    // cells / rivalAvg at/below this => "열세"
export const COHESION_STABLE = 0.55; // avg solidarity at/above this => "안정"
export const COHESION_DANGER = 0.4;  // below this => "위험" (civil-war cue), between => "불안"

export interface Standing {
  cells: number;
  rivalAvgCells: number;
  strength: "strong" | "even" | "weak";
  cohesion: number;
  cohesionState: "stable" | "shaky" | "danger";
  borderPolities: number;
  truceCount: number;
}

// Instantaneous, read-only snapshot of the player's standing. Never mutates s.
export function computeStanding(s: SimState, opts: { neighborsOnly?: boolean } = {}): Standing {
  const agg = aggregate(s);
  const me = s.playerPolity;
  const cells = agg[me]?.cells ?? 0;
  const cohesion = agg[me]?.avg ?? 0;

  // distinct rival polities touching the player's front line
  const borderSet = new Set<number>();
  for (const e of frontEdges(s)) borderSet.add(e.enemy);

  // rival average cells: whole living field by default; bordering rivals only if requested
  let sum = 0, cnt = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (o === me || !s.alive[o]) continue;
    if (opts.neighborsOnly && !borderSet.has(o)) continue;
    sum += agg[o].cells; cnt++;
  }
  const rivalAvgCells = cnt > 0 ? sum / cnt : 0;

  const ratio = rivalAvgCells > 0 ? cells / rivalAvgCells : Infinity;
  const strength = ratio >= STRENGTH_STRONG ? "strong" : ratio <= STRENGTH_WEAK ? "weak" : "even";

  const cohesionState =
    cohesion >= COHESION_STABLE ? "stable" : cohesion >= COHESION_DANGER ? "shaky" : "danger";

  let truceCount = 0;
  for (const until of s.truces.values()) if (until > s.tick) truceCount++;

  return { cells, rivalAvgCells, strength, cohesion, cohesionState, borderPolities: borderSet.size, truceCount };
}
