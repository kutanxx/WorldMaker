# Province Sim P2 SP2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal, actually-playable province game (`playProvince.html`): pick a nation on the province map, attack whole adjacent provinces from every front, advance while AI nations evolve via the SP1 engine, and win by domination or survival (lose by capital capture). A new, isolated app; Version A and the cell game are untouched.

**Architecture:** A thin **player wrapper** (`stepPlayerTurn`) added to the SP1 `provinceSim.ts` (same pattern as the cell game's `playSim` wrapping `historySim`) — rng-free, additive. A new isolated UI (`src/ui/provinceApp.ts` + `provinceMain.ts` + `playProvince.html` + a third landing card) renders the province map by feeding a **province-snapped per-cell owner** array to the existing `politicalLayer` (owner-colored whole-province fills), with a transparent per-province overlay for click-targeting.

**Tech Stack:** TypeScript, vitest (node env for the engine, jsdom for UI), Vite. No new dependencies.

## Global Constraints

- **Fork / safety:** the engine wrapper imports NOTHING from `historySim`, `playSim`, `intervention`, or `src/ui/*`; it only reads `ProvinceSimState` (and never mutates `world`). Do NOT edit `historySim`/`playSim`/`playApp.ts`/`play.html` or anything Version A uses. Version A's seed-1 `polityOf` golden FNV `1350115163` stays byte-identical, and the SP1 province goldens (`initProvinceSim` provOwner `226648593`) stay unchanged.
- **Rng-free:** SP2 uses NO `Math.random` and NO rng stream. A fixed seed + fixed player target sequence evolves identically every run.
- **Read-only province objects:** `ProvinceSimState.provinces` aliases `world.provinces` — render FROM province objects, never write back into them.
- **`noUnusedLocals` / `noUnusedParameters` are on** — no unused imports/params (prefix intentionally-unused with `_`).
- **Placeholder constants (SP3 retunes; do not invent other values):** reuse SP1's engine constants unchanged; new UI constant `DOMINATION_MULT = 3`; horizon = `PROVINCE_SIM_TICKS` (50, already exported by SP1).
- **Relative entry paths:** the landing card and any nav use `playProvince.html` (relative — GitHub Pages sub-path safe), never a leading `/`.
- Run vitest from the worktree root: `C:/projects/WorldMaker/.claude/worktrees/game-ui-benchmarking-1d8868`.
- FNV-1a convention for golden hashes (provOwner has -1 entries, so offset by +1): `let h = 2166136261 >>> 0; for (let i=0;i<arr.length;i++){ h ^= (arr[i]+1)>>>0; h = Math.imul(h,16777619)>>>0; } return h>>>0;`.

## File Structure

- Modify `src/engine/provinceSim.ts` — add `PlayerStepEvents`, `armableTargets`, `stepPlayerTurn` (Tasks 1–2). Pure, rng-free.
- Modify `src/engine/provinceSim.test.ts` — engine player tests + determinism golden + Version-A safety (Tasks 1–2).
- Create `src/ui/provinceApp.ts` — the game UI (`mountProvinceApp`) (Tasks 3–6).
- Create `src/ui/provinceApp.test.ts` — UI tests (Tasks 3–6, jsdom).
- Create `src/ui/provinceMain.ts` — DOM entry that mounts the app (Task 3).
- Create `playProvince.html` — HTML entry (Task 3).
- Modify `src/landing.ts` + `src/landing.test.ts` — third choice card (Task 3).
- Modify `vite.config.ts` — register `playProvince.html` as a build entry (Task 3).

---

### Task 1: Engine — `armableTargets` + `stepPlayerTurn` + events

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `ProvinceSimState`, `PAgg`, `pAggregate`, `strength` (internal), constants `SOL_RISE`, `SOL_DECAY`, `CONQUEST_SOL`, `CONTEST_THRESH` — all already in `provinceSim.ts`.
- Produces:
  - `interface PlayerStepEvents { conquests: { prov: number; from: number; to: number }[]; eliminated: number[] }`
  - `armableTargets(s: ProvinceSimState, playerId: number): number[]` — sorted list of provinces the player may attack this turn: not player-owned, and adjacent to at least one player-owned province (enemy alive, enemy eliminated, or unowned all qualify).
  - `stepPlayerTurn(s: ProvinceSimState, playerId: number, targets: ReadonlySet<number>): PlayerStepEvents` — one player turn (solidarity step; contest where the player attacks its explicit targets and AI nations auto-contest with the player excluded from auto-initiation; `alive` recompute; `tick++`). Returns the turn's conquests + eliminations.
- Refactor (same file): extract the solidarity update and the contest/conquest passes that SP1's `stepProvinceSim` inlines into shared private helpers (`stepSolidarity`, `contestPass`, `aiAttacker`, `recomputeAlive`), so `stepProvinceSim` and `stepPlayerTurn` share one implementation instead of duplicating the logic block. This is **behavior-preserving** — SP1's golden tests (`initProvinceSim` provOwner `226648593`, 50-tick `3566824384`) are the guard and must stay green.

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/provinceSim.test.ts`:

```ts
import { armableTargets, stepPlayerTurn } from "./provinceSim";

describe("armableTargets", () => {
  // line: A(0) owns prov 0 (capital) & 1; B(1) owns prov 2 (capital); prov 3 unowned; adj 1-2, 2-3.
  function line(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2, 3].map((i) => ({ id: i, name: String(i), cells: 10, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 4, provOwner: Int32Array.from([0, 0, 1, -1]), provSol: Float32Array.from([0.5, 0.5, 0.5, 0]),
      adj: [[1], [0, 2], [1, 3], [2]], capitalProv: Int32Array.from([0, 2]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("lists adjacent non-player provinces (enemy) but not the player's own or non-adjacent ones", () => {
    // player = A(0); prov 1 borders enemy prov 2 → armable is [2]; prov 3 (unowned) is not adjacent to A.
    expect(armableTargets(line(), 0)).toEqual([2]);
  });
  it("includes an adjacent unowned province", () => {
    // player = B(1); B's prov 2 borders A's prov 1 AND unowned prov 3 → [1, 3]
    expect(armableTargets(line(), 1)).toEqual([1, 3]);
  });
});

describe("stepPlayerTurn", () => {
  // A(0) is big/cohesive (prov 0 capital + prov 1), B(1) holds a lone weak capital prov 2. adj 1-2.
  function fixture(): ProvinceSimState {
    const provinces: Province[] = [0, 1, 2].map((i) => ({ id: i, name: String(i), cells: 20, centroid: [i * 10, 0], seedCell: i, biome: 4 }));
    return {
      provinces, n: 3, provOwner: Int32Array.from([0, 0, 1]), provSol: Float32Array.from([0.9, 0.9, 0.1]),
      adj: [[1], [0, 2], [1]], capitalProv: Int32Array.from([0, 2]), alive: [true, true], tick: 0,
    } as ProvinceSimState;
  }
  it("conquers a targeted weak enemy province for the player and returns the event", () => {
    const s = fixture();
    const ev = stepPlayerTurn(s, 0, new Set([2]));
    expect(s.provOwner[2]).toBe(0);
    expect(s.provSol[2]).toBeCloseTo(0.7, 5); // CONQUEST_SOL
    expect(ev.conquests).toEqual([{ prov: 2, from: 1, to: 0 }]);
    expect(ev.eliminated).toEqual([1]); // B lost its capital province
    expect(s.tick).toBe(1);
  });
  it("does NOT take a beatable enemy province the player did not target (player never auto-initiates)", () => {
    const s = fixture();
    stepPlayerTurn(s, 0, new Set()); // no targets
    expect(s.provOwner[2]).toBe(1); // prov 2 stays B's — player didn't attack, and B isn't attacking itself
    expect(s.alive[1]).toBe(true);
  });
  it("lets an AI nation capture the player's province (player is a valid defender)", () => {
    // swap roles: player = B(1) with the weak lone capital; A(0) is the AI aggressor.
    const s = fixture();
    stepPlayerTurn(s, 1, new Set()); // player B does nothing; AI A auto-contests prov 2
    expect(s.provOwner[2]).toBe(0); // A took the player's capital province
    expect(s.alive[1]).toBe(false); // player B defeated
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: FAIL — `armableTargets`/`stepPlayerTurn` are not exported.

- [ ] **Step 3: Implement**

First, extract SP1's inlined step logic into shared private helpers. In `src/engine/provinceSim.ts`, add these **above** `stepProvinceSim` (they use the module's existing `SOL_RISE`, `SOL_DECAY`, `CONQUEST_SOL`, `CONTEST_THRESH`, `pAggregate`, `strength`):

```ts
// double-buffered solidarity update: frontier provinces (adjacent to a different owner) rise, interior decay,
// clamp [0,1]. (Extracted from stepProvinceSim so the player step shares it — behaviour unchanged.)
function stepSolidarity(s: ProvinceSimState): void {
  const { n, provOwner, adj } = s;
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
}

type AttackerPick = { attacker: number; frontProv: number } | null;

// double-buffered contest: for each province p (owner o) an attacker is chosen by `pick(p, o, agg)`; if
// atk > def·CONTEST_THRESH the whole province flips. Reads pre-turn ownership + stepped solidarity, writes a
// fresh owner buffer, then resets conquered provinces to CONQUEST_SOL. Returns the conquered province ids.
function contestPass(s: ProvinceSimState, pick: (p: number, o: number, agg: PAgg[]) => AttackerPick): number[] {
  const agg = pAggregate(s);
  const nextOwner = s.provOwner.slice();
  const conquered: number[] = [];
  for (let p = 0; p < s.n; p++) {
    const o = s.provOwner[p];
    const chosen = pick(p, o, agg);
    if (!chosen) continue;
    const atk = strength(s, agg, chosen.attacker, p, chosen.frontProv);
    const def = o < 0 ? 0 : strength(s, agg, o, p, p);
    if (atk > def * CONTEST_THRESH) { nextOwner[p] = chosen.attacker; conquered.push(p); }
  }
  s.provOwner = nextOwner;
  for (const p of conquered) s.provSol[p] = CONQUEST_SOL;
  return conquered;
}

function recomputeAlive(s: ProvinceSimState): void {
  for (let id = 0; id < s.alive.length; id++) {
    s.alive[id] = s.capitalProv[id] >= 0 && s.provOwner[s.capitalProv[id]] === id;
  }
}

// attacker chooser: p's strongest LIVE adjacent enemy by agg.avg. `excludePlayer` (an id, or -1 for none) is
// never chosen as an aggressor — the player only attacks its explicit targets, never auto-initiates.
function aiAttacker(s: ProvinceSimState, excludePlayer: number) {
  return (p: number, o: number, agg: PAgg[]): AttackerPick => {
    let attacker = -1, frontProv = -1, bestAvg = -Infinity;
    for (const q of s.adj[p]) {
      const po = s.provOwner[q];
      if (po < 0 || po === o || po === excludePlayer || !s.alive[po]) continue;
      if (agg[po].avg > bestAvg) { bestAvg = agg[po].avg; attacker = po; frontProv = q; }
    }
    return attacker < 0 ? null : { attacker, frontProv };
  };
}
```

Then **replace** SP1's `stepProvinceSim` body with the helper-based version (behaviour identical — golden-guarded):

```ts
export function stepProvinceSim(s: ProvinceSimState): void {
  stepSolidarity(s);
  contestPass(s, aiAttacker(s, -1)); // -1 = no player; every nation may auto-initiate
  recomputeAlive(s);
  s.tick++;
}
```

Then add the player API (after `stepProvinceSim`):

```ts
export interface PlayerStepEvents {
  conquests: { prov: number; from: number; to: number }[];
  eliminated: number[];
}

// provinces the player may attack this turn: not player-owned, and adjacent to some player-owned province.
// Enemy (alive or already-eliminated) and unowned wilderness all qualify — so no land is stranded.
export function armableTargets(s: ProvinceSimState, playerId: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < s.n; p++) {
    if (s.provOwner[p] === playerId) continue;
    let borders = false;
    for (const q of s.adj[p]) if (s.provOwner[q] === playerId) { borders = true; break; }
    if (borders) out.push(p);
  }
  return out;
}

// one player turn: rng-free. Solidarity step, then a single double-buffered contest where the player attacks
// its explicit `targets` (from its highest-solidarity adjacent front province) and every OTHER province is
// auto-contested by its strongest live non-player enemy. Then alive-recompute + tick++. Returns the events.
export function stepPlayerTurn(
  s: ProvinceSimState, playerId: number, targets: ReadonlySet<number>,
): PlayerStepEvents {
  const prevOwner = s.provOwner.slice();
  const prevAlive = s.alive.slice();
  stepSolidarity(s);
  const ai = aiAttacker(s, playerId); // AI excludes the player from auto-initiating
  const conquered = contestPass(s, (p, o, agg) => {
    if (o !== playerId && targets.has(p)) {
      let bestSol = -Infinity, bestFront = -1;
      for (const q of s.adj[p]) {
        if (s.provOwner[q] !== playerId) continue;
        const sv = s.provSol[q];
        if (sv > bestSol || (sv === bestSol && (bestFront < 0 || q < bestFront))) { bestSol = sv; bestFront = q; }
      }
      if (bestFront >= 0) return { attacker: playerId, frontProv: bestFront };
    }
    return ai(p, o, agg);
  });
  recomputeAlive(s);
  s.tick++;
  const conquests = conquered.map((p) => ({ prov: p, from: prevOwner[p], to: s.provOwner[p] }));
  const eliminated: number[] = [];
  for (let id = 0; id < s.alive.length; id++) if (prevAlive[id] && !s.alive[id]) eliminated.push(id);
  return { conquests, eliminated };
}
```

> The SP1 `stepProvinceSim` unit tests AND its determinism goldens (`226648593` / `3566824384`) must stay green
> after the refactor — run them in Step 4. If a golden moves, the refactor changed behaviour: STOP and fix the
> refactor (do not re-pin the golden).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS (all new cases + all earlier tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(engine): player turn step + armable targets (P2 SP2)"
```

---

### Task 2: Engine — determinism golden + Version-A safety for the player path

**Files:**
- Modify: `src/engine/provinceSim.test.ts`

**Interfaces:** Consumes `initProvinceSim`, `armableTargets`, `stepPlayerTurn`, `PROVINCE_SIM_TICKS`. No new production code — pins determinism of the player path and proves the fork stays isolated.

- [ ] **Step 1: Write the failing test (golden as placeholder to fill from the first run)**

Add to `src/engine/provinceSim.test.ts` (the `fnv` helper already exists in this file from SP1 Task 6 — reuse it; do not redefine):

```ts
describe("stepPlayerTurn determinism + safety (seed 1)", () => {
  // a fixed, deterministic policy: each turn the player (nation 0) attacks EVERY armable province.
  function runPlayerGame() {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initProvinceSim(world);
    const playerId = 0;
    for (let t = 0; t < PROVINCE_SIM_TICKS && s.alive[playerId]; t++) {
      stepPlayerTurn(s, playerId, new Set(armableTargets(s, playerId)));
    }
    return s;
  }
  it("pins the seed-1 player-path golden hash — deterministic, rng-free", () => {
    const a = runPlayerGame(), b = runPlayerGame();
    expect(fnv(a.provOwner)).toBe(fnv(b.provOwner)); // two runs identical (determinism)
    expect(fnv(a.provOwner)).toBe(0); // PLACEHOLDER — replace with the actual value printed on first run
  });
  it("does not perturb Version A's world-gen golden hash (fork is isolated)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
  });
});
```

- [ ] **Step 2: Run to capture the golden value**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: the determinism equality PASSES, the PLACEHOLDER `toBe(0)` FAILS printing `expected <actual> to be 0`. Note the actual `provOwner` hash. The Version-A case must PASS.
If the two-run determinism equality fails, STOP and report — it means an rng/ordering leak, not a value to paper over.

- [ ] **Step 3: Pin the captured value**

Replace the `toBe(0)` placeholder with the actual hash printed in Step 2.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engine/provinceSim.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite**

Run: `npx vitest run` — Expected: all pass, including `world.test` (Version A golden hashes unchanged) and SP1's province goldens.

- [ ] **Step 6: Commit**

```bash
git add src/engine/provinceSim.test.ts
git commit -m "test(engine): pin player-path golden + Version-A safety (P2 SP2)"
```

---

### Task 3: UI — app scaffold, province owner-map render, landing card

**Files:**
- Create: `src/ui/provinceApp.ts`, `src/ui/provinceMain.ts`, `playProvince.html`
- Create: `src/ui/provinceApp.test.ts`
- Modify: `src/landing.ts`, `src/landing.test.ts`, `vite.config.ts`

**Interfaces:**
- Consumes: `generateWorld` (`../engine/world`), `DEFAULT_PARAMS` (`../types/world`), `initProvinceSim`/`ProvinceSimState` (`../engine/provinceSim`), `politicalLayer` (`./politicalLayer`), `PLAYER_COLOR` (`./nationPalette`), `svgEl` (`./renderer`), `detectLang` (`./lang`).
- Produces:
  - `provinceCellOwner(count: number, provinceOf: ArrayLike<number>, provOwner: Int32Array): Int32Array` (exported from `provinceApp.ts`) — per-cell owner = the owner of the cell's province (`-1` for ocean/unowned), so `politicalLayer` paints whole provinces in nation colors.
  - `mountProvinceApp(root: HTMLElement, opts?: { seed?: number }): void` — renders the game into `root`. Task 3 renders the province map (owner-colored) inside a framed `<svg>`; picker/turn/victory come in Tasks 4–6.

- [ ] **Step 1: Write the failing test**

Create `src/ui/provinceApp.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountProvinceApp, provinceCellOwner } from "./provinceApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim } from "../engine/provinceSim";

describe("provinceCellOwner", () => {
  it("maps each cell to its province's owner, ocean/unowned to -1", () => {
    const provinceOf = [0, 0, 1, -1];
    const provOwner = Int32Array.from([5, 2]); // prov 0 → nation 5, prov 1 → nation 2
    expect(Array.from(provinceCellOwner(4, provinceOf, provOwner))).toEqual([5, 5, 2, -1]);
  });
});

describe("mountProvinceApp (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("renders the province map: a framed svg with owner-colored polity paths and a nation border", () => {
    mountProvinceApp(root, { seed: 1 });
    const svg = root.querySelector("svg") as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 700"); // grid.width x grid.height (DEFAULT_PARAMS)
    // politicalLayer emits one path per owning polity, tagged data-polity
    expect(root.querySelectorAll("[data-polity]").length).toBeGreaterThan(0);
    // and the snapped nation border overlay is present
    expect(root.querySelector(".nation-border")).toBeTruthy();
  });

  it("does not mutate the world's province objects (read-only aliasing guard)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const before = world.provinces[0].cells;
    const s = initProvinceSim(world);
    provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner);
    expect(world.provinces[0].cells).toBe(before);
  });
});
```

Add to `src/landing.test.ts` (in the existing chooser-hrefs test, after the two existing `toContain` assertions):

```ts
    expect(hrefs).toContain("playProvince.html");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts src/landing.test.ts`
Expected: FAIL — `./provinceApp` not found; landing has no `playProvince.html` card.

- [ ] **Step 3: Implement**

Create `playProvince.html` (mirror `play.html`):

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WorldMaker — 영토</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="province-app"></div>
    <script type="module" src="/src/ui/provinceMain.ts"></script>
  </body>
</html>
```

Create `src/ui/provinceMain.ts`:

```ts
import "../theme.css";
import { mountProvinceApp } from "./provinceApp";

const root = document.getElementById("province-app");
if (root) mountProvinceApp(root);
```

Create `src/ui/provinceApp.ts`:

```ts
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim } from "../engine/provinceSim";
import { politicalLayer } from "./politicalLayer";
import { PLAYER_COLOR } from "./nationPalette";
import { svgEl } from "./renderer";
import { detectLang } from "./lang";

// per-cell owner = the owner of the cell's province (ocean/unowned → -1). Feeding this to politicalLayer
// paints whole provinces in their nation's colour (the EU4 whole-province model) and yields data-polity paths.
export function provinceCellOwner(count: number, provinceOf: ArrayLike<number>, provOwner: Int32Array): Int32Array {
  const out = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) { const p = provinceOf[c]; if (p >= 0) out[c] = provOwner[p]; }
  return out;
}

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? (Math.floor(Date.now() % 1_000_000)); // non-deterministic seed is fine — UI only
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  const s = initProvinceSim(world);

  root.innerHTML = "";
  const svg = svgEl("svg", {
    class: "prov-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`,
    preserveAspectRatio: "xMidYMid meet",
  }) as SVGSVGElement;
  svg.appendChild(politicalLayer(
    world.grid, provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner), world.polities,
    { fills: true, labels: true, legend: false, playerColor: PLAYER_COLOR },
  ));
  root.appendChild(svg);
  void lang; // (used by picker/HUD strings in Task 4)
}
```

> Note: `politicalLayer(grid, owner, polities, opts)` (see `src/ui/politicalLayer.ts`) already paints one
> `data-polity` path per owning polity and appends a `.nation-border` when it snaps owners; feeding it the
> province-snapped per-cell owner makes fills + borders fall on province edges. Do not rebuild coloring.

Modify `src/landing.ts` — add a third card inside the `.landing` div, immediately after the `play.html` card:

```html
      <a class="choice-card" href="playProvince.html">
        <div class="choice-icon">🗺️</div>
        <div class="choice-title">Play in Provinces</div>
        <p class="choice-desc">Rule a nation and conquer whole provinces on the map, EU4-style.</p>
        <div class="choice-sub">영토로 플레이</div>
      </a>
```

Modify `vite.config.ts` — add `playProvince.html` to the multi-page build inputs (dev server serves it either way, but the production build only bundles listed entries):

```ts
      input: {
        main: "index.html",
        map: "map.html",
        play: "play.html",
        playProvince: "playProvince.html",
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts src/landing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceMain.ts src/ui/provinceApp.test.ts playProvince.html src/landing.ts src/landing.test.ts vite.config.ts
git commit -m "feat(play): province game scaffold + owner-map render + landing card (P2 SP2)"
```

---

### Task 4: UI — picker (pick a nation) + HUD

**Files:**
- Modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: Task 3's `mountProvinceApp` render; `pAggregate` (`../engine/provinceSim`); `PROVINCE_SIM_TICKS` (`../engine/provinceSim`).
- Produces: after clicking a live nation's territory (a `[data-polity]` path), the app enters "playing" state for that `playerId`, records `startProvinces` (its province count), and renders a HUD (`.prov-hud`) with: player province count `/` total land provinces, average solidarity `%`, turn `0/50`, capital status, and live-rival count. The player nation is painted in `PLAYER_COLOR`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/provinceApp.test.ts`:

```ts
import { pAggregate } from "../engine/provinceSim";

describe("province picker → play (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("clicking a live nation's territory starts a game and shows the HUD", () => {
    mountProvinceApp(root, { seed: 1 });
    const path = root.querySelector("[data-polity]") as SVGPathElement;
    const pid = Number(path.getAttribute("data-polity"));
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const hud = root.querySelector(".prov-hud");
    expect(hud).toBeTruthy();
    expect(hud!.textContent).toMatch(/0\s*\/\s*50/); // turn 0 of 50
    // the started nation is painted with the player colour
    const playerPath = root.querySelector(`[data-polity="${pid}"]`) as SVGPathElement;
    expect(playerPath.getAttribute("fill")).toBe("#c0247a"); // PLAYER_COLOR (src/ui/nationPalette.ts:20)
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: FAIL — no `.prov-hud`, click does nothing.

- [ ] **Step 3: Implement**

In `src/ui/provinceApp.ts`, restructure `mountProvinceApp` to hold state and re-render. Replace the single render with a picker→play flow:

```ts
import { initProvinceSim, pAggregate, PROVINCE_SIM_TICKS, type ProvinceSimState } from "../engine/provinceSim";
// ...existing imports...

interface UI { world: ReturnType<typeof generateWorld>["world"]; s: ProvinceSimState; playerId: number; startProvinces: number; }

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000);
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  let ui: UI | null = null; // null = picker mode

  function playerProvinceCount(u: UI): number {
    let k = 0; for (let p = 0; p < u.s.n; p++) if (u.s.provOwner[p] === u.playerId) k++; return k;
  }
  function totalLandProvinces(u: UI): number { return u.s.n; }
  function liveRivals(u: UI): number { return u.s.alive.filter((a, id) => a && id !== u.playerId).length; }

  function buildMap(): SVGSVGElement {
    const s = ui ? ui.s : initProvinceSim(world); // picker previews the initial partition
    const svg = svgEl("svg", {
      class: "prov-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`, preserveAspectRatio: "xMidYMid meet",
    }) as SVGSVGElement;
    svg.appendChild(politicalLayer(
      world.grid, provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner), world.polities,
      { fills: true, labels: true, legend: false, ...(ui ? { playerPolity: ui.playerId, playerColor: PLAYER_COLOR } : {}) },
    ));
    return svg;
  }

  function startGame(playerId: number): void {
    const s = initProvinceSim(world);
    if (!s.alive[playerId]) return; // only live nations are playable
    const startProvinces = (() => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === playerId) k++; return k; })();
    ui = { world, s, playerId, startProvinces };
    render();
  }

  function hudText(u: UI): string {
    const avg = Math.round(pAggregate(u.s)[u.playerId].avg * 100);
    const capOk = u.s.alive[u.playerId];
    const t = { ko: { prov: "영토", sol: "안정도", turn: "턴", cap: "수도", capOk: "유지", capLost: "상실", rivals: "라이벌" },
                en: { prov: "provinces", sol: "stability", turn: "turn", cap: "capital", capOk: "held", capLost: "lost", rivals: "rivals" } }[lang];
    return `${t.prov} ${playerProvinceCount(u)}/${totalLandProvinces(u)} · ${t.sol} ${avg}% · ${t.turn} ${u.s.tick}/${PROVINCE_SIM_TICKS} · ${t.cap} ${capOk ? t.capOk : t.capLost} · ${t.rivals} ${liveRivals(u)}`;
  }

  function render(): void {
    root.innerHTML = "";
    const map = buildMap();
    root.appendChild(map);
    if (!ui) {
      // picker: click any polity territory to play it
      map.addEventListener("click", (e) => {
        const el = (e.target as Element | null)?.closest?.("[data-polity]");
        if (el) startGame(Number(el.getAttribute("data-polity")));
      });
    } else {
      const hud = document.createElement("div");
      hud.className = "prov-hud";
      hud.textContent = hudText(ui);
      root.appendChild(hud);
    }
  }
  render();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(play): province picker + HUD (P2 SP2)"
```

---

### Task 5: UI — turn loop (target provinces, advance)

**Files:**
- Modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `armableTargets`, `stepPlayerTurn` (`../engine/provinceSim`); `cellPath` (`./svgPaths`).
- Produces: in play mode, a transparent per-province target overlay (`<path class="prov-target" data-province>`) over the armable provinces; clicking one toggles it in a `targets` Set (armed = `.armed` class). An "Advance" button (`.prov-advance`) calls `stepPlayerTurn(s, playerId, targets)`, appends the returned conquest/elimination events to a chronicle log (`.prov-log`), clears `targets`, and re-renders.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/provinceApp.test.ts`:

```ts
import { armableTargets } from "../engine/provinceSim";

describe("province turn loop (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function startAsFirstPolity(): number {
    mountProvinceApp(root, { seed: 1 });
    const path = root.querySelector("[data-polity]") as SVGPathElement;
    const pid = Number(path.getAttribute("data-polity"));
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return pid;
  }

  it("only armable provinces get a target overlay, and clicking toggles the armed class", () => {
    startAsFirstPolity();
    const targets = root.querySelectorAll(".prov-target");
    expect(targets.length).toBeGreaterThan(0);
    const first = targets[0] as SVGPathElement;
    expect(first.classList.contains("armed")).toBe(false);
    first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // after a click the same province path (re-rendered) is armed
    const provId = first.getAttribute("data-province");
    const armed = root.querySelector(`.prov-target[data-province="${provId}"]`) as SVGPathElement;
    expect(armed.classList.contains("armed")).toBe(true);
  });

  it("advancing bumps the turn and logs any conquest", () => {
    startAsFirstPolity();
    const target = root.querySelector(".prov-target") as SVGPathElement;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true })); // arm one province
    (root.querySelector(".prov-advance") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-hud")!.textContent).toMatch(/1\s*\/\s*50/); // turn advanced
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: FAIL — no `.prov-target`, `.prov-advance`.

- [ ] **Step 3: Implement**

In `src/ui/provinceApp.ts`: add `import { cellPath } from "./svgPaths";` and the imports named above; add a `targets = new Set<number>()` and a `log: string[]` to the play state (put them alongside `ui`), and extend `render()`'s play branch.

Build the target overlay (a `<g>` of transparent per-province paths, only for armable provinces):

```ts
  function targetOverlay(u: UI): SVGGElement {
    const arm = new Set(armableTargets(u.s, u.playerId));
    const byProv: string[] = u.world.provinces.map(() => "");
    for (let c = 0; c < u.world.grid.count; c++) {
      const p = u.world.provinceOf[c];
      if (p >= 0 && arm.has(p)) byProv[p] += cellPath(u.world.grid.polygons[c]);
    }
    const g = svgEl("g", { class: "prov-targets" }) as SVGGElement;
    for (const prov of u.world.provinces) {
      if (!byProv[prov.id]) continue;
      const path = svgEl("path", {
        class: "prov-target" + (targets.has(prov.id) ? " armed" : ""), "data-province": prov.id,
        d: byProv[prov.id], fill: targets.has(prov.id) ? "#e8b53a" : "transparent", "fill-opacity": targets.has(prov.id) ? 0.35 : 0,
        stroke: targets.has(prov.id) ? "#e8b53a" : "none", "stroke-width": 1.5,
      });
      g.appendChild(path);
    }
    return g;
  }
```

In `render()`'s play branch, after appending the map, add the overlay + advance button + log and wire them:

```ts
      const map = root.querySelector(".prov-map") as SVGSVGElement;
      map.appendChild(targetOverlay(ui));
      map.addEventListener("click", (e) => {
        const el = (e.target as Element | null)?.closest?.(".prov-target");
        if (!el) return;
        const p = Number(el.getAttribute("data-province"));
        if (targets.has(p)) targets.delete(p); else targets.add(p);
        render();
      });
      const bar = document.createElement("div");
      bar.className = "prov-bar";
      const advance = document.createElement("button");
      advance.className = "prov-advance";
      advance.textContent = lang === "ko" ? "진행 ▶" : "Advance ▶";
      advance.addEventListener("click", () => {
        const ev = stepPlayerTurn(ui!.s, ui!.playerId, targets);
        for (const c of ev.conquests) log.unshift(`${lang === "ko" ? "정복" : "took"} ${ui!.world.provinces[c.prov].name}`);
        for (const id of ev.eliminated) log.unshift(`${ui!.world.polities[id]?.name ?? id} ${lang === "ko" ? "멸망" : "eliminated"}`);
        targets.clear();
        render();
      });
      bar.appendChild(advance);
      root.appendChild(bar);
      const logEl = document.createElement("div");
      logEl.className = "prov-log";
      logEl.textContent = log.slice(0, 8).join(" · ");
      root.appendChild(logEl);
```

Declare `const targets = new Set<number>();` and `const log: string[] = [];` in the `mountProvinceApp` closure (reset on `startGame`: `targets.clear(); log.length = 0;`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(play): province turn loop — target + advance (P2 SP2)"
```

---

### Task 6: UI — victory / defeat + game over, and real-browser verification

**Files:**
- Modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: everything above; `DOMINATION_MULT` (new local const in `provinceApp.ts` = 3).
- Produces: after each `stepPlayerTurn`, an outcome check — **defeat** (`!s.alive[playerId]`), **domination** (player province count ≥ `DOMINATION_MULT × startProvinces`), or **survival** (`s.tick >= PROVINCE_SIM_TICKS`). On any outcome, render a game-over banner (`.prov-over`) naming the result (defeat names the conqueror = the new owner of the player's capital province), and buttons "Play again" (`.prov-again`, back to picker, same world) and "New world" (`.prov-new`, remount with a fresh seed). The advance button is removed at game over.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/provinceApp.test.ts`:

```ts
describe("province victory / defeat", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("declares survival victory after the last turn if the capital is held", () => {
    mountProvinceApp(root, { seed: 1 });
    const path = root.querySelector("[data-polity]") as SVGPathElement;
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // advance to the horizon without attacking (pure survival)
    for (let i = 0; i < 50; i++) {
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game already ended (defeat)
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".prov-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/생존|survi|정복|domina|패배|defeat/i); // some terminal outcome shown
    // a finished game offers restart
    expect(root.querySelector(".prov-again")).toBeTruthy();
    expect(root.querySelector(".prov-new")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: FAIL — no `.prov-over` / restart buttons.

- [ ] **Step 3: Implement**

In `src/ui/provinceApp.ts`: add `const DOMINATION_MULT = 3;` near the top. Add an outcome helper and a game-over branch in `render()`. After the advance handler calls `stepPlayerTurn` + `render()`, `render()` itself decides play-vs-over:

```ts
  type Outcome = { kind: "defeat"; by: string } | { kind: "domination" } | { kind: "survival" } | null;
  function outcome(u: UI): Outcome {
    if (!u.s.alive[u.playerId]) {
      const cap = u.s.capitalProv[u.playerId];
      const by = u.world.polities[u.s.provOwner[cap]]?.name ?? "?";
      return { kind: "defeat", by };
    }
    if (playerProvinceCount(u) >= DOMINATION_MULT * u.startProvinces) return { kind: "domination" };
    if (u.s.tick >= PROVINCE_SIM_TICKS) return { kind: "survival" };
    return null;
  }
```

In `render()`'s play branch, wrap the turn UI so that when `outcome(ui)` is non-null it renders the banner instead of the advance button:

```ts
      const oc = outcome(ui);
      if (oc) {
        const over = document.createElement("div");
        over.className = "prov-over";
        over.textContent =
          oc.kind === "defeat" ? (lang === "ko" ? `패배 — ${oc.by}에게 수도 함락` : `Defeat — capital taken by ${oc.by}`)
          : oc.kind === "domination" ? (lang === "ko" ? "지배 승리!" : "Domination victory!")
          : (lang === "ko" ? "생존 승리 — 왕조가 살아남았다" : "Survival victory — your dynasty endured");
        const again = document.createElement("button"); again.className = "prov-again";
        again.textContent = lang === "ko" ? "다시" : "Play again";
        again.addEventListener("click", () => { ui = null; targets.clear(); log.length = 0; render(); });
        const nw = document.createElement("button"); nw.className = "prov-new";
        nw.textContent = lang === "ko" ? "새 세계" : "New world";
        nw.addEventListener("click", () => mountProvinceApp(root, {})); // fresh seed
        const bar = document.createElement("div"); bar.className = "prov-bar";
        bar.append(again, nw);
        root.append(over, bar);
        const logEl = document.createElement("div"); logEl.className = "prov-log";
        logEl.textContent = log.slice(0, 8).join(" · ");
        root.appendChild(logEl);
        return; // no target overlay / advance once the game is over
      }
```

(Place this `if (oc) { ... return; }` at the very start of the play branch, before the target overlay / advance wiring from Task 5.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/provinceApp.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run` — Expected: all pass (engine + UI + Version A goldens unchanged).
Run: `npm run build` — Expected: builds (a pre-existing `TS2688 'node'` type error, if it appears, is a known unrelated environment gap — report it as such; any other error is yours). Confirm `playProvince.html` is picked up (Vite multi-page: it is an HTML entry at the repo root, like `play.html`).

- [ ] **Step 6: Real-browser verification**

Start the dev server (preview_start) and open `playProvince.html`. Verify: the province map renders in nation colors; clicking a nation starts a game (HUD shows `turn 0/50`, your nation in the player color); armable provinces highlight and toggle on click; Advance bumps the turn and logs conquests; the console is clean. Capture a screenshot for the user (the layout/feel needs the user's eyes; screenshots may be harness-limited — report DOM/console evidence too).

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(play): province victory/defeat + game over (P2 SP2)"
```

---

## Post-implementation

SP2 delivers a playable, isolated province game on the SP1 engine. Follow-ups: **SP3** (balance re-tune — `SIZE_CAP` at province scale is the flagged primary target, plus `DOMINATION_MULT` pacing), then later SP2 feature passes (invest/stance levers, dilemmas, standing/grudges, challenges, sea lanes, replay, daily/string seeds, ascension, legacy). Styling polish for `.prov-map`/`.prov-hud`/`.prov-over` (theme.css) and mobile/touch (tipStrip, coarse sizing) are feel-pass items once the core is verified.
