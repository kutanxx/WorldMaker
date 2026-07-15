# Province Map Layer (P1 — map tool) — Design

**Date:** 2026-07-16 · **Scope:** UI — a new `src/ui/provinceLayer.ts`, a `"province"` `MapView` in `src/ui/svgWorldRenderer.ts`, a 4th view toggle in `src/ui/app.ts`, a `.province-label` tier in `src/ui/deconflict.ts`, one i18n string. **No engine change** (consumes P0's `world.provinceOf` / `world.provinces`). **Origin:** P1 of the EU4/HOI4 province project — make the P0 partition visible in the map tool (Version A). This is also the first time provinces are rendered, so it doubles as P0's visual validation (are provinces even, or blobby?).

## What P1 adds

A dedicated **"영토 / Provinces"** map view (alongside terrain / political / culture) that draws the province partition: thin province borders, a faint per-province biome tint so the borders read, culled province-name labels, and a hover tooltip naming any province.

## Components

### 1. `provinceLayer(grid, provinceOf, provinces, opts?) → SVGGElement`  (new `src/ui/provinceLayer.ts`)

Mirrors `politicalLayer`'s structure. Returns a `<g class="province">` containing, in paint order:

- **Tint fills** (optional, default on): one `<path>` per province of its member cells (`cellPath` joined, same as politicalLayer's fills), `fill` = the province's biome colour at low opacity (~0.18), `class="province-fill"`, `data-province="<id>"`, and a child `<title>` = the province name. The `<title>` gives a native hover tooltip for EVERY province (covers names culled from the label pass). Ocean cells (`provinceOf < 0`) are skipped.
- **Borders:** one `<path class="province-border">` with `d = segPath(politicalBorders(grid, provinceOf))` — the same boundary algorithm the political view uses, fed `provinceOf` instead of `owner` (it already skips `< 0`). Thin, muted stroke.
- **Labels:** a `<text class="province-label">` per province at `province.centroid`, emitted **largest-cells-first** so the deconflict pass keeps the biggest when labels collide. `text-anchor="middle"`, small font.

Signature: `export function provinceLayer(grid: GridLike, provinceOf: ArrayLike<number>, provinces: Province[], opts?: { fills?: boolean; labels?: boolean }): SVGGElement` where `GridLike = { count; neighbors; points; polygons }` (matches politicalLayer's local `GridLike`). `Province` imported from `../engine/provinces`.

### 2. `"province"` view in `svgWorldRenderer.ts`

- `export type MapView = "terrain" | "political" | "culture" | "province";`
- In `renderWorld`, the `.political-slot` gets `provinceLayer(...)` when `view === "province"` (the existing `view === "culture" ? cultureLayer : politicalLayer` branch becomes a small switch). Biomes are muted under the province view exactly as under political/culture (reuse the existing mute condition — extend it to include `"province"`).

### 3. View toggle in `app.ts`

- A 4th button `provinceBtn` in the `.view-toggle` group; label from i18n `province`. `setView("province")` on click; `applyStrings` sets its text.

### 4. Label culling — `deconflict.ts`

- Add `[".province-label", 3]` to the `tiers` array (same rank as region labels; province view has no nation/region labels so it only culls province-vs-province). The existing `deconflictLabels(svg)` call in `app.ts` (post-render) then culls overlapping province names automatically — biggest survive (emit order), the rest are hidden but still reachable via the tint `<title>` tooltip.

### 5. i18n

- Add `province: "Provinces"` (en) / `province: "영토"` (ko) to the map-tool UI strings (`UI` in `i18n.ts`, next to `terrain`/`political`/`culture`).

## Determinism / constraints

- Pure UI over P0 data; no rng, no engine change, golden hashes untouched.
- SVG export (PNG/SVG) already serializes the rendered `.political-slot`; the province view exports like the others. Styling that must survive export uses inline attrs (tint `fill`/opacity, border stroke) per the existing convention; hover `<title>` is inert in a static export (fine).
- jsdom: `deconflictLabels` no-ops (no getBBox), so all province labels stay visible in tests — assert structure (counts, classes, data attrs), not culling.

## Testing

- **provinceLayer** (`provinceLayer.test.ts`): given a small hand-built grid + `provinceOf`/`provinces`, returns a `<g.province>` with a `.province-border` path (non-empty `d`), one `.province-fill[data-province]` per province each carrying a `<title>` with the province name, and `.province-label` texts equal to the province count; labels are in largest-first order; ocean cells contribute no fill.
- **renderWorld** (extend `svgWorldRenderer.test.ts`): `renderWorld(world, "province")` contains a `.province` layer and no `.nation-labels`; biomes are muted (same assertion pattern as the political/culture view test).
- **app toggle** (extend the Version A app test if present, else a focused test): clicking the province toggle switches `svg` to the province view (a `.province` group appears).
- **deconflict:** `.province-label` is in the tier list (import the module's behaviour is hard to unit-test without layout; a light assertion that the selector is handled, or covered indirectly by the render tests).

## Rejected alternatives

- **Overlay checkbox on any view** instead of a dedicated view: the toggle is mutually-exclusive views (terrain/political/culture); a 4th view matches the model and the codebase. An overlay is a different interaction to bolt on for no clear gain.
- **All labels always shown:** ~100 names clutter the map; culling + hover tooltip is the readable middle.
- **Heavy per-province colour fills (EU4 political-map look):** too loud for a worldbuilder map tool and clashes with the political view; a faint biome tint keeps borders legible without a second political map.
- **Gazetteer province listing:** deferred — a small follow-up once the map view is validated; ~100 entries need their own formatting thought.
- **Biome-aware province boundaries (P0 refinement):** only pursue if P1 shows provinces reading as arbitrary blobs; decided visually here, not assumed.
