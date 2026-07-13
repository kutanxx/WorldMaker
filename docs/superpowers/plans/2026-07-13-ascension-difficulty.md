# Ascension Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wins on a seed auto-raise its difficulty (A1–A5): every rival's cohesion regenerates faster by one dial, the picker shows the ladder step, and the annals record which step each win happened at.

**Architecture:** UI derives the level from the existing per-seed legacy annals (`ascensionLevel` = wins capped at 5, no new storage). The engine gets one gated nudge in stepSim's solidarity loop (`ASCENSION_SOL_DELTA · level` for non-player polities) behind a new optional `initPlaySim` parameter — `initSim` leaves `ascension: 0`, so the pure path is byte-identical. `recordReign` stores the run's level in an optional `asc` field for the annals marker.

**Tech Stack:** TypeScript, vitest (+jsdom for UI tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-ascension-difficulty-design.md`

## Global Constraints

- Run all test commands from the WORKTREE root. Baseline before Task 1: 518 passing.
- **Pure path byte-identical**: golden FNV hash tests untouched; the nudge is gated `s.playerPolity >= 0 && s.ascension > 0` and `initSim` sets `ascension: 0`. No rng draws added/reordered.
- `initPlaySim`'s new parameter is OPTIONAL (`ascension = 0`) — every existing call site (picker `agg0`, `startGame`, dozens of tests) compiles unchanged.
- Every user-facing play string in BOTH `PLAY_UI.en` and `PLAY_UI.ko`.
- Verbatim advance handler untouched.
- `ASCENSION_SOL_DELTA = 0.005` initial; pre-authorized levers 0.003 / 0.008 per the sweep — the implementer reports numbers, the session lead adjudicates.
- Commit style `feat(play): …`.

---

### Task 1: Engine — `ascension` state + one cohesion-regen dial (+ sweep)

**Files:**
- Modify: `src/engine/historySim.ts` (SimState interface ~line 82-96; `initSim` return ~line 264; solidarity loop ~lines 274-285; consts near GRUDGE_TICKS/REVENGE_MULT)
- Modify: `src/engine/playSim.ts` (`initPlaySim` at lines 14-22)
- Test: `src/engine/historySim.test.ts`

**Interfaces:**
- Produces (Tasks 2-3 rely on these):
  - `SimState.ascension: number` (0 on the pure path).
  - `export const ASCENSION_SOL_DELTA = 0.005;` and `export const ASCENSION_CAP = 5;` in `historySim.ts` (the CAP lives engine-side so Task 2's UI derivation and the engine agree; Task 2 re-uses it via import).
  - `initPlaySim(world, seed, playerPolity, stance, ascension = 0)` — clamps to `[0, ASCENSION_CAP]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/historySim.test.ts` (imports to extend: `ASCENSION_SOL_DELTA` from `./historySim` — `initSim`/`initPlaySim`/`playTurn`/`generateWorld`/`DEFAULT_PARAMS` are already imported in this file; `playTurn`/`initPlaySim` come from `./playSim` there — check the file head and follow its existing import split):

```ts
  it("ascension: rivals regenerate faster, the player does not; pure init stays at 0", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
    expect(initSim(world, 4).ascension).toBe(0);

    const a0 = initPlaySim(world, 4, 0, "internal");
    const a5 = initPlaySim(world, 4, 0, "internal", 5);
    expect(a0.ascension).toBe(0);
    expect(a5.ascension).toBe(5);
    playTurn(a0, null);
    playTurn(a5, null);
    // pick one rival cell and one player cell present in both runs (same seed ⇒ same initial map)
    let rival = -1, mine = -1;
    for (let c = 0; c < a0.n; c++) {
      if (rival < 0 && a0.owner[c] > 0 && !a0.polities[a0.owner[c]].free) rival = c;
      if (mine < 0 && a0.owner[c] === 0) mine = c;
      if (rival >= 0 && mine >= 0) break;
    }
    expect(a5.solidarity[rival]).toBeCloseTo(a0.solidarity[rival] + 5 * ASCENSION_SOL_DELTA, 5);
    expect(a5.solidarity[mine]).toBeCloseTo(a0.solidarity[mine], 5);
  });

  it("initPlaySim clamps ascension into [0, cap]", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
    expect(initPlaySim(world, 4, 0, "internal", 99).ascension).toBe(5);
    expect(initPlaySim(world, 4, 0, "internal", -3).ascension).toBe(0);
  });
```

(Note: after ONE tick the delta is exactly `level · ASCENSION_SOL_DELTA` only while neither cell hits the 0/1 clamps or a floor (CITY/ECON) — if `toBeCloseTo` fails on seed 4 because the chosen cells clamp or the a5 owner map already diverged, scan for a rival/player cell pair whose solidarity is mid-range (0.2–0.8) in BOTH runs and whose owner matches across runs, instead of the first found. One tick of divergence is unlikely but possible; make the search robust rather than weakening the assertion.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/engine/historySim.test.ts`
Expected: FAIL — `ASCENSION_SOL_DELTA` not exported / `ascension` undefined / extra argument rejected.

- [ ] **Step 3: Implement**

3a. `src/engine/historySim.ts` — consts (next to `GRUDGE_TICKS`/`REVENGE_MULT`):

```ts
export const ASCENSION_CAP = 5;          // ladder ceiling — the annals ★ stays comparable
export const ASCENSION_SOL_DELTA = 0.005; // per level per tick: every rival regenerates this much faster
```

3b. `SimState` interface: add `ascension: number; // 0 = off (always 0 on the pure path); play sets 1..ASCENSION_CAP` next to `playerPolity`.

3c. `initSim`'s returned object literal (~line 264): add `ascension: 0,` (keep field order readable — next to `playerPolity: -1`).

3d. Solidarity loop — immediately after the player's stance-nudge line (`if (s.playerPolity >= 0 && o === s.playerPolity) sv += STANCE_SOL_DELTA[s.stance];`):

```ts
    // ascension (play only): every rival regenerates faster — the ONE difficulty dial. Real
    // stored solidarity, so the border report and meters stay honest. Free polities returned
    // above; the playerPolity gate keeps the pure path byte-identical.
    if (s.playerPolity >= 0 && s.ascension > 0 && o !== s.playerPolity) sv += ASCENSION_SOL_DELTA * s.ascension;
```

(Verify the free-polity branch really `continue`s before this point — it does today at ~line 277 (`if (s.polities[o].free) { nextSol[c] = FREE_SOL; continue; }`); if the file drifted, add `&& !s.polities[o].free`.)

3e. `src/engine/playSim.ts` — `initPlaySim`:

```ts
export function initPlaySim(world: World, seed: number, playerPolity: number, stance: Stance, ascension = 0): SimState {
  const s = initSim(world, seed);
  s.playerPolity = playerPolity;
  s.stance = stance;
  s.ascension = Math.max(0, Math.min(ASCENSION_CAP, ascension));
  ...
```

(add `ASCENSION_CAP` to the existing import from `./historySim`; rest of the body unchanged.)

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 518 + 2 = 520 passing — including golden hashes; tsc clean.

- [ ] **Step 5: Calibration sweep (throwaway — numbers into the report, file NOT committed)**

Temporary test file (deleted before commit): seeds 1–10 × levels {0, 3, 5}, `initPlaySim(world, seed, 0, "internal", level)`, `playTurn(s, null)` until `finished` (max 50), record survival ticks + final player cells per run. Report the full table + medians. Expected shape: A0 = today's numbers; A5 median clearly below A0 (harder) but ≥1 seed still survives 50 ticks passively (not hopeless). DO NOT change ASCENSION_SOL_DELTA yourself — report; the session lead adjudicates (levers 0.003 / 0.008). Delete the file; `git status` must be clean of it.

- [ ] **Step 6: Commit**

```bash
git add src/engine/historySim.ts src/engine/playSim.ts src/engine/historySim.test.ts
git commit -m "feat(play): ascension state + cohesion-regen dial — one gated nudge, pure path untouched"
```

---

### Task 2: Legacy — level derivation + asc recording

**Files:**
- Modify: `src/ui/legacy.ts` (LegacyEntry interface, `recordReign` passthrough is automatic via the Omit type; add `ascensionLevel`)
- Test: `src/ui/legacy.test.ts`

**Interfaces:**
- Consumes: `ASCENSION_CAP` from `../engine/historySim`.
- Produces (Task 3 relies on):
  - `LegacyEntry.asc?: number` (optional — v1 schema kept, `loadLegacy`'s filter untouched).
  - `export function ascensionLevel(entries: LegacyEntry[]): number` — wins (`kind !== "defeat"`) capped at `ASCENSION_CAP`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/legacy.test.ts` (follow the file's existing in-memory-storage idiom; add `ascensionLevel` to its imports from `./legacy`):

```ts
describe("ascensionLevel", () => {
  const win = (n: number): LegacyEntry => ({ v: 1, n, nation: "X", kind: "endurance", cause: "", year: 500, peakCells: 10, citiesFounded: 0, epitaph: { code: "epiEndured", data: {} } });
  const loss = (n: number): LegacyEntry => ({ ...win(n), kind: "defeat", cause: "Y", epitaph: { code: "epiFallen", data: { name: "Y" } } });

  it("counts wins only, capped at 5; empty annals mean level 0", () => {
    expect(ascensionLevel([])).toBe(0);
    expect(ascensionLevel([loss(1), loss(2)])).toBe(0);
    expect(ascensionLevel([win(1), loss(2), win(3)])).toBe(2);
    expect(ascensionLevel([1, 2, 3, 4, 5, 6, 7].map(win))).toBe(5);
  });

  it("recordReign round-trips the optional asc field", () => {
    const store = mem(); // the file's existing in-memory StorageLike helper — reuse its real name
    recordReign(7, { nation: "X", kind: "endurance", cause: "", year: 500, peakCells: 10, citiesFounded: 0, epitaph: { code: "epiEndured", data: {} }, asc: 3 }, store);
    expect(loadLegacy(7, store)[0].asc).toBe(3);
  });
});
```

(If `LegacyEntry` isn't currently imported by the test file, add the type import. If the in-memory storage helper has a different name, reuse the file's own.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/legacy.test.ts`
Expected: FAIL — `ascensionLevel` not exported; the `asc` property rejected by the type.

- [ ] **Step 3: Implement in `src/ui/legacy.ts`**

3a. Import: `import { ASCENSION_CAP } from "../engine/historySim";`

3b. `LegacyEntry` gains one optional field (after `citiesFounded`):

```ts
  asc?: number;                 // ascension level the run was played at (absent for A0 / legacy rows)
```

(`recordReign`'s `Omit<LegacyEntry, "v" | "n">` picks it up automatically; `loadLegacy`'s tolerant filter needs no change.)

3c. Add:

```ts
// StS ladder, derived — wins on this seed raise its difficulty; defeats never punish a retry.
export function ascensionLevel(entries: LegacyEntry[]): number {
  return Math.min(ASCENSION_CAP, entries.filter((e) => e.kind !== "defeat").length);
}
```

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 520 + 2 = 522 passing; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/legacy.ts src/ui/legacy.test.ts
git commit -m "feat(play): ascension ladder derived from the annals — wins only, capped"
```

---

### Task 3: Picker badge + annals marker + wiring the level into the sim

**Files:**
- Modify: `src/ui/playApp.ts` (imports; `renderPicker` badge + annals row; `startGame`'s `initPlaySim` call at ~line 134; `end()`'s `recordReign` at ~line 888)
- Modify: `src/ui/i18n.ts` (2 keys × 2 languages)
- Modify: `src/theme.css` (badge style)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `ascensionLevel` (Task 2), `initPlaySim(..., ascension)` (Task 1), existing `loadLegacy`/`recordReign`, existing `.daily-badge` placement in `renderPicker` (~lines 63-67) and annals row template (~line 124).
- Produces: DOM contract — `.asc-badge` next to the picker title when level > 0 (absent at level 0), with non-empty `title`; annals rows show `⬆{n}` when the entry has `asc`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts` (imports: `recordReign` from `./legacy` if not present):

```ts
  it("the picker shows the ascension badge after a win on this seed, and the annals mark the level", () => {
    const SEED = 424242; // unlikely to collide with other tests' legacy keys
    localStorage.removeItem(`wm:legacy:${SEED}`);
    try {
      const fresh = document.createElement("div");
      createPlayApp(fresh, SEED);
      expect(fresh.querySelector(".asc-badge")).toBeNull(); // A0: no badge

      recordReign(SEED, { nation: "X", kind: "endurance", cause: "", year: 500, peakCells: 10, citiesFounded: 0, epitaph: { code: "epiEndured", data: {} }, asc: 0 });
      recordReign(SEED, { nation: "X", kind: "conquest", cause: "", year: 300, peakCells: 90, citiesFounded: 2, epitaph: { code: "epiUnified", data: {} }, asc: 1 });
      const root = document.createElement("div");
      createPlayApp(root, SEED);
      const badge = root.querySelector(".asc-badge") as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain("2");         // two wins ⇒ A2 next
      expect(badge.title.length).toBeGreaterThan(0);
      const rows = [...root.querySelectorAll(".legacy-row")].map((r) => r.textContent || "");
      expect(rows.some((t) => t.includes("⬆1"))).toBe(true); // the A1 win is marked
    } finally {
      localStorage.removeItem(`wm:legacy:${SEED}`);
    }
  });
```

(Two `createPlayApp` calls on the same seed generate the same world twice — accepted cost, mirrors the daily-badge test's pattern.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — no `.asc-badge`.

- [ ] **Step 3: Implement**

3a. `src/ui/playApp.ts` imports: add `ascensionLevel` to the existing `./legacy` import.

3b. `renderPicker` — compute once near the existing `const legacy = loadLegacy(seed);` line: `const asc = ascensionLevel(legacy);` Then, right after the daily-badge block (~line 67), add:

```ts
    if (asc > 0) {
      const tag = document.createElement("span");
      tag.className = "asc-badge";
      tag.textContent = playT(lang, "ascBadge").replace("{n}", String(asc));
      tag.title = playT(lang, "ascTip").replace(/\{n\}/g, String(asc));
      title.appendChild(tag);
    }
```

3c. Annals row (~line 124) — append the marker to the row template: after the epitaph segment, add `` + (e.asc ? ` ⬆${e.asc}` : "") `` (keep the ★ suffix logic as the last element; exact splice point: read the current template literal and insert before the `${star}` interpolation).

3d. `startGame` (~line 134): `const s = initPlaySim(world, seed, playerPolity, "internal", ascensionLevel(loadLegacy(seed)));`

3e. `end()`'s `recordReign` call (~line 888): add `asc: s.ascension,` to the entry object (record even 0? No — keep the annals clean: `...(s.ascension > 0 ? { asc: s.ascension } : {}),`).

3f. i18n — `PLAY_UI.en`: `ascBadge: "⬆ Ascension {n}", ascTip: "{n} wins on this world — every rival's cohesion regenerates {n} steps faster.",` · `PLAY_UI.ko`: `ascBadge: "⬆ 상승 {n}", ascTip: "이 세계에서 {n}승 — 모든 라이벌의 결속 회복이 {n}단계 강해집니다.",` (place next to `dailyBadge`/`dailyTip`).

3g. `src/theme.css` — next to `.daily-badge`:

```css
.asc-badge { font-size: 0.5em; vertical-align: middle; margin-left: 10px; padding: 3px 8px; border-radius: 10px; background: rgba(122, 47, 47, 0.16); white-space: nowrap; }
```

- [ ] **Step 4: Full suite + typecheck + build**

Run: `npx vitest run` then `npm run build`
Expected: 522 + 1 = 523 passing; build clean. (The `agg0` startup `initPlaySim` call deliberately stays at level 0 — it only sizes nations for the picker; verify no test asserts otherwise.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): ascension badge + annals marker — the ladder is visible and recorded"
```

---

## Post-plan verification (session lead, not a task)

- Full suite + `npm run build`; adjudicate the Task 1 sweep (keep 0.005 / lever 0.003 or 0.008) BEFORE the final review.
- Live: fresh seed → no badge; seed a win via localStorage (or play one out) → reload → `⬆ 상승 1` badge + tooltip; annals row shows `⬆1` after the next recorded win; A>0 run's border report shows rivals holding higher cohesion than an A0 control.
- Whole-branch review (seams: initPlaySim call sites, pure-path byte identity, ASCENSION_CAP single-source between engine and UI, badge coexistence with the daily badge on the same title).
