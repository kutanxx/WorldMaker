# Army prototype — the AI checks the race leader

**Date:** 2026-07-28 · **Engine:** `src/engine/armySim.ts` · **Page:** `playArmy.html`

## The problem

In seed 11 the same 29-province giant wins every game. A player starting at 11 or 14
provinces loses to it — not to an AI playing well, but to a runaway leader nobody opposes.

Two mechanisms produce this, and only one of them is addressed here.

**Mechanism A — the AI systematically avoids the strongest nation.** `aiObjective` scores a
target as `pop / (1 + defence)` and never looks at who owns it. Defence counts the enemy army
and its militia, so a strong neighbour scores *low*. The AI is therefore steered toward weak
neighbours and unowned wasteland, and the leader is attacked only by accident. The AI does not
know a race is happening.

**Mechanism B — production scales with size, the goal does not.** An AI levies from
`ceil(owned × AI_LEVY_FRAC)` provinces, so 29 provinces muster from 8 and 11 provinces muster
from 3. The victory goal is `round(GOAL_GAIN_FRAC × theater land)` — the same absolute number
for everyone. A big nation runs the same race roughly 2.7× faster.

This spec fixes **A only**. B is structural and would mean changing what victory is; we do not
touch it here. If the giant still wins after this change, B is the reason, and we will know
that from measurement rather than from argument.

## What changes

The AI learns who is winning the race and prefers to attack them — but only among fights it
was already going to win.

### 1. Who counts as the leader

New `raceLeader(s: ArmyState): number`.

- Score is `nationProgress(n).gained` — conquest relative to that nation's own start.
- **The player is included.** The player leading is the case this most needs to cover.
- Only nations still holding land inside the theater are considered.
- Ties break on the lower polity id. Returns `-1` when no nation qualifies.

Size is deliberately *not* the metric. This game replaced an absolute "hold 40% of the world"
goal with a start-fair additive one because size at t0 is an accident of map generation.
Targeting by size would reintroduce exactly the unfairness that decision removed: a large
nation sitting still and gaining nothing would be dogpiled for existing.

The existing `leadingRival(s, player)` is unchanged and stays. It excludes the player and
feeds the HUD's `추격` display; `raceLeader` includes everyone and feeds the AI. Two callers,
two questions, two functions.

### 2. How the AI reacts

One new constant:

```ts
export const AI_LEADER_BIAS = 2;
```

Both places that score a target — `aiObjective` and the per-army fight-target loop inside
`aiTurn` — multiply the score when the target province belongs to the leader:

```ts
score = (pop / (1 + def)) * (leader >= 0 && owner === leader ? AI_LEADER_BIAS : 1)
```

The `leader >= 0` guard is load-bearing: unowned provinces carry `owner === -1` and
`raceLeader` returns `-1` when no nation qualifies, so without it every wasteland province
would be treated as belonging to the leader.

`aiObjective` takes the leader as an optional third parameter defaulting to `-1`, so its
existing callers and tests keep working unchanged and the default is "no bias".

**The `d >= army.men` winnability gate is untouched.** This is the safety property of the
design, not an omission.

The previous balance lever on this AI (`AI_ODDS_MIN`, requiring good odds before attacking)
backfired and was reverted: because a winner loses `round(def × 0.6 × closeness)`, a rout is
cheap and a near-run fight is ruinous, so making the AI cautious made it *more* efficient and
stronger. The same arithmetic runs in reverse here. The leader is by definition strong, so
pushing AI armies into the leader would produce close fights, and close fights bleed the
winner. An AI forced to attack the leader would grind itself down and hand the game to whoever
stayed out of it.

So the bias **reorders preference among winnable targets and nothing else**. An AI that cannot
win where it stands still marches to its front and still declines fights it would lose.

### 3. The player must be able to see it

When the player is the race leader, the HUD says so — the AI is now behaving differently
because of the player's standing, and an unannounced dogpile reads as random unfairness rather
than as a mechanic. Every prior pass on this repo (P1 counter, P2 forecast, P3 margin, P4b
consolidation) was the same axis: what the player is judged by must be on screen.

### 4. Determinism

The leader is computed **once per `aiTurn` call**, before the per-nation loop, so every AI in
a turn reacts to the same leader and the result does not depend on nation processing order.
No `Math.random()`; `raceLeader` is a pure function of state with an explicit tie-break.

## Testing

- `raceLeader` picks the highest `gained`, includes the player, breaks ties on lower id,
  ignores nations outside the theater, and returns `-1` on an empty board.
- The bias reorders choice between two targets the army could beat.
- **The bias never causes an attack the AI would otherwise decline** — an army adjacent to a
  leader province it cannot beat still does not attack it.
- The leader is fixed for the whole turn: nation processing order does not change the outcome.
- Same seed, same commands, identical game (the standing determinism guarantee).

## Measurement after merge

1. Seed 11: does the 29-province giant still win every game? If yes, mechanism B is the cause.
2. The backfire check: are AI nations collectively weaker (fewer total provinces gained,
   more armies destroyed) than before the change? That is the `AI_ODDS_MIN` failure mode and
   it must be looked for, not assumed absent.
3. The player-leads case: does a strong player start still walk to victory?

Bot measurement is a proxy and has been wrong on this engine before. Live play by the user
outranks it.

## Reverting

Set `AI_LEADER_BIAS = 1` and the AI behaves exactly as it does today. One line.
