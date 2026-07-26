# Army prototype — make it a race (the AI can win, so you can lose)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every nation the same victory condition the player has, so an AI reaching it first ends the game as the player's defeat — turning "when do I win" into "can I get there before they do".

**Architecture:** The state records every nation's starting province count at game start. `outcome` gains one branch: after the player's own defeat/victory checks, if any rival has met the goal, the player has been outpaced. The HUD shows the leading rival's progress, because a race you cannot see is not a race.

**Tech Stack:** TypeScript, Vitest (node + jsdom).

## Why (measured)

After theater scoping made the goal honest, every playable nation still wins, and now quickly — on seed 23 with a mechanical policy, victory lands on **turn 5–11 out of a 50-turn horizon**:

| nation | start | win turn |
|---|---|---|
| 8 provinces | 8 | **5** |
| 18 provinces | 18 | 9 |
| 10 provinces | 10 | 9 |
| 3 provinces | 3 | 11 |

Turtling does not lose either (it merely ranks poorly). So the game currently has no way to lose and no pressure: **only the player has a victory condition, so nothing is chasing you.** Every per-battle decision has tension (the odds work), but the game as a whole has none.

This is the cheapest possible fix for that: the rules already exist — they simply only apply to one nation.

## Global Constraints

- PROTOTYPE iteration. NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, `src/ui/politicalLayer.ts`, or any pre-existing test outside `armySim.test.ts` / `armyApp.test.ts`.
- Engine pure and rng-free: no `Math.random()`, no `Date.now()`.
- **Do NOT change any balance constant in this plan.** `GOAL_GAIN_FRAC` stays `0.2`. Retuning happens after this is measured, not before — the whole point is that the current number cannot be judged until there is a race.
- The goal is measured the same way for everyone: `provinceCount(nation) − startOf(nation) >= goalGain(s)`, all scoped to the theater.
- Ties go to the PLAYER: the player's own victory is checked before any rival's. (The player acts first within a turn, so this matches what the player just did.)
- `tsc --noEmit` clean (`noUnusedLocals` is on).
- Run tests from the repo root: `npx vitest run <file>`.

---

### Task 1: Every nation races for the same goal

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- `ArmyState` gains `startCounts: Int32Array` — province count per nation at the moment the game began. `initArmySim` fills it from the initial ownership.
- Produces:
  - `export function nationProgress(s: ArmyState, nation: number): { gained: number; goal: number }` — the same measure as `goalProgress`, but using the nation's own recorded start.
  - `export function leadingRival(s: ArmyState, player: number): { nation: number; gained: number; goal: number } | null` — the rival closest to the goal (highest `gained`; ties → lower polity id), among nations in the theater that still hold land. `null` if none.
  - `Outcome` gains `{ kind: "outpaced"; by: number; }`.
- Changed: `outcome(s, nation, startProv)` gains the outpaced branch (see order below).

**Note on `startProv`:** `outcome` keeps its existing third parameter for the PLAYER (the UI records it at pick time and it must keep working). Rivals use `s.startCounts`. Do not change the player's path to use `startCounts` — the player's start is recorded when they pick, which is the same moment `initArmySim` ran, so the two agree; keeping the parameter avoids touching the UI contract.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add the new names to the existing `./armySim` import line):

```typescript
describe("the race (every nation has the same victory condition)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("records every nation's starting size", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))];
    for (const n of nations) expect(s.startCounts[n]).toBe(provinceCount(s, n));
  });

  it("measures a rival's progress from ITS OWN start", () => {
    const s = fresh(11);
    const rival = [...new Set([...s.owner].filter((o) => o >= 0))][1];
    const before = nationProgress(s, rival);
    expect(before.gained).toBe(0);
    expect(before.goal).toBe(goalGain(s));
    // hand the rival one more province
    const victim = [...Array(s.n).keys()].find((p) => s.owner[p] >= 0 && s.owner[p] !== rival)!;
    s.owner[victim] = rival;
    expect(nationProgress(s, rival).gained).toBe(1);
  });

  it("leadingRival names the rival closest to the goal, never the player", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const free = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== rival && s.owner[p] !== me);
    for (const p of free.slice(0, 3)) s.owner[p] = rival;      // rival pulls ahead
    const lead = leadingRival(s, me)!;
    expect(lead.nation).toBe(rival);
    expect(lead.nation).not.toBe(me);
    expect(lead.gained).toBeGreaterThan(0);
  });

  it("the player LOSES when a rival reaches the goal first", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const need = goalGain(s);
    const takeable = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== rival && s.owner[p] !== me);
    for (const p of takeable.slice(0, need)) s.owner[p] = rival;
    const r = outcome(s, me, s.startCounts[me]);
    expect(r).toEqual({ kind: "outpaced", by: rival });
  });

  it("a tie goes to the player: my own victory outranks a rival's", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const need = goalGain(s);
    const pool = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== me && s.owner[p] !== rival);
    for (const p of pool.slice(0, need)) s.owner[p] = rival;          // rival is at the goal
    for (const p of pool.slice(need, need * 2)) s.owner[p] = me;      // and so am I
    expect(outcome(s, me, s.startCounts[me])).toEqual({ kind: "victory" });
  });

  it("my own defeat still outranks everything", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const me = nations[0], rival = nations[1];
    const need = goalGain(s);
    const pool = [...Array(s.n).keys()].filter((p) => s.owner[p] >= 0 && s.owner[p] !== me);
    for (const p of pool.slice(0, need)) s.owner[p] = rival;
    for (let p = 0; p < s.n; p++) if (s.owner[p] === me) s.owner[p] = rival;   // I hold nothing
    expect(outcome(s, me, s.startCounts[me])).toEqual({ kind: "defeat" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "the race"`
Expected: FAIL — `startCounts` is undefined / `leadingRival` is not defined.

- [ ] **Step 3: Write the implementation**

In `src/engine/armySim.ts`:

1. Add `startCounts: Int32Array;` to the `ArmyState` interface (comment: "province count per nation when the game began — every nation races from its own start").
2. In `initArmySim`, after `owner` is settled, fill it:

```typescript
  const startCounts = new Int32Array(world.polities.length);
  for (let p = 0; p < n; p++) { const o = owner[p]; if (o >= 0 && o < startCounts.length) startCounts[o]++; }
```
and include `startCounts` in the returned state.

3. Add, next to `goalProgress`:

```typescript
// a nation's progress toward the SAME goal the player races for, measured from its own starting size.
export function nationProgress(s: ArmyState, nation: number): { gained: number; goal: number } {
  return { gained: provinceCount(s, nation) - (s.startCounts[nation] ?? 0), goal: goalGain(s) };
}

// the rival closest to winning — what the player is actually racing. Ties break on the lower polity id.
// Only nations that still hold land inside the theater are considered.
export function leadingRival(s: ArmyState, player: number): { nation: number; gained: number; goal: number } | null {
  const seen = new Set<number>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o >= 0 && o !== player && (!s.scope || s.scope[p] === 1)) seen.add(o);
  }
  let best: { nation: number; gained: number; goal: number } | null = null;
  for (const n of [...seen].sort((a, b) => a - b)) {
    const pr = nationProgress(s, n);
    if (!best || pr.gained > best.gained) best = { nation: n, ...pr };
  }
  return best;
}
```

4. Extend `Outcome` with `| { kind: "outpaced"; by: number }` and add the branch to `outcome`, AFTER defeat and victory and BEFORE the horizon:

```typescript
  const lead = leadingRival(s, nation);
  if (lead && lead.gained >= lead.goal) return { kind: "outpaced", by: lead.nation };
```

- [ ] **Step 4: Run the engine suite**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS. Pre-existing tests that build a state and call `outcome` may now hit the outpaced branch if a rival happens to be at the goal — if one does, fix it by making the scenario explicit (e.g. assert on a state where no rival is near the goal), never by weakening the assertion. Report any such test.

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): every nation races for the same goal, so the player can be outpaced"
```

---

### Task 2: Show the race and name the winner

**Files:**
- Modify: `src/ui/armyApp.ts`
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `leadingRival`, the extended `Outcome` (Task 1).
- DOM contract: the HUD contains a rival segment `추격 <name> +N/M`; the end screen renders the outpaced result naming the rival.

- [ ] **Step 1: Write the failing jsdom tests**

Append to `src/ui/armyApp.test.ts` (reuse the existing `pickNation()` helper):

```typescript
describe("the race is visible", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows the leading rival's progress next to my own", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    const hud = root.querySelector(".army-hud")!.textContent!;
    expect(hud).toMatch(/정복 [+-]\d+\/\d+/);      // mine
    expect(hud).toMatch(/추격 .+ [+-]\d+\/\d+/);   // theirs
  });

  it("ends the game naming the rival that got there first", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    // play passively to the end; either the horizon or a rival finishes it
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".army-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/패배|승리|종료/);
    expect(root.querySelector("button.army-restart")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/armyApp.test.ts -t "the race is visible"`
Expected: FAIL — no `추격` segment in the HUD.

- [ ] **Step 3: Show the rival in the HUD**

In `src/ui/armyApp.ts`, import `leadingRival` and append a rival segment to the HUD line, keeping every existing field verbatim:

```typescript
    const rival = leadingRival(s, me);
    const rivalSeg = rival
      ? ` · 추격 ${world.polities[rival.nation]?.name ?? rival.nation} ${rival.gained >= 0 ? "+" : ""}${rival.gained}/${rival.goal}`
      : "";
```

and append `rivalSeg` to the HUD text.

- [ ] **Step 4: Handle the outpaced ending**

Add the new outcome kind to the end-screen text selection:

```typescript
        : oc.kind === "outpaced" ? `패배 — ${world.polities[oc.by]?.name ?? oc.by}이(가) 먼저 목표를 달성했습니다`
```

Place it alongside the existing `defeat` / `victory` / `horizon` branches. Keep the existing `.army-over` / `button.army-restart` structure exactly as it is.

- [ ] **Step 5: Run the UI tests, the full suite and tsc**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: PASS. If a pre-existing test now ends earlier because a rival wins, adjust only its setup/turn count, never its assertions — and report it.

Run: `npx vitest run` — full suite green.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts
git commit -m "feat(playArmy): show the leading rival's progress and name whoever beats you to it"
```

---

### Task 3: Play it and retune the goal

**Files:** none (verification, then a possible one-constant change)

- [ ] **Step 1: Full suite + type-check + build**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx vite build`

- [ ] **Step 2: Measure the race**

On seed 23 and seed 11, play the same nations as the previous sweep with the same policy (levy everything, attack the best target at ≥70% odds) and record for each: did I win, on what turn, and how close was the leading rival (`추격 N/M` at the end). Then play PASSIVELY (levy but never attack) and confirm that a rival now actually wins — that is the first time losing is possible, so verify it happens.

- [ ] **Step 3: Retune `GOAL_GAIN_FRAC` if the data says so**

Now — and only now — the goal can be judged, because there is something to lose to. If the player still wins by turn ~10 with the rival far behind, raise `GOAL_GAIN_FRAC` (0.2 → 0.3) and re-measure both the win turn and whether a passive player still loses. Change ONE constant, re-run the same measurements, and report both before and after. Record the outcome in the backlog memory.

---

## Self-Review notes

- **Coverage:** per-nation starts recorded (T1) ✓; rival progress from its own start (T1) ✓; leadingRival excludes the player and respects the theater (T1) ✓; outpaced branch in the right order — defeat > victory > outpaced > horizon (T1 tests pin all three orderings) ✓; HUD shows the rival (T2) ✓; end screen names them (T2) ✓; measure then retune, in that order (T3) ✓.
- **Type consistency:** `nationProgress`/`leadingRival` signatures identical across tasks; `Outcome`'s new member is additive so existing `switch`/ternary chains keep compiling — but T2 must handle it explicitly or the end screen would fall through to the horizon text.
- **Deliberate non-goal:** the AI's *behaviour* is unchanged — it does not play smarter, it simply now counts as a winner if its dumb expansion reaches the goal. If the race proves too easy to win, the lever is `GOAL_GAIN_FRAC` (T3), not AI cleverness, which is a separate and much larger piece of work.
