# Province play P3 (battle margin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the battle-preview line's two raw numbers (`⚔ -5 vs 🛡 17`) with one signed contest margin (`🛡 defender ahead by N`), so the negative attack number disappears and the outcome is read for the player instead of computed — with the number provably consistent with the ✓/✕ verdict.

**Architecture:** A single function, `attackLine` in `src/ui/provinceApp.ts`, is the sole producer of this string (it feeds both the preview panel rows and the target tooltips). Extract a pure exported `battleMargin(atk, def, win)` helper so the sign-from-verdict rule and the floor-at-1 rule are unit-tested directly, then rewrite `attackLine` to use it. UI display only — no engine change, so all golden hashes are untouched by construction.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-23-province-play-p3-battle-margin-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`. Nothing else.
- **Do not touch `src/engine/`.** The golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`) must stay untouched — they will, as long as no engine file changes.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- Every user-visible string needs a `ko` and an `en` form, following the existing `lang === "ko" ? ... : ...` pattern in this file.
- **The engine's contest is `win = atk > def × CONTEST_THRESH` with `CONTEST_THRESH = 1.03`.** `CONTEST_THRESH` is NOT exported from the engine; the helper re-declares it locally as a constant `1.03` with a comment that it must match the engine, and takes `win` as a parameter so it NEVER re-derives the verdict from the margin.
- **The side marker (⚔ vs 🛡) MUST come from `od.win`, never from the rounded magnitude.** Rounding `|m|×100` can be 0 for a razor-thin margin; deciding the side from the displayed number would flip a thin win/loss and contradict the ✓/✕ badge. This is the one gotcha the spec flags.
- Baseline before you start: **694 tests passing**.
- Commit on the current branch (`claude/continue-next-task-5f1bb2`).

---

### Task 1: `battleMargin` helper + rewrite `attackLine`

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `explainAttack(...)` returning `AttackOdds { win, atk, def, reason, breakable, lane }` (existing), `reasonText` (existing).
- Produces: `export function battleMargin(atk: number, def: number, win: boolean): { side: "atk" | "def"; mag: number }`.

- [ ] **Step 1: Write the failing tests**

Extend the import at the top of `src/ui/provinceApp.test.ts`:

```ts
import {
  mountProvinceApp, provinceCellOwner, isDomination, shakyOpacity, reasonText, survivalGrade, defectionReasonText,
  sortRisksByUrgency, provinceOutlinePath, badgeScale, dominationProgress, renderedMapWidth, battleMargin,
} from "./provinceApp";
```

(Include whichever of those names the file already imports — add `battleMargin`. If some of the listed names are not currently imported, do not add them; only add `battleMargin`.)

Append:

```ts
describe("battleMargin (one signed contest margin, consistent with the verdict)", () => {
  it("takes the SIDE from win, not from the rounded magnitude", () => {
    // a razor-thin WIN whose |margin|*100 rounds to 0 must still read as the attacker's side
    // atk = 0.515, def = 0.5 → margin = 0.515 - 0.5*1.03 = 0.000; win passed as true
    expect(battleMargin(0.515, 0.5, true).side).toBe("atk");
    // same magnitude, but a loss → defender's side
    expect(battleMargin(0.515, 0.5, false).side).toBe("def");
  });
  it("floors the magnitude at 1 so a decisive-but-tiny margin never prints +0", () => {
    expect(battleMargin(0.515, 0.5, true).mag).toBeGreaterThanOrEqual(1);
  });
  it("reports the real contest margin magnitude for a clear case", () => {
    // atk 0.72, def 0.50 → m = 0.72 - 0.515 = 0.205 → round(20.5) = 21 (or 20; assert >= 1 and the win side)
    const r = battleMargin(0.72, 0.50, true);
    expect(r.side).toBe("atk");
    expect(r.mag).toBeGreaterThanOrEqual(20);
  });
  it("never yields a negative magnitude even when atk is negative (the far-target case)", () => {
    // atk = -0.05 (the old "⚔ -5"), def 0.17, loss
    const r = battleMargin(-0.05, 0.17, false);
    expect(r.side).toBe("def");
    expect(r.mag).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(r.mag)).toBe(true);
  });
});

describe("attackLine as a single margin (no raw negative attack number)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("shows a signed margin whose side agrees with the ✓/✕ verdict, never a negative number", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // arm every target so the preview panel renders a row per target, then read the rows' text
    for (const t of root.querySelectorAll(".prov-target")) t.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const rows = [...root.querySelectorAll(".prov-preview-row")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const text = row.textContent || "";
      // no "⚔ -5" style negative number anywhere
      expect(text).not.toMatch(/-\d/);
      // winnable rows lead with ⚔, too-strong rows lead with 🛡 — side matches the row's own class
      if (row.classList.contains("winnable")) expect(text).toContain("⚔");
      else expect(text).toContain("🛡");
    }
  });
});
```

Note: if seed 1 at turn 0 does not offer both a winnable and a too-strong target, the row-level test still holds (it asserts per-row against that row's `winnable`/`too-strong` class, which `targetOverlay` sets from `explainAttack(...).win`). The `battleMargin` unit tests carry the sign-from-verdict and floor guarantees regardless of seed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — `battleMargin` is not exported.

- [ ] **Step 3: Add the `battleMargin` helper**

In `src/ui/provinceApp.ts`, at module scope near the other exported helpers (e.g. after `reasonText`):

```ts
// The battle line shows ONE signed contest margin instead of two raw numbers, so the reader doesn't have to
// compute `atk > def×1.03` themselves — and a negative attack strength (a far target's honest formula output)
// never appears. The margin is m = atk − def×CONTEST_THRESH, so m>0 is exactly `win`; the SIDE is taken from
// `win` (never from the rounded magnitude, which can be 0 for a razor-thin margin and would otherwise flip the
// side and contradict the ✓/✕ verdict). Magnitude is floored at 1 so a decisive-but-tiny margin never prints +0.
const CONTEST_THRESH_DISPLAY = 1.03; // MUST match the engine's CONTEST_THRESH (not exported); used for display only
export function battleMargin(atk: number, def: number, win: boolean): { side: "atk" | "def"; mag: number } {
  const m = atk - def * CONTEST_THRESH_DISPLAY;
  return { side: win ? "atk" : "def", mag: Math.max(1, Math.round(Math.abs(m) * 100)) };
}
```

- [ ] **Step 4: Rewrite `attackLine` to use it**

Replace the body of `attackLine` (currently building `⚔ {round(atk*100)} vs 🛡 {round(def*100)}`). The current function is:

```ts
  function attackLine(u: UI, prov: number): string {
    const od = explainAttack(u.s, u.playerId, prov);
    const name = (od?.lane ? "⚓ " : "") + u.world.provinces[prov].name;
    if (!od) return u.world.provinces[prov].name;
    const verdict = od.win ? (lang === "ko" ? "점령 가능" : "you can take") : (lang === "ko" ? "실패" : "too strong");
    let line = `${name} — ⚔ ${Math.round(od.atk * 100)} ${lang === "ko" ? "대" : "vs"} 🛡 ${Math.round(od.def * 100)} · ${verdict} (${reasonText(od.reason, lang)})`;
    if (!od.win) line += od.breakable // a losing attack: does building up (consolidate) open it, or is it too tough for now?
      ? (lang === "ko" ? " · 🛡 내실하면 뚫림" : " · consolidate to break through")
      : (lang === "ko" ? " · 지금은 벅참 (상대가 약해지길)" : " · too tough for now (wait for it to weaken)");
    return line;
  }
```

Rewrite the middle `line` construction to use `battleMargin` (keep everything else — `name`, `verdict`, the trailing hint — identical):

```ts
  function attackLine(u: UI, prov: number): string {
    const od = explainAttack(u.s, u.playerId, prov);
    const name = (od?.lane ? "⚓ " : "") + u.world.provinces[prov].name;
    if (!od) return u.world.provinces[prov].name;
    const verdict = od.win ? (lang === "ko" ? "점령 가능" : "you can take") : (lang === "ko" ? "실패" : "too strong");
    // one signed margin, side taken from the verdict (od.win), so the number can never contradict the ✓/✕
    const { side, mag } = battleMargin(od.atk, od.def, od.win);
    const marginText = side === "atk"
      ? (lang === "ko" ? `⚔ 우세 +${mag}` : `⚔ ahead by ${mag}`)
      : (lang === "ko" ? `🛡 우세 +${mag}` : `🛡 defender ahead by ${mag}`);
    let line = `${name} — ${marginText} · ${verdict} (${reasonText(od.reason, lang)})`;
    if (!od.win) line += od.breakable // a losing attack: does building up (consolidate) open it, or is it too tough for now?
      ? (lang === "ko" ? " · 🛡 내실하면 뚫림" : " · consolidate to break through")
      : (lang === "ko" ? " · 지금은 벅참 (상대가 약해지길)" : " · too tough for now (wait for it to weaken)");
    return line;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS. Watch for any EXISTING test that asserted the old `⚔ N 대 🛡 M` format — grep the test file for `대 🛡` / `vs 🛡` and update those assertions to the new margin format (do not weaken them; assert the new `우세`/`ahead` wording and the side marker).

- [ ] **Step 6: Full suite + build**

Run: `npm test`
Expected: PASS, ~699 tests (694 + 5 new).

Run: `npm run build`
Expected: no TypeScript errors.

If the count differs but everything passes, trust the actual count.

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): battle line as one signed margin, no negative attack number"
```

---

### Task 2: Live-browser verification

Confirm the negative-number case is gone on a real far target and the side marker matches the verdict.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Start the dev server**

`preview_start` `{name: "worldmaker"}`, navigate to `playProvince.html`, `resize_window` to 1280×900 (the preview viewport starts at 0 width; `?seed=` is NOT plumbed — read state from the DOM, don't assume a seed).

- [ ] **Step 2: The negative-number case is gone**

Pick a nation, arm every target, and read the `.prov-preview-row` texts. Confirm:
- no row contains a `-` immediately before a digit (the old `⚔ -5`);
- every `.winnable` row contains `⚔` and its verdict is 점령 가능 / you can take;
- every `.too-strong` row contains `🛡` and its verdict is 실패 / too strong.

Also read a couple of target `<title>` tooltips (the same `attackLine` feeds them) and confirm the same format.

- [ ] **Step 3: Find the specific far-target case**

Scan targets/tooltips for a far target that reads a large `🛡 defender ahead by N` (the case that previously showed `⚔ -5`), and confirm the reason still reads "far from your capital" / "수도에서 멀어 원정 페널티" — the reason now pairs sensibly with the margin.

- [ ] **Step 4: Console + report**

`read_console_messages` — no errors. Report the actual lines you read. If a defect is found, fix in `provinceApp.ts`, re-run `npm test`, commit.

**Not verifiable here:** whether the new phrasing reads well — the user's eyes. Report the exact strings so the user can judge the wording.

---

## Self-review notes

- Spec coverage: negative-number removal + single-margin format + sign-from-verdict + floor-at-1 → Task 1 (helper + `attackLine`); live confirmation of the far-target case → Task 2.
- The one gotcha (side from `od.win`, not the rounded magnitude) is pinned by the first `battleMargin` unit test, which feeds a margin that rounds to 0 and asserts the side flips with `win`, not with the magnitude.
- `CONTEST_THRESH` is not exported from the engine; the helper re-declares `1.03` locally for display and takes `win` as a parameter so it never re-derives the verdict — the plan states this in Global Constraints and the helper comment.
- Test-count estimates drift; trust the actual number when everything passes.
