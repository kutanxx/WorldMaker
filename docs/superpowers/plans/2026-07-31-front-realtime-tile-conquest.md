# Real-time tile conquest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new real-time game where territory is owned cell-by-cell, a nation is one troop pool with no units, and clicking a neighbour pushes your entire shared border into them.

**Architecture:** A pure `tick(s)` simulation over the existing 4,000-cell grid — only the UI is real-time, driving `tick` from an animation loop, so determinism survives. Rendering moves to canvas because 4,000 retained-mode SVG nodes cannot repaint at framerate. Four new files; the four existing games are untouched.

**Tech Stack:** TypeScript, Vitest (`jsdom` for UI), Vite, HTML canvas. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-front-realtime-tile-conquest-design.md`

## Global Constraints

- **Determinism is a hard invariant.** No `Math.random()`, no `Date`, no `Set`/`Map` key iteration without an explicit sort. Same seed + same command log must produce an identical state after N ticks. Every tie-break resolves to the **lower cell id**, then the lower nation id.
- **Real time lives only in the UI.** The engine never reads a clock. `tick(s)` advances exactly one step; the animation loop decides when to call it. Tests call `tick` in a plain loop with no timers.
- **The engine must not import from `src/ui/`.** The one permitted cross-game import is the `BIOME_DEF` constant from `src/engine/armySim.ts`, reused deliberately so terrain defence is not defined twice.
- **Do not modify any existing game.** `armySim.ts`, `armyApp.ts`, `provinceSim.ts`, `playSim.ts`, `historySim.ts` and their pages stay as they are. The only edits to existing files are one new Vite input and one new landing card.
- **Starting constants, verbatim from the spec:** `TICK_HZ = 10`, `TROOP_EXP = 0.6`, `TROOP_BASE = 200`, `TROOP_SCALE = 60`, `REGEN_BASE = 1`, `REGEN_K = 0.25`, `ATTACK_SPEED = 0.05`, `FORCE_MIN = 0.2`, `FORCE_MAX = 3`, `COST_ATK = 1.0`, `COST_DEF = 0.6`, `VICTORY_SHARE = 0.4`.
- **Canvas is not available in jsdom.** `canvas.getContext("2d")` returns `null` there. Mounting must tolerate that, and everything worth testing about rendering must live in a pure function that returns *what* to draw rather than drawing it.
- Comments explain *why*, not *what*.
- Commands: `npx vitest run <path>`, full suite `npx vitest run` (870 at baseline), `npx tsc --noEmit`, `npx vite build`.

## File structure

| file | responsibility |
|---|---|
| `src/engine/frontSim.ts` | state, `tick`, troop economy, attacks, AI, victory. No DOM. |
| `src/ui/frontApp.ts` | canvas renderer, HUD, input, animation loop. |
| `src/ui/frontMain.ts` | entry point; reads `?seed=`. |
| `playFront.html` | the page. |

Naming follows the existing `armySim` / `armyApp` / `armyMain` / `playArmy.html` convention.

---

### Task 1: State and the troop economy

**Files:**
- Create: `src/engine/frontSim.ts`
- Test: `src/engine/frontSim.test.ts`

**Interfaces:**
- Consumes: `World` from `src/types/world.ts` — per-cell arrays `terrain`, `biome`, `polityOf`, and `grid.{count,neighbors,polygons,points}`; `OCEAN` from `src/engine/terrain.ts`.
- Produces, all used by Tasks 2-4: `FrontState`, `Attack`, `initFrontSim(world)`, `setOwner(s, cell, nation)`, `maxTroops(s, nation)`, `regenPerTick(s, nation)`, `tick(s)`, and the constants above plus `UNOWNED = -1`, `SEA = -2`.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/frontSim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { OCEAN } from "./terrain";
import {
  initFrontSim, setOwner, maxTroops, regenPerTick, tick,
  TROOP_BASE, TROOP_SCALE, TROOP_EXP, UNOWNED, SEA,
} from "./frontSim";

const fresh = (seed: number) => initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed }).world);

describe("frontSim state", () => {
  it("owns land cell by cell, marks the sea, and starts every nation at the floor", () => {
    const s = fresh(11);
    expect(s.n).toBe(s.world.grid.count);
    for (let c = 0; c < s.n; c++) {
      if (s.world.terrain[c] === OCEAN) expect(s.owner[c]).toBe(SEA);
      else expect(s.owner[c]).toBeGreaterThanOrEqual(UNOWNED);
    }
    // at least one nation actually holds land, or every later test is vacuous
    expect([...s.tiles].some((k) => k > 0)).toBe(true);
    expect(s.attacks).toEqual([]);
    expect(s.tick).toBe(0);
  });

  it("keeps the tile counts in step with the owner array", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const cell = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED)!;
    const before = s.tiles[nation];
    setOwner(s, cell, nation);
    expect(s.tiles[nation]).toBe(before + 1);
    setOwner(s, cell, UNOWNED);
    expect(s.tiles[nation]).toBe(before);
    // and the derived count still matches a full recount, which is the invariant that matters
    const counted = [...s.owner].filter((o) => o === nation).length;
    expect(s.tiles[nation]).toBe(counted);
  });
});

describe("frontSim economy", () => {
  it("raises the cap sublinearly — ten times the land is far less than ten times the ceiling", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === nation) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    expect(land.length).toBeGreaterThan(220);          // seed 11 has plenty of land to work with
    for (let i = 0; i < 20; i++) setOwner(s, land[i], nation);
    const small = maxTroops(s, nation);
    for (let i = 20; i < 200; i++) setOwner(s, land[i], nation);
    const big = maxTroops(s, nation);
    expect(big).toBeGreaterThan(small);                 // more land is still more power
    expect(big).toBeLessThan(small * 10);               // but nowhere near proportionally
    expect(small).toBeCloseTo(TROOP_BASE + TROOP_SCALE * Math.pow(20, TROOP_EXP), 6);
    expect(big).toBeCloseTo(TROOP_BASE + TROOP_SCALE * Math.pow(200, TROOP_EXP), 6);
  });

  it("chokes regeneration as the pool fills, and stops dead at the cap", () => {
    const s = fresh(11);
    const nation = [...s.owner].find((o) => o >= 0)!;
    const max = maxTroops(s, nation);
    s.troops[nation] = max * 0.1;
    const low = regenPerTick(s, nation);
    s.troops[nation] = max * 0.9;
    const high = regenPerTick(s, nation);
    expect(low).toBeGreaterThan(high);
    s.troops[nation] = max;
    expect(regenPerTick(s, nation)).toBe(0);
  });

  it("never lets a tick push a nation past its cap", () => {
    const s = fresh(11);
    for (let t = 0; t < 200; t++) tick(s);
    for (let p = 0; p < s.troops.length; p++) {
      expect(s.troops[p]).toBeLessThanOrEqual(maxTroops(s, p) + 1e-9);
    }
    expect(s.tick).toBe(200);
  });

  it("same seed, same ticks, identical state — no clock and no rng", () => {
    const a = fresh(11), b = fresh(11);
    for (let t = 0; t < 50; t++) { tick(a); tick(b); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.troops]).toEqual([...b.troops]);
    expect([...a.tiles]).toEqual([...b.tiles]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/frontSim.test.ts
```

Expected: FAIL — `src/engine/frontSim.ts` does not exist, so the import errors.

- [ ] **Step 3: Write the implementation**

Create `src/engine/frontSim.ts`:

```ts
import type { World } from "../types/world";
import { OCEAN } from "./terrain";

// One troop pool per nation and no army units at all: a nation's whole military is a single number,
// and attacking is committing part of it to a front rather than moving something across the map.
export const TICK_HZ = 10;          // simulation steps per second; only the UI knows about seconds
export const TROOP_EXP = 0.6;
export const TROOP_BASE = 200;      // floor, so a one-cell nation is not starved out instantly
export const TROOP_SCALE = 60;
export const REGEN_BASE = 1;
export const REGEN_K = 0.25;

export const UNOWNED = -1;
export const SEA = -2;

// `progress` carries the fraction of a cell left over from the previous tick. Without it a front
// whose per-tick budget is below one cell would never move at all — and at these constants most
// fronts start there, so a slow push has to accumulate rather than round to nothing.
export interface Attack { attacker: number; target: number; pool: number; progress: number }

export interface FrontState {
  world: World;
  n: number;              // cell count
  owner: Int32Array;      // cell -> nation, UNOWNED, or SEA
  tiles: Int32Array;      // nation -> cells held; maintained incrementally, never recounted per tick
  troops: Float64Array;   // nation -> troop pool
  attacks: Attack[];
  tick: number;
}

export function initFrontSim(world: World): FrontState {
  const n = world.grid.count;
  const owner = new Int32Array(n);
  const tiles = new Int32Array(world.polities.length);
  for (let c = 0; c < n; c++) {
    if (world.terrain[c] === OCEAN) { owner[c] = SEA; continue; }
    const p = world.polityOf[c];
    owner[c] = p >= 0 && p < tiles.length ? p : UNOWNED;
    if (owner[c] >= 0) tiles[owner[c]]++;
  }
  const troops = new Float64Array(tiles.length).fill(TROOP_BASE / 2);
  return { world, n, owner, tiles, troops, attacks: [], tick: 0 };
}

// The only way ownership changes. Going through one door is what keeps `tiles` from drifting out of
// step with `owner` — and `tiles` exists because maxTroops is read for every nation every tick, and
// recounting 4,000 cells that often is waste we would feel at 10 ticks a second.
export function setOwner(s: FrontState, cell: number, nation: number): void {
  const prev = s.owner[cell];
  if (prev === nation) return;
  if (prev >= 0) s.tiles[prev]--;
  s.owner[cell] = nation;
  if (nation >= 0) s.tiles[nation]++;
}

// Sublinear in territory: ten times the land is about 2.9x the ceiling. Conquest yields land faster
// than it yields power, which is the damper this genre runs on. It slows the runaway; it does not
// stop it, and the spec is explicit that this game does not claim to.
export function maxTroops(s: FrontState, nation: number): number {
  return TROOP_BASE + TROOP_SCALE * Math.pow(s.tiles[nation] ?? 0, TROOP_EXP);
}

// Growth dies as the pool fills, so sitting at the cap throws away most of your income. This is the
// pressure that makes a player spend troops instead of hoarding them — the single thing that was
// most obviously missing from the turn-based game this replaces.
export function regenPerTick(s: FrontState, nation: number): number {
  const max = maxTroops(s, nation);
  const t = s.troops[nation];
  if (t >= max) return 0;
  return (REGEN_BASE + Math.pow(t, 0.73) * REGEN_K) * (1 - t / max);
}

export function tick(s: FrontState): void {
  for (let p = 0; p < s.troops.length; p++) {
    s.troops[p] = Math.min(maxTroops(s, p), s.troops[p] + regenPerTick(s, p));
  }
  s.tick++;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/engine/frontSim.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite and type check**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: 876 pass (870 baseline + 6), tsc silent. No existing test may change — this task adds a file and touches nothing.

- [ ] **Step 6: Commit**

```bash
git add src/engine/frontSim.ts src/engine/frontSim.test.ts
git commit -m "feat(frontSim): cell ownership and a troop pool that punishes sitting full"
```

---

### Task 2: Attacks along the shared border

**Files:**
- Modify: `src/engine/frontSim.ts`
- Test: `src/engine/frontSim.test.ts`

**Interfaces:**
- Consumes: `FrontState`, `Attack`, `setOwner`, `tick`, `UNOWNED`, `SEA` from Task 1.
- Produces, used by Tasks 3-4: `borderCells(s, attacker, target): number[]`, `startAttack(s, attacker, target, fraction): boolean`, `cancelAttack(s, attacker, target): void`, `terrainDef(s, cell): number`, and the constants `ATTACK_SPEED`, `FORCE_MIN`, `FORCE_MAX`, `COST_ATK`, `COST_DEF`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/frontSim.test.ts`:

```ts
import {
  borderCells, startAttack, cancelAttack, terrainDef,
  ATTACK_SPEED, FORCE_MIN, FORCE_MAX, COST_ATK, COST_DEF, maxTroops as capOf,
} from "./frontSim";

describe("frontSim attacks", () => {
  // Builds a clean two-nation strip so border length is something the test sets, not something the
  // map happens to produce: `a` owns a block of land, `b` owns the cells bordering it.
  function strip(seed: number, wide: boolean) {
    const s = fresh(seed);
    const a = 0, b = 1;
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    setOwner(s, land[0], a);
    // grow `a` until it has enough neighbours to make a wide or narrow front
    const want = wide ? 40 : 6;
    for (let i = 1; i < land.length && s.tiles[a] < want; i++) {
      if (s.world.grid.neighbors[land[i]].some((q) => s.owner[q] === a)) setOwner(s, land[i], a);
    }
    // everything touching `a` becomes `b`
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] !== UNOWNED) continue;
      if (s.world.grid.neighbors[c].some((q) => s.owner[q] === a)) setOwner(s, c, b);
    }
    s.troops[a] = 1000; s.troops[b] = 1000;
    return { s, a, b };
  }

  it("counts the target's cells that touch the attacker, and nothing else", () => {
    const { s, a, b } = strip(11, false);
    const border = borderCells(s, a, b);
    expect(border.length).toBeGreaterThan(0);
    for (const c of border) {
      expect(s.owner[c]).toBe(b);
      expect(s.world.grid.neighbors[c].some((q) => s.owner[q] === a)).toBe(true);
    }
    expect([...border]).toEqual([...border].sort((x, y) => x - y));   // ascending: order is fixed
  });

  it("takes troops out of the pool the moment an attack starts", () => {
    const { s, a, b } = strip(11, false);
    const before = s.troops[a];
    expect(startAttack(s, a, b, 0.5)).toBe(true);
    expect(s.troops[a]).toBeCloseTo(before * 0.5, 6);
    expect(s.attacks).toHaveLength(1);
    expect(s.attacks[0]).toMatchObject({ attacker: a, target: b });
    expect(s.attacks[0].pool).toBeCloseTo(before * 0.5, 6);
  });

  it("gives the pool back when the attack is cancelled", () => {
    const { s, a, b } = strip(11, false);
    const before = s.troops[a];
    startAttack(s, a, b, 0.5);
    cancelAttack(s, a, b);
    expect(s.attacks).toHaveLength(0);
    expect(s.troops[a]).toBeCloseTo(before, 6);
  });

  it("advances faster across a wide border than a narrow one — this is the whole point", () => {
    const narrow = strip(11, false), wide = strip(11, true);
    expect(borderCells(wide.s, wide.a, wide.b).length)
      .toBeGreaterThan(borderCells(narrow.s, narrow.a, narrow.b).length);
    startAttack(narrow.s, narrow.a, narrow.b, 0.5);
    startAttack(wide.s, wide.a, wide.b, 0.5);
    const nBefore = narrow.s.tiles[narrow.a], wBefore = wide.s.tiles[wide.a];
    // Several ticks, not one: a front's budget is a fraction of a cell per tick, so a single tick
    // captures nothing on either side and would make this comparison 0 > 0.
    for (let t = 0; t < 30; t++) { tick(narrow.s); tick(wide.s); }
    expect(wide.s.tiles[wide.a] - wBefore).toBeGreaterThan(narrow.s.tiles[narrow.a] - nBefore);
  });

  it("charges the attacker and bleeds the defender for every cell taken", () => {
    const { s, a, b } = strip(11, true);
    startAttack(s, a, b, 0.9);
    const poolBefore = s.attacks[0].pool, defBefore = s.troops[b], tilesBefore = s.tiles[a];
    for (let t = 0; t < 30; t++) tick(s);
    expect(s.tiles[a]).toBeGreaterThan(tilesBefore);
    expect(s.attacks[0]?.pool ?? 0).toBeLessThan(poolBefore);
    expect(s.troops[b]).toBeLessThan(defBefore);
  });

  it("takes unowned land without bleeding anybody", () => {
    const s = fresh(11);
    const a = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    for (let i = 0; i < 30; i++) setOwner(s, land[i], a);
    s.troops[a] = 1000;
    const troopsElsewhere = [...s.troops];
    expect(startAttack(s, a, UNOWNED, 0.5)).toBe(true);
    const tilesBefore = s.tiles[a];
    for (let t = 0; t < 30; t++) tick(s);
    expect(s.tiles[a]).toBeGreaterThan(tilesBefore);
    for (let p = 1; p < s.troops.length; p++) expect(s.troops[p]).toBe(troopsElsewhere[p]);
  });

  it("ends an attack once its pool runs out", () => {
    const { s, a, b } = strip(11, true);
    s.troops[a] = 4;                       // barely anything to spend
    startAttack(s, a, b, 1);
    for (let t = 0; t < 60 && s.attacks.length > 0; t++) tick(s);
    expect(s.attacks).toHaveLength(0);
  });

  it("refuses an attack with no shared border", () => {
    const s = fresh(11);
    const a = 0, b = 1;
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, UNOWNED);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    setOwner(s, land[0], a);
    setOwner(s, land[land.length - 1], b);
    s.troops[a] = 1000;
    const before = s.troops[a];
    expect(startAttack(s, a, b, 0.5)).toBe(false);
    expect(s.attacks).toHaveLength(0);
    expect(s.troops[a]).toBe(before);      // a refused attack costs nothing
  });

  it("captures the same cells when the same tick is run from the same state", () => {
    const one = strip(11, true), two = strip(11, true);
    startAttack(one.s, one.a, one.b, 0.6);
    startAttack(two.s, two.a, two.b, 0.6);
    for (let t = 0; t < 10; t++) { tick(one.s); tick(two.s); }
    expect([...one.s.owner]).toEqual([...two.s.owner]);
    expect([...one.s.troops]).toEqual([...two.s.troops]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/frontSim.test.ts -t "frontSim attacks"
```

Expected: FAIL — `borderCells`, `startAttack`, `cancelAttack` and `terrainDef` are not exported.

- [ ] **Step 3: Add the attack constants and helpers**

In `src/engine/frontSim.ts`, add after the existing constants:

```ts
export const ATTACK_SPEED = 0.05;
export const FORCE_MIN = 0.2;
export const FORCE_MAX = 3;
export const COST_ATK = 1.0;
export const COST_DEF = 0.6;
```

and add the import at the top of the file:

```ts
import { BIOME_DEF } from "./armySim";
```

Then add, after `setOwner`:

```ts
// Rough ground costs more to take. Deliberately the same weighting the army game uses rather than a
// second table that could drift away from it.
export function terrainDef(s: FrontState, cell: number): number {
  return BIOME_DEF[s.world.biome[cell]] ?? 1;
}

// The target's cells that touch the attacker. Its LENGTH is the border, and the border is what sets
// how fast a front moves — a realm with a long frontier is taken quickly and a compact one is not.
// Ascending cell order so every consumer sees the same sequence.
export function borderCells(s: FrontState, attacker: number, target: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== target) continue;
    for (const q of s.world.grid.neighbors[c]) {
      if (s.owner[q] === attacker) { out.push(c); break; }
    }
  }
  return out;
}
```

- [ ] **Step 4: Add starting and cancelling**

Append to `src/engine/frontSim.ts`:

```ts
// Committing is instant and visible: the troops leave the pool now, not when they arrive. Returns
// false — and costs nothing — when there is nothing to attack across.
export function startAttack(s: FrontState, attacker: number, target: number, fraction: number): boolean {
  if (attacker === target || s.troops[attacker] === undefined) return false;
  if (borderCells(s, attacker, target).length === 0) return false;
  const pool = s.troops[attacker] * Math.min(1, Math.max(0, fraction));
  if (pool <= 0) return false;
  cancelAttack(s, attacker, target);                 // one front per pair; re-committing replaces it
  s.troops[attacker] -= pool;
  s.attacks.push({ attacker, target, pool, progress: 0 });
  return true;
}

// Calling off a front hands its survivors back rather than deleting them, so probing an enemy is not
// punished by the accounting.
export function cancelAttack(s: FrontState, attacker: number, target: number): void {
  const i = s.attacks.findIndex((a) => a.attacker === attacker && a.target === target);
  if (i < 0) return;
  s.troops[attacker] += s.attacks[i].pool;
  s.attacks.splice(i, 1);
}
```

- [ ] **Step 5: Advance the fronts inside `tick`**

In `src/engine/frontSim.ts`, add this function above `tick`:

```ts
// One step of every front. Deterministic throughout: fronts run in array order, and within a front
// the border is walked in ascending cell id, so the same state always yields the same captures.
function advanceAttacks(s: FrontState): void {
  for (const atk of [...s.attacks]) {
    const border = borderCells(s, atk.attacker, atk.target);
    if (border.length === 0 || atk.pool <= 0) { s.attacks = s.attacks.filter((x) => x !== atk); continue; }
    const defence = atk.target >= 0 ? Math.max(1, s.troops[atk.target]) : 0;
    // Unowned land has nobody to hold it, so a front there always runs at full speed.
    const force = defence === 0
      ? FORCE_MAX
      : Math.min(FORCE_MAX, Math.max(FORCE_MIN, atk.pool / defence));
    // Accumulate rather than round down: a front whose budget is a fraction of a cell per tick has
    // to creep, not stall. Dropping the remainder would freeze every slow push permanently.
    atk.progress += force * border.length * ATTACK_SPEED;
    for (const cell of border) {
      if (atk.progress < 1 || atk.pool <= 0) break;
      const def = terrainDef(s, cell);
      atk.pool -= COST_ATK * def;
      if (atk.target >= 0) s.troops[atk.target] = Math.max(0, s.troops[atk.target] - COST_DEF * def);
      setOwner(s, cell, atk.attacker);
      atk.progress -= 1;
    }
    if (atk.pool <= 0) s.attacks = s.attacks.filter((x) => x !== atk);
  }
}
```

Then change `tick` to call it between the economy and the counter:

```ts
export function tick(s: FrontState): void {
  for (let p = 0; p < s.troops.length; p++) {
    s.troops[p] = Math.min(maxTroops(s, p), s.troops[p] + regenPerTick(s, p));
  }
  advanceAttacks(s);
  s.tick++;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/engine/frontSim.test.ts
```

Expected: PASS, 15 tests (6 from Task 1 + 9 new).

- [ ] **Step 7: Verify the border really drives the speed**

Temporarily replace `force * border.length * ATTACK_SPEED` with `force * ATTACK_SPEED * 10` — a budget that ignores border length entirely. Confirm the test *"advances faster across a wide border than a narrow one"* FAILS. Restore the line exactly and confirm it passes. Report the observation with actual output, and confirm with `git diff` that the file is byte-identical afterwards.

- [ ] **Step 8: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/engine/frontSim.ts src/engine/frontSim.test.ts
git commit -m "feat(frontSim): fronts advance along the whole shared border"
```

---

### Task 3: Opponents and winning

**Files:**
- Modify: `src/engine/frontSim.ts`
- Test: `src/engine/frontSim.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces, used by Task 4: `aiStep(s, playerNation)`, `landTotal(s)`, `shareOf(s, nation)`, `outcome(s, playerNation)` returning `{ kind: "victory" } | { kind: "defeat" } | { kind: "outpaced"; by: number } | null`, and `VICTORY_SHARE`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/frontSim.test.ts`:

```ts
import { aiStep, landTotal, shareOf, outcome, VICTORY_SHARE } from "./frontSim";

describe("frontSim opponents and victory", () => {
  it("measures a nation's share of the land, ignoring the sea", () => {
    const s = fresh(11);
    const total = landTotal(s);
    expect(total).toBeGreaterThan(0);
    expect(total).toBe([...s.owner].filter((o) => o !== SEA).length);
    const nation = [...s.owner].find((o) => o >= 0)!;
    expect(shareOf(s, nation)).toBeCloseTo(s.tiles[nation] / total, 9);
  });

  it("has the AI open fronts, and never for the player", () => {
    const s = fresh(11);
    const player = [...s.owner].find((o) => o >= 0)!;
    for (let p = 0; p < s.troops.length; p++) s.troops[p] = 800;
    for (let t = 0; t < 5; t++) { aiStep(s, player); tick(s); }
    expect(s.attacks.length).toBeGreaterThan(0);
    expect(s.attacks.some((a) => a.attacker === player)).toBe(false);
  });

  it("declares victory at the configured share and defeat at nothing left", () => {
    const s = fresh(11);
    const player = [...s.owner].find((o) => o >= 0)!;
    expect(outcome(s, player)).toBeNull();
    // hand the player everything: unambiguously over the line
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, player);
    expect(shareOf(s, player)).toBeGreaterThan(VICTORY_SHARE);
    expect(outcome(s, player)).toEqual({ kind: "victory" });
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, UNOWNED);
    expect(outcome(s, player)).toEqual({ kind: "defeat" });
  });

  it("reports being outpaced when a rival crosses the line first", () => {
    const s = fresh(11);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const player = nations[0], rival = nations[1];
    for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) setOwner(s, c, rival);
    const oneCell = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
    setOwner(s, oneCell, player);          // the player survives but is nowhere near winning
    expect(outcome(s, player)).toEqual({ kind: "outpaced", by: rival });
  });

  it("stays deterministic with the AI running", () => {
    const a = fresh(11), b = fresh(11);
    const player = [...a.owner].find((o) => o >= 0)!;
    for (let t = 0; t < 40; t++) { aiStep(a, player); tick(a); aiStep(b, player); tick(b); }
    expect([...a.owner]).toEqual([...b.owner]);
    expect([...a.troops]).toEqual([...b.troops]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/frontSim.test.ts -t "opponents and victory"
```

Expected: FAIL — `aiStep`, `landTotal`, `shareOf`, `outcome` and `VICTORY_SHARE` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/engine/frontSim.ts`:

```ts
export const VICTORY_SHARE = 0.4;

export function landTotal(s: FrontState): number {
  let k = 0;
  for (let c = 0; c < s.n; c++) if (s.owner[c] !== SEA) k++;
  return k;
}

export function shareOf(s: FrontState, nation: number): number {
  const total = landTotal(s);
  return total === 0 ? 0 : (s.tiles[nation] ?? 0) / total;
}

export type Outcome =
  | { kind: "victory" }
  | { kind: "defeat" }
  | { kind: "outpaced"; by: number }
  | null;

// Death first, then your own win, then a rival's. Ties go to the player, who is checked first.
export function outcome(s: FrontState, playerNation: number): Outcome {
  if ((s.tiles[playerNation] ?? 0) === 0) return { kind: "defeat" };
  if (shareOf(s, playerNation) >= VICTORY_SHARE) return { kind: "victory" };
  for (let p = 0; p < s.tiles.length; p++) {
    if (p === playerNation) continue;
    if (shareOf(s, p) >= VICTORY_SHARE) return { kind: "outpaced", by: p };
  }
  return null;
}

// Deliberately simple, in the spirit of the army game's AI: each nation that is not already pushing
// somewhere opens a front against its weakest neighbour. It does not read the leaderboard and does
// not coordinate — the spec is explicit that a coalition against the leader is separate work.
// Deterministic: nations ascending, candidates ascending, ties to the lower id.
export function aiStep(s: FrontState, playerNation: number): void {
  for (let nation = 0; nation < s.tiles.length; nation++) {
    if (nation === playerNation || s.tiles[nation] === 0) continue;
    if (s.attacks.some((a) => a.attacker === nation)) continue;
    if (s.troops[nation] < TROOP_BASE / 2) continue;      // wait until there is something to send
    const seen = new Set<number>();
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] !== nation) continue;
      for (const q of s.world.grid.neighbors[c]) {
        const o = s.owner[q];
        if (o !== SEA && o !== nation) seen.add(o);
      }
    }
    let best = -3, bestScore = Infinity;
    for (const cand of [...seen].sort((a, b) => a - b)) {
      const score = cand === UNOWNED ? 0 : s.troops[cand];   // empty land first, then the weakest
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    if (best !== -3) startAttack(s, nation, best, 0.5);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/engine/frontSim.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 5: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/frontSim.ts src/engine/frontSim.test.ts
git commit -m "feat(frontSim): opponents that push, and a share of the map to win"
```

---

### Task 4: The app — canvas, HUD, input, loop

**Files:**
- Create: `src/ui/frontApp.ts`
- Test: `src/ui/frontApp.test.ts`

**Interfaces:**
- Consumes: everything exported by `src/engine/frontSim.ts`.
- Produces, used by Task 5: `mountFrontApp(root: HTMLElement, opts?: { seed?: number }): void`, and the pure `paintPlan(s, player): { cell: number; fill: string }[]`.

**Why a pure paint model:** jsdom returns `null` from `canvas.getContext("2d")`, so nothing drawn can be asserted there. `paintPlan` decides *what* colour every cell should be and is testable without a canvas; the drawing code does nothing but execute it. Mounting must survive a null context so the HUD and input tests can run.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/frontApp.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountFrontApp, paintPlan } from "./frontApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initFrontSim, setOwner, SEA, UNOWNED } from "../engine/frontSim";

describe("frontApp", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("paints every land cell and leaves the sea alone", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const player = [...s.owner].find((o) => o >= 0)!;
    const plan = paintPlan(s, player);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    expect(plan).toHaveLength(land.length);
    expect(plan.every((p) => s.owner[p.cell] !== SEA)).toBe(true);
    expect(plan.map((p) => p.cell)).toEqual(land);          // ascending, so redraws are stable
  });

  it("gives the player its own colour, distinct from unowned land and from rivals", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const player = nations[0], rival = nations[1];
    const fill = (cell: number) => paintPlan(s, player).find((p) => p.cell === cell)!.fill;
    const mine = [...Array(s.n).keys()].find((c) => s.owner[c] === player)!;
    const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
    const empty = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED);
    expect(fill(mine)).not.toBe(fill(theirs));
    if (empty !== undefined) expect(fill(mine)).not.toBe(fill(empty));
  });

  it("repaints as ownership changes", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const player = [...s.owner].find((o) => o >= 0)!;
    const cell = [...Array(s.n).keys()].find((c) => s.owner[c] !== SEA && s.owner[c] !== player)!;
    const before = paintPlan(s, player).find((p) => p.cell === cell)!.fill;
    setOwner(s, cell, player);
    expect(paintPlan(s, player).find((p) => p.cell === cell)!.fill).not.toBe(before);
  });

  it("mounts without a 2d context and still renders the HUD and the controls", () => {
    // jsdom has no canvas backend, so getContext returns null. Mounting must survive that, or none
    // of the input tests below could exist at all.
    mountFrontApp(root, { seed: 11 });
    expect(root.querySelector("canvas.front-map")).toBeTruthy();
    const hud = root.querySelector(".front-hud")!;
    expect(hud.textContent).toMatch(/\d/);
    expect(root.querySelector("input.front-commit")).toBeTruthy();
  });

  it("shows the pool against the cap, and the commit slider in both percent and troops", () => {
    mountFrontApp(root, { seed: 11 });
    const hud = root.querySelector(".front-hud")!.textContent!;
    expect(hud).toMatch(/\d+\s*\/\s*\d+/);                 // pool / cap
    const commit = root.querySelector(".front-commit-label")!.textContent!;
    expect(commit).toMatch(/%/);
    expect(commit).toMatch(/\(\d+\)/);                     // absolute troops in brackets
  });

  it("moving the slider changes the troops it says it will send", () => {
    mountFrontApp(root, { seed: 11 });
    const slider = root.querySelector("input.front-commit") as HTMLInputElement;
    const read = () => root.querySelector(".front-commit-label")!.textContent!;
    slider.value = "20";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const low = read();
    slider.value = "80";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(read()).not.toBe(low);
    expect(read()).toContain("80%");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/ui/frontApp.test.ts
```

Expected: FAIL — `src/ui/frontApp.ts` does not exist.

- [ ] **Step 3: Write the app**

Create `src/ui/frontApp.ts`:

```ts
import "../theme.css";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initFrontSim, tick, aiStep, startAttack, outcome, maxTroops, regenPerTick,
  SEA, UNOWNED, TICK_HZ, type FrontState,
} from "../engine/frontSim";
import { nationColor } from "./nationPalette";

const PLAYER_FILL = "#c0392b";
const EMPTY_FILL = "#c8bfa6";

// What to draw, separated from drawing it. jsdom has no canvas backend, so this is the only part of
// rendering that can be tested — and it is the part where a mistake would actually be visible.
// Ascending cell order so a repaint never depends on iteration order.
export function paintPlan(s: FrontState, player: number): { cell: number; fill: string }[] {
  const out: { cell: number; fill: string }[] = [];
  for (let c = 0; c < s.n; c++) {
    const o = s.owner[c];
    if (o === SEA) continue;
    out.push({ cell: c, fill: o === player ? PLAYER_FILL : o === UNOWNED ? EMPTY_FILL : nationColor(o) });
  }
  return out;
}

export function mountFrontApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const seed = opts.seed ?? 1;
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  const s = initFrontSim(world);
  const player = [...s.owner].find((o) => o >= 0) ?? 0;
  let commit = 0.2;

  root.innerHTML = "";
  const hud = document.createElement("div");
  hud.className = "front-hud";
  root.appendChild(hud);

  const canvas = document.createElement("canvas");
  canvas.className = "front-map";
  canvas.width = world.grid.width;
  canvas.height = world.grid.height;
  root.appendChild(canvas);

  const bar = document.createElement("div");
  bar.className = "front-controls";
  const label = document.createElement("span");
  label.className = "front-commit-label";
  const slider = document.createElement("input");
  slider.className = "front-commit";
  slider.type = "range";
  slider.min = "1"; slider.max = "100"; slider.value = "20";
  bar.append(slider, label);
  root.appendChild(bar);

  // One Path2D per cell, built once: rebuilding 4,000 paths every frame is the cost this game
  // cannot afford, and it is the reason this page is canvas rather than SVG.
  const paths: Path2D[] = [];
  for (let c = 0; c < s.n; c++) {
    const p = new Path2D();
    const poly = world.grid.polygons[c];
    if (poly && poly.length) {
      p.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1]);
      p.closePath();
    }
    paths.push(p);
  }

  const ctx = canvas.getContext("2d");   // null under jsdom; everything below must tolerate that

  function draw(): void {
    if (!ctx) return;
    for (const { cell, fill } of paintPlan(s, player)) {
      ctx.fillStyle = fill;
      ctx.fill(paths[cell]);
    }
  }

  function renderHud(): void {
    const pool = Math.round(s.troops[player]);
    const cap = Math.round(maxTroops(s, player));
    const rate = Math.round(regenPerTick(s, player) * TICK_HZ);
    const oc = outcome(s, player);
    hud.textContent =
      `병력 ${pool} / ${cap} · +${rate}/s · 영토 ${s.tiles[player]}` +
      (oc ? ` · ${oc.kind === "victory" ? "승리" : oc.kind === "defeat" ? "패배" : "추월당함"}` : "");
    label.textContent = `${slider.value}% (${Math.round(s.troops[player] * commit)})`;
  }

  slider.addEventListener("input", () => { commit = Number(slider.value) / 100; renderHud(); });

  canvas.addEventListener("click", (ev) => {
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    let hit = -1;
    for (let c = 0; c < s.n; c++) if (ctx.isPointInPath(paths[c], x, y)) { hit = c; break; }
    if (hit < 0 || s.owner[hit] === SEA || s.owner[hit] === player) return;
    startAttack(s, player, s.owner[hit], commit);
    renderHud();
  });

  renderHud();
  draw();

  // Real time lives here and nowhere else: the loop decides WHEN to step, the engine decides WHAT a
  // step is. An accumulator keeps the simulation rate fixed regardless of framerate, which is what
  // keeps a replay of the same commands identical.
  let last = 0, acc = 0;
  function frame(now: number): void {
    if (last) {
      acc += now - last;
      const step = 1000 / TICK_HZ;
      while (acc >= step) { aiStep(s, player); tick(s); acc -= step; }
      renderHud();
      draw();
    }
    last = now;
    if (!outcome(s, player)) requestAnimationFrame(frame);
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(frame);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/ui/frontApp.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full suite, type check and build**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass. If `nationColor(o)` has a different signature than assumed, adapt the call — do not invent a second palette; report what you changed.

- [ ] **Step 6: Commit**

```bash
git add src/ui/frontApp.ts src/ui/frontApp.test.ts
git commit -m "feat(frontApp): canvas map, commit slider, and a fixed-step loop"
```

---

### Task 5: The page, the wiring, and a live check

**Files:**
- Create: `src/ui/frontMain.ts`, `playFront.html`
- Modify: `vite.config.ts` (one new input), `src/landing.ts` (one new card), `src/landing.test.ts`

**Interfaces:**
- Consumes: `mountFrontApp(root, { seed })` from Task 4.
- Produces: a reachable page at `playFront.html`, built by Vite and linked from the landing page.

- [ ] **Step 1: Write the failing landing test**

In `src/landing.test.ts`, add alongside the existing `playArmy.html` card test:

```ts
  it("renders a card linking to playFront.html with the Korean sub text", () => {
    const root = document.createElement("div");
    mountLanding(root);
    const link = [...root.querySelectorAll("a.choice-card")]
      .find((a) => a.getAttribute("href") === "playFront.html");
    expect(link).toBeTruthy();
    expect(link!.textContent).toContain("실시간");
  });
```

Match the surrounding tests' setup — if they call something other than `mountLanding`, use theirs.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/landing.test.ts -t "playFront"
```

Expected: FAIL — no card links to `playFront.html`.

- [ ] **Step 3: Create the entry point**

Create `src/ui/frontMain.ts`:

```ts
import "../theme.css";
import { mountFrontApp } from "./frontApp";

// ?seed=12345 pins the world so a play-test session can be reproduced, exactly as the other games do.
function seedFromQuery(): number | undefined {
  const raw = new URLSearchParams(location.search).get("seed");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

const root = document.getElementById("front-app");
if (root) mountFrontApp(root, { seed: seedFromQuery() });
```

- [ ] **Step 4: Create the page**

Create `playFront.html`, matching `playArmy.html` exactly except for the title, mount id and script:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WorldMaker — 전선</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="front-app"></div>
    <script type="module" src="/src/ui/frontMain.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Add the Vite input and the landing card**

In `vite.config.ts`, add to the `input` map beside `playArmy`:

```ts
        playFront: "playFront.html",
```

In `src/landing.ts`, add a card beside the `playArmy.html` one, following that card's exact markup shape:

```html
      <a class="choice-card" href="playFront.html">
        <span class="choice-title">⚡ Hold the Front</span>
        <span class="choice-sub">실시간 전선 — 국경 전체로 밀어붙이기</span>
      </a>
```

- [ ] **Step 6: Add the minimal styles**

In `src/theme.css`, beside the existing `.army-*` rules:

```css
.front-hud { font-size: 15px; padding: 6px 2px; color: #3c2f1c; }
.front-map { display: block; width: 100%; max-width: 900px; margin: 6px auto; background: #eadfc2;
  border: 1px solid #cbb784; border-radius: 5px; max-height: 60vh; cursor: pointer; }
.front-controls { display: flex; gap: 8px; align-items: center; font-size: 14px; padding: 4px 2px; }
.front-commit { width: 220px; }
```

- [ ] **Step 7: Run everything**

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Expected: all pass, and the build emits `playFront.html`.

- [ ] **Step 8: Commit**

```bash
git add src/ui/frontMain.ts playFront.html vite.config.ts src/landing.ts src/landing.test.ts src/theme.css
git commit -m "feat(playFront): a page for the real-time front game"
```

- [ ] **Step 9: Live check — controller runs this, not a subagent**

Start the dev server and open `playFront.html?seed=11`. Confirm, using the browser tools rather than a screenshot (screenshots time out in this harness):

- the canvas has non-zero size and the HUD reports a pool, a cap and a rate
- the numbers change over a few seconds without any interaction — the loop is running
- clicking a neighbouring nation's territory reduces the pool immediately and the map changes within a second or two
- the console is clean

Report what the pool, cap and rate actually were, and how long a neighbour took to fall. Those numbers are the first real input to tuning the constants.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Tile ownership on the existing grid, no provinces | Task 1 (`owner` indexed by cell) |
| One troop pool per nation, no units, no movement | Task 1 (`troops` per nation; no unit type exists anywhere) |
| Click a target → the whole shared border advances | Task 2 (`borderCells` length drives the budget) + Task 4 (canvas click) |
| Cap sublinear in territory; regen falls as the pool fills | Task 1 (`maxTroops`, `regenPerTick`) |
| Percentage commit, deducted immediately | Task 2 (`startAttack`) + Task 4 (slider) |
| Fixed-timestep real time, determinism preserved | Task 4 (accumulator loop) + determinism tests in Tasks 1, 2, 3 |
| Canvas rendering | Task 4 (`Path2D` cache, `paintPlan`) |
| AI opponents | Task 3 (`aiStep`) |
| Victory at a share of theater land | Task 3 (`outcome`, `VICTORY_SHARE`) |
| Attack formula: force clamp, per-cell costs, unowned is free | Task 2 Step 5 + its tests |
| Starting constants, exact values | Global Constraints + Task 1 Step 3, Task 2 Step 3, Task 3 Step 3 |
| `terrainDef` reuses `BIOME_DEF` rather than a second table | Task 2 Step 3 |
| Existing games untouched | Global Constraints; only `vite.config.ts`, `src/landing.ts`, `src/theme.css` are edited |
| Measurement: is it fun, does fill-pressure bite, how fast does it resolve | Task 5 Step 9 gathers the first numbers; the fun question is the user's, not a task |

The spec's "what this does not do" section needs no task — it is a statement that the runaway is out of scope.

**Placeholder scan:** none. Every code step carries its code; every command carries its expected output. Two steps say "adapt if the existing signature differs" (`nationColor`, the landing test's mount helper) and both require reporting what changed — those are instructions to check reality, not deferred decisions.

**Type consistency:** `FrontState`, `Attack`, `setOwner`, `maxTroops`, `regenPerTick`, `tick`, `borderCells`, `startAttack`, `cancelAttack`, `terrainDef`, `aiStep`, `landTotal`, `shareOf`, `outcome`, `paintPlan` and `mountFrontApp` are each defined once and used with the same signature everywhere after. `UNOWNED = -1` and `SEA = -2` are used consistently in the engine, the tests and `paintPlan`. The `Outcome` union in Task 3 matches what Task 4's HUD switches on.
