# Invest Legibility + Metric Rename (민심/loyalty) — Design

**Date:** 2026-07-15 · **Scope:** UI copy only — `src/ui/i18n.ts` (metric word + invest labels + tooltip), `src/ui/playApp.ts` (one button/summary string names the metric), tests. **No engine change, no logic, no new i18n keys.** **Origin:** user feel-pass — the invest buttons under the map (`전국 | 국경` with a bare `+N%p`) are opaque to first-timers: they don't say it's an *invest* action, what the two scopes are *for*, that the number is *cohesion*, and "cohesion/결속" is itself jargon (Turchin asabiyya).

## Three coupled fixes

### 1. Metric rename — 결속 → 민심 (KO), cohesion → loyalty (EN), game-wide

The core health metric is renamed in **all display copy** in `i18n.ts` (~24 KO strings, ~28 EN strings: the meter label, tooltips, howto, stance descriptions, border report, goals, advice, fx messages). Reason: 결속/cohesion reads as jargon; 민심/loyalty is instantly legible ("민심을 잃다 → 반란"; loyalty is a standard strategy-game stat).

**Only string VALUES change. Code identifiers stay** — the i18n *keys* `cohesion`/`tipCohesion`, the class `.meter-cohesion`, `SimState`-side `solidarity`, `computeStanding().cohesion`/`cohesionState`, and `ChoicePreview.cohesion` are internal and untouched. Because most surfaces build their text via `playT(lang, "cohesion")`, renaming that key's VALUE cascades automatically; the remaining literal "결속"/"cohesion" occurrences inside other strings are replaced directly.

State words (안정/불안/위험, stable/shaky/danger) are unaffected — no collision with 민심.

### 2. Invest button labels — noun → verb (option B)

| scope | 결속-era | new KO | new EN |
|---|---|---|---|
| nation | 전국 / realm | `내정 다지기` | `shore up realm` |
| border | 국경 / frontier | `국경 방비` | `fortify frontier` |

`investRealmOpt` / `investFrontierOpt` values only.

### 3. Number names the metric

The button face `💰 <label> (+N%p)` becomes `💰 <label> (<metric> +N%p)` by reusing `playT(lang,"cohesion")` — so it renders `💰 내정 다지기 (민심 +7%p)` / `💰 shore up realm (loyalty +7%p)` and auto-tracks the rename. The advance-button summary (`— 💰 <label> +N%p`) gains the same metric word. `%p` is kept (it is the game's existing convention for cohesion CHANGES — the meter's pending-invest fx badge shows `▲+7%p` too, so button and meter stay consistent); `tipInvest` gains a plain-language gloss of what 민심 and %p mean.

## Testing

Copy assertions that check the OLD word must move to the new word (the rename makes them fail; update to the new expected copy):
- `i18nPlayFx.test.ts`: `결속 ▲` → `민심 ▲` (×2 in the KO cases), `cohesion ▲▲` → `loyalty ▲▲` (EN).
- `playApp.test.ts`: the KO-toggle test's `panel.toContain("결속")` → `"민심"`.

Untouched (internal identifiers, not display): `.meter-cohesion`/`.invest-seg` structural selectors, `{cohesion: n}` preview-object equality, `cohesionState`/`cohesionOk` engine assertions. A new assertion checks an invest button's face contains the metric word + `%p` so the "named number" doesn't silently regress.

## Rejected alternatives

- **A/C/D invest layouts (caption / purpose-first / minimal):** user picked B (verb labels) after seeing mockups.
- **Drop `%p` → `%` on the button:** would desync from the meter's `%p` fx badge; keep `%p`, teach it once in the tooltip.
- **단결/unity, 충성/loyalty for the metric:** user picked 민심/loyalty (most accessible KO; loyalty is a familiar game stat).
- **Renaming code identifiers too (solidarity/cohesion):** churn with no user-visible benefit and it would touch the golden-hash engine surface; display copy is the whole ask.

## Addendum 2026-07-15 — metric term 민심/loyalty → 안정도/stability

After shipping 민심/loyalty the user asked whether 안정도 (stability) reads better, and how the genre names this stat. Survey: the two conventions are **Stability** (EU4, HOI4, Stellaris, Imperator — nation-wide "does it hold together", HOI4 shows a raw %) and **Loyalty** (Civ6 — per-city, low loyalty flips a city to a free city, which is exactly our civil-war/secession mechanic). Both fit; 안정도/stability is the more standard, self-describing term (names the outcome the player watches). Decision: adopt the **Paradox term** (안정도/stability) but keep **Civ-style approachable presentation** (the adjective state band + colour + ⚠), because this is a casual killing-time phone game — the opaque raw-number Paradox *presentation* would fight the legibility goal, but the *word* is just the clearest label.

Changes on top of the 민심 pass: 민심→안정도 (KO), loyalty→stability (EN) game-wide in display copy (same i18n surface; `loyalty` was only ever a display value so the EN pass is a safe global replace this time). The invest buttons and advance summary auto-follow via `playT("cohesion")` → `(안정도 +7%p)` / `(stability +7%p)`. **Collision fix:** the metric name 안정도 would sit next to the stable-state label 안정 (`안정도 72% (안정)`), so the KO `solStable` word changes 안정 → **굳건** (불안/위험 unchanged; EN steady/shaky/critical unaffected — no collision there). Tests re-point 민심→안정도, loyalty→stability. Live-verified both languages incl. the stable band rendering `안정도 91% (굳건)` with no collision.
