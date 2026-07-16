# Micro-Challenges (marks of a reign) — design

**Date:** 2026-07-16
**Status:** approved design, pending spec review → plan
**Positioning:** optional side-feats that add per-reign flavour and bragging rights, distinct from the three
victory goals. Recognition-only — no mechanical reward, so the engine, golden hashes, and balance are untouched.

## Goal

Give the empire-sim (Version B, `play.html`) three **fixed optional challenges** shown alongside the existing
victory goals. Completing one is a small "look what I pulled off" moment: the chip flips to ✓, the chronicle
pings, and the completed challenge is recorded in the reign's hall-of-fame entry (a Hades "Fated List" analog).
They are NOT win conditions and grant nothing mechanical.

Benchmark grounding (research 2026-07-16): EU4 achievements = "do X under a playstyle constraint"; Civ VI =
clever-named compound feats; roguelites (Balatro/Monster Train/Hades) = optional restriction runs + a persistent
feat checklist for bragging. Takeaway applied here: **constraint-flavoured feats + a persisted record**, kept
tiny (3 fixed) for a phone-scale casual game.

## Decisions (locked during brainstorming)

- **Purpose:** variety / replay flavour + bragging, NOT turn-to-turn direction, tutorial, or reward.
- **Reward:** recognition only (chronicle ping + legacy badge). No stability/combat effect.
- **Count / selection:** exactly **3 fixed** challenges, the same every reign. No random draw, no per-start
  viability filter (all three are achievable from any start), no `s.rng` / `Math.random` — the simplest shape.
- **Prominence:** a separate `.challenges` row directly under the victory-goal (`.goals`) row.
- **Scope:** Version B only. Version A (map tool) is untouched.

## The three challenges

Targets (N/M/year) are **tunable placeholders**; a post-implementation sweep tunes them. Each challenge is a
pure predicate over play-session state.

| code | name (KO / EN) | icon | condition | fail |
|------|----------------|------|-----------|------|
| `bloodless` | 무혈의 치세 / Bloodless | 🕊 | end the reign (survive to the end / any non-defeat ending) having **never attacked** | the moment the player commits any attack → locked failed |
| `blitz` | 전격전 / Blitz | ⚡ | reach **≥ N owned tiles by year Y** (default N = 100, Y = 200) | year passes Y still below N → locked failed |
| `phoenix` | 불사조 / Phoenix | 📈 | be pushed down to **≤ L tiles**, then recover to **≥ M tiles** (default L = 15, M = 50) | never fails — completes whenever both have happened |

Rationale for this trio: three distinct playstyles (pacifist / rush / comeback), all viable from any start, none
overlapping the victory goals (conquest = eliminate all rivals, prosper = many cities + cohesion, endure = reach
year 500). Cut during design: `founder` (overlaps prosper), `conqueror`/all-rivals (overlaps conquest),
`underdog`/`giant-slayer`/`thalassocracy` (needed a start-viability filter), `tall` (compound streak, low
value-per-complexity).

## Architecture

### New module `src/ui/challenges.ts` (pure, DOM-free)

Reads play state, never mutates it; imports `SimState` type-only from `historySim`. No engine changes.

```ts
export type ChallengeState = "active" | "done" | "failed";

// small session-tracked history the raw SimState doesn't keep
export interface ChallengeCtx {
  everAttacked: boolean; // set true when the player commits an attack
  minCellsEver: number;  // running min of the player's owned-tile count
}

export interface ChallengeProgress {
  // numbers the chip text/tooltip format via i18n placeholders
  cells?: number; target?: number; year?: number; low?: boolean;
}

export interface Challenge {
  code: "bloodless" | "blitz" | "phoenix";
  icon: string;
  evaluate(s: SimState, ctx: ChallengeCtx, over: boolean): { state: ChallengeState; progress: ChallengeProgress };
}

export const CHALLENGE_BLITZ_TILES = 100;
export const CHALLENGE_BLITZ_YEAR = 200;
export const CHALLENGE_PHOENIX_LOW = 15;
export const CHALLENGE_PHOENIX_HIGH = 50;

export const CHALLENGES: Challenge[]; // the fixed three, in display order
```

`evaluate` derives the player's current tile count from `aggregate(s)[s.playerPolity].cells`, the year from
`s.tick` (× `YEARS_PER_TICK`), and the state as follows:

- **bloodless** — `ctx.everAttacked` → `failed`; else `over && s.alive[player]` (any non-defeat end) → `done`;
  else `active`.
- **blitz** — `cells >= N` → `done`; else `year > Y` → `failed`; else `active` (progress = cells/N, year).
- **phoenix** — `ctx.minCellsEver <= L && cells >= M` → `done`; else `active` (progress: `low = minCellsEver<=L`,
  cells/M). Never `failed`.

### Session wiring in `playApp.ts` `startGame`

- Session state (built once, alongside the existing per-reign lets): `const chalCtx: ChallengeCtx = { everAttacked: false, minCellsEver: <player start cells> }` and `const chalDone = new Set<string>()`.
- Update `chalCtx` where state advances:
  - `everAttacked = true` at the point the player commits an attack action (the advance handler that applies a
    player attack).
  - `minCellsEver = Math.min(minCellsEver, currentCells)` once per rendered turn.
- `renderChallenges()` (called from `renderAll` / `renderPending`, right after `renderGoals`): clears and rebuilds
  the `.challenges` row. For each `CHALLENGES` entry, `evaluate(...)` → a chip. When a challenge is newly `done`
  (not already in `chalDone`): add it, `appendLog(playT(lang,"chalDone").replace("{name}", …), "hl")` (a chronicle
  ping — no cell, so it is an inert log line), so the completion reads in the chronicle.
- At reign end (`recordReign` call site, already in `startGame`), pass `challenges: [...chalDone]`.

The `.challenges` row element is created once and appended to the info rail `side` next to `goals` so it survives
re-renders (same pattern as the home link / goals).

### UI

`.challenges` row under `.goals`:

- label: `playT(lang, "challenges")` ("도전" / "Challenges")
- one `.challenge-chip` per challenge, class-modified by state:
  - `active`: `{icon} {name} — {progress}` + tooltip (the full condition)
  - `done`: `.done` `✓ {icon} {name}` (highlighted)
  - `failed`: `.failed` `✗ {icon} {name}` (greyed, struck)
- coarse/phone tap sizing inherits the existing `.goal-chip` coarse rules (add `.challenge-chip` to them).

### Persistence — additive legacy field

`LegacyEntry` gains an optional field; `v` stays `1` and reads stay tolerant (old rows simply lack it), so this is
back-compatible with no migration:

```ts
export interface LegacyEntry {
  // …existing 7 fields…
  challenges?: string[]; // codes of micro-challenges completed this reign (absent = none)
}
```

- `recordReign` already takes `Omit<LegacyEntry,"v"|"n">`; the caller adds `challenges`.
- Game-over legacy panel and the picker annals render a small 🏅 badge per completed code (icon row), with a
  tooltip naming them. Absent/empty → no badge (older reigns unaffected).

### i18n (`PLAY_UI`, both languages)

New keys: `challenges` (row label), `chalDone` (ping, `{name}` placeholder), `chalFailed` (optional chip suffix),
and per-challenge `chalBloodless`/`chalBlitz`/`chalPhoenix` (names) + `tipChalBloodless`/`tipChalBlitz`/
`tipChalPhoenix` (condition tooltips). Progress strings reuse number placeholders.

## Determinism / safety

- Pure UI + play-session state; `challenges.ts` never touches the engine. No `s.rng` draw, no `Math.random`.
- Everything is gated inside `startGame` (playerPolity ≥ 0), so the pure history path (Version A) and golden
  hashes are byte-unchanged. No balance change (recognition-only).

## Testing

- `challenges.test.ts` (pure): for each challenge, drive `evaluate` through its transitions —
  - bloodless: active → failed on `everAttacked`; active → done on `over` & alive.
  - blitz: active → done at N tiles before Y; active → failed once year > Y below N.
  - phoenix: active until `minCellsEver ≤ L` AND cells ≥ M, then done; stays active if never dropped low.
- `playApp.test.ts`: the `.challenges` row renders 3 chips on the play screen; a chip shows `.done` after its
  condition is met (drive a minimal case, e.g. blitz by seeding tile count, or bloodless done at game over); the
  completed code is written to legacy via `recordReign` (spy/fake storage).

## Out of scope / deferred

- Number tuning (N/Y/L/M) — placeholder defaults now; sweep after implementation.
- Any mechanical reward, random selection, larger pool, or Version-A challenges.
