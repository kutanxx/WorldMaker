# Province Sea Lanes — expedition routes so island nations join the war

**Date:** 2026-07-20
**Status:** Approved design
**Feature:** province-sim naval (SP2/content follow-up; the "ⓐ 바닷길/naval" backlog item)

## Why (measured / structural)

The province game (`provinceSim.ts`, `playProvince.html`) builds attack reach purely from LAND
adjacency: `buildProvinceAdj` links two provinces only when a land cell of one neighbours a land
cell of the other. A nation whose provinces are entirely sea-girt therefore has **zero attack
targets and zero attackers** — it can only survive, never conquer, and can never be conquered. If
the player picks such a nation the game has no moves; and in the AI world sea-locked nations are
immortal, making the world less dynamic.

Benchmarks: **Risk** — trans-ocean attacks along a FEW fixed routes drawn on the board (legible;
islands become defensible chokepoints, not unreachable). The cell game already solved the identical
gap for its sim in `2026-07-12-sea-lanes-design.md`; this ports that idea to province granularity.

## Decisions (from brainstorming)

- **Symmetric.** Both the player AND the AI cross lanes. Rejected "player-only" — it would make an
  island a perfectly safe turtle base (attack out, never attacked in), worsening the turtle problem
  SP3 already fought. Symmetry keeps the world honest and islands non-safe.
- **Generous lanes, not just disconnected islands.** Connect genuinely disconnected components AND
  add short-hop lanes between nearby coastal provinces (narrow straits, cross-channel). More ways in
  = less safe turtling, at the cost of a slightly less minimal map. Bounded by a per-province degree
  cap so it stays legible (no spaghetti).
- **Lanes feed solidarity frontier too.** A province linked across a lane to a different owner
  counts as a frontier (its solidarity rises), symmetric with land frontiers — so a contested sea
  coast behaves like a contested land border and islands stay defensible.

## Mechanic

### Generation (`initProvinceSim`, rng-free, deterministic)

New state field `laneAdj: number[][]` on `ProvinceSimState` — province → list of lane-linked
province ids, index-aligned to `provinces` exactly like `adj`. The land-only `adj` is left
untouched (it remains the meaningful land-adjacency graph; lanes are a separate overlay).

`buildSeaLanes(provinceOf, provinces, grid, adj): number[][]`:

1. **Coastal provinces & wharf cells.** A province is *coastal* iff some cell `c` with
   `provinceOf[c] === p` has a neighbour `nb` with `provinceOf[nb] < 0` (sea). Those water-touching
   cells are its *wharf cells* (candidate crossing endpoints).
2. **Candidate pairing distance.** For two coastal provinces `a`, `b` that are NOT already land-
   adjacent (a lane must cross water, never duplicate land), distance = the minimum Euclidean
   distance over `grid.points` between a wharf cell of `a` and a wharf cell of `b`. Nearest-coastal-
   cell, not centroid — so a narrow strait between two big provinces is correctly seen as short.
3. **Short-hop lanes.** Consider candidate pairs with distance ≤ `LANE_MAX_DIST`, in ascending
   distance order (ties → lower `(a, b)` id pair). Add greedily, but skip a pair if either endpoint
   already has `LANE_MAX_DEGREE` lanes (Risk: ~2–4 connections per territory). Bounds spaghetti.
   Starting values (tuned during implementation by eyeballing lane counts so typical worlds get a
   handful of crossings, not a mesh): `LANE_MAX_DIST` ≈ a small multiple of the median inter-cell
   spacing, `LANE_MAX_DEGREE = 3`. Both are generation-time constants, safe to tune (re-pins the
   generation golden only).
4. **Connectivity fallback.** Compute reach-components over `adj ∪ lanes-added-so-far`. Consider
   only components containing ≥1 nation capital (barren wild components need no route). While more
   than one such component exists, join the two closest by their nearest wharf-cell pair (distance
   ignored — a far island still gets exactly one lifeline), respecting nothing but determinism
   (ties → lower id). Guarantees every capital is reachable.

Return an adjacency-list `laneAdj[p] = sorted unique lane partners of p`. Deterministic: two runs
byte-identical.

### Combat (symmetric; `EXPEDITION_MULT` penalty)

Lanes are consumed **alongside** land `adj` wherever attack reach is computed, but an attack that
travels *across a lane* multiplies the ATTACKER's `strength(...)` by `EXPEDITION_MULT` (placeholder
`0.6`; a costly naval invasion — final value set by SP3-style measurement before merge). Defender
strength is unchanged.

- **`armableTargets`** — a province qualifies if it borders a player-owned province by land **or**
  by lane. So sea-locked enemies become attackable.
- **`aiAttacker`** — an attacker candidate for province `p` may be an enemy neighbour by land **or**
  by lane. When the chosen route is a lane, the expedition penalty applies to that attacker's
  strength in the contest.
- **Front selection / contest / `explainAttack` / `predictCapture`** — the front province is the
  player's best-solidarity own neighbour of the target, considering land neighbours first and lane
  neighbours as fallback. **When a target is reachable by BOTH land and lane, the land route (no
  penalty) wins** — a lane is the long way around, never worse than necessary. `explainAttack`
  reflects the penalty in `atk`, and reports a lane crossing in its reason/label so the preview is
  honest.

Implementation shape: a small helper resolves, for (attacker polity, target province), the best
front province + whether it is a lane crossing (→ multiplier). `strength` gains an optional
expedition flag (or the caller applies the multiplier) so land vs. lane share one code path.

### Solidarity frontier

`computeSteppedSol`'s frontier test becomes: `p` is a frontier iff some neighbour in
`adj[p] ∪ laneAdj[p]` has a different owner. So a sea coast facing an enemy across a lane rises like
a land border. This changes the AI-world evolution (goldens re-pinned — see below) and keeps island
coasts defensible so they don't melt under expeditions.

### UI (`provinceApp` / `provinceSim` exports)

- Draw each lane as a dashed route (`.sea-lane`, stroke `#3f5d78`, dash `6 5`, opacity ~0.55,
  `pointer-events: none`) between the two provinces' centroids — you can SEE where invasion is
  possible.
- Lane-reach attack targets flow through the existing green/red forecast overlay unchanged, plus an
  `⚓` tooltip prefix and a slightly different tint to distinguish an expedition target from a land
  target. `explainAttack`'s number/reason already accounts for the penalty, so the forecast stays
  truthful.
- Legend gains one chip (`legendLane` / `⚓ 원정 항로`); the how-to gains one lane clause. KO + EN.

## Golden & determinism

Every province golden is a game-side capture-and-pin (provinceSim is a game-only fork; Version A /
`map.html` never import it). So **re-pin** all three after implementation:
`initProvinceSim` initial owner hash, the 50-tick AI-world hash, the player-path hash. **Version A
golden `polityOf 1350115163` is untouched** (asserted in a test — provinceSim adds no import to the
cell sim). Lane generation and consumption are all inside provinceSim.

## Acceptance (probe-verified before merge; throwaway file policy)

1. **Reachability.** On seeds where a capital was previously in a land-disconnected component, after
   `initProvinceSim` every capital is reachable over `adj ∪ laneAdj`. 0 disconnected capitals by
   construction.
2. **Islands come alive but don't melt.** On such seeds, run the 50-tick AI world: a formerly
   survive-only island nation now participates (a conquest or loss involving a lane occurs across
   some run), yet island nations are not wiped out at a dramatically higher rate than before. If
   islands melt, adjust `EXPEDITION_MULT` once (record numbers).
3. **Non-static signal.** The existing SP1 non-static expectation (top nation grows, alive count
   shrinks over 50 ticks) still holds — report if lanes distort it (that is SP3 balance data, not a
   reason to force constants).
4. **Full suite green** with goldens re-pinned; Version A golden byte-identical.

## Non-goals

Naval units / fleets; lanes that shortcut already-land-connected provinces; player-only crossing;
colonizing barren wild islets; Version A (map.html) rendering of lanes; a global "everyone is one
lane apart" mesh (degree cap prevents this).

## Testing

1. **`buildSeaLanes` unit** — on a land-disconnected seed, yields ≥1 lane and `adj ∪ laneAdj` is
   connected across all capitals; endpoints are coastal; per-province degree ≤ `LANE_MAX_DEGREE`;
   no lane duplicates a land adjacency; deterministic (two runs identical). On a fully land-
   connected seed with no near coasts, may yield none.
2. **Combat** — a lane-reach enemy appears in `armableTargets`; `explainAttack`/`predictCapture`
   across a lane applies `EXPEDITION_MULT` (a target winnable by land is NOT penalized when land
   reach exists); `aiAttacker` can pick a lane enemy.
3. **Solidarity** — a province with only a lane link to a different owner counts as frontier
   (rises), matching a land-frontier province.
4. **provinceApp DOM** — `.sea-lane` path present on a laned seed; lane target `⚓`-tooltipped /
   tinted; legend chip present; KO + EN strings.
5. **Golden guards** — re-pinned province goldens; Version A golden untouched.

## Sources

- `docs/superpowers/specs/2026-07-12-sea-lanes-design.md` (the cell-game precedent this ports).
- [Risk — Sea Connections (fixed routes on the board)](https://risk.fandom.com/wiki/Sea_Connections)
- [Risk map design — 2–4 connections per territory](https://nanjiangames.com/how-to-make-a-risk-board-game-map/)
