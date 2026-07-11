# Dilemma Depth: State Cards + Chain + Crisis Arc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the play mode's dilemma system with 2 state-triggered cards, a 2-card prophecy chain, and a 3-act hegemon crisis arc — all previewed honestly through the existing `previewDilemma`/`playDilemmaFx` pipeline.

**Architecture:** All game logic lives in `src/engine/dilemma.ts` (play-only, never on the pure-history path). `SimState` gains one play-only field `dilemmaFlags: Set<string>` (the `truces`/`foundedCities` precedent). The play UI needs ZERO changes — `renderDilemma` renders any card via `playDilemma(code)` and previews via `previewDilemma`+`playDilemmaFx`, so new codes flow through automatically once i18n faces exist. Spec: `docs/superpowers/specs/2026-07-11-dilemma-depth-crisis-arc-design.md`.

**Tech Stack:** TypeScript, vitest. No new dependencies.

## Global Constraints

- Engine golden hashes byte-identical: `dilemmaFlags` is initialized in `initSim` but NEVER read on the pure-history path; the full-suite world.test hash test guards this.
- `previewDilemma` NEVER calls `s.rng()` and NEVER mutates `SimState` (gambles report `odds`, thresholds report the condition).
- Effects use existing primitives only: `nudgePlayerSol`, `s.owner` flips, `s.truces` writes.
- Every user-facing string in BOTH `playDilemma`/`playDilemmaOutcome`/PLAY_UI KO and EN branches.
- Selection logic shared between resolve and preview via named helpers (the anti-drift pattern).
- Scope locked: exactly 7 new card faces (warweary, boomtown, prophecy1, prophecy2, hegemon1, hegemon2, hegemon3).
- Run vitest from the worktree root `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`, never from the main repo root.
- Baseline: 428 tests green at branch tip `d1ffcf0`.
- STRICT GIT: no reset/rebase/checkout/restore/clean; `git add` only files named in the task; verify branch + expected HEAD before each commit.

---

### Task 1: Formatter groundwork — `playDilemmaFx` odds-wrapping + new note codes

**Files:**
- Modify: `src/engine/dilemma.ts` (ONLY the `ChoicePreview` interface, lines ~99-105)
- Modify: `src/ui/i18n.ts` (`playDilemmaFx` at ~lines 145-163; PLAY_UI keys)
- Test: `src/ui/i18nPlayFx.test.ts` (append)

**Interfaces:**
- Consumes: existing `ChoicePreview`, `playT`.
- Produces (later tasks rely on): `ChoicePreview.note: "fortify" | "noTarget" | "noEffect" | "citywall" | "prophecyDeal" | "prophecyCond"`, new field `pct?: number`; `playDilemmaFx` renders gambles as `성공 p%: {ALL parts} / 실패: {negated parts}` and renders the four new notes; PLAY_UI keys `fxNoEffect`, `fxCitywall`, `fxProphecyDeal`, `fxProphecyCond` (with `{p}` slot); `fxTruceGain` value becomes duration-agnostic.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/i18nPlayFx.test.ts` inside the existing `describe`:

```ts
  it("a gamble with cells AND cohesion wraps the whole effect, failure fully negated", () => {
    const line = playDilemmaFx("ko", { cells: 8, cohesion: 1, odds: 0.62 });
    expect(line).toBe("성공 62%: 국력 ▲+8셀 · 결속 ▲ / 실패: 국력 ▼8셀 · 결속 ▼");
  });
  it("renders the new note codes, including the live prophecy condition percent", () => {
    expect(playDilemmaFx("en", { note: "noEffect" })).toBe(playT("en", "fxNoEffect"));
    expect(playDilemmaFx("ko", { note: "citywall" })).toBe(playT("ko", "fxCitywall"));
    expect(playDilemmaFx("en", { note: "prophecyDeal" })).toBe(playT("en", "fxProphecyDeal"));
    const cond = playDilemmaFx("ko", { note: "prophecyCond", pct: 47 });
    expect(cond).toContain("47%");
    expect(cond).toContain("50%"); // the threshold is stated
  });
  it("fxTruceGain no longer states a duration (durations live in choice labels)", () => {
    expect(playT("en", "fxTruceGain")).not.toMatch(/10|y\)/);
    expect(playT("ko", "fxTruceGain")).not.toContain("10년");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/i18nPlayFx.test.ts`
Expected: 3 new tests FAIL (old odds format wraps cohesion only; notes unknown; fxTruceGain says "10y"). The 3 pre-existing tests must still PASS (they reference values via `playT`, not literals — except the first test's literal expectations which don't involve odds/truce, so they hold).

- [ ] **Step 3: Implement**

(a) In `src/engine/dilemma.ts`, replace the `ChoicePreview` interface with:

```ts
export interface ChoicePreview {
  cells?: number;               // signed projected cell delta
  cohesion?: -2 | -1 | 1 | 2;   // direction weight (▼▼ ▼ ▲ ▲▲)
  odds?: number;                // when set: the whole effect with this probability, reversed otherwise
  truce?: "break" | "gain";
  note?: "fortify" | "noTarget" | "noEffect" | "citywall" | "prophecyDeal" | "prophecyCond";
  pct?: number;                 // live value for prophecyCond (current cohesion %)
}
```

(b) In `src/ui/i18n.ts`, replace the body of `playDilemmaFx` with:

```ts
export function playDilemmaFx(lang: Lang, pv: ChoicePreview): string {
  if (pv.note === "fortify") return playT(lang, "fxFortify");
  if (pv.note === "noTarget") return playT(lang, "fxNoTarget");
  if (pv.note === "noEffect") return playT(lang, "fxNoEffect");
  if (pv.note === "citywall") return playT(lang, "fxCitywall");
  if (pv.note === "prophecyDeal") return playT(lang, "fxProphecyDeal");
  if (pv.note === "prophecyCond") return playT(lang, "fxProphecyCond").replace("{p}", String(pv.pct ?? 0));
  // compose the effect parts once; a gamble shows them twice (success, then fully negated failure)
  const part = (cells?: number, cohesion?: number): string[] => {
    const out: string[] = [];
    if (cells) out.push(`${playT(lang, "strength")} ${cells > 0 ? `▲+${cells}` : `▼${-cells}`}${playT(lang, "cells")}`);
    if (cohesion) out.push(`${playT(lang, "cohesion")} ${cohesion > 0 ? "▲".repeat(cohesion) : "▼".repeat(-cohesion)}`);
    return out;
  };
  const parts = part(pv.cells, pv.cohesion);
  if (pv.truce === "break") parts.push(playT(lang, "fxTruceBreak"));
  if (pv.truce === "gain") parts.push(playT(lang, "fxTruceGain"));
  if (pv.odds === undefined) return parts.join(" · ");
  const fail = part(pv.cells === undefined ? undefined : -pv.cells,
    pv.cohesion === undefined ? undefined : -pv.cohesion).join(" · ");
  return `${playT(lang, "fxOdds").replace("{p}", String(Math.round(pv.odds * 100)))}: ${parts.join(" · ")} / ${playT(lang, "fxFail")}: ${fail}`;
}
```

(c) PLAY_UI key changes — in `en`:

```ts
fxTruceGain: "truce secured",
fxNoEffect: "no effect", fxCitywall: "cohesion ▲▲ around the city",
fxProphecyDeal: "cohesion ▼ now · judged next decade",
fxProphecyCond: "▲▲ if cohesion ≥50%, ▼ if below · now {p}%",
```

and in `ko`:

```ts
fxTruceGain: "휴전 확보",
fxNoEffect: "변화 없음", fxCitywall: "도시 주변 결속 ▲▲",
fxProphecyDeal: "지금 결속 ▼ · 다음 십년에 심판",
fxProphecyCond: "결속 50% 이상이면 ▲▲, 미만이면 ▼ · 지금 {p}%",
```

(`fxTruceGain` REPLACES the old `"truce +1 (10y)"`/`"휴전 +1 (10년)"` values.)

NOTE: the spec sketched "playDilemmaFx gains an optional data arg" for the live percent; the implemented mechanism is the `pct` field on ChoicePreview (computed inside `previewDilemma`, keeping the playApp call-site unchanged). Same honest information, fewer moving parts — documented refinement.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/i18nPlayFx.test.ts`
Expected: 6/6 PASS. Also run `npx vitest run src/ui/playApp.test.ts` (37/37 — the peace-preview badge test uses `playT(lang,"truce")`, not `fxTruceGain`, and the unrest gamble line's new failure format still contains ▼).

- [ ] **Step 5: Commit**

```bash
git add src/engine/dilemma.ts src/ui/i18n.ts src/ui/i18nPlayFx.test.ts
git commit -m "feat(play): playDilemmaFx gambles wrap the whole effect; new preview note codes"
```

---

### Task 2: State cards — 전쟁 피로 warweary + 도시의 성장 boomtown

**Files:**
- Modify: `src/engine/dilemma.ts` (consts, DilemmaCode, offerDilemma inserts, resolveDilemma branches, previewDilemma branches, 2 shared helpers)
- Modify: `src/ui/i18n.ts` (`playDilemma` + `playDilemmaOutcome`, both langs)
- Test: `src/engine/dilemma.test.ts` (append)

**Interfaces:**
- Consumes: `nudgePlayerSol`, `frontEdges`, `aggregate`, `s.foundedCities`, `s.truces`, Task 1's note codes.
- Produces: codes `"warweary" | "boomtown"` in `DilemmaCode`; exported consts `WARWEARY_MIN_THREATS=4, WARWEARY_MAX_ASA=0.5, WARWEARY_PROB=0.4, WARWEARY_LEVY_SOL=0.1, WARWEARY_LEVY_INTERIOR_SOL=0.03, WARWEARY_TERMS_SOL=0.03, WARWEARY_TRUCE_TICKS=2, BOOMTOWN_PROB=0.25, BOOMTOWN_CHARTER_SOL=0.04, BOOMTOWN_WALL_SOL=0.15`; private helpers `biggestThreatFoe(s): number`, `cityWallCells(s, city): number[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/dilemma.test.ts` (imports: add `previewDilemma` usages exist; add `WARWEARY_TRUCE_TICKS` to the dilemma import):

```ts
describe("state cards", () => {
  it("warweary: fires under threat with sagging cohesion; terms buys a truce with the top threat", () => {
    const s = biggestPlayerState(1, true);
    // player sagging (0.45 < WARWEARY_MAX_ASA, but above unrest's 0.42) and OUTMATCHED at the
    // border (threat edges need the ENEMY side to be the stronger one — hence enemies at 0.9)
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === s.playerPolity ? 0.45 : 0.9;
    const d = forceOffer(s, "warweary");
    expect(d?.code).toBe("warweary");
    if (!d) return;
    expect(previewDilemma(s, d, "a")).toEqual({ note: "fortify" });
    const pb = previewDilemma(s, d, "b");
    const out = resolveDilemma(s, d, "b");
    if (out.code === "warwearyTerms") {
      expect(pb).toEqual({ cohesion: -1, truce: "gain" });
      // the truce really exists, with the named polity, for 2 ticks
      const foe = s.polities.findIndex((p) => p.name === out.data.name);
      expect((s.truces.get(foe) ?? 0)).toBe(s.tick + WARWEARY_TRUCE_TICKS);
    } else {
      expect(out.code).toBe("warwearyNoFoe");
      expect(pb).toEqual({ note: "noTarget" });
    }
  });

  it("boomtown: needs a held founded city; walls lift the city and its owned neighbors", () => {
    const s = biggestPlayerState(1, true);
    // plant a founded city on a player cell with player-owned neighbors
    let city = -1;
    for (let c = 0; c < s.n && city < 0; c++) {
      if (s.owner[c] !== s.playerPolity) continue;
      if (s.grid.neighbors[c].every((nb) => s.owner[nb] === s.playerPolity)) city = c;
    }
    expect(city).toBeGreaterThanOrEqual(0);
    s.foundedCities.add(city);
    const d = forceOffer(s, "boomtown");
    expect(d?.code).toBe("boomtown");
    if (!d) return;
    expect(Number(d.data.cell)).toBe(city);
    expect(previewDilemma(s, d, "a")).toEqual({ cohesion: 1 });
    expect(previewDilemma(s, d, "b")).toEqual({ note: "citywall" });
    const before = s.solidarity[city];
    const out = resolveDilemma(s, d, "b");
    expect(out.code).toBe("boomtownWall");
    expect(Number(out.data.n)).toBe(1 + s.grid.neighbors[city].length); // city + all neighbors owned
    expect(s.solidarity[city]).toBeGreaterThan(before);
  });

  it("boomtown never fires without a held founded city", () => {
    const s = biggestPlayerState(1, true);
    expect(forceOffer(s, "boomtown", 64)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/dilemma.test.ts`
Expected: new tests FAIL (`forceOffer` never yields the unknown codes). Pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `src/engine/dilemma.ts`:

(a) Consts (after the existing const block):

```ts
export const WARWEARY_MIN_THREATS = 4, WARWEARY_MAX_ASA = 0.5, WARWEARY_PROB = 0.4;
export const WARWEARY_LEVY_SOL = 0.1, WARWEARY_LEVY_INTERIOR_SOL = 0.03, WARWEARY_TERMS_SOL = 0.03, WARWEARY_TRUCE_TICKS = 2;
export const BOOMTOWN_PROB = 0.25, BOOMTOWN_CHARTER_SOL = 0.04, BOOMTOWN_WALL_SOL = 0.15;
```

(b) `DilemmaCode` becomes:

```ts
export type DilemmaCode = "unrest" | "raiders" | "warweary" | "boomtown" | "prosperity" | "defector";
```

(Task 3/4 extend it further.)

(c) Shared helpers (place after `nudgePlayerSol`):

```ts
// the polity throwing the most threat edges at the player. NOTE: FrontEdge.enemy is a CELL
// index, not a polity id — s.owner[] maps it. Shared by resolve and preview (anti-drift).
function biggestThreatFoe(s: SimState): number {
  const counts = new Map<number, number>();
  for (const e of frontEdges(s)) {
    if (e.kind !== "threat") continue;
    const p = s.owner[e.enemy];
    if (p >= 0) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best = -1, bestN = 0;
  for (const [p, n] of counts) if (n > bestN) { best = p; bestN = n; }
  return best;
}
// the founded city cell + its player-owned neighbors (the wall's reach) — shared with preview
function cityWallCells(s: SimState, city: number): number[] {
  const cells = s.owner[city] === s.playerPolity ? [city] : [];
  for (const nb of s.grid.neighbors[city]) if (s.owner[nb] === s.playerPolity) cells.push(nb);
  return cells;
}
```

(d) In `offerDilemma`, directly AFTER the raiders block and BEFORE the defector block, insert:

```ts
  if (threats >= WARWEARY_MIN_THREATS && mine.avg < WARWEARY_MAX_ASA && s.rng() < WARWEARY_PROB) {
    s.lastDilemma = s.tick;
    return { code: "warweary", data: { threats } };
  }
  // boomtown: the strongest founded city still in the player's hands
  let bestCity = -1;
  for (const fc of s.foundedCities) {
    if (s.owner[fc] !== s.playerPolity) continue;
    if (bestCity < 0 || s.solidarity[fc] > s.solidarity[bestCity]) bestCity = fc;
  }
  if (bestCity >= 0 && s.rng() < BOOMTOWN_PROB) {
    s.lastDilemma = s.tick;
    return { code: "boomtown", data: { cell: bestCity } };
  }
```

(the `threats` variable already exists in scope from the raiders block).

(e) In `resolveDilemma`, insert after the raiders branch:

```ts
  if (d.code === "warweary") {
    if (choice === "a") {
      const n = nudgePlayerSol(s, WARWEARY_LEVY_SOL, "border");
      nudgePlayerSol(s, -WARWEARY_LEVY_INTERIOR_SOL, "interior");
      return { code: "warwearyLevy", data: { n } };
    }
    const foe = biggestThreatFoe(s);
    if (foe < 0) return { code: "warwearyNoFoe", data: {} };
    s.truces.set(foe, s.tick + WARWEARY_TRUCE_TICKS);
    nudgePlayerSol(s, -WARWEARY_TERMS_SOL, "nation");
    return { code: "warwearyTerms", data: { name: s.polities[foe].name } };
  }
  if (d.code === "boomtown") {
    if (choice === "a") {
      nudgePlayerSol(s, BOOMTOWN_CHARTER_SOL, "nation");
      return { code: "boomtownCharter", data: {} };
    }
    const cells = cityWallCells(s, Number(d.data.cell));
    for (const c of cells) s.solidarity[c] = Math.min(1, s.solidarity[c] + BOOMTOWN_WALL_SOL);
    return { code: "boomtownWall", data: { n: cells.length } };
  }
```

(f) In `previewDilemma`, insert after the raiders branch:

```ts
  if (d.code === "warweary") {
    if (choice === "a") return { note: "fortify" };
    return biggestThreatFoe(s) >= 0 ? { cohesion: -1, truce: "gain" } : { note: "noTarget" };
  }
  if (d.code === "boomtown") return choice === "a" ? { cohesion: 1 } : { note: "citywall" };
```

(g) i18n faces — in `playDilemma` KO switch add:

```ts
      case "warweary": return { title: "잇단 전쟁에 백성이 지쳐갑니다.", a: "징집을 강화한다 (국경 ▲▲, 내지 ▼)", b: "최대 위협국과 화의를 모색한다 (20년 휴전, 결속 소폭 ▼)" };
      case "boomtown": return { title: "건설한 도시가 크게 성장했습니다.", a: "시장 특허를 내린다 (전국 결속 ▲)", b: "성벽을 증축한다 (도시 주변 ▲▲)" };
```

EN switch:

```ts
    case "warweary": return { title: "The realm wearies of endless war.", a: "Raise the levies (border ▲▲, interior ▼)", b: "Sue for terms with the greatest threat (20y truce, cohesion slightly ▼)" };
    case "boomtown": return { title: "Your founded city booms.", a: "Charter the market (realm cohesion ▲)", b: "Raise the walls (▲▲ around the city)" };
```

`playDilemmaOutcome` KO:

```ts
      case "warwearyLevy": return `국경 ${n}개 셀에 병력을 증강했다.`;
      case "warwearyTerms": return `${name}와(과) 20년 화의를 맺었다. 제후들은 못마땅해한다.`;
      case "warwearyNoFoe": return "화의를 청할 상대가 없었다.";
      case "boomtownCharter": return "시장 특허가 온 나라의 상인을 불러모은다.";
      case "boomtownWall": return `성벽이 올라가 주변 ${n}개 셀이 든든해졌다.`;
```

EN:

```ts
    case "warwearyLevy": return `Levies strengthen ${n} border cells.`;
    case "warwearyTerms": return `Terms agreed with ${name} for 20 years; the lords grumble.`;
    case "warwearyNoFoe": return "There was no foe to treat with.";
    case "boomtownCharter": return "The market charter draws traders from all the realm.";
    case "boomtownWall": return `New walls hearten ${n} cells around the city.`;
```

- [ ] **Step 4: Run the dilemma suite + full suite**

Run: `npx vitest run src/engine/dilemma.test.ts` → all PASS (pre-existing + 3 new).
Run: `npx vitest run` → all PASS (golden hash test included; expected total 431).

- [ ] **Step 5: Commit**

```bash
git add src/engine/dilemma.ts src/ui/i18n.ts src/engine/dilemma.test.ts
git commit -m "feat(play): state cards — war-weariness and boomtown dilemmas (KODP state-triggered events)"
```

---

### Task 3: `dilemmaFlags` + the prophecy chain

**Files:**
- Modify: `src/engine/historySim.ts` (SimState interface ~line 90; initSim return ~line 201)
- Modify: `src/engine/dilemma.ts` (consts, DilemmaCode, offer tier, resolve, preview)
- Modify: `src/ui/i18n.ts` (faces + outcomes, both langs)
- Test: `src/engine/dilemma.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `pct` field + `prophecyDeal`/`prophecyCond`/`noEffect` notes.
- Produces: `SimState.dilemmaFlags: Set<string>` (initialized `new Set()` — Task 4 uses it for hegemon stages); codes `"prophecy1" | "prophecy2"`; exported consts `PROPHECY_PROB=0.15, PROPHECY_ASA=0.5, PROPHECY_COST_SOL=0.03, PROPHECY_BOON_SOL=0.08, PROPHECY_BUST_SOL=0.05`; flags `prophecySponsored`/`prophecyDone`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/dilemma.test.ts`:

```ts
describe("prophecy chain", () => {
  it("sponsoring guarantees the follow-up at the next window; the judgment is the stated threshold", () => {
    const s = biggestPlayerState(1, true);
    const d1 = forceOffer(s, "prophecy1");
    expect(d1?.code).toBe("prophecy1");
    if (!d1) return;
    expect(previewDilemma(s, d1, "a")).toEqual({ cohesion: -1, note: "prophecyDeal" });
    expect(previewDilemma(s, d1, "b")).toEqual({ note: "noEffect" });
    resolveDilemma(s, d1, "a");
    expect(s.dilemmaFlags.has("prophecySponsored")).toBe(true);
    // next window: the follow-up is guaranteed (no probability draw)
    s.lastDilemma = -99;
    const d2 = offerDilemma(s);
    expect(d2?.code).toBe("prophecy2");
    if (!d2) return;
    // the preview states the live condition
    const pv = previewDilemma(s, d2, "a");
    expect(pv.note).toBe("prophecyCond");
    expect(typeof pv.pct).toBe("number");
    // set cohesion decisively above the threshold and proclaim
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.9;
    const out = resolveDilemma(s, d2, "a");
    expect(out.code).toBe("prophecyFulfilled");
    expect(s.dilemmaFlags.has("prophecySponsored")).toBe(false);
    expect(s.dilemmaFlags.has("prophecyDone")).toBe(true);
    // once per reign: never offered again
    expect(forceOffer(s, "prophecy1", 64)).toBeNull();
  });

  it("turning the prophet away ends the chain; a low-cohesion proclamation debunks", () => {
    const s = biggestPlayerState(2, true);
    const d1 = forceOffer(s, "prophecy1");
    if (!d1) return; // seed didn't cooperate — the seed-1 test above carries the chain contract
    resolveDilemma(s, d1, "b");
    expect(s.dilemmaFlags.has("prophecyDone")).toBe(true);
    expect(s.dilemmaFlags.has("prophecySponsored")).toBe(false);
  });

  it("dilemmaFlags is initialized empty and unused by pure history", () => {
    const { world } = generateWorld({ ...small, seed: 3 });
    const s = initSim(world, 3);
    expect(s.dilemmaFlags.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/dilemma.test.ts`
Expected: FAIL — `s.dilemmaFlags` undefined / `prophecy1` never offered.

- [ ] **Step 3: Implement**

(a) `src/engine/historySim.ts` — in the `SimState` interface, after the `lastDilemma` line add:

```ts
  dilemmaFlags: Set<string>;    // dilemma chain/crisis markers (prophecy, hegemon); play UI only
```

and in the `initSim` return object add `dilemmaFlags: new Set()` beside `lastDilemma: -99`.

(b) `src/engine/dilemma.ts` consts:

```ts
export const PROPHECY_PROB = 0.15, PROPHECY_ASA = 0.5, PROPHECY_COST_SOL = 0.03, PROPHECY_BOON_SOL = 0.08, PROPHECY_BUST_SOL = 0.05;
```

`DilemmaCode` gains `"prophecy1" | "prophecy2"`.

(c) In `offerDilemma`, directly AFTER the cooldown check (`if (s.tick - s.lastDilemma < DILEMMA_COOLDOWN) return null;` and the `mine` guard), insert the guaranteed follow-up tier:

```ts
  // chain follow-up: a sponsored prophecy is judged at the next window, guaranteed
  if (s.dilemmaFlags.has("prophecySponsored")) {
    s.lastDilemma = s.tick;
    return { code: "prophecy2", data: {} };
  }
```

and BETWEEN the defector block and the prosperity block, insert the opener draw:

```ts
  if (!s.dilemmaFlags.has("prophecyDone") && s.rng() < PROPHECY_PROB) {
    s.lastDilemma = s.tick;
    return { code: "prophecy1", data: {} };
  }
```

(`prophecySponsored` cannot be set here — the guaranteed tier above would have fired first.)

(d) `resolveDilemma` branches (before the defector fallthrough):

```ts
  if (d.code === "prophecy1") {
    if (choice === "a") {
      nudgePlayerSol(s, -PROPHECY_COST_SOL, "nation");
      s.dilemmaFlags.add("prophecySponsored");
      return { code: "prophecySponsor", data: {} };
    }
    s.dilemmaFlags.add("prophecyDone");
    return { code: "prophecyIgnore", data: {} };
  }
  if (d.code === "prophecy2") {
    s.dilemmaFlags.delete("prophecySponsored");
    s.dilemmaFlags.add("prophecyDone");
    if (choice === "b") return { code: "prophecyBuried", data: {} };
    const avg = aggregate(s)[s.playerPolity]?.avg ?? 0;
    if (avg >= PROPHECY_ASA) {
      nudgePlayerSol(s, PROPHECY_BOON_SOL, "nation");
      return { code: "prophecyFulfilled", data: {} };
    }
    nudgePlayerSol(s, -PROPHECY_BUST_SOL, "nation");
    return { code: "prophecyDebunked", data: {} };
  }
```

(e) `previewDilemma` branches:

```ts
  if (d.code === "prophecy1") return choice === "a" ? { cohesion: -1, note: "prophecyDeal" } : { note: "noEffect" };
  if (d.code === "prophecy2") {
    if (choice === "b") return { note: "noEffect" };
    const pct = Math.round((aggregate(s)[s.playerPolity]?.avg ?? 0) * 100);
    return { note: "prophecyCond", pct };
  }
```

(f) i18n — `playDilemma` KO:

```ts
      case "prophecy1": return { title: "떠돌이 예언자가 왕국의 영광을 예언합니다.", a: "예언자를 후원한다 (지금 ▼, 다음 십년에 심판)", b: "내친다 (변화 없음)" };
      case "prophecy2": return { title: "예언의 시간이 왔습니다 — 나라의 결속이 심판대에 오릅니다.", a: "성취를 선포한다 (결속 ≥50%: ▲▲ / 미만: ▼)", b: "조용히 묻는다 (변화 없음)" };
```

EN:

```ts
    case "prophecy1": return { title: "A wandering prophet foretells your realm's glory.", a: "Sponsor the prophet (▼ now, judged next decade)", b: "Turn them away (no effect)" };
    case "prophecy2": return { title: "The prophecy's hour has come — the realm's cohesion is judged.", a: "Proclaim the fulfilment (cohesion ≥50%: ▲▲ / below: ▼)", b: "Bury it quietly (no effect)" };
```

`playDilemmaOutcome` KO:

```ts
      case "prophecySponsor": return "예언자가 왕실의 이름으로 순회를 시작했다.";
      case "prophecyIgnore": return "예언자는 다른 나라로 떠났다.";
      case "prophecyFulfilled": return "예언이 이루어졌다! 백성이 왕조를 칭송한다.";
      case "prophecyDebunked": return "예언은 빈말이 되었고, 왕실의 체면이 깎였다.";
      case "prophecyBuried": return "예언은 조용히 잊혔다.";
```

EN:

```ts
    case "prophecySponsor": return "The prophet tours in the crown's name.";
    case "prophecyIgnore": return "The prophet moves on to other lands.";
    case "prophecyFulfilled": return "The prophecy is fulfilled! The realm exults.";
    case "prophecyDebunked": return "The prophecy rings hollow; the crown is embarrassed.";
    case "prophecyBuried": return "The prophecy is quietly forgotten.";
```

- [ ] **Step 4: Run the dilemma suite + FULL suite (golden guard — initSim changed)**

Run: `npx vitest run src/engine/dilemma.test.ts` → PASS.
Run: `npx vitest run` → ALL PASS including the world.test golden-hash test (the new field is never read on the pure path). Expected total 434.

- [ ] **Step 5: Commit**

```bash
git add src/engine/historySim.ts src/engine/dilemma.ts src/ui/i18n.ts src/engine/dilemma.test.ts
git commit -m "feat(play): prophecy chain — sponsored prophecy judged next decade against a stated cohesion threshold"
```

---

### Task 4: Hegemon crisis arc (3 acts)

**Files:**
- Modify: `src/engine/dilemma.ts` (consts, DilemmaCode, offer tiers ①/④, resolve, preview, helpers `hegemonFoe`/`endHegemon`/`battleOdds`/`borderCellsBetween`)
- Modify: `src/ui/i18n.ts` (3 faces + 7 outcomes, both langs)
- Test: `src/engine/dilemma.test.ts` (append)

**Interfaces:**
- Consumes: `dilemmaFlags` (Task 3), `hostileNeighbors` (add to the intervention import), `aggregate`, Task 1's odds-wrapping.
- Produces: codes `"hegemon1" | "hegemon2" | "hegemon3"`; exported consts `HEGEMON_MIN_TICK=20, HEGEMON_RATIO=1.6, HEGEMON_SPOILS=8, HEGEMON_RALLY_TICKS=2, HEGEMON_ARM_BORDER_SOL=0.08, HEGEMON_ARM_INTERIOR_SOL=0.02, HEGEMON_TRIBUTE_SOL=0.08, HEGEMON_TRIBUTE_TICKS=3, HEGEMON_DEFY_SOL=0.04, HEGEMON_WIN_SOL=0.06, HEGEMON_LOSE_SOL=0.06, HEGEMON_KNEEL_SOL=0.12`; exported `borderCellsBetween(s, other, k, losing)` (preview-shared); flags `hegemon2`/`hegemon3`/`hegemonDone`/`hegemonFoe:<id>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/dilemma.test.ts` (add `borderCellsBetween`, `HEGEMON_SPOILS`, `HEGEMON_RATIO`, `HEGEMON_MIN_TICK` to the import):

```ts
describe("hegemon crisis arc", () => {
  // a state where the arc's opening condition holds: play the SMALLEST nation late-game
  function hegemonState(seed: number) {
    const s = biggestPlayerState(seed, true);
    const counts = new Map<number, number>();
    for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
    s.playerPolity = sorted[0][0]; // smallest → the biggest rival easily clears 1.6×
    s.tick = HEGEMON_MIN_TICK + 1;
    return s;
  }

  it("opens once past mid-game against a 1.6× rival, then runs act-per-window bypassing the cooldown", () => {
    const s = hegemonState(1);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    expect(d1?.code).toBe("hegemon1");
    if (!d1) return;
    const foe = Number(d1.data.polity);
    expect(s.alive[foe]).toBe(true);
    expect(previewDilemma(s, d1, "a")).toEqual({ truce: "gain" });
    expect(previewDilemma(s, d1, "b")).toEqual({ note: "fortify" });
    resolveDilemma(s, d1, "b");
    expect(s.dilemmaFlags.has("hegemon2")).toBe(true);
    // act 2 fires on the very next offer call — no cooldown wait
    const d2 = offerDilemma(s);
    expect(d2?.code).toBe("hegemon2");
    if (!d2) return;
    expect(previewDilemma(s, d2, "a")).toEqual({ cohesion: -2, truce: "gain" });
    resolveDilemma(s, d2, "b"); // defy
    expect(s.dilemmaFlags.has("hegemon3")).toBe(true);
    const d3 = offerDilemma(s);
    expect(d3?.code).toBe("hegemon3");
    if (!d3) return;
    // the battle preview reports real odds and the real spoils count, no rng draw
    const pv = previewDilemma(s, d3, "a");
    expect(pv.odds).toBeGreaterThanOrEqual(0.2);
    expect(pv.odds).toBeLessThanOrEqual(0.8);
    expect(pv.cells).toBe(borderCellsBetween(s, foe, HEGEMON_SPOILS, "other").length);
    // stub the roll: win
    const rng = s.rng;
    s.rng = () => 0;
    const before = borderCellsBetween(s, foe, HEGEMON_SPOILS, "other");
    const out = resolveDilemma(s, d3, "a");
    s.rng = rng;
    expect(out.code).toBe("hegemonVictory");
    expect(Number(out.data.n)).toBe(before.length);
    for (const c of before) expect(s.owner[c]).toBe(s.playerPolity);
    expect(s.dilemmaFlags.has("hegemonDone")).toBe(true);
    // once per reign
    s.lastDilemma = -99;
    for (let i = 0; i < 32; i++) { s.lastDilemma = -99; expect(offerDilemma(s)?.code ?? "x").not.toMatch(/^hegemon/); }
  });

  it("a lost battle cedes player border cells to the hegemon; tribute ends the arc peacefully", () => {
    const s = hegemonState(2);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    expect(d1?.code).toBe("hegemon1");
    if (!d1) return;
    const foe = Number(d1.data.polity);
    resolveDilemma(s, d1, "a"); // rally: truces with some neighbors, never the hegemon
    expect((s.truces.get(foe) ?? 0) <= s.tick).toBe(true);
    const d2 = offerDilemma(s)!;
    resolveDilemma(s, d2, "b");
    const d3 = offerDilemma(s)!;
    const rng = s.rng;
    s.rng = () => 0.999; // force the rout
    const lost = borderCellsBetween(s, foe, HEGEMON_SPOILS, "player");
    const out = resolveDilemma(s, d3, "a");
    s.rng = rng;
    expect(out.code).toBe("hegemonRout");
    for (const c of lost) expect(s.owner[c]).toBe(foe);
  });

  it("the arc dissolves silently if the hegemon dies between acts", () => {
    const s = hegemonState(3);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    expect(d1?.code).toBe("hegemon1");
    if (!d1) return;
    resolveDilemma(s, d1, "b");
    s.alive[Number(d1.data.polity)] = false;
    const next = offerDilemma(s);
    expect(next?.code ?? "none").not.toMatch(/^hegemon/);
    expect(s.dilemmaFlags.has("hegemonDone")).toBe(true);
    expect(s.dilemmaFlags.has("hegemon2")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/dilemma.test.ts`
Expected: FAIL — hegemon codes never offered.

- [ ] **Step 3: Implement**

In `src/engine/dilemma.ts`:

(a) Add `hostileNeighbors` to the intervention import. Consts:

```ts
export const HEGEMON_MIN_TICK = 20, HEGEMON_RATIO = 1.6, HEGEMON_SPOILS = 8;
export const HEGEMON_RALLY_TICKS = 2, HEGEMON_ARM_BORDER_SOL = 0.08, HEGEMON_ARM_INTERIOR_SOL = 0.02;
export const HEGEMON_TRIBUTE_SOL = 0.08, HEGEMON_TRIBUTE_TICKS = 3, HEGEMON_DEFY_SOL = 0.04;
export const HEGEMON_WIN_SOL = 0.06, HEGEMON_LOSE_SOL = 0.06, HEGEMON_KNEEL_SOL = 0.12;
```

`DilemmaCode` gains `"hegemon1" | "hegemon2" | "hegemon3"`.

(b) Helpers (after `cityWallCells`):

```ts
function hegemonFoe(s: SimState): number {
  for (const f of s.dilemmaFlags) if (f.startsWith("hegemonFoe:")) return Number(f.slice(11));
  return -1;
}
function endHegemon(s: SimState): void {
  for (const f of [...s.dilemmaFlags]) if (f.startsWith("hegemon")) s.dilemmaFlags.delete(f);
  s.dilemmaFlags.add("hegemonDone");
}
// cohesion IS battle-readiness under this game's rules; clamped so neither side is a lock
function battleOdds(s: SimState): number {
  const avg = aggregate(s)[s.playerPolity]?.avg ?? 0;
  return Math.min(0.8, Math.max(0.2, avg));
}
// up to k cells of the LOSING side on the shared player<->other land front, lowest solidarity
// first — deterministic, exported and shared by resolve and preview so counts cannot drift
export function borderCellsBetween(s: SimState, other: number, k: number, losing: "player" | "other"): number[] {
  const losePol = losing === "player" ? s.playerPolity : other;
  const winPol = losing === "player" ? other : s.playerPolity;
  const out: number[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== losePol) continue;
    for (const nb of s.grid.neighbors[c]) {
      if (s.terrain[nb] !== OCEAN && s.owner[nb] === winPol) { out.push(c); break; }
    }
  }
  out.sort((x, y) => s.solidarity[x] - s.solidarity[y]);
  return out.slice(0, k);
}
```

(c) `offerDilemma` — at the very top after the `playerPolity < 0` guard, move the `aggregate` computation up if needed and insert TIER ① (crisis continuation, BEFORE the cooldown check):

```ts
  const agg = aggregate(s);
  const mine = agg[s.playerPolity];
  if (!mine || mine.cells === 0) return null;

  // ① crisis-arc continuation: an act per offer window, bypassing the cooldown (Frostpunk
  // pacing — 30-year gaps between acts would kill the arc). Dissolves if the hegemon died.
  const stage = s.dilemmaFlags.has("hegemon3") ? "hegemon3" : s.dilemmaFlags.has("hegemon2") ? "hegemon2" : null;
  if (stage) {
    const foe = hegemonFoe(s);
    if (foe >= 0 && s.alive[foe]) {
      s.lastDilemma = s.tick;
      return { code: stage, data: { polity: foe, name: s.polities[foe].name } };
    }
    endHegemon(s); // dissolve silently; normal flow resumes below
  }

  if (s.tick - s.lastDilemma < DILEMMA_COOLDOWN) return null;
```

(the original `aggregate`/`mine` lines after the cooldown check are REMOVED — they now live above it; the rest of the function body is unchanged apart from the inserts below).

Then insert TIER ④ (opening) directly after the prophecy2 guaranteed tier (Task 3's insert) and before the unrest block. IMPORTANT: offering face 1 sets ONLY the `hegemonFoe:` marker — the `hegemon2` stage flag is set by RESOLVING face 1 (an ignored/expired card must re-offer face 1 later, never skip to act 2):

```ts
  // ④ crisis opening: a rival has grown into a hegemon — fires when first true, once per reign
  if (s.tick >= HEGEMON_MIN_TICK && !s.dilemmaFlags.has("hegemonDone")) {
    let big = -1, bigCells = 0;
    for (let p = 0; p < s.polities.length; p++) {
      if (p === s.playerPolity || !s.alive[p] || s.polities[p].free) continue;
      const cells = agg[p]?.cells ?? 0;
      if (cells > bigCells) { big = p; bigCells = cells; }
    }
    if (big >= 0 && bigCells >= HEGEMON_RATIO * mine.cells) {
      for (const f of [...s.dilemmaFlags]) if (f.startsWith("hegemonFoe:")) s.dilemmaFlags.delete(f);
      s.dilemmaFlags.add(`hegemonFoe:${big}`);
      s.lastDilemma = s.tick;
      return { code: "hegemon1", data: { polity: big, name: s.polities[big].name } };
    }
  }
```

(An expired unanswered hegemon1 leaves only the `hegemonFoe:` marker, which the opening refreshes on re-offer. Acts 2/3 exist only after their flags are set by resolve.)

(d) `resolveDilemma` branches (before the defector fallthrough):

```ts
  if (d.code === "hegemon1") {
    const foe = Number(d.data.polity);
    s.dilemmaFlags.add("hegemon2");
    if (choice === "a") {
      // rally the flanks: truces with up to 2 weakest hostile neighbors — never the hegemon
      const agg = aggregate(s);
      const others = hostileNeighbors(s)
        .filter((h) => h.id !== foe && (h.trucedUntil ?? 0) <= s.tick)
        .sort((x, y) => (agg[x.id]?.cells ?? 0) - (agg[y.id]?.cells ?? 0))
        .slice(0, 2);
      for (const h of others) s.truces.set(h.id, s.tick + HEGEMON_RALLY_TICKS);
      return { code: "hegemonRally", data: { n: others.length } };
    }
    const n = nudgePlayerSol(s, HEGEMON_ARM_BORDER_SOL, "border");
    nudgePlayerSol(s, -HEGEMON_ARM_INTERIOR_SOL, "interior");
    return { code: "hegemonArm", data: { n } };
  }
  if (d.code === "hegemon2") {
    const foe = Number(d.data.polity), name = String(d.data.name ?? "");
    s.dilemmaFlags.delete("hegemon2");
    if (choice === "a") {
      s.truces.set(foe, s.tick + HEGEMON_TRIBUTE_TICKS);
      nudgePlayerSol(s, -HEGEMON_TRIBUTE_SOL, "nation");
      endHegemon(s);
      return { code: "hegemonTribute", data: { name } };
    }
    nudgePlayerSol(s, HEGEMON_DEFY_SOL, "nation");
    s.dilemmaFlags.add("hegemon3");
    return { code: "hegemonDefy", data: {} };
  }
  if (d.code === "hegemon3") {
    const foe = Number(d.data.polity), name = String(d.data.name ?? "");
    endHegemon(s);
    if (choice === "b") {
      s.truces.set(foe, s.tick + HEGEMON_TRIBUTE_TICKS);
      nudgePlayerSol(s, -HEGEMON_KNEEL_SOL, "nation");
      return { code: "hegemonKneel", data: { name } };
    }
    if (s.rng() < battleOdds(s)) {
      const spoils = borderCellsBetween(s, foe, HEGEMON_SPOILS, "other");
      for (const c of spoils) { s.owner[c] = s.playerPolity; s.solidarity[c] = CONQUEST_SOL; }
      nudgePlayerSol(s, HEGEMON_WIN_SOL, "nation");
      return { code: "hegemonVictory", data: { n: spoils.length, name } };
    }
    const lost = borderCellsBetween(s, foe, HEGEMON_SPOILS, "player");
    for (const c of lost) { s.owner[c] = foe; s.solidarity[c] = CONQUEST_SOL; }
    nudgePlayerSol(s, -HEGEMON_LOSE_SOL, "nation");
    return { code: "hegemonRout", data: { n: lost.length, name } };
  }
```

NOTE the ordering trap in `hegemon3-a`: `battleOdds(s)` must be computed BEFORE the sol nudges (it is — the roll happens first). And `endHegemon` before the owner flips is fine (flags only).

(e) `previewDilemma` branches:

```ts
  if (d.code === "hegemon1") return choice === "a" ? { truce: "gain" } : { note: "fortify" };
  if (d.code === "hegemon2") return choice === "a" ? { cohesion: -2, truce: "gain" } : { cohesion: 1 };
  if (d.code === "hegemon3") {
    if (choice === "b") return { cohesion: -2, truce: "gain" };
    return {
      cells: borderCellsBetween(s, Number(d.data.polity), HEGEMON_SPOILS, "other").length,
      cohesion: 1,
      odds: battleOdds(s),
    };
  }
```

(Known cosmetic approximation, accepted in the spec: the failure side of the battle line negates the SPOILS count, while an actual rout cedes up to `HEGEMON_SPOILS` of the player's own front cells — same scale, may differ by a few cells.)

(f) i18n — `playDilemma` KO:

```ts
      case "hegemon1": return { title: `${name}이(가) 패권국으로 부상했습니다. 그 그림자가 국경에 드리웁니다.`, a: "측면을 규합한다 (이웃과 휴전)", b: "군비를 증강한다 (국경 ▲▲, 내지 ▼)" };
      case "hegemon2": return { title: `${name}의 최후통첩 — 조공이냐, 전쟁이냐.`, a: "조공을 바친다 (결속 ▼▼, 30년 휴전)", b: "항전을 결의한다 (결속 ▲, 결전으로)" };
      case "hegemon3": return { title: `결전의 날 — ${name}의 대군이 국경에 집결했습니다.`, a: "결전에 나선다 (도박 — 승률은 결속이 정한다)", b: "무릎 꿇는다 (결속 ▼▼, 30년 휴전)" };
```

EN:

```ts
    case "hegemon1": return { title: `${name} rises as a hegemon; its shadow falls on your border.`, a: "Rally the flanks (truces with neighbors)", b: "Arm the border (border ▲▲, interior ▼)" };
    case "hegemon2": return { title: `${name}'s ultimatum — tribute, or war.`, a: "Pay tribute (cohesion ▼▼, 30y truce)", b: "Defy them (cohesion ▲, to the reckoning)" };
    case "hegemon3": return { title: `The reckoning — ${name}'s host masses on your border.`, a: "Give battle (a gamble — cohesion sets the odds)", b: "Kneel (cohesion ▼▼, 30y truce)" };
```

`playDilemmaOutcome` KO:

```ts
      case "hegemonRally": return `${n}개 이웃과 휴전을 맺어 측면을 지켰다.`;
      case "hegemonArm": return `국경 ${n}개 셀에 방비를 세웠다.`;
      case "hegemonTribute": return `${name}에 조공을 바쳤다. 굴욕이지만 나라는 산다.`;
      case "hegemonDefy": return "항전의 깃발이 올랐다.";
      case "hegemonVictory": return `결전에서 승리했다! ${name}에게서 ${n}개 셀을 빼앗았다.`;
      case "hegemonRout": return `결전에서 패했다. ${name}에게 ${n}개 셀을 내주었다.`;
      case "hegemonKneel": return `${name} 앞에 무릎 꿇었다. 나라는 살아남았다.`;
```

EN:

```ts
    case "hegemonRally": return `Truces with ${n} neighbors secure the flanks.`;
    case "hegemonArm": return `The border arms: ${n} cells fortified.`;
    case "hegemonTribute": return `Tribute paid to ${name}; humiliating, but the realm lives.`;
    case "hegemonDefy": return "The banner of defiance is raised.";
    case "hegemonVictory": return `Victory! ${n} cells taken from ${name}.`;
    case "hegemonRout": return `Routed — ${n} cells lost to ${name}.`;
    case "hegemonKneel": return `You kneel before ${name}; the realm survives.`;
```

- [ ] **Step 4: Run the dilemma suite + full suite**

Run: `npx vitest run src/engine/dilemma.test.ts` → PASS (all, including the pre-existing offer tests — the tier restructure preserved their behavior contracts).
Run: `npx vitest run` → ALL PASS incl. golden hash. Expected total 437.

- [ ] **Step 5: Commit**

```bash
git add src/engine/dilemma.ts src/ui/i18n.ts src/engine/dilemma.test.ts
git commit -m "feat(play): hegemon crisis arc — a three-act Frostpunk-style storm with honest battle odds"
```

---

### Task 5: Full verification (controller-run)

**Files:** none new (fixes only if something fails)

- [ ] **Step 1:** `npx vitest run` from the worktree root — all green (expected 437), golden hash test included.
- [ ] **Step 2:** `npm run build` — clean.
- [ ] **Step 3:** Live checks via the dev server + preview_eval on `/play.html`: advance turns until a card appears; confirm every card face renders a title (never a raw code like "warweary") and two non-empty `.choice-fx` lines; force-check the KO/EN toggle on a card; verify no console errors.
- [ ] **Step 4:** Whole-branch final review (most capable model), then merge per finishing-a-development-branch; ask the user to eyeball localhost and play an arc.
