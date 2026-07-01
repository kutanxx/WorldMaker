# Harbor (city form Phase 3) — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** Organic City Form Phase 1 + Mountain Cities Phase 2 (both on this branch).
Spec §5 of `2026-06-30-organic-city-form-design.md`.

## Goal

Coastal cities (`coastalPort`, `water.kind === "sea"`) get a real harbor in the sea:
a **breakwater/mole** hooking out from the shore to shelter a basin, a **lighthouse**
at its tip, a few **piers/jetties** running from the shore into the sheltered water,
and small **moored boats**. This is what makes a port drilldown read as a port.

## Research grounding (medieval/ancient ports + fantasy cartography)

Folded in from a web survey:
1. A port = **breakwater(s)** reducing wave action inside a **protected basin**, with
   **quays (parallel to shore) and piers/jetties (perpendicular)** for mooring; a
   **mole** is a non-floating rubble breakwater extending from land.
2. **Lighthouse/beacon at the breakwater tip.**
3. Draw jetties as **thin rectangles/lines perpendicular to the shore**; ships as
   **small, simple glyphs** ("postage-stamp", don't over-detail at small scale).
4. Warehouses sit along the quay — **already covered by the existing `harbor` ward**
   (zoning labels it), so harbor.ts adds only the WATER structures (no land buildings),
   which also sidesteps collision with existing wards.

Sources: Ancient Ports Antiques (port structures), Mole architecture (Grokipedia),
ProFantasy / Fantasy Map Assets / Map Effects (drawing docks, jetties, ships).

## Components

### 1. `src/engine/city/harbor.ts` (new)

```ts
export interface Boat { at: Point; angle: number }
export interface Harbor {
  breakwater: Polyline;   // shore → out into the sea → elbow that shelters the basin
  lighthouse: Point;      // breakwater tip
  piers: Polyline[];      // short jetties from the shore into the sheltered water
  boats: Boat[];          // moored boats (pier tips + a couple in the basin)
}

export function makeHarbor(
  rng: Rng, water: Water, boundary: Polygon, center: Point, bounds: { w: number; h: number },
): Harbor | null
```

- Returns `null` (drawing NO rng) unless `water.kind === "sea"` — preserves the rng
  stream of every non-coastal city.
- **Shore anchor:** the boundary vertices whose just-outside sample is in water are the
  seaward rim; their mean is `shoreAnchor`. If < 2 such vertices, return `null`.
- `dir` = unit(`shoreAnchor − center`) (toward the sea); `tan` = perpendicular.
- **Breakwater:** `[shoreAnchor, shoreAnchor + dir*reach, tip]` where `tip =
  mid + tan*side*span` (an elbow mole reaching out then turning to enclose a basin);
  `reach`/`span`/`side` from `rng`.
- **Lighthouse:** the breakwater tip.
- **Piers:** 2–3 short jetties `[base, base + dir*len]` where `base = shoreAnchor +
  tan*offset` for a few offsets along the shore (only if `base` is on the water side).
- **Boats:** one at each pier tip + 1–2 in the basin near the breakwater mid, `angle`
  aligned to `dir`.
- Deterministic: all from `rng`.

### 2. `src/engine/city.ts` (modified)

- `CityLayout.harbor: Harbor | null`.
- Generate **last** (after suburbs/outworks, before `return`): `const harbor =
  makeHarbor(rng, water, boundary, [center[0],center[1]], bounds);`. Because it is last
  and draws rng only for sea cities, every existing coastal city's intramural + suburb
  layout stays byte-identical and the harbor is simply appended; non-coastal cities are
  wholly unchanged.

### 3. `src/ui/svgCityRenderer.ts` (modified)

A `.harbor` group drawn just after the water bodies (so piers/breakwater sit on the
sea, under nothing that matters):
- breakwater: thick stone polyline (`#9a8f7a`, width ~3, round caps/joins);
- lighthouse: a small tower — a dot + a short beacon tick at the tip;
- piers: thin timber polylines (`#8a6a44`, width ~1.4);
- boats: a small quad (hull) per boat, oriented by `angle`.

### Determinism / signatures

Public `cityContext` / `generateCityLayout` / `renderCity` unchanged → `app.ts`
untouched. All rng via `deriveSeed(worldSeed, ctx.id)`; `makeHarbor` draws only for
sea cities and only at the end. No `Math.random`.

## Testing

- `harbor.test`: `makeHarbor` returns `null` for `none`/`river`/`lake` water (and does
  not disturb a shared rng — a fresh rng yields the same next value); for a `sea` water
  with a seaward boundary it returns a harbor whose `breakwater` has ≥2 points, a
  `lighthouse` equal to the breakwater tip, ≥1 pier, ≥1 boat; deterministic for a seed.
- `city.test`: a `coastalPort` city has a non-null `harbor` with a breakwater and boats;
  an inland city has `harbor === null`; the golden determinism hash for an inland city is
  unchanged (guards the no-rng-drift contract).
- `svgCityRenderer.test`: a coastal city renders a `.harbor` group with a `.breakwater`,
  a `.lighthouse`, ≥1 `.pier`, and boats; an inland city renders no `.harbor`.

## Non-goals (YAGNI)

Warehouses as separate geometry (the `harbor` ward already covers them), shipyards /
boats-under-construction, customs house, river-specific jetties + fish market
(bridgeTown/meander — a later backlog; the extramural watermill already exists),
animated water. Sea harbor for `coastalPort` only.

## Verification

Dev server serves this worktree, so `preview_eval` can DOM-verify the harbor on a
coastal city drilldown (breakwater/lighthouse/pier/boat counts). Screenshot still times
out; harbor aesthetics need the user's eyes.
