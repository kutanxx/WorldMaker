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
- **`gained` must be strictly positive.** A nation that has conquered nothing is not leading.
- Ties break on the lower polity id. Returns `-1` when no nation qualifies.

The `gained > 0` requirement exists because `startCounts` is snapshotted at init, so at t0 every
nation's `gained` is exactly 0 and the tie-break alone would decide — crowning the lowest-id nation
(possibly the player) as "leader" for no reason connected to the race, aiming the AI's bias and any
future "you are the leader" message at an arbitrary target. Returning `-1` instead leaves the whole
leader-check inert until somebody has actually taken something.

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

## Measured result

All-AI worlds (`aiTurn(s, -1)`, so every nation is played by the AI and no human proxy stands in
for one), run to the first nation reaching the goal or to the turn-50 horizon. "Before" was taken
by setting `AI_LEADER_BIAS = 1`, which the code makes bit-identical to the pre-feature engine, so
before and after come from the same driver on the same commit. `lead−2nd` is the winning margin;
`totalGain` sums every nation's positive conquest.

| seed | before (bias 1) | after (bias 2) |
|---|---|---|
| 11 | nation 6 wins **t15**, lead−2nd 18, totalGain 40, men 5601, pop 6967 | nation 6 wins **t28**, lead−2nd 11, totalGain 43, men 6412, pop 6545 |
| 23 | nation 2 wins t28, lead−2nd 20, totalGain 18 | **no winner in 50**, lead−2nd 0, totalGain 3 |
| 1 | no winner, lead−2nd 12, totalGain 28 | no winner, lead−2nd 6, totalGain 24 |
| 7 | nation 4 wins t32, lead−2nd 15, totalGain 25 | **no winner in 50**, lead−2nd 21, totalGain 18 |
| 42 | nation 0 wins t30, lead−2nd 12, totalGain 36 | nation 0 wins t36, lead−2nd 18, totalGain 30 |
| 107 | no winner, totalGain 0 | *byte-identical* — see below |

**1. Did the runaway stop? Partly, and the null result stands.** Seed 11's 29-province giant
**still wins**. The check delays it — t15 to t28, and its margin over second place falls from 18 to
11 — but it does not stop it. That is mechanism B doing exactly what this spec predicted it would:
the giant levies from 8 provinces while an 11-province neighbour levies from 3, and the goal is the
same flat number for both. **No amount of tuning `AI_LEADER_BIAS` will fix that**; it would mean
changing what victory is, or how production scales.

**⚠ Read the table with its confound in mind.** Every metric above is taken at game end, but the
"after" games run *longer* — the check delays or prevents a winner, so before ends at t15–t50 and
after at t28–t50. Standing men, totalGain and margin all accumulate with turns played, so raw
end-state numbers flatter the change. Where the two conclusions below depend on that, they are
normalized per turn.

**2. Did it backfire the way `AI_ODDS_MIN` did? Not in the same way — but conquest slows
everywhere, and one seed does show the attrition signature.** The `AI_ODDS_MIN` failure mode was
armies bleeding out in close fights, which shows as *fewer* men standing. Men rose on seeds 11
(5601→6412), 23 (4109→4313) and 7 (7459→8860), fell 1.2% on seed 1 — and **fell 10.2% on seed 42
(6254→5613), while its army count rose 27→44**. More, smaller stacks holding fewer men is the
attrition pattern, not the accumulation pattern, and seed 42 is the one seed exhibiting it. It
should not be rounded off: the spec required this check be *looked for*, not assumed absent.

Normalizing conquest by turns actually played, the picture is worse than the raw totals suggest:

| seed | conquest/turn before | after | change |
|---|---|---|---|
| 11 | 2.67 | 1.54 | −42% |
| 23 | 0.64 | 0.06 | −91% |
| 1 | 0.56 | 0.48 | −14% |
| 7 | 0.78 | 0.36 | −54% |
| 42 | 1.20 | 0.83 | −31% |

**Conquest rate falls in 5 of 5, by 14–91%.** Seed 11's raw totalGain *rise* (40→43) is an artifact
of having 13 more turns to produce 3 more provinces. So the honest statement is: the bias does not
bleed armies the way `AI_ODDS_MIN` did, but it makes the whole world less decisive. Armies
concentrate on a leader they often cannot beat and then wait. On an all-AI board that reads as
stalling; with a human player pushing a front it may read as pressure. **This is the thing to watch
in live play.**

**3. The player-leads case was NOT measured.** The spec's third question — does a strong player
start still walk to victory? — cannot be answered by an all-AI driver, which has no player. Since
"the player is included in the leader check" is this feature's headline design decision, this is a
real gap and it is deliberately left open for live play rather than papered over with a bot proxy.

**Margins: closer in three of five, wider in two.** Narrowed on seeds 11 (18→11), 23 (20→0) and 1
(12→6); widened on 7 (15→21) and 42 (12→18). The widening cases are the coalition eating each other
while the eventual winner is elsewhere: the bias aims everyone at whoever is *momentarily* ahead,
which is not always whoever will win.

**Seed 107 is identical under both settings**, which is the `gained > 0` rule working: with no
player, no nation there ever reaches positive conquest, so `raceLeader` returns -1 all game and the
lever never engages. That is specific to the all-AI configuration, not a general property of that
world — seed 107 is also the seed the UI test uses precisely because a *player* there conquers by
turn 7 and then leads for 23 straight turns, engaging the lever for most of the game.

**Standing caveat.** This is a bot proxy and it has been wrong on this engine before — the
`AI_ODDS_MIN` measurement pointed the opposite way from what live play showed. These numbers are a
direction, not a verdict. Live play decides.

## Live play — five games on seed 11, with the bias A/B'd

Same aggressive driver throughout (levy everywhere offered, attack wherever possible), so the only
variable is the nation played and whether the bias is on.

| nation | bias | outcome |
|---|---|---|
| Shakhaar, 14 provinces | on | defeat t14 — Vidaus got there first |
| Shakhaar, 14 provinces | **off** | defeat t12 |
| **Vidaus, 29 provinces** | **off** | **victory t22**, +27/27, best rival stuck at +6 |
| **Vidaus, 29 provinces** | on | **turn-50 horizon, nobody wins**, +12/27, a rival reached +19 |
| Veiviksveir, 4 provinces | on | wiped out t15 (grew 4→10, then collapsed) |

**The feature's real effect is on a player who plays big — the case the bot driver structurally
could not measure.** Playing the giant used to be a walk: victory at t22 with the runner-up at +6.
With the check on it becomes a seesaw — +21, ground down to +6, back to +19, down again — and 50
turns end with nobody at the goal while a rival peaks at +22. That is the catch-up mechanic this
game did not have.

**It does not fix the giant *AI*.** Playing 14 provinces loses either way; t12 → t14 is the whole
difference. Mechanism B is confirmed as the real cause by live play as well as by the bot.

### The problem live play found: the threshold is noise-level

The check fires on leads far too small to mean anything. In the 14-province game the player became
"the leader" at **t1, having taken exactly one province**. In the 4-province game the player was
flagged at **+4** — while the 29-province giant sitting at +3 was not.

`gained` is the right metric for the *goal*, but as a *threat* metric it systematically targets
small nations: a small realm's early growth spurt is its survival condition, and that is precisely
when the coalition arrives. The 4-province game is that story — 4→10 provinces, flagged at t2,
annihilated by t15.

### Fix: a lead has to be worth something

`raceLeader` additionally requires

```ts
gained >= Math.ceil(LEAD_MIN_FRAC * goalGain(s))     // LEAD_MIN_FRAC = 0.2
```

so a nation must be a fifth of the way to victory before the world notices it. The threshold is
derived from the goal, so it scales with the theater instead of needing per-map tuning: goal 27 →
6 provinces, goal 7 → 2. Against the games above this leaves every genuine runaway flagged (the
giant crosses 6 by t2) while the 14-province player is not flagged until t3-t4 instead of t1, and
the 4-province player not until t6 instead of t2.

### Fix: the documented revert must not make the HUD lie

Setting `AI_LEADER_BIAS = 1` stops the AI reacting, but the HUD reads `raceLeader` directly and
would keep warning about a dogpile that is no longer happening. The HUD gates on the same constant,
so the one-line revert really is one line.
