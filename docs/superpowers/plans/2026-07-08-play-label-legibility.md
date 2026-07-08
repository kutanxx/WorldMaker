# Play Map Label Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop labels overlapping on the play map (reuse Version A's de-confliction) and make the player's own nation label visibly theirs (magenta, top priority).

**Architecture:** Extract Version A's private `deconflictLabels` into a shared `src/ui/deconflict.ts` (adding a top tier for the player's label), color the player's nation label in the reserved magenta in `politicalLayer`, and call `deconflictLabels` on the play map after each render. Pure DOM (render-time, not seeded) → engine goldens unaffected.

**Tech Stack:** TypeScript, Vite MPA, Vitest (jsdom).

## Global Constraints

- Pure DOM / render-time; do NOT edit any engine file. Golden hashes byte-identical.
- **Version A (`map.html`) behavior must stay identical** — same `deconflictLabels`, and the new player tier is inert there (no `.nation-label.player` in Version A).
- Tier order (highest first): `.nation-label.player (6) > .nation-label:not(.player) (5) > .city-capital (4) > .region-label (3) > .river-label (2) > .city-town (1)`.
- Player label color falls back to `#2a2118` when no `playerColor` is passed.
- Run tests from THIS worktree with `npm test`. Baseline: **413 tests**.

---

### Task 1: Extract `deconflictLabels` into a shared module (with player top tier)

**Files:**
- Create: `src/ui/deconflict.ts`
- Modify: `src/ui/app.ts` (remove local def; import)
- Test: `src/ui/deconflict.test.ts`

**Interfaces:**
- Produces: `export function deconflictLabels(svg: SVGSVGElement): void` — hides any label whose `getBBox` overlaps a higher-priority label, by the tier order above.

- [ ] **Step 1: Write the failing test**

Create `src/ui/deconflict.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { deconflictLabels } from "./deconflict";

const NS = "http://www.w3.org/2000/svg";
type Box = { x: number; y: number; width: number; height: number };
function mkLabel(svg: SVGSVGElement, cls: string, box: Box) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("class", cls);
  (t as unknown as { getBBox: () => Box }).getBBox = () => box; // jsdom lacks getBBox; stub per element
  svg.appendChild(t);
  return t as unknown as SVGGraphicsElement;
}

describe("deconflictLabels", () => {
  it("hides a lower-priority label overlapping a higher-priority one; keeps a non-overlapping one", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const nation = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const townOverlap = mkLabel(svg, "city-label city-town", { x: 10, y: 2, width: 40, height: 10 });
    const townFar = mkLabel(svg, "city-label city-town", { x: 200, y: 200, width: 30, height: 10 });
    deconflictLabels(svg);
    expect(nation.style.visibility).toBe("");
    expect(townOverlap.style.visibility).toBe("hidden");
    expect(townFar.style.visibility).toBe("");
  });

  it("never hides the player's own nation label (top tier); the other nation yields", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const other = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const player = mkLabel(svg, "nation-label player", { x: 5, y: 1, width: 50, height: 10 });
    deconflictLabels(svg);
    expect(player.style.visibility).toBe("");
    expect(other.style.visibility).toBe("hidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- deconflict`
Expected: FAIL — `Cannot find module './deconflict'`.

- [ ] **Step 3: Create `src/ui/deconflict.ts`**

```ts
// Hide any label whose bounding box overlaps a higher-priority one (player nation > other nation >
// capital > region > river > town), so nation names and place names don't collide. Runs post-mount
// because it needs getBBox (real layout); jsdom lacks getBBox, so it's a no-op in tests unless
// getBBox is stubbed. Pure DOM — not seeded, safe for determinism.
export function deconflictLabels(svg: SVGSVGElement): void {
  const tiers: [string, number][] = [
    [".nation-label.player", 6], [".nation-label:not(.player)", 5], [".city-capital", 4],
    [".region-label", 3], [".river-label", 2], [".city-town", 1],
  ];
  const labels: { el: SVGGraphicsElement; box: DOMRect; prio: number }[] = [];
  try {
    for (const [sel, prio] of tiers) {
      for (const el of svg.querySelectorAll<SVGGraphicsElement>(sel)) {
        el.style.visibility = ""; // reset any prior pass
        labels.push({ el, box: el.getBBox(), prio });
      }
    }
  } catch {
    return; // getBBox unavailable (e.g. jsdom) → skip culling, keep all labels visible
  }
  labels.sort((a, b) => b.prio - a.prio); // place the important ones first
  const kept: DOMRect[] = [];
  const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const l of labels) {
    if (kept.some((k) => hit(k, l.box))) l.el.style.visibility = "hidden";
    else kept.push(l.box);
  }
}
```

- [ ] **Step 4: Point `app.ts` at the shared module**

In `src/ui/app.ts`, delete the local `deconflictLabels` function (the `// overlaps a higher-priority one …` comment block through the closing `}` of the function, currently lines ~25-50) and add an import near the other `./` imports at the top:

```ts
import { deconflictLabels } from "./deconflict";
```

Leave the call site (`deconflictLabels(svg);` after each year render) unchanged.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- deconflict` → PASS.
Run: `npm test -- app` → existing Version A app tests still PASS (deconflict is a no-op in jsdom).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/deconflict.ts src/ui/app.ts src/ui/deconflict.test.ts
git commit -m "refactor(ui): extract deconflictLabels to a shared module + player-label top tier"
```

---

### Task 2: Color the player's nation label magenta

**Files:**
- Modify: `src/ui/politicalLayer.ts` (player label `fill`)
- Test: `src/ui/politicalLayer.test.ts`

**Interfaces:**
- Consumes: `PoliticalOpts.playerPolity`/`playerColor` (already added in prior work).

- [ ] **Step 1: Extend the failing test**

In `src/ui/politicalLayer.test.ts`, in the existing test "draws the player's nation in the reserved player color with a ♛-marked bold label", add a label-fill assertion right after the existing `expect(label.textContent!.startsWith("♛")).toBe(true);` line:

```ts
    expect(label.getAttribute("fill")).toBe(PLAYER_COLOR); // player label text is the signature colour, not near-black
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- politicalLayer`
Expected: FAIL — the player label `fill` is still `#2a2118`.

- [ ] **Step 3: Color the player label**

In `src/ui/politicalLayer.ts`, in the labels loop, change the label's `fill` (currently `fill: "#2a2118"`) so the player's label uses the player color:

```ts
        const t = svgEl("text", {
          class: isPlayer ? "nation-label player" : "nation-label", x: c.x, y: c.y, "text-anchor": "middle",
          "font-size": 11, fill: isPlayer ? (opts.playerColor ?? "#2a2118") : "#2a2118",
          stroke: "#f3ead2", "stroke-width": 2.5, "paint-order": "stroke", "stroke-linejoin": "round",
        });
```

(Only the `fill` value changes; the cream `stroke` halo + `paint-order:stroke` stay, keeping the magenta text legible.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- politicalLayer` → PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/politicalLayer.ts src/ui/politicalLayer.test.ts
git commit -m "feat(play): render the player's nation label in the signature magenta (was near-black)"
```

---

### Task 3: Call `deconflictLabels` on the play map

**Files:**
- Modify: `src/ui/playApp.ts` (import + call in `renderMap`)

**Interfaces:**
- Consumes from Task 1: `deconflictLabels(svg)`.

- [ ] **Step 1: Import and call it**

In `src/ui/playApp.ts`, add the import near the other `./` UI imports:

```ts
import { deconflictLabels } from "./deconflict";
```

In `renderMap`, change the final `mapFrame.appendChild(svg);` so de-confliction runs after the SVG is in the document (it needs `getBBox`):

```ts
      mapFrame.appendChild(svg);
      deconflictLabels(svg); // hide colliding lower-priority labels once the map is mounted
```

- [ ] **Step 2: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS (existing tests unaffected; `deconflictLabels` is a jsdom no-op).
Run: `npm test` → all pass (**≈415** = 413 + 2 new deconflict tests), no golden regressions.
Run: `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/playApp.ts
git commit -m "feat(play): de-conflict overlapping labels on the play map"
```

Manual check (user): overlapping nation/city/region labels on the play map thin out (lower-priority ones hidden); the player's own nation label shows in magenta and is never the one culled.

---

## Self-Review

**1. Spec coverage:** De-confliction extracted + player top tier → Task 1. Player label magenta → Task 2. Called on the play map → Task 3. Version A unchanged (same function; player tier inert) → Task 1 Step 5 (`app` tests) + the `:not(.player)` scoping in the tier list. Player-label self-collision avoided via `:not(.player)` → Task 1 tier list. Pure-DOM/goldens → Global Constraints. ✓

**2. Placeholder scan:** No TBD/TODO; every step has complete code/commands.

**3. Type consistency:** `deconflictLabels(svg: SVGSVGElement): void` defined in Task 1, imported unchanged in Tasks 1(app) and 3(playApp). `PLAYER_COLOR` (from prior work) used in the Task 2 test; `opts.playerColor` is the existing `PoliticalOpts` field. Classes `.nation-label.player` / `.nation-label:not(.player)` in the tier list match the classes `politicalLayer` emits. The `hit`/`kept`/`tiers` internals match the original app.ts implementation exactly (plus the two player-tier entries).
