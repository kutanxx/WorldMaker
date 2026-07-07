# Play-mode self-feedback fixes — balance triangle, reign chronicle, dilemmas, difficulty labels

Status: built 2026-07-07 (same session as Phase 2 + map-click targeting). Origin: a bot-measured
self-feedback pass (3 seeds × 2 nation picks × 4 strategies × 50 turns) compared against other
games (Civ/EU4, Reigns/King of Dragon Pass, Crusader Kings, WorldBox). Four findings, four fixes.

## Findings (pre-fix bot matrix)

1. **builder was a dominant strategy** (6/6 alive, always rank 1, 2-3× everyone's cells) — invest
   spam + city anchors compounded for free (Civ "always rush X" problem).
2. **attack was a strategic trap** — the most interactive verb lost to quiet investing (aggro 3/6
   dead despite capturing ~200 cells/run; aggressive stance decay + overextension ate it all).
3. **defensive was strictly worse than doing nothing** (turtle < passOnly everywhere) — its 0.6
   attacker self-nerf starved growth while 1.2 defense didn't hold.
4. **50 identical turns** — no varied questions aimed at the player (vs Reigns/KODP), and no
   artifact of the reign at the end (vs the product's "readable history" DNA).

## Fixes

### 1. Balance triangle (`historySim.ts`, `intervention.ts`)
- `STANCE_ATK_MULT` defensive 0.6→0.85, aggressive 1.15→1.2; `STANCE_DEF_MULT` defensive
  1.2→1.35; `STANCE_SOL_DELTA` aggressive −0.01→−0.005, defensive 0→+0.005.
- Invest gains diminishing returns: `sol += INVEST_DELTA·(1−sol)` (was flat +0.15 clamp).
- Post-fix matrix: no strictly-dominated stance; aggro = high-peak/high-risk (peaks 449 vs 320
  baseline, still can die), turtle survives hard starts passOnly loses (seed 7 rank 3), builder
  still safest but margin 10-45% not 2-3×. Honest-low-agency preserved (no protagonist buff).

### 2. Difficulty labels (`playApp.ts` picker)
Nation size IS difficulty — label it: ≥66% of max cells "easy/쉬움", ≥33% "normal/보통", else
"hard/어려움" in the picker sub-line.

### 3. Reign chronicle export (`src/engine/reign.ts`)
`reignChronicle(s, worldName, lang)` → Markdown: title, outcome (survived/fell), stats line
(peak/final/rank/cities), then one year-ordered "## 기록" stream = the player's events
(polityId/otherId === player) + decades whose net cell swing ≥ `DELTA_NOTEWORTHY=15` (computed
from snapshots). Event body text stays engine-Korean (same scope-out as the chronicle);
headers/stat lines localise. End-screen `.reign-export` button downloads `{nation}_reign.md`
(win or lose — a lost reign is still a story).

### 4. Reigns-style dilemmas (`src/engine/dilemma.ts`)
Condition-triggered two-choice cards aimed AT the player; free (separate from the one action per
turn); at most one per turn with `DILEMMA_COOLDOWN=3` ticks (ignoring a card also cools down —
it expires with the decade). Effects use ONLY existing mechanics (solidarity/owner/truces).
`offerDilemma` is called by the play UI only and no-ops for `playerPolity<0` ⇒ golden hashes
untouched; it draws from `s.rng`, which is fine in a game (already diverged from pure history).

| code | trigger (priority order) | A | B |
|---|---|---|---|
| unrest | avg<0.42, cells≥60, p=.5 | concede: shed ≤5 lowest-sol border cells to no-man's-land, nation sol +.08 | crush: 50/50 → nation sol +.06 / −.06 |
| raiders | threat edges ≥6, p=.4 | fortify: border sol +.1, interior −.02 | punitive raid: free attack at best predictCapture target |
| defector | any non-free enemy border cell, p=.2 | cell defects (CONQUEST_SOL), truce with them broken | return: 10-year truce (1 tick) |
| prosperity | avg≥0.55, p=.3 | feast: nation sol +.04 | frontier: border sol +.09 |

SimState gains `lastDilemma: number` (init −99, inert on the pure path). UI: `.dilemma` card
between panel and map; answering logs a `❔` headline; `end()` clears it. i18n: `playDilemma`
(title + 2 choice labels) + `playDilemmaOutcome`, KO/EN.

## Testing gotchas (recorded for future sessions)

- Trigger tests must loop `offerDilemma` until the WANTED code fires (a met condition can lose
  its probability draw and fall through to a lower-priority dilemma).
- `UNREST_MIN_CELLS=60` needs full-size (`DEFAULT_PARAMS`) worlds — the 300×300/400-cell test
  world's biggest realm is too small (same class of gotcha as `CITY_MIN_GAP`).
- The dilemma UI jsdom test advances up to 50 turns and expects ≥1 card — probabilistic but
  flake-negligible (<1%): prosperity alone gives ~16 draws at p=.3 once cohesion rises.

## Not done / next

Balance is bot-validated, not feel-validated — the user should play. Dilemma variety is 4 codes;
easy to extend (the table above is the pattern). Save/load still out of scope (rng closure).
