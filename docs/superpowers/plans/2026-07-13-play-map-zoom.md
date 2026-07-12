# Play-Map Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The play map gets Version A's zoom (+/−/⤡ buttons, wheel, drag-pan) with zoom state surviving every re-render, and a scale-aware `touch-action` so phones can scroll the page over an unzoomed map.

**Architecture:** Extend `attachZoomPan` backward-compatibly with `viewBox(): string` (read current box) and `opts.restore` (re-apply a saved box, clamped), and replace its unconditional `touch-action: none` with scale-aware syncing (`pan-y` at base scale, `none` when zoomed). Then `renderMap` in play mode saves/destroys/re-attaches around its full rebuild — zoom survives turns, pending-action clicks, language toggles, and replay scrubbing.

**Tech Stack:** TypeScript, vitest+jsdom (PointerEvent polyfill already in zoomPan.test.ts). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-play-map-zoom-design.md`

## Global Constraints

- Run all test commands from the WORKTREE root. Baseline before Task 1: 508 passing (+ the theme.css tune commit `d68e7fb` already on the branch).
- `npm run build` (tsc noUnusedLocals + vite) must pass.
- No `src/engine` changes; the `playApp.ts` verbatim advance handler guarded region untouched (Task 2 edits only `renderMap` + one import + one state line).
- `attachZoomPan`'s new parameters are OPTIONAL — Version A's call site in `src/ui/app.ts` compiles and behaves identically except the sanctioned improvement: `touch-action` at base scale becomes `"pan-y"` instead of `"none"` (page scroll over an unzoomed map works on touch).
- The existing drag-vs-click discrimination (DRAG_PX, capture-phase click swallow) must be byte-identical — the play map's attack/city taps depend on it.
- Commit after each task; message style `feat(mobile): …`.

---

### Task 1: zoomPan extension — viewBox(), restore, scale-aware touch-action

**Files:**
- Modify: `src/ui/zoomPan.ts`
- Test: `src/ui/zoomPan.test.ts` (additive)

**Interfaces:**
- Produces (Task 2 relies on these exact signatures):
  - `export interface ZoomPan { reset(): void; destroy(): void; viewBox(): string; }`
  - `export function attachZoomPan(svg: SVGSVGElement, container: HTMLElement, opts?: { restore?: string | null }): ZoomPan`
  - Behavior: attach now writes the viewBox once (normalizing the attribute to `"x y w h"` template form) and sets `touch-action` = `"pan-y"` at base scale / `"none"` when zoomed, re-synced on every zoom/pan/reset.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("attachZoomPan", …)` block of `src/ui/zoomPan.test.ts` (the file already has the PointerEvent polyfill, `makeSvg()`, and `vb()` helpers — reuse them):

```ts
  it("viewBox() reports the current box and restore round-trips across re-attach", () => {
    const zp = attachZoomPan(svg, container);
    (container.querySelectorAll(".map-zoom-controls button")[0] as HTMLButtonElement).click(); // +
    const saved = zp.viewBox();
    expect(saved).not.toBe("0 0 100 100");
    expect(svg.getAttribute("viewBox")).toBe(saved);
    zp.destroy();
    const fresh = makeSvg();
    const zp2 = attachZoomPan(fresh.svg, fresh.container, { restore: saved });
    expect(zp2.viewBox()).toBe(saved); // exact — an in-range restore copies the numbers verbatim
    expect(fresh.svg.getAttribute("viewBox")).toBe(saved);
    zp2.destroy();
  });

  it("garbage restore starts at base; over-zoomed restore clamps to MAX_SCALE", () => {
    const a = attachZoomPan(svg, container, { restore: "not a box" });
    expect(a.viewBox()).toBe("0 0 100 100");
    a.destroy();
    const fresh = makeSvg();
    const b = attachZoomPan(fresh.svg, fresh.container, { restore: "0 0 1 1" }); // scale 100 → clamp 8
    expect(vb(fresh.svg)[2]).toBeCloseTo(100 / 8, 5);
    b.destroy();
  });

  it("touch-action follows scale: pan-y at base, none when zoomed, pan-y after reset", () => {
    const zp = attachZoomPan(svg, container);
    expect(svg.style.touchAction).toBe("pan-y");
    (container.querySelectorAll(".map-zoom-controls button")[0] as HTMLButtonElement).click(); // +
    expect(svg.style.touchAction).toBe("none");
    zp.reset();
    expect(svg.style.touchAction).toBe("pan-y");
    zp.destroy();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/zoomPan.test.ts`
Expected: 3 FAIL (`viewBox` is not a function; touchAction is `"none"` at base).

- [ ] **Step 3: Implement in `src/ui/zoomPan.ts`**

3a. Interface + signature:

```ts
export interface ZoomPan { reset(): void; destroy(): void; viewBox(): string; }
```

```ts
export function attachZoomPan(svg: SVGSVGElement, container: HTMLElement, opts?: { restore?: string | null }): ZoomPan {
```

3b. Scale-aware touch-action — extend `apply` (replacing the old one-liner) so every path that writes the box also syncs the policy:

```ts
  // at base scale the map yields the touch surface to the page (scroll passes through, taps
  // still land); zoomed in, the map owns it (one-finger pan, and pinch arrives as pointers)
  const syncTouchAction = () => { svg.style.touchAction = cur.w < base.w - 1e-9 ? "none" : "pan-y"; };
  const apply = () => { svg.setAttribute("viewBox", `${cur.x} ${cur.y} ${cur.w} ${cur.h}`); syncTouchAction(); };
```

3c. DELETE the line `svg.style.touchAction = "none";` (near the listener registrations).

3d. Restore + initial apply — after the listener registrations / `svg.style.cursor = "grab";`, add:

```ts
  // restore a saved box (the play map is rebuilt every render): in-range boxes are copied
  // verbatim so a save/restore round-trip is exact; out-of-range scales clamp; garbage is ignored
  const r = opts?.restore ? parse(opts.restore) : null;
  if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0) {
    const scale = base.w / r.w;
    if (scale >= MIN_SCALE && scale <= MAX_SCALE) cur = { ...r };
    else {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      cur = { x: r.x, y: r.y, w: base.w / s, h: base.h / s };
    }
    clampPan();
  }
  apply(); // normalizes the attribute and sets the initial touch-action either way
```

3e. Return object gains the getter:

```ts
  return {
    reset,
    viewBox() { return `${cur.x} ${cur.y} ${cur.w} ${cur.h}`; },
    destroy() {
```

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 508 + 3 = 511 passing (all six pre-existing zoomPan tests still green — none asserts `touchAction`); tsc clean (Version A's `attachZoomPan(svg, container)` call still matches the optional signature).

- [ ] **Step 5: Commit**

```bash
git add src/ui/zoomPan.ts src/ui/zoomPan.test.ts
git commit -m "feat(mobile): zoomPan gains viewBox()/restore + scale-aware touch-action"
```

---

### Task 2: Play map integration — zoom that survives every re-render

**Files:**
- Modify: `src/ui/playApp.ts` (import; one state line in `startGame`; `renderMap` head and tail)
- Modify: `src/theme.css` (one line inside the EXISTING `@media (pointer: coarse)` block)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes (from Task 1): `attachZoomPan(svg, container, { restore })` and `ZoomPan` with `viewBox(): string`.
- Produces: DOM contract — `.map-frame` contains `.map-zoom-controls` with 3 buttons (`+`, `−`, `⤡`); the world svg's `viewBox` changes on `+`, survives `.btn-advance`, and returns to base on `⤡`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts`:

```ts
  it("the play map zooms via controls; zoom survives a turn; reset restores", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const buttons = () => [...root.querySelectorAll(".map-frame .map-zoom-controls button")] as HTMLButtonElement[];
    expect(buttons().length).toBe(3); // + / − / ⤡
    const svgVb = () => (root.querySelector(".map-frame svg") as SVGSVGElement).getAttribute("viewBox");
    const base = svgVb();
    buttons()[0].click(); // +
    const zoomed = svgVb();
    expect(zoomed).not.toBe(base);
    (root.querySelector(".btn-advance") as HTMLButtonElement).click(); // full map rebuild
    expect(svgVb()).toBe(zoomed); // restore carried the zoom across the re-render
    buttons()[2].click(); // ⤡ (fresh controls on the rebuilt map)
    expect(svgVb()).toBe(base);
  });
```

(Note for the implementer: `base` is read AFTER attach, so it's already in the normalized `"x y w h"` template form — the reset comparison is exact.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — no `.map-zoom-controls` in the play map.

- [ ] **Step 3: Implement**

3a. `src/ui/playApp.ts` import (with the other `./` imports):

```ts
import { attachZoomPan, type ZoomPan } from "./zoomPan";
```

3b. State — in `startGame`, next to the other `let` declarations (e.g. after `let replayBar: Timeline | null = null;`):

```ts
    let mapZoom: ZoomPan | null = null; // the map is rebuilt every render; zoom must survive it
```

3c. `renderMap` head — the function currently opens with `mapFrame.innerHTML = "";`. Insert BEFORE it:

```ts
      const savedView = mapZoom ? mapZoom.viewBox() : null;
      mapZoom?.destroy(); // tears down svg listeners + any in-flight drag's window listeners
      mapZoom = null;
```

3d. `renderMap` tail — after `mapFrame.appendChild(svg); deconflictLabels(svg);` add:

```ts
      mapZoom = attachZoomPan(svg, mapFrame, { restore: savedView });
```

3e. `src/theme.css` — inside the EXISTING `@media (pointer: coarse)` block (do not create a second one), add:

```css
  .map-zoom-controls button { min-width: 48px; }
```

(The `#play button` rule already gives them 48px height on coarse; this keeps them square-ish. `.map-frame` already has `position: relative` at theme.css:33 — no change needed. Desktop Version A control visuals unchanged.)

- [ ] **Step 4: Full suite + typecheck + build**

Run: `npx vitest run` then `npm run build`
Expected: 511 + 1 = 512 passing; build clean. Watch for existing playApp tests that click map cells (attack-target selection) — zoomPan's click-swallow only fires after a real drag, so genuine `element.click()` dispatches in tests pass through; if any map-click test fails, read it before touching anything and report as a concern.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(mobile): play-map zoom — controls + wheel/drag, state survives every render"
```

---

## Post-plan verification (session lead, not a task)

- Full suite + `npm run build` from the worktree root.
- Live (browser pane, fine pointer): play map shows +/−/⤡; `+` zooms (viewBox shrinks); advancing a turn keeps the zoom; ⤡ restores; wheel zooms; attack-target click still selects after a zoom; replay scrub at game over keeps the zoom. Version A map still zooms as before.
- Real phone (post-push, joins the existing checklist): at rest the page scrolls over the map and taps select; `+` then one-finger pan explores; ⤡ returns and scroll resumes.
- Whole-branch review before merge (seams: Version A call site behavior; renderMap rebuild loop).
