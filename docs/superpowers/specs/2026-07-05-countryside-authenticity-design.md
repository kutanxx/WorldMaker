# Countryside Authenticity Polish — Design

2026-07-05. Follow-up to the extramural-countryside feature. Self-review found the
countryside is geographically sound but socially empty — it has the land-use rings but
not the *community* that medieval open-field agriculture was organised around. Three
research-grounded additions, highest-impact first.

Research: the open-field system was organised around **nucleated villages** (church + green
+ clustered dwellings), each holding scattered strips in 2–3 great fields under a rotation
where **one field lies fallow** each year (grazed by the village livestock). Mills were
**seigneurial monopolies**: the **watermill sat on the watercourse** with a mill-race; the
**windmill stood on exposed high ground**.

Scope: city-drilldown only (engine `countryside.ts` + `city.ts` outworks + renderer). No
world-map, history, or castle changes. Determinism preserved per-run; byte-compat with
prior layouts already waived. Countryside stays at the rng-stream tail.

## ① Nucleated village (the biggest gap)

`Countryside` gains `villages: Village[]`, `Village { green: Polygon; chapel: Point; houses: Polygon[] }`.
- Count: `1 + Math.floor(size / 3)` (size 1–2 → 1, 3–5 → 2, 6+ → 3).
- Placement: along a gate road, far out (`t` 0.55–0.9), offset well past the field ring
  (18–30 px to one side) so the cluster sits in open country, not on the wall.
- Geometry: a small irregular **green** (open square, r≈5) at the centre `vc`; a **chapel**
  point at the green's edge; **5–9 houses** ringed around `vc` at r≈7–9, each a small
  oriented rect facing the green.
- Validation: reuse the existing exact-geometry guards — reject if any house overlaps a
  claimed patch (`polysOverlap`), a road passes through the green (`roadThrough`), or the
  cluster falls in boundary/water/mountains/off-canvas. Claim the green + houses so later
  patches (woods) avoid them. Generated after farmsteads, before woods.
- Render (new `.village` group inside `.environs`): green as grass (#bcd0a0), chapel as a
  small steeple/cross glyph, houses as #e0d6c0 rects — like a miniature of the town.

## ② Three-field fallow rotation

`FieldPatch` gains `state: "cultivated" | "fallow"`.
- One `fallowSector` is chosen (single rng draw) when `sectors >= 2`; every field from that
  sector is `fallow`, the rest `cultivated`. Desert (dry) fields are always `cultivated`
  (irrigation, not rotation).
- Render: fallow fields fill a grazed green-grey (#c8cba0) with lighter furrows (#b3b585,
  the ridge-and-furrow earthwork is permanent so furrows stay); cultivated keep the wheat
  palette. This gives the open fields the characteristic 2/3-planted, 1/3-resting look.

## ③ Mill placement (seigneurial, water/wind correct)

`Outwork` gains `race?: [Point, Point]` (watermill only).
- **Watermill:** keep the near-water dry spot, then march from it toward the water to build
  a short **mill-race** channel `[millPoint, waterEdgePoint]`; the wheel glyph renders on
  the water-facing end and the race as a thin channel line.
- **Windmill:** require an **open-ground** spot on a rise — distance from town centre
  `> wallR + 25` and clear of suburbs — so it stands exposed, not tucked against the wall.
  Soft preference: try open-ground spots first, fall back to any valid spot so a cramped
  canvas never yields zero mills.

## Tests

- `countryside.test.ts`: villages present for a size-3 plains city (≥1), each with a chapel,
  a green, ≥5 houses, all outside the boundary; village houses don't overlap other patches;
  a fallow sector exists (≥1 field `fallow`, ≥1 `cultivated`) when ≥2 sectors; desert fields
  all `cultivated`.
- `city.test.ts`: a watermill (coastal/river city) carries a `race` whose far end is in
  water; the windmill (inland dry city) sits beyond `wallR + 25` from centre.
- `geometry.test.ts`: already covers the overlap/segment helpers reused here.

## Out of scope (backlog, disclosed)

Parish churches scattered through the intramural wards; waterside noxious-trade zoning
(tanners/dyers downstream); pannage (woodland pig grazing); market cross / barbican / inns;
unfenced common vs enclosed pasture nuance; villages owning specific field strips (visual
association only, no data link).
