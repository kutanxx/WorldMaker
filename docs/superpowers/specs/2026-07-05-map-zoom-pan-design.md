# Map Zoom / Pan — Design

2026-07-05. User: "지도 확대 같은건 안돼? 세계지도와 도시 지도 둘 다." Add interactive zoom + pan
to both the world map and the city drilldown. Chosen: wheel + drag + on-screen buttons; simple
visual zoom (vector scale, no zoom-level-dependent detail/culling).

Both maps are `<svg>` elements appended to the `.stage` container in `app.ts` (`showWorld`
mounts the world svg + timeline + chronicle; `openCity` mounts a back button + the city svg).
Zoom/pan is done by manipulating the svg `viewBox` — vector-crisp, no new dependency, works for
both. Markers/labels scale with the map (simple visual zoom, as chosen).

## §1. New module `src/ui/zoomPan.ts`

```ts
export interface ZoomPan { reset(): void; destroy(): void; }
export function attachZoomPan(svg: SVGSVGElement, container: HTMLElement): ZoomPan;
```

- On attach, read the svg's initial `viewBox` by PARSING THE ATTRIBUTE STRING
  (`svg.getAttribute("viewBox")` → `[x,y,w,h]`; do NOT use `svg.viewBox.baseVal`, which jsdom
  does not implement) as the BASE (full extent). All updates write back via
  `svg.setAttribute("viewBox", \`${x} ${y} ${w} ${h}\`)`. Current scale = `base.w / cur.w`.
- **Wheel:** zoom toward the cursor. Convert the cursor client position to svg-user coords
  using `svg.getBoundingClientRect()` (fallback: treat rect as the base viewBox if width 0, for
  jsdom); scale factor 1.0015^(-deltaY) clamped so the resulting scale stays in **[1, 8]**; keep
  the cursor's user-point fixed while shrinking/growing w/h. `preventDefault()` on the wheel
  event (so the page doesn't scroll while zooming the map).
- **Drag (pan):** `pointerdown` on the svg starts a drag (setPointerCapture); `pointermove`
  translates the viewBox by the pointer delta converted to user units (`dx * cur.w / rect.width`);
  `pointerup`/`pointercancel` ends it. Track cumulative movement; if it exceeds `DRAG_PX = 4`,
  mark the sequence as a drag.
- **Pan clamp:** keep the viewBox inside the base extent — `x ∈ [base.x, base.x + base.w -
  cur.w]`, `y` similarly (so the map can't be dragged fully off-screen; at scale 1, x/y pin to
  base).
- **Buttons:** create a `<div class="map-zoom-controls">` appended to `container`, with
  `+` / `−` / `⤢` (reset) buttons. `+`/`−` zoom by a fixed step about the viewBox centre
  (clamped to [1,8]); `⤢` calls `reset()`.
- **Drilldown-click preservation:** the world svg has a `click` listener that drills into a
  city marker. To stop a drag from triggering a drilldown, `attachZoomPan` installs a
  CAPTURE-phase `click` listener on the svg that calls `stopPropagation()`/`preventDefault()`
  when the just-finished pointer sequence was a drag (movement > DRAG_PX). A genuine click
  (no drag) passes through untouched. This keeps `app.ts`'s existing click handler unchanged.
- **reset():** restore the base viewBox (scale 1). **destroy():** remove all listeners
  (wheel/pointer/click-capture) and the controls element — called on navigation to avoid leaks.
- Cursor: set `svg.style.cursor = "grab"`, `"grabbing"` during a drag.

## §2. Wiring in `app.ts`

- Add module-scope `let worldZoom: ZoomPan | null` and `let cityZoom: ZoomPan | null` (mirroring
  the existing `timeline` handling).
- `showWorld`: after `stage.appendChild(svg)` and its click listener, `worldZoom?.destroy();
  worldZoom = attachZoomPan(svg, stage);`. Destroy `cityZoom` if leaving a city.
- `openCity`: after `stage.append(back, citySvg)`, `cityZoom?.destroy(); cityZoom =
  attachZoomPan(citySvg, stage);`. (Capture the city svg from `renderCity(...)` into a variable
  so it can be passed to `attachZoomPan`.)
- On `regenerate` / re-entering `showWorld` / `openCity`, the OLD zoom is destroyed first, and a
  FRESH svg (new base viewBox) means zoom resets automatically per navigation.
- The timeline scrubber replaces `.political-slot` children only; the viewBox lives on the svg
  root, so **zoom persists across year scrubbing** and view toggles that keep the same svg.
  `deconflictLabels(svg)` reads `getBBox` (layout coords) — unaffected by viewBox zoom.

## §3. Styles (index.html `<style>` / theme.css)

- `.stage { position: relative; }` (anchor for the absolutely-positioned controls).
- `.map-zoom-controls { position: absolute; right: 14px; bottom: 14px; display: flex;
  flex-direction: column; gap: 4px; }` + parchment button styling matching existing buttons
  (small square, `background:#f3ead2`, border `#b7a071`). `pointer-events` on the controls only
  (they sit over the map).
- `.stage svg { cursor: grab; }` handled inline by the helper (set on attach).

## §4. Preserved / unaffected

- PNG/SVG/JSON/gazetteer exports re-render fresh full-extent SVGs (`exportWorldSvg`,
  `renderCity` for export) — zoom is view-only, never in exports.
- Back button, view toggle, random seed, timeline play — unchanged.
- Culture view (static, mounted by renderWorld) still zooms (viewBox on the same svg).

## §5. Tests

- `src/ui/zoomPan.test.ts` (jsdom): build an `SVGSVGElement` with `viewBox="0 0 100 100"`,
  stub `getBoundingClientRect` to a known box; assert: (a) a wheel-up event shrinks the viewBox
  w/h and raises scale, clamped ≤ 8; (b) wheel-down never zooms out past scale 1 (viewBox never
  exceeds base); (c) a pointerdown→move→up drag translates the viewBox and clamps within base;
  (d) `reset()` restores `0 0 100 100`; (e) after a >4px drag, a following `click` is stopped
  (spy a document-level click listener), while a no-move click is NOT stopped; (f) `destroy()`
  removes the controls element and further wheel events don't change the viewBox.
- `src/ui/app.test.ts`: after `createApp` renders the world, a `.map-zoom-controls` exists in
  the stage; clicking a marker still drills down (existing test stays green); opening a city
  mounts controls too.

## Out of scope (backlog, disclosed)

Pinch-to-zoom (multi-touch); zoom-level-dependent detail (marker/label density, culling at zoom);
double-click-to-zoom; persisting zoom across navigation; minimap. Simple visual viewBox zoom
only, per the chosen scope.
