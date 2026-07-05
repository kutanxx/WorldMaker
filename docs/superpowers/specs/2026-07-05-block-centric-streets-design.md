# Block-Centric Streets (Roads ↔ Buildings Alignment) — Design

2026-07-05. User: "도로가 건물 위에 있거나 건물에 안 맞고 이상하다 — 도로 생성 방식을 바꿔야 할 것 같다."

Root cause (confirmed by reading the pipeline): the streets and the buildings come from two
DIFFERENT paradigms glued together. Streets are **road-centric** (tensor-field streamlines,
`tensorField.ts` + `streets.ts`) while buildings are **block-centric** (independent Voronoi
wards subdivided into lots). The two are generated independently, so streamline roads cut
across wards and buildings don't front the roads.

Research (Watabou MFCG source; Parish & Müller; Citygen; martindevans lot-subdivision):
a coherent city is EITHER fully road-centric (grow roads → extract enclosed blocks → subdivide
into lots) OR fully block-centric (partition into blocks → streets are the gaps between blocks →
subdivide each block into lots). Watabou is block-centric and our code is already 80% there
(Voronoi wards + `subdivide`). Chosen approach (user-approved): **go fully block-centric.**

Scope: city drilldown only. World map / history untouched (separate rng stream; golden hash
safe). Byte-compat with prior city layouts WAIVED (every layout changes — this is a redesign).
Determinism per-run preserved. The public `CityLayout` shape is preserved (`mainRoads`/
`minorRoads` stay `Polyline[]`; their CONTENT changes from streamlines to ward-edge streets),
so the renderer and all downstream consumers (zoning, castle, harbor, countryside, detail
glyphs, moat, suburb roads, gate connectors) keep working.

## §1. Paradigm shift — streets are the gaps between blocks

Invert the generation order in `generateCityLayout`:
1. Generate wards FIRST (Voronoi, existing `generateWards`) — these ARE the city blocks.
2. Streets = the shared edges between adjacent wards (the Voronoi interior-edge graph).
3. Buildings = each ward polygon INSET by the street half-width, then `subdivide`d — so lots
   sit back from the shared edges and front the streets by construction.
4. DROP the tensor-field streamline roads entirely.

## §2. New module `src/engine/city/blockStreets.ts`

```ts
export interface StreetGraph {
  nodes: Point[];                 // Voronoi vertices (street junctions), deduped
  edges: [number, number][];      // index pairs into nodes; each is a shared ward edge = a street
  segments: Polyline[];           // convenience: edges as 2-point polylines
}
// interior edges only: an edge shared by exactly two wards is a street; an edge on the city
// perimeter (belongs to one ward) is the wall side, not a street.
export function extractStreets(wards: WardCell[]): StreetGraph;

// main streets = the union of shortest paths (Dijkstra on the node graph, edge weight = length)
// from each gate's nearest node to the centre node; minor = every other street edge.
export function classifyStreets(
  graph: StreetGraph, gates: Point[], centre: Point,
): { main: Polyline[]; minor: Polyline[] };
```

`extractStreets`: collect every edge of every ward polygon, key it by its two endpoints rounded
to a small epsilon (min-corner first for order-independence), count occurrences. Count 2 →
interior street edge; count 1 → perimeter (skip). Build the node list (deduped rounded
vertices) and the edge index pairs.

`classifyStreets`: build an adjacency list over `nodes` from `edges`. Snap each gate and the
centre to their nearest node. Dijkstra from each gate-node to the centre-node; mark every edge
on the returned path as `main`. All unmarked edges are `minor`. Return both as `Polyline[]`
(2-point segments) for rendering and for `mainRoads`/`minorRoads`.

## §3. Gates & wall

Gates are placed where streets reach the wall, reusing the existing `wallFromDefenses` (which
already snaps road endpoints onto wall segments within 15px and keeps `maxGates` well-spread
via farthest-point sampling). Feed it the street nodes as candidate "roads":
`wallFromDefenses(boundary, water, mountains, graph.nodes.map((nd) => [nd, nd]), maxGates)`.
The nodes near the wall snap to it and become gates; the sea/mountain sides stay closed as
today. `maxGates = 2 + floor(size/3)` unchanged. After the wall (gates known), run
`classifyStreets(graph, wall.gates, center)` so main roads run gate→centre.

## §4. Buildings

`subdivide(insetPolygon(ward.polygon, STREET_HALF), { minArea, margin })` per non-open ward
(STREET_HALF ≈ 2.5, so a ~5px street runs between neighbouring blocks). REMOVE the road-
proximity building filter (`!nearRoad(c)`) — it is obsolete because the streets are now the
inset gaps, so buildings can never sit on a street. Keep the water filter (`!inWater` unless
`onStilts`) and `pointInPolygon(boundary)`. `plaza`/`park`/`field` wards stay open (no
buildings) as today. Ward count may be bumped (`8 + size*3` → tune upward for finer blocks) if
verification shows blocks too coarse.

## §5. Rendering

Minimal change: `layout.mainRoads`/`minorRoads` are already drawn as polylines; they now carry
the ward-edge streets, so the existing road-drawing block renders them unchanged (main wider,
minor thinner; casings; roads-on-top z-order from the prior fix). Buildings render as today.
Because streets are the gaps between inset blocks, roads and buildings no longer overlap.

## §6. Preserved consumers (must keep working)

zoning/social-zonation, `assignZones`, castle (from the castle ward), harbor, countryside
(reads `suburbRoads`/gates), the detail glyphs (parish/market-cross/well/inns/barbican/trades),
moat, gate bridges, suburb roads, gate connectors, `waterBridges` — all key off wards, gates,
boundary, or `mainRoads`, none of which change shape. `waterBridges([...mainRoads,...minorRoads],
water)` still finds street/water crossings. The archetype `streetField` (grid/radial/organic/
linear), which used to shape the tensor field, becomes a light bias on ward-site distribution
(grid → jittered lattice sites, radial → ring sites, else → current random); this is a
nice-to-have — v1 may keep uniform-random sites and note the bias as a follow-up.

## §7. Cleanup

`tensorField.ts` and `streets.ts` lose their only caller (city street generation). Remove them
and their tests, plus the `fieldsFor`/tensor plumbing in `city.ts`. This is a net simplification.
(Keep `geometry.ts` helpers.) Grep for stray imports before deleting.

## §8. Tests

- `blockStreets.test.ts` (new): `extractStreets` returns only shared edges (a hand-built
  2-ward fixture yields exactly the one shared edge); node dedup works; `classifyStreets` marks
  a gate→centre path as main and it is a connected chain of ward edges.
- `city.test.ts`: every `mainRoads`/`minorRoads` segment endpoints coincide (within ε) with a
  ward polygon vertex (streets ARE ward edges); no building polygon overlaps any street segment
  (inset guarantee — sample check via `polysOverlap`/point-in-building on street midpoints);
  every gate has a main road reaching it and a main path exists to the centre; determinism
  (JSON equality across two runs); the road-vs-wall regression from the prior fix still holds
  (gate connectors still added).
- `svgCityRenderer.test.ts`: road counts equal `mainRoads`/`minorRoads` lengths (unchanged);
  roads still render after buildings (z-order).
- Existing zoning/castle/harbor/countryside/glyph tests keep passing (their inputs unchanged).

## Out of scope (backlog, disclosed)

Curved/organic street rendering (Voronoi edges are straight — the medieval look Watabou ships);
street-width taper; per-ward street-facing lot orientation (straight-skeleton lots — `subdivide`
stays recursive-split for v1); `streetField`→site-distribution bias beyond the light v1 version;
plaza as a true street-connected square rather than an open ward.
