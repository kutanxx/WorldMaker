# Army digestion backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conquered land unusable until a realm digests it, at a fixed rate that does not scale with realm size, so runaway conquest slows while steady growth does not.

**Architecture:** One optional `Int32Array` on `ArmyState` records the turn each province changed hands. `moveArmy`'s single ownership-transfer line marks it; `canLevy`'s single gate blocks it; a new `digest` step in `endTurn` clears the oldest `DIGEST_PER_TURN` per nation per turn. The UI marks raw provinces on the map, says why the levy button is unavailable, and reports the backlog in the HUD.

**Tech Stack:** TypeScript, Vitest (`jsdom` for UI tests), Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-army-digestion-backlog-design.md`

## Global Constraints

- **Determinism is a hard invariant.** No `Math.random()`, no `Date`, no iteration over a `Set` or `Map`'s keys without an explicit sort. Same seed + same commands must produce an identical game. Every tie-break resolves to the **lower id** — lower province id within a nation, lower polity id between nations.
- **`DIGEST_PER_TURN` is fixed and must never be scaled by realm size.** That is the entire design: a damper proportional to conquest *volume* taxes a small nation catching up as hard as a runaway, in relative terms harder. A fixed capacity taxes conquest *rate*. Measured rates separate cleanly — the steady 0.67/turn winner never accumulates a backlog, the 1.35/turn and 1.74/turn runaways accumulate forever.
- **Raw land blocks levy and nothing else.** It still supplies militia when attacked, still counts in province totals, and still counts toward the victory goal. Do not touch `militiaOf`, `defenceOf`, `provinceCount`, `goalGain`, or `nationProgress`.
- **New state fields are optional and lazily allocated**, mirroring the existing `leviedOn` field, so hand-built fixtures that predate them keep compiling and a missing array behaves as "nothing is raw".
- **The AI is deliberately not taught about this.** Do not modify `aiTurn`, `aiObjective`, `stepToward`, or `leaderWeight`. The AI over-eats and pays; that is the intent.
- Comments in this codebase explain *why*, not *what*. Match that.
- Commands: `npx vitest run <path>`, full suite `npx vitest run` (839 at baseline), `npx tsc --noEmit`, `npx vite build`.

---

### Task 1: The engine — raw land, the levy gate, and digestion

Marking, gating and digesting ship together on purpose. Marking without digestion would make every capture permanently unlevyable, which is not a state worth reviewing or testing against.

**Files:**
- Modify: `src/engine/armySim.ts` — `ArmyState` (line ~50), `canLevy` (line ~119), `moveArmy` capture block (line ~232), `endTurn` (line ~349), plus new exports
- Test: `src/engine/armySim.test.ts` (new `describe` block at the end)

**Interfaces:**
- Consumes: existing `ArmyState`, `moveArmy(s, prov, nation, target)`, `canLevy(s, prov, nation)`, `levy(s, prov, nation)`, `endTurn(s, playerNation)`, `armyAt`, `militiaOf`, `defenceOf`.
- Produces, all consumed by Tasks 2 and 3:
  - `ArmyState.raw?: Int32Array` — province → turn captured, `-1` when digested or never taken
  - `isRaw(s: ArmyState, prov: number): boolean`
  - `backlogOf(s: ArmyState, nation: number): number`
  - `digest(s: ArmyState): void`
  - `DIGEST_PER_TURN: number` (value `1`)

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts`:

```ts
describe("digestion (conquered land does not fight for you yet)", () => {
  const fresh = (seed: number) => initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

  // Takes an undefended neighbour with certain odds (no militia, no garrison -> defence 0, so the
  // battle roll cannot decide the test). Returns [captor, capturedProvince].
  function captureOne(s: ArmyState, nation: number): [number, number] {
    const target = [...Array(s.n).keys()]
      .find((p) => s.owner[p] !== nation && s.adj[p].some((q) => s.owner[q] === nation));
    expect(target).toBeDefined();                       // every seed-11 nation has a frontier
    const from = s.adj[target!].find((q) => s.owner[q] === nation)!;
    s.pop[target!] = 0;
    s.armies = s.armies.filter((a) => a.prov !== target);
    s.armies.push({ prov: from, nation, men: 500, movedOn: -1 });
    expect(moveArmy(s, from, nation, target!)?.captured).toBe(true);
    return [from, target!];
  }

  it("starting territory is not raw", () => {
    const s = fresh(11);
    for (let p = 0; p < s.n; p++) expect(isRaw(s, p)).toBe(false);
    const nation = [...s.owner].find((o) => o >= 0)!;
    expect(backlogOf(s, nation)).toBe(0);
  });

  it("capture marks the province raw, and raw land cannot be levied", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const [, taken] = captureOne(s, nation);
    expect(s.owner[taken]).toBe(nation);
    expect(isRaw(s, taken)).toBe(true);
    expect(backlogOf(s, nation)).toBe(1);
    s.pop[taken] = 1000;                    // plenty to raise, so ONLY rawness can block the levy
    expect(canLevy(s, taken, nation)).toBe(false);
    expect(levy(s, taken, nation)).toBe(0);
    expect(s.pop[taken]).toBe(1000);        // and nothing was taken from the land
  });

  it("digesting frees it — a conqueror at or below capacity is unaffected", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const [, taken] = captureOne(s, nation);
    s.pop[taken] = 1000;
    digest(s);
    expect(isRaw(s, taken)).toBe(false);
    expect(backlogOf(s, nation)).toBe(0);
    expect(canLevy(s, taken, nation)).toBe(true);
    expect(levy(s, taken, nation)).toBeGreaterThan(0);
  });

  it("captures beyond the fixed capacity accumulate a backlog", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const targets = [...Array(s.n).keys()]
      .filter((p) => s.owner[p] !== nation && s.adj[p].some((q) => s.owner[q] === nation))
      .slice(0, 3);
    expect(targets.length).toBe(3);         // seed 11's frontier is wide enough for three
    s.raw = new Int32Array(s.n).fill(-1);
    for (const t of targets) { s.owner[t] = nation; s.raw[t] = s.turn; }
    expect(backlogOf(s, nation)).toBe(3);
    digest(s);
    expect(backlogOf(s, nation)).toBe(Math.max(0, 3 - DIGEST_PER_TURN));
    digest(s);
    expect(backlogOf(s, nation)).toBe(Math.max(0, 3 - 2 * DIGEST_PER_TURN));
  });

  it("digests the oldest capture first", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const mine = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation).slice(0, 3);
    expect(mine.length).toBe(3);
    const [a, b, c] = mine;
    s.raw = new Int32Array(s.n).fill(-1);
    s.raw[a] = 9; s.raw[b] = 2; s.raw[c] = 5;   // b oldest, then c, then a
    digest(s);
    expect(isRaw(s, b)).toBe(false);            // oldest went first
    expect(isRaw(s, c)).toBe(true);
    expect(isRaw(s, a)).toBe(true);
  });

  it("breaks an age tie on the lower province id", () => {
    expect(DIGEST_PER_TURN).toBe(1);            // this test is written for a capacity of exactly 1
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const [x, y] = [...Array(s.n).keys()].filter((p) => s.owner[p] === nation).slice(0, 2);
    s.raw = new Int32Array(s.n).fill(-1);
    s.raw[x] = 4; s.raw[y] = 4;                 // same age; x < y since the filter runs ascending
    digest(s);
    expect(isRaw(s, x)).toBe(false);
    expect(isRaw(s, y)).toBe(true);
  });

  it("each nation digests its own backlog — one nation's captures do not consume another's capacity", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b).slice(0, 2);
    expect(nations.length).toBe(2);
    s.raw = new Int32Array(s.n).fill(-1);
    for (const n of nations) {
      for (const p of [...Array(s.n).keys()].filter((q) => s.owner[q] === n).slice(0, 2)) s.raw[p] = 1;
    }
    expect(nations.map((n) => backlogOf(s, n))).toEqual([2, 2]);
    digest(s);
    expect(nations.map((n) => backlogOf(s, n))).toEqual([2 - DIGEST_PER_TURN, 2 - DIGEST_PER_TURN]);
  });

  it("recapture makes it raw again", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const [, taken] = captureOne(s, nation);
    digest(s);
    expect(isRaw(s, taken)).toBe(false);
    const other = [...new Set([...s.owner].filter((o) => o >= 0 && o !== nation))].sort((a, b) => a - b)[0];
    s.pop[taken] = 0;
    s.armies = s.armies.filter((a) => a.prov !== taken);
    const from = s.adj[taken].find((q) => s.owner[q] !== nation) ?? s.adj[taken][0];
    s.owner[from] = other;
    s.armies.push({ prov: from, nation: other, men: 500, movedOn: -1 });
    expect(moveArmy(s, from, other, taken)?.captured).toBe(true);
    expect(isRaw(s, taken)).toBe(true);
  });

  it("raw land still defends — militia is untouched", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const attacker = [...new Set([...s.owner].filter((o) => o >= 0 && o !== nation))].sort((a, b) => a - b)[0];
    const p = [...Array(s.n).keys()].find((q) => s.owner[q] === nation)!;
    s.pop[p] = 500;
    const before = defenceOf(s, p, attacker);
    s.raw = new Int32Array(s.n).fill(-1);
    s.raw[p] = s.turn;
    expect(militiaOf(s, p)).toBe(Math.floor(500 * MILITIA_FRAC));
    expect(defenceOf(s, p, attacker)).toBe(before);
  });

  it("the AI is blocked by the same gate — a wholly raw realm raises nobody", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    s.raw = new Int32Array(s.n).fill(-1);
    for (let p = 0; p < s.n; p++) if (s.owner[p] === nation) s.raw[p] = s.turn;
    aiTurn(s, -1);
    // Its armies are the readout: with the gate in place the AI's levy raises nothing, so this
    // nation ends the turn with no men at all. (Do not also compare its population before and
    // after — another nation can take a province from it during the same aiTurn, which moves that
    // province's people out of the sum for reasons that have nothing to do with digestion.)
    const raised = s.armies.filter((a) => a.nation === nation).reduce((k, a) => k + a.men, 0);
    expect(raised).toBe(0);
  });

  it("endTurn digests, and the same seed still produces the same game", () => {
    const a = fresh(11), b = fresh(11);
    for (let t = 0; t < 8; t++) { endTurn(a, 0); endTurn(b, 0); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
    expect([...(a.raw ?? [])]).toEqual([...(b.raw ?? [])]);
    expect(a.armies).toEqual(b.armies);
  });
});
```

Add `isRaw`, `backlogOf`, `digest`, `DIGEST_PER_TURN` and `type ArmyState` to the import list at the top of `src/engine/armySim.test.ts` (line 4). `moveArmy`, `levy`, `canLevy`, `endTurn`, `aiTurn`, `defenceOf`, `militiaOf` and `MILITIA_FRAC` are already there.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/armySim.test.ts -t "digestion"
```

Expected: FAIL — `isRaw`, `backlogOf`, `digest` and `DIGEST_PER_TURN` are undefined, so the block errors on import.

- [ ] **Step 3: Add the state field**

In `src/engine/armySim.ts`, inside `interface ArmyState` (after the `leviedOn` field, around line 50):

```ts
  // Freshly conquered land does not fight for you yet: the turn a province changed hands, or -1
  // once it has been digested (and for land nobody has taken). Optional and lazily allocated for
  // the same reason as leviedOn — fixtures built before this field existed must keep behaving as
  // "nothing is raw".
  raw?: Int32Array;
```

- [ ] **Step 4: Add the accessors and the digestion step**

In `src/engine/armySim.ts`, immediately after the `leviedOnArr` helper (around line 114):

```ts
// the digestion clock, allocated on first use so hand-built fixtures without it still work.
function rawArr(s: ArmyState): Int32Array {
  if (!s.raw || s.raw.length !== s.n) s.raw = new Int32Array(s.n).fill(-1);
  return s.raw;
}

// Still being digested: it cannot be levied. Its people do still take up arms as militia when it is
// attacked — they are there, they just will not march for a conqueror they met last week.
export function isRaw(s: ArmyState, prov: number): boolean {
  if (prov < 0 || prov >= s.n) return false;
  return rawArr(s)[prov] >= 0;
}

// How much of a realm is still being digested. Derived from the provinces rather than stored per
// nation, so a province that changes hands leaves one backlog and joins the other with no
// bookkeeping that could fall out of sync.
export function backlogOf(s: ArmyState, nation: number): number {
  const arr = rawArr(s);
  let k = 0;
  for (let p = 0; p < s.n; p++) if (s.owner[p] === nation && arr[p] >= 0) k++;
  return k;
}
```

Then, immediately before `endTurn` (around line 349):

```ts
// How many provinces a realm absorbs per turn. FIXED, and deliberately NOT scaled by realm size —
// that is the whole design. A damper proportional to conquest VOLUME taxes a small nation catching
// up as hard as a runaway (in relative terms harder, since it must conquer more of its own size to
// compete). A fixed capacity taxes the RATE instead, and the measured rates separate cleanly: the
// steady winner gained 0.67/turn and never accumulates a backlog, while the runaways gained
// 1.35 and 1.74/turn and accumulate forever.
export const DIGEST_PER_TURN = 1;

// Each nation absorbs its oldest raw provinces. Deterministic: nations ascending, and within a
// nation oldest-captured first with ties on the lower province id.
export function digest(s: ArmyState): void {
  const arr = rawArr(s);
  const byNation = new Map<number, number[]>();
  for (let p = 0; p < s.n; p++) {
    const o = s.owner[p];
    if (o < 0 || arr[p] < 0) continue;
    const list = byNation.get(o);
    if (list) list.push(p); else byNation.set(o, [p]);
  }
  for (const nation of [...byNation.keys()].sort((a, b) => a - b)) {
    const list = byNation.get(nation)!.sort((x, y) => (arr[x] - arr[y]) || (x - y));
    for (let i = 0; i < DIGEST_PER_TURN && i < list.length; i++) arr[list[i]] = -1;
  }
}
```

- [ ] **Step 5: Mark on capture and gate the levy**

In `src/engine/armySim.ts`, in `moveArmy`'s capture block, directly after `s.owner[target] = nation;` (around line 232):

```ts
    rawArr(s)[target] = s.turn;   // the one line ownership changes on, so no capture can skip this
```

In `canLevy` (around line 119), after the ownership check and before the `maxLevy` check:

```ts
  if (isRaw(s, prov)) return false;   // still digesting: the land is yours, its men are not
```

- [ ] **Step 6: Digest at the end of the turn**

In `src/engine/armySim.ts`, change `endTurn` (around line 349) to:

```ts
export function endTurn(s: ArmyState, playerNation: number): void {
  aiTurn(s, playerNation);
  applyUpkeep(s);
  regrow(s);
  digest(s);      // after this turn's captures, so a conqueror at capacity levies its prize next turn
  s.turn++;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/engine/armySim.test.ts -t "digestion"
```

Expected: PASS, 11 tests.

- [ ] **Step 8: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass. **Some pre-existing tests capture a province and then levy it.** With digestion running in `endTurn`, a capture is digested at the end of the same turn, so a test that captures on turn T and levies on turn T+1 still works — but one that captures and levies *within the same turn* now correctly gets 0. If such a test fails, do **not** weaken its assertion. Work out what it was really testing: if the point was "levy works", give it a province that is not freshly captured; if the point was the capture, leave the levy out. Say in your report exactly which test changed and why.

- [ ] **Step 9: Verify the gate is load-bearing**

Temporarily delete the `if (isRaw(s, prov)) return false;` line from `canLevy`, confirm the "raw land cannot be levied" and "the AI is blocked by the same gate" tests FAIL, then restore it exactly and confirm they pass. Do the same for `rawArr(s)[target] = s.turn;` in `moveArmy` — the "capture marks the province raw" test must fail without it. Report both observations, and confirm with `git diff` that the file is byte-identical afterwards.

- [ ] **Step 10: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): conquered land has to be digested before it will fight for you"
```

---

### Task 2: The player can see the backlog

The player's new decision is *how fast to expand*. A player who cannot see the backlog cannot pace anything, so this is not decoration — it is the half of the feature that makes it playable.

**Files:**
- Modify: `src/ui/armyApp.ts` — the import block (line ~3), the province hit path and label (lines ~114-138), the levy button label (lines ~215-220), the HUD line (line ~267)
- Test: `src/ui/armyApp.test.ts`

**Interfaces:**
- Consumes: `isRaw(s, prov)` and `backlogOf(s, nation)` from Task 1.
- Produces: `data-raw="1"` on `.army-prov` for raw provinces; a `⌛` prefix on the `.army-num` label; the levy button text `소화 중 — 아직 징집할 수 없습니다`; a ` · 소화 대기 N` HUD segment shown only when `N > 0`. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/armyApp.test.ts`, inside the existing top-level describe block:

```ts
  const myRaw = () => [...root.querySelectorAll('.army-prov[data-raw="1"][data-mine="1"]')];

  // Plays aggressively until the PLAYER holds raw land. The check runs BEFORE the end-turn click,
  // not after: digestion happens in endTurn, so a single capture is absorbed the moment the turn
  // ends and a check on the next iteration would find nothing. `data-mine` filters out the AI's
  // own fresh conquests, which are marked too but are not what the HUD counts.
  function pushUntilCapture(maxTurns: number): boolean {
    for (let t = 0; t < maxTurns; t++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) return false;
      for (const p of root.querySelectorAll('.army-prov[data-mine="1"]')) {
        p.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const lv = root.querySelector("button.army-levy") as HTMLButtonElement | null;
        if (lv && !lv.disabled) lv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const atk = [...root.querySelectorAll("button.army-move")]
          .find((b) => /공격/.test(b.textContent || "")) as HTMLButtonElement | undefined;
        if (atk && !atk.disabled) atk.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      if (myRaw().length > 0) return true;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    return false;
  }

  it("nothing is raw at turn 0 — no marks, no backlog in the HUD", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    expect(root.querySelector('.army-prov[data-raw="1"]')).toBeNull();
    expect(root.querySelector(".army-hud")!.textContent).not.toContain("소화 대기");
    expect(root.querySelector(".army-map")!.textContent).not.toContain("⌛");
  });

  it("a freshly taken province is marked on the map and counted in the HUD", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    expect(pushUntilCapture(12)).toBe(true);      // the driver must actually take something
    const raw = myRaw();
    expect(raw.length).toBeGreaterThan(0);
    // every one of them carries the map marker on its own number label
    for (const r of raw) {
      const id = r.getAttribute("data-prov");
      const label = root.querySelector(`.army-num[data-prov="${id}"]`);
      expect(label?.textContent).toContain("⌛");
    }
    // and the HUD counts exactly the player's own backlog, not the whole world's
    expect(root.querySelector(".army-hud")!.textContent).toContain(`소화 대기 ${raw.length}`);
  });

  it("the levy button says why it is unavailable, instead of just being dead", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    expect(pushUntilCapture(12)).toBe(true);
    myRaw()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const btn = root.querySelector("button.army-levy") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("소화 중");
    expect(btn.textContent).not.toContain("징집 완료");   // the two reasons must not be confused
  });
```

`pickNation` already exists at the top of that describe block. No new imports are needed — these tests read the DOM only.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/armyApp.test.ts -t "raw"
npx vitest run src/ui/armyApp.test.ts -t "소화"
```

Expected: FAIL — no element ever carries `data-raw`, so `pushUntilCapture` exhausts its turns and returns `false`.

- [ ] **Step 3: Import the accessors**

In `src/ui/armyApp.ts`, add `isRaw` and `backlogOf` to the existing import from `"../engine/armySim"` (the block starting at line 3).

- [ ] **Step 4: Mark raw provinces on the map**

In `src/ui/armyApp.ts`, in the per-province loop (around line 117), add the attribute to the hit path:

```ts
      const hit = svgEl("path", {
        class: "army-prov" + (sel === p ? " sel" : ""), "data-prov": String(p), "data-mine": mine ? "1" : "0",
        "data-polity": String(s.owner[p]), "data-raw": isRaw(s, p) ? "1" : "0",
        d: byProv[p], fill: sel === p ? "rgba(232,181,58,0.35)" : "transparent", stroke: "none",
      });
```

Then mark the number label (around line 137). Replace:

```ts
        label.textContent = army ? `${Math.round(s.pop[p])}·⚔${army.men}` : `${Math.round(s.pop[p])}`;
```

with:

```ts
        // ⌛ on the number rather than a new map layer: the label is already where this province's
        // numbers live, and a raw province's population is exactly the number that is not available.
        const digesting = isRaw(s, p) ? "⌛" : "";
        label.textContent = army
          ? `${digesting}${Math.round(s.pop[p])}·⚔${army.men}`
          : `${digesting}${Math.round(s.pop[p])}`;
```

- [ ] **Step 5: Say why the levy button is unavailable**

In `src/ui/armyApp.ts` (around line 219), replace:

```ts
      ? `징집 (+${levyAmount}명, 인구 −${levyAmount})`
      : "징집 완료 (이번 턴)";
```

with:

```ts
      ? `징집 (+${levyAmount}명, 인구 −${levyAmount})`
      // two different reasons the button is dead, and the player needs to tell them apart: one
      // clears next turn, the other clears when the realm has digested what it swallowed.
      : isRaw(s, p) ? "소화 중 — 아직 징집할 수 없습니다"
      : "징집 완료 (이번 턴)";
```

- [ ] **Step 6: Report the backlog in the HUD**

In `src/ui/armyApp.ts`, after the `leadSeg` assignment (around line 268) add:

```ts
    // Only when there is one: a permanent "소화 대기 0" is noise, and this line is already long.
    const backlog = backlogOf(s, me);
    const digestSeg = backlog > 0 ? ` · 소화 대기 ${backlog}` : "";
```

and append it to the HUD text — change the end of that template literal from `${rivalSeg}${leadSeg}` to `${rivalSeg}${leadSeg}${digestSeg}`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/ui/armyApp.test.ts
```

Expected: PASS, 35 tests (32 baseline + 3 new).

- [ ] **Step 8: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts
git commit -m "feat(armyApp): show what the realm is still digesting"
```

---

### Task 3: Measure — did the map freeze?

Ships **no code**. The deliverable is a written finding. The driver is a throwaway and must not be committed.

**Files:**
- Create (temporary, never committed): `src/engine/digest.measure.test.ts`

**Interfaces:**
- Consumes `initArmySim`, `setTheater`, `aiTurn`, `applyUpkeep`, `regrow`, `digest`, `nationProgress`, `provinceCount`, `backlogOf`, `goalGain`, `playableNations`, `HORIZON`, `DIGEST_PER_TURN`.

- [ ] **Step 1: Write the driver**

Create `src/engine/digest.measure.test.ts`:

```ts
import { describe, it } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initArmySim, setTheater, aiTurn, applyUpkeep, regrow, digest, nationProgress, provinceCount, backlogOf, goalGain, playableNations, HORIZON, DIGEST_PER_TURN } from "./armySim";

// THROWAWAY. All-AI worlds run to a decision, so the question "did this freeze the map" is asked
// without a human proxy standing in for one of the players.
describe("digestion measurement", () => {
  it("reports the winner, the spread and the backlog", () => {
    console.log(`DIGEST_PER_TURN=${DIGEST_PER_TURN}`);
    for (const seed of [11, 23, 1, 7, 42]) {
      const s = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);
      setTheater(s, playableNations(s)[0]);
      const nations = playableNations(s);
      const goal = goalGain(s);
      let winner = -1, at = -1;
      for (let t = 1; t <= HORIZON && winner < 0; t++) {
        aiTurn(s, -1); applyUpkeep(s); regrow(s); digest(s); s.turn++;
        for (const n of nations) if (nationProgress(s, n).gained >= goal) { winner = n; at = t; break; }
      }
      const gains = nations.map((n) => nationProgress(s, n).gained);
      const top = [...gains].sort((a, b) => b - a);
      const totalGain = gains.filter((g) => g > 0).reduce((a, b) => a + b, 0);
      const backlog = nations.map((n) => backlogOf(s, n)).reduce((a, b) => a + b, 0);
      const turns = winner >= 0 ? at : HORIZON;
      console.log(
        `seed ${seed} | goal ${goal} | winner ${winner} @t${at} | best ${top[0]} 2nd ${top[1] ?? 0}` +
        ` | totalGain ${totalGain} | rate ${(totalGain / turns).toFixed(2)}/turn | backlog ${backlog}` +
        ` | biggest ${Math.max(...nations.map((n) => provinceCount(s, n)))}`,
      );
    }
  });
});
```

- [ ] **Step 2: Run it with digestion on**

```bash
npx vitest run src/engine/digest.measure.test.ts --reporter=verbose
```

Record the five lines.

- [ ] **Step 3: Run it with digestion off**

`DIGEST_PER_TURN` set high enough that no backlog can ever form is the spec's documented revert, and it is bit-identical to the pre-feature engine because `digest` then clears everything it finds every turn. Edit `src/engine/armySim.ts` to `export const DIGEST_PER_TURN = 9999;`, re-run the command from Step 2, record the lines, then set it back to `1` and confirm with `git diff` that the file is byte-identical.

Do **not** use `git switch`/`git checkout` to get the "before" numbers — the constant is the supported lever and leaves git untouched.

- [ ] **Step 4: Answer the questions, in this order**

1. **Did the map freeze?** This is the first question, not the last. The leader-check already cost 14–91% of the per-turn conquest rate. If `totalGain`/turn has now collapsed further and no seed produces a winner, the game is quieter rather than better — say so plainly and recommend raising `DIGEST_PER_TURN` or lowering the goal, rather than reporting the absence of runaways as a success.
2. **Did the runaways slow?** Compare `best`, `biggest` and the winning turn.
3. **Did the field close up, or did everyone just slow together?** Compare `best` minus `2nd` before and after. A smaller gap only means something if `2nd` went *up*.
4. What are the end-of-game backlogs? A large residual backlog on the leader is the mechanism working; a large one on everybody means the capacity is simply too low for this map size.

- [ ] **Step 5: Delete the driver**

```bash
rm src/engine/digest.measure.test.ts && git status --short
```

Expected: clean tree. The driver must not appear in any commit.

- [ ] **Step 6: Record the finding in the spec**

Append a `## Measured result` section to `docs/superpowers/specs/2026-07-28-army-digestion-backlog-design.md` with the before/after table and the answers to all four questions above.

```bash
git add docs/superpowers/specs/2026-07-28-army-digestion-backlog-design.md
git commit -m "docs(plan): measured result of the digestion backlog"
```

- [ ] **Step 7: Hand to the user for live play**

Bot measurement is a proxy and has been wrong on this engine before. Report the numbers and ask the user to play before merging. Do not merge to `main` or push to `origin` without an explicit go-ahead. The question a bot cannot answer is spec measurement item 3: does pacing expansion actually beat over-eating for a human player? If "take everything you can" is still optimal, the lever did nothing for the player and only taxed the AI.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. Raw provinces (`raw?: Int32Array`, optional + lazy, start not raw, recapture re-marks) | Task 1 Steps 3-5 + tests 1, 2, 8 |
| 2. Capture marks at the single ownership line | Task 1 Step 5 + test 2; Step 9 proves it load-bearing |
| 3. Fixed digestion capacity, oldest first, ties lower id | Task 1 Step 4 + tests 4, 5, 6, 7 |
| Rawness is per-province, backlog derived | Task 1 `backlogOf` + test 7 (per-nation independence) |
| 4. Blocks levy only; militia, counts and goal untouched | Task 1 Step 5 + tests 2, 9; Global Constraints forbid touching the rest |
| The AI goes through the same gate | Task 1 test 10 |
| 5. Player must see it — map, button reason, HUD backlog | Task 2, all three, one test each |
| 6. AI not taught | Global Constraints (do not modify `aiTurn` et al.) |
| 7. Determinism | Task 1 Step 4 (sorted `Map` keys, explicit tie-break) + test 11 |
| Testing section, all nine bullets | Task 1 tests 1-11, Task 2 tests 1-3 |
| Measurement — freeze first, then runaways, field, backlog | Task 3 Step 4, in that order |
| Reverting via `DIGEST_PER_TURN` | Task 3 Step 3 uses it as the revert |

No gaps.

**Placeholder scan:** none — every code step carries its code, every command its expected output.

**Type consistency:** `isRaw(s: ArmyState, prov: number): boolean`, `backlogOf(s: ArmyState, nation: number): number`, `digest(s: ArmyState): void` and `DIGEST_PER_TURN: number` are defined in Task 1 and used with those exact signatures in Tasks 2 and 3. The private helper `rawArr` is used only inside `armySim.ts`. `ArmyState.raw` is spelled identically in the interface, the helper, the tests and the determinism assertion.
