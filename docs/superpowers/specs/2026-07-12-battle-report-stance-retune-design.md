# Border Battle Report + Stance Retune — making the invest→battle→land chain visible AND real

**Date:** 2026-07-12
**Status:** Approved design

## Why (measured, not guessed)

User feel-pass: "투자하면 왜 땅이 변하는지 모르겠고, 태세 차이를 못 느끼겠다." A headless probe
(8 seeds × 15 turns, biggest nation) split the cause in two:

| policy | net Δcells | cells lost |
|---|---|---|
| internal+pass | +1019 | 87 |
| aggressive+pass | +1158 | 2995 |
| defensive+pass | +897 | 408 |
| internal+investBorder | **+1686** | 103 |

1. **Legibility**: stance effects are real but manifest as CHURN (aggressive gains ~4100 and loses
   ~3000), while the UI shows only the net — indistinguishable from internal in one sitting.
   Per-seed variance swamps single-run perception.
2. **Balance**: aggressive nets only +14% over internal at 34× the losses (a trap as tuned), and
   internal+investBorder dominates everything — the stances CONVERGE in outcome, so there is
   little difference to feel even with perfect eyes.

## Part A — Border battle report (legibility)

**A1. Turn report line** — the momentum headline in `renderPanel` splits the net into its parts:
`이번 턴 · 국경 +{gained} / −{lost} (행동 +{n})` — gained/lost from the existing before/after
owner diff in the advance handler, action share from `TurnResult.actionData.n` (attack captures /
0 otherwise). EN mirror. The existing ▲/▼ net glyph stays in front.

**A2. Border-standing line** — a new pure helper in `src/engine/standing.ts`:

```ts
export interface BorderReport { mine: number; theirs: number } // avg solidarity on each side of the front
export function borderReport(s: SimState): BorderReport | null; // null when no front
```

`mine` = average solidarity of player cells on `frontEdges`; `theirs` = average of the enemy
cells across those edges. Rendered under the momentum line:
`국경 결속 {mine}% vs 인접 적 {theirs}% — {우세|비등|열세}` (word at ±5%p), with a `title`
disclosing it is the dominant LOCAL term of the contest math, not the whole formula (avg-asabiyya
and size also weigh in) — honest approximation, clearly labeled.

**A3. Quantified stance tooltips** — the stance buttons' `title`s gain the real numbers:
`공격적: 공격 ×1.35 · 수비 ×1.0 · 결속 −1%p/턴` etc. (rendered from the CONSTS, not hardcoded
copy, so a retune can never desync the tooltip — export the three stance tables from historySim).

## Part B — Stance retune (balance)

Current: ATK {agg 1.2, def 0.85, int 0.75}, DEF {1.0, 1.35, 1.05}, SOL {−0.005, +0.005, +0.02}.

Target identities, measured by re-running the same probe protocol:
- **aggressive** = fast, bloody expansion: net Δ ≥ internal's net Δ × 1.25 across the 8-seed sweep
  (currently ×1.14); losses stay the highest (identity, not a bug).
- **internal** = safest recovery, slowest expansion: lowest or near-lowest losses; its net clearly
  BELOW aggressive (currently nearly equal — the trap).
- **defensive** = the wall: losses well under aggressive's (≤ 1/4), net between internal and
  aggressive on contested seeds.

Starting candidate (one iteration allowed after measuring): ATK {agg 1.35, def 0.7, int 0.55},
DEF {agg 1.0, def 1.5, int 1.05}, SOL {agg −0.01, def +0.005, int +0.02}. Final values are
whatever passes the acceptance sweep; they are all player-gated multipliers (applied only when
`playerPolity` participates), so **golden hashes stay byte-identical**.

The probe is a THROWAWAY test file (recreated for the sweep, deleted before commit; results
pasted into the plan/report). No permanent probe test — 40 full simulations are too slow for the
suite; the acceptance numbers are recorded in the spec/memory instead.

## Non-goals

Per-contest battle log (too chatty for a decade-turn game); reworking the contest formula;
touching bot-vs-bot behavior (multipliers stay player-gated); prosperity/victory tuning.

## Testing

1. `borderReport` unit: both sides averaged over front edges only; null with no front; read-only.
2. playApp DOM: momentum line contains the gained/lost split after an advance; border-standing
   line renders with a % on both sides; stance tooltips contain "×" numbers derived from the
   exported const tables.
3. Retune: full suite green (goldens untouched — gated multipliers); acceptance numbers from the
   probe recorded in the plan execution notes.

## Sources

Internal measurement (probe results above); prior balance methodology from the 07-07 bot-matrix
retune and 07-08c victory-condition measurement.
