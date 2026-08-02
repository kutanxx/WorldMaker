# A real-time tile conquest game

**Date:** 2026-07-31 · **New engine:** `src/engine/frontSim.ts` · **New page:** `playFront.html`

This is a **new game**, not a change to `playArmy`. The four existing games stay untouched, as they
have through every previous pivot in this repo.

## Why

`playArmy` works and is deployed, but three consecutive attempts to fix its balance failed, each
from a different wrong diagnosis. The last one ended with a clear finding: **restraint has no
defensive benefit, and no tax can create one** — a tax only makes both strategies worse.

Looking at openfront.io was the user's idea. I read its source and then played it, and the
conclusion is narrower than I first reported:

- **It does not solve the runaway problem.** I went from rank 449 to rank 1 in 25 seconds of
  singleplayer and nothing stopped me. Its `maxTroops ∝ tiles^0.6` damps the feedback loop; it does
  not break it. What actually stops a runaway there is *dozens of humans allying against the
  leader* — the one thing a single-player game cannot borrow.
- **Its moment-to-moment play is much better than ours, and that is the reason to build this.**

So this spec is scoped honestly: **it is a feel project, not a balance fix.** The runaway problem
survives it and is left open.

## What playing it actually showed

Numbers recorded from my own session:

| state | troops / cap | income |
|---|---|---|
| 30% full | 3.5K / 11.8K | **+387/s** |
| 42% full | 8.4K / 19.9K | **+574/s** — peak |
| 91% full | 10.7K / 11.8K | **+106/s** |

**The economy is the game's clock.** Sitting at cap costs you three quarters of your income, so
there is constant pressure to spend troops. Our game has nothing like it: hoarding costs 3% upkeep,
which is why a paced playthrough sat on 5,000 idle men and was punished for nothing.

Three more things only visible in play:

- **Committing is instant and heavy.** Sliding to 66% and attacking cut my standing army from 12.7K
  to 7.57K on the spot. Over-commit and you are naked; under-commit and nothing happens.
- **Eating a neighbour takes seconds, not a campaign.** A wide shared border absorbed an entire
  nation in 11 seconds. This is absorption, not warfare.
  *(Correction, 2026-08-03: this framing does not transfer. Measured across the 18 adjacent nation
  pairs on this generator's map, shared borders run min 5 / median 8 / max 16 cells — nothing here
  is the wide OpenFront-scale border "eating a neighbour in 11 seconds" assumed. Most fronts on this
  map fight over a border in the single digits, not a wide one; see "Opening-play correction" below
  for what that did to the actual play experience.)*
- **You never move anything.** There are no army units. One troop pool, one click, and the whole
  shared border advances.

That last point is why this cannot be grafted onto `playArmy`. Adding a cap formula to a game where
you move stacks province-by-province changes a number, not the way it is played.

## What v1 is

1. **Tile ownership** on the existing 4,000-cell grid. No provinces. `grid.neighbors` already gives
   cell adjacency, so the world generator is untouched.
2. **One troop pool per nation.** No army units, no movement.
3. **Click an adjacent target → the entire shared border advances**, continuously, until the attack
   is cancelled or exhausted.
4. **Troop cap rises sublinearly with territory**; regeneration falls as the pool fills.
5. **Percentage-commit slider.** Committed troops leave the pool immediately.
6. **Fixed-timestep real time** with a command log, so the game stays deterministic.
7. **Canvas rendering.**
8. **AI opponents.**
9. **Victory at a share of the theater landmass.**

Deliberately out: gold, buildings, ports, naval, nukes, alliances. Each can be added later; alliances
are the least useful, since there is nobody to negotiate with.

## Architecture

Four new files. Nothing existing is modified except the landing page's card list.

| file | responsibility |
|---|---|
| `src/engine/frontSim.ts` | state, `tick`, attacks, troop economy, AI, victory |
| `src/ui/frontApp.ts` | canvas renderer, input, HUD, the animation loop |
| `src/ui/frontMain.ts` | entry point |
| `playFront.html` | the page |

Naming follows the existing `armySim` / `armyApp` / `armyMain` / `playArmy.html` convention.

### State

```ts
interface FrontState {
  world: World;
  n: number;                  // cell count
  owner: Int32Array;          // cell -> nation id; -1 unowned land; -2 ocean
  troops: Float64Array;       // nation -> troop pool. There are no army units.
  attacks: Attack[];          // fronts currently advancing
  tick: number;
  scope?: Uint8Array;         // theater mask, same idea as armySim's
}

interface Attack {
  attacker: number;
  target: number;             // nation id, or -1 for unowned land
  pool: number;               // troops committed to this front, already deducted
}
```

`owner` is indexed by **cell**, not province. That single change is what makes border length a real
quantity rather than a derived one.

### The tick is the whole simulation

```ts
export function tick(s: FrontState): void   // economy -> attacks advance -> AI decides -> s.tick++
```

Everything else is a pure query over state. The UI runs an animation loop that calls `tick` at a
fixed rate with an accumulator; **only the UI is real-time.** Player input becomes commands queued
against a tick number and applied at tick boundaries.

This is what preserves determinism: **same seed + same command log = identical game.** Tests drive
`tick` in a plain loop exactly as the current suite drives `endTurn`, with no timers involved. Real
time is a rendering concern, not a simulation one.

### Attacks are state, not events

Clicking a neighbour creates an `Attack` and deducts its `pool` immediately. Each tick, for each
attack in a deterministic order:

1. collect the target's cells that border the attacker — this count **is** the border length
2. capture that many cells, scaled by force:

```
force      = clamp(attack.pool / max(1, troops[target]), FORCE_MIN, FORCE_MAX)
cellsPerTick = force * borderCells * ATTACK_SPEED
```

3. for each captured cell, in priority order:

```
attack.pool   -= COST_ATK * terrainDef(cell)
troops[target] -= COST_DEF * terrainDef(cell)     // skipped for unowned land
owner[cell]    = attacker
```

4. the attack ends when its pool reaches zero, when no cells border the target any more, or when
   the player cancels it. A cancelled attack returns its remaining pool to the nation.

**Unowned land is the cheap case**, as in OpenFront: there is no defender pool, so `force` takes
`FORCE_MAX` and `COST_DEF` is not applied. Early expansion into empty land is fast; taking it off a
neighbour is not.

*(Correction, 2026-08-03: measured across seven seeds, unowned land is only 3.5%-20% of cells at
kickoff, not the "meaningful buffer" this spec assumed when it was written. Most of a game is fought
over already-owned land, so this cheap path matters far less to how a game actually plays out than
the section above implies — see "Balance correction" below.)*

Capture order is by an explicit priority — rougher terrain last, cells with more already-owned
neighbours first — so pockets fill in and the result never depends on iteration order.

Determinism rules, identical to the rest of this repo: no `Math.random()`, no `Date`, no `Set`/`Map`
iteration without an explicit sort, and every tie-break resolves to the lower cell id.

### Economy

Shapes taken from OpenFront, **constants re-derived for a 4,000-cell map** — its thresholds are
written for maps of 100,000+ tiles and do not transfer.

```
maxTroops(n)   = TROOP_BASE + TROOP_SCALE * tiles(n)^TROOP_EXP     // TROOP_EXP = 0.6
regenPerTick(n) = (REGEN_BASE + troops(n)^0.73 * REGEN_K) * (1 - troops(n) / maxTroops(n))
```

The exponent below 1 is what makes conquest yield land faster than power. The `(1 - fill)` term is
what makes sitting at cap wasteful, and it is the single strongest thing in the game to play
against.

### Starting constants

These were **starting values, not final ones** — the whole point of the measurement section was to
move them, and the "Balance correction" section below records that it happened. They were derived
for a map of ~4,000 cells assumed to hold roughly 2,000 land cells with 8–12 nations; measurement
found the real figure is **1,297–1,844** (seven seeds), not ~2,000 — the table below carries the
corrected numbers and the current constant values.

| constant | value | why this size |
|---|---|---|
| `TICK_HZ` | 10 | the simulation rate; the UI's animation loop accumulates to it |
| `TROOP_EXP` | 0.6 | taken from OpenFront unchanged — it is the shape, not a magnitude |
| `TROOP_BASE` | 200 | a floor so a one-cell nation is not starved out instantly |
| `TROOP_SCALE` | 60 | 20 cells → cap 562; 200 cells → 1,640; 800 cells → 3,540. Ten times the land yields about 2.9× the cap |
| `TROOP_START_FRAC` | **0.4** (new, 2026-08-03) | fraction of a nation's own cap it starts with — see "Opening-play correction" |
| `REGEN_BASE` | 1 | keeps a nearly-dead nation twitching |
| `REGEN_K` | 0.25 | at 500 troops and an empty pool this is ~23/tick, i.e. ~230/s against a cap of ~1,600 |
| `ATTACK_SPEED` | **0.02** (2026-08-03; was 0.0075, was originally 0.05) | raised back toward the original after the 0.0075 retune turned out to have slowed every front 6.7×, not just fixed game length — see "Opening-play correction" |
| `FORCE_MIN` / `FORCE_MAX` | 0.2 / 3 | a hopeless attack still crawls; an overwhelming one is capped so numbers alone cannot instantly delete a nation |
| `COST_ATK` | 1.0 | attacker pays per cell taken, scaled by terrain |
| `COST_DEF` | 0.6 | the defender bleeds less per cell than the attacker spends, so attacking is genuinely expensive |
| `VICTORY_GAIN_FRAC` | **0.35** (2026-08-03; was 0.15; replaces `VICTORY_SHARE = 0.4`) | fraction of theater land a nation must *gain* from its own starting count to win — raised to put game length back on the goal instead of on combat speed, see "Opening-play correction" |

`terrainDef(cell)` reuses the existing biome defence weighting rather than inventing a second one.

### Rendering

Canvas, not SVG. Each cell's polygon becomes a `Path2D` built once at mount; each frame fills cells
by owner colour. Repainting 4,000 retained-mode SVG nodes at framerate is not viable, and that is
the only technical reason this must be a new page rather than a mode of the existing one.

### AI

Deliberately simple, in the spirit of `armySim`'s: pick the weakest adjacent neighbour worth taking,
commit a fraction of the pool, keep the front running, stop when the pool is spent. It does not
form alliances and does not check the leaderboard.

## Testing

- Same seed and same command log produce an identical state after N ticks — the standing guarantee.
- A wider shared border captures more cells per tick than a narrow one, all else equal.
- Regeneration falls as the pool fills, and is zero at cap.
- `maxTroops` is sublinear: ten times the territory yields less than ten times the cap.
- Committing troops deducts them from the pool immediately.
- An attack ends when its pool is exhausted.
- Capture order is stable — running the same tick twice from the same state gives the same cells.
- Victory triggers once a nation has gained `VICTORY_GAIN_FRAC` of theater land from its own
  starting count — not at a fixed share of the map (see "Balance correction").
- UI: the HUD shows pool, cap and income; the commit slider shows both percentage and absolute
  troops; clicking a non-adjacent nation does nothing.

## Measurement after it runs

1. **Is it fun to play for two minutes?** This is a feel project; that is the primary question and
   only live play answers it.
2. Does the fill-ratio pressure actually make you spend troops, or do you still hoard?
3. How fast does the map resolve? In OpenFront I was first in 40 seconds — if ours resolves that
   fast, the constants need stretching.
4. **The runaway, which this does not claim to fix:** does one nation still run away? Expect yes.

## Balance correction (2026-08-03)

A review measured seven seeds against the v1 constants above and found the balance unusable:

- **Starting share varied four-fold**, 9%-37% of the map, against a single fixed 40% victory line —
  so a fixed-share goal was never remotely fair between games, or between nations within a game.
- **On seed 7 the player started 2.9 percentage points from victory** (48 cells out of 1,608):
  effectively already won at t=0 by nothing but map-generation luck.
- **Every game resolved in 25-75 seconds**, tripping this spec's own criterion above (`## Measurement
  after it runs`, item 3) for "the constants need stretching."
- **The outcome was decided at t=0.** Across seven seeds, a greedy proxy won in all four where the
  player happened to start as the largest nation, and lost in all three where it did not.

Two derivation errors in this spec's original "Starting constants" section contributed: it sized
`TROOP_SCALE` and the map for "~2,000 land cells" against a measured **1,297-1,844**, and it treated
unowned land as a meaningful buffer when it is only **3.5%-20%** of cells — see the correction note
under "Attacks are state, not events" above.

**Victory is now start-fair, not share-based.** `VICTORY_SHARE = 0.4` (hold 40% of the map) is
replaced by `VICTORY_GAIN_FRAC = 0.15`: a nation must *gain* 15% of theater land from wherever it
personally started, tracked via a new `startCounts` snapshot taken once in `initFrontSim`. This is
the same fix the army game (`armySim.ts`) already made for the identical problem — see `goalGain` /
`goalProgress` / `nationProgress` there — reapplied to this engine rather than shared as code, since
the two engines' state shapes differ. `shareOf` and `landTotal` are unchanged and still power the
HUD; only what counts as *winning* changed.

**Game length was retuned separately.** `ATTACK_SPEED` moved from 0.05 to 0.0075 (a front now
advances roughly 6.7x slower per tick) to bring games into a 2-4 minute target instead of 25-75
seconds. Measured with a greedy proxy (always attacks the weakest reachable neighbour with 50% of
pool) playing as the nation that started largest, `aiStep` running every other nation, both engine
changes applied together:

| seed | before (ticks / seconds) | after (ticks / seconds) | outcome after |
|---|---|---|---|
| 1 | 313 / 31.3s | 2,197 / 219.7s | outpaced by nation 2 |
| 2 | 386 / 38.6s | 1,269 / 126.9s | victory |
| 3 | 322 / 32.2s | 1,605 / 160.5s | victory |
| 4 | 302 / 30.2s | 2,134 / 213.4s | outpaced by nation 5 |
| 5 | 387 / 38.7s | 2,394 / 239.4s | outpaced by nation 2 |
| 6 | 175 / 17.5s | 1,161 / 116.1s | victory |
| 7 | 353 / 35.3s | 1,720 / 172.0s | outpaced by nation 6 |

("before" already has the start-fair victory rule applied, at the original `ATTACK_SPEED = 0.05` —
it isolates what the speed retune alone changed.)

Every seed moved into or within a few percent of the 2-4 minute (1,200-2,400 tick) target — none got
shorter. **Seed 6 landed 39 ticks (3.9s) under the 1,200-tick floor**, the one seed that did not
fully clear the target window; it was left as-is rather than chasing it exactly, since tightening
further would have pushed seed 5 (already at 2,394) over the 2,400-tick ceiling instead. **Seeds 3
and 7 flipped their win/loss outcome** between the two runs (3: loss to win; 7: win to loss) — a side
effect of `aiStep`'s rivals getting far more ticks to act once the game runs longer, not a defect;
flagged here because a result flip is the kind of thing measurement write-ups in this repo have
previously omitted.

## Opening-play correction (2026-08-03)

Live play surfaced a second problem, separate from the balance correction above: **territory did
not spread.** It grew at one or two spots and crept outward in a thin line from there.

Two measurements explain why:

- **Shared borders on this map are narrow.** Across the 18 adjacent nation pairs generated, border
  width runs **min 5, median 8, max 16 cells** — this is what the "wide border absorbs a whole
  nation in eleven seconds" framing borrowed from OpenFront (see the correction note under "What
  playing it actually showed" above) missed: there is no map-wide wide border here to absorb
  anything quickly, only narrow ones by default.
- **Nations started at 4% of their own cap.** `initFrontSim` filled every nation's troop pool with a
  flat `TROOP_BASE / 2 = 100`, a number written before the cap formula (`maxTroops`) existed and
  never revisited — against a typical cap in the low thousands, 100 troops is nothing. With a pool
  that small, `force = pool / troops[target]` clamped to `FORCE_MIN` on nearly every front, and a
  median-width (8-cell) front took **8.3 seconds per cell** to advance. That is the dead opening the
  user described.

### Starting troops now scale with the nation, not a flat number

`initFrontSim` now fills each nation's pool to `TROOP_START_FRAC * maxTroops(nation)` — a fraction
of what that specific nation's own land already supports, instead of one constant shared by a
1-cell nation and a 40-cell one alike.

The fraction was derived, not picked by feel. `regenPerTick(t) = (REGEN_BASE + t^REGEN_EXP * REGEN_K)
* (1 - t/max)` peaks partway to the cap — sitting there is where a nation's economy is doing the most
work per tick, so starting there means a fresh nation begins at its most productive point instead of
the starved corner the `(1 - t/max)` term was built to punish. Dropping the additive `REGEN_BASE` term
(negligible once `t` is more than a handful of troops), the peak has a closed form:
`t/max = REGEN_EXP / (1 + REGEN_EXP) = 0.73 / 1.73 ≈ 0.422`. Measured numerically **with**
`REGEN_BASE` included, across caps from 562 (a 20-cell nation) to 3,540 (an 800-cell one), the true
optimum sits at **0.40–0.42** of the cap. `TROOP_START_FRAC = 0.4` was chosen from that range.

### Game length belongs on the goal, not on combat speed

The balance correction above fixed game length by cutting `ATTACK_SPEED` from 0.05 to 0.0075 — a
6.7× slowdown of every front on the map, opening included, which is the other half of why the game
felt dead at the start. **Combat speed and game length are different knobs**: `ATTACK_SPEED`
controls how alive a single front feels tick to tick, while `VICTORY_GAIN_FRAC` controls how much
territory a game actually requires — stretching a game by making combat crawl pays for length by
spending the one thing (a responsive front) this whole engine exists to deliver.

`ATTACK_SPEED` is raised back toward 0.05, to **0.02** — not all the way, because at 0.05 the far
larger starting pools above make the early game so decisive that several seeds' greedy playouts
either resolved in a few hundred ticks regardless of `VICTORY_GAIN_FRAC`, or (past a `VICTORY_GAIN_FRAC`
threshold around 0.45) stopped resolving at all within 8,000 ticks — two greedy nations locked in a
back-and-forth neither could break. `0.02` was the fastest speed that stayed stable across all seven
measured seeds while still landing typical games in the target window. Game length itself is
recovered by raising `VICTORY_GAIN_FRAC` from 0.15 to **0.35**, so the goal — not the front — is what
now sets how long a game runs.

Measured with a throwaway driver (`aiStep` applied to *every* nation each tick, including the one
being measured — the same greedy "always attack the weakest reachable neighbour with half the pool"
logic `aiStep` already uses for opponents, run against itself). For each of the seven seeds already
used in the balance correction above, the tracked nation is the one that started with the most land;
ticks are counted until `outcome()` returns non-null:

| seed | before (flat troops, `ATTACK_SPEED=0.0075`, `VICTORY_GAIN_FRAC=0.15`) | after (`TROOP_START_FRAC=0.4`, `ATTACK_SPEED=0.02`, `VICTORY_GAIN_FRAC=0.35`) | outcome after |
|---|---|---|---|
| 1 | 2,013 ticks | 1,576 ticks | victory |
| 2 | 4,437 ticks | 1,506 ticks | victory |
| 3 | 1,606 ticks | 1,827 ticks | outpaced by nation 4 |
| 4 | 2,135 ticks | **901 ticks** | defeat |
| 5 | 1,841 ticks | 2,399 ticks | victory |
| 6 | 1,162 ticks | 1,447 ticks | victory |
| 7 | 1,721 ticks | 1,217 ticks | outpaced by nation 2 |

Six of the seven land inside the 1,200-2,400 tick (2-4 minute) target, five of them comfortably so.
**Seed 4 is the one seed that moved against the change**, and by a lot: from 2,135 ticks (outpaced)
under the old constants to 901 ticks (defeat) under the new ones — the tracked nation is eliminated
entirely, well under the floor. This is not something `VICTORY_GAIN_FRAC` can fix: elimination
(`s.tiles[player] === 0`) is independent of the goal fraction, and 901 ticks came out identical
across every `VICTORY_GAIN_FRAC` value tried in the sweep that produced 0.35. The larger starting
pools mean an early misstep against a stronger neighbour is now fatal much faster than it was when
everyone opened at a flat, nearly-defenceless 100 troops — a real behavioural change from committing
is instant and heavy applying from the very first tick, not a bug in the tuning. It is left as a
known outlier rather than chased, the same way the prior correction left seed 6 under its own floor
rather than push seed 5 over its ceiling.

The number the user actually feels — how long it takes a median-width (8-cell) front to take one
cell, committing the entire pool, from the fresh starting state — dropped from 8.3s (old constants,
`FORCE_MIN`-clamped) to **0.43-0.91s** across the same seven seeds (`force` now varies 0.68-1.45,
no longer clamped, because both sides start with troop counts proportional to their own land instead
of an equal flat number):

| seed | force | ticks/cell | sec/cell |
|---|---|---|---|
| 1 | 0.684 | 9.14 | 0.914 |
| 2 | 1.275 | 4.90 | 0.490 |
| 3 | 0.923 | 6.77 | 0.677 |
| 4 | 0.752 | 8.31 | 0.831 |
| 5 | 0.766 | 8.16 | 0.816 |
| 6 | 1.185 | 5.27 | 0.527 |
| 7 | 1.454 | 4.30 | 0.430 |

Every seed lands under a second, most well under it.

## What this does not do

**It does not fix the snowball.** `tiles^0.6` slows the loop; conquering someone weaker still pays,
still raises your ceiling, and still compounds — I confirmed this by playing, after initially
claiming the opposite from too narrow a window of data. In OpenFront the brake is other humans
ganging up on the leader, and a single-player game has no such thing.

If the runaway needs solving afterwards, the honest candidate is the thing OpenFront does socially
and we would have to do mechanically: **AI opponents that recognise the leader and coordinate
against them.** That is a separate project, and this repo already has a crude first version of it in
`armySim`'s leader-check.

## Prior art in this repo

Every previous game here survived its successor: `map.html`, `play.html`, `playProvince.html` and
`playArmy.html` are all still live. This follows that pattern rather than replacing anything. The
world generator — roughly 90% of the source — is shared and untouched.
