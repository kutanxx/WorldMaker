# Province play P4c — size-as-playstyle framing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a large starting realm read as a *harder, defensive* game (not a stronger one) through display-only framing — a size tier helper, tier-aware objective + end-screen copy, and static picker cues — closing P4c with no engine lever.

**Architecture:** Pure helpers in `src/ui/provinceApp.ts` (`startTier`, `recommendedStarter`, `objectiveHint`, `survivalEndText`, `survivalEarned`) select copy/markers from the player's start size relative to the world's land. The picker gains a static legend line and always-visible `⚠`/`⭐` markers (a picker-only SVG overlay). Nothing in `src/engine/**`, `politicalLayer`, or any golden changes.

**Tech Stack:** TypeScript, Vitest (`jsdom` for DOM smoke tests), inline SVG via `svgEl`.

## Global Constraints

- Display-only. NO change to `src/engine/**`, NO change to `politicalLayer`, NO golden re-pin.
- Strings use the surrounding inline `lang === "ko" ? … : …` pattern in `provinceApp.ts` (NOT `i18n.ts`).
- Win-condition math (`isDomination`, `survivalGrade` thresholds) is unchanged; helpers select TEXT only.
- Tier cutoffs, relative to this world's land count: `small` if `start <= round(0.08 * land)`, `large` if `start >= round(0.18 * land)`, else `mid`.
- Picker cues are static and always-visible (no hover, no tap-to-arm) so mobile is untouched.
- Markers mark the extremes only: every alive `large` nation → `⚠`; exactly one deterministic `recommendedStarter` → `⭐`; `mid` nations unmarked.
- Picker legend line (verbatim):
  - ko: `⭐ 추천 · ⚠ 생존전 — 큰 나라는 강해 보여도 넓은 국경은 지키기 어려워요`
  - en: `⭐ Recommended · ⚠ Survival — a big realm looks strong, but wide borders are hard to hold`
- Run tests from the worktree root with `npx vitest run <file>`.

---

### Task 1: `startTier` pure helper

**Files:**
- Modify: `src/ui/provinceApp.ts` (add exported helper near `survivalGrade`, ~line 57)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Produces: `export type StartTier = "small" | "mid" | "large"` and `export function startTier(start: number, land: number): StartTier`

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/provinceApp.test.ts` (after the `survivalGrade` describe block). Update the import at the top of the file to add `startTier` to the existing `./provinceApp` import list.

```typescript
describe("startTier (start size relative to the world's land)", () => {
  const LAND = 102; // round(0.08*102)=8, round(0.18*102)=18
  it("classifies small / mid / large at the relative cutoffs", () => {
    expect(startTier(8, LAND)).toBe("small");   // <= round(0.08*land)
    expect(startTier(9, LAND)).toBe("mid");     // just above small
    expect(startTier(17, LAND)).toBe("mid");    // the 16-17 band folds into mid
    expect(startTier(18, LAND)).toBe("large");  // >= round(0.18*land)
    expect(startTier(30, LAND)).toBe("large");
  });
  it("is relative, so cutoffs scale with a smaller map", () => {
    const SMALL_LAND = 50; // round(0.08*50)=4, round(0.18*50)=9
    expect(startTier(4, SMALL_LAND)).toBe("small");
    expect(startTier(5, SMALL_LAND)).toBe("mid");
    expect(startTier(9, SMALL_LAND)).toBe("large");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "startTier"`
Expected: FAIL — `startTier is not exported` / `startTier is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/ui/provinceApp.ts` just below `survivalGrade` (around line 57):

```typescript
// The player's STARTING size decides which game they are playing, expressed relative to this world's
// land so it is robust to map size. small = expansion (favoured), large = survival (wide borders are
// hard to hold), mid = balanced. Measured cutoffs (P4c sweep): small <=8, large >=18 on the ~100-map.
// This selects framing TEXT only — the win-condition math (isDomination, survivalGrade) is untouched.
export type StartTier = "small" | "mid" | "large";
export function startTier(start: number, land: number): StartTier {
  if (start <= Math.round(0.08 * land)) return "small";
  if (start >= Math.round(0.18 * land)) return "large";
  return "mid";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "startTier"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): startTier helper — classify start size as small/mid/large"
```

---

### Task 2: Tier-aware objective line

**Files:**
- Modify: `src/ui/provinceApp.ts` (add `objectiveHint`; wire into `buildHeader`, ~lines 641-644)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `startTier`, `StartTier` (Task 1)
- Produces: `export function objectiveHint(name: string, tier: StartTier, lang: "ko" | "en"): string`

- [ ] **Step 1: Write the failing tests**

Add `objectiveHint` to the `./provinceApp` import list in the test file, then add:

```typescript
describe("objectiveHint (tier-aware objective line)", () => {
  it("tags each tier and keeps the nation name", () => {
    expect(objectiveHint("Aror", "small", "ko")).toContain("Aror");
    expect(objectiveHint("Aror", "small", "ko")).toContain("팽창전");
    expect(objectiveHint("Aror", "mid", "ko")).toContain("균형");
    expect(objectiveHint("Aror", "large", "ko")).toContain("생존전");
  });
  it("never claims a large start CANNOT dominate — only that it is hard", () => {
    expect(objectiveHint("Aror", "large", "ko")).toContain("15%"); // conquest still offered
    expect(objectiveHint("Aror", "large", "en")).toMatch(/15%/);
  });
  it("tags tiers in English too", () => {
    expect(objectiveHint("Aror", "small", "en")).toContain("expansion");
    expect(objectiveHint("Aror", "large", "en")).toContain("survival");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "objectiveHint"`
Expected: FAIL — `objectiveHint is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/ui/provinceApp.ts` just below `startTier`:

```typescript
// the started-game objective line, reframed by start tier: the WIN CONDITIONS are identical for every
// tier (dominate 15% OR survive 50 turns) — only the emphasis is reordered, and a large start is never
// told it cannot dominate (the sweep shows it still does 3-6%), just that it is hard.
export function objectiveHint(name: string, tier: StartTier, lang: "ko" | "en"): string {
  if (lang === "ko") {
    if (tier === "small") return `${name} · 팽창전 — 세계의 15%를 새로 정복하거나 50턴 생존`;
    if (tier === "mid") return `${name} · 균형 — 15% 정복 또는 50턴 생존`;
    return `${name} · 생존전 — 50턴 버텨 왕조를 지키세요 (15% 정복도 가능하나 벅참)`;
  }
  if (tier === "small") return `${name} · expansion — conquer 15% of the world, or survive 50 turns`;
  if (tier === "mid") return `${name} · balanced — conquer 15%, or survive 50 turns`;
  return `${name} · survival — hold your borders for 50 turns (15% conquest possible but hard)`;
}
```

- [ ] **Step 4: Wire it into `buildHeader`**

In `src/ui/provinceApp.ts`, replace the `ui ?` branch of the `hint.textContent =` assignment (currently lines ~641-644):

```typescript
    hint.textContent = ui
      ? (lang === "ko"
          ? `${ui.world.polities[ui.playerId]?.name ?? ""} — 세계의 15%를 새로 정복하거나 50턴 생존`
          : `${ui.world.polities[ui.playerId]?.name ?? ""} — conquer 15% of the world, or survive 50 turns`)
      : (lang === "ko"
```

with:

```typescript
    hint.textContent = ui
      ? objectiveHint(
          ui.world.polities[ui.playerId]?.name ?? "",
          startTier(ui.startProvinces, ui.s.n),
          lang,
        )
      : (lang === "ko"
```

(Leave the picker branch — the `"지도에서 나라를 클릭…"` / `"Click a nation…"` lines — unchanged in this task.)

- [ ] **Step 5: Write the jsdom smoke test (hint differs by tier)**

Add to `src/ui/provinceApp.test.ts`. This starts two nations of different tiers on seed 1 and asserts the header hint reflects the tier. It computes each nation's tier from the engine so it is not brittle to the specific seed layout.

```typescript
describe("objective line reflects the chosen nation's start tier (jsdom)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows the survival framing for a large start and expansion/balanced for a smaller one", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initProvinceSim(world);
    const land = s.n;
    const startOf = (id: number) => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === id) k++; return k; };
    const large = world.polities.find((pl) => s.alive[pl.id] && startTier(startOf(pl.id), land) === "large");
    const smaller = world.polities.find((pl) => s.alive[pl.id] && startTier(startOf(pl.id), land) !== "large");
    expect(large).toBeTruthy(); expect(smaller).toBeTruthy();

    mountProvinceApp(root, { seed: 1 });
    (root.querySelector(`[data-polity="${large!.id}"]`) as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-hint")!.textContent).toContain("생존전");

    // remount and pick the smaller nation
    root.innerHTML = "";
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector(`[data-polity="${smaller!.id}"]`) as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-hint")!.textContent).not.toContain("생존전");
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "objectiveHint"` then
`npx vitest run src/ui/provinceApp.test.ts -t "objective line reflects"`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): tier-aware objective line (expansion/balanced/survival)"
```

---

### Task 3: Tier-aware survival end-screen text

**Files:**
- Modify: `src/ui/provinceApp.ts` (add `survivalEndText` + `survivalEarned`; wire into `render`, ~lines 668-672)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `startTier`, `StartTier` (Task 1)
- Produces:
  - `export function survivalEndText(tier: StartTier, grade: "great" | "grown" | "held", lang: "ko" | "en"): string`
  - `export function survivalEarned(tier: StartTier, grade: "great" | "grown" | "held"): boolean`

- [ ] **Step 1: Write the failing tests**

Add `survivalEndText, survivalEarned` to the `./provinceApp` import list, then:

```typescript
describe("survivalEndText / survivalEarned (large-start holding is an earned win)", () => {
  it("credits a large realm that merely held, but not a small one", () => {
    expect(survivalEndText("large", "held", "ko")).toContain("생존전 성공");
    expect(survivalEndText("small", "held", "ko")).toContain("겨우 버텨냈다");
    expect(survivalEarned("large", "held")).toBe(true);   // large + held = earned
    expect(survivalEarned("small", "held")).toBe(false);  // small + held = unremarkable turtle
  });
  it("leaves grown / great celebratory for every tier", () => {
    expect(survivalEarned("small", "grown")).toBe(true);
    expect(survivalEarned("small", "great")).toBe(true);
    expect(survivalEndText("small", "great", "ko")).toContain("강대국");
    expect(survivalEndText("large", "great", "ko")).toContain("강대국"); // unchanged by tier
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "survivalEndText"`
Expected: FAIL — `survivalEndText is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/ui/provinceApp.ts` below `objectiveHint`:

```typescript
// the survival end-screen text, reframed for exactly one cell: a LARGE start that merely HELD kept its
// sprawling borders alive, which is the intended achievement, so it reads as a win — while a small/mid
// hold stays the unremarkable turtle it is (they had room to grow). grown/great are already celebratory
// and are untouched for every tier.
export function survivalEndText(tier: StartTier, grade: "great" | "grown" | "held", lang: "ko" | "en"): string {
  if (grade === "great") return lang === "ko" ? "강대국 — 왕조가 크게 뻗어나갔다" : "A great power — your realm expanded mightily";
  if (grade === "grown") return lang === "ko" ? "생존 — 왕국을 넓히며 버텨냈다" : "Endured — you expanded and held on";
  if (tier === "large") return lang === "ko" ? "생존전 성공 — 넓은 제국을 끝까지 지켜냈다" : "Survival won — you held your sprawling realm to the end";
  return lang === "ko" ? "겨우 버텨냈다 — 영토는 그대로였다" : "Merely endured — you held your ground, no more";
}

// does this survival outcome earn the celebratory ".ok" styling? grown/great always do; a bare hold does
// only for a large start (holding wide borders was the game).
export function survivalEarned(tier: StartTier, grade: "great" | "grown" | "held"): boolean {
  return grade !== "held" || tier === "large";
}
```

- [ ] **Step 4: Wire it into `render` (the survival end-screen)**

In `src/ui/provinceApp.ts`, replace the survival-text + class block (currently lines ~668-672):

```typescript
        const grade = survivalGrade(playerProvinceCount(ui), ui.startProvinces, ui.s.n);
        const survivalText = grade === "great" ? (lang === "ko" ? "강대국 — 왕조가 크게 뻗어나갔다" : "A great power — your realm expanded mightily")
          : grade === "grown" ? (lang === "ko" ? "생존 — 왕국을 넓히며 버텨냈다" : "Endured — you expanded and held on")
          : (lang === "ko" ? "겨우 버텨냈다 — 영토는 그대로였다" : "Merely endured — you held your ground, no more");
        over.className = "prov-over" + (oc.kind === "domination" ? " win" : oc.kind === "survival" && grade !== "held" ? " ok" : "");
```

with:

```typescript
        const grade = survivalGrade(playerProvinceCount(ui), ui.startProvinces, ui.s.n);
        const tier = startTier(ui.startProvinces, ui.s.n);
        const survivalText = survivalEndText(tier, grade, lang);
        over.className = "prov-over" + (oc.kind === "domination" ? " win" : oc.kind === "survival" && survivalEarned(tier, grade) ? " ok" : "");
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "survivalEndText"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): credit a large realm's survival hold as an earned win"
```

---

### Task 4: `recommendedStarter` pure helper

**Files:**
- Modify: `src/ui/provinceApp.ts` (add exported helper below `startTier`)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `startTier` (Task 1), `ProvinceSimState` (already imported in the module)
- Produces: `export function recommendedStarter(s: ProvinceSimState, land: number): number` — the polity id to mark `⭐`.

- [ ] **Step 1: Write the failing tests**

Add `recommendedStarter` to the `./provinceApp` import list. Add `initProvinceSim` is already imported in the test file (it is). Then:

```typescript
describe("recommendedStarter (the deterministic ⭐ first-pick)", () => {
  it("is deterministic and picks a favoured small-tier nation on a fixed seed", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initProvinceSim(world);
    const a = recommendedStarter(s, s.n);
    const b = recommendedStarter(s, s.n);
    expect(a).toBe(b);                    // deterministic
    expect(s.alive[a]).toBe(true);        // a live nation
    const startOf = (id: number) => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === id) k++; return k; };
    // seed 1 has small-tier nations, so the pick must be small tier
    expect(startTier(startOf(a), s.n)).toBe("small");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "recommendedStarter"`
Expected: FAIL — `recommendedStarter is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/ui/provinceApp.ts` below `startTier`:

```typescript
// the single ⭐ "recommended" pick for the picker: among ALIVE nations, the LARGEST start that is still
// small-tier (favoured by the P4c sweep, but substantial rather than a fragile speck); if no small-tier
// nation exists, the smallest mid; final fallback the smallest alive start. Ties → lowest polity id.
// Deterministic, rng-free. `land` is the world's province count (s.n).
export function recommendedStarter(s: ProvinceSimState, land: number): number {
  const k = s.capitalProv.length;
  const starts: number[] = new Array(k).fill(0);
  for (let p = 0; p < s.n; p++) { const o = s.provOwner[p]; if (o >= 0 && o < k) starts[o]++; }
  let smallBest = -1, midBest = -1, anyBest = -1;
  for (let id = 0; id < k; id++) {
    if (!s.alive[id]) continue;
    const start = starts[id];
    if (anyBest < 0 || start < starts[anyBest]) anyBest = id;          // smallest alive (final fallback)
    const tier = startTier(start, land);
    if (tier === "small") { if (smallBest < 0 || start > starts[smallBest]) smallBest = id; } // largest small
    else if (tier === "mid") { if (midBest < 0 || start < starts[midBest]) midBest = id; }    // smallest mid
  }
  return smallBest >= 0 ? smallBest : midBest >= 0 ? midBest : anyBest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "recommendedStarter"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): recommendedStarter — deterministic first-pick for the picker star"
```

---

### Task 5: Picker before-pick cues (legend line + `⚠`/`⭐` map markers)

**Files:**
- Modify: `src/ui/provinceApp.ts` (legend in `buildHeader` picker branch; marker overlay in `buildMap` picker branch)
- Modify: `src/theme.css` (styles for `.prov-pick-legend`, `.prov-pick-mark`)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `startTier` (Task 1), `recommendedStarter` (Task 4), `svgEl` (already imported), `world.polities[id].capital` (cell index), `world.grid.points` (flat `[x0,y0,x1,y1,…]`).
- Produces (DOM contract the test relies on):
  - `.prov-pick-legend` — one element present only in picker mode, containing the legend copy.
  - `.prov-pick-mark` — SVG `<text>` markers present only in picker mode; each has `data-polity="<id>"` and `data-kind="warn"` (`⚠`, one per alive large nation) or `data-kind="star"` (`⭐`, exactly one, on `recommendedStarter`).

- [ ] **Step 1: Write the failing jsdom test**

Add to `src/ui/provinceApp.test.ts`:

```typescript
describe("picker before-pick cues (legend + static markers)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows a legend and marks every large nation ⚠ plus exactly one ⭐ recommended", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initProvinceSim(world);
    const land = s.n;
    const startOf = (id: number) => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === id) k++; return k; };
    const largeIds = world.polities.filter((pl) => s.alive[pl.id] && startTier(startOf(pl.id), land) === "large").map((pl) => pl.id);
    const rec = recommendedStarter(s, land);

    mountProvinceApp(root, { seed: 1 }); // stays in picker mode (no click)

    // legend present
    const legend = root.querySelector(".prov-pick-legend");
    expect(legend).toBeTruthy();
    expect(legend!.textContent).toContain("생존전");

    // exactly one star, on the recommended nation
    const stars = Array.from(root.querySelectorAll('.prov-pick-mark[data-kind="star"]'));
    expect(stars.length).toBe(1);
    expect(stars[0].getAttribute("data-polity")).toBe(String(rec));

    // a warn marker for every large nation, and no more
    const warns = Array.from(root.querySelectorAll('.prov-pick-mark[data-kind="warn"]'));
    expect(warns.map((w) => Number(w.getAttribute("data-polity"))).sort((a, b) => a - b))
      .toEqual(largeIds.slice().sort((a, b) => a - b));
  });

  it("removes the picker cues once a game starts", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-pick-legend")).toBeNull();
    expect(root.querySelector(".prov-pick-mark")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "picker before-pick cues"`
Expected: FAIL — no `.prov-pick-legend` / `.prov-pick-mark` in the DOM.

- [ ] **Step 3: Add the legend line in `buildHeader`**

In `src/ui/provinceApp.ts`, `buildHeader` currently ends with `h.append(home, title, hint); return h;`. Replace those two lines with:

```typescript
    h.append(home, title, hint);
    if (!ui) {
      const legend = document.createElement("div");
      legend.className = "prov-pick-legend";
      legend.textContent = lang === "ko"
        ? "⭐ 추천 · ⚠ 생존전 — 큰 나라는 강해 보여도 넓은 국경은 지키기 어려워요"
        : "⭐ Recommended · ⚠ Survival — a big realm looks strong, but wide borders are hard to hold";
      h.append(legend);
    }
    return h;
```

- [ ] **Step 4: Add the marker overlay in `buildMap`**

In `src/ui/provinceApp.ts`, `buildMap` ends by lifting the label groups and `return svg;`. Immediately BEFORE `return svg;` (after the `for (const cls of …)` loop), add the picker-only marker overlay. `s` is already in scope (the picker's `initProvinceSim(world)` from the top of `buildMap`):

```typescript
    // picker-only difficulty cues: static ⚠ on every large-tier nation and a single ⭐ recommended pick,
    // placed at each capital's cell point. Always-visible (no hover) so mobile is untouched; drawn last so
    // they sit above the borders/labels. politicalLayer is not modified.
    if (!ui) {
      const k = world.polities.length;
      const starts: number[] = new Array(k).fill(0);
      for (let p = 0; p < s.n; p++) { const o = s.provOwner[p]; if (o >= 0 && o < k) starts[o]++; }
      const rec = recommendedStarter(s, s.n);
      const marks = svgEl("g", { class: "prov-pick-marks" });
      for (const pol of world.polities) {
        if (!s.alive[pol.id]) continue;
        const isLarge = startTier(starts[pol.id], s.n) === "large";
        const isRec = pol.id === rec;
        if (!isLarge && !isRec) continue;
        const cap = pol.capital;
        const x = world.grid.points[cap * 2], y = world.grid.points[cap * 2 + 1];
        const glyph = isRec ? "⭐" : "⚠";
        const mark = svgEl("text", {
          class: "prov-pick-mark", "data-polity": String(pol.id), "data-kind": isRec ? "star" : "warn",
          x: String(x), y: String(y), "text-anchor": "middle", "dominant-baseline": "central",
        });
        mark.textContent = glyph;
        marks.appendChild(mark);
      }
      svg.appendChild(marks);
    }
    return svg;
```

- [ ] **Step 5: Add CSS**

In `src/theme.css`, after the `.prov-hint` rule (line ~351), add:

```css
.prov-pick-legend { width: 100%; text-align: center; color: #7a5a2f; font-size: 13px; margin-top: 3px; }
.prov-pick-mark { font-size: 15px; pointer-events: none; paint-order: stroke; stroke: #f6ecd2; stroke-width: 3px; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "picker before-pick cues"`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): picker legend + static ⚠/⭐ markers so first-timers see size=difficulty"
```

---

### Task 6: Full suite + live browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — all prior tests plus the new ones (~715+ tests). No golden or engine test changed.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Live-verify in the browser (per the harness verification workflow)**

Start the dev server preview for `playProvince.html`, then:
- Picker: confirm the legend line renders under the title, exactly one `⭐` shows on a smaller nation, and `⚠` shows on the visibly-large nations. Take a screenshot.
- Click the `⭐` nation → header hint shows `· 팽창전` (or `· 균형`); click a `⚠` nation on a fresh mount → hint shows `· 생존전 …(15% 정복도 가능하나 벅참)`.
- Check `read_console_messages` for errors (expect none).

- [ ] **Step 4: Commit any fixes from live verification** (only if the browser surfaced a real issue)

```bash
git add -A
git commit -m "fix(playProvince): P4c framing live-verification fixes"
```

---

## Self-Review notes

- **Spec coverage:** startTier (Task 1) ✓; touchpoint A legend+markers (Task 5) ✓; touchpoint B objective (Task 2) ✓; touchpoint C end-screen (Task 3) ✓; recommendedStarter (Task 4) ✓; politicalLayer/engine/golden untouched (Global Constraints + Task 5 overlay is a separate group) ✓; testing bullets map to Tasks 1-5 ✓.
- **Type consistency:** `StartTier` used identically in Tasks 1-5; `recommendedStarter(s, land): number` consumed in Task 5; `survivalEndText`/`survivalEarned` grade union matches `survivalGrade`'s return type.
- **No placeholders:** every code step shows full code; every run step shows the exact command + expected result.
