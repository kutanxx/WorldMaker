# Player Interventions — Version B sub-project ② (+ playable slice of ③)

Status: approved design (2026-07-06). Turns the empire sim from a passive history playback into a
game: you rule ONE nation, set its stance, and nudge it one action per decade while the existing
Turchin AI runs the rest of the world.

## Goal & framing

- **Survive to year 500** (50 ticks × 10 years). If your capital cell is captured, you are defeated
  (reuses the sim's existing "capital falls ⇒ polity eliminated" rule).
- Otherwise an open **sandbox**: expand, consolidate, develop. At year 500 (or on defeat) show a
  **scorecard**: cells owned, cities, rank among nations, peak size.
- **Vertical slice**: the intervention engine (②) + a minimal `play.html` UI so it is actually
  playable now. Save/load is out of scope (the sim's `rng` is a non-serializable closure — carried
  landmine from ①).

## Hard determinism constraint

The pure history path (`simulateHistory` → the golden `history.test` hashes) MUST stay
byte-identical. Every player mechanic is **gated on `playerPolity >= 0`** (and on `truces`/`stance`
being set). `initSim` keeps `playerPolity = -1`, empty truces, neutral stance ⇒ no behavior change.

## Two levers of agency

The player steers, does not micro-manage — the AI (`stepSim`) runs every nation including the
player's each tick. The player influences via:

### 1. National stance (persistent, changeable any turn)

`Stance = "aggressive" | "defensive" | "internal"` on `SimState.stance` (only meaningful for
`playerPolity`). Applied inside `stepSim`, gated on `playerPolity >= 0`:

- **aggressive** — in the border-contest step, when the player's polity is the ATTACKER, add
  `STANCE_ATTACK_BONUS` to its contest strength; as a cost, the player's cells decay solidarity
  slightly faster (`STANCE_AGGRO_DECAY` extra) → historical overextension.
- **defensive** — two effects so it genuinely *holds* rather than grows: (a) as DEFENDER the
  incoming challenger's required threshold is multiplied up (`STANCE_DEFENSE_MULT`), so player cells
  are harder to take; (b) as ATTACKER the player's contest strength is multiplied DOWN
  (`STANCE_DEFENSE_ATTACK_MULT` < 1) so the AI stops auto-expanding the player's nation.
- **internal** — the player's cells get `STANCE_INTERNAL_RISE` extra solidarity rise (and reduced
  decay), stabilizing the realm; also attacker strength down (like defensive) so it consolidates
  rather than expands.

Neutral default (no player) = none of the above fires. **Changing stance is FREE** — it is a
separate lever from the one action/turn, and can be changed every turn.

### 2. One action per turn (the 4-action set)

`applyIntervention(state, action)` runs BETWEEN `stepSim` calls (before advancing the tick), mutates
`SimState` in place, and returns `{ ok: boolean; message: string }` (message → event log). "Pass"
(no action) is allowed.

1. **Attack a border cell** — `{ type: "attack"; cell }`. `cell` is an enemy-owned cell adjacent to
   the player's territory (chosen from a generated list). Resolution reuses the **same contest
   strength the sim uses** (extracted into `contestStrength(s, attackerPolity, cell)` — see New
   modules), so a player attack is coherent with how the AI resolves the same cell. Capture succeeds
   iff `contestStrength(player, cell) × ATTACK_EDGE ≥ contestStrength(defender, cell)` — the player's
   edge is (a) they pick WHERE and (b) the `ATTACK_EDGE` multiplier (≈1.0, an even fight goes to the
   attacker). On success the cell flips to the player and its solidarity resets to `CONQUEST_SOL`
   (the sim's fresh-conquest value, reused). Attacking a truced polity's cell breaks that truce
   (`truces.delete`). A failed attack still consumes the turn (message: repulsed).
2. **Invest cohesion** — `{ type: "invest"; scope: "nation" | "border" }`. Raise solidarity by
   `INVEST_DELTA` (clamped ≤ 1) on either every player cell (`nation`) or only the player's
   border-adjacent cells (`border`). One-time boost that then decays under the normal sim rules.
3. **Found a city** — `{ type: "foundCity"; cell }`. `cell` is a player-owned cell far enough
   (`CITY_MIN_GAP`, reuse the sim's spacing) from existing cities. Adds a lore city (name via
   `s.nameGen`), records a `newCity` event, and makes the cell a **permanent anchor** in a new
   `SimState.foundedCities` set. The anchor's effects apply **only while the player still owns the
   cell**: (a) it floors that cell's solidarity at `CITY_SOL_FLOOR` each tick and (b) adds
   `CITY_POWER_BONUS` to the player's `contestStrength` for that cell and its neighbours. If the cell
   is captured, the anchor goes inert (no bonus to the captor) but stays in the set (the city still
   exists on the map / in the tally of cities the player founded). Distinct from invest (permanent,
   not decaying) and counts toward the scorecard.
4. **Sue for peace** — `{ type: "peace"; polity }`. `polity` is a hostile neighbour nation (from a
   list). Records `truces.set(polity, s.tick + PEACE_TICKS)`. In `stepSim`'s contest, an attack FROM
   a truced polity ONTO a player cell is skipped while `s.tick < truces.get(polity)`. If the player
   later attacks that polity (action 1 onto its cell), the truce is broken (`truces.delete`).

## SimState additions (all default to the no-player values)

```ts
interface SimState {
  // ...existing...
  playerPolity: number;              // -1 = pure history (default); else the player's polity id
  stance: Stance;                    // inert when playerPolity < 0; default "internal"
  truces: Map<number, number>;       // polityId -> tick until which they won't attack the player; default empty
  foundedCities: Set<number>;        // player-founded anchor cells; default empty
  peakCells: number;                 // max cells the player has held (scorecard); default 0
}
```

`stepSim` gains gated hooks, each a no-op when `playerPolity < 0` / the collection is empty, so the
golden path is unchanged:
- solidarity update: stance rise/decay modifier for player cells + `CITY_SOL_FLOOR` for the player's
  still-owned `foundedCities`.
- contest strength (the extracted `contestStrength`): stance attack/defense modifiers +
  `CITY_POWER_BONUS` for the player's still-owned founded cells.
- contest skip: truce gate (`truces` lookup) for attacks on player cells.
- **player-polity follow on civil war**: the existing civil-war split reassigns cells to new
  successor polities. When `playerPolity >= 0` and the player's polity splits, after the split
  `stepSim` reassigns `s.playerPolity` to the successor that owns the old capital cell (so the player
  keeps ruling the realm that holds their seat) and updates `s.peakCells` from the live owner counts.
  Gated on `playerPolity >= 0`, so the golden path never runs it.

## New modules (isolation)

- **`src/engine/intervention.ts`** — `Action` discriminated union, `applyIntervention(s, action):
  InterventionResult`, and pure helpers to enumerate legal targets: `borderTargets(s)` (enemy cells
  adjacent to the player), `foundCityTargets(s)` (eligible owned cells), `hostileNeighbors(s)`
  (adjacent enemy polities). The UI uses these enumerators to build its lists.
- **`src/engine/playSim.ts`** — thin orchestration: `initPlaySim(world, seed, playerPolity, stance)`
  (calls `initSim`, sets the player fields, `peakCells` from the start, records a snapshot),
  `setStance(s, stance)` (free, any turn), `playTurn(s, action | null): TurnResult` (applyIntervention
  if action → `stepSim` → update `peakCells` → snapshot → compute `{ defeated, year, events }`), and
  `scorecard(s)` (cells / cities-founded-and-held / rank among nations / `peakCells`). `defeated` =
  the player's capital cell is no longer owned by `s.playerPolity` (after the civil-war follow in
  stepSim, a benign split keeps you alive; only a real conquest of the seat defeats you).
- **`historySim.ts`** — the SimState fields + the gated hooks + constants. **Extract** the sim's
  per-cell contest strength (currently inline in the border-contest loop) into an exported
  `contestStrength(s, polity, cell): number` and have BOTH the loop and intervention.ts call it — a
  behavior-preserving refactor verified by the golden hashes (the extracted call must reproduce the
  inline math exactly). Also export the constants intervention.ts reuses: the fresh-conquest
  solidarity (the civil-war birth-sol / `CONQUEST_SOL`) and the city spacing (`CITY_MIN_GAP`, from
  the sim's lore-city founding). `initSim` unchanged externally (defaults). Keep the file focused;
  the intervention *logic* lives in intervention.ts.

## UI (`play.html` + `src/playMain.ts`, replaces the stub)

Minimal, list-driven, reusing existing rendering:
1. **Nation picker** — generate the world (seed from URL hash like map.html, else random), list the
   nations (name + starting size), pick one → start.
2. **Play screen**:
   - **Map**: `renderWorld(world, "political", …)` with a `.political-slot` swapped to the live
     `s.owner` each turn (reuse `politicalLayer`); the player's nation highlighted.
   - **Nation panel**: your cells, avg cohesion, current stance (3 toggle buttons), threatened
     border count, and a ranked nation list.
   - **Action panel**: 4 buttons; each opens a small list/select of legal targets (from the
     intervention enumerators) then confirms. Plus a **Pass** and an **Advance year** button (advance
     applies the chosen action, if any, then steps one tick).
   - **Event log**: reuse the chronicle styling; append this turn's events.
   - **End screen**: defeat (capital fell) or year-500 scorecard.

No Voronoi hit-testing — targeting is entirely via lists/dropdowns.

## Testing

- `intervention.test.ts` — each action: attack (capture on strong edge / repulse on weak; cell flips;
  breaks a truce with the target), invest (nation vs border scope, clamp ≤ 1), foundCity (adds a
  city + anchor set membership + spacing rejects too-close), peace (records a truce with the right
  expiry); plus target enumerators return only legal targets.
- `historySim.test.ts` (golden) — **unchanged and still byte-identical** (the guard): `initSim`
  defaults keep `simulateHistory` identical (the `contestStrength` extraction is behavior-preserving
  — the existing golden hashes are the proof). Add an explicit test that a fresh `SimState` has
  `playerPolity === -1`, empty `truces`/`foundedCities`, `peakCells === 0`.
- `intervention.test.ts` — a **direct single-tick** stance unit test (not a flaky full-run
  comparison): on one identical state, one `stepSim` under `internal` raises a chosen player cell's
  solidarity strictly more than under `aggressive`; and `contestStrength(player, cell)` is higher
  under `aggressive` than `defensive` for the same cell.
- `playSim.test.ts` — `initPlaySim` sets the player fields; `playTurn` advances a tick and reports
  `defeated` when the seat is conquered; a truce blocks the target polity from taking a player border
  cell for `PEACE_TICKS`; and when the player's polity is forced to civil-war, `playerPolity` follows
  the successor holding the old capital (not a defeat).
- `playMain.test.ts` (jsdom smoke) — nation picker renders and selecting a nation mounts the play
  screen with a map, panel, and the 4 action buttons; Advance year updates the year readout.

## Constants (sensible defaults; the player-facing balance is tuned by playing)

`STANCE_ATTACK_BONUS`, `STANCE_AGGRO_DECAY`, `STANCE_DEFENSE_MULT` (defender threshold up, >1),
`STANCE_DEFENSE_ATTACK_MULT` (player attacker strength down, <1 — so defensive/internal hold not
grow), `STANCE_INTERNAL_RISE`, `ATTACK_EDGE` (≈1.0 — even fight wins with the player's pick),
`CONQUEST_SOL` (reuse the sim's fresh-conquest value), `INVEST_DELTA` (≈0.15), `CITY_SOL_FLOOR`
(≈0.55), `CITY_POWER_BONUS`, `PEACE_TICKS` (≈3 = 30 years), `CITY_MIN_GAP` (reuse sim spacing).
Grouped and commented in historySim.ts / intervention.ts so they are easy to sweep.

## Out of scope (later)

Save/load & undo (rng closure non-serializable); AI diplomacy beyond the one-sided truce; multiple
actions per turn; map-click targeting; win-by-conquest goal; per-region stance. These are noted so
the slice stays small.
