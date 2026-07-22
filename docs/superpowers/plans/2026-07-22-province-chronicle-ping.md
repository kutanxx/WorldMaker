# Province name → map ping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the province game, clicking any UI row that NAMES a province flashes that province's outline on the map, so the player can find the land the game is talking about.

**Architecture:** One ephemeral SVG node appended to the live map svg and removed by its own animation — no state, no re-render, mirroring `pingMap` in `playApp.ts`. Three call sites (risk panel, dilemma card title, chronicle log) share one `makePingable` affordance helper. UI-only: no engine file is touched, so every golden hash is untouched by construction.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-22-province-chronicle-ping-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`, `src/theme.css`. Nothing else.
- **Do not touch `src/engine/`.** The golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`) must stay untouched — they will, as long as no engine file changes.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- Both languages: every user-visible string needs a `ko` and an `en` form, following the existing `lang === "ko" ? ... : ...` pattern in this file.
- Baseline before you start: **643 tests passing**.
- Commit after each task on the current branch. Do not merge, do not push.

---

### Task 1: `pingProvince` + the risk panel

Delivers the whole mechanism plus the highest-value call site: the defection risk panel, which today names a province and prescribes a remedy for land the player cannot locate.

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for Tasks 2 and 3:
  - `export function provinceOutlinePath(world: World, provId: number): string` — module-level, pure. (Today it is a closure taking `UI`; this task lifts it out so tests can assert the ping's exact geometry.)
  - `function pingProvince(u: UI, provId: number): void` — closure inside `mountProvinceApp`.
  - `function makePingable(el: HTMLElement, u: UI, provId: number): void` — closure inside `mountProvinceApp`; adds class `prov-pingable`, `data-province`, a `title` tooltip, and the click listener.
  - CSS classes `.prov-pingable`, `.prov-ping`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`. Note the import line at the top of the file must gain `provinceOutlinePath`:

```ts
// top of file — extend the existing import from "./provinceApp"
import {
  mountProvinceApp, provinceCellOwner, isDomination, shakyOpacity, reasonText, survivalGrade, defectionReasonText,
  sortRisksByUrgency, provinceOutlinePath,
} from "./provinceApp";
```

```ts
describe("province ping (a named province is click-to-locate on the map)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  // Drive an all-in blitz until the player holds land under enough pressure to be at risk of defecting —
  // the same driver the existing risk-panel test uses.
  function blitzUntilRisk(): Element | null {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 0; t < 40 && !root.querySelector(".prov-risk-row"); t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); t--; continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game ended
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    return root.querySelector(".prov-risk-row");
  }

  it("flashes the province's own outline when a risk row is clicked", () => {
    const row = blitzUntilRisk();
    expect(row).toBeTruthy();                                   // the driver reached a risk state
    expect(row!.classList.contains("prov-pingable")).toBe(true); // the row advertises itself as clickable
    expect(root.querySelector(".prov-map .prov-ping")).toBeNull(); // nothing pinged yet

    row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ping = root.querySelector(".prov-map .prov-ping") as SVGPathElement;
    expect(ping).toBeTruthy();
    // it is THAT province's outline, not a generic marker
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const provId = Number((row as HTMLElement).dataset.province);
    expect(ping.getAttribute("d")).toBe(provinceOutlinePath(world, provId));
    expect(ping.getAttribute("style") || "").toContain("pointer-events:none"); // never blocks target clicks
  });

  it("removes itself so pings don't pile up", () => {
    vi.useFakeTimers();
    try {
      const row = blitzUntilRisk();
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".prov-ping")).toBeTruthy();
      vi.advanceTimersByTime(2000); // jsdom fires no animationend — the fallback timer must clean up
      expect(root.querySelector(".prov-ping")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("provinceOutlinePath (pure province boundary)", () => {
  it("returns a non-empty path per province and differs between provinces", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const a = provinceOutlinePath(world, 0);
    const b = provinceOutlinePath(world, 1);
    expect(a.startsWith("M")).toBe(true);
    expect(b.startsWith("M")).toBe(true);
    expect(a).not.toBe(b);
  });
});
```

`vi` must be in the vitest import at the top of the test file:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — `provinceOutlinePath` is not exported (import error / undefined).

- [ ] **Step 3: Lift `provinceOutlinePath` to module scope and export it**

In `src/ui/provinceApp.ts`, add `World` to the types import:

```ts
import { DEFAULT_PARAMS, type World } from "../types/world";
```

Delete the closure version (currently `function provinceOutlinePath(u: UI, provId: number)` inside `mountProvinceApp`) and add this at module scope, next to the other exported helpers (e.g. after `defectionReasonText`):

```ts
// clean OUTLINE of a whole province (its boundary against other provinces + ocean), not the jagged
// per-cell mesh — so a highlight reads as a province, not a pile of cells. Pure + exported so the
// ping's geometry is directly testable.
export function provinceOutlinePath(world: World, provId: number): string {
  const grid = world.grid;
  const po = world.provinceOf;
  const segs: Segment[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (po[i] !== provId) continue;
    for (const j of grid.neighbors[i]) {
      if (po[j] === provId) continue; // internal cell edge — skip
      const e = sharedEdge(grid.polygons[i], grid.polygons[j]);
      if (e) segs.push(e);
    }
  }
  return segPath(segs);
}
```

Update the three existing call sites to pass the world (they are inside `mountProvinceApp`, where `u: UI` is in scope):

- in `defectionOverlay`: `d: provinceOutlinePath(u.world, p),`
- in `targetOverlay`: `d: provinceOutlinePath(u.world, prov.id),`
- in `fortifyOverlay`: `d: provinceOutlinePath(u.world, prov.id),`

- [ ] **Step 4: Add `pingProvince` and `makePingable`**

Inside `mountProvinceApp`, after the `buildMap` function:

```ts
  // ephemeral gold flash of a province OUTLINE on the CURRENT map svg — it answers "this name is WHICH
  // land?". No state, no re-render: a later render() rebuilds the svg and the ping is gone (transient by
  // design). pointer-events off so it can never block target/fortify clicks.
  function pingProvince(u: UI, provId: number): void {
    const svg = root.querySelector(".prov-map");
    if (!svg) return;
    const path = svgEl("path", {
      class: "prov-ping", style: "pointer-events:none", d: provinceOutlinePath(u.world, provId),
      fill: "none", stroke: "#e8b53a", "stroke-width": 3.4, "stroke-linejoin": "round",
    });
    path.addEventListener("animationend", () => path.remove());
    window.setTimeout(() => path.remove(), 1400); // fallback — jsdom fires no animation events
    svg.appendChild(path);
  }

  // mark a row that NAMES a province as click-to-locate. The cursor/underline/tooltip affordance is not
  // decoration: without it nothing tells the player the row can be clicked.
  function makePingable(el: HTMLElement, u: UI, provId: number): void {
    el.classList.add("prov-pingable");
    el.dataset.province = String(provId);
    el.title = lang === "ko" ? "지도에서 위치 보기" : "show on map";
    el.addEventListener("click", () => pingProvince(u, provId));
  }
```

- [ ] **Step 5: Wire the risk panel rows**

In `render()`, in the risk-panel loop, immediately after the line that sets `row.textContent`:

```ts
          row.textContent = `⚠ ${ui.world.provinces[p].name} — ${turns} · ${defectionReasonText(r.reason, r.ownN, r.foeN, lang)}`;
          makePingable(row, ui, p);
```

- [ ] **Step 6: Add the CSS**

In `src/theme.css`, after the `.prov-log` rule:

```css
/* name → map ping: any row that NAMES a province is click-to-locate; clicking flashes that province's
   outline. Gold SOLID and brief — deliberately distinct from the amber DASHED, persistent defection ring. */
.prov-pingable { cursor: pointer; }
.prov-pingable:hover { text-decoration: underline dotted; text-underline-offset: 2px; }
.prov-ping { pointer-events: none; animation: wm-prov-ping 0.9s ease-out forwards; }
@keyframes wm-prov-ping {
  0%   { opacity: 0; }
  15%  { opacity: 1; }
  40%  { opacity: .15; }
  65%  { opacity: 1; }
  100% { opacity: 0; }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS, including the pre-existing risk-panel and target/fortify-ring tests (the lifted helper must not change any rendered `d`).

- [ ] **Step 8: Full suite + build**

Run: `npm test`
Expected: PASS, 646 tests (643 baseline + 3 new).

Run: `npm run build`
Expected: no TypeScript errors, build succeeds.

If the test count differs but everything passes, trust the actual count.

- [ ] **Step 9: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): click a defection risk row to flash that province on the map"
```

---

### Task 2: The dilemma card title

A dilemma demands a decision about a named province the player may never have seen. `muster` names no province (`d.prov` is `-1`) and must stay non-pingable.

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `makePingable(el, u, provId)` and the `.prov-ping` / `.prov-pingable` classes from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("dilemma card title pings its province", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("makes a placed dilemma's title click-to-locate, and leaves a placeless one alone", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let title: HTMLElement | null = null;
    for (let i = 0; i < 25; i++) {
      title = root.querySelector(".prov-dilemma-title");
      if (title) break;
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(title).toBeTruthy(); // a dilemma appeared within 25 turns

    if (title!.classList.contains("prov-pingable")) {
      // a placed dilemma (restless / defector): clicking the title flashes that province
      title!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".prov-map .prov-ping")).toBeTruthy();
    } else {
      // the muster dilemma names no province — clicking must not ping anything
      title!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".prov-map .prov-ping")).toBeNull();
      expect(title!.textContent || "").toMatch(/소집|muster/i);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- provinceApp`
Expected: FAIL — whichever branch the seed-1 dilemma lands in, either no `.prov-ping` appears for a placed dilemma, or (if it is `muster`) the test passes trivially. If it passes trivially, note it in the commit and keep the assertion — it still guards the placeless case.

- [ ] **Step 3: Wire the title**

In `dilemmaCard`, right after the title element is built:

```ts
    const h = document.createElement("div"); h.className = "prov-dilemma-title"; h.textContent = T[0];
    if (d.prov >= 0) makePingable(h, u, d.prov); // muster names no province — nothing to locate
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test`
Expected: PASS, 647 tests.

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "feat(playProvince): click a dilemma title to locate the province it is about"
```

---

### Task 3: The chronicle log

The log is currently `string[]` rendered as a single centred line joined by ` · `, and that rendering is **copy-pasted in three places** (game over, dilemma card, normal turn). This task carries the province through the log, wraps each entry in a span, and collapses the three copies into one helper. **The rendered look must not change** — same one-line, centred, ` · `-joined text.

**Files:**
- Modify: `src/ui/provinceApp.ts`
- Modify: `src/theme.css`
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `makePingable(el, u, provId)` from Task 1.
- Produces: `type LogEntry = { text: string; prov?: number }` and `function logEl(): HTMLElement` (closure inside `mountProvinceApp`).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("chronicle log entries locate themselves on the map", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function blitz(turns: number): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 0; t < turns; t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  }

  it("renders the log as separate entries, keeping the same one-line text", () => {
    blitz(6);
    const items = Array.from(root.querySelectorAll(".prov-log .prov-log-item"));
    expect(items.length).toBeGreaterThan(0);
    // regression: the visible text is still the entries joined by " · "
    expect((root.querySelector(".prov-log")!.textContent || "").trim())
      .toBe(items.map((i) => i.textContent).join(" · "));
  });

  it("pings the province a conquest entry names", () => {
    blitz(6);
    const item = root.querySelector(".prov-log .prov-log-item.prov-pingable") as HTMLElement;
    expect(item).toBeTruthy(); // conquests/losses carry a province
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ping = root.querySelector(".prov-map .prov-ping") as SVGPathElement;
    expect(ping).toBeTruthy();
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    expect(ping.getAttribute("d")).toBe(provinceOutlinePath(world, Number(item.dataset.province)));
  });

  it("leaves placeless entries (an eliminated nation) non-pingable", () => {
    blitz(30);
    const items = Array.from(root.querySelectorAll(".prov-log .prov-log-item")) as HTMLElement[];
    for (const it of items) {
      const placeless = /멸망|eliminated|결정|chose/.test(it.textContent || "");
      if (placeless) expect(it.classList.contains("prov-pingable")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — `.prov-log-item` does not exist (the log is one text node).

- [ ] **Step 3: Change the log's type and add the `logEl` helper**

In `mountProvinceApp`, replace the declaration:

```ts
  const log: string[] = [];
```

with:

```ts
  // a chronicle entry optionally carries the province it happened in, so the row can locate itself on the map
  type LogEntry = { text: string; prov?: number };
  const log: LogEntry[] = [];
```

Add this helper next to `makePingable`:

```ts
  // the chronicle strip — the SAME one centred line as before (entries joined by " · "), except each entry
  // is its own span so a placed one can be clicked to locate it. Was copy-pasted in three render branches.
  function logEl(): HTMLElement {
    const el = document.createElement("div");
    el.className = "prov-log";
    log.slice(0, 8).forEach((e, i) => {
      if (i > 0) el.appendChild(document.createTextNode(" · "));
      const span = document.createElement("span");
      span.className = "prov-log-item";
      span.textContent = e.text;
      if (typeof e.prov === "number" && ui) makePingable(span, ui, e.prov);
      el.appendChild(span);
    });
    return el;
  }
```

- [ ] **Step 4: Update every `log` writer to the new shape**

In the dilemma choice handler:

```ts
        log.unshift({ text: `${lang === "ko" ? "결정" : "chose"}: ${(choice === "a" ? T[2] : T[3]).split(" (")[0]}` });
```

In the advance handler:

```ts
        for (const c of ev.conquests) {
          if (c.to === pid) log.unshift({ text: `${lang === "ko" ? "정복" : "took"} ${ui!.world.provinces[c.prov].name}`, prov: c.prov });
          else if (c.from === pid) log.unshift({ text: `${lang === "ko" ? "상실" : "lost"} ${ui!.world.provinces[c.prov].name}`, prov: c.prov });
        }
        for (const d of ev.defections) {
          if (d.from === pid) log.unshift({ text: `${lang === "ko" ? "이탈" : "defected"} ${ui!.world.provinces[d.prov].name}`, prov: d.prov });
          else if (d.to === pid) log.unshift({ text: `${lang === "ko" ? "귀순" : "joined you"} ${ui!.world.provinces[d.prov].name}`, prov: d.prov });
        }
        for (const id of ev.eliminated) log.unshift({ text: `${ui!.world.polities[id]?.name ?? id} ${lang === "ko" ? "멸망" : "eliminated"}` });
```

(An eliminated nation is not a place — no `prov`.)

- [ ] **Step 5: Replace the three copy-pasted render blocks**

All three of these blocks:

```ts
        const logEl = document.createElement("div"); logEl.className = "prov-log";
        logEl.textContent = log.slice(0, 8).join(" · ");
        root.appendChild(logEl);
```

become a single line each (mind the game-over branch, the dilemma branch, and the end of the normal-turn branch):

```ts
      root.appendChild(logEl());
```

Note: the game-over branch renders while `ui` is non-null, so its entries stay pingable — the map is still on screen there.

- [ ] **Step 6: Add the span CSS**

In `src/theme.css`, right after the `.prov-log` rule:

```css
.prov-log-item { white-space: nowrap; }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS — including the pre-existing defection log test that reads `.prov-log` textContent for `이탈` / `귀순` (the joined text is unchanged).

- [ ] **Step 8: Full suite + build**

Run: `npm test`
Expected: PASS, 650 tests.

Run: `npm run build`
Expected: no TypeScript errors (watch for a now-unused local from the deleted blocks — `noUnusedLocals` is on).

- [ ] **Step 9: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts src/theme.css
git commit -m "feat(playProvince): chronicle entries carry their province and ping the map on click"
```

---

### Task 4: Real-browser verification

jsdom loads no CSS and does no layout, so every synthetic `dispatchEvent` above passes even if a real click would be blocked — exactly the 07-15 picker bug (`pointer-events: none` inherited from another rule made the map unclickable while jsdom tests passed). This task proves real clickability.

**Files:** none modified unless a defect is found.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a verification report.

- [ ] **Step 1: Start the dev server**

Use the preview tooling (`preview_start`) — never `npm run dev` via a shell tool. Open `playProvince.html`.

- [ ] **Step 2: Start a game and drive it to a risk state**

Click a nation on the picker map, then advance turns (arming targets) until the `.prov-risk` panel appears.

- [ ] **Step 3: Prove the rows are really clickable**

In the page, for a `.prov-risk-row`, compute its centre and check the hit test:

```js
const r = document.querySelector('.prov-risk-row').getBoundingClientRect();
document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.prov-pingable') !== null
```

Expected: `true`. Repeat for `.prov-log-item.prov-pingable`.

- [ ] **Step 4: Prove the ping renders and disappears**

Click the risk row, then immediately check `document.querySelectorAll('.prov-map .prov-ping').length` → 1, and its computed `stroke` is the gold `#e8b53a` (`rgb(232, 181, 58)`). After ~1.5s, check the count is 0.

- [ ] **Step 5: Prove the ping does not block play**

With a ping on screen, confirm `document.elementFromPoint` over a `.prov-target` still returns the target (the ping is `pointer-events: none`), and that clicking a target still arms it.

- [ ] **Step 6: Check the console**

`read_console_messages` — expected: no errors.

- [ ] **Step 7: Report**

Summarise the results. If a check fails, fix it in `provinceApp.ts` / `theme.css`, re-run `npm test`, and commit the fix.

**Not verifiable here:** whether the flash actually *reads* as a visible, pleasant highlight. Screenshots are harness-blocked, so that is the user's call after deploy.

---

## Self-review notes

- Spec coverage: risk panel → Task 1; dilemma title → Task 2; chronicle log + `logEl` dedup + unchanged text → Task 3; real-click limits → Task 4. Battle preview and map labels are explicit non-goals and have no task, as intended.
- Spec test #1 said "assert `d` equals `provinceOutlinePath`" — that required the helper to be exported, so Task 1 lifts it to module scope and updates its three existing call sites.
- Test-count estimates (646/647/650) drift in practice; trust the actual number when everything passes.
