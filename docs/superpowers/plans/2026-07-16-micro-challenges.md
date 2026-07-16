# Micro-Challenges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three fixed, optional, recognition-only "challenge" feats to the empire sim (Version B) — shown under the victory goals, marked ✓/✗ live, pinged in the chronicle on completion, and recorded in the reign's hall-of-fame entry.

**Architecture:** A pure `src/ui/challenges.ts` module defines the three challenges and a stateless `evaluate(s, ctx, over)` predicate over play-session state. `playApp.ts` owns a tiny per-reign context (`everAttacked`, `minCellsEver`) and a `chalDone` set, renders a `.challenges` row, pings the chronicle on newly-completed feats, and writes completed codes to the legacy entry. An additive optional `LegacyEntry.challenges?` field persists them; the picker annals show a 🏅 badge.

**Tech Stack:** TypeScript, Vite MPA, vitest (jsdom for UI, node for pure). No new dependencies.

## Global Constraints

- Determinism: `challenges.ts` reads `SimState` but NEVER mutates it, and uses NO `s.rng` / `Math.random`. All wiring lives inside `startGame` (playerPolity ≥ 0), so the pure history path (Version A) and golden hashes stay byte-identical.
- Recognition-only: no mechanical effect on stability/combat/ownership. No balance change.
- `noUnusedLocals` is on — no unused imports.
- Run vitest from the worktree root: `C:/projects/WorldMaker/.claude/worktrees/jolly-easley-2721cc`.
- i18n: every user-facing string goes through `playT(lang, key)` with keys in BOTH `en` and `ko` PLAY_UI blocks.
- Tunable placeholder targets (do not hardcode elsewhere): `CHALLENGE_BLITZ_TILES = 100`, `CHALLENGE_BLITZ_YEAR = 200`, `CHALLENGE_PHOENIX_LOW = 15`, `CHALLENGE_PHOENIX_HIGH = 50`.

## File Structure

- Create: `src/ui/challenges.ts` — the 3 challenges + `evaluate` + tunable constants (pure, DOM-free).
- Create: `src/ui/challenges.test.ts` — unit tests for `evaluate` transitions (node env).
- Modify: `src/ui/legacy.ts` — add optional `challenges?: string[]` to `LegacyEntry`.
- Modify: `src/ui/legacy.test.ts` — round-trip the new field.
- Modify: `src/ui/i18n.ts` — new `PLAY_UI` keys (both langs).
- Modify: `src/ui/playApp.ts` — session ctx, `everAttacked`/`minCellsEver` tracking, `renderChallenges`, completion ping, `recordReign` field, picker annals badge.
- Modify: `src/ui/playApp.test.ts` — challenges row renders; completion writes to legacy.
- Modify: `src/theme.css` — `.challenges` / `.challenge-chip` styles + coarse tap sizing.

---

### Task 1: The `challenges.ts` pure module

**Files:**
- Create: `src/ui/challenges.ts`
- Test: `src/ui/challenges.test.ts`

**Interfaces:**
- Consumes: `aggregate`, `YEARS_PER_TICK`, and the `SimState` type from `../engine/historySim`.
- Produces:
  - `type ChallengeState = "active" | "done" | "failed"`
  - `interface ChallengeCtx { everAttacked: boolean; minCellsEver: number }`
  - `interface ChallengeProgress { cells?: number; target?: number; year?: number; low?: boolean }`
  - `interface Challenge { code: "bloodless" | "blitz" | "phoenix"; icon: string; evaluate(s: SimState, ctx: ChallengeCtx, over: boolean): { state: ChallengeState; progress: ChallengeProgress } }`
  - `const CHALLENGES: Challenge[]` (the fixed three, display order)
  - `const CHALLENGE_BLITZ_TILES`, `CHALLENGE_BLITZ_YEAR`, `CHALLENGE_PHOENIX_LOW`, `CHALLENGE_PHOENIX_HIGH`

- [ ] **Step 1: Write the failing test**

Create `src/ui/challenges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SimState } from "../engine/historySim";
import {
  CHALLENGES, CHALLENGE_BLITZ_TILES, CHALLENGE_BLITZ_YEAR,
  CHALLENGE_PHOENIX_LOW, CHALLENGE_PHOENIX_HIGH, type ChallengeCtx,
} from "./challenges";

// minimal fake: aggregate() only reads owner/solidarity over n and polities.length.
// `cells` player-0 tiles; the player is polity 0, always the first entry.
function fake(cells: number, tick: number, alive = true): SimState {
  const n = Math.max(cells, 1);
  const owner = new Int32Array(n).fill(0);
  for (let i = cells; i < n; i++) owner[i] = -1;
  return {
    n, owner, solidarity: new Float32Array(n).fill(0.5),
    polities: [{ id: 0 }], playerPolity: 0, alive: [alive], tick,
  } as unknown as SimState;
}
const get = (code: string) => CHALLENGES.find((c) => c.code === code)!;
const ctx = (o: Partial<ChallengeCtx> = {}): ChallengeCtx => ({ everAttacked: false, minCellsEver: 999, ...o });

describe("bloodless", () => {
  it("fails once the player has attacked", () => {
    expect(get("bloodless").evaluate(fake(10, 5), ctx({ everAttacked: true }), false).state).toBe("failed");
  });
  it("is active mid-reign with no attack, done on a non-defeat ending", () => {
    expect(get("bloodless").evaluate(fake(10, 5), ctx(), false).state).toBe("active");
    expect(get("bloodless").evaluate(fake(10, 50), ctx(), true).state).toBe("done");
  });
  it("is not done if the reign ended in defeat (player not alive)", () => {
    expect(get("bloodless").evaluate(fake(0, 50, false), ctx(), true).state).toBe("active");
  });
});

describe("blitz", () => {
  it("is done at the tile target before the deadline year", () => {
    const year = CHALLENGE_BLITZ_YEAR - 10;
    expect(get("blitz").evaluate(fake(CHALLENGE_BLITZ_TILES, year / 10), ctx(), false).state).toBe("done");
  });
  it("fails once the deadline year passes below target", () => {
    expect(get("blitz").evaluate(fake(CHALLENGE_BLITZ_TILES - 1, (CHALLENGE_BLITZ_YEAR + 10) / 10), ctx(), false).state).toBe("failed");
  });
});

describe("phoenix", () => {
  it("is done only after dropping low then recovering to the high mark", () => {
    expect(get("phoenix").evaluate(fake(CHALLENGE_PHOENIX_HIGH, 30), ctx({ minCellsEver: 999 }), false).state).toBe("active");
    expect(get("phoenix").evaluate(fake(CHALLENGE_PHOENIX_HIGH, 30), ctx({ minCellsEver: CHALLENGE_PHOENIX_LOW }), false).state).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/challenges.test.ts`
Expected: FAIL — "Cannot find module './challenges'".

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/challenges.ts`:

```ts
import type { SimState } from "../engine/historySim";
import { aggregate, YEARS_PER_TICK } from "../engine/historySim";

export type ChallengeState = "active" | "done" | "failed";

// small session history the raw SimState doesn't keep; playApp maintains it across the reign.
export interface ChallengeCtx {
  everAttacked: boolean; // set true the turn the player commits an attack
  minCellsEver: number;  // running min of the player's owned-tile count
}

export interface ChallengeProgress {
  cells?: number; target?: number; year?: number; low?: boolean;
}

export interface Challenge {
  code: "bloodless" | "blitz" | "phoenix";
  icon: string;
  evaluate(s: SimState, ctx: ChallengeCtx, over: boolean): { state: ChallengeState; progress: ChallengeProgress };
}

// tunable placeholder targets (a sweep tunes them post-implementation)
export const CHALLENGE_BLITZ_TILES = 100;
export const CHALLENGE_BLITZ_YEAR = 200;
export const CHALLENGE_PHOENIX_LOW = 15;
export const CHALLENGE_PHOENIX_HIGH = 50;

function playerCells(s: SimState): number {
  return aggregate(s)[s.playerPolity]?.cells ?? 0;
}

export const CHALLENGES: Challenge[] = [
  {
    code: "bloodless", icon: "🕊",
    evaluate(s, ctx, over) {
      if (ctx.everAttacked) return { state: "failed", progress: {} };
      if (over && s.alive[s.playerPolity]) return { state: "done", progress: {} };
      return { state: "active", progress: { year: s.tick * YEARS_PER_TICK } };
    },
  },
  {
    code: "blitz", icon: "⚡",
    evaluate(s, _ctx, _over) {
      const cells = playerCells(s);
      const year = s.tick * YEARS_PER_TICK;
      const progress: ChallengeProgress = { cells, target: CHALLENGE_BLITZ_TILES, year };
      if (cells >= CHALLENGE_BLITZ_TILES) return { state: "done", progress };
      if (year > CHALLENGE_BLITZ_YEAR) return { state: "failed", progress };
      return { state: "active", progress };
    },
  },
  {
    code: "phoenix", icon: "📈",
    evaluate(s, ctx, _over) {
      const cells = playerCells(s);
      const low = ctx.minCellsEver <= CHALLENGE_PHOENIX_LOW;
      const progress: ChallengeProgress = { cells, target: CHALLENGE_PHOENIX_HIGH, low };
      if (low && cells >= CHALLENGE_PHOENIX_HIGH) return { state: "done", progress };
      return { state: "active", progress };
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/challenges.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/ui/challenges.ts src/ui/challenges.test.ts
git commit -m "feat(play): pure micro-challenge module (bloodless/blitz/phoenix)"
```

---

### Task 2: Legacy schema — optional `challenges` field

**Files:**
- Modify: `src/ui/legacy.ts` (the `LegacyEntry` interface, ~line 16)
- Test: `src/ui/legacy.test.ts`

**Interfaces:**
- Produces: `LegacyEntry.challenges?: string[]` — completed challenge codes for the reign; absent = none. `v` stays `1`; reads remain back-compatible (old rows lack it).

- [ ] **Step 1: Write the failing test**

Add to `src/ui/legacy.test.ts` (inside the existing top-level `describe`, or as a new one):

```ts
it("round-trips the optional challenges field, and old rows without it still load", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  recordReign(7, {
    nation: "A335", kind: "endurance", cause: "", year: 500, peakCells: 40, citiesFounded: 2,
    epitaph: { code: "epiEndured", data: {} }, challenges: ["bloodless", "blitz"],
  }, storage);
  const got = loadLegacy(7, storage);
  expect(got[0].challenges).toEqual(["bloodless", "blitz"]);
  // a legacy row saved before this field existed still loads (challenges === undefined)
  store.set("wm:legacy:8", JSON.stringify([{ v: 1, n: 1, nation: "Old", kind: "defeat", cause: "X", year: 100, peakCells: 5, citiesFounded: 0, epitaph: { code: "epiFallen", data: { name: "X" } } }]));
  expect(loadLegacy(8, storage)[0].challenges).toBeUndefined();
});
```

Ensure `recordReign` and `loadLegacy` are imported in the test file (they already are).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/legacy.test.ts`
Expected: FAIL — TypeScript error "object literal may only specify known properties (`challenges`)" or the assertion fails.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/legacy.ts`, add the field to `LegacyEntry` (after `asc?`):

```ts
  asc?: number;                 // ascension level the run was played at (absent for A0 / legacy rows)
  challenges?: string[];        // codes of micro-challenges completed this reign (absent = none)
  epitaph: { code: EpitaphCode; data: Record<string, string | number> };
```

No change needed to `recordReign`/`loadLegacy`: `recordReign` spreads the whole `entry`, and `loadLegacy`'s filter only checks `v`/`n`/`nation`, so the extra optional field passes through untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/legacy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/legacy.ts src/ui/legacy.test.ts
git commit -m "feat(play): additive optional challenges field on the legacy entry"
```

---

### Task 3: The live `.challenges` row (i18n + render + tracking + CSS)

**Files:**
- Modify: `src/ui/i18n.ts` (PLAY_UI en ~line 59, ko ~line 120)
- Modify: `src/ui/playApp.ts` (imports; `startGame` session state; advance-click pre-listener; `renderChallenges`; wire into `renderAll`/`renderPending`)
- Modify: `src/theme.css`
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `CHALLENGES`, `type ChallengeCtx` from `./challenges`; `aggregate` (already imported); `playT` (already imported).
- Produces: a `.challenges` row element in the info rail with one `.challenge-chip` per challenge; session lets `chalCtx: ChallengeCtx` and `chalDone: Set<string>` used by Task 4.

- [ ] **Step 1: Add the i18n keys**

In `src/ui/i18n.ts`, add to the `en` PLAY_UI block:

```ts
    challenges: "Challenges", chalDone: "🏅 Challenge complete: {name}",
    chalBloodless: "Bloodless", chalBlitz: "Blitz", chalPhoenix: "Phoenix",
    tipChalBloodless: "Reach the end of your reign without ever attacking.",
    tipChalBlitz: "Hold at least 100 tiles by year 200.",
    tipChalPhoenix: "Fall to 15 tiles or fewer, then recover to 50.",
```

And to the `ko` PLAY_UI block:

```ts
    challenges: "도전", chalDone: "🏅 도전 달성: {name}",
    chalBloodless: "무혈의 치세", chalBlitz: "전격전", chalPhoenix: "불사조",
    tipChalBloodless: "한 번도 공격하지 않고 치세를 끝까지 이어가세요.",
    tipChalBlitz: "200년 안에 영토 100칸을 확보하세요.",
    tipChalPhoenix: "영토가 15칸 이하로 몰렸다가 50칸으로 부활하세요.",
```

- [ ] **Step 2: Write the failing test**

Add to `src/ui/playApp.test.ts` (inside the `describe("playApp", …)` block):

```ts
it("renders a challenges row with a chip per fixed challenge on the play screen", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const row = root.querySelector(".challenges");
  expect(row).not.toBeNull();
  expect(row!.querySelectorAll(".challenge-chip").length).toBe(3);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts -t "challenges row"`
Expected: FAIL — `.challenges` is null.

- [ ] **Step 4: Implement the row, session state, and tracking**

In `src/ui/playApp.ts`:

(a) Add the import near the other `./` imports:

```ts
import { CHALLENGES, type ChallengeCtx } from "./challenges";
```

(b) In `startGame`, create the row element and session state. Next to the other per-reign `let`s (after `const highlights: DilemmaOutcome[] = [];`, ~line 177) add:

```ts
    const chalCtx: ChallengeCtx = { everAttacked: false, minCellsEver: aggregate(s)[playerPolity]?.cells ?? 0 };
    const chalDone = new Set<string>();
    const chalFailed = new Set<string>(); // latches a failed challenge so a later tick can't flip it to done
```

(c) Create the `.challenges` element alongside `goals` (~line 187) and append it to the info rail right after `goals`. Change the `side.append(...)` line to include it:

```ts
    const challengesRow = document.createElement("div");
    challengesRow.className = "challenges";
```

and update the info-rail append (the existing `side.append(playHome, panel, goals, dilemmaBox, log);`) to:

```ts
    side.append(playHome, panel, goals, challengesRow, dilemmaBox, log);
```

(d) Add an advance-click PRE-listener to catch attacks WITHOUT touching the verbatim handler. Immediately BEFORE the `// --- BEGIN verbatim advance handler` comment (~line 761) add:

```ts
      // pre-listener (runs before the verbatim handler, while pendingAction is still set): a committed
      // attack fails the Bloodless challenge. Kept OUT of the verbatim block on purpose.
      advance.addEventListener("click", () => { if (pendingAction?.type === "attack") chalCtx.everAttacked = true; });
```

(e) Add `renderChallenges` near `renderGoals` (after the `renderGoals` function, ~line 715):

```ts
    function renderChallenges(): void {
      challengesRow.innerHTML = "";
      if (!s.alive[s.playerPolity] && !over) return;
      chalCtx.minCellsEver = Math.min(chalCtx.minCellsEver, aggregate(s)[s.playerPolity]?.cells ?? 0);
      const label = document.createElement("span");
      label.className = "goals-label";
      label.textContent = `${playT(lang, "challenges")}:`;
      challengesRow.appendChild(label);
      for (const ch of CHALLENGES) {
        const { state, progress } = ch.evaluate(s, chalCtx, over);
        if (state === "failed") chalFailed.add(ch.code); // latch failure — a later tick must not flip it to done
        const failed = chalFailed.has(ch.code);
        if (state === "done" && !failed && !chalDone.has(ch.code)) {
          chalDone.add(ch.code); // latch completion + ping the chronicle the first time it lands
          appendLog(playT(lang, "chalDone").replace("{name}", playT(lang, "chal" + ch.code[0].toUpperCase() + ch.code.slice(1))), true);
        }
        const done = chalDone.has(ch.code);
        const chip = document.createElement("span");
        chip.className = "challenge-chip" + (done ? " done" : failed ? " failed" : "");
        const name = playT(lang, "chal" + ch.code[0].toUpperCase() + ch.code.slice(1));
        const mark = done ? "✓ " : failed ? "✗ " : "";
        const prog = !done && !failed && progress.cells !== undefined && progress.target !== undefined
          ? ` ${progress.cells}/${progress.target}` : "";
        chip.textContent = `${mark}${ch.icon} ${name}${prog}`;
        chip.title = playT(lang, "tipChal" + ch.code[0].toUpperCase() + ch.code.slice(1));
        challengesRow.appendChild(chip);
      }
    }
```

Note: `chalFailed` latches `failed` so blitz cannot flip from failed→done after the deadline; `chalDone` latches completion and pings the chronicle once. The `appendLog(... "chalDone" ...)` call means the completion ping is implemented here (Task 4 no longer adds it).

(f) Wire it into the render aggregators. Change `renderAll` (~line 882) and `renderPending` (~line 885) to call it after `renderGoals()`:

```ts
    function renderAll(): void { renderMap(); renderPanel(); renderGoals(); renderChallenges(); renderActions(); renderDilemma(); renderHowto(); renderLegend(); }
    function renderPending(): void { renderMap(); renderPanel(); renderGoals(); renderChallenges(); renderActions(); }
```

- [ ] **Step 5: Add the CSS**

In `src/theme.css`, after the `.goal-chip` / `.goals` rules, add:

```css
.challenges { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
.challenge-chip {
  font-size: 12px; padding: 3px 8px; border-radius: 10px;
  background: #efe6cf; border: 1px solid #cbb784; color: #4a3f2c;
}
.challenge-chip.done { background: #dcecb9; border-color: #8caa4e; color: #3a4a1a; font-weight: 600; }
.challenge-chip.failed { opacity: .5; text-decoration: line-through; }
```

And add `.challenge-chip` to the existing coarse rule (the `@media (pointer: coarse)` block, next to `.goal-chip`):

```css
  .goal-chip, .challenge-chip { padding: 8px 12px; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/ui/playApp.test.ts -t "challenges row"`
Expected: PASS.
Then full file: `npx vitest run src/ui/playApp.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/i18n.ts src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): live challenges row under the victory goals"
```

---

### Task 4: Completion — chronicle ping + record to legacy

**Files:**
- Modify: `src/ui/playApp.ts` (`renderChallenges` ping; `end()` finalize + `recordReign` field)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `chalDone`, `renderChallenges`, `appendLog`, `recordReign` (all in scope).
- Produces: completed codes flow into `recordReign(..., { challenges: [...chalDone] })`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/playApp.test.ts`. This drives Bloodless to completion by ending a reign without attacking (advance years to the end), using a fake storage to capture the legacy write:

```ts
it("records a completed challenge (bloodless) in the legacy entry at reign end", () => {
  const store = new Map<string, string>();
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((k: string, v: string) => void store.set(k, v));
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((k: string) => store.get(k) ?? null);
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  // advance to the end WITHOUT ever choosing an attack → bloodless completes on the endurance ending
  for (let i = 0; i < 60; i++) {
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) break;
    adv.click();
  }
  const raw = store.get("wm:legacy:1");
  expect(raw).toBeTruthy();
  const entry = JSON.parse(raw!)[0];
  expect(entry.challenges).toContain("bloodless");
  spy.mockRestore();
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts -t "records a completed challenge"`
Expected: FAIL — `entry.challenges` is undefined (not yet wired).

- [ ] **Step 3: Record completed challenges at reign end**

The completion chronicle ping is already implemented in `renderChallenges` (Task 3). This step only finalizes and records.

In `end()` (~line 958), BEFORE the `recordReign(...)` call, run `renderChallenges()` one final time so Bloodless (which only completes on a non-defeat ending, when `over` is true) is latched into `chalDone`, then pass the set. Add `renderChallenges();` right after `const sc = scorecard(s);`, and add the `challenges` field to the `recordReign` object:

```ts
      const sc = scorecard(s);
      renderChallenges(); // final pass: latches end-of-reign completions (e.g. bloodless) into chalDone
      recordReign(seed, {
        nation: s.polities[s.playerPolity].name,
        kind, cause,
        year: s.tick * YEARS_PER_TICK,
        peakCells: sc.peakCells,
        citiesFounded: sc.citiesFounded,
        epitaph: composeEpitaph(kind, cause, highlights),
        ...(s.ascension > 0 ? { asc: s.ascension } : {}),
        ...(chalDone.size ? { challenges: [...chalDone] } : {}),
      });
```

Note: `renderChallenges` already guards `if (!s.alive[player] && !over) return;` — at `end()`, `over` is true, so it runs even on a defeat ending (Bloodless returns active on defeat, so it is NOT latched — correct).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/playApp.test.ts -t "records a completed challenge"`
Expected: PASS.
Then: `npx vitest run src/ui/playApp.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): chronicle ping + legacy record on challenge completion"
```

---

### Task 5: Picker annals badge for completed challenges

**Files:**
- Modify: `src/ui/playApp.ts` (`renderPicker` legacy-row build, ~line 156)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `LegacyEntry.challenges` (Task 2), `loadLegacy` (in scope).
- Produces: a 🏅 badge (one medal per completed challenge) appended to each annals row that has completions.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/playApp.test.ts`. Seed a legacy row with challenges into storage, then open the picker and assert a medal shows:

```ts
it("shows a challenge medal in the picker annals for reigns that completed one", () => {
  const store = new Map<string, string>();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((k: string) => store.get(k) ?? null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((k: string, v: string) => void store.set(k, v));
  store.set("wm:legacy:1", JSON.stringify([{
    v: 1, n: 1, nation: "A335", kind: "endurance", cause: "", year: 500, peakCells: 40, citiesFounded: 2,
    epitaph: { code: "epiEndured", data: {} }, challenges: ["bloodless", "blitz"],
  }]));
  const root = document.createElement("div");
  createPlayApp(root, 1);
  const annals = root.querySelector(".legacy-row");
  expect(annals).not.toBeNull();
  expect(annals!.textContent).toContain("🏅");
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts -t "challenge medal"`
Expected: FAIL — the row text has no 🏅.

- [ ] **Step 3: Implement the badge**

In `renderPicker`, the annals row builds `row.textContent = ...` (~line 156-160). Append one medal per completed challenge. Change the assignment to also include the medals:

```ts
        row.textContent =
          `${playT(lang, "legacyReignN").replace("{n}", String(e.n))} · ${e.nation} · ` +
          `${ICON[e.kind] ?? "•"} ${playYear(lang, e.year)} — "${playLegacyEpitaph(lang, e.epitaph.code, e.epitaph.data)}"` +
          (e.asc ? ` ⬆${e.asc}` : "") +
          (e.challenges?.length ? " " + "🏅".repeat(e.challenges.length) : "") +
          star;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/playApp.test.ts -t "challenge medal"`
Expected: PASS.
Then the full suite: `npx vitest run` — Expected: all pass.
Then build: `npm run build` — Expected: no type errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): challenge medals in the picker annals"
```

---

## Post-implementation

- Live-verify in the real browser (play.html): the challenges row shows 3 chips; advancing years updates Blitz progress; completing one flips the chip to ✓ and pings the chronicle; the picker annals show 🏅 after a completing reign. Check no console errors.
- Number tuning (N/Y/L/M) is a follow-up sweep — see the spec "Out of scope".
