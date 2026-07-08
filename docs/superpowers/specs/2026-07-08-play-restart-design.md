# Play-mode Restart / Re-select on Game Over (Version B)

**Date:** 2026-07-08
**Status:** Design approved (post self-critique), ready for plan
**Scope:** Version B play-mode only (`src/ui/playApp.ts`, `src/ui/i18n.ts`, `src/theme.css`). Play-UI only — no engine change, golden hashes byte-identical.

## Problem

When a reign ends (defeated, or endured to year 500) the end banner shows the result + a reign-chronicle download, but there is **no way to play again** — the player must reload the page manually. The user wants a "restart and choose a nation again" affordance on the game-over screen.

## Design

Two buttons on the end banner (`renderBanner`), after the existing reign-export button:

- **▶ 다시 통치 / Play again** (primary) → calls `renderPicker()` — returns to the nation picker on the **same world**, so the player can choose a nation and start a fresh reign. Picking a different nation gives a genuinely different game (different start size/position/difficulty); picking the same nation is a deterministic retry.
- **🌍 새 세계 / New world** → `location.hash = "seed=" + randomSeed(); location.reload();` — reloads into a **new random world** and its picker. A fresh seed is required because a plain reload would reuse the current hash seed and regenerate the same world.

## Self-critique resolved

- **Listener leak on restart** — verified NOT an issue: `renderPicker()` does `root.innerHTML = ""`, which discards the map SVG and all its DOM listeners; `zoomPan.ts` attaches `window` listeners only during an active drag (added on `pointerdown`, removed on `pointerup`/`pointercancel`), so nothing persistent accumulates across restarts.
- **Determinism** — same-world + same-nation replays identically (seeded RNG); replay value comes from choosing a different nation. Not a defect; the picker supports it.

## Architecture

- `src/ui/playApp.ts`:
  - Import `randomSeed` from `./urlState`.
  - In `renderBanner`, after appending the reign-export button, append a `.restart-row` containing a `.btn-play-again` button (→ `renderPicker()`) and a `.btn-new-world` button (→ set hash + reload).
  - `renderPicker` is defined at the `createPlayApp` scope (sibling of `startGame`), so `renderBanner` reaches it through the closure.
- `src/ui/i18n.ts`: new KO/EN keys `playAgain`, `newWorld`.
- `src/theme.css`: a `.restart-row` layout rule (centred button row); the two buttons reuse the existing button styling.

## Data flow

Game reaches `end()` → `renderBanner()` draws result + export + the two restart buttons. **Play again** → `renderPicker()` re-mounts the picker (same world). **New world** → navigates to a fresh seed and reloads (playMain generates the new world).

## Error / edge handling

- `renderPicker()` fully resets by wiping `root`; the old game's `SimState`/closures are dropped (GC).
- `location.reload()` is a hard reload — no state to preserve.

## Testing

- `src/ui/playApp.test.ts`:
  - Play to the end deterministically: the game always terminates by turn 50 (`TICKS`, 500 years). Click `.btn-advance` in a loop until it disappears (≤50 iterations) → the banner (`.stub`) appears.
  - Assert the banner contains `.btn-play-again` and `.btn-new-world`.
  - Click `.btn-play-again` → the nation picker returns (`.nation-choice` present).
  - Do NOT click `.btn-new-world` (it calls `location.reload()`, unavailable/again-navigating in jsdom); assert its presence only.
- **Golden regression:** engine/world/history/playSim golden-hash tests stay byte-identical (play-UI only).

## Out of scope (YAGNI)

Mid-game restart / abandon (the request is "when it all ends"); carrying settings/language across a New-world reload beyond what the URL already does; a confirm dialog before restart.
