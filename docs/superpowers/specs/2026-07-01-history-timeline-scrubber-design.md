# History Timeline Scrubber (sub-project B) — Design

**Date:** 2026-07-01
**Status:** Approved
**Depends on:** History Engine + Chronicle (sub-project A, merged `a5d3852`)

## Goal

Add a **timeline slider + ▶/⏸ play** control below the world map that scrubs
through `history.snapshots` (year 0→500, 51 frames). As the year changes:

1. A **political overlay** on the biome map updates to show territory at that year.
2. The **chronicle** panel synchronises: events after the current year are dimmed,
   and the latest era at/under the current year scrolls into view.

This is a **pure UI/rendering sub-project**. The history engine (`src/engine/history.ts`)
is NOT touched — it already emits everything we need (`snapshots`, `polities` with
colours including fragments).

## Chosen approach

**A — political overlay on the existing biome map.** The biome base stays; a
`.political` layer (translucent polity-colour fills + borders) is rebuilt in place
for the displayed year. Rejected: (B) a modal biome↔political toggle (more surface,
modal), (C) borders-only scrub (territory change too subtle to read).

## Components

### 1. `src/ui/politicalLayer.ts` (new)

Pure geometry → SVG. No playback logic.

- `politicalLayer(grid, owner, polities): SVGGElement`
  - Returns `<g class="political">` containing:
    - one translucent filled `<path class="territory" data-polity="id">` per polity
      id present in `owner` (merged cell polygons via the existing `cellPath` style),
      `fill = polities[id].color`, `fill-opacity ≈ 0.33`.
    - one `<path class="border">` built from `politicalBorders(grid, owner)`.
  - `owner: ArrayLike<number>` so a snapshot `Int32Array` passes with no copy.
  - `polities`: `{ id: number; color: string }[]` — pass `history.polities`
    (includes fragment polities, which `world.polities` does not).
- Skips cells with `owner[i] < 0` (ocean / unclaimed).

`cellPath`/`segPath` are currently private to `svgWorldRenderer.ts`. Extract them to
a tiny shared module `src/ui/svgPaths.ts` (`cellPath`, `segPath`) so both the world
renderer and the political layer use one implementation.

### 2. `src/engine/borders.ts` (modified)

Widen `politicalBorders(grid, polityOf: number[])` → `polityOf: ArrayLike<number>`
so snapshot `Int32Array` is accepted without an `Array.from` copy. `coastline` is
unchanged. Existing behaviour identical for `number[]` callers.

### 3. `src/ui/svgWorldRenderer.ts` (modified)

- Insert an empty `<g class="political-slot">` between the biomes group and the
  markers group.
- Remove the static `.border` path (year-0 borders from `world.polityOf`). Borders
  now live inside the political layer (single source of truth).
- `renderWorld` mounts a **default year-0 political layer** into the slot using
  `world.polityOf` + `world.polities`, so the map (and PNG/SVG export, which call
  `renderWorld` directly) always shows the currently-displayed political state.

**Deliberate visual change:** the base map goes from "coastline + border lines over
biomes" to "coastline + translucent political tint + border lines over biomes." Fill
opacity is kept low (~0.33) so biomes still read; this is a common worldbuilder-map
look and makes the present political situation legible too. Export captures whatever
year is displayed.

### 4. `src/ui/timeline.ts` (new)

- `createTimeline(history, onIndex): { element: HTMLElement; setIndex(i): void; destroy(): void }`
  - Builds `.timeline` with: `<input type="range" min=0 max=snapshots.length-1 step=1>`,
    a ▶/⏸ `<button>`, and a `.timeline-year` readout (e.g. `120년`).
  - Slider `input` → `onIndex(index)` + readout update.
  - Play: a timer (`setInterval`, ~300 ms/step) advances the index, updates the
    slider position + readout, and calls `onIndex`. Stops at the last frame (button
    resets to ▶). Pressing ▶ from the last frame restarts at 0.
  - `setIndex(i)` — programmatic move (clamps, updates slider + readout, calls `onIndex`).
  - `destroy()` — clears any running timer (called on leaving the world view).
- Pure DOM; no SVG knowledge. Testable via dispatched `input` events + fake timers.

### 5. `src/ui/chronicle.ts` (modified)

- Tag each `.chronicle-event` row with `data-year`. Era-header rows
  (`.chronicle-era`) get NO `data-year` and are ignored by the helper.
- Add `applyChronicleYear(chronicleEl, year): void`:
  - `.chronicle-event` rows with `data-year > year` get class `.future` (dimmed);
    others clear it;
  - the last non-future event row is scrolled into view within the panel
    (`scrollIntoView({ block: "nearest" })`).
- `renderChronicle` signature unchanged.

### 6. `src/ui/app.ts` (modified)

- `showWorld()`:
  - render base SVG (now with the political slot); grab the `.political-slot` element
    and the mounted chronicle element.
  - define `renderYear(index)`: rebuild `politicalLayer(grid, snapshots[index].owner,
    history.polities)` and swap it into the slot; call `applyChronicleYear(chronicle,
    snapshots[index].year)`.
  - mount `createTimeline(history, renderYear)` between the map and the chronicle,
    default index 0; keep the handle in a module variable.
- `openCity` / `regenerate`: call the stored timeline handle's `destroy()` before
  tearing down the stage, so playback timers never leak.

### 7. CSS (`index.html` `<style>` block)

All app styling currently lives in the inline `<style>` in `index.html` (there is no
`.css` file; the chronicle classes are presently unstyled). Add there:
`.timeline` (flex row, gap, padding), `.timeline-year` (monospace-ish width so the
readout doesn't jitter), `.political .territory { pointer-events: none }` (clicks
should still reach city markers underneath), and `.chronicle-event.future { opacity: .4 }`.
Give the chronicle panel a bounded `max-height` + `overflow:auto` so `scrollIntoView`
has somewhere to scroll.

## Data flow

```
slider drag / play tick
        │
        ▼
timeline → onIndex(index)
        │
        ▼
app.renderYear(index)
   ├─ politicalLayer(grid, snapshots[index].owner, history.polities) → swap into .political-slot
   └─ applyChronicleYear(chronicle, snapshots[index].year)
```

## Non-goals (YAGNI)

- City markers stay at year-0 geometry. Lore cities founded in later years appear in
  the chronicle text only — no new map geometry, no marker animation.
- No engine changes; determinism/URLs/export payload all unaffected.
- No per-frame path caching (51 frames × ≤~20 merged paths is sub-frame; add caching
  only if profiling shows a need).

## Testing

- `politicalLayer.test.ts`: small grid + owner array → one `.territory` path per
  present polity with the right fill; a `.border` path present; a different owner
  yields different paths; `owner[i] < 0` cells excluded.
- `borders.test.ts`: add a case passing an `Int32Array` to `politicalBorders`
  (same result as the `number[]` equivalent); existing cases still pass.
- `timeline.test.ts`: `input` event fires `onIndex` with the slider index and updates
  the readout; with fake timers, play advances the index and pause/last-frame stops;
  `destroy()` clears the timer.
- `chronicle.test.ts`: `applyChronicleYear` adds `.future` to later events, clears it
  on earlier ones.
- `app.test.ts`: the world view contains a `.timeline` with a range input and a
  `.political-slot`; moving the slider updates the political layer contents.
- Full suite (currently 134) stays green; build clean.

## Performance

51 frames; each `renderYear` groups ~4000 cells into ≤~20 merged path strings plus
border segments — sub-frame cost, fine for 300 ms play steps and continuous drag.
