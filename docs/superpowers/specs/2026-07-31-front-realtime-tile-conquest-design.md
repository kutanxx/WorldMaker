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

These are **starting values, not final ones** — the whole point of the measurement section is to
move them. They are derived for a map of ~4,000 cells (roughly 2,000 of them land) with 8–12
nations, and they exist so the implementation is not blocked on a judgement call.

| constant | value | why this size |
|---|---|---|
| `TICK_HZ` | 10 | the simulation rate; the UI's animation loop accumulates to it |
| `TROOP_EXP` | 0.6 | taken from OpenFront unchanged — it is the shape, not a magnitude |
| `TROOP_BASE` | 200 | a floor so a one-cell nation is not starved out instantly |
| `TROOP_SCALE` | 60 | 20 cells → cap 562; 200 cells → 1,640; 800 cells → 3,540. Ten times the land yields about 2.9× the cap |
| `REGEN_BASE` | 1 | keeps a nearly-dead nation twitching |
| `REGEN_K` | 0.25 | at 500 troops and an empty pool this is ~23/tick, i.e. ~230/s against a cap of ~1,600 |
| `ATTACK_SPEED` | 0.05 | with a 20-cell border at parity this is ~1 cell/tick, so a 200-cell realm falls in roughly 20 seconds — OpenFront's pace |
| `FORCE_MIN` / `FORCE_MAX` | 0.2 / 3 | a hopeless attack still crawls; an overwhelming one is capped so numbers alone cannot instantly delete a nation |
| `COST_ATK` | 1.0 | attacker pays per cell taken, scaled by terrain |
| `COST_DEF` | 0.6 | the defender bleeds less per cell than the attacker spends, so attacking is genuinely expensive |
| `VICTORY_SHARE` | 0.4 | share of theater land needed to win. OpenFront uses 0.8 with hundreds of players; with ~10 nations that would be a formality |

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
- Victory triggers at the configured share of theater land.
- UI: the HUD shows pool, cap and income; the commit slider shows both percentage and absolute
  troops; clicking a non-adjacent nation does nothing.

## Measurement after it runs

1. **Is it fun to play for two minutes?** This is a feel project; that is the primary question and
   only live play answers it.
2. Does the fill-ratio pressure actually make you spend troops, or do you still hoard?
3. How fast does the map resolve? In OpenFront I was first in 40 seconds — if ours resolves that
   fast, the constants need stretching.
4. **The runaway, which this does not claim to fix:** does one nation still run away? Expect yes.

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
