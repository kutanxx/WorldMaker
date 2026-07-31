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
