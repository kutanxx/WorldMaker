# Mountain Cities (city form Phase 2) — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** Organic City Form Phase 1 (merged) — spec `2026-06-30-organic-city-form-design.md` §4.
**Builds on the unified barrier/wall model:** wall = boundary edges NOT adjacent to a barrier; barriers were water only, now also mountains.

## Goal

High-elevation cities get terrain-appropriate mountain forms. A mountain mass on
one/three/two sides acts as a natural defensive **barrier**, so the §2 wall model
automatically opens the wall on the cliff side (spur = wall only on the land neck,
hillside = wall only on the downhill faces). Pure city-drilldown work; the world
map and history are untouched.

## Research grounding (medieval hill towns + cartographic convention)

Folded into the design from a web survey:
1. **Castle/citadel sits on the high ground**, town on the slopes below → the keep
   is anchored toward the mountain, not the geometric centre.
2. **Cliffs ARE the fortification** → no wall (and no gate glyph) on cliff edges;
   the barrier model already yields this, and gate markers are suppressed there.
3. **Cartographic cliffs**: downhill hachures (short strokes perpendicular to the
   crest, pointing downslope; denser = steeper) + a unified light direction, not
   plain concentric contour lines.
4. **Crags/cliffs differ from rolling hills** → `spur` renders as a sharp dark
   cliff (bold crest, dense hachures); `hillside` as a gentler slope (softer, sparser).

Sources: Hill town (Wikipedia), Terrain cartography (Wikipedia), Italian hilltop
towns (Academy Travel), Mountains in fantasy cartography (Fantasy Map Assets),
Watabou MFCG devlog (elevation/terraces are still a *future* feature there — so
deferring switchbacks matches the state of the art).

## Scope decision

Streets: **cliff render + roads stop at the mass** (chosen option A). No tensor-field
switchback rework — deferred to a Phase 2.5 backlog. Existing curving field +
region `stop` (already blocks outside-boundary) keeps roads out of the mass.

## Components

### 1. `src/engine/city/archetypes.ts` (modified)

Add three mountain archetypes to `ArchetypeId` and `TABLE`:
- `hillside`  — streetField `organic`, wallShape `hull`,  water `none`.
- `spur`      — streetField `radial`, wallShape `hull`,  water `none`.
- `valleyPass` — streetField `linear`, wallShape `rect`, water `none`.
All three `...BASE` (stone walls, no vegetation), groundColor a rocky `#e8e2d6`.

`selectArchetype` gains an optional `pick?: number` (`[0,1)`). When
`elevation >= 0.7`, choose from `[hilltopFortress, hillside, spur, valleyPass]`
by `Math.min(3, Math.floor((pick ?? 0) * 4))`. `pick` omitted → index 0 →
`hilltopFortress` (existing behaviour preserved; non-elevation branches unchanged).

### 2. `src/engine/city/mountain.ts` (new)

```ts
export interface MountainMass {
  polygon: Polygon;    // inner rim arc (city side) → outer canvas edge (wedge mass)
  innerEdge: Polyline; // city-facing rim arc, ordered; for cliff line + hachures
  steep: boolean;      // spur/valleyPass = true (sharp cliff), hillside = false
}

export function makeMountains(
  rng: Rng, archetype: Archetype, boundary: Polygon, center: Point,
  bounds: { w: number; h: number },
): MountainMass[]

export function inMountains(masses: MountainMass[], p: Point): boolean
```

- Returns `[]` for any non-mountain archetype **without drawing from `rng`** (so
  every existing non-mountain / hilltopFortress city keeps a byte-identical rng
  stream). Draws from `rng` only for hillside/spur/valleyPass (all new).
- Per mass, for a direction `θ` and half-arc `φ`: take the boundary vertices whose
  angle-from-centre falls in `[θ−φ, θ+φ]` as the **innerEdge** (city rim), then
  extend each outward (radially from centre) to the canvas bbox to form the outer
  edge; close the polygon. Perturb the outer edge with a little noise. Because the
  inner edge sits on the rim, the mass overlaps the "just outside the edge" sample
  point the wall uses → the wall opens there; and the mass interior lies OUTSIDE
  the boundary, so it never eats city buildings.
- Placement per archetype (directions drawn from `rng`):
  - `hillside`: 1 mass, `steep=false`, `φ ≈ 0.9`.
  - `spur`: 3 masses at θ, θ+2π/3±jitter (leave one ~120° neck open), `steep=true`, `φ ≈ 0.7`.
  - `valleyPass`: 2 masses on opposite sides perpendicular to the linear axis, `steep=true`, `φ ≈ 0.7`.
- `inMountains` = `masses.some(m => pointInPolygon(p, m.polygon))`.

### 3. `src/engine/city/walls.ts` (modified)

`wallFromDefenses(boundary, water, mountains: MountainMass[], mainRoads)`.
Per boundary edge, classify the just-outside sample: `"water"` if `inWater`, else
`"mountain"` if `inMountains`, else `null`. `isWall = barrier === null`. When a wall
run ends, emit a **seaGate only where the adjacent non-wall edge's barrier is
`"water"`** — mountain transitions are closed cliffs with no gate marker
(research #2). Non-mountain callers pass `[]` → identical to today.

### 4. `src/engine/city/zoning.ts` (modified)

`assignZones(..., opts: { hasCastle; coastal; castleAnchor?: Point })`. When
`castleAnchor` is provided and `hasCastle`, the castle ward = the not-yet-typed
ward nearest `castleAnchor` (swapped into the castle slot, no extra rng draw);
otherwise the current innermost-castle behaviour. Omitted → byte-identical to today.

### 5. `src/engine/city.ts` (modified)

- Compute the mountain variant from a **separate** rng so the main stream is
  unchanged: `const pick = mulberry32(deriveSeed(worldSeed, ctx.id + 4200))();`
  passed to `selectArchetype`.
- After `makeBoundary`: `const mountains = makeMountains(rng, archetype, boundary, center, bounds);`
  (draws rng only for mountain archetypes).
- `wallFromDefenses(boundary, water, mountains, mainRoads)`.
- `castleAnchor` = when `mountains.length`, the mean of mass `innerEdge` midpoints
  pulled ~30% toward centre (a rim ward on the high side); passed to `assignZones`.
- Suburb + outwork placement gains a `!inMountains(mountains, p)` guard (no
  faubourg/mill on the cliffs).
- `CityLayout.mountains: MountainMass[]` (empty for non-mountain cities).

### 6. `src/ui/svgCityRenderer.ts` (modified)

A new **unclipped** `.mountains` group drawn right after the water bodies (base
terrain, behind the clipped city so the city rim overlaps it). Per mass:
- fill the polygon a rock colour (`steep` → darker `#a99e8c`, else `#bcb2a0`);
- a **cliff crest line** along `innerEdge` (`steep` → `#5f5648` width 1.4, else `#7a715f` width 0.9);
- **downhill hachures**: along `innerEdge`, short strokes pointing from the crest
  toward `center` (downslope), spacing/length by `steep` (steeper = shorter, denser);
- a unified light hint: the crest line only on the inner edge (top-left light is
  implicit via the single dark crest). Keep flat — no gradients.

### Determinism / signatures

Public `cityContext` / `generateCityLayout` / `renderCity` unchanged → `app.ts`
untouched. All rng via `deriveSeed(worldSeed, ctx.id)` (+ the separate
`ctx.id + 4200` stream for the variant pick). No `Math.random`. Existing
non-mountain cities are byte-identical; existing high-elevation cities change
(new archetype variety) — intended, no snapshots.

## Testing

- `archetypes.test`: `pick` sweep at `elevation 0.9` yields all four variants; `pick`
  omitted → `hilltopFortress`; a non-elevation, non-coastal case is unchanged.
- `mountain.test`: `makeMountains` returns `[]` for plainsMarket/coastalPort; 1 mass
  for hillside, 3 for spur, 2 for valleyPass; each `polygon` is closed and each
  `innerEdge` has ≥2 points; a point just outside a covered rim edge is
  `inMountains`, the city centre is not.
- `walls.test`: with a mountain covering one side, that side has no wall (fewer
  segments than the water-free all-around ring) and emits no seaGate there; a
  water side still emits seaGates.
- `zoning.test`: with `castleAnchor`, the `castle` ward is the one nearest the anchor.
- `city.test`: an `elevation 0.9` ctx that selects a mountain archetype has
  non-empty `layout.mountains`, wall segments < a full ring, no building/suburb
  centroid inside a mass; determinism hash stable; a plains ctx has empty
  `mountains` and an unchanged golden hash (guards the "no rng drift" contract).
- `svgCityRenderer.test`: a mountain city renders a `.mountains` group with a mass
  path and hachures; a plains city renders none.

## Non-goals (YAGNI)

Switchback/terraced streets (Phase 2.5), stacked Terrassenhaus rendering, oblique
roof silhouettes, per-mass individual peaks. Harbor = Phase 3 (next, separate spec).

## Verification

Dev server is serving this worktree this session, so `preview_eval` can DOM-verify
the city drilldown (mass paths, wall-segment counts, gate counts). Screenshot tool
still times out; cliff-shading aesthetics need the user's eyes.
