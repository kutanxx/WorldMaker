# Play UI Outcome Preview + Turn Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the player commits a turn, show what their chosen action/dilemma choice will do (Into the Breach / Reigns), and make the advance button state the turn (Civ).

**Architecture:** A read-only `previewDilemma` joins `resolveDilemma` in `src/engine/dilemma.ts` (play layer — never runs in Version A), sharing extracted helpers so preview cannot drift from resolve. The play UI (`src/ui/playApp.ts`) renders effect badges on the standing meters, effect lines under dilemma choices, folds the `.action-status` span into the advance-button label, and adds an advisor button. Spec: `docs/superpowers/specs/2026-07-10-play-ui-preview-turn-guide-design.md`.

**Tech Stack:** TypeScript, Vite MPA, vitest (jsdom for UI tests), plain DOM (no framework).

## Global Constraints

- Everything is play-layer/UI: engine golden hashes must stay byte-identical (`npm test` includes the golden test; nothing here may touch `stepSim`/`initSim` behavior).
- `previewDilemma` NEVER calls `s.rng()` and NEVER mutates `SimState` (gambles report `odds`).
- The verbatim advance handler in `renderActions` (`// --- BEGIN verbatim advance handler` … `END ---`) must not be modified.
- Every user-facing string goes in the `PLAY_UI` KO+EN tables in `src/ui/i18n.ts` (both languages, every key).
- No confirmation dialogs anywhere (dialog-fatigue rule from the spec).
- Run vitest **from the worktree root** (`C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`), never from the main repo root (it globs worktree copies).
- Baseline: 415 tests green before Task 1.

---

### Task 1: `previewDilemma` + shared selection helpers (engine/dilemma.ts)

**Files:**
- Modify: `src/engine/dilemma.ts` (helpers extracted from `resolveDilemma:76-127`)
- Test: `src/engine/dilemma.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: existing `Dilemma`, `SimState`, `borderTargets`, `predictCapture`, consts `CONCEDE_MAX_CELLS`, `CRUSH_ODDS`.
- Produces (later tasks rely on these exact exports from `src/engine/dilemma.ts`):
  - `export interface ChoicePreview { cells?: number; cohesion?: -2 | -1 | 1 | 2; odds?: number; truce?: "break" | "gain"; note?: "fortify" | "noTarget" }`
  - `export function previewDilemma(s: SimState, d: Dilemma, choice: "a" | "b"): ChoicePreview`
  - `export function bestRaidTarget(s: SimState): { cell: number; gain: number } | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/dilemma.test.ts` (reuses the file's existing `biggestPlayerState`/`forceOffer` fixtures; add `previewDilemma`, `bestRaidTarget` to the line-6 import):

```ts
describe("previewDilemma", () => {
  it("is read-only: no rng draw, no state mutation", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.2;
    const d = forceOffer(s, "unrest")!;
    const rng = s.rng; let calls = 0;
    s.rng = () => { calls++; return rng(); };
    const owner = [...s.owner], sol = [...s.solidarity];
    previewDilemma(s, d, "a"); previewDilemma(s, d, "b");
    expect(calls).toBe(0);
    expect([...s.owner]).toEqual(owner);
    expect([...s.solidarity]).toEqual(sol);
    s.rng = rng;
  });

  it("unrest: concede preview matches the cells resolve actually sheds; crush reports odds, not a roll", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.2;
    const d = forceOffer(s, "unrest")!;
    const pa = previewDilemma(s, d, "a");
    const pb = previewDilemma(s, d, "b");
    expect(pa.cohesion).toBe(1);
    expect(pb.cohesion).toBe(1);
    expect(pb.odds).toBeGreaterThan(0);
    expect(pb.odds).toBeLessThan(1);
    const out = resolveDilemma(s, d, "a"); // resolve AFTER previews
    expect(out.code).toBe("unrestConcede");
    expect(pa.cells).toBe(-Number(out.data.n));
  });

  it("raiders: raid preview equals the raid's real capture count (shared bestRaidTarget)", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === s.playerPolity ? 0.9 : 0.1;
    const d: Dilemma = { code: "raiders", data: { threats: 6 } }; // effects don't read the offer draw
    const bt = bestRaidTarget(s);            // BEFORE resolve — resolve mutates the state
    const pv = previewDilemma(s, d, "b");
    if (bt) expect(pv.cells).toBe(bt.gain); else expect(pv.note).toBe("noTarget");
    const out = resolveDilemma(s, d, "b");
    if (out.code === "raidersRaid") expect(Number(out.data.n)).toBe(pv.cells);
    else expect(pv.note).toBe("noTarget");
    expect(previewDilemma(s, d, "a")).toEqual({ note: "fortify" });
  });

  it("prosperity: frontier reads as the stronger boost; defector previews flip + truce", () => {
    const s = biggestPlayerState(1, true);
    expect(previewDilemma(s, { code: "prosperity", data: {} }, "a")).toEqual({ cohesion: 1 });
    expect(previewDilemma(s, { code: "prosperity", data: {} }, "b")).toEqual({ cohesion: 2 });
    const d = forceOffer(s, "defector");
    if (d) {
      expect(previewDilemma(s, d, "a")).toEqual({ cells: 1, truce: "break" });
      expect(previewDilemma(s, d, "b")).toEqual({ truce: "gain" });
    }
  });
});
```

Also add the type import if TS complains: `import { offerDilemma, resolveDilemma, previewDilemma, bestRaidTarget, DILEMMA_COOLDOWN, type Dilemma } from "./dilemma";`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/dilemma.test.ts`
Expected: FAIL — `previewDilemma` / `bestRaidTarget` are not exported.

- [ ] **Step 3: Implement — extract shared helpers, add previewDilemma**

In `src/engine/dilemma.ts`, add above `resolveDilemma`:

```ts
// the border cells the concede choice would shed, worst cohesion first — shared by
// resolveDilemma and previewDilemma so the preview cannot drift from the real effect
function concedeCells(s: SimState): number[] {
  const border: number[] = [];
  for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity && isBorder(s, c)) border.push(c);
  border.sort((x, y) => s.solidarity[x] - s.solidarity[y]);
  return border.slice(0, CONCEDE_MAX_CELLS);
}

// the punitive raid's target: the capturable border cell with the biggest breakthrough.
// Exported: the play UI's advisor uses the same pick for "a good moment to expand".
export function bestRaidTarget(s: SimState): { cell: number; gain: number } | null {
  let best: { cell: number; gain: number } | null = null;
  for (const t of borderTargets(s)) {
    if (!t.capturable) continue;
    const gain = predictCapture(s, t.cell).length;
    if (!best || gain > best.gain) best = { cell: t.cell, gain };
  }
  return best;
}

// what a choice would do, as glyph-able data — read-only, and NEVER draws from s.rng
// (gambles report `odds`; the roll happens only in resolveDilemma)
export interface ChoicePreview {
  cells?: number;               // signed projected cell delta
  cohesion?: -2 | -1 | 1 | 2;   // direction weight (▼▼ ▼ ▲ ▲▲)
  odds?: number;                // when set: `cohesion` with this probability, reversed otherwise
  truce?: "break" | "gain";
  note?: "fortify" | "noTarget";
}
export function previewDilemma(s: SimState, d: Dilemma, choice: "a" | "b"): ChoicePreview {
  if (d.code === "unrest") {
    return choice === "a" ? { cells: -concedeCells(s).length, cohesion: 1 }
      : { cohesion: 1, odds: CRUSH_ODDS };
  }
  if (d.code === "raiders") {
    if (choice === "a") return { note: "fortify" };
    const best = bestRaidTarget(s);
    return best ? { cells: best.gain } : { note: "noTarget" };
  }
  if (d.code === "prosperity") return choice === "a" ? { cohesion: 1 } : { cohesion: 2 };
  return choice === "a" ? { cells: 1, truce: "break" } : { truce: "gain" }; // defector
}
```

Then refactor `resolveDilemma` to use them — behavior-identical:

```ts
// unrest choice "a" body becomes:
if (choice === "a") {
  const shed = concedeCells(s);
  for (const c of shed) { s.owner[c] = -1; s.solidarity[c] = 0; }
  nudgePlayerSol(s, CONCEDE_SOL, "nation");
  return { code: "unrestConcede", data: { n: shed.length } };
}
```

```ts
// raiders choice "b" body becomes:
const best = bestRaidTarget(s);
if (!best) return { code: "raidersNoTarget", data: {} };
const r = applyIntervention(s, { type: "attack", cell: best.cell });
if (!r.ok) return { code: "raidersNoTarget", data: {} };
return { code: "raidersRaid", data: { name: String(r.data?.name ?? ""), n: Number(r.data?.n ?? 1) } };
```

Delete the now-inlined `border`-collection and `best`-loop code from the old bodies. Nothing else in the file changes.

- [ ] **Step 4: Run the dilemma suite — new tests pass, EXISTING tests untouched and green**

Run: `npx vitest run src/engine/dilemma.test.ts`
Expected: PASS, including every pre-existing test (they pin that the refactor is behavior-identical).

- [ ] **Step 5: Run the full suite (golden guard)**

Run: `npx vitest run`
Expected: 415 + 4 new = 419 passing (golden hash test green — dilemma.ts never runs on the pure-history path).

- [ ] **Step 6: Commit**

```bash
git add src/engine/dilemma.ts src/engine/dilemma.test.ts
git commit -m "feat(play): previewDilemma — read-only choice projections sharing resolve's selection helpers"
```

---

### Task 2: `playDilemmaFx` formatter + all new i18n keys (ui/i18n.ts)

**Files:**
- Modify: `src/ui/i18n.ts` (PLAY_UI tables at lines ~56-131, new function after `playT`)
- Test: Create `src/ui/i18nPlayFx.test.ts`

**Interfaces:**
- Consumes: `ChoicePreview` (type-only import from Task 1), `playT`, `Lang`.
- Produces: `export function playDilemmaFx(lang: Lang, pv: ChoicePreview): string` — Tasks 4 uses it. Also all i18n keys Tasks 3-6 use (exact keys listed below).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/i18nPlayFx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { playDilemmaFx, playT } from "./i18n";

describe("playDilemmaFx", () => {
  it("formats cell and cohesion deltas with direction glyphs", () => {
    expect(playDilemmaFx("ko", { cells: -5, cohesion: 1 })).toBe("국력 ▼5셀 · 결속 ▲");
    expect(playDilemmaFx("ko", { cells: 3 })).toBe("국력 ▲+3셀");
    expect(playDilemmaFx("en", { cohesion: 2 })).toBe("cohesion ▲▲");
  });
  it("renders a gamble as odds + reversed failure, never a resolved outcome", () => {
    const line = playDilemmaFx("ko", { cohesion: 1, odds: 0.5 });
    expect(line).toContain("50%");
    expect(line).toContain("▲");
    expect(line).toContain("▼"); // the failure direction is shown too
  });
  it("formats truce changes and the two note codes", () => {
    expect(playDilemmaFx("ko", { cells: 1, truce: "break" })).toBe("국력 ▲+1셀 · 휴전 파기");
    expect(playDilemmaFx("en", { truce: "gain" })).toBe(playT("en", "fxTruceGain"));
    expect(playDilemmaFx("ko", { note: "fortify" })).toBe(playT("ko", "fxFortify"));
    expect(playDilemmaFx("en", { note: "noTarget" })).toBe(playT("en", "fxNoTarget"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/i18nPlayFx.test.ts`
Expected: FAIL — `playDilemmaFx` is not exported.

- [ ] **Step 3: Implement — keys + formatter**

Add to BOTH `PLAY_UI.en` and `PLAY_UI.ko` (en / ko values):

```ts
// en:
fxFortify: "frontier cohesion ▲ · interior ▼", fxNoTarget: "no target to strike",
fxOdds: "{p}% success", fxFail: "fail",
fxTruceBreak: "breaks the truce", fxTruceGain: "truce +1 (10y)",
fxOwn: "your action", fxCityNext: "city #{n} planned",
advFound: "🏘 found city", advPeace: "🕊 peace",
advanceAlertTip: "An unanswered card expires with the decade.",
adviseAct: "Do it", adviseStance: "Go defensive",
// ko:
fxFortify: "국경 결속 ▲ · 내지 ▼", fxNoTarget: "칠 곳 없음",
fxOdds: "성공 {p}%", fxFail: "실패",
fxTruceBreak: "휴전 파기", fxTruceGain: "휴전 +1 (10년)",
fxOwn: "내 행동 효과", fxCityNext: "{n}번째 도시 예정",
advFound: "🏘 도시 건설", advPeace: "🕊 강화",
advanceAlertTip: "답하지 않은 카드는 이 턴이 끝나면 사라집니다.",
adviseAct: "실행", adviseStance: "방어 태세로",
```

Add after `playT` (type-only import — no runtime cycle: dilemma.ts does not import i18n):

```ts
import type { ChoicePreview } from "../engine/dilemma";

// the localized effect line under a dilemma choice, composed from its read-only preview
export function playDilemmaFx(lang: Lang, pv: ChoicePreview): string {
  if (pv.note === "fortify") return playT(lang, "fxFortify");
  if (pv.note === "noTarget") return playT(lang, "fxNoTarget");
  const parts: string[] = [];
  if (pv.cells) {
    const glyph = pv.cells > 0 ? `▲+${pv.cells}` : `▼${-pv.cells}`;
    parts.push(`${playT(lang, "strength")} ${glyph}${playT(lang, "cells")}`);
  }
  if (pv.cohesion) {
    const up = pv.cohesion > 0;
    const glyph = up ? "▲".repeat(pv.cohesion) : "▼".repeat(-pv.cohesion);
    const line = `${playT(lang, "cohesion")} ${glyph}`;
    parts.push(pv.odds === undefined ? line
      : `${playT(lang, "fxOdds").replace("{p}", String(Math.round(pv.odds * 100)))}: ${line} / ${playT(lang, "fxFail")}: ${up ? "▼" : "▲"}`);
  }
  if (pv.truce === "break") parts.push(playT(lang, "fxTruceBreak"));
  if (pv.truce === "gain") parts.push(playT(lang, "fxTruceGain"));
  return parts.join(" · ");
}
```

Note the `import type` line goes at the top of the file with the other imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/i18nPlayFx.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/i18n.ts src/ui/i18nPlayFx.test.ts
git commit -m "feat(play): playDilemmaFx formatter + i18n keys for outcome previews and turn guide"
```

---

### Task 3: Action-preview badges on the standing meters (ui/playApp.ts)

**Files:**
- Modify: `src/ui/playApp.ts` (`renderPanel:329-403`, `renderGoals:405-412`, click sites at lines 175-179, 195-199, 439-442, 460-463, 469)
- Modify: `src/theme.css` (append after the `.meter` block, ~line 171)
- Test: `src/ui/playApp.test.ts` (append)

**Interfaces:**
- Consumes: `predictCapture` (already imported), `CONQUEST_SOL` (extend the existing `../engine/historySim` import), local `investEffect`, closure `pendingAction`.
- Produces: local `renderPending()` — Tasks 5-6 call it; CSS classes `.fx-badge.good/.bad`, `.fx-label` — Task 4's `.choice-fx` also lands in this CSS block.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/playApp.test.ts`:

```ts
it("selecting an attack previews its own effect on both meters (▲ cells, ▼ cohesion)", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  expect(root.querySelector(".fx-badge")).toBeNull(); // no pending action → no badges
  // mirror the click mechanism the existing attack test (~playApp.test.ts:100-106) uses
  const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
  target.dispatchEvent(new MouseEvent("click"));
  const sBadge = root.querySelector(".meter-strength .fx-badge");
  const cBadge = root.querySelector(".meter-cohesion .fx-badge");
  expect(sBadge?.textContent).toContain("▲");
  expect(cBadge?.textContent).toContain("▼");      // overexpansion made visible
  expect(root.querySelector(".fx-label")).not.toBeNull(); // "your action" scoping label
});

it("invest previews cohesion only; pass clears all badges", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  (root.querySelector(".invest-seg button") as HTMLButtonElement).click();
  expect(root.querySelector(".meter-cohesion .fx-badge")?.textContent).toContain("▲");
  expect(root.querySelector(".meter-strength .fx-badge")).toBeNull();
  (root.querySelector(".btn-pass") as HTMLButtonElement).click();
  expect(root.querySelector(".fx-badge")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: the two new tests FAIL (no `.fx-badge` rendered); all existing tests still PASS.

- [ ] **Step 3: Implement**

(a) Extend the historySim import in `playApp.ts` with `CONQUEST_SOL`.

(b) Add next to `investEffect` (after line 120):

```ts
// projected effect of the player's OWN pending action on the meters — read-only.
// Deliberately excludes the world's response (bots move in the same advance); the
// .fx-label "your action" scopes the claim so the preview never reads as a lie.
function actionFx(): { cells?: number; coh?: number; threat?: "up" | "down" } | null {
  if (!pendingAction) return null;
  if (pendingAction.type === "attack") {
    const k = predictCapture(s, pendingAction.cell).length || 1;
    let n = 0, sum = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) { n++; sum += s.solidarity[c]; }
    const dCoh = n ? ((sum + k * CONQUEST_SOL) / (n + k) - sum / n) * 100 : 0; // raw %p, rounded at display
    const breaks = (s.truces.get(s.owner[pendingAction.cell]) ?? 0) > s.tick;
    return { cells: k, coh: dCoh, ...(breaks ? { threat: "up" as const } : {}) };
  }
  if (pendingAction.type === "invest") return { coh: investEffect(pendingAction.scope).gain };
  if (pendingAction.type === "peace") return { threat: "down" };
  return null; // foundCity — the goals line carries its hint (renderGoals)
}
function fxBadge(text: string, good: boolean): HTMLElement {
  const b = document.createElement("span");
  b.className = `fx-badge ${good ? "good" : "bad"}`;
  b.textContent = text;
  return b;
}
```

(c) In `renderPanel`, capture the meter rows and append badges. Replace lines 361 and 370 (`meters.appendChild(meterRow(...))`) with:

```ts
const strengthRow = meterRow("meter-strength", playT(lang, "strength"), strengthVal, st.strength, playT(lang, "tipStrength"));
meters.appendChild(strengthRow);
```

```ts
const cohRow = meterRow("meter-cohesion", playT(lang, "cohesion"), cohVal, st.cohesionState, playT(lang, "tipCohesion"));
meters.appendChild(cohRow);
```

then directly after `panel.appendChild(meters);` (line 371):

```ts
const fx = actionFx();
if (fx) {
  if (fx.cells) strengthRow.appendChild(fxBadge(`▲+${fx.cells}${playT(lang, "cells")}`, true));
  if (fx.coh) {
    // direction always shows; the magnitude only when it wouldn't round to 0 (tiny attacks on a
    // large realm shift the average by <0.1%p — "▼" alone is honest, "▼−0%p" is nonsense)
    const up = fx.coh > 0;
    const mag = Math.round(Math.abs(fx.coh) * 10) / 10;
    cohRow.appendChild(fxBadge(`${up ? "▲" : "▼"}${mag >= 0.1 ? `${up ? "+" : "−"}${mag}%p` : ""}`, up));
  }
  const label = document.createElement("span");
  label.className = "fx-label";
  label.textContent = playT(lang, "fxOwn");
  meters.appendChild(label);
}
```

and on the threat line, after line 378 (`threat.textContent = ...`):

```ts
if (fx?.threat === "up") threat.appendChild(fxBadge(`▲ ${playT(lang, "fxTruceBreak")}`, false));
if (fx?.threat === "down") threat.appendChild(fxBadge(`▼ ${playT(lang, "truce")} +1`, true)); // spec: 위협 ▼ 휴전 +1
```

(d) In `renderGoals`, extend the foundCity case — after the existing `goals.textContent` assignment add:

```ts
if (pendingAction?.type === "foundCity") {
  goals.textContent += ` · 🏘 ${playT(lang, "fxCityNext").replace("{n}", String(vp.cities + 1))}`;
}
```

(e) **Repaint the panel when an action is picked.** Add next to `renderAll` (line 555):

```ts
// a picked-but-uncommitted action must repaint the meters/goals too, not just map+bar
function renderPending(): void { renderMap(); renderPanel(); renderGoals(); renderActions(); }
```

Replace the body `renderMap(); renderActions();` with `renderPending();` at all five click sites: attack target click (~line 176-178), site click (~line 196-198), invest buttons (~line 440-441), peace select change (~line 461-462), pass button (~line 469). (`renderPending` is hoisted — function declarations are usable before their line.)

(f) Append to `src/theme.css` after the meter block:

```css
/* outcome preview: badges = projected effect of the player's own pending action */
.fx-badge { font-size: 11px; font-weight: 700; margin-left: 6px; white-space: nowrap; }
.fx-badge.good { color: #3f7d4e; }
.fx-badge.bad { color: #a63d36; }
.standing .fx-label { font-size: 10px; color: #8a7a5e; align-self: flex-end; }
.choice-fx { display: block; font-size: 11px; font-weight: 400; color: #6a5a40; margin-top: 2px; }
```

- [ ] **Step 4: Run the playApp suite**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): meter badges preview the pending action's own effect (attack shows the overexpansion cost)"
```

---

### Task 4: Effect lines under dilemma choice buttons (ui/playApp.ts)

**Files:**
- Modify: `src/ui/playApp.ts` (`renderDilemma:532-553`, import line 5 area for dilemma imports, line 14 for i18n imports)
- Test: `src/ui/playApp.test.ts` (append)

**Interfaces:**
- Consumes: `previewDilemma` (Task 1), `playDilemmaFx` (Task 2), CSS `.choice-fx` (Task 3).
- Produces: nothing later tasks need.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts` (same hunt-loop pattern as the existing dilemma test at line 206):

```ts
it("each dilemma choice shows a non-empty effect preview line", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  let seen = false;
  for (let i = 0; i < 50 && !seen; i++) {
    if (root.querySelector(".dilemma-a")) {
      const fx = [...root.querySelectorAll(".choice-fx")].map((e) => e.textContent || "");
      expect(fx.length).toBe(2);
      expect(fx[0].length).toBeGreaterThan(2);
      expect(fx[1].length).toBeGreaterThan(2);
      seen = true;
      break;
    }
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) break;
    adv.click();
  }
  expect(seen).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts -t "effect preview line"`
Expected: FAIL — `.choice-fx` count is 0.

- [ ] **Step 3: Implement**

In `playApp.ts`: add `previewDilemma` to the dilemma import (`import { offerDilemma, resolveDilemma, previewDilemma, type Dilemma } from "../engine/dilemma";` — match the existing import's actual shape) and `playDilemmaFx` to the i18n import at line 14.

In `renderDilemma`, inside the `for (const [key, label] of ...)` loop, replace `btn.textContent = label;` with:

```ts
btn.textContent = label;
const fx = document.createElement("span");
fx.className = "choice-fx";
fx.textContent = playDilemmaFx(lang, previewDilemma(s, dilemma, key));
btn.appendChild(fx); // inside the button: the whole card stays one big click target
```

- [ ] **Step 4: Run the playApp suite**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS (new test + the existing dilemma answer/clear test both green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): dilemma choices show Reigns-style effect previews (direction glyphs + honest odds)"
```

---

### Task 5: Advance button states the turn; `.action-status` removed (ui/playApp.ts)

**Files:**
- Modify: `src/ui/playApp.ts` (`renderActions:414-513`), `src/ui/i18n.ts` (delete 6 dead keys ×2 langs)
- Modify: `src/ui/playApp.test.ts:23,68,71,106,135` (retarget `.action-status` selectors)

**Interfaces:**
- Consumes: `predictCapture`, `investEffect`, closure `dilemma`; i18n keys `advFound`, `advPeace`, `advanceAlertTip` (Task 2).
- Produces: `.btn-advance` label format `"{advance} — {summary}"`; `.advance-alert` dot. Task 6's test asserts against this label format.

- [ ] **Step 1: Retarget existing tests + add new ones (failing first)**

In `src/ui/playApp.test.ts` update the five `.action-status` usages:
- line 23: `expect(root.querySelector(".action-status")).not.toBeNull();` → `expect(root.querySelector(".action-status")).toBeNull(); // folded into the advance button`
- line 68 (`toContain("Found")`): assert on the advance button instead → `expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("🏘");`
- line 71 (`toContain("Invest")`) → `expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("💰");`
- line 106 (`toContain("Attack")`) → `expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("⚔");`
- line 135 (`toContain("Found")`) → `expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("🏘");`

Append two new tests:

```ts
it("the advance button states the pending turn (icon + magnitude), and only then", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const adv = () => (root.querySelector(".btn-advance") as HTMLButtonElement).textContent || "";
  expect(adv()).not.toContain("⚔");
  expect(adv()).not.toContain("💰");
  const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
  target.dispatchEvent(new MouseEvent("click"));
  expect(adv()).toContain("⚔");
  expect(adv()).toMatch(/\+\d/); // magnitude, e.g. +3
  (root.querySelector(".btn-pass") as HTMLButtonElement).click();
  expect(adv()).not.toContain("⚔");
});

it("an unanswered dilemma puts a subtle alert dot on the advance button (never a dialog)", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  let checked = false;
  for (let i = 0; i < 50 && !checked; i++) {
    if (root.querySelector(".dilemma-a")) {
      expect(root.querySelector(".btn-advance .advance-alert")).not.toBeNull();
      (root.querySelector(".dilemma-a") as HTMLButtonElement).click();
      expect(root.querySelector(".btn-advance .advance-alert")).toBeNull(); // answered → dot gone
      checked = true;
      break;
    }
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) break;
    adv.click();
  }
  expect(checked).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify the new/retargeted ones fail**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: retargeted + new tests FAIL (status span still exists, button label static); untouched tests PASS.

- [ ] **Step 3: Implement**

In `renderActions` (`playApp.ts:414-513`):

(a) Delete the `status` span block (lines 420-428) and remove `status` from the final `actions.append(...)` (line 512).

(b) Replace `advance.textContent = playT(lang, "advance");` (line 473) with:

```ts
// the button states the turn — Civ's Next Turn as the single anchor (replaces .action-status)
const summary = () =>
  !pendingAction ? ""
    : pendingAction.type === "attack" ? ` — ⚔ +${predictCapture(s, pendingAction.cell).length || 1}${playT(lang, "cells")}`
      : pendingAction.type === "foundCity" ? ` — ${playT(lang, "advFound")}`
        : pendingAction.type === "peace" ? ` — ${playT(lang, "advPeace")}`
          : ` — 💰 ${playT(lang, pendingAction.scope === "border" ? "investFrontierOpt" : "investRealmOpt")} +${investEffect(pendingAction.scope).gain}%p`;
advance.textContent = playT(lang, "advance") + summary();
if (dilemma) {
  const dot = document.createElement("span");
  dot.className = "advance-alert";
  dot.textContent = " ❗";
  dot.title = playT(lang, "advanceAlertTip");
  advance.appendChild(dot);
}
```

(The verbatim advance handler below it is untouched — this only changes the label above the handler registration.)

(c) In `src/ui/i18n.ts` delete the six now-dead keys from BOTH langs: `noAction`, `attackChosen`, `investRealmChosen`, `investFrontierChosen`, `foundChosen`, `peaceChosen`, `peacePlaceholder` stays (peace select still uses it). Verify with `grep -rn "attackChosen\|noAction\|investRealmChosen\|investFrontierChosen\|foundChosen\|peaceChosen" src/` → only i18n.ts table lines remain before deleting; keep any key that still has a caller.

(d) Append to `src/theme.css`:

```css
.btn-advance .advance-alert { color: #a63d36; font-size: 12px; }
```

- [ ] **Step 4: Run the full playApp suite**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS — all retargeted + new + untouched tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): advance button states the turn (icon+magnitude, dilemma alert dot); action-status folded in"
```

---

### Task 6: Clickable advisor — advice selects, never executes (ui/playApp.ts)

**Files:**
- Modify: `src/ui/playApp.ts` (advice block in `renderPanel:398-402`, `adviceKey:294-304` untouched)
- Test: `src/ui/playApp.test.ts` (append)

**Interfaces:**
- Consumes: `bestRaidTarget` (Task 1, add to the dilemma import), `foundCityTargets` (already imported; sorted best-first by sol), `renderPending` (Task 3), `setStance` (already imported), i18n `adviseAct`/`adviseStance` (Task 2).
- Produces: `.advise-act` button.

- [ ] **Step 1: Probe which advice fires at seed 1, turn 0**

Run: `npx vitest run src/ui/playApp.test.ts -t "advice line"` then add a THROWAWAY console log or quick probe:

```bash
node -e "console.log('probe via test below')"
```

Simplest probe: temporarily append to the existing "advice line" test `console.log(root.querySelector('.advice')!.textContent)` , run, note which advice string appears (💡 결속…/국경…/확장…/정세…), remove the log. The new test below asserts the concrete behavior for that advice type; write the assertion to match (all four branches produce a button unless the branch's target list is empty — expand/build omit it when nothing qualifies).

- [ ] **Step 2: Write the failing test**

Append (adjust the inner expectation per the probe — the skeleton asserts the invariant that holds for every branch):

```ts
it("the advice line's button selects a pending action or stance — it never advances the turn", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const year = root.querySelector(".play-year")!.textContent;
  const act = root.querySelector(".advise-act") as HTMLButtonElement | null;
  expect(act).not.toBeNull(); // seed-1 turn-0 advice is actionable (per probe)
  const advBefore = (root.querySelector(".btn-advance") as HTMLElement).textContent;
  const stanceBefore = (root.querySelector(".view-toggle button.active") as HTMLElement)?.textContent;
  act!.click();
  expect(root.querySelector(".play-year")!.textContent).toBe(year); // did NOT advance
  const advAfter = (root.querySelector(".btn-advance") as HTMLElement).textContent;
  const stanceAfter = (root.querySelector(".view-toggle button.active") as HTMLElement)?.textContent;
  expect(advAfter !== advBefore || stanceAfter !== stanceBefore).toBe(true); // something got selected
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts -t "never advances"`
Expected: FAIL — `.advise-act` is null.

- [ ] **Step 4: Implement**

In `playApp.ts`, add `bestRaidTarget` to the dilemma import. Add below `adviceKey` (line 304):

```ts
// the advisor's one consistent semantic: SELECT (pendingAction + map preview), never execute.
// adviceDefend is the labeled exception — stance is an instant free toggle, not an action.
function adviceAction(key: string): { stance?: boolean; run: () => void } | null {
  if (key === "adviceLowSol")
    return { run: () => { pendingAction = { type: "invest", scope: "nation" }; renderPending(); } };
  if (key === "adviceDefend")
    return { stance: true, run: () => { setStance(s, "defensive"); renderAll(); } };
  if (key === "adviceExpand") {
    const t = bestRaidTarget(s); // same pick the raiders raid uses
    return t ? { run: () => { pendingAction = { type: "attack", cell: t.cell }; renderPending(); } } : null;
  }
  const site = foundCityTargets(s)[0]; // sorted best-first by cohesion
  return site ? { run: () => { pendingAction = { type: "foundCity", cell: site.cell }; renderPending(); } } : null;
}
```

Replace the advice block (lines 399-402) with:

```ts
const advice = document.createElement("div");
advice.className = "advice";
const key = adviceKey();
advice.textContent = playT(lang, key);
const act = adviceAction(key);
if (act) {
  const b = document.createElement("button");
  b.className = "advise-act";
  b.textContent = playT(lang, act.stance ? "adviseStance" : "adviseAct");
  b.addEventListener("click", act.run);
  advice.appendChild(b);
}
panel.appendChild(advice);
```

Append to `src/theme.css`:

```css
.advice .advise-act { margin-left: 8px; font-size: 11px; padding: 1px 8px; font-style: normal; }
```

- [ ] **Step 5: Run the playApp suite**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): clickable advisor — advice selects the recommended action (map-previewed), never executes"
```

---

### Task 7: Full verification — suite, build, live DOM checks

**Files:** none new (fixes only if something fails)

- [ ] **Step 1: Full test suite from the worktree root**

Run: `npx vitest run`
Expected: all green (415 baseline + ~10 new). The world.test golden-hash test MUST pass unchanged.

- [ ] **Step 2: Type-check + production build**

Run: `npm run build`
Expected: clean build, no TS errors.

- [ ] **Step 3: Live DOM verification (harness cannot screenshot — use eval)**

Start the dev server via preview_start, then verify with preview_eval on `/play.html` (pick a nation programmatically, click a `.target-cell.capturable`, then assert): `.fx-badge` count ≥ 2 and `.meter-cohesion .fx-badge` contains ▼; `.btn-advance` text contains ⚔ and +N; select invest → badge flips to cohesion-only; if a `.dilemma` card is up, two `.choice-fx` lines have text; `.advise-act` exists and clicking it changes `.btn-advance` text without changing `.play-year`; computed colors: `.fx-badge.bad` is the red `#a63d36`, `.fx-badge.good` the green `#3f7d4e`.

- [ ] **Step 4: Ask the user to eyeball layout/feel at localhost:5173/play.html** (visual look is user's-eyes-only per harness limits), then hand off per finishing-a-development-branch.
