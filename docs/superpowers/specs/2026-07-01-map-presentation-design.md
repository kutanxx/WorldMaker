# Map Presentation Overhaul — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** History Timeline Scrubber (sub-project B, merged `cfc2dd1`)

## Problem

Two user complaints about the world map:

1. **Nations are not distinguishable.** Political territory is a translucent 0.33
   tint over varied biomes, so one nation reads differently over forest vs desert,
   and nothing on the map names the countries — "경계선만 보고 이게 어느 나라인지 구분이 안 가."
2. **The UI looks plain** — system-ui font, default buttons, no frame or texture;
   reads like a dev tool, not a fantasy worldbuilder — "뭔가 있어보이면 좋겠는데."

Two decisions taken in brainstorming:

- Nation distinction → a **terrain/political view toggle** (political view is the
  crisp nation map).
- Aesthetic → **parchment old-map cartography.**

Delivered in two parts, Part 1 first (it fixes the concrete legibility bug),
each part its own plan + merge. Pure UI; the engine is untouched.

---

## Part 1 — Terrain/political view toggle + nation legibility

### View state

`type MapView = "terrain" | "political"` in the app; a segmented toggle in the
controls (`지형` / `정치`). Default `terrain`. The app keeps `currentView` and
`currentYearIndex`; changing either rebuilds the political layer and swaps the
legend visibility.

- **Terrain view:** biome fills (the hero) + coastline + **thin political borders
  only** (the current translucent territory tint is REMOVED here, so biomes read
  cleanly). Biome legend shown. Timeline scrub moves the borders.
- **Political view:** each nation filled with a **distinct saturated colour at
  ~0.8 opacity** + bold borders + **nation-name labels at territory centroids** +
  a **nation legend**. Biomes are muted underneath (CSS). Timeline scrub shows
  empires rise and fall dramatically.

### `src/ui/nationPalette.ts` (new)

- `NATION_PALETTE: string[]` — 12 curated, distinct, parchment-friendly hues
  (brick/slate/olive/ochre/plum/teal/rust/forest/umber/maroon/pine/indigo).
- `nationColor(id: number): string` — `NATION_PALETTE[id mod 12]` (safe for
  negative ids). Applied at RENDER time, indexed by polity id, so nations are
  always distinguishable regardless of the engine's pastel palette. Does NOT
  touch the engine (colours are cosmetic, not part of any rng/seed; determinism
  and export payload unaffected).
- `nationCentroids(grid, owner): Map<number, { x: number; y: number; cells: number }>`
  — per present polity, the mean of its owned cell centre points and its cell
  count. Pure; used for label placement and legend ordering.

### `src/ui/politicalLayer.ts` (modified)

Add an options object (keeps the border-only path the default so nothing else
breaks):

```ts
politicalLayer(
  grid, owner: ArrayLike<number>,
  polities: { id: number; name?: string }[],
  opts?: { fills?: boolean; labels?: boolean; legend?: boolean },
): SVGGElement
```

- Always draws the `.border` path (from `politicalBorders`).
- `opts.fills` → one `.territory` `<path data-polity>` per present polity, filled
  with `nationColor(id)` at `fill-opacity 0.8` (pointer-events:none).
- `opts.labels` → a `.nation-labels` group: for each present polity with
  `cells ≥ MIN_LABEL_CELLS` (e.g. 25), a `.nation-label` `<text>` centred at its
  centroid showing `polities[id].name`, with a halo (paint-order:stroke, cream
  stroke) for legibility.
- `opts.legend` → a `.nation-legend` group (swatch + name per present polity,
  ordered by cells desc, capped to ~10 rows) placed bottom-right, drawn with
  `nationColor(id)`. Lives inside the layer so a timeline scrub rebuilds it.

The polities array is `history.polities` (includes fragment polities → correct
names/colours at every year). `name` is optional so the year-0 default call in
`renderWorld` (which passes `world.polities`, also carrying names) still type-checks.

### `src/ui/svgWorldRenderer.ts` (modified)

- `renderWorld(world, view: MapView = "terrain")`.
- Tag the root: `class="world view-terrain"` or `view-political`.
- Terrain: political-slot = `politicalLayer(grid, polityOf, polities)` (borders only).
- Political: political-slot = `politicalLayer(grid, polityOf, polities,
  { fills: true, labels: true, legend: true })`.
- Biome legend gets class `.biome-legend`; CSS hides it in political view and
  mutes `.biomes` (`opacity`) so nation fills dominate.

### `src/ui/app.ts` (modified)

- Add `let currentView: MapView = "terrain"` and a `지형/정치` segmented toggle
  button in the controls.
- `showWorld` renders `renderWorld(world, currentView)`; `renderYear(index)`
  rebuilds the political-slot from `history.snapshots[index]` using the current
  view's options, and (political view only) the nation legend rebuilds with it.
- The toggle re-renders the current world at the current year in the new view
  (cheap: rebuild the slot + toggle the root class; no full regen). Export uses
  the current view + year.

### Part 1 testing

- `nationPalette.test.ts`: `nationColor` is stable, distinct across ids, handles
  negatives; `nationCentroids` returns a centroid within the map bounds and the
  right cell count for a small synthetic owner array.
- `politicalLayer.test.ts` (extend): `{fills:true}` → `.territory` filled with
  `nationColor(id)`; `{labels:true}` → `.nation-label` count ≤ present polities and
  skips tiny ones; `{legend:true}` → `.nation-legend` present; default (no opts) →
  border only, no `.territory`.
- `svgWorldRenderer.test.ts` (extend): `renderWorld(world,"political")` root has
  `view-political`, `.territory` and `.nation-label` present; `"terrain"` (default)
  has `view-terrain`, no `.territory`.
- `app.test.ts` (extend): a `지형/정치` toggle exists; clicking `정치` adds
  `.territory`/`.nation-label` to the map and clicking `지형` removes them.

---

## Part 2 — Parchment cartography theme

Presentational. Styling lives in `index.html`'s `<style>` (+ a Google-Fonts
`<link>`); decorative SVG (frame, compass, cartouche) is added in `renderWorld`.

- **Page + panels:** warm parchment page background (`#e8dcc0` family) with a
  subtle CSS texture; controls/legend/chronicle/timeline restyled as bordered
  parchment cards with serif headers.
- **Map frame:** an SVG decorative double-line border inset from the viewBox edge
  with simple corner flourishes (`.map-frame` group), drawn last so it sits on top.
- **Typography:** load a display serif (Cinzel) for titles/nation labels and a
  body serif (EB Garamond / IM Fell) for controls and chronicle, via one
  `fonts.googleapis.com` `<link>`. Fallback to `serif` so tests/offline still work.
- **Title cartouche:** a small serif title banner at the top of the map
  (`.map-title`) — the app name / a placeholder world title.
- **Compass rose:** a small decorative SVG compass in a corner (`.compass`).
- **Markers:** capitals as a star glyph, towns as a ringed dot; labels serif with
  halo (reuse the halo approach).
- **Controls:** seed input, Generate, exports, the `지형/정치` toggle, and the
  timeline all themed to match (aged buttons, serif).
- **YAGNI — excluded:** sea hatching/stipple, animated textures, blackletter fonts.

### Part 2 testing

Presence/structure only (aesthetics need the user's eyes): `renderWorld` output
contains a `.map-frame` and a `.compass`; capitals render a `.marker-capital`
(star) and towns a `.marker-town`; the controls container carries the themed
class. Existing suite stays green.

---

## Non-goals / constraints (both parts)

- Engine (`src/engine/`) untouched; determinism, URL seeds, and `worldToJSON`
  export payload byte-unchanged.
- Export (PNG/SVG) reflects the current on-screen view + year.
- No new runtime deps beyond a Google-Fonts stylesheet link (graceful serif
  fallback if it fails to load).

## Verification note

Screenshot tooling is still broken and dev ports are held by another session, so
structure/behaviour is verified via jsdom + build; the parchment aesthetics and
nation-colour legibility need the user's eyes at localhost.
