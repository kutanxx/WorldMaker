# Map Zoom / Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add interactive wheel-zoom + drag-pan + on-screen +/−/reset controls to both the world map and the city drilldown, by manipulating each `<svg>`'s viewBox (vector-crisp, no new dependency, simple visual zoom).

**Architecture:** A reusable `src/ui/zoomPan.ts` — `attachZoomPan(svg, container)` — reads the svg's base viewBox, updates it on wheel/drag/buttons (scale clamped [1,8], pan clamped to the base extent), swallows the click that follows a drag so the world map's marker-drilldown still works on a genuine click, and returns `{ reset, destroy }`. `app.ts` attaches it to the world svg in `showWorld` and the city svg in `openCity`, destroying the previous one on navigation (mirroring the existing `timeline` handling).

**Tech Stack:** TypeScript, Vitest (jsdom), SVG viewBox, Pointer/Wheel events. No new deps.

**Spec:** `docs/superpowers/specs/2026-07-05-map-zoom-pan-design.md`

## Global Constraints

- No new dependencies. Read/write the viewBox as the ATTRIBUTE STRING (`getAttribute`/`setAttribute("viewBox", ...)`), NOT `svg.viewBox.baseVal` (jsdom doesn't implement it).
- Scale clamp [1, 8]; pan clamp keeps the viewBox inside the base extent (at scale 1, no pan). Drag threshold `DRAG_PX = 4`.
- Zoom is view-only: exports (`exportWorldSvg`, city export) re-render fresh full-extent SVGs and MUST be unaffected. The timeline scrubber updates `.political-slot` children only — the viewBox lives on the svg root, so zoom persists across year scrubbing.
- Preserve the world-map marker drilldown: a genuine click (no drag) still triggers it; a drag does not.
- `attachZoomPan` must `destroy()` cleanly (remove all listeners + the controls element) so navigation doesn't leak.
- Tests: Vitest jsdom. `npx vitest run src/ui/zoomPan.test.ts`, full `npm test`, build `npm run build`. Commit style: Korean feat prefix + footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `zoomPan.ts` — the attach helper

**Files:**
- Create: `src/ui/zoomPan.ts`
- Test: `src/ui/zoomPan.test.ts`

**Interfaces:**
- Produces: `interface ZoomPan { reset(): void; destroy(): void }` and `attachZoomPan(svg: SVGSVGElement, container: HTMLElement): ZoomPan`.

- [ ] **Step 1: Write the failing test** — `src/ui/zoomPan.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { attachZoomPan } from "./zoomPan";

const SVGNS = "http://www.w3.org/2000/svg";
function makeSvg(): { svg: SVGSVGElement; container: HTMLElement } {
  const container = document.createElement("div");
  const svg = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  // jsdom returns a 0-size rect; stub a known box so client→user math works
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
  container.appendChild(svg);
  document.body.appendChild(container);
  return { svg, container };
}
const vb = (svg: SVGSVGElement) => (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);

describe("attachZoomPan", () => {
  let svg: SVGSVGElement, container: HTMLElement;
  beforeEach(() => { document.body.innerHTML = ""; ({ svg, container } = makeSvg()); });

  it("wheel-up zooms in (viewBox shrinks) toward the cursor, clamped at 8x", () => {
    const zp = attachZoomPan(svg, container);
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true }));
    let [, , w] = vb(svg);
    expect(w).toBeLessThan(100);
    for (let i = 0; i < 60; i++) svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true }));
    [, , w] = vb(svg);
    expect(w).toBeGreaterThanOrEqual(100 / 8 - 1e-6); // scale capped at 8 → w ≥ 12.5
    zp.destroy();
  });

  it("wheel-down never zooms out past the base (scale floor 1)", () => {
    const zp = attachZoomPan(svg, container);
    for (let i = 0; i < 10; i++) svg.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: 50, clientY: 50, cancelable: true }));
    expect(vb(svg)).toEqual([0, 0, 100, 100]);
    zp.destroy();
  });

  it("drag pans when zoomed, clamped inside the base extent", () => {
    const zp = attachZoomPan(svg, container);
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true })); // zoom in first
    const before = vb(svg);
    svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 }));
    svg.dispatchEvent(new PointerEvent("pointermove", { clientX: 30, clientY: 50, pointerId: 1 }));
    svg.dispatchEvent(new PointerEvent("pointerup", { clientX: 30, clientY: 50, pointerId: 1 }));
    const after = vb(svg);
    expect(after[0]).not.toBe(before[0]); // x panned
    expect(after[0]).toBeGreaterThanOrEqual(0);            // clamped ≥ base.x
    expect(after[0] + after[2]).toBeLessThanOrEqual(100 + 1e-6); // clamped within base
    zp.destroy();
  });

  it("reset restores the base viewBox", () => {
    const zp = attachZoomPan(svg, container);
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 20, clientY: 20, cancelable: true }));
    zp.reset();
    expect(vb(svg)).toEqual([0, 0, 100, 100]);
    zp.destroy();
  });

  it("swallows the click after a drag but lets a genuine click through", () => {
    const zp = attachZoomPan(svg, container);
    const marker = document.createElementNS(SVGNS, "rect");
    marker.setAttribute("data-city", "1");
    svg.appendChild(marker);
    let clicks = 0;
    svg.addEventListener("click", () => { clicks++; }); // app's drilldown handler (bubble)

    // drag then click on the marker → swallowed
    svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 }));
    svg.dispatchEvent(new PointerEvent("pointermove", { clientX: 70, clientY: 50, pointerId: 1 }));
    svg.dispatchEvent(new PointerEvent("pointerup", { clientX: 70, clientY: 50, pointerId: 1 }));
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(0);

    // no-drag click on the marker → passes through
    svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 2 }));
    svg.dispatchEvent(new PointerEvent("pointerup", { clientX: 50, clientY: 50, pointerId: 2 }));
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1);
    zp.destroy();
  });

  it("mounts controls and destroy() removes them + stops responding", () => {
    const zp = attachZoomPan(svg, container);
    expect(container.querySelector(".map-zoom-controls")).not.toBeNull();
    zp.destroy();
    expect(container.querySelector(".map-zoom-controls")).toBeNull();
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true }));
    expect(vb(svg)).toEqual([0, 0, 100, 100]); // no longer responds
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/zoomPan.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/ui/zoomPan.ts`:

```ts
// viewBox-based zoom/pan for an SVG map (world or city). Simple visual zoom — markers/labels
// scale with the map. No dependencies. Read/write the viewBox as an attribute string (jsdom
// does not implement svg.viewBox.baseVal).
export interface ZoomPan { reset(): void; destroy(): void; }

const MIN_SCALE = 1, MAX_SCALE = 8, DRAG_PX = 4;

export function attachZoomPan(svg: SVGSVGElement, container: HTMLElement): ZoomPan {
  const parse = (s: string | null) => { const a = (s || "0 0 100 100").split(/[\s,]+/).map(Number); return { x: a[0], y: a[1], w: a[2], h: a[3] }; };
  const base = parse(svg.getAttribute("viewBox"));
  let cur = { ...base };
  const apply = () => svg.setAttribute("viewBox", `${cur.x} ${cur.y} ${cur.w} ${cur.h}`);
  const rectOf = () => { const r = svg.getBoundingClientRect(); return r && r.width ? r : ({ left: 0, top: 0, width: base.w, height: base.h } as DOMRect); };

  const clampPan = () => {
    cur.x = Math.max(base.x, Math.min(base.x + base.w - cur.w, cur.x));
    cur.y = Math.max(base.y, Math.min(base.y + base.h - cur.h, cur.y));
  };
  // scale = base.w / cur.w target; keep the user-space point (ux,uy) fixed on screen
  const setScale = (scale: number, ux: number, uy: number) => {
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const nw = base.w / scale, nh = base.h / scale;
    const rx = (ux - cur.x) / cur.w, ry = (uy - cur.y) / cur.h;
    cur = { x: ux - rx * nw, y: uy - ry * nh, w: nw, h: nh };
    clampPan(); apply();
  };
  const userAt = (clientX: number, clientY: number) => {
    const r = rectOf();
    return { ux: cur.x + ((clientX - r.left) / r.width) * cur.w, uy: cur.y + ((clientY - r.top) / r.height) * cur.h };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { ux, uy } = userAt(e.clientX, e.clientY);
    setScale((base.w / cur.w) * Math.pow(1.0015, -e.deltaY), ux, uy);
  };

  let dragging = false, moved = 0, lastX = 0, lastY = 0, wasDrag = false;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true; moved = 0; wasDrag = false; lastX = e.clientX; lastY = e.clientY;
    svg.setPointerCapture?.(e.pointerId); svg.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const r = rectOf();
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > DRAG_PX) wasDrag = true;
    cur.x -= (dx * cur.w) / r.width; cur.y -= (dy * cur.h) / r.height; clampPan(); apply();
  };
  const onUp = (e: PointerEvent) => { if (!dragging) return; dragging = false; svg.releasePointerCapture?.(e.pointerId); svg.style.cursor = "grab"; };
  // capture-phase: swallow the click that a drag would otherwise turn into a drilldown
  const onClickCapture = (e: MouseEvent) => { if (wasDrag) { e.stopPropagation(); e.preventDefault(); wasDrag = false; } };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("click", onClickCapture, true);
  svg.style.cursor = "grab";
  svg.style.touchAction = "none";

  const ctrls = document.createElement("div");
  ctrls.className = "map-zoom-controls";
  const mkBtn = (label: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", fn); return b; };
  const zoomCentre = (factor: number) => setScale((base.w / cur.w) * factor, cur.x + cur.w / 2, cur.y + cur.h / 2);
  const reset = () => { cur = { ...base }; apply(); };
  ctrls.append(mkBtn("+", () => zoomCentre(1.4)), mkBtn("−", () => zoomCentre(1 / 1.4)), mkBtn("⤡", reset));
  container.appendChild(ctrls);

  return {
    reset,
    destroy() {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      svg.removeEventListener("click", onClickCapture, true);
      ctrls.remove();
    },
  };
}
```

- [ ] **Step 4: Run** — `npx vitest run src/ui/zoomPan.test.ts` all PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: zoomPan — viewBox 기반 SVG 지도 줌/팬 헬퍼 (휠·드래그·버튼)"`

---

### Task 2: Wire into `app.ts` + styles

**Files:**
- Modify: `src/ui/app.ts` (import, `worldZoom`/`cityZoom` state, `showWorld`/`openCity` wiring)
- Modify: `src/ui/theme.css` (`.stage` position + `.map-zoom-controls`)
- Test: `src/ui/app.test.ts`

**Interfaces:**
- Consumes: `attachZoomPan(svg, container): ZoomPan` from Task 1.

- [ ] **Step 1: Failing test** — in `src/ui/app.test.ts` add:

```ts
it("mounts zoom controls on the world map and again on a city drilldown", () => {
  const root = document.createElement("div");
  createApp(root, { seed: 1, width: 1000, height: 700, cellCount: 4000, seaLevel: 0.3, mountainLevel: 0.55, polityCount: 8, townCount: 20 });
  const stage = root.querySelector(".stage")!;
  expect(stage.querySelector(".map-zoom-controls")).not.toBeNull(); // world map
  const marker = stage.querySelector("[data-city]") as SVGElement;
  marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(stage.querySelector("svg.city")).not.toBeNull();          // drilled down
  expect(stage.querySelector(".map-zoom-controls")).not.toBeNull(); // city map controls
});
```
(Match the existing app.test.ts import of `createApp` and its param shape; reuse a helper if one exists.)

- [ ] **Step 2: Run** — `npx vitest run src/ui/app.test.ts -t "zoom controls"` → FAIL.

- [ ] **Step 3: Implement**

`app.ts` — import: `import { attachZoomPan, type ZoomPan } from "./zoomPan";`

Add module-scope state next to `let timeline`:
```ts
  let worldZoom: ZoomPan | null = null;
  let cityZoom: ZoomPan | null = null;
```

In `showWorld`, after `stage.appendChild(svg);` and its click listener (and before/after the timeline mount is fine, but attach to `svg`):
```ts
    cityZoom?.destroy(); cityZoom = null;
    worldZoom?.destroy();
    worldZoom = attachZoomPan(svg, stage);
```

In `openCity`, capture the city svg and attach:
```ts
    const citySvg = renderCity(layout, lang);
    stage.append(back, citySvg);
    worldZoom?.destroy(); worldZoom = null;
    cityZoom?.destroy();
    cityZoom = attachZoomPan(citySvg, stage);
```
(Replace the existing `stage.append(back, renderCity(layout, lang));` line.)

Also destroy both at the top of `regenerate` (before `showWorld()` re-attaches): add `worldZoom?.destroy(); worldZoom = null; cityZoom?.destroy(); cityZoom = null;` — OR rely on the destroy-before-attach in showWorld/openCity (which already covers it). Ensure no double-attach: the destroy-before-attach lines above are sufficient.

`theme.css` — append:
```css
.stage { position: relative; }
.map-zoom-controls {
  position: absolute; right: 14px; bottom: 14px;
  display: flex; flex-direction: column; gap: 4px; z-index: 5;
}
.map-zoom-controls button {
  width: 30px; height: 30px; padding: 0; font-size: 18px; line-height: 1;
  background: #f3ead2; border: 1px solid #b7a071; border-radius: 4px; color: #3c2f1c; cursor: pointer;
}
.map-zoom-controls button:hover { background: #e7d9b6; }
```

- [ ] **Step 4: Run** — `npx vitest run src/ui/app.test.ts` PASS (new + existing drilldown test); full `npm test` green; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 세계·도시 지도에 줌/팬 연결 + 컨트롤 스타일"`

---

### Task 3: Integration verify + deploy

**Files:** none new (fixes only if verification finds issues)

- [ ] **Step 1: Full suite + build** — `npm test` green; `npm run build` clean.
- [ ] **Step 2: Live verify** — dev server (`worldmaker`), `preview_resize({width:1280,height:800})`. On `map.html`: (a) `.map-zoom-controls` present over the world map; (b) via `preview_eval`, dispatch a `wheel` (deltaY:-200) at a point over the svg and assert the world svg's `viewBox` width shrank; dispatch `+`/`−`/`⤢` button clicks and assert viewBox changes then resets; (c) simulate a drag (pointerdown→move→up) after zooming and assert the viewBox x/y translated and clamped; (d) a genuine marker click still drills into a city; (e) the city svg also has controls and zooms; (f) the timeline scrubber still works while zoomed (viewBox unchanged by scrubbing). Report the observed viewBox values.
- [ ] **Step 3: Regression checks** — confirm PNG/SVG export still produces a full-extent map (not the zoomed view): trigger `exportSvg` via `preview_eval` and check the exported svg viewBox equals the base (`0 0 1000 700`), independent of on-screen zoom.
- [ ] **Step 4: Merge + deploy** — merge branch to `main` (`git -C /c/projects/WorldMaker merge --no-ff …`), push (Pages auto-deploys; on a deploy-pages "try again later" failure, wait ~5 min and push an empty commit — known Pages throttle). Verify the live bundle serves.
- [ ] **Step 5: Ask the user to eyeball** the deployed site — wheel/drag/buttons on both maps, zoom feel (max 8x), and that drilldown still works.

---

## Self-Review Notes

- Spec coverage: §1 module→Task 1 (all behaviors: wheel toward cursor, scale [1,8], drag+clamp, buttons, reset, destroy, drag-click swallow, viewBox-as-attribute); §2 wiring→Task 2; §3 styles→Task 2; §4 preserved (exports/timeline/back)→verified in Task 2 (existing tests stay green) + Task 3 steps 2f/3; §5 tests→Task 1 (zoomPan) + Task 2 (app).
- Placeholder scan: none — all code + tests are complete.
- Type consistency: `ZoomPan`/`attachZoomPan(svg, container)` identical in Tasks 1-2; `worldZoom`/`cityZoom: ZoomPan | null` mirror the existing `timeline` pattern.
- Risk: the capture-phase click-swallow relies on the drilldown click's target being a DESCENDANT of the svg (the marker), so capture-on-svg fires before the app's bubble-on-svg handler — verified by the Task 1 test dispatching on a child `<rect data-city>`. Real markers are descendants, so this holds.
- Determinism/engine untouched: pure UI; no `src/engine/**`, world.ts, or history.ts changes.
