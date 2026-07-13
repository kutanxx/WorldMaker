import type { SimState } from "./historySim";
import { aggregate, GRUDGE_TICKS } from "./historySim";
import { frontEdges, hostileNeighbors } from "./intervention";

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
  for (const e of frontEdges(s)) borderSet.add(s.owner[e.enemy]);

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

// --- neighbor attitudes -----------------------------------------------------------------
// Honest 3-state diplomacy readability (TW/Paradox: attitude + itemized reasons). Each state
// maps to a REAL behavioral guarantee — friendly = truce active (stepSim skips their attacks
// on the player), hostile = they win border contests (bigger) or are the flagged crisis foe or hold a fresh grudge the player caused (stepSim retaliates at REVENGE_MULT),
// wary = everything else. The Civ-agendas lesson: never display what the sim doesn't back.
export type Attitude = "friendly" | "wary" | "hostile";
export const ATT_HOSTILE_RATIO = 1.15; // their cells / ours at/above this ⇒ hostile
export { GRUDGE_TICKS }; // single source with the sim (imported above) — the chip stops saying 원한 exactly when the sim stops acting on it

export interface NeighborAttitude {
  id: number; name: string;
  att: Attitude;
  ratio: number;        // their cells / player cells
  borderEdges: number;  // shared front edges (threat + push)
  truceLeft: number;    // ticks remaining, 0 if none
  hegemon: boolean;     // the crisis arc's flagged foe
  attackedMeAgo: number | null; // ticks since it last took player cells, null if never/expired
  iAttackedAgo: number | null;  // ticks since the player last took its cells (backed by REVENGE_MULT retaliation)
}

export function neighborAttitudes(s: SimState): NeighborAttitude[] {
  if (s.playerPolity < 0) return [];
  const agg = aggregate(s);
  const mine = agg[s.playerPolity]?.cells ?? 0;
  const edgeCount = new Map<number, number>();
  for (const e of frontEdges(s)) {
    const p = s.owner[e.enemy]; // FrontEdge.enemy is a CELL index — owner[] maps it
    if (p >= 0) edgeCount.set(p, (edgeCount.get(p) ?? 0) + 1);
  }
  let hegemonId = -1;
  for (const f of s.dilemmaFlags) if (f.startsWith("hegemonFoe:")) hegemonId = Number(f.slice(11));
  const out: NeighborAttitude[] = [];
  for (const h of hostileNeighbors(s)) {
    const ratio = mine > 0 ? (agg[h.id]?.cells ?? 0) / mine : 0;
    const truceLeft = Math.max(0, h.trucedUntil - s.tick);
    const hegemon = h.id === hegemonId;
    const ago = (m: Map<number, number>): number | null => {
      const t = m.get(h.id);
      return t !== undefined && s.tick - t < GRUDGE_TICKS ? s.tick - t : null;
    };
    const attackedMeAgo = ago(s.attacksOnPlayer);
    const iAttackedAgo = ago(s.attacksByPlayer);
    const att: Attitude = truceLeft > 0 ? "friendly"
      : ratio >= ATT_HOSTILE_RATIO || hegemon || attackedMeAgo !== null || iAttackedAgo !== null ? "hostile" : "wary";
    out.push({ id: h.id, name: h.name, att, ratio, borderEdges: edgeCount.get(h.id) ?? 0, truceLeft, hegemon, attackedMeAgo, iAttackedAgo });
  }
  return out.sort((a, b) => b.borderEdges - a.borderEdges);
}

// average solidarity on each side of the player's front — the dominant LOCAL term of the
// contest math, surfaced so "invest → win borders → gain land" is visible every turn. An honest
// approximation: avg-asabiyya and size also weigh in (the UI labels it as such).
export interface BorderReport { mine: number; theirs: number }
export function borderReport(s: SimState): BorderReport | null {
  if (s.playerPolity < 0) return null;
  const seenMine = new Set<number>(), seenTheirs = new Set<number>();
  let mySum = 0, foeSum = 0;
  for (const e of frontEdges(s)) {
    if (!seenMine.has(e.cell)) { seenMine.add(e.cell); mySum += s.solidarity[e.cell]; }
    if (!seenTheirs.has(e.enemy)) { seenTheirs.add(e.enemy); foeSum += s.solidarity[e.enemy]; }
  }
  if (seenMine.size === 0 || seenTheirs.size === 0) return null;
  return { mine: mySum / seenMine.size, theirs: foeSum / seenTheirs.size };
}
