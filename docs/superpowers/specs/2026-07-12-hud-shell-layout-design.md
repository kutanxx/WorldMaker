# Viewport-fit HUD Shell — the play screen stops being a scrolling document

**Date:** 2026-07-12
**Status:** Approved design

## Why

User: "화면이 너무 중앙 위에 있고 위의 UI들을 쳐다보기 불편하다." Measured at 1440×900: the standing
panel sits flush at y=0 (zero top margin), the map at y=155-785, the advance button at y≈860, the
chronicle below the fold (doc 996 > viewport 900) — the eye ping-pongs between document extremes
every turn. Research: (1) HUD principle — eyes stay on the CENTER (the map); constantly-monitored
info lives at screen EDGES with frequently-read info on the LEFT, commands at the BOTTOM (the RTS
command-card convention); (2) web games use a no-scroll viewport-fit app shell (`100svh` — the
mobile-safe small-viewport unit).

## Layout

**Wide screens (≥ `SHELL_MIN = 1100px` via media query): a no-scroll 100svh grid.**

```
┌────────────┬──────────────────────────┐
│ .play-side │  .play-main              │
│  panel     │   stage (map, flex:1)    │
│  goals     │   ├ map-frame (letterbox)│
│  dilemma   │   └ legend row           │
│  [banner]  │   actions (command bar)  │
│  chronicle │                          │
│  (scrolls) │                          │
└────────────┴──────────────────────────┘
grid-template-columns: 340px 1fr; height: 100svh; padding+gap 10px
```

- **Sidebar left** (HUD research: frequent info on the left): standing panel, goals line, dilemma
  card, game-over banner (inserted before the chronicle), chronicle filling the remaining height
  with INTERNAL scroll (`flex: 1; min-height: 0; overflow: auto`). `.play-side` is a flex column.
- **Main right**: the stage grows (`flex: 1; min-height: 0`), the command bar sits directly under
  the map — always at the same place, always visible (bottom = commands, the RTS convention).
- **The map gets BIGGER, not smaller**: the 900px `max-width` cap is REMOVED in shell mode; the
  svg fills its box (`width/height: 100%`) and `preserveAspectRatio="xMidYMid meet"` letterboxes
  the 1000×700 viewBox — at 1440×900 the drawn map grows from 900px wide to roughly the full main
  column (~1050px). Clicks/labels are unaffected (getBBox and pointer math are user-space).
- No page scroll in shell mode: the grid is exactly `100svh`, and the page chrome is neutralized
  ONLY while the shell is mounted via `body:has(.play-shell) { margin: 0; padding: 0;
  overflow: hidden }` (`:has` is fine in all target browsers) — the nation picker and Version A
  keep their parchment page margins untouched.

**Narrow screens (< 1100px): the current vertical stack**, unchanged behavior — `.play-shell`
falls back to a block column (max-width 1100 centered, svg capped 900px, chronicle max-height
240px), i.e. today's layout preserved as the fallback.

## Implementation surface

- `src/ui/playApp.ts` (`startGame` mount block): the flat `col.append(panel, goals, stage,
  dilemmaBox, actions, log)` becomes
  `side.append(panel, goals, dilemmaBox, log)` + `main.append(stage, actions)` +
  `col.className = "play-shell"; col.append(side, main)`. `renderBanner`'s
  `col.insertBefore(banner, log)` becomes `side.insertBefore(banner, log)`. Nothing else in
  playApp changes — all render functions target the same element handles.
- `src/theme.css`: new `.play-shell/.play-side/.play-main` rules + media query; every existing
  `.play-col …` selector (map cap, play-scoped label sizes, panel/goals/actions/chronicle rules)
  is re-scoped to `.play-shell` so BOTH modes keep the tuned label sizes; the `svg.world`
  900px cap moves INSIDE the narrow-mode media query.
- No engine, no i18n, no test-visible behavior change beyond the re-parenting (tests query by
  class through `root`, which still finds everything).

## Non-goals

Zoom/pan for the play map; collapsible sidebar; mobile-first redesign (<1100px keeps the stack);
moving the how-to overlay (already `position: fixed`); Version A (map.html) layout.

## Testing

1. playApp DOM: `.play-shell > .play-side` contains the panel and chronicle; `.play-main`
   contains the stage and command bar; the game-over banner lands inside `.play-side` before the
   chronicle (play-to-end test).
2. All existing tests green unmodified (they select by class from `root`).
3. Live geometry check (the feature IS geometry): at 1440×900 — `document.body.scrollHeight ===
   innerHeight` (no page scroll), panel.top ≈ 10 (not 0), advance button fully inside the
   viewport, svg drawn width > 900; at 1000px width — fallback stack (side above main), svg ≤
   900. Layout LOOK still needs the user's eyes.

## Sources

- [Game UX Master Guide — HUD layout (edges, left-frequency, bottom commands)](https://gameuxmasterguide.com/2019-05-07-HUDLayout/)
- [Game Developer — Strategy game UI dos and don'ts](https://www.gamedeveloper.com/design/ui-strategy-game-design-dos-and-don-ts)
- [svh viewport units](https://dev.to/web_dev-usman/the-new-css-viewport-units-that-finally-fix-mobile-layouts-2cjd)
