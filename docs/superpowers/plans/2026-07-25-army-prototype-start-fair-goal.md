# Army prototype — start-fair goal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make victory measure what you conquered rather than what you hold, so a 3-province nation and an 18-province nation face the same finish line.

**Architecture:** Replace the absolute `GOAL_FRAC`/`goalTarget` with an additive `GOAL_GAIN_FRAC`/`goalGain`, and thread the player's starting province count through `outcome`. The HUD renders `goalProgress`, the same helper the victory test uses, so the counter can never disagree with the win.

**Tech Stack:** TypeScript, Vitest (node + jsdom).

## Global Constraints

- PROTOTYPE iteration. NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, or any pre-existing test outside `armySim.test.ts` / `armyApp.test.ts`.
- Engine pure and rng-free: no `Math.random()`, no `Date.now()`.
- Exact value: `GOAL_GAIN_FRAC = 0.2`. `GOAL_FRAC` and `goalTarget` are REMOVED (this replaces them, it does not sit alongside them). `HORIZON = 50` is unchanged, as are all balance constants.
- `goalGain(s) = Math.round(GOAL_GAIN_FRAC * landProvinces(s))`; victory iff `provinceCount(s, nation) - startProv >= goalGain(s)`.
- `outcome` order stays fixed: defeat (zero provinces) → victory → horizon (`turn >= HORIZON`) → `null`.
- `gained` is reported even when NEGATIVE — never clamp it. A shrinking realm is the state the player most needs to see.
- UI strings plain Korean. The victory line derives its percentage from `GOAL_GAIN_FRAC`, never hardcoded.
- Existing behaviours must not regress: nation picker, `시드 N` in the HUD, panel-issued marches, `이미 이동함` + disabled buttons on a spent army, levy disabled at 0, click-own-province-selects, end screen with `다시` returning to a genuinely fresh game.
- `tsc --noEmit` must stay clean (`noUnusedLocals` is on).
- Run tests from the worktree root: `npx vitest run <file>`.

---

### Task 1: Additive goal in the engine

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Removes: `GOAL_FRAC`, `goalTarget`.
- Produces:
  - `export const GOAL_GAIN_FRAC = 0.2`
  - `export function goalGain(s: ArmyState): number`
  - `export function goalProgress(s: ArmyState, nation: number, startProv: number): { gained: number; goal: number }`
  - `export function outcome(s: ArmyState, nation: number, startProv: number): Outcome` (gains a third parameter)
- Unchanged: `landProvinces`, `provinceCount`, `nationRank`, `HORIZON`, `type Outcome`.

- [ ] **Step 1: Write the failing tests**

In `src/engine/armySim.test.ts`, REPLACE the existing `describe("goal / outcome (a reason to keep playing)")` block with the version below (the old block tests `goalTarget`, which no longer exists). Update the `./armySim` import line: drop `GOAL_FRAC` and `goalTarget`, add `GOAL_GAIN_FRAC`, `goalGain`, `goalProgress`.

```typescript
describe("goal / outcome (start-fair: you must CONQUER, not merely hold)", () => {
  const fresh = () => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world);

  it("goalGain is round(GOAL_GAIN_FRAC x land)", () => {
    const s = fresh();
    expect(goalGain(s)).toBe(Math.round(GOAL_GAIN_FRAC * landProvinces(s)));
    expect(goalGain(s)).toBeGreaterThan(0);
  });

  it("nobody wins at t0, whatever their size — gain is 0 for every start", () => {
    const s = fresh();
    const counts = new Map<number, number>();
    for (let p = 0; p < s.n; p++) if (s.owner[p] >= 0) counts.set(s.owner[p], (counts.get(s.owner[p]) ?? 0) + 1);
    const sizes = [...counts].sort((a, b) => a[1] - b[1]);
    const smallest = sizes[0], largest = sizes[sizes.length - 1];
    expect(outcome(s, smallest[0], smallest[1])).toBeNull();
    expect(outcome(s, largest[0], largest[1])).toBeNull();   // a big start cannot win instantly
  });

  it("needs the full gain: one short is not a win, exactly the gain is", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const other = me === 0 ? 1 : 0;
    const land = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0);
    const start = 2;
    const need = goalGain(s);
    for (const p of land) s.owner[p] = other;
    for (const p of land.slice(0, start + need - 1)) s.owner[p] = me;
    expect(outcome(s, me, start)).toBeNull();
    s.owner[land[start + need - 1]] = me;
    expect(outcome(s, me, start)).toEqual({ kind: "victory" });
  });

  it("the same finish line for a small and a large start (start-fair)", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const need = goalGain(s);
    expect(goalProgress(s, me, 3).goal).toBe(need);
    expect(goalProgress(s, me, 18).goal).toBe(need);   // identical requirement
  });

  it("reports a NEGATIVE gain when the realm shrinks below its start", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    const held = provinceCount(s, me);
    const prog = goalProgress(s, me, held + 4);
    expect(prog.gained).toBe(-4);
  });

  it("defeat still outranks victory and the horizon", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    for (let p = 0; p < s.n; p++) if (s.owner[p] === me) s.owner[p] = me === 0 ? 1 : 0;
    s.turn = HORIZON + 5;
    expect(outcome(s, me, 1)).toEqual({ kind: "defeat" });
  });

  it("ends at the horizon with a rank", () => {
    const s = fresh();
    const me = [...s.owner].find((o) => o >= 0)!;
    s.turn = HORIZON;
    const r = outcome(s, me, provinceCount(s, me));
    expect(r && r.kind).toBe("horizon");
    if (r && r.kind === "horizon") expect(r.of).toBe(nationRank(s, me).of);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "start-fair"`
Expected: FAIL — `goalGain is not defined`.

- [ ] **Step 3: Write the implementation**

In `src/engine/armySim.ts`, DELETE `GOAL_FRAC` and `goalTarget`, and replace them with:

```typescript
// Victory is measured by what you CONQUERED, not by what you happen to hold. Additive so it is
// start-fair: a 3-province realm and an 18-province realm must both take the same absolute number of
// provinces, a big start never wins at t0 (gain is 0), and a small start cannot win by grabbing two
// neighbours. (The province game learned this same lesson; an absolute threshold favours big starts.)
export const GOAL_GAIN_FRAC = 0.2;

export function goalGain(s: ArmyState): number {
  return Math.round(GOAL_GAIN_FRAC * landProvinces(s));
}

// what the HUD shows AND what victory is tested against — one source, so they cannot drift.
// `gained` is deliberately NOT clamped: a realm below its start is the losing state to surface.
export function goalProgress(s: ArmyState, nation: number, startProv: number): { gained: number; goal: number } {
  return { gained: provinceCount(s, nation) - startProv, goal: goalGain(s) };
}
```

Then change `outcome` to take the start count and use `goalProgress`:

```typescript
export function outcome(s: ArmyState, nation: number, startProv: number): Outcome {
  if (provinceCount(s, nation) === 0) return { kind: "defeat" };
  const { gained, goal } = goalProgress(s, nation, startProv);
  if (gained >= goal) return { kind: "victory" };
  if (s.turn >= HORIZON) { const { rank, of } = nationRank(s, nation); return { kind: "horizon", rank, of }; }
  return null;
}
```

- [ ] **Step 4: Run the engine suite**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS. `src/ui/armyApp.ts` will now fail to type-check until Task 2 — that is expected; do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): start-fair goal — you must conquer a fixed share, not merely hold one"
```

---

### Task 2: Thread the start count through the UI

**Files:**
- Modify: `src/ui/armyApp.ts`
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `GOAL_GAIN_FRAC`, `goalGain`, `goalProgress`, `outcome(s, nation, startProv)`, `HORIZON`.
- Produces (DOM contract): the HUD contains `정복 +N/M` (signed, may be negative); everything else unchanged.

- [ ] **Step 1: Write the failing jsdom tests**

Append to `src/ui/armyApp.test.ts` (reuse the existing `pickNation()` helper):

```typescript
describe("start-fair goal in the HUD", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows a signed conquest counter, starting at +0", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    expect(root.querySelector(".army-hud")!.textContent).toMatch(/정복 \+0\/\d+/);
  });

  it("re-reads the start count after a restart with a different nation", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    // end turns until the game is over, then restart and pick again
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    (root.querySelector("button.army-restart") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    pickNation();
    // a fresh game: turn 0 and a zero gain again
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 0");
    expect(root.querySelector(".army-hud")!.textContent).toMatch(/정복 \+0\/\d+/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/armyApp.test.ts -t "start-fair goal"`
Expected: FAIL — the HUD still says `목표`, and/or `tsc` errors on `outcome`'s arity.

- [ ] **Step 3: Wire the start count through**

In `src/ui/armyApp.ts`:

1. Add a module-scope variable next to the existing `player` / `sel` state:

```typescript
  let startProv = 0;   // provinces held the moment this nation was picked — the goal is measured from here
```

2. In `startGame(nation)`, record it right after setting `player`:

```typescript
      startProv = provinceCount(s, nation);
```

(`provinceCount` must be imported from `../engine/armySim`.)

3. In the restart handler, reset it alongside the rest (it is re-recorded on the next pick, but reset it so no stale value can leak):

```typescript
      startProv = 0;
```

4. Replace the HUD's `목표 N/M` segment with the signed conquest counter, keeping every other field verbatim:

```typescript
    const prog = goalProgress(s, me, startProv);
    const gainStr = `${prog.gained >= 0 ? "+" : ""}${prog.gained}`;
```

and use `· 정복 ${gainStr}/${prog.goal}` where `· 목표 …` used to be.

5. Update the `outcome` call to pass the start count: `const oc: Outcome = outcome(s, me, startProv);`

6. Update the victory line to derive its percentage from the new constant:

```typescript
        : oc.kind === "victory" ? `승리 — 세계의 ${Math.round(GOAL_GAIN_FRAC * 100)}%를 새로 정복했습니다`
```

Update the engine import list: drop `GOAL_FRAC`/`goalTarget`, add `GOAL_GAIN_FRAC`, `goalProgress`, `provinceCount`. `tsc` must end clean with no unused imports.

- [ ] **Step 4: Run the UI tests, the full suite and tsc**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: PASS. Any pre-existing test asserting `목표` must be updated to the new counter — change only the expected string, never what the test is checking.

Run: `npx vitest run` — full suite green.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts
git commit -m "feat(playArmy): signed conquest counter measured from your starting size"
```

---

### Task 3: Play both ends and confirm the finish line is fair

**Files:** none (verification only)

- [ ] **Step 1: Full suite + type-check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: green and clean.

- [ ] **Step 2: Play the same two nations on the same world**

Open `/playArmy.html?seed=23` (103 land provinces, so the goal should be ~+21) and play BOTH:
- the 18-province nation (Muvalais) — previously won at turn 22 under the absolute goal
- the 3-province nation (Saaandhia) — previously ended 22/41, unable to win

Record for each: the goal shown at t0 (must be identical for both), whether victory was reached and on
what turn, and the final outcome line. Confirm the HUD counter goes negative if a realm shrinks.

- [ ] **Step 3: Report and recommend**

State plainly whether the finish line is now the same for both starts, whether the large start still
wins much earlier (expected — it has more population, and that is an advantage, not unfairness), and
whether `GOAL_GAIN_FRAC = 0.2` should move. Record in the backlog memory.

---

## Self-Review notes

- **Spec coverage:** `GOAL_GAIN_FRAC` replacing `GOAL_FRAC` (T1) ✓; `goalGain`/`goalProgress` (T1) ✓; `outcome` gains the start parameter and keeps its order (T1) ✓; 0-gain at t0 for any size (T1 test) ✓; negative gain unclamped (T1 test + T2 HUD sign) ✓; start count recorded at pick and reset on restart (T2) ✓; HUD shows the same helper the win uses (T2) ✓; victory copy derived from the constant (T2) ✓; both-ends play-test (T3) ✓.
- **Type consistency:** `goalProgress(s, nation, startProv)` and `outcome(s, nation, startProv)` keep identical signatures across both tasks; `Outcome` unchanged.
- **Deliberate breakage:** Task 1 leaves `armyApp.ts` failing to type-check until Task 2 lands, because `outcome`'s arity changes. This is called out in T1 Step 4 so the implementer does not "fix" it out of scope. The suite is only required to be fully green at the end of Task 2.
