# Multiple Victory Conditions + Goals (Version B)

**Date:** 2026-07-08
**Status:** Design approved (research + measurement grounded), ready for plan
**Scope:** Version B play-mode. Victory logic in `src/engine/playSim.ts` (the play layer, NOT the pure `historySim` engine); UI in `src/ui/playApp.ts` / `i18n.ts` / `theme.css`. Player-gated + read-only over the history sim → golden hashes byte-identical.

## Problem

The game has rich mechanics but only one goal — "survive to year 500" — which is passive. The user also observed that nations war every turn and asked whether the player must always fight. Both point to the same fix: **multiple victory paths, including a viable non-military one**, so the player has direction and can win by building rather than only by enduring constant war.

## Research + measurement grounding

- **Domination = capitals, not % of map.** Civ VI wins by capturing every original capital, not 100% land. ([Civ domination](https://civilization.fandom.com/wiki/Domination_victory_(Civ5))) Our sim already annexes a nation when its capital falls (`historySim.ts:278`), so "eliminate all original rivals" maps onto existing mechanics and dodges the civil-war size cap that made a "% of land" goal fragile.
- **Overexpansion penalty is genre-standard** (EU4 overextension, Civ happiness, Stellaris sprawl); "every good 4X inhibits expansion." ([EU4 Overextension](https://eu4.paradoxwikis.com/Overextension), [tall vs wide](https://forum.paradoxplaza.com/forum/threads/empire-sprawl-and-overextension-how-it-could-be-changed-to-make-tall-vs-wide-viable.1471429/)) Our **civil war** (large realm + low cohesion → split) IS this penalty; it validly balances the wide (conquest) path against the tall (prosperity) path.
- **Headless measurement** (10 seeds, full-size worlds, naive bots; harness since deleted):
  - **Turtle** (invest-only, defensive) survived **10/10**, cohesion ~0.56, even grew to 700–1750 cells → **peaceful play is fully viable** (answers the user's concern with data).
  - **Builder** (found every turn) reached **12–36 founded cities**, min cohesion ~0.49 → a "3 cities" bar is trivial; the meaningful bar is higher, and cohesion is the natural tension (city-spam alone can't hold 0.55).
  - **Conqueror** (attack strongest, aggressive) eliminated ~4–5 of 7 rivals but was **never** the last (0/10), cohesion crashing to ~0.02 → total domination in 50 turns is a hard, self-limiting prestige path (overexpansion penalty firing).

## Design

Three victory paths, all checkable each turn and able to trigger **early**; if none triggers, surviving to year 500 is the default **endurance** win. The only loss remains **capital fall**. This mirrors Civ (a score/time win if no faster victory lands). All checks are player-gated.

### Victory conditions (constants are tunable knobs, seeded from the measurement)

- **⚔ 정복 / Conquest** — no other `origin:"initial"` polity is still alive (you are the last original realm). Hard, aggressive, prestige. (Tunable fallback if playtest shows it's impossible: hold ≥ ⅔ of the original capitals.)
- **🏘 번영 / Prosperity** — hold **≥ `PROSPER_CITIES` (6)** of your own founded cities **and** average cohesion **≥ `PROSPER_COH` (0.55)**, sustained **`PROSPER_STREAK` (3)** consecutive turns. Reachable (builders hit 12–36 cities) but requires balancing building *and* cohesion (no single naive strategy did both) — the "tall" skill path.
- **👑 치세 / Endurance** — reach year 500 (`tick ≥ TICKS`) still alive. The default win when no faster victory triggered.
- Priority when several are met the same turn: **Conquest > Prosperity > Endurance**.

### Goals panel (direction, kept compact)

A single compact `.goals` line under the standing strip showing live progress toward each path, so the player knows what they are working toward:

`목표 · ⚔ 라이벌 5 · 🏘 도시 2/6 · 결속 OK · 1/3 · 👑 120/500년`

Compact by design (the standing strip was just decluttered) — one line, icons + numbers, no cards.

### Victory banner

`end()` carries a **victory kind** (`"conquest" | "prosperity" | "endurance" | "defeat"`). The banner head text differs per kind (unified the realm / brought lasting prosperity / endured 500 years / fell), then reuses the existing reign-chronicle export and the restart buttons.

## Architecture

- `src/engine/playSim.ts`:
  - Export constants `PROSPER_CITIES = 6`, `PROSPER_COH = 0.55`, `PROSPER_STREAK = 3`.
  - `export interface VictoryProgress { rivalsLeft: number; initialRivals: number; cities: number; cohesionOk: boolean; year: number; conquest: boolean; prosperityGate: boolean }`
  - `export function victoryProgress(s: SimState): VictoryProgress` — pure read over the sim (uses `aggregate`, `s.alive`, `s.polities[].origin`, `s.foundedCities`, `s.tick`). `conquest = initial rivals all dead`; `prosperityGate = cities ≥ PROSPER_CITIES && cohesionOk`. No streak here (streak is turn context).
- `src/ui/playApp.ts`:
  - Track a `prosperStreak` closure counter (like `momentum`): after each `playTurn`, `prosperStreak = victoryProgress(s).prosperityGate ? prosperStreak + 1 : 0`.
  - After a turn, resolve the victory kind: `conquest` → if `vp.conquest`; else `prosperity` → if `prosperStreak ≥ PROSPER_STREAK`; else `endurance` → if `s.tick ≥ TICKS`; else `defeat` → if the player is dead; else continue. Call `end(kind, cause)`.
  - Add `renderGoals()` producing the compact `.goals` line from `victoryProgress` + `prosperStreak`; call it in `renderAll`.
  - `end(kind, cause?)` + `renderBanner` pick head text by kind.
- `src/ui/i18n.ts`: goals labels + the four banner-kind heads (KO/EN).
- `src/theme.css`: `.goals` compact styling.

## Data flow

`playTurn` (unchanged) → UI reads `victoryProgress(s)`, updates `prosperStreak`, resolves the kind, and either ends (with the kind) or re-renders (goals line updates). The pure history sim is untouched.

## Error / edge handling

- Player already dead (capital fell) → `defeat` (checked before endurance).
- No initial rivals ever (edge worlds) → conquest could be trivially true at start; guard: conquest requires `initialRivals ≥ 1` (there was someone to conquer).
- Prosperity streak resets to 0 whenever the gate is not met (e.g., a city lost or cohesion dips).

## Testing

- `src/engine/playSim.test.ts`:
  - `victoryProgress`: `conquest` true only when all initial rivals are dead and there was ≥1 (construct a state with rivals dead); `prosperityGate` true only when cities ≥ 6 and cohesion ≥ 0.55 (drive `foundedCities`/`solidarity`); `rivalsLeft`/`cities` counts correct.
  - constants exported with the specified values.
- `src/ui/playApp.test.ts`:
  - the `.goals` line renders with the three path readouts for a live player.
  - a game advanced to the turn-50 cap ends with the **endurance** banner head (deterministic; every reign ends by turn 50).
- **Golden regression:** `historySim`/`world`/`history` golden-hash tests stay byte-identical (no engine edits; victory logic is player-gated in the play layer).

## Out of scope (YAGNI)

Rival victory as a separate loss rule (capital-fall already covers losing to a strong rival); diplomatic/cultural victory tiers (only the three agreed paths); AI pursuing specific victory conditions; the prosperity/conquest numbers are seeded from measurement but a real human feel-pass may retune them (they are exported constants).
