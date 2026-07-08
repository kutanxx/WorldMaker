# Multiple Victory Conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add three victory paths (Conquest / Prosperity / Endurance) with a compact goals readout and per-kind victory banners, so the player has direction and a viable non-military win.

**Architecture:** Victory logic is a pure read (`victoryProgress`) in the play layer `src/engine/playSim.ts` (NOT the pure `historySim` engine). `playApp.ts` tracks a prosperity streak, resolves the victory kind after each turn, renders a compact goals line, and picks the banner head by kind. Player-gated + read-only over the history sim → golden hashes byte-identical.

**Tech Stack:** TypeScript, Vite MPA, Vitest.

## Global Constraints

- **Do NOT edit the pure engine** (`historySim.ts`, `intervention.ts`, `world.ts`, `dilemma.ts`, `standing.ts`). Victory logic lives in `playSim.ts` (play layer) and the UI. Golden-hash tests MUST stay byte-identical.
- **All user-facing strings via `playT(lang, key)`** with BOTH `en` and `ko`. Icon glyphs (⚔ 🏘 👑 ✓ ✗ ·) may be literal.
- **Preserve the existing restart buttons and reign-export** in `renderBanner` (added in prior work) and the momentum-capture logic in the advance handler.
- Constants (`PROSPER_CITIES=6`, `PROSPER_COH=0.55`, `PROSPER_STREAK=3`) are the measurement-seeded values; keep them as exported constants (tunable).
- Run tests from THIS worktree with `npm test`. Baseline: **405 tests**.

---

### Task 1: `victoryProgress` + constants (play layer)

**Files:**
- Modify: `src/engine/playSim.ts`
- Test: `src/engine/playSim.test.ts`

**Interfaces:**
- Consumes: `aggregate`, `YEARS_PER_TICK` (already imported in playSim), `SimState`.
- Produces:
  ```ts
  export const PROSPER_CITIES: number; // 6
  export const PROSPER_COH: number;    // 0.55
  export const PROSPER_STREAK: number; // 3
  export interface VictoryProgress {
    rivalsLeft: number; initialRivals: number; cities: number;
    cohesionOk: boolean; year: number; conquest: boolean; prosperityGate: boolean;
  }
  export function victoryProgress(s: SimState): VictoryProgress;
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/engine/playSim.test.ts`:

```ts
import { victoryProgress, PROSPER_CITIES, PROSPER_COH, PROSPER_STREAK } from "./playSim";

describe("victoryProgress", () => {
  const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
  function playerCellsList(s: ReturnType<typeof initPlaySim>): number[] {
    const cells: number[] = [];
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) cells.push(c);
    return cells;
  }

  it("exports the measurement-seeded constants", () => {
    expect(PROSPER_CITIES).toBe(6);
    expect(PROSPER_COH).toBe(0.55);
    expect(PROSPER_STREAK).toBe(3);
  });

  it("conquest is true only when every initial rival is dead (and there was >=1)", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    expect(victoryProgress(s).conquest).toBe(false); // rivals alive at start
    expect(victoryProgress(s).initialRivals).toBeGreaterThan(0);
    for (let o = 0; o < s.polities.length; o++) {
      if (o !== s.playerPolity && s.polities[o].origin === "initial") s.alive[o] = false;
    }
    expect(victoryProgress(s).rivalsLeft).toBe(0);
    expect(victoryProgress(s).conquest).toBe(true);
  });

  it("prosperityGate needs >=PROSPER_CITIES held cities AND cohesion >= PROSPER_COH", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const mine = playerCellsList(s);
    for (const c of mine) s.solidarity[c] = 0.7;              // cohesion high
    for (let i = 0; i < PROSPER_CITIES; i++) s.foundedCities.add(mine[i]); // 6 held cities
    expect(victoryProgress(s).prosperityGate).toBe(true);
    s.foundedCities.delete(mine[0]);                          // now only 5
    expect(victoryProgress(s).prosperityGate).toBe(false);
    s.foundedCities.add(mine[0]);
    for (const c of mine) s.solidarity[c] = 0.3;              // cohesion too low
    expect(victoryProgress(s).cohesionOk).toBe(false);
    expect(victoryProgress(s).prosperityGate).toBe(false);
  });
});
```

(The file already imports `generateWorld`, `DEFAULT_PARAMS`, `initPlaySim` at the top — reuse them; only add the new `victoryProgress`/constants import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playSim`
Expected: FAIL — `victoryProgress` is not exported.

- [ ] **Step 3: Implement in `src/engine/playSim.ts`**

Add after the existing `scorecard` function (constants near the top of the file, or just above the function):

```ts
// --- victory conditions (play layer; measurement-seeded, tunable) ---
export const PROSPER_CITIES = 6;    // held founded cities for the prosperity path
export const PROSPER_COH = 0.55;    // avg cohesion floor for prosperity
export const PROSPER_STREAK = 3;    // consecutive turns the prosperity gate must hold

export interface VictoryProgress {
  rivalsLeft: number;      // living initial rivals (excludes the player)
  initialRivals: number;   // count of initial polities other than the player
  cities: number;          // player-held founded cities
  cohesionOk: boolean;     // avg cohesion >= PROSPER_COH
  year: number;            // s.tick * YEARS_PER_TICK
  conquest: boolean;       // every initial rival eliminated (and there was >=1)
  prosperityGate: boolean; // cities >= PROSPER_CITIES && cohesionOk (the per-turn gate)
}

export function victoryProgress(s: SimState): VictoryProgress {
  const agg = aggregate(s);
  let initialRivals = 0, rivalsLeft = 0;
  for (let o = 0; o < s.polities.length; o++) {
    if (o === s.playerPolity || s.polities[o].origin !== "initial") continue;
    initialRivals++;
    if (s.alive[o]) rivalsLeft++;
  }
  let cities = 0;
  for (const fc of s.foundedCities) if (s.owner[fc] === s.playerPolity) cities++;
  const cohesionOk = (agg[s.playerPolity]?.avg ?? 0) >= PROSPER_COH;
  return {
    rivalsLeft, initialRivals, cities, cohesionOk,
    year: s.tick * YEARS_PER_TICK,
    conquest: initialRivals >= 1 && rivalsLeft === 0,
    prosperityGate: cities >= PROSPER_CITIES && cohesionOk,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- playSim`
Expected: PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/playSim.ts src/engine/playSim.test.ts
git commit -m "feat(play): victoryProgress + prosperity constants (conquest/prosperity readout, play layer)"
```

---

### Task 2: Victory detection + per-kind banner

**Files:**
- Modify: `src/ui/playApp.ts` (imports; `prosperStreak` state; advance-handler resolution; `end`/`renderBanner` by kind)
- Modify: `src/ui/i18n.ts` (`winConquest`, `winProsperity` heads, both langs)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes from Task 1: `victoryProgress`, `PROSPER_STREAK`; `TICKS` from historySim.
- Produces: `end(kind, cause?)` with `type VictoryKind = "conquest" | "prosperity" | "endurance" | "defeat"`; banner head varies by kind.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts`:

```ts
  it("a reign that runs the full 500 years ends with the endurance victory banner", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    const h2 = root.querySelector(".stub h2")!.textContent || "";
    expect(h2).toMatch(/endured|500/i);   // endurance head, not a defeat/other head
    expect(root.querySelector(".btn-play-again")).not.toBeNull(); // restart still present
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: it may already pass IF seed-1 biggest nation endures — but proceed; the goal is that after the refactor it still holds. If it passes now, treat Steps 3-6 as a refactor that must keep it green. (The real new coverage for conquest/prosperity is Task 1's pure test.)

- [ ] **Step 3: Add i18n heads**

In `src/ui/i18n.ts`, add to the **`en`** play block (near `endured`): `winConquest: "You unified the realm.", winProsperity: "Your realm prospered into a golden age.",`
Add to the **`ko`** play block (near `endured`): `winConquest: "당신은 천하를 통일했습니다.", winProsperity: "당신의 나라가 황금기를 이루었습니다.",`

- [ ] **Step 4: Imports + streak state + VictoryKind**

In `src/ui/playApp.ts`:
- Extend the historySim import to include `TICKS` (it currently imports `aggregate, YEARS_PER_TICK`): add `TICKS`.
- Extend the playSim import (currently `initPlaySim, playTurn, setStance, scorecard, playerCells`) to add `victoryProgress, PROSPER_STREAK, PROSPER_CITIES`.
- Add the type near the top of the file (module scope): `type VictoryKind = "conquest" | "prosperity" | "endurance" | "defeat";`
- In the game-mount scope (where `let momentum ... = null;` is), add: `let prosperStreak = 0;`

- [ ] **Step 5: Replace the end-of-turn resolution in the advance handler**

In the advance handler, replace the current block:

```ts
        if (r.finished) {
          const conq = r.events.find((e) => e.type === "conquer" && e.otherId === s.playerPolity);
          return end(r.defeated, conq ? s.polities[conq.polityId].name : "");
        }
```

with:

```ts
        const vp = victoryProgress(s);
        prosperStreak = vp.prosperityGate ? prosperStreak + 1 : 0;
        const kind: VictoryKind | null =
          !s.alive[s.playerPolity] ? "defeat"
            : vp.conquest ? "conquest"
              : prosperStreak >= PROSPER_STREAK ? "prosperity"
                : s.tick >= TICKS ? "endurance"
                  : null;
        if (kind) {
          const conq = r.events.find((e) => e.type === "conquer" && e.otherId === s.playerPolity);
          return end(kind, kind === "defeat" && conq ? s.polities[conq.polityId].name : "");
        }
```

(Everything above it — momentum capture, the `appendLog(playDelta…)`, message, and event loop — stays unchanged. `r.finished` is no longer referenced here; it is subsumed by the `defeat`/`endurance` cases.)

- [ ] **Step 6: Change `end` + `renderBanner` to use the kind**

Replace `let defeatedFlag = false;` (near `let defeatCause = "";`) with:

```ts
    let victoryKind: VictoryKind = "endurance";
    let defeatCause = "";
```

In `renderBanner`, replace the `head`/`cause` lines:

```ts
      const head =
        victoryKind === "defeat" ? playFell(lang, sc.survivedYears)
          : victoryKind === "conquest" ? playT(lang, "winConquest")
            : victoryKind === "prosperity" ? playT(lang, "winProsperity")
              : playT(lang, "endured");
      const cause = victoryKind === "defeat" && defeatCause ? ` ${playDefeatCause(lang, defeatCause)}` : "";
```

Replace the `end` function signature/body head:

```ts
    function end(kind: VictoryKind, cause = ""): void {
      over = true;
      victoryKind = kind;
      defeatCause = cause;
      dilemma = null;
      actions.innerHTML = "";
      renderPanel();
```

(The rest of `end` — `renderDilemma(); renderHowto(); renderBanner();` — is unchanged.)

- [ ] **Step 7: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS (the endurance-banner test + existing restart/advance tests green).
Run: `npm test` → all pass (**≈408** = 405 + 3 Task-1 + endurance test), no golden regressions.
Run: `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/ui/playApp.test.ts
git commit -m "feat(play): resolve victory kind each turn — conquest/prosperity/endurance banners"
```

---

### Task 3: Compact goals readout

**Files:**
- Modify: `src/ui/playApp.ts` (a `goals` element + `renderGoals` + call in `renderAll`)
- Modify: `src/ui/i18n.ts` (`goals`, `goalRivals` labels, both langs)
- Modify: `src/theme.css` (`.goals`)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `victoryProgress`, `PROSPER_CITIES`, `PROSPER_STREAK`, `prosperStreak`.
- Produces: a compact `.goals` line showing per-path progress, hidden once the game is over.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts`:

```ts
  it("shows a compact goals line with the three victory paths", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const goals = root.querySelector(".goals");
    expect(goals).not.toBeNull();
    const txt = goals!.textContent || "";
    expect(txt).toMatch(/⚔/);          // conquest readout
    expect(txt).toMatch(/🏘/);          // prosperity readout
    expect(txt).toMatch(/500/);         // endurance readout (year target)
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `.goals` is null.

- [ ] **Step 3: Add i18n labels**

In `src/ui/i18n.ts`, add to the **`en`** play block: `goals: "Goals", goalRivals: "rivals",`
Add to the **`ko`** play block: `goals: "목표", goalRivals: "라이벌",`

- [ ] **Step 4: Add the goals element and renderer**

In `src/ui/playApp.ts`, in the DOM assembly (where `panel`, `stage`, etc. are created and `col.append(...)` is called), create a goals element and insert it right after `panel`:

```ts
    const goals = document.createElement("div");
    goals.className = "goals";
```

and change the `col.append(...)` line to include it after `panel`:

```ts
    col.append(panel, goals, stage, dilemmaBox, actions, log);
```

Add the renderer (near `renderPanel`):

```ts
    function renderGoals(): void {
      if (over || !s.alive[s.playerPolity]) { goals.textContent = ""; return; }
      const vp = victoryProgress(s);
      goals.textContent =
        `${playT(lang, "goals")}: ⚔ ${playT(lang, "goalRivals")} ${vp.rivalsLeft}` +
        ` · 🏘 ${vp.cities}/${PROSPER_CITIES} ${vp.cohesionOk ? "✓" : "✗"} ${prosperStreak}/${PROSPER_STREAK}` +
        ` · 👑 ${vp.year}/500`;
    }
```

Add `renderGoals()` to `renderAll`:

```ts
    function renderAll(): void { renderMap(); renderPanel(); renderGoals(); renderActions(); renderDilemma(); renderHowto(); renderLegend(); }
```

- [ ] **Step 5: Add CSS**

In `src/theme.css`, near the standing-panel rules, add:

```css
.goals { font-size: 12px; color: #5a4a34; margin: 2px 0 4px; }
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS.
Run: `npm test` → all pass (**≈409**), no golden regressions.
Run: `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): compact goals line — conquest/prosperity/endurance progress"
```

Manual check (user): the goals line shows `목표: ⚔ 라이벌 N · 🏘 c/6 ✓ s/3 · 👑 year/500`; a conquest/prosperity/endurance win shows its own banner head; restart still works.

---

## Self-Review

**1. Spec coverage:** Conquest (all initial rivals dead) / Prosperity (≥6 cities + cohesion, 3-turn streak) / Endurance (year 500) → Task 1 `victoryProgress` + Task 2 resolution. Priority Conquest>Prosperity>Endurance, loss = capital fall → Task 2 kind ladder (`defeat` first, then conquest/prosperity/endurance). Goals panel → Task 3. Per-kind banner → Task 2. Play-layer only / goldens intact → Global Constraints (no engine edits). ✓

**2. Placeholder scan:** No TBD/TODO; all code, i18n, CSS complete.

**3. Type consistency:** `VictoryProgress` fields produced in Task 1 are read by the same names in Tasks 2-3. `VictoryKind` union defined once (Task 2) and used by `end`/`renderBanner`/the resolution ladder. Constants `PROSPER_CITIES`/`PROSPER_COH`/`PROSPER_STREAK` exported (Task 1) and imported where used. `end(kind, cause?)` new signature — its only caller is the advance handler (Task 2). `victoryKind` replaces `defeatedFlag` everywhere it was read (only `renderBanner`). New classes/keys (`.goals`, `goals`, `goalRivals`, `winConquest`, `winProsperity`) match the tests and `playT` calls.
