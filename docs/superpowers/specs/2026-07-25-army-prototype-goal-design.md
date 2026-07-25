# Army prototype — a reason to play (goal, defeat, horizon) — design

Date: 2026-07-25
Status: PROTOTYPE iteration. Builds on the army prototype + tension pass.
Scope: `src/engine/armySim.ts` + `src/ui/armyApp.ts`. The deployed province game stays untouched.

## Why

The prototype is free play with a turn counter. The user confirmed the broad direction is what they
had in mind, and the play-tests show the loop is alive (139 battles in 25 turns, real setbacks, odds
that hurt). But nothing says **why you keep playing** — turns just accumulate and stop when you stop.

A goal is not decoration here. Every decision this game asks — spend the army now or mass more, levy
this province dry or leave it defensible — only carries weight against something you are racing
toward. Without a finish line, "hold back and be safe" has no cost, which is also why turtling still
reads as merely pointless rather than as losing.

## The three outcomes

Checked in this order, before the player acts each turn:

1. **Defeat** — you hold zero provinces. You are out. (There is no capital mechanic in this engine;
   provinces are the whole of what you own, so losing all of them is the honest death condition.)
2. **Victory** — you hold at least `GOAL_FRAC` of the world's land provinces. `GOAL_FRAC = 0.4`.
   With ~100 provinces and 8 nations, an even split is 12.5%; 40% is a genuine conquest and sits just
   past the best controller run (35/103 ≈ 34%) — reachable with good play, not handed to you.
3. **Horizon** — at `HORIZON = 50` turns the game ends and you are ranked by provinces held, with
   your position among all nations reported (`3위 / 8`). Surviving is not framed as winning; the
   ranking says plainly how you did.

A game that ends is what makes the mid-game decisions matter, so the horizon is a real ending, not a
soft stop.

## Progress must be visible and must equal the win check

The repo already learned this in the province game: the counter the player watches must be computed
from exactly what the victory test counts, so the two can never disagree. The HUD gains

```
목표 33/41
```

where the goal is `Math.round(GOAL_FRAC × landProvinces)` — the same number `isVictory` compares
against. A single exported helper produces both, so no second formula can drift.

## Engine API

```
export const GOAL_FRAC = 0.4;
export const HORIZON = 50;

export function landProvinces(s: ArmyState): number      // provinces that can be owned at all
export function goalTarget(s: ArmyState): number         // round(GOAL_FRAC * landProvinces)
export function provinceCount(s: ArmyState, nation: number): number
export function nationRank(s: ArmyState, nation: number): { rank: number; of: number }

export type Outcome =
  | { kind: "defeat" }
  | { kind: "victory" }
  | { kind: "horizon"; rank: number; of: number }
  | null;                                                 // game continues

export function outcome(s: ArmyState, nation: number): Outcome
```

`outcome` is pure and rng-free, checked in the order above. Ranking counts every nation that still
holds land, ties broken by lower polity id, so the reported `of` is the number of surviving nations.

## UI

- **HUD** gains `목표 N/M` next to the existing readouts.
- **End screen**: when `outcome` is non-null the app replaces the panel and the end-turn button with a
  result line and a `다시` button that returns to the nation picker (a fresh game on the same world).
  - defeat: `패배 — 모든 영토를 잃었습니다`
  - victory: `승리 — 세계의 40%를 정복했습니다`
  - horizon: `50턴 종료 — 3위 / 8`
- The map, the log and the HUD stay visible so the player can read the final state.
- No new interaction: the game simply stops accepting levies and moves once it is over.

## What this does NOT change

- The battle model, odds, terrain, economy, AI, one-move-per-turn — all untouched.
- The nation picker, the seed in the HUD, the panel-issued marches.
- The deployed province game, its engine, and every existing test.

## Testing

- `goalTarget` equals `round(GOAL_FRAC × landProvinces)` and is what `outcome` compares against
  (assert by driving a state to exactly the target and to one below it).
- `outcome` returns `defeat` at zero provinces even if the turn horizon has also passed (order matters),
  `victory` at the target, `horizon` with a rank at `HORIZON`, and `null` mid-game.
- `nationRank` ranks by province count, ties → lower id, and counts only nations still holding land.
- jsdom: the HUD shows `목표 N/M`; a state driven to victory renders the end screen and no end-turn
  button; `다시` returns to the picker.

## Honesty

- `GOAL_FRAC = 0.4` and `HORIZON = 50` are calibrated to the controller's runs (best was ~34% by turn
  25), not to the user's play. Both are single constants and expected to move after the next play-test —
  if 40% turns out to be a formality by turn 30, raise it; if it is never reached, lower it.
- A horizon ranking is a weaker ending than a scored campaign. It is chosen because it is honest about
  what the prototype can currently measure (land held) rather than inventing a score whose weights
  nobody has validated.
