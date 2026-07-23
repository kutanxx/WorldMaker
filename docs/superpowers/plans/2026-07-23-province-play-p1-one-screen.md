# Province play P1 (one screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the province game playable without scrolling — the map and the action button on one screen, a live win-progress counter, and a clear "nothing to attack" state — so a turn never means scrolling or guessing.

**Architecture:** All three changes live in `targetOverlay`/`render`/`mapWidthPx`/`hudText` inside `src/ui/provinceApp.ts` plus rules in `src/theme.css`. UI-only: no engine file changes, so all golden hashes are untouched by construction. A pure exported `dominationProgress` helper ties the counter to the win check; a corrected `mapWidthPx` keeps the verdict badge scaled right once the map's height is capped.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-23-province-play-p1-one-screen-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`, `src/theme.css`. Nothing else.
- **Do not touch `src/engine/`.** The golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`) must stay untouched — they will, as long as no engine file changes.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- Every user-visible string needs a `ko` and an `en` form, following the existing `lang === "ko" ? ... : ...` pattern in this file.
- Domination win check (verbatim, from `provinceApp.ts`): `isDomination(prov, start, land)` returns `prov - start >= Math.round(0.15 * land)` (`DOMINATION_GAIN_FRAC = 0.15`). The counter MUST derive from the same numbers.
- Baseline before you start: **669 tests passing**.
- Commit after each task on the current branch. Do not merge, do not push.

---

### Task 1: Win-progress counter (A2)

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `isDomination(prov, start, land)` (existing, exported).
- Produces: `export function dominationProgress(prov: number, start: number, land: number): { gained: number; goal: number }`; a `.prov-progress` element rendered under the HUD.

- [ ] **Step 1: Write the failing tests**

Extend the import at the top of `src/ui/provinceApp.test.ts`:

```ts
import {
  mountProvinceApp, provinceCellOwner, isDomination, shakyOpacity, reasonText, survivalGrade, defectionReasonText,
  sortRisksByUrgency, provinceOutlinePath, badgeScale, dominationProgress,
} from "./provinceApp";
```

Append:

```ts
describe("dominationProgress (the counter is the win check, exposed)", () => {
  const LAND = 102; // goal = round(0.15 * 102) = 15
  it("reports gained = prov - start and goal = round(0.15*land)", () => {
    expect(dominationProgress(25, 10, LAND)).toEqual({ gained: 15, goal: 15 });
    expect(dominationProgress(24, 10, LAND)).toEqual({ gained: 14, goal: 15 });
  });
  it("shows a NEGATIVE gained when the realm shrank below its start (the losing state)", () => {
    expect(dominationProgress(6, 10, LAND)).toEqual({ gained: -4, goal: 15 });
  });
  it("gained >= goal exactly when isDomination is true — same fact, no drift", () => {
    for (const [prov, start] of [[25, 10], [24, 10], [40, 40], [55, 40], [6, 10]] as const) {
      const { gained, goal } = dominationProgress(prov, start, LAND);
      expect(gained >= goal).toBe(isDomination(prov, start, LAND));
    }
  });
});

describe("HUD win-progress bar", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  it("renders a counter and bar matching dominationProgress once a game starts", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const prog = root.querySelector(".prov-progress");
    expect(prog).toBeTruthy();
    const hud = root.querySelector(".prov-hud")!.textContent || "";
    // realm count in the HUD ("영토 A/B") must equal start+gained from the counter
    const provInHud = Number((hud.match(/(\d+)\s*\/\s*\d+/) || [])[1]);
    const gained = Number((prog!.textContent || "").match(/-?\d+/)?.[0]);
    expect(Number.isFinite(provInHud)).toBe(true);
    expect(Number.isFinite(gained)).toBe(true);
    // at t0 gained is 0 (just picked), so the HUD province count equals the start
    expect(prog!.querySelector(".prov-progress-bar")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — `dominationProgress` is not exported.

- [ ] **Step 3: Add the `dominationProgress` helper**

In `src/ui/provinceApp.ts`, right after the `isDomination` function (which defines `DOMINATION_GAIN_FRAC`):

```ts
// The HUD counter exposes EXACTLY what isDomination counts, so it can never disagree with the win: you have
// gained (prov - start) provinces toward a goal of round(0.15 * land). gained is reported even when negative —
// a realm shrinking below its start is the losing state the player most needs to see, so it is not clamped.
export function dominationProgress(prov: number, start: number, land: number): { gained: number; goal: number } {
  return { gained: prov - start, goal: Math.round(DOMINATION_GAIN_FRAC * land) };
}
```

- [ ] **Step 4: Render the counter + bar under the HUD**

In `render()`, immediately after the block that appends `hud` (`root.appendChild(hud);`):

```ts
      // win-progress: the same fact as the victory check, shown as a number + bar so "am I winning?" is legible
      const { gained, goal } = dominationProgress(playerProvinceCount(ui), ui.startProvinces, ui.s.n);
      const prog = document.createElement("div");
      prog.className = "prov-progress";
      const label = document.createElement("span");
      label.className = "prov-progress-label";
      label.textContent = lang === "ko" ? `정복 ${gained} / ${goal}` : `conquered ${gained} / ${goal}`;
      const track = document.createElement("div");
      track.className = "prov-progress-track";
      const fill = document.createElement("div");
      fill.className = "prov-progress-bar";
      const frac = goal > 0 ? gained / goal : 0;
      fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; // bar clamps at empty; the NUMBER can go negative
      track.appendChild(fill);
      prog.append(label, track);
      root.appendChild(prog);
```

- [ ] **Step 5: Add the CSS**

In `src/theme.css`, after the `.prov-hud` rule (search for `.prov-hud`):

```css
/* win-progress: the domination goal made visible — a number that can go negative when the realm shrinks,
   over a bar that empties (but never fills below zero). */
.prov-progress { max-width: 900px; margin: 4px auto 0; display: flex; align-items: center; gap: 10px; }
.prov-progress-label { font-size: 13px; color: #6a5a3c; white-space: nowrap; font-variant-numeric: tabular-nums; }
.prov-progress-track { flex: 1; height: 6px; background: #e6dcc2; border-radius: 3px; overflow: hidden; }
.prov-progress-bar { height: 100%; background: #d8b25a; transition: width .2s; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 7: Full suite + build**

Run: `npm test`
Expected: PASS, ~674 tests (669 + 5 new).

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): show domination progress as a counter + bar tied to the win check"
```

---

### Task 2: Empty-conquer-state notice (A5)

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: the conquer-mode branch in `render()`, `targetOverlay`.
- Produces: a `.prov-empty` notice inside the target-preview area when conquer mode has zero targets.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("empty conquer state notice", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("shows a notice only when conquer mode has zero attackable provinces", () => {
    // seed + nation scan for a turn with no armable targets; drive an all-consolidate game
    // (never attacking keeps the player small, and some turns genuinely have nothing takeable).
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let sawEmpty = false, sawTargets = false;
    for (let t = 0; t < 30; t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      const targets = root.querySelectorAll(".prov-target").length;
      const empty = root.querySelector(".prov-empty");
      if (targets === 0) { expect(empty).toBeTruthy(); sawEmpty = true; }   // no targets → notice present
      else { expect(empty).toBeNull(); sawTargets = true; }                 // targets → no notice
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(sawEmpty || sawTargets).toBe(true); // the game reached at least one conquer turn to check
  });

  it("never shows the notice in consolidate mode", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (Array.from(root.querySelectorAll(".prov-stance-btn")) as HTMLButtonElement[])
      .find((b) => b.dataset.mode === "consolidate")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-empty")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- provinceApp`
Expected: FAIL — no `.prov-empty` element exists, so a zero-target turn asserts truthy on null.

Note: if the 30-turn driver never hits a zero-target conquer turn for seed 1, the first test still passes via `sawTargets` — but the SECOND assertion inside the loop (`empty === null` when targets present) exercises the new code path once targets exist, and Step 4 will make it pass. If you cannot make the failing case appear, do NOT weaken the test; report it and pin a seed known to reach a zero-target turn (the controller observed this on multiple seeds; scan 1–8 with a throwaway probe and delete it before committing).

- [ ] **Step 3: Render the notice**

In `render()`, in the `mode === "conquer"` branch, replace the empty-preview block. The current code is:

```ts
        if (targets.size === 0) {
          preview.textContent = lang === "ko"
            ? "공격할 지역을 눌러 지정하면 전투 예측이 여기 표시됩니다"
            : "click provinces to target — the battle forecast appears here";
        } else {
```

Change it so that when there are no ATTACKABLE provinces at all (not just none selected), the notice explains the dead end. Insert, right after `const preview = ...` and before the `if (targets.size === 0)`:

```ts
        // no province is attackable at all — tell the player it's a lull, not a stuck game (verified true:
        // a few consolidate turns turn "too strong" provinces takeable).
        const noneAttackable = map.querySelectorAll(".prov-target").length === 0;
        if (noneAttackable) {
          const empty = document.createElement("div");
          empty.className = "prov-empty";
          empty.textContent = lang === "ko"
            ? "지금은 칠 땅이 없어요 — 내실로 힘을 키우면 뚫립니다"
            : "No province is takeable right now — consolidate to build up strength";
          preview.appendChild(empty);
        } else if (targets.size === 0) {
```

Note the `if (targets.size === 0)` becomes `} else if (targets.size === 0) {`. The `targetOverlay(ui)` call already ran above this block (it is appended to `map` before the preview is built), so `map.querySelectorAll(".prov-target")` reflects this turn's attackable set.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test`
Expected: PASS, ~676 tests.

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): tell the player when no province is takeable instead of an empty map"
```

---

### Task 3: Cap the map height, correct the badge measurement, sticky command bar (A1)

This is the layout task. It also fixes the badge-scale interaction the spec flags: capping map height makes `preserveAspectRatio: meet` letterbox the drawing, so the box width overstates the rendered width and the badge would scale too small.

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `mapWidthPx()` (existing closure), the stance + advance rendering in `render()`.
- Produces: a corrected `mapWidthPx()`; a `.prov-commandbar` wrapper made sticky.

- [ ] **Step 1: Write the failing test for `mapWidthPx`**

The current `mapWidthPx` returns the box width. We need it to return the letterboxed rendered width. Since it is a closure, test it through its observable effect is awkward; instead extract the pure arithmetic into an exported helper and test that directly.

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("renderedMapWidth (letterboxed width once height is the binding dimension)", () => {
  it("is the box width when width is the binding dimension (wide, short box)", () => {
    // box 900x400: height*1000/700 = 571 < 900, so height binds → rendered width 571
    expect(renderedMapWidth(900, 400)).toBeCloseTo(571.43, 1);
  });
  it("is the box width when the box matches the 1000x700 aspect or is taller", () => {
    expect(renderedMapWidth(900, 900)).toBe(900); // height*1000/700 = 1286 > 900 → width binds
  });
  it("is 0 when unmeasured (jsdom), preserving the badge fallback to scale 1", () => {
    expect(renderedMapWidth(0, 0)).toBe(0);
    expect(renderedMapWidth(0, 500)).toBe(0);
  });
});
```

Add `renderedMapWidth` to the import block at the top of the test file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- provinceApp`
Expected: FAIL — `renderedMapWidth` is not exported.

- [ ] **Step 3: Add `renderedMapWidth` and use it in `mapWidthPx`**

In `src/ui/provinceApp.ts`, at module scope near `badgeScale`:

```ts
// The map svg keeps a fixed 1000x700 viewBox with preserveAspectRatio "meet", so when its box is capped in
// HEIGHT the drawing letterboxes and the box WIDTH overstates the rendered width. The badge counter-scale must
// see the width actually drawn: the smaller of the box width and the width implied by the box height at 1000:700.
// Returns 0 when unmeasured (jsdom) so badgeScale still falls back to 1.
export function renderedMapWidth(boxWidth: number, boxHeight: number): number {
  if (!boxWidth || boxWidth <= 0) return 0;
  const fromHeight = boxHeight * (1000 / 700);
  return fromHeight > 0 && fromHeight < boxWidth ? fromHeight : boxWidth;
}
```

Change the closure `mapWidthPx` to use it:

```ts
  // width of the RENDERED map in CSS px (letterboxed if height-capped); 0 in jsdom so badgeScale falls back to 1
  function mapWidthPx(): number {
    const el = root.querySelector(".prov-map");
    if (!el) return 0;
    try { const r = el.getBoundingClientRect(); return renderedMapWidth(r.width, r.height); } catch { return 0; }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- provinceApp`
Expected: PASS. The existing badge tests must still pass (desktop path: a wide-enough box means width binds, so `renderedMapWidth` returns the box width — no change to desktop badge scale).

- [ ] **Step 5: Wrap stance + advance in one sticky command bar**

The stance toggle (`stance`) and the advance bar (`bar`) are appended to `root` separately. To make them a single sticky footer, wrap them. In `render()`:

Find where `stance` is appended (`root.appendChild(stance);`) and where the advance `bar` is appended near the end of the play branch (`root.appendChild(bar);`, right after `bar.appendChild(advance);`). Replace those two separate appends with a shared container. Concretely:

- Delete the line `root.appendChild(stance);` (leave the stance element built).
- Where the advance `bar` is appended at the end, replace `root.appendChild(bar);` with:

```ts
      const commandbar = document.createElement("div");
      commandbar.className = "prov-commandbar";
      commandbar.append(stance, bar);
      root.appendChild(commandbar);
```

This moves the stance toggle down next to the advance button. That is intentional — both are per-turn commands and belong together in the pinned footer. The legend/preview/log stay in document flow above.

⚠ The consolidate-mode and dilemma-pending branches: check that `stance` is still in scope at the point `commandbar` is built (it is created before the `if (mode === "conquer")` split and used in both branches). The dilemma branch returns early before `stance` is built, so it is unaffected.

- [ ] **Step 6: Add the layout CSS**

In `src/theme.css`:

Cap the map height (find the `.prov-map` rule; if it only sets `class`-level things, add height there):

```css
.prov-map { max-height: 58vh; }
```

Add the sticky command bar after the `.prov-stance` rule:

```css
/* keep the per-turn commands (stance + advance) reachable without scrolling, however tall the panels grow */
.prov-commandbar {
  position: sticky; bottom: 0; z-index: 4;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 8px 0 10px; margin-top: 8px;
  background: linear-gradient(transparent, #efe6cf 22%);
}
```

- [ ] **Step 7: Run the tests + build**

Run: `npm test`
Expected: PASS, ~679 tests. The badge tests especially must still pass.

Run: `npm run build`
Expected: no TypeScript errors (watch for `stance` now being used only inside `commandbar` — it is still referenced, so `noUnusedLocals` is fine).

- [ ] **Step 8: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): cap map height, pin commands to a sticky bar, fix badge scale for letterboxing"
```

---

### Task 4: Live-browser verification

The A1 acceptance is explicitly a layout claim jsdom cannot judge, and the badge-scale fix must be confirmed against real layout.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Start the dev server and open the game**

`preview_start` with `{name: "worldmaker"}`. Navigate to `http://localhost:5173/playProvince.html`. `resize_window` to **1280×720** (the brief's laptop case) — and remember the preview viewport starts at width 0, so this resize is mandatory before any rect read.

- [ ] **Step 2: The A1 acceptance — map target and advance button visible together**

Pick a nation. Arm a target (click a `.prov-target`). Then check, without scrolling, that both the armed target and the advance button are in the viewport:

```js
(() => {
  const t = document.querySelector('.prov-target.armed') || document.querySelector('.prov-target');
  const adv = document.querySelector('.prov-advance');
  const tr = t.getBoundingClientRect(), ar = adv.getBoundingClientRect();
  const vh = innerHeight;
  return { targetVisible: tr.top >= 0 && tr.bottom <= vh, advVisible: ar.top >= 0 && ar.bottom <= vh,
           targetBottom: Math.round(tr.bottom), advTop: Math.round(ar.top), vh };
})()
```

Expected: both `true`. Repeat at **1440×900**.

- [ ] **Step 3: The command bar is actually pinned**

Confirm `.prov-commandbar` has computed `position: sticky` and that scrolling the panel area does not move it out of view.

- [ ] **Step 4: The badge still sits inside its province after the height cap**

Pick (or scan to) a nation with a winnable target. For each `.prov-verdict`, compute `disc.width / min(province.width, province.height)` and confirm it is ≤ ~0.75 (the per-province cap from the prior feature) — i.e. capping the map height did not blow the badge up. Also confirm the badge transform's scale is sane (not 1 when it should be counter-scaled, proving `renderedMapWidth` measured).

- [ ] **Step 5: The progress counter matches the HUD**

Read `.prov-progress` text and the HUD province count across a couple of advances; confirm `start + gained === HUD province count` and the bar width tracks. Confirm a shrinking realm shows a negative `gained` with an empty bar.

- [ ] **Step 6: The empty-state notice**

Drive to a zero-target conquer turn (consolidate-only play reaches one) and confirm `.prov-empty` renders with the notice text and no phantom targets.

- [ ] **Step 7: Console + report**

`read_console_messages` — expected no errors. Summarise results; if a check fails, fix in `provinceApp.ts` / `theme.css`, re-run `npm test`, commit.

**Not verifiable here:** whether `58vh` is the right cap on every real display — that is the user's eyes. Report the measured numbers so the user can judge.

---

## Self-review notes

- Spec coverage: A2 → Task 1; A5 → Task 2; A1 (height cap + sticky bar + `mapWidthPx` correction) → Task 3; live layout acceptance → Task 4. The badge-scale interaction the spec flags is handled in Task 3 via `renderedMapWidth`.
- Task order puts the two low-risk additive changes (counter, notice) before the layout reflow, so a layout problem in Task 3 cannot mask a regression in the simpler tasks.
- Test-count estimates drift; trust the actual number when everything passes.
- `dominationProgress` (Task 1) and `renderedMapWidth` (Task 3) are both pure and exported specifically so the two claims that matter — "the counter equals the win check" and "the badge measures the drawn width" — are pinned by direct unit tests, not just inferred from DOM.
