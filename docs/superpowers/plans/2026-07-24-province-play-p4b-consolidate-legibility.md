# Province play P4b (consolidate legibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make consolidating feel like it does something — show the stability gain (`안정도 55% → 65%`) on a selected consolidate province — and make the buried "consolidate to break through" cue prominent (a `🔓` marker on breakable too-strong rows), so the player understands why/when to consolidate.

**Architecture:** UI display only, in `fortifyOverlay` and `attackLine`/the conquer preview inside `src/ui/provinceApp.ts`, plus two CSS rules. A tiny pure exported `consolidatedStability` helper carries the +0.1 arithmetic. No engine change — `explainAttack.breakable` and `CONSOLIDATE_BONUS` are reused as-is, so all golden hashes are untouched by construction.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-24-province-play-p4b-consolidate-legibility-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`, `src/theme.css`. Nothing else.
- **Do not touch `src/engine/`.** The golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`) must stay untouched — they will, as long as no engine file changes.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- Every user-visible string needs a `ko` and an `en` form, following the existing `lang === "ko" ? ... : ...` pattern.
- **`CONSOLIDATE_BONUS = 0.1` is NOT exported from the engine.** The `consolidatedStability` helper re-declares `0.1` locally with a comment that it must match the engine's `CONSOLIDATE_BONUS`. It is a DISPLAY value only (never feeds a contest), so a drift would only mis-label. This matches how P3's `battleMargin` re-declares `CONTEST_THRESH` locally.
- The copy must stay accurate to `breakable`'s meaning: `breakable` = "a fully cohesive realm could take this" = "building up opens it EVENTUALLY", NOT "one consolidate turn opens it". Do not write copy that promises one turn.
- Baseline before you start: **702 tests passing**.
- Commit after each task on the current branch. Do not merge, do not push.

---

### Task 1: Stability `→` on selected consolidate provinces + prominent breakable cue

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `fortifyOverlay`'s existing per-province loop (which already computes `sel`, `protectedSel`, and sets the `<title>`); `attackLine`'s existing `od.breakable` branch; the conquer-preview row builder at ~line 790.
- Produces: `export function consolidatedStability(sol: number): number`; a `.prov-fortify-gain` map label on selected consolidate provinces; a `.prov-preview-row.breakable` class + `🔓` marker on breakable too-strong rows.

- [ ] **Step 1: Write the failing tests**

Extend the import at the top of `src/ui/provinceApp.test.ts` to include `consolidatedStability` (add it to the existing `./provinceApp` import list):

```ts
import {
  mountProvinceApp, /* ...existing... */ battleMargin, consolidatedStability,
} from "./provinceApp";
```

Append:

```ts
describe("consolidatedStability (the +0.1 the consolidate action adds, for display)", () => {
  it("adds the consolidate bonus and clamps at 1", () => {
    expect(consolidatedStability(0.55)).toBeCloseTo(0.65, 5);
    expect(consolidatedStability(0.95)).toBeCloseTo(1.0, 5);
    expect(consolidatedStability(1.0)).toBe(1.0);
    expect(consolidatedStability(0)).toBeCloseTo(0.1, 5);
  });
});

describe("consolidate mode shows the stability gain on a selected province", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function startConsolidate(): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (Array.from(root.querySelectorAll(".prov-stance-btn")) as HTMLButtonElement[])
      .find((b) => b.dataset.mode === "consolidate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("shows a X% → Y% gain label on a province the player selects to consolidate, not on unselected ones", () => {
    startConsolidate();
    expect(root.querySelector(".prov-fortify-gain")).toBeNull(); // nothing selected yet
    (root.querySelector(".prov-fortify") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const gain = root.querySelector(".prov-fortify-gain");
    expect(gain).toBeTruthy();
    // "안정도 X% → Y%" with Y = X + 10 (clamped) — assert the arrow and a +10 relationship
    const m = (gain!.textContent || "").match(/(\d+)%\s*→\s*(\d+)%/);
    expect(m).toBeTruthy();
    const x = Number(m![1]), y = Number(m![2]);
    expect(y).toBe(Math.min(100, x + 10));
  });
});

describe("breakable too-strong rows get a prominent 🔓 build-up cue", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("marks a breakable too-strong armed target with 🔓 and the .breakable class; a non-breakable one keeps 'too tough'", () => {
    // drive seed 1 to a turn with too-strong targets, arm them all, then inspect the preview rows.
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (const t of root.querySelectorAll(".prov-target")) t.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const tooStrong = [...root.querySelectorAll(".prov-preview-row.too-strong")];
    expect(tooStrong.length).toBeGreaterThan(0);
    for (const row of tooStrong) {
      const txt = row.textContent || "";
      if (row.classList.contains("breakable")) {
        expect(txt).toContain("🔓");
        expect(txt).toMatch(/뚫려|break through/);
      } else {
        expect(txt).toMatch(/벅참|too tough/);
        expect(txt).not.toContain("🔓");
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — `consolidatedStability` not exported; no `.prov-fortify-gain`; no `.breakable` class / `🔓`.

- [ ] **Step 3: Add the `consolidatedStability` helper**

In `src/ui/provinceApp.ts`, at module scope near the other exported helpers (e.g. after `battleMargin`):

```ts
// The consolidate action adds CONSOLIDATE_BONUS to a province's solidarity. Shown at decision time so the
// player SEES the gain their pick buys (playtest: "consolidating doesn't visibly raise stability"). DISPLAY
// only — never feeds a contest, so this local 0.1 just has to match the engine's CONSOLIDATE_BONUS for the
// label to read right.
const CONSOLIDATE_BONUS_DISPLAY = 0.1; // MUST match the engine's CONSOLIDATE_BONUS (not exported)
export function consolidatedStability(sol: number): number {
  const v = sol + CONSOLIDATE_BONUS_DISPLAY;
  return v > 1 ? 1 : v;
}
```

- [ ] **Step 4: Show the gain label in `fortifyOverlay`**

In `fortifyOverlay`, the per-province loop already computes `sel` and `protectedSel` and sets a `<title>`. Keep the title logic, and ADD a small map label for SELECTED provinces showing the gain. After the block that appends the fortify path + title (and near where the selected `.prov-fortify-ring` is appended), add — only when `sel`:

```ts
      if (sel) {
        const cur = Math.round(u.s.provSol[prov.id] * 100);
        const after = Math.round(consolidatedStability(u.s.provSol[prov.id]) * 100);
        const c = u.world.provinces[prov.id].centroid;
        const label = svgEl("text", {
          class: "prov-fortify-gain", style: "pointer-events:none",
          x: Math.round(c[0]), y: Math.round(c[1]) - 6, "text-anchor": "middle",
        });
        label.textContent = lang === "ko" ? `안정도 ${cur}% → ${after}%` : `stability ${cur}% → ${after}%`;
        g.appendChild(label);
      }
```

Leave the existing `<title>` precedence as-is (the `🛡 protected` title still wins for a protected selected province — the gain label is an ADDITION, not a replacement of the title, so both can coexist: the map label shows the number, the hover title shows the shield message).

- [ ] **Step 5: Prominent breakable cue in the conquer preview**

Two parts — the row CLASS and the leading marker in the text.

(a) In the conquer-preview row builder (~line 790, where `row.className = "prov-preview-row " + (od?.win ? "winnable" : "too-strong")`), add a `breakable` class when the target is a breakable too-strong one:

```ts
            const od = explainAttack(ui.s, ui.playerId, p);
            const row = document.createElement("div");
            const cls = od?.win ? "winnable" : (od?.breakable ? "too-strong breakable" : "too-strong");
            row.className = "prov-preview-row " + cls;
            row.textContent = (od?.win ? "✓ " : "✕ ") + attackLine(ui, p);
            preview.appendChild(row);
```

(b) In `attackLine`, change the breakable trailing cue to lead with `🔓` and phrase it as "build up" (eventual, accurate to `breakable`):

```ts
    if (!od.win) line += od.breakable // building up (consolidate) opens it EVENTUALLY, vs too tough for now
      ? (lang === "ko" ? " · 🔓 내실로 힘을 키우면 뚫려요" : " · 🔓 build up your strength to break through")
      : (lang === "ko" ? " · 지금은 벅참 (상대가 약해지길)" : " · too tough for now (wait for it to weaken)");
    return line;
```

- [ ] **Step 6: Add the CSS**

In `src/theme.css`:

```css
/* consolidate gain label: the stability a pick buys, shown on the map at decision time */
.prov-fortify-gain { font-size: 9px; font-weight: 600; fill: #3a6ea5; paint-order: stroke;
  stroke: #f7f2e6; stroke-width: 2.4px; stroke-linejoin: round; }
/* a too-strong target that consolidation can open reads as an opportunity, not a dead end */
.prov-preview-row.breakable { color: #7a5a1e; }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS. Watch for any existing test that asserted the OLD breakable copy (`🛡 내실하면 뚫림` / `consolidate to break through`) — grep the test file for `내실하면 뚫림` / `break through` and update those assertions to the new `🔓 ... 뚫려요` / `🔓 build up ... break through` wording (do not weaken them).

- [ ] **Step 8: Full suite + build**

Run: `npm test`
Expected: PASS, ~707 tests (702 + 5 new).

Run: `npm run build`
Expected: no TypeScript errors.

If the count differs but everything passes, trust the actual count.

- [ ] **Step 9: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): show consolidate's stability gain and make the break-through cue prominent"
```

---

### Task 2: Live-browser verification

Confirm the gain label reads correctly and the breakable cue is prominent.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Start the dev server**

`preview_start` `{name: "worldmaker"}`, navigate to `playProvince.html`, `resize_window` to 1280×900 (the preview viewport starts at 0 width; `?seed=` is NOT plumbed — read state from the DOM).

- [ ] **Step 2: The consolidate gain label**

Pick a nation, switch to consolidate mode, and select a province (click a `.prov-fortify`). Confirm a `.prov-fortify-gain` label reads `안정도 X% → Y%` with `Y = min(100, X + 10)`, positioned near the province centroid. Confirm an unselected province shows no gain label. Select a second province and confirm it too gets a label (up to the CONSOLIDATE_MAX cap).

- [ ] **Step 3: Protected precedence intact**

If a selected province is also "protected" (from P2), confirm its hover `<title>` still shows the `🛡` shield message while the map still shows the gain label — the two coexist, neither regressed.

- [ ] **Step 4: The breakable cue in conquer mode**

Switch to conquer mode on a turn with too-strong targets, arm them, and read the `.prov-preview-row` texts. Confirm breakable rows lead their cue with `🔓 ... 뚫려요 / build up ... break through` and carry the `.breakable` class (accent colour), while non-breakable too-strong rows read `too tough for now` with no `🔓`.

- [ ] **Step 5: Console + report**

`read_console_messages` — no errors. Report the exact label and cue strings you read so the user can judge the wording and whether consolidate now "feels" like it does something.

**Not verifiable here:** whether it now feels intuitive — the user's eyes. Report the strings.

---

## Self-review notes

- Spec coverage: stability gain (effect) → Task 1 Step 4 + the `consolidatedStability` helper; prominent breakable cue (purpose) → Task 1 Step 5; dead-turn relief is a consequence of Step 5 with no extra code; live confirmation → Task 2.
- No engine change: `breakable` and `CONSOLIDATE_BONUS` are reused; the helper re-declares `0.1` locally (display-only), same pattern as P3's `battleMargin`/`CONTEST_THRESH`.
- The copy stays accurate to `breakable` ("build up ... eventually", not "one turn opens it") — the strict per-front predictor is deferred (not this cut).
- Test-count estimates drift; trust the actual number when everything passes.
