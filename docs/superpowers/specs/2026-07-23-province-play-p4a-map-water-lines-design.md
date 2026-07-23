# Province play P4a: no border lines or lanes cluttering the sea (design)

Date: 2026-07-23
Scope: `playProvince.html` (province game), play map. UI render only.

P4a of the playtest-driven improvement set. A playtest surfaced two rendering issues on the
play map, both confirmed by measurement:

1. **~22% of the solid province-border segments are drawn over open water.** Sampling 160
   of the 1118 `.province-border` segments in a live game, 35 had midpoints over the sea
   (the bare svg background, not any land fill). Cause: the grid is a Delaunay/Voronoi
   tessellation, so two land cells on opposite sides of a narrow strait can be Voronoi
   neighbours; the Voronoi edge `politicalBorders` draws between them runs across the water
   gap. `politicalBorders` excludes ocean *cells* (`provinceOf < 0`), but the edge between
   two *land* cells can still physically cross water.
2. **All 22 sea-lane dashed lines are drawn every turn**, ~half with midpoints over water.
   They are the naval-expedition routes (a real mechanic), but drawn in full they read as
   stray dashed lines strewn across the sea, most irrelevant to the current turn.

## Non-goals

- No engine change. `buildSeaLanes`, `politicalBorders`, the province partition, and the
  golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version
  A `1350115163`) are untouched — this is render-side only, in `provinceApp.ts` + `theme.css`.
- The map tool (Version A, `provinceLayer.ts`) has the same border-over-water behaviour but
  is a separate surface; it is NOT in P4a's scope (the user plays `playProvince`). Noted as
  a follow-up; the same clip technique would apply there.
- The naval-expedition mechanic itself is unchanged; only which lanes are *drawn* changes.

## Design

### 1. Clip the border lines to land

Rather than filter individual border segments by a fragile geometric predicate (a Voronoi
edge between two land cells is, by definition, not "inside an ocean cell", so a
nearest-site test would wrongly keep it), **clip the border strokes to the land region** —
provably correct regardless of the Voronoi subtlety: a stroke can only paint where land is.

- Build one SVG `<clipPath id="prov-land">` whose shape is the union of every land cell's
  polygon (`world.grid.polygons[c]` for each `c` where `world.terrain[c] !== OCEAN`), using
  the same `cellPath` the map already fills territory with. This is exactly the drawn
  landmass.
- Apply `clip-path="url(#prov-land)"` to the `.province-border` path and the `.nation-border`
  path. A segment that crosses water is clipped at the coastline: its on-land part still
  shows, the over-water part is hidden. Genuine inland borders are unaffected (fully inside
  the clip).

`world.terrain` and `OCEAN` are already available (`OCEAN` from `../engine/terrain`, imported
where needed). The clip path is built once per `buildMap` call.

This also cleans up the `.nation-border` (bold country outline), which shares the same
`politicalBorders` origin and the same over-water artifact.

### 2. Draw only the turn-relevant sea lanes

Replace "draw all 22 lanes every turn" with "draw only the lanes the player could act on
this turn":

- In conquer mode, draw a lane only if it connects one of the player's provinces to a
  province the player can attack across it this turn — i.e., the other endpoint is an
  armable expedition target (`armableTargets` reachable by lane, the ones `explainAttack`
  marks with `lane: true`). These are the routes the ⚓ expedition targets sit on.
- Optionally include lanes on an incoming expedition threat (a `forecastIncoming` attacker
  reaching the player across a lane), so a naval threat's route is visible — but keep it to
  lanes touching a player province, never the full mesh.
- In consolidate mode and the picker, draw no lanes (the picker already draws none in play;
  keep it lane-free).

Net effect: instead of 22 always-on dashed lines, the player sees the handful of naval
routes that matter this turn — the sea reads clean, and a visible lane now *means* "you can
strike across here" (or "a fleet is coming this way").

## Files

- `src/ui/provinceApp.ts` (`buildMap`: add the land clip + apply to both border paths;
  `seaLaneLayer`: filter to turn-relevant lanes)
- `src/theme.css` (no new rules expected; the clip is an attribute)

## Tests

1. A `<clipPath id="prov-land">` is emitted once per map render, and both `.province-border`
   and `.nation-border` carry `clip-path="url(#prov-land)"`.
2. The land clip contains a path for each non-ocean cell (its subpath count equals the
   number of `terrain !== OCEAN` cells), and none for ocean cells.
3. `seaLaneLayer` in conquer mode emits a lane only for player↔armable-expedition-target
   pairs: on a seed/turn with a lane-reachable target, the drawn `.prov-lane` count equals
   the number of armable lane targets touching the player (not the full lane set); with no
   lane target this turn, zero `.prov-lane` are drawn.
4. Consolidate mode and the picker draw zero `.prov-lane`.
5. Golden guard is not needed (no engine file touched) — but a test asserts `buildSeaLanes`
   / `politicalBorders` are still called unchanged (the fix is purely which output is drawn
   / clipped, not how it is computed).

## Verification (live browser)

Re-run the measurement that found the bug: sample `.province-border` segment midpoints and
confirm ~0% now fall over the sea background (the clip removed them), while inland borders
still render. Confirm `.prov-lane` count is now small and every drawn lane touches a player
province and an armable ⚓ target (or an incoming naval threat). Confirm the ✓ badge, hatch,
threat rings, and territory fills are visually unchanged (the clip must not eat them — it is
applied only to the two border paths, nothing else). Screenshots are harness-blocked, so the
"does the sea read clean now" judgement is the user's, but the segment-over-water count and
the lane count are fully measurable via the DOM.
