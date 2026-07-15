# Nation Picker — Map-Centered Redesign + Clickable Regions + 셀→칸 — Design

**Date:** 2026-07-15 · **Scope:** UI — `src/ui/playApp.ts` (picker DOM order + map click/hover wiring), `src/theme.css` (picker layout), `src/ui/i18n.ts` (셀→칸 / cells→tiles), tests. **No engine change, no rng.** **Origin:** user feel-pass on the nation picker — the current buttons-left / small-map-right split is weak; the map should be the centered hero with the nation choices spread horizontally beneath it. Also "셀/cells" is a dev term (Voronoi cell) and reads as jargon.

## Three parts

### 1. Layout — map is the centered hero, choices below

Today `renderPicker` builds `row = [picker(.landing cards) , mapBox(.picker-map)]` as a 2-column flex (buttons left, ~380px sticky map right; `<900px` = column-reverse). New layout, on every width:

```
[ title + daily/ascension badges ]
[        LARGE CENTERED MAP        ]
[ card | card | card | card | … ]   ← horizontal wrapping row
[ annals (legacy panel) ]
```

- DOM: append the map first — `row.append(mapBox, picker)` — and make `.picker-row` `flex-direction: column; align-items: center`.
- `.picker-map`: widen (max-width ~600px), center, drop `position: sticky`, enable pointer events (see part 2).
- `.landing` (the card container) stays a centered wrapping flex but sits below the map; `.choice-card` becomes more compact (smaller flex-basis ~160px, less padding) so several cards sit per row (mockup option A). The card content (name + `{cells} 칸 · {difficulty}`) is unchanged.
- The `<900px` media rule that did `column-reverse` is removed/simplified — the base is already map-on-top; mobile just wraps the cards. Coarse tap-target sizing (existing `@media (pointer:coarse)`) still applies to `.nation-choice`.

### 2. Clickable map regions

`politicalLayer` already emits **one `<path data-polity="id" class="territory…">` per polity**, so regions are directly targetable. Wire the picker map (which paints `owner0`/`polities0`):

- Enable pointer events on the map; `cursor: pointer` on `.picker-map .territory`.
- **Delegated** listeners on the map container (survive the `paintMini` repaints, which `replaceChildren` the layer):
  - `click` → `path.closest('[data-polity]')`; if its id is a **playable** nation (`playableIds = new Set(nationsByCells.map(n => n.p.id))`), call `startGame(id)`.
  - `mouseover`/`mouseout` → `paintMini(id)` / `paintMini(-1)` — the same magenta highlight the buttons already trigger. One path per polity keeps hover clean (no per-cell flicker).
- Non-playable ids (e.g. any free city) are ignored — the buttons list defines the playable set.

The buttons remain the primary, labelled selector (names, difficulty, revenge badge); the map is a second, spatial way in. Button hover and map hover drive the same `paintMini`.

### 3. Rename 셀 → 칸 (KO), cells → tiles (EN) — game-wide display

Territory-count unit renamed in **display copy only** (`i18n.ts`): the `cells` key value (셀→칸 / cells→tiles), every literal "셀" in KO playLog/dilemma/scorecard strings → 칸, every display "cells" in EN strings → tiles, and the `unit = lang==="ko" ? "셀" : "cells"` ternary (scorecard). **Code identifiers stay** — the i18n *key* `cells`, the JS var `cells` in `part()` (playDilemmaFx), `agg.cells`, `playerCells`, etc. As with the 안정도 rename, KO 셀 appears only in display values (safe global); EN "cells" collides with the key/JS var, so its replacement is scoped to display strings and the two code spots (key `cells:`, `if (cells)` / `${cells}`) are left intact. "칸/tiles" fits any magnitude (142칸, ▲+3칸) — no number-scale awkwardness, so no cell-merging is needed here.

## Deferred (separate future project)

**"영토 칸" — aggregating cells into province-sized units.** The user wants larger, chunkier territory units eventually. That is a core-model redesign (per-cell contests, conquest, `CIVILWAR_MIN_CELLS`, `SIZE_CAP`, difficulty thresholds, all fx deltas are cell-tuned) with real balance work — out of scope here, logged to the backlog.

## Testing

- **Layout:** picker renders the map element BEFORE the card container in `.picker-row` (order assertion); cards carry `.nation-choice`.
- **Map click:** a `[data-polity]` path for a playable nation exists; dispatching `click` on it mounts the play screen (`svg.world` appears / picker gone), i.e. same effect as a button.
- **Map hover:** `mouseover` a region repaints the layer with that polity as the magenta player override (assert the territory path for that id gets `class` "territory player" or the player fill) — mirrors the button-hover test.
- **Rename:** the picker sub reads "N 칸 · …" not "셀"; `playDilemmaFx` cell deltas read 칸/tiles; scorecard uses 칸/tiles. Reuse the existing i18n/fx tests, re-pointing 셀→칸 / cells→tiles.

## Rejected alternatives

- **Slim pill buttons (mockup B):** user picked A (cards) for legibility.
- **Keeping the small side map:** the whole request is to make the map the hero.
- **Merging cells into provinces now:** deferred — a core redesign, not a picker polish.
- **칸 as a code-level rename (cell → tile in identifiers):** churn with no user benefit; display copy is the ask.
