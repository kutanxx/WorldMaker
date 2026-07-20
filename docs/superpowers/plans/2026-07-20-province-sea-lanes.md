# Province Sea Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the province game Risk-style expedition sea lanes so sea-locked nations can attack and be attacked, instead of being survive-only.

**Architecture:** A new pure generator `buildSeaLanes` (in `provinceSim.ts`) produces a `laneAdj` overlay adjacency alongside the existing land-only `adj`. Combat and solidarity read `adj ∪ laneAdj`; attacks that cross a lane pay an `EXPEDITION_MULT` strength penalty and (when both routes exist) prefer land. The UI draws lanes as dashed routes and marks expedition targets with `⚓`. All province goldens are game-side and get re-pinned (capture-and-pin); Version A's golden is untouched.

**Tech Stack:** TypeScript, Vitest, hand-rolled SVG DOM (no framework). rng-free deterministic engine.

## Global Constraints

- **rng-free / deterministic:** `buildSeaLanes` and all lane logic take NO rng. Ties break by lower id. Two runs must be byte-identical.
- **Fork isolation:** `provinceSim.ts` must NOT import from `historySim.ts` / `playSim.ts` / the cell sim. Version A golden `polityOf` FNV = `1350115163` stays byte-identical (asserted by existing tests — do not touch).
- **Province goldens are capture-and-pin:** the init-owner hash `226648593` is unaffected (lanes don't change initial ownership) and MUST stay green. The 50-tick AI-world hash (currently `3566824384`) and the player-path hash (currently `243852981`) WILL change — re-pin by running the test, reading the actual value, and replacing the literal.
- **Constants (starting values, tunable):** `EXPEDITION_MULT = 0.6`, `LANE_HOP_CELLS = 3` (max water gap in cell-spacings for a short-hop lane), `LANE_MAX_DEGREE = 3` (max lanes per province).
- **i18n:** every user-facing string is KO + EN.
- **Non-static test is a signal, not a target:** if the "territory concentrates" test breaks after lanes land, STOP and report the numbers — do NOT force constants to make it pass.

---

## File Structure

- `src/engine/provinceSim.ts` — MODIFY: add `buildSeaLanes`, `laneAdj` state field, `laneOf` helper, expedition-aware combat + frontier.
- `src/engine/provinceSim.test.ts` — MODIFY: unit tests for lanes + re-pinned goldens.
- `src/ui/provinceApp.ts` — MODIFY: draw lanes, `⚓` in the forecast, legend/hint clause.
- `src/ui/provinceApp.test.ts` — MODIFY: DOM test for the lane layer.
- `src/theme.css` — MODIFY: one `.sea-lane` rule.

---

### Task 1: `buildSeaLanes` — coastal detection + short-hop lanes

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `Province` (from `./provinces`: `{ id, name, cells, centroid: [number,number], seedCell, biome }`), `World["grid"]`.
- Produces:
  - `type LaneGrid = Pick<World["grid"], "count" | "neighbors" | "points" | "width" | "height">`
  - `export function buildSeaLanes(provinceOf: ArrayLike<number>, provinces: Province[], grid: LaneGrid, adj: number[][], capitals: number[]): number[][]` — returns `laneAdj`, index-aligned to `provinces`; each `laneAdj[p]` is a sorted unique list of lane-partner province ids. (Task 1 implements the short-hop half; `capitals` is unused until Task 2's fallback.)

- [ ] **Step 1: Write the failing test**

Add to `src/engine/provinceSim.test.ts`:

```ts
import { buildSeaLanes } from "./provinceSim";

describe("buildSeaLanes — short-hop coastal crossings", () => {
  // 4 land provinces in two pairs separated by a thin sea. Row of cells:
  //   [P0][P0][sea][P1][P1]   (a narrow one-cell strait between P0 and P1)
  //   [P2 far ................ P3]  handled in Task 2; here just P0/P1.
  // grid.points are cell centers; width/height set the spacing reference.
  function strait(): {
    provinceOf: number[]; provinces: import("./provinces").Province[];
    grid: { count: number; neighbors: number[][]; points: Float64Array; width: number; height: number };
    adj: number[][];
  } {
    // cells: 0,1 => P0 ; 2 => sea(-1) ; 3,4 => P1. neighbours are the line.
    const provinceOf = [0, 0, -1, 1, 1];
    const points = Float64Array.from([0, 0, 10, 0, 20, 0, 30, 0, 40, 0]);
    const neighbors = [[1], [0, 2], [1, 3], [2, 4], [3]];
    const grid = { count: 5, neighbors, points, width: 40, height: 10 };
    const provinces = [
      { id: 0, name: "P0", cells: 2, centroid: [5, 0] as [number, number], seedCell: 0, biome: 4 },
      { id: 1, name: "P1", cells: 2, centroid: [35, 0] as [number, number], seedCell: 3, biome: 4 },
    ];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    return { provinceOf, provinces, grid, adj };
  }

  it("links two coastal provinces across a narrow sea gap", () => {
    const { provinceOf, provinces, grid, adj } = strait();
    expect(adj).toEqual([[], []]); // NOT land-adjacent (sea cell 2 between them)
    const lanes = buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1]);
    expect(lanes).toEqual([[1], [0]]); // a lane bridges them
  });

  it("is deterministic (two runs identical)", () => {
    const a = strait(), b = strait();
    expect(buildSeaLanes(a.provinceOf, a.provinces, a.grid, a.adj, [0, 1]))
      .toEqual(buildSeaLanes(b.provinceOf, b.provinces, b.grid, b.adj, [0, 1]));
  });

  it("respects the per-province degree cap", () => {
    // one hub province surrounded by 5 island provinces all within hop range → hub keeps at most LANE_MAX_DEGREE (3).
    // cells: 0 => hub P0 at origin; islands P1..P5 one sea cell away in a ring.
    const provinceOf = [0, -1, 1, 2, 3, 4, 5];
    const pts = [0, 0,  0, 5,  10, 0,  0, 10,  -10, 0,  0, -10,  7, 7];
    const points = Float64Array.from(pts);
    const neighbors = [[1], [0, 2, 3, 4, 5, 6], [1], [1], [1], [1], [1]];
    const grid = { count: 7, neighbors, points, width: 40, height: 40 };
    const mk = (id: number, x: number, y: number, c: number) =>
      ({ id, name: "P" + id, cells: 1, centroid: [x, y] as [number, number], seedCell: c, biome: 4 });
    const provinces = [mk(0, 0, 0, 0), mk(1, 0, 5, 2), mk(2, 10, 0, 3), mk(3, 0, 10, 4), mk(4, -10, 0, 5), mk(5, 0, -10, 6)];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    const lanes = buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1, 2, 3, 4, 5]);
    expect(lanes[0].length).toBeLessThanOrEqual(3); // hub capped at LANE_MAX_DEGREE
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "short-hop"`
Expected: FAIL — `buildSeaLanes is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/engine/provinceSim.ts`, add near the top (after the imports) the grid type and constants:

```ts
type LaneGrid = Pick<World["grid"], "count" | "neighbors" | "points" | "width" | "height">;
const LANE_HOP_CELLS = 3;   // a short-hop lane may cross up to this many cell-spacings of open water
const LANE_MAX_DEGREE = 3;  // Risk lesson: few connections per territory (chokepoints, not a mesh)
const EXPEDITION_MULT = 0.6; // a lane crossing is a costly naval invasion — attacker strength is scaled by this
```

Then add the generator (place it just after `buildProvinceAdj`):

```ts
// cells of province p that touch open sea (a neighbour cell is ocean, provinceOf < 0) — the crossing endpoints.
function wharfCells(provinceOf: ArrayLike<number>, nProv: number, grid: LaneGrid): number[][] {
  const out: number[][] = Array.from({ length: nProv }, () => []);
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c];
    if (p < 0) continue;
    for (const nb of grid.neighbors[c]) if (provinceOf[nb] < 0) { out[p].push(c); break; }
  }
  return out;
}

// nearest Euclidean distance between any wharf cell of a and any wharf cell of b (Infinity if either has none).
function wharfDist(a: number[], b: number[], points: ArrayLike<number>): number {
  let best = Infinity;
  for (const ca of a) for (const cb of b) {
    const dx = points[ca * 2] - points[cb * 2], dy = points[ca * 2 + 1] - points[cb * 2 + 1];
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

// Risk-style expedition lanes over open water. Deterministic, rng-free. `laneAdj[p]` = sorted unique partners.
// Two halves: (1) short-hop lanes between nearby coastal provinces (this task); (2) a connectivity fallback so
// every capital is reachable (Task 2). `capitals` = the distinct capital province ids (used only by the fallback).
export function buildSeaLanes(
  provinceOf: ArrayLike<number>, provinces: Province[], grid: LaneGrid, adj: number[][], capitals: number[],
): number[][] {
  const n = provinces.length;
  const lanes: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const wharf = wharfCells(provinceOf, n, grid);
  const coastal = provinces.filter((p) => wharf[p.id].length > 0).map((p) => p.id);
  const spacing = Math.sqrt((grid.width * grid.height) / Math.max(1, grid.count));
  const maxHop = LANE_HOP_CELLS * spacing;

  const landAdj: Set<number>[] = adj.map((a) => new Set(a));
  const add = (a: number, b: number) => { lanes[a].add(b); lanes[b].add(a); };

  // (1) short-hop candidates: coastal pairs, not land-adjacent, within maxHop. Add greedily by ascending distance,
  //     skipping a pair if either endpoint is already at the degree cap. Ties → lower (a,b) id.
  const cand: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < coastal.length; i++) for (let j = i + 1; j < coastal.length; j++) {
    const a = coastal[i], b = coastal[j];
    if (landAdj[a].has(b)) continue;
    const d = wharfDist(wharf[a], wharf[b], grid.points);
    if (d <= maxHop) cand.push({ a, b, d });
  }
  cand.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  for (const { a, b } of cand) {
    if (lanes[a].size >= LANE_MAX_DEGREE || lanes[b].size >= LANE_MAX_DEGREE) continue;
    add(a, b);
  }

  // (2) connectivity fallback — added in Task 2.

  return lanes.map((s) => [...s].sort((x, y) => x - y));
}
```

Note: `Province` is already imported at the top of the file (`import type { Province } from "./provinces";`). `World` is already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "short-hop"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): buildSeaLanes short-hop coastal crossings (rng-free)"
```

---

### Task 2: `buildSeaLanes` — connectivity fallback

**Files:**
- Modify: `src/engine/provinceSim.ts` (extend `buildSeaLanes` where the `// (2) connectivity fallback` note is)
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `buildSeaLanes(...)` from Task 1 (same signature; `capitals` now used).
- Produces: same return type; now guarantees all capital-bearing components are joined into one over `adj ∪ laneAdj`.

- [ ] **Step 1: Write the failing test**

Add to the `describe("buildSeaLanes — short-hop coastal crossings", ...)` block a sibling `describe`:

```ts
describe("buildSeaLanes — connectivity fallback", () => {
  // Two capitals on land-disconnected islands FAR apart (beyond hop range) still get exactly one lifeline lane.
  // cells: 0 => P0(cap of nation, island A) ; 1 => sea ; ... ; big gap ; N => P1 (island B). No land adjacency.
  function farIslands() {
    const provinceOf = [0, -1, -1, -1, -1, 1];
    const points: number[] = [0, 0, 20, 0, 40, 0, 60, 0, 80, 0, 100, 0];
    const neighbors = [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]];
    const grid = { count: 6, neighbors, points, width: 100, height: 10 };
    const provinces = [
      { id: 0, name: "A", cells: 1, centroid: [0, 0] as [number, number], seedCell: 0, biome: 4 },
      { id: 1, name: "B", cells: 1, centroid: [100, 0] as [number, number], seedCell: 5, biome: 4 },
    ];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    return { provinceOf, provinces, grid, adj };
  }

  it("bridges land-disconnected capital components even beyond hop range", () => {
    const { provinceOf, provinces, grid, adj } = farIslands();
    // both provinces are >maxHop apart, so the short-hop pass adds nothing; the fallback must still connect them.
    const lanes = buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1]);
    expect(lanes).toEqual([[1], [0]]);
  });

  it("adds no fallback lane when capitals already connect by land", () => {
    // one landmass, two provinces adjacent by land → already one component → no lane needed.
    const provinceOf = [0, 0, 1, 1];
    const points: number[] = [0, 0, 10, 0, 20, 0, 30, 0];
    const neighbors = [[1], [0, 2], [1, 3], [2]];
    const grid = { count: 4, neighbors, points, width: 30, height: 10 };
    const provinces = [
      { id: 0, name: "A", cells: 2, centroid: [5, 0] as [number, number], seedCell: 0, biome: 4 },
      { id: 1, name: "B", cells: 2, centroid: [25, 0] as [number, number], seedCell: 2, biome: 4 },
    ];
    const adj = buildProvinceAdj(provinceOf, provinces, grid);
    expect(buildSeaLanes(provinceOf, provinces, grid, adj, [0, 1])).toEqual([[], []]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "connectivity fallback"`
Expected: FAIL — first test yields `[[], []]` (no lane) instead of `[[1], [0]]`.

- [ ] **Step 3: Write the implementation**

Replace the `// (2) connectivity fallback — added in Task 2.` line in `buildSeaLanes` with:

```ts
  // (2) connectivity fallback: join every capital-bearing component into one, cheapest wharf pair first.
  // Component labels over adj ∪ lanes-so-far.
  const label = (): Int32Array => {
    const lab = new Int32Array(n).fill(-1);
    let next = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (lab[s0] >= 0) continue;
      const stack = [s0]; lab[s0] = next;
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of adj[u]) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
        for (const v of lanes[u]) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
      }
      next++;
    }
    return lab;
  };
  const capProvs = [...new Set(capitals.filter((c) => c >= 0))];
  // repeatedly connect the two distinct capital-components whose nearest coastal provinces are closest.
  for (;;) {
    const lab = label();
    const capLabels = [...new Set(capProvs.map((c) => lab[c]))];
    if (capLabels.length <= 1) break;
    let best: { a: number; b: number; d: number } | null = null;
    // consider only coastal provinces; find the closest cross-component wharf pair (ties → lower ids).
    for (let i = 0; i < coastal.length; i++) for (let j = i + 1; j < coastal.length; j++) {
      const a = coastal[i], b = coastal[j];
      if (lab[a] === lab[b]) continue;                       // same component already
      if (!capLabels.includes(lab[a]) || !capLabels.includes(lab[b])) continue; // both sides must carry a capital
      const d = wharfDist(wharf[a], wharf[b], grid.points);
      if (!best || d < best.d || (d === best.d && (a < best.a || (a === best.a && b < best.b)))) best = { a, b, d };
    }
    if (!best) break; // no coastal way to connect (all-inland capitals) — leave as is
    add(best.a, best.b);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "connectivity fallback"`
Expected: PASS (2 tests). Also re-run the Task 1 tests: `npx vitest run src/engine/provinceSim.test.ts -t "short-hop"` → still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): buildSeaLanes connectivity fallback — every capital reachable"
```

---

### Task 3: State wiring — `laneAdj` field, `initProvinceSim` builds it, `laneOf` helper

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `buildSeaLanes` (Tasks 1–2).
- Produces:
  - `ProvinceSimState.laneAdj?: number[][]` (optional so existing hand-built fixtures compile as land-only).
  - `function laneOf(s: ProvinceSimState, p: number): number[]` — module-local; returns `s.laneAdj?.[p] ?? []`.
  - `initProvinceSim` now populates `laneAdj`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/provinceSim.test.ts` inside `describe("initProvinceSim (seed 1)", ...)`:

```ts
  it("builds sea lanes so every capital is reachable over land ∪ lanes", () => {
    // union land adjacency with lane adjacency and flood-fill from each capital; all capitals share one component.
    const lab = new Int32Array(s.n).fill(-1);
    let next = 0;
    for (let s0 = 0; s0 < s.n; s0++) {
      if (lab[s0] >= 0) continue;
      const stack = [s0]; lab[s0] = next;
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of s.adj[u]) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
        for (const v of (s.laneAdj?.[u] ?? [])) if (lab[v] < 0) { lab[v] = next; stack.push(v); }
      }
      next++;
    }
    const capLabels = new Set(world.polities.map((p) => lab[s.capitalProv[p.id]]));
    expect(capLabels.size).toBe(1); // one connected reach-graph across all capitals
    expect(s.laneAdj?.length).toBe(s.n);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "reachable over land"`
Expected: FAIL — `s.laneAdj` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/engine/provinceSim.ts`:

(a) Add `laneAdj` to the interface:

```ts
export interface ProvinceSimState {
  provinces: Province[];
  n: number;
  provOwner: Int32Array;
  provSol: Float32Array;
  adj: number[][];
  laneAdj?: number[][];    // expedition sea lanes (province → lane partners); optional so land-only fixtures compile
  capitalProv: Int32Array;
  alive: boolean[];
  tick: number;
}
```

(b) Add the helper (place it after `buildProvinceAdj`/`buildSeaLanes`):

```ts
// lane partners of province p, tolerant of fixtures that predate laneAdj (→ land-only, no lanes).
function laneOf(s: ProvinceSimState, p: number): number[] { return s.laneAdj?.[p] ?? []; }
```

(c) In `initProvinceSim`, after `const adj = buildProvinceAdj(provinceOf, provinces, grid);` and after `capitalProv` is filled, build lanes and include them in the returned state:

```ts
  const adj = buildProvinceAdj(provinceOf, provinces, grid);
  const capitals = [...new Set([...capitalProv].filter((c) => c >= 0))];
  const laneAdj = buildSeaLanes(provinceOf, provinces, world.grid, adj, capitals);
  const alive = polities.map((pol) => capitalProv[pol.id] >= 0 && provOwner[capitalProv[pol.id]] === pol.id);
  return { provinces, n, provOwner, provSol, adj, laneAdj, capitalProv, alive, tick: 0 };
```

(Ensure `capitalProv` is fully populated before this — it is, in the existing `for (const pol of polities)` loop above `provSol`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS — the new reachability test passes AND the existing golden tests stay green (init hash `226648593`, 50-tick `3566824384`, player `243852981` are all UNCHANGED because no stepping code reads `laneAdj` yet).

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): wire laneAdj into state + init (consumption not yet enabled)"
```

---

### Task 4: Engine consumption — frontier + expedition combat, re-pin goldens

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `laneOf` (Task 3), `EXPEDITION_MULT` (Task 1).
- Produces:
  - `computeSteppedSol` frontier test now unions `adj ∪ laneAdj`.
  - `armableTargets` includes lane-reach targets.
  - `interface AttackOdds` gains `lane: boolean`.
  - `type AttackerPick = { attacker: number; frontProv: number; lane: boolean } | null`.
  - `function attackFront(s, attacker, target, sol): { front: number; lane: boolean }` — land preferred, lane fallback, `front = -1` if unreachable.

This task changes both stepping paths, so re-pin the 50-tick and player goldens at the end.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/provinceSim.test.ts`:

```ts
describe("sea lanes — combat & frontier", () => {
  // two lone-nation island provinces, different owners, NOT land-adjacent but lane-linked. Equal strength ⇒
  // no conquest (expedition atk = 0.6·def < 1.03·def), so we can observe the solidarity frontier rule cleanly.
  function islands(over: Record<string, unknown> = {}): ProvinceSimState {
    const provinces: Province[] = [0, 1].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 100, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 2, provOwner: Int32Array.from([0, 1]), provSol: Float32Array.from([0.5, 0.5]),
      adj: [[], []], laneAdj: [[1], [0]], capitalProv: Int32Array.from([0, 1]), alive: [true, true], tick: 0, ...over,
    } as ProvinceSimState;
  }

  it("a province linked to a different owner ONLY by a lane counts as frontier (rises)", () => {
    const s = islands();
    stepProvinceSim(s);
    expect(s.provSol[0]).toBeCloseTo(0.53, 5); // frontier via lane → +SOL_RISE, not interior decay
    expect(s.provSol[1]).toBeCloseTo(0.53, 5);
  });

  it("armableTargets includes a lane-reach enemy with no land border", () => {
    expect(armableTargets(islands(), 0)).toEqual([1]);
  });

  it("explainAttack across a lane flags the expedition and scales attacker strength", () => {
    // make the attacker strong so it would win by land, then confirm the lane penalty is applied + flagged.
    const s = islands({ provSol: Float32Array.from([0.9, 0.1]) });
    const od = explainAttack(s, 0, 1)!;
    expect(od.lane).toBe(true);
    // atk equals the un-penalised strength times EXPEDITION_MULT (0.6): compare to a land-linked twin.
    const land = islands({ provSol: Float32Array.from([0.9, 0.1]), adj: [[1], [0]], laneAdj: [[], []] });
    const landOdds = explainAttack(land, 0, 1)!;
    expect(od.atk).toBeCloseTo(landOdds.atk * 0.6, 5);
    expect(landOdds.lane).toBe(false);
  });

  it("prefers the land route (no penalty) when a target is reachable by BOTH land and lane", () => {
    const both = islands({ adj: [[1], [0]], laneAdj: [[1], [0]] });
    expect(explainAttack(both, 0, 1)!.lane).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "combat & frontier"`
Expected: FAIL — lanes are not yet consumed (frontier decays; `armableTargets` returns `[]`; `od.lane` undefined).

- [ ] **Step 3: Write the implementation**

In `src/engine/provinceSim.ts`:

(a) `computeSteppedSol` — frontier test unions lanes:

```ts
    let frontier = false;
    for (const q of adj[p]) if (provOwner[q] !== o) { frontier = true; break; }
    if (!frontier) for (const q of laneOf(s, p)) if (provOwner[q] !== o) { frontier = true; break; }
```

(Replace the existing single `for (const q of adj[p]) ...` frontier loop with these two.)

(b) Add `attackFront` (replaces the role of `playerFront` for player attacks; keep or remove `playerFront` — it is now superseded, so replace its uses). Place after `playerFront`:

```ts
// the attacker's best own province bordering `target`, and whether the route is a lane (expedition). Land
// neighbours are preferred (no penalty); among a route class, highest solidarity wins (tie → lower id).
// front = -1 if the attacker doesn't reach the target at all.
function attackFront(s: ProvinceSimState, attacker: number, target: number, sol: ArrayLike<number>): { front: number; lane: boolean } {
  const pickBest = (ids: number[]): number => {
    let bestSol = -Infinity, front = -1;
    for (const q of ids) {
      if (s.provOwner[q] !== attacker) continue;
      const v = sol[q];
      if (v > bestSol || (v === bestSol && (front < 0 || q < front))) { bestSol = v; front = q; }
    }
    return front;
  };
  const land = pickBest(s.adj[target]);
  if (land >= 0) return { front: land, lane: false };
  const lane = pickBest(laneOf(s, target));
  return { front: lane, lane: lane >= 0 };
}
```

(c) `AttackOdds` + `explainAttack`: add the `lane` flag and apply the multiplier.

```ts
export interface AttackOdds { win: boolean; atk: number; def: number; reason: AttackReason; breakable: boolean; lane: boolean; }
```

In `explainAttack`, replace the front/atk section:

```ts
  const stepped = computeSteppedSol(s);
  const { front, lane } = attackFront(s, playerId, targetProv, stepped);
  if (front < 0) return null;
  const tmp: ProvinceSimState = { ...s, provSol: stepped };
  const agg = pAggregate(tmp);
  const o = s.provOwner[targetProv];
  const mult = lane ? EXPEDITION_MULT : 1;
  const atk = strength(tmp, agg, playerId, targetProv, front) * mult;
  const def = o < 0 ? 0 : strength(tmp, agg, o, targetProv, targetProv);
  const win = atk > def * CONTEST_THRESH;
```

And scale `bestAtk` for breakable, and add `lane` to the return:

```ts
  const bestAtk = (W_ASA * 1 + W_LOCAL * 1 + W_POWER * Math.sqrt(Math.min(agg[playerId].cells, SIZE_CAP)) - W_DIST * myDist) * mult;
  const breakable = bestAtk > def * CONTEST_THRESH;
  return { win, atk, def, reason, breakable, lane };
```

(d) `AttackerPick` + `aiAttacker`: consider lane enemies, prefer land, carry the `lane` flag.

```ts
type AttackerPick = { attacker: number; frontProv: number; lane: boolean } | null;
```

```ts
function aiAttacker(s: ProvinceSimState, excludePlayer: number) {
  return (p: number, o: number, agg: PAgg[]): AttackerPick => {
    let attacker = -1, frontProv = -1, lane = false, bestAvg = -Infinity;
    const consider = (q: number, viaLane: boolean) => {
      const po = s.provOwner[q];
      if (po < 0 || po === o || po === excludePlayer || !s.alive[po]) return;
      // strictly-better realm wins; on a tie, prefer the land route (viaLane === false).
      if (agg[po].avg > bestAvg || (agg[po].avg === bestAvg && lane && !viaLane)) {
        bestAvg = agg[po].avg; attacker = po; frontProv = q; lane = viaLane;
      }
    };
    for (const q of s.adj[p]) consider(q, false);
    for (const q of laneOf(s, p)) consider(q, true);
    return attacker < 0 ? null : { attacker, frontProv, lane };
  };
}
```

(e) `contestPass`: apply the expedition multiplier to the chosen attacker's strength.

```ts
    const atk = strength(s, agg, chosen.attacker, p, chosen.frontProv) * (chosen.lane ? EXPEDITION_MULT : 1);
```

(f) `armableTargets`: qualify by land OR lane.

```ts
export function armableTargets(s: ProvinceSimState, playerId: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < s.n; p++) {
    if (s.provOwner[p] === playerId) continue;
    let borders = false;
    for (const q of s.adj[p]) if (s.provOwner[q] === playerId) { borders = true; break; }
    if (!borders) for (const q of laneOf(s, p)) if (s.provOwner[q] === playerId) { borders = true; break; }
    if (borders) out.push(p);
  }
  return out;
}
```

(g) `stepPlayerTurn`: the player's target front now uses `attackFront` (so player expeditions work + carry the flag).

```ts
  const conquered = contestPass(s, (p, o, agg) => {
    if (o !== playerId && playerTargets.has(p)) {
      const { front, lane } = attackFront(s, playerId, p, s.provSol); // s.provSol is the stepped buffer here
      if (front >= 0) return { attacker: playerId, frontProv: front, lane };
    }
    return ai(p, o, agg);
  });
```

(If `playerFront` is now unused, delete it to avoid a dead-code lint; `explainAttack` and `stepPlayerTurn` both use `attackFront` instead.)

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "combat & frontier"`
Expected: PASS (4 tests).

- [ ] **Step 5: Re-pin the goldens**

Run the full engine suite: `npx vitest run src/engine/provinceSim.test.ts`
Two golden tests now FAIL with a message like `expected <NEW> to be 3566824384` (50-tick) and `expected <NEW> to be 243852981` (player-path). For EACH, copy the ACTUAL number from the failure and replace the pinned literal:

- In `describe("provinceSim determinism + safety (seed 1)", ...)`: replace `3566824384` with the new 50-tick hash. Update the trailing comment to `// pinned golden hash — after 50 ticks (seed 1), re-pinned with sea lanes`.
- In `describe("stepPlayerTurn determinism + safety (seed 1)", ...)`: replace `243852981` with the new player-path hash. Update the comment to `// ... re-pinned with sea lanes`.

The init hash `226648593` and Version A `1350115163` MUST still pass — do NOT change them. If either fails, STOP: lanes leaked into init or into the cell sim.

- [ ] **Step 6: Guard the non-static signal**

Run: `npx vitest run src/engine/provinceSim.test.ts -t "not static"`
Expected: PASS (top nation still grows, alive count still shrinks). **If it FAILS, STOP and report the before/after numbers** — do not adjust constants to force it; that is SP3 balance data for the user.

- [ ] **Step 7: Run the whole suite + commit**

Run: `npx vitest run`
Expected: all green.

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): consume sea lanes — expedition combat + lane frontiers, goldens re-pinned"
```

---

### Task 5: UI — draw lanes, mark expedition targets, legend

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `ui.s.laneAdj` (Task 3), `explainAttack(...).lane` (Task 4).
- Produces: a `.sea-lane` path per lane in the play map; `⚓` prefix on expedition forecast lines; a legend clause.

- [ ] **Step 1: Write the failing test**

First inspect the existing DOM test file to match its harness (seed, mount helper). Then add to `src/ui/provinceApp.test.ts`:

```ts
it("draws a dashed sea-lane for each expedition route in play mode", () => {
  // mount, start a game as a live nation, then assert the play map has one .sea-lane path per lane pair.
  const root = document.createElement("div");
  mountProvinceApp(root, { seed: 1 });
  // pick the first live polity territory to start (mirrors how other tests in this file start a game).
  const terr = root.querySelector<SVGElement>("[data-polity]");
  terr?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const lanes = root.querySelectorAll(".prov-map .sea-lane");
  // seed 1 has ≥1 lane by construction (connectivity fallback guarantees reachability); each is a <path>.
  expect(lanes.length).toBeGreaterThan(0);
  expect(lanes[0].getAttribute("stroke-dasharray")).toBeTruthy();
});
```

If the existing tests start a game differently (e.g. a helper), match that pattern instead of the `[data-polity]` click. Keep the two assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts -t "sea-lane"`
Expected: FAIL — no `.sea-lane` elements.

- [ ] **Step 3: Implement the lane layer**

In `src/ui/provinceApp.ts`, add a builder near `solidarityWash`:

```ts
  // expedition sea lanes: a dashed route between each linked province pair's centroids. Play mode only;
  // pointer-events off so it never blocks target clicks. Deduped by p < q.
  function seaLaneLayer(u: UI): SVGGElement {
    const g = svgEl("g", { class: "prov-lanes", style: "pointer-events:none" }) as SVGGElement;
    const laneAdj = u.s.laneAdj ?? [];
    for (let p = 0; p < laneAdj.length; p++) for (const q of laneAdj[p]) {
      if (q <= p) continue; // draw each undirected lane once
      const a = u.world.provinces[p].centroid, b = u.world.provinces[q].centroid;
      g.appendChild(svgEl("line", {
        class: "sea-lane", x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: "#3f5d78", "stroke-width": 1.4, "stroke-dasharray": "6 5", "stroke-opacity": 0.55,
      }));
    }
    return g;
  }
```

In `buildMap`, add the lane layer in play mode, above the fills/wash and below the labels. Insert right after the solidarity wash append:

```ts
    if (ui) svg.appendChild(solidarityWash(ui));
    if (ui) svg.appendChild(seaLaneLayer(ui));
```

- [ ] **Step 4: Mark expedition targets with `⚓` and extend the legend**

In `attackLine`, prefix the name with an anchor when the attack is an expedition:

```ts
  function attackLine(u: UI, prov: number): string {
    const od = explainAttack(u.s, u.playerId, prov);
    const name = (od?.lane ? "⚓ " : "") + u.world.provinces[prov].name;
    if (!od) return u.world.provinces[prov].name;
    ...
```

(Keep the rest of `attackLine` unchanged; just source `name` with the `⚓` prefix and use it in the returned string as before.)

In the conquer-mode legend (`render`, the `mode === "conquer"` branch), append the lane clause:

```ts
    legend.textContent = lang === "ko"
      ? "✓ 초록 = 점령 가능  ·  ✕ 빨강 = 너무 강함  ·  ⚓ = 바다 건너 원정 — 지역에 마우스를 올리면 이유가 나와요"
      : "✓ green = you can take  ·  ✕ red = too strong  ·  ⚓ = sea expedition — hover a province for the reason";
```

- [ ] **Step 5: Add the CSS rule**

In `src/theme.css`, next to the other `.prov-map` rules (after line ~360):

```css
.prov-map .sea-lane { pointer-events: none; }
```

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: PASS including the new `sea-lane` test.

Run: `npx vitest run` then `npm run build`
Expected: all green; build emits `dist/playProvince.html` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): draw sea lanes + mark ⚓ expedition targets in the forecast"
```

---

### Task 6: Verification & `EXPEDITION_MULT` tuning (throwaway probe)

**Files:**
- Temporary: `scripts/_probe-lanes.mjs` (or a throwaway `*.test.ts`) — DELETE before the final commit.
- Possibly modify: `src/engine/provinceSim.ts` (`EXPEDITION_MULT` only, if islands melt).

**Interfaces:** none (measurement only).

- [ ] **Step 1: Write a throwaway reachability + island-survival probe**

Create `src/engine/_probe-lanes.test.ts` (throwaway — deleted in Step 4):

```ts
import { describe, it } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim, stepProvinceSim, PROVINCE_SIM_TICKS } from "./provinceSim";

describe("PROBE (throwaway) — lanes reachability + island survival", () => {
  it("reports capitals-connected and island survival over 20 seeds", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
      const s = initProvinceSim(world);
      // reach over adj ∪ laneAdj
      const lab = new Int32Array(s.n).fill(-1); let nx = 0;
      for (let s0 = 0; s0 < s.n; s0++) { if (lab[s0] >= 0) continue; const st = [s0]; lab[s0] = nx;
        while (st.length) { const u = st.pop(); for (const v of s.adj[u]) if (lab[v] < 0) { lab[v] = nx; st.push(v); }
          for (const v of (s.laneAdj?.[u] ?? [])) if (lab[v] < 0) { lab[v] = nx; st.push(v); } } nx++; }
      const capLabels = new Set(world.polities.map((p) => lab[s.capitalProv[p.id]]));
      const laneCount = (s.laneAdj ?? []).reduce((a, l) => a + l.length, 0) / 2;
      const aliveStart = s.alive.filter(Boolean).length;
      for (let t = 0; t < PROVINCE_SIM_TICKS; t++) stepProvinceSim(s);
      const aliveEnd = s.alive.filter(Boolean).length;
      console.log(`seed ${seed}: capComponents=${capLabels.size} lanes=${laneCount} alive ${aliveStart}->${aliveEnd}`);
    }
  });
});
```

- [ ] **Step 2: Run the probe and read the numbers**

Run: `npx vitest run src/engine/_probe-lanes.test.ts`
Expected observations:
- `capComponents=1` for ALL 20 seeds (reachability guaranteed by construction). If any seed shows >1, the fallback has a bug — fix Task 2 before continuing.
- `lanes=` a small handful per seed (typically 1–6). If some seed shows a very large number, `LANE_HOP_CELLS` is too generous — lower it and re-run.
- `alive x->y`: island-bearing seeds should not collapse dramatically more than a land seed. Note the range.

- [ ] **Step 3: Tune `EXPEDITION_MULT` once if islands melt**

If the probe shows island nations being wiped out at a dramatically higher rate (e.g. formerly-immortal islands now die almost every run very fast), lower the expedition strength so crossings are costlier: set `EXPEDITION_MULT = 0.5` (or `0.45`) in `src/engine/provinceSim.ts`, re-run Step 2, and re-pin the goldens (Task 4, Step 5) since the constant change moves the 50-tick and player hashes. If islands survive at a reasonable rate, leave `0.6`. Record the decision in the commit message. (Only ONE adjustment — this is a resting-point tune, not a sweep.)

- [ ] **Step 4: Delete the probe and finalize**

```bash
rm src/engine/_probe-lanes.test.ts
npx vitest run
```
Expected: full suite green (no probe file).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify sea-lane reachability + island survival (probe removed); tune EXPEDITION_MULT"
```

---

## Self-Review

**Spec coverage:**
- Symmetric crossing (AI + player) → Task 4 (`aiAttacker` lanes + `stepPlayerTurn` `attackFront`). ✓
- Generous lanes (disconnected islands + short-hop coastal) → Tasks 1 (short-hop) + 2 (fallback). ✓
- Per-province degree cap → Task 1 (`LANE_MAX_DEGREE`, tested). ✓
- Nearest-coastal-cell distance (not centroid) → Task 1 (`wharfDist`). ✓
- `EXPEDITION_MULT` penalty on attacker strength → Task 4 (contest + explainAttack), placeholder 0.6, tuned in Task 6. ✓
- Land preferred when both routes exist → Task 4 (`attackFront` land-first; `aiAttacker` tie-break; tested). ✓
- Lanes feed solidarity frontier → Task 4 (`computeSteppedSol`, tested). ✓
- `armableTargets` lane reach → Task 4 (tested). ✓
- `explainAttack`/`predictCapture` lane-aware + `lane` field → Task 4 (`predictCapture` delegates to `explainAttack`, inherits penalty; `lane` field added + tested). ✓
- UI dashed lanes, `⚓` targets, legend chip, KO+EN → Task 5. ✓
- Goldens: init `226648593` unchanged, 50-tick + player re-pinned, Version A `1350115163` untouched → Tasks 3 (unchanged) + 4 (re-pin) + Global Constraints. ✓
- Acceptance probe (reachability, islands don't melt, non-static signal) → Task 6 + Task 4 Step 6. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every code step shows the code. `EXPEDITION_MULT`, `LANE_HOP_CELLS`, `LANE_MAX_DEGREE` have concrete starting values. ✓

**Type consistency:** `AttackerPick` gains `lane: boolean` (Task 4) and every producer (`aiAttacker`, the `stepPlayerTurn` closure) returns it; `AttackOdds` gains `lane: boolean` and `explainAttack` returns it; `attackFront` returns `{ front, lane }` used by both `explainAttack` and `stepPlayerTurn`; `buildSeaLanes` signature is identical across Tasks 1–3; `laneAdj?: number[][]` and `laneOf` consistent. ✓
