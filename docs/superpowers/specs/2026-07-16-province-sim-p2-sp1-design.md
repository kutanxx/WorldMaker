# Province Sim — P2 SP1: the province-evolution engine — design

**Date:** 2026-07-16
**Status:** approved design, pending spec review → plan
**Project:** P2 (game plays in provinces). This spec is **SP1 of 3** — see decomposition below.

## P2 decomposition (context)

The user chose **B) full mechanics** (the game plays in provinces, not cells) and **fork** (a game-only
province sim; the map tool / Version A stays cell-based and golden-safe). P2 is too large for one spec, so:

- **SP1 (this spec):** a headless, deterministic **province-evolution engine** — AI nations own and contest
  whole provinces. No player levers, no UI. Fully testable in isolation.
- **SP2:** player levers (stance / attack / invest / …) + wiring the engine into `play.html` (province map,
  whole-province targeting, borders, meters, victory, replay).
- **SP3:** balance re-tune — sweeps to calibrate difficulty / conquest pace for province granularity.

Deferred out of SP1 (to an SP1 follow-up): civil war, free cities, economic zones (all need rng / extra state).

## Goal

A new pure module `src/engine/provinceSim.ts` that, given a generated `World` (which already carries the P0
`provinceOf` / `provinces` partition) and a seed, simulates nations owning and conquering **whole provinces**
over the same 50-tick horizon the cell sim uses. Version A's `historySim` and its golden hashes are untouched —
`provinceSim` only READS `world.provinceOf` / `world.provinces` and never imports or mutates the cell sim.

## Non-goals (SP1)

- No player: no `playerPolity`, stance, attack, invest, found-city, peace, grudge, sea lanes. (SP2.)
- No civil war / free cities / econ zones. (SP1 follow-up.)
- No UI, no rendering. (SP2.)
- No balance sweep — constants are placeholders reused from the cell sim; SP3 tunes them.

## Data model

Reuses the P0 partition (~100 provinces, ownership-independent geography). A `ProvinceSimState`:

```ts
interface ProvinceSimState {
  provinces: Province[];       // from world.provinces (read-only)
  n: number;                   // provinces.length
  provOwner: Int32Array;       // province → polity id (or -1 = unowned; oceans have no province)
  provSol: Float32Array;       // province → solidarity in [0,1]
  adj: number[][];             // province adjacency (land borders), index-aligned to provinces
  polities: { id: number; capital: number }[]; // capital = the PROVINCE id holding the nation's capital cell
  capitalProv: Int32Array;     // polity id → its capital province (for defeat checks)
  alive: boolean[];            // polity id → still has its capital province
  tick: number;
}
```

- **Adjacency `adj`** (derived once from `provinceOf` + `grid.neighbors`): provinces P and Q are adjacent iff
  some land cell of P has a land-neighbour cell in Q. Built by scanning every land cell's neighbours and
  recording the province pair when they differ (both ≥ 0). Symmetric, de-duplicated. Rng-free.
- **Initial `provOwner`** = each province's majority owner over its cells (reuse the P0/display logic
  `provinceOwners(provinceOf, provinces, world.polityOf)`); a province with no owned cells → -1.
- **Capital province** for a polity = `provinceOf[polity.capital cell]`. `capitalProv[id]` stores it;
  `alive[id]` = `provOwner[capitalProv[id]] === id`.
- **`provSol`** init = `SOL_INIT` (0.5) for owned provinces, 0 for unowned.

## The step — `stepProvinceSim(s)`

Runs once per tick (50 total). Mirrors the cell sim's shape at province granularity. **Rng-free** — the whole
SP1 core is a deterministic function of the partition + initial ownership.

1. **Solidarity update (double-buffered).** For each owned province p, it is a *frontier* province if any
   adjacent province has a different owner. `provSol[p] += frontier ? SOL_RISE : -SOL_DECAY`, clamped [0,1].
   (Reuse `SOL_RISE 0.03` / `SOL_DECAY 0.02` as placeholders.) Write into a fresh buffer, then swap.

2. **Contest & whole-province conquest (double-buffered).** Compute a per-polity aggregate first
   (`cells` = sum of member-province cell counts, `avg` = mean province solidarity weighted by cells). For each
   owned province p, find the adjacent enemy province `q*` whose owner has the highest `avg` (the credible
   aggressor). `strength(polity, distProv, solProv)` mirrors the cell sim's
   `contestStrength(polity, distCell, solCell)`:

   ```
   strength(polity, distProv, solProv) = W_ASA·agg[polity].avg
                                        + W_LOCAL·provSol[solProv]
                                        + W_POWER·√(min(agg[polity].cells, SIZE_CAP))
                                        − W_DIST·distance(distProv.centroid, capitalProv[polity].centroid)
   ```

   - **Attacker** = `strength(owner(q*), p, q*)` — the aggressor's own front province `q*` supplies the local
     solidarity; distance is from the contested province `p` to the aggressor's capital.
   - **Defender** = `strength(owner(p), p, p)` — province `p`'s own solidarity and its distance to its capital.

   (Constants `W_ASA 1.0 / W_LOCAL 0.5 / W_POWER 0.03 / W_DIST 0.002 / SIZE_CAP 24 / CONTEST_THRESH 1.03`
   are placeholders carried over from the cell sim; SP3 retunes.) If `atk > def · CONTEST_THRESH`, province p
   flips to the aggressor **entirely** in the next-owner buffer. Newly-conquered provinces reset to
   `CONQUEST_SOL` (0.7) — a fresh conquest is cohesive, as in the cell sim. Swap buffers, then recompute
   `alive` (a polity that lost its capital province is dead and stops contesting on later ticks).

   Whole-province flips are far coarser than cell flips: at most one province changes per contest per tick, and
   a captured province is 15–30 cells at once. Pacing/coarseness is a balance concern (SP3).

## Determinism / safety

- SP1 is **rng-free**; a seed's world evolves identically every run. No `Math.random`, no `s.rng`.
- New golden anchor pinned in tests: `provOwner` FNV hash after 50 ticks for seed 1 (and the initial-ownership
  hash). These are provinceSim-only.
- **Version A untouched:** provinceSim imports nothing from `historySim`/`playSim`/`intervention`, mutates no
  shared state, and only reads `world.provinceOf` / `world.provinces` / `world.polities` / `world.grid`. A test
  asserts `world.test`'s existing golden hashes (seed-1 polityOf 1350115163, etc.) are unchanged.

## Testing (headless)

- **Adjacency:** provinces sharing a land border are adjacent; non-bordering provinces are not; adjacency is
  symmetric.
- **Initial ownership:** every province maps to the majority owner of its cells; each capital province is owned
  by its own nation; `alive` is all-true at t0.
- **Solidarity:** a frontier province (adjacent to an enemy) rises after a step; a fully-interior province decays.
- **Conquest:** a strong nation's province conquers an adjacent weak enemy province — the whole province's owner
  flips, and it resets to `CONQUEST_SOL`.
- **Capital defeat:** taking a nation's capital province flips `alive[id]` to false and it stops contesting.
- **Determinism:** the seed-1 50-tick `provOwner` golden hash is stable; a small sweep (a few seeds) confirms
  the world is NOT static — ownership concentrates over time (a dominant power emerges), so the engine "does
  something."
- **Version A safety:** the cell-sim golden hashes in `world.test` are byte-unchanged.

## Deliverable

A tested, headless `provinceSim.ts` whose determinism and conquest dynamics are pinned — the verified engine SP2
renders and SP3 tunes.
