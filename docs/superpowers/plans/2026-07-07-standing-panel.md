# Standing Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Version B play-mode a compact "am I winning / getting better or worse?" panel — a momentum headline + two health meters (국력/결속) + a threat line — so the player can *feel* balance and difficulty.

**Architecture:** One new pure read-only helper `src/engine/standing.ts` computes an instantaneous `Standing` snapshot from `SimState`. `src/ui/playApp.ts` captures turn-over-turn momentum in the existing advance handler and rewrites `renderPanel` to render the headline + meters + threat. All play-UI + read-only → engine goldens byte-identical.

**Tech Stack:** TypeScript, Vite MPA, Vitest (jsdom for UI), plain DOM (no framework).

## Global Constraints

- **Determinism / goldens:** This feature is read-only over `SimState` and touches only play-UI files. It MUST NOT change any engine tuning constant or write to `SimState`. Existing world/history/playSim golden-hash tests MUST stay byte-identical — never edit `historySim.ts`, `intervention.ts`, `world.ts`, `dilemma.ts`.
- **Run tests from THIS worktree** (`npm test`), not the main repo root (the root globs `.claude/worktrees/*` copies and inflates the count). Current baseline: **391 tests** on `main`.
- **i18n:** every user-facing string goes through the existing `playT(lang, key)` table in `src/ui/i18n.ts` with BOTH `en` and `ko` entries. No hard-coded literals in `playApp.ts`.
- **Thresholds live in `standing.ts`** as named exported consts, not magic numbers scattered in the UI.
- **Commit** after each task's tests pass.

---

### Task 1: `computeStanding` pure helper

**Files:**
- Create: `src/engine/standing.ts`
- Test: `src/engine/standing.test.ts`

**Interfaces:**
- Consumes: `SimState`, `aggregate` from `./historySim`; `frontEdges` from `./intervention`.
- Produces:
  ```ts
  export const STRENGTH_STRONG: number;   // 1.15
  export const STRENGTH_WEAK: number;     // 0.7
  export const COHESION_STABLE: number;   // 0.55
  export const COHESION_DANGER: number;   // 0.4
  export interface Standing {
    cells: number;
    rivalAvgCells: number;
    strength: "strong" | "even" | "weak";
    cohesion: number;
    cohesionState: "stable" | "shaky" | "danger";
    borderPolities: number;
    truceCount: number;
  }
  export function computeStanding(s: SimState, opts?: { neighborsOnly?: boolean }): Standing;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/engine/standing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim } from "./playSim";
import { computeStanding } from "./standing";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

// build a controlled two-nation state: player(0) owns [0,pCells), rival(1) owns [pCells, pCells+rCells)
function twoNation(pCells: number, rCells: number, sol = 0.6) {
  const { world } = generateWorld({ ...small, seed: 1 });
  const s = initPlaySim(world, 1, 0, "internal");
  s.alive = s.alive.map((_, i) => i === 0 || i === 1);
  for (let c = 0; c < s.n; c++) {
    s.owner[c] = c < pCells ? 0 : c < pCells + rCells ? 1 : -1;
    s.solidarity[c] = s.owner[c] >= 0 ? sol : 0;
  }
  return s;
}

describe("computeStanding", () => {
  it("reports the player's own cell count and cohesion", () => {
    const s = twoNation(10, 20, 0.7);
    const st = computeStanding(s);
    expect(st.cells).toBe(10);
    expect(Math.round(st.cohesion * 100)).toBe(70);
  });

  it("strength is weak/even/strong vs the living-field average", () => {
    expect(computeStanding(twoNation(10, 20)).strength).toBe("weak");   // 0.5 <= 0.7
    expect(computeStanding(twoNation(10, 10)).strength).toBe("even");   // 1.0
    expect(computeStanding(twoNation(30, 10)).strength).toBe("strong"); // 3.0 >= 1.15
    expect(computeStanding(twoNation(10, 20)).rivalAvgCells).toBe(20);
  });

  it("cohesionState maps by threshold (stable/shaky/danger)", () => {
    expect(computeStanding(twoNation(10, 10, 0.9)).cohesionState).toBe("stable");
    expect(computeStanding(twoNation(10, 10, 0.45)).cohesionState).toBe("shaky");
    expect(computeStanding(twoNation(10, 10, 0.1)).cohesionState).toBe("danger");
  });

  it("counts active truces only (tick still in the future)", () => {
    const s = twoNation(10, 10);
    s.truces.set(1, s.tick + 3);
    s.truces.set(2, s.tick - 1);
    expect(computeStanding(s).truceCount).toBe(1);
  });

  it("guards the no-living-rival case as 'strong'", () => {
    const s = twoNation(10, 0);              // rival owns nothing
    s.alive = s.alive.map((_, i) => i === 0); // player is last standing
    const st = computeStanding(s);
    expect(st.rivalAvgCells).toBe(0);
    expect(st.strength).toBe("strong");
  });

  it("neighborsOnly restricts the average to bordering rivals (0 when isolated)", () => {
    const s = twoNation(10, 0);
    s.alive = s.alive.map((_, i) => i === 0);
    const st = computeStanding(s, { neighborsOnly: true });
    expect(st.borderPolities).toBe(0);
    expect(st.strength).toBe("strong");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- standing`
Expected: FAIL — `Cannot find module './standing'` / `computeStanding is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/standing.ts`:

```ts
import type { SimState } from "./historySim";
import { aggregate } from "./historySim";
import { frontEdges } from "./intervention";

// tuning knobs for the "how am I doing" readout (UI layer — NOT engine goldens)
export const STRENGTH_STRONG = 1.15; // cells / rivalAvg at/above this => "우세"
export const STRENGTH_WEAK = 0.7;    // cells / rivalAvg at/below this => "열세"
export const COHESION_STABLE = 0.55; // avg solidarity at/above this => "안정"
export const COHESION_DANGER = 0.4;  // below this => "위험" (civil-war cue), between => "불안"

export interface Standing {
  cells: number;
  rivalAvgCells: number;
  strength: "strong" | "even" | "weak";
  cohesion: number;
  cohesionState: "stable" | "shaky" | "danger";
  borderPolities: number;
  truceCount: number;
}

// Instantaneous, read-only snapshot of the player's standing. Never mutates s.
export function computeStanding(s: SimState, opts: { neighborsOnly?: boolean } = {}): Standing {
  const agg = aggregate(s);
  const me = s.playerPolity;
  const cells = agg[me]?.cells ?? 0;
  const cohesion = agg[me]?.avg ?? 0;

  // distinct rival polities touching the player's front line
  const borderSet = new Set<number>();
  for (const e of frontEdges(s)) borderSet.add(e.enemy);

  // rival average cells: whole living field by default; bordering rivals only if requested
  let sum = 0, cnt = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (o === me || !s.alive[o]) continue;
    if (opts.neighborsOnly && !borderSet.has(o)) continue;
    sum += agg[o].cells; cnt++;
  }
  const rivalAvgCells = cnt > 0 ? sum / cnt : 0;

  const ratio = rivalAvgCells > 0 ? cells / rivalAvgCells : Infinity;
  const strength = ratio >= STRENGTH_STRONG ? "strong" : ratio <= STRENGTH_WEAK ? "weak" : "even";

  const cohesionState =
    cohesion >= COHESION_STABLE ? "stable" : cohesion >= COHESION_DANGER ? "shaky" : "danger";

  let truceCount = 0;
  for (const until of s.truces.values()) if (until > s.tick) truceCount++;

  return { cells, rivalAvgCells, strength, cohesion, cohesionState, borderPolities: borderSet.size, truceCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- standing`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/engine/standing.test.ts
git commit -m "feat(play): computeStanding — pure read-only standing snapshot (cells/strength/cohesion/threat)"
```

---

### Task 2: Standing panel in the play UI (momentum + meters + threat)

**Files:**
- Modify: `src/ui/i18n.ts` (add play-UI keys to both `en` and `ko` blocks — the `en` block is around line 58, the `ko` block around line 88)
- Modify: `src/ui/playApp.ts` (import `computeStanding`; add `momentum` state; capture it in the advance handler ~line 434; rewrite `renderPanel` ~lines 289-328; remove the now-unused `LOW_COHESION` const at line 18)
- Modify: `src/theme.css` (add `.standing`/`.momentum`/`.meter`/`.threat-line` styles after the `.advice` block ~line 141)
- Test: `src/ui/playApp.test.ts` (append cases)

**Interfaces:**
- Consumes from Task 1: `computeStanding(s)`, `Standing`.
- Produces: no exported API; internal `momentum` module state of shape `{ dCells: number; dCohesionDir: -1 | 0 | 1; lost: number } | null` (null = before the first advance).

- [ ] **Step 1: Add i18n keys**

In `src/ui/i18n.ts`, add these keys to the **`en`** play block (near `solStable: "steady", ...` at line 79):

```ts
    strength: "power", strengthStrong: "ahead", strengthEven: "even", strengthWeak: "behind",
    thisTurn: "This turn", firstTurn: "First turn", cellsLost: " lost",
    border: "borders", truce: "truces", vs: "vs",
```

Add the matching keys to the **`ko`** play block (near `solStable: "안정", ...` at line 109):

```ts
    strength: "국력", strengthStrong: "우세", strengthEven: "균형", strengthWeak: "열세",
    thisTurn: "이번 턴", firstTurn: "첫 턴", cellsLost: "셀 상실",
    border: "국경 접촉", truce: "휴전", vs: "vs",
```

- [ ] **Step 2: Write the failing UI test**

Append to `src/ui/playApp.test.ts` (inside the existing `describe("playApp", ...)`):

```ts
  it("shows a standing panel: momentum headline, two meters, threat line", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    // before any turn: momentum headline reads "first turn"
    expect(root.querySelector(".momentum")!.textContent).toMatch(/first turn/i);
    // two meters present
    expect(root.querySelector(".meter-strength")).not.toBeNull();
    expect(root.querySelector(".meter-cohesion")).not.toBeNull();
    // threat line present
    expect(root.querySelector(".threat-line")).not.toBeNull();
  });

  it("after a turn the momentum headline reports the change (not 'first turn')", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const mo = root.querySelector(".momentum")!.textContent || "";
    expect(mo).not.toMatch(/first turn/i);
    expect(mo).toMatch(/This turn/);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `.momentum` / `.meter-strength` are null.

- [ ] **Step 4: Import the helper and add momentum state**

In `src/ui/playApp.ts`, extend the Task-1 import from `historySim`/add a new import. Change line 3-6 area so `computeStanding` and `Standing` are imported:

```ts
import { computeStanding, type Standing } from "../engine/standing";
```

Remove the now-unused const at line 18:

```ts
const LOW_COHESION = 0.4; // civil-war risk cue threshold   <-- DELETE this line
```

In the game-mount scope (where `let over = false;` is declared, ~line 68), add:

```ts
    let momentum: { dCells: number; dCohesionDir: -1 | 0 | 1; lost: number } | null = null;
```

- [ ] **Step 5: Capture momentum in the advance handler**

In the `advance.addEventListener("click", ...)` body (~line 434), it already computes `before`, `gained`, `lost`. Add a cohesion-before read right after `const before = ...`, and set `momentum` right after the `gained`/`lost` loop. The edited handler head becomes:

```ts
      advance.addEventListener("click", () => {
        const before = Int32Array.from(s.owner);
        const cohBefore = aggregate(s)[s.playerPolity]?.avg ?? 0;
        const r = playTurn(s, pendingAction);
        pendingAction = null;
        let gained = 0, lost = 0;
        for (let c = 0; c < s.n; c++) {
          const was = before[c] === s.playerPolity, now = s.owner[c] === s.playerPolity;
          if (now && !was) gained++; else if (was && !now) lost++;
        }
        const cohAfter = aggregate(s)[s.playerPolity]?.avg ?? 0;
        const dir: -1 | 0 | 1 = cohAfter > cohBefore + 0.005 ? 1 : cohAfter < cohBefore - 0.005 ? -1 : 0;
        momentum = { dCells: gained - lost, dCohesionDir: dir, lost };
```

(Leave the rest of the handler — `appendLog(playDelta(...))` onward — unchanged.)

- [ ] **Step 6: Rewrite `renderPanel`**

Replace the whole `renderPanel` function (lines ~289-328) with:

```ts
    function meterRow(cls: string, label: string, value: string, state: string): HTMLElement {
      const row = document.createElement("div");
      row.className = `meter ${cls} ${state}`;
      const l = document.createElement("span"); l.className = "meter-label"; l.textContent = label;
      const v = document.createElement("span"); v.className = "meter-value"; v.textContent = value;
      row.append(l, v);
      return row;
    }

    function momentumText(): string {
      if (!momentum) return playT(lang, "firstTurn");
      const d = momentum.dCells;
      const cellArrow = d > 0 ? `▲+${d}` : d < 0 ? `▼${-d}` : "–";
      const dir = momentum.dCohesionDir;
      const cohArrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "–";
      const lostClause = momentum.lost > 0 ? ` · ${momentum.lost}${playT(lang, "cellsLost")}` : "";
      return `${playT(lang, "thisTurn")} · ${playT(lang, "strength")} ${cellArrow}${playT(lang, "cells")}` +
        ` · ${playT(lang, "cohesion")} ${cohArrow}${lostClause}`;
    }

    function renderPanel(): void {
      const year = playYear(lang, s.tick * YEARS_PER_TICK);
      const name = s.polities[s.playerPolity].name;
      // a fallen realm has no standing to speak of — the scorecard banner tells that story
      if (!s.alive[s.playerPolity]) {
        panel.innerHTML = `<b class="play-year">${year}</b> · ${name} — ${playT(lang, "fallen")}`;
        panel.appendChild(langButton(rerender));
        return;
      }
      const st = computeStanding(s);
      panel.innerHTML = `<b class="play-year">${year}</b> · ${name}`;

      // ① momentum headline — the real new signal
      const mo = document.createElement("div");
      mo.className = "momentum";
      mo.textContent = momentumText();
      panel.appendChild(mo);

      // ② two health meters (context the momentum moves within)
      const meters = document.createElement("div");
      meters.className = "standing";
      const strengthWord = playT(lang,
        st.strength === "strong" ? "strengthStrong" : st.strength === "weak" ? "strengthWeak" : "strengthEven");
      const strengthVal = `${strengthWord} (${st.cells} ${playT(lang, "vs")} ${Math.round(st.rivalAvgCells)})`;
      meters.appendChild(meterRow("meter-strength", playT(lang, "strength"), strengthVal, st.strength));
      const cohWord = playT(lang,
        st.cohesionState === "stable" ? "solStable" : st.cohesionState === "shaky" ? "solShaky" : "solDanger");
      const warn = st.cohesionState === "danger" ? "⚠ " : "";
      const cohVal = `${warn}${(st.cohesion * 100) | 0}% (${cohWord})`;
      meters.appendChild(meterRow("meter-cohesion", playT(lang, "cohesion"), cohVal, st.cohesionState));
      panel.appendChild(meters);

      // ③ threat line
      const threat = document.createElement("div");
      threat.className = "threat-line";
      const truceStr = st.truceCount > 0 ? ` · ${playT(lang, "truce")} ${st.truceCount}` : "";
      threat.textContent = `${playT(lang, "border")} ${st.borderPolities}${truceStr}`;
      panel.appendChild(threat);

      // stance levers + help + language (unchanged behaviour)
      const stanceRow = document.createElement("span");
      stanceRow.className = "view-toggle";
      for (const st2 of STANCES) {
        const btn = document.createElement("button");
        btn.textContent = playT(lang, st2);
        btn.title = playT(lang, `tip${st2[0].toUpperCase()}${st2.slice(1)}`);
        btn.className = s.stance === st2 ? "active" : "";
        btn.addEventListener("click", () => { setStance(s, st2); renderAll(); });
        stanceRow.appendChild(btn);
      }
      const helpBtn = document.createElement("button");
      helpBtn.className = "help-btn";
      helpBtn.textContent = playT(lang, "help");
      helpBtn.addEventListener("click", () => { showHelp = true; renderHowto(); });
      panel.append(stanceRow, helpBtn, langButton(rerender));

      // per-turn advice line (kept)
      const advice = document.createElement("div");
      advice.className = "advice";
      advice.textContent = playT(lang, adviceKey());
      panel.appendChild(advice);
    }
```

Note: the `st` inside the stance loop was renamed to `st2` to avoid shadowing the `Standing` value `st`. `borderTargets` is no longer read by `renderPanel`; leave its import (still used elsewhere in the file for the action list and `adviceKey`).

- [ ] **Step 7: Add CSS**

In `src/theme.css`, after the `.advice` rule (~line 141) add:

```css
/* standing panel: momentum headline + two health meters + threat line */
.momentum { margin: 4px 0; font-weight: 600; color: #3a2f22; }
.standing { display: flex; flex-direction: column; gap: 3px; margin: 4px 0; }
.meter { display: flex; justify-content: space-between; gap: 8px; padding: 2px 8px;
  border-left: 3px solid #b8a878; border-radius: 3px; background: #f2ead8; font-size: 13px; }
.meter .meter-label { color: #5a4a34; }
.meter.strong { border-left-color: #4a8c5a; }
.meter.even   { border-left-color: #c8a344; }
.meter.weak, .meter.danger { border-left-color: #b5533f; }
.meter.stable { border-left-color: #4a8c5a; }
.meter.shaky  { border-left-color: #c8a344; }
.threat-line { margin: 3px 0; font-size: 12px; color: #6a5a42; }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- playApp`
Expected: PASS (existing playApp tests + 2 new).

- [ ] **Step 9: Full test run + build**

Run: `npm test`
Expected: PASS — 391 prior + 6 (Task 1) + 2 (Task 2) = **399 tests**, no golden-hash regressions.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): standing panel — momentum headline + 국력/결속 meters + threat line"
```

---

## Self-Review

**1. Spec coverage:**
- ① Momentum headline (Δterritory, Δcohesion, cells-lost, first-turn) → Task 2 Steps 5-6 (`momentum` state + `momentumText`). ✓
- ② Two meters (territory vs whole-field avg; cohesion reusing thresholds) → Task 1 `computeStanding` + Task 2 `meterRow`. ✓
- ② calibration default whole-field, `neighborsOnly` knob off by default → Task 1 `opts.neighborsOnly`. ✓
- ③ Threat line (border polities + truces) → Task 2 Step 6. ✓
- Pure helper `src/engine/standing.ts` with tests → Task 1. ✓
- Edge cases: dead player (fallen banner), no living rivals (strong guard), turn 1 (첫 턴) → Task 1 test + Task 2 `renderPanel` fallen branch + `momentumText` null. ✓
- Read-only / goldens intact → Global Constraints + Task 2 Step 9. ✓
- Deferred preview extension → not in plan (correctly out of scope). ✓

**2. Placeholder scan:** No TBD/TODO. Every step has complete, ready-to-paste content (CSS hexes, i18n keys, full `renderPanel` body).

**3. Type consistency:** `Standing` fields (`cells`, `rivalAvgCells`, `strength`, `cohesion`, `cohesionState`, `borderPolities`, `truceCount`) are produced in Task 1 and consumed by the same names in Task 2. `momentum` shape `{ dCells, dCohesionDir, lost }` is defined (Step 4) and read (Steps 5-6) identically. i18n keys added in Step 1 (`strength`, `strengthStrong/Even/Weak`, `thisTurn`, `firstTurn`, `cellsLost`, `border`, `truce`, `vs`) are exactly the keys `renderPanel`/`momentumText` pass to `playT`. `solStable/solShaky/solDanger` reused for the cohesion word already exist in i18n.
