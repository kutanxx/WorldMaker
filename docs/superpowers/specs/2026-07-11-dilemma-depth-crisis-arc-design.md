# Dilemma Depth: State Cards + Chain + Crisis Arc (benchmarked)

**Date:** 2026-07-11
**Status:** Approved design (user picked proposal ① from the gap-diagnosis benchmark study)

## Why

Self-diagnosis of the play mode's weakest points: the 4 dilemma cards repeat into routine by
mid-game, and a 50-turn reign has no narrative arc — turn 40 feels like turn 10. Benchmarks:

- **King of Dragon Pass** — events are *state-triggered* (neglect defenses → raids) and choices
  *change the future event pool* (chains). Praised as "a management game whose heart is an RPG
  chronicle."
- **Frostpunk** — a three-act escalation toward a climactic final storm; preparation time, then
  the test. The most praised pacing device in the genre.
- Constraint carried from the previous feature (Into the Breach honesty): every new card's
  effects appear in `previewDilemma` — odds shown for gambles, conditions shown for thresholds,
  never fake precision.

## Architecture

### SimState (engine file, play-only fields — golden-safe by precedent)

`src/engine/historySim.ts` gains one field, following the `truces`/`foundedCities`/`lastDilemma`
precedent (initialized in `initSim`, never read on the pure-history path):

```ts
dilemmaFlags: Set<string>; // chain flags + crisis-arc stage/once markers; play UI only
```

Flags used: `prophecySponsored`, `prophecyDone`, `hegemon2`, `hegemon3`, `hegemonDone`.

### offerDilemma → card bag (src/engine/dilemma.ts, signature unchanged)

Priority order per call (still max one card, cooldown `DILEMMA_COOLDOWN=3` unchanged EXCEPT
where noted):

1. **Crisis-arc continuation** (`hegemon2`/`hegemon3` flag set): fires on the NEXT offer call,
   **bypassing the cooldown** — Frostpunk pacing; 30-year gaps between acts would kill the arc.
   If the hegemon polity has died meanwhile, the arc dissolves silently (`hegemonDone` set, no
   card, fall through).
2. **Chain follow-up** (`prophecySponsored` set): guaranteed card, normal cooldown applies.
3. **Crisis-arc opening**: hegemon check (below), once per reign.
4. Existing crisis-tier card: unrest (unchanged).
5. State cards with probability draws, in order: raiders (unchanged), **warweary**, **boomtown**,
   defector (unchanged), **prophecy**, prosperity (unchanged).

NOTE: inserting draws changes which card a given rng sequence produces vs today. The play path is
not golden-guarded and existing trigger tests use retry loops (`forceOffer`), so this is safe —
but it is a deliberate, documented behavior change for live games.

## New content (7 card faces — scope is FIXED)

Tuning consts exported from dilemma.ts unless noted. All effects use existing primitives only
(solidarity nudges via `nudgePlayerSol`, `s.owner` flips, `s.truces`).

### State card: 전쟁 피로 warweary

- Trigger: threat edges ≥ `WARWEARY_MIN_THREATS=4` AND player avg < `WARWEARY_MAX_ASA=0.5`,
  prob `WARWEARY_PROB=0.4`. (Distinct from raiders: raiders needs 6 threats, no cohesion gate.)
- a **징집 강화 / Raise the levies**: border `+WARWEARY_LEVY_SOL=0.1`, interior `−0.03` (the
  fortify pattern). Outcome `warwearyLevy {n}`.
- b **화의 모색 / Sue for terms**: truce with the polity owning the most threat edges, for
  `WARWEARY_TRUCE_TICKS=2` (20y); nation `−WARWEARY_TERMS_SOL=0.03` (lords resent it). Outcome
  `warwearyTerms {name}`. If no threat polity exists (race), outcome `warwearyNoFoe` (no effect).

### State card: 도시의 성장 boomtown

- Trigger: at least one founded city currently held, prob `BOOMTOWN_PROB=0.25`. `data.cell` =
  the held founded city with highest solidarity.
- a **시장 특허 / Charter the market**: nation `+BOOMTOWN_CHARTER_SOL=0.04`. Outcome
  `boomtownCharter`.
- b **성벽 증축 / Raise the walls**: the city cell + its grid neighbors owned by the player get
  `+BOOMTOWN_WALL_SOL=0.15`. Outcome `boomtownWall {n}`.

### Chain: 떠도는 예언 prophecy (2 faces)

- Face 1 trigger: `!prophecyDone && !prophecySponsored`, prob `PROPHECY_PROB=0.15`.
  - a **예언자를 후원 / Sponsor the prophet**: nation `−PROPHECY_COST_SOL=0.03` now; sets
    `prophecySponsored`. Outcome `prophecySponsor`.
  - b **내친다 / Turn them away**: no effect. Outcome `prophecyIgnore`. Sets `prophecyDone`.
- Face 2 (follow-up, guaranteed at the next offer window): resolves by a DETERMINISTIC condition
  shown in advance — player avg ≥ `PROPHECY_ASA=0.5`:
  - a **성취를 선포 / Proclaim the fulfilment**: if avg ≥ 0.5 → nation `+PROPHECY_BOON_SOL=0.08`
    (outcome `prophecyFulfilled`), else nation `−PROPHECY_BUST_SOL=0.05` (outcome
    `prophecyDebunked`). Preview states the condition, not a roll — this makes "raise cohesion
    above 50% before next decade" a mini-goal that plugs into the invest/preview loop.
  - b **조용히 묻는다 / Bury it quietly**: no effect. Outcome `prophecyBuried`.
  - Either choice clears `prophecySponsored`, sets `prophecyDone` (once per reign).

### Crisis arc: 패권국의 그림자 hegemon (3 faces, once per reign)

- Opening trigger: `s.tick ≥ HEGEMON_MIN_TICK=20` AND largest living rival's cells ≥
  `HEGEMON_RATIO=1.6` × player cells AND `!hegemonDone`. No probability draw — it fires when the
  condition first holds (subject to cooldown tier order). `data.polity`/`data.name` = hegemon.
- Face 1 **그림자 / The shadow** (warning + preparation):
  - a **측면을 규합 / Rally the flanks**: truce (`HEGEMON_RALLY_TICKS=2`) with up to 2 weakest
    hostile neighbors EXCLUDING the hegemon (they fear it too — no cost). Outcome
    `hegemonRally {n}`.
  - b **군비 증강 / Arm the border**: border `+0.08`, interior `−0.02`. Outcome `hegemonArm {n}`.
  - Both set `hegemon2`.
- Face 2 **최후통첩 / The ultimatum**:
  - a **조공을 바친다 / Pay tribute**: nation `−HEGEMON_TRIBUTE_SOL=0.08`, truce with hegemon
    `HEGEMON_TRIBUTE_TICKS=3` (30y). Arc ends (`hegemonDone`). Outcome `hegemonTribute {name}`.
  - b **항전을 결의 / Defy them**: nation `+0.04` (resolve rallies the realm). Sets `hegemon3`.
    Outcome `hegemonDefy`.
- Face 3 **결전 / The reckoning** (the storm) — choice a fights, choice b is a last-second
  capitulation:
  - a **결전에 나선다 / Give battle**: gamble with REAL odds = `clamp(playerAvg, 0.2, 0.8)`
    (cohesion IS battle-readiness in this game's rules; shown honestly in the preview).
    Win (rng < odds): `HEGEMON_SPOILS=8` hegemon border cells adjacent to the player flip to the
    player at `CONQUEST_SOL`; nation `+0.06`. Outcome `hegemonVictory {n}`.
    Lose: 8 player border cells adjacent to the hegemon flip TO the hegemon at `CONQUEST_SOL`;
    nation `−0.06`. Outcome `hegemonRout {n}`. (Owner flips reuse the concede/defector
    primitive; capital-fall defeat rules unchanged — the arc cannot instakill.)
  - b **무릎 꿇는다 / Kneel**: as tribute but harsher: nation `−0.12`, truce 3 ticks. Outcome
    `hegemonKneel {name}`.
  - Either choice sets `hegemonDone`.
  - Cell selection for spoils/rout: deterministic — shared helper
    `borderCellsBetween(s, other: number, k: number, losing: "player" | "other"): number[]`
    returns up to k cells of the losing side that sit on the shared player↔other land front,
    lowest solidarity first (no rng; used by both resolve and preview so counts cannot drift).

## Preview integration (previewDilemma + playDilemmaFx)

- `ChoicePreview.note` union extends to: `"fortify" | "noTarget" | "noEffect" | "citywall" |
  "prophecyDeal" | "prophecyCond"`.
- New previews: warweary a `{note:"fortify"}`, b `{truce:"gain", cohesion:-1}`; boomtown a
  `{cohesion:1}`, b `{note:"citywall"}`; prophecy-1 a `{cohesion:-1, note:"prophecyDeal"}`
  (static: "지금 ▼ · 다음 십년에 심판"), b `{note:"noEffect"}`; prophecy-2 a
  `{note:"prophecyCond"}` rendered with the LIVE condition state ("결속 ≥50% → ▲▲ / 지금:
  47% ▼" — playDilemmaFx gains an optional `data` arg for the current avg), b `{note:"noEffect"}`;
  hegemon-1 a `{truce:"gain"}`, b `{note:"fortify"}`; hegemon-2 a `{cohesion:-2, truce:"gain"}`,
  b `{cohesion:1}`; hegemon-3 a `{cells:+8, cohesion:1, odds:battleOdds}`, b
  `{cohesion:-2, truce:"gain"}`.
- **playDilemmaFx refactor**: today `odds` wraps only the cohesion part. Change: compose the
  success line from ALL parts (cells+cohesion+truce), and when `odds` is set render
  `성공 {p}%: {parts} / 실패: {negated parts}` where negation flips cells sign and cohesion
  direction (truce omitted from the failure side). Existing unrest-b output stays semantically
  identical ("성공 50%: 결속 ▲ / 실패: 결속 ▼" — failure now names the meter, an accepted
  cosmetic change; update the Task-2 formatter test accordingly).
- `previewDilemma` stays rng-free: hegemon-3 reports `odds`, never a roll.
- `fxTruceGain` becomes duration-agnostic ("휴전 확보"/"truce secured") since new truces vary
  (warweary 20y, rally 2×20y, tribute 30y vs defector 10y); durations live in the choice labels,
  where they already appear today. The one Task-2 test asserting the old "+1 (10y)" string is
  updated.

## i18n

All card faces (title/a/b) extend `playDilemma`, all outcomes extend `playDilemmaOutcome`, both
KO and EN, same switch style. New `playDilemmaFx` note strings (`fxNoEffect`, `fxCitywall`,
`fxProphecyDeal`, `fxProphecyCond` with `{p}` current-percent slot). Copy stays terse — one line
per face element, matching the existing register (예언/패권국 tone follows the current 제후/변경
voice).

## Non-goals

Proposal ② (neighbor attitude display), ③ (world legacy / hall of fame), ④ (chronicle map ping);
bot behavior changes (attitudes driving stepSim targeting); save/load; any pure-history change;
new UI surfaces (cards render through the existing dilemma box + previews).

## Testing

1. Trigger tests per new card (forceOffer pattern; full-size worlds where thresholds need them).
2. Effect tests per outcome code (including truce writes, owner flips both directions, flag
   transitions prophecySponsored→prophecyDone, hegemon2→hegemon3→hegemonDone).
3. Arc-sequence test: force the hegemon condition, walk offer→resolve through all three faces on
   consecutive offer windows (stage cards bypass cooldown); dissolves cleanly if the hegemon dies
   between stages.
4. previewDilemma: rng-untouched + state-unmutated for every new code; preview↔resolve
   consistency on deterministic branches (warweary truce target, boomtown wall count, prophecy
   condition, hegemon spoils/rout cell count via `borderCellsBetween`).
5. playDilemmaFx: odds-wrapping refactor cases incl. negated failure side; update the one
   existing gamble-format assertion.
6. Golden guard: existing world.test hash test must stay green (`dilemmaFlags` never read on the
   pure path).

## Risks / notes

- offerDilemma draw-order change vs live games: documented above, accepted.
- Hegemon death mid-arc: dissolve rule specified (stage checks `s.alive`).
- `borderCellsBetween` must be deterministic and shared by resolve+preview (the Task-1 anti-drift
  pattern).
- Copy volume is the real cost; scope locked at 7 faces.

## Sources (benchmark research)

- [King of Dragon Pass — if50 retrospective](https://if50.substack.com/p/1999-king-of-dragon-pass)
- [KODP — Hardcore Gaming 101](https://www.hardcoregaming101.net/king-of-dragon-pass/)
- [Frostpunk — Wikipedia (three-act structure, final storm)](https://en.wikipedia.org/wiki/Frostpunk)
- [Civ VI agendas reception (the honesty constraint)](https://forums.civfanatics.com/threads/agendas-are-making-a-return-yay-or-nay.692131/)
