# Army-conquest prototype (levy → march → battle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable prototype where you levy men from provinces (costing population), march armies into adjacent provinces, and win battles by numbers modified by terrain — so we can answer one question: is this loop fun turn after turn?

**Architecture:** A new pure engine `src/engine/armySim.ts` (population derived from the generated world, levy, armies, movement, battle, upkeep, regrowth, dumb AI, `endTurn`) plus a minimal UI `src/ui/armyApp.ts` on a new page `playArmy.html`. Reuses world generation, `Province`, `buildProvinceAdj`, and the existing SVG helpers. The deployed province game and all its tests are untouched.

**Tech Stack:** TypeScript, Vitest (node for engine, jsdom for UI), inline SVG via `svgEl`, Vite multi-page build.

## Global Constraints

- PROTOTYPE. Ugly is fine. Answer "is the loop fun", nothing more.
- NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, or any existing golden/test. The 716 existing tests must still pass untouched.
- Engine is pure and rng-free: same seed + same commands → identical state. No `Math.random()`, no `Date.now()`.
- Constants live in ONE exported block in `armySim.ts` with these exact values:
  `LEVY_FRAC = 0.2`, `REGROW_FRAC = 0.03`, `UPKEEP_FRAC = 0.03`, `MILITIA_FRAC = 0.2`, `WIN_LOSS_MULT = 0.6`, `CITY_BONUS = 0.5`.
- `BIOME_POP` (by biome constant): `GRASSLAND 1.0`, `TEMPERATE_FOREST 0.8`, `TROPICAL 0.7`, `TAIGA 0.5`, `WETLAND 0.5`, `TUNDRA 0.3`, `DESERT 0.3`, `ALPINE 0.25`, `OCEAN 0`.
- `BIOME_DEF` (by biome constant): `GRASSLAND 0.85`, `DESERT 0.9`, `TUNDRA 1.0`, `TROPICAL 1.15`, `TEMPERATE_FOREST 1.2`, `TAIGA 1.2`, `WETLAND 1.35`, `ALPINE 1.6`, `OCEAN 1.0`.
- Battle: `militia = floor(pop × MILITIA_FRAC)`; `def = (enemyArmyMen + militia) × BIOME_DEF[biome]`; attacker wins iff `atk > def`.
- Movement is LAND-adjacency only (`buildProvinceAdj`), one move per army per turn.
- No victory condition. Free play with a turn counter.
- Korean UI strings inline (`lang === "ko" ? … : …` is NOT needed — this prototype is Korean-only; use plain Korean strings).
- Run tests from the worktree root: `npx vitest run <file>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/armySim.ts` (new) | All game rules: state, population, levy, move, battle, upkeep, regrow, AI, endTurn. Pure. |
| `src/engine/armySim.test.ts` (new) | Engine unit tests. |
| `src/ui/armyApp.ts` (new) | Minimal UI: map render, click-to-levy, click-army-then-target, end turn, log. |
| `src/ui/armyApp.test.ts` (new) | jsdom smoke test. |
| `src/ui/armyMain.ts` (new) | Entry point (mirrors `provinceMain.ts`). |
| `playArmy.html` (new) | Page shell (mirrors `playProvince.html`). |
| `vite.config.ts` (modify) | Add `playArmy` to `rollupOptions.input`. |
| `src/theme.css` (modify) | A few `.army-*` classes. |

---

### Task 1: State + population derived from the world

**Files:**
- Create: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `World` from `../types/world`, `buildProvinceAdj` from `./provinceSim`, biome constants from `./biome`.
- Produces:
  - `export const LEVY_FRAC, REGROW_FRAC, UPKEEP_FRAC, MILITIA_FRAC, WIN_LOSS_MULT, CITY_BONUS: number`
  - `export const BIOME_POP: Record<number, number>`, `export const BIOME_DEF: Record<number, number>`
  - `export interface Army { prov: number; nation: number; men: number }`
  - `export interface ArmyState { world: World; n: number; owner: Int32Array; pop: Float64Array; basePop: Float64Array; armies: Army[]; adj: number[][]; turn: number }`
  - `export function basePopOf(world: World, provId: number): number`
  - `export function initArmySim(world: World): ArmyState`

- [ ] **Step 1: Write the failing test**

Create `src/engine/armySim.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { basePopOf, initArmySim, BIOME_POP, BIOME_DEF } from "./armySim";
import { GRASSLAND, ALPINE } from "./biome";

describe("basePopOf (population comes from the generated world)", () => {
  it("scales with province size and biome, and is 0 for no cells", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    for (const p of world.provinces) {
      const pop = basePopOf(world, p.id);
      expect(pop).toBeGreaterThanOrEqual(0);
      // population must be proportional to cells x biome weight, before city bonus
      const floor = p.cells * (BIOME_POP[p.biome] ?? 0);
      expect(pop).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });
  it("weights a grassland province above an alpine one of the same size", () => {
    expect(BIOME_POP[GRASSLAND]).toBeGreaterThan(BIOME_POP[ALPINE]);
    expect(BIOME_DEF[ALPINE]).toBeGreaterThan(BIOME_DEF[GRASSLAND]);
    expect(BIOME_DEF[GRASSLAND]).toBeLessThan(1); // open ground favours the ATTACKER
  });
});

describe("initArmySim", () => {
  it("starts every province owned as the world says, at full population, with no armies", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    expect(s.n).toBe(world.provinces.length);
    expect(s.armies).toEqual([]);
    expect(s.turn).toBe(0);
    for (let p = 0; p < s.n; p++) {
      expect(s.pop[p]).toBe(s.basePop[p]);
      expect(s.basePop[p]).toBe(basePopOf(world, p));
    }
    // at least one province is owned by each live polity's majority snap
    expect([...s.owner].some((o) => o >= 0)).toBe(true);
    expect(s.adj.length).toBe(s.n);
  });
  it("is deterministic for the same seed", () => {
    const a = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world);
    const b = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 3 }).world);
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.pop]).toEqual([...b.pop]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: FAIL — cannot resolve `./armySim`.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/armySim.ts`:

```typescript
import type { World } from "../types/world";
import { buildProvinceAdj } from "./provinceSim";
import { OCEAN, TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE } from "./biome";

// --- tunable constants (the whole balance surface of the prototype lives here) ---
export const LEVY_FRAC = 0.2;      // max share of a province's population one levy takes
export const REGROW_FRAC = 0.03;   // share of basePop regained per turn
export const UPKEEP_FRAC = 0.03;   // share of an army lost per turn (use it or lose it)
export const MILITIA_FRAC = 0.2;   // share of a province's population that defends it in battle
export const WIN_LOSS_MULT = 0.6;  // winner's losses as a share of the loser's effective strength
export const CITY_BONUS = 0.5;     // population multiplier added per city in the province

// population potential by biome: rich plains, empty mountains
export const BIOME_POP: Record<number, number> = {
  [OCEAN]: 0, [GRASSLAND]: 1.0, [TEMPERATE_FOREST]: 0.8, [TROPICAL]: 0.7,
  [TAIGA]: 0.5, [WETLAND]: 0.5, [TUNDRA]: 0.3, [DESERT]: 0.3, [ALPINE]: 0.25,
};

// defensibility by biome. Below 1.0 = the ATTACKER is favoured (open ground), so defence
// never simply pays and the map cannot stalemate.
export const BIOME_DEF: Record<number, number> = {
  [OCEAN]: 1.0, [GRASSLAND]: 0.85, [DESERT]: 0.9, [TUNDRA]: 1.0, [TROPICAL]: 1.15,
  [TEMPERATE_FOREST]: 1.2, [TAIGA]: 1.2, [WETLAND]: 1.35, [ALPINE]: 1.6,
};

export interface Army { prov: number; nation: number; men: number }

export interface ArmyState {
  world: World;
  n: number;
  owner: Int32Array;      // province -> nation id (-1 unowned)
  pop: Float64Array;      // province -> current population
  basePop: Float64Array;  // province -> population ceiling
  armies: Army[];
  adj: number[][];
  turn: number;
}

// a province's population ceiling, derived from the generated world: size x biome x cities.
export function basePopOf(world: World, provId: number): number {
  const p = world.provinces[provId];
  if (!p) return 0;
  let cities = 0;
  for (const c of world.cities) if (world.provinceOf[c.cell] === provId) cities++;
  return p.cells * (BIOME_POP[p.biome] ?? 0) * (1 + CITY_BONUS * cities);
}

// each province's majority owner over its cells (ties -> lower id; unowned -> -1)
function majorityOwner(world: World, nProv: number): Int32Array {
  const tally: Map<number, number>[] = Array.from({ length: nProv }, () => new Map<number, number>());
  for (let c = 0; c < world.provinceOf.length; c++) {
    const p = world.provinceOf[c];
    if (p < 0 || p >= nProv) continue;
    const o = world.polityOf[c];
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

export function initArmySim(world: World): ArmyState {
  const n = world.provinces.length;
  const owner = majorityOwner(world, n);
  // a nation must not start capital-less: force each capital's province to its polity
  for (const pol of world.polities) {
    const cap = world.provinceOf[pol.capital];
    if (cap >= 0) owner[cap] = pol.id;
  }
  const basePop = new Float64Array(n);
  const pop = new Float64Array(n);
  for (let p = 0; p < n; p++) { basePop[p] = basePopOf(world, p); pop[p] = basePop[p]; }
  const adj = buildProvinceAdj(world.provinceOf, world.provinces, world.grid);
  return { world, n, owner, pop, basePop, armies: [], adj, turn: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): state + population derived from biome, size and cities"
```

---

### Task 2: Levy, upkeep, regrowth

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `ArmyState`, `Army`, `LEVY_FRAC`, `UPKEEP_FRAC`, `REGROW_FRAC` (Task 1).
- Produces:
  - `export function maxLevy(s: ArmyState, prov: number): number` — men available from one levy (floored).
  - `export function levy(s: ArmyState, prov: number, nation: number): number` — performs it, returns men raised (0 if not owned / nothing to raise). Mutates `pop` and `armies`.
  - `export function armyAt(s: ArmyState, prov: number, nation: number): Army | undefined`
  - `export function applyUpkeep(s: ArmyState): void`
  - `export function regrow(s: ArmyState): void`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add the new names to the existing `./armySim` import line):

```typescript
describe("levy (men cost population)", () => {
  it("raises up to LEVY_FRAC of the province's population and removes it from the population", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const before = s.pop[prov];
    const expected = Math.floor(before * LEVY_FRAC);
    const got = levy(s, prov, nation);
    expect(got).toBe(expected);
    expect(s.pop[prov]).toBeCloseTo(before - expected, 9);
    expect(armyAt(s, prov, nation)!.men).toBe(expected);
  });
  it("stacks a second levy into the same army", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const a = levy(s, prov, nation);
    const b = levy(s, prov, nation);
    expect(armyAt(s, prov, nation)!.men).toBe(a + b);
    expect(s.armies.filter((x) => x.prov === prov && x.nation === nation).length).toBe(1);
  });
  it("refuses to levy from land you do not own", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const notOwner = s.owner[prov] === 0 ? 1 : 0;
    expect(levy(s, prov, notOwner)).toBe(0);
  });
});

describe("upkeep and regrowth", () => {
  it("bleeds every army by UPKEEP_FRAC each turn and removes empty ones", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    s.armies.push({ prov: 0, nation: 0, men: 100 }, { prov: 1, nation: 0, men: 1 });
    applyUpkeep(s);
    expect(s.armies.find((a) => a.prov === 0)!.men).toBe(100 - Math.max(1, Math.floor(100 * UPKEEP_FRAC)));
    expect(s.armies.find((a) => a.prov === 1)).toBeUndefined(); // 1 man army drains away
  });
  it("regrows population toward basePop but never past it", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    s.pop[0] = 0;
    regrow(s);
    expect(s.pop[0]).toBeCloseTo(s.basePop[0] * REGROW_FRAC, 9);
    s.pop[1] = s.basePop[1];
    regrow(s);
    expect(s.pop[1]).toBe(s.basePop[1]); // capped
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "levy"`
Expected: FAIL — `levy is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/armySim.ts`:

```typescript
export function armyAt(s: ArmyState, prov: number, nation: number): Army | undefined {
  return s.armies.find((a) => a.prov === prov && a.nation === nation);
}

// men one levy can raise from a province right now
export function maxLevy(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * LEVY_FRAC);
}

// raise men from an owned province: the population really leaves the land.
export function levy(s: ArmyState, prov: number, nation: number): number {
  if (prov < 0 || prov >= s.n || s.owner[prov] !== nation) return 0;
  const men = maxLevy(s, prov);
  if (men <= 0) return 0;
  s.pop[prov] -= men;
  const a = armyAt(s, prov, nation);
  if (a) a.men += men; else s.armies.push({ prov, nation, men });
  return men;
}

// a mobilised army bleeds every turn — you must use it or lose it (the anti-turtle force).
export function applyUpkeep(s: ArmyState): void {
  for (const a of s.armies) a.men -= Math.max(1, Math.floor(a.men * UPKEEP_FRAC));
  s.armies = s.armies.filter((a) => a.men > 0);
}

export function regrow(s: ArmyState): void {
  for (let p = 0; p < s.n; p++) {
    const v = s.pop[p] + s.basePop[p] * REGROW_FRAC;
    s.pop[p] = v > s.basePop[p] ? s.basePop[p] : v;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): levy costs population, armies bleed upkeep, population regrows"
```

---

### Task 3: Battle and movement

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces:
  - `export function militiaOf(s: ArmyState, prov: number): number`
  - `export function defenceOf(s: ArmyState, prov: number, attacker: number): number` — effective defence of `prov` against `attacker` (enemy army men + militia, × terrain).
  - `export interface BattleResult { won: boolean; atk: number; def: number; attackerLosses: number; captured: boolean }`
  - `export function previewMove(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null` — pure, no mutation; `null` if the move is illegal (no army, not adjacent).
  - `export function moveArmy(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null` — performs it.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add new names to the import line):

```typescript
describe("defence (militia + terrain)", () => {
  it("counts MILITIA_FRAC of the population, multiplied by the biome's defensibility", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = 0;
    s.pop[prov] = 100;
    const expectedMilitia = Math.floor(100 * MILITIA_FRAC);
    expect(militiaOf(s, prov)).toBe(expectedMilitia);
    const attacker = s.owner[prov] === 0 ? 1 : 0;
    const mult = BIOME_DEF[world.provinces[prov].biome];
    expect(defenceOf(s, prov, attacker)).toBeCloseTo(expectedMilitia * mult, 9);
  });
  it("adds an enemy army standing on the province", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = 0;
    s.pop[prov] = 100;
    const defender = s.owner[prov];
    const attacker = defender === 0 ? 1 : 0;
    s.armies.push({ prov, nation: defender, men: 50 });
    const mult = BIOME_DEF[world.provinces[prov].biome];
    expect(defenceOf(s, prov, attacker)).toBeCloseTo((50 + Math.floor(100 * MILITIA_FRAC)) * mult, 9);
  });
});

describe("moveArmy (march, battle, capture)", () => {
  it("refuses a move to a non-adjacent province or with no army", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    expect(moveArmy(s, prov, nation, s.adj[prov][0])).toBeNull(); // no army yet
    levy(s, prov, nation);
    const far = [...Array(s.n).keys()].find((p) => p !== prov && !s.adj[prov].includes(p))!;
    expect(moveArmy(s, prov, nation, far)).toBeNull();
  });
  it("marches into own land without a battle", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] === s.owner[p]))!;
    const nation = s.owner[prov];
    const dest = s.adj[prov].find((q) => s.owner[q] === nation)!;
    const men = levy(s, prov, nation);
    const r = moveArmy(s, prov, nation, dest)!;
    expect(r.won).toBe(true);
    expect(r.attackerLosses).toBe(0);
    expect(armyAt(s, dest, nation)!.men).toBe(men);
    expect(armyAt(s, prov, nation)).toBeUndefined();
  });
  it("wins, captures and bleeds when the attacker outnumbers the defence", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const def = defenceOf(s, target, nation);
    s.armies.push({ prov, nation, men: Math.ceil(def) + 1000 }); // overwhelming
    const preview = previewMove(s, prov, nation, target)!;
    const r = moveArmy(s, prov, nation, target)!;
    expect(preview.won).toBe(true);
    expect(r.won).toBe(true);
    expect(r.captured).toBe(true);
    expect(s.owner[target]).toBe(nation);
    expect(r.attackerLosses).toBe(Math.round(def * WIN_LOSS_MULT));
    expect(armyAt(s, target, nation)!.men).toBe(Math.ceil(def) + 1000 - r.attackerLosses);
  });
  it("loses the whole attacking army and captures nothing when outmatched", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const ownerBefore = s.owner[target];
    s.armies.push({ prov, nation, men: 1 }); // hopeless
    const r = moveArmy(s, prov, nation, target)!;
    expect(r.won).toBe(false);
    expect(r.captured).toBe(false);
    expect(s.owner[target]).toBe(ownerBefore);
    expect(armyAt(s, prov, nation)).toBeUndefined(); // destroyed
  });
  it("previewMove never mutates the state", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    levy(s, prov, nation);
    const target = s.adj[prov][0];
    const before = JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies });
    previewMove(s, prov, nation, target);
    expect(JSON.stringify({ o: [...s.owner], p: [...s.pop], a: s.armies })).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "moveArmy"`
Expected: FAIL — `moveArmy is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/armySim.ts`:

```typescript
// the province's own people take up arms when attacked. Computed at battle time, so a province
// hollowed out by over-levying really is defenceless. Militia cannot move.
export function militiaOf(s: ArmyState, prov: number): number {
  if (prov < 0 || prov >= s.n) return 0;
  return Math.floor(s.pop[prov] * MILITIA_FRAC);
}

// effective defence of `prov` against `attacker`: every non-attacker army standing there plus the
// militia, all multiplied by how defensible the terrain is.
export function defenceOf(s: ArmyState, prov: number, attacker: number): number {
  let men = 0;
  for (const a of s.armies) if (a.prov === prov && a.nation !== attacker) men += a.men;
  const mult = BIOME_DEF[s.world.provinces[prov].biome] ?? 1;
  return (men + militiaOf(s, prov)) * mult;
}

export interface BattleResult { won: boolean; atk: number; def: number; attackerLosses: number; captured: boolean }

function resolve(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  const army = armyAt(s, prov, nation);
  if (!army || !s.adj[prov]?.includes(target)) return null;
  if (s.owner[target] === nation) return { won: true, atk: army.men, def: 0, attackerLosses: 0, captured: false };
  const atk = army.men;
  const def = defenceOf(s, target, nation);
  const won = atk > def;
  const attackerLosses = won ? Math.min(atk - 1 < 0 ? 0 : atk, Math.round(def * WIN_LOSS_MULT)) : atk;
  return { won, atk, def, attackerLosses, captured: won };
}

// PURE forecast of a move — same arithmetic the real move runs, so the preview can never lie.
export function previewMove(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  return resolve(s, prov, nation, target);
}

// march or attack. On a win the army occupies the target (and the land, with its population, changes
// hands — that population is levyable next turn, which is what makes attacking compound).
export function moveArmy(s: ArmyState, prov: number, nation: number, target: number): BattleResult | null {
  const r = resolve(s, prov, nation, target);
  if (!r) return null;
  const army = armyAt(s, prov, nation)!;
  if (!r.won) {                                   // wiped out
    s.armies = s.armies.filter((a) => a !== army);
    return r;
  }
  // losses, then relocate the survivors onto the target
  army.men -= r.attackerLosses;
  const militiaLost = r.captured ? militiaOf(s, target) : 0;
  s.armies = s.armies.filter((a) => a !== army);
  if (r.captured) {
    s.armies = s.armies.filter((a) => a.prov !== target);  // the defenders are destroyed
    s.pop[target] = Math.max(0, s.pop[target] - militiaLost);
    s.owner[target] = nation;
  }
  if (army.men > 0) {
    const there = armyAt(s, target, nation);
    if (there) there.men += army.men; else s.armies.push({ prov: target, nation, men: army.men });
  }
  return r;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): terrain-modified battle, militia defence, march and capture"
```

---

### Task 4: AI + endTurn

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - `export function aiTurn(s: ArmyState, playerNation: number): void` — every non-player nation levies once from its most populous province and marches its biggest army at the weakest beatable adjacent enemy province.
  - `export function endTurn(s: ArmyState, playerNation: number): void` — `aiTurn` → `applyUpkeep` → `regrow` → `turn++`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add new names to the import line):

```typescript
describe("endTurn", () => {
  it("advances the turn, applies upkeep and regrows population", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...s.owner].findIndex((o) => o >= 0);
    const nation = s.owner[prov];
    const men = levy(s, prov, nation);
    const popAfterLevy = s.pop[prov];
    endTurn(s, nation);
    expect(s.turn).toBe(1);
    expect(armyAt(s, prov, nation)!.men).toBeLessThan(men);   // upkeep bled it
    expect(s.pop[prov]).toBeGreaterThan(popAfterLevy);        // regrowth
  });
  it("lets the AI act but never moves the player's armies", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const player = 0;
    const prov = [...Array(s.n).keys()].find((p) => s.owner[p] === player)!;
    levy(s, prov, player);
    const before = armyAt(s, prov, player)!.men;
    endTurn(s, player);
    // the player's army is still where the player left it (only upkeep changed its size)
    expect(armyAt(s, prov, player)).toBeDefined();
    expect(armyAt(s, prov, player)!.men).toBeLessThan(before);
    // and the AI did something: some nation other than the player raised men
    expect(s.armies.some((a) => a.nation !== player)).toBe(true);
  });
  it("is deterministic: same seed and same commands give the same state", () => {
    const run = () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
      const s = initArmySim(world);
      const prov = [...s.owner].findIndex((o) => o >= 0);
      const nation = s.owner[prov];
      levy(s, prov, nation);
      endTurn(s, nation);
      endTurn(s, nation);
      return JSON.stringify({ o: [...s.owner], p: [...s.pop].map((v) => v.toFixed(6)), a: s.armies, t: s.turn });
    };
    expect(run()).toBe(run());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "endTurn"`
Expected: FAIL — `endTurn is not defined`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/armySim.ts`:

```typescript
// Deliberately dumb AI: enough for the world to push back while we test whether the loop is fun.
// Each non-player nation levies once from its most populous province, then marches its biggest army
// at the weakest adjacent enemy province it can actually beat. Deterministic: ties break on lower id.
export function aiTurn(s: ArmyState, playerNation: number): void {
  const nations = [...new Set([...s.owner].filter((o) => o >= 0 && o !== playerNation))].sort((a, b) => a - b);
  for (const nation of nations) {
    // 1. levy from the most populous owned province
    let best = -1;
    for (let p = 0; p < s.n; p++) {
      if (s.owner[p] !== nation) continue;
      if (best < 0 || s.pop[p] > s.pop[best]) best = p;
    }
    if (best >= 0) levy(s, best, nation);
    // 2. march the biggest army at the weakest beatable adjacent enemy province
    let army: Army | undefined;
    for (const a of s.armies) {
      if (a.nation !== nation) continue;
      if (!army || a.men > army.men || (a.men === army.men && a.prov < army.prov)) army = a;
    }
    if (!army) continue;
    let target = -1, targetDef = Infinity;
    for (const q of s.adj[army.prov]) {
      if (s.owner[q] === nation) continue;
      const d = defenceOf(s, q, nation);
      if (d < army.men && (d < targetDef || (d === targetDef && q < target))) { targetDef = d; target = q; }
    }
    if (target >= 0) moveArmy(s, army.prov, nation, target);
  }
}

export function endTurn(s: ArmyState, playerNation: number): void {
  aiTurn(s, playerNation);
  applyUpkeep(s);
  regrow(s);
  s.turn++;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): dumb deterministic AI and endTurn"
```

---

### Task 5: Playable UI + page

**Files:**
- Create: `src/ui/armyApp.ts`, `src/ui/armyMain.ts`, `playArmy.html`, `src/ui/armyApp.test.ts`
- Modify: `vite.config.ts`, `src/theme.css`

**Interfaces:**
- Consumes: all of `armySim` (Tasks 1–4); `generateWorld`, `DEFAULT_PARAMS`; `politicalLayer` from `./politicalLayer`; `svgEl` from `./renderer`; `cellPath` from `./svgPaths`.
- Produces: `export function mountArmyApp(root: HTMLElement, opts?: { seed?: number }): void`
- DOM contract the test relies on: `.army-map`, `.army-prov[data-prov]` (clickable province hit areas), `.army-hud`, `.army-log`, `button.army-end`, `button.army-levy`, `.army-sel` (current selection readout).

- [ ] **Step 1: Write the failing jsdom test**

Create `src/ui/armyApp.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountArmyApp } from "./armyApp";

describe("armyApp (prototype loop: levy -> march -> end turn)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("renders a map, a HUD and an end-turn button", () => {
    mountArmyApp(root, { seed: 1 });
    expect(root.querySelector(".army-map")).toBeTruthy();
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴");
    expect(root.querySelector("button.army-end")).toBeTruthy();
    expect(root.querySelectorAll(".army-prov").length).toBeGreaterThan(0);
  });

  it("levies from an owned province: men appear and population drops", () => {
    mountArmyApp(root, { seed: 1 });
    const hudBefore = root.querySelector(".army-hud")!.textContent!;
    const own = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    own.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const btn = root.querySelector("button.army-levy") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-hud")!.textContent).not.toBe(hudBefore); // men went up
    expect(root.querySelector(".army-log")!.textContent).toContain("징집");
  });

  it("ends the turn and advances the counter", () => {
    mountArmyApp(root, { seed: 1 });
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 0");
    (root.querySelector("button.army-end") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: FAIL — cannot resolve `./armyApp`.

- [ ] **Step 3: Write the UI**

Create `src/ui/armyApp.ts`:

```typescript
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initArmySim, levy, maxLevy, moveArmy, previewMove, endTurn, armyAt, militiaOf, defenceOf,
  type ArmyState,
} from "../engine/armySim";
import { politicalLayer } from "./politicalLayer";
import { svgEl } from "./renderer";
import { cellPath } from "./svgPaths";

// PROTOTYPE UI. Two clicks per action, no stances, no target arming: click your province to levy,
// click your army then a neighbour to march. Everything the rules use is printed on the map.
export function mountArmyApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000);
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  const s: ArmyState = initArmySim(world);
  // the player is the nation holding the most provinces at the start
  const counts = new Map<number, number>();
  for (let p = 0; p < s.n; p++) if (s.owner[p] >= 0) counts.set(s.owner[p], (counts.get(s.owner[p]) ?? 0) + 1);
  let player = 0, bestN = -1;
  for (const [id, k] of [...counts].sort((a, b) => a[0] - b[0])) if (k > bestN) { bestN = k; player = id; }

  let sel: number | null = null;          // selected province (mine)
  const log: string[] = [];
  const say = (t: string) => { log.unshift(`T${s.turn} ${t}`); if (log.length > 10) log.pop(); };

  const myPop = () => { let v = 0; for (let p = 0; p < s.n; p++) if (s.owner[p] === player) v += s.pop[p]; return v; };
  const myMen = () => s.armies.filter((a) => a.nation === player).reduce((k, a) => k + a.men, 0);
  const myProv = () => { let k = 0; for (let p = 0; p < s.n; p++) if (s.owner[p] === player) k++; return k; };

  function buildMap(): SVGSVGElement {
    const svg = svgEl("svg", {
      class: "army-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`,
      preserveAspectRatio: "xMidYMid meet",
    }) as SVGSVGElement;
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let c = 0; c < world.grid.count; c++) { const p = world.provinceOf[c]; if (p >= 0) owner[c] = s.owner[p]; }
    svg.appendChild(politicalLayer(world.grid, owner, world.polities, { fills: true, labels: false, legend: false }));

    // one clickable hit area per province + its numbers
    const byProv: string[] = new Array(s.n).fill("");
    for (let c = 0; c < world.grid.count; c++) {
      const p = world.provinceOf[c];
      if (p >= 0) byProv[p] += cellPath(world.grid.polygons[c]);
    }
    for (let p = 0; p < s.n; p++) {
      if (!byProv[p]) continue;
      const mine = s.owner[p] === player;
      const hit = svgEl("path", {
        class: "army-prov" + (sel === p ? " sel" : ""), "data-prov": String(p), "data-mine": mine ? "1" : "0",
        d: byProv[p], fill: sel === p ? "rgba(232,181,58,0.35)" : "transparent", stroke: "none",
      });
      hit.addEventListener("click", () => onProvClick(p));
      svg.appendChild(hit);
      const [cx, cy] = world.provinces[p].centroid;
      const army = s.armies.find((a) => a.prov === p);
      const label = svgEl("text", {
        class: "army-num", x: String(cx), y: String(cy), "text-anchor": "middle", "pointer-events": "none",
      });
      label.textContent = army ? `${Math.round(s.pop[p])}·⚔${army.men}` : `${Math.round(s.pop[p])}`;
      svg.appendChild(label);
    }
    return svg;
  }

  function onProvClick(p: number): void {
    if (sel !== null && sel !== p) {
      const a = armyAt(s, sel, player);
      if (a && s.adj[sel].includes(p)) {           // march / attack
        const r = moveArmy(s, sel, player, p);
        if (r) {
          say(r.captured ? `점령 ${world.provinces[p].name} (손실 ${r.attackerLosses})`
            : r.won ? `이동 ${world.provinces[p].name}`
            : `패배 ${world.provinces[p].name} — 전멸 (방어 ${Math.round(r.def)})`);
        }
        sel = null; render(); return;
      }
    }
    sel = s.owner[p] === player ? p : null;
    render();
  }

  function panel(): HTMLElement {
    const box = document.createElement("div");
    box.className = "army-sel";
    if (sel === null) { box.textContent = "내 영토를 클릭해 징집하거나, 군대를 고른 뒤 인접 영토를 클릭하세요."; return box; }
    const p = sel, name = world.provinces[p].name;
    const a = armyAt(s, p, player);
    const head = document.createElement("div");
    head.textContent = `${name} · 인구 ${Math.round(s.pop[p])} · 민병 ${militiaOf(s, p)}` + (a ? ` · 병력 ${a.men}` : "");
    box.appendChild(head);
    const btn = document.createElement("button");
    btn.className = "army-levy";
    btn.textContent = `징집 (+${maxLevy(s, p)}명, 인구 −${maxLevy(s, p)})`;
    btn.addEventListener("click", () => { const m = levy(s, p, player); if (m > 0) say(`징집 ${name} +${m}`); render(); });
    box.appendChild(btn);
    if (a) {
      const list = document.createElement("div");
      list.className = "army-moves";
      for (const q of s.adj[p]) {
        const r = previewMove(s, p, player, q);
        if (!r) continue;
        const row = document.createElement("div");
        row.textContent = s.owner[q] === player
          ? `→ ${world.provinces[q].name} (행군)`
          : `→ ${world.provinces[q].name} · 공격 ${r.atk} vs 방어 ${Math.round(r.def)} · ${r.won ? "승리 예상" : "패배 예상"}`;
        list.appendChild(row);
      }
      box.appendChild(list);
    }
    return box;
  }

  function render(): void {
    root.innerHTML = "";
    const hud = document.createElement("div");
    hud.className = "army-hud";
    hud.textContent = `턴 ${s.turn} · ${world.polities[player]?.name ?? ""} · 영토 ${myProv()} · 인구 ${Math.round(myPop())} · 병력 ${myMen()}`;
    root.appendChild(hud);
    root.appendChild(buildMap());
    root.appendChild(panel());
    const end = document.createElement("button");
    end.className = "army-end";
    end.textContent = "턴 종료 ▶";
    end.addEventListener("click", () => { endTurn(s, player); sel = null; render(); });
    root.appendChild(end);
    const lg = document.createElement("div");
    lg.className = "army-log";
    lg.textContent = log.join("  ·  ");
    root.appendChild(lg);
  }

  render();
}
```

- [ ] **Step 4: Add the entry point, page and build wiring**

Create `src/ui/armyMain.ts`:

```typescript
import "../theme.css";
import { mountArmyApp } from "./armyApp";

const root = document.getElementById("army-app");
if (root) mountArmyApp(root);
```

Create `playArmy.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WorldMaker — 군대</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="army-app"></div>
    <script type="module" src="/src/ui/armyMain.ts"></script>
  </body>
</html>
```

In `vite.config.ts`, add one line to `rollupOptions.input` (keep the existing entries):

```typescript
        playProvince: "playProvince.html",
        playArmy: "playArmy.html",
```

Append to `src/theme.css`:

```css
.army-hud { font-size: 15px; padding: 6px 2px; color: #3c2f1c; }
.army-map { display: block; width: 100%; max-width: 900px; margin: 6px auto; background: #eadfc2; border: 1px solid #cbb784; border-radius: 5px; max-height: 60vh; }
.army-prov { cursor: pointer; }
.army-num { font-size: 9px; fill: #2b2113; paint-order: stroke; stroke: #f6ecd2; stroke-width: 2.5px; }
.army-sel { font-size: 14px; padding: 8px 2px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.army-moves { font-size: 13px; color: #5c4626; }
.army-end { margin: 6px 0; }
.army-log { font-size: 13px; color: #7a5a2f; padding: 4px 2px; }
```

- [ ] **Step 5: Run the UI test to verify it passes**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts src/ui/armyMain.ts playArmy.html vite.config.ts src/theme.css
git commit -m "feat(playArmy): minimal playable prototype UI — levy, march, end turn"
```

---

### Task 6: Whole-suite check + live play verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run`
Expected: PASS. The 716 pre-existing tests are unchanged and still green, plus the new engine and UI tests.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Live-play it in the browser**

Start the dev server preview and open `/playArmy.html`, then actually play several turns:
- Levy from a rich province, confirm its population number drops by the men gained.
- Select the army, read the `공격 N vs 방어 M` preview on a neighbour, march, and confirm the log line and the ownership change match the preview.
- Attack a mountain (`ALPINE`) province and a grassland one with similar armies and confirm the mountain is visibly harder (higher 방어 for the same men).
- End several turns and confirm: armies shrink from upkeep, populations regrow, AI nations take land.
- Check `read_console_messages` for errors (expect none).

- [ ] **Step 4: Record the fun-test verdict**

This prototype exists to answer "is this loop fun". Write a short honest note (in the session summary and the backlog memory) covering: does each turn have a real decision, does terrain change where you fight, does upkeep actually pressure you to move, and does anything snowball. No code change in this step.

- [ ] **Step 5: Commit any fixes from live play** (only if something is actually broken)

```bash
git add -A
git commit -m "fix(playArmy): prototype live-play fixes"
```

---

## Self-Review notes

- **Spec coverage:** population from world (T1) ✓; terrain tables both directions incl. attacker-favouring grassland (T1) ✓; levy costs population (T2) ✓; upkeep drain (T2) ✓; regrowth cap (T2) ✓; militia + terrain defence (T3) ✓; battle verdict + both-sides losses + capture transferring land/population (T3) ✓; adjacency-only movement (T3) ✓; pure preview (T3) ✓; dumb AI (T4) ✓; endTurn order (T4) ✓; determinism (T1, T4) ✓; no victory condition (nothing implements one) ✓; minimal UI with two-click actions and printed numbers (T5) ✓; new page + build wiring (T5) ✓; existing game untouched (Global Constraints; no task touches it) ✓; fun-test verdict recorded (T6) ✓.
- **Type consistency:** `ArmyState`, `Army`, `BattleResult` defined in T1/T3 and consumed unchanged in T4/T5; `levy/maxLevy/armyAt/militiaOf/defenceOf/previewMove/moveArmy/endTurn` signatures identical everywhere they appear.
- **No placeholders:** every code step contains complete code; every run step names the command and the expected result.
- **Known prototype-grade simplification (intentional, spec-sanctioned):** `moveArmy` destroys ALL armies on a captured province (any third-party stacks too). With one army per nation per province and a dumb AI this is not reachable in practice; it is called out here rather than hidden.
