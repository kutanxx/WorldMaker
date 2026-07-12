# Border Battle Report + Stance Retune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every turn shows WHERE cells came and went (border +12 / −7, action +4) and how the front stands (my border cohesion vs theirs), stance tooltips carry the real multipliers, and the multipliers themselves are retuned so the three stances measurably diverge.

**Architecture:** Part A: `borderReport` pure helper in standing.ts, a momentum-line rewrite in playApp (requires a CONSCIOUS 2-line amendment inside the "verbatim advance handler" guard — the momentum capture lives there), tooltips rendered from newly-exported stance const tables (anti-drift). Part B: candidate consts + a throwaway probe sweep with acceptance criteria, one adjustment iteration allowed. Spec: `docs/superpowers/specs/2026-07-12-battle-report-stance-retune-design.md`.

**Tech Stack:** TypeScript, vitest. Probe = temp test file, deleted before commit.

## Global Constraints

- Stance multipliers stay PLAYER-GATED (only applied where `playerPolity` participates) — golden hashes byte-identical; full suite is the guard.
- The "verbatim advance handler" block may be amended ONLY at the momentum-capture lines (documented below); nothing else inside it moves. Update the marker comment to say "verbatim except the momentum capture (battle report, 07-12)".
- Tooltips derive from the exported const tables — no hardcoded numbers in copy.
- Retune acceptance (8 seeds × 15 turns, biggest nation, pass policy): aggressive net ≥ internal net × 1.25; defensive lost ≤ aggressive lost / 4; internal lost lowest or near-lowest; internal net < aggressive net. Probe results pasted into `.superpowers/sdd/progress.md`; probe file NEVER committed.
- All new strings KO+EN. tsc noUnusedLocals clean. Baseline: 467 tests at `033fd50`.
- STRICT GIT: no reset/rebase/checkout/restore/clean; add only named files.

---

### Task 1: Battle report + border standing + quantified stance tooltips

**Files:**
- Modify: `src/engine/historySim.ts` (export the three stance tables at ~lines 24-26), `src/engine/standing.ts` (+`borderReport`), `src/ui/playApp.ts` (momentum type ~line 106, advance-handler capture ~line 621, `momentumText` ~line 393, border line + stance tooltips in `renderPanel`), `src/ui/i18n.ts` (keys), `src/theme.css` (`.border-report`)
- Test: `src/engine/standing.test.ts`, `src/ui/playApp.test.ts` (append; grep `thisTurn|This turn|momentum` in the test file first and retarget any assertion pinned to the old momentum format)

**Interfaces:**
- Produces: `export const STANCE_ATK_MULT/STANCE_DEF_MULT/STANCE_SOL_DELTA` from historySim; `export interface BorderReport { mine: number; theirs: number }` + `export function borderReport(s: SimState): BorderReport | null` from standing; momentum local type becomes `{ gained: number; lost: number; dCohesionDir: -1 | 0 | 1; actionGain: number }`.

- [ ] **Step 1: Failing tests**

`src/engine/standing.test.ts` (inside the existing describe using `playerState`):

```ts
  it("borderReport averages each side of the front, read-only, null off the play path", () => {
    const s = playerState(1);
    const owner = [...s.owner];
    const br = borderReport(s)!;
    expect(br).not.toBeNull();
    expect(br.mine).toBeGreaterThan(0);
    expect(br.mine).toBeLessThanOrEqual(1);
    expect(br.theirs).toBeGreaterThan(0);
    expect([...s.owner]).toEqual(owner);
    s.playerPolity = -1;
    expect(borderReport(s)).toBeNull();
  });
```

`src/ui/playApp.test.ts`:

```ts
it("the momentum line splits the turn into border gains/losses and names the action share", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
  target.dispatchEvent(new MouseEvent("click"));
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const mo = root.querySelector(".momentum")!.textContent || "";
  expect(mo).toMatch(/\+\d+ \/ −\d+/);      // border split
  expect(mo).toMatch(/행동|action/);        // the attack's share is attributed
  const br = root.querySelector(".border-report");
  expect(br).not.toBeNull();
  expect((br!.textContent || "").match(/%/g)!.length).toBeGreaterThanOrEqual(2); // both sides
});

it("stance tooltips carry the real multipliers, derived from the const tables", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const stanceBtns = [...root.querySelectorAll(".view-toggle button")].filter((b) => !b.className.includes("invest"));
  const withNums = stanceBtns.filter((b) => /×[\d.]+/.test(b.getAttribute("title") || ""));
  expect(withNums.length).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/engine/standing.test.ts src/ui/playApp.test.ts` → new tests FAIL, rest PASS (fix any old momentum-format assertion found by the grep).

- [ ] **Step 3: Implement**

(a) historySim.ts lines 24-26: `const` → `export const` (three tables).

(b) standing.ts:

```ts
// average solidarity on each side of the player's front — the dominant LOCAL term of the
// contest math, surfaced so "invest → win borders → gain land" is visible every turn. An honest
// approximation: avg-asabiyya and size also weigh in (the UI labels it as such).
export interface BorderReport { mine: number; theirs: number }
export function borderReport(s: SimState): BorderReport | null {
  if (s.playerPolity < 0) return null;
  const seenMine = new Set<number>(), seenTheirs = new Set<number>();
  let mySum = 0, foeSum = 0;
  for (const e of frontEdges(s)) {
    if (!seenMine.has(e.cell)) { seenMine.add(e.cell); mySum += s.solidarity[e.cell]; }
    if (!seenTheirs.has(e.enemy)) { seenTheirs.add(e.enemy); foeSum += s.solidarity[e.enemy]; }
  }
  if (seenMine.size === 0 || seenTheirs.size === 0) return null;
  return { mine: mySum / seenMine.size, theirs: foeSum / seenTheirs.size };
}
```


(c) playApp.ts:
- momentum local: `let momentum: { gained: number; lost: number; dCohesionDir: -1 | 0 | 1; actionGain: number } | null = null;`
- Inside the advance handler, replace ONLY `momentum = { dCells: gained - lost, dCohesionDir: dir, lost };` with:

```ts
        // battle report (07-12): keep the action's share so the line can attribute it
        const actionGain = r.actionCode === "captured" || r.actionCode === "landed" ? Math.max(1, Number(r.actionData?.n ?? 1)) : 0;
        momentum = { gained, lost, dCohesionDir: dir, actionGain };
```

and update the BEGIN marker comment to `// --- BEGIN verbatim advance handler (do not modify; sole amendment: the momentum capture, battle report 07-12) ---`.
- `momentumText`:

```ts
    function momentumText(): string {
      if (!momentum) return playT(lang, "firstTurn");
      const net = momentum.gained - momentum.lost;
      const netGlyph = net > 0 ? `▲+${net}` : net < 0 ? `▼${-net}` : "–";
      const cohArrow = momentum.dCohesionDir > 0 ? "▲" : momentum.dCohesionDir < 0 ? "▼" : "–";
      const act = momentum.actionGain > 0 ? ` (${playT(lang, "reportAction").replace("{n}", String(momentum.actionGain))})` : "";
      return `${playT(lang, "thisTurn")} ${netGlyph} · ` +
        `${playT(lang, "reportBorder").replace("{g}", String(momentum.gained)).replace("{l}", String(momentum.lost))}${act}` +
        ` · ${playT(lang, "cohesion")} ${cohArrow}`;
    }
```

- renderPanel, directly after the momentum `panel.appendChild(mo);`:

```ts
      // where the front stands — the visible link in the invest → border wins → land chain
      const br = borderReport(s);
      if (br) {
        const line = document.createElement("div");
        line.className = "border-report hint";
        const m = Math.round(br.mine * 100), t = Math.round(br.theirs * 100);
        const word = playT(lang, m - t >= 5 ? "brAhead" : t - m >= 5 ? "brBehind" : "brEven");
        line.textContent = `${playT(lang, "brLine").replace("{m}", String(m)).replace("{t}", String(t))} — ${word}`;
        line.title = playT(lang, "brTip");
        panel.appendChild(line);
      }
```

- Stance buttons: import the three tables from `../engine/historySim` (extend the existing import) and replace `btn.title = playT(lang, \`tip${st2[0].toUpperCase()}${st2.slice(1)}\`);` with:

```ts
        const solPct = (STANCE_SOL_DELTA[st2] * 100).toFixed(1).replace(/\.0$/, "");
        btn.title = `${playT(lang, `tip${st2[0].toUpperCase()}${st2.slice(1)}`)} — ` +
          playT(lang, "stanceNums")
            .replace("{a}", String(STANCE_ATK_MULT[st2]))
            .replace("{d}", String(STANCE_DEF_MULT[st2]))
            .replace("{s}", `${STANCE_SOL_DELTA[st2] > 0 ? "+" : ""}${solPct}`);
```

(d) i18n keys — en:

```ts
reportBorder: "border +{g} / −{l}", reportAction: "action +{n}",
brLine: "front cohesion {m}% vs {t}%", brAhead: "ahead", brEven: "even", brBehind: "behind",
brTip: "Average cohesion on each side of your border — the dominant local term in every border battle (realm-wide cohesion and size also weigh in).",
stanceNums: "attack ×{a} · defense ×{d} · cohesion {s}%p/turn",
```

ko:

```ts
reportBorder: "국경 +{g} / −{l}", reportAction: "행동 +{n}",
brLine: "국경 결속 {m}% vs 인접 적 {t}%", brAhead: "우세", brEven: "비등", brBehind: "열세",
brTip: "국경 양쪽의 평균 결속 — 모든 국경 전투에서 가장 큰 국지 항목입니다 (전국 결속·규모도 함께 작용).",
stanceNums: "공격 ×{a} · 수비 ×{d} · 결속 {s}%p/턴",
```

(e) theme.css: `.border-report { font-size: 12px; color: #5a4a34; margin-top: 2px; }`

- [ ] **Step 4: Suites** — targeted files PASS, `npx vitest run` all green, tsc clean.
- [ ] **Step 5: Commit**

```bash
git add src/engine/historySim.ts src/engine/standing.ts src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/engine/standing.test.ts src/ui/playApp.test.ts
git commit -m "feat(play): border battle report — gains/losses split, front-cohesion line, quantified stance tooltips"
```

---

### Task 2: Stance retune with acceptance sweep (controller-run measurement loop)

- [ ] **Step 1:** Apply the candidate consts in historySim.ts:

```ts
const STANCE_ATK_MULT = { aggressive: 1.35, defensive: 0.7, internal: 0.55 } as const;
const STANCE_DEF_MULT = { aggressive: 1.0, defensive: 1.5, internal: 1.05 } as const;
const STANCE_SOL_DELTA = { aggressive: -0.01, defensive: 0.005, internal: 0.02 } as const;
```

(keep the `export` added in Task 1.)

- [ ] **Step 2:** Recreate the throwaway probe at `src/engine/feelprobe.test.ts` (same code as the diagnosis probe: 8 seeds × 15 turns × 5 policies, console table). Run it; check acceptance: `agg net ≥ int net × 1.25`, `def lost ≤ agg lost / 4`, `int` lowest-or-near losses, `int net < agg net`.
- [ ] **Step 3:** If a criterion fails, ONE adjustment iteration (move only the offending knob, e.g. agg ATK ±0.05 or int ATK ∓0.05), re-run. Paste both sweeps' TOTALS into `.superpowers/sdd/progress.md`.
- [ ] **Step 4:** DELETE the probe file. `npx vitest run` full suite green (goldens prove the gating), tsc clean.
- [ ] **Step 5: Commit**

```bash
git add src/engine/historySim.ts
git commit -m "tune(play): stance retune — aggressive earns its risk, internal stops dominating (measured sweep)"
```

---

### Task 3: Verification + final review + merge (controller-run)

- [ ] Live: advance a turn → momentum shows `국경 +g / −l` + border-report line with two %; attack then advance → `(행동 +n)` appears; stance tooltips show the NEW multipliers (×1.35 etc. — auto-derived); KO/EN toggle; console clean.
- [ ] Whole-branch final review (most capable model, read-only; flag: inline execution, no per-task reviewer ran) → fix wave if needed → merge per finishing-a-development-branch; push awaits "push해".
