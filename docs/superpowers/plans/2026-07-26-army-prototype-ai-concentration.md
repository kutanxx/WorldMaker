# Army prototype — an AI that concentrates force

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI mass its armies at a chosen objective instead of leaving each one to nibble at whatever happens to border it — the single behaviour that separates the player from the AI today.

**Architecture:** Each AI nation picks one objective per turn (the best value-for-defence province on its frontier) and one front (its own province next to that objective). Armies that can win a fight locally still take it; armies that cannot stop idling and march one step toward the front along their own territory, so force accumulates until the objective falls. All deterministic and rng-free.

**Tech Stack:** TypeScript, Vitest.

## Why (measured)

Every playable nation beats the AI, and the margin is not close:

| player start | result | rival's final progress |
|---|---|---|
| 8 provinces | WIN turn 7 | +1 / 18 |
| 18 provinces | WIN turn 12 | +3 / 18 |
| 3 provinces | WIN turn 18 | +6 / 18 |

Only a completely passive player loses. And the cause is visible in `aiTurn`: each army looks **only at provinces adjacent to itself** and attacks the weakest one it can beat — otherwise it does nothing at all. So an AI army that starts away from a weak border sits still for the whole game, bleeding 3% upkeep every turn, while the player marches three stacks into one province and breaks through.

Raising the goal does not fix this (measured: goal 0.2 → 0.3 made the rival's margin *worse*, 5 → 3, because the player compounds faster). The lever is the AI's behaviour, not a constant.

## Global Constraints

- PROTOTYPE iteration. NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `src/ui/armyApp.ts`, `playProvince.html`, or any pre-existing test outside `armySim.test.ts`.
- **Deterministic and rng-free**: no `Math.random()`, no `Date.now()`. Every choice (objective, front, path, army order) needs an explicit tie-break — ascending province id unless stated otherwise.
- Do NOT change any balance constant, the battle model, the odds curve, levy/upkeep/regrow, or the victory conditions. This changes only *how the AI decides*, nothing about the rules it plays under.
- The AI must keep obeying every rule the player obeys: one levy per province per turn (`canLevy`), one move per army per turn (`movedOn`), land adjacency only.
- The player is never an actor in `aiTurn` (it already excludes `playerNation` — keep it that way).
- `tsc --noEmit` clean (`noUnusedLocals` is on).
- Run tests from the repo root: `npx vitest run <file>`.

---

### Task 1: Pick an objective worth taking

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Produces `export function aiObjective(s: ArmyState, nation: number): number` — the province this nation should be trying to take, or `-1` if it borders nothing it could ever want.
  - Candidates: every province NOT owned by `nation` that is land-adjacent to at least one province the nation owns.
  - Score: `s.pop[q] / (1 + defenceOf(s, q, nation))` — a rich, thinly-held province beats an empty fortress. Higher is better; ties → lower province id.
  - Deterministic; no mutation.

Why value and not just weakness: the current AI targets the lowest defence, which is usually empty wasteland. Population is what turns into soldiers next turn, so the AI should want the same provinces a player wants.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add `aiObjective` to the existing `./armySim` import line):

```typescript
describe("aiObjective (the AI wants land worth having)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("picks a province on the nation's frontier, never its own land", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const obj = aiObjective(s, nation);
    expect(obj).toBeGreaterThanOrEqual(0);
    expect(s.owner[obj]).not.toBe(nation);
    const touchesMe = s.adj[obj].some((q) => s.owner[q] === nation);
    expect(touchesMe).toBe(true);
  });

  it("prefers the richer of two equally defended frontier provinces", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    // find two frontier candidates and make one clearly richer, both undefended by armies
    const frontier = [...Array(s.n).keys()].filter((p) => s.owner[p] !== nation && s.adj[p].some((q) => s.owner[q] === nation));
    expect(frontier.length).toBeGreaterThan(1);
    const [a, b] = frontier;
    s.armies = s.armies.filter((x) => x.prov !== a && x.prov !== b);
    s.pop[a] = 10; s.pop[b] = 10;
    expect(aiObjective(s, nation)).toBe(Math.min(a, b));   // equal value -> lower id
    s.pop[b] = 400;                                         // now b is far richer
    expect(aiObjective(s, nation)).toBe(b);
  });

  it("returns -1 for a nation with no frontier at all", () => {
    const s = fresh(23);
    // an isolated nation (seed 23 has them): every neighbour of its land is its own
    const isolated = [...new Set([...s.owner].filter((o) => o >= 0))]
      .find((n) => {
        for (let p = 0; p < s.n; p++) if (s.owner[p] === n) for (const q of s.adj[p]) if (s.owner[q] !== n) return false;
        return true;
      });
    expect(isolated).toBeDefined();
    expect(aiObjective(s, isolated!)).toBe(-1);
  });

  it("is pure — calling it twice gives the same answer and mutates nothing", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const snap = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    const first = aiObjective(s, nation);
    expect(aiObjective(s, nation)).toBe(first);
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(snap);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "aiObjective"`
Expected: FAIL — `aiObjective is not defined`.

- [ ] **Step 3: Write the implementation**

Add above `aiTurn` in `src/engine/armySim.ts`:

```typescript
// What this nation is trying to take. Scored by value-for-defence — population is what becomes
// soldiers next turn, so the AI should want the same provinces a player wants, not merely the
// emptiest wasteland on its border (which is what "lowest defence" alone picks). Ties -> lower id.
export function aiObjective(s: ArmyState, nation: number): number {
  let best = -1, bestScore = -Infinity;
  for (let p = 0; p < s.n; p++) {
    if (s.owner[p] === nation) continue;
    let touches = false;
    for (const q of s.adj[p]) if (s.owner[q] === nation) { touches = true; break; }
    if (!touches) continue;
    const score = s.pop[p] / (1 + defenceOf(s, p, nation));
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS, including every pre-existing test (nothing calls `aiObjective` yet).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): the AI picks an objective by value, not by whatever is weakest"
```

---

### Task 2: Stop idling — march toward the front

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `aiObjective` (Task 1).
- Produces `export function stepToward(s: ArmyState, from: number, to: number, nation: number): number` — the next province to move to along a shortest path through provinces the nation OWNS, or `-1` if `to` is unreachable that way or already adjacent-to/equal-to `from`'s position in a way that needs no step. BFS from `from` over own territory; ties → lower province id at every expansion so the path is deterministic.
- Changed: `aiTurn`'s movement phase.

New movement phase, per nation, armies visited in ascending province id (snapshot positions first, as today, because `moveArmy` mutates `s.armies`):

1. `obj = aiObjective(s, nation)`. If `obj < 0`, the nation has no frontier — leave its armies where they are.
2. `front` = the nation's own province adjacent to `obj` holding the most men (ties → lower id); if none of its provinces borders `obj` — impossible by construction, but guard anyway — skip.
3. For each army:
   - **Fight if you can win here.** Among provinces adjacent to the army that the nation does not own, take the one with the best `aiObjective`-style score that the army can beat (`defenceOf < army.men`). If one exists, `moveArmy` into it and continue to the next army.
   - **Otherwise converge.** If the army is not already on `front`, `stepToward(s, army.prov, front, nation)` and move one step if a step exists.
   - **Otherwise wait.** The army is at the front and cannot win yet: leave it to accumulate. (Upkeep still bleeds it, which is the pressure that stops this becoming an infinite build-up.)

This is the whole change: an army that cannot fight now walks to where it will matter instead of standing still for fifty turns.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add `stepToward` to the import line):

```typescript
describe("stepToward (deterministic march through your own land)", () => {
  const fresh = () => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);

  it("returns a neighbour of `from` that is owned by the nation and closer to `to`", () => {
    const s = fresh();
    const nation = [...s.owner].find((o) => o >= 0)!;
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    // find a pair of my provinces at distance >= 2 through my own land
    let from = -1, to = -1;
    for (const a of mine) for (const b of mine) {
      if (a === b || s.adj[a].includes(b)) continue;
      if (stepToward(s, a, b, nation) >= 0) { from = a; to = b; break; }
      if (from >= 0) break;
    }
    expect(from).toBeGreaterThanOrEqual(0);
    const step = stepToward(s, from, to, nation);
    expect(s.adj[from]).toContain(step);
    expect(s.owner[step]).toBe(nation);
  });

  it("is deterministic and does not mutate", () => {
    const s = fresh();
    const nation = [...s.owner].find((o) => o >= 0)!;
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    const snap = JSON.stringify({ o: [...s.owner], a: s.armies });
    const a = stepToward(s, mine[0], mine[mine.length - 1], nation);
    expect(stepToward(s, mine[0], mine[mine.length - 1], nation)).toBe(a);
    expect(JSON.stringify({ o: [...s.owner], a: s.armies })).toBe(snap);
  });

  it("returns -1 when the destination cannot be reached through own land", () => {
    const s = fresh();
    const nation = [...s.owner].find((o) => o >= 0)!;
    const foreign = [...Array(s.n).keys()].find((p) => s.owner[p] >= 0 && s.owner[p] !== nation)!;
    const mine = [...Array(s.n).keys()].find((p) => s.owner[p] === nation)!;
    expect(stepToward(s, mine, foreign, nation)).toBe(-1);
  });
});

describe("the AI concentrates instead of idling", () => {
  it("moves an army that cannot win anything toward the front", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 11 });
    const s = initArmySim(world);
    const player = 0;
    const nation = [...new Set([...s.owner].filter((o) => o >= 0 && o !== player))][0];
    // put a tiny army deep inside the nation's territory, far from any enemy it could beat
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation);
    const interior = mine.find((p) => s.adj[p].every((q) => s.owner[q] === nation));
    if (interior === undefined) return;                   // this seed has no interior province; nothing to assert
    s.armies.push({ prov: interior, nation, men: 1, movedOn: -1 });
    aiTurn(s, player);
    // it must not still be sitting where it started doing nothing
    expect(armyAt(s, interior, nation)).toBeUndefined();
  });

  it("still obeys one move per army per turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 11 });
    const s = initArmySim(world);
    const player = 0;
    aiTurn(s, player);
    for (const a of s.armies) if (a.nation !== player) expect(a.movedOn === -1 || a.movedOn === s.turn).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "stepToward"`
Expected: FAIL — `stepToward is not defined`.

- [ ] **Step 3: Write the implementation**

Add next to `aiObjective`:

```typescript
// One step along a shortest path from `from` to `to` through provinces this nation OWNS. BFS with an
// ascending-id frontier so the path (and therefore the whole game) stays deterministic. -1 when `to`
// is not reachable through own territory, or when `from` is already `to`.
export function stepToward(s: ArmyState, from: number, to: number, nation: number): number {
  if (from === to) return -1;
  const prev = new Int32Array(s.n).fill(-1);
  const seen = new Uint8Array(s.n);
  seen[from] = 1;
  let frontier = [from];
  while (frontier.length) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const v of [...s.adj[u]].sort((a, b) => a - b)) {
        if (seen[v]) continue;
        if (v !== to && s.owner[v] !== nation) continue;   // may only march through own land
        seen[v] = 1; prev[v] = u;
        if (v === to) {                                    // walk back to the first step
          let cur = v;
          while (prev[cur] !== from) cur = prev[cur];
          return cur;
        }
        next.push(v);
      }
    }
    next.sort((a, b) => a - b);
    frontier = next;
  }
  return -1;
}
```

Then replace `aiTurn`'s movement phase (step 2 in the existing function) with:

```typescript
    // 2. concentrate. Each army fights if it can win where it stands; otherwise it marches toward the
    // front rather than standing still for the rest of the game bleeding upkeep. Snapshot positions
    // first because moveArmy mutates s.armies (removes/merges/relocates).
    const obj = aiObjective(s, nation);
    let front = -1, frontMen = -1;
    if (obj >= 0) {
      for (const q of s.adj[obj]) {
        if (s.owner[q] !== nation) continue;
        const men = armyAt(s, q, nation)?.men ?? 0;
        if (men > frontMen || (men === frontMen && (front < 0 || q < front))) { frontMen = men; front = q; }
      }
    }
    const positions = s.armies.filter((a) => a.nation === nation).map((a) => a.prov).sort((a, b) => a - b);
    for (const prov of positions) {
      const army = armyAt(s, prov, nation);
      if (!army) continue;                       // merged away by an earlier move this turn
      // fight if this army can win where it stands — best value-for-defence among what it can beat
      let target = -1, bestScore = -Infinity;
      for (const q of s.adj[army.prov]) {
        if (s.owner[q] === nation) continue;
        const d = defenceOf(s, q, nation);
        if (d >= army.men) continue;
        const score = s.pop[q] / (1 + d);
        if (score > bestScore) { bestScore = score; target = q; }
      }
      if (target >= 0) { moveArmy(s, army.prov, nation, target); continue; }
      // otherwise walk toward the front so force accumulates where it will matter
      if (front >= 0 && army.prov !== front) {
        const step = stepToward(s, army.prov, front, nation);
        if (step >= 0) moveArmy(s, army.prov, nation, step);
      }
    }
```

- [ ] **Step 4: Run the engine suite**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS. Pre-existing AI tests may shift because the AI now moves armies it previously left idle — if one breaks, verify the new behaviour is correct and update the test's SETUP or expectation to match the new (intended) behaviour, never weakening what it checks. Report every such test.

- [ ] **Step 5: Full suite, tsc, commit**

Run: `npx vitest run` and `npx tsc --noEmit`.

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): AI armies converge on a front instead of idling where they stand"
```

---

### Task 3: Measure whether the AI is actually competitive now

**Files:** none (verification)

- [ ] **Step 1: Full suite + type-check + build**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx vite build`.

- [ ] **Step 2: Re-run the exact comparison this plan is judged against**

On seed 23, play the same three nations with the same policy as the measurements in "Why" (levy every province once, attack the best target at ≥70% odds) and record for each: win/lose, the turn, and **the leading rival's final progress**. The baseline to beat:

| player start | before | rival's progress before |
|---|---|---|
| 8 provinces | WIN turn 7 | +1 / 18 |
| 18 provinces | WIN turn 12 | +3 / 18 |
| 3 provinces | WIN turn 18 | +6 / 18 |

Also re-run the passive game and confirm the player still loses (it should lose *sooner* now).

- [ ] **Step 3: Report honestly**

State whether the rival's margin actually closed, and by how much. If the AI is still far behind, say so plainly and name the next lever (defence — the AI still never garrisons — or race-awareness). Do NOT retune constants to manufacture a closer result; the point of this task is to find out whether concentration alone was the missing behaviour. Record in the backlog memory.

---

## Self-Review notes

- **Coverage:** value-based objective (T1) ✓; deterministic own-land pathing (T2) ✓; fight-if-you-can-win-else-converge-else-wait (T2) ✓; one-move and one-levy rules still obeyed (T2 test) ✓; player never acted for (unchanged) ✓; measurement against the stated baseline (T3) ✓.
- **Type consistency:** `aiObjective(s, nation): number` and `stepToward(s, from, to, nation): number` keep identical signatures in both tasks.
- **Deliberate non-goals:** the AI still does not defend (no garrisoning), does not consider the race leader, and does not retreat. Those are named as the next levers in T3 rather than smuggled in here, so this task answers one question: *was dispersal the reason the AI lost?*
