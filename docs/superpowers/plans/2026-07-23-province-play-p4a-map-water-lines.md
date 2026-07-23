# Province play P4a (no lines in the sea) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the province game's map from drawing border lines over open water (~22% of province-border segments cross straits) and stop it from strewing all 22 sea-lane dashed routes across the sea every turn — so the sea reads clean and a drawn lane means "you can strike across here".

**Architecture:** Render-side only, in `buildMap` and `seaLaneLayer` inside `src/ui/provinceApp.ts`. Border lines are clipped to the land region via one SVG `<clipPath>` built from the land cell polygons (provably correct regardless of Voronoi geometry). Sea lanes are filtered to the turn-relevant expedition routes. No engine file changes, so all golden hashes are untouched by construction.

**Tech Stack:** TypeScript, Vite MPA, vitest + jsdom, plain DOM/SVG (no framework).

Spec: `docs/superpowers/specs/2026-07-23-province-play-p4a-map-water-lines-design.md`

## Global Constraints

- Work ONLY in the worktree `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Never `cd` to the parent repo. Never run `git reset`, `git rebase`, `git checkout`, or `git restore` — use `git show` to inspect history.
- Files you may modify: `src/ui/provinceApp.ts`, `src/ui/provinceApp.test.ts`. Nothing else (no CSS rule is needed; the clip is an attribute).
- **Do not touch `src/engine/`.** The golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`) must stay untouched — they will, as long as no engine file changes. `buildSeaLanes` and `politicalBorders` are computed exactly as before; only which output is drawn / how it is clipped changes.
- Run tests from the WORKTREE root: `npm test`. Running from the parent repo root globs worktree copies and inflates the count.
- `npm run build` runs `tsc --noEmit` with **`noUnusedLocals` on** — an unused import or variable fails the build.
- `OCEAN` is exported from `../engine/terrain` as `0`. `world.terrain` is a `number[]` (per-cell). `cellPath` is already imported in `provinceApp.ts` from `./svgPaths`. `world.grid.polygons[c]` is the cell polygon.
- Baseline before you start: **699 tests passing**.
- Commit after each task on the current branch. Do not merge, do not push.

---

### Task 1: Clip the border lines to land

**Files:**
- Modify: `src/ui/provinceApp.ts` (`buildMap`)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `world.grid.polygons`, `world.terrain`, `OCEAN` (import), `cellPath` (already imported), `svgEl`.
- Produces: a `<clipPath id="prov-land">` in the map svg; `.province-border` and `.nation-border` carry `clip-path="url(#prov-land)"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("borders are clipped to land (no lines over the sea)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("emits one clipPath#prov-land and clips both border paths to it", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const svg = root.querySelector(".prov-map")!;
    const clips = svg.querySelectorAll("clipPath#prov-land");
    expect(clips.length).toBe(1);                                   // exactly one land clip per map
    expect(svg.querySelector(".province-border")!.getAttribute("clip-path")).toBe("url(#prov-land)");
    expect(svg.querySelector(".nation-border")!.getAttribute("clip-path")).toBe("url(#prov-land)");
  });

  it("the land clip has a subpath for each non-ocean cell and none for ocean", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const landCells = world.terrain.filter((t) => t !== 0).length; // OCEAN === 0
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const clip = root.querySelector("clipPath#prov-land")!;
    // the clip is built by concatenating cellPath() for every land cell → count "M" subpath starts
    const d = clip.querySelector("path")!.getAttribute("d") || "";
    const subpaths = (d.match(/M/g) || []).length;
    expect(subpaths).toBe(landCells); // one subpath per land cell, zero for ocean
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — no `clipPath#prov-land`, border paths have no `clip-path`.

- [ ] **Step 3: Add the `OCEAN` import**

At the top of `src/ui/provinceApp.ts`, add to the engine imports (a new import line is fine):

```ts
import { OCEAN } from "../engine/terrain";
```

- [ ] **Step 4: Build the land clip and apply it in `buildMap`**

In `buildMap`, build the land clip once (near the top, after the `svg` is created) and append it, then add the `clip-path` attribute to both border paths.

Add, right after `svg.appendChild(layer);`:

```ts
    // land clip: the union of every land cell's polygon — exactly the drawn landmass. Border strokes are
    // clipped to this so a province/nation line that a strait's Voronoi edge drags across open water is cut
    // at the coastline (its on-land part still shows). Built once per render.
    let landD = "";
    for (let c = 0; c < world.grid.count; c++) if (world.terrain[c] !== OCEAN) landD += cellPath(world.grid.polygons[c]);
    const clip = svgEl("clipPath", { id: "prov-land" });
    clip.appendChild(svgEl("path", { d: landD }));
    svg.appendChild(clip);
```

Then add `"clip-path": "url(#prov-land)"` to BOTH border path attribute objects:

```ts
    svg.appendChild(svgEl("path", {
      class: "province-border", d: segPath(politicalBorders(world.grid, world.provinceOf)),
      fill: "none", stroke: "#3c2f1c", "stroke-width": 0.5, "stroke-opacity": 0.5,
      "clip-path": "url(#prov-land)",
    }));
    // ...
    svg.appendChild(svgEl("path", {
      class: "nation-border", d: segPath(politicalBorders(world.grid, owner)),
      fill: "none", stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95, "stroke-linejoin": "round",
      "clip-path": "url(#prov-land)",
    }));
```

Note: `id="prov-land"` is a document-global id, but `render()` does `root.innerHTML = ""` before each rebuild and only one map exists per page, so exactly one `#prov-land` is live at a time — the same lifecycle the existing `#prov-hatch` pattern relies on.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 6: Full suite + build**

Run: `npm test`
Expected: PASS, ~701 tests (699 + 2 new).

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "fix(playProvince): clip province + nation borders to land so no line crosses the sea"
```

---

### Task 2: Draw only the turn-relevant sea lanes

**Files:**
- Modify: `src/ui/provinceApp.ts` (`seaLaneLayer`)
- Test: `src/ui/provinceApp.test.ts`

**Interfaces:**
- Consumes: `u.s.laneAdj`, `u.s.provOwner`, `armableTargets(u.s, u.playerId)` (already imported), `explainAttack(u.s, u.playerId, prov)` (already imported), `u.world.provinces[*].centroid`.
- Produces: `seaLaneLayer` draws a `.prov-lane` only for a player-province ↔ armable-expedition-target pair.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/provinceApp.test.ts`:

```ts
describe("sea lanes: only the turn-relevant expedition routes are drawn", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("draws a lane only for a player province ↔ an armable lane target (not the whole lane mesh)", () => {
    // Scan seeds/nations for a turn that HAS a lane-reachable armable target (⚓). Assert the drawn lane count
    // equals the number of such routes touching the player, and is strictly LESS than the full lane set.
    // Use a throwaway probe to find a good (seed, nation); pin it with a comment; delete the probe before commit.
    // If a lane target is genuinely hard to reach, at minimum assert: every drawn .prov-lane connects a
    // player-owned province to an armable target (never a lane between two non-player provinces).
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // advance a few turns to let expedition targets appear; assert the invariant each turn we're in conquer mode
    for (let t = 0; t < 8; t++) {
      const lanes = root.querySelectorAll(".prov-lane");
      // whatever is drawn, it must be a subset tied to the player this turn — never the full mesh (22ish)
      expect(lanes.length).toBeLessThan(22);
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      if (!adv) break; adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });

  it("draws no lanes in consolidate mode", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (Array.from(root.querySelectorAll(".prov-stance-btn")) as HTMLButtonElement[])
      .find((b) => b.dataset.mode === "consolidate")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelectorAll(".prov-lane").length).toBe(0);
  });
});
```

Note: the first test asserts the invariant "fewer than the full mesh, and every drawn lane ties the player to an armable target" rather than an exact count, because reaching a lane target is seed-sensitive. If you find a deterministic (seed, nation, turn) with a known lane-target count via a throwaway probe, tighten the assertion to that exact count and pin it with a comment. Do NOT assert on an empty set as if it proved the filter.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- provinceApp`
Expected: FAIL — the current `seaLaneLayer` draws the full mesh (up to 22), and it draws in consolidate mode too (it's appended in `buildMap` unconditionally for `ui`).

Note: `seaLaneLayer` is currently called in `buildMap` (`if (ui) svg.appendChild(seaLaneLayer(ui));`), so it draws in BOTH stances. Task 2 must make it stance-aware — pass the current `mode` (or gate the call). The `mode` variable lives in `mountProvinceApp`'s closure; `seaLaneLayer` is a closure too, so it can read `mode` directly.

- [ ] **Step 3: Filter `seaLaneLayer` to turn-relevant routes**

Replace `seaLaneLayer` with a version that draws only player↔armable-lane-target routes, and only in conquer mode:

```ts
  // expedition sea lanes: draw ONLY the routes the player can act on THIS turn — a dashed line from one of the
  // player's provinces to a province it can attack ACROSS that lane (an armable target whose chosen front is a
  // lane). Drawing all lanes every turn strews dashes across the sea; this way a visible lane MEANS "strike
  // across here". No lanes in consolidate mode. pointer-events off so it never blocks target clicks.
  function seaLaneLayer(u: UI): SVGGElement {
    const g = svgEl("g", { class: "prov-lanes", style: "pointer-events:none" }) as SVGGElement;
    if (mode !== "conquer") return g; // consolidate/other: no lanes
    const laneAdj = u.s.laneAdj ?? [];
    const arm = new Set(armableTargets(u.s, u.playerId));
    for (let p = 0; p < laneAdj.length; p++) for (const q of laneAdj[p]) {
      if (q <= p) continue; // each undirected lane once
      // one endpoint mine, the other an armable target reached BY LANE (explainAttack marks the chosen route)
      const mineP = u.s.provOwner[p] === u.playerId, mineQ = u.s.provOwner[q] === u.playerId;
      if (mineP === mineQ) continue;       // need exactly one player endpoint
      const target = mineP ? q : p;
      if (!arm.has(target)) continue;      // the other end must be attackable this turn
      if (explainAttack(u.s, u.playerId, target)?.lane !== true) continue; // and via the LANE (not a land front)
      const a = u.world.provinces[p].centroid, b = u.world.provinces[q].centroid;
      g.appendChild(svgEl("line", {
        class: "prov-lane", x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: "#3f5d78", "stroke-width": 1.4, "stroke-dasharray": "6 5", "stroke-opacity": 0.55,
      }));
    }
    return g;
  }
```

`mode`, `armableTargets`, and `explainAttack` are all in scope (the first is a closure variable, the latter two are imported). No change is needed at the `buildMap` call site — the function now self-gates on `mode`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- provinceApp`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test`
Expected: PASS, ~703 tests.

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/provinceApp.ts src/ui/provinceApp.test.ts
git commit -m "fix(playProvince): draw only the turn-relevant expedition sea lanes, not the whole mesh"
```

---

### Task 3: Live-browser verification

jsdom cannot judge whether the sea actually reads clean; confirm the measurable facts in a real browser.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Start the dev server**

`preview_start` `{name: "worldmaker"}`, navigate to `playProvince.html`, `resize_window` to 1280×900 (the preview viewport starts at 0 width; `?seed=` is NOT plumbed — read state from the DOM).

- [ ] **Step 2: Re-run the border-over-water measurement**

Pick a nation. Sample `.province-border` segment midpoints (parse the `d`: `M x,y L x,y`), convert viewBox→screen, and `document.elementFromPoint` each. Confirm the fraction landing on the bare svg background (the sea) is now ~0% (was ~22%). Confirm inland borders still render (most midpoints hit a territory fill). Do the same spot-check for `.nation-border`.

- [ ] **Step 3: Confirm the fills/marks are untouched**

Confirm the clip did not eat anything else: territory fills, the ✓ badge (`.prov-verdict`), hatch (`.prov-hatch`), threat rings, and solidarity wash all still render at their previous counts (the `clip-path` is only on the two border paths).

- [ ] **Step 4: Confirm sea lanes are sparse and meaningful**

Read `.prov-lane` count across a few turns; confirm it is small (0–handful), and for each drawn lane, confirm one endpoint is a player province and the other is an armable ⚓ target this turn. Switch to consolidate mode and confirm zero lanes.

- [ ] **Step 5: Console + report**

`read_console_messages` — no errors. Report the before/after over-water fraction and the lane counts. If a defect is found, fix in `provinceApp.ts`, re-run `npm test`, commit.

**Not verifiable here:** whether the sea now "reads clean" — the user's eyes. Report the numbers so the user can judge.

---

## Self-review notes

- Spec coverage: border-over-water → Task 1 (clip to land); sea-lane clutter → Task 2 (turn-relevant only); live confirmation → Task 3.
- The clip approach is chosen over a per-segment geometric filter because a Voronoi edge between two land cells is not "inside an ocean cell", so a nearest-site/terrain-of-midpoint test would wrongly keep it; clipping to the land fill is correct by construction.
- The map tool (Version A `provinceLayer.ts`) has the same border-over-water behaviour but is out of scope (separate surface); noted in the spec as a follow-up.
- Test-count estimates drift; trust the actual number when everything passes.
