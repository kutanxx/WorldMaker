# Named World + Geographic Feature Names (world-map depth ①) — Design

**Date:** 2026-07-01
**Status:** Approved
**Scope note:** The user wants geographic names + a world name + a culture layer.
This spec is sub-project ① (world name + geographic feature names). The **culture
layer is sub-project ②** (separate spec, later) because it is bigger and it *builds
on* named regions (culture drives name style/colour). ① is the prerequisite.

## Goal

Make the world map read like a fantasy atlas: name the land's major geographic
regions (seas, mountain ranges, forests, deserts, plains, marshes, tundra) and give
the whole world a name, both rendered on the map in an antique cartographic style.
Kingdom names already render (political view `.nation-label`); this adds the
*geography's own* names, which are currently absent.

## Research grounding (fantasy toponymy)

Folded in from a web survey:
1. Names mean something concrete — colour, growth, terrain, weather.
2. Larger areas get **less specific, more evocative** names.
3. Feature-name structure: **"the {Adjective} {FeatureNoun}"**, **"{FeatureNoun} of
   {Proper}"**, **"{Proper} {FeatureNoun}"**.
4. The FeatureNoun depends on the terrain kind (desert→Wastes/Sands, forest→Woods/
   Wilds, mountains→Peaks/Range, sea→Sea/Deep).
5. Cultures name differently (Japanese -yama/-kawa, Arabic water/direction) →
   noted as the hook for the culture layer (②); ① uses generic fantasy descriptors
   with a culture-ready structure.
Sources: Keir DuBois "Fictional Toponymy", Map Effects "Place Names", Aesoterik
"D&D toponymy", Inksorcery naming/typography.

## Components

### 1. `src/engine/geography.ts` (new)

```ts
export interface Region { name: string; kind: number; centroid: [number, number]; cells: number }

// pure geometry: same-biome connected components (land) + ocean seas, above a size floor
export function detectRegions(
  grid: Pick<Grid,"count"|"neighbors"|"points">, biome: number[], terrain: number[],
): { kind: number; centroid: [number, number]; cells: number }[]

export function nameGeography(rng: Rng, raws: {kind;centroid;cells}[]): Region[]  // assigns names
export function worldName(rng: Rng): string
```

- **detectRegions:** BFS connected components over `grid.neighbors`, grouping cells
  that share the same `biome` value. Land components below `MIN_CELLS` (≈35) are
  dropped; keep the largest `MAX_REGIONS` (≈12) across all kinds. Each region's
  `centroid` = mean of its member cell points.
- **Ocean (seas):** the ocean forms its own component(s); the sea LABEL sits at the
  DEEPEST open water — a multi-source BFS from coast-adjacent ocean cells gives each
  ocean cell a coast-distance; the max is the label point (avoids naming the sea over
  an island's centre). Keep the 1-2 largest ocean components.
- Pure, deterministic-by-input, **draws no rng** (so it is trivially testable).

### 2. `src/engine/names.ts` (extended)

Region/feature naming assembled in `geography.ts` using `names.ts` for proper nouns.
`geography.ts` holds the FeatureNoun table by biome kind + an adjective list:
- OCEAN→[Sea, Deep, Gulf, Waters, Expanse, Main], TUNDRA→[Tundra, Frostlands, Barrens],
  TAIGA→[Pinewood, Taiga, Wilds], FOREST→[Forest, Woods, Wilds, Reach, Wold],
  GRASSLAND→[Plains, Steppe, Downs, Fields], DESERT→[Wastes, Sands, Dunes, Barrens],
  TROPICAL→[Jungle, Rainforest, Wilds], WETLAND→[Marsh, Fens, Mire, Moor],
  ALPINE→[Peaks, Mountains, Range, Spires, Heights].
- Adjectives: Ashen, Grey, Green, Golden, White, Black, Bitter, Broken, Endless,
  Silent, Frozen, Shrouded, Sunken, Hollow, Iron, Amber, Pale, Riven, Cold, Old.
- Proper nouns from `makeNameGen(rng).nation()`.
- `worldName`: weighted "{Proper}ia"-style OR "the {Adjective} {Realm|Lands|Reaches|Dominion}".

### 3. `src/types/world.ts` + `src/engine/world.ts` (modified)

- `World` gains `name: string` and `regions: Region[]`.
- `generateWorld`: a SEPARATE rng `mulberry32(deriveSeed(params.seed, 8001))` (a new
  salt, distinct from biome 7001/7002 and history 9001/9002) computes
  `regions = nameGeography(geoRng, detectRegions(grid, biome, terrain))` and
  `name = worldName(geoRng)`. detectRegions READS the already-built biome array →
  the MAIN rng stream (heights/terrain/biome/polity/cities) is byte-unchanged and the
  golden FNV world-gen regression (seed 1 polityOf/cityCells) still holds.

### 4. `src/ui/svgWorldRenderer.ts` (modified)

- `.region-labels` group (drawn after biomes, before markers — a background layer):
  each region's `name` at its centroid, antique style (italic serif, wide
  letter-spacing, muted ink `#5a4a34`, subtle), font-size scaled by `cells` (bigger
  region → bigger label). Shown in BOTH views (geography is view-independent). Under
  the city markers so settlement labels stay on top.
- `.world-name` title: the world's name as a centred serif cartouche at the top of the
  map (Cinzel, larger), the atlas title.

`renderWorld(world, view, econZones)` already receives `world`, so it reads
`world.name`/`world.regions` — no signature change.

## Non-goals (YAGNI)

Culture layer (②), curved/warped label baselines (straight or slightly rotated only),
river names (major area features first), per-city habitation renaming, collision-free
label layout (accept the occasional overlap as real atlases do).

## Testing

- `geography.test.ts`: `detectRegions` groups same-biome neighbours into one component,
  drops sub-threshold specks, returns centroids inside the map bounds, caps count;
  `nameGeography` names every region with a kind-appropriate FeatureNoun and is
  deterministic for a seed; `worldName` returns a non-empty string, deterministic.
- `world.test.ts`: `world.name` is a non-empty string; `world.regions` is non-empty for
  a normal map; the golden world-gen hash (seed 1 polityOf/cityCells) is UNCHANGED
  (guards the separate-rng contract).
- `svgWorldRenderer.test.ts`: a `.world-name` title renders with the world's name; at
  least one `.region-label` renders in both terrain and political views.
- Full suite green; build clean.

## Verification

Dev server serves this worktree; `preview_eval` DOM-verifies labels/title/positions.
Screenshot still times out — the antique-label aesthetics (placement, density, overlap)
need the user's eyes at localhost.
