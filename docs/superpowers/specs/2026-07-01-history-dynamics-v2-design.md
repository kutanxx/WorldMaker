# History Dynamics v2 — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** History Engine + Chronicle (merged), Timeline Scrubber (merged).

## Problem

The simulated history is predictable/boring: one nation almost always conquers
everything (seed 1 → a single empire by year 500). User wants varied fates —
neutral/free city-states, economic special zones, and great empires that splinter
via civil war.

**Root cause:** contest strength is `total power = Σ solidarity over all cells`
(`history.ts` line 62/93), so **bigger = stronger**, and it compounds → runaway
snowball to total conquest. The only counterforce (fragmentation, prob 0.08,
sheds 30 cells) is far too weak.

This is backwards from the Turchin model it cites: strength should be **asabiyya
(cohesion)**, and large empires **overextend and disintegrate**.

## Research grounding (folded in)

- **Turchin secular cycles / asabiyya:** empires rise on frontier-forged cohesion,
  then overextend → interior cohesion decays → elite strife → **civil war /
  disintegration → collapse → reset**; ~200-300y cycles (our 500y ≈ 2 cycles).
  → strength = **average** asabiyya (size-independent) + admin reach (distance).
- **Free imperial cities / Hanseatic League:** self-ruling cities kept independence
  through **commercial power** (wealth → fortifications, militias) and collective
  defence. → free cities have pinned-high cohesion and strongly resist conquest;
  trade cities are likelier to break free.
- **Staple towns / free ports:** designated trade cities with privileges, a source
  of wealth. → economic zones give a cohesion floor + raise independence propensity.

Sources: Turchin *Secular Cycles* / *War and Peace and War* (asabiyya), Free
imperial city (Wikipedia), Hanseatic League (Wikipedia), Statute of the Staple.

## The four mechanics

All in `src/engine/history.ts`. Determinism unchanged: same separate rng stream
`deriveSeed(worldSeed, 9001/9002)`, world map / cities / URLs byte-unaffected; only
the history object changes.

### 1. Overextension = weakness (core rebalance)

Add `avgSol[p] = agg[p].power / agg[p].cells` (asabiyya). Replace total-power terms
in the border contest with asabiyya + admin reach:

```
strength_attack = avgSol[best]*W_ASA + solidarity[frontierCell]*W_LOCAL − dist(c, capital[best])*W_DIST + zoneBonus(best)
strength_defend = avgSol[o]*W_ASA   + solidarity[c]*W_LOCAL          − dist(c, capital[o])*W_DIST   + zoneBonus(o)
flip if strength_attack > strength_defend * CONTEST_THRESH
```

- `avgSol` is size-independent, so a sprawling low-cohesion empire is **weak at its
  far frontier** (big `dist`, low `avgSol`) → it sheds cells → rise-and-fall.
- Frontier cells still rise in solidarity (asabiyya forged at borders — unchanged),
  interior decays — this now actually matters because avg cohesion drives strength.
- `zoneBonus(p)` = small bonus per economic zone `p` owns (trade wealth).
- Free polities are **excluded as attackers** (a free city does not expand).

### 2. Civil war / disintegration (분열)

Each tick, an alive non-free polity that is **large and low-cohesion** (`cells ≥
CIVILWAR_MIN_CELLS` and `avgSol < CIVILWAR_MAX_ASA`) may (`rng() < CIVILWAR_PROB`)
disintegrate: pick `K` (2 or 3) secession capitals among its cells that are far from
its capital and from each other (farthest-point), then **re-partition all its cells
to the nearest of {old capital, new capitals}** (capital-Voronoi). Each new capital
becomes a successor polity (`origin:"fragment"`). This carves an empire into 2-3
states in one event — the disintegrative phase. At most one civil war per tick.
Event `civilwar`: "내전이 X를 갈라 Y·Z로 쪼갬".

The old small "fragment" (sheds one 30-cell border cluster) is **removed** — civil
war replaces it as the fragmentation mechanic.

### 3. Free cities (중립도시)

Each tick, a city cell (a `world.cities` cell) owned by a low-cohesion polity and
**beyond admin reach** (`dist(cell, capital[owner]) > FREE_REACH`), or an economic-zone
city, may (`rng() < FREE_PROB`, higher for zones) **declare independence**: a new
`origin:"free"` polity claims the city cell + its owned immediate neighbours
(bounded), capital = the city cell. Free polities:

- have solidarity **pinned to `FREE_SOL` (high, ~0.85)** every tick (fortified/wealthy)
  → strongly resist contests via the asabiyya term;
- are **excluded as attackers** (never expand);
- render **neutral grey**, not a nation colour.

Event `independence`: "자유도시 <name> 독립 선포". (Free cities can still be
re-conquered by a powerful empire later — that is fine, adds drama.)

### 4. Economic special zones (경제 특구)

At year 0 pick `ECON_COUNT` (≈3) economic-zone cities from `world.cities`, preferring
coastal, then largest, deterministic via the history rng. Store
`History.economicZones: { cell:number; name:string }[]`.

- Each zone cell gets a **solidarity floor** `ECON_SOL_FLOOR` (~0.55) every tick
  (sustained trade wealth resists decay).
- The owning polity gets `zoneBonus` in the contest (per owned zone).
- Zone cities have a raised chance to become free cities (commercial power).
- Event `staple` at year 0: "<name>, 자유무역항 지정".
- Rendered with a distinct marker on the map.

### New chronicle event types

`HistoryEventType` gains `civilwar`, `independence`, `staple`, `goldenage`. A
`goldenage` fires when a polity first reaches high asabiyya AND size (a positive
milestone: "X, 황금기 도래"). `fragment` type is retired (civil war replaces it).

## Data model

- `HistoryPolity.origin`: `"initial" | "fragment" | "free"`. Add `free: boolean`
  (== origin "free") for renderers that shouldn't import the union.
- `History.economicZones: { cell:number; name:string }[]`.
- `HistoryEventType`: `"found"|"newCity"|"conquer"|"civilwar"|"independence"|"staple"|"goldenage"`.

## Rendering

- `src/ui/politicalLayer.ts`: the `polities` param element gains optional
  `free?: boolean`; free polities fill neutral grey (`#b7b1a4`) instead of
  `nationColor(id)`. Labels/legend still work (they carry the free-city name).
- Economic-zone markers: the app draws a small `.econ-zone` glyph (a diamond/coin)
  at each `history.economicZones` cell on the world SVG (both views), after
  `renderWorld`. `renderWorld` is unchanged; the app overlays them (it already
  overlays the political slot).
- `src/ui/chronicle.ts`: render the new event types (each gets `evt-<type>` class;
  era logic unchanged).

## Tuning targets (verified with a harness across seeds 1-20)

A throwaway measurement (via `preview_eval` importing `simulateHistory`, or a temp
test) reports, per seed at year 500: number of surviving polities, whether one
polity holds > 80% of land ("total conquest"), civil-war count, free-city count.

Goal distribution (not exact): **total-conquest seeds ≤ ~3/20** (was ~all), at least
**half the seeds** end with ≥ 3 surviving polities, **most seeds** see ≥ 1 civil war,
**most seeds** end with ≥ 1 free city, every seed has its 3 econ zones. No instant
collapse (year 0 always the generated map). Constants (`W_ASA, W_LOCAL, W_DIST,
CONTEST_THRESH, CIVILWAR_*, FREE_*, ECON_*`) are tuned empirically to hit this.

## Testing

- `history.test.ts` (extend): determinism (same seed → identical history incl. new
  fields); world map untouched (existing golden world-gen hash unaffected — history
  simulates on a COPY, never mutates `world.polityOf`); across seeds 1-10 the new
  dynamics produce variety — not-all-conquest (at least some seeds end with ≥3
  polities), ≥1 civil war across the set, ≥1 free city across the set, every history
  has 3 econ zones; free polities never appear as an attacker's expansion (a free
  city's cell count never grows); snapshots length still TICKS+1.
- `politicalLayer.test.ts` (extend): a free polity renders grey (not nationColor).
- `chronicle.test.ts` (extend): new event types render rows.
- Full suite green; build clean.

## Non-goals (YAGNI)

Player interaction (that's Version B), diplomacy/alliances/leagues, trade routes as
geometry, population/economy numbers, per-cell culture. Free cities don't form
leagues (just persist). Econ zones are cosmetic + a cohesion floor + independence
bias, not a full economy.

## Verification note

Screenshot still times out; the dev server serves this worktree, so `preview_eval`
DOM/metric-verifies (variety metrics, grey free cities, econ markers). Map colour
aesthetics need the user's eyes.
