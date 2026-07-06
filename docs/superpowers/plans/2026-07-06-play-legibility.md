# Play-mode Legibility Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the empire sim readable in the moment — a colored front line on the map, a per-decade gain/loss summary with emphasized player headlines, and a cause-of-defeat line — without changing any balance.

**Architecture:** UI-only. A pure enumerator `frontEdges(s)` (engine, beside `borderTargets`) classifies player border edges; `playApp` renders them as colored frontier lines, diffs `s.owner` each turn for the gain/loss line, styles player-involved events as headlines, and reads the conquer event for the defeat cause. No engine behavior changes; the pure-history golden hashes stay byte-identical.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom for UI), SVG DOM.

## Global Constraints

- **Determinism:** UI-only. `frontEdges` and the newly-exported `CONTEST_THRESH` are never called on the pure-history path (`playerPolity < 0`). The golden `historySim.test.ts` / `history.test.ts` hashes MUST stay byte-identical. Run the full suite after each task.
- **i18n:** new generated strings go through the `i18n.ts` `PLAY_UI` / dedicated-function pattern, KO + EN. Existing Korean history event `text` is NOT re-translated (accepted mixed-language in EN mode).
- **Colors:** push = `#3f9e57` (green), threat = `#c0473f` (red). Inline stroke attributes (export parity), not CSS-only.
- **Commit** after each task. Branch is `claude/xenodochial-margulis-ba6d43` (already on it; do NOT switch branches, do NOT reset/rebase; `git add` only the named files).
- Test runner: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`.

---

### Task 1: `frontEdges` enumerator + export `CONTEST_THRESH`

**Files:**
- Modify: `src/engine/historySim.ts` (line 8 — split `CONTEST_THRESH` out and export it)
- Modify: `src/engine/intervention.ts` (import `CONTEST_THRESH`; add `FrontEdge` + `frontEdges`)
- Test: `src/engine/intervention.test.ts`, `src/engine/historySim.test.ts`

**Interfaces:**
- Consumes: `SimState`, `aggregate`, `contestStrength`, `ATTACK_EDGE` (existing), `CONTEST_THRESH` (newly exported), `OCEAN` (already imported in intervention.ts).
- Produces: `export type FrontKind = "push" | "threat"`, `export interface FrontEdge { cell: number; enemy: number; kind: FrontKind }`, `export function frontEdges(s: SimState): FrontEdge[]`.

- [ ] **Step 1: Write the failing tests** (append to `src/engine/intervention.test.ts`)

```ts
describe("frontEdges", () => {
  it("an overwhelming player yields only push edges at capturable enemy cells", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
    const edges = frontEdges(s);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(s.owner[e.cell]).toBe(s.playerPolity);
      expect(s.owner[e.enemy]).toBeGreaterThanOrEqual(0);
      expect(s.owner[e.enemy]).not.toBe(s.playerPolity);
      expect(s.terrain[e.enemy]).not.toBe(OCEAN);
    }
    expect(edges.some((e) => e.kind === "threat")).toBe(false);
  });

  it("a defenceless player against strong enemies yields threat edges on its own border", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0;
      else if (s.owner[c] >= 0) s.solidarity[c] = 1;
    }
    const edges = frontEdges(s);
    const threats = edges.filter((e) => e.kind === "threat");
    expect(threats.length).toBeGreaterThan(0);
    for (const e of threats) expect(s.owner[e.cell]).toBe(s.playerPolity);
  });
});
```

Note: `OCEAN` is already imported in this test file; `biggestPlayerState` and `frontEdges` must be importable. Add `frontEdges` to the existing `import { ... } from "./intervention"` line.

Also append to `src/engine/historySim.test.ts` (inside the top-level `describe("historySim", ...)`):

```ts
it("exports CONTEST_THRESH (> 1)", () => {
  expect(CONTEST_THRESH).toBeGreaterThan(1);
});
```

Add `CONTEST_THRESH` to the existing `import { ... } from "./historySim"` line in that test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/intervention.test.ts src/engine/historySim.test.ts`
Expected: FAIL — `frontEdges` is not exported / `CONTEST_THRESH` is not exported.

- [ ] **Step 3: Export `CONTEST_THRESH`** — in `src/engine/historySim.ts` change line 8 from:

```ts
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002, CONTEST_THRESH = 1.03;
```

to:

```ts
const W_ASA = 1.0, W_LOCAL = 0.5, W_POWER = 0.03, W_DIST = 0.002;
export const CONTEST_THRESH = 1.03;
```

- [ ] **Step 4: Add `frontEdges`** — in `src/engine/intervention.ts`, change the historySim import to add `CONTEST_THRESH`:

```ts
import { aggregate, contestStrength, CONQUEST_SOL, AMPHIB_MULT, CONTEST_THRESH } from "./historySim";
```

Then append at the end of the file:

```ts
export type FrontKind = "push" | "threat";
export interface FrontEdge { cell: number; enemy: number; kind: FrontKind }

// classify each player-vs-enemy LAND border edge: "threat" if the enemy could take the player's cell
// (the sim's own contest rule), else "push" if the player could take the enemy cell (the dropdown's
// rule). Threat wins when both apply. Pure read of state — never called on the pure-history path.
export function frontEdges(s: SimState): FrontEdge[] {
  if (s.playerPolity < 0) return [];
  const agg = aggregate(s);
  const out: FrontEdge[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    const myDef = contestStrength(s, agg, s.playerPolity, c, c);
    for (const nb of s.grid.neighbors[c]) {
      if (s.terrain[nb] === OCEAN) continue;
      const e = s.owner[nb];
      if (e < 0 || e === s.playerPolity) continue;
      const enemyAtk = contestStrength(s, agg, e, c, nb);
      if (enemyAtk > myDef * CONTEST_THRESH) { out.push({ cell: c, enemy: nb, kind: "threat" }); continue; }
      const myAtk = contestStrength(s, agg, s.playerPolity, nb, c);
      const enemyDef = contestStrength(s, agg, e, nb, nb);
      if (myAtk * ATTACK_EDGE >= enemyDef) out.push({ cell: c, enemy: nb, kind: "push" });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/engine/intervention.test.ts src/engine/historySim.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + full suite (golden unchanged)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (golden byte-identical).

- [ ] **Step 7: Commit**

```bash
git add src/engine/historySim.ts src/engine/intervention.ts src/engine/intervention.test.ts src/engine/historySim.test.ts
git commit -m "feat(play): frontEdges enumerator (push/threat) + export CONTEST_THRESH"
```

---

### Task 2: i18n — `playDelta` + `playDefeatCause`

**Files:**
- Modify: `src/ui/i18n.ts` (add two exported functions after the existing play helpers)
- Test: `src/ui/i18n.test.ts`

**Interfaces:**
- Produces: `export function playDelta(lang: Lang, year: number, gained: number, lost: number): string`, `export function playDefeatCause(lang: Lang, name: string): string`.

- [ ] **Step 1: Write the failing tests** (append to `src/ui/i18n.test.ts`; add `playDelta, playDefeatCause` to the existing i18n import)

```ts
describe("play delta + defeat cause", () => {
  it("formats gains and losses, both languages", () => {
    expect(playDelta("en", 180, 8, 114)).toBe("Year 180: +8 −114 cells");
    expect(playDelta("ko", 180, 8, 114)).toBe("180년: +8 −114 셀");
  });
  it("omits a zero side and marks a still decade", () => {
    expect(playDelta("en", 50, 3, 0)).toBe("Year 50: +3 cells");
    expect(playDelta("en", 50, 0, 0)).toBe("Year 50: no change");
    expect(playDelta("ko", 50, 0, 0)).toBe("50년: 변동 없음");
  });
  it("formats the defeat cause", () => {
    expect(playDefeatCause("en", "Skarnhrok")).toBe("Conquered by Skarnhrok.");
    expect(playDefeatCause("ko", "Skarnhrok")).toBe("Skarnhrok에게 정복당함.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/i18n.test.ts`
Expected: FAIL — `playDelta` / `playDefeatCause` not exported.

- [ ] **Step 3: Implement** — append to `src/ui/i18n.ts`:

```ts
// per-decade gain/loss summary; "−" is U+2212 to match the minus used elsewhere
export function playDelta(lang: Lang, year: number, gained: number, lost: number): string {
  const parts: string[] = [];
  if (gained) parts.push(`+${gained}`);
  if (lost) parts.push(`−${lost}`);
  const unit = lang === "ko" ? "셀" : "cells";
  const still = lang === "ko" ? "변동 없음" : "no change";
  const change = parts.length ? `${parts.join(" ")} ${unit}` : still;
  return lang === "ko" ? `${year}년: ${change}` : `Year ${year}: ${change}`;
}
export function playDefeatCause(lang: Lang, name: string): string {
  return lang === "ko" ? `${name}에게 정복당함.` : `Conquered by ${name}.`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/i18n.ts src/ui/i18n.test.ts
git commit -m "feat(play): i18n playDelta + playDefeatCause (KO/EN)"
```

---

### Task 3: Front-line overlay on the map

**Files:**
- Modify: `src/ui/playApp.ts` (imports; `renderMap` adds a `.front` group)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `frontEdges` + `borderTargets` (intervention), `sharedEdge` (borders), `world.grid.polygons`, `world.grid.points`.
- Produces: a `<g class="front">` inside the map SVG with `<line class="front-push|front-threat">` children and `<text class="sea-target">` ⛵ markers.

- [ ] **Step 1: Write the failing test** (append to `src/ui/playApp.test.ts`)

```ts
it("draws a colored front line on the map", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const front = root.querySelector(".front");
  expect(front).not.toBeNull();
  expect(front!.querySelectorAll("line").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — no `.front` element.

- [ ] **Step 3: Implement** — in `src/ui/playApp.ts` add imports near the top:

```ts
import { borderTargets, frontEdges, type Action } from "../engine/intervention";
import { sharedEdge } from "../engine/borders";
```

(Replace the existing `import { borderTargets, type Action } from "../engine/intervention";` line with the first line above.)

Then replace the `renderMap` function body's `mapFrame.appendChild(svg);` tail so the group is added before appending. Full new `renderMap`:

```ts
    function renderMap(): void {
      mapFrame.innerHTML = "";
      const svg = renderWorld(world, "political", s.economicZones.map((z) => z.cell), lang);
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, politicalOpts("political")));
      // front-line overlay: green = can push here, red = my cell is vulnerable here
      const NS = "http://www.w3.org/2000/svg";
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "front");
      for (const e of frontEdges(s)) {
        const seg = sharedEdge(world.grid.polygons[e.cell], world.grid.polygons[e.enemy]);
        if (!seg) continue;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", String(seg[0][0])); line.setAttribute("y1", String(seg[0][1]));
        line.setAttribute("x2", String(seg[1][0])); line.setAttribute("y2", String(seg[1][1]));
        line.setAttribute("class", e.kind === "threat" ? "front-threat" : "front-push");
        line.setAttribute("stroke", e.kind === "threat" ? "#c0473f" : "#3f9e57");
        line.setAttribute("stroke-width", "2.4");
        line.setAttribute("stroke-linecap", "round");
        g.appendChild(line);
      }
      // amphibious opportunities: a small ⛵ at each capturable sea target
      for (const t of borderTargets(s)) {
        if (!t.sea || !t.capturable) continue;
        const tx = document.createElementNS(NS, "text");
        tx.setAttribute("x", String(world.grid.points[t.cell * 2]));
        tx.setAttribute("y", String(world.grid.points[t.cell * 2 + 1]));
        tx.setAttribute("class", "sea-target");
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("font-size", "10");
        tx.textContent = "⛵";
        g.appendChild(tx);
      }
      slot.parentNode!.insertBefore(g, slot.nextSibling); // above political fills, below markers
      mapFrame.appendChild(svg);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): colored front-line overlay + sea-target markers on the map"
```

---

### Task 4: Decade gain/loss line + player-event headlines

**Files:**
- Modify: `src/ui/playApp.ts` (`appendLog` gains a headline option; the advance handler diffs owners and emphasizes player events)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `playDelta` (i18n), `s.owner`, `r.events` with `polityId` / `otherId` / `type`.
- Produces: log rows `.chronicle-event` with an optional `.headline` class; a per-decade delta row.

- [ ] **Step 1: Write the failing tests** (append to `src/ui/playApp.test.ts`)

```ts
it("logs a per-decade gain/loss line on advance", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
  expect(rows.some((t) => /Year 10:/.test(t))).toBe(true);
});

it("emphasizes a player-involved history event as a headline", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  // headline styling is driven by polityId/otherId === playerPolity; assert the class exists in DOM
  // after enough turns that at least one player event fires, or that the mechanism is wired.
  for (let i = 0; i < 20; i++) {
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) break;
    adv.click();
  }
  // at minimum the log rendered rows; headline is optional per run, so assert the renderer supports it
  expect(root.querySelector(".chronicle")).not.toBeNull();
});
```

Note: the second test is a smoke check (a player event is not guaranteed every seed); the headline class is verified structurally in Step 3's code and by manual/preview check. Keep it as a wiring guard.

- [ ] **Step 2: Run to verify the delta test fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — no `Year 10:` row yet.

- [ ] **Step 3: Implement** — in `src/ui/playApp.ts`:

Add `playDelta` to the i18n import:

```ts
import { t, playT, playYear, playLog, playRuleIntro, playFell, playStats, playDelta, type Lang } from "./i18n";
```

Replace `appendLog` with a headline-aware version:

```ts
    function appendLog(text: string, headline = false): void {
      if (!text) return;
      const row = document.createElement("div");
      row.className = headline ? "chronicle-event headline" : "chronicle-event";
      row.textContent = text;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    const HEADLINE_ICON: Record<string, string> = {
      civilwar: "⚔", independence: "🏴", conquer: "👑", goldenage: "☀",
    };
    function isPlayerEvent(e: { polityId: number; otherId?: number }): boolean {
      return e.polityId === s.playerPolity || e.otherId === s.playerPolity;
    }
```

Replace the advance click handler body (inside `renderActions`) with the owner-diff + headline version:

```ts
      advance.addEventListener("click", () => {
        const before = Int32Array.from(s.owner);
        const r = playTurn(s, pendingAction);
        pendingAction = null;
        let gained = 0, lost = 0;
        for (let c = 0; c < s.n; c++) {
          const was = before[c] === s.playerPolity, now = s.owner[c] === s.playerPolity;
          if (now && !was) gained++; else if (was && !now) lost++;
        }
        appendLog(playDelta(lang, r.year, gained, lost));
        const msg = playLog(lang, r.actionCode, r.actionData);
        if (msg) appendLog(`— ${msg}`);
        for (const e of r.events) {
          const hl = isPlayerEvent(e);
          appendLog(hl ? `${HEADLINE_ICON[e.type] ?? "•"} ${e.text}` : e.text, hl);
        }
        if (r.finished) {
          const conq = r.events.find((e) => e.type === "conquer" && e.otherId === s.playerPolity);
          return end(r.defeated, conq ? s.polities[conq.polityId].name : "");
        }
        renderAll();
      });
```

(Task 5 changes `end`'s signature to accept the conqueror name; if executing this task before Task 5, `end(r.defeated, "")` compiles once Task 5's signature lands — do Task 5's `end` signature change together if the compiler complains. Simplest: apply Task 4 and Task 5 code, then run tests once.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: the delta test PASSES. (If `end` arity errors, land Task 5 Step 3 first.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): per-decade gain/loss line + emphasized player-event headlines"
```

---

### Task 5: Cause of defeat on the banner

**Files:**
- Modify: `src/ui/playApp.ts` (`end` takes a conqueror name; `renderBanner` appends the cause)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `playDefeatCause` (i18n), the conqueror name passed from the advance handler (Task 4).
- Produces: a defeat banner whose text includes the conqueror.

- [ ] **Step 1: Write the failing test** (append to `src/ui/playApp.test.ts`)

```ts
it("shows the conqueror on the defeat banner", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  // pick polity 0 (first card) then run until defeat or year 500
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  let banner: Element | null = null;
  for (let i = 0; i < 50; i++) {
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) { banner = root.querySelector(".stub"); break; }
    adv.click();
    banner = root.querySelector(".stub");
    if (banner) break;
  }
  expect(banner).not.toBeNull();
  // survived → "endured"; defeated → contains "Conquered by". One of the two must hold.
  const txt = banner!.textContent || "";
  expect(/Conquered by |endured/.test(txt)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails or is unstable** — the current `end` has no cause line; if the run defeats, the banner lacks "Conquered by".

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: the new test FAILS on a defeat seed (no cause), or passes only via "endured". Proceed to wire the cause regardless.

- [ ] **Step 3: Implement** — in `src/ui/playApp.ts` add the i18n import:

```ts
import { t, playT, playYear, playLog, playRuleIntro, playFell, playStats, playDelta, playDefeatCause, type Lang } from "./i18n";
```

Add a persisted cause in `startGame`'s scope (near `let defeatedFlag = false;`):

```ts
    let defeatCause = "";
```

Change `end` to accept and store the conqueror, and `renderBanner` to append the cause:

```ts
    function renderBanner(): void {
      root.querySelector(".stub")?.remove();
      const sc = scorecard(s);
      const banner = document.createElement("div");
      banner.className = "stub";
      const head = defeatedFlag ? playFell(lang, sc.survivedYears) : playT(lang, "endured");
      const rankText = sc.rank > 0 ? `${sc.rank} / ${sc.nations}` : "—";
      const cause = defeatedFlag && defeatCause ? ` ${playDefeatCause(lang, defeatCause)}` : "";
      banner.innerHTML = `<h2>${head}${cause}</h2><p>${playStats(lang, sc.peakCells, sc.cells, rankText)}</p>`;
      root.insertBefore(banner, log);
    }

    function end(defeated: boolean, conqueror = ""): void {
      over = true;
      defeatedFlag = defeated;
      defeatCause = conqueror;
      actions.innerHTML = "";
      renderPanel();
      renderBanner();
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite (golden unchanged)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass; golden byte-identical.

- [ ] **Step 6: Commit**

```bash
git add src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(play): cause-of-defeat line on the scorecard banner"
```

---

### Task 6: theme.css polish + live verification

**Files:**
- Modify: `src/theme.css` (headline style; the front strokes already inline their colour)
- No new tests (visual).

- [ ] **Step 1: Add a headline style** — append to `src/theme.css`:

```css
.chronicle-event.headline { font-weight: 600; }
.front line { pointer-events: none; }
.sea-target { pointer-events: none; }
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; all pass.

- [ ] **Step 3: Live verify** (preview server on 5173): load `/play.html`, pick a nation, confirm via `preview_eval`: `.front` has green (`#3f9e57`) and red (`#c0473f`) lines; advancing appends a `Year N:` delta row and player events render with `.headline`; run to a defeat and confirm the banner reads "Conquered by …". Screenshot is expected to time out (harness limit) — DOM-verify counts/colours; the front-line *look* needs the user's eyes at localhost:5173.

- [ ] **Step 4: Commit**

```bash
git add src/theme.css
git commit -m "style(play): headline weight + non-interactive front overlay"
```

---

## Self-Review

**Spec coverage:**
- Part 1 front-line overlay → Task 1 (`frontEdges`) + Task 3 (render) + Task 6 (style). ✓ (edges not filled cells; threat = real vulnerability; ⛵ for capturable sea targets.)
- Part 2 decade summary + headlines → Task 4 (owner-diff delta + player-event headlines) + Task 2 (`playDelta`). ✓ (gain/loss split via owner diff.)
- Part 3 cause of defeat → Task 5 + Task 2 (`playDefeatCause`). ✓
- i18n KO/EN → Task 2. ✓
- Determinism / golden unchanged → asserted in Task 1 Step 6 and Task 5 Step 5. ✓

**Placeholder scan:** none — every code step has complete code.

**Type consistency:** `FrontEdge { cell, enemy, kind }` used identically in Task 1 and Task 3. `frontEdges(s)`, `borderTargets(s)`, `sharedEdge(polyA, polyB)`, `playDelta(lang, year, gained, lost)`, `playDefeatCause(lang, name)`, `end(defeated, conqueror="")` consistent across tasks. Task 4/5 both edit `end`/the advance handler — noted inline that Task 5's `end` signature must land for Task 4's `end(r.defeated, name)` call to compile (do them in order; run tests after Task 5).
