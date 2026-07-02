# Rivers (World-Map Depth ③) — Design

Date: 2026-07-03

## Goal

Add rivers to the world map. The atlas already names seas, mountain ranges, forests
(geography ①) and cultures (②); rivers are the missing physical feature. Carve realistic
dendritic river networks that flow downhill from the uplands to the sea, draw them with
width proportional to flow, name the major trunks, and weave the named rivers into the
gazetteer. Rivers complete the physical atlas.

Positioning: a worldbuilder tool. Rivers are lore-bearing named features (novelists/GMs),
not a hydrology simulation.

## Non-goals (backlog)

- Lakes / endorheic basins (this pass drains everything to the sea).
- City-drilldown coupling (elevation ↔ world river), riverside-city emphasis.
- Rotated river labels following the river's course.

## Architecture

Follows the established world-map-depth pattern (geography ①, culture ②):

- New pure engine module `src/engine/rivers.ts`, split like `geography.ts` into
  **pure geometry** (`traceRivers`) and **naming** (`nameRivers`).
- `world.ts` computes rivers on a **separate rng stream `deriveSeed(seed, 8002)`**
  (geography family; 8001 = geography, confirmed unused elsewhere: used salts are
  6001 culture, 7001/7002 biome, 8001 geography, 9001/9002 history). River geometry is
  **purely deterministic from `heights`/`terrain`/`biome`** — no rng at all; only *naming*
  draws from the 8002 stream. Therefore **zero main-stream draws** → the golden FNV
  regression (`polityOf` = 1350115163, cityCells = 4294534188, 28 cities) is byte-unchanged.
- Rendering added to `svgWorldRenderer.ts`; gazetteer text added to `gazetteer.ts`.

## Algorithm (flux-accumulation, no lakes)

### 1. Drainage directions — Priority-Flood + ε

Guarantee every land cell drains to the sea with no depressions.

- Min-heap keyed by `(filledHeight, cellIndex)` — the **cellIndex tie-break makes pop order
  deterministic** regardless of heap internals or platform.
- Seed the heap with every ocean cell (`terrain[c] === OCEAN`) at `filled[c] = heights[c]`,
  mark them processed.
- Pop the lowest cell `c`. For each unprocessed neighbor `n`:
  `filled[n] = max(heights[n], filled[c] + EPS)` (EPS ≈ 1e-5), `receiver[n] = c`, mark
  processed, push `n`. (Neighbors iterated in fixed `grid.neighbors[c]` order.)
- Result: a drainage **forest** rooted at ocean cells; each land cell has exactly one
  `receiver` strictly lower in `filled` height → no cycles, every path reaches the sea.
- **Record the pop order.** Ocean cells have `receiver = -1`.

Filled depressions become flat plains that rivers cross in near-straight lines — the
accepted cost of "no lakes". The ε gradient keeps flow defined; ε accumulation over a
chain (≤ ~1e-4) is negligible against heights ∈ [0,1].

### 2. Flow accumulation

- Per-cell rainfall `rain[c]` by biome (deterministic, no rng), capturing moisture:
  `DESERT 0.3, TUNDRA 0.5, GRASSLAND 0.7, TAIGA 1.0, TEMPERATE_FOREST 1.0, ALPINE 1.2
  (snowmelt sources), WETLAND 1.4, TROPICAL 1.6`. Ocean cells contribute nothing.
- Initialize `flux[c] = rain[c]` for land cells.
- Walk cells in **filled-height descending order = the recorded pop order reversed** (a
  valid reverse-topological order of the drainage tree, since every child is ε higher than
  its receiver). For each land cell `c` with a land or ocean receiver:
  `flux[receiver[c]] += flux[c]`. No separate sort needed.
- Because flux accumulates from upstream, a river fed by wet uplands still flows **through**
  a dry region to the sea (Nile case) — intended, not a bug.

### 3. Network extraction (adaptive threshold)

- A cell is a **river cell** when `flux[c] ≥ drawThreshold`, `terrain[c] !== OCEAN`.
- `drawThreshold` is **adaptive**, not absolute: `drawThreshold = DRAW_FRAC * maxMouthFlux`
  where `maxMouthFlux` = the largest `flux` among mouths (land cells whose receiver is
  ocean). `DRAW_FRAC ≈ 0.04` (tuned). This self-scales: wet and dry worlds get comparable
  river counts instead of "20 vs 2".
- Emit one **segment** per river cell: `point(c) → point(receiver[c])`, carrying `f = flux[c]`.
  The final land→ocean hop **is included** so rivers visibly reach the sea (overshoot ≤ half
  a cell, reads as a river mouth). Segments form the dendritic network incl. tributaries.

### 4. Named trunks

- Mouths = land river cells whose receiver is ocean. Sort **desc by mouth flux, tie-break by
  cell index** (deterministic ordering for stable naming draws).
- A mouth is a **major river** when `mouthFlux ≥ NAME_FRAC * maxMouthFlux` (NAME_FRAC ≈ 0.25,
  tuned), capped at `MAX_NAMED ≈ 7`. Small/dry worlds naturally name fewer.
- For each named mouth, trace **upstream following the max-flux child** to build the trunk
  polyline (mouth → source). Trunks are disjoint (drainage forest → each cell drains to one
  mouth), so no shared-cell naming conflicts.

### Naming (`nameRivers`)

- Culture-flavoured, like city names: name uses `phonAt(mouthCell)` (the mouth cell's culture
  profile). Because rivers are on the separate 8002 stream (like geography), naming may use
  variable-length rng draws freely — no `pick`-count-invariance constraint.
- River nouns: `["River", "Water", "Run", "Fork", "Flow", "Race", "Rill"]`.
  Patterns (parallel to `geography.featureName`): `the {Adj} {Noun}` / `{Proper} {Noun}` /
  `{Noun} {Proper}`, where `{Proper}` = `makeNameGen(rng, phon).place()`, `{Adj}` reuses
  geography's `ADJ` list.

## Data (`types/world.ts`)

```ts
export interface River {
  name: string;
  path: [number, number][]; // trunk polyline, mouth → source
  flux: number;             // mouth flux (label sizing, gazetteer ordering)
  mouth: [number, number];  // mouth land-cell point (compass / label anchor)
}

// on World:
rivers: River[];                                          // named trunks
riverNet: { x1: number; y1: number; x2: number; y2: number; f: number }[]; // full network
```

`traceRivers(grid, heights, terrain, biome)` returns `{ segments, trunks }` where `segments`
is the network and `trunks` are raw `{ mouthCell, path, flux }`. `nameRivers(rng, trunks,
phonAt)` maps trunks → `River[]`. `world.ts` glue:

```ts
const rivRng = mulberry32(deriveSeed(params.seed, 8002));
const { segments, trunks } = traceRivers(grid, heights, terrain, Array.from(biome));
const rivers = nameRivers(rivRng, trunks, phonAt); // phonAt already defined for city naming
// world.riverNet = segments; world.rivers = rivers;
```

Empty worlds: `rivers = []`, `riverNet = []` are valid (renderer draws an empty group,
gazetteer omits the Rivers block).

## Rendering (`svgWorldRenderer.ts`)

- Rivers shown on **all views** (terrain / political / culture) — geography is view-independent.
- Z-order: **above** the `political-slot` (so rivers stay visible over the ~0.8-opacity nation
  fills and translucent culture fills), **below** `region-labels` and `markers` (cities/labels
  stay on top).
- Draw `riverNet` as **3 stroke tiers**, bucketed by `f` relative to `maxMouthFlux`
  (`< 0.15` minor / `< 0.5` medium / else major), one `<path>` per tier via `segPath`
  (matching coastline/border style). Widths ≈ `0.5 / 1.0 / 1.8`, colour `#5b83a6` (a blue-grey
  slightly bluer than the `#5f7888` coastline). `fill:none`, round caps/joins.
- Named trunks: an italic serif label (parchment halo, `paint-order:stroke`, blue-grey
  `#3f5d78`) at the polyline midpoint vertex, font-size scaled by `flux`. Unrotated (matches
  region labels). Only the named trunks (≤ MAX_NAMED) get labels — minor tributaries are
  drawn but unlabeled to avoid clutter.
- `renderWorld(world, view, econZones)` signature unchanged (reads `world.riverNet` /
  `world.rivers`). Inline attributes (not CSS) so exported standalone SVG/PNG matches screen.

## Gazetteer (`gazetteer.ts`)

Under `## The Land`, after the regions, add a **Rivers** block (only if `world.rivers.length`):

```
### Rivers
- **{name}** — flows to the sea in the {compass(mouth)}.
```

Reusing the existing `compass(cx, cy, w, h)` helper with the river's `mouth` point.

## Determinism summary

- River **geometry** = pure function of `heights`/`terrain`/`biome` (all main-stream
  outputs) + deterministic heap (index tie-break) → identical across runs, no rng.
- River **naming** = separate 8002 stream, drawn in a fixed trunk order (flux desc, cell-index
  tie-break) → stable strings; no main-stream draw → golden hash byte-unchanged.
- Simulated on read-only copies (`Array.from(biome)`); `world.polityOf` etc. untouched.

## Testing

`rivers.test.ts`:
- Synthetic slope grid: flow runs downhill; every land cell's receiver chain reaches an
  ocean cell; mouth flux = sum of upstream `rain` (accumulation correctness).
- Depression removal: a grid with a local-minimum pit still fully drains (no cycle, chain
  reaches ocean) after Priority-Flood.
- Receiver graph is acyclic (follow receivers from every cell, bounded steps, terminates at
  ocean).
- Segments only connect river cells at/above the adaptive threshold; mouth hop reaches an
  ocean cell.
- `nameRivers` is deterministic (same seed+trunks → same names) and culture-flavoured
  (different mouth culture → different phonetic character).
- Adaptive threshold: a scaled-up-rainfall world yields a similar *count* of rivers (not a
  blow-up) — guards the "20 vs 2" regression.

`world.test.ts`:
- Golden FNV hash unchanged (polityOf 1350115163, cityCells 4294534188, 28 cities).
- `world.rivers` / `world.riverNet` present and non-empty for a normal seed.
- Two `generateWorld(sameSeed)` calls produce identical `rivers` + `riverNet` (determinism).

`gazetteer.test.ts`: output contains a named river under a Rivers heading (normal seed).

`svgWorldRenderer` test: a `.rivers` group with river paths renders in all three views.

Implementation check: confirm no existing test pins the exact `World` object shape / a
`worldToJSON` snapshot that would break on the two new fields (golden hash is field-agnostic).

## Tuning & verification

Constants (`DRAW_FRAC`, `NAME_FRAC`, `MAX_NAMED`, `rain` weights, `EPS`, stroke tiers) tuned
across seeds 1–20 via `preview_eval` on the dev server (as history/biome/dynamics were):
target a legible dendritic network with a handful of named trunks per seed, no single seed
flooded with lines or barren. Screenshot tool still times out — final aesthetics
(colour/width/label density) need the user's eyes at localhost:5173.
