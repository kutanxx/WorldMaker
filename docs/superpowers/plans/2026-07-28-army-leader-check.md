# Army leader-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the army-game AI notice who is winning the race and prefer to attack them, so a runaway leader — including the player — gets checked instead of expanding unopposed.

**Architecture:** One pure engine function identifies the race leader by conquest-since-start (player included). One exported constant multiplies a target's score when it belongs to that leader, applied at both places the AI scores a target. The winnability gate that decides *whether* to attack is not touched — the bias only reorders *which* winnable target to prefer. The HUD tells the player when they are the leader and therefore the target.

**Tech Stack:** TypeScript, Vitest (`jsdom` for UI tests), Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-army-leader-check-design.md`

## Global Constraints

- **Determinism is a hard invariant.** No `Math.random()`, no `Date`, no iteration over unordered sets without an explicit sort. Same seed + same commands must produce an identical game; the whole test suite depends on it. Every tie-break in this plan resolves to the **lower polity id**.
- **Do not touch the `d >= army.men` winnability gate in `aiTurn`.** A previous balance lever (`AI_ODDS_MIN`, commit `80dd8f4`) was reverted at `d9708fb` because pushing the AI toward harder fights made it *stronger*, not weaker: a winner loses `round(def × WIN_LOSS_MULT × closeness)`, so routs are cheap and close fights are ruinous. Forcing attacks into the leader would reproduce that failure.
- **`AI_LEADER_BIAS` must be a single exported constant.** Setting it to `1` must restore today's behaviour exactly.
- Comments in this codebase explain *why*, not *what*. Match that.
- Test command: `npx vitest run <path>`. Full suite: `npx vitest run` (816 tests at baseline). Type check: `npx tsc --noEmit`. Build: `npx vite build`.
- Existing exported signatures may gain **optional** parameters only. Do not break `aiObjective(s, nation)` for its existing callers and tests.

---

### Task 1: `raceLeader` — who is winning

**Files:**
- Modify: `src/engine/armySim.ts` (add after `leadingRival`, around line 455)
- Test: `src/engine/armySim.test.ts` (add a new `describe` block at the end of the file)

**Interfaces:**
- Consumes: existing `nationProgress(s, nation): { gained: number; goal: number }` (line ~437), `ArmyState.scope?: Uint8Array` (optional theater mask; `scope[p] === 1` means province `p` is in play).
- Produces: `raceLeader(s: ArmyState): number` — the polity id leading the race, or `-1` when no nation holds theater land. Task 2 consumes this.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts`:

```ts
describe("raceLeader (the AI can see who is winning)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("picks the nation with the most conquest since its own start, not the biggest nation", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    expect(nations.length).toBeGreaterThan(2);
    // at t0 nobody has gained anything, so the tie-break decides: lowest id
    expect(raceLeader(s)).toBe(nations[0]);
    // hand a LATER-id nation one extra province taken from a third nation; it now leads on gained
    const climber = nations[nations.length - 1];
    const victim = nations[1];
    const taken = [...Array(s.n).keys()].find((p) => s.owner[p] === victim)!;
    s.owner[taken] = climber;
    expect(raceLeader(s)).toBe(climber);
    expect(nationProgress(s, climber).gained).toBe(1);
    // the biggest nation is NOT necessarily the answer — assert we did not just pick by size
    const sizes = nations.map((n) => ({ n, k: provinceCount(s, n) })).sort((a, b) => b.k - a.k);
    if (sizes[0].n !== climber) expect(raceLeader(s)).not.toBe(sizes[0].n);
  });

  it("includes the player — it is not the rival-only question leadingRival answers", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const player = nations[0];
    const taken = [...Array(s.n).keys()].find((p) => s.owner[p] === nations[1])!;
    s.owner[taken] = player;
    expect(raceLeader(s)).toBe(player);                 // the player can be the leader
    expect(leadingRival(s, player)?.nation).not.toBe(player); // leadingRival still excludes them
  });

  it("ignores nations outside the theater", () => {
    const s = fresh(23);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const outsider = nations[nations.length - 1];
    // give the outsider a commanding lead, then scope the theater to exclude it entirely
    for (let p = 0; p < s.n; p++) if (s.owner[p] === nations[1]) s.owner[p] = outsider;
    s.scope = new Uint8Array(s.n);
    for (let p = 0; p < s.n; p++) if (s.owner[p] !== outsider) s.scope[p] = 1;
    expect(raceLeader(s)).not.toBe(outsider);
  });

  it("returns -1 when nobody holds land", () => {
    const s = fresh(11);
    s.owner.fill(-1);
    expect(raceLeader(s)).toBe(-1);
  });

  it("is pure and deterministic — same answer twice, state untouched", () => {
    const s = fresh(11);
    const snap = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    const first = raceLeader(s);
    expect(raceLeader(s)).toBe(first);
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(snap);
  });
});
```

Add `raceLeader` to the import list at the top of `src/engine/armySim.test.ts` (line 4) — append `, raceLeader` inside the existing `{ ... }` from `"./armySim"`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/armySim.test.ts -t "raceLeader"
```

Expected: FAIL. The import of `raceLeader` is undefined, so every test in the block errors with something like `raceLeader is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/engine/armySim.ts`, immediately after the `leadingRival` function (which ends around line 455), add:

```ts
// Who is winning the race — measured by conquest since each nation's own start, the same number the
// HUD shows. The PLAYER IS INCLUDED: a player running away with the game is the case this exists to
// cover. Size is deliberately not the metric — this game replaced an absolute goal with a start-fair
// one because size at t0 is an accident of the map, and a large nation that has gained nothing has
// not earned a coalition against it. Ties -> lower polity id. -1 when nobody holds theater land.
export function raceLeader(s: ArmyState): number {
  const seen = new Set<number>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o >= 0 && (!s.scope || s.scope[p] === 1)) seen.add(o);
  }
  let best = -1, bestGained = -Infinity;
  for (const n of [...seen].sort((a, b) => a - b)) {
    const g = nationProgress(s, n).gained;
    if (g > bestGained) { bestGained = g; best = n; }
  }
  return best;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/engine/armySim.test.ts -t "raceLeader"
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite and type check — nothing else may move**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all tests pass (821 = 816 baseline + 5 new), tsc silent.

- [ ] **Step 6: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): raceLeader — who is winning the race, player included"
```

---

### Task 2: The AI prefers the leader, among fights it can already win

**Files:**
- Modify: `src/engine/armySim.ts` — add `AI_LEADER_BIAS` + `leaderWeight` near `AI_LEVY_FRAC` (line ~251); change `aiObjective` (line 256); change `aiTurn` (line 304)
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `raceLeader(s)` from Task 1; existing `defenceOf(s, prov, nation)`, `armyAt(s, prov, nation)`, `moveArmy(s, from, nation, to)`.
- Produces: `AI_LEADER_BIAS: number` (exported const, value `2`) and `aiObjective(s, nation, leader?: number)` — third parameter defaults to `-1`, meaning no bias. Task 4 measures against these.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts`:

```ts
describe("AI_LEADER_BIAS (the AI checks the leader, but never suicides for it)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);
  const frontierOf = (s: ArmyState, nation: number) => [...Array(s.n).keys()]
    .filter((p) => s.owner[p] !== nation && s.adj[p].some((q) => s.owner[q] === nation));
  const otherNation = (s: ArmyState, nation: number) =>
    [...new Set([...s.owner].filter((o) => o >= 0 && o !== nation))].sort((a, b) => a - b)[0];

  // `defenceOf` reads armies, population and biome — never `owner`. So reassigning a province's
  // owner changes the bias and NOTHING else, which is what makes these tests exact rather than
  // dependent on some seed's biome layout happening to produce a tie.
  const scoreOf = (s: ArmyState, p: number, nation: number) => s.pop[p] / (1 + defenceOf(s, p, nation));

  it("lifts the leader's province past a rival the AI would otherwise prefer", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const leader = otherNation(s, nation);
    const top = aiObjective(s, nation, -1);
    expect(top).toBeGreaterThanOrEqual(0);
    // a near-miss: loses on raw value, but by less than the bias makes up
    const runnerUp = frontierOf(s, nation).filter((p) => p !== top)
      .find((p) => scoreOf(s, p, nation) > 0 && scoreOf(s, p, nation) * AI_LEADER_BIAS > scoreOf(s, top, nation));
    expect(runnerUp).toBeDefined();
    s.owner[top] = -1;                 // make sure the leader does not also own the old winner
    s.owner[runnerUp!] = leader;
    expect(aiObjective(s, nation, -1)).toBe(top);           // unbiased: unchanged
    expect(aiObjective(s, nation, leader)).toBe(runnerUp);  // biased: the leader's land wins
  });

  it("does not mistake unowned wasteland for the leader's land when there is no leader", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const top = aiObjective(s, nation, -1);
    const wild = frontierOf(s, nation).filter((p) => p !== top)
      .find((p) => scoreOf(s, p, nation) > 0 && scoreOf(s, p, nation) * AI_LEADER_BIAS > scoreOf(s, top, nation));
    expect(wild).toBeDefined();
    s.owner[wild!] = -1;                              // unowned, scoring just below the winner
    s.owner[top] = otherNation(s, nation);            // owned, so it is not wasteland too
    // owner is -1 for wasteland and raceLeader returns -1 for "nobody". Drop the `leader >= 0`
    // guard from leaderWeight and `wild` wins this. It must not.
    expect(aiObjective(s, nation, -1)).toBe(top);
  });

  it("never turns a fight the AI would decline into one it takes", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const leader = otherNation(s, nation);
    // every neighbour becomes the leader's (maximally attractive) AND unbeatable (militia alone
    // dwarfs anything this nation can raise). The bias must not override the winnability gate.
    for (const p of frontierOf(s, nation)) { s.owner[p] = leader; s.pop[p] = 1e6; }
    const mine = new Set([...Array(s.n).keys()].filter((p) => s.owner[p] === nation));
    aiTurn(s, -1);
    expect(s.armies.some((a) => a.nation === nation)).toBe(true);   // it did raise troops
    for (const a of s.armies) if (a.nation === nation) expect(mine.has(a.prov)).toBe(true);
  });

  it("defaults to inert — the third parameter is optional and unbiased", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    expect(AI_LEADER_BIAS).toBeGreaterThan(1);        // 1 would be a no-op lever
    expect(aiObjective(s, nation)).toBe(aiObjective(s, nation, -1));
  });

  it("same seed, same game — the bias introduced no order-dependence", () => {
    const a = fresh(11), b = fresh(11);
    for (let t = 0; t < 8; t++) { endTurn(a, 0); endTurn(b, 0); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
    expect(a.armies).toEqual(b.armies);
  });
});
```

Add `AI_LEADER_BIAS` **and `type ArmyState`** to the import list at the top of
`src/engine/armySim.test.ts` (line 4). `ArmyState` is not currently imported there and the helper
signatures above need it; `defenceOf`, `aiTurn` and `endTurn` are already in that list.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/armySim.test.ts -t "AI_LEADER_BIAS"
```

Expected: FAIL — `AI_LEADER_BIAS` is undefined, and `aiObjective(s, nation, leader)` ignores its third argument so the "prefers the leader's province" assertion returns `Math.min(a, b)` instead of `b`.

- [ ] **Step 3: Add the constant and the weight helper**

In `src/engine/armySim.ts`, immediately after `export const AI_LEVY_FRAC = 0.25;` (line 251):

```ts
// A province owned by the race leader is worth more than its raw value — this is the whole
// leader-check. It only reorders targets the AI could already beat; it never overrides the
// winnability test in aiTurn. That restraint is deliberate: the winner of a battle loses
// def x WIN_LOSS_MULT x closeness, so close fights are ruinous and an AI pushed into the strongest
// nation would grind itself down. Set to 1 to restore the unbiased AI exactly.
export const AI_LEADER_BIAS = 2;

// `leader >= 0` is load-bearing: unowned provinces carry owner -1 and raceLeader returns -1 when
// nobody qualifies, so without the guard every wasteland would score as the leader's land.
function leaderWeight(s: ArmyState, prov: number, leader: number): number {
  return leader >= 0 && s.owner[prov] === leader ? AI_LEADER_BIAS : 1;
}
```

- [ ] **Step 4: Give `aiObjective` the optional leader**

In `src/engine/armySim.ts`, change the signature and the scoring line of `aiObjective` (line 256). Replace:

```ts
export function aiObjective(s: ArmyState, nation: number): number {
```

with:

```ts
export function aiObjective(s: ArmyState, nation: number, leader = -1): number {
```

and replace:

```ts
    const score = s.pop[p] / (1 + defenceOf(s, p, nation));
```

with:

```ts
    const score = leaderWeight(s, p, leader) * s.pop[p] / (1 + defenceOf(s, p, nation));
```

- [ ] **Step 5: Wire it into `aiTurn`**

In `src/engine/armySim.ts`, inside `aiTurn` (line 304), add the leader lookup **before** the per-nation loop so every nation in the turn reacts to the same leader:

```ts
  const nations = [...new Set([...s.owner].filter((o) => o >= 0 && o !== playerNation))].sort((a, b) => a - b);
  const leader = raceLeader(s);   // computed once: the turn's outcome must not depend on nation order
  for (const nation of nations) {
```

Then pass it to the objective — replace `const obj = aiObjective(s, nation);` with:

```ts
    const obj = aiObjective(s, nation, leader);
```

And weight the per-army fight target — replace:

```ts
        const score = s.pop[q] / (1 + d);
```

with:

```ts
        const score = leaderWeight(s, q, leader) * s.pop[q] / (1 + d);
```

Leave the line above it (`if (d >= army.men) continue;`) exactly as it is. That is the winnability gate.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/engine/armySim.test.ts -t "AI_LEADER_BIAS"
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite and type check**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all pass. Some pre-existing AI tests assert concrete game outcomes for a seed; if any now fail, **do not weaken the assertion** — the AI genuinely behaves differently, so update the expected value and note in the commit body which test changed and why.

- [ ] **Step 8: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): the AI concentrates on whoever is winning the race"
```

---

### Task 3: The player can see that they are the target

**Files:**
- Modify: `src/ui/armyApp.ts` (HUD construction, lines 256-268)
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `raceLeader(s)` from Task 1.
- Produces: the `.army-hud` text gains the segment ` · ⚠ 당신이 선두 — 주변국이 노립니다` exactly when the player is the race leader. No new exports.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/armyApp.test.ts`, inside the existing top-level `describe` block:

```ts
  it("stays silent at turn 0 — nobody has conquered anything yet, so nobody leads", () => {
    const base = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world);
    const playable = playableNations(base);
    expect(playable.length).toBeGreaterThan(1);
    // structural, not seed luck: startCounts is snapshotted at init, so every nation's `gained`
    // is exactly 0 at t0, and raceLeader requires gained > 0. No pick may produce the warning.
    for (const id of playable) {
      root.remove();
      root = document.createElement("div");
      document.body.appendChild(root);
      mountArmyApp(root, { seed: 1 });
      (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".army-hud")!.textContent).not.toContain("당신이 선두");
    }
  });

  it("warns once the player is actually ahead, and only while they are", () => {
    mountArmyApp(root, { seed: 23 });
    pickNation();
    // The HUD already prints both numbers the answer depends on: `정복 +N/M` is the player's
    // own gained, `추격 <name> +K/M` is the best rival's. So the test needs no mirror of the
    // app's internal state — it reads the same screen the player does.
    let sawLead = 0, sawQuiet = 0;
    for (let turn = 0; turn < 30; turn++) {
      const hud = root.querySelector(".army-hud")!.textContent!;
      const mine = Number((hud.match(/정복 ([+-]?\d+)\//) || [])[1]);
      const rivalMatch = hud.match(/추격 .*?([+-]?\d+)\/\d+/);
      const rival = rivalMatch ? Number(rivalMatch[1]) : -Infinity;
      const warned = hud.includes("당신이 선두");
      if (mine <= 0) { expect(warned).toBe(false); sawQuiet++; }
      else if (mine > rival) { expect(warned).toBe(true); sawLead++; }
      // mine > 0 && mine === rival is deliberately skipped: raceLeader breaks that tie on the
      // lower polity id, not in the player's favour, so these two numbers do not decide it.
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;                                   // the game reached an outcome
      playAggressively();
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(sawQuiet).toBeGreaterThan(0);                 // it was quiet before the first conquest
    expect(sawLead).toBeGreaterThan(0);                  // and it did fire once the player led
  });
```

`playAggressively()` is a helper you must add next to the existing `pickNation()` helper at the
top of the describe block: for the currently selected realm, levy where the panel offers it and
then click the first `button.army-move` whose label matches `/공격/`. The test at
`src/ui/armyApp.test.ts:196-200` already does exactly this inline — lift that pattern rather than
inventing a new one, and make it a no-op when neither button is present.

Seed 23 is named because the driver has to actually reach a conquest for `sawLead` to be
non-zero. If it does not on seed 23, try another seed and say in your report which you used and
why — do **not** weaken `expect(sawLead).toBeGreaterThan(0)`, which is what stops this test from
passing vacuously.

The imports this test needs from `"../engine/armySim"` (line 6) are `initArmySim` and
`playableNations`, both already there. It deliberately does **not** import `raceLeader` — it
reads the HUD's own numbers instead of recomputing the answer with the same function the
implementation uses, which would make the test agree with a bug.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/ui/armyApp.test.ts -t "race leader"
```

Expected: FAIL — `expect(warned).toBe(iLead)` gets `false` where `true` was expected, because the HUD never prints the warning.

- [ ] **Step 3: Add the warning to the HUD**

In `src/ui/armyApp.ts`, add `raceLeader` to the import from `"../engine/armySim"` (the block at lines 3-8). Then after the `rivalSeg` assignment (line 261-263) add:

```ts
    // Being in front now changes how the AI plays, so it has to be on screen: an unannounced
    // dogpile reads as the game being unfair rather than as a rule the player can play around.
    const leadSeg = raceLeader(s) === me ? " · ⚠ 당신이 선두 — 주변국이 노립니다" : "";
```

and append it to the HUD text (line 267) — change the end of that template literal from `${rivalSeg}` to `${rivalSeg}${leadSeg}`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/ui/armyApp.test.ts -t "race leader"
```

Expected: PASS.

- [ ] **Step 5: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts
git commit -m "feat(armyApp): the HUD tells you when the world is coming for you"
```

---

### Task 4: Measure — did it work, and did it backfire?

This task ships **no code**. Its deliverable is a written finding. The driver is a throwaway and must not be committed.

**Files:**
- Create (temporary, never committed): `src/engine/leaderCheck.measure.test.ts`

**Interfaces:**
- Consumes only API that exists **both** on this branch and on `d9708fb`: `initArmySim`, `setTheater`, `aiTurn`, `nationProgress`, `provinceCount`, `goalGain`, `playableNations`, `HORIZON`. This is what lets the same file run on both commits for a before/after comparison.

- [ ] **Step 1: Write the driver**

Create `src/engine/leaderCheck.measure.test.ts`:

```ts
import { describe, it } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initArmySim, setTheater, aiTurn, applyUpkeep, regrow, nationProgress, provinceCount, goalGain, playableNations, HORIZON } from "./armySim";

// THROWAWAY. An all-AI world (playerNation -1 means every nation is run by the AI) played to a
// decision, so the question "does the leader still run away with it" is asked without a human proxy.
describe("leader-check measurement", () => {
  it("reports the winner and the shape of the race", () => {
    for (const seed of [11, 23, 1, 7, 42]) {
      const s = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);
      const first = playableNations(s)[0];
      setTheater(s, first);
      const nations = playableNations(s);
      const goal = goalGain(s);
      let winner = -1, at = -1;
      for (let t = 0; t < HORIZON && winner < 0; t++) {
        aiTurn(s, -1); applyUpkeep(s); regrow(s); s.turn++;
        for (const n of nations) if (nationProgress(s, n).gained >= goal) { winner = n; at = t; break; }
      }
      const sizes = nations.map((n) => `${n}:${provinceCount(s, n)}`).join(" ");
      const gains = nations.map((n) => `${n}:${nationProgress(s, n).gained}`).join(" ");
      const armies = s.armies.filter((a) => nations.includes(a.nation)).length;
      console.log(`seed ${seed} goal ${goal} winner ${winner} turn ${at} | sizes ${sizes} | gained ${gains} | armies ${armies}`);
    }
  });
});
```

- [ ] **Step 2: Run it on this branch (bias on) and save the output**

```bash
npx vitest run src/engine/leaderCheck.measure.test.ts --reporter=verbose 2>&1 | tee "$SCRATCH/after.txt"
```

Expected: five `seed ... winner ...` lines. Record them.

- [ ] **Step 3: Run the same driver on the pre-change engine (bias off)**

The driver is untracked, so it survives a checkout. From a clean tree:

```bash
git stash list && git status --short
```

Expected: only `?? src/engine/leaderCheck.measure.test.ts`. If anything else is dirty, commit it first — the next step checks out another commit.

```bash
git switch --detach d9708fb && npx vitest run src/engine/leaderCheck.measure.test.ts --reporter=verbose 2>&1 | tee "$SCRATCH/before.txt"; git switch -
```

Expected: five lines from the unbiased AI. Confirm you are back on the working branch with `git status`.

- [ ] **Step 4: Compare and write the finding**

Answer these three questions in the commit body of the docs update, using the two outputs:

1. **Did the runaway stop?** In seed 11, is the winner still the same 29-province giant, and does it still win at roughly the same turn? If yes, mechanism B in the spec (production scales with size, the goal does not) is the cause and the leader-check did not address it. **Say so plainly — a null result is the finding.**
2. **Did it backfire?** Compare total `gained` across all nations and the surviving `armies` count, before vs after. If the AI world collectively conquered *less* and lost more armies, the bias is bleeding the AI the way `AI_ODDS_MIN` did, and `AI_LEADER_BIAS` should be lowered or the change reverted.
3. **Is the race closer?** Compare the gap between first and second place, before vs after.

- [ ] **Step 5: Delete the driver**

```bash
rm src/engine/leaderCheck.measure.test.ts && git status --short
```

Expected: clean tree. The driver must not appear in any commit.

- [ ] **Step 6: Record the finding in the spec**

Append a `## Measured result` section to `docs/superpowers/specs/2026-07-28-army-leader-check-design.md` with the before/after numbers and the answers to the three questions above.

```bash
git add docs/superpowers/specs/2026-07-28-army-leader-check-design.md
git commit -m "docs(plan): measured result of the army leader-check"
```

- [ ] **Step 7: Hand to the user for live play**

Bot measurement is a proxy and has been wrong on this engine before (`80dd8f4` was reverted after bot numbers pointed the wrong way). Report the numbers to the user and ask them to play a few rounds before merging to `main`. Do not push to `origin` without an explicit "push해".

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. Who counts as the leader (`raceLeader`, gained, player included, theater-only, tie lower id, -1) | Task 1 |
| `leadingRival` unchanged and kept | Task 1, Step 1 test asserts it still excludes the player |
| 2. `AI_LEADER_BIAS = 2`, both scoring sites, `leader >= 0` guard, optional `aiObjective` param | Task 2 |
| Winnability gate untouched | Task 2 Step 5 (explicit instruction) + Task 2 Step 1 test 3 |
| 3. Player must see it | Task 3 |
| 4. Determinism — no rng, identical game per seed | Task 2 Step 1 test 5 |
| 4. Leader computed once per turn (order-independence) | Task 2 Step 5 — structural, enforced by code placement and its comment; not observable through the public API |
| Testing section (all five bullets) | Tasks 1-3 tests |
| Measurement after merge (all three questions) | Task 4 |
| Reverting via the constant | Task 2 Step 1 test 4 documents the lever |

No gaps.

**Placeholder scan:** none — every code step carries the code, every command carries its expected output.

**Type consistency:** `raceLeader(s: ArmyState): number` is defined in Task 1 and consumed with that exact signature in Tasks 2, 3 and 4. `leaderWeight(s, prov, leader)` is module-private and used only within Task 2. `aiObjective`'s third parameter is named `leader` in both the definition and every call site. `AI_LEADER_BIAS` is spelled identically in the engine, both test files and the spec.
