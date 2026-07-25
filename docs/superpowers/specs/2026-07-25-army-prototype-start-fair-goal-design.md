# Army prototype — a start-fair goal — design

Date: 2026-07-25
Status: PROTOTYPE iteration. Revises the goal introduced in `2026-07-25-army-prototype-goal-design.md`.
Scope: `src/engine/armySim.ts` + `src/ui/armyApp.ts`.

## Why

The goal shipped as an ABSOLUTE threshold — hold 40% of the world's land. Play-testing both ends of the
nation picker on the same world (seed 23, 103 land provinces) showed it is not start-fair:

| Start | Result |
|---|---|
| 18 provinces | **victory at turn 22** — comfortable |
| 3 provinces | 22/41 at turn 50 — **cannot realistically win** |

The small nation played a genuinely good game (3 → 22 provinces, 136 battles, an underdog arc with two
setbacks and a final surge) and still could not reach the finish line, because the line was drawn where
a large realm starts closer to it.

This repo already solved this once. The province game's P1 notes say it plainly: an additive goal is
*"start-fair: a tiny realm and a large one must both take the same absolute number of provinces, a big
start never wins instantly (gain is 0 at t0), and a small start can't win by grabbing 2 neighbours."*
The absolute threshold was a regression to a design this project had already rejected.

## The change

Victory is measured by **what you conquered, not by what you ended up holding**:

```
GOAL_GAIN_FRAC = 0.2
goalGain(s)    = round(GOAL_GAIN_FRAC × landProvinces(s))     // ~21 on a 103-province world
gained         = provinceCount(s, nation) − startProvinces
victory        iff gained >= goalGain(s)
```

Everyone must take the same absolute number of provinces regardless of where they started. Checked
against the two play-tests: the large start reached +23 by turn 22 (so it still wins, slightly later);
the small start reached +19 by turn 50 (so it now comes *close* to winning instead of being excluded).
That is the intended shape — a tight race from both ends rather than a formality from one and an
impossibility from the other.

`startProvinces` is the count at the moment the player picks a nation, so it is 0-gain at t0 and a big
start can never win instantly.

Defeat (zero provinces) and the 50-turn horizon ranking are unchanged.

## Progress must show the loss state too

The HUD shows the same quantity the victory test uses:

```
정복 +19/21
```

`gained` is reported **even when negative** (`정복 -4/21`). A realm shrinking below its start is the
losing state the player most needs to see, so it is not clamped — the same decision the province game
made for exactly the same reason.

## Engine API changes

```
export const GOAL_GAIN_FRAC = 0.2;                    // replaces GOAL_FRAC
export function goalGain(s: ArmyState): number;       // replaces goalTarget
export function goalProgress(s: ArmyState, nation: number, startProv: number): { gained: number; goal: number };
export function outcome(s: ArmyState, nation: number, startProv: number): Outcome;   // gains a parameter
```

`goalProgress` is what the HUD renders and what `outcome` tests, so the counter and the victory check
cannot disagree — the single-source property carried over from the previous pass.

`Outcome`'s shape is unchanged (`defeat` / `victory` / `horizon` with rank / `null`), as is the check
order: defeat → victory → horizon → null.

## UI

- `mountArmyApp` records `startProvinces` when the player picks a nation and passes it to `outcome` and
  the HUD.
- HUD replaces `목표 N/M` with `정복 +N/M` (signed).
- The victory line becomes `승리 — 세계의 20%를 새로 정복했습니다` (derived from `GOAL_GAIN_FRAC`, not hardcoded).
- Restart already returns to the picker with a fresh state; the recorded `startProvinces` must reset with it.

## Testing

- `goalGain` = `round(GOAL_GAIN_FRAC × landProvinces)`, and `outcome` compares against exactly that.
- Gain is 0 at t0 for any start size, so no nation can win on turn 0 — assert for both a large and a
  small starting nation.
- A nation at `start + goalGain − 1` is not yet a victory; at `start + goalGain` it is.
- `goalProgress.gained` goes negative when the realm shrinks below its start.
- Defeat still outranks victory and the horizon.
- jsdom: the HUD shows `정복 +N/M`; it shows a negative gain after losing ground; restart resets the
  recorded start count (pick a big nation, restart, pick a small one, and check the goal line reflects
  the NEW start).

## Honesty

- Start-fair is not the same as equal difficulty: a large realm still has more population and therefore
  raises more men, so it will usually get there first. The change removes the structural impossibility
  for a small start, not the advantage of a big one.
- `GOAL_GAIN_FRAC = 0.2` is calibrated to two controller bot runs on one world. It is a single constant
  and should be retuned after the user plays — if a large start wins by turn 20 again, raise it.
