# Province play P1: read the board on one screen (design)

Date: 2026-07-23
Scope: `playProvince.html` (province game), play mode. UI-only.

This is P1 of a four-part playtest-driven improvement set. P1 = the layout/HUD group
(task-order A1, A2, A5 from the user's playtest brief, `WorldMaker_ClaudeCode_작업지시서.md`).
P2 (threat foresight), P3 (negative attack floor), P4 (balance, measurement-first) are
separate specs. P1 is deliberately first because every later playtest is easier once the
scroll-round-trip is gone.

## Problems (from two playtests)

1. **The map and the action buttons are not on one screen (A1).** The play view stacks
   header → map → HUD → risk panel → stance → legend → preview → advance → log vertically.
   At a 900px-wide map the SVG alone is ~630px tall, so choosing a target (map, near the
   top) scrolls the `정복 진행` / `내실 다지기` button (bottom) out of view. Every turn is a
   scroll round-trip.
2. **No progress toward the win condition (A2).** The goal is "conquer 15% of the map
   beyond your start", but nothing counts it down. In a controller playtest the realm sat
   at 14–17 provinces for 20+ turns with no on-screen sign of whether that was winning or
   losing.
3. **A conquer turn with zero targets looks broken (A5).** When no province is attackable
   the map shows no ✓ and no hatching — an empty frame with one button. In a controller
   playtest this happened for 8 turns straight, twice in one game. The player cannot tell
   "nothing to do" from "the game is stuck".

## Non-goals

- The picker's lack of per-nation info is real but out of scope: it is a pre-game screen,
  a different concern, and P1 is about the in-game board. A later pass may add it.
- No engine change, no balance change. Golden hashes (init `226648593`, 50-tick
  `2503300448`, player path `2374466985`, Version A `1350115163`) stay untouched.
- P2's threat foresight, grouped log, and defection-tooltip wording are NOT here.

## Design

### A1 — map and controls on one screen

The province view has few panels, so a full two-column shell (as the cell game uses) is
more than this needs. Instead:

- **Cap the map's height to the viewport.** The `.prov-map` svg already carries
  `viewBox="0 0 1000 700"` and `preserveAspectRatio: xMidYMid meet`, so constraining its
  rendered size does not distort it — `meet` letterboxes within the box. Give `.prov-map`
  a `max-height` of roughly `58vh` (tuned in the live pass) so the map, the stance toggle,
  and the advance button are simultaneously visible at 1280×720 and 1440×900.
- **Pin the command controls to the bottom.** Wrap the stance toggle + advance button in a
  `position: sticky; bottom: 0` bar so the primary action is always reachable without
  scrolling, however tall the panels above grow. The battle-preview / risk / log panels
  scroll between the map and the sticky bar.

**⚠ Interaction with the verdict badge (must be handled, or the badge silently breaks).**
`preserveAspectRatio: meet` means a `max-height` cap makes the *rendered* map narrower
than its box: the box stays full width but the drawing letterboxes to
`boxHeight × 1000/700`. The badge counter-scale reads `mapWidthPx()` (currently
`getBoundingClientRect().width`, the BOX width) to keep the badge a constant on-screen
size. Once height is the binding constraint, box width overstates the real drawing width,
so the badge would be scaled too small. `mapWidthPx()` must return the **actually rendered**
width:

```
renderedWidth = min(boxWidth, boxHeight × (1000 / 700))
```

This stays 0 under jsdom (both rects are 0), so the existing `badgeScale` fallback to 1 is
unaffected. The live pass must re-measure badge coverage after the cap to confirm it still
sits inside its province.

### A2 — win-progress counter

Expose exactly the value the win check counts, so the counter can never disagree with the
outcome. Domination is `provinces - start >= round(0.15 * land)` (`isDomination` in
`provinceApp.ts`). So:

- `gained = playerProvinceCount - startProvinces`
- `goal = round(0.15 * totalLandProvinces)`
- Show `정복 {gained} / {goal}` (EN `conquered {gained} / {goal}`) in the HUD, plus a thin
  progress bar filled `clamp(gained/goal, 0, 1)`.
- **`gained` is shown even when negative** (`정복 −4 / 15`): the realm shrinking below its
  start is exactly the losing state the player must see, and clamping it to 0 would hide
  that. The bar's fill clamps at 0 (an empty bar), but the number does not.

The survival route already has `턴 {tick}/50` in the HUD; leave it. `startProvinces` and
`totalLandProvinces(u)` already exist on the UI state.

Add a pure exported helper so the arithmetic is testable and provably tied to the win
check:

```
export function dominationProgress(prov: number, start: number, land: number):
  { gained: number; goal: number }
```

and assert in tests that `gained >= goal` iff `isDomination(prov, start, land)` — the
counter and the victory condition are the same fact.

### A5 — empty-conquer-state notice

In conquer mode, when `armableTargets` yields no province the map draws nothing. Render a
notice in the target-preview area: "지금은 칠 땅이 없어요 — 내실로 힘을 키우면 뚫립니다"
/ "No province is takeable right now — consolidate to build up strength". This claim is
verified true, not a guess: in a controller playtest, from a zero-target state, four
consolidate turns turned two provinces from "too strong" to takeable.

Only shown in conquer mode with zero armable targets; consolidate mode already has its own
hint.

## Files

- `src/ui/provinceApp.ts`
- `src/theme.css`

## Tests

1. `dominationProgress` is pure: `{gained: prov-start, goal: round(0.15*land)}`, and
   `gained >= goal` exactly when `isDomination(prov, start, land)` is true (same fact,
   including a negative-gained case).
2. The HUD renders the counter and the bar once a game starts, and the counter text
   matches `dominationProgress` for that state (including a state where `gained` is
   negative).
3. In conquer mode with zero armable targets, the empty-state notice renders; with targets
   present it does not; in consolidate mode it never does.
4. `mapWidthPx` returns `min(boxWidth, boxHeight*1000/700)` — assert via a stubbed
   `getBoundingClientRect` that a height-bound box yields the letterboxed width, not the
   box width. (Keep the jsdom→0→scale-1 fallback intact.)
5. Regression: the verdict badge tests from the prior feature still pass (the `mapWidthPx`
   change must not move desktop badge scale, where width is the binding dimension).

## Verification (live browser)

The brief's A1 acceptance is explicitly layout: at **1280×720 and 1440×900**, after
picking a nation, the map's chosen target and the advance button are visible **at the same
time** without scrolling. That is the pass/fail — confirm it in a real browser (screenshots
are harness-blocked, so measure element rects and viewport occupancy via JS, and the final
look is the user's call).

Also re-measure badge coverage after the height cap (a badge must still sit inside its
province) and confirm the progress counter matches the HUD's province count as a game
advances.
