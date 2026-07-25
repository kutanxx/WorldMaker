# Army prototype — goal, defeat, horizon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the army prototype a reason to keep playing — a conquest target you race toward, a death condition, and a turn horizon that ends the game with a ranking.

**Architecture:** One pure engine function (`outcome`) plus the small helpers it and the HUD share, so the progress counter the player watches is computed from exactly what the victory test checks. The UI shows `목표 N/M` and, once `outcome` is non-null, replaces the controls with a result line and a `다시` button back to the nation picker.

**Tech Stack:** TypeScript, Vitest (node + jsdom).

## Global Constraints

- PROTOTYPE iteration. NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, or any pre-existing test outside `armySim.test.ts` / `armyApp.test.ts`.
- Engine stays pure and rng-free: no `Math.random()`, no `Date.now()`.
- Exact values: `GOAL_FRAC = 0.4`, `HORIZON = 50`. No other constant changes.
- `goalTarget(s) = Math.round(GOAL_FRAC * landProvinces(s))`, and `outcome` MUST compare against that same helper — no second formula.
- `outcome` order is fixed: defeat (zero provinces) → victory (>= goalTarget) → horizon (`s.turn >= HORIZON`) → `null`.
- Ranking counts only nations that still hold land; ties break on lower polity id.
- UI strings are plain Korean. Existing behaviours must not regress: nation picker, `시드 N` in the HUD, panel-issued marches (`button.army-move[data-target]`), `이미 이동함` on a spent army, levy button disabled at 0.
- `tsc --noEmit` must stay clean (`noUnusedLocals` is on — no unused imports).
- Run tests from the worktree root: `npx vitest run <file>`.

---

### Task 1: Outcome model in the engine

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `ArmyState` (`owner: Int32Array`, `n`, `turn`).
- Produces:
  - `export const GOAL_FRAC = 0.4`, `export const HORIZON = 50`
  - `export function landProvinces(s: ArmyState): number`
  - `export function goalTarget(s: ArmyState): number`
  - `export function provinceCount(s: ArmyState, nation: number): number`
  - `export function nationRank(s: ArmyState, nation: number): { rank: number; of: number }`
  - `export type Outcome = { kind: "defeat" } | { kind: "victory" } | { kind: "horizon"; rank: number; of: number } | null`
  - `export function outcome(s: ArmyState, nation: number): Outcome`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add the new names to the EXISTING `./armySim` import line):

```typescript
describe("goal / outcome (a reason to keep playing)", () => {
  const fresh = () => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world);

  it("goalTarget is round(GOAL_FRAC x land) and land counts ownable provinces", () => {
    const s = fresh();
    expect(landProvinces(s)).toBeGreaterThan(0);
    expect(landProvinces(s)).toBeLessThanOrEqual(s.n);
    expect(goalTarget(s)).toBe(Math.round(GOAL_FRAC * landProvinces(s)));
  });

  it("returns null mid-game", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    expect(outcome(s, me)).toBeNull();
  });

  it("is defeat at zero provinces — even past the horizon (order matters)", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    for (let p = 0; p < s.n; p++) if (s.owner[p] === me) s.owner[p] = me === 0 ? 1 : 0;
    s.turn = HORIZON + 5;
    expect(outcome(s, me)).toEqual({ kind: "defeat" });
  });

  it("is victory at exactly the target, and not one below it", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const other = me === 0 ? 1 : 0;
    const land = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0);
    const target = goalTarget(s);
    for (const p of land) s.owner[p] = other;            // wipe the board to a rival
    for (const p of land.slice(0, target - 1)) s.owner[p] = me;
    expect(outcome(s, me)).toBeNull();                    // one short
    s.owner[land[target - 1]] = me;
    expect(outcome(s, me)).toEqual({ kind: "victory" });
  });

  it("ends at the horizon with a rank among surviving nations", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    s.turn = HORIZON;
    const r = outcome(s, me);
    expect(r && r.kind).toBe("horizon");
    if (r && r.kind === "horizon") {
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.rank).toBeLessThanOrEqual(r.of);
      expect(r.of).toBe(nationRank(s, me).of);
    }
  });

  it("nationRank ranks by province count, ties to the lower id, counting only living nations", () => {
    const s = fresh();
    const a = 0, b = 1;
    for (let p = 0; p < s.n; p++) if (s.owner[p] >= 0) s.owner[p] = -1 as unknown as number; // clear owners
    // rebuild a tiny world: nation a holds 3, nation b holds 5
    const land = [...Array(s.n).keys()].slice(0, 8);
    for (const p of land.slice(0, 3)) s.owner[p] = a;
    for (const p of land.slice(3, 8)) s.owner[p] = b;
    expect(provinceCount(s, a)).toBe(3);
    expect(provinceCount(s, b)).toBe(5);
    expect(nationRank(s, b)).toEqual({ rank: 1, of: 2 });
    expect(nationRank(s, a)).toEqual({ rank: 2, of: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "goal / outcome"`
Expected: FAIL — `outcome is not defined`.

- [ ] **Step 3: Write the implementation**

Append to `src/engine/armySim.ts`:

```typescript
// --- goal: what you are racing toward, and how a game ends ---
export const GOAL_FRAC = 0.4;   // conquer this share of the world's land to win (8 nations => 12.5% is average)
export const HORIZON = 50;      // the game ends here and ranks you — a real ending, not a soft stop

// provinces that can be owned at all (the denominator the goal is a fraction of)
export function landProvinces(s: ArmyState): number {
  let k = 0;
  for (let p = 0; p < s.n; p++) if (s.basePop[p] > 0 || s.owner[p] >= 0) k++;
  return k;
}

// the number the HUD shows AND the number victory is tested against — one source, so they cannot drift.
export function goalTarget(s: ArmyState): number {
  return Math.round(GOAL_FRAC * landProvinces(s));
}

export function provinceCount(s: ArmyState, nation: number): number {
  let k = 0;
  for (let p = 0; p < s.n; p++) if (s.owner[p] === nation) k++;
  return k;
}

// standing among nations that still hold land; ties -> lower polity id ranks first.
export function nationRank(s: ArmyState, nation: number): { rank: number; of: number } {
  const alive: { id: number; k: number }[] = [];
  const seen = new Set<number>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o >= 0 && !seen.has(o)) { seen.add(o); alive.push({ id: o, k: provinceCount(s, o) }); }
  }
  alive.sort((a, b) => b.k - a.k || a.id - b.id);
  const idx = alive.findIndex((x) => x.id === nation);
  return { rank: idx < 0 ? alive.length + 1 : idx + 1, of: alive.length };
}

export type Outcome =
  | { kind: "defeat" }
  | { kind: "victory" }
  | { kind: "horizon"; rank: number; of: number }
  | null;

// Checked before the player acts each turn, in this order: death first (it outranks everything),
// then the conquest goal, then the horizon.
export function outcome(s: ArmyState, nation: number): Outcome {
  const mine = provinceCount(s, nation);
  if (mine === 0) return { kind: "defeat" };
  if (mine >= goalTarget(s)) return { kind: "victory" };
  if (s.turn >= HORIZON) { const { rank, of } = nationRank(s, nation); return { kind: "horizon", rank, of }; }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): conquest goal, defeat and a turn horizon that ranks you"
```

---

### Task 2: Show the goal and end the game

**Files:**
- Modify: `src/ui/armyApp.ts`
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `outcome`, `goalTarget`, `provinceCount`, `type Outcome` (Task 1).
- Produces (DOM contract): the HUD contains `목표 N/M`; when the game is over the app renders `.army-over` with the result line and `button.army-restart`, and renders NO `button.army-end` and no `.army-sel` panel.

- [ ] **Step 1: Write the failing jsdom tests**

Append to `src/ui/armyApp.test.ts` (reuse the existing `pickNation()` helper in that file):

```typescript
describe("goal and game over", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows goal progress in the HUD once a game starts", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const hud = root.querySelector(".army-hud")!.textContent!;
    expect(hud).toMatch(/목표 \d+\/\d+/);
  });

  it("ends the game and offers a restart back to the picker", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    // end turns until the horizon is reached (HORIZON is 50)
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".army-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/승리|패배|종료/);
    expect(root.querySelector("button.army-end")).toBeNull();   // no more turns
    expect(root.querySelector(".army-sel")).toBeNull();         // no more orders

    (root.querySelector("button.army-restart") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-pick")).toBeTruthy();      // back to the nation picker
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/armyApp.test.ts -t "goal and game over"`
Expected: FAIL — no `목표` in the HUD.

- [ ] **Step 3: Add the goal counter to the HUD**

In `src/ui/armyApp.ts`, import `outcome, goalTarget, provinceCount` (and the `Outcome` type) from `../engine/armySim`, then extend the HUD text in `render()`'s play branch — keep every existing field and add the goal:

```typescript
    hud.textContent = `턴 ${s.turn} · 시드 ${seed} · ${world.polities[me]?.name ?? ""} · 영토 ${myProv()} · 목표 ${provinceCount(s, me)}/${goalTarget(s)} · 인구 ${Math.round(myPop())} · 병력 ${myMen()}`;
```

(If the existing HUD line differs in wording, keep its existing fields verbatim and insert only the `· 목표 N/M` segment.)

- [ ] **Step 4: Render the end screen and stop accepting orders**

Still in `render()`'s play branch, immediately after appending the HUD and the map, check the outcome and return early:

```typescript
    const oc: Outcome = outcome(s, me);
    if (oc) {
      const over = document.createElement("div");
      over.className = "army-over";
      over.textContent =
        oc.kind === "defeat" ? "패배 — 모든 영토를 잃었습니다"
        : oc.kind === "victory" ? `승리 — 세계의 ${Math.round(GOAL_FRAC * 100)}%를 정복했습니다`
        : `${HORIZON}턴 종료 — ${oc.rank}위 / ${oc.of}`;
      root.appendChild(over);
      const again = document.createElement("button");
      again.className = "army-restart";
      again.textContent = "다시";
      again.addEventListener("click", () => { player = null; sel = null; log.length = 0; render(); });
      root.appendChild(again);
      root.appendChild(logEl());   // keep the chronicle visible; use whatever the file already calls it
      return;                       // no panel, no end-turn button — the game is over
    }
```

Import `GOAL_FRAC` and `HORIZON` alongside the other engine imports so the copy cannot drift from the rules. If the file has no `logEl()` helper, append the existing log element the same way the play branch already does.

- [ ] **Step 5: Add CSS**

Append to `src/theme.css`:

```css
.army-over { font-size: 17px; padding: 10px 2px; color: #3c2f1c; text-align: center; }
.army-restart { margin: 4px 0; }
```

- [ ] **Step 6: Run the UI tests, the full suite and tsc**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: PASS. Pre-existing tests that end turns must still pass — if one now runs past the horizon and loses its end-turn button, adjust only that test's turn count, never its assertions.

Run: `npx vitest run` — full suite green.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts src/theme.css
git commit -m "feat(playArmy): goal counter in the HUD and a real ending with restart"
```

---

### Task 3: Play it and report whether the goal changes how it feels

**Files:** none (verification only)

- [ ] **Step 1: Full suite + type-check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 2: Play with the goal in place**

Start the preview and open `/playArmy.html?seed=23` (the world every prior play-test used, so numbers compare).
Pick the same nation as before (the one with 18 provinces) and play toward the goal, recording:
- Was the goal reached, and on what turn? (Controller's best pre-goal run was 35/103 ≈ 34% by turn 25.)
- Does `목표 N/M` in the HUD always equal what the victory check does (it must — same helper)?
- Does the game actually END (end screen, no end-turn button) and does `다시` return to the picker?
- Play a losing game too (turtle) — does the horizon ranking read honestly?
- Console errors (expect none).

- [ ] **Step 3: Report the verdict and whether the constants need moving**

`GOAL_FRAC = 0.4` and `HORIZON = 50` were calibrated to bot runs, not human play. Say plainly whether
40% was trivial, unreachable, or a real race, and recommend a change if warranted. Record in the
backlog memory.

---

## Self-Review notes

- **Spec coverage:** `GOAL_FRAC`/`HORIZON` (T1) ✓; `landProvinces`/`goalTarget`/`provinceCount`/`nationRank` (T1) ✓; `outcome` with the fixed order defeat→victory→horizon→null (T1) ✓; the HUD counter computed from the same `goalTarget` the win check uses (T2) ✓; end screen with the three result lines and restart-to-picker (T2) ✓; orders refused once over (T2 early return) ✓; existing behaviours untouched (Global Constraints) ✓; play-test + constant recommendation (T3) ✓.
- **Type consistency:** `Outcome` is defined in T1 and consumed as `Outcome` in T2; `goalTarget(s)` and `provinceCount(s, nation)` keep the same signatures in both tasks.
- **Known risk called out for the implementer:** T2 Step 6 warns that a pre-existing UI test which ends many turns may now hit the horizon; the instruction is to adjust its turn count only, never its assertions.
