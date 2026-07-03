# Steppable History Engine (Version B, Sub-project 1) — Design

Date: 2026-07-03

## Context

Version B is the interactive empire sim: the player is the **ruler of one nation** (HOI-lite)
who advances the world year by year and intervenes (attack a border, invest in cohesion,
found a city, sue for peace). It decomposes into three sub-projects, built in order:

1. **Steppable engine core** (this spec) — refactor the batch `simulateHistory` into a
   steppable engine so a driver can advance one tick at a time.
2. Player interventions (engine) — `applyIntervention(state, action)` between steps.
3. Play-mode UI — pick your nation, "advance year", control panel, live map + event log.

Today `simulateHistory(world, seed)` (`src/engine/history.ts`) runs all 50 ticks × 10 years
in one monolithic loop and returns the whole `History` (polities, events, snapshots,
economicZones). The timeline scrubber replays those precomputed snapshots. An interactive
sim needs to step one tick at a time and inject player actions between ticks — impossible
with the monolithic loop.

## Goal

Extract the tick loop into a steppable engine (`SimState` + `initSim` + `stepSim`) with
**zero behavior change**: `simulateHistory` becomes a thin wrapper that loops `stepSim`, and
its output stays **byte-identical** to today's. This unblocks sub-projects 2–3 while keeping
the existing chronicle/timeline/gazetteer working untouched.

## Non-goals (later sub-projects)

- Player interventions / actions (sub-project 2).
- Play-mode UI, player-nation selection (sub-project 3).
- Save/load or undo of a running sim (would need a serializable rng — see Determinism).

## Approach

Chosen: **refactor `simulateHistory` in place into init + step; batch wrapper reproduces it.**
Alternatives considered and rejected:
- *Separate interactive engine that re-implements the mechanics* — two divergent engines make
  the world behave differently in the chronicle vs play mode, doubling maintenance; violates
  the roadmap's "reuse the same history engine."
- *Precompute the full timeline, then branch by re-simulating from an edited snapshot* —
  branching from an arbitrary mid-timeline state requires the sim to accept an arbitrary
  starting `SimState`, which *is* the steppable refactor. Collapses into the chosen approach.

## Architecture

### New module `src/engine/historySim.ts`

Holds `SimState`, `initSim`, `stepSim`, the tick constants, and the helper functions. The
state carried across ticks is exactly the loop-carried variables of today's loop — nothing
speculative.

```ts
export interface SimState {
  // immutable world references (read-only during the sim)
  grid: World["grid"];
  terrain: number[];
  n: number;
  // mutable simulation state (advanced by stepSim)
  owner: Int32Array;
  solidarity: Float32Array;
  polities: HistoryPolity[];
  capitals: number[];
  alive: boolean[];
  golden: boolean[];
  rng: Rng;            // mulberry32 closure, carried across steps (draw order preserved)
  nameGen: NameGen;
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
  economicZones: EconomicZone[];
  zoneCells: Set<number>;
  cityCells: { cell: number; name: string }[];
  tick: number;        // 0 after initSim; stepSim increments to 1..TICKS
}

export function initSim(world: World, worldSeed: number): SimState;
export function stepSim(state: SimState): void; // mutates in place, advances one tick
```

`initSim` performs everything today's function does **before** the loop: `owner =
Int32Array.from(polityOf)`, solidarity init (`SOL_INIT` on land), `polities` from
`world.polities`, `capitals`/`alive`/`golden`, the two derived-seed generators
(`rng` = `mulberry32(deriveSeed(worldSeed, HISTORY_SALT))`, `nameGen` =
`makeNameGen(mulberry32(deriveSeed(worldSeed, HISTORY_SALT+1)))`), the year-0 `found` and
`staple` events, `economicZones`/`zoneCells`/`cityCells`, and the year-0 snapshot. `tick = 0`.

`stepSim` is today's loop **body for one tick**, in the identical order: solidarity update
(double-buffered) → border contests → conquest → civil war → free city → golden age →
new city → push snapshot. It computes `year = (state.tick + 1) * YEARS_PER_TICK`, does the
work, then sets `state.tick++`. **The rng is drawn in the exact same order and count per
tick** (civil war, then free city, then new city gates), so the sequence is preserved.

Today's closures become module-level helpers taking the state (or the specific arrays they
need): `aggregate(state)`, `zoneBonus(state, p)`, `farthest(state, cells, seed, count)`,
`dist(state, a, b)` (or a small `px/py/dist` trio bound to `state.grid`). Constants
(`TICKS`, `YEARS_PER_TICK`, weights, thresholds, palettes) move to `historySim.ts`.

### `src/engine/history.ts` becomes the batch wrapper

```ts
export function simulateHistory(world: World, worldSeed: number): History {
  const s = initSim(world, worldSeed);
  for (let t = 1; t <= TICKS; t++) stepSim(s);
  return {
    years: TICKS * YEARS_PER_TICK,
    polities: s.polities, events: s.events,
    snapshots: s.snapshots, economicZones: s.economicZones,
  };
}
```

The `History*` interfaces (`HistoryPolity`, `HistoryEvent`, `HistorySnapshot`,
`EconomicZone`, `History`, `HistoryEventType`) either stay in `history.ts` and are imported
by `historySim.ts`, or move to `historySim.ts` and are re-exported by `history.ts`. **The
public API of `history.ts` (the `simulateHistory` function and all exported types) is
unchanged**, so `app.ts`, `timeline.ts`, `chronicle.ts`, `gazetteer.ts`, and every existing
test keep working with no edits.

## Determinism (the crux)

The whole refactor is validated by exact reproduction:

- `SimState.rng` is the mulberry32 **closure**, created once in `initSim` and carried across
  every `stepSim`, so the draw sequence is continuous and identical to today's single loop.
- `stepSim` preserves the per-tick single-event semantics (each of civil war / free city /
  golden age / new city fires at most once per tick, `break`-equivalent) and the exact draw
  order within a tick.

**Two landmines that would silently break rng reproduction — the plan must call these out:**

1. **`polities` grows mid-tick.** The civil-war and free-city blocks `push` new polities into
   `state.polities` during a single `stepSim`. The subsequent blocks (free city, golden age,
   new city) iterate `0..state.polities.length` and depend on that grown length and on the
   block order. **Do not reorder the blocks and do not cache `polities.length`** in a local —
   read it live each block, exactly as the current loop does. Reordering or caching changes
   the rng draw count and the set of eligible candidates.
2. **`solidarity` is reassigned each tick.** `stepSim` computes `nextSol` then sets
   `state.solidarity = nextSol`. The civil-war block later writes `CIVILWAR_BIRTH_SOL` into
   solidarity — that write must land in the **new** array via `state.solidarity[c] = …`. Do
   not keep a stale local reference to the pre-reassignment array.

**Golden anchor (captured from the current code before refactor).** The anchor covers three
independent facets so a bug that keeps ownership identical while drifting event text or polity
lifecycle is still caught:

| seed | snaps | pols | events | econ | allSnapHash | eventsHash | politiesHash |
|------|-------|------|--------|------|-------------|------------|--------------|
| 1 | 51 | 14 | 31 | 3 | 2796185232 | 3677329610 | 4247206507 |
| 2 | 51 | 15 | 38 | 3 |  999977846 | 1287836464 | 1375770347 |
| 3 | 51 | 16 | 44 | 3 | 4292460260 | 4115537623 | 2430550014 |

The hashes use FNV-1a folding `fold(h,x) = imul(h ^ (x>>>0), 16777619) >>> 0` from seed
`2166136261`:
- `allSnapHash` = fold every snapshot's owner (`fold` of each `owner[i]+1`) into one hash — a
  whole-timeline ownership anchor.
- `eventsHash` = fold, per event in order: `year`, `fnvStr(type)`, `polityId+1`,
  `(otherId ?? -1)+1`, `(cell ?? -1)+1`, `fnvStr(text)`.
- `politiesHash` = fold, per polity in order: `id+1`, `capital+1`, `foundedYear`,
  `(endedYear ?? -1)+1`, `fnvStr(origin)`, `fnvStr(name)`, `free?1:0`.
- `fnvStr(s)` = fold each `s.charCodeAt(i)`.

Note: `SimState.rng` as a closure is **not serializable**, which is fine for in-memory
stepping (sub-projects 2–3 run in one session). A future save/load/undo feature would need
`mulberry32` to expose its internal state; explicitly out of scope here.

## Testing

`src/engine/historySim.test.ts` (new):
- `initSim` yields the year-0 state: `tick === 0`, one snapshot at year 0, `owner` equals
  `Int32Array.from(world.polityOf)`, `polities.length === world.polities.length` all
  `origin:"initial"`, year-0 events include a `found` per polity and a `staple` per econ zone.
- `stepSim` advances one tick: `tick` increments, a snapshot is appended, its `year` is
  `tick * 10`, `owner` length is `n`.
- Determinism: two `initSim`+`stepSim`×50 runs on the same seed produce identical
  `allSnapHash`.

`src/engine/history.test.ts` (existing 12 tests — must stay green, proving behavior
preserved) **plus** a new golden-anchor test: for seeds 1–3, assert `simulateHistory`'s
`snapshots.length`, `polities.length`, `events.length`, `economicZones.length`, `allSnapHash`,
`eventsHash`, and `politiesHash` equal the pinned values above. (Add the `fold`/`fnvStr`/facet
helpers to the test, exactly as specified in the Determinism section.)

## File structure

- `src/engine/historySim.ts` — new: `SimState`, `initSim`, `stepSim`, constants, helpers,
  and (decision) the `History*` interfaces. `history.ts` re-exports the types with
  `export type { History, HistoryPolity, HistoryEvent, HistoryEventType, HistorySnapshot,
  EconomicZone } from "./historySim";` so every existing `from "./history"` import is
  unaffected. Runtime deps flow one way only (history.ts → historySim.ts); historySim.ts
  imports no runtime value from history.ts, so there is no cycle.
- `src/engine/history.ts` — shrinks to the batch wrapper + type re-exports (imports
  `initSim`, `stepSim`, `TICKS`, `YEARS_PER_TICK` from `historySim.ts`).
- `src/engine/historySim.test.ts` — new unit tests.
- `src/engine/history.test.ts` — unchanged tests + golden-anchor test.

No other files change (public API preserved).
