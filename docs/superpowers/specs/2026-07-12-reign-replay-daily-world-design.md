# Reign Replay + Daily World — Design

**Date:** 2026-07-12 · **Mode:** Version B (play) + landing · **Benchmarks:** Dwarf Fortress legends mode (a finished history you can explore), Spelunky Daily (one shared seed per day, everyone competes on the same board).

## Problem

1. A reign ends with a banner and a downloadable chronicle, but the *shape* of the run — the surge, the collapse, the border that held for 200 years — is invisible. `stepSim` already records a per-tick `s.snapshots` (year + owner array) that play mode never reads. The payoff data exists; there is no payoff surface.
2. Every player is on their own seed. There is no shared board, so the per-seed legacy annals (`wm:legacy:<seed>`) never contain anyone but yourself on a seed nobody else will visit. A daily seed turns the existing legacy panel into "today's hall of fame" for free.

## Feature 1 — Reign Replay (치세 리플레이)

Game-over gains a territory-timeline replay on the **main play map**, controlled from the **bottom command bar** (which `end()` currently empties with `actions.innerHTML = ""` — dead space at exactly the right moment).

### Mechanics

- **Data:** read-only over `s.snapshots` (one per tick, snapshot 0 = year 0; endurance run = 51 frames). No rng touched, no engine change, pure path unaffected.
- **Control:** reuse `createTimeline` (▶/⏸ + range slider + year readout, 300 ms/frame). Mounted into the `actions` bar when the game ends.
- **Rendering:** `startGame` keeps a `replayIndex: number | null` (null = live). `renderMap()` passes `replayIndex === null ? s.owner : s.snapshots[replayIndex].owner` to `politicalLayer` with the SAME options as live (fills, labels, player magenta, legend off) — the last frame is byte-identical to the current map, so scrubbing to the end "lands" on the present. Timeline `onIndex(i)` sets `replayIndex = i` and calls `renderMap()`.
- Old snapshots may contain since-dead polities; `s.polities` never shrinks, so name/color lookups stay valid for every historical owner id.

### Type loosening (timeline.ts)

`createTimeline(history: History, …)` only reads `.snapshots[i].year`. Loosen the parameter to a structural type (`{ snapshots: { year: number }[] }`) so `SimState` passes without a cast. Version A call sites compile unchanged.

### Year formatting (timeline.ts)

`readout` hard-codes `` `${year}년` ``. Add an optional `formatYear?: (y: number) => string` parameter defaulting to the current Korean string (Version A unchanged); play mode passes its `playYear(lang, y)` so EN reigns don't show `년`.

### Lifecycle (the one real hazard)

`createTimeline`'s ▶ runs a `setInterval`; the game-over screen can be torn down under it three ways. All three must call `timeline.destroy()` (and reset `replayIndex = null` where the map survives):

1. **다시하기 (play again)** → `renderPicker()` replaces the DOM; a live timer would keep painting a detached slot.
2. **새 세계 (new world)** → `location.reload()` — destroy anyway for symmetry (cheap, and covers any future non-reload path).
3. **Language toggle** → `rerender()` rebuilds the banner; the replay bar is rebuilt too (fresh `createTimeline` with the new formatter), old one destroyed first.

Track the live instance in a `startGame`-scoped `replayBar: Timeline | null`.

### Edge cases

- **1-tick defeat** (snapshots length ≥ 2 after one turn; but a turn-0 loss is impossible — defeat is checked after a turn): shortest real case is 2 frames; `max = length − 1 ≥ 1`. Slider still works. If `max === 0` ever occurs, `createTimeline` already clamps and ▶ stops immediately — no guard needed.
- **Map interactions during replay:** cell-click targeting is already gated behind `over === false`; no new gating required. (Verify in implementation; if any handler survives game-over, gate it on `replayIndex === null` too.)

## Feature 2 — Daily World (오늘의 세계)

One shared world per UTC day, reachable from the landing page in one click.

### Mechanics

- **Seed name:** `daily-YYYY-MM-DD` from the UTC date (`new Date().toISOString().slice(0, 10)`). Pure helper in `landing.ts` (or a tiny shared module):
  - `dailyName(date: Date): string` → `"daily-2026-07-12"`
  - `dailyTarget(date: Date): string` → `"play.html#seed=daily-2026-07-12"` (same URL-name convention `nameTargets` uses — the name stays readable in the URL).
- **World derivation:** free — `parseSeedValue` already hashes non-numeric strings via `hashStringToSeed`. Same day ⇒ same world for everyone (the Spelunky pact).
- **Landing UI:** a third row under the name-seed input: one button `🗓 오늘의 세계 · Daily World — 2026-07-12` → `location.assign(dailyTarget(new Date()))`. No map variant (the daily is a *play* ritual; the map is reachable by typing the name).
- **Hall of fame, free:** `wm:legacy:<seed>` is already per-seed, so the picker's legacy panel on the daily seed IS today's annals. Zero code.

### Daily badge (picker)

`createPlayApp` receives only the numeric seed — no signature change needed: compute `hashStringToSeed(dailyName(new Date()))` in `playApp` and, when it equals `seed`, render a `🗓` tag (class `daily-badge`, KO "오늘의 세계" / EN "Daily World") next to the picker title. Yesterday's daily URL opened today simply shows no badge (correct: it is no longer *the* daily).

## i18n

New play strings: badge label (`dailyBadge`). Landing is bilingual-inline like its existing copy (no i18n framework on landing). Timeline formatter uses the existing `playYear`.

## Testing

- **timeline.test.ts:** `formatYear` override is used; default stays `…년`; structural-type call with a bare `{ snapshots }` object compiles (existing tests already do this — the cast disappears).
- **playApp.test.ts (jsdom):** game over ⇒ replay bar present in the command bar; `onIndex` scrub ⇒ map rerendered from `snapshots[i].owner` (assert a cell's fill differs between frame 0 and the final frame on a run where territory changed, or assert via owner-array plumbing); play-again click ⇒ timer stopped (spy on `destroy` or assert no interval leak via fake timers).
- **landing.test.ts:** `dailyName`/`dailyTarget` deterministic for a fixed `Date`; UTC (a Date at 23:30−09:00 vs 00:30+09:00 crossing — pin with explicit UTC timestamps); chooser renders the daily button with today's date.
- **Golden hashes:** untouched — replay reads existing state; daily is just a seed string. All 477 existing tests must pass as-is.

## Rejected alternatives

- **Mini-map inside the banner card** — too small to read territory detail; duplicates a renderer invocation for a worse view.
- **Cinematic auto-play only (no scrubber)** — DF legends' value is *exploration*; scrubbing is the feature.
- **Separate replay page / route** — over-engineering; the map is already on screen.
- **Local-date daily** — breaks "same world for everyone"; UTC chosen (user-confirmed).
- **Daily leaderboard beyond local legacy** — needs a server; out of scope by standing constraint (no backend).
