# Province Map Layer (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Provinces" map view to the map tool (Version A) that draws the P0 province partition — borders, a faint biome tint with hover names, and culled province labels.

**Architecture:** A new `src/ui/provinceLayer.ts` builds an SVG `<g class="province">` (tint fills with `<title>`, a border path from `politicalBorders(grid, provinceOf)`, and largest-first labels). `renderWorld` gains a `"province"` `MapView` that mounts this layer; `app.ts` gets a 4th view toggle; `deconflict.ts` learns a `.province-label` tier so the existing post-render cull applies.

**Tech Stack:** TypeScript, Vite MPA, Vitest, SVG.

## Global Constraints

- **No engine change / no rng:** P1 only READS `world.provinceOf` and `world.provinces` (built in P0). Golden hashes untouched.
- **Export fidelity:** styling that must survive PNG/SVG export uses inline SVG attributes (fill/opacity/stroke), NOT CSS — matches the existing biome/political layers.
- **jsdom:** `deconflictLabels` no-ops without `getBBox`, so tests assert STRUCTURE (element counts, classes, `data-*`, `<title>`), never culling/visibility.
- **Run tests from the WORKTREE root** (`npx vitest run ...`).
- **Build:** `npm run build` (`tsc --noEmit`, `noUnusedLocals`) — no unused imports.

---

### Task 1: `provinceLayer` — the SVG layer

**Files:**
- Create: `src/ui/provinceLayer.ts`
- Test: `src/ui/provinceLayer.test.ts`

**Interfaces:**
- Consumes: `svgEl` from `./renderer`, `cellPath, segPath` from `./svgPaths`, `politicalBorders` from `../engine/borders`, `BIOME_COLORS` from `../engine/biome`, `Province` from `../engine/provinces`.
- Produces: `export function provinceLayer(grid: GridLike, provinceOf: ArrayLike<number>, provinces: Province[], opts?: { fills?: boolean; labels?: boolean }): SVGGElement` where `GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points">`. Returns `<g class="province">` with `.province-fill[data-province]` (each with a `<title>`), one `.province-border` path, and `.province-label` texts (largest-first).

- [ ] **Step 1: Write the failing test**

```typescript
// src/ui/provinceLayer.test.ts
import { describe, it, expect } from "vitest";
import { provinceLayer } from "./provinceLayer";
import type { Province } from "../engine/provinces";

// 4 cells in a row (squares), cells 0-1 = province 0, cell 2 = province 1, cell 3 = ocean (-1)
const grid = {
  count: 4,
  points: [0, 0, 10, 0, 20, 0, 30, 0],
  polygons: [
    [[0, 0], [10, 0], [10, 10], [0, 10]],
    [[10, 0], [20, 0], [20, 10], [10, 10]],
    [[20, 0], [30, 0], [30, 10], [20, 10]],
    [[30, 0], [40, 0], [40, 10], [30, 10]],
  ] as number[][][],
  neighbors: [[1], [0, 2], [1, 3], [2]],
};
const provinceOf = [0, 0, 1, -1];
const provinces: Province[] = [
  { id: 0, name: "the Grey Fields", cells: 2, centroid: [5, 5], seedCell: 0, biome: 4 },
  { id: 1, name: "Iron Wastes", cells: 1, centroid: [20, 5], seedCell: 2, biome: 5 },
];

describe("provinceLayer", () => {
  it("draws a border path, a tinted+titled fill per province, and a label per province", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    expect(g.getAttribute("class")).toBe("province");
    // one border path with a non-empty d
    const border = g.querySelector("path.province-border")!;
    expect(border).not.toBeNull();
    expect((border.getAttribute("d") || "").length).toBeGreaterThan(0);
    // one fill per non-ocean province, each carrying its name as a <title>
    const fills = g.querySelectorAll("path.province-fill");
    expect(fills.length).toBe(2);
    const titles = [...fills].map((f) => f.querySelector("title")?.textContent);
    expect(new Set(titles)).toEqual(new Set(["the Grey Fields", "Iron Wastes"]));
    expect(fills[0].getAttribute("data-province")).not.toBeNull();
    // a label per province, largest-first (province 0 has more cells → comes first)
    const labels = [...g.querySelectorAll("text.province-label")].map((t) => t.textContent);
    expect(labels).toEqual(["the Grey Fields", "Iron Wastes"]);
  });

  it("skips ocean cells (province -1 contributes no fill)", () => {
    const g = provinceLayer(grid, provinceOf, provinces);
    // total fill paths equal province count (2), never 3 — the ocean cell is not its own fill
    expect(g.querySelectorAll("path.province-fill").length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/provinceLayer.test.ts`
Expected: FAIL — cannot resolve `./provinceLayer`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/ui/provinceLayer.ts
import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import { BIOME_COLORS } from "../engine/biome";
import type { Province } from "../engine/provinces";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points">;

// A dedicated "provinces" view layer: faint per-province biome tint (with a <title> so hovering any
// province names it), the province borders (same algorithm the political view uses, fed provinceOf),
// and province-name labels emitted largest-first so deconflictLabels keeps the biggest on collision.
export function provinceLayer(
  grid: GridLike, provinceOf: ArrayLike<number>, provinces: Province[],
  opts: { fills?: boolean; labels?: boolean } = {},
): SVGGElement {
  const { fills = true, labels = true } = opts;
  const g = svgEl("g", { class: "province" }) as SVGGElement;

  if (fills) {
    const byProv: string[] = provinces.map(() => "");
    for (let i = 0; i < grid.count; i++) {
      const p = provinceOf[i];
      if (p < 0 || p >= byProv.length) continue;
      byProv[p] += cellPath(grid.polygons[i]);
    }
    for (const prov of provinces) {
      if (!byProv[prov.id]) continue;
      const path = svgEl("path", {
        class: "province-fill", "data-province": prov.id, d: byProv[prov.id],
        fill: BIOME_COLORS[prov.biome] ?? "#cbb488", "fill-opacity": 0.18,
      });
      const title = svgEl("title");
      title.textContent = prov.name;
      path.appendChild(title);
      g.appendChild(path);
    }
  }

  g.appendChild(svgEl("path", {
    class: "province-border", d: segPath(politicalBorders(grid, provinceOf)),
    fill: "none", stroke: "#6b5a3f", "stroke-width": 0.5, "stroke-opacity": 0.7,
  }));

  if (labels) {
    const lg = svgEl("g", { class: "province-labels" });
    for (const prov of [...provinces].sort((a, b) => b.cells - a.cells)) {
      const tx = svgEl("text", {
        class: "province-label", x: prov.centroid[0], y: prov.centroid[1],
        "text-anchor": "middle", "font-size": 7,
      });
      tx.textContent = prov.name;
      lg.appendChild(tx);
    }
    g.appendChild(lg);
  }
  return g;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/provinceLayer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/provinceLayer.ts src/ui/provinceLayer.test.ts
git commit -m "feat(map): province SVG layer (borders, biome tint + hover name, labels)"
```

---

### Task 2: `"province"` MapView in `renderWorld`

**Files:**
- Modify: `src/ui/svgWorldRenderer.ts` (MapView type + slot dispatch + provinceLayer import)
- Test: `src/ui/svgWorldRenderer.test.ts`

**Interfaces:**
- Consumes: `provinceLayer` (Task 1), `world.provinceOf`, `world.provinces`.
- Produces: `MapView` now includes `"province"`; `renderWorld(world, "province")` mounts a `.province` layer inside `.political-slot`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/ui/svgWorldRenderer.test.ts (inside the existing describe that has `world` + renderWorld)
  it("renders a province view: province layer, no nation labels, biomes muted", () => {
    const pv = renderWorld(world, "province");
    expect(pv.querySelectorAll(".political-slot .province").length).toBe(1);
    expect(pv.querySelectorAll(".province .province-border").length).toBe(1);
    expect(pv.querySelectorAll(".province .province-fill").length).toBeGreaterThan(1);
    expect(pv.querySelectorAll(".nation-labels").length).toBe(0);         // not the political view
    expect(pv.querySelector(".biomes")?.getAttribute("opacity")).toBe("0.6"); // muted like political/culture
  });
```

(If `world`/`renderWorld` are scoped inside an existing `describe` block, place this `it` there; otherwise add `import { renderWorld } from "./svgWorldRenderer";` and build `const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;` mirroring the file's existing setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/svgWorldRenderer.test.ts -t "province view"`
Expected: FAIL — `.province` layer not found (view falls through to politicalLayer).

- [ ] **Step 3: Modify `svgWorldRenderer.ts`**

Add the import near the existing layer imports:

```typescript
import { provinceLayer } from "./provinceLayer";
```

Change the `MapView` type declaration to:

```typescript
export type MapView = "terrain" | "political" | "culture" | "province";
```

Replace the slot-append (the `slot.appendChild(view === "culture" ? cultureLayer(...) : politicalLayer(...))` block) with:

```typescript
  const slot = svgEl("g", { class: "political-slot" });
  slot.appendChild(
    view === "culture" ? cultureLayer(grid, world.cultureOf, world.cultures)
      : view === "province" ? provinceLayer(grid, world.provinceOf, world.provinces)
        : politicalLayer(grid, world.polityOf, world.polities, politicalOpts(view)));
  root.appendChild(slot);
```

(Biome muting already covers the province view — the `biomes` group uses `view !== "terrain" ? opacity 0.6 : …`, so no change there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/svgWorldRenderer.test.ts`
Expected: PASS (province view + existing terrain/political/culture tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/svgWorldRenderer.ts src/ui/svgWorldRenderer.test.ts
git commit -m "feat(map): province MapView renders the province layer"
```

---

### Task 3: View toggle, i18n, and label culling tier

**Files:**
- Modify: `src/ui/i18n.ts` (add `province` UI string, en + ko)
- Modify: `src/ui/deconflict.ts` (add `.province-label` tier)
- Modify: `src/ui/app.ts` (4th view-toggle button)
- Test: `src/ui/app.test.ts`

**Interfaces:**
- Consumes: `MapView` "province" (Task 2), `setView`, the existing `.view-toggle` group.
- Produces: a 4th toggle button that switches the map to the province view; `t(lang, "province")` resolves; province labels participate in `deconflictLabels`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/ui/app.test.ts (mirror the file's existing createApp/root mount pattern)
  it("has a Provinces view toggle that switches the map to the province layer", () => {
    const root = document.createElement("div");
    createApp(root);
    const btns = [...root.querySelectorAll(".view-toggle button")] as HTMLButtonElement[];
    const prov = btns.find((b) => /Provinces|영토/.test(b.textContent || ""));
    expect(prov).not.toBeUndefined();
    prov!.click();
    expect(root.querySelector("svg .province")).not.toBeNull();
  });
```

(If `app.test.ts` does not already `import { createApp } from "./app";`, add it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/app.test.ts -t "Provinces view toggle"`
Expected: FAIL — no province toggle button exists.

- [ ] **Step 3a: Add the i18n string**

In `src/ui/i18n.ts`, extend the two UI lines:

- English (the line `terrain: "Terrain", political: "Political", culture: "Culture",`) →
```typescript
    terrain: "Terrain", political: "Political", culture: "Culture", province: "Provinces",
```
- Korean (the line `terrain: "지형", political: "정치", culture: "문화",`) →
```typescript
    terrain: "지형", political: "정치", culture: "문화", province: "영토",
```

- [ ] **Step 3b: Add the `.province-label` tier to deconflict**

In `src/ui/deconflict.ts`, add `.province-label` to the `tiers` array (same rank as region labels):

```typescript
  const tiers: [string, number][] = [
    [".nation-label.player", 6], [".nation-label:not(.player)", 5], [".city-capital", 4],
    [".region-label", 3], [".province-label", 3], [".river-label", 2], [".city-town", 1],
  ];
```

- [ ] **Step 3c: Add the toggle button in `app.ts`**

Add the button declaration next to the others (after `const cultureBtn = document.createElement("button");`):

```typescript
  const provinceBtn = document.createElement("button");
```

Add it to the toggle group — change `viewToggle.append(terrainBtn, politicalBtn, cultureBtn);` to:

```typescript
  viewToggle.append(terrainBtn, politicalBtn, cultureBtn, provinceBtn);
```

In `applyStrings`, after `cultureBtn.textContent = t(lang, "culture");` add:

```typescript
    provinceBtn.textContent = t(lang, "province");
```

Wire the click, after `cultureBtn.addEventListener("click", () => setView("culture"));`:

```typescript
  provinceBtn.addEventListener("click", () => setView("province"));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run`
Expected: all pass.
Run: `npx tsc --noEmit` (ignore only the pre-existing `Cannot find type definition file for 'node'` env error)
Expected: no new type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/i18n.ts src/ui/deconflict.ts src/ui/app.ts src/ui/app.test.ts
git commit -m "feat(map): Provinces view toggle + label culling tier"
```

---

## Post-implementation: live visual validation (the P0/P1 eyeball)

Start the dev server, open `map.html`, switch to the Provinces view. Confirm: province borders tile the land with no water-crossing; the biome tint makes borders legible; labels don't overlap (culled) and hovering any province shows its name. **This is also P0's validation** — if provinces read as arbitrary blobs rather than terrain-following regions, the lever is P0's deferred biome-aware BFS cost (a separate change to `provinces.ts`, its own task). Note the finding in the handoff either way. Screenshot is harness-blocked, so confirm structure/among-cells evenness via `read_page`/JS and leave the aesthetic judgment to the user.

## Self-Review notes (spec coverage)

- Dedicated province view + toggle → Tasks 2, 3. ✓
- provinceLayer: borders (politicalBorders over provinceOf) + biome tint + `<title>` hover + largest-first labels → Task 1. ✓
- Biome mute under province view → already handled (`view !== "terrain"`), noted in Task 2. ✓
- Label culling via deconflict `.province-label` tier → Task 3b. ✓
- i18n string → Task 3a. ✓
- No engine change / golden untouched → Global Constraints (P1 reads P0 data only). ✓
- jsdom asserts structure not culling → Global Constraints + tests assert counts/classes/titles. ✓
- Gazetteer / biome-aware refinement → explicitly deferred (spec Rejected alternatives; post-impl note). ✓
