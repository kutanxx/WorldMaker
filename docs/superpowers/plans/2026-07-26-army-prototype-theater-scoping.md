# Army prototype — scope the game to the theater you can actually reach

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game's board exactly the land the player can act on — so unreachable islands stop inflating the victory target, stop showing numbers nobody can touch, and stop being offered as unplayable nations — while the world still *looks* whole.

**Architecture:** The province adjacency graph is split into land-connected components once per game. When a nation is picked, that nation's component becomes the "theater": land counting, the goal, and the ranking are all scoped to it. Provinces outside it stay painted (the world keeps its shape) but carry no numbers and are excluded from every count. Nations with no reachable rival are not offered.

**Tech Stack:** TypeScript, Vitest (node + jsdom).

## Why (measured, not assumed)

Across 10 worlds, **31% of all provinces (315/1015) are unreachable by land**, and **11 nations across those 10 worlds are completely stranded** — pick one and you press "end turn" 50 times with zero available actions (verified: all 18 adjacency rows read `(행군)`, no `공격` row at any odds threshold).

The dead land also silently inflates the victory target, because the goal is a fraction of *all* land:

| seed | provinces | unreachable | goal now | goal if scoped |
|---|---|---|---|---|
| 23 | 103 | 42 (41%) | 21 | **12** |
| 57 | 101 | 53 (52%) | 20 | **10** |
| 64 | 102 | 50 (49%) | 20 | **10** |
| 11 | 101 | 11 (11%) | 20 | 18 |

So on some maps the player is asked to conquer twice what the reachable board warrants.

## Global Constraints

- PROTOTYPE iteration. NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, `src/ui/politicalLayer.ts`, or any pre-existing test outside `armySim.test.ts` / `armyApp.test.ts`.
- Engine pure and rng-free: no `Math.random()`, no `Date.now()`.
- **Do NOT delete or hide land.** Out-of-theater provinces must still be painted exactly as they are today (owned ones in their nation's colour, unowned in the wilderness tone). Only their NUMBERS and their COUNTING change.
- No balance constant changes. `GOAL_GAIN_FRAC` stays `0.2`; the goal moves only because its denominator becomes the theater.
- Movement rules are untouched — land adjacency already makes cross-component movement impossible, so nothing about `moveArmy`/`defenceOf` changes.
- `tsc --noEmit` clean (`noUnusedLocals` is on).
- Run tests from the repo root: `npx vitest run <file>`.

---

### Task 1: Theater scoping in the engine

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- `ArmyState` gains an optional field: `scope?: Uint8Array` — `1` = province is in the current theater, `0` = out. Absent/undefined means "whole map" (the pre-scoping behaviour, so existing fixtures keep working).
- Produces:
  - `export function landComponents(s: ArmyState): Int32Array` — component id per province, from `s.adj`. Deterministic (scan provinces ascending, ids assigned in first-seen order).
  - `export function theaterOf(s: ArmyState, nation: number): Uint8Array` — the mask of provinces in the same component as any province that `nation` owns.
  - `export function setTheater(s: ArmyState, nation: number): void` — sets `s.scope = theaterOf(s, nation)`.
  - `export function playableNations(s: ArmyState): number[]` — nations whose component contains at least one OTHER nation (i.e. someone to fight), ascending.
- Changed behaviour (signatures unchanged): `landProvinces`, `provinceCount` and `nationRank` count only provinces where `s.scope` is 1 (or all, when `scope` is absent). `goalGain`/`goalProgress`/`outcome` therefore scale to the theater automatically.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add the new names to the existing `./armySim` import line):

```typescript
describe("theater scoping (the board is what you can reach)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("splits the map into land components, deterministically", () => {
    const s = fresh(23);
    const a = landComponents(s), b = landComponents(s);
    expect([...a]).toEqual([...b]);
    expect(a.length).toBe(s.n);
    // seed 23 is island-heavy: more than one component
    expect(new Set([...a]).size).toBeGreaterThan(1);
  });

  it("a theater contains the nation's own land and nothing from another component", () => {
    const s = fresh(23);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const comp = landComponents(s);
    const mask = theaterOf(s, nation);
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    const myComp = comp[mine[0]];
    for (let p = 0; p < s.n; p++) expect(mask[p] === 1).toBe(comp[p] === myComp);
    for (const p of mine) expect(mask[p]).toBe(1);
  });

  it("scoping shrinks the land count and therefore the goal", () => {
    const s = fresh(23);
    const wholeMap = landProvinces(s);
    const wholeGoal = goalGain(s);
    const nation = [...s.owner].find((o) => o >= 0)!;
    setTheater(s, nation);
    expect(landProvinces(s)).toBeLessThan(wholeMap);
    expect(goalGain(s)).toBeLessThanOrEqual(wholeGoal);
    expect(goalGain(s)).toBe(Math.round(GOAL_GAIN_FRAC * landProvinces(s)));
  });

  it("counts and ranks only within the theater", () => {
    const s = fresh(23);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const before = provinceCount(s, nation);
    setTheater(s, nation);
    expect(provinceCount(s, nation)).toBe(before);          // my own land is all in my theater
    const { of } = nationRank(s, nation);
    // every ranked nation must actually be inside the theater
    const inTheater = new Set<number>();
    for (let p = 0; p < s.n; p++) if (s.scope![p] === 1 && s.owner[p] >= 0) inTheater.add(s.owner[p]);
    expect(of).toBe(inTheater.size);
  });

  it("playableNations excludes a nation with no reachable rival", () => {
    const s = fresh(23);
    const playable = playableNations(s);
    const all = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    expect(playable.length).toBeGreaterThan(0);
    expect(playable.length).toBeLessThan(all.length);        // seed 23 has stranded nations
    for (const n of playable) {
      const mask = theaterOf(s, n);
      const others = new Set<number>();
      for (let p = 0; p < s.n; p++) if (mask[p] === 1 && s.owner[p] >= 0 && s.owner[p] !== n) others.add(s.owner[p]);
      expect(others.size).toBeGreaterThan(0);                // a rival exists in every offered theater
    }
  });

  it("without a scope everything still counts (pre-scoping behaviour)", () => {
    const s = fresh(11);
    expect(s.scope).toBeUndefined();
    expect(landProvinces(s)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "theater scoping"`
Expected: FAIL — `landComponents is not defined`.

- [ ] **Step 3: Write the implementation**

In `src/engine/armySim.ts`, add `scope?: Uint8Array;` to the `ArmyState` interface (document it as "1 = in the current theater; absent = whole map"), then add:

```typescript
// The province graph splits into land-connected components; armies move only by land, so two
// components can never interact. Deterministic: provinces scanned ascending, ids in first-seen order.
export function landComponents(s: ArmyState): Int32Array {
  const comp = new Int32Array(s.n).fill(-1);
  let next = 0;
  for (let i = 0; i < s.n; i++) {
    if (comp[i] >= 0) continue;
    const stack = [i]; comp[i] = next;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of s.adj[u]) if (comp[v] < 0) { comp[v] = next; stack.push(v); }
    }
    next++;
  }
  return comp;
}

// the landmass this nation actually plays on: every province reachable by land from its territory.
export function theaterOf(s: ArmyState, nation: number): Uint8Array {
  const comp = landComponents(s);
  const mine = new Set<number>();
  for (let p = 0; p < s.n; p++) if (s.owner[p] === nation) mine.add(comp[p]);
  const mask = new Uint8Array(s.n);
  for (let p = 0; p < s.n; p++) if (mine.has(comp[p])) mask[p] = 1;
  return mask;
}

export function setTheater(s: ArmyState, nation: number): void { s.scope = theaterOf(s, nation); }

// nations worth offering: those with at least one rival reachable by land. A nation alone on an
// island can neither attack nor be attacked, so picking it is 50 turns of pressing "end turn".
export function playableNations(s: ArmyState): number[] {
  const comp = landComponents(s);
  const byComp = new Map<number, Set<number>>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o < 0) continue;
    if (!byComp.has(comp[p])) byComp.set(comp[p], new Set());
    byComp.get(comp[p])!.add(o);
  }
  const out = new Set<number>();
  for (const nations of byComp.values()) if (nations.size >= 2) for (const n of nations) out.add(n);
  return [...out].sort((a, b) => a - b);
}
```

Then make the counting helpers respect the scope. Add one predicate and use it in all three:

```typescript
const inScope = (s: ArmyState, p: number) => !s.scope || s.scope[p] === 1;
```

- `landProvinces`: skip provinces where `!inScope(s, p)`.
- `provinceCount`: skip provinces where `!inScope(s, p)`.
- `nationRank`: when collecting living nations, skip provinces where `!inScope(s, p)`.

Leave `goalGain`, `goalProgress` and `outcome` as they are — they already read through these helpers, so they scale automatically.

- [ ] **Step 4: Run the engine suite**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS, including every pre-existing test (they build states without a `scope`, so behaviour is unchanged for them).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): scope the board to the landmass a nation can actually reach"
```

---

### Task 2: Offer only playable nations, and stop numbering land you cannot touch

**Files:**
- Modify: `src/ui/armyApp.ts`
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `playableNations`, `setTheater` (Task 1) and the now-scoped `goalGain`/`provinceCount`/`outcome`.
- DOM contract: in picker mode only playable nations get a `.army-pick-label`; a province click starts a game only for a playable nation. In play mode, `.army-num` labels exist ONLY for provinces inside the theater. Out-of-theater land keeps its existing fill.

- [ ] **Step 1: Write the failing jsdom tests**

Append to `src/ui/armyApp.test.ts` (reuse the existing `pickNation()` helper):

```typescript
describe("theater scoping in the UI", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("offers only nations that have a reachable rival", () => {
    mountArmyApp(root, { seed: 23 });
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 23 });
    const s = initArmySim(world);
    const offered = [...root.querySelectorAll(".army-pick-label")].map((l) => Number(l.getAttribute("data-polity"))).sort((a, b) => a - b);
    expect(offered).toEqual(playableNations(s));
    expect(offered.length).toBeLessThan(new Set([...s.owner].filter((o) => o >= 0)).size);
  });

  it("numbers only the land inside the theater, but still paints the rest", () => {
    mountArmyApp(root, { seed: 23 });
    pickNation();
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 23 });
    const s = initArmySim(world);
    const played = Number((root.querySelector(".army-hud") as HTMLElement).dataset.nation ?? NaN);
    const mask = theaterOf(s, Number.isNaN(played) ? playableNations(s)[0] : played);
    const numbered = new Set([...root.querySelectorAll(".army-num")].map((n) => Number(n.getAttribute("data-prov"))));
    for (const p of numbered) expect(mask[p]).toBe(1);              // nothing outside the theater is numbered
    expect(numbered.size).toBeLessThan(s.n);                        // seed 23 has out-of-theater land
    expect(root.querySelector(".army-wild")).toBeTruthy();          // the rest of the world is still painted
  });

  it("the goal reflects the theater, not the whole map", () => {
    mountArmyApp(root, { seed: 23 });
    pickNation();
    const goalShown = Number((root.querySelector(".army-hud")!.textContent!.match(/정복 [+-]\d+\/(\d+)/) || [])[1]);
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 23 });
    const s = initArmySim(world);
    const wholeMapGoal = goalGain(s);
    expect(goalShown).toBeGreaterThan(0);
    expect(goalShown).toBeLessThan(wholeMapGoal);
  });
});
```

Note: the second test reads the played nation from `.army-hud`'s `data-nation`. Add that attribute in Task 2 Step 3 (`hud.dataset.nation = String(me)`) — it is a cheap, honest way for the test to know which nation was picked without reaching into module state.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/armyApp.test.ts -t "theater scoping in the UI"`
Expected: FAIL — every nation is still offered.

- [ ] **Step 3: Wire the scoping into the UI**

In `src/ui/armyApp.ts`:

1. Import `playableNations`, `setTheater`, `theaterOf` from `../engine/armySim`.
2. Compute the offered set once per render of the picker: `const offered = new Set(playableNations(s));`
   - Only emit a `.army-pick-label` for a nation in `offered`.
   - In the province click handler's picker branch, start a game only when `offered.has(s.owner[p])`; otherwise do nothing (a click on an unplayable nation's land is inert).
3. In `startGame(nation)`, call `setTheater(s, nation)` BEFORE recording `startProv` (so the recorded start count is measured under the same scope everything else uses).
4. On restart, `s = initArmySim(world)` already discards the scope — verify that is still the case so the picker shows the whole world again.
5. When building the map in play mode, emit an `.army-num` label ONLY for provinces where the theater mask is 1. Keep every fill exactly as it is — out-of-theater land must still be painted (owned in its nation's colour, unowned in the wilderness tone).
6. Add `hud.dataset.nation = String(me);` where the HUD is built.

- [ ] **Step 4: Run the UI tests, the full suite and tsc**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: PASS. Pre-existing UI tests that pick "the first label" still work because the first offered label is a playable nation; if any pre-existing test assumed a specific nation id, adjust only that assumption, never its assertion.

Run: `npx vitest run` — full suite green.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts
git commit -m "feat(playArmy): offer only reachable nations and number only the land in play"
```

---

### Task 3: Play it and re-measure

**Files:** none (verification only)

- [ ] **Step 1: Full suite + type-check + build**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx vite build`
Expected: green, clean, builds.

- [ ] **Step 2: Re-run the survey that motivated this**

Open `/playArmy.html?seed=23` and confirm:
- the picker no longer offers the two stranded nations (previously ids 4 and 7);
- the goal shown at t0 is the scoped one (~12 rather than 21);
- no number labels sit on out-of-theater islands, but those islands are still painted;
- playing a full game still works end to end (levy → march → battle → victory/horizon), console clean.

Also check a seed with NO unreachable land (seed 11): every nation should still be offered and the goal should be essentially unchanged, proving the change is a no-op where there is nothing to scope.

- [ ] **Step 3: Report the new balance baseline**

The goal drops substantially on island-heavy maps, which makes winning EASIER — measure it: play the same nations as the previous sweep and report the new win turns. This is the baseline the next step (giving the AI a victory condition, so there is a race) will be judged against, and it is also the moment to say whether `GOAL_GAIN_FRAC` should rise. Record in the backlog memory.

---

## Self-Review notes

- **Scope coverage:** components (T1) ✓; theater mask (T1) ✓; scoped land/count/rank so goal follows (T1) ✓; playable-nation filter (T1) ✓; picker offers only playable (T2) ✓; numbers only in theater while fills stay (T2) ✓; scope set before `startProv` is recorded (T2 step 3) ✓; restart clears scope (T2 step 4) ✓; re-measure + new baseline (T3) ✓.
- **Type consistency:** `theaterOf`/`playableNations`/`setTheater` keep identical signatures across both tasks; `ArmyState.scope` is optional so every existing hand-built fixture stays valid.
- **Deliberate non-goal:** unreachable land is NOT deleted and naval movement is NOT added. Both remain open options; this change only stops the game from counting and offering what it cannot reach.
