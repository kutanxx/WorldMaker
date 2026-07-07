# Standing Panel — "지금 잘하고 있나" feedback (Version B play-mode)

**Date:** 2026-07-07
**Status:** Design approved, ready for plan
**Scope:** Version B (`play.html` / `src/ui/playApp.ts`) only. Play-UI + read-only over `SimState`. No world/history/tuning-const changes → golden hashes byte-identical.

## Problem

The user can play but cannot *feel* balance or difficulty: "밸런스와 난이도 감각이 잘 안 잡힌다." The game shows the map, cohesion, dilemmas, and a log, but nothing answers **"am I winning or losing, and is it getting better or worse?"** So no amount of play builds intuition, and a genuine feel-pass/tunable-sweep is blocked.

## Research grounding

- **Reigns (our direct genre — dilemmas are Reigns-style):** balance legibility comes NOT from a leaderboard but from ① always-visible meters that must stay in a healthy zone and ② previewing what a choice will do *before* committing (the "dots"). We already have one such meter (cohesion) and half of the preview system (action previews).
- **Civ demographics / mobile-4X "Power Velocity":** relative standing (rank / rate vs cohort) is the canonical "how am I doing" tool. We fold in the *relative* half without a full leaderboard.
- **Difficulty is *felt* through the cue→reaction→feedback loop and forward-momentum signals**, not static labels.

**Rejected framings (self-feedback):** a 4X leaderboard rank pushes a "be #1" fantasy that fights this game's single-ruler survival/reign identity (it has a reign chronicle). We keep the survival frame and absorb relative standing as a *calibration*, not a rank.

## Design

A compact **판세(Standing) panel** in the play sidebar. Four parts:

### ① Two health meters (Reigns-style, safe-zone framed, orthogonal)

- **국력 = territory (cell count).** A bar whose safe zone is calibrated **relative to the average cells of bordering living neighbors** (fallback: all living polities if the player has no land border). States: **우세 / 균형 / 열세** (green / amber / red). This answers "am I keeping pace" without a leaderboard.
- **결속 = average solidarity.** Reuse the existing 안정/불안/위험 thresholds (`>=0.55` / `>=LOW_COHESION` / below), rendered as a *peer* meter next to 국력.

Rationale for territory (not the engine's `power = cells×avg`): `power` re-mixes cohesion, so it would double-count cohesion across the two meters and move both on any cohesion change. Territory is the orthogonal axis ("how big" vs "how solid") and is directly visible on the map, giving the tightest cue→feedback loop.

### ② Momentum row (turn-over-turn Δ)

`국력 ▲+3셀   결속 ▼불안` — change since last turn. Makes forward/backward motion visible (the difficulty-*felt* signal). Computed in the UI by diffing against the previous turn's standing snapshot.

### ③ Threat line (one line)

`국경 접촉 3세력 · 이번 턴 2셀 상실 · 휴전 1` — from:
- **bordering enemy polities** (distinct polities across `frontEdges`/`borderTargets`),
- **cells lost this turn** (count `conquer` events in the turn's event slice where `otherId === playerPolity`),
- **active truces** (`s.truces` entries still in the future).

### ④ Preview extension — project onto the two meters (the Reigns "dots")

When the player focuses/selects an **action** or a **dilemma choice**, show its projected effect on the two meters *before commit*:
- attack → `국력 ▲` (from `predictCapture` cell count) ; invest → `결속 ▲` (from `investEffect`) ; foundCity → `국력 ▲(+1)` ; peace → threat ▼.
- dilemma choices → map each choice's existing effect to `국력`/`결속` direction glyphs. **This folds in backlog item "dilemma card map-previews."**

## Architecture

**New pure helper `src/engine/standing.ts`** — instantaneous, read-only over `SimState`:

```ts
export interface Standing {
  cells: number;
  neighborAvgCells: number;      // avg cells of bordering living neighbors (fallback: all living)
  strength: "strong" | "even" | "weak";   // cells vs neighborAvgCells thresholds
  cohesion: number;              // player avg solidarity (0..1)
  cohesionState: "stable" | "shaky" | "danger";
  borderPolities: number;        // distinct enemy polities on the land/strait border
  truceCount: number;            // active truces (tick < value)
}
export function computeStanding(s: SimState): Standing;
```

Tuning consts (UI/standing layer, NOT engine goldens): `STRENGTH_STRONG = 1.15`, `STRENGTH_WEAK = 0.7` (cells / neighborAvg ratio); cohesion thresholds reuse existing `0.55` / `LOW_COHESION`.

**UI layer (`src/ui/playApp.ts`):**
- Keep `prevStanding` (Standing snapshot from the previous turn) to render the ② momentum arrows; store cells/cohesion each turn.
- Count ③ "cells lost this turn" from the `TurnResult.events` slice (`conquer` with `otherId === playerPolity`) — turn context lives in the UI, not the pure helper.
- Replace the current single-line panel text (`renderPanel`) with the meters + momentum + threat layout. Reuse `aggregate`, `frontEdges`/`borderTargets`, `playerCells`, `LOW_COHESION`.
- ④ preview: reuse `investEffect`, `predictCapture`, and dilemma effect data to annotate choices.

**Styling:** two small meter bars + one momentum row + one threat line. Compact — NOT a dashboard. New CSS classes in the play stylesheet (`.standing`, `.meter`, `.meter-strength`, `.meter-cohesion`, `.momentum`, `.threat-line`).

**i18n:** all new strings via the existing `playT(lang, key)` table (KO/EN), matching the current play-UI convention.

## Data flow

`playTurn` (unchanged) → UI calls `computeStanding(s)` → diff vs `prevStanding` for momentum → count lost cells from the turn's events → render meters/momentum/threat → store as next `prevStanding`. Previews call the existing effect functions on focus/select and render meter-direction glyphs.

## Error / edge handling

- **Dead player** (`!s.alive[player]`): keep the existing fallen banner; skip the standing panel.
- **No neighbors / isolated** (island start, or all neighbors are own/dead): `neighborAvgCells` falls back to the average of all living *other* polities; if none, strength = "even".
- **Turn 1** (no `prevStanding`): momentum row shows "—" (no delta), not fake zeros.
- **neighborAvgCells === 0**: guard the ratio (treat as "strong").

## Testing

- `src/engine/standing.test.ts` (pure): strength thresholds (strong/even/weak around 1.15/0.7), cohesion states, border-polity counting, truce counting, isolated fallback, zero-neighbor guard. Full-size `DEFAULT_PARAMS` world where cell-count minimums matter (per the known test-world gotcha).
- `src/ui/playApp.test.ts`: panel renders both meters + momentum + threat for a live player; momentum shows "—" on turn 1; fallen player still shows only the banner; a turn that loses cells shows "N셀 상실".
- **Golden regression:** existing world/history/playSim golden-hash tests must stay byte-identical (this feature is read-only + play-UI-only).

## Out of scope (YAGNI)

Full leaderboard/rank screen; turn-by-turn history graph; per-polity spying/fog; any change to engine tuning consts (that is the *separate* feel-pass this feature unblocks); save/load.
