# Army prototype — conquered land does not defend itself

**Date:** 2026-07-31 · **Engine:** `src/engine/armySim.ts` · **Page:** `playArmy.html`

Follows `2026-07-28-army-digestion-backlog-design.md`, whose live-play section established that the
digestion backlog is a conquest tax rather than a pacing decision. This spec is the attempt to make
pacing actually pay.

## Why the backlog alone did not work

Four games on seed 11, varying only attacks per turn: greedy reached the horizon at +17 and first
of three; capping at 3 lost outright and collapsed to −13; capping at 1 sat at +0 all game. Greedy
strictly dominated.

The obvious explanation — that conquest is free, so no tax could matter — is **wrong**, and
measuring it is what produced this design. Real attack options after six turns:

```
→ the Green Sands   · 공격 58 vs 방어 51 · 60%
→ the Silent Wilds  · 공격 58 vs 방어 22 · 95%
→ the Iron Taiga    · 공격 30 vs 방어 10 · 97%
→ the Ashen Fields  · 공격 151 vs 방어 35 · 99%
```

Winner's losses are `round(def × WIN_LOSS_MULT × closeness)`, so 58-vs-51 costs **27 of 58 men —
nearly half the army** — while 58-vs-22 costs 5 and 151-vs-35 costs 5. Conquest is already
priced. Greedy wins because there are enough 90–99% targets that the *average* conquest is cheap.

The actual asymmetry is elsewhere. In the paced game the realm went 29 → 27 → 26 provinces **while
declining to attack**. Not expanding does not reduce incoming pressure:

- the cost of greed is a delayed levy on a province or two
- the cost of restraint is being ground down while every rival grows

**Restraint has no defensive benefit at all.** Until it does, no tax can make pacing pay — a tax
only makes both strategies worse.

## What changes

Raw land stops defending itself.

### 1. The rule

`militiaOf` returns 0 for a raw province, via one tunable:

```ts
export const RAW_MILITIA_FRAC = 0;   // 1 restores the previous behaviour exactly

// militiaOf becomes:
Math.floor(s.pop[prov] * MILITIA_FRAC * (isRaw(s, prov) ? RAW_MILITIA_FRAC : 1))
```

Applying the factor **inside** the `floor`, rather than scaling the rounded result, is what makes
`RAW_MILITIA_FRAC = 1` bit-identical to today's `Math.floor(pop × MILITIA_FRAC)` — so the revert is
genuinely a no-op and not a source of off-by-one drift.

This merges two rules into one. It was "raw land cannot be levied"; it becomes **"raw land gives you
nothing until it is digested — no men, and no defence."** One concept with two consequences is
easier to learn than "no levy, and half defence", which is why the value is 0 and not an arbitrary
fraction.

**Garrisons still defend normally.** `defenceOf` counts armies standing on the province plus
militia; only the militia term goes to zero. So holding fresh conquests means **leaving troops
behind**, and that splits your offensive power. That is the mechanism by which restraint pays: a
paced realm's frontier is solid and its army stays concentrated, while an over-eater either garrisons
everything or leaves a soft belly.

### 2. The AI needs no changes at all

`aiObjective` already scores targets `pop / (1 + defence)`. A raw province has minimal defence, so
its score is maximal — **an over-eater's fresh conquests automatically become the most attractive
targets on the board**, for every nation, with no new AI code. The counter-pressure that makes
over-expansion dangerous emerges from the scoring function that already exists.

### 3. One touch point

`militiaOf(s, prov)` is the only function to change. Both consumers go through it — `defenceOf`, and
`moveArmy`'s militia-loss on capture — so the two stay consistent by construction: a raw province
that mounts no militia also loses no population to militia deaths when it changes hands, because
nobody took up arms.

`previewMove` runs the same `resolve` as the real move, so the odds and defence numbers shown to
the player follow automatically and cannot drift from what actually happens.

### 4. What the player sees

Two of these are already free:

- the province panel prints `민병 N` from `militiaOf`, so a selected raw province will read
  **`민병 0`** with no UI change at all
- attack rows print the real `방어` number, which will simply be lower

One needs copy. The levy button's `소화 중` state must name **both** consequences, since that is
where a player already looks when they touch raw land, and the second consequence is the one that
can lose them the province:

> `소화 중 — 징집 불가, 주민도 싸우지 않음`

The phrasing also hints at the answer: if the locals will not fight, leave your own men there.

### 5. This reverses a decision from the previous feature

The digestion work scoped the `⌛` marker to the player's own provinces, on the explicit grounds
that *"raw land defends exactly as normal … so an enemy's hourglass conveys nothing the player can
act on"*. Under this spec that reasoning is false: an enemy's raw province is the softest target on
the map, and hiding it would withhold the single most actionable piece of information the feature
creates.

So `⌛` returns to **every** raw province. The mismatch that motivated the original scoping — the
map's hourglass count not matching the HUD's number — is fixed the other way instead: the HUD
segment becomes **`내 소화 대기 N`**, which claims only what it counts. Two comments asserting the
old justification (`src/ui/armyApp.ts` at the marker, and one in `src/ui/armyApp.test.ts`) become
false and must be corrected rather than left to mislead.

### 6. A test currently asserts the opposite of this spec

`src/engine/armySim.test.ts` contains **`"raw land still defends — militia is untouched"`**, which
pins exactly the behaviour being removed. It must be inverted, not deleted: the replacement asserts
that a raw province supplies no militia, that its `defenceOf` drops accordingly, and that a garrison
standing on it still defends at full strength. Flagged here so it is handled deliberately rather
than discovered as a failure.

## Testing

- `militiaOf` returns 0 for a raw province and the normal `floor(pop × MILITIA_FRAC)` once digested.
- `defenceOf` on a raw province drops by exactly the militia term; a garrison on it still counts.
- Capturing a raw province destroys no population, because there was no militia to die — the
  `militiaLost` term in `moveArmy` is 0.
- `RAW_MILITIA_FRAC = 1` reproduces the previous behaviour exactly.
- `aiObjective` prefers an enemy's raw province over an otherwise identical digested one — the
  emergent counter-pressure, asserted rather than assumed.
- The levy button names both consequences; the HUD reads `내 소화 대기`; `⌛` appears on enemy raw
  land.
- Same seed, same commands, identical game.

## Measurement after merge

**1. Does land ping-pong? Check this first.** Recapture re-marks a province raw, so a contested
province can be permanently soft and change hands every turn. Count total ownership changes per
game and the maximum for any single province, before and after. If the front turns into a
revolving door, `RAW_MILITIA_FRAC` goes up — this is the failure mode this design most plausibly
has.

**2. Does pacing now beat greed?** Re-run the exact experiment that produced this spec: seed 11 as
the 29-province giant at 1, 3 and unlimited attacks per turn. **This is the entire point of the
work. If greedy still dominates, report that as a failure** — not as a partial success with
favourable side effects.

**3.** The standing runaway checks: best gain, biggest realm, second place, per-turn conquest rate.

Bot measurement is a proxy and has been wrong on this engine before. Live play decides.

## Measured result — this did not work, and the mechanism is wrong-signed

"Before" was taken with `RAW_MILITIA_FRAC = 1`, the documented revert, so both columns come from the
same driver on the same commit. Flips are normalised per turn because the games ran different
lengths.

| seed | turns | flips/turn | max flips | prov 4+ | best | 2nd | biggest | winner |
|---|---|---|---|---|---|---|---|---|
| 11 | 50 → 50 | 10.9 → 13.2 | 27 → 32 | 48 → 47 | 15 → **22** | 12 → **9** | 44 → **51** | none → none |
| 23 | 29 → 28 | 12.6 → 13.1 | 19 → 24 | 36 → 32 | 18 → **19** | 5 → 5 | 21 → **29** | t29 → t28 |
| 1 | 50 → 47 | 19.3 → 16.6 | 30 → 34 | 62 → 53 | 18 → **24** | 12 → 14 | 25 → **33** | none → **t47** |
| 7 | 34 → 26 | 8.9 → 7.0 | 15 → 10 | 33 → 23 | 19 → 19 | 12 → **8** | 47 → 47 | t34 → **t26** |
| 42 | 21 → 50 | 15.8 → 14.7 | 14 → 30 | 42 → 55 | 24 → 15 | 3 → 13 | 44 → 33 | t21 → none |

**1. Ping-pong: did not happen.** The failure mode this design was most likely to have is the one it
avoided. Flips per turn rose on two seeds and fell on three; `prov 4+` fell on four of five. Seed
42's raw counts triple, but its game went from 21 turns to 50 — per turn it fell.

**2. Runaways got *bigger*, on three of five.** `biggest` rose on seeds 11 (44→51), 23 (21→29) and
1 (25→33), was flat on 7, and fell only on 42. `best` gain rose on the same three. Seed 1 gained a
winner where it previously had none, and seed 7's winner arrived eight turns earlier. This is the
opposite of the intent.

**3. Second place: no pattern.** Up on seeds 1 and 42, **down on 11 and 7**, flat on 23.

### Live play, which is what decides it

Seed 11 as the 29-province giant, with the rule **on**, three strategies:

| strategy | outcome |
|---|---|
| greedy — every attack available | **defeat** around t32, collapsed to −5 |
| paced — 1 attack/turn | turn-50 horizon, **3rd of 4**, −4 |
| selective — 2 attacks/turn, always the best odds | peaked +6 while leading at t13, then declined to −4 by t35 |

Against the same seed and nation **before** this change: greedy reached the horizon at **+17, first
of three**, and paced sat at +0. **Every strategy got worse, and the best of them is now a loss.**

The selective driver deserves its own note, because it is the play this design exists to reward:
raw land shows a much lower `방어`, so picking the best odds each turn preferentially eats exactly
the land the feature softened. It did briefly work — at t13 the player led +6 to +5, which neither
other strategy managed — and then it lost anyway.

### Why it is wrong-signed

Softening raw land makes conquest cheaper **for everyone**, and the beneficiary of cheaper conquest
is whoever has the most armies and the most fronts — the runaway. The patient player gets little
from it: they hold almost no raw land of their own to protect (a paced realm's backlog is 1), and
they have no privileged access to the runaway's soft land, which sits on the far side of the map
behind the runaway's armies.

The diagnosis that produced this design was right — restraint has no defensive benefit — but this
lever does not supply one. It supplies a *general* discount on attacking, and a general discount
favours the player who attacks most. **Tuning `RAW_MILITIA_FRAC` between 0 and 1 changes the
magnitude, not the sign**, so a gentler value is not expected to rescue it.

**Recommendation: do not merge.** The mechanism is implemented, tested and revertible, but the
measurement says it makes the game worse on both the AI board and in the player's hands.

## Prior art — why this might fail

Mechanical balance levers have been reverted here repeatedly (`SIZE_CAP`, fragile conquest,
`WORLD_HARDEN`, `CONQUEST_SOL`, `AI_ODDS_MIN`), and the immediately preceding attempt — the
digestion backlog — did not achieve its stated goal either, though it did close the
"playing big is a walk" problem. The recurring failure mode is a lever that taxes something without
changing what the optimal strategy *is*.

This design is aimed squarely at that: it does not add a cost, it adds a **benefit to restraint**,
which the measurement of the last attempt identified as the missing half. That is a better argument
than the previous attempt had, and it is still only an argument — which is why measurement item 2
is phrased so it can come back "no".

## Alternatives considered

- **Occupation drain** — raw land costs men per turn. Rejected: it is another tax, and the
  diagnosis above says a tax cannot fix this. It makes both strategies worse without making
  restraint better.
- **Revolt on age** — a province raw too long flips away. This is punchier and creates a real
  deadline, but it is still a penalty on greed rather than a reward for restraint, and it adds a
  new failure mode (land vanishing) plus a decision about who receives it.

## Reverting

Set `RAW_MILITIA_FRAC = 1`. The digestion backlog and everything else stays as it is today.
