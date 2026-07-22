# Attack-verdict encoding (✓ badge + diagonal hatch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "I can take this province" and "this one is too strong" readable at a glance, by moving the distinction off the fill hue (which already carries ownership, and measures at 1.01–1.12 contrast) and onto shape (a ✓ badge) and pattern (45° hatching).

**Architecture:** Both marks are added inside the existing `targetOverlay` in `src/ui/provinceApp.ts`, drawn above the clickable `.prov-target` paths with `pointer-events: none` so the click layer is untouched. The existing green/red tint stays as a redundant secondary cue and as the "this is clickable" affordance. A pure `badgeScale` helper counter-scales the badge so it keeps a roughly constant on-screen size as the map is fitted to narrower viewports.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-22-attack-verdict-encoding-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`, `src/theme.css`. Nothing else.
- **Do not touch `src/engine/`.** Golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`) must stay untouched — they will, as long as no engine file changes.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- Every user-visible string needs a `ko` and an `en` form, following the existing `lang === "ko" ? ... : ...` pattern in this file.
- The badge and hatch must be `pointer-events: none`. The clickable layer stays the `.prov-target` path.
- Exact visual values from the spec, to use verbatim: badge disc `r=9`, fill `#f4ecd8`, stroke `#3c2f1c` width `1.2`; ✓ glyph `#1f6b3a`, `font-size 12`, bold. Hatch: `7` spacing, `patternUnits="userSpaceOnUse"`, `patternTransform="rotate(45)"`, stroke `#3c2f1c` width `1.6`, stroke-opacity `0.28`.
- **✓ and ✕ must never be distinguished by size** — shape alone carries the verdict (CHI 2026: accuracy 0.944 when shape carries the task variable vs 0.760 when size does). In this design the negative case has no glyph at all.
- Baseline before you start: **652 tests passing**.
- Commit after each task on the current branch. Do not merge, do not push.

---

### Task 1: ✓ badge for winnable targets, counter-scaled for narrow viewports

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for Task 2:
  - `export function badgeScale(mapWidthWorld: number, renderedWidthPx: number): number` — pure, module-level.
  - A `.prov-verdict` `<g>` per winnable target inside the existing `.prov-targets` group.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`. The import at the top of the file must gain `badgeScale`:

```ts
// extend the existing import from "./provinceApp"
import {
  mountProvinceApp, provinceCellOwner, isDomination, shakyOpacity, reasonText, survivalGrade, defectionReasonText,
  sortRisksByUrgency, provinceOutlinePath, badgeScale,
} from "./provinceApp";
```

```ts
describe("badgeScale (a verdict badge keeps a constant on-screen size)", () => {
  it("is 1 when the rendered width is unknown (jsdom / before layout)", () => {
    expect(badgeScale(1000, 0)).toBe(1);
    expect(badgeScale(1000, -5)).toBe(1);
  });
  it("counter-scales as the map is fitted into a narrower box", () => {
    expect(badgeScale(1000, 900)).toBeCloseTo(1.111, 2); // desktop ~900px
    expect(badgeScale(1000, 500)).toBe(2);               // already at the cap
  });
  it("clamps to [1, 2] — never shrinks below 1, never swallows a province on a phone", () => {
    expect(badgeScale(1000, 2000)).toBe(1); // map larger than its own viewBox
    expect(badgeScale(1000, 360)).toBe(2);  // phone: uncapped would be 2.8
  });
});

describe("verdict marks on the attack map", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function start(): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("puts exactly one ✓ badge on each province you can take, and none on the rest", () => {
    start();
    const winnable = root.querySelectorAll(".prov-target.winnable").length;
    const badges = root.querySelectorAll(".prov-targets .prov-verdict");
    expect(winnable).toBeGreaterThan(0);          // seed 1 offers at least one takeable target
    expect(badges.length).toBe(winnable);
    for (const b of badges) expect(b.textContent).toContain("✓");
  });

  it("never blocks the click layer", () => {
    start();
    for (const b of root.querySelectorAll(".prov-verdict")) {
      expect(b.getAttribute("style") || "").toContain("pointer-events:none");
    }
  });

  it("registers exactly ONE resize listener no matter how many times the map re-renders", () => {
    const spy = vi.spyOn(window, "addEventListener");
    start();
    for (let i = 0; i < 3; i++) {
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      if (adv) adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const resizeRegistrations = spy.mock.calls.filter((c) => c[0] === "resize").length;
    expect(resizeRegistrations).toBe(1); // render() runs per turn — per-render registration would stack
    spy.mockRestore();
  });
});
```

`vi` must be in the vitest import at the top of the test file:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — `badgeScale` is not exported (import error / undefined).

- [ ] **Step 3: Add the `badgeScale` helper**

In `src/ui/provinceApp.ts`, at module scope next to the other exported helpers (e.g. after `defectionReasonText`):

```ts
// The map is a fixed 1000x700 viewBox fitted to its container, so anything drawn in viewBox units shrinks
// with the map: at ~360px phone width an r=9 badge would land at ~3 screen px. Counter-scale the badge so it
// keeps a roughly constant ON-SCREEN size. Capped at 2 — a constant-size badge and a shrinking province pull
// opposite ways, and on a phone a province is only ~24px across, so an uncapped badge would swallow it.
// Returns 1 when the width is unknown (jsdom, or before first layout).
export function badgeScale(mapWidthWorld: number, renderedWidthPx: number): number {
  if (!renderedWidthPx || renderedWidthPx <= 0) return 1;
  const k = mapWidthWorld / renderedWidthPx;
  return k < 1 ? 1 : k > 2 ? 2 : k;
}
```

- [ ] **Step 4: Draw the badge**

Inside `mountProvinceApp`, add this helper next to the other small helpers (it reads the live map, which
`render()` has already appended to `root` by the time overlays are built):

```ts
  // width of the rendered map in CSS pixels; 0 in jsdom (no layout) so badgeScale falls back to 1
  function mapWidthPx(): number {
    const el = root.querySelector(".prov-map");
    if (!el) return 0;
    try { return el.getBoundingClientRect().width; } catch { return 0; }
  }
```

In `targetOverlay`, inside the `for (const prov of u.world.provinces)` loop, after the block that appends the
armed gold ring, add:

```ts
      // "You can take this" rides SHAPE, not hue — the fill hue already belongs to ownership, and the
      // green/red tint measures at 1.01-1.12 contrast against itself over varying nation colours.
      if (win) {
        const c = u.world.provinces[prov.id].centroid;
        const k = badgeScale(u.world.grid.width, mapWidthPx());
        const badge = svgEl("g", {
          class: "prov-verdict", style: "pointer-events:none",
          transform: `translate(${Math.round(c[0])},${Math.round(c[1])}) scale(${k.toFixed(2)})`,
        });
        badge.appendChild(svgEl("circle", {
          cx: 0, cy: 0, r: 9, fill: "#f4ecd8", stroke: "#3c2f1c", "stroke-width": 1.2,
        }));
        const mark = svgEl("text", {
          x: 0, y: 4.2, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#1f6b3a",
        });
        mark.textContent = "✓";
        badge.appendChild(mark);
        g.appendChild(badge);
      }
```

- [ ] **Step 5: Register the single resize listener**

At the end of `mountProvinceApp`, replace the final `render();` call with:

```ts
  // ONE debounced resize listener for the whole app — registered here, never inside render(), which runs
  // every turn (per-render registration would stack listeners). A resize changes the map's fitted width,
  // so the verdict badges must recompute their counter-scale.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (ui) render(); }, 150);
  });
  render();
```

- [ ] **Step 6: Add the CSS**

In `src/theme.css`, after the `.prov-target, .prov-fortify` rule:

```css
/* verdict marks: the ✓ badge answers "can I take this?" by SHAPE, because hue already means ownership.
   Never interactive — the tinted .prov-target underneath stays the click target. */
.prov-verdict { pointer-events: none; }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 8: Full suite + build**

Run: `npm test`
Expected: PASS, 656 tests (652 baseline + 4 new).

Run: `npm run build`
Expected: no TypeScript errors, build succeeds.

If the count differs but everything passes, trust the actual count.

- [ ] **Step 9: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): mark takeable provinces with a scale-stable ✓ badge"
```

---

### Task 2: Diagonal hatch for too-strong targets, and the legend

The negative case gets a pattern rather than a second glyph: hatching scales with the province instead of
sitting at a fixed footprint, so it survives on small provinces and on phones.

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: the `.prov-verdict` badge and `badgeScale` from Task 1 (no code dependency; the tests below
  assert the two marks stay mutually exclusive).
- Produces: a `<pattern id="prov-hatch">` defined once per rendered overlay, and one `.prov-hatch` path per
  too-strong target.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("hatching marks the provinces you cannot take", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function start(): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("hatches every too-strong target and leaves takeable ones clear", () => {
    start();
    const tooStrong = root.querySelectorAll(".prov-target.too-strong").length;
    const hatches = root.querySelectorAll(".prov-targets .prov-hatch");
    expect(tooStrong).toBeGreaterThan(0);
    expect(hatches.length).toBe(tooStrong);
    for (const h of hatches) expect(h.getAttribute("fill")).toBe("url(#prov-hatch)");
  });

  it("defines the hatch pattern ONCE per render, not once per province", () => {
    start();
    expect(root.querySelectorAll("pattern#prov-hatch").length).toBe(1);
  });

  it("never blocks the click layer, and an unwinnable province stays selectable", () => {
    start();
    for (const h of root.querySelectorAll(".prov-hatch")) {
      expect(h.getAttribute("style") || "").toContain("pointer-events:none");
    }
    const hard = root.querySelector(".prov-target.too-strong") as SVGPathElement;
    hard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelectorAll(".prov-target.armed").length).toBe(1); // you may still attack and fail
  });

  it("the legend describes both marks, not the colours", () => {
    start();
    const legend = root.querySelector(".prov-legend")!.textContent || "";
    expect(legend).toMatch(/✓/);
    expect(legend).toMatch(/빗금|hatched/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — no `.prov-hatch` elements exist.

- [ ] **Step 3: Define the pattern once, and hatch the too-strong provinces**

In `src/ui/provinceApp.ts`, in `targetOverlay`, immediately after the group is created
(`const g = svgEl("g", { class: "prov-targets" }) as SVGGElement;`) and before the province loop:

```ts
    // ONE pattern per rendered overlay (not per province). 45° so it never reads as another region
    // boundary — the borders here run mostly horizontal/vertical — and low contrast so ~100 small
    // provinces don't moiré. Pattern is the channel to use when hue is already taken.
    const defs = svgEl("defs");
    const hatch = svgEl("pattern", {
      id: "prov-hatch", width: 7, height: 7,
      patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)",
    });
    hatch.appendChild(svgEl("line", {
      x1: 0, y1: 0, x2: 0, y2: 7, stroke: "#3c2f1c", "stroke-width": 1.6, "stroke-opacity": 0.28,
    }));
    defs.appendChild(hatch);
    g.appendChild(defs);
```

Then inside the province loop, directly after the `g.appendChild(path);` line that adds the clickable target:

```ts
      // "Too strong" rides PATTERN: it scales with the province instead of sitting at a fixed footprint,
      // so it holds up on a small province and on a phone, where a glyph would not.
      if (!win) g.appendChild(svgEl("path", {
        class: "prov-hatch", style: "pointer-events:none",
        d: byProv[prov.id], fill: "url(#prov-hatch)",
      }));
```

- [ ] **Step 4: Update the legend**

In `render()`, in the `mode === "conquer"` branch, replace the legend text assignment with:

```ts
        legend.textContent = lang === "ko"
          ? "✓ = 점령 가능  ·  빗금 = 너무 강함  ·  ⚓ = 바다 건너 원정 — 지역에 마우스를 올리면 이유가 나와요"
          : "✓ = you can take  ·  hatched = too strong  ·  ⚓ = sea expedition — hover a province for the reason";
```

Check whether any existing test asserts the old legend wording (search the test file for `점령가능`,
`너무강함`, `green`, `red`) and update those assertions to the new wording if so — do not weaken them.

- [ ] **Step 5: Add the CSS**

In `src/theme.css`, directly after the `.prov-verdict` rule:

```css
.prov-hatch { pointer-events: none; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 7: Full suite + build**

Run: `npm test`
Expected: PASS, 660 tests (656 + 4 new).

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): hatch provinces you cannot take, and retire the colour-only legend"
```

---

### Task 3: Real-browser verification

jsdom loads no CSS and does no layout, so every assertion above passes even if a real click would be
blocked or the marks were invisible. This task proves the encoding works in a browser.

**Files:** none modified unless a defect is found.

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: a verification report.

- [ ] **Step 1: Start the dev server and open the game**

Use `preview_start` with `{name: "worldmaker"}` — never `npm run dev` via a shell tool. Navigate to
`http://localhost:5173/playProvince.html`. Then `resize_window` to 1280x900 — **the preview viewport starts
at width 0, which makes `getBoundingClientRect` and `elementFromPoint` return junk**; without the resize the
checks below are meaningless.

- [ ] **Step 2: Start a game**

Click a nation on the picker map (`[data-polity]`), which enters play mode with the conquer stance.

- [ ] **Step 3: Confirm both marks render and match the verdicts**

```js
JSON.stringify({
  winnable: document.querySelectorAll('.prov-target.winnable').length,
  badges: document.querySelectorAll('.prov-verdict').length,
  tooStrong: document.querySelectorAll('.prov-target.too-strong').length,
  hatches: document.querySelectorAll('.prov-hatch').length,
  patterns: document.querySelectorAll('pattern#prov-hatch').length,
})
```

Expected: `badges === winnable`, `hatches === tooStrong`, `patterns === 1`.

- [ ] **Step 4: Confirm the badge is counter-scaled**

Read a badge's `transform` — at a 1280px window the map is roughly 900px wide, so the scale factor should be
near 1.1 (not 1, which would mean `mapWidthPx()` returned 0). Then `resize_window` to 400x800, confirm the
map re-renders after the debounce, and confirm the scale factor has risen to the cap of 2.

- [ ] **Step 5: Prove neither mark blocks play**

For a `.prov-target.too-strong` (i.e. a hatched province), compute its centre and check
`document.elementFromPoint(cx, cy)?.closest('.prov-target')` is non-null — the hatch must not intercept.
Do the same over a `.prov-verdict` badge centre. Then click a hatched province and confirm it arms
(`.prov-target.armed` count goes to 1).

- [ ] **Step 6: Measure that the problem is actually fixed**

The original complaint was measured: green vs red composited contrast was 1.01–1.12. Confirm the new marks
do not depend on that channel — check a hatch line's computed `stroke` is the ink `rgb(60, 47, 28)` and a
badge disc's computed `fill` is the parchment `rgb(244, 236, 216)`, i.e. both read against any nation colour
rather than against each other.

- [ ] **Step 7: Check the console**

`read_console_messages` — expected: no errors.

- [ ] **Step 8: Report**

Summarise the results. If a check fails, fix it in `provinceApp.ts` / `theme.css`, re-run `npm test`, and
commit the fix.

**Not verifiable here:** whether the hatch reads as "locked" rather than "dirty", and whether the badge is
legible on a real phone (`pointer: coarse` cannot be emulated). Both are the user's call — the second pairs
with backlog item ⓚ (real-phone acceptance).

---

## Self-review notes

- Spec coverage: ✓ badge → Task 1; counter-scale + single resize listener → Task 1; hatch + single pattern
  def → Task 2; legend rewording → Task 2; live clickability and scale checks → Task 3. The tint staying as
  a secondary cue requires no code (it is the current behaviour, left untouched).
- The spec's documented fallback (drop the badge, keep hatching alone) is deliberately NOT built — it is a
  retreat to take only if a real phone demands it.
- Test-count estimates (656/660) drift in practice; trust the actual number when everything passes.
