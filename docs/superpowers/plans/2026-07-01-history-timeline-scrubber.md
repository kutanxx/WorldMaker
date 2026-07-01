# History Timeline Scrubber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a timeline slider + ▶/⏸ play below the world map that scrubs `history.snapshots` (year 0→500); the biome map's political overlay and the chronicle panel update to the displayed year.

**Architecture:** Pure UI. A new `politicalLayer` builds a translucent-fill + border SVG group from any snapshot's `owner` array; `renderWorld` hosts it in a `.political-slot` (default year 0); a new `timeline` control drives an index; `app` wires index→(rebuild political layer + `applyChronicleYear`). The engine is untouched.

**Tech Stack:** TypeScript, Vite, Vitest (+ jsdom for DOM tests), SVG via `svgEl` helper.

## Global Constraints

- Engine files (`src/engine/history.ts`) are NOT modified — snapshots/polities already exist.
- Determinism, URL seed encoding, and export payload must be byte-unaffected (this is UI-only).
- DOM tests start with `// @vitest-environment jsdom`.
- Test runner: `npm test` (all) or `npx vitest run <path>` (one file). Build check: `npm run build`.
- Political fill opacity `0.33`; border stroke `#3c2f1c` width `0.8` (match the existing map border).
- Play step interval: `300` ms.

---

### Task 1: Shared SVG path helpers + widen `politicalBorders`

Extract the private `cellPath`/`segPath` from the world renderer into a shared module (the political layer needs them too), and widen `politicalBorders` to accept a typed-array snapshot.

**Files:**
- Create: `src/ui/svgPaths.ts`
- Create: `src/ui/svgPaths.test.ts`
- Modify: `src/ui/svgWorldRenderer.ts` (remove local `cellPath`/`segPath`, import them)
- Modify: `src/engine/borders.ts:27` (`politicalBorders` param type)
- Modify: `src/engine/borders.test.ts` (add Int32Array case)

**Interfaces:**
- Produces: `cellPath(poly: number[][]): string`, `segPath(segs: Segment[]): string` (from `src/ui/svgPaths.ts`).
- Produces: `politicalBorders(grid, polityOf: ArrayLike<number>): Segment[]` (widened).

- [ ] **Step 1: Write the failing test** — `src/ui/svgPaths.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { cellPath, segPath } from "./svgPaths";

describe("svgPaths", () => {
  it("cellPath builds a closed path and returns '' for an empty polygon", () => {
    expect(cellPath([[0, 0], [2, 0], [2, 2]])).toBe("M0.0,0.0L2.0,0.0L2.0,2.0Z");
    expect(cellPath([])).toBe("");
  });
  it("segPath emits one M..L.. per segment", () => {
    expect(segPath([[[0, 0], [1, 1]]])).toBe("M0.0,0.0L1.0,1.0");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/svgPaths.test.ts`
Expected: FAIL — cannot resolve `./svgPaths`.

- [ ] **Step 3: Create `src/ui/svgPaths.ts`**

```ts
import type { Segment } from "../engine/borders";

export function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  return "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

export function segPath(segs: Segment[]): string {
  return segs
    .map(([a, b]) => `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`)
    .join("");
}
```

- [ ] **Step 4: Widen `politicalBorders`** in `src/engine/borders.ts`

Change the signature only (body unchanged; indexing works identically for `Int32Array`):

```ts
export function politicalBorders(grid: GridLike, polityOf: ArrayLike<number>): Segment[] {
```

- [ ] **Step 5: Refactor `src/ui/svgWorldRenderer.ts` to use the shared helpers**

Delete the local `cellPath` (lines ~7-10) and `segPath` (lines ~12-14). Add an import near the top:

```ts
import { cellPath, segPath } from "./svgPaths";
```

Leave the rest of the file as-is for this task (the `.political-slot` change comes in Task 3).

- [ ] **Step 6: Add the Int32Array case** to `src/engine/borders.test.ts` (inside the existing `describe("borders", ...)`)

```ts
  it("politicalBorders accepts an Int32Array (snapshot) owner and matches the array result", () => {
    const arr = Int32Array.from([0, 0, 1]);
    const a = politicalBorders(grid, [0, 0, 1]);
    const b = politicalBorders(grid, arr);
    expect(b.length).toBe(a.length);
    expect(b.length).toBe(1); // only the cell1|cell2 edge differs
  });
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/ui/svgPaths.test.ts src/engine/borders.test.ts src/ui/svgWorldRenderer.test.ts`
Expected: PASS (helpers work, borders accept Int32Array, renderer still renders after the import swap).

- [ ] **Step 8: Commit**

```bash
git add src/ui/svgPaths.ts src/ui/svgPaths.test.ts src/ui/svgWorldRenderer.ts src/engine/borders.ts src/engine/borders.test.ts
git commit -m "refactor: shared svgPaths helpers + politicalBorders accepts ArrayLike"
```

---

### Task 2: `politicalLayer` — snapshot → SVG group

Build the translucent-fill + border group for one snapshot's owner array.

**Files:**
- Create: `src/ui/politicalLayer.ts`
- Create: `src/ui/politicalLayer.test.ts`

**Interfaces:**
- Consumes: `cellPath`, `segPath` (Task 1), `politicalBorders` (Task 1), `svgEl` (`./renderer`).
- Produces: `politicalLayer(grid, owner: ArrayLike<number>, polities: { id: number; color: string }[]): SVGGElement`.

- [ ] **Step 1: Write the failing test** — `src/ui/politicalLayer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { politicalLayer } from "./politicalLayer";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
const { world } = generateWorld({ ...small, seed: 1 });
const h = simulateHistory(world, 1);
const dstr = (g: SVGGElement) =>
  Array.from(g.querySelectorAll("path.territory")).map((p) => p.getAttribute("d")).join("|");

describe("politicalLayer", () => {
  it("draws one territory path per present polity plus one border path", () => {
    const g = politicalLayer(world.grid, h.snapshots[0].owner, h.polities);
    const present = new Set<number>();
    for (let i = 0; i < world.grid.count; i++) {
      const o = h.snapshots[0].owner[i];
      if (o >= 0) present.add(o);
    }
    expect(g.querySelectorAll("path.territory").length).toBe(present.size);
    expect(g.querySelectorAll("path.border").length).toBe(1);
  });
  it("colors each territory from the polity palette", () => {
    const g = politicalLayer(world.grid, h.snapshots[0].owner, h.polities);
    const first = g.querySelector("path.territory") as SVGElement;
    const id = Number(first.getAttribute("data-polity"));
    expect(first.getAttribute("fill")).toBe(h.polities[id].color);
    expect(first.getAttribute("fill-opacity")).toBe("0.33");
  });
  it("reflects a later snapshot differently once borders have shifted", () => {
    const a = politicalLayer(world.grid, h.snapshots[0].owner, h.polities);
    const b = politicalLayer(world.grid, h.snapshots[h.snapshots.length - 1].owner, h.polities);
    expect(dstr(a)).not.toBe(dstr(b));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/politicalLayer.test.ts`
Expected: FAIL — cannot resolve `./politicalLayer`.

- [ ] **Step 3: Create `src/ui/politicalLayer.ts`**

```ts
import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors">;

export function politicalLayer(
  grid: GridLike,
  owner: ArrayLike<number>,
  polities: { id: number; color: string }[],
): SVGGElement {
  const g = svgEl("g", { class: "political" }) as SVGGElement;

  const byPolity = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const o = owner[i];
    if (o < 0) continue;
    byPolity.set(o, (byPolity.get(o) ?? "") + cellPath(grid.polygons[i]));
  }

  const colorOf = new Map(polities.map((p) => [p.id, p.color]));
  for (const [id, d] of byPolity) {
    g.appendChild(svgEl("path", {
      class: "territory", "data-polity": id, d,
      fill: colorOf.get(id) ?? "#888888", "fill-opacity": 0.33,
    }));
  }

  g.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, owner)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 0.8, "stroke-linejoin": "round",
  }));

  return g;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/politicalLayer.test.ts`
Expected: PASS (per-polity paths, palette colors, later snapshot differs).

- [ ] **Step 5: Commit**

```bash
git add src/ui/politicalLayer.ts src/ui/politicalLayer.test.ts
git commit -m "feat: politicalLayer renders a snapshot's territories + borders"
```

---

### Task 3: World renderer hosts a `.political-slot`

Replace the static year-0 border path with a `.political-slot` group holding a default (year-0) political layer, so the app can swap layers per year and exports still show political state.

**Files:**
- Modify: `src/ui/svgWorldRenderer.ts` (remove the `.border` path append; add slot + default layer)
- Modify: `src/ui/svgWorldRenderer.test.ts` (assert the new structure)

**Interfaces:**
- Consumes: `politicalLayer` (Task 2).
- Produces: `renderWorld` now emits `<g class="political-slot">` (between coastline and markers) containing one `.political` group; still exactly one `path.border` and one `path.coastline`.

- [ ] **Step 1: Update the renderer test first** — replace the second `it` block in `src/ui/svgWorldRenderer.test.ts`

```ts
  it("draws coastline once and a political slot with territories + one border", () => {
    expect(svg.querySelectorAll("path.coastline").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot").length).toBe(1);
    expect(svg.querySelectorAll(".political-slot .territory").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll("path.border").length).toBe(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/svgWorldRenderer.test.ts`
Expected: FAIL — no `.political-slot` yet.

- [ ] **Step 3: Edit `src/ui/svgWorldRenderer.ts`**

Add the import:

```ts
import { politicalLayer } from "./politicalLayer";
```

Remove the now-unused `politicalBorders` import and the `Segment` type import if they are no longer referenced (coastline is still used; keep `coastline`). Replace the border-path append block:

```ts
  root.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, world.polityOf)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 0.8, "stroke-linejoin": "round",
  }));
```

with:

```ts
  const slot = svgEl("g", { class: "political-slot" });
  slot.appendChild(politicalLayer(grid, world.polityOf, world.polities));
  root.appendChild(slot);
```

(The `coastline` path append immediately above stays. `world.polities` is `{id,color,...}[]`, structurally valid for `politicalLayer`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/svgWorldRenderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/svgWorldRenderer.ts src/ui/svgWorldRenderer.test.ts
git commit -m "feat: world renderer hosts a political-slot (default year 0)"
```

---

### Task 4: `timeline` control

A slider + play/pause + year readout that drives a snapshot index.

**Files:**
- Create: `src/ui/timeline.ts`
- Create: `src/ui/timeline.test.ts`

**Interfaces:**
- Consumes: `History` type (`../engine/history`).
- Produces: `createTimeline(history: History, onIndex: (i: number) => void): Timeline` where
  `interface Timeline { element: HTMLElement; setIndex(i: number): void; destroy(): void }`.

- [ ] **Step 1: Write the failing test** — `src/ui/timeline.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTimeline } from "./timeline";
import type { History } from "../engine/history";

function fakeHistory(frames: number): History {
  return {
    years: (frames - 1) * 10,
    polities: [],
    events: [],
    snapshots: Array.from({ length: frames }, (_, i) => ({ year: i * 10, owner: new Int32Array(0) })),
  };
}

describe("createTimeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onIndex with the slider index and updates the year readout", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(6), (i) => seen.push(i));
    const slider = t.element.querySelector("input") as HTMLInputElement;
    slider.value = "3";
    slider.dispatchEvent(new Event("input"));
    expect(seen).toEqual([3]);
    expect((t.element.querySelector(".timeline-year") as HTMLElement).textContent).toBe("30년");
  });

  it("play advances the index each step and stops at the last frame", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(4), (i) => seen.push(i));
    const btn = t.element.querySelector("button") as HTMLButtonElement;
    btn.click();
    vi.advanceTimersByTime(1300); // steps at 300/600/900 -> 1,2,3 ; 1200 -> stop
    expect(seen).toEqual([1, 2, 3]);
    expect(btn.textContent).toBe("▶");
  });

  it("destroy clears a running timer", () => {
    const seen: number[] = [];
    const t = createTimeline(fakeHistory(10), (i) => seen.push(i));
    (t.element.querySelector("button") as HTMLButtonElement).click();
    vi.advanceTimersByTime(600);
    const after = seen.length;
    t.destroy();
    vi.advanceTimersByTime(3000);
    expect(seen.length).toBe(after);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/timeline.test.ts`
Expected: FAIL — cannot resolve `./timeline`.

- [ ] **Step 3: Create `src/ui/timeline.ts`**

```ts
import type { History } from "../engine/history";

export interface Timeline {
  element: HTMLElement;
  setIndex(i: number): void;
  destroy(): void;
}

const STEP_MS = 300;

export function createTimeline(history: History, onIndex: (i: number) => void): Timeline {
  const max = history.snapshots.length - 1;

  const element = document.createElement("div");
  element.className = "timeline";

  const playBtn = document.createElement("button");
  playBtn.className = "timeline-play";
  playBtn.textContent = "▶";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "timeline-slider";
  slider.min = "0";
  slider.max = String(max);
  slider.step = "1";
  slider.value = "0";

  const year = document.createElement("span");
  year.className = "timeline-year";

  element.append(playBtn, slider, year);

  let timer: ReturnType<typeof setInterval> | null = null;
  let index = 0;

  const readout = (i: number) => { year.textContent = `${history.snapshots[i].year}년`; };

  function apply(i: number, fromSlider = false): void {
    index = Math.max(0, Math.min(max, i));
    if (!fromSlider) slider.value = String(index);
    readout(index);
    onIndex(index);
  }

  function stop(): void {
    if (timer !== null) { clearInterval(timer); timer = null; }
    playBtn.textContent = "▶";
  }

  function play(): void {
    if (index >= max) apply(0); // replay from the dawn
    playBtn.textContent = "⏸";
    timer = setInterval(() => {
      if (index >= max) { stop(); return; }
      apply(index + 1);
    }, STEP_MS);
  }

  playBtn.addEventListener("click", () => { if (timer === null) play(); else stop(); });
  slider.addEventListener("input", () => { stop(); apply(Number(slider.value), true); });

  readout(0);
  return { element, setIndex: (i: number) => apply(i), destroy: stop };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/timeline.ts src/ui/timeline.test.ts
git commit -m "feat: timeline control (slider + play + year readout)"
```

---

### Task 5: Chronicle year sync

Tag event rows with their year and add a helper that dims future events and scrolls the current one into view.

**Files:**
- Modify: `src/ui/chronicle.ts` (add `data-year`; export `applyChronicleYear`)
- Modify: `src/ui/chronicle.test.ts` (add a sync test)

**Interfaces:**
- Produces: `applyChronicleYear(root: HTMLElement, year: number): void`. `renderChronicle` signature unchanged; `.chronicle-event` rows now carry `data-year`.

- [ ] **Step 1: Write the failing test** — add to `src/ui/chronicle.test.ts`

```ts
import { renderChronicle, applyChronicleYear } from "./chronicle";

// ...existing describe stays; add:
describe("applyChronicleYear", () => {
  it("dims events after the current year and clears earlier ones", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(h);
    applyChronicleYear(el, 100);
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".chronicle-event"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.classList.contains("future")).toBe(Number(r.dataset.year) > 100);
    }
  });
});
```

(Update the top import line from `import { renderChronicle } from "./chronicle";` to also import `applyChronicleYear`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/chronicle.test.ts`
Expected: FAIL — `applyChronicleYear` is not exported.

- [ ] **Step 3: Edit `src/ui/chronicle.ts`**

In the event-row block, tag the year (add the `dataset` line before setting textContent):

```ts
    const row = document.createElement("li");
    row.className = `chronicle-event evt-${e.type}`;
    row.dataset.year = String(e.year);
    row.textContent = e.text;
```

Append the helper at the end of the file:

```ts
export function applyChronicleYear(root: HTMLElement, year: number): void {
  const rows = root.querySelectorAll<HTMLElement>(".chronicle-event");
  let lastCurrent: HTMLElement | null = null;
  rows.forEach((row) => {
    if (Number(row.dataset.year) > year) {
      row.classList.add("future");
    } else {
      row.classList.remove("future");
      lastCurrent = row;
    }
  });
  if (lastCurrent && typeof lastCurrent.scrollIntoView === "function") {
    lastCurrent.scrollIntoView({ block: "nearest" });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/chronicle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/chronicle.ts src/ui/chronicle.test.ts
git commit -m "feat: chronicle year sync (dim future events)"
```

---

### Task 6: App integration + styles

Wire the timeline between the map and chronicle; each index rebuilds the political layer and syncs the chronicle. Add styles.

**Files:**
- Modify: `src/ui/app.ts`
- Modify: `src/ui/app.test.ts`
- Modify: `index.html` (`<style>` block)

**Interfaces:**
- Consumes: `politicalLayer` (Task 2), `createTimeline`/`Timeline` (Task 4), `applyChronicleYear` (Task 5).

- [ ] **Step 1: Write the failing tests** — add to `src/ui/app.test.ts`

```ts
  it("shows a timeline and a political layer over the world", () => {
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector(".timeline input[type=range]")).not.toBeNull();
    expect(root.querySelector(".political-slot .territory")).not.toBeNull();
  });
  it("scrubbing the timeline updates the year readout", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const slider = root.querySelector(".timeline input[type=range]") as HTMLInputElement;
    slider.value = slider.max; // last frame = year 500
    slider.dispatchEvent(new Event("input"));
    expect((root.querySelector(".timeline-year") as HTMLElement).textContent).toBe("500년");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/app.test.ts`
Expected: FAIL — no `.timeline`.

- [ ] **Step 3: Edit `src/ui/app.ts`**

Update imports:

```ts
import { renderChronicle, applyChronicleYear } from "./chronicle";
import { createTimeline, type Timeline } from "./timeline";
import { politicalLayer } from "./politicalLayer";
```

Add a handle in `createApp` scope (next to `let history = ...`):

```ts
  let timeline: Timeline | null = null;
```

Replace the whole `showWorld` function with:

```ts
  function showWorld(): void {
    timeline?.destroy();
    stage.innerHTML = "";
    const svg = renderWorld(generated.world);
    svg.addEventListener("click", (e) => {
      const target = e.target as Element;
      const id = target.getAttribute("data-city");
      if (id !== null && id !== "") openCity(Number(id));
    });
    stage.appendChild(svg);

    const chronicle = renderChronicle(history);
    const slot = svg.querySelector(".political-slot") as SVGGElement;
    const world = generated.world;
    const renderYear = (index: number): void => {
      const snap = history.snapshots[index];
      slot.replaceChildren(politicalLayer(world.grid, snap.owner, history.polities));
      applyChronicleYear(chronicle, snap.year);
    };

    timeline = createTimeline(history, renderYear);
    stage.append(timeline.element, chronicle);
    renderYear(0);
    location.hash = encodeParams(params).slice(1);
  }
```

In `openCity`, stop playback before tearing down the stage — add `timeline?.destroy();` right after the `if (!marker) return;` guard:

```ts
  function openCity(cityId: number): void {
    const marker = generated.world.cities.find((c) => c.id === cityId);
    if (!marker) return;
    timeline?.destroy();
    stage.innerHTML = "";
    // ...rest unchanged
```

(`regenerate` already calls `showWorld`, which destroys first — no change needed there.)

- [ ] **Step 4: Add styles** to the `<style>` block in `index.html`

```css
  .timeline { display: flex; gap: 8px; padding: 8px; align-items: center; }
  .timeline-slider { flex: 1; }
  .timeline-year { min-width: 56px; font-variant-numeric: tabular-nums; }
  .political .territory { pointer-events: none; }
  .chronicle { max-height: 240px; overflow: auto; padding: 0 8px; }
  .chronicle-event.future { opacity: .4; }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/ui/app.test.ts`
Expected: PASS (timeline present, political territories present, scrub sets the readout to `500년`).

- [ ] **Step 6: Full suite + build**

Run: `npm test`
Expected: all suites PASS (134 existing + new).
Run: `npm run build`
Expected: `tsc --noEmit` clean, `vite build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.ts src/ui/app.test.ts index.html
git commit -m "feat: wire timeline scrubber into the app (political + chronicle sync)"
```

---

## Self-Review

**Spec coverage:**
- politicalLayer module → Task 2. ✓
- borders `ArrayLike` widen → Task 1. ✓
- `.political-slot` + default year-0 layer + removed static border + export uses displayed year → Task 3. ✓
- timeline (slider/play/readout/destroy) → Task 4. ✓
- chronicle `data-year` + `applyChronicleYear` (dim future, scroll current, era headers untouched) → Task 5. ✓
- app wiring (renderYear rebuilds slot + syncs chronicle; destroy on openCity/regenerate) + CSS → Task 6. ✓
- shared `cellPath`/`segPath` extraction → Task 1. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `politicalLayer(grid, owner: ArrayLike<number>, polities: {id;color}[])` used identically in Tasks 2/3/6; `createTimeline(history, onIndex)` returns `Timeline{element,setIndex,destroy}` used in Task 6; `applyChronicleYear(root, year)` defined in Task 5, called in Task 6. Snapshot `owner` is `Int32Array` (ArrayLike) throughout; `politicalBorders` widened in Task 1 accepts it.
