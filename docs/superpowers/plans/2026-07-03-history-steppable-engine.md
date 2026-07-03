# Steppable History Engine (Version B, Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the monolithic `simulateHistory` tick-loop into a steppable engine (`SimState` + `initSim` + `stepSim`) with zero behavior change, so later sub-projects can advance the sim one tick at a time and inject player interventions.

**Architecture:** New `src/engine/historySim.ts` holds `SimState` and the `initSim`/`stepSim` functions (the current loop's setup and one-tick body), plus the constants, helpers, and `History*` types. `src/engine/history.ts` shrinks to a thin batch wrapper that loops `stepSim` and re-exports the types — its public API (`simulateHistory` + `History*`) is unchanged, so every consumer keeps working.

**Tech Stack:** TypeScript, Vite, Vitest.

## Global Constraints

- **Behavior-preserving refactor — output must be byte-identical.** `simulateHistory` must return the same result it does today. Validated by a golden-anchor characterization test (Task 1) plus the existing 12 `history.test.ts` tests.
- **rng determinism:** `SimState.rng` is the mulberry32 **closure**, created once in `initSim` and carried across every `stepSim`; drawn in the exact same order/count per tick as today.
- **Landmine 1 — `polities` grows mid-tick:** the civil-war and free-city blocks `push` into `state.polities` during one `stepSim`. Later blocks iterate `0..state.polities.length` live. **Do NOT reorder the blocks and do NOT cache `polities.length` in a local** — read it live each block, exactly as the current loop.
- **Landmine 2 — `solidarity` is reassigned each tick:** `stepSim` builds `nextSol` then sets `state.solidarity = nextSol`; the civil-war block's `CIVILWAR_BIRTH_SOL` write must land in the new array via `state.solidarity[c] = …`. Never keep a stale local ref to the pre-reassignment array. (This plan avoids the trap by reading `state.solidarity` live and only destructuring `owner`/`terrain`.)
- **Public API unchanged:** `simulateHistory(world, worldSeed): History` and the exported `History*` types must remain importable from `./history`. `app.ts`, `timeline.ts`, `chronicle.ts`, `gazetteer.ts` must not need edits.
- **Golden anchor values (seeds 1–3), pinned:**
  | seed | snaps | pols | events | econ | allSnapHash | eventsHash | politiesHash |
  |------|-------|------|--------|------|-------------|------------|--------------|
  | 1 | 51 | 14 | 31 | 3 | 2796185232 | 3677329610 | 4247206507 |
  | 2 | 51 | 15 | 38 | 3 |  999977846 | 1287836464 | 1375770347 |
  | 3 | 51 | 16 | 44 | 3 | 4292460260 | 4115537623 | 2430550014 |
- Run tests with `npm test`. Build with `npm run build`.

---

### Task 1: Golden-anchor characterization test (safety net)

Lock today's `simulateHistory` behavior with a hash anchor BEFORE refactoring. This test passes on the current code (the values were captured from it); Task 2 must keep it green.

**Files:**
- Test: `src/engine/history.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: existing `simulateHistory(world, worldSeed): History`, existing `build(seed)` helper (top of the file), `HistoryEvent`/`HistoryPolity` shapes.
- Produces: nothing consumed by later tasks (pure test).

- [ ] **Step 1: Append the anchor test**

Append to `src/engine/history.test.ts` (after the closing `});` of the existing `describe("simulateHistory skeleton", …)`), reusing the file's existing `build` helper:

```ts
describe("simulateHistory golden anchor (behaviour lock)", () => {
  const fold = (h: number, x: number) => { h ^= x >>> 0; return Math.imul(h, 16777619) >>> 0; };
  const fnvArr = (arr: ArrayLike<number>) => { let h = 2166136261 >>> 0; for (let i = 0; i < arr.length; i++) h = fold(h, arr[i] + 1); return h >>> 0; };
  const fnvStr = (str: string) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) h = fold(h, str.charCodeAt(i)); return h >>> 0; };
  const anchors: Record<number, { snaps: number; pols: number; evs: number; econ: number; allSnap: number; events: number; polities: number }> = {
    1: { snaps: 51, pols: 14, evs: 31, econ: 3, allSnap: 2796185232, events: 3677329610, polities: 4247206507 },
    2: { snaps: 51, pols: 15, evs: 38, econ: 3, allSnap:  999977846, events: 1287836464, polities: 1375770347 },
    3: { snaps: 51, pols: 16, evs: 44, econ: 3, allSnap: 4292460260, events: 4115537623, polities: 2430550014 },
  };
  for (const seed of [1, 2, 3]) {
    it(`reproduces the pinned hashes for seed ${seed}`, () => {
      const h = simulateHistory(build(seed), seed);
      let allSnap = 2166136261 >>> 0;
      for (const s of h.snapshots) allSnap = fold(allSnap, fnvArr(s.owner));
      let ev = 2166136261 >>> 0;
      for (const e of h.events) {
        ev = fold(ev, e.year); ev = fold(ev, fnvStr(e.type)); ev = fold(ev, e.polityId + 1);
        ev = fold(ev, (e.otherId ?? -1) + 1); ev = fold(ev, (e.cell ?? -1) + 1); ev = fold(ev, fnvStr(e.text));
      }
      let pol = 2166136261 >>> 0;
      for (const p of h.polities) {
        pol = fold(pol, p.id + 1); pol = fold(pol, p.capital + 1); pol = fold(pol, p.foundedYear);
        pol = fold(pol, (p.endedYear ?? -1) + 1); pol = fold(pol, fnvStr(p.origin)); pol = fold(pol, fnvStr(p.name)); pol = fold(pol, p.free ? 1 : 0);
      }
      const a = anchors[seed];
      expect(h.snapshots.length).toBe(a.snaps);
      expect(h.polities.length).toBe(a.pols);
      expect(h.events.length).toBe(a.evs);
      expect(h.economicZones.length).toBe(a.econ);
      expect(allSnap >>> 0).toBe(a.allSnap);
      expect(ev >>> 0).toBe(a.events);
      expect(pol >>> 0).toBe(a.polities);
    });
  }
});
```

- [ ] **Step 2: Run the anchor test — confirm it PASSES on current code**

Run: `npm test -- history.test`
Expected: PASS (all existing 12 + 3 new anchor tests). This is a characterization test, not a feature test — it passing NOW proves the pinned values match reality, so it can catch a regression in Task 2. If it FAILS, the pinned values are wrong — stop and report (do not adjust them blindly).

- [ ] **Step 3: Commit**

```bash
git add src/engine/history.test.ts
git commit -m "test: golden-anchor characterization of simulateHistory (pre-refactor lock)"
```

---

### Task 2: Extract the steppable engine (`historySim.ts`) + shrink `history.ts` to a wrapper

The refactor itself. Move all logic into `historySim.ts` as `initSim`/`stepSim`; make `history.ts` a thin wrapper. Add unit tests for the new functions. The Task-1 anchor + the existing 12 tests are the regression gate.

**Files:**
- Create: `src/engine/historySim.ts`
- Modify: `src/engine/history.ts` (replace its body with the wrapper + type re-exports)
- Test: `src/engine/historySim.test.ts` (new)

**Interfaces:**
- Consumes: `World` (`../types/world`), `OCEAN` (`./terrain`), `mulberry32`/`deriveSeed`/`Rng` (`./rng`), `makeNameGen`/`NameGen` (`./names`).
- Produces:
  - `historySim.ts`: `export const TICKS = 50, YEARS_PER_TICK = 10;`
  - `export interface SimState { grid: World["grid"]; terrain: number[]; n: number; owner: Int32Array; solidarity: Float32Array; polities: HistoryPolity[]; capitals: number[]; alive: boolean[]; golden: boolean[]; rng: Rng; nameGen: NameGen; events: HistoryEvent[]; snapshots: HistorySnapshot[]; economicZones: EconomicZone[]; zoneCells: Set<number>; cityCells: { cell: number; name: string }[]; tick: number; }`
  - `export function initSim(world: World, worldSeed: number): SimState`
  - `export function stepSim(state: SimState): void`
  - `export interface HistoryPolity / HistoryEvent / HistorySnapshot / EconomicZone / History`, `export type HistoryEventType` (moved here from `history.ts`).
  - `history.ts`: `export function simulateHistory(world: World, worldSeed: number): History` (unchanged signature) + `export type { … } from "./historySim"`.

- [ ] **Step 1: Write the failing unit tests for the new module**

Create `src/engine/historySim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, TICKS } from "./historySim";

describe("historySim", () => {
  it("initSim yields the year-0 state", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initSim(world, 1);
    expect(s.tick).toBe(0);
    expect(s.snapshots.length).toBe(1);
    expect(s.snapshots[0].year).toBe(0);
    expect(Array.from(s.owner)).toEqual(Array.from(world.polityOf));
    expect(s.polities.length).toBe(world.polities.length);
    for (const p of s.polities) expect(p.origin).toBe("initial");
    const founds = s.events.filter((e) => e.type === "found" && e.year === 0);
    expect(founds.length).toBe(world.polities.length);
    expect(s.events.some((e) => e.type === "staple")).toBe(true);
  });

  it("stepSim advances one tick and appends a snapshot", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initSim(world, 1);
    stepSim(s);
    expect(s.tick).toBe(1);
    expect(s.snapshots.length).toBe(2);
    expect(s.snapshots[1].year).toBe(10);
    expect(s.snapshots[1].owner.length).toBe(world.grid.count);
  });

  it("is deterministic across two init+step runs (whole-timeline hash)", () => {
    const run = () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
      const s = initSim(world, 4);
      for (let t = 1; t <= TICKS; t++) stepSim(s);
      let h = 2166136261 >>> 0;
      for (const snap of s.snapshots) for (let i = 0; i < snap.owner.length; i++) { h ^= (snap.owner[i] + 1) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    };
    expect(run()).toBe(run());
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- historySim`
Expected: FAIL ("Cannot find module './historySim'" / `initSim` is not a function).

- [ ] **Step 3: Create `src/engine/historySim.ts`**

This is the current `history.ts` reorganized: constants + types + helpers at module scope, the pre-loop setup as `initSim`, the one-tick loop body as `stepSim`. Preserve every constant value, every event string, and the exact block order and rng draw order.

```ts
import { OCEAN } from "./terrain";
import type { World } from "../types/world";
import { mulberry32, deriveSeed, type Rng } from "./rng";
import { makeNameGen, type NameGen } from "./names";

export const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002, CONTEST_THRESH = 1.03;
const SIZE_CAP = 24;
const HISTORY_SALT = 9001;
const CIVILWAR_MIN_CELLS = 220, CIVILWAR_MAX_ASA = 0.42, CIVILWAR_PROB = 0.06, CIVILWAR_BIRTH_SOL = 0.7;
const FREE_REACH = 250, FREE_MAX_ASA = 0.5, FREE_PROB = 0.035, FREE_ZONE_PROB = 0.09;
const FREE_SOL = 0.85, FREE_CLUSTER = 5, FREE_MAX_ALIVE = 4;
const ECON_COUNT = 3, ECON_SOL_FLOOR = 0.55, ECON_BONUS = 0.12;
const GOLDEN_MIN_CELLS = 170, GOLDEN_MIN_ASA = 0.38;
const HPALETTE = ["#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6", "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8"];
const FREE_COLOR = "#b7b1a4";

interface Agg { cells: number; power: number; avg: number; }

export interface HistoryPolity {
  id: number; name: string; color: string;
  capital: number; foundedYear: number; endedYear: number | null;
  origin: "initial" | "fragment" | "free";
  free: boolean;
}
export type HistoryEventType = "found" | "newCity" | "conquer" | "civilwar" | "independence" | "staple" | "goldenage";
export interface HistoryEvent {
  year: number; type: HistoryEventType; text: string;
  polityId: number; otherId?: number; cell?: number;
}
export interface HistorySnapshot { year: number; owner: Int32Array; }
export interface EconomicZone { cell: number; name: string; }
export interface History {
  years: number;
  polities: HistoryPolity[];
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
  economicZones: EconomicZone[];
}

export interface SimState {
  grid: World["grid"];
  terrain: number[];
  n: number;
  owner: Int32Array;
  solidarity: Float32Array;
  polities: HistoryPolity[];
  capitals: number[];
  alive: boolean[];
  golden: boolean[];
  rng: Rng;
  nameGen: NameGen;
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
  economicZones: EconomicZone[];
  zoneCells: Set<number>;
  cityCells: { cell: number; name: string }[];
  tick: number;
}

const px = (s: SimState, i: number) => s.grid.points[i * 2];
const py = (s: SimState, i: number) => s.grid.points[i * 2 + 1];
const dist = (s: SimState, a: number, b: number) => Math.hypot(px(s, a) - px(s, b), py(s, a) - py(s, b));

function aggregate(s: SimState): Agg[] {
  const a: Agg[] = s.polities.map(() => ({ cells: 0, power: 0, avg: 0 }));
  for (let c = 0; c < s.n; c++) { const o = s.owner[c]; if (o >= 0) { a[o].cells++; a[o].power += s.solidarity[c]; } }
  for (const g of a) g.avg = g.cells > 0 ? g.power / g.cells : 0;
  return a;
}
function zoneBonus(s: SimState, p: number): number {
  let b = 0;
  for (const z of s.economicZones) if (s.owner[z.cell] === p) b += ECON_BONUS;
  return b;
}
// greedy farthest-point: pick `count` cells maximising min-distance to the chosen set
function farthest(s: SimState, cells: number[], seed: number, count: number): number[] {
  const chosen = [seed]; const out: number[] = [];
  while (out.length < count) {
    let best = -1, bd = -1;
    for (const c of cells) {
      if (chosen.includes(c)) continue;
      let md = Infinity;
      for (const sc of chosen) { const d = dist(s, c, sc); if (d < md) md = d; }
      if (md > bd) { bd = md; best = c; }
    }
    if (best < 0) break;
    chosen.push(best); out.push(best);
  }
  return out;
}

export function initSim(world: World, worldSeed: number): SimState {
  const { grid, terrain, polityOf } = world;
  const n = grid.count;
  const owner = Int32Array.from(polityOf);
  const rng = mulberry32(deriveSeed(worldSeed, HISTORY_SALT));
  const nameGen = makeNameGen(mulberry32(deriveSeed(worldSeed, HISTORY_SALT + 1)));
  const solidarity = new Float32Array(n);
  for (let c = 0; c < n; c++) solidarity[c] = owner[c] >= 0 ? SOL_INIT : 0;

  const polities: HistoryPolity[] = world.polities.map((p) => ({
    id: p.id, name: p.name, color: p.color, capital: p.capital,
    foundedYear: 0, endedYear: null, origin: "initial" as const, free: false,
  }));
  const capitals: number[] = polities.map((p) => p.capital);
  const alive: boolean[] = polities.map(() => true);
  const golden: boolean[] = polities.map(() => false);

  const events: HistoryEvent[] = [];
  for (const p of polities) events.push({ year: 0, type: "found", text: `0년, ${p.name} 건국`, polityId: p.id, cell: p.capital });

  // economic zones: prefer coastal, then large cities (deterministic, no rng draw)
  const zoneCities = [...world.cities]
    .sort((a, b) => (Number(b.coastal) - Number(a.coastal)) || (b.size - a.size) || (a.id - b.id))
    .slice(0, ECON_COUNT);
  const economicZones: EconomicZone[] = zoneCities.map((c) => ({ cell: c.cell, name: c.name }));
  const zoneCells = new Set(economicZones.map((z) => z.cell));
  for (const z of economicZones) events.push({ year: 0, type: "staple", text: `0년, ${z.name} 자유무역항 지정`, polityId: owner[z.cell] >= 0 ? owner[z.cell] : -1, cell: z.cell });

  const snapshots: HistorySnapshot[] = [{ year: 0, owner: owner.slice() }];
  const cityCells = world.cities.map((c) => ({ cell: c.cell, name: c.name }));

  return { grid, terrain, n, owner, solidarity, polities, capitals, alive, golden, rng, nameGen, events, snapshots, economicZones, zoneCells, cityCells, tick: 0 };
}

export function stepSim(s: SimState): void {
  const year = (s.tick + 1) * YEARS_PER_TICK;
  const { n, owner, terrain } = s;      // owner is a live ref, mutated in place; never reassigned
  const neighbors = s.grid.neighbors;

  // --- solidarity update (double-buffered); free cells pinned high, zones floored ---
  const nextSol = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const o = owner[c];
    if (o < 0) { nextSol[c] = 0; continue; }
    if (s.polities[o].free) { nextSol[c] = FREE_SOL; continue; }
    let frontier = false;
    for (const nb of neighbors[c]) { if (terrain[nb] !== OCEAN && owner[nb] !== o) { frontier = true; break; } }
    let sv = s.solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
    if (s.zoneCells.has(c) && sv < ECON_SOL_FLOOR) sv = ECON_SOL_FLOOR;
    nextSol[c] = sv < 0 ? 0 : sv > 1 ? 1 : sv;
  }
  s.solidarity = nextSol;

  // --- border contests: asabiyya + local − admin reach (free polities never attack) ---
  const agg = aggregate(s);
  const nextOwner = owner.slice();
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN) continue;
    const o = owner[c];
    let best = -1, bestAvg = -Infinity, bestCell = -1;
    for (const nb of neighbors[c]) {
      if (terrain[nb] === OCEAN) continue;
      const p = owner[nb];
      if (p < 0 || p === o || s.polities[p].free) continue;
      if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = nb; }
    }
    if (best < 0) continue;
    const attack = agg[best].avg * W_ASA + s.solidarity[bestCell] * W_LOCAL + Math.min(Math.sqrt(agg[best].cells), SIZE_CAP) * W_POWER - dist(s, c, s.capitals[best]) * W_DIST + zoneBonus(s, best);
    const defend = o < 0 ? 0 : agg[o].avg * W_ASA + s.solidarity[c] * W_LOCAL + Math.min(Math.sqrt(agg[o].cells), SIZE_CAP) * W_POWER - dist(s, c, s.capitals[o]) * W_DIST + zoneBonus(s, o);
    if (attack > defend * CONTEST_THRESH) nextOwner[c] = best;
  }
  owner.set(nextOwner);

  // --- conquest: a polity whose capital falls is eliminated and annexed ---
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o]) continue;
    const capOwner = owner[s.capitals[o]];
    if (capOwner >= 0 && capOwner !== o) {
      for (let c = 0; c < n; c++) if (owner[c] === o) owner[c] = capOwner;
      s.alive[o] = false; s.polities[o].endedYear = year;
      s.events.push({ year, type: "conquer", text: `${year}년, ${s.polities[capOwner].name}이(가) ${s.polities[o].name}을(를) 정복`, polityId: capOwner, otherId: o, cell: s.capitals[o] });
    }
  }

  // --- civil war: one large, low-cohesion empire disintegrates into 2-3 successors ---
  const agg2 = aggregate(s);
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o] || s.polities[o].free || agg2[o].cells < CIVILWAR_MIN_CELLS) continue;
    if (agg2[o].avg >= CIVILWAR_MAX_ASA) continue;
    if (s.rng() > CIVILWAR_PROB) continue;
    const cells: number[] = [];
    for (let c = 0; c < n; c++) if (owner[c] === o) cells.push(c);
    const extra = s.rng() < 0.5 ? 1 : 2; // 2 or 3 successor states total
    const newCaps = farthest(s, cells, s.capitals[o], extra);
    if (newCaps.length === 0) continue;
    const allCaps = [s.capitals[o], ...newCaps];
    const capPolity = allCaps.map((_, i) => (i === 0 ? o : s.polities.length + i - 1));
    const names: string[] = [];
    for (let i = 1; i < allCaps.length; i++) {
      const id = s.polities.length;
      const nm = s.nameGen.nation();
      names.push(nm);
      s.polities.push({ id, name: nm, color: HPALETTE[id % HPALETTE.length], capital: allCaps[i], foundedYear: year, endedYear: null, origin: "fragment", free: false });
      s.capitals.push(allCaps[i]); s.alive.push(true); s.golden.push(false);
    }
    for (const c of cells) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < allCaps.length; i++) { const d = dist(s, c, allCaps[i]); if (d < bd) { bd = d; bi = i; } }
      owner[c] = capPolity[bi];
      s.solidarity[c] = CIVILWAR_BIRTH_SOL; // fresh cohesion so successors can stand on their own
    }
    s.events.push({ year, type: "civilwar", text: `${year}년, 내란이 ${s.polities[o].name}을(를) ${names.join("·")}(으)로 쪼갬`, polityId: o, cell: s.capitals[o] });
    break;
  }

  // --- free city: one city beyond admin reach (or an econ zone) declares independence ---
  const agg3 = aggregate(s);
  let aliveFree = 0;
  for (let o = 0; o < s.polities.length; o++) if (s.alive[o] && s.polities[o].free) aliveFree++;
  for (const { cell: c, name } of aliveFree < FREE_MAX_ALIVE ? s.cityCells : []) {
    const o = owner[c];
    if (o < 0 || !s.alive[o] || s.polities[o].free) continue;
    const isZone = s.zoneCells.has(c);
    const reachOk = dist(s, c, s.capitals[o]) > FREE_REACH;
    if (!isZone && !reachOk) continue;
    if (!isZone && agg3[o].avg >= FREE_MAX_ASA) continue;
    if (c === s.capitals[o]) continue; // a capital doesn't secede from itself
    if (s.rng() > (isZone ? FREE_ZONE_PROB : FREE_PROB)) continue;
    const cluster: number[] = [c]; const inC = new Set([c]);
    for (let qi = 0; qi < cluster.length && cluster.length < FREE_CLUSTER; qi++) {
      for (const nb of neighbors[cluster[qi]]) {
        if (owner[nb] === o && nb !== s.capitals[o] && !inC.has(nb)) { inC.add(nb); cluster.push(nb); if (cluster.length >= FREE_CLUSTER) break; }
      }
    }
    const id = s.polities.length;
    s.polities.push({ id, name, color: FREE_COLOR, capital: c, foundedYear: year, endedYear: null, origin: "free", free: true });
    s.capitals.push(c); s.alive.push(true); s.golden.push(false);
    for (const cc of cluster) owner[cc] = id;
    s.events.push({ year, type: "independence", text: `${year}년, 자유도시 ${name} 독립 선포`, polityId: id, otherId: o, cell: c });
    break;
  }

  // --- golden age: a polity first reaching high cohesion + size ---
  const agg4 = aggregate(s);
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o] || s.golden[o] || s.polities[o].free) continue;
    if (agg4[o].cells >= GOLDEN_MIN_CELLS && agg4[o].avg >= GOLDEN_MIN_ASA) {
      s.golden[o] = true;
      s.events.push({ year, type: "goldenage", text: `${year}년, ${s.polities[o].name} 황금기 도래`, polityId: o, cell: s.capitals[o] });
      break;
    }
  }

  // --- new city: one large, stable polity may found a lore city ---
  for (let o = 0; o < agg4.length; o++) {
    if (!s.alive[o] || s.polities[o].free || agg4[o].cells < 40) continue;
    if (agg4[o].avg < 0.42) continue;
    if (s.rng() > 0.14) continue;
    s.events.push({ year, type: "newCity", text: `${year}년, ${s.polities[o].name}이(가) ${s.nameGen.place()} 건설`, polityId: o, cell: s.capitals[o] });
    break;
  }

  s.snapshots.push({ year, owner: owner.slice() });
  s.tick++;
}
```

- [ ] **Step 4: Replace `src/engine/history.ts` with the wrapper**

Overwrite `src/engine/history.ts` entirely with:

```ts
import type { World } from "../types/world";
import { initSim, stepSim, TICKS, YEARS_PER_TICK } from "./historySim";
import type { History } from "./historySim";

export type {
  History, HistoryPolity, HistoryEvent, HistoryEventType, HistorySnapshot, EconomicZone,
} from "./historySim";

export function simulateHistory(world: World, worldSeed: number): History {
  const s = initSim(world, worldSeed);
  for (let t = 1; t <= TICKS; t++) stepSim(s);
  return {
    years: TICKS * YEARS_PER_TICK,
    polities: s.polities,
    events: s.events,
    snapshots: s.snapshots,
    economicZones: s.economicZones,
  };
}
```

- [ ] **Step 5: Run the new module tests — confirm GREEN**

Run: `npm test -- historySim`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the anchor + existing history tests — confirm behavior preserved**

Run: `npm test -- history.test`
Expected: PASS (12 existing + 3 anchor). If any anchor hash mismatches, the refactor changed behavior — most likely a reordered block, a cached `polities.length`, or a stale `solidarity` reference (see Landmines). Fix the refactor; do NOT edit the anchor values.

- [ ] **Step 7: Full suite + build**

Run: `npm test && npm run build`
Expected: all pass (existing consumers `app.ts`/`timeline.ts`/`chronicle.ts`/`gazetteer.ts` still compile against the re-exported types), build clean.

- [ ] **Step 8: Commit**

```bash
git add src/engine/historySim.ts src/engine/history.ts src/engine/historySim.test.ts
git commit -m "refactor: extract steppable historySim (initSim/stepSim); history.ts is now a thin wrapper"
```

---

## Verification (after all tasks)

- `npm test` — full suite green (existing + anchor + historySim unit tests).
- `npm run build` — clean (public API unchanged; no consumer edits).
- Confirm `git grep -n "from \"./history\"" src && git grep -n "from \"../engine/history\"" src` still resolve (types re-exported) — no consumer file was modified.
- This unblocks Version B sub-project 2 (player interventions via `applyIntervention(state, action)` between `stepSim` calls) and sub-project 3 (play-mode UI). Update `worldmaker-status.md` after merge.
