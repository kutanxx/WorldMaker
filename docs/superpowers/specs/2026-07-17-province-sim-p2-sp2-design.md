# Province Sim — P2 SP2: player-playable province slice — design

**Date:** 2026-07-17
**Status:** approved design, pending spec review → plan
**Project:** P2 (game plays in provinces). This spec is **SP2 of 3** — see decomposition in the SP1 spec
(`2026-07-16-province-sim-p2-sp1-design.md`).

## Context

P2 = the game plays in **provinces** (not cells), as a **fork**: a game-only province sim, while the map tool
(Version A, `historySim`) stays cell-based and golden-safe. SP1 delivered a headless, deterministic, **rng-free**
province-evolution engine `src/engine/provinceSim.ts` (AI nations own and conquer whole provinces over 50 ticks;
no player, no UI). SP1 is on `main` at `2913a9d`.

SP2 makes it **playable**: a human picks a nation and conquers whole provinces, in a **new, isolated app** that
does not touch the polished cell game (`play.html` / `playApp.ts`) or Version A.

## User decisions (brainstorming 2026-07-17)

1. **Scope = minimal playable vertical slice.** Pick a nation → attack adjacent provinces → advance → win/lose.
   Invest/stance levers, dilemmas, grudges, challenges, sea lanes, replay, daily/string seeds, ascension, and
   legacy are **out of scope** (later SP2 follow-ups). Balance tuning is SP3.
2. **Housing = a new separate app/page** (`playProvince.html` + `src/ui/provinceApp.ts` + a third landing card),
   fully isolated from the cell game. Rendering helpers are reused, not rebuilt.
3. **Victory = domination + survival.** Defeat = losing the capital province. See "Victory / defeat".
4. **Turn model = attack from every front.** Each turn the player may mark **multiple** adjacent enemy provinces
   as targets; advancing resolves them all at once.
5. **Combat feel = EU4/Risk-style whole-province conquest** (turn-based province flips), explicitly **not** HOI4
   continuous frontlines / division allocation.

## Goal

A minimal, actually-playable province game: a new `playProvince.html` whose `provinceApp.ts` lets a player pick a
nation on the province map, designate adjacent enemy provinces to attack, advance turns while AI nations evolve
via the SP1 engine, and win by domination or survival (or lose by capital capture). Deterministic given the
player's choices. Version A and the cell game are untouched.

## Non-goals (SP2 slice)

- No invest/stance levers, dilemmas, grudges/standing, challenges, sea lanes, replay, daily worlds, string-seed
  input, ascension difficulty, or legacy/annals. (Later.)
- No balance sweep — constants are placeholders; SP3 tunes (including SP1's flagged `SIZE_CAP`).
- No change to `provinceSim.ts`'s existing pure core semantics beyond the additive player-step wrapper below, and
  no change to `historySim`/`playSim`/`playApp`/Version A.

## Architecture

- **New files:** `playProvince.html` (entry), `src/ui/provinceApp.ts` (game UI + its test), and a third
  `.choice-card` in `src/landing.ts` linking to `playProvince.html` (relative path — Pages sub-path safe, per the
  home-link gotcha).
- **Engine layer:** a thin **player wrapper** added to `src/engine/provinceSim.ts` (same pattern as the cell
  game's `playSim` wrapping `historySim`). It stays **rng-free** and imports nothing new. The existing pure core
  (`buildProvinceAdj`, `initProvinceSim`, `pAggregate`, `stepProvinceSim`, `strength`) is unchanged; SP2 adds
  `stepPlayerTurn` alongside it.
- **Reused rendering (shared, not rebuilt):** province geometry + owner coloring via the existing
  `src/ui/provinceLayer.ts` helpers (`snapOwnersToProvinces`, `provinceOwners`) and `politicalBorders`
  (`src/engine/borders.ts`); plus `src/ui/lang.ts`, `installTipStrip`, and the home-link pattern.

## Engine layer — the player step

`stepPlayerTurn(s: ProvinceSimState, playerId: number, targets: Set<number>): PlayerStepEvents`

Runs one player turn. **Rng-free, deterministic.** Mirrors `stepProvinceSim`'s shape, with two changes: the
player nation never auto-initiates, and the player's explicitly-targeted enemy provinces are contested by the
player instead of by their strongest neighbour.

1. **Solidarity step** — identical to `stepProvinceSim` step 1 (frontier rise / interior decay, double-buffered).

2. **Contest & whole-province conquest (single double-buffered pass, `nextOwner = provOwner.slice()`).** For each
   province `p` with owner `o`, determine its attacker from the **pre-turn** state:
   - **Player-forced:** if `p` is in `targets` **and** the player borders `p` (some `adj[p]` province is owned by
     `playerId`) and `o !== playerId` → attacker = `playerId`. Any non-player province the player borders is a
     valid target: a live enemy's, a **since-eliminated** nation's leftover province, or **unowned** wilderness
     (for unowned `def = 0`). (Allowing dead nations' leftover provinces prevents stranded, unconquerable land.)
     The player's front province for the strength calc is the player-owned neighbour of `p` with the **highest
     `provSol`** (tie → lowest province id).
   - **AI auto:** otherwise attacker = the strongest **live, non-player** adjacent enemy by `agg.avg` (SP1's
     existing rule, but the player id is **excluded** from auto-initiation — the player only attacks its targets).
   - Resolve exactly as SP1: `atk = strength(attacker, p, attackerFrontProv)`, `def = o<0 ? 0 : strength(o, p, p)`;
     if `atk > def · CONTEST_THRESH`, `p` flips to the attacker in `nextOwner`.
   Because the player and AI attackers are all resolved from the same pre-turn `provOwner`/stepped `provSol` into
   `nextOwner`, player and AI attacks resolve **simultaneously** (no ordering bias). CONQUEST_SOL reset applied
   after the loop (as SP1).

3. **`alive` recompute, `tick++`** — identical to SP1 (a nation that lost its capital province is dead; the player
   losing its capital province ends the game — surfaced by the UI, not the engine).

**Events returned** (`PlayerStepEvents`): the conquests this turn and any eliminations, for the chronicle —
`{ conquests: { prov: number; from: number; to: number }[]; eliminated: number[] }`. Derived by diffing
pre-turn vs post-turn `provOwner` and `alive`; pure, no rng.

Notes:
- The player is a valid **defender**: AI nations can attack (and take) the player's provinces, including its
  capital. That is the threat.
- Stale/invalid targets (player no longer borders `p`, or `p` became player-owned or unowned) are silently
  ignored — the UI only offers currently-adjacent enemy provinces, and the guard above re-checks.

## Player loop (UI)

- **Picker.** Render the province map (owner-colored via `snapOwnersToProvinces` + province borders + nation
  borders). The player clicks a **live nation's** territory to play it. Record its starting province count
  (`startProvinces`) for the domination threshold. (Minimal: a random seed on load; a "new world" button re-rolls.
  No daily/string-seed input in the slice.)
- **Each turn.** Provinces adjacent to the player's territory that are **not** the player's own — a live enemy's,
  a since-eliminated nation's leftover, or unowned wilderness — are **armable** (`armableTargets(s, playerId)`):
  clicking toggles a target highlight (multiple allowed). "Advance" calls `stepPlayerTurn(s, playerId, targets)`, appends
  the returned events to the chronicle, clears targets, re-renders the map, and re-checks victory/defeat.
- **HUD (minimal).** Player province count / total land provinces; average solidarity (`pAggregate[playerId].avg`);
  turn `X / 50`; capital status; live-rival count. A chronicle log of conquest/elimination events.
- **Touch/desktop.** Reuse `installTipStrip` and the existing `pointer:coarse` sizing conventions; a home link
  back to the landing chooser.

## Victory / defeat

- **Defeat:** the player's capital province is captured (`alive[playerId] === false`) → immediate game over,
  naming the conqueror (the new owner of the capital province).
- **Domination victory (early end):** the player's province count reaches `DOMINATION_MULT × startProvinces`
  (relative to start, mirroring the challenges' relative-scaling lesson so a large start doesn't win instantly).
  Placeholder `DOMINATION_MULT = 3` — SP3 tunes.
- **Survival victory:** the player still holds its capital province after `PROVINCE_SIM_TICKS` (50) turns without
  hitting the domination threshold.
- Game-over banner + "Play again" (back to picker, same world) / "New world" (re-roll seed).

## Constants (placeholders — SP3 tunes; do not invent tuned values)

- Reuse SP1's engine constants unchanged. New UI-side: `DOMINATION_MULT = 3`, horizon = `PROVINCE_SIM_TICKS` (50).

## Determinism / safety

- **Rng-free.** The engine wrapper uses no `Math.random`/rng; the only inputs are the seed's world (SP1 partition)
  and the player's per-turn target choices. A fixed seed + fixed target sequence evolves identically every run.
- **New golden anchor:** a test drives a fixed player target sequence on seed 1 and pins the resulting `provOwner`
  FNV hash (capture-and-pin, as in SP1 Task 6).
- **Version A untouched:** `stepPlayerTurn` imports nothing from `historySim`/`playSim`/`intervention`/`src/ui/*`
  and never mutates `world`. A test asserts Version A's seed-1 `polityOf` golden `1350115163` is unchanged, and
  the full suite (incl. `world.test`) stays green. The new app is a separate entry — `play.html`/`playApp.ts` are
  not edited.

## SP2 known carry-forwards (from SP1 review, to honor here)

- **Capital-province collision** (two capitals in one province → `alive` only probabilistically true at t0): if
  the picker lets the player choose such a nation, its `alive`-at-start could be false. The picker offers only
  nations that are `alive` at t0, which sidesteps it; a follow-up may force distinct capital provinces.
- **`state.provinces === world.provinces` aliasing:** the UI must treat province objects as **read-only** (render
  from them, never write back), or freeze/copy at the app boundary, so it cannot corrupt `world`.

## Testing (headless + UI)

- **Engine (`provinceSim.test.ts`, added):** player conquest of a targeted weak enemy province; AI capturing a
  player province (player as defender); player capital defeat ends `alive[playerId]`; player excluded from
  auto-initiation (an untargeted enemy the player could beat is not auto-taken); events reflect the diff;
  determinism golden for a fixed seed-1 target sequence; Version A `1350115163` unchanged.
- **UI (`provinceApp.test.ts`, jsdom):** picker renders the province map and starts a game on nation click; only
  adjacent live-enemy provinces are armable and toggle; advance applies the step and logs events; domination and
  survival and defeat each produce the right game-over banner; play-again / new-world reset. Plus a real-browser
  end-to-end verification (map renders, targeting works, advance/console clean).

## Deliverable

A playable, isolated province game (`playProvince.html`) on the SP1 engine: pick a nation, attack whole provinces
from every front, win by domination or survival, lose by capital capture — headless engine wrapper pinned by
determinism + Version-A safety tests, UI verified in a real browser. SP3 then tunes balance; later SP2 follow-ups
add the deferred levers/features.
