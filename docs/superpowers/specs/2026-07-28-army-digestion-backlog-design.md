# Army prototype — conquered land takes time to digest

**Date:** 2026-07-28 · **Engine:** `src/engine/armySim.ts` · **Page:** `playArmy.html`

## The problem, re-diagnosed

The previous spec (`2026-07-28-army-leader-check-design.md`) named a "mechanism B": production
scales with size while the goal is a flat number, so a big nation runs the same race faster.
**Measurement does not support that explanation, and this spec replaces it.**

An all-AI run of five worlds, recording every nation's start against what it achieved:

| seed | nation | start | result |
|---|---|---|---|
| 42 | n4 | 17 provinces, **5,088 population — richest in the world** | peak gain **0**, ended with **0 provinces** |
| 11 | n7 | 17 provinces, 3,333 population (2nd) | peak gain **0**, ended with **0 provinces** |
| 11 | n4 | 14 provinces, 2,035 population (4th) | gain **+31**, reached the goal at t46 |
| 1 | n5 | 24 provinces, 7,167 population (1st) | peak gain 7, nobody won |

The richest nation in a world is annihilated without gaining anything; a mid-sized one wins.
Size is not destiny, so "big start ⇒ structural win" is the wrong model.

What the data does show is the shape of the outcome. Seed 11's peak gains, ranked:

```
38 · 31 · 7 · 2 · 1 · 0 · 0 · 0
```

One or two nations run away and everyone else sits near zero. Winners end at 44, 61 and 53
provinces from starts of 29, 28 and 20 — they roughly double or triple.

**The real mechanism is that conquest compounds and nothing damps it.** Capture transfers a
province *and its population*, which is levyable the next turn: population → men → capture → more
population. The only outflow is upkeep at 3% of men, which for a 6,000-man realm is ~180 men a
turn against a levy income of ~1,200 — not a brake. Start size only weights the opening coin flip;
after that the loop decides, which is why the richest nation can die and a fourth-place one can
win.

This also means a goal proportional to starting size — the obvious fix for the old diagnosis —
would not help. The runaway does not come from where a nation starts.

## What changes

Conquered land does not fight for you immediately. It has to be digested, and a realm can only
digest so much at a time.

### 1. Raw provinces

`ArmyState.raw?: Int32Array` — province → the turn it was captured, or `-1` for land that is
digested or was never taken. **Optional and lazily allocated**, exactly mirroring the existing
`leviedOn` field, so hand-built fixtures that predate it keep compiling and a missing array
behaves everywhere as "nothing is raw".

Starting territory is not raw. Recapturing land — including land you previously owned — marks it
raw again; a province changing hands repeatedly on a contested front is expensive to hold, which
is the intended reading.

### 2. Capture marks

`moveArmy` has exactly one line that transfers ownership (`s.owner[target] = nation`). Marking
happens there, so there is no second path a capture could take.

### 3. Digestion has a fixed capacity

In `endTurn`, after upkeep and regrowth, **every nation including the player's** integrates its
`DIGEST_PER_TURN` **oldest** raw provinces — oldest meaning the smallest captured-turn, ties broken
on the lower province id. A nation with nothing raw is a no-op.

Rawness is a property of the **province**, not of a nation, and a nation's backlog is derived by
asking which of its owned provinces are raw. So when a province is lost, it leaves the old owner's
backlog and enters the new owner's automatically — there is no per-nation bookkeeping to keep in
sync, and no way for the two to disagree.

```ts
export const DIGEST_PER_TURN = 1;
```

**The capacity is fixed and does not scale with realm size. That single property is the whole
design.** A damper proportional to conquest *volume* taxes a small nation catching up exactly as
hard as a runaway — in relative terms harder, since a small realm must conquer more of its own
size to compete. A fixed capacity taxes conquest *rate* instead, and the measured rates separate
cleanly:

| nation | measured rate | effect |
|---|---|---|
| seed 11 n4, the 14-province winner | 31 gained over 46 turns = **0.67/turn** | under capacity — backlog never accumulates, effectively unaffected |
| seed 11 n6, the runaway | 38 over 28 turns = **1.35/turn** | backlog grows ~0.35/turn, forever |
| seed 42 n0, the runaway | 40 over 23 turns = **1.74/turn** | backlog grows ~0.74/turn, forever |

The damping is also self-limiting rather than a cliff: as the backlog grows, less of the realm can
levy, so the conquest rate falls toward the digestion rate. Sustained expansion converges to about
one province per turn instead of being capped by a hard rule.

### 4. Raw land blocks levy and nothing else

`canLevy` returns false for a raw province. That is the only gate — it is already the single point
every levy path goes through, including the AI's.

Raw provinces still provide **militia when attacked**: the population is there, it simply will not
march for you. They still count toward province totals and the victory goal — you own them.

### 5. The player has to be able to see it

The player's new decision is *how fast to expand*, and a player who cannot see the backlog cannot
pace anything. Three places:

- the map marks raw provinces
- the levy button says **why** it is unavailable — the same pattern as the existing
  `징집 완료 (이번 턴)` state, not a silently disabled control
- the HUD shows how many provinces are waiting to be digested

### 6. The AI is not taught about this

The AI keeps taking whatever it can. It will over-eat and pay for it. That is the intended
direction — the runaway this exists to slow is usually an AI — and it leaves the informed player a
genuine advantage in pacing, which is the kind of lever this repo has repeatedly found works.

**One exception, added after review found it inverts the design.** `aiTurn` fills a levy quota of
`max(1, ceil(owned × AI_LEVY_FRAC))` provinces, taken in population order. Raw provinces sort near
the top of that list — the AI picks targets by `pop / (1 + defence)`, and captured land has not been
hollowed out by repeated levying the way its own core has — and a levy that returns 0 still consumed
its slot. A 4-province AI has one slot and would raise **nothing at all** for a turn after a single
capture; a 20-province runaway has five and loses at most a fifth. That channel scales with realm
size in exactly the opposite direction to this feature's thesis.

So the quota counts **successful** levies and skips provinces it cannot levy. This is not strategic
awareness — the AI already declines fights it cannot win — it just stops the AI spending a turn on
an action that does nothing. Digestion now costs a realm the raw province's own contribution and
not a whole slot. The AI still does not pace its conquest, which is the part that stays untaught.

### 7. Determinism

Nations processed in ascending id; within a nation, raw provinces sorted by captured-turn ascending
then province id ascending. No `Math.random()`, no `Date`. Same seed and same commands must produce
an identical game.

## Testing

- Capture marks a province raw; starting territory is not raw.
- `canLevy` is false for a raw province and true once digested; the AI's levy path is blocked by
  the same gate.
- Digestion integrates exactly `DIGEST_PER_TURN` provinces per nation per turn, oldest first,
  ties on the lower id.
- A nation capturing at or below capacity never accumulates a backlog; one capturing above it
  accumulates without bound.
- Recapture re-marks a province raw.
- Militia defence of a raw province is unchanged.
- Same seed, same commands, identical game.
- UI: the map marks raw provinces, the levy button states the reason, the HUD reports the backlog.

## Measurement after merge

**The first question is whether the map freezes.** The leader-check already cost 14–91% of the
per-turn conquest rate across five seeds. This is a second damper on the same quantity, and two
dampers can easily produce a game where 50 turns end with nobody near the goal — which is not a
better game than a runaway, only a quieter one. Measure that before anything else, and be willing
to raise `DIGEST_PER_TURN` or lower the goal if it happens.

Then:

1. Do the runaways actually slow — do winners' peak gains and end sizes come down?
2. Do the steady growers gain relative position, or does everyone just slow together?
3. The player case, which a bot driver cannot answer: does pacing expansion actually beat
   over-eating? If the optimal play is still "take everything you can", the lever did nothing for
   the player and only taxed the AI.

Bot measurement is a proxy and has been wrong on this engine before. Live play decides.

## Prior art in this repo — why this might fail

Mechanical anti-snowball levers have been reverted here four times (`SIZE_CAP`, fragile conquest,
`WORLD_HARDEN`, `CONQUEST_SOL`), with the recorded meta-conclusion that the engine is
cohesion-driven and patient play adapts to mechanical brakes, while incentives and framing land.
`SIZE_CAP` in particular was close to option C below.

Two things differ here. The leader-check that shipped immediately before this was itself a
mechanical lever and it worked. And this change targets a causal chain the measurement actually
identified — capture → population → men — rather than penalising size as a proxy. Neither argument
is proof, which is why the measurement section leads with the failure mode rather than the hoped-for
result.

## Alternatives considered

- **War devastation** — capture scatters most of the population, which regrows at the existing 3%.
  One line, very intuitive. Rejected because the tax is linear in conquest volume, so it hits a
  small nation catching up as hard as a runaway.
- **Overextension cost** — upkeep rising disproportionately with size or army count. Rejected: it
  penalises size rather than rate, and is closest to the `SIZE_CAP` attempt that was reverted.

## Reverting

Set `DIGEST_PER_TURN` high enough to exceed any achievable conquest rate and the backlog never
forms. The raw marking stays but stops having an effect.
