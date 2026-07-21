# Province Defection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make politically isolated, far-flung provinces defect to the rival pressing them, so thin overextension (especially overseas conquests taken by sea-lane expedition) costs you something.

**Architecture:** A pure `pressureOf` compares a province's friendly vs. hostile LAND neighbours, its own garrison, and its distance from its owner's capital. A per-province `unrest` counter rises while pressure dominates and resets the moment it lifts; at `UNREST_FLIP` the province flips whole to the pressing rival in a double-buffered `revoltPass` that runs after the contest. The UI shows a countdown badge with its REASON and a remedy hint, matching the `explainAttack` precedent.

**Tech Stack:** TypeScript, Vitest, hand-rolled SVG DOM. rng-free deterministic engine.

## Global Constraints

- **rng-free / deterministic:** no rng anywhere. Ties break by lower id. Two runs byte-identical.
- **Fork isolation:** `src/engine/provinceSim.ts` gains NO new import (not `historySim.ts` / `playSim.ts` / `intervention.ts` / the cell sim). Version A golden `polityOf` FNV = `1350115163` stays byte-identical.
- **Goldens:** the init-owner hash `226648593` and Version A `1350115163` MUST stay unchanged. The 50-tick AI-world hash (currently `2803010495`) and the player-path hash (currently `2070567107`) WILL change in Task 2 — re-pin by running the test, reading the ACTUAL value, and replacing the literal.
- **Constants (starting values, confirmed by Task 4's measurement):** `UNREST_FLIP = 3`, `REVOLT_SELF = 2`, `REVOLT_DIST = 0.003`.
- **Pressure uses LAND adjacency (`s.adj`) only — never `laneAdj`.** This is what guarantees deep interiors never defect and overseas conquests are the most at-risk.
- **A capital province never defects** (no nation may be eliminated without combat).
- **`tsc --noEmit` must stay clean.** `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters`; a declaration added before its first use breaks the build. Test-fixture `grid.points` must be typed `number[]`, never `Float64Array`.
- **i18n:** every user-facing string KO + EN.
- **Non-static test is a signal, not a target:** if `"is not static"` breaks after Task 2, STOP and report the numbers — do NOT tune constants to force it.

---

## File Structure

- `src/engine/provinceSim.ts` — MODIFY: `unrest` state field, `unrestArr`, `pressureOf`, `defectionRisk`, `revoltPass`, wiring into both step functions, `defections` on `PlayerStepEvents`.
- `src/engine/provinceSim.test.ts` — MODIFY: pressure/reason units, countdown/flip behaviour, re-pinned goldens.
- `src/ui/provinceApp.ts` — MODIFY: at-risk ring overlay, risk panel with reason + remedy hint, defection log lines.
- `src/ui/provinceApp.test.ts` — MODIFY: DOM test for the badge/reason/hint.
- `src/theme.css` — MODIFY: risk panel + ring rules.

---

### Task 1: Pressure model — `pressureOf`, `defectionRisk`, reason

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: existing `ProvinceSimState` (`provOwner`, `provSol`, `adj`, `capitalProv`, `provinces`), the module-local `centroidDist(a: Province, b: Province): number`.
- Produces:
  - `ProvinceSimState.unrest?: Int32Array` (optional — hand-built fixtures omit it)
  - `function unrestArr(s: ProvinceSimState): Int32Array` (module-local; lazily allocates)
  - `function pressureOf(s, p): { hold: number; press: number; rival: number; ownN: number; foeN: number; dist: number } | null` (module-local; `null` when unowned or a capital)
  - `export type DefectionReason = "isolated" | "far" | "shaky"`
  - `export interface DefectionRisk { turnsLeft: number; reason: DefectionReason; ownN: number; foeN: number; rival: number }`
  - `export function defectionRisk(s: ProvinceSimState, p: number): DefectionRisk | null` — `null` when the province is not currently under dominant pressure.

This task is PURE: no stepping code calls it yet, so every existing golden stays byte-identical.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/provinceSim.test.ts`:

```ts
import { defectionRisk } from "./provinceSim";

describe("defection pressure", () => {
  // 5 provinces in a row. Player 0 owns prov 1 (a lone salient); rival 1 owns 0, 2, 3; prov 4 unowned.
  // capitals: nation 0 → prov 1?? no — nation 0's capital is prov 1 only in the capital test below.
  // Here nation 0's capital is a FAR province 4 slot is unowned, so we give nation 0 capital = prov 1's
  // neighbour-free stand-in: we set capitalProv[0] = 1 only in the "capital never defects" case.
  function row(over: Record<string, unknown> = {}): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2, 3, 4].map((i) => ({
      id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4,
    }));
    return {
      provinces, n: 5,
      provOwner: Int32Array.from([1, 0, 1, 1, -1]),
      provSol: Float32Array.from([0.5, 0.5, 0.5, 0.5, 0]),
      adj: [[1], [0, 2], [1, 3], [2, 4], [3]],
      laneAdj: [[], [], [], [], []],
      capitalProv: Int32Array.from([3, 0]), // nation 0's capital = prov 3 (NOT owned by it — fine, alive is recomputed elsewhere); nation 1's = prov 0
      alive: [true, true], unrest: new Int32Array(5), tick: 0, ...over,
    } as ProvinceSimState;
  }

  it("flags a lone salient pressed by more hostile land neighbours than friendly ones", () => {
    // prov 1 is owned by 0; its land neighbours are prov 0 and prov 2, BOTH owned by rival 1.
    // ownN = 0, foeN = 2 → press(2) > hold(0 + 2*0.5 - dist term) → at risk, rival = 1.
    const r = defectionRisk(row(), 1)!;
    expect(r).not.toBeNull();
    expect(r.rival).toBe(1);
    expect(r.ownN).toBe(0);
    expect(r.foeN).toBe(2);
    expect(r.turnsLeft).toBe(3); // UNREST_FLIP - unrest(0)
    expect(r.reason).toBe("isolated");
  });

  it("never flags a deep interior province, however low its solidarity", () => {
    // nation 1 owns prov 2 and both its neighbours (1 and 3) → foeN = 0 → no pressure at any solidarity.
    const s = row({
      provOwner: Int32Array.from([1, 1, 1, 1, -1]),
      provSol: Float32Array.from([0, 0, 0, 0, 0]), // fully decayed interior
      capitalProv: Int32Array.from([-1, 0]),
    });
    expect(defectionRisk(s, 2)).toBeNull();
  });

  it("ignores unowned neighbours — wilderness neither supports nor pressures", () => {
    // prov 3 owned by 1; neighbours are prov 2 (owned by 1 → friendly) and prov 4 (unowned → ignored).
    const s = row({ capitalProv: Int32Array.from([-1, 0]) });
    expect(defectionRisk(s, 3)).toBeNull(); // ownN=1, foeN=0
  });

  it("ignores lane neighbours — pressure is a land-border phenomenon", () => {
    // give prov 1 a LANE to rival-owned prov 3 as well; the verdict must be unchanged by it.
    const withLane = defectionRisk(row({ laneAdj: [[], [3], [], [1], []] }), 1)!;
    const plain = defectionRisk(row(), 1)!;
    expect(withLane.foeN).toBe(plain.foeN); // lane partner did NOT add pressure
  });

  it("never flags a capital province", () => {
    // make prov 1 nation 0's capital — same hostile surroundings, but capitals cannot defect.
    expect(defectionRisk(row({ capitalProv: Int32Array.from([1, 0]) }), 1)).toBeNull();
  });

  it("reports 'far' when distance is the dominant term and 'shaky' when the garrison is", () => {
    // FAR: one friendly + one hostile neighbour (isolated gap = 0), but the capital is far away.
    const far = defectionRisk(row({
      provOwner: Int32Array.from([0, 0, 1, 1, -1]),  // prov 1 owned by 0, neighbour 0 friendly, 2 hostile
      provSol: Float32Array.from([1, 1, 0.5, 0.5, 0]), // full garrison → shaky term 0
      capitalProv: Int32Array.from([0, 2]),
      provinces: [0, 1, 2, 3, 4].map((i) => ({
        id: i, name: String(i), cells: 10, centroid: [i === 0 ? 5000 : i * 10, 0] as [number, number], seedCell: i, biome: 4,
      })),
    }), 1);
    expect(far?.reason).toBe("far");

    // SHAKY: one friendly + one hostile (isolated gap 0), capital adjacent (dist ~10 → far term ~0.03),
    // but solidarity 0 → the missing garrison (REVOLT_SELF * 1 = 2) dominates.
    const shaky = defectionRisk(row({
      provOwner: Int32Array.from([0, 0, 1, 1, -1]),
      provSol: Float32Array.from([1, 0, 0.5, 0.5, 0]),
      capitalProv: Int32Array.from([0, 2]),
    }), 1);
    expect(shaky?.reason).toBe("shaky");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "defection pressure"`
Expected: FAIL — `defectionRisk is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/engine/provinceSim.ts`:

(a) Add the constants next to the other tuning constants near the top of the file:

```ts
const UNREST_FLIP = 3;      // turns a province may sit under dominant foreign pressure before it defects
const REVOLT_SELF = 2;      // how much a fully-solid garrison counts toward holding a province (in neighbours)
const REVOLT_DIST = 0.003;  // hold lost per unit of centroid distance from the owner's capital
```

(b) Add `unrest` to the state interface (optional, like `laneAdj`):

```ts
export interface ProvinceSimState {
  provinces: Province[];
  n: number;
  provOwner: Int32Array;
  provSol: Float32Array;
  adj: number[][];
  laneAdj?: number[][];
  unrest?: Int32Array;     // province → consecutive turns under dominant foreign pressure (defection clock)
  capitalProv: Int32Array;
  alive: boolean[];
  tick: number;
}
```

(c) Add the helpers. Place them after `centroidDist` (which they use):

```ts
// the defection clock, allocated on first use so hand-built fixtures without it still work.
function unrestArr(s: ProvinceSimState): Int32Array {
  if (!s.unrest || s.unrest.length !== s.n) s.unrest = new Int32Array(s.n);
  return s.unrest;
}

// Local political balance around province p: how strongly its owner holds it vs. the strongest rival
// pressing on it. LAND adjacency only — a sea lane is a military route, not a shared border, so an
// island (no land neighbours) is never pressured and a deep interior always has press = 0.
// null when the province is unowned or is its owner's capital (capitals never defect).
function pressureOf(s: ProvinceSimState, p: number):
  { hold: number; press: number; rival: number; ownN: number; foeN: number; dist: number } | null {
  const o = s.provOwner[p];
  if (o < 0 || s.capitalProv[o] === p) return null;
  let ownN = 0;
  const byRival = new Map<number, number>();
  for (const q of s.adj[p]) {
    const r = s.provOwner[q];
    if (r < 0) continue;              // wilderness: no support, no pull
    if (r === o) ownN++;
    else byRival.set(r, (byRival.get(r) ?? 0) + 1);
  }
  let rival = -1, foeN = 0;
  for (const [r, k] of byRival) if (k > foeN || (k === foeN && r < rival)) { foeN = k; rival = r; }
  const cap = s.capitalProv[o];
  const dist = cap >= 0 ? centroidDist(s.provinces[p], s.provinces[cap]) : 0;
  const hold = ownN + REVOLT_SELF * s.provSol[p] - REVOLT_DIST * dist;
  return { hold, press: foeN, rival, ownN, foeN, dist };
}

// why a province is slipping — the largest term pushing `press` above `hold`, mirroring how
// explainAttack names its dominant factor.
export type DefectionReason = "isolated" | "far" | "shaky";
export interface DefectionRisk { turnsLeft: number; reason: DefectionReason; ownN: number; foeN: number; rival: number }

// Is province p currently slipping away from its owner, and if so why and how long is left?
// null when it is not under dominant pressure (or cannot defect at all).
export function defectionRisk(s: ProvinceSimState, p: number): DefectionRisk | null {
  const pr = pressureOf(s, p);
  if (!pr || pr.press <= pr.hold) return null;
  const terms: [DefectionReason, number][] = [
    ["isolated", pr.foeN - pr.ownN],                   // outnumbered on the ground
    ["far", REVOLT_DIST * pr.dist],                    // beyond the capital's reach
    ["shaky", REVOLT_SELF * (1 - s.provSol[p])],       // the garrison it is MISSING
  ];
  terms.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const left = UNREST_FLIP - unrestArr(s)[p];
  return { turnsLeft: left < 0 ? 0 : left, reason: terms[0][0], ownN: pr.ownN, foeN: pr.foeN, rival: pr.rival };
}
```

Note: `unrestArr` and `pressureOf` are both used by `defectionRisk`, so `noUnusedLocals` is satisfied immediately.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "defection pressure"`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify nothing else moved**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → full suite green, ALL FOUR goldens unchanged (`226648593`, `2803010495`, `2070567107`, `1350115163`). No stepping code calls the new helpers yet, so any golden change means something leaked — STOP and report BLOCKED if so.

- [ ] **Step 6: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): defection pressure model (land-adjacency hold vs press) + risk reason"
```

---

### Task 2: `revoltPass` — countdown, flip, wiring, golden re-pin

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `pressureOf`, `unrestArr`, `UNREST_FLIP`, `CONQUEST_SOL` (Task 1 + existing).
- Produces:
  - `interface Defection { prov: number; from: number; to: number }` (module-local shape)
  - `function revoltPass(s: ProvinceSimState): Defection[]` (module-local)
  - `PlayerStepEvents.defections: { prov: number; from: number; to: number }[]`
  - `stepProvinceSim` and `stepPlayerTurn` both run `revoltPass` after the contest.

This task changes both stepping paths, so re-pin the two game goldens at the end.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/provinceSim.test.ts`:

```ts
describe("defection — countdown and flip", () => {
  // prov 1 belongs to nation 0 but is surrounded by nation 1's provinces 0 and 2. Nation 0's capital is
  // prov 3 (which nation 1 also holds — irrelevant here; what matters is prov 1 is not a capital).
  function salient(over: Record<string, unknown> = {}): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2, 3].map((i) => ({
      id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4,
    }));
    return {
      provinces, n: 4,
      provOwner: Int32Array.from([1, 0, 1, 0]),
      provSol: Float32Array.from([0.5, 0.5, 0.5, 0.5]),
      adj: [[1], [0, 2], [1, 3], [2]],
      laneAdj: [[], [], [], []],
      capitalProv: Int32Array.from([3, 0]),
      alive: [true, true], unrest: new Int32Array(4), tick: 0, ...over,
    } as ProvinceSimState;
  }

  it("counts up while pressed and flips to the pressing rival at UNREST_FLIP", () => {
    const s = salient();
    stepProvinceSim(s);
    expect(s.provOwner[1]).toBe(0); expect(s.unrest![1]).toBe(1); // pressed, not yet gone
    stepProvinceSim(s);
    expect(s.provOwner[1]).toBe(0); expect(s.unrest![1]).toBe(2);
    stepProvinceSim(s);
    expect(s.provOwner[1]).toBe(1);  // defected to nation 1
    expect(s.unrest![1]).toBe(0);    // clock reset for the new owner
  });

  it("resets the clock the moment the pressure lifts", () => {
    const s = salient();
    stepProvinceSim(s);
    expect(s.unrest![1]).toBe(1);
    s.provOwner[0] = 0; s.provOwner[2] = 0; // its neighbours become friendly
    stepProvinceSim(s);
    expect(s.unrest![1]).toBe(0);
  });

  it("never defects a capital province", () => {
    // make prov 1 nation 0's capital: same hostile surroundings, but it must never flip.
    const s = salient({ capitalProv: Int32Array.from([1, 0]) });
    for (let t = 0; t < 10; t++) stepProvinceSim(s);
    expect(s.provOwner[1]).toBe(0);
    expect(s.alive[0]).toBe(true); // and so nation 0 is never eliminated without combat
  });

  it("a conquest resets the defection clock, so fresh land gets its FULL grace period", () => {
    // A(0) holds prov 0 (capital) + prov 1 and is cohesive; B(1) holds prov 2 (weak) plus 3, 4 and its
    // capital 5. Prov 2 already has 2 turns of unrest on the clock from B's side. A conquers prov 2.
    // Prov 2 is genuinely pressed afterwards (1 friendly vs 3 hostile land neighbours), so:
    //   - WITH the conquest reset: clock 0 → 1, and A keeps the province.
    //   - WITHOUT it: clock 2 → 3 = UNREST_FLIP, and it would defect straight back to B the same tick.
    // Asserting A still owns it therefore tests the reset, not a tautology.
    const provinces: Province[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      id: i, name: String(i), cells: 20, centroid: [i * 10, 0], seedCell: i, biome: 4,
    }));
    const s = {
      provinces, n: 6,
      provOwner: Int32Array.from([0, 0, 1, 1, 1, 1]),
      provSol: Float32Array.from([0.9, 0.9, 0.1, 0.1, 0.1, 0.1]),
      adj: [[1], [0, 2], [1, 3, 4, 5], [2], [2], [2]],
      laneAdj: [[], [], [], [], [], []],
      capitalProv: Int32Array.from([0, 5]),
      alive: [true, true],
      unrest: Int32Array.from([0, 0, 2, 0, 0, 0]), // prov 2 was already wavering under B
      tick: 0,
    } as ProvinceSimState;
    const ev = stepPlayerTurn(s, 0, new Set([2]));
    expect(ev.conquests).toContainEqual({ prov: 2, from: 1, to: 0 }); // A took it
    expect(s.provOwner[2]).toBe(0);   // …and KEPT it — the clock restarted instead of firing
    expect(s.unrest![2]).toBe(1);     // one fresh turn of pressure, not the inherited 2
    expect(ev.defections).toEqual([]);
  });

  it("stepPlayerTurn reports defections as events", () => {
    // the player is nation 0 and loses its salient after UNREST_FLIP quiet turns.
    const s = salient();
    let ev = stepPlayerTurn(s, 0, new Set());
    expect(ev.defections).toEqual([]);
    ev = stepPlayerTurn(s, 0, new Set());
    expect(ev.defections).toEqual([]);
    ev = stepPlayerTurn(s, 0, new Set());
    expect(ev.defections).toEqual([{ prov: 1, from: 0, to: 1 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "countdown and flip"`
Expected: FAIL — no defection happens; `ev.defections` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/engine/provinceSim.ts`:

(a) Reset the defection clock whenever a conquest changes hands. In `contestPass`, change the post-loop line:

```ts
  s.provOwner = nextOwner;
  const clock = unrestArr(s);
  for (const c of conquered) { s.provSol[c.prov] = CONQUEST_SOL; clock[c.prov] = 0; } // fresh conquest: cohesive, full grace
  return conquered;
```

(b) Add `revoltPass` after `contestPass`:

```ts
interface Defection { prov: number; from: number; to: number }

// double-buffered defection: every province under dominant foreign pressure ticks its clock up (and
// resets the instant the pressure lifts); at UNREST_FLIP it flips WHOLE to the rival pressing hardest.
// Decided from pre-defection ownership so defections cannot cascade within one tick. Capitals are
// excluded by pressureOf, so no nation is ever eliminated without combat.
function revoltPass(s: ProvinceSimState): Defection[] {
  const clock = unrestArr(s);
  const nextOwner = s.provOwner.slice();
  const defections: Defection[] = [];
  for (let p = 0; p < s.n; p++) {
    const pr = pressureOf(s, p);
    if (!pr || pr.press <= pr.hold) { clock[p] = 0; continue; }
    clock[p]++;
    if (clock[p] >= UNREST_FLIP) {
      nextOwner[p] = pr.rival;
      defections.push({ prov: p, from: s.provOwner[p], to: pr.rival });
    }
  }
  s.provOwner = nextOwner;
  for (const d of defections) { clock[d.prov] = 0; s.provSol[d.prov] = CONQUEST_SOL; } // new owner starts fresh
  return defections;
}
```

(c) Wire it into `stepProvinceSim`:

```ts
export function stepProvinceSim(s: ProvinceSimState): void {
  stepSolidarity(s);
  contestPass(s, aiAttacker(s, -1)); // -1 = no player; every nation may auto-initiate
  revoltPass(s);
  recomputeAlive(s);
  s.tick++;
}
```

(d) Add `defections` to the events interface:

```ts
export interface PlayerStepEvents {
  conquests: { prov: number; from: number; to: number }[];
  defections: { prov: number; from: number; to: number }[];
  eliminated: number[];
}
```

(e) Wire it into `stepPlayerTurn` — insert the `revoltPass` call after the ATTACK_EXHAUST loop and before `recomputeAlive`, and return the defections:

```ts
  const defected = revoltPass(s);
  recomputeAlive(s);
  s.tick++;
  const conquests = conquered.map((c) => ({ prov: c.prov, from: prevOwner[c.prov], to: s.provOwner[c.prov] }));
  const defections = defected.map((d) => ({ prov: d.prov, from: d.from, to: d.to }));
  const eliminated: number[] = [];
  for (let id = 0; id < s.alive.length; id++) if (prevAlive[id] && !s.alive[id]) eliminated.push(id);
  return { conquests, defections, eliminated };
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "countdown and flip"`
Expected: PASS (5 tests).

- [ ] **Step 5: Re-pin the two game goldens**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Two golden tests now FAIL with `expected <NEW> to be 2803010495` (50-tick) and `expected <NEW> to be 2070567107` (player-path). Copy each ACTUAL value and replace the literal, appending ` — re-pinned with defection` to each trailing comment.

The init hash `226648593` and Version A `1350115163` MUST still pass unchanged. If either fails, STOP and report BLOCKED (defection leaked into init or into the cell sim).

- [ ] **Step 6: Guard the non-static signal**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "not static"`
Expected: PASS (`aliveEnd < aliveStart` and `topEnd !== topStart`).
**If it FAILS, STOP and report the before/after numbers** — do NOT adjust constants to force it; that is balance data for the human.

- [ ] **Step 7: Full verification + commit**

Run: `npx tsc --noEmit` → clean. Run `npx vitest run` → all green.

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): province defection — unrest clock flips isolated land to the pressing rival"
```

---

### Task 3: UI — at-risk ring, reason + remedy panel, defection log

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `defectionRisk(s, p): DefectionRisk | null` and `DefectionReason` (Task 1); `PlayerStepEvents.defections` (Task 2); the existing `provinceOutlinePath(u, provId): string` helper in `provinceApp.ts`.
- Produces: `export function defectionReasonText(reason: DefectionReason, ownN: number, foeN: number, lang: "ko" | "en"): string` (pure, exported for unit test).

- [ ] **Step 1: Write the failing test**

Add to `src/ui/provinceApp.test.ts`. First READ the file to match how its existing tests mount and start a game, then adapt these lines to that harness while keeping the assertions:

```ts
import { defectionReasonText } from "./provinceApp";

describe("defectionReasonText (a warning always says why)", () => {
  it("phrases each reason in the chosen language, with the neighbour counts for 'isolated'", () => {
    expect(defectionReasonText("isolated", 1, 4, "ko")).toContain("고립");
    expect(defectionReasonText("isolated", 1, 4, "ko")).toContain("4");
    expect(defectionReasonText("far", 1, 2, "ko")).toContain("멂");
    expect(defectionReasonText("shaky", 1, 2, "en")).toContain("garrison");
    expect(defectionReasonText("far", 1, 2, "en")).toContain("far");
  });
});

describe("defection warning in play mode", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("shows a countdown badge with its reason, a ring on the map, and a remedy hint", () => {
    mountProvinceApp(root, { seed: SEED, lang: "ko" });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // advance until the player actually has land at risk (found deterministically — see Step 1a)
    for (let t = 0; t < TURNS; t++) {
      (root.querySelector(".prov-advance") as HTMLButtonElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const panel = root.querySelector(".prov-risk")!;
    expect(panel).toBeTruthy();                                       // the warning renders at all
    const row = panel.querySelector(".prov-risk-row")!;
    expect(row.textContent || "").toMatch(/이탈 \d턴/);                // countdown
    expect(row.textContent || "").toMatch(/고립|멂|수비/);              // …and the REASON
    expect(panel.querySelector(".prov-risk-hint")!.textContent || "").toMatch(/내실/); // …and the remedy
    expect(root.querySelectorAll(".prov-map .prov-risk-ring").length).toBeGreaterThan(0); // …and the map ring
  });
});
```

**Step 1a — find `SEED` and `TURNS` deterministically before writing the test above.** The engine is rng-free, so a fixed seed/turn pair reproduces exactly. Write a THROWAWAY script that, for seeds 1–20, plays the all-armable policy as the first live polity and reports the first turn at which any player-owned province has `defectionRisk(s, p) !== null`:

```ts
// throwaway — delete after reading the numbers
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim, stepPlayerTurn, armableTargets, defectionRisk } from "../engine/provinceSim";
for (let seed = 1; seed <= 20; seed++) {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  const s = initProvinceSim(world);
  const pid = s.alive.findIndex(Boolean);
  for (let t = 1; t <= 12 && s.alive[pid]; t++) {
    stepPlayerTurn(s, pid, new Set(armableTargets(s, pid)));
    let n = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === pid && defectionRisk(s, p)) n++;
    if (n > 0) { console.log(`seed ${seed}: at-risk from turn ${t} (${n})`); break; }
  }
}
```

Pick the smallest `(seed, turn)` it reports, hard-code them as `SEED`/`TURNS` constants in the test, DELETE the throwaway script, and confirm the test passes unconditionally. If NO seed produces an at-risk province within 12 turns, do not weaken the test — report that as a finding: the mechanic never fires under normal play and the constants need Task 4's tuning first.

Note: the DOM test clicks `.prov-advance` `TURNS` times. If a dilemma card blocks the turn (the app hides the advance button until a dilemma is resolved), resolve it by clicking `.prov-choice` first — the existing "survive 50 turns" test in this file already does this; copy that loop's pattern.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "defection"`
Expected: FAIL — `defectionReasonText` is not exported; no `.prov-risk` element.

- [ ] **Step 3: Implement the reason text**

In `src/ui/provinceApp.ts`, add next to the existing `reasonText` helper:

```ts
// a defection warning always says WHY, the same contract explainAttack follows for attacks.
export function defectionReasonText(reason: DefectionReason, ownN: number, foeN: number, lang: "ko" | "en"): string {
  if (lang === "ko") {
    return reason === "isolated" ? `고립됨 (적 이웃 ${foeN} · 내 이웃 ${ownN})`
      : reason === "far" ? "수도에서 너무 멂"
      : "수비가 약함";
  }
  return reason === "isolated" ? `isolated (${foeN} hostile vs ${ownN} friendly)`
    : reason === "far" ? "too far from your capital"
    : "its garrison is thin";
}
```

Add `DefectionReason` and `defectionRisk` to the existing import from `../engine/provinceSim`.

- [ ] **Step 4: Implement the ring overlay and the risk panel**

Add the overlay builder next to `solidarityWash` in `src/ui/provinceApp.ts`:

```ts
  // provinces of yours that are slipping away — an amber dashed outline so you can SEE which land is at
  // risk, not just read about it. pointer-events off so it never blocks targeting.
  function defectionOverlay(u: UI): SVGGElement {
    const g = svgEl("g", { class: "prov-risks", style: "pointer-events:none" }) as SVGGElement;
    for (let p = 0; p < u.s.n; p++) {
      if (u.s.provOwner[p] !== u.playerId) continue;
      if (!defectionRisk(u.s, p)) continue;
      g.appendChild(svgEl("path", {
        class: "prov-risk-ring", d: provinceOutlinePath(u, p),
        fill: "none", stroke: "#d08a1e", "stroke-width": 2.4, "stroke-dasharray": "5 4", "stroke-linejoin": "round",
      }));
    }
    return g;
  }
```

In `render()`, inside the play branch right after `root.appendChild(hud);`, add the ring + panel (before the pending-dilemma early return, so a warning is visible even on a dilemma turn):

```ts
      map.appendChild(defectionOverlay(ui));
      const risks: { p: number; r: NonNullable<ReturnType<typeof defectionRisk>> }[] = [];
      for (let p = 0; p < ui.s.n; p++) {
        if (ui.s.provOwner[p] !== ui.playerId) continue;
        const r = defectionRisk(ui.s, p);
        if (r) risks.push({ p, r });
      }
      if (risks.length) {
        const panel = document.createElement("div");
        panel.className = "prov-risk";
        for (const { p, r } of risks) {
          const row = document.createElement("div");
          row.className = "prov-risk-row";
          const turns = lang === "ko" ? `이탈 ${r.turnsLeft}턴` : `defects in ${r.turnsLeft}`;
          row.textContent = `⚠ ${ui.world.provinces[p].name} — ${turns} · ${defectionReasonText(r.reason, r.ownN, r.foeN, lang)}`;
          panel.appendChild(row);
        }
        const hint = document.createElement("div");
        hint.className = "prov-risk-hint";
        hint.textContent = lang === "ko"
          ? "내실로 다지거나, 압박하는 땅을 치세요"
          : "consolidate it, or take the province pressing it";
        panel.appendChild(hint);
        root.appendChild(panel);
      }
```

- [ ] **Step 5: Log defections in the chronicle**

In `render()`'s advance handler, directly after the existing `for (const c of ev.conquests) { ... }` loop, add:

```ts
        for (const d of ev.defections) {
          if (d.from === pid) log.unshift(`${lang === "ko" ? "이탈" : "defected"} ${ui!.world.provinces[d.prov].name}`);
          else if (d.to === pid) log.unshift(`${lang === "ko" ? "귀순" : "joined you"} ${ui!.world.provinces[d.prov].name}`);
        }
```

- [ ] **Step 6: Add the CSS**

In `src/theme.css`, next to the other `.prov-*` rules:

```css
.prov-map .prov-risk-ring { pointer-events: none; }
.prov-risk { max-width: 900px; margin: 8px auto 0; padding: 6px 10px; border: 1px solid #d08a1e; border-radius: 6px; background: rgba(208,138,30,.08); }
.prov-risk-row { font-size: 13px; color: #7a4a10; }
.prov-risk-hint { font-size: 12px; color: #6a5a3c; margin-top: 4px; }
```

- [ ] **Step 7: Verify + commit**

Run: `npx vitest run src/ui/provinceApp.test.ts` → PASS including the new tests.
Run: `npx tsc --noEmit` → clean. Run `npx vitest run` → full suite green (goldens unchanged — this task is UI-only). Run `npm run build` → succeeds, emits `dist/playProvince.html`.

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): defection warning — countdown badge with reason, remedy hint, ring + log"
```

---

### Task 4: Verification & constant tuning (throwaway probe)

**Files:**
- Temporary: `src/engine/_probe_defection.test.ts` — DELETE before the final commit.
- Possibly modify: `src/engine/provinceSim.ts` (`UNREST_FLIP` / `REVOLT_SELF` / `REVOLT_DIST` only).

**Interfaces:** none (measurement only).

- [ ] **Step 1: Write the throwaway probe**

Create `src/engine/_probe_defection.test.ts`:

```ts
import { describe, it } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initProvinceSim, stepProvinceSim, stepPlayerTurn, armableTargets, defectionRisk, PROVINCE_SIM_TICKS,
} from "./provinceSim";

function share(s: { provOwner: Int32Array; provinces: { cells: number }[] }) {
  const m = new Map<number, number>();
  for (let p = 0; p < s.provOwner.length; p++) { const o = s.provOwner[p]; if (o >= 0) m.set(o, (m.get(o) ?? 0) + s.provinces[p].cells); }
  return m;
}

describe("PROBE defection (throwaway)", () => {
  it("A. AI world: defection volume, interiors safe, world still dynamic", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const s = initProvinceSim(world);
      const aliveStart = s.alive.filter(Boolean).length;
      const topStart = Math.max(...share(s).values());
      let defections = 0, interiorDefections = 0;
      for (let t = 0; t < PROVINCE_SIM_TICKS; t++) {
        const before = s.provOwner.slice();
        // record which provinces were deep interiors BEFORE the tick
        const interior = new Set<number>();
        for (let p = 0; p < s.n; p++) {
          const o = before[p];
          if (o < 0) continue;
          let allMine = true;
          for (const q of s.adj[p]) { const r = before[q]; if (r >= 0 && r !== o) { allMine = false; break; } }
          if (allMine) interior.add(p);
        }
        stepProvinceSim(s);
        for (let p = 0; p < s.n; p++) if (s.provOwner[p] !== before[p]) {
          // a change is either conquest or defection; count interior changes as the red flag
          if (interior.has(p)) interiorDefections++;
        }
      }
      // total flips is a coarse proxy; the interior count is the invariant that must be 0 from defection
      defections = 0;
      const aliveEnd = s.alive.filter(Boolean).length;
      const topEnd = Math.max(...share(s).values());
      console.log(`A seed ${String(seed).padStart(2)}: interiorFlips=${interiorDefections} alive ${aliveStart}->${aliveEnd} top ${topStart}->${topEnd} (${defections})`);
    }
  });

  it("B. player: at-risk count per turn, domination still reachable, overseas land keepable", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const s = initProvinceSim(world);
      const pid = s.alive.findIndex(Boolean);
      const start = (() => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === pid) k++; return k; })();
      let maxAtRisk = 0, sumAtRisk = 0, lostToDefection = 0;
      for (let t = 0; t < PROVINCE_SIM_TICKS && s.alive[pid]; t++) {
        const ev = stepPlayerTurn(s, pid, new Set(armableTargets(s, pid)));
        lostToDefection += ev.defections.filter((d) => d.from === pid).length;
        let atRisk = 0;
        for (let p = 0; p < s.n; p++) if (s.provOwner[p] === pid && defectionRisk(s, p)) atRisk++;
        if (atRisk > maxAtRisk) maxAtRisk = atRisk;
        sumAtRisk += atRisk;
      }
      const end = (() => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === pid) k++; return k; })();
      const gain = end - start, need = Math.round(0.2 * s.n);
      console.log(`B seed ${String(seed).padStart(2)}: atRisk avg=${(sumAtRisk / PROVINCE_SIM_TICKS).toFixed(1)} max=${maxAtRisk} lostToDefection=${lostToDefection} gain ${gain}/${need} ${gain >= need ? "DOMINATION" : ""} alive=${s.alive[pid]}`);
    }
  });

  it("C. keepable: a consolidating player holds its at-risk provinces", () => {
    // every turn, consolidate the two most at-risk provinces instead of attacking; count losses.
    for (let seed = 1; seed <= 10; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const s = initProvinceSim(world);
      const pid = s.alive.findIndex(Boolean);
      let lost = 0;
      for (let t = 0; t < PROVINCE_SIM_TICKS && s.alive[pid]; t++) {
        const risky: number[] = [];
        for (let p = 0; p < s.n; p++) if (s.provOwner[p] === pid && defectionRisk(s, p)) risky.push(p);
        const ev = risky.length
          ? stepPlayerTurn(s, pid, new Set(risky.slice(0, 2)), { consolidate: true })
          : stepPlayerTurn(s, pid, new Set(armableTargets(s, pid)));
        lost += ev.defections.filter((d) => d.from === pid).length;
      }
      console.log(`C seed ${String(seed).padStart(2)}: lostWhileConsolidating=${lost}`);
    }
  });
});
```

- [ ] **Step 2: Run the probe and read the numbers**

Run: `npx vitest run src/engine/_probe_defection.test.ts`

Check against the spec's acceptance criteria:
- **A — interiors never defect:** `interiorFlips` should reflect only conquests, never a province whose neighbours all shared its owner flipping without an attacker. If interior provinces are flipping by defection, `pressureOf` is wrong — fix it, don't tune.
- **A — empires don't crumble:** `top` should still end substantial; the world should still lose nations (`alive` shrinks).
- **B — few at risk at once:** `atRisk avg` should be roughly 0–3, `max` not a screenful. If it is large, raise `REVOLT_SELF` (easier to hold) or lower `REVOLT_DIST`.
- **B — player can still win:** `DOMINATION` should appear on at least a couple of seeds. If it never does, defection is too harsh.
- **C — keepable with investment (the critical check):** `lostWhileConsolidating` should be substantially lower than B's `lostToDefection`. If a consolidating player still loses everything, `REVOLT_DIST` dominates and MUST come down — otherwise the sea-lane feature is nullified ("you can take it but never keep it").

- [ ] **Step 3: Tune once if the numbers demand it**

Adjust at most one round of `UNREST_FLIP` / `REVOLT_SELF` / `REVOLT_DIST` in `src/engine/provinceSim.ts`, re-run Step 2, and record the before/after numbers and the reason in the commit message. Any constant change moves the two game goldens — re-pin them exactly as in Task 2 Step 5 and re-check the non-static guard.

- [ ] **Step 4: Delete the probe and finalize**

```bash
rm src/engine/_probe_defection.test.ts
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: no probe file, full suite green, tsc clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify defection acceptance (interiors safe, few at risk, land keepable); probe removed"
```

---

## Self-Review

**Spec coverage:**
- Pressure formula (`hold`/`press`, land-only adjacency, unowned ignored, dead rivals count) → Task 1 `pressureOf`. ✓
- Starting constants `UNREST_FLIP=3`, `REVOLT_SELF=2`, `REVOLT_DIST=0.003` → Task 1 Step 3(a). ✓
- Deep interior / island never defects → Task 1 tests + Task 4 probe A. ✓
- Countdown, immediate reset, flip to max-pressure rival (ties → lower id), ownership change resets clock, double-buffer, capital never defects, symmetric → Task 2. ✓
- Step order `stepSolidarity → contestPass → revoltPass → recomputeAlive → tick++` in both step functions → Task 2 Step 3(c)(e). ✓
- Consolidate raises `hold` via `REVOLT_SELF` (agency) → falls out of the formula; verified by Task 4 probe C. ✓
- Badge with countdown, REASON, remedy hint, player-only → Task 3. ✓
- Defection chronicle line distinct from 정복/상실 → Task 3 Step 5. ✓
- Goldens: init + Version A unchanged, two game goldens re-pinned → Task 1 Step 5 (unchanged) + Task 2 Step 5 (re-pin). ✓
- Acceptance 1–7 incl. keepable-with-investment and few-at-risk → Task 4 probe A/B/C. ✓
- Non-goals (free cities, rebel units, capital defection, enemy-defection UI, unrest persistence) → nothing in any task builds them. ✓

**Placeholder scan:** every code step contains the actual code; constants have concrete values; the one soft spot (Task 3's DOM test) is called out explicitly with instructions to replace the vacuous conditional with a hard-coded seed/turn found by a throwaway loop, so it cannot ship as an assertion-free test. ✓

**Type consistency:** `DefectionReason` and `DefectionRisk` are defined in Task 1 and consumed verbatim in Task 3; `defectionRisk(s, p)` signature identical across tasks; `PlayerStepEvents.defections` shape `{prov, from, to}` matches `Defection` and the Task 3 log loop; `unrestArr` used by Task 1 (`defectionRisk`) and Task 2 (`contestPass`, `revoltPass`); `provinceOutlinePath(u, provId)` matches the existing helper in `provinceApp.ts`. ✓
