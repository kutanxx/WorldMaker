# Culture / Ethnic Regions Layer (world-map depth ②) — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** Named World + Geography (① merged `838f505`).

## Goal

Give the world distinct peoples: divide the land into a few **cultures**, each with
its own **phonetic naming style**, so a city/nation/region in the harsh north sounds
different from one in the melodic south. Show the cultures on the map as a new
**"문화" view**. This is the pay-off that makes the atlas feel inhabited.

Scope (my recommendation, user deferred): **name style + a visible culture map.**
History/politics integration is deferred (bigger; a later enhancement).

## Research grounding (phonaesthetics)

- **Harsh** = guttural/uvular consonants + clusters (k, kr, gr, kh, gg) — the
  belligerent stereotype (Klingon; German/Russian/Arabic clichés).
- **Soft** = bilabials (m, b, p — the softness of lips) + liquids (l), open vowels;
  **trilled R reads rough, liquids/nasals read smooth**.
- Culture sound = interplay of inherent phonetics + cultural norm.
Source: Mooshammer et al. 2024 "Does Orkish Sound Evil?"; Phonaesthetics (Wikipedia).

→ 5 culture profiles spanning a spectrum: **guttural** (mountain/barbarian),
**liquid** (elvish/southern), **sibilant** (desert/silk-road), **sonorous**
(classical/imperial), **nordic** (coastal/harsh-soft mix). Each = `{onset[], vowel[],
coda[]}` + a culture name + a muted colour.

## Determinism (the key constraint)

Existing shared-seed URLs must still render the **same map, politics, and history** —
only the place NAMES may change (an intended, cosmetic content change). Achieved by:

1. **Culture assignment on a SEPARATE rng stream** `deriveSeed(seed, 6001)` (free;
   biome=7001/2, geography=8001, history=9001/2). It never touches the main stream.
2. **Naming keeps the exact main-stream draw pattern.** `makeNameGen(rng, profile?)`
   selects syllables from a profile's arrays but performs the IDENTICAL sequence of
   rng calls (`pick` draws one rng() regardless of array length; the `place()`
   coin-flip draws the same value). So `polityOf`, city cells, sizes, heights — the
   whole geometry — are byte-unchanged and the golden FNV regression still holds; only
   the resulting name STRINGS differ.

## Components

### 1. `src/engine/culture.ts` (new)

```ts
export interface Phonetics { onset: string[]; vowel: string[]; coda: string[] }
export interface Culture { name: string; color: string; phon: Phonetics }
export const CULTURE_PROFILES: { color: string; phon: Phonetics }[] // 5 profiles

// spatial: seed `count` culture centres on land, nearest-centre → cultureOf per cell (-1 ocean)
export function assignCultures(
  rng: Rng, grid: Pick<Grid,"count"|"points">, terrain: number[], count: number,
): { cultureOf: Int32Array; cultures: Culture[] }
```

- `count ≈ 4` (or `3 + floor(polityCount/4)`), clamped to `CULTURE_PROFILES.length`.
- Culture centres = `count` random land cells (min-separated); each land cell takes
  the nearest centre (Euclidean over grid points). Ocean = -1.
- Each culture gets a profile (cycled), a colour, and a name generated from its own
  phonetics (`makeNameGen(rng, phon).nation()`), all on the SEPARATE stream.

### 2. `src/engine/names.ts` (extended)

`makeNameGen(rng: Rng, phon: Phonetics = DEFAULT_PHON)` — the current ONSET/VOWEL/CODA
become `DEFAULT_PHON`; the body is otherwise unchanged (same draw structure). Existing
callers that pass no profile are byte-identical.

### 3. `src/engine/world.ts` (modified)

- `assignCultures(cultRng, grid, terrain, count)` with `cultRng = mulberry32(deriveSeed(seed, 6001))`.
- Polity names: `makeNameGen(rng, cultures[cultureOf[capital]].phon).nation()`.
- City names: `makeNameGen(rng, cultures[cultureOf[cell]].phon).place()`.
  (same main-stream draws → geometry preserved; names now culture-flavoured).
- `World` gains `cultureOf: number[]` and `cultures: Culture[]`.
- (Region names keep the default profile for now — see Non-goals.)

### 4. `src/ui/cultureLayer.ts` (new) + renderer/app

- `cultureLayer(grid, cultureOf, cultures)` → a `<g class="culture">`: one translucent
  fill per culture (its colour) + culture-name labels at culture centroids + a culture
  legend. Mirrors `politicalLayer`'s structure.
- `svgWorldRenderer`: `MapView` gains `"culture"`; `renderWorld(world, "culture", …)`
  mounts the culture layer (biomes muted, like political view) and shows the culture
  legend instead of the biome legend.
- `app.ts`: the view toggle becomes **지형 / 정치 / 문화** (a third button); `currentView`
  handles "culture"; scrub/export unaffected (culture is time-independent, so the
  timeline just doesn't change it).

## Non-goals (YAGNI)

Culture in the history sim (cohesion/borders), real morphology/grammar, per-culture
architecture in the city drilldown, culture blending at borders. **Region names by
local culture** (geography.ts) is a natural follow-up but deferred to keep this cut
focused — the culture signal lives mainly in the city/nation names + the culture view.

## Testing

- `culture.test.ts`: `assignCultures` covers all land cells with a valid culture id,
  ocean stays -1, is deterministic, respects `count`; profiles are distinct.
- `names.test.ts` (extend): `makeNameGen` with two different profiles yields different
  strings from the SAME seed but draws the SAME number of rng values (assert the rng
  is left at an identical position — e.g., a trailing `rng()` matches across profiles).
- `world.test.ts`: `world.cultures`/`cultureOf` present and valid; **the golden
  world-gen hash (seed 1 polityOf/cityCells) is UNCHANGED** (guards the geometry
  contract); a city's name uses its culture's phonetics is hard to assert directly, so
  assert names are non-empty and cultureOf is consistent.
- `svgWorldRenderer.test.ts`: `renderWorld(world,"culture")` mounts a `.culture` layer
  with fills + a culture legend; terrain/political unaffected.
- `app.test.ts`: a 문화 toggle exists; clicking it shows the culture layer.
- Full suite green; build clean.

## Verification

Dev server + `preview_eval` DOM-verify: culture view fills/labels/legend, names vary
by region, geometry hash unchanged. The culture palette + name aesthetics need the
user's eyes.
