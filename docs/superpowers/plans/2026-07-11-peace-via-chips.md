# Peace via Neighbor Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a neighbor attitude chip selects peace with that realm (toggle, map-previewed, confirmed by the advance button naming them); the `강화 요청` dropdown is removed.

**Architecture:** Pure play-UI: a click handler in `renderPanel`'s chip loop (chips derive a `.selected` state from `pendingAction`), the `pce` select block deleted from `renderActions`, `summary()`'s peace branch names the counterparty, three dead i18n keys removed, `howto2` rewritten to teach the three input surfaces. Engine untouched. Spec: `docs/superpowers/specs/2026-07-11-peace-via-chips-design.md`.

**Tech Stack:** TypeScript, vitest (jsdom).

## Global Constraints

- Chip click SELECTS (sets `pendingAction`), never executes — same semantic as the advisor; same chip again clears (toggle); truced chips stay clickable (renewal). Overflow (+N) neighbors lose peace access — accepted trade, they are lowest border pressure.
- The verbatim advance handler must be untouched (`summary()` sits above it and may change).
- Dead keys `peacePlaceholder`/`tipPeace`/`advPeace` deleted from BOTH langs only after grep shows zero remaining callers. `howto2` rewritten in BOTH langs.
- tsc noUnusedLocals clean. Run vitest from the worktree root. Baseline: 464 tests green at `ac6010d`.
- STRICT GIT: no reset/rebase/checkout/restore/clean; add only named files; verify branch + expected HEAD before committing.

---

### Task 1: Chip-click peace + dropdown removal (single deliverable)

**Files:**
- Modify: `src/ui/playApp.ts` (chip loop ~line 475-497 in renderPanel; `pce` block ~570-593 and `actions.append` in renderActions; `summary()` ~599-604), `src/ui/i18n.ts` (howto2 both langs; delete 3 keys ×2 langs), `src/theme.css` (chip cursor/hover/selected)
- Test: `src/ui/playApp.test.ts` (6 retargets + 1 new toggle test)

**Interfaces:**
- Consumes: existing `pendingAction` closure, `renderPending()`, `neighborAttitudes` data (`a.id`, `a.name`), `s.polities[..].name`.
- Produces: `.neighbor-chip.selected` class; command bar = invest seg + pass + advance only.

- [ ] **Step 1: Retarget the six `.peace-select` tests + add the toggle test (failing first)**

In `src/ui/playApp.test.ts` (grep `peace-select` — exactly 6 sites):

(a) Test `"offers a peace select; picking found-city on the map then invest shares one pending action"` — rename to `"neighbor chips are the peace surface; picking found-city then invest shares one pending action"` and replace the two `peace` lines with:

```ts
    expect(root.querySelectorAll(".neighbor-chip").length).toBeGreaterThan(0);
```

(rest of the test unchanged).

(b) Test `"suing for peace logs the truce"` — replace the three `peace.*` lines with:

```ts
    (root.querySelector(".neighbor-chip") as HTMLElement).click();
```

(the advance click + chronicle assertion stay).

(c) The tooltip test asserting `.peace-select` title length (~line 205) — replace that one expectation with:

```ts
    expect((((root.querySelector(".neighbor-chip") as HTMLElement) || { title: "" }).title || "").length).toBeGreaterThan(8);
```

(d) Test `"picking invest or peace paints the affected area on the map (action preview)"` — replace the three `peace.*` lines with:

```ts
    (root.querySelector(".neighbor-chip") as HTMLElement).click();
```

(the exclusive-preview assertions stay: `.preview-invest` null, `.preview-peace` present).

(e) Test `"command bar has invest segments + labelled peace + advance, and no dropdown clutter"` — rename to `"command bar has invest segments + advance, and no dropdown at all"`, and change:

```ts
    expect(root.querySelector(".peace-select")).toBeNull(); // peace moved to the neighbor chips
```

(f) Test `"peace options carry the attitude icon, and making peace flips the chip to friendly"` — rewrite as:

```ts
it("clicking a chip selects peace (named on the advance button); advancing flips it to friendly", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const chip = root.querySelector(".neighbor-chip") as HTMLElement;
  const name = (chip.textContent || "").replace(/^[⚔👁🤝]\s*/, "");
  chip.click();
  const adv = () => (root.querySelector(".btn-advance") as HTMLButtonElement).textContent || "";
  expect(adv()).toContain("🕊");
  expect(adv()).toContain(name); // the button confirms WHO, since the dropdown is gone
  expect(root.querySelector(".neighbor-chip.selected")).not.toBeNull();
  expect(root.querySelector(".preview-peace")).not.toBeNull();
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const after = [...root.querySelectorAll(".neighbor-chip")].find((c) => (c.textContent || "").includes(name));
  if (after) {
    expect(after.className).toContain("friendly");
    (after as HTMLElement).click(); // truced chips stay clickable — renewal is allowed
    expect(adv()).toContain("🕊");
  }
});
```

(g) NEW toggle test:

```ts
it("clicking the selected chip again cancels the peace pick", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  (root.querySelector(".neighbor-chip") as HTMLElement).click();
  expect(root.querySelector(".neighbor-chip.selected")).not.toBeNull();
  (root.querySelector(".neighbor-chip.selected") as HTMLElement).click();
  expect(root.querySelector(".neighbor-chip.selected")).toBeNull();
  expect((root.querySelector(".btn-advance") as HTMLButtonElement).textContent).not.toContain("🕊");
});
```

- [ ] **Step 2: Run to verify the changed/new tests fail**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: retargeted + new tests FAIL (chips not clickable, select still exists); untouched tests PASS.

- [ ] **Step 3: Implement**

(a) `src/ui/playApp.ts` — chip loop in `renderPanel`: derive selection and attach the handler. Replace the two className/textContent lines with:

```ts
          const chip = document.createElement("span");
          const selected = pendingAction?.type === "peace" && pendingAction.polity === a.id;
          chip.className = `neighbor-chip ${a.att}${selected ? " selected" : ""}`;
          chip.textContent = `${ATT_ICON[a.att]} ${a.name}`;
```

and after `chip.title = lines.join("\n");` add:

```ts
          // direct-manipulation diplomacy (Total War): click the realm to propose peace —
          // select-only (the advance button executes); clicking again cancels; truced = renewal
          chip.addEventListener("click", () => {
            pendingAction = selected ? null : { type: "peace", polity: a.id };
            renderPending();
          });
```

(b) `renderActions`: DELETE the whole `pce` block (from `const pce = document.createElement("select");` through `pce.addEventListener("change", ...)` inclusive) and drop `pce` from the final `actions.append(investSeg, pce, pass, advance)` → `actions.append(investSeg, pass, advance)`.

(c) `summary()` peace branch:

```ts
              : pendingAction.type === "peace" ? ` — 🕊 ${s.polities[pendingAction.polity].name}`
```

(d) `src/ui/i18n.ts`: grep `peacePlaceholder|tipPeace|advPeace` — after (b)/(c) the only hits must be the table lines; delete all three keys from BOTH langs. Rewrite `howto2`:

en:
```ts
    howto2: "Each turn is a decade: change stance freely, then take ONE action — click the map to attack or build, click a neighbor chip to sue for peace (a 30-year truce; attacking them breaks it), or pick an invest button.",
```

ko:
```ts
    howto2: "한 턴은 10년: 태세는 언제든 무료로 바꾸고, 행동은 하나만 — 지도를 클릭해 공격·건설, 이웃 칩을 클릭해 화친(30년 불가침, 내가 공격하면 파기), 또는 투자 버튼을 고르세요.",
```

(e) `src/theme.css`: in the existing `.neighbor-chip` rule change `cursor: default` → `cursor: pointer`, and append:

```css
.neighbor-chip:hover { box-shadow: 0 0 0 2px rgba(201, 187, 150, 0.5); }
.neighbor-chip.selected { outline: 2px solid #5b83a6; }
```

- [ ] **Step 4: Run the playApp suite + full suite + typecheck**

Run: `npx vitest run src/ui/playApp.test.ts`, `npx vitest run`, `npx tsc --noEmit` — all green (advPeace removal would break tsc if any caller remained — the grep in (d) is the guard).

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): peace moves to the neighbor chips — click a realm to propose; dropdown removed"
```

---

### Task 2: Full verification (controller-run)

- [ ] **Step 1:** `npx vitest run` (~465 expected, trust actual) + `npm run build` clean.
- [ ] **Step 2:** Live: chip click → blue wash + `진행 ▶ — 🕊 {name}` + selected outline; re-click cancels; advance → 🤝 flip; command bar has no select; howto shows the new line; KO/EN; console clean.
- [ ] **Step 3:** Whole-branch final review → merge per finishing-a-development-branch; push awaits "push해".
