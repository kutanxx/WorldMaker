# Standing Panel — "지금 잘하고 있나" feedback (Version B play-mode)

**Date:** 2026-07-07
**Status:** Design approved (revised after self-critique), ready for plan
**Scope:** Version B (`play.html` / `src/ui/playApp.ts`) only. Play-UI + read-only over `SimState`. No world/history/tuning-const changes → golden hashes byte-identical.

## Problem

The user can play but cannot *feel* balance or difficulty: "밸런스와 난이도 감각이 잘 안 잡힌다." The game shows the map, cohesion, dilemmas, and a log, but nothing answers **"am I winning or losing, and is it getting better or worse?"** So no amount of play builds intuition, and a genuine feel-pass/tunable-sweep is blocked.

## Research grounding

- **Reigns (our direct genre — dilemmas are Reigns-style):** balance legibility comes NOT from a leaderboard but from ① always-visible meters that must stay in a healthy zone and ② previewing what a choice will do *before* committing (the "dots"). We already have one such meter (cohesion) and half of the preview system (action previews).
- **Civ demographics / mobile-4X "Power Velocity":** relative standing (rank / rate vs cohort) is a "how am I doing" tool. We fold in the *relative* half without a full leaderboard.
- **Difficulty is *felt* through the cue→reaction→feedback loop and forward-momentum signals**, not static labels.

**Rejected framings (self-feedback):** a 4X leaderboard rank pushes a "be #1" fantasy that fights this game's single-ruler survival/reign identity (it has a reign chronicle). We keep the survival frame.

## Self-critique that shaped this revision

A pass over the first draft found: (1) the current panel already prints `cells · cohesion% (word) · threats N` ([playApp.ts:308](../../../src/ui/playApp.ts)), so two "meters" would mostly *reskin existing data* — the genuinely new information is **momentum (turn Δ)**, **cells lost this turn**, and a **relative-standing calibration**; (2) the draft weighted the meters as the headline and momentum as secondary, backwards from the research ("difficulty is felt through momentum"); (3) neighbor-only calibration can pin a player next to a giant at permanent "열세" red → learned helplessness, not learning; (4) the preview extension is really a separate feature and bloats scope. This revision promotes momentum, defaults calibration to the whole-field average, and defers the preview work.

## Design

A compact **판세(Standing) panel** in the play sidebar. Headline = motion; meters = the context that motion moves within.

### ① Momentum headline (the real new signal) — "이번 턴 어떻게 됐나"

One prominent line summarizing the last turn's motion, e.g. `이번 턴 · 국력 ▲+3셀 · 결속 ▼ · 2셀 상실`:
- **Δ territory** since last turn (`playerCells` now − last turn) with ▲/▼/–.
- **Δ cohesion** direction (avg solidarity now vs last turn) with ▲/▼/–.
- **cells lost this turn** — count `conquer` events in the turn's event slice where `otherId === playerPolity`; omit the clause when zero.

Turn 1 (no previous snapshot) shows a neutral "첫 턴" instead of fake zeros.

### ② Two health meters (context for the motion; Reigns-style, safe-zone framed)

- **국력 = territory (cell count).** A bar whose safe zone is calibrated **relative to the average cells of living rival polities** (whole field). States: **우세 / 균형 / 열세** (green / amber / red). Answers "am I keeping pace" without a leaderboard.
- **결속 = average solidarity.** Reuse the existing 안정/불안/위험 thresholds (`>=0.55` / `>=LOW_COHESION` / below), rendered as a *peer* meter next to 국력.

Rationale for territory (not the engine's `power = cells×avg`): `power` re-mixes cohesion, so it would double-count cohesion across the two meters. Territory is the orthogonal axis ("how big" vs "how solid") and is directly visible on the map.

Calibration default is the **whole living-field average** (steadier; avoids permanent-red helplessness when one neighbor is huge). A `neighborsOnly` option (bordering polities) is exposed as a tuning knob but OFF by default.

### ③ Threat line (one line)

`국경 접촉 3세력 · 휴전 1` — bordering enemy polities (distinct polities across `frontEdges`/`borderTargets`) + active truces (`s.truces` entries still in the future). (Cells-lost moved up to ①.)

## Deferred to a follow-up (was ④)

**Preview extension** — projecting each action/dilemma choice onto the two meters before commit (the Reigns "dots"; folds in backlog "dilemma card map-previews"). Separated to keep this feature focused; it becomes its own spec once the standing panel is validated by play.

## Architecture

**New pure helper `src/engine/standing.ts`** — instantaneous, read-only over `SimState`:

```ts
export interface Standing {
  cells: number;
  rivalAvgCells: number;         // avg cells of living rival polities (whole field by default)
  strength: "strong" | "even" | "weak";   // cells vs rivalAvgCells thresholds
  cohesion: number;              // player avg solidarity (0..1)
  cohesionState: "stable" | "shaky" | "danger";
  borderPolities: number;        // distinct enemy polities on the land/strait border
  truceCount: number;            // active truces (tick < value)
}
export function computeStanding(s: SimState, opts?: { neighborsOnly?: boolean }): Standing;
```

Tuning consts (UI/standing layer, NOT engine goldens): `STRENGTH_STRONG = 1.15`, `STRENGTH_WEAK = 0.7` (cells / rivalAvg ratio); cohesion thresholds reuse existing `0.55` / `LOW_COHESION`.

**UI layer (`src/ui/playApp.ts`):**
- Keep `prevStanding` (cells + cohesion from the previous turn) to render the ① momentum headline; store it each turn after rendering.
- Count ① "cells lost this turn" from the `TurnResult.events` slice (`conquer` with `otherId === playerPolity`) — turn context lives in the UI, not the pure helper.
- Replace the current single-line panel text (`renderPanel`) with the momentum headline + two meters + threat line. Reuse `aggregate`, `frontEdges`/`borderTargets`, `playerCells`, `LOW_COHESION`.

**Styling:** momentum headline (one emphasized line) + two small meter bars + one threat line. Compact — NOT a dashboard. New CSS classes (`.standing`, `.momentum`, `.meter`, `.meter-strength`, `.meter-cohesion`, `.threat-line`).

**i18n:** all new strings via the existing `playT(lang, key)` table (KO/EN).

## Data flow

`playTurn` (unchanged) → UI diffs `playerCells`/cohesion vs `prevStanding` for the ① headline → counts lost cells from the turn's events → calls `computeStanding(s)` for the ② meters + ③ threat → renders → stores next `prevStanding`.

## Error / edge handling

- **Dead player** (`!s.alive[player]`): keep the existing fallen banner; skip the standing panel.
- **No living rivals** (player is last standing): `rivalAvgCells` = 0 → strength = "strong" (guard the ratio).
- **Turn 1** (no `prevStanding`): momentum headline shows "첫 턴" (no delta), not fake zeros.

## Testing

- `src/engine/standing.test.ts` (pure): strength thresholds (strong/even/weak around 1.15/0.7 of rivalAvg), cohesion states, border-polity counting, truce counting, no-living-rivals guard, `neighborsOnly` option. Full-size `DEFAULT_PARAMS` world where cell-count minimums matter (per the known test-world gotcha).
- `src/ui/playApp.test.ts`: panel renders momentum headline + both meters + threat for a live player; momentum shows "첫 턴" on turn 1; a turn that loses cells shows the "N셀 상실" clause; fallen player still shows only the banner.
- **Golden regression:** existing world/history/playSim golden-hash tests must stay byte-identical (read-only + play-UI-only).

## Out of scope (YAGNI)

Preview extension (deferred, above); full leaderboard/rank screen; turn-by-turn history graph; per-polity spying/fog; any change to engine tuning consts (that is the *separate* feel-pass this feature unblocks); save/load.
