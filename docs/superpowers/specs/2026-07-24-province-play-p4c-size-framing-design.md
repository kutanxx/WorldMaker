# Province play P4c (balance) — size-as-playstyle framing (design)

Date: 2026-07-24
Scope: display-only. NO engine change, NO golden re-pin, NO measurement change. Closes P4c.

## Context: why framing, not a lever

P4c's measurement phase ran a headless sweep (start-size × strategy, two independent 80-world
seed blocks, ~3,450 games). Findings, reproduced across both blocks:

- **B1 confirmed & severe.** Monotone size gradient: the bigger the start, the worse on every
  axis. A large start (≥18 provinces) has a negative net trajectory under *every* strategy (best
  case, "mixed", nets −5.5 to −6.0), peaking ~27 then bleeding to ~18 — the brief's §2
  "grow then collapse" shape. Large-start domination is 3–6%.
- **B2 refuted.** Small starts are the *favoured* bucket (highest domination 21–25%, best net
  gain, lowest defeat). The brief's "small bootstrap is broken" is wrong; matches live play.
- **B3 partly refuted.** Domination is reachable (small/mixed 21–25%) but heavily
  size-dependent; median net gain is 0 for small/mid, −8 for large.
- **No runaway winner** anywhere (domination ≤25%); pure defense loses (consolidate-only nets
  ~0 and collapses for large starts) — anti-turtle incentives are working.

The repo has tried four *mechanical* anti-size levers and reverted all four; the standing
meta-conclusion is that only incentive/framing levers stick. The measurement shows small/mid
are a healthy resting point and there is no runaway to fix. The one genuine defect is not
balance but an **information gap**: nothing tells the player that a large realm is a *harder,
defensive* game rather than a *stronger* one, so a new player picks the biggest nation, gets a
losing trajectory, and has no idea why.

Decision (user-approved): **leave the engine balance as the resting point; close the gap with a
display-only framing pass.** No lever, no golden re-pin. This document is that pass.

## The tier model

A pure helper classifies a nation's *starting* size, expressed as a fraction of THIS world's
land so it is robust to map-size changes:

```
startTier(start, land): "small" | "mid" | "large"
  small  if start <= round(0.08 * land)   (~ <= 8 on the ~100-province default map) -> expansion
  large  if start >= round(0.18 * land)   (~ >= 18)                                 -> survival
  mid    otherwise (~9-17)                                                          -> balanced
```

Cutoffs align with the measured buckets (small ≤8, large ≥18). The unmeasured 16–17 band folds
into "mid" — framing is not a hard promise, so a soft boundary there is acceptable. This helper
selects TEXT only; it never touches the win-condition math (`isDomination`, `survivalGrade`
thresholds are unchanged).

## The three touchpoints (all reuse existing lines; no new UI machinery)

All strings follow the surrounding inline `lang === "ko" ? … : …` pattern in `provinceApp.ts`
(not `i18n.ts`), matching the objective line and survival text already there.

### A. Picker — before the pick (plain copy + static per-nation markers)

A first-timer's only real question at the picker is "which one do I click?", and their prior is
"big = strong = easy". A generic abstract line ("expansion vs survival") does not subvert that
prior or point at any specific nation, so it is too weak. Two changes make the before-pick signal
land, both **static and always-visible (no hover, no tap-to-arm)** so the repo's mobile-picker
pain is untouched:

**A1. Static per-nation difficulty markers on the picker map (extremes only).** The picker
(`ui === null`) renders a small marker at a nation's capital seat for the extremes only — mid
nations stay unmarked, which respects that the bot sweep is a coarse *direction* signal, not a
precise per-nation difficulty score:

- every alive **large**-tier nation → `⚠` (hard / survival),
- exactly one deterministic recommended starter → `⭐` (a safe first pick).

The recommended starter is a pure helper `recommendedStarter(s, land)`: among alive nations, the
one with the LARGEST start that is still `small` tier (favoured by the data, but substantial
rather than a fragile 2-province speck); ties → lowest polity id; if no small-tier nation exists,
fall back to the smallest-start `mid` nation. Deterministic, rng-free.

The markers are drawn as a **picker-only overlay layer inside `buildMap()`**, positioned from
each polity's capital cell point; `politicalLayer` (shared with the map tool, golden-adjacent) is
NOT modified.

**A2. Plain legend line that decodes the markers AND names the misconception**, added under the
existing `.prov-hint`:

> ko: `⭐ 추천 · ⚠ 생존전 — 큰 나라는 강해 보여도 넓은 국경은 지키기 어려워요`
> en: `⭐ Recommended · ⚠ Survival — a big realm looks strong, but wide borders are hard to hold`

The line does triple duty: decodes both icons, subverts the "big = strong" prior directly ("looks
strong, but…"), and points a newbie at the ⭐. Together A1+A2 answer "which do I click?" on the
map itself.

### B. Objective line — after the pick (tier-aware, `ui.startProvinces`)

The header hint for a started game (currently the single "conquer 15% or survive 50 turns" line
for everyone) becomes tier-aware. The win conditions are IDENTICAL for all tiers — only the
emphasis is reordered, and domination is never removed (a large start still wins it 3–6%):

- small: `{name} · 팽창전 — 세계의 15%를 새로 정복하거나 50턴 생존`
- mid:   `{name} · 균형 — 15% 정복 또는 50턴 생존`
- large: `{name} · 생존전 — 50턴 버텨 왕조를 지키세요 (15% 정복도 가능하나 벅참)`

(en mirrors: `· expansion —`, `· balanced —`, `· survival — hold your borders for 50 turns
(15% conquest possible but hard)`.)

### C. End-screen survival text — tier-aware

The key reframe targets exactly ONE cell: the SAME `held` outcome means different things by start
size. `survivalGrade` itself is unchanged (still great/grown/held), and `grown`/`great` already
get celebratory copy and the `.ok` class today — those stay untouched for every tier (a realm
that grew has already earned its celebration). Only the `held` end-screen text-selection and its
`.ok` class become tier-aware:

- **large + held:** read holding as the intended achievement —
  `생존전 성공 — 넓은 제국을 끝까지 지켜냈다` / `Survival won — you held your sprawling realm to the end`,
  and apply the `.ok` (earned) styling.
- **small / mid + held:** unchanged — `겨우 버텨냈다 — 영토는 그대로였다` / `Merely endured — you
  held your ground, no more`, plain styling.

So the only behavioural change in C is (large, held) → celebrated instead of plain. The
anti-turtle framing (turtling reads as unremarkable) is preserved for the sizes where growth is
achievable (small/mid); `grown`/`great`/domination texts are unchanged for all tiers.

## Components & boundaries

- `startTier(start, land)` — pure, exported, unit-tested at boundaries. Shared by A1 (per-nation
  markers), B, and C.
- `recommendedStarter(s, land)` — pure, exported: the deterministic ⭐ pick for A1 (largest
  small-tier alive nation; fallback smallest mid; ties → lowest id).
- `objectiveHint(name, tier, lang)` — pure text selector for touchpoint B.
- `survivalEndText(tier, grade, lang)` and its `.ok`-class predicate — pure selectors for C.
  Extracting B and C into pure functions lets them be unit-tested without driving a full game to
  turn 50.
- Picker marker overlay in `buildMap()` (picker mode only): for each alive nation, `startTier` of
  its province count → `⚠` if large, plus `⭐` on `recommendedStarter`; placed at the capital cell
  point. `politicalLayer` untouched.
- Wiring in `render()` / `buildHeader()` picks the tier from `ui.startProvinces` and `ui.s.n`.

## Scope & files

- `src/ui/provinceApp.ts` — the helpers (`startTier`, `recommendedStarter`, `objectiveHint`,
  `survivalEndText`) + wiring (picker marker overlay, picker legend line, tier-aware objective,
  tier-aware end text/class).
- `src/theme.css` — minimal style for the picker legend line (`.prov-pick-legend`) and the map
  markers (`.prov-pick-mark`).
- NO change to `src/engine/**`, `politicalLayer`, or any golden; no golden re-pin, no measurement
  artifact (the sweep harness was throwaway and is already deleted).

## Testing

- `startTier`: boundary cases (round(0.08·land), round(0.18·land), and the 16–17 fold) return the
  right tier on the default ~100-province land count and a smaller land count (relative-fraction
  robustness).
- `recommendedStarter`: deterministic on a fixed seed (same nation every run); returns a
  small-tier nation when one exists; falls back to smallest mid when none; ties → lowest id.
- `objectiveHint`: each tier yields a string carrying its tier tag and the nation name; large
  still mentions the 15% conquest option (does not falsely claim it is unavailable).
- `survivalEndText` + class predicate: large+held → the "survival won" copy and `.ok`; small+held
  → the plain "merely endured" copy and no `.ok`; great/domination unchanged across tiers.
- jsdom smoke (picker): on a fixed seed, every large-tier nation's seat carries a `⚠` marker and
  exactly one `⭐` marker exists on `recommendedStarter`'s nation; the legend line is present.
- jsdom smoke (play): start a large-start nation and a small-start nation on a fixed seed; assert
  the objective hint text differs by tier tag.

## Constraints & honesty

- **Framing, not truth-bending.** The objective never says a large start *cannot* dominate; it
  says it is hard, which the data supports. The survival reframe credits large-start holding
  without inflating it (`held` stays `held` in the grade; only the words and styling change).
- **Bots are a direction signal, not proof** (the measurement caveat still stands). The framing
  is calibrated to a robust, twice-reproduced direction (size is a liability), not to precise
  numbers.
- **P4c concludes here.** No lever chosen; the engine balance is accepted as the resting point
  the four prior levers converged on. If future live play contradicts "large = survival," the
  framing copy is cheap to retune; the engine stays untouched.
