# Viewport-fit HUD Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On wide screens the play page becomes a no-scroll 100svh HUD — info rail left, map filling the remaining space, command bar pinned under it; narrow screens keep the current stack.

**Architecture:** playApp's mount block re-parents the same six element handles into `.play-shell > (.play-side | .play-main)`; everything else is theme.css (a wide-mode grid media query, a narrow-mode fallback replicating today's stack, `.play-col` selectors re-scoped). Spec: `docs/superpowers/specs/2026-07-12-hud-shell-layout-design.md`.

**Tech Stack:** TypeScript, CSS Grid/flex, `100svh`, `body:has(...)`. jsdom cannot see layout — geometry verification is live (Task 2).

## Global Constraints

- Render functions and the verbatim advance handler untouched — ONLY the mount block and `renderBanner`'s insert target change in playApp.ts.
- Wide mode ≥1100px: grid `340px 1fr`, `height: 100svh`, no page scroll (`body:has(.play-shell)` scoping so the picker page and Version A keep their margins); map svg `width/height: 100%` (letterboxed by the default `preserveAspectRatio`), 900px cap REMOVED in wide mode; chronicle scrolls internally.
- Narrow mode <1100px: today's stack byte-for-byte in effect (max-width 1100 centered column, svg capped 900, chronicle max-height as-is).
- The tuned play label sizes (`.play-col .nation-label` 14px etc.) must apply in BOTH modes → re-scope to `.play-shell`.
- tsc noUnusedLocals clean; run vitest from the worktree root. Baseline: 465 tests green at `9fbc203`.
- STRICT GIT: no reset/rebase/checkout/restore/clean; add only named files; verify branch + expected HEAD before committing.

---

### Task 1: Shell mount + CSS

**Files:**
- Modify: `src/ui/playApp.ts` (mount block ~lines 124-129; `renderBanner`'s `col.insertBefore(banner, log)` ~line 737)
- Modify: `src/theme.css` (lines 64-69 `.play-col` label rules; lines 134-137 `.play-col` container rules; new media-query blocks)
- Test: `src/ui/playApp.test.ts` (append 2)

**Interfaces:**
- Consumes: existing element handles `panel/goals/dilemmaBox/stage/actions/log/howtoBox`, `renderBanner`'s `banner` (class `stub`).
- Produces: DOM contract `.play-shell > .play-side` (panel, goals, dilemma, [banner], chronicle) and `.play-shell > .play-main` (stage, actions).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/playApp.test.ts`:

```ts
it("mounts the HUD shell: info rail left of the map, commands under it", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const side = root.querySelector(".play-shell > .play-side");
  const main = root.querySelector(".play-shell > .play-main");
  expect(side).not.toBeNull();
  expect(main).not.toBeNull();
  expect(side!.querySelector(".play-panel")).not.toBeNull();
  expect(side!.querySelector(".goals")).not.toBeNull();
  expect(side!.querySelector(".dilemma")).not.toBeNull();
  expect(side!.querySelector(".chronicle")).not.toBeNull();
  expect(main!.querySelector(".stage svg.world")).not.toBeNull();
  expect(main!.querySelector(".play-actions")).not.toBeNull();
});

it("the game-over banner lands in the side rail before the chronicle", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  for (let i = 0; i < 60; i++) {
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) break;
    adv.click();
  }
  const side = root.querySelector(".play-side")!;
  const banner = side.querySelector(".stub");
  expect(banner).not.toBeNull();
  const kids = [...side.children];
  expect(kids.indexOf(banner as Element)).toBeLessThan(kids.indexOf(side.querySelector(".chronicle")!));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: both new tests FAIL (`.play-shell` absent); all existing PASS.

- [ ] **Step 3: Implement**

(a) `src/ui/playApp.ts` — replace the mount block (the comment + `col` creation through `root.append`):

```ts
    // viewport-fit HUD shell (wide screens): info rail on the LEFT (the frequent-info edge, per
    // HUD research), the map filling the remaining space, the command bar pinned under it (the
    // RTS bottom-commands convention). Narrow screens fall back to the old vertical stack in CSS.
    const col = document.createElement("div");
    col.className = "play-shell";
    const side = document.createElement("div");
    side.className = "play-side";
    const main = document.createElement("div");
    main.className = "play-main";
    side.append(panel, goals, dilemmaBox, log);
    main.append(stage, actions);
    col.append(side, main);
    root.append(howtoBox, col);
```

(b) `renderBanner`: `col.insertBefore(banner, log);` → `side.insertBefore(banner, log);`

(c) `src/theme.css`:
- Re-scope lines 64-69: every `.play-col ` prefix → `.play-shell ` (6 label rules).
- DELETE the two old container rules:
  `.play-col { max-width: 1100px; ... }` and `.play-col .stage svg.world { max-width: 900px; ... }`.
- Add in their place:

```css
/* viewport-fit HUD shell (≥1100px): no page scroll — info rail left, map fills, commands bottom */
@media (min-width: 1100px) {
  body:has(.play-shell) { overflow: hidden; }
  body:has(.play-shell) #play { max-width: none; margin: 0; padding: 0; }
  .play-shell { display: grid; grid-template-columns: 340px 1fr; gap: 10px; height: 100svh; padding: 10px; box-sizing: border-box; }
  .play-side { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: hidden; }
  .play-side .chronicle { flex: 1; min-height: 0; max-height: none; overflow: auto; }
  .play-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
  .play-main .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .play-main .map-frame { flex: 1; min-height: 0; }
  .play-main .stage svg.world { width: 100%; height: 100%; max-width: none; }
}
/* narrow fallback (<1100px): today's centered vertical stack, unchanged */
@media (max-width: 1099.98px) {
  .play-shell { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
  .play-shell .stage svg.world { max-width: 900px; margin: 0 auto; }
}
```

Then `grep -rn "play-col" src/` — zero hits allowed (tests don't use it; only theme.css did).

- [ ] **Step 4: Run the suites**

Run: `npx vitest run src/ui/playApp.test.ts` → PASS (existing + 2 new). `npx vitest run` → all green. `npx tsc --noEmit` clean. `npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): viewport-fit HUD shell — info rail left, bigger map, bottom command bar, no scroll"
```

---

### Task 2: Live geometry verification (controller-run — the feature IS geometry)

- [ ] **Step 1:** Dev server; browser viewport 1440×900; open `/play.html#seed=11`, pick a nation, then measure via JS eval:
  - `document.body.scrollHeight <= innerHeight` (no page scroll)
  - `.play-panel` rect top ≥ 8 (not flush at 0)
  - `.btn-advance` rect bottom ≤ innerHeight (command bar inside the viewport)
  - `svg.world` drawn width > 900 (the cap is gone and the map grew)
  - `.chronicle` scrollHeight vs clientHeight (internal scroll)
- [ ] **Step 2:** Resize to 1000×800 → `.play-shell` falls back to the stack (side above main by rect tops), svg ≤ 900 wide.
- [ ] **Step 3:** Interactions still work in shell mode: map target click sets ⚔ on the advance button; chip click sets 🕊; a dilemma card renders in the sidebar. Console clean.
- [ ] **Step 4:** Whole-branch final review → merge per finishing-a-development-branch; push awaits "push해"; the LOOK still needs the user's eyes.
