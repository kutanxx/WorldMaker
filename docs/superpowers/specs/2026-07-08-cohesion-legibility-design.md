# Cohesion (& standing-term) Legibility for New Players

**Date:** 2026-07-08
**Status:** Design approved (post self-critique), ready for plan
**Scope:** Version B play-mode only (`src/ui/playApp.ts`, `src/ui/i18n.ts`, `src/theme.css`). Play-UI text/tooltips only — no engine change, golden hashes byte-identical.

## Problem

A new player who sees "결속 50% (불안)" in the standing panel has no idea what 결속 (cohesion) is or what 불안 (shaky) leads to. The only explanation lives in the start-of-game how-to card (`howto4`), which is dismissed and gone. The standing-panel meters themselves carry **no tooltip and no inline consequence**, so the term stays opaque mid-game.

## Research grounding

- **Just-in-time tooltips** on the unfamiliar element itself teach on demand without interrupting — but must be genuinely useful, not restate the obvious. ([Envato Tuts+ Game UI](https://code.tutsplus.com/game-ui-by-example-a-crash-course-in-the-good-and-the-bad--gamedev-3943t))
- **Clear labels remove ambiguity** and keep players immersed; combine naming + accessible tooltips + gradual pacing. ([Justinmind Game UI](https://www.justinmind.com/ui-design/game))

## Self-critique that shaped this design (accuracy first)

The first draft proposed inline consequence copy "불안 · 반란 위험" and "위험 · 내전 임박". Checking the engine (`historySim.ts`) showed this is **factually wrong**:
`CIVILWAR_MIN_CELLS = 220`, `CIVILWAR_MAX_ASA = 0.42`, `CIVILWAR_PROB = 0.06` — civil war fires only when a realm has **≥ 220 cells AND average cohesion < 0.42**, then at a **6% per-tick** chance.
- "불안" (0.40–0.55) is mostly above 0.42 → **not civil-war-eligible**; the tag would be false.
- "임박/imminent" overstates a 6% chance.
- A **small realm (< 220 cells)** never civil-wars regardless of cohesion → the tag would lie to small-realm players.

The **universally true** consequence: cohesion (solidarity) feeds `contestStrength`, so low cohesion **weakens the realm in every battle → easier to lose ground**, for realms of any size. Civil war is an **additional, large-realm-only** risk. The design below states only what is true, and puts the size-conditional civil-war detail in the tooltip (not the always-on inline tag).

Also rejected (self-critique): renaming 결속 (the word isn't the problem, the missing explanation is; renaming touches many strings and the game's voice); a per-term "?" pip that opens the full how-to card (a bait-and-switch — a term-level control opening a general card); a first-encounter popup (the how-to card already covers the intro; adds state + interruption).

## Design (A + D)

### D — inline consequence, always visible (no hover), only where TRUE

The cohesion meter's state word:
- **안정 / stable** → unchanged.
- **불안 / shaky** → unchanged (not civil-war-eligible; do not add a scary tag).
- **위험 / danger** → append the universally-true consequence: `⚠ 위험 · 약해짐` / `⚠ danger · weakened` (low cohesion = weaker in battle, size-independent). No "civil war / imminent" claim in the inline tag.

### A — tooltips + a label hint (no "?" pip)

- A subtle **dotted-underline** on the three standing labels (결속 / 국력 / 위협) signals "hover for info" (the discovery cue; no separate "?" element). Desktop-web hover is the primary path; touch is out of scope for this pass.
- A genuinely-useful `title` tooltip on each of the three meter rows / threat line:
  - **결속 / cohesion:** "결속이 낮으면 전투에서 약해져 땅을 잃기 쉽습니다. 나라가 크고 결속까지 낮으면 내란으로 분열될 수 있습니다. 투자(💰)나 내치 태세로 회복합니다." / EN: "Low cohesion makes your realm weaker in battle, so you lose ground. A large realm with low cohesion can also split apart in civil war. Restore it with invest (💰) or the internal stance."
  - **국력 / power:** "내 영토(셀 수)를 이웃 세력 평균과 비교합니다. 앞서면 우세, 밀리면 열세." / EN: "Your territory (cell count) versus the average rival realm. Ahead = strong, behind = weak."
  - **위협 / threats:** "국경에 맞닿은 적국 수. 많을수록 침공 압박이 커집니다." / EN: "The number of enemy realms bordering you. More means greater invasion pressure."

## Architecture

All in the play UI:
- `src/ui/playApp.ts` — `renderPanel`: `meterRow` gains a `tooltip` argument (sets `title` on the row and a `.hint` dotted-underline class on the label); pass the three tooltip strings; the threat-line div gets `title` + `.hint`; the cohesion value appends the danger consequence tag when `cohesionState === "danger"`.
- `src/ui/i18n.ts` — new KO/EN keys: `tipCohesion`, `tipStrength`, `tipThreat`, `cohWeak` (the "약해짐"/"weakened" tag).
- `src/theme.css` — a `.hint` rule (dotted underline, `cursor: help`).

## Data flow

Unchanged game loop. Only `renderPanel`'s markup changes: title attributes, a label class, and one conditional suffix on the cohesion value.

## Error / edge handling

- Fallen player: standing strip already shows only the banner; no meters, so no tooltips — unaffected.
- The danger tag keys off the existing `cohesionState === "danger"` (avg < COHESION_DANGER 0.4); no new threshold introduced.

## Testing

- `src/ui/playApp.test.ts`:
  - the cohesion meter row has a non-empty `title` attribute.
  - the cohesion label carries the `.hint` class.
  - a player at danger-level cohesion shows the `약해짐`/`weakened` tag in the cohesion value; a stable player does not.
  - 국력 and 위협 labels/rows also carry titles.
- **Golden regression:** engine/world/history/playSim golden-hash tests stay byte-identical (play-UI only).
- Visual (dotted-underline subtlety) → user eyeballs localhost.

## Out of scope (YAGNI)

Renaming 결속; a "?" pip; first-encounter popups; touch/tap tooltip handling; tooltips on the momentum headline (transient); extending to the how-to card copy.
