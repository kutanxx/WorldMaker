# Province Partition (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, ownership-independent partition of the world's land into ~100 connected, named provinces, attached to `World`, with no change to any existing simulation or golden hash.

**Architecture:** A new pure engine module `src/engine/provinces.ts` computes provinces via farthest-point seeding + multi-source BFS over the land adjacency graph (guarantees connected provinces that never cross water). It runs on its own rng stream (salt 8100) and is assembled in `generateWorld`, exposed as `world.provinceOf` (cell → province id, -1 for ocean) and `world.provinces` (id, name, cells, centroid, seedCell, biome).

**Tech Stack:** TypeScript, Vite MPA, Vitest. Determinism via `mulberry32(deriveSeed(seed, salt))`.

## Global Constraints

- **Determinism:** provinces use ONLY `mulberry32(deriveSeed(params.seed, 8100))`; they READ existing arrays (`terrain`, `grid`, `biome`) and add NO draw to any existing rng stream. Existing golden FNV hashes (world.test `polityOf` = 1350115163, cities = 4294534188, 28 cities) MUST stay byte-identical.
- **Pure engine module:** no DOM, no imports from `src/ui/`.
- **Build:** `npm run build` runs `tsc --noEmit` with `noUnusedLocals` — no unused imports/locals.
- **Run tests from the WORKTREE root** (`npx vitest run ...`), never the parent repo (it globs worktree copies).
- **Ocean sentinel:** non-land cells (`terrain[c] === OCEAN`) get `provinceOf = -1` and belong to no province.

---

### Task 1: Farthest-point province seeds

**Files:**
- Create: `src/engine/provinces.ts`
- Test: `src/engine/provinces.test.ts`

**Interfaces:**
- Consumes: `GridLike = { count: number; neighbors: number[][]; points: number[] }`, `terrain: ArrayLike<number>`, `OCEAN` from `./terrain`, `Rng` from `./rng`.
- Produces: `export function pickProvinceSeeds(grid: GridLike, terrain: ArrayLike<number>, target: number, rng: Rng): number[]` — an array of distinct land-cell indices (the first is an rng pick; the rest maximise minimum squared distance to the chosen set). Length `min(target, landCount)`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/provinces.test.ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import { mulberry32, deriveSeed } from "./rng";
import { pickProvinceSeeds } from "./provinces";

const grid1 = () => generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;

describe("pickProvinceSeeds", () => {
  it("picks `target` distinct land seeds, deterministically", () => {
    const w = grid1();
    const rngA = mulberry32(deriveSeed(1, 8100));
    const rngB = mulberry32(deriveSeed(1, 8100));
    const a = pickProvinceSeeds(w.grid, w.terrain, 100, rngA);
    const b = pickProvinceSeeds(w.grid, w.terrain, 100, rngB);
    expect(a.length).toBe(100);
    expect(new Set(a).size).toBe(100);             // distinct
    for (const c of a) expect(w.terrain[c]).not.toBe(OCEAN); // land only
    expect(a).toEqual(b);                          // deterministic
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/provinces.test.ts`
Expected: FAIL — `pickProvinceSeeds` is not exported / module has no such member.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/engine/provinces.ts
import type { Rng } from "./rng";
import { OCEAN } from "./terrain";

export const PROVINCE_SALT = 8100;
export const PROVINCE_TARGET = 100;

export type GridLike = { count: number; neighbors: number[][]; points: number[] };

// farthest-point sampling: the first seed is an rng pick; each subsequent seed is the land cell
// whose minimum (squared) distance to the already-chosen seeds is greatest. Even + deterministic.
export function pickProvinceSeeds(grid: GridLike, terrain: ArrayLike<number>, target: number, rng: Rng): number[] {
  const land: number[] = [];
  for (let c = 0; c < grid.count; c++) if (terrain[c] !== OCEAN) land.push(c);
  if (land.length <= target) return land.slice();
  const px = (i: number) => grid.points[i * 2], py = (i: number) => grid.points[i * 2 + 1];
  const minD = new Float64Array(grid.count).fill(Infinity);
  const relax = (s: number) => {
    for (const c of land) {
      const dx = px(c) - px(s), dy = py(c) - py(s);
      const d = dx * dx + dy * dy;
      if (d < minD[c]) minD[c] = d;
    }
  };
  const seeds: number[] = [land[Math.floor(rng() * land.length)]];
  relax(seeds[0]);
  while (seeds.length < target) {
    let best = -1, bestD = -1;
    for (const c of land) { if (minD[c] > bestD) { bestD = minD[c]; best = c; } } // ties → lowest index
    seeds.push(best);
    relax(best);
  }
  return seeds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/provinces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinces.ts src/engine/provinces.test.ts
git commit -m "feat(engine): farthest-point province seeds"
```

---

### Task 2: Multi-source BFS assignment

**Files:**
- Modify: `src/engine/provinces.ts`
- Test: `src/engine/provinces.test.ts`

**Interfaces:**
- Consumes: `pickProvinceSeeds` (Task 1), `GridLike`, `terrain`.
- Produces: `export function assignProvinces(grid: GridLike, terrain: ArrayLike<number>, seeds: number[]): Int32Array` — `provinceOf` where seed `i` owns province `i`; ocean and any land not reachable from a seed are `-1`. Every province produced this way is connected (BFS over `neighbors`, land only).

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/engine/provinces.test.ts
import { assignProvinces } from "./provinces";

describe("assignProvinces", () => {
  it("assigns land by BFS: seeds own themselves, ocean stays -1, provinces are connected", () => {
    const w = grid1();
    const rng = mulberry32(deriveSeed(1, 8100));
    const seeds = pickProvinceSeeds(w.grid, w.terrain, 100, rng);
    const pof = assignProvinces(w.grid, w.terrain, seeds);
    expect(pof.length).toBe(w.grid.count);
    seeds.forEach((s, i) => expect(pof[s]).toBe(i)); // each seed owns its own province
    for (let c = 0; c < w.grid.count; c++) if (w.terrain[c] === OCEAN) expect(pof[c]).toBe(-1);
    // connectivity: BFS within a province id reaches every cell holding that id
    const target = pof[seeds[7]];
    const members = new Set<number>();
    for (let c = 0; c < w.grid.count; c++) if (pof[c] === target) members.add(c);
    const seen = new Set<number>([seeds[7]]); const q = [seeds[7]];
    for (let h = 0; h < q.length; h++) for (const nb of w.grid.neighbors[q[h]]) {
      if (pof[nb] === target && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
    expect(seen.size).toBe(members.size); // one connected component
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/provinces.test.ts -t assignProvinces`
Expected: FAIL — `assignProvinces` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to src/engine/provinces.ts
// multi-source BFS over the land adjacency graph: seed i owns province i; ties (equal graph
// distance) go to the lower seed index (FIFO frontier). Guarantees connected, water-respecting
// provinces. Land not reachable from any seed stays -1 (Task 3 cleans those up).
export function assignProvinces(grid: GridLike, terrain: ArrayLike<number>, seeds: number[]): Int32Array {
  const provinceOf = new Int32Array(grid.count).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < seeds.length; i++) { provinceOf[seeds[i]] = i; queue.push(seeds[i]); }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head], pid = provinceOf[c];
    for (const nb of grid.neighbors[c]) {
      if (terrain[nb] !== OCEAN && provinceOf[nb] === -1) { provinceOf[nb] = pid; queue.push(nb); }
    }
  }
  return provinceOf;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/provinces.test.ts`
Expected: PASS (both describes).

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinces.ts src/engine/provinces.test.ts
git commit -m "feat(engine): multi-source BFS province assignment"
```

---

### Task 3: Assemble named provinces (`buildProvinces`)

**Files:**
- Modify: `src/engine/geography.ts` (export `featureName`)
- Modify: `src/engine/provinces.ts`
- Test: `src/engine/provinces.test.ts`

**Interfaces:**
- Consumes: `pickProvinceSeeds`, `assignProvinces`, `featureName(rng: Rng, ng: { nation(): string }, kind: number): string` (exported from `./geography`), `makeNameGen` from `./names`.
- Produces:
  - `export interface Province { id: number; name: string; cells: number; centroid: [number, number]; seedCell: number; biome: number }`
  - `export function buildProvinces(grid: GridLike, terrain: ArrayLike<number>, biome: ArrayLike<number>, rng: Rng, target?: number): { provinceOf: Int32Array; provinces: Province[] }` — full partition: every land cell has `provinceOf >= 0` (leftover land components become extra provinces), ocean is `-1`, each province named by its dominant biome.

- [ ] **Step 1: Export `featureName` from geography.ts**

In `src/engine/geography.ts`, change the declaration on the line `function featureName(rng: Rng, ng: { nation(): string }, kind: number): string {` to:

```typescript
export function featureName(rng: Rng, ng: { nation(): string }, kind: number): string {
```

(No other change to that file.)

- [ ] **Step 2: Write the failing test**

```typescript
// append to src/engine/provinces.test.ts
import { buildProvinces } from "./provinces";

describe("buildProvinces", () => {
  it("partitions ALL land with named, connected provinces; ocean is -1; deterministic", () => {
    const w = grid1();
    const run = () => buildProvinces(w.grid, w.terrain, w.biome, mulberry32(deriveSeed(1, 8100)), 100);
    const { provinceOf, provinces } = run();
    // full land coverage, ocean excluded
    let land = 0, covered = 0;
    for (let c = 0; c < w.grid.count; c++) {
      if (w.terrain[c] === OCEAN) { expect(provinceOf[c]).toBe(-1); continue; }
      land++;
      if (provinceOf[c] >= 0 && provinceOf[c] < provinces.length) covered++;
    }
    expect(covered).toBe(land);
    // partition: sum of province cell counts equals land count
    expect(provinces.reduce((s, p) => s + p.cells, 0)).toBe(land);
    // every province is named and non-empty
    for (const p of provinces) { expect(p.name.length).toBeGreaterThan(0); expect(p.cells).toBeGreaterThan(0); }
    // count is at least the seed target (may exceed by seedless-island cleanup)
    expect(provinces.length).toBeGreaterThanOrEqual(100);
    // deterministic: a second run is identical
    const again = run();
    expect(Array.from(again.provinceOf)).toEqual(Array.from(provinceOf));
    expect(again.provinces.map((p) => p.name)).toEqual(provinces.map((p) => p.name));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/engine/provinces.test.ts -t buildProvinces`
Expected: FAIL — `buildProvinces` not exported.

- [ ] **Step 4: Write minimal implementation**

```typescript
// add imports at the TOP of src/engine/provinces.ts (next to the existing ones)
import { makeNameGen } from "./names";
import { featureName } from "./geography";

// append to src/engine/provinces.ts
export interface Province {
  id: number; name: string; cells: number; centroid: [number, number]; seedCell: number; biome: number;
}

export function buildProvinces(
  grid: GridLike, terrain: ArrayLike<number>, biome: ArrayLike<number>, rng: Rng, target = PROVINCE_TARGET,
): { provinceOf: Int32Array; provinces: Province[] } {
  const seedCells = pickProvinceSeeds(grid, terrain, target, rng);
  const provinceOf = assignProvinces(grid, terrain, seedCells);
  // cleanup: land whose landmass held no seed is still -1 — flood-fill each such component as a new province
  for (let c = 0; c < grid.count; c++) {
    if (terrain[c] === OCEAN || provinceOf[c] !== -1) continue;
    const pid = seedCells.length;
    seedCells.push(c);
    provinceOf[c] = pid;
    const q = [c];
    for (let h = 0; h < q.length; h++) {
      for (const nb of grid.neighbors[q[h]]) {
        if (terrain[nb] !== OCEAN && provinceOf[nb] === -1) { provinceOf[nb] = pid; q.push(nb); }
      }
    }
  }
  // aggregate cells / centroid / dominant biome, then name (rng order = province id order → deterministic)
  const count = seedCells.length;
  const cells = new Int32Array(count), sumX = new Float64Array(count), sumY = new Float64Array(count);
  const biomeCount: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  for (let c = 0; c < grid.count; c++) {
    const p = provinceOf[c]; if (p < 0) continue;
    cells[p]++; sumX[p] += grid.points[c * 2]; sumY[p] += grid.points[c * 2 + 1];
    const b = biome[c]; biomeCount[p].set(b, (biomeCount[p].get(b) ?? 0) + 1);
  }
  const ng = makeNameGen(rng);
  const provinces: Province[] = [];
  for (let p = 0; p < count; p++) {
    let domB = 0, domN = -1;
    for (const [b, n] of biomeCount[p]) if (n > domN) { domN = n; domB = b; }
    provinces.push({
      id: p, name: featureName(rng, ng, domB), cells: cells[p],
      centroid: [sumX[p] / cells[p], sumY[p] / cells[p]], seedCell: seedCells[p], biome: domB,
    });
  }
  return { provinceOf, provinces };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/engine/provinces.test.ts`
Expected: PASS (all three describes).

- [ ] **Step 6: Commit**

```bash
git add src/engine/provinces.ts src/engine/provinces.test.ts src/engine/geography.ts
git commit -m "feat(engine): assemble named province partition (buildProvinces)"
```

---

### Task 4: Wire into the world + golden hashes

**Files:**
- Modify: `src/types/world.ts` (add `provinceOf`, `provinces` to `World`)
- Modify: `src/engine/world.ts` (build provinces, attach to `world`)
- Test: `src/engine/world.test.ts` (province golden hash + no-regression guard)

**Interfaces:**
- Consumes: `buildProvinces`, `PROVINCE_SALT`, `Province` (from `./provinces`), `mulberry32`, `deriveSeed` (already imported in world.ts).
- Produces: `world.provinceOf: number[]` (length `grid.count`, ocean `-1`) and `world.provinces: Province[]`.

- [ ] **Step 1: Add fields to the `World` type**

In `src/types/world.ts`, add an import near the top (after the existing type imports):

```typescript
import type { Province } from "../engine/provinces";
```

Then inside the `World` interface (e.g. right after the `polities: Polity[];` line), add:

```typescript
  provinceOf: number[];
  provinces: Province[];
```

- [ ] **Step 2: Write the failing golden/regression test**

```typescript
// append to src/engine/world.test.ts
describe("province partition", () => {
  it("adds no main-stream draws (existing golden hash holds) and pins the province partition", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    // regression: the political golden hash is byte-identical (provinces use a separate rng stream)
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
    // partition invariants
    expect(world.provinceOf.length).toBe(world.grid.count);
    for (let c = 0; c < world.grid.count; c++) {
      if (world.terrain[c] === OCEAN) expect(world.provinceOf[c]).toBe(-1);
      else expect(world.provinceOf[c]).toBeGreaterThanOrEqual(0);
    }
    // golden partition hash (locks the deterministic province map)
    let ph = 2166136261 >>> 0;
    for (const p of world.provinceOf) { ph ^= (p + 1); ph = Math.imul(ph, 16777619) >>> 0; }
    expect(ph >>> 0).toBe(0);              // ← replace 0 with the printed actual in Step 5
    expect(world.provinces.length).toBe(0); // ← replace 0 with the printed actual in Step 5
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/engine/world.test.ts -t "province partition"`
Expected: FAIL — `world.provinceOf` is `undefined` (field not built yet).

- [ ] **Step 4: Build provinces in `generateWorld`**

In `src/engine/world.ts`, add the import to the existing import block:

```typescript
import { buildProvinces, PROVINCE_SALT } from "./provinces";
```

Immediately AFTER the river-names block (the `const rivers = nameRivers(...)` line, ~line 98) and BEFORE `const world: World = {`, add:

```typescript
  // provinces: a fixed geographic partition of the land on its own rng stream (8100), read-only over
  // terrain/biome/grid — adds no main-stream draw, so the golden regression stays byte-unchanged
  const provRng = mulberry32(deriveSeed(params.seed, PROVINCE_SALT));
  const { provinceOf, provinces } = buildProvinces(grid, terrain, biome, provRng);
```

Then inside the `const world: World = { ... }` literal, add these two fields (e.g. after `polities,`):

```typescript
    provinceOf: Array.from(provinceOf),
    provinces,
```

- [ ] **Step 5: Run the test, capture the real hash/count, pin them**

Run: `npx vitest run src/engine/world.test.ts -t "province partition"`
Expected: FAIL showing the actual province hash (`expected <actual> to be 0`) and the actual `provinces.length`. Copy both printed actual values into the test — replace the `.toBe(0)` on the hash line with the printed province hash, and the `.toBe(0)` on the length line with the printed count (expected ≈ 100–110). Re-run:

Run: `npx vitest run src/engine/world.test.ts`
Expected: PASS (province partition + all existing biome/history golden hashes unchanged).

- [ ] **Step 6: Full suite + build**

Run: `npx vitest run`
Expected: all pass (prior count + the new province tests).
Run: `npx vitest run src/engine/world.test.ts src/engine/history.test.ts`
Expected: PASS — existing golden anchors untouched.

- [ ] **Step 7: Commit**

```bash
git add src/types/world.ts src/engine/world.ts src/engine/world.test.ts
git commit -m "feat(engine): attach province partition to the world + golden hash"
```

---

## Post-implementation: visual validation (not a committed task)

Before P1, eyeball the partition in a real browser to confirm evenness/connectivity: temporarily tint each cell by `provinceOf` (e.g. a throwaway overlay keyed on `world.provinces[provinceOf[c]]`), load the map, confirm provinces look reasonably uniform and contiguous with no water-crossing. If they read as arbitrary blobs, the deferred biome-aware BFS-cost refinement (from the spec) is the lever. Remove the throwaway render before moving on.

## Self-Review notes (spec coverage)

- Partition algorithm (farthest-point + BFS) → Tasks 1–2. ✓
- ~100 count dial (`PROVINCE_TARGET`) → Task 1/3. ✓
- Connected, ownership-independent, ocean=-1 → Tasks 2–3 + Task 4 invariants. ✓
- Determinism / separate salt 8100 / golden untouched → Global Constraints + Task 4 regression assertion. ✓
- Naming via `featureName` → Task 3. ✓
- `world.provinceOf` / `world.provinces` exposure → Task 4. ✓
- Full land coverage incl. seedless islands → Task 3 cleanup loop + Task 4 invariant. ✓
- Visual validation → post-implementation note. ✓
