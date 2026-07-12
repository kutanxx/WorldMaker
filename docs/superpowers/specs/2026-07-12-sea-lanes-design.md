# Sea Lanes — Risk-style expedition routes so every rival is conquerable

**Date:** 2026-07-12
**Status:** Approved design

## Why (measured)

User: "먼 섬은 상륙이 안 돼서 거기 나라는 점령 자체가 불가능하다." Confirmed and quantified: landing
crosses only `STRAIT_SEA_HOPS = 2` ocean cells, and a reach-graph probe (land adjacency + strait
links, seeds 1–20) found **7/20 worlds where initial capitals span disconnected components** —
conquest victory structurally impossible for anyone on 35% of worlds.

Benchmarks: **Risk** — trans-ocean attacks happen only along FIXED routes drawn on the board
(legible planning; islands become defensible chokepoints instead of unreachable or indefensible).
**Polytopia (Path of the Ocean)** — the port is the gateway to naval power; for us this synergy is
FREE: a founded city near a lane endpoint already strengthens crossings via the existing
`CITY_POWER_BONUS` (rules addition: none; a how-to line: one).

## Mechanic

**Generation (play-only, deterministic, no rng — golden-safe by the straitLinks precedent):**
In `initPlaySim`, after `buildStraitLinks`:
1. Compute reach-components: flood-fill over land adjacency ∪ strait links.
2. Consider only components containing ≥1 initial capital (barren micro-islets stay wild —
   nothing to conquer there; documented).
3. Connect those components into ONE component with a minimum spanning set of lanes: repeatedly
   join the two closest components by their nearest coastal-cell pair (Euclidean over
   `grid.points`). Ties break by lower cell index. Typically 1–2 lanes per affected world
   (Risk lesson: FEW connections — chokepoints, not spaghetti).
4. Store `s.seaLanes: { a: number; b: number }[]` (new play-only SimState field, default `[]` in
   `initSim`, populated only by `initPlaySim`) and a derived lookup `laneLinks: Map<number,
   number[]>` equivalent for the contest/intervention code (implementation detail: may be a
   module-local builder from `seaLanes`).

**Combat (symmetric — bots cross too, so the 35% of dead worlds come alive politically):**
- A lane endpoint can attack the opposite endpoint's cell exactly like a strait target, but with
  `EXPEDITION_MULT = 0.6` instead of `AMPHIB_MULT = 0.85` (a costly naval invasion; initial value,
  tunable). Applied in BOTH stepSim's strait-contest pass (a second, lane-driven pass mirroring
  the strait one, gated inside the same `playerPolity >= 0` block) and `applyIntervention`
  attack / `seaLaunchCell` (player manual attacks; the expedition launch is the player's best
  coastal cell at the NEAR endpoint's side — concretely: lanes contribute to the launch lookup
  exactly like strait links, with the expedition multiplier).
- When a target is reachable BOTH by strait and by lane, the milder strait penalty wins (a lane
  is the long way around; never worse than necessary).
- The lane contest pass records the grudge ledger exactly like the strait pass (both directions).
- Truces apply as everywhere else (the existing truce guards run in the same loops).
- `predictCapture`/preview flow through unchanged (capture resolution is unchanged; only the
  strength multiplier differs).

**UI (playApp):**
- Lanes drawn on the play map as a dashed route line (`.sea-lane`, stroke `#3f5d78`, dash `6 5`,
  opacity ~0.55, `pointer-events: none`) between the two endpoints' coordinates — the Risk board
  affordance: you can SEE where invasion is possible.
- The far endpoint appears among attack targets when capturable (borderTargets gains lane-reach
  targets, `sea: true` plus `lane: true`), tinted a deeper blue than strait landings
  (`rgba(43,80,120,0.3)`), tooltip prefix `⚓`.
- Legend gains one chip (`legendLane`: "원정 항로 / expedition lane"); `howto3` gains the lane
  clause and the port-synergy hint ("항로 곁에 도시를 세우면 원정이 강해집니다"). KO+EN.

## Acceptance (probe-verified before merge, throwaway file policy as before)

1. Reach probe re-run: 0/20 seeds with capitals in disconnected components (by construction).
2. Island survivability: on the 7 previously-blocked seeds, run 30 pure-play ticks (biggest
   nation as a passive player) — island polities must not be wiped out at a dramatically higher
   rate than before (chokepoint + 0.6 mult should keep them defensible); record numbers, adjust
   `EXPEDITION_MULT` once if islands melt.
3. Full suite green (goldens byte-identical — all additions are play-gated).

## Non-goals

Naval units/fleets; lanes between already-connected landmasses (no shortcuts); player-only
crossing (symmetry keeps the world honest); colonizing barren islets; Version A rendering of
lanes (play map only).

## Testing

1. Lane generation unit: on a blocked seed (probe list: 2, 4, 5, 6, 7, 16, 17) `initPlaySim`
   yields ≥1 lane and the reach graph including lanes is connected across capitals; on a
   connected seed it yields none; deterministic (two runs identical); endpoints are coastal land.
2. Combat: a lane-reach enemy cell appears in `borderTargets` with `lane: true`; capturable
   respects `EXPEDITION_MULT`; `applyIntervention` attack across a lane succeeds when strength
   suffices and records the grudge ledger as usual.
3. playApp DOM: on a blocked seed, `.sea-lane` path present; lane target tinted/`⚓`-tooltipped;
   legend chip present.
4. Golden guard: full suite.

## Sources

- [Risk — Sea Connections (fixed routes on the board)](https://risk.fandom.com/wiki/Sea_Connections)
- [Risk map design — 2–4 connections per territory](https://nanjiangames.com/how-to-make-a-risk-board-game-map/)
- [Polytopia — Path of the Ocean (ports as naval gateways)](https://polytopia.io/path-of-the-ocean/)
