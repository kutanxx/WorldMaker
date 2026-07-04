# Town Detail Deepening + Castle Glyph — Design

2026-07-05. Follow-up to the countryside authenticity work. Two user directives: dig deeper
into medieval fidelity (parish churches, waterside noxious trades, market cross/well/inns,
barbican) and make the lord's-castle glyph less bland (it is currently a flat rotated square).

Research grounding: medieval towns had a parish church roughly per 1,000 people (a skyline of
steeples); a **market cross** and public **well** on the market square; **inns** clustered at
the gates for travelers; a **barbican** (forward gate-work) defending the principal gate;
noxious trades (**tanners, dyers**) pushed to the water's edge outside the walls for their
stench and effluent. The lord's keep was a **donjon** — a tall square great-tower with corner
turrets, read in plan view as concentric squares with bulging corners.

Scope: city-drilldown only (`city.ts` + `castle.ts` data, `svgCityRenderer.ts` glyphs). No
world-map/history/countryside-generation changes except adding the three extramural structures
to the countryside's `occupied` avoidance list. Determinism per-run; byte-compat with prior
layouts already waived. No new text labels → no i18n work (glyphs only, like abbey/gallows).

## §1. Castle glyph — donjon + corner turrets (renderer-only)

No engine or interface change. `svgCityRenderer.ts`'s `castle-inner` block is enriched:
- **Inner wall**: the single thin polyline becomes a town-wall-style double stroke (thick
  `#5a5346` w≈1.6 + inner light `#8a7a60` w≈0.6); corner **towers** grow r 1.3 → 2.1 with a
  darker ring.
- **Keep = concentric-square donjon**: a drop **shadow** (keep polygon offset +1,+1, dark
  `#2f333c`), the keep body (`#6e7686`, stroke `#3a4050` w 0.8), an **inner square** (keep
  inset ~40%, darker `#565e6e`) reading as the tall great-tower, and a **corner turret**
  circle (r≈1.6, `#7c8494`, dark ring) at each of the keep's four vertices.
- No flag/pennant (would break the strict top-down projection).
- Renderer computes turrets from `castle.keep` vertices and the inner square via `insetPolygon`.

## §2. Parish churches (skyline) — intramural

`CityLayout.parishChurches: Point[]`. Count `1 + size` (capped by available wards). Placed at
the centroids of wards that are NOT cathedral/castle/plaza/harbor, nudged to a clear spot,
min-gap apart. Rendered in the CLIPPED group (above buildings, landmark convention) as a small
steeple glyph: a tiny nave rect + a cross, smaller than the cathedral landmark. Generated in
the tail block using the existing `zoned` wards.

## §3. Barbican — extramural gate-work

`CityLayout.barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[]`.
At the principal gate only (`1`, or `2` when `size >= 4`). The principal gate is the one whose
extended gate-road (`suburbRoads`) is longest — the main approach; ties broken by lowest index,
so the choice is deterministic. Skip any gate whose outward point is in water (no barbican into
the sea) or blocked by mountains; if the chosen gate is unusable, fall through to the next
longest. Geometry: from the gate, march outward ~10–14px; place two flanking
tower points offset perpendicular, and two short walls from the wall line out to the towers.
Rendered in `.environs` (over the causeway) — two tower circles (wall-tower style) + two wall
polylines. Added to `occupied` before countryside.

## §4. Market cross, well, inns

- **Market cross** `CityLayout.marketCross: Point | null` = the plaza ward centroid (plaza is
  the open square with no buildings, always present when wards exist; no rng). Rendered
  (clipped) as a stepped base (small square) + a cross.
- **Well** `CityLayout.well: Point | null` = a point a few px off the plaza centroid. Rendered
  (clipped) as a small stone ring (circle, stroke, inner dark).
- **Inns** `CityLayout.inns: Point[]` = at 1–2 gate-road starts (roadside, just outside the
  gate). Rendered (`.environs`) as a slightly larger house rect + a signpost tick (a short
  stroke with a small rect sign). Added to `occupied` before countryside.

## §5. Waterside trades — river/sea/lake cities only

`CityLayout.riversideTrades: { at: Point; kind: "tanner" | "dyer" }[]`. Empty for inland dry
cities. Place 2–3 workshops just OUTSIDE the boundary near the water edge (found by sampling
outside the wall where a short probe reaches water; honest approximation of "by the water" —
no flow-direction data for true downstream). Rendered (`.environs`): a dark workshop rect
(`#6b5a44`); dyers add 2–3 drying-rack ticks (short strokes). Added to `occupied` before
countryside.

## Generation order (determinism)

In `generateCityLayout`, after the existing landmark block (abbey/cemetery/gallows) and BEFORE
the `generateCountryside` call: generate §3 barbicans, §4 inns, §5 trades, pushing each new
point into `occupied` so countryside avoids them. §2 parish churches, §4 market cross + well
are intramural and computed alongside (order fixed). All rng draws sit at the stream tail;
world-map generation uses a separate stream so its golden hash is unaffected. Reuse the exact
geometry guards (`pointInPolygon`, `inWater`, `inMountains`, `pointSegDist` vs roads/moat) so
nothing overlaps.

## CityLayout additions (summary)

```ts
parishChurches: Point[];
barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[];
marketCross: Point | null;
well: Point | null;
inns: Point[];
riversideTrades: { at: Point; kind: "tanner" | "dyer" }[];
```

## Tests

- `city.test.ts`: parish-church count = `min(1+size, availableWards)` and all inside the
  boundary; barbican present at a non-water gate for a plains city, absent when the only gates
  face the sea; marketCross equals the plaza centroid; inns outside the boundary; riverside
  trades present for a coastal/river city and empty for an inland dry city, each near water;
  no barbican/inn/trade overlaps a countryside patch (they are in `occupied`).
- `svgCityRenderer.test.ts`: `.castle-keep` now accompanied by `.castle-turret` ×4 and
  `.castle-keep-inner`; `.parish-church` count = layout.parishChurches.length; `.barbican`,
  `.market-cross`, `.well`, `.inn`, `.riverside-trade` counts match their arrays.
- Determinism: existing history/world golden hashes unchanged (separate rng stream).

## Out of scope (backlog)

True downstream placement (needs river-flow data in the city drilldown); leper house;
fairground; guild-specific district signage; church dedications/names; pannage; timber-vs-stone
church materials by region.
