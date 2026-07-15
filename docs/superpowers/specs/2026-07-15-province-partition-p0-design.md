# Province Partition (P0 — shared foundation) — Design

**Date:** 2026-07-15 · **Scope:** engine only — a new pure module `src/engine/provinces.ts`, wired into `src/engine/world.ts`, attached to `World`. **No UI. No change to existing simulation, world-gen draws, or golden hashes.** **Origin:** the user wants EU4/HOI4-style provinces — a fixed regional partition of the land, ~100 provinces tiling the whole map independent of nation ownership, that BOTH apps (map tool + game) will consume. This is P0 of a 3-phase plan (P0 partition → P1 map-tool display → P2 game province-unit mechanics); P0 is the shared, low-risk foundation.

## What P0 produces

A deterministic partition of **land cells** into ~100 connected, named provinces:

- `provinceOf: number[]` — per cell, the province id owning it; **-1 for ocean** (and any non-land). Length = `grid.count`. (Mirrors `polityOf`/`cultureOf`.)
- `provinces: Province[]` where `Province = { id: number; name: string; cells: number; centroid: [number, number]; seedCell: number; biome: number }`.

Attached to `World` as `world.provinceOf` / `world.provinces`, built in `world.ts` alongside the existing layers.

**Provinces are ownership-independent** — derived purely from geography (the land adjacency graph), so they exist and stay fixed regardless of who holds them. Ownership (which polity holds which province) is a P1/P2 concern, not P0.

## Algorithm — farthest-point seeds + multi-source BFS

1. **Land set:** all cells with `terrain[c] !== OCEAN`.
2. **Seed placement (`PROVINCE_TARGET ≈ 100`, a dial):** greedy **farthest-point sampling** — start from a deterministic land cell (e.g. the lowest index, or an rng pick), then repeatedly add the land cell whose minimum Euclidean distance to the already-chosen seeds is largest, until `min(PROVINCE_TARGET, landCount)` seeds are chosen. Even, spread, deterministic. (Distances use `grid.points`.)
3. **Assignment (multi-source BFS):** a single BFS frontier seeded with all province seeds at distance 0; expand over `grid.neighbors`, **land cells only** (never enqueue ocean). Each land cell is claimed by the seed that reaches it first (ties broken by lower province id for determinism). Because expansion follows the land adjacency graph, every province is **connected and never crosses open water** — islands become their own provinces naturally.
4. **Result:** `provinceOf` filled for all land, `-1` elsewhere; `provinces[]` with cell counts, centroid (mean of member `grid.points`), seedCell, and dominant `biome`.

**Why BFS over nearest-centroid Voronoi:** naive nearest-seed can assign a cell to a seed across water, producing disconnected provinces; graph BFS guarantees connectivity and coastline respect — the EU4/HOI4 property that a province is one contiguous region.

**Deferred refinement (noted, not built in P0):** biome-aware boundaries — charge extra BFS cost to cross a biome edge (or a river edge) so provinces align with terrain features. Start with pure graph distance; evaluate visually in P1 and add only if provinces read as arbitrary blobs.

## Determinism

- New rng stream `mulberry32(deriveSeed(params.seed, PROVINCE_SALT))` with **`PROVINCE_SALT = 8100`** (unused; neighbours: culture 6001, biome 7001/2, geography 8001/2, history 9001/2). Used only for seed-0 selection / name draws.
- Reads existing arrays (`terrain`, `grid`, `biome`) — **adds no draw to any existing stream**, so seed-shared URLs and the golden FNV hashes (world.test `polityOf`, history anchors) stay byte-identical. A dedicated golden hash over `provinceOf` is added to lock the partition.

## Naming

Reuse the geography namer: each province draws a biome-appropriate noun via the existing `featureName(rng, nameGen, kind)` path (`nameGeography` internals), keyed on the province's dominant biome. One name per province; collisions are acceptable flavour (the gazetteer already tolerates repeats).

## Testing (`provinces.test.ts` + a golden line in `world.test.ts`)

- **Cover:** every land cell has `provinceOf >= 0`; every ocean cell is `-1`; union of all `provinces[].cells` equals the land-cell count (partition, no gaps/overlap).
- **Connectivity:** each province is a single connected component over `grid.neighbors` (BFS from any member reaches all members).
- **Count:** exactly `provinces.length === min(PROVINCE_TARGET, landCount)` — farthest-point never repeats a cell and every seed claims at least itself, so no province is empty and the count is exact (a lone 1-cell island seed is a valid 1-cell province).
- **Determinism:** golden FNV hash of `provinceOf` for seed 1 pinned; re-running `generateWorld` twice is identical.
- **No regression:** existing world.test golden hashes (`polityOf`, cities, history anchors) unchanged.
- **Visual validation (dev-only, not committed):** a temporary render tints cells by province to eyeball evenness/connectivity in the browser before P1 — provinces should look reasonably uniform and contiguous.

## Rejected alternatives

- **Reuse `detectRegions` (biome components) as provinces:** wildly uneven (one giant desert = one province, a tiny grove = another) — fails the EU4-even-tiling goal.
- **Nearest-centroid Voronoi assignment:** can split a province across water; BFS is connectivity-safe.
- **k-means clustering:** iterative, heavier, and still needs a connectivity pass; farthest-point + BFS is simpler and deterministic in one pass.
- **Fixed grid squares:** ignores coastlines/geography — provinces would straddle sea and land.
