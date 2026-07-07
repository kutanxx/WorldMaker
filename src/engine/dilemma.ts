// Reigns-style dilemmas — condition-triggered two-choice events aimed AT the player, so a 50-turn
// reign asks varied questions instead of repeating the same four verbs. Free (separate from the
// one action/turn); effects use only existing mechanics (solidarity/owner/truces). NEVER runs on
// the pure-history path: offerDilemma is only called by the play UI and no-ops for playerPolity<0,
// so the golden hashes are untouched. Draws come from s.rng — fine in a game, which already
// diverges from pure history the moment the player exists.
import { OCEAN } from "./terrain";
import type { SimState } from "./historySim";
import { aggregate, CONQUEST_SOL } from "./historySim";
import { borderTargets, frontEdges, predictCapture, applyIntervention } from "./intervention";

export const DILEMMA_COOLDOWN = 3; // min ticks between offers (ignoring one also cools down)
const UNREST_MAX_ASA = 0.42, UNREST_MIN_CELLS = 60, UNREST_PROB = 0.5;
const RAIDERS_MIN_THREATS = 6, RAIDERS_PROB = 0.4;
const DEFECTOR_PROB = 0.2;
const PROSPERITY_MIN_ASA = 0.55, PROSPERITY_PROB = 0.3;
const CONCEDE_MAX_CELLS = 5, CONCEDE_SOL = 0.08;
const CRUSH_OK_SOL = 0.06, CRUSH_FAIL_SOL = 0.06, CRUSH_ODDS = 0.5;
const FORTIFY_BORDER_SOL = 0.1, FORTIFY_INTERIOR_SOL = 0.02;
const FEAST_SOL = 0.04, FRONTIER_SOL = 0.09;
const RETURN_TRUCE_TICKS = 1; // returning a defector buys a 10-year non-aggression

export type DilemmaCode = "unrest" | "raiders" | "prosperity" | "defector";
export interface Dilemma { code: DilemmaCode; data: Record<string, string | number> }
export interface DilemmaOutcome { code: string; data: Record<string, string | number> }

function isBorder(s: SimState, c: number): boolean {
  for (const nb of s.grid.neighbors[c]) {
    if (s.terrain[nb] !== OCEAN && s.owner[nb] !== s.playerPolity) return true;
  }
  return false;
}
function nudgePlayerSol(s: SimState, delta: number, where: "nation" | "border" | "interior"): number {
  let n = 0;
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    if (where !== "nation" && isBorder(s, c) !== (where === "border")) continue;
    s.solidarity[c] = Math.max(0, Math.min(1, s.solidarity[c] + delta));
    n++;
  }
  return n;
}

// at most one dilemma per call; sets the cooldown when one fires. Priority: crisis first.
export function offerDilemma(s: SimState): Dilemma | null {
  if (s.playerPolity < 0) return null;
  if (s.tick - s.lastDilemma < DILEMMA_COOLDOWN) return null;
  const agg = aggregate(s);
  const mine = agg[s.playerPolity];
  if (!mine || mine.cells === 0) return null;

  if (mine.cells >= UNREST_MIN_CELLS && mine.avg < UNREST_MAX_ASA && s.rng() < UNREST_PROB) {
    s.lastDilemma = s.tick;
    return { code: "unrest", data: {} };
  }
  const threats = frontEdges(s).filter((e) => e.kind === "threat").length;
  if (threats >= RAIDERS_MIN_THREATS && s.rng() < RAIDERS_PROB) {
    s.lastDilemma = s.tick;
    return { code: "raiders", data: { threats } };
  }
  // defector: the most cohesive enemy border cell asks to change sides
  const targets = borderTargets(s).filter((t) => !t.sea && !s.polities[t.owner].free);
  if (targets.length && s.rng() < DEFECTOR_PROB) {
    let best = targets[0];
    for (const t of targets) if (s.solidarity[t.cell] > s.solidarity[best.cell]) best = t;
    s.lastDilemma = s.tick;
    return { code: "defector", data: { cell: best.cell, polity: best.owner, name: best.ownerName } };
  }
  if (mine.avg >= PROSPERITY_MIN_ASA && s.rng() < PROSPERITY_PROB) {
    s.lastDilemma = s.tick;
    return { code: "prosperity", data: {} };
  }
  return null;
}

export function resolveDilemma(s: SimState, d: Dilemma, choice: "a" | "b"): DilemmaOutcome {
  if (d.code === "unrest") {
    if (choice === "a") {
      // concede: shed the lowest-cohesion border cells to no-man's-land, realm breathes again
      const border: number[] = [];
      for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity && isBorder(s, c)) border.push(c);
      border.sort((x, y) => s.solidarity[x] - s.solidarity[y]);
      const shed = border.slice(0, CONCEDE_MAX_CELLS);
      for (const c of shed) { s.owner[c] = -1; s.solidarity[c] = 0; }
      nudgePlayerSol(s, CONCEDE_SOL, "nation");
      return { code: "unrestConcede", data: { n: shed.length } };
    }
    if (s.rng() < CRUSH_ODDS) {
      nudgePlayerSol(s, CRUSH_OK_SOL, "nation");
      return { code: "unrestCrushOk", data: {} };
    }
    nudgePlayerSol(s, -CRUSH_FAIL_SOL, "nation");
    return { code: "unrestCrushFail", data: {} };
  }
  if (d.code === "raiders") {
    if (choice === "a") {
      const n = nudgePlayerSol(s, FORTIFY_BORDER_SOL, "border");
      nudgePlayerSol(s, -FORTIFY_INTERIOR_SOL, "interior");
      return { code: "raidersFortify", data: { n } };
    }
    // punitive raid: a free strike at the best capturable target (reuses the real attack rules)
    let best: { cell: number; gain: number } | null = null;
    for (const t of borderTargets(s)) {
      if (!t.capturable) continue;
      const gain = predictCapture(s, t.cell).length;
      if (!best || gain > best.gain) best = { cell: t.cell, gain };
    }
    if (!best) return { code: "raidersNoTarget", data: {} };
    const r = applyIntervention(s, { type: "attack", cell: best.cell });
    if (!r.ok) return { code: "raidersNoTarget", data: {} };
    return { code: "raidersRaid", data: { name: String(r.data?.name ?? ""), n: Number(r.data?.n ?? 1) } };
  }
  if (d.code === "prosperity") {
    if (choice === "a") { nudgePlayerSol(s, FEAST_SOL, "nation"); return { code: "prosperityFeast", data: {} }; }
    const n = nudgePlayerSol(s, FRONTIER_SOL, "border");
    return { code: "prosperityFrontier", data: { n } };
  }
  // defector
  const cell = Number(d.data.cell), polity = Number(d.data.polity), name = String(d.data.name ?? "");
  if (choice === "a") {
    if (s.owner[cell] === polity) { s.owner[cell] = s.playerPolity; s.solidarity[cell] = CONQUEST_SOL; }
    s.truces.delete(polity); // harbouring their lord sours relations
    return { code: "defectorAccept", data: { name } };
  }
  s.truces.set(polity, s.tick + RETURN_TRUCE_TICKS);
  return { code: "defectorReturn", data: { name } };
}
