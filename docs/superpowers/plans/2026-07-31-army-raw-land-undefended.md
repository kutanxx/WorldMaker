# Raw land does not defend itself — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make restraint pay by giving conquered land no militia until it is digested, so holding fresh conquests means leaving troops behind instead of pressing on.

**Architecture:** One constant and one line in `militiaOf`. Both consumers — `defenceOf` and `moveArmy`'s militia-loss — go through that function, so they stay consistent for free, and `aiObjective`'s existing `pop / (1 + defence)` scoring turns an over-eater's fresh land into the board's most attractive target with no AI change. The UI restores the hourglass on enemy land (now actionable) and renames the HUD counter to claim only what it counts.

**Tech Stack:** TypeScript, Vitest (`jsdom` for UI tests), Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-army-raw-land-undefended-design.md`

## Global Constraints

- **Determinism is a hard invariant.** No `Math.random()`, no `Date`, no `Set`/`Map` key iteration without an explicit sort. Same seed + same commands must produce an identical game. Tie-breaks resolve to the **lower id**.
- **`RAW_MILITIA_FRAC = 1` must restore the previous behaviour exactly.** The factor multiplies *inside* the `Math.floor`, never scaling an already-rounded result — otherwise the revert drifts by one man on some populations.
- **Only the militia term changes.** Garrisons on a raw province defend at full strength. Do not touch `defenceOf`'s army loop, `provinceCount`, `goalGain`, `nationProgress`, `canLevy`, `digest`, or `DIGEST_PER_TURN`.
- **The AI is not modified.** `aiTurn`, `aiObjective`, `stepToward`, `leaderWeight` stay as they are — the new counter-pressure is supposed to emerge from `aiObjective`'s existing scoring, and one test asserts exactly that.
- Comments explain *why*, not *what*.
- Commands: `npx vitest run <path>`, full suite `npx vitest run` (859 at baseline), `npx tsc --noEmit`, `npx vite build`.

---

### Task 1: The engine — raw land mounts no militia

**Files:**
- Modify: `src/engine/armySim.ts` — `militiaOf` (line ~185) and a new constant beside it
- Test: `src/engine/armySim.test.ts` — one existing test inverted, one new `describe` block

**Interfaces:**
- Consumes: `isRaw(s, prov)`, `digest(s)`, `militiaOf(s, prov)`, `defenceOf(s, prov, attacker)`, `moveArmy(s, prov, nation, target)`, `aiObjective(s, nation, leader?)`, `MILITIA_FRAC`, `BIOME_DEF`.
- Produces: `RAW_MILITIA_FRAC: number` (exported const, value `0`). Task 3 reads it.

- [ ] **Step 1: Invert the test that asserts the opposite of this spec**

`src/engine/armySim.test.ts` contains a test named **`"raw land still defends — militia is untouched"`**, whose body is:

```ts
    const nation = [...s.owner].find((o) => o >= 0)!;
    const attacker = [...new Set([...s.owner].filter((o) => o >= 0 && o !== nation))].sort((a, b) => a - b)[0];
    const p = [...Array(s.n).keys()].find((q) => s.owner[q] === nation)!;
    s.pop[p] = 500;
    const before = defenceOf(s, p, attacker);
    s.raw = new Int32Array(s.n).fill(-1);
    s.raw[p] = s.turn;
    expect(militiaOf(s, p)).toBe(Math.floor(500 * MILITIA_FRAC));
    expect(defenceOf(s, p, attacker)).toBe(before);
```

**Delete that test.** Its replacement is the first test of the new block below. Do not simply loosen it — the behaviour it pins is being deliberately removed, and the new block asserts the opposite.

- [ ] **Step 2: Write the failing tests**

Append to `src/engine/armySim.test.ts`:

```ts
describe("raw land does not defend itself", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  it("mounts no militia while raw, and its normal militia once digested", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const p = [...Array(s.n).keys()].find((q) => s.owner[q] === nation)!;
    s.pop[p] = 500;
    expect(militiaOf(s, p)).toBe(Math.floor(500 * MILITIA_FRAC));   // digested land is unchanged
    s.raw![p] = s.turn;
    expect(militiaOf(s, p)).toBe(0);
    digest(s);                                                      // p is this nation's only raw land
    expect(militiaOf(s, p)).toBe(Math.floor(500 * MILITIA_FRAC));
  });

  it("loses exactly the militia term, while a garrison standing on it still counts in full", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const attacker = [...new Set([...s.owner].filter((o) => o >= 0 && o !== nation))].sort((a, b) => a - b)[0];
    const p = [...Array(s.n).keys()].find((q) => s.owner[q] === nation)!;
    s.armies = s.armies.filter((a) => a.prov !== p);
    s.pop[p] = 500;
    const mult = BIOME_DEF[s.world.provinces[p].biome] ?? 1;
    expect(defenceOf(s, p, attacker)).toBeCloseTo(Math.floor(500 * MILITIA_FRAC) * mult, 9);
    s.raw![p] = s.turn;
    expect(defenceOf(s, p, attacker)).toBe(0);                      // nothing left to hold it
    s.armies.push({ prov: p, nation, men: 120, movedOn: -1 });
    expect(defenceOf(s, p, attacker)).toBeCloseTo(120 * mult, 9);   // the garrison is untouched
  });

  it("leaves digested land completely alone at every population", () => {
    // Fails if the factor is applied unconditionally instead of only to raw land.
    const s = fresh(11);
    const p = [...Array(s.n).keys()].find((q) => s.owner[q] >= 0)!;
    for (const pop of [0, 1, 4, 5, 501, 5000]) {
      s.pop[p] = pop;
      expect(militiaOf(s, p)).toBe(Math.floor(pop * MILITIA_FRAC));
    }
  });

  it("capturing raw land destroys no population — there was nobody under arms to die", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const target = [...Array(s.n).keys()]
      .find((q) => s.owner[q] !== nation && s.adj[q].some((x) => s.owner[x] === nation))!;
    const from = s.adj[target].find((q) => s.owner[q] === nation)!;
    s.armies = s.armies.filter((a) => a.prov !== target && a.prov !== from);
    s.pop[target] = 500;
    s.raw![target] = s.turn;                       // its current owner had only just taken it
    s.armies.push({ prov: from, nation, men: 900, movedOn: -1 });
    expect(moveArmy(s, from, nation, target)?.captured).toBe(true);
    expect(s.pop[target]).toBe(500);
  });

  it("makes an over-eater's fresh conquest the most attractive target the AI can see", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const frontier = [...Array(s.n).keys()]
      .filter((q) => s.owner[q] !== nation && s.adj[q].some((x) => s.owner[x] === nation));
    expect(frontier.length).toBeGreaterThan(1);    // seed 11's frontier is wide
    const [a, b] = frontier;
    s.armies = s.armies.filter((x) => x.prov !== a && x.prov !== b);
    for (const q of frontier) if (q !== a && q !== b) s.pop[q] = 0;   // isolate the comparison
    s.pop[a] = 400; s.pop[b] = 400;
    // Mark whichever one the AI did NOT already want, so the flip is attributable to rawness and
    // not to the two provinces happening to differ in terrain.
    const pickBefore = aiObjective(s, nation);
    const other = pickBefore === a ? b : a;
    s.raw![other] = s.turn;
    expect(aiObjective(s, nation)).toBe(other);
  });

  it("same seed, same game — no rng crept in", () => {
    const a = fresh(11), b = fresh(11);
    for (let t = 0; t < 8; t++) { endTurn(a, 0); endTurn(b, 0); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
    expect([...a.raw!]).toEqual([...b.raw!]);
    expect(a.armies).toEqual(b.armies);
  });
});
```

Add `RAW_MILITIA_FRAC` to the import list at the top of `src/engine/armySim.test.ts` (line 4). `militiaOf`, `defenceOf`, `moveArmy`, `aiObjective`, `digest`, `endTurn`, `MILITIA_FRAC` and `BIOME_DEF` are already there.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/engine/armySim.test.ts -t "raw land does not defend"
```

Expected: FAIL — `RAW_MILITIA_FRAC` is undefined, so the block errors on import.

- [ ] **Step 4: Write the implementation**

In `src/engine/armySim.ts`, replace `militiaOf` and its comment (around line 184-188):

```ts
// What a conquered province's militia is worth to its new owner. 0: they will not fight for someone
// they met last week. This is what gives RESTRAINT a benefit rather than giving greed another cost —
// holding fresh land now means leaving troops on it, which splits the army that would take the next
// province. Set to 1 to restore the previous behaviour exactly.
export const RAW_MILITIA_FRAC = 0;

// the province's own people take up arms when attacked. Computed at battle time, so a province
// hollowed out by over-levying really is defenceless. Militia cannot move. Land still being
// digested musters nobody — the factor goes INSIDE the floor so RAW_MILITIA_FRAC = 1 is bit-identical
// to the un-factored expression rather than drifting by a man on some populations.
export function militiaOf(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * MILITIA_FRAC * (isRaw(s, prov) ? RAW_MILITIA_FRAC : 1));
}
```

Leave `defenceOf` exactly as it is — it already reads `militiaOf`, so it follows automatically.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/engine/armySim.test.ts -t "raw land does not defend"
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full suite and type check**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: all pass. Several existing tests set a province raw and then assert battle numbers; defence values genuinely change now, so a failure is real behaviour, not a broken test. Do **not** weaken any assertion — work out whether the new value is correct, update it, and say in your report exactly which test changed, from what to what, and why.

- [ ] **Step 7: Verify the change is load-bearing**

Temporarily set `RAW_MILITIA_FRAC = 1`, confirm the first, second and fifth tests of the new block FAIL, then set it back to `0` and confirm they pass. Report the observation with actual output, and confirm with `git diff` that the file is byte-identical afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): conquered land will not fight for its new owner"
```

---

### Task 2: The UI — the enemy's soft land becomes visible again

**Files:**
- Modify: `src/ui/armyApp.ts` — the `⌛` marker (line ~140-148), the levy button copy and its comment (line ~226-234), the HUD backlog segment (line ~294-296)
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `isRaw(s, prov)`, `backlogOf(s, nation)`, `militiaOf(s, prov)` — all already imported in `armyApp.ts`.
- Produces: `⌛` on every raw province with a label; HUD segment ` · 내 소화 대기 N`; levy button text `소화 중 — 징집 불가, 주민도 싸우지 않음`. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/armyApp.test.ts`, inside the existing top-level describe block:

```ts
  it("marks an enemy's fresh conquest too — it is now the softest target on the board", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    let enemyRaw: Element[] = [];
    for (let t = 0; t < 12 && enemyRaw.length === 0; t++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      enemyRaw = [...root.querySelectorAll('.army-prov[data-raw="1"][data-mine="0"]')];
    }
    // the AI conquers within 12 turns on seed 11; if it ever stops, this fails loudly rather
    // than skipping the assertions below
    expect(enemyRaw.length).toBeGreaterThan(0);
    const labelled = enemyRaw
      .map((e) => root.querySelector(`.army-num[data-prov="${e.getAttribute("data-prov")}"]`))
      .filter(Boolean);
    expect(labelled.length).toBeGreaterThan(0);   // in-theater raw land carries a label
    for (const l of labelled) expect(l!.textContent).toContain("⌛");
  });

  it("the HUD counts only the player's own backlog, and its label says so", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    expect(pushUntilCapture(12)).toBe(true);
    expect(root.querySelector(".army-hud")!.textContent).toContain(`내 소화 대기 ${myRaw().length}`);
  });

  it("a selected raw province reads 민병 0 and the levy button names both consequences", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    expect(pushUntilCapture(12)).toBe(true);
    myRaw()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-sel")!.textContent).toContain("민병 0");
    const btn = root.querySelector("button.army-levy") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("소화 중");
    expect(btn.textContent).toContain("주민도 싸우지 않음");   // the consequence that can lose the province
  });
```

No new imports are needed — these read the DOM only.

`pushUntilCapture(maxTurns)` and `myRaw()` **already exist** at the top of that describe block, added
by the digestion feature: `myRaw()` returns the player's own raw provinces
(`.army-prov[data-raw="1"][data-mine="1"]`), and `pushUntilCapture` plays aggressively until the
player holds raw land, checking **before** each end-turn click because digestion absorbs a single
capture the moment the turn ends. Reuse them — do not re-inline that loop.

The first test above cannot use `pushUntilCapture`, because it needs the *AI* to have conquered
rather than the player, which is why it ends turns without acting.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/armyApp.test.ts -t "softest target"
npx vitest run src/ui/armyApp.test.ts -t "내 소화 대기"
npx vitest run src/ui/armyApp.test.ts -t "민병 0"
```

Expected: FAIL — enemy labels carry no `⌛`, the HUD says `소화 대기` without `내`, and the button text lacks `주민도 싸우지 않음`.

- [ ] **Step 3: Put the hourglass back on every raw province**

In `src/ui/armyApp.ts`, replace the marker block (the comment plus the `const digesting = …` line, around lines 138-148):

```ts
        // ⌛ on the number rather than a new map layer: the label is already where this province's
        // numbers live, and a raw province's population is exactly the number that is not available.
        // Shown for EVERY nation's raw land, not just the player's: raw land musters no militia, so
        // an enemy's hourglass marks the softest target on the board — the most actionable thing
        // this feature produces. The HUD's counter says "내 소화 대기" precisely so that showing all
        // of them here cannot be read as a claim about the player's own backlog.
        const digesting = isRaw(s, p) ? "⌛" : "";
```

- [ ] **Step 4: Make the levy button name both consequences**

In `src/ui/armyApp.ts`, the levy button has a comment about precedence containing the clause *"a capture strips militia, so a near-empty province is exactly what raw land looks like right after it changes hands"*. That clause is now false — a raw province loses no militia on capture, because it had none. Replace that comment with:

```ts
    // Three distinct reasons the button can read, and rawness must be checked before the
    // empty-population case: a freshly captured province can be both raw AND under-populated after
    // a long siege of levying by its previous owner. Rawness is the reason that will not clear next
    // turn — the player needs that, not "+0명" — so it must win the precedence.
```

Then change the raw branch's text from `"소화 중 — 아직 징집할 수 없습니다"` to:

```ts
      : isRaw(s, p) ? "소화 중 — 징집 불가, 주민도 싸우지 않음"
```

The second clause is the one that matters most: it tells the player the province cannot hold itself, and implies the answer — leave your own men there.

- [ ] **Step 5: Rename the HUD segment**

In `src/ui/armyApp.ts` (around line 296), change:

```ts
    const digestSeg = backlog > 0 ? ` · 소화 대기 ${backlog}` : "";
```

to:

```ts
    const digestSeg = backlog > 0 ? ` · 내 소화 대기 ${backlog}` : "";
```

and extend the comment above it to say why the possessive is there: the map now shows every nation's raw land, so the counter must claim only what it counts.

- [ ] **Step 6: Correct the stale comment in the UI test file**

`src/ui/armyApp.test.ts` has a comment on the pre-existing marker test asserting that raw land *"defends like normal land (militiaOf/defenceOf never consult `raw`), so the marker is only meaningful … for the player's own backlog"*. That justification is now false. Rewrite it to state the current rule: raw land musters no militia, the marker is shown for every nation, and the player's own backlog is what the HUD counts.

If that test selects markers with `[data-mine="1"]`, leave the selector — scoping to the player's own land still describes the player's backlog correctly, and the new enemy-marker test covers the rest.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/ui/armyApp.test.ts
```

Expected: PASS, 40 tests (37 baseline + 3 new). Two pre-existing assertions reference `소화 대기` and still match inside `내 소화 대기`; update them to the new string anyway so the expected text is exact rather than incidentally a substring.

- [ ] **Step 8: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts
git commit -m "feat(armyApp): show every realm's undigested land, not just your own"
```

---

### Task 3: Measure — does land ping-pong, and does pacing finally win?

Ships **no code**. The deliverable is a written finding. The driver is a throwaway and must not be committed.

**Files:**
- Create (temporary, never committed): `src/engine/rawDefence.measure.test.ts`

**Interfaces:**
- Consumes `initArmySim`, `setTheater`, `aiTurn`, `applyUpkeep`, `regrow`, `digest`, `nationProgress`, `provinceCount`, `goalGain`, `playableNations`, `HORIZON`, `RAW_MILITIA_FRAC`.

- [ ] **Step 1: Write the driver**

Create `src/engine/rawDefence.measure.test.ts`:

```ts
import { describe, it } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initArmySim, setTheater, aiTurn, applyUpkeep, regrow, digest, nationProgress, provinceCount, goalGain, playableNations, HORIZON, RAW_MILITIA_FRAC } from "./armySim";

// THROWAWAY. All-AI worlds. The headline question is whether the front turns into a revolving door,
// so ownership changes are counted per province across the whole game.
describe("raw-defence measurement", () => {
  it("reports churn, the winner and the spread", () => {
    console.log(`RAW_MILITIA_FRAC=${RAW_MILITIA_FRAC}`);
    for (const seed of [11, 23, 1, 7, 42]) {
      const s = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);
      setTheater(s, playableNations(s)[0]);
      const nations = playableNations(s);
      const goal = goalGain(s);
      const flips = new Int32Array(s.n);
      let prev = Int32Array.from(s.owner);
      let winner = -1, at = -1;
      for (let t = 1; t <= HORIZON && winner < 0; t++) {
        aiTurn(s, -1); applyUpkeep(s); regrow(s); digest(s); s.turn++;
        for (let p = 0; p < s.n; p++) if (s.owner[p] !== prev[p]) flips[p]++;
        prev = Int32Array.from(s.owner);
        for (const n of nations) if (nationProgress(s, n).gained >= goal) { winner = n; at = t; break; }
      }
      const turns = winner >= 0 ? at : HORIZON;
      const totalFlips = [...flips].reduce((a, b) => a + b, 0);
      const maxFlips = Math.max(...flips);
      const churned = [...flips].filter((f) => f >= 4).length;
      const gains = nations.map((n) => nationProgress(s, n).gained);
      const top = [...gains].sort((a, b) => b - a);
      const totalGain = gains.filter((g) => g > 0).reduce((a, b) => a + b, 0);
      console.log(
        `seed ${seed} | goal ${goal} | winner ${winner} @t${at}` +
        ` | FLIPS total ${totalFlips} max ${maxFlips} provsFlipped4+ ${churned}` +
        ` | best ${top[0]} 2nd ${top[1] ?? 0} | totalGain ${totalGain}` +
        ` | rate ${(totalGain / turns).toFixed(2)}/turn | biggest ${Math.max(...nations.map((n) => provinceCount(s, n)))}`,
      );
    }
  });
});
```

- [ ] **Step 2: Run it with the feature on**

```bash
npx vitest run src/engine/rawDefence.measure.test.ts --reporter=verbose
```

Record the five lines.

- [ ] **Step 3: Run it with the feature off**

Edit `src/engine/armySim.ts` to `export const RAW_MILITIA_FRAC = 1;` — the spec's documented revert — re-run the command from Step 2, record the lines, then set it back to `0` and confirm with `git diff` that the file is byte-identical.

Do **not** use `git switch`/`git checkout` for the "before" numbers. The constant is the supported lever and leaves git untouched.

- [ ] **Step 4: Answer the questions, in this order**

1. **Does land ping-pong?** Compare `FLIPS total`, `max` and `provsFlipped4+` before and after. Recapture re-marks a province raw, so a contested province can be permanently soft. If churn has jumped — especially `provsFlipped4+` — the front has become a revolving door and `RAW_MILITIA_FRAC` must go up. Report this first and plainly; it is the failure mode this design most plausibly has.
2. **Does pacing now beat greed?** This must be answered by playing, not by the all-AI driver, and it is the entire point of the work. Report the numbers you have and hand this question to the controller for live play.
3. The standing checks: `best`, `2nd`, `biggest`, `rate`.

- [ ] **Step 5: Delete the driver**

```bash
rm src/engine/rawDefence.measure.test.ts && git status --short
```

Expected: clean tree. The driver must not appear in any commit.

- [ ] **Step 6: Record the finding in the spec**

Append a `## Measured result` section to `docs/superpowers/specs/2026-07-31-army-raw-land-undefended-design.md` with the before/after table and the answers above. **Write the full table first and the conclusions after it, and name every seed that moved against the change** — the two preceding features in this repo both had their measurement writeups corrected in review for omitting exactly that.

```bash
git add docs/superpowers/specs/2026-07-31-army-raw-land-undefended-design.md
git commit -m "docs(plan): measured result of raw land losing its militia"
```

- [ ] **Step 7: Hand to the controller for live play**

The decisive experiment is seed 11 as the 29-province giant at 1, 3 and unlimited attacks per turn — the exact runs that showed greedy dominating and produced this spec. **If greedy still wins, report it as a failure**, not as a partial success with favourable side effects. Do not merge or push without an explicit go-ahead.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. `RAW_MILITIA_FRAC = 0`, factor inside the floor, revert is bit-identical | Task 1 Steps 4, 7 + tests 1, 3 |
| Garrisons still defend normally | Task 1 test 2 |
| 2. AI unchanged; counter-pressure emerges from `aiObjective` | Global Constraints + Task 1 test 5 |
| 3. One touch point; `militiaLost` follows | Task 1 Step 4 + test 4 |
| `previewMove` follows automatically | No task needed — it calls the same `resolve`; Global Constraints forbid touching it |
| 4. `민병 0` free from the panel; attack rows free; levy copy names both | Task 2 Steps 4, 7 + test 3 |
| 5. `⌛` returns to all raw land; HUD becomes `내 소화 대기`; two stale comments | Task 2 Steps 3, 5, 6 + tests 1, 2 |
| 6. The contradicting test is inverted, not deleted silently | Task 1 Step 1 (deleted) + Step 2 (replacement asserts the opposite) |
| Testing section, all eight bullets | Task 1 tests 1-6, Task 2 tests 1-3 |
| Measurement — ping-pong first, then pacing, then standing checks | Task 3 Step 4, in that order |
| Reverting via `RAW_MILITIA_FRAC` | Task 3 Step 3 uses it as the revert |

No gaps.

**Placeholder scan:** none — every code step carries its code, every command its expected output.

**Type consistency:** `RAW_MILITIA_FRAC: number` is defined in Task 1 and read in Task 3 with that exact name. `militiaOf(s, prov)`, `defenceOf(s, prov, attacker)` and `isRaw(s, prov)` keep their existing signatures — no call site changes. `⌛`, `내 소화 대기` and `주민도 싸우지 않음` are spelled identically in the implementation steps and the tests that assert them.
