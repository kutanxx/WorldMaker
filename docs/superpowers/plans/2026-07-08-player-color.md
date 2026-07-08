# Reserved Player Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In play mode, render the player's nation in a reserved signature color (deep magenta `#c0247a`) with a ♛-marked bold label, so "which realm is mine" is unmistakable — replacing the too-faint own-tint.

**Architecture:** A `PLAYER_COLOR` constant + an optional `playerPolity`/`playerColor` override in the shared `politicalLayer` (Version A passes neither, so its output is byte-identical). `playApp` wires it in, drops the own-tint, and recolors the chip swatch. Render-time only → determinism + engine goldens unaffected.

**Tech Stack:** TypeScript, Vite MPA, Vitest (jsdom).

## Global Constraints

- Colors are render-time cosmetics (not seeded); do NOT edit any engine file (`historySim.ts`, `world.ts`, etc.). Golden hashes byte-identical.
- **Version A must be unaffected:** when `politicalLayer` is called without `playerPolity`, its output must be identical to today (fills use `nationColor`, labels unmarked).
- `PLAYER_COLOR = "#c0247a"` (research-chosen; see spec).
- Run tests from THIS worktree with `npm test`. Baseline: **411 tests**.

---

### Task 1: PLAYER_COLOR + politicalLayer player override

**Files:**
- Modify: `src/ui/nationPalette.ts` (add `PLAYER_COLOR`)
- Modify: `src/ui/politicalLayer.ts` (optional `playerPolity`/`playerColor`; player fill + marked label)
- Test: `src/ui/politicalLayer.test.ts`

**Interfaces:**
- Produces: `export const PLAYER_COLOR: string`; `PoliticalOpts` gains `playerPolity?: number; playerColor?: string`. When set, the matching polity's territory fills with `playerColor` at opacity `0.72` and class `territory player`, and its label renders as `♛ {name}` with class `nation-label player`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/politicalLayer.test.ts` (inside `describe("politicalLayer", ...)`), and add `PLAYER_COLOR` to the existing `./nationPalette` import at the top:

```ts
  it("draws the player's nation in the reserved player color with a ♛-marked bold label", () => {
    // player owns 30 cells (>=25) so its label renders; a single polity keeps the fixture simple
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let i = 0; i < 30; i++) owner[i] = 0;
    const polities = [{ id: 0, name: "Mine", free: false }];
    const g = politicalLayer(world.grid, owner, polities, {
      fills: true, labels: true, playerPolity: 0, playerColor: PLAYER_COLOR,
    });
    const terr = g.querySelector('path.territory[data-polity="0"]') as SVGElement;
    expect(terr.getAttribute("fill")).toBe(PLAYER_COLOR);
    expect(terr.getAttribute("fill-opacity")).toBe("0.72");
    expect(terr.classList.contains("player")).toBe(true);
    const label = g.querySelector(".nation-label.player") as SVGElement;
    expect(label).not.toBeNull();
    expect(label.textContent!.startsWith("♛")).toBe(true);
  });

  it("leaves fills/labels unchanged when no playerPolity is passed (Version A path)", () => {
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let i = 0; i < 30; i++) owner[i] = 0;
    const g = politicalLayer(world.grid, owner, [{ id: 0, name: "Mine", free: false }], { fills: true, labels: true });
    expect((g.querySelector('path.territory[data-polity="0"]') as SVGElement).getAttribute("fill")).toBe(nationColor(0));
    expect(g.querySelector(".nation-label.player")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- politicalLayer`
Expected: FAIL — `PLAYER_COLOR` not exported / player fill not applied.

- [ ] **Step 3: Add `PLAYER_COLOR`**

In `src/ui/nationPalette.ts`, after the `NATION_PALETTE` export, add:

```ts
// The player's realm is always rendered in this reserved signature colour (play mode only), so
// "which realm is mine" needs no swatch-matching. Deep magenta: the one hue family absent from the
// map (no pinks), colourblind-safe (Okabe-Ito reddish-purple), avoids the blue↔purple confusion a
// violet would cause given the map's many blues. Render-time only — not seeded.
export const PLAYER_COLOR = "#c0247a";
```

- [ ] **Step 4: Add the override to `politicalLayer`**

In `src/ui/politicalLayer.ts`, extend `PoliticalOpts`:

```ts
export interface PoliticalOpts {
  fills?: boolean;
  labels?: boolean;
  legend?: boolean;
  playerPolity?: number; // play mode: render this polity in the reserved player colour + mark its label
  playerColor?: string;
}
```

In the fills loop, replace the `for (const [id, d] of byPolity)` body:

```ts
    for (const [id, d] of byPolity) {
      const free = freeSet.has(id);
      const isPlayer = id === opts.playerPolity;
      g.appendChild(svgEl("path", {
        class: free ? "territory free-city" : isPlayer ? "territory player" : "territory",
        "data-polity": id, d,
        fill: free ? FREE_COLOR : isPlayer ? (opts.playerColor ?? nationColor(id)) : nationColor(id),
        "fill-opacity": free ? 0.72 : isPlayer ? 0.72 : 0.58,
      }));
    }
```

In the labels loop, replace the `for (const [id, c] of centroids)` body:

```ts
      for (const [id, c] of centroids) {
        if (c.cells < MIN_LABEL_CELLS) continue;
        const name = nameOf.get(id);
        if (!name) continue;
        const isPlayer = id === opts.playerPolity;
        const t = svgEl("text", {
          class: isPlayer ? "nation-label player" : "nation-label", x: c.x, y: c.y, "text-anchor": "middle",
          "font-size": 11, fill: "#2a2118", stroke: "#f3ead2", "stroke-width": 2.5,
          "paint-order": "stroke", "stroke-linejoin": "round",
        });
        t.textContent = isPlayer ? `♛ ${name}` : name;
        labels.appendChild(t);
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- politicalLayer`
Expected: PASS (new + existing politicalLayer tests). Then `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/nationPalette.ts src/ui/politicalLayer.ts src/ui/politicalLayer.test.ts
git commit -m "feat(play): reserved player colour + ♛-marked label in politicalLayer (opt-in via playerPolity)"
```

---

### Task 2: Wire into the play map + drop the own-tint

**Files:**
- Modify: `src/ui/playApp.ts` (renderMap opts; remove own-tint; chip swatch; import)
- Modify: `src/theme.css` (bold player label)
- Test: `src/ui/playApp.test.ts` (update the nation-emphasis test)

**Interfaces:**
- Consumes from Task 1: `PLAYER_COLOR`, the `playerPolity`/`playerColor` opts.

- [ ] **Step 1: Update the existing nation-emphasis test**

In `src/ui/playApp.test.ts`, in the test "shows which nation is the player's: chip with coloured swatch + capital crown, no in-map legend", replace the `.own-tint` assertion line:

```ts
    expect(root.querySelector(".own-tint")).not.toBeNull();        // own-territory wash
```

with:

```ts
    expect(root.querySelector("svg.world .nation-label.player")).not.toBeNull(); // player's realm labelled ♛
    expect(root.querySelector(".own-tint")).toBeNull();            // faint tint removed (reserved colour replaces it)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `.nation-label.player` is null (not wired yet) and `.own-tint` still present.

- [ ] **Step 3: Wire the player color into `renderMap` and remove the own-tint**

In `src/ui/playApp.ts`:

Change the political-layer call (currently `{ fills: true, labels: true, legend: false }`) to pass the player:

```ts
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, { fills: true, labels: true, legend: false, playerPolity: s.playerPolity, playerColor: PLAYER_COLOR }));
```

Delete the own-tint block entirely (the comment `// own-territory tint: …` and the `const mine … g.insertBefore(tint, g.firstChild); }` lines). Keep the capital-crown block that follows it.

- [ ] **Step 4: Recolor the chip swatch + fix the import**

Change the chip swatch line in `renderPanel`:

```ts
      sw.style.background = PLAYER_COLOR;
```

Update the import on line 17. If `nationColor` is now unused elsewhere in `playApp.ts` (it is — the chip was its only consumer), change:

```ts
import { nationColor } from "./nationPalette";
```

to:

```ts
import { PLAYER_COLOR } from "./nationPalette";
```

(If `tsc --noEmit` reports `nationColor` still used somewhere, keep both: `import { nationColor, PLAYER_COLOR } from "./nationPalette";`.)

- [ ] **Step 5: Add CSS**

In `src/theme.css`, near the play-map/standing rules, add:

```css
.nation-label.player { font-weight: 700; }
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS.
Run: `npm test` → all pass (**≈413** = 411 + 2 Task-1), no golden regressions.
Run: `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): render player realm in reserved magenta + ♛ label; drop faint own-tint"
```

Manual check (user): the player's realm is now a distinct deep magenta with a ♛ bold label and the ♛ capital crown; the chip swatch matches; identifying your realm needs no swatch-matching.

---

## Self-Review

**1. Spec coverage:** Reserved fill (`PLAYER_COLOR` at 0.72, opt-in) → Task 1. Marked ♛ bold label → Task 1 + Task 2 CSS. Chip swatch = PLAYER_COLOR → Task 2. Own-tint removed → Task 2 (+ existing test updated). Capital crown kept → untouched. Version A unaffected (no playerPolity passed) → Task 1 "Version A path" test. Render-time/goldens intact → Global Constraints. ✓

**2. Placeholder scan:** No TBD/TODO; all code complete.

**3. Type consistency:** `PLAYER_COLOR: string` produced in Task 1, consumed in Task 2 (renderMap opts + chip). `PoliticalOpts.playerPolity?/playerColor?` defined (Task 1) and passed (Task 2). Classes `territory player` / `nation-label player` set in Task 1, queried by both test files and styled in Task 2 CSS. The `nationColor` import removal is guarded ("if unused") to avoid a `noUnusedLocals` break.
