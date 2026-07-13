# Ascension Difficulty (StS-lite) — Design

**Date:** 2026-07-13 · **Scope:** engine (`playSim.ts` init param, `historySim.ts` one solidarity nudge), UI (`legacy.ts` level derivation + annals marker, `playApp.ts` picker badge), i18n. **Origin:** backlog 🅰③, the last item of the benchmark-researched shortlist — Slay the Spire's Ascension gives repeat play on the same board a reason to exist; ours couples to the per-seed legacy annals and gives the daily world a "win it, then win it harder" arc (per-seed = the ladder persists; daily = fresh seed each day resets it naturally).

## Mechanics

### 1. Level derivation (UI layer, `src/ui/legacy.ts`)

```ts
export const ASCENSION_CAP = 5;
export function ascensionLevel(entries: LegacyEntry[]): number {
  return Math.min(ASCENSION_CAP, entries.filter((e) => e.kind !== "defeat").length);
}
```

- Wins on this seed (conquest/prosperity/endurance) count; defeats don't (no punishment for losing — retry freely). Auto-applied: winning at A(n) means the next run IS A(n+1) — equivalent to the StS ladder without a selector UI.
- Derived fresh from `loadLegacy(seed)` at picker time; no new storage.

### 2. Engine modifier — ONE dial (`historySim.ts` + `playSim.ts`)

- `SimState` gains `ascension: number` (0 from `initSim` — pure path untouched). `initPlaySim(world, seed, playerPolity, stance, ascension = 0)` sets it (existing call sites compile unchanged).
- `export const ASCENSION_SOL_DELTA = 0.005;` (initial; see Calibration).
- In stepSim's solidarity update (the per-cell loop around historySim.ts:274-285, where the player's stance nudge already lives), NON-player, non-free polities regenerate faster:

```ts
    if (s.playerPolity >= 0 && s.ascension > 0 && o !== s.playerPolity) sv += ASCENSION_SOL_DELTA * s.ascension;
```

placed right after the player's `STANCE_SOL_DELTA` line (the free-polity branch already returned earlier — verify; if not, add the `!s.polities[o].free` guard). At A5 this is +0.025/tick — every rival regenerates better than the player's internal stance (+0.02), which is the intended squeeze.
- **Honesty:** the nudge changes REAL stored solidarity, so the border-report cohesion line, meter tooltips, and every contest read the same truth — no display the sim doesn't back.
- **Pure path byte-identical:** `ascension` is 0 unless `initPlaySim` sets it, and the nudge is additionally gated on `playerPolity >= 0`. The `o !== s.playerPolity` comparison is inside that gate, so the `o === -1 === playerPolity` trap cannot fire.
- No rng draws; no reordering.

### 3. UI surfaces (minimal)

- **Picker badge:** when `ascensionLevel(legacy) > 0`, the picker title (next to the existing daily badge slot) shows `⬆ 상승 N` (`ascBadge`, KO `⬆ 상승 {n}` / EN `⬆ Ascension {n}`) with a title tooltip `ascTip`: KO `이 세계에서 {n}승 — 모든 라이벌의 결속 회복이 {n}단계 강해집니다` / EN `{n} wins on this world — every rival's cohesion regenerates {n} steps faster.`
- **Annals marker:** `LegacyEntry` gains optional `asc?: number` (recorded at `recordReign` when > 0; the v1 filter stays tolerant — the field is optional, no schema bump). Picker annals rows append `⬆{asc}` after the year when present, so the hall of fame shows WHICH ladder step each win happened at.
- `recordReign` call in playApp's `end()` passes the run's level (available via the sim: `s.ascension`).

## Calibration (measured — the stance-retune/revenge method)

Throwaway sweep during implementation (numbers into the report, file deleted): 10 seeds × {A0, A3, A5}, pass-only internal-stance runs to game over; record survival ticks + final cells. Acceptance:
1. A0 is byte-identical to today (nudge gated off at level 0).
2. A5 is clearly harder (median survival/final-cells visibly below A0) but NOT hopeless (some seeds still survive the 50 ticks even passively — active play must stay winnable).
3. Pre-authorized levers: `ASCENSION_SOL_DELTA` 0.003 if A5 is brutal, 0.008 if invisible. Controller adjudicates; implementer only reports.

## Determinism / constraints

- Golden FNV hash tests untouched (pure path never sets ascension).
- Verbatim advance handler untouched. `initPlaySim`'s new parameter is optional — the picker's `agg0` startup call and every test call site compile unchanged (level 0).
- `wm:legacy` storage failures already degrade to `[]` → level 0 — failure-proof by construction.

## Testing

- **legacy.test.ts** (or the file where legacy helpers are tested): `ascensionLevel` counts wins only, caps at 5, empty → 0; `recordReign` round-trips `asc`.
- **Engine test:** two `initPlaySim` sims same seed, one A0 one A5, one `playTurn(s, null)` each — assert some non-player cell's solidarity is strictly higher in the A5 run and the player's own cells are equal; assert `initSim` leaves `ascension === 0`.
- **playApp.test.ts:** picker shows no badge on a fresh seed; after `recordReign` with a win entry (seed-scoped localStorage, try/finally cleanup like the lang tests), re-created picker shows `⬆` badge with non-empty tooltip; annals row shows the `⬆` marker for an entry with `asc`.
- **Golden hashes:** untouched.

## Rejected alternatives

- **Per-level distinct effects (true StS)** — one dial keeps a "간단한 게임" legible; more dials only after the feel-pass asks.
- **Picker level selector** — YAGNI until someone wants to replay lower levels; auto-max matches StS default flow anyway.
- **Losses increment too** — punishes retrying, the opposite of the roguelite loop.
- **Uncapped** — unbalanceable, and the annals ★ comparison loses meaning.
- **Buffing bot ATTACK instead of cohesion regen** — regen is visible in the border report and meters (honest); a hidden attack multiplier would be another invisible hand.
