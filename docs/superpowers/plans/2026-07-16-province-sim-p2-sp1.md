# Province Sim P2 SP1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless, deterministic, rng-free province-evolution engine (`src/engine/provinceSim.ts`): AI nations own and conquer WHOLE provinces over 50 ticks. No player, no UI. Version A (`historySim`) is untouched.

**Architecture:** New pure module reads the P0 partition (`world.provinceOf` / `world.provinces`). Per-province ownership + solidarity; a land-adjacency graph; each tick updates solidarity (frontier rise / interior decay) then contests each province against its strongest adjacent enemy, flipping the whole province when the attacker wins. Deterministic (no rng) — pinned by golden hashes.

**Tech Stack:** TypeScript, vitest (node env for pure engine). No new dependencies.

## Global Constraints

- **Fork / safety:** `provinceSim.ts` imports NOTHING from `historySim`, `playSim`, `intervention`, or `src/ui/*`. It only reads `world` (`provinceOf`, `provinces`, `polityOf`, `polities`, `grid`). It must never mutate `world`. Version A's golden hashes (world.test: seed-1 polityOf FNV `1350115163`, province partition `2955931295`) stay byte-identical.
- **Rng-free:** SP1 uses NO `Math.random` and NO rng stream. A seed's world evolves identically every run.
- **`noUnusedLocals` / `noUnusedParameters` are on** — no unused imports/params (prefix intentionally-unused with `_`).
- Run vitest from the worktree root: `C:/projects/WorldMaker/.claude/worktrees/jolly-easley-2721cc`.
- Placeholder constants carried from the cell sim (SP3 retunes; do not invent values): `SOL_INIT 0.5`, `SOL_RISE 0.03`, `SOL_DECAY 0.02`, `CONQUEST_SOL 0.7`, `W_ASA 1.0`, `W_LOCAL 0.5`, `W_POWER 0.03`, `W_DIST 0.002`, `SIZE_CAP 24`, `CONTEST_THRESH 1.03`, `PROVINCE_SIM_TICKS 50`.
- FNV-1a hash convention (matches world.test): `let h = 2166136261 >>> 0; for (const x of arr) { h ^= x; h = Math.imul(h, 16777619) >>> 0; }`.

## File Structure

- Create: `src/engine/provinceSim.ts` — the engine (adjacency, init, aggregate/strength, step).
- Test: `src/engine/provinceSim.test.ts` — all unit + golden + safety tests (node env).

All tasks add to these two files.

---

### Task 1: Province adjacency graph

**Files:** Create `src/engine/provinceSim.ts`, `src/engine/provinceSim.test.ts`

**Interfaces:**
- Produces: `buildProvinceAdj(provinceOf: ArrayLike<number>, provinces: Province[], grid: Pick<World["grid"], "count" | "neighbors">): number[][]` — index-aligned to provinces; `adj[p]` = sorted list of provinces sharing a land border with p. Symmetric.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { Province } from "./provinces";
import { buildProvinceAdj } from "./provinceSim";

// cells 0,1 → province 0; cell 2 → province 1; cell 3 = ocean (province -1). neighbours 1↔2 make 0,1 adjacent.
const grid = { count: 4, neighbors: [[1], [0, 2], [1, 3], [2]] };
const provinceOf = [0, 0, 1, -1];
const provinces: Province[] = [
  { id: 0, name: "A", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4 },
  { id: 1, name: "B", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5 },
];

describe("buildProvinceAdj", () => {
  it("links provinces that share a land border, symmetric, ocean ignored", () => {
    expect(buildProvinceAdj(provinceOf, provinces, grid)).toEqual([[1], [0]]);
  });
  it("gives an isolated province no neighbours", () => {
    const g2 = { count: 3, neighbors: [[1], [0], []] };
    expect(buildProvinceAdj([0, 0, 1], [provinces[0], provinces[1]], g2)).toEqual([[], []]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: FAIL — "Cannot find module './provinceSim'".

- [ ] **Step 3: Implement**

Create `src/engine/provinceSim.ts`:

```ts
import type { World } from "../types/world";
import type { Province } from "./provinces";

type GridLike = Pick<World["grid"], "count" | "neighbors">;

// two provinces are adjacent iff some land cell of one has a land-neighbour cell in the other.
export function buildProvinceAdj(
  provinceOf: ArrayLike<number>, provinces: Province[], grid: GridLike,
): number[][] {
  const adj: Set<number>[] = provinces.map(() => new Set<number>());
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c];
    if (p < 0) continue;
    for (const nb of grid.neighbors[c]) {
      const q = provinceOf[nb];
      if (q >= 0 && q !== p) { adj[p].add(q); adj[q].add(p); }
    }
  }
  return adj.map((s) => [...s].sort((a, b) => a - b));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(engine): province adjacency graph (P2 SP1)"
```

---

### Task 2: Initial state

**Files:** Modify `src/engine/provinceSim.ts`, `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `buildProvinceAdj` (Task 1).
- Produces:
  - `interface ProvinceSimState { provinces: Province[]; n: number; provOwner: Int32Array; provSol: Float32Array; adj: number[][]; capitalProv: Int32Array; alive: boolean[]; tick: number }`
  - `initProvinceSim(world: World): ProvinceSimState` — provinces snapped to their majority owner, then each nation's capital province FORCED to that nation (so no nation starts capital-less); solidarity `SOL_INIT` for owned provinces; `alive` all true.

- [ ] **Step 1: Write the failing test**

```ts
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim } from "./provinceSim";
// (add to the existing imports/describe file)

describe("initProvinceSim (seed 1)", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const s = initProvinceSim(world);
  it("owns one entry per province and starts every nation alive on its own capital province", () => {
    expect(s.n).toBe(world.provinces.length);
    expect(s.provOwner.length).toBe(s.n);
    for (const pol of world.polities) {
      const cap = s.capitalProv[pol.id];
      expect(cap).toBeGreaterThanOrEqual(0);
      expect(s.provOwner[cap]).toBe(pol.id);   // capital province forced to its nation
    }
    expect(s.alive.every(Boolean)).toBe(true);
    expect(s.tick).toBe(0);
  });
  it("seeds owned provinces at SOL_INIT (0.5) and unowned at 0", () => {
    for (let p = 0; p < s.n; p++) {
      expect(s.provSol[p]).toBe(s.provOwner[p] >= 0 ? 0.5 : 0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: FAIL — `initProvinceSim` is not a function.

- [ ] **Step 3: Implement**

Add to `src/engine/provinceSim.ts` (constants at top, below the imports):

```ts
const SOL_INIT = 0.5;

export const PROVINCE_SIM_TICKS = 50;

export interface ProvinceSimState {
  provinces: Province[];
  n: number;
  provOwner: Int32Array;   // province → polity id (-1 unowned)
  provSol: Float32Array;   // province → solidarity [0,1]
  adj: number[][];         // province land-adjacency, index-aligned to provinces
  capitalProv: Int32Array; // polity id → its capital province id
  alive: boolean[];        // polity id → still holds its capital province
  tick: number;
}

// each province's majority owner over its cells (ties → lower id; unowned → -1)
function majorityOwner(provinceOf: ArrayLike<number>, nProv: number, owner: ArrayLike<number>): Int32Array {
  const tally: Map<number, number>[] = Array.from({ length: nProv }, () => new Map<number, number>());
  for (let c = 0; c < provinceOf.length; c++) {
    const p = provinceOf[c];
    if (p < 0 || p >= nProv) continue;
    const o = owner[c];
    if (o < 0) continue;
    tally[p].set(o, (tally[p].get(o) ?? 0) + 1);
  }
  const out = new Int32Array(nProv).fill(-1);
  for (let p = 0; p < nProv; p++) {
    let best = -1, bestN = 0;
    for (const [o, k] of tally[p]) if (k > bestN || (k === bestN && o < best)) { bestN = k; best = o; }
    out[p] = best;
  }
  return out;
}

export function initProvinceSim(world: World): ProvinceSimState {
  const { provinces, provinceOf, polities, grid } = world;
  const n = provinces.length;
  const provOwner = majorityOwner(provinceOf, n, world.polityOf);
  const capitalProv = new Int32Array(polities.length).fill(-1);
  // force each nation's capital province to itself so no nation starts capital-less (majority snap could
  // otherwise hand a capital's province to a neighbour). Capital-province collisions (two capitals in one
  // province) are last-write-wins — vanishingly rare on the ~100-province map; acceptable for SP1.
  for (const pol of polities) {
    const cap = provinceOf[pol.capital];
    capitalProv[pol.id] = cap;
    if (cap >= 0) provOwner[cap] = pol.id;
  }
  const provSol = new Float32Array(n);
  for (let p = 0; p < n; p++) provSol[p] = provOwner[p] >= 0 ? SOL_INIT : 0;
  const adj = buildProvinceAdj(provinceOf, provinces, grid);
  const alive = polities.map((pol) => capitalProv[pol.id] >= 0 && provOwner[capitalProv[pol.id]] === pol.id);
  return { provinces, n, provOwner, provSol, adj, capitalProv, alive, tick: 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(engine): initial province-sim state (majority owner + forced capitals)"
```

---

### Task 3: Per-polity aggregate

**Files:** Modify `src/engine/provinceSim.ts`, `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `ProvinceSimState` (Task 2).
- Produces: `interface PAgg { cells: number; avg: number }` and `pAggregate(s: ProvinceSimState): PAgg[]` — per polity id: total member-province cells, and solidarity averaged over provinces weighted by cell count. Index = polity id; a polity owning nothing is `{cells:0, avg:0}`.

- [ ] **Step 1: Write the failing test**

```ts
import { pAggregate, type ProvinceSimState } from "./provinceSim";
import type { Province } from "./provinces";

function fakeState(over: Record<string, unknown> = {}): ProvinceSimState {
  const provinces: Province[] = [
    { id: 0, name: "A", cells: 10, centroid: [0, 0], seedCell: 0, biome: 4 },
    { id: 1, name: "B", cells: 30, centroid: [10, 0], seedCell: 1, biome: 4 },
  ];
  return {
    provinces, n: 2, provOwner: Int32Array.from([0, 0]), provSol: Float32Array.from([0.2, 0.6]),
    adj: [[1], [0]], capitalProv: Int32Array.from([0]), alive: [true], tick: 0, ...over,
  } as ProvinceSimState;
}

describe("pAggregate", () => {
  it("sums cells and averages solidarity weighted by province size", () => {
    const agg = pAggregate(fakeState());
    expect(agg[0].cells).toBe(40);
    // (0.2*10 + 0.6*30) / 40 = 0.5
    expect(agg[0].avg).toBeCloseTo(0.5, 6);
  });
  it("reports 0/0 for a polity that owns nothing", () => {
    const agg = pAggregate(fakeState({ provOwner: Int32Array.from([-1, -1]) }));
    expect(agg[0]).toEqual({ cells: 0, avg: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: FAIL — `pAggregate` is not a function.

- [ ] **Step 3: Implement**

Add to `src/engine/provinceSim.ts`:

```ts
export interface PAgg { cells: number; avg: number; }

export function pAggregate(s: ProvinceSimState): PAgg[] {
  const k = s.capitalProv.length; // number of polities
  const cells = new Float64Array(k), wsol = new Float64Array(k);
  for (let p = 0; p < s.n; p++) {
    const o = s.provOwner[p];
    if (o < 0 || o >= k) continue;
    const c = s.provinces[p].cells;
    cells[o] += c;
    wsol[o] += s.provSol[p] * c;
  }
  const out: PAgg[] = [];
  for (let id = 0; id < k; id++) out.push({ cells: cells[id], avg: cells[id] > 0 ? wsol[id] / cells[id] : 0 });
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(engine): per-polity province aggregate"
```

---

### Task 4: Step — solidarity update

**Files:** Modify `src/engine/provinceSim.ts`, `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `ProvinceSimState`.
- Produces: `stepProvinceSim(s: ProvinceSimState): void` — for now it ONLY does the solidarity update + `tick++` (Task 5 inserts contest before `tick++`). A frontier province (adjacent to a different owner) gains `SOL_RISE`; an interior one loses `SOL_DECAY`; clamped [0,1]; double-buffered.

- [ ] **Step 1: Write the failing test**

```ts
import { stepProvinceSim } from "./provinceSim";

describe("stepProvinceSim — solidarity", () => {
  // three provinces in a line: 0,1 owned by A(0); 2 owned by B(1). 1 borders 2 (frontier); 0 is interior.
  function line(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 3, provOwner: Int32Array.from([0, 0, 1]), provSol: Float32Array.from([0.5, 0.5, 0.5]),
      adj: [[1], [0, 2], [1]], capitalProv: Int32Array.from([0, 2]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("raises frontier provinces and decays interior ones", () => {
    const s = line();
    stepProvinceSim(s);
    expect(s.provSol[0]).toBeCloseTo(0.5 - 0.02, 5); // interior A province decays
    expect(s.provSol[1]).toBeCloseTo(0.5 + 0.03, 5); // A province bordering B rises
    expect(s.provSol[2]).toBeCloseTo(0.5 + 0.03, 5); // B province bordering A rises
    expect(s.tick).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: FAIL — `stepProvinceSim` is not a function.

- [ ] **Step 3: Implement**

Add to `src/engine/provinceSim.ts` (constants near the top with `SOL_INIT`):

```ts
const SOL_RISE = 0.03, SOL_DECAY = 0.02;
```

and the function:

```ts
export function stepProvinceSim(s: ProvinceSimState): void {
  const { n, provOwner, adj } = s;
  // 1. solidarity: frontier provinces (adjacent to a different owner) rise; interior provinces decay
  const nextSol = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const o = provOwner[p];
    if (o < 0) { nextSol[p] = 0; continue; }
    let frontier = false;
    for (const q of adj[p]) if (provOwner[q] !== o) { frontier = true; break; }
    const sv = s.provSol[p] + (frontier ? SOL_RISE : -SOL_DECAY);
    nextSol[p] = sv < 0 ? 0 : sv > 1 ? 1 : sv;
  }
  s.provSol = nextSol;
  // 2. contest & conquest — added in Task 5, BEFORE the tick bump
  s.tick++;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(engine): province-sim step — solidarity update"
```

---

### Task 5: Step — contest, whole-province conquest, capital defeat

**Files:** Modify `src/engine/provinceSim.ts`, `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `pAggregate`, `stepProvinceSim` (extends it).
- Produces: an internal `strength(...)` and the contest pass inside `stepProvinceSim` — each province contests its strongest LIVE adjacent enemy; if `atk > def·CONTEST_THRESH` the whole province flips to the aggressor and resets to `CONQUEST_SOL`; `alive` recomputed (a polity that lost its capital province stops initiating attacks thereafter).

- [ ] **Step 1: Write the failing test**

```ts
describe("stepProvinceSim — conquest & capital defeat", () => {
  // B(1)'s lone province 1 is its capital and is weak; A(0) is large and cohesive next door → A takes it,
  // eliminating B. A's provinces 0 (capital) and 2 make A big; province 1 is B's only (capital) province.
  function fixture(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2].map((i) => ({ id: i, name: String(i), cells: 20, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 3, provOwner: Int32Array.from([0, 1, 0]),
      provSol: Float32Array.from([0.9, 0.1, 0.9]),
      adj: [[1], [0, 2], [1]], capitalProv: Int32Array.from([0, 1]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("flips the whole weak enemy province to the strong aggressor and resets its solidarity", () => {
    const s = fixture();
    stepProvinceSim(s);
    expect(s.provOwner[1]).toBe(0);          // province 1 conquered by A
    expect(s.provSol[1]).toBeCloseTo(0.7, 5); // fresh conquest → CONQUEST_SOL
  });
  it("marks a nation dead once its capital province is taken", () => {
    const s = fixture();
    stepProvinceSim(s);
    expect(s.alive[1]).toBe(false); // B lost its capital province
    expect(s.alive[0]).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: FAIL — province 1 not conquered / `alive[1]` still true (no contest logic yet).

- [ ] **Step 3: Implement**

Add the constants (near the others):

```ts
const CONQUEST_SOL = 0.7;
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002, SIZE_CAP = 24, CONTEST_THRESH = 1.03;
```

Add the strength helper (above `stepProvinceSim`):

```ts
function centroidDist(a: Province, b: Province): number {
  return Math.hypot(a.centroid[0] - b.centroid[0], a.centroid[1] - b.centroid[1]);
}

// mirrors the cell sim's contestStrength(polity, distCell, solCell) at province granularity.
function strength(s: ProvinceSimState, agg: PAgg[], polity: number, distProv: number, solProv: number): number {
  const cap = s.capitalProv[polity];
  const d = cap >= 0 ? centroidDist(s.provinces[distProv], s.provinces[cap]) : 0;
  return W_ASA * agg[polity].avg
    + W_LOCAL * s.provSol[solProv]
    + W_POWER * Math.sqrt(Math.min(agg[polity].cells, SIZE_CAP))
    - W_DIST * d;
}
```

Then replace the `// 2. contest ...` comment + `s.tick++;` at the end of `stepProvinceSim` with:

```ts
  // 2. contest & whole-province conquest (double-buffered). Each province meets its strongest LIVE
  // adjacent enemy; if the attacker beats the defender by the threshold, the whole province flips.
  const agg = pAggregate(s);
  const nextOwner = provOwner.slice();
  const conquered: number[] = [];
  for (let p = 0; p < n; p++) {
    const o = provOwner[p];
    let best = -1, bestAvg = -Infinity, bestQ = -1;
    for (const q of adj[p]) {
      const po = provOwner[q];
      if (po < 0 || po === o || !s.alive[po]) continue; // dead nations (no capital) don't initiate
      if (agg[po].avg > bestAvg) { bestAvg = agg[po].avg; best = po; bestQ = q; }
    }
    if (best < 0) continue;
    const atk = strength(s, agg, best, p, bestQ);
    const def = o < 0 ? 0 : strength(s, agg, o, p, p);
    if (atk > def * CONTEST_THRESH) { nextOwner[p] = best; conquered.push(p); }
  }
  s.provOwner = nextOwner;
  // fresh conquests reset to CONQUEST_SOL — applied AFTER the loop so contest reads the stable stepped
  // solidarity (no mid-loop mutation of provSol that a later province could read)
  for (const p of conquered) s.provSol[p] = CONQUEST_SOL;
  // a polity that lost its capital province is dead (stops initiating attacks next tick)
  for (let id = 0; id < s.alive.length; id++) {
    s.alive[id] = s.capitalProv[id] >= 0 && s.provOwner[s.capitalProv[id]] === id;
  }
  s.tick++;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS (both new cases + all earlier tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(engine): province contest, whole-province conquest, capital defeat"
```

---

### Task 6: Golden anchors, determinism, and Version-A safety

**Files:** Modify `src/engine/provinceSim.test.ts`

**Interfaces:** Consumes the whole module. No new production code — this task pins determinism and proves the engine is non-trivial and safe.

- [ ] **Step 1: Write the failing test (golden values as placeholders to be filled from the first run)**

```ts
import { PROVINCE_SIM_TICKS } from "./provinceSim";

function fnv(arr: ArrayLike<number>): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arr.length; i++) { h ^= (arr[i] + 1) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function ownerShare(s: { provOwner: Int32Array; provinces: { cells: number }[] }): Map<number, number> {
  const m = new Map<number, number>();
  for (let p = 0; p < s.provOwner.length; p++) { const o = s.provOwner[p]; if (o >= 0) m.set(o, (m.get(o) ?? 0) + s.provinces[p].cells); }
  return m;
}

describe("provinceSim determinism + safety (seed 1)", () => {
  it("pins the seed-1 golden hashes (initial + after 50 ticks) — deterministic, rng-free", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initProvinceSim(world);
    expect(fnv(s.provOwner)).toBe(0); // PLACEHOLDER — replace with the actual value printed on first run
    for (let t = 0; t < PROVINCE_SIM_TICKS; t++) stepProvinceSim(s);
    expect(s.tick).toBe(PROVINCE_SIM_TICKS);
    expect(fnv(s.provOwner)).toBe(0); // PLACEHOLDER — replace with the actual value printed on first run
  });
  it("is not static — territory concentrates (the top nation grows, some nations are eliminated)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initProvinceSim(world);
    const t0 = ownerShare(s);
    const topStart = Math.max(...t0.values());
    const aliveStart = s.alive.filter(Boolean).length;
    for (let t = 0; t < PROVINCE_SIM_TICKS; t++) stepProvinceSim(s);
    const topEnd = Math.max(...ownerShare(s).values());
    const aliveEnd = s.alive.filter(Boolean).length;
    expect(topEnd).toBeGreaterThan(topStart);  // a dominant power emerged
    expect(aliveEnd).toBeLessThan(aliveStart); // at least one nation was conquered
  });
  it("does not perturb Version A's world-gen golden hash (fork is isolated)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
  });
});
```

- [ ] **Step 2: Run to capture the golden values**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: the two PLACEHOLDER assertions FAIL, printing `expected <actual> to be 0`. Note the two actual `provOwner` hashes (initial and 50-tick). Also confirm the "not static" and "Version A" cases PASS.

If the "not static" case fails (e.g. `topEnd` not greater), STOP and report — it means the placeholder constants produce a static or degenerate world, which is a real finding for SP3 (do not tweak constants to force the test green; report it).

- [ ] **Step 3: Pin the captured values**

Replace the two `toBe(0)` placeholders with the actual hashes printed in Step 2. These now guard determinism.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run` — Expected: all pass, including `world.test` (Version A golden hashes unchanged).
Run: `npm run build` — Expected: builds (a pre-existing `TS2688 'node'` type error, if it appears, is an unrelated environment gap — report it as such; any other error is yours).

- [ ] **Step 6: Commit**

```bash
git add src/engine/provinceSim.test.ts
git commit -m "test(engine): pin province-sim golden hashes + non-static + Version-A safety"
```

---

## Post-implementation

- SP1 delivers a tested headless engine. Next: **SP2** (player levers + wiring into `play.html`), then **SP3** (balance re-tune — the placeholder constants almost certainly need province-scale tuning; the "not static" test is the first signal the dynamics are alive).
