# Province play P2 (threat foresight) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make losses predictable and attributable — forecast which of the player's provinces an enemy will conquer next turn (and who), sound a distinct alarm when the capital is threatened, name the culprit in the loss log, and fix the self-contradicting expedition reason — while the four golden hashes stay byte-identical.

**Architecture:** Two pure, golden-safe additions to `src/engine/provinceSim.ts` (`forecastIncoming` predictor + an `expedition` reason in `explainAttack`), then UI in `provinceApp.ts` + `theme.css` that merges the existing defection panel with the new conquest forecast into one threat section, raises a capital banner, names the loss attacker, and groups the log by turn.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-23-province-play-p2-threat-foresight-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/engine/provinceSim.ts`, `src/engine/provinceSim.test.ts`, `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`, `src/theme.css`. Nothing else.
- **Golden hashes must stay byte-identical:** init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`. The engine additions are pure predictors NEVER called by `stepProvinceSim`/`stepPlayerTurn`, and the `expedition` change touches only the reason string (not win/atk/def), so the goldens will not move — a task asserts this.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- Every user-visible string needs a `ko` and an `en` form, following the existing `lang === "ko" ? ... : ...` pattern.
- Engine determinism convention: `forecastIncoming` must NOT mutate `s` (clone the buffers it steps). A test asserts non-mutation.
- Existing engine constants to reuse verbatim (do not redefine): `CONSOLIDATE_BONUS = 0.1`, `EXPEDITION_MULT = 0.6`, `CONTEST_THRESH = 1.03`. Existing internal helpers to reuse: `computeSteppedSol`, `aiAttacker`, `strength`, `pAggregate`, `attackFront`, `unrestArr`.
- Baseline before you start: **680 tests passing**.
- Commit after each task on the current branch. Do not merge, do not push.

---

### Task 1: `forecastIncoming` engine predictor

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: existing internals `computeSteppedSol(s)`, `aiAttacker(s, excludePlayer)`, `strength(s, agg, polity, distProv, solProv)`, `pAggregate(s)`, `CONTEST_THRESH`, `EXPEDITION_MULT`, `CONSOLIDATE_BONUS`.
- Produces:
  - `export interface IncomingThreat { prov: number; attacker: number }`
  - `export function forecastIncoming(s: ProvinceSimState, playerId: number, opts?: { consolidate?: boolean; targets?: ReadonlySet<number> }): IncomingThreat[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/provinceSim.test.ts` (mirror the fixtures the existing contest tests build — search that file for how they construct a `ProvinceSimState` with `provOwner`/`provSol`/`adj`/`capitalProv`/`alive`):

```ts
import { forecastIncoming } from "./provinceSim";

describe("forecastIncoming (which of my provinces an enemy takes next turn)", () => {
  it("does not mutate the state it reads", () => {
    const s = /* build or load the seed-1 initial state via initProvinceSim(world) */ makeSeed1();
    const owner0 = s.provOwner.slice(), sol0 = s.provSol.slice();
    const unrest0 = s.unrest ? s.unrest.slice() : null;
    forecastIncoming(s, /* playerId */ pickPlayer(s));
    expect(Array.from(s.provOwner)).toEqual(Array.from(owner0));
    expect(Array.from(s.provSol)).toEqual(Array.from(sol0));
    if (unrest0) expect(Array.from(s.unrest!)).toEqual(Array.from(unrest0));
  });

  it("predicts exactly the conquest losses a real player turn produces (no attacks armed)", () => {
    const s = makeSeed1();
    const playerId = pickPlayer(s);
    const forecast = forecastIncoming(s, playerId); // conquer stance, nothing armed
    // run the REAL turn with no targets and see which player provinces flipped to an enemy
    const before = s.provOwner.slice();
    const ev = stepPlayerTurn(s, playerId, new Set());
    const actualLosses = ev.conquests
      .filter((c) => c.from === playerId)                 // provinces I lost this turn
      .map((c) => ({ prov: c.prov, attacker: c.to }))
      .sort((a, b) => a.prov - b.prov);
    const predicted = forecast.slice().sort((a, b) => a.prov - b.prov);
    expect(predicted).toEqual(actualLosses);
    void before;
  });
});
```

`makeSeed1()` / `pickPlayer(s)` are helpers you write in the test file: build the seed-1
initial state (`initProvinceSim(generateWorld({...DEFAULT_PARAMS, seed: 1}).world)`), and
pick a player id that actually owns provinces and loses at least one this turn — scan ids
0..n and choose one whose `stepPlayerTurn(clone, id, new Set())` yields a `from === id`
conquest, so the faithfulness assertion is non-vacuous. If no seed-1 player loses a
province on turn 0, advance the clone a few turns first (headless) to reach a losing state,
and pin that setup with a comment. Use a throwaway probe to find it; delete it before commit.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- provinceSim`
Expected: FAIL — `forecastIncoming` is not exported.

- [ ] **Step 3: Implement `forecastIncoming`**

In `src/engine/provinceSim.ts`, after `stepPlayerTurn` (so all internals it uses are in
scope), add:

```ts
export interface IncomingThreat { prov: number; attacker: number }

// PURE forecast: which of the player's provinces an enemy would CONQUER on the next advance, and who takes
// each. Mirrors the first half of stepPlayerTurn read-only — it clones the buffers it steps and never mutates
// `s`. Faithful by construction: it reuses the same computeSteppedSol / aiAttacker / strength / CONTEST_THRESH
// the real contest runs. Scope is conquest only (defection is forewarned by the risk panel). This turn's
// incoming losses depend only on the solidarity step + the consolidate bonus, not on the player's own attack
// targets (a player province is always AI-contested, and attack-exhaustion applies only to NEXT turn), so opts
// carries just the consolidate selection.
export function forecastIncoming(
  s: ProvinceSimState, playerId: number,
  opts: { consolidate?: boolean; targets?: ReadonlySet<number> } = {},
): IncomingThreat[] {
  // step solidarity into a fresh buffer, then apply the same consolidate bonus stepPlayerTurn would
  const stepped = computeSteppedSol(s);
  if (opts.consolidate && opts.targets) {
    for (const p of opts.targets) {
      if (p >= 0 && p < s.n && s.provOwner[p] === playerId) {
        const v = stepped[p] + CONSOLIDATE_BONUS;
        stepped[p] = v > 1 ? 1 : v;
      }
    }
  }
  const tmp: ProvinceSimState = { ...s, provSol: stepped }; // shallow clone; provOwner shared but never written
  const agg = pAggregate(tmp);
  const ai = aiAttacker(tmp, playerId); // AI excludes the player from initiating
  const out: IncomingThreat[] = [];
  for (let p = 0; p < s.n; p++) {
    if (s.provOwner[p] !== playerId) continue;             // only MY provinces can be lost to conquest
    const chosen = ai(p, playerId, agg);
    if (!chosen) continue;
    const atk = strength(tmp, agg, chosen.attacker, p, chosen.frontProv) * (chosen.lane ? EXPEDITION_MULT : 1);
    const def = strength(tmp, agg, playerId, p, p);
    if (atk > def * CONTEST_THRESH) out.push({ prov: p, attacker: chosen.attacker });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- provinceSim`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test`
Expected: PASS, ~682 tests. The GOLDEN tests must be green (this change is additive).

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts
git commit -m "feat(provinceSim): forecastIncoming — pure predictor of next-turn conquest losses"
```

---

### Task 2: `expedition` reason in `explainAttack`

**Files:**
- Modify: `src/engine/provinceSim.ts`
- Test: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: existing `explainAttack`, `AttackReason`, `EXPEDITION_MULT`.
- Produces: `AttackReason` union gains `"expedition"`; `explainAttack` returns it when the expedition penalty dominates.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/provinceSim.test.ts`:

```ts
describe("explainAttack expedition reason", () => {
  it("blames the sea crossing when a lane attack's expedition penalty is the dominant factor", () => {
    // build a fixture where the player is realm-strong but attacks ACROSS A LANE and loses:
    // the reason must be 'expedition', not 'realm-strong'. Mirror the existing lane/attackFront fixtures
    // in this file (search for laneAdj). Assert od.lane === true and od.reason === "expedition".
    const s = makeLaneAttackFixture();
    const od = explainAttack(s, /* playerId */ 0, /* target across the lane */ TARGET)!;
    expect(od.lane).toBe(true);
    expect(od.reason).toBe("expedition");
  });

  it("is reason-only: a non-lane attack's win/atk/def are unchanged by this addition", () => {
    // a plain land fixture — assert the numeric fields still compute as before (win a known outcome).
    const s = makeLandFixture();
    const od = explainAttack(s, 0, TARGET_LAND)!;
    expect(od.lane).toBe(false);
    expect(typeof od.win).toBe("boolean");
    expect(od.atk).toBeGreaterThan(0);
    expect(od.reason).not.toBe("expedition"); // land attacks never blame the crossing
  });
});
```

Build `makeLaneAttackFixture` / `makeLandFixture` by mirroring the existing lane and
contest fixtures in this test file. If the seed-1 world offers a natural lane attack where
the penalty dominates, use it and pin it with a comment instead.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- provinceSim`
Expected: FAIL — `reason` is `"realm-strong"` (or another land term), not `"expedition"`.

- [ ] **Step 3: Add the reason**

In `src/engine/provinceSim.ts`:

Extend the `AttackReason` union (line ~317):

```ts
export type AttackReason = "realm-strong" | "realm-weak" | "target-shaky" | "target-stable" | "near" | "too-far" | "even" | "expedition";
```

In `explainAttack`, after the three existing terms are pushed and before the sort, add the
expedition term when the attack crosses a lane. The current code computes `mult` and
`atk = strength(...) * mult`. Capture the un-multiplied strength so the penalty magnitude is
explicit:

```ts
  const atkUnmult = strength(tmp, agg, playerId, targetProv, front);
  const atk = atkUnmult * mult;
  const def = o < 0 ? 0 : strength(tmp, agg, o, targetProv, targetProv);
  const win = atk > def * CONTEST_THRESH;
  // ... existing defAvg/defSol/dist term setup ...
  const terms: [AttackReason, AttackReason, number][] = [
    ["realm-strong", "realm-weak", W_ASA * (agg[playerId].avg - defAvg)],
    ["target-shaky", "target-stable", W_LOCAL * (stepped[front] - defSol)],
    ["near", "too-far", -W_DIST * (myDist - theirDist)],
  ];
  // the sea crossing weakens the attacker by atkUnmult*(1-mult); include it so a lane attack that fails
  // DESPITE a strong realm blames the crossing, not the realm (fixes "realm strong yet fails").
  if (lane) terms.push(["expedition", "expedition", -atkUnmult * (1 - mult)]);
  terms.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
```

Note: this replaces the existing `const atk = strength(...) * mult;` line with the two-line
`atkUnmult`/`atk` split. The `[pos, neg, val]` selection below already handles the sign:
the expedition term is always negative (a penalty), so `val >= 0 ? pos : neg` yields
`"expedition"` (both slots are `"expedition"`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- provinceSim`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test`
Expected: PASS, ~684 tests. GOLDEN tests green (reason-only change).

Run: `npm run build`
Expected: no TypeScript errors — note `reasonText` in `provinceApp.ts` is a `Record<AttackReason, string>` and will now FAIL to compile until the `expedition` key is added. That is Task 5's job, BUT the build must pass now: add the `expedition` key to both `reasonText` maps as part of THIS task (it is the same engine-facing type change). Add to `reasonText` (ko + en):

```ts
    "expedition": "바다 건너 원정이라 군대가 약해짐", // ko map
    "expedition": "the sea crossing weakens the attack", // en map
```

- [ ] **Step 6: Commit**

```bash
git add src/engine/provinceSim.ts src/engine/provinceSim.test.ts src/ui/provinceApp.ts
git commit -m "feat(provinceSim): expedition attack reason — a lane attack blames the crossing, not the realm"
```

---

### Task 3: Golden-unchanged guard

A dedicated task so the "engine additions are golden-safe" claim is pinned by an explicit
test, not merely implied by other tests passing.

**Files:**
- Modify: `src/engine/provinceSim.test.ts`

**Interfaces:**
- Consumes: `forecastIncoming`, `explainAttack` (from Tasks 1–2), and the existing golden hashes.

- [ ] **Step 1: Write the test**

Find the existing golden-hash test in `src/engine/provinceSim.test.ts` (search for
`226648593` / `2503300448` / `2374466985`). Add a test that:

```ts
it("the P2 predictors do not perturb the golden simulation path", () => {
  // run the SAME golden scenario that produces 226648593 / 2503300448 / 2374466985,
  // but call forecastIncoming and explainAttack in between the steps, and assert the
  // final hashes are byte-identical — proving the predictors are side-effect-free.
  const s = /* the golden initial state exactly as the existing golden test builds it */;
  expect(fnv(s.provOwner)).toBe(226648593); // initial golden, unchanged
  for (let t = 0; t < 50; t++) {
    forecastIncoming(s, 0);                  // call the predictor between steps
    explainAttack(s, 0, /* any armable */ armableTargets(s, 0)[0] ?? 0);
    stepProvinceSim(s);
  }
  expect(fnv(s.provOwner)).toBe(2503300448); // 50-tick golden, unchanged despite predictor calls
});
```

Match the exact hashing helper and initial-state construction the existing golden test
uses (reuse its `fnv`/hash function and its state setup — do not invent a new one). The
point is: interleaving the predictors changes nothing.

- [ ] **Step 2: Run to verify it passes** (it should pass immediately if the predictors are pure)

Run: `npm test -- provinceSim`
Expected: PASS. If it FAILS, a predictor is mutating state — fix the predictor (Task 1/2), do not weaken the hash.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: PASS, ~685 tests.

- [ ] **Step 4: Commit**

```bash
git add src/engine/provinceSim.test.ts
git commit -m "test(provinceSim): pin that P2 predictors leave the golden path byte-identical"
```

---

### Task 4: Merged threat section + capital banner + red threat ring

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `forecastIncoming` (Task 1), the existing defection-risk render block, `sortRisksByUrgency`, `makePingable`, `provinceOutlinePath`, `defectionOverlay`.
- Produces: a `.prov-threat` section replacing the `.prov-risk` panel; a `.prov-capital-alarm` banner; a `.prov-threat-ring` map overlay.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`. Drive seed 1 (or scan seeds) to a turn that has BOTH
a defection risk and a forecast conquest loss; if hard, two separate seeds are acceptable —
one proving the conquest row, one the defection row — as long as neither assertion is
vacuous.

```ts
describe("merged threat section (defection + incoming conquest)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function play(seed: number, nation: number, turns: number): void {
    mountProvinceApp(root, { seed });
    (root.querySelectorAll("[data-polity]")[nation] as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 0; t < turns; t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  }

  it("renders conquest threat rows (red, ⚔) that ping their province", () => {
    // scan seeds/nations for a turn with a forecast conquest loss; pin the one you find.
    play(/* seed */ 1, /* nation */ 3, /* turns */ 4);
    const conquestRows = root.querySelectorAll(".prov-threat-row.conquest");
    // if none this turn, advance until one appears (bounded); assert once found
    // (write the loop in the test; do NOT assert on an empty collection)
    expect(root.querySelector(".prov-threat")).toBeTruthy();
  });

  it("raises the capital alarm banner when the capital is forecast-lost", () => {
    // find a seed/nation whose capital appears in forecastIncoming; assert .prov-capital-alarm shows
    // and names an attacker. If unreachable within a turn budget, report — do not fake it.
  });
});
```

Because reaching a specific threat state is seed-sensitive, write each test to advance a
bounded number of turns until the asserted state appears, and assert then — never assert on
an empty collection. Use a throwaway probe to find good (seed, nation) pairs and pin them
with comments; delete the probe before commit.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — no `.prov-threat` / `.prov-threat-row.conquest` / `.prov-capital-alarm` exist yet.

- [ ] **Step 3: Compute the forecast and build the merged section**

In `render()`, the play branch, REPLACE the existing defection-risk block (the
`const risks = []; ... if (risks.length) { ... }` at roughly lines 609–634) with a merged
build. First compute the forecast (respecting the current stance so it is reactive):

```ts
      map.appendChild(defectionOverlay(ui));
      // incoming CONQUEST forecast — reactive to the current stance (consolidating a province can drop it)
      const forecast = forecastIncoming(ui.s, ui.playerId,
        mode === "consolidate" ? { consolidate: true, targets } : {});
      map.appendChild(threatOverlay(ui, forecast)); // red rings on forecast-lost provinces

      // capital alarm — the sole defeat condition, kept ABOVE the list so it is never buried
      const capProv = ui.s.capitalProv[ui.playerId];
      const capThreat = forecast.find((f) => f.prov === capProv);
      if (capThreat) {
        const alarm = document.createElement("div");
        alarm.className = "prov-capital-alarm";
        const by = ui.world.polities[capThreat.attacker]?.name ?? "?";
        alarm.textContent = lang === "ko"
          ? `⚠ 수도가 위협받고 있습니다 — ${by}에게 넘어갈 위기`
          : `⚠ Your capital is under threat — ${by} will take it`;
        root.appendChild(alarm);
      }

      // ONE threat section: defection (amber, 🏳) + incoming conquest (red, ⚔), urgency-sorted, each pingable.
      type ThreatRow = { p: number; turnsLeft: number; text: string; kind: "defection" | "conquest" };
      const rows: ThreatRow[] = [];
      for (let p = 0; p < ui.s.n; p++) {
        if (ui.s.provOwner[p] !== ui.playerId) continue;
        const r = defectionRisk(ui.s, p);
        if (r) rows.push({ p, turnsLeft: r.turnsLeft, kind: "defection",
          text: `🏳 ${ui.world.provinces[p].name} — ${lang === "ko" ? `이탈 ${r.turnsLeft}턴` : `defects in ${r.turnsLeft}`} · ${defectionReasonText(r.reason, r.ownN, r.foeN, lang)}` });
      }
      for (const f of forecast) {
        const by = ui.world.polities[f.attacker]?.name ?? "?";
        rows.push({ p: f.prov, turnsLeft: 0, kind: "conquest", // conquest is always "next turn" → sorts first
          text: `⚔ ${ui.world.provinces[f.prov].name} — ${lang === "ko" ? `${by}에게 넘어감` : `falls to ${by}`}` });
      }
      if (rows.length) {
        const panel = document.createElement("div");
        panel.className = "prov-threat";
        for (const row of sortRisksByUrgency(rows.map((r) => ({ ...r, r: { turnsLeft: r.turnsLeft } })))) {
          const el = document.createElement("div");
          el.className = "prov-threat-row " + row.kind;
          el.textContent = row.text;
          makePingable(el, ui, row.p);
          panel.appendChild(el);
        }
        const hint = document.createElement("div");
        hint.className = "prov-threat-hint";
        hint.textContent = lang === "ko"
          ? "🏳 이탈 · ⚔ 정복 — 내실로 다지거나, 압박하는 땅을 치세요"
          : "🏳 defection · ⚔ conquest — consolidate it, or take the province pressing it";
        panel.appendChild(hint);
        root.appendChild(panel);
      }
```

Add the `threatOverlay` helper near `defectionOverlay` (in the same file):

```ts
  // red rings on provinces the enemy will CONQUER next turn — distinct from the amber DASHED defection ring.
  function threatOverlay(u: UI, forecast: IncomingThreat[]): SVGGElement {
    const g = svgEl("g", { class: "prov-threats", style: "pointer-events:none" }) as SVGGElement;
    for (const f of forecast) {
      g.appendChild(svgEl("path", {
        class: "prov-threat-ring", d: provinceOutlinePath(u.world, f.prov),
        fill: "none", stroke: "#c0392b", "stroke-width": 2.6, "stroke-linejoin": "round",
      }));
    }
    return g;
  }
```

Add the import of `forecastIncoming` and the `IncomingThreat` type to the engine import
block at the top of `provinceApp.ts`.

- [ ] **Step 4: Add the CSS**

In `src/theme.css`, next to the `.prov-risk` rules (reuse their look; the classes are renamed):

```css
.prov-threat { max-width: 900px; margin: 6px auto 0; }
.prov-threat-row { font-size: 13px; padding: 2px 12px; cursor: pointer; }
.prov-threat-row.defection { color: #9a6a1e; }
.prov-threat-row.conquest { color: #b23a3a; font-weight: 600; }
.prov-threat-row:hover { text-decoration: underline dotted; text-underline-offset: 2px; }
.prov-threat-hint { max-width: 900px; margin: 2px auto 0; text-align: center; font-size: 12px; color: #6a5a3c; font-style: italic; }
.prov-capital-alarm {
  max-width: 900px; margin: 8px auto 0; padding: 8px 14px; text-align: center;
  font-weight: 700; color: #7a1f14; background: #f6e2dd; border: 2px solid #c0392b; border-radius: 8px;
}
.prov-threat-ring { animation: wm-threat-pulse 1.3s ease-in-out infinite; }
@keyframes wm-threat-pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
```

Delete the now-unused `.prov-risk`, `.prov-risk-row`, `.prov-risk-hint` CSS rules **only if
nothing else references them** (grep first: the defection MAP ring `.prov-risk-ring` in
`defectionOverlay` is separate and STAYS — do not remove it).

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS. Any prior test that queried `.prov-risk`/`.prov-risk-row` must be updated to
`.prov-threat`/`.prov-threat-row` (grep the test file; update assertions, do not weaken them).

- [ ] **Step 6: Full suite + build**

Run: `npm test`
Expected: PASS. Run: `npm run build` — no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): merge defection + incoming-conquest into one threat panel, add capital alarm"
```

---

### Task 5: Loss attacker in the log, turn-grouped log, defection hint reword, consolidate-protected mark

The remaining pure-UI polish. Grouped because they all touch the log/consolidate render and
share no engine surface.

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `logEl()`, `LogEntry`, the advance handler's conquest/defection loop, the fortify overlay, `forecastIncoming`.
- Produces: `LogEntry` gains `tick?: number`; log renders grouped by tick.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("P2 log + consolidate polish", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  function start(seed: number, nation: number): void {
    mountProvinceApp(root, { seed });
    (root.querySelectorAll("[data-polity]")[nation] as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("names the attacker on a loss log entry", () => {
    // advance until a `상실`/`lost` entry appears, assert it also contains a nation name in parens
    start(1, 3);
    let found = "";
    for (let t = 0; t < 20 && !found; t++) {
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      if (!adv) break; adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const lost = [...root.querySelectorAll(".prov-log-item")].map((e) => e.textContent || "")
        .find((t2) => /상실|lost/.test(t2));
      if (lost) found = lost;
    }
    expect(found).toMatch(/\(.+\)/); // "lost X (to Y)" / "상실 X (Y에게)" — a culprit in parens
  });

  it("groups the log by turn with T{tick} headers", () => {
    start(1, 3);
    for (let t = 0; t < 4; t++) {
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      if (adv) adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(root.querySelector(".prov-log-turn")).toBeTruthy(); // a per-turn group header exists
  });

  it("defection hint explains that neighbours dominate, not stability", () => {
    // reach a defection risk, assert the hint text mentions neighbours / 이웃
    start(1, 3);
    for (let t = 0; t < 20; t++) {
      if (root.querySelector(".prov-threat-hint")) break;
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      if (!adv) break; adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const hint = root.querySelector(".prov-threat-hint")?.textContent || "";
    expect(hint).toMatch(/이웃|neighbour/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — the loss entry has no culprit, no `.prov-log-turn` header exists.

- [ ] **Step 3: Name the attacker on losses + stamp the tick**

In the advance handler's event loop, change the loss push to include the conqueror, and
stamp every pushed entry with the current tick. Find the block that builds log entries from
`ev.conquests` / `ev.defections` / `ev.eliminated` and update the loss line:

```ts
        for (const c of ev.conquests) {
          if (c.to === pid) log.unshift({ text: `${lang === "ko" ? "정복" : "took"} ${ui!.world.provinces[c.prov].name}`, prov: c.prov, tick: ui!.s.tick });
          else if (c.from === pid) {
            const by = ui!.world.polities[c.to]?.name ?? "?";
            log.unshift({ text: `${lang === "ko" ? "상실" : "lost"} ${ui!.world.provinces[c.prov].name} ${lang === "ko" ? `(${by}에게)` : `(to ${by})`}`, prov: c.prov, tick: ui!.s.tick });
          }
        }
```

Stamp the defection and elimination pushes with `tick: ui!.s.tick` the same way, and the
dilemma-choice log push (search for the other `log.unshift` sites). Add `tick?: number` to
the `LogEntry` type.

- [ ] **Step 4: Group the log by turn in `logEl`**

Rewrite `logEl()` to group entries by `tick`, newest first, with a `T{tick}` header per
group, keeping each entry pingable. Preserve the existing behaviour that entries without a
`prov` are not pingable:

```ts
  function logEl(): HTMLElement {
    const el = document.createElement("div");
    el.className = "prov-log";
    // group the most recent entries by the turn they happened on, newest turn first
    const groups: { tick: number; items: LogEntry[] }[] = [];
    for (const e of log.slice(0, 12)) {
      const t = e.tick ?? -1;
      let g = groups.find((x) => x.tick === t);
      if (!g) { g = { tick: t, items: [] }; groups.push(g); }
      g.items.push(e);
    }
    for (const g of groups) {
      const turn = document.createElement("div");
      turn.className = "prov-log-turn";
      const head = document.createElement("span");
      head.className = "prov-log-turn-head";
      head.textContent = g.tick >= 0 ? `T${g.tick}` : "";
      turn.appendChild(head);
      g.items.forEach((e, i) => {
        if (i > 0) turn.appendChild(document.createTextNode(" · "));
        else if (head.textContent) turn.appendChild(document.createTextNode(" "));
        const span = document.createElement("span");
        span.className = "prov-log-item" + (/정복|took|귀순|joined/.test(e.text) ? " gain" : /상실|lost|이탈|defected|멸망|eliminated/.test(e.text) ? " loss" : "");
        span.textContent = e.text;
        if (typeof e.prov === "number" && ui) makePingable(span, ui, e.prov);
        turn.appendChild(span);
      });
      el.appendChild(turn);
    }
    return el;
  }
```

(The gain/loss class is a lightweight colour cue — the spec asks gains in the success colour,
losses in the risk colour.)

- [ ] **Step 5: Consolidate-protected mark**

In the fortify overlay / consolidate render, mark a SELECTED province that was in the
pre-consolidate forecast as protected. Compute the unconditional forecast once and, for a
selected fortify province that appears in it, add a `.protected` class or a "🛡" title.
Concretely, in `fortifyOverlay` (or where fortify rows/paths are built), when `mode ===
"consolidate"`:

```ts
    // provinces that WOULD be lost if we did nothing — selecting one to consolidate "protects" it
    const wouldLose = new Set(forecastIncoming(u.s, u.playerId).map((f) => f.prov));
    // ... for a selected fortify province p that is in wouldLose, add class "protected" and a title:
    //   title = lang === "ko" ? "🛡 이 턴 이탈/정복을 막습니다" : "🛡 shielded from loss this turn"
```

Keep this minimal — a class + title on the selected fortify path is enough; no new panel.

- [ ] **Step 6: Reword the defection hint**

The merged threat hint from Task 4 already carries the reword. Ensure its text explains that
neighbours dominate (Task 4's hint text does: "🏳 이탈 · ⚔ 정복 — 내실로 다지거나…"). Extend
it so the neighbour-count explanation is present (the Task-5 test asserts `이웃`/`neighbour`):

```ts
        hint.textContent = lang === "ko"
          ? "🏳 이탈(이웃 수로 결정 — 고립되면 안정도 높아도 넘어감) · ⚔ 정복 — 내실로 다지거나 압박하는 땅을 치세요"
          : "🏳 defection (decided by neighbours — an isolated province flips even at high stability) · ⚔ conquest — consolidate or take the pressing province";
```

- [ ] **Step 7: Add CSS for the log groups + protected mark**

In `src/theme.css`:

```css
.prov-log-turn { display: block; }
.prov-log-turn:first-child { font-weight: 500; } /* newest turn emphasised */
.prov-log-turn-head { color: #8a7a5c; font-variant-numeric: tabular-nums; margin-right: 4px; }
.prov-log-item.gain { color: #2f6b3f; }
.prov-log-item.loss { color: #b23a3a; }
.prov-fortify.protected { }  /* selection ring already shows; title carries the 🛡 explanation */
```

- [ ] **Step 8: Run to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 9: Full suite + build**

Run: `npm test`
Expected: PASS. Run: `npm run build` — no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): name loss attackers, group log by turn, explain defection, mark protected"
```

---

### Task 6: Live-browser verification

The forecast's faithfulness and the panel layout need a real browser.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Start the dev server**

`preview_start` `{name: "worldmaker"}`, navigate to `playProvince.html`, `resize_window` to
1280×900 FIRST (the preview viewport starts at 0 width; and remember `?seed=` is NOT plumbed
— seeds are random per load, so read state from the DOM, don't assume a seed).

- [ ] **Step 2: The forecast is faithful (the core claim)**

Pick a nation, arm nothing, read the threat panel's `⚔` conquest rows and note the predicted
`{province, attacker}`. Click advance. Confirm the provinces that flipped away from the
player (compare owner before/after, or read the `상실 … (to …)` log lines) match the
forecast exactly — same provinces, same attackers.

- [ ] **Step 3: The forecast reacts to consolidate**

On a turn with a `⚔` conquest threat, switch to consolidate and select the threatened
province. Confirm it drops from the threat panel and its red ring disappears — live, without
advancing.

- [ ] **Step 4: Capital alarm**

Drive (or scan nations) to a state where `forecastIncoming` includes the capital; confirm
the `.prov-capital-alarm` banner appears above the panel and names the attacker, and that
advancing then actually loses the capital (defeat). If unreachable in a reasonable budget,
report it rather than claim it.

- [ ] **Step 5: Log grouping + culprit + one-screen check**

Confirm the log shows `T{tick}` groups with gains green / losses red, a loss line names its
attacker in parens, and the merged threat panel did not reintroduce a scroll problem at
1280×720 (the map target + advance button still visible together, per P1's acceptance).

- [ ] **Step 6: ⚓ reason**

Find a lane attack that fails and confirm its preview/tooltip now reads the expedition reason
("바다 건너 원정이라…") instead of "내 나라가 강함".

- [ ] **Step 7: Console + report**

`read_console_messages` — no errors. Summarise; fix any defect in the UI/engine, re-run
`npm test`, commit.

**Not verifiable here:** whether the red pulse and the capital banner read as urgent — the
user's eyes.

---

## Self-review notes

- Spec coverage: `forecastIncoming` → Task 1; `expedition` reason → Task 2; golden guard →
  Task 3; merged threat panel + capital alarm + red ring → Task 4; loss culprit + turn-grouped
  log + defection hint + protected mark → Task 5; live faithfulness → Task 6.
- Engine additions (Tasks 1–2) come first so the UI (Tasks 4–5) can consume them; the golden
  guard (Task 3) sits between so a golden regression is caught before any UI is built on top.
- Task 2 deliberately adds the `expedition` key to `reasonText` in `provinceApp.ts` within
  the engine task, because the `Record<AttackReason, string>` type forces it — splitting it
  to Task 5 would leave the build red between tasks.
- The forecast covers conquest only; defection stays with `defectionRisk` — the merged panel
  shows both but from two different engine sources, by design.
- Test-count estimates drift; trust the actual number when everything passes.
