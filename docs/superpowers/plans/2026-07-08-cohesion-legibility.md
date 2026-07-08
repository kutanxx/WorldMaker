# Cohesion Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 결속/cohesion (and 국력/위협) legible to new players via an accurate always-visible consequence on the danger state plus hover tooltips on the standing labels.

**Architecture:** One task in the play UI. `renderPanel`'s `meterRow` gains a tooltip argument (sets `title` on the row + a `.hint` dotted-underline class on the label); the cohesion value appends a true "weakened" tag only at danger; the threat line gets a tooltip. New i18n keys + one CSS rule. No engine change → golden hashes byte-identical.

**Tech Stack:** TypeScript, Vite MPA, Vitest (jsdom), plain DOM.

## Global Constraints

- **Play-UI only.** Do NOT edit any engine file (`historySim.ts`, `intervention.ts`, `world.ts`, `dilemma.ts`, `standing.ts`, `playSim.ts`). No golden-hash impact.
- **Every user-facing string via `playT(lang, key)`** with BOTH `en` and `ko` entries. Glyphs (⚠ 💰) may be literal.
- **Consequence copy must stay accurate to the engine:** low cohesion = weaker in battle (all realms); civil war is large-realm-only (≥220 cells & avg<0.42). The inline danger tag says only the universally-true "weakened"; the civil-war detail lives in the tooltip.
- Run tests from THIS worktree with `npm test`. Baseline: **403 tests**.
- Dotted-underline subtlety is visual → the user eyeballs localhost; tests assert DOM (title attrs, classes, text) only.

---

### Task 1: Tooltips + label hints + accurate danger tag

**Files:**
- Modify: `src/ui/playApp.ts` (`meterRow` signature + its two call sites + the threat line + the cohesion value, all inside `renderPanel`)
- Modify: `src/ui/i18n.ts` (add `tipCohesion`, `tipStrength`, `tipThreat`, `cohWeak` to both `en` and `ko` play blocks)
- Modify: `src/theme.css` (add a `.hint` rule)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: existing `computeStanding` result `st` (has `cohesionState`), existing `playT`.
- Produces: `meterRow(cls, label, value, state, tooltip)` — a fifth `tooltip: string` argument. When non-empty, sets `row.title` and adds `hint` to the label's class.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts` inside `describe("playApp", ...)`:

```ts
  it("standing labels have explanatory tooltips + a hover hint, and no false danger tag when healthy", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const coh = root.querySelector(".meter-cohesion") as HTMLElement;
    const str = root.querySelector(".meter-strength") as HTMLElement;
    const threat = root.querySelector(".threat-line") as HTMLElement;
    // each standing row carries a non-empty explanatory tooltip
    expect(coh.title.length).toBeGreaterThan(0);
    expect(str.title.length).toBeGreaterThan(0);
    expect(threat.title.length).toBeGreaterThan(0);
    // the cohesion label invites hovering
    expect(coh.querySelector(".meter-label")!.classList.contains("hint")).toBe(true);
    // a fresh realm (cohesion ~50%, not danger) must NOT show the "weakened" consequence tag
    expect(coh.querySelector(".meter-value")!.textContent).not.toMatch(/약해짐|weakened/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `coh.title` is empty / `.meter-label` lacks `hint`.

- [ ] **Step 3: Add i18n keys**

In `src/ui/i18n.ts`, add to the **`en`** play block (near the other `tip*` keys):

```ts
    tipStrength: "Your territory (cell count) versus the average rival realm. Ahead = strong, behind = weak.",
    tipCohesion: "Low cohesion makes your realm weaker in battle, so you lose ground. A large realm with low cohesion can also split apart in civil war. Restore it with invest (💰) or the internal stance.",
    tipThreat: "The number of enemy realms bordering you. More means greater invasion pressure.",
    cohWeak: "weakened",
```

Add to the **`ko`** play block (near the other `tip*` keys):

```ts
    tipStrength: "내 영토(셀 수)를 이웃 세력 평균과 비교합니다. 앞서면 우세, 밀리면 열세.",
    tipCohesion: "결속이 낮으면 전투에서 약해져 땅을 잃기 쉽습니다. 나라가 크고 결속까지 낮으면 내란으로 분열될 수 있습니다. 투자(💰)나 내치 태세로 회복합니다.",
    tipThreat: "국경에 맞닿은 적국 수. 많을수록 침공 압박이 커집니다.",
    cohWeak: "약해짐",
```

- [ ] **Step 4: Extend `meterRow` and its call sites**

In `src/ui/playApp.ts`, change the `meterRow` helper (inside `renderPanel`'s enclosing scope) to accept a tooltip:

```ts
    function meterRow(cls: string, label: string, value: string, state: string, tooltip: string): HTMLElement {
      const row = document.createElement("div");
      row.className = `meter ${cls} ${state}`;
      if (tooltip) row.title = tooltip;
      const l = document.createElement("span");
      l.className = tooltip ? "meter-label hint" : "meter-label";
      l.textContent = label;
      const v = document.createElement("span"); v.className = "meter-value"; v.textContent = value;
      row.append(l, v);
      return row;
    }
```

In `renderPanel`, update the two `meterRow` calls to pass the tooltips, and append the danger consequence tag to the cohesion value. Replace the strength/cohesion meter block:

```ts
      meters.appendChild(meterRow("meter-strength", playT(lang, "strength"), strengthVal, st.strength, playT(lang, "tipStrength")));
      const cohWord = playT(lang,
        st.cohesionState === "stable" ? "solStable" : st.cohesionState === "shaky" ? "solShaky" : "solDanger");
      const warn = st.cohesionState === "danger" ? "⚠ " : "";
      // only the danger state gets an inline consequence, and only the universally-true one
      // (low cohesion = weaker in battle). Civil-war detail lives in the tooltip, since it is
      // large-realm-only (>=220 cells & avg<0.42) and would be false for small realms.
      const weakTag = st.cohesionState === "danger" ? ` · ${playT(lang, "cohWeak")}` : "";
      const cohVal = `${warn}${(st.cohesion * 100) | 0}% (${cohWord}${weakTag})`;
      meters.appendChild(meterRow("meter-cohesion", playT(lang, "cohesion"), cohVal, st.cohesionState, playT(lang, "tipCohesion")));
```

(This replaces the existing lines that build `cohWord`, `warn`, `cohVal` and append the two meter rows. The `strengthWord`/`strengthVal` lines just above stay unchanged.)

Then give the threat line a tooltip + hint. Replace the threat-line creation:

```ts
      const threat = document.createElement("div");
      threat.className = "threat-line hint";
      threat.title = playT(lang, "tipThreat");
      const truceStr = st.truceCount > 0 ? ` · ${playT(lang, "truce")} ${st.truceCount}` : "";
      threat.textContent = `${playT(lang, "border")} ${st.borderPolities}${truceStr}`;
      panel.appendChild(threat);
```

- [ ] **Step 5: Add the `.hint` CSS**

In `src/theme.css`, near the standing-panel rules, add:

```css
.hint { text-decoration: underline dotted #9a8a70; text-underline-offset: 3px; cursor: help; }
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS (new test + existing green).
Run: `npm test` → all pass (**404 tests** = 403 + 1 new), no golden regressions.
Run: `npx tsc --noEmit` → clean. Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): cohesion legibility — hover tooltips on standing labels + accurate danger tag"
```

Manual check (user): hovering 결속/국력/위협 shows a plain-language explanation; the labels carry a dotted underline hint; at low cohesion the meter reads `⚠ … (위험 · 약해짐)`.

---

## Self-Review

**1. Spec coverage:**
- D inline consequence, only on danger, universally-true "weakened" → Step 4 `weakTag`. ✓
- A tooltips on 결속/국력/위협 + dotted-underline hint, no "?" pip → Step 4 `meterRow` tooltip + threat title + `.hint` class, Step 5 CSS. ✓
- Accurate copy (civil war = large-realm-only, in tooltip not inline) → Step 3 `tipCohesion` + Step 4 comment. ✓
- Play-UI only / goldens intact → Global Constraints, no engine edits. ✓
- Rejected rename / "?" pip / first-encounter popup → not present. ✓

**2. Placeholder scan:** No TBD/TODO. All copy, code, and CSS are complete.

**3. Type consistency:** `meterRow` fifth param `tooltip: string` is passed at both call sites (`playT(lang,"tipStrength")`, `playT(lang,"tipCohesion")`). i18n keys added (`tipStrength`, `tipCohesion`, `tipThreat`, `cohWeak`) are exactly the keys `renderPanel` passes to `playT`. `.hint`/`.meter-label`/`.meter-cohesion`/`.meter-strength`/`.threat-line` are the classes the test queries. `st.cohesionState` values (`stable`/`shaky`/`danger`) match the `Standing` type from `standing.ts`.
