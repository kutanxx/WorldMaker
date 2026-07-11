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
export const WARWEARY_MIN_THREATS = 4, WARWEARY_MAX_ASA = 0.5, WARWEARY_PROB = 0.4;
export const WARWEARY_LEVY_SOL = 0.1, WARWEARY_LEVY_INTERIOR_SOL = 0.03, WARWEARY_TERMS_SOL = 0.03, WARWEARY_TRUCE_TICKS = 2;
export const BOOMTOWN_PROB = 0.25, BOOMTOWN_CHARTER_SOL = 0.04, BOOMTOWN_WALL_SOL = 0.15;
export const PROPHECY_PROB = 0.15, PROPHECY_ASA = 0.5, PROPHECY_COST_SOL = 0.03, PROPHECY_BOON_SOL = 0.08, PROPHECY_BUST_SOL = 0.05;

export type DilemmaCode = "unrest" | "raiders" | "warweary" | "boomtown" | "prosperity" | "defector" | "prophecy1" | "prophecy2";
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
// the polity throwing the most threat edges at the player. NOTE: FrontEdge.enemy is a CELL
// index, not a polity id — s.owner[] maps it. Shared by resolve and preview (anti-drift).
function biggestThreatFoe(s: SimState): number {
  const counts = new Map<number, number>();
  for (const e of frontEdges(s)) {
    if (e.kind !== "threat") continue;
    const p = s.owner[e.enemy];
    if (p >= 0) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best = -1, bestN = 0;
  for (const [p, n] of counts) if (n > bestN) { best = p; bestN = n; }
  return best;
}
// the founded city cell + its player-owned neighbors (the wall's reach) — shared with preview
function cityWallCells(s: SimState, city: number): number[] {
  const cells = s.owner[city] === s.playerPolity ? [city] : [];
  for (const nb of s.grid.neighbors[city]) if (s.owner[nb] === s.playerPolity) cells.push(nb);
  return cells;
}

// at most one dilemma per call; sets the cooldown when one fires. Priority: crisis first.
export function offerDilemma(s: SimState): Dilemma | null {
  if (s.playerPolity < 0) return null;
  if (s.tick - s.lastDilemma < DILEMMA_COOLDOWN) return null;
  const agg = aggregate(s);
  const mine = agg[s.playerPolity];
  if (!mine || mine.cells === 0) return null;

  // chain follow-up: a sponsored prophecy is judged at the next window, guaranteed
  if (s.dilemmaFlags.has("prophecySponsored")) {
    s.lastDilemma = s.tick;
    return { code: "prophecy2", data: {} };
  }

  if (mine.cells >= UNREST_MIN_CELLS && mine.avg < UNREST_MAX_ASA && s.rng() < UNREST_PROB) {
    s.lastDilemma = s.tick;
    return { code: "unrest", data: {} };
  }
  const threats = frontEdges(s).filter((e) => e.kind === "threat").length;
  if (threats >= RAIDERS_MIN_THREATS && s.rng() < RAIDERS_PROB) {
    s.lastDilemma = s.tick;
    return { code: "raiders", data: { threats } };
  }
  if (threats >= WARWEARY_MIN_THREATS && mine.avg < WARWEARY_MAX_ASA && s.rng() < WARWEARY_PROB) {
    s.lastDilemma = s.tick;
    return { code: "warweary", data: { threats } };
  }
  // boomtown: the strongest founded city still in the player's hands
  let bestCity = -1;
  for (const fc of s.foundedCities) {
    if (s.owner[fc] !== s.playerPolity) continue;
    if (bestCity < 0 || s.solidarity[fc] > s.solidarity[bestCity]) bestCity = fc;
  }
  if (bestCity >= 0 && s.rng() < BOOMTOWN_PROB) {
    s.lastDilemma = s.tick;
    return { code: "boomtown", data: { cell: bestCity } };
  }
  // defector: the most cohesive enemy border cell asks to change sides
  const targets = borderTargets(s).filter((t) => !t.sea && !s.polities[t.owner].free);
  if (targets.length && s.rng() < DEFECTOR_PROB) {
    let best = targets[0];
    for (const t of targets) if (s.solidarity[t.cell] > s.solidarity[best.cell]) best = t;
    s.lastDilemma = s.tick;
    return { code: "defector", data: { cell: best.cell, polity: best.owner, name: best.ownerName } };
  }
  if (!s.dilemmaFlags.has("prophecyDone") && s.rng() < PROPHECY_PROB) {
    s.lastDilemma = s.tick;
    return { code: "prophecy1", data: {} };
  }
  if (mine.avg >= PROSPERITY_MIN_ASA && s.rng() < PROSPERITY_PROB) {
    s.lastDilemma = s.tick;
    return { code: "prosperity", data: {} };
  }
  return null;
}

// the border cells the concede choice would shed, worst cohesion first — shared by
// resolveDilemma and previewDilemma so the preview cannot drift from the real effect
function concedeCells(s: SimState): number[] {
  const border: number[] = [];
  for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity && isBorder(s, c)) border.push(c);
  border.sort((x, y) => s.solidarity[x] - s.solidarity[y]);
  return border.slice(0, CONCEDE_MAX_CELLS);
}

// the punitive raid's target: the capturable border cell with the biggest breakthrough.
// Exported: the play UI's advisor uses the same pick for "a good moment to expand".
export function bestRaidTarget(s: SimState): { cell: number; gain: number } | null {
  let best: { cell: number; gain: number } | null = null;
  for (const t of borderTargets(s)) {
    if (!t.capturable) continue;
    const gain = predictCapture(s, t.cell).length;
    if (!best || gain > best.gain) best = { cell: t.cell, gain };
  }
  return best;
}

// what a choice would do, as glyph-able data — read-only, and NEVER draws from s.rng
// (gambles report `odds`; the roll happens only in resolveDilemma)
export interface ChoicePreview {
  cells?: number;               // signed projected cell delta
  cohesion?: -2 | -1 | 1 | 2;   // direction weight (▼▼ ▼ ▲ ▲▲)
  odds?: number;                // when set: the whole effect with this probability, reversed otherwise
  truce?: "break" | "gain";
  note?: "fortify" | "noTarget" | "noEffect" | "citywall" | "prophecyDeal" | "prophecyCond";
  pct?: number;                 // live value for prophecyCond (current cohesion %)
}
export function previewDilemma(s: SimState, d: Dilemma, choice: "a" | "b"): ChoicePreview {
  if (d.code === "unrest") {
    return choice === "a" ? { cells: -concedeCells(s).length, cohesion: 1 }
      : { cohesion: 1, odds: CRUSH_ODDS };
  }
  if (d.code === "raiders") {
    if (choice === "a") return { note: "fortify" };
    const best = bestRaidTarget(s);
    return best ? { cells: best.gain } : { note: "noTarget" };
  }
  if (d.code === "warweary") {
    if (choice === "a") return { note: "fortify" };
    return biggestThreatFoe(s) >= 0 ? { cohesion: -1, truce: "gain" } : { note: "noTarget" };
  }
  if (d.code === "boomtown") return choice === "a" ? { cohesion: 1 } : { note: "citywall" };
  if (d.code === "prosperity") return choice === "a" ? { cohesion: 1 } : { cohesion: 2 };
  if (d.code === "prophecy1") return choice === "a" ? { cohesion: -1, note: "prophecyDeal" } : { note: "noEffect" };
  if (d.code === "prophecy2") {
    if (choice === "b") return { note: "noEffect" };
    const pct = Math.round((aggregate(s)[s.playerPolity]?.avg ?? 0) * 100);
    return { note: "prophecyCond", pct };
  }
  return choice === "a" ? { cells: 1, truce: "break" } : { truce: "gain" }; // defector
}

export function resolveDilemma(s: SimState, d: Dilemma, choice: "a" | "b"): DilemmaOutcome {
  if (d.code === "unrest") {
    if (choice === "a") {
      // concede: shed the lowest-cohesion border cells to no-man's-land, realm breathes again
      const shed = concedeCells(s);
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
    const best = bestRaidTarget(s);
    if (!best) return { code: "raidersNoTarget", data: {} };
    const r = applyIntervention(s, { type: "attack", cell: best.cell });
    if (!r.ok) return { code: "raidersNoTarget", data: {} };
    return { code: "raidersRaid", data: { name: String(r.data?.name ?? ""), n: Number(r.data?.n ?? 1) } };
  }
  if (d.code === "warweary") {
    if (choice === "a") {
      const n = nudgePlayerSol(s, WARWEARY_LEVY_SOL, "border");
      nudgePlayerSol(s, -WARWEARY_LEVY_INTERIOR_SOL, "interior");
      return { code: "warwearyLevy", data: { n } };
    }
    const foe = biggestThreatFoe(s);
    if (foe < 0) return { code: "warwearyNoFoe", data: {} };
    s.truces.set(foe, s.tick + WARWEARY_TRUCE_TICKS);
    nudgePlayerSol(s, -WARWEARY_TERMS_SOL, "nation");
    return { code: "warwearyTerms", data: { name: s.polities[foe].name } };
  }
  if (d.code === "boomtown") {
    if (choice === "a") {
      nudgePlayerSol(s, BOOMTOWN_CHARTER_SOL, "nation");
      return { code: "boomtownCharter", data: {} };
    }
    const cells = cityWallCells(s, Number(d.data.cell));
    for (const c of cells) s.solidarity[c] = Math.min(1, s.solidarity[c] + BOOMTOWN_WALL_SOL);
    return { code: "boomtownWall", data: { n: cells.length } };
  }
  if (d.code === "prosperity") {
    if (choice === "a") { nudgePlayerSol(s, FEAST_SOL, "nation"); return { code: "prosperityFeast", data: {} }; }
    const n = nudgePlayerSol(s, FRONTIER_SOL, "border");
    return { code: "prosperityFrontier", data: { n } };
  }
  if (d.code === "prophecy1") {
    if (choice === "a") {
      nudgePlayerSol(s, -PROPHECY_COST_SOL, "nation");
      s.dilemmaFlags.add("prophecySponsored");
      return { code: "prophecySponsor", data: {} };
    }
    s.dilemmaFlags.add("prophecyDone");
    return { code: "prophecyIgnore", data: {} };
  }
  if (d.code === "prophecy2") {
    s.dilemmaFlags.delete("prophecySponsored");
    s.dilemmaFlags.add("prophecyDone");
    if (choice === "b") return { code: "prophecyBuried", data: {} };
    const avg = aggregate(s)[s.playerPolity]?.avg ?? 0;
    if (avg >= PROPHECY_ASA) {
      nudgePlayerSol(s, PROPHECY_BOON_SOL, "nation");
      return { code: "prophecyFulfilled", data: {} };
    }
    nudgePlayerSol(s, -PROPHECY_BUST_SOL, "nation");
    return { code: "prophecyDebunked", data: {} };
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
