# Extramural Countryside + Urban Castle — Design

2026-07-05. User request: "성 밖을 꾸몄으면 — 건물 엄청 많고 방목하는 공간, 농업, 헛간 등등 중세 느낌"
plus two follow-ups: farming belongs OUTSIDE the walls (today fields render inside), and every
walled city should have a lord's castle with its own inner wall.

Research grounding:
- Urban castles were integrated INTO the town wall at a strategic point, with a postern to the
  fields outside and a separate gate into the town (Wikipedia: Urban castle).
- Open-field system: 2–3 great common fields around a nucleated settlement, each divided into
  furlongs → long thin strips (ridge-and-furrow); plus common pasture/waste, riverside meadow,
  woodland (Wikipedia: Open-field system).
- Distance zonation outside the walls: perishables closest to market — kitchen gardens/orchards
  right under the walls; grain fields and pasture beyond; woodland outermost. Churches/abbeys sat
  outside the gates (Benson, *Life in a Mediæval City*).
- Watabou MFCG practice: farm fields fill the emptiness outside walls; farmhouses at field edges,
  not centers; castle optionally attached to the wall.

Approved decisions: existing city layouts MAY change (no byte-compat this time; world map and
seeds untouched). Countryside gets generous space ("널널한 시골 링").

## §1. Canvas expansion

- `generateCityLayout`: bounds 300×300 → **460×460**, center (230,230). City radius formula
  `60 + size*12` unchanged → countryside ring widens from ~30–78px to ~110–158px.
- Water/mountains/existing extramural features all derive from `bounds` and adapt automatically.
  Audit constants that assumed 300 (suburb road cap 38, scatter margins, harbor reach) and scale
  where needed.
- Renderer viewBox becomes `0 0 (460+LEGW) 460` (LEGW=108 legend strip unchanged).
- CSS `.stage svg.city` max-width 762 → **1008px** so the intramural city keeps ≈ its current
  on-screen size (the earlier "city looks small" regression class — handled in the same change).

## §2. New engine module `src/engine/city/countryside.ts`

Pure function, same idioms as the rest of `src/engine/city/` (rng-first args, Point/Polygon from
geometry.ts, rejection sampling with avoidance predicates).

```ts
interface FieldPatch { polygon: Polygon; strips: Polyline[] }   // furlong block + furrow lines
interface Pasture    { fence: Polygon; animals: Point[]; kind: "sheep" | "cattle" }
interface Farmstead  { house: Polygon; barn: Polygon; yard: Polygon | null }
interface Orchard    { polygon: Polygon; trees: Point[] }
interface Countryside {
  roads: Polyline[];        // gate roads extended to the canvas edge (slightly bent)
  gardens: Polygon[];       // kitchen-garden plots hugging the wall
  fields: FieldPatch[];     // strip fields grouped into 2–3 "great field" sectors
  pastures: Pasture[];
  farmsteads: Farmstead[];
  orchards: Orchard[];
  woods: Point[];           // tree points forming a woodland fringe at the canvas edge
  hamlets: Polygon[];       // roadside houses beyond today's faubourg ribbon
}
generateCountryside(rng, opts): Countryside
```

`opts`: bounds, boundary, water, mountains, wall gates, existing landmarks/outworks/suburbs as
avoidance obstacles, ctx.size, biome profile (§3).

Placement algorithm (three distance rings, per research):

1. **Roads first**: extend each gate road to the canvas edge with 1–2 gentle bend points;
   existing water guard (never run a road into the sea). These spines orient everything else.
2. **Wall fringe (0–12px from boundary)**: small kitchen-garden rectangles and 1–2 orchards
   tucked against the wall between gates.
3. **Middle ring**: pick 2–3 "great field" sectors (angular wedges not blocked by water/
   mountains); fill each with 2–4 furlong blocks — rectangles oriented to the nearest road,
   subdivided into 4–8 parallel strips drawn as furrow polylines. Pastures (noise-deformed
   fenced blobs + 2–5 animal dots) fill gaps between sectors; meadow-style pasture preferred
   near rivers/lakes. Farmsteads (house + bigger dark barn + optional fenced yard) sit at
   field-block corners beside a road — never mid-field (Watabou lesson). Hamlet houses line
   the roads (denser near the gate, thinning outward — extends today's faubourg).
4. **Canvas edge**: scattered woodland points along the outer 8% (skipped on sea/mountain
   sides) so the map reads as continuing into forest.

Scaling: total cultivated patch budget ≈ `3 + size` field blocks, `2 + floor(size/2)` pastures,
`1 + floor(size/3)` farmsteads. All placements reject: inside boundary, in water, in mountains,
off canvas, overlapping prior patches/landmarks (bbox test + min-gap like `findSpot`).

## §3. Biome profiles

One small table keyed off the existing archetype/biome traits (CityContext.biome):

| profile | fields | pastures | orchards | woods | notes |
|---|---|---|---|---|---|
| plains (default) | max | normal | normal | normal | wheat-tan strips |
| forest biomes | fewer | fewer | more | dense | clearing feel; reuse `.tree` glyph |
| wetland | few | meadow-heavy | none | sparse | pastures hug water; cattle |
| desert | few, only near oasis/river | none | palm orchard near water | none | dry ochre strips |
| mountain archetypes | minimal | sheep-heavy | none | sparse | terraced look NOT in scope |

Colors stay in the parchment palette: field strip #d9cc9a / furrow #c4b581 (desert: ochre pair),
pasture #ccd6a8 with fence #8a6a44, animals white (sheep) / #8a6a44 (cattle) 1px dots, garden
#c9d0a0, barn roof #7a5a3a vs house #e0d6c0.

## §4. Rendering

In the existing unclipped `.environs` group, bottom→top: gardens/fields/pastures/orchards →
woods → roads (suburb-road style) → farmsteads/hamlets → existing landmarks (mills, abbey,
cemetery, gallows) stay on top. New classes `.field`, `.furrow`, `.pasture`, `.animal`,
`.farmstead`, `.garden`, `.wood-tree`. All colors inline attrs (export parity convention).
District legend unchanged (intramural only).

## §5. Tests

- `countryside.test.ts` (new): determinism; every patch outside boundary, inside canvas, out of
  water/mountains; furrows inside their field polygon; animals inside their fence; size-3 plains
  city gets ≥3 field blocks / ≥2 pastures / ≥1 farmstead; desert city has 0 pastures; roads reach
  the canvas edge.
- `city.test.ts`: `layout.countryside` present; update any assertions assuming 300×300.
- `svgCityRenderer.test.ts`: `.environs` contains the new element classes with counts matching
  the layout.
- World-map golden hashes unaffected (city drilldown is a separate rng stream).

## §6. Remove intramural fields (user report: "농사는 성벽 밖에")

- `zoning.ts:88`: the outermost intramural ring (f>0.85) currently becomes `suburb|field`.
  Replace with slum 0.5 / craftsmen 0.3 / park 0.2 — the town stays urban to the wall.
- Delete `"suburb"` and `"field"` from `WardType`, DENSITY, i18n WARD_NAME, and the renderer
  tint table (they become unreachable). The district legend loses "밭" — the countryside takes
  over that role visually.

## §7. Lord's castle (urban castle) upgrade

- **Every city gets a castle**: drop the `isCapital || size >= 4` gate. size 1–2 → fortified
  manor (small keep + fence-scale inner wall), size ≥3 → full castle ward.
- **Placement**: non-mountain cities anchor the castle ward AT the town wall (pick the ward
  whose polygon touches the boundary, biased away from the harbor side); mountain cities keep
  the existing high-ground `castleAnchor`. Implemented as a new anchor rule in `assignZones`.
- **Inner wall**: inset of the castle ward polygon (geometry.ts `inset`), drawn like the town
  wall but thinner, with corner towers and **two gates**: an inner gate facing the town center
  and — when the ward touches the town wall — a **postern** cutting through the town wall to
  the countryside (research: the lord's independent exit). The postern adds a short exit road
  outside (reuses gate-road logic, water-guarded).
- **Interior**: replace generic subdivision with 1 large keep (dark, prominent) + 1–2 annexes
  (hall/chapel) + open courtyard. `CityLayout.castle: Castle | null` new struct
  `{ innerWall: Polygon; towers: Point[]; gate: Point; postern: Point | null; keep: Polygon;
  annexes: Polygon[] }`.
- Renderer: `.castle` group — inner wall polyline + tower dots (town-wall style, thinner), keep
  filled dark w/ subtle shadow, courtyard left as ground. Existing "성채" label kept.

## Out of scope

- Terraced mountain fields, seasonal crop colors, livestock movement, leper house/fairground
  (old backlog), expanding the world-map↔city elevation coupling.
- Castle moat; keep interiors.

## Build order note

§1 (canvas) and §6 (zoning swap) are small and land first; §7 (castle) and §2–4 (countryside)
are independent after that; §5 rides along each. Countryside generation runs LAST in
`generateCityLayout` (after landmarks) so its rng draws sit at the stream tail, matching the
established convention even though byte-compat is waived this round.
