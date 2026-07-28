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
digested or was never taken. **Optional**, exactly mirroring the existing `leviedOn` field, so
hand-built fixtures that predate it keep compiling and a missing array behaves everywhere as
"nothing is raw". `initArmySim` allocates it eagerly; the lazy allocator is the fallback for those
fixtures, not the normal path — a query function that silently allocates would otherwise make
state comparisons depend on which state happened to be queried first.

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
  carries the excess into the next turn. (Accumulation *without bound* is the design's claim but is
  not what the tests pin — they cover one step above capacity, which is the part a unit test can
  reach; the unbounded case is what the measurement section is for.)
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

## Measured result

All-AI worlds, run to the first nation reaching the goal or to the turn-50 horizon. "Before" was
taken by setting `DIGEST_PER_TURN = 9999` — the documented revert, which makes `digest` clear
everything it finds every turn — so both columns come from the same driver on the same commit, with
the leader-check already in place in both.

The driver diverged from the plan in one way worth stating: it printed the backlog **per nation**
as well as summed, which is where §4's per-nation figures come from. It has since been deleted, so
those figures are not reproducible from the plan's version as written.

| seed | winner | best | 2nd | totalGain | rate | biggest | backlog |
|---|---|---|---|---|---|---|---|
| 11 | t28 → **none** | 27 → **15** | 16 → 12 | 43 → 36 | 1.54 → 0.72 | 56 → 44 | 0 → 27 |
| 23 | t32 → t29 | 18 → 18 | 1 → 5 | 19 → 23 | 0.59 → 0.79 | 36 → 21 | 0 → 20 |
| 1 | none → none | 6 → **18** | 5 → 12 | 19 → 31 | 0.38 → 0.62 | 27 → 25 | 0 → 39 |
| 7 | t37 → t34 | 21 → 19 | 0 → **12** | 21 → 31 | 0.57 → 0.91 | 49 → 47 | 0 → 30 |
| 42 | t23 → t21 | 23 → 24 | 4 → 3 | 30 → 28 | 1.30 → 1.33 | 43 → 44 | 0 → 29 |

**1. Did the map freeze? No.** This was the failure mode to check first and it did not happen.
Per-turn conquest rose on four seeds and fell only on seed 11, where it fell because the runaway
producing most of that conquest was stopped. Two caveats on that number, both against the
favourable reading: `rate` is `totalGain / turnsToWin`, so seed 42's 1.30→1.33 is entirely a shorter
denominator — its total conquest actually **fell** 30→28. And total conquest rose on only three of
five. The world did get busier on three seeds; the plausible reason is that breaking a runaway
leaves more nations alive and active, but the driver never counted survivors, so that is an
inference and not a measurement.

**2. Did the runaways slow? On two seeds yes, on one it got worse, and the rest is noise.** Best
gain fell on seed 11 (27→15) and seed 7 (21→19), was flat on 23, and **rose on two**: seed 42
23→24, and **seed 1 tripled, 6→18**. Seed 11 is the clean case — a winner at t28 with a 56-province
empire becomes no winner at all. But `biggest` is the metric that moves most consistently, falling
on four of five (56→44, 36→21, 49→47, 27→25) and rising only on 42.

On three seeds the winner arrives **earlier** (t32→29, t37→34, t23→21). Seed 23 is explicable — a
*different* nation wins, so it is a reshuffle. Seeds 7 and 42 have no such account, and on seed 42
every runaway metric moved the wrong way at once. With five seeds on a chaotic simulation this may
simply be noise, and it is recorded as unexplained rather than filed under "barely moved".

**3. The field closed up on three seeds of five.** The plan required that a narrower gap only counts
if second place went *up*, and on three it did: 0→12 on seed 7, 5→12 on seed 1, 1→5 on seed 23.
Seed 7 is the strongest single result — the runner-up went from gaining *nothing at all* to gaining
12, which is the "one nation runs away while everyone else sits near zero" shape breaking. But
second place **fell** on seeds 11 and 42, and seed 11 is the same seed called the clean case in §2.
So the two headline seeds disagree with each other, and the closure is a three-of-five result, not a
general one.

**4. The backlogs are large, and that is worth watching.** End-of-game backlogs run 20–39 provinces
per world, concentrated on the leaders: seed 7's winner holds **23 raw provinces out of 47**, seed
42's 24 of 44 (per-nation figures, from the diverged driver noted above; the pairing of the largest
backlog with the winner is inferred from nation order, not printed as such). Mechanically that is
the design working — a runaway accumulates forever — but roughly half of a large realm being
unlevyable is a big number to put in front of a player, and whether `소화 대기 23` reads as
meaningful pressure or as an incomprehensible tax is a live-play question, not a measurement one.

### Two behaviours found in review that the design did not anticipate

**The damper taxes the human more than the AI at low conquest rates.** §3's "a conqueror at or
below capacity is effectively unaffected" is exactly true for the **AI**, because `aiTurn` levies
*before* it moves: a province the AI takes on turn T is cleared by `digest` at the end of T, so at
one capture per turn the AI is never blocked once and pays nothing at all. The **player** acts
before `endTurn`, and could previously capture a province and levy it the same turn. Now they
cannot, so they lose one levy of a fresh, un-hollowed province on *every* conquest at any rate.
That is arguably the feature working — it removes the strongest compounding move the player had —
but it is the opposite of §6's claim that this leaves the informed player an advantage, and moving
the `digest` call would not fix it: the asymmetry comes from the AI's levy-before-move ordering.

**The approved AI levy-skip softens the damper exactly where it was meant to bite hardest.** Under
the original loop, a realm whose top `nLevy` slots were all fresh conquests raised nothing that
turn — the damper bit hardest on the biggest backlog. With the skip, the quota is always filled, so
digestion costs the realm only the *population difference* between the raw province and its
replacement. The measured runaways hold about half their realm raw and still won earlier, which is
consistent with this. The skip is still correct — without it a 4-province AI raised nothing after a
single capture, which inverted the design far worse — and both measurement columns include it, so
nothing above is attributable to it. But it is the most plausible mechanism behind the unexplained
earlier winners in §2, and it is recorded here so the next balance pass does not have to re-derive
it.

**Standing caveat.** Bot measurement is a proxy and has been wrong on this engine before. These are
a direction, not a verdict, and they cannot answer the one that matters most for the player: whether
pacing expansion actually beats over-eating. If "take everything you can" is still optimal, this
lever did nothing for the player and only taxed the AI.

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
