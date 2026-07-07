# Play-mode Map & Controls UX Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Version-B play screen legible: a near-full-width map, a clear "which nation is mine" signal, and a slim command bar replacing the four stacked dropdowns.

**Architecture:** All changes are in the play UI (`src/ui/playApp.ts`, `src/theme.css`, `src/ui/i18n.ts`). Three independently-viewable tasks: (1) vertical-stack layout so the map gets dominant width, (2) nation chip + capital crown + own-territory tint + suppress the in-map nation legend, (3) rewrite `renderActions` into a slim command bar (invest 2-segment + labelled peace + pass + advance; attack/found via existing map-click). No engine change → golden hashes byte-identical.

**Tech Stack:** TypeScript, Vite MPA, Vitest (jsdom), plain DOM/SVG.

## Global Constraints

- **Play-UI only.** Do NOT edit any engine file (`historySim.ts`, `intervention.ts`, `world.ts`, `dilemma.ts`, `standing.ts`, `playSim.ts`). No tuning constant changes. Engine/world/history/playSim golden-hash tests MUST stay byte-identical.
- **Every user-facing string via `playT(lang, key)`** with BOTH `en` and `ko` entries — no hard-coded linguistic literals (directional/icon glyphs like ♛ 💰 🕊 ▶ are allowed literal, matching existing precedent).
- **Preserve the existing `advance` button handler verbatim** (the momentum capture + `playTurn` + event logging block) when rewriting `renderActions` — copy it exactly, only its surrounding controls change.
- **Preserve existing map-click behaviour** — attack targets and found-city sites are already clickable in `renderMap`; do not remove those handlers.
- Run tests from THIS worktree with `npm test`. Baseline: **400 tests**.
- Layout/visual LOOK cannot be verified in jsdom and the harness screenshot is broken → after each task, the change is viewable at localhost:5173/play.html for the user to eyeball; the automated tests assert DOM structure only.

---

### Task 1: Vertical-stack layout (map gets dominant width)

**Files:**
- Modify: `src/ui/playApp.ts` (the DOM assembly in `startGame`, ~lines 72-102)
- Modify: `src/theme.css` (replace the `.play-grid`/`.play-main`/`.play-side` rules ~lines 118-127)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: play screen DOM is a single centred column `.play-col` containing, in order: `.play-panel` (standing strip), `.stage` (map), `.dilemma`, `.play-actions` (command bar), `.chronicle` (log). The `.play-grid`/`.play-main`/`.play-side` structure is gone.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts` inside `describe("playApp", ...)`:

```ts
  it("lays the play screen out as a single centred column (map gets full width)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".play-col")).not.toBeNull();
    expect(root.querySelector(".play-side")).toBeNull();   // old 2-col sidebar gone
    expect(root.querySelector(".play-grid")).toBeNull();
    // map, standing strip, and command bar all live inside the column
    const col = root.querySelector(".play-col")!;
    expect(col.querySelector("svg.world")).not.toBeNull();
    expect(col.querySelector(".play-panel")).not.toBeNull();
    expect(col.querySelector(".play-actions")).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `.play-col` is null (still `.play-grid`/`.play-side`).

- [ ] **Step 3: Restructure the DOM assembly**

In `src/ui/playApp.ts`, replace the assembly block (currently lines ~85-96, from the `// game layout:` comment through `root.append(howtoBox, grid);`) with:

```ts
    // vertical stack: a thin standing strip on top, then the big map, the dilemma card, the slim
    // command bar, and the log — so the map gets the full column width (user feedback: map too small)
    const col = document.createElement("div");
    col.className = "play-col";
    col.append(panel, stage, dilemmaBox, actions, log);
    root.append(howtoBox, col);
```

(Delete the now-unused `grid`, `main`, `side` element creations. `panel`, `stage`, `dilemmaBox`, `actions`, `log` are created exactly as before, just parented differently.)

- [ ] **Step 4: Update CSS**

In `src/theme.css`, replace the play-layout block (lines ~118-127, the `#play` rule stays, replace `.play-grid`/`.play-main`/`.play-side`/`.play-actions`/`@media` play rules) with:

```css
#play { max-width: 1440px; margin: 0 auto; padding: 0 16px 32px; }
/* single centred column: the map takes the full width, capped for readability on large screens */
.play-col { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
/* standing strip: horizontal, wraps on narrow screens */
.play-panel { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.play-panel .standing { flex-direction: row; flex-wrap: wrap; gap: 4px 10px; }
/* command bar: a slim horizontal row under the map */
.play-actions.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.chronicle { max-height: 240px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- playApp`
Expected: PASS (new test + existing 24 playApp tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): vertical-stack layout — full-width map, standing strip on top, command bar under"
```

Manual check (user): localhost:5173/play.html — the map is now much wider; standing panel is a strip on top; controls sit under the map.

---

### Task 2: Nation emphasis (chip + capital crown + own tint, suppress in-map legend)

**Files:**
- Modify: `src/ui/playApp.ts` (`renderPanel` — add the chip; `renderMap` — add crown/tint + `legend:false`)
- Modify: `src/ui/i18n.ts` (add `yourNation` to both `en` and `ko` blocks)
- Modify: `src/theme.css` (chip + swatch + crown + tint styles)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `nationColor` from `./nationPalette`; `s.capitals[playerPolity]`.
- Produces: `.nation-chip` (with `.nation-swatch`) in the standing strip; `.capital-crown` text + `.own-tint` path on the map; the map no longer contains a `.nation-legend` group.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts`:

```ts
  it("shows which nation is the player's: chip with coloured swatch + capital crown, no in-map legend", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const chip = root.querySelector(".nation-chip");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toMatch(/\S/);                       // has the nation name
    expect(root.querySelector(".nation-chip .nation-swatch")).not.toBeNull();
    expect(root.querySelector(".capital-crown")).not.toBeNull();   // ♛ on the map
    expect(root.querySelector(".own-tint")).not.toBeNull();        // own-territory wash
    expect(root.querySelector("svg.world .nation-legend")).toBeNull(); // in-map legend suppressed
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `.nation-chip` is null.

- [ ] **Step 3: Add the `yourNation` i18n key**

In `src/ui/i18n.ts`, add to the **`en`** play block (near `strength: "power", ...`): `yourNation: "You rule",`
Add to the **`ko`** play block (near `strength: "국력", ...`): `yourNation: "당신의 국가",`

- [ ] **Step 4: Import `nationColor` and add the chip in `renderPanel`**

In `src/ui/playApp.ts`, add the import near the other `./` UI imports:

```ts
import { nationColor } from "./nationPalette";
```

In `renderPanel`, right after the line that sets `panel.innerHTML = \`<b class="play-year">${year}</b> · ${name}\`;` (the live-player branch), insert the chip as the first child:

```ts
      const chip = document.createElement("span");
      chip.className = "nation-chip";
      const sw = document.createElement("span");
      sw.className = "nation-swatch";
      sw.style.background = nationColor(s.playerPolity);
      chip.append(sw, document.createTextNode(` ${playT(lang, "yourNation")}: ${name}`));
      panel.insertBefore(chip, panel.firstChild);
```

- [ ] **Step 5: Add crown + tint and suppress the legend in `renderMap`**

In `src/ui/playApp.ts` `renderMap`, change the political-layer call (currently `slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, politicalOpts("political")));`) to suppress the in-map nation legend:

```ts
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, { fills: true, labels: true, legend: false }));
```

Then, just before the final `slot.parentNode!.insertBefore(g, slot.nextSibling);` line, add the own-territory tint and the capital crown to the overlay group `g`:

```ts
      // own-territory tint: a faint light wash so the player's realm reads brighter than neighbours
      const mine: number[] = [];
      for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) mine.push(c);
      if (mine.length) {
        const tint = document.createElementNS(NS, "path");
        tint.setAttribute("d", mine.map((c) => cellPath(world.grid.polygons[c])).join(""));
        tint.setAttribute("class", "own-tint");
        tint.setAttribute("fill", "rgba(255,250,235,0.12)");
        tint.setAttribute("pointer-events", "none");
        g.insertBefore(tint, g.firstChild); // under the interactive targets and front lines
      }
      // capital crown — only while the player still holds the seat
      const cap = s.capitals[s.playerPolity];
      if (s.owner[cap] === s.playerPolity) {
        const crown = document.createElementNS(NS, "text");
        crown.setAttribute("x", String(world.grid.points[cap * 2]));
        crown.setAttribute("y", String(world.grid.points[cap * 2 + 1]));
        crown.setAttribute("class", "capital-crown");
        crown.setAttribute("text-anchor", "middle");
        crown.setAttribute("font-size", "13");
        crown.setAttribute("pointer-events", "none");
        crown.textContent = "♛";
        g.appendChild(crown);
      }
```

(`politicalOpts` may now be unused in `playApp.ts` — if `tsc --noEmit` flags it via `noUnusedLocals`, remove it from the import on line 10; if still used elsewhere, leave it.)

- [ ] **Step 6: Add CSS**

In `src/theme.css`, after the standing-panel block (near `.threat-line`), add:

```css
.nation-chip { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: #2a2118;
  padding: 2px 8px; background: #f2ead8; border-radius: 4px; }
.nation-swatch { width: 12px; height: 12px; border: 1px solid #8a7a5c; border-radius: 2px; display: inline-block; }
.capital-crown { fill: #b8860b; stroke: #f3ead2; stroke-width: 0.5px; paint-order: stroke; }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- playApp`
Expected: PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): nation emphasis — you-rule chip, capital crown, own-territory tint, no in-map legend"
```

Manual check (user): the chip names your nation with its colour swatch; a ♛ marks your capital; your realm reads slightly brighter; the cluttered in-map colour list is gone.

---

### Task 3: Slim command bar (replace the four dropdowns)

**Files:**
- Modify: `src/ui/playApp.ts` (rewrite `renderActions`, ~lines 373-510)
- Modify: `src/ui/i18n.ts` (add `pass` to both blocks)
- Modify: `src/theme.css` (command-bar control styling)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: existing `investEffect`, `hostileNeighbors`, `pendingAction`, the map-click handlers (already set `pendingAction` to attack/foundCity), and the existing `advance` handler body (copy verbatim).
- Produces: command bar with `.action-status` text, an `.invest-seg` 2-button segment, a `.peace-select`, a `.btn-pass`, and `.btn-advance`; NO `.attack-select`/`.found-select`/`.invest-select`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts`:

```ts
  it("command bar has invest segments + labelled peace + advance, and no dropdown clutter", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".invest-seg")).not.toBeNull();
    expect(root.querySelectorAll(".invest-seg button").length).toBe(2); // 전국 | 국경
    expect(root.querySelector(".peace-select")).not.toBeNull();
    expect(root.querySelector(".btn-advance")).not.toBeNull();
    expect(root.querySelector(".btn-pass")).not.toBeNull();
    expect(root.querySelector(".action-status")).not.toBeNull();
    // the old four stacked dropdowns are gone
    expect(root.querySelector(".attack-select")).toBeNull();
    expect(root.querySelector(".found-select")).toBeNull();
    expect(root.querySelector(".invest-select")).toBeNull();
  });

  it("advancing a year still works from the new command bar", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const yearBefore = root.querySelector(".play-year")!.textContent;
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".play-year")!.textContent).not.toBe(yearBefore);
  });
```

- [ ] **Step 2: Update the existing test that asserts the old status-button class**

The current mount test (`src/ui/playApp.test.ts`, in "shows a nation picker, then mounts the play screen on selection") asserts `expect(root.querySelector(".btn-attack")).not.toBeNull();`. Task 3 renames that status element from `.btn-attack` to `.action-status`. Change that one assertion to:

```ts
    expect(root.querySelector(".action-status")).not.toBeNull();   // action status line
```

- [ ] **Step 3: Run tests to verify the new ones fail (and the updated one is ready)**

Run: `npm test -- playApp`
Expected: FAIL — `.invest-seg` null, `.attack-select` still present; the updated `.action-status` assertion also fails until Step 5.

- [ ] **Step 4: Add the `pass` i18n key**

In `src/ui/i18n.ts`, add to the **`en`** play block: `pass: "Pass",`
Add to the **`ko`** play block: `pass: "패스",`

- [ ] **Step 5: Rewrite `renderActions`**

In `src/ui/playApp.ts`, replace the entire `renderActions` function (from `function renderActions(): void {` through its closing `}` before `appendLog`) with the following. NOTE: the `advance` handler body between the marked lines is COPIED VERBATIM from the current code — do not alter it.

```ts
    function renderActions(): void {
      actions.innerHTML = "";
      if (over) return; // a fallen realm has no actions (the banner tells the story)

      // the current pending action, in words — the bar always states what "Advance" will do,
      // so map-clicks (attack / found-city) have a visible confirmation
      const status = document.createElement("span");
      status.className = "action-status";
      const label = () =>
        !pendingAction ? playT(lang, "noAction")
          : pendingAction.type === "attack" ? playT(lang, "attackChosen")
            : pendingAction.type === "foundCity" ? playT(lang, "foundChosen")
              : pendingAction.type === "peace" ? playT(lang, "peaceChosen")
                : playT(lang, pendingAction.scope === "border" ? "investFrontierChosen" : "investRealmChosen");
      status.textContent = label();

      // invest = a 2-segment control (전국 | 국경), each showing its numeric effect — not a dropdown
      const investSeg = document.createElement("span");
      investSeg.className = "view-toggle invest-seg";
      for (const scope of ["nation", "border"] as const) {
        const fx = investEffect(scope);
        const b = document.createElement("button");
        b.textContent = `💰 ${playT(lang, scope === "border" ? "investFrontierOpt" : "investRealmOpt")} (+${fx.gain}%p)`;
        b.title = playT(lang, "tipInvest");
        b.className = pendingAction?.type === "invest" && pendingAction.scope === scope ? "active" : "";
        b.addEventListener("click", () => {
          pendingAction = { type: "invest", scope };
          renderMap(); renderActions();
        });
        investSeg.appendChild(b);
      }

      // peace = the one remaining select, clearly labelled (not one of four tiny ones)
      const pce = document.createElement("select");
      pce.className = "peace-select";
      pce.title = playT(lang, "tipPeace");
      const pceNone = document.createElement("option");
      pceNone.value = ""; pceNone.textContent = playT(lang, "peacePlaceholder");
      pce.appendChild(pceNone);
      for (const h of hostileNeighbors(s)) {
        const opt = document.createElement("option");
        opt.value = String(h.id);
        opt.textContent = h.trucedUntil > s.tick ? `${h.name} ✓` : h.name;
        pce.appendChild(opt);
      }
      if (pendingAction?.type === "peace") pce.value = String(pendingAction.polity);
      pce.addEventListener("change", () => {
        pendingAction = pce.value ? { type: "peace", polity: Number(pce.value) } : null;
        renderMap(); renderActions();
      });

      // pass clears any pending action
      const pass = document.createElement("button");
      pass.className = "btn-pass";
      pass.textContent = playT(lang, "pass");
      pass.addEventListener("click", () => { pendingAction = null; renderMap(); renderActions(); });

      const advance = document.createElement("button");
      advance.className = "btn-advance";
      advance.textContent = playT(lang, "advance");
      // --- BEGIN verbatim advance handler (do not modify) ---
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
        dilemma = offerDilemma(s); // an unanswered card expires with the decade
        renderAll();
      });
      // --- END verbatim advance handler ---

      actions.append(status, investSeg, pce, pass, advance);
    }
```

- [ ] **Step 6: Add command-bar CSS**

In `src/theme.css`, add near the play-actions rule:

```css
.play-actions .action-status { font-weight: 600; color: #4a3d2c; margin-right: 4px; }
.play-actions .invest-seg button { font-size: 13px; }
.play-actions .peace-select { max-width: 200px; }
.play-actions .btn-advance { margin-left: auto; font-weight: 700; }
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS (new tests + existing green).
Run: `npm test` → all pass (**404 tests** = 400 + Task1 1 + Task2 1 + Task3 2), no golden regressions.
Run: `npx tsc --noEmit` → clean. Run: `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): slim command bar — invest segments, labelled peace, pass/advance; drop 4 dropdowns"
```

Manual check (user): the four dropdowns are gone; invest is two clear segments, peace is one labelled menu, Advance is the prominent button; attacking/founding is done by clicking the map with a status line confirming the pick.

---

## Self-Review

**1. Spec coverage:**
- ① dominant-width map (vertical stack, capped column) → Task 1. ✓
- ② nation chip + capital crown + own tint + suppress in-map legend → Task 2. ✓
- ③ slim command bar: status text, invest 2-segment, labelled peace, pass, advance; attack/found via map-click → Task 3. ✓
- Rejected bold-outline (self-critique) → not implemented (tint instead). ✓
- Play-UI only / goldens intact → Global Constraints + no engine edits. ✓
- Independently viewable per task → each task ends with a manual-check note. ✓

**2. Placeholder scan:** No TBD/TODO. The verbatim advance handler is fully reproduced (not "same as before"). All code blocks complete.

**3. Type consistency:** `pendingAction` (`Action | null`) branches match the existing `Action` shape (`attack{cell}`, `invest{scope}`, `foundCity{cell}`, `peace{polity}`). `nationColor(id: number): string` used with `s.playerPolity`. `s.capitals: number[]` indexed by polity. i18n keys added (`yourNation`, `pass`) are the exact keys passed to `playT`; reused keys (`noAction`, `attackChosen`, `foundChosen`, `peaceChosen`, `investFrontierChosen`, `investRealmChosen`, `investFrontierOpt`, `investRealmOpt`, `peacePlaceholder`, `tipInvest`, `tipPeace`) already exist. New DOM classes (`.play-col`, `.nation-chip`, `.nation-swatch`, `.capital-crown`, `.own-tint`, `.invest-seg`, `.action-status`, `.btn-pass`) are the exact classes the tests query.
