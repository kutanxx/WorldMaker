# Reign Legacy — per-seed dynasty chronicle (DF/morgue-file benchmark)

**Date:** 2026-07-11
**Status:** Approved design (bundle ①; user chose legacy+attitude over save/load after the backlog audit — a simple game keeps runs one-sitting, but what REMAINS after a run is cheap and durable)

## Why

Runs leave nothing behind — no reason to replay a world. Benchmarks: **Dwarf Fortress** (the world persists; new games build on old history), **roguelike morgue files** (Cogmind/DCSS — a run record that *reads like a story*, not a stat row), **Reigns** (the lineage of past rulers). Deliberately NOT save/load: recording only *finished* runs needs a fixed 7-field schema, no SimState serialization, no migration tax.

## Storage (language-neutral, fixed schema)

`localStorage["wm:legacy:<seed>"]` → JSON array, newest first, capped at `LEGACY_CAP = 20`.

```ts
interface LegacyEntry {
  v: 1;
  n: number;                    // 제N대 — 1-based reign counter per seed
  nation: string;               // player polity name
  kind: "conquest" | "prosperity" | "endurance" | "defeat";
  cause: string;                // conqueror name when kind === "defeat", else ""
  year: number;                 // final year (tick * YEARS_PER_TICK)
  peakCells: number;
  citiesFounded: number;
  epitaph: { code: EpitaphCode; data: Record<string, string | number> }; // localized at RENDER time
}
```

Storage failures (quota, privacy mode, corrupt JSON) are silently non-fatal: reads return `[]`, writes are try/caught — the game never breaks because localStorage did.

## Epitaph — the morgue-file lesson: one sentence that tells the run's story

New UI-level module `src/ui/legacy.ts` (pure functions + a thin storage wrapper):

```ts
type EpitaphCode = "epiFallen" | "epiUnified" | "epiSlewHegemon" | "epiSurvivedShadow" | "epiProphecy" | "epiGoldenAge" | "epiEndured";
```

- `composeEpitaph(kind, cause, highlights: DilemmaOutcome[]): { code: EpitaphCode; data }` — highlights are the FULL outcome objects (code + data), so `epiSlewHegemon` keeps the hegemon's `{name}`. Priority order, first match wins:
  1. `defeat` → `epiFallen {conqueror}` ("Nianthael의 손에 무너졌다")
  2. `conquest` → `epiUnified` ("천하를 통일했다")
  3. highlight `hegemonVictory` → `epiSlewHegemon {name}` ("패권국 {name}을 결전에서 꺾었다")
  4. highlight `hegemonRout`/`hegemonKneel`/`hegemonTribute` → `epiSurvivedShadow {name}` ("{name}의 그림자 아래에서 살아남았다")
  5. highlight `prophecyFulfilled` → `epiProphecy` ("예언을 이루었다")
  6. `prosperity` → `epiGoldenAge` ("황금기를 이루었다")
  7. fallback `endurance` → `epiEndured` ("500년을 버텼다")
- **Highlights source:** dilemma outcomes are NOT in `s.events` (they only reach the DOM log), so `playApp` keeps a session-local `highlights: DilemmaOutcome[]` — outcomes pushed when `resolveDilemma` returns a `hegemon*`/`prophecy*` code. Zero engine change.
- **Reign counter:** `n = (newest entry's n ?? 0) + 1` — it keeps counting past the 20-entry cap (제27대 is possible with only 20 rows kept).
- Rendering: `playLegacyEpitaph(lang, code, data): string` in i18n.ts (KO/EN switch, same style as `playDilemmaOutcome`).

## API (`src/ui/legacy.ts`)

```ts
export function loadLegacy(seed: number, storage?: Storage): LegacyEntry[];      // [] on any failure
export function recordReign(seed: number, entry: Omit<LegacyEntry, "v" | "n">, storage?: Storage): void;
export function seedBestPeak(entries: LegacyEntry[]): number;                    // for the ★ record badge
```

`storage` defaults to `window.localStorage`; injectable for tests.

## UI (playApp.ts)

- **Write point:** inside `end(kind, cause)` — build the entry from the existing reign scorecard values (`peakCells`, `citiesFounded`) + `composeEpitaph`, call `recordReign`. Recorded for EVERY finished reign, win or lose.
- **Picker panel:** `renderPicker()` gains, below the nation cards, a `.legacy-panel` "이 세계의 연대기 / Annals of this world" listing up to `LEGACY_SHOW = 5` entries:
  `제3대 · Glounman · ⚔ 312년 — "패권국 Nianthael을 결전에서 꺾었다" ★`
  (kind icon ⚔🏘👑/☠, final year, epitaph; `★` on the entry holding the seed's best `peakCells`). Hidden entirely when no entries (first visit unchanged).
- **☠ 복수전 badge:** if the latest entry is a `defeat`, the nation card whose name equals `cause` gets a small `.revenge-badge` "☠ 복수전 / Vengeance" (the conqueror is pickable when it's an initial polity; if it isn't among the choices, no badge — fine).
- i18n: all panel strings + epitaph codes KO/EN.

## Non-goals

Save/load (ICEBOX — rng blocker solved, revisit if runs lengthen); cross-seed hall of fame; storing full run event logs (reign chronicle export already covers per-run share); editing/deleting entries.

## Testing

1. `legacy.ts` unit: recordReign→loadLegacy roundtrip with injected in-memory Storage; reign counter increments; cap at 20; corrupt JSON → `[]`; quota-throw write → no crash.
2. `composeEpitaph` priority table (each branch).
3. playApp DOM: play to a guaranteed end (existing turn-50 loop pattern), then `renderPicker` via "play again" → `.legacy-panel` present with 1 entry; seeded-storage test renders ☠ badge on the matching nation card.
4. Full suite (pure UI — goldens untouched).

## Sources

- [Grid Sage Games — morgue files: history logging reads like a story](https://www.gridsagegames.com/blog/2019/08/building-ultimate-roguelike-morgue-file-part-4-history-logging/)
- [Dwarf Fortress — world persistence](https://dwarffortresswiki.org/index.php/World_activities)
