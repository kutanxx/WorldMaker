# Play-Map Zoom (button-first, touch-safe) — Design

**Date:** 2026-07-13 · **Scope:** `src/ui/zoomPan.ts` (small API extension, Version A keeps working) + play-mode map integration. **Origin:** real-phone feel-pass — "지도가 작아서 괜찮을란가": at device width the 900-wide world renders ~375px; regions are tappable (multi-cell clusters) but hard to READ. This was the pre-agreed trigger for the deferred zoom work.

**Approach (user-confirmed A):** reuse `attachZoomPan` — it already has +/−/⤡ controls, wheel zoom, drag-pan, and drag-vs-click discrimination proven against clickable children in Version A. Two additions: a save/restore API (the play map is rebuilt EVERY render — turn, pending-action click, replay scrub — and zoom must survive), and a scale-aware `touch-action` policy so the map stops eating page scroll on phones.

**Rejected (for now):** full pinch entry at scale 1 (browser gesture-claim fights under `touch-action: pan-y`; revisit after this ships if the feel-pass asks), double-tap zoom (collides with `touch-action: manipulation` semantics and fast repeated taps on targets).

## 1. `zoomPan.ts` extension (backward-compatible)

```ts
export interface ZoomPan { reset(): void; destroy(): void; viewBox(): string; }
export function attachZoomPan(svg: SVGSVGElement, container: HTMLElement, opts?: { restore?: string | null }): ZoomPan
```

- **`viewBox()`** returns the CURRENT `"x y w h"` string (what `apply()` last wrote — read from `cur`, not the DOM, so it's exact).
- **`opts.restore`**: after `base` is parsed from the svg's own viewBox attribute (unchanged), a valid 4-number `restore` string sets `cur` to it, then clamps: scale into `[MIN_SCALE, MAX_SCALE]` relative to `base` (i.e. `cur.w` into `[base.w / MAX_SCALE, base.w]`, same for h using the base aspect), then `clampPan()`, then `apply()`. Garbage / missing / degenerate (`w<=0`) restore strings are ignored (start at base). This means a stale restore from a DIFFERENT map simply clamps into range rather than exploding.
- **Scale-aware touch policy (replaces the unconditional `touchAction = "none"`):**
  - a `syncTouchAction()` helper: `svg.style.touchAction = cur.w < base.w - 1e-9 ? "none" : "pan-y";`
  - called at attach time and inside `apply()` (every zoom/pan/reset path funnels through `apply`).
  - Effect at base scale: one finger scrolls the page over the map (pan is a no-op there anyway — `clampPan` pins it), taps still select targets. Zoomed in: the map owns the surface — one-finger pan explores, and two-finger pinch is delivered as pointer events (free extra; no dedicated pinch code in this pass — if it happens to feel dead on some device, the buttons are the contract).
  - This applies to Version A too and is strictly better there (its map at base scale currently blocks page scroll on touch for zero benefit).
- Everything else (wheel, DRAG_PX click discrimination, capture-phase click swallow after drags, +/−/⤡ controls appended to `container`) is untouched.

## 2. Play integration (`playApp.ts` `renderMap`)

- `startGame`-scoped `let mapZoom: ZoomPan | null = null;`
- `renderMap()` start: `const savedView = mapZoom ? mapZoom.viewBox() : null; mapZoom?.destroy(); mapZoom = null;` BEFORE `mapFrame.innerHTML = ""` (destroy tears down any in-flight drag's window listeners).
- `renderMap()` end, after `mapFrame.appendChild(svg); deconflictLabels(svg);`:
  `mapZoom = attachZoomPan(svg, mapFrame, { restore: savedView });`
- Consequences that must hold (and be tested): zoom survives advancing a turn, picking a pending action (both re-render the map), language toggle, and replay scrubbing (you can zoom into your homeland while the timeline plays). Attack/city taps keep working at rest; a pan does NOT fire a selection (zoomPan's capture-phase swallow — already proven in Version A).
- The picker minimap does NOT get zoom (it's `pointer-events: none` context).
- Game-over: the replay map keeps the control cluster — intended (inspecting history zoomed is the point).

## 3. CSS

- `.map-frame { position: relative; }` (the controls are absolutely positioned by the existing `.map-zoom-controls` rules — verify against theme.css and add the anchor only if missing).
- Coarse pointers: the existing `#play button { min-height: 48px … }` already covers the zoom buttons' height; add `@media (pointer: coarse) { .map-zoom-controls button { min-width: 48px; } }` inside the existing coarse block so they're square-ish, not tall slivers.
- Desktop Version A: `.map-zoom-controls` visuals unchanged.

## 4. Testing

- `zoomPan.test.ts` (additive): `viewBox()` reflects the current box after a `+` click; `restore` round-trips (attach → zoom → read `viewBox()` → detach → attach with `restore` → same box); garbage restore ⇒ base; restore beyond `MAX_SCALE` clamps; `touchAction` is `"pan-y"` at base and `"none"` after zooming in, back to `"pan-y"` after `⤡` reset.
- `playApp.test.ts`: game screen shows `.map-zoom-controls` inside `.map-frame`; clicking `+` changes the world svg's `viewBox`; clicking `.btn-advance` (full re-render) preserves that zoomed viewBox; `⤡` restores the base box. jsdom note: `getBoundingClientRect` returns zeros — `rectOf()` already has the zero-width fallback, and button-driven `zoomCentre` doesn't need client coords at all.
- All existing zoomPan/Version A tests stay green (API additions optional; the only behavior change is `touchAction` at base scale, `"none"` → `"pan-y"` — if a test asserted the old value, updating it is sanctioned and the spec's reasoning applies).
- Determinism: UI-only; golden hashes and the verbatim advance handler untouched.

## 5. Acceptance

- Live (browser pane, fine pointer): controls render on the play map, wheel/buttons zoom, viewBox survives a turn.
- Real phone (post-push): at rest the page scrolls over the map and taps select; `+` then one-finger pan explores; ⤡ returns and scroll resumes. This joins the existing real-phone checklist.
