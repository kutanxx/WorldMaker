# Player Interventions — Phase 1 (thin prototype) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable thin prototype of the "steer-a-living-simulation" empire game: rule one nation
via a persistent stance + an attack action, one move per decade, while the existing Turchin sim runs
the rest — enough to judge whether nudging the sim feels meaningful.

**Architecture:** Extend `SimState` with a player identity + stance (default = no player, so
`simulateHistory` stays byte-identical). Extract the sim's per-cell contest strength into a pure
function reused by both the tick loop and a new `intervention.ts`. A thin `playSim.ts` orchestrates
turns; a list-driven `play.html` UI drives it.

**Tech Stack:** TypeScript, Vite, Vitest (+ jsdom for DOM tests). Pure engine in `src/engine/`, UI in
`src/`. No new dependencies.

## Global Constraints

- **Determinism / golden guard:** the pure history path (`simulateHistory` → the golden hashes in
  `src/engine/history.test.ts`) MUST stay byte-identical. Every player mechanic is gated on
  `s.playerPolity >= 0`; `initSim` sets `playerPolity = -1`. Run `npx vitest run src/engine/history.test.ts`
  after every engine task and confirm it passes unchanged.
- **Spec:** `docs/superpowers/specs/2026-07-06-player-interventions-design.md` (Phase 1 subset).
- **Agency = honest low-agency:** stance/attack are MODEST nudges, never an escape hatch. Constants
  are grouped + commented for easy sweeping.
- **Determinism convention:** engine reads existing arrays + `s.rng` closure; no new rng streams.
- Test commands run from repo root. Full suite: `npx vitest run`. Build check: `npm run build`.
- Korean UI copy matches the existing app tone; keep EN/KO parity minimal (Phase 1 can be EN-only in
  the play screen — the world map labels already localise).

---

### Task 1: Extract `contestStrength` (+ export `aggregate`) — behavior-preserving refactor

The border-contest inner loop computes an attacker and defender "strength" inline. Extract that math
into a pure exported function so `intervention.ts` can resolve a player attack with the SAME formula.
This must not change any output — the golden hashes are the proof.

**Files:**
- Modify: `src/engine/historySim.ts` (add exports + refactor `stepSim` lines ~161-162)
- Test: `src/engine/historySim.test.ts` (new file — unit test for the extracted fn)

**Interfaces:**
- Produces:
  - `export function aggregate(s: SimState): Agg[]` (was private `aggregate`)
  - `export interface Agg { cells: number; power: number; avg: number }`
  - `export function contestStrength(s: SimState, agg: Agg[], polity: number, distCell: number, solCell: number): number`
    — the polity's strength contesting `distCell` (distance-to-capital uses `distCell`), reading its
    local border solidarity from `solCell`.

- [ ] **Step 1: Write the failing unit test**

Create `src/engine/historySim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, aggregate, contestStrength, W_CONSTS_FOR_TEST } from "./historySim";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

describe("contestStrength", () => {
  it("reproduces the inline attacker/defender formula", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initSim(world, 1);
    const agg = aggregate(s);
    // pick any land cell with an owner and an owned neighbour
    let c = -1, solCell = -1, p = -1;
    for (let i = 0; i < s.n && c < 0; i++) {
      if (s.owner[i] < 0) continue;
      for (const nb of s.grid.neighbors[i]) if (s.owner[nb] >= 0) { c = i; solCell = nb; p = s.owner[nb]; break; }
    }
    expect(c).toBeGreaterThanOrEqual(0);
    const { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP } = W_CONSTS_FOR_TEST;
    const dx = s.grid.points[c * 2] - s.grid.points[s.capitals[p] * 2];
    const dy = s.grid.points[c * 2 + 1] - s.grid.points[s.capitals[p] * 2 + 1];
    const expected =
      agg[p].avg * W_ASA + s.solidarity[solCell] * W_LOCAL +
      Math.min(Math.sqrt(agg[p].cells), SIZE_CAP) * W_POWER -
      Math.hypot(dx, dy) * W_DIST; // zoneBonus is 0 for a non-zone polity in this tiny world
    expect(contestStrength(s, agg, p, c, solCell)).toBeCloseTo(expected + 0, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/historySim.test.ts`
Expected: FAIL — `contestStrength`/`aggregate`/`W_CONSTS_FOR_TEST` are not exported.

- [ ] **Step 3: Add the exports + extract the function in `historySim.ts`**

Make the `Agg` interface exported: change `interface Agg {` (line ~19) to `export interface Agg {`.

Change `function aggregate` (line ~66) to `export function aggregate`.

Add, right after the `zoneBonus` function (after line ~76):

```ts
// per-cell contest strength for a polity: asabiyya + local border solidarity + saturating size edge
// − admin reach + econ-zone bonus. Extracted verbatim from the border-contest loop so a player
// attack resolves with the same math the AI uses (byte-identical: golden hashes are the proof).
export function contestStrength(s: SimState, agg: Agg[], polity: number, distCell: number, solCell: number): number {
  return agg[polity].avg * W_ASA + s.solidarity[solCell] * W_LOCAL
    + Math.min(Math.sqrt(agg[polity].cells), SIZE_CAP) * W_POWER
    - dist(s, distCell, s.capitals[polity]) * W_DIST + zoneBonus(s, polity);
}

// test-only view of the private weights (so the unit test can recompute the formula)
export const W_CONSTS_FOR_TEST = { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP };
```

Replace the two inline lines in `stepSim` (currently ~161-162):

```ts
    const attack = agg[best].avg * W_ASA + s.solidarity[bestCell] * W_LOCAL + Math.min(Math.sqrt(agg[best].cells), SIZE_CAP) * W_POWER - dist(s, c, s.capitals[best]) * W_DIST + zoneBonus(s, best);
    const defend = o < 0 ? 0 : agg[o].avg * W_ASA + s.solidarity[c] * W_LOCAL + Math.min(Math.sqrt(agg[o].cells), SIZE_CAP) * W_POWER - dist(s, c, s.capitals[o]) * W_DIST + zoneBonus(s, o);
```

with:

```ts
    const attack = contestStrength(s, agg, best, c, bestCell);
    const defend = o < 0 ? 0 : contestStrength(s, agg, o, c, c);
```

- [ ] **Step 4: Run the new test AND the golden guard**

Run: `npx vitest run src/engine/historySim.test.ts src/engine/history.test.ts`
Expected: PASS — the unit test passes and the golden byte-identical history test is unchanged (the
extraction is exact). If `history.test.ts` fails, the refactor changed the math — revert and redo.

- [ ] **Step 5: Commit**

```bash
git add src/engine/historySim.ts src/engine/historySim.test.ts
git commit -m "refactor(history): extract contestStrength (byte-identical) for reuse"
```

---

### Task 2: Player identity + stance in `SimState` (gated hooks in `stepSim`)

Add the player fields and the stance modifiers. All gated on `playerPolity >= 0`, so the default
(no player) path is byte-identical.

**Files:**
- Modify: `src/engine/historySim.ts` (SimState fields, constants, `initSim` defaults, `stepSim` hooks)
- Test: `src/engine/historySim.test.ts` (add cases)

**Interfaces:**
- Consumes: `contestStrength`, `aggregate` (Task 1).
- Produces:
  - `export type Stance = "aggressive" | "defensive" | "internal"`
  - `SimState` gains `playerPolity: number`, `stance: Stance`, `peakCells: number`
  - `export const CONQUEST_SOL: number` (= the sim's fresh-cohesion value `CIVILWAR_BIRTH_SOL`)

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/historySim.test.ts`:

```ts
import { stepSim, initSim as initSim2, CONQUEST_SOL, type Stance } from "./historySim";

describe("player fields + stance", () => {
  const mk = () => { const { world } = generateWorld({ ...small, seed: 2 }); return initSim2(world, 2); };

  it("a fresh SimState has no player (byte-identical default path)", () => {
    const s = mk();
    expect(s.playerPolity).toBe(-1);
    expect(s.peakCells).toBe(0);
    expect(CONQUEST_SOL).toBeGreaterThan(0);
  });

  it("internal stance raises a player cell's solidarity more than aggressive over one tick", () => {
    const setup = (stance: Stance) => {
      const s = mk();
      // choose an interior (non-frontier) player cell so the base delta is a decay we can offset
      const p = s.owner.findIndex((o) => o >= 0);
      s.playerPolity = s.owner[p]; s.stance = stance;
      const cell = p;
      stepSim(s);
      return s.solidarity[cell];
    };
    expect(setup("internal")).toBeGreaterThan(setup("aggressive"));
  });

  it("aggressive raises the player's attacker strength above defensive (same state)", () => {
    const s = mk();
    const p = s.owner.find((o) => o >= 0)!;
    s.playerPolity = p;
    const agg = aggregate(s);
    // a border cell of p and the enemy cell beyond it
    let distCell = -1, solCell = -1;
    for (let i = 0; i < s.n && distCell < 0; i++) {
      if (s.owner[i] !== p) continue;
      for (const nb of s.grid.neighbors[i]) if (s.owner[nb] >= 0 && s.owner[nb] !== p) { solCell = i; distCell = nb; break; }
    }
    expect(distCell).toBeGreaterThanOrEqual(0);
    const base = contestStrength(s, agg, p, distCell, solCell);
    // the exported stance multipliers must order aggressive > defensive for the attacker
    const { STANCE_ATK_MULT } = W_CONSTS_FOR_TEST as any; // see Step 3 (added to the export)
    expect(base * STANCE_ATK_MULT.aggressive).toBeGreaterThan(base * STANCE_ATK_MULT.defensive);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/historySim.test.ts`
Expected: FAIL — `playerPolity`/`stance`/`peakCells`/`CONQUEST_SOL`/`STANCE_ATK_MULT` missing.

- [ ] **Step 3: Add fields, constants, defaults, and gated hooks in `historySim.ts`**

Add constants near the other constants (after line ~14):

```ts
// --- player stance (Phase 1): MODEST nudges, only active when playerPolity >= 0 (honest low-agency) ---
const STANCE_ATK_MULT = { aggressive: 1.15, defensive: 0.6, internal: 0.75 } as const; // player-as-attacker multiplier
const STANCE_DEF_MULT = { aggressive: 1.0, defensive: 1.2, internal: 1.05 } as const;  // player-as-defender multiplier
const STANCE_SOL_DELTA = { aggressive: -0.01, defensive: 0.0, internal: 0.02 } as const; // per-tick solidarity nudge on player cells
export const CONQUEST_SOL = CIVILWAR_BIRTH_SOL; // reuse the sim's fresh-conquest cohesion value
export type Stance = "aggressive" | "defensive" | "internal";
```

Extend `W_CONSTS_FOR_TEST` (from Task 1) to also expose the stance multipliers:

```ts
export const W_CONSTS_FOR_TEST = { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP, STANCE_ATK_MULT };
```

Add fields to the `SimState` interface (after `tick: number;`):

```ts
  playerPolity: number; // -1 = pure history (default); else the player's polity id
  stance: Stance;       // inert when playerPolity < 0
  peakCells: number;    // max cells the player has held (scorecard); default 0
```

In `initSim`, add to the returned object (before `tick: 0`):

```ts
    playerPolity: -1, stance: "internal", peakCells: 0,
```

In `stepSim`, solidarity update — replace the player-cell delta. Change (line ~141):

```ts
    let sv = s.solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
```

to:

```ts
    let sv = s.solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
    if (s.playerPolity >= 0 && o === s.playerPolity) sv += STANCE_SOL_DELTA[s.stance]; // gated stance nudge
```

In `stepSim`, the contest — after computing `attack`/`defend` (Task 1 gave the two lines) and before
`if (attack > defend * CONTEST_THRESH)`, insert the gated stance multipliers:

```ts
    let atk = attack, def = defend;
    if (s.playerPolity >= 0) {
      if (best === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];   // player attacking
      if (o === s.playerPolity) def *= STANCE_DEF_MULT[s.stance];       // player defending
    }
    if (atk > def * CONTEST_THRESH) nextOwner[c] = best;
```

(Delete the old `if (attack > defend * CONTEST_THRESH) nextOwner[c] = best;` line — replaced above.)

- [ ] **Step 4: Run tests + golden guard**

Run: `npx vitest run src/engine/historySim.test.ts src/engine/history.test.ts`
Expected: PASS — the new player/stance tests pass; the golden history test is still byte-identical
(all hooks gated on `playerPolity >= 0`, which the pure path never sets).

- [ ] **Step 5: Commit**

```bash
git add src/engine/historySim.ts src/engine/historySim.test.ts
git commit -m "feat(history): player identity + gated stance hooks (default byte-identical)"
```

---

### Task 3: `intervention.ts` — the attack action + `borderTargets`

**Files:**
- Create: `src/engine/intervention.ts`
- Test: `src/engine/intervention.test.ts`

**Interfaces:**
- Consumes: `SimState`, `aggregate`, `contestStrength`, `CONQUEST_SOL` (Tasks 1-2).
- Produces:
  - `export type Action = { type: "attack"; cell: number }`
  - `export interface InterventionResult { ok: boolean; message: string }`
  - `export interface BorderTarget { cell: number; owner: number; ownerName: string; capturable: boolean }`
  - `export function borderTargets(s: SimState): BorderTarget[]`
  - `export function applyIntervention(s: SimState, action: Action): InterventionResult`
  - `export const ATTACK_EDGE = 1.0`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/intervention.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, CONQUEST_SOL } from "./historySim";
import { borderTargets, applyIntervention } from "./intervention";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
function playerState(seed: number) {
  const { world } = generateWorld({ ...small, seed });
  const s = initSim(world, seed);
  s.playerPolity = s.owner.find((o) => o >= 0)!; // the first owned polity
  return s;
}

describe("borderTargets", () => {
  it("lists only enemy land cells adjacent to the player, none owned by the player", () => {
    const s = playerState(1);
    const ts = borderTargets(s);
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) {
      expect(s.owner[t.cell]).not.toBe(s.playerPolity);
      expect(s.owner[t.cell]).toBeGreaterThanOrEqual(0);
      const adj = s.grid.neighbors[t.cell].some((nb) => s.owner[nb] === s.playerPolity);
      expect(adj).toBe(true);
    }
  });
});

describe("applyIntervention attack", () => {
  it("captures a border cell when the player's edge wins, flips owner + resets solidarity", () => {
    const s = playerState(1);
    // make the player overwhelming so at least one target is capturable
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
    const target = borderTargets(s).find((t) => t.capturable)!;
    expect(target).toBeTruthy();
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(true);
    expect(s.owner[target.cell]).toBe(s.playerPolity);
    expect(s.solidarity[target.cell]).toBeCloseTo(CONQUEST_SOL, 6);
  });

  it("repulses when the defender is stronger (owner unchanged)", () => {
    const s = playerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0; // weak player
    const target = borderTargets(s)[0];
    const before = s.owner[target.cell];
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(false);
    expect(s.owner[target.cell]).toBe(before);
  });

  it("rejects a non-border or own cell", () => {
    const s = playerState(1);
    const own = s.owner.findIndex((o) => o === s.playerPolity);
    expect(applyIntervention(s, { type: "attack", cell: own }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/intervention.test.ts`
Expected: FAIL — `src/engine/intervention.ts` does not exist.

- [ ] **Step 3: Implement `intervention.ts`**

```ts
import { OCEAN } from "./terrain";
import type { SimState } from "./historySim";
import { aggregate, contestStrength, CONQUEST_SOL } from "./historySim";

export type Action = { type: "attack"; cell: number };
export interface InterventionResult { ok: boolean; message: string }
export interface BorderTarget { cell: number; owner: number; ownerName: string; capturable: boolean }

export const ATTACK_EDGE = 1.0; // even fight goes to the player (their edge is picking the cell)

// the player-owned neighbour of `cell` with the highest solidarity — the strongest launching point,
// or -1 if `cell` is not adjacent to the player.
function launchCell(s: SimState, cell: number): number {
  let best = -1, bestSol = -Infinity;
  for (const nb of s.grid.neighbors[cell]) {
    if (s.owner[nb] === s.playerPolity && s.solidarity[nb] > bestSol) { bestSol = s.solidarity[nb]; best = nb; }
  }
  return best;
}

// enemy land cells adjacent to the player's territory (the attack list)
export function borderTargets(s: SimState): BorderTarget[] {
  if (s.playerPolity < 0) return [];
  const agg = aggregate(s);
  const seen = new Set<number>();
  const out: BorderTarget[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    for (const nb of s.grid.neighbors[c]) {
      if (s.terrain[nb] === OCEAN) continue;
      const o = s.owner[nb];
      if (o < 0 || o === s.playerPolity || seen.has(nb)) continue;
      seen.add(nb);
      const solCell = c; // c is a player neighbour of nb by construction
      const atk = contestStrength(s, agg, s.playerPolity, nb, solCell);
      const def = contestStrength(s, agg, o, nb, nb);
      out.push({ cell: nb, owner: o, ownerName: s.polities[o].name, capturable: atk * ATTACK_EDGE >= def });
    }
  }
  return out;
}

export function applyIntervention(s: SimState, action: Action): InterventionResult {
  if (action.type === "attack") {
    const target = action.cell;
    const def = s.owner[target];
    if (def < 0 || def === s.playerPolity) return { ok: false, message: "Not an enemy cell." };
    const solCell = launchCell(s, target);
    if (solCell < 0) return { ok: false, message: "Not on your border." };
    const agg = aggregate(s);
    const atkStr = contestStrength(s, agg, s.playerPolity, target, solCell);
    const defStr = contestStrength(s, agg, def, target, target);
    if (atkStr * ATTACK_EDGE >= defStr) {
      s.owner[target] = s.playerPolity;
      s.solidarity[target] = CONQUEST_SOL;
      return { ok: true, message: `Captured a cell from ${s.polities[def].name}.` };
    }
    return { ok: false, message: `Attack on ${s.polities[def].name} was repulsed.` };
  }
  return { ok: false, message: "Unknown action." };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/engine/intervention.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/engine/intervention.ts src/engine/intervention.test.ts
git commit -m "feat(intervention): attack action + border targets (shared contest math)"
```

---

### Task 4: `playSim.ts` — turn orchestration + defeat + scorecard

**Files:**
- Create: `src/engine/playSim.ts`
- Test: `src/engine/playSim.test.ts`

**Interfaces:**
- Consumes: `initSim`, `stepSim`, `SimState`, `Stance`, `TICKS`, `YEARS_PER_TICK`, `aggregate`;
  `Action`, `applyIntervention` (Task 3).
- Produces:
  - `export interface TurnResult { year: number; defeated: boolean; finished: boolean; events: HistoryEvent[]; message: string }`
  - `export interface Scorecard { cells: number; peakCells: number; rank: number; nations: number; survivedYears: number; alive: boolean }`
  - `export function initPlaySim(world: World, seed: number, playerPolity: number, stance: Stance): SimState`
  - `export function setStance(s: SimState, stance: Stance): void`
  - `export function playTurn(s: SimState, action: Action | null): TurnResult`
  - `export function playerCells(s: SimState): number`
  - `export function scorecard(s: SimState): Scorecard`

Note: a nation's own civil war keeps its capital with the original polity (verified in `stepSim`),
so the player is only ever defeated by CONQUEST of its seat — `defeated = !s.alive[playerPolity]`.
No playerPolity reassignment is needed.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/playSim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim, playTurn, playerCells, scorecard, setStance } from "./playSim";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

describe("playSim", () => {
  it("initPlaySim sets the player fields and seeds peakCells", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    expect(s.playerPolity).toBe(0);
    expect(s.stance).toBe("internal");
    expect(s.peakCells).toBe(playerCells(s));
    expect(s.peakCells).toBeGreaterThan(0);
  });

  it("playTurn with no action advances one tick (10 years) and reports the year", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const r = playTurn(s, null);
    expect(r.year).toBe(10);
    expect(r.defeated).toBe(false);
    expect(s.tick).toBe(1);
  });

  it("reports defeat when the player's capital is conquered", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    // force an enemy onto the player's capital cell, then step → conquest eliminates polity 0
    const cap = s.capitals[0];
    const enemy = s.polities.findIndex((_, i) => i !== 0);
    for (const nb of s.grid.neighbors[cap]) s.owner[nb] = enemy;
    s.owner[cap] = enemy;                 // seat already lost
    const r = playTurn(s, null);
    expect(r.defeated).toBe(true);
  });

  it("setStance changes the stance for free", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    setStance(s, "aggressive");
    expect(s.stance).toBe("aggressive");
  });

  it("scorecard ranks the player among living nations", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const sc = scorecard(s);
    expect(sc.cells).toBeGreaterThan(0);
    expect(sc.rank).toBeGreaterThanOrEqual(1);
    expect(sc.rank).toBeLessThanOrEqual(sc.nations);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/playSim.test.ts`
Expected: FAIL — `src/engine/playSim.ts` does not exist.

- [ ] **Step 3: Implement `playSim.ts`**

```ts
import type { World } from "../types/world";
import { initSim, stepSim, aggregate, TICKS, YEARS_PER_TICK, type SimState, type Stance, type HistoryEvent } from "./historySim";
import { applyIntervention, type Action } from "./intervention";

export interface TurnResult { year: number; defeated: boolean; finished: boolean; events: HistoryEvent[]; message: string }
export interface Scorecard { cells: number; peakCells: number; rank: number; nations: number; survivedYears: number; alive: boolean }

export function playerCells(s: SimState): number {
  let n = 0;
  for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) n++;
  return n;
}

export function initPlaySim(world: World, seed: number, playerPolity: number, stance: Stance): SimState {
  const s = initSim(world, seed);
  s.playerPolity = playerPolity;
  s.stance = stance;
  s.peakCells = playerCells(s);
  return s;
}

export function setStance(s: SimState, stance: Stance): void {
  s.stance = stance; // free lever, separate from the one action/turn
}

export function playTurn(s: SimState, action: Action | null): TurnResult {
  let message = "";
  if (action) message = applyIntervention(s, action).message;
  const before = s.events.length;
  stepSim(s);
  const cells = playerCells(s);
  if (cells > s.peakCells) s.peakCells = cells;
  const defeated = !s.alive[s.playerPolity];
  return {
    year: s.tick * YEARS_PER_TICK,
    defeated,
    finished: defeated || s.tick >= TICKS,
    events: s.events.slice(before),
    message,
  };
}

export function scorecard(s: SimState): Scorecard {
  const agg = aggregate(s);
  const mine = agg[s.playerPolity]?.cells ?? 0;
  let rank = 1, nations = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (!s.alive[o]) continue;
    nations++;
    if (agg[o].cells > mine) rank++;
  }
  return { cells: mine, peakCells: s.peakCells, rank, nations, survivedYears: s.tick * YEARS_PER_TICK, alive: s.alive[s.playerPolity] };
}
```

- [ ] **Step 4: Run tests + full engine suite (golden guard)**

Run: `npx vitest run src/engine/playSim.test.ts src/engine/history.test.ts`
Expected: PASS — playSim behaves, golden history unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/engine/playSim.ts src/engine/playSim.test.ts
git commit -m "feat(playSim): turn loop, defeat detection, scorecard"
```

---

### Task 5: Play UI — nation picker + play screen (`play.html` + `playMain.ts`)

Replace the stub with a list-driven prototype. Reuse `renderWorld(world,"political",…)` + a live
`politicalLayer` swap (the pattern in `src/ui/app.ts`). Targeting is a dropdown of `borderTargets`.

**Files:**
- Modify: `src/playMain.ts` (replace the stub with the play app)
- Create: `src/ui/playApp.ts` (the play screen builder — keeps `playMain.ts` a thin entry)
- Modify: `play.html` (ensure a `#play` root exists — it already does per the stub)
- Test: `src/ui/playApp.test.ts` (jsdom smoke)

**Interfaces:**
- Consumes: `initPlaySim`, `playTurn`, `setStance`, `scorecard`, `playerCells` (Task 4);
  `borderTargets`, `type Action` (Task 3); `renderWorld`, `politicalOpts` (`./svgWorldRenderer`);
  `politicalLayer` (`./politicalLayer`); `generateWorld` (`../engine/world`); `randomSeed`
  (`./urlState`); `aggregate` (`../engine/historySim`).
- Produces: `export function createPlayApp(root: HTMLElement, seed: number): void`

- [ ] **Step 1: Write the failing smoke test**

Create `src/ui/playApp.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createPlayApp } from "./playApp";

describe("playApp", () => {
  it("shows a nation picker, then mounts the play screen on selection", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const choices = root.querySelectorAll(".nation-choice");
    expect(choices.length).toBeGreaterThan(0);
    (choices[0] as HTMLButtonElement).click();
    expect(root.querySelector("svg.world")).not.toBeNull();     // live map
    expect(root.querySelector(".play-panel")).not.toBeNull();   // nation panel
    expect(root.querySelector(".btn-attack")).not.toBeNull();   // attack action
    expect(root.querySelector(".btn-advance")).not.toBeNull();  // advance year
  });

  it("advancing a year updates the year readout", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const yearBefore = root.querySelector(".play-year")!.textContent;
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".play-year")!.textContent).not.toBe(yearBefore);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — `./playApp` does not exist.

- [ ] **Step 3: Implement `src/ui/playApp.ts`**

```ts
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { aggregate } from "../engine/historySim";
import { initPlaySim, playTurn, setStance, scorecard, playerCells } from "../engine/playSim";
import type { Stance } from "../engine/historySim";
import { borderTargets, type Action } from "../engine/intervention";
import { renderWorld, politicalOpts } from "./svgWorldRenderer";
import { politicalLayer } from "./politicalLayer";

const STANCES: Stance[] = ["aggressive", "defensive", "internal"];
const LOW_COHESION = 0.4; // civil-war risk cue threshold

export function createPlayApp(root: HTMLElement, seed: number): void {
  root.innerHTML = "";
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });

  // --- nation picker ---
  const picker = document.createElement("div");
  picker.className = "landing";
  const title = document.createElement("h1");
  title.className = "app-title";
  title.textContent = "Choose your realm";
  root.append(title, picker);

  const agg0 = (() => {
    const s = initPlaySim(world, seed, 0, "internal");
    return aggregate(s);
  })();
  world.polities
    .map((p) => ({ p, cells: agg0[p.id]?.cells ?? 0 }))
    .sort((a, b) => b.cells - a.cells)
    .forEach(({ p, cells }) => {
      const b = document.createElement("button");
      b.className = "nation-choice choice-card";
      b.innerHTML = `<span class="choice-title" style="color:${p.color}">${p.name}</span><span class="choice-sub">${cells} cells</span>`;
      b.addEventListener("click", () => startGame(p.id));
      picker.appendChild(b);
    });

  function startGame(playerPolity: number): void {
    root.innerHTML = "";
    const s = initPlaySim(world, seed, playerPolity, "internal");
    let pendingAction: Action | null = null;

    const stage = document.createElement("div");
    stage.className = "stage";
    const panel = document.createElement("div");
    panel.className = "play-panel controls";
    const actions = document.createElement("div");
    actions.className = "play-actions controls";
    const log = document.createElement("div");
    log.className = "chronicle";
    root.append(panel, stage, actions, log);

    const mapFrame = document.createElement("div");
    mapFrame.className = "map-frame";
    stage.appendChild(mapFrame);

    function renderMap(): void {
      mapFrame.innerHTML = "";
      const svg = renderWorld(world, "political", s.economicZones.map((z) => z.cell), "en");
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, politicalOpts("political")));
      mapFrame.appendChild(svg);
    }

    function renderPanel(): void {
      const cells = playerCells(s);
      const agg = aggregate(s);
      const avg = agg[s.playerPolity]?.avg ?? 0;
      const threats = borderTargets(s).length;
      const risk = avg < LOW_COHESION ? ` · ⚠ civil-war risk (cohesion ${(avg * 100) | 0}%)` : "";
      panel.innerHTML =
        `<b class="play-year">Year ${s.tick * 10}</b> · ${s.polities[s.playerPolity].name}` +
        ` · ${cells} cells · cohesion ${(avg * 100) | 0}%${risk} · threats ${threats}`;
      const stanceRow = document.createElement("span");
      stanceRow.className = "view-toggle";
      for (const st of STANCES) {
        const btn = document.createElement("button");
        btn.textContent = st;
        btn.className = s.stance === st ? "active" : "";
        btn.addEventListener("click", () => { setStance(s, st); renderAll(); });
        stanceRow.appendChild(btn);
      }
      panel.appendChild(stanceRow);
    }

    function renderActions(): void {
      actions.innerHTML = "";
      const attackBtn = document.createElement("button");
      attackBtn.className = "btn-attack";
      attackBtn.textContent = pendingAction ? "Attack: chosen ✓" : "Attack…";
      const sel = document.createElement("select");
      sel.className = "attack-select";
      const none = document.createElement("option");
      none.value = ""; none.textContent = "— pick a border cell —";
      sel.appendChild(none);
      for (const t of borderTargets(s)) {
        const opt = document.createElement("option");
        opt.value = String(t.cell);
        opt.textContent = `${t.ownerName} (cell ${t.cell})${t.capturable ? " ✓" : " ✗"}`;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        pendingAction = sel.value ? { type: "attack", cell: Number(sel.value) } : null;
        attackBtn.textContent = pendingAction ? "Attack: chosen ✓" : "Attack…";
      });
      const advance = document.createElement("button");
      advance.className = "btn-advance";
      advance.textContent = "Advance year ▶";
      advance.addEventListener("click", () => {
        const r = playTurn(s, pendingAction);
        pendingAction = null;
        if (r.message) appendLog(`— ${r.message}`);
        for (const e of r.events) appendLog(e.text);
        if (r.finished) return end(r.defeated);
        renderAll();
      });
      actions.append(attackBtn, sel, advance);
    }

    function appendLog(text: string): void {
      const row = document.createElement("div");
      row.className = "chronicle-event";
      row.textContent = text;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    function renderAll(): void { renderMap(); renderPanel(); renderActions(); }

    function end(defeated: boolean): void {
      const sc = scorecard(s);
      actions.innerHTML = "";
      renderPanel();
      const banner = document.createElement("div");
      banner.className = "stub";
      banner.innerHTML = defeated
        ? `<h2>Your realm fell in ${sc.survivedYears} years.</h2>`
        : `<h2>You endured 500 years.</h2>`;
      banner.innerHTML += `<p>Peak ${sc.peakCells} cells · final ${sc.cells} cells · rank ${sc.rank} of ${sc.nations}.</p>`;
      root.insertBefore(banner, log);
    }

    renderAll();
    appendLog(`Year 0 — you rule ${s.polities[playerPolity].name}.`);
  }
}
```

- [ ] **Step 4: Wire `playMain.ts` to the play app**

Replace the contents of `src/playMain.ts` with:

```ts
import "./theme.css";
import { createPlayApp } from "./ui/playApp";
import { randomSeed } from "./ui/urlState";

const root = document.getElementById("play");
if (root) {
  const hashSeed = Number(new URLSearchParams(location.hash.slice(1)).get("seed"));
  const seed = Number.isFinite(hashSeed) && hashSeed > 0 ? hashSeed : randomSeed();
  createPlayApp(root, seed);
}
```

Confirm `play.html` has `<div id="play"></div>` and loads `src/playMain.ts` (it does per the stub —
do not change its structure beyond keeping the `#play` root).

- [ ] **Step 5: Run the smoke test + build**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS (picker → play screen, advance updates the year).

Run: `npm run build`
Expected: build succeeds (play.html entry compiles with the new imports).

- [ ] **Step 6: Commit**

```bash
git add src/playMain.ts src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): nation picker + play-screen prototype (stance + attack)"
```

---

### Task 6: Full-suite check + live prototype for the feel gate

**Files:** none (verification).

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — all prior tests + the new ones; the golden `history.test.ts` unchanged.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: emits `dist/play.html` + assets, no errors.

- [ ] **Step 3: Manual play (the Phase-1 gate)**

Start the dev server, open `play.html`, pick a nation, and play several decades: change stance,
attack border cells, watch the log + map. Confirm the loop runs end-to-end (defeat when the seat
falls; scorecard at year 500). This is the **feel gate**: report to the user whether nudging the sim
feels meaningful before starting Phase 2 (invest / found city / peace + richer observability).

---

## Notes carried into Phase 2 (not built here)

- `truces: Map` + `foundedCities: Set` fields, the `invest` / `foundCity` / `peace` actions, and
  their enumerators.
- Reconsider free per-turn stance flipping (add inertia if it reads as degenerate).
- Richer observability (per-region cohesion, overextension, civil-war risk cues beyond the nation
  average) if the prototype feels blind.
- Constant sweep for stance multipliers / `ATTACK_EDGE` once the feel is known.
