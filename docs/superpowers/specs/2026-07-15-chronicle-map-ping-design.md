# Chronicle → Map Ping (play mode) — Design

**Date:** 2026-07-15 · **Scope:** UI only — `src/ui/playApp.ts` (log rows carry their cell + a click pings the map), `src/theme.css` (ping keyframes), `src/ui/i18n.ts` (one affordance string, KO/EN), tests. **No engine change, no rng, no new state on `SimState`.** **Origin:** backlog NEXT #4 / 🅱 shortlist — connect the two surfaces that already exist (the reign's chronicle log ↔ the map) so history reads spatially. Pairs with the shipped reign-replay atlas: on game over the log persists and the map is a clean atlas, so pinging locates past events on it.

## Problem

The play-mode side-rail chronicle logs events as plain text (`appendLog(text, headline)` at playApp.ts:771). Each source `HistoryEvent` carries a `cell` (conquest→fallen capital, civil war→origin capital, independence→seceding city, golden age→capital), but the log row discards it. A player reading "1200년, X가 Y를 정복" has no way to see *where* on the map it happened.

## Mechanics

### 1. Log rows carry their cell

`appendLog(text, headline = false, cell?)` gains an optional `cell`. The advance loop (playApp.ts:747–749) passes `e.cell` for each event. Rows whose event has a numeric cell become **pingable**; positionless rows (the border delta `+g/−l` line at :744, dilemma-outcome rows at :809, the rule intro at :917) pass no cell and stay inert.

**⚠ This one call site (line 749) is INSIDE the verbatim advance handler** (BEGIN 728 / END 766). The event→row mapping exists only in this loop, so the cell can't be captured elsewhere without a larger refactor (pulling the loop out is a bigger change than adding one argument). Per the standing gotcha, the handler has one sanctioned amendment (momentum capture, 07-12c) and any further change needs the same explicit ceremony. This is the **second sanctioned amendment**: append `e.cell` as the third argument at :749, and extend the marker comment at :728 to name it. The change captures UI-only positional info from the advance (same spirit as momentum) and touches no control flow, no sim state, no rng. The delta/`— msg` rows (:744, :746) stay two-argument (no cell).

A pingable row gets:
- `data-cell="<n>"`
- class `pingable` (CSS: `cursor: pointer`, subtle hover)
- a localized `title` (affordance; on coarse/touch the existing `installTipStrip` delegate surfaces it as a tap hint — no extra wiring)
- a `click` listener → `pingMap(cell)`

### 2. `pingMap(cell)` — ephemeral, stateless

```
const svg = mapFrame.querySelector("svg");
if (!svg) return;
const x = world.grid.points[cell * 2], y = world.grid.points[cell * 2 + 1];
// append a <g class="map-ping"> with two staggered <circle>s at (x,y)
// remove on animationend (fallback setTimeout) — no SimState, no re-render
```

Because zoom is **viewBox-based** (mapZoom manipulates the svg viewBox, not a transform group — see 07-13b), an element appended at grid-point coordinates lines up correctly at any zoom/CSS scale, exactly as the existing `.sea-target` markers do. The ping is transient: if a real `renderMap()` runs (next advance, language toggle, replay scrub) it rebuilds the svg and the ping is gone — acceptable and desired. Appended as the svg's last child so it draws on top of the political layer and overlays.

### 3. Visual (`theme.css`)

`@keyframes wm-ping` — a ring that expands (r small→large) while fading opacity 0.9→0. Two circles with a stagger so it reads as a sonar ping. `.map-ping` fill none, stroke a bright amber/white that reads on any nation fill and on parchment; `pointer-events: none`. Final colour/size/duration tuned live in the browser.

## Determinism / constraints

- Pure UI. Golden FNV hash tests untouched (no engine/rng touch). Pure history path (Version A) never calls this.
- Works identically live and on the game-over atlas (both render the map into `mapFrame`; the atlas has no `.front` overlays but the ping appends to the svg regardless).
- The "verbatim advance handler" IS touched — one argument (`e.cell`) added to the appendLog call at :749, the **second sanctioned amendment**. The BEGIN marker comment (:728) is extended to name it. No control-flow, sim-state, or rng change. `appendLog`'s definition (:771) and the `pingMap` helper live outside the verbatim region.

## Testing (`playApp.test.ts`)

- An event row with a cell renders `data-cell` + `.pingable`; a positionless row (delta/intro) does not.
- Clicking a pingable row appends a `.map-ping` element into the map svg (jsdom: animation is a no-op, but the DOM insertion + coordinates are assertable via the element's `cx`/`cy` matching `grid.points`).
- A non-pingable row has no click effect (no `.map-ping` appears).
- (Guard) the ping does not mutate `SimState` — owner/solidarity unchanged after a click.

## Rejected alternatives

- **State + re-render (store `pingCell`, renderMap draws it, timeout clears):** fights the map's save→destroy→re-attach + zoom restore for no benefit; the ephemeral direct-append is simpler and zoom-safe.
- **Recenter/pan the map to an off-screen ping:** YAGNI for v1 — play happens mostly at the default full-map zoom where every cell is visible. Deferred; would need a `mapZoom.centerOn(cell)` API.
- **Version A (map.html) chronicle too:** separate render path (`chronicle.ts` `<li>` rows + the history map in `app.ts`); out of this scope. The play chronicle is where engagement lives.
- **A persistent marker until dismissed:** a sonar flash matches "locate it" intent without adding a clear-marker affordance or lingering clutter.
