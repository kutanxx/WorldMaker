# Town Detail Deepening + Castle Glyph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the city drilldown with five medieval-authentic details (parish-church skyline, market cross + well, inns, barbican, waterside trades) and make the lord's-castle glyph read as a donjon (concentric-square great tower + corner turrets + shadow).

**Architecture:** The castle glyph is a renderer-only change (no engine/data touch). The five details add small data arrays to `CityLayout`, generated in a fixed tail block in `generateCityLayout` (after the abbey/cemetery/gallows landmarks, before `generateCountryside`), reusing the existing exact-geometry guards; the three extramural ones (barbican/inns/trades) are pushed into `occupied` so the countryside avoids them. Rendering adds glyphs to the existing `env` (extramural, unclipped) and `clipped` (intramural) groups.

**Tech Stack:** TypeScript, Vitest, SVG via `svgEl`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-town-detail-castle-design.md`

## Global Constraints

- Engine (`src/engine/**`) pure/DOM-free; determinism per-run (same rng + inputs → identical output).
- Byte-compat with prior layouts is WAIVED (approved); world-map generation uses a separate rng stream so its golden hash is unaffected — do not touch `world.ts`/`history.ts`.
- All SVG colors inline attrs (export parity), parchment palette.
- No new text labels / no i18n (glyphs only, like abbey/gallows).
- Generation lives in the tail block of `generateCityLayout` in this FIXED order: parish churches → market cross → well → inns → barbicans → riverside trades → (existing) `generateCountryside`. Extramural structures (inns, barbicans, trades) push their points into the existing `occupied: Point[]` array before the countryside call.
- In-scope render anchors: `env` group content is built up to `src/ui/svgCityRenderer.ts:183` (`root.appendChild(env)`); `clipped` group content is built 185–219 and appended at line 220. Intramural glyphs go into `clipped` (after the castle block, before line 220); extramural glyphs go into `env` (after the gallows block, before line 183).
- Test CityContext shape: `{ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }` (import `GRASSLAND` from `src/engine/biome.ts`). For a river/sea city set `coastal: true`.
- Tests: Vitest. Focused: `npx vitest run src/engine/city.test.ts src/ui/svgCityRenderer.test.ts`. Full `npm test`. Build `npm run build`.
- Commit style: Korean feat/fix prefix + footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Castle glyph — donjon + corner turrets (renderer-only)

**Files:**
- Modify: `src/ui/svgCityRenderer.ts:209-219` (the `if (layout.castle)` block)
- Test: `src/ui/svgCityRenderer.test.ts` (the existing "draws the castle inner wall, towers and keep" test)

**Interfaces:**
- Consumes: `layout.castle` (`Castle { innerWall, towers, gate, postern, keep, annexes }`) — unchanged. Renderer helpers `pts()`, `avg()` already in this file.
- Produces: new SVG classes `.castle-wall-inner`, `.castle-keep-shadow`, `.castle-keep-inner`, `.castle-turret` (×4).

- [ ] **Step 1: Update the failing test** — in `src/ui/svgCityRenderer.test.ts`, extend the castle test:

```ts
  it("draws the castle as a donjon: inner wall, towers, keep with shadow, inner tower and 4 corner turrets", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelector(".castle-wall")).not.toBeNull();
    expect(svg.querySelector(".castle-keep")).not.toBeNull();
    expect(svg.querySelector(".castle-keep-shadow")).not.toBeNull();
    expect(svg.querySelector(".castle-keep-inner")).not.toBeNull();
    expect(svg.querySelectorAll(".castle-turret").length).toBe(4);
    expect(svg.querySelectorAll(".castle-tower").length).toBe(layout.castle!.towers.length);
  });
```

(If the old test with the same first sentence exists, replace it.)

- [ ] **Step 2: Run** — `npx vitest run src/ui/svgCityRenderer.test.ts -t "donjon"` → FAIL (`.castle-turret` count 0).

- [ ] **Step 3: Implement** — replace lines 209-219 (`if (layout.castle) { … clipped.appendChild(cg); }`) with:

```ts
  if (layout.castle) {
    const ca = layout.castle;
    const cg = svgEl("g", { class: "castle-inner" });
    for (const an of ca.annexes) cg.appendChild(svgEl("polygon", { class: "castle-annex", points: pts(an), fill: "#cfd4dd", stroke: "#5a6272", "stroke-width": 0.4 }));
    // inner wall: town-wall-style double stroke
    cg.appendChild(svgEl("polygon", { class: "castle-wall", points: pts(ca.innerWall), fill: "none", stroke: "#5a5346", "stroke-width": 1.6, "stroke-linejoin": "round" }));
    cg.appendChild(svgEl("polygon", { class: "castle-wall-inner", points: pts(ca.innerWall), fill: "none", stroke: "#8a7a60", "stroke-width": 0.6, "stroke-linejoin": "round" }));
    for (const t2 of ca.towers) cg.appendChild(svgEl("circle", { class: "castle-tower", cx: t2[0], cy: t2[1], r: 2.1, fill: "#8a8272", stroke: "#4c463c", "stroke-width": 0.6 }));
    cg.appendChild(svgEl("circle", { class: "castle-gate", cx: ca.gate[0], cy: ca.gate[1], r: 1.1, fill: "#e8dfc9", stroke: "#4c463c", "stroke-width": 0.5 }));
    if (ca.postern) cg.appendChild(svgEl("circle", { class: "castle-postern", cx: ca.postern[0], cy: ca.postern[1], r: 0.9, fill: "#e8dfc9", stroke: "#7a2f2f", "stroke-width": 0.5 }));
    // donjon: shadow + body + inner great-tower square + corner turrets (concentric-square, top-down)
    const kctr = avg(ca.keep);
    const shadow = ca.keep.map(([x, y]) => [x + 1, y + 1] as [number, number]);
    const innerKeep = ca.keep.map(([x, y]) => [x + (kctr[0] - x) * 0.42, y + (kctr[1] - y) * 0.42] as [number, number]);
    cg.appendChild(svgEl("polygon", { class: "castle-keep-shadow", points: pts(shadow), fill: "#2f333c", "fill-opacity": 0.5 }));
    cg.appendChild(svgEl("polygon", { class: "castle-keep", points: pts(ca.keep), fill: "#6e7686", stroke: "#3a4050", "stroke-width": 0.8 }));
    cg.appendChild(svgEl("polygon", { class: "castle-keep-inner", points: pts(innerKeep), fill: "#565e6e", stroke: "#333a48", "stroke-width": 0.5 }));
    for (const [x, y] of ca.keep) cg.appendChild(svgEl("circle", { class: "castle-turret", cx: x, cy: y, r: 1.6, fill: "#7c8494", stroke: "#3a4050", "stroke-width": 0.5 }));
    clipped.appendChild(cg);
  }
```

- [ ] **Step 4: Run** — `npx vitest run src/ui/svgCityRenderer.test.ts` PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 성채 글리프를 donjon으로 — 동심 사각 대탑 + 4모서리 망루 + 그림자 + 내성벽 이중선"`

---

### Task 2: Parish churches (skyline) — intramural

**Files:**
- Modify: `src/engine/city.ts` (`CityLayout` interface, tail block, return)
- Modify: `src/ui/svgCityRenderer.ts` (clipped group)
- Test: `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `zoned` (array of `{ type: WardType; polygon: Polygon; site: Point; ... }`) in scope in `generateCityLayout`; `centroid` from geometry (already imported).
- Produces: `CityLayout.parishChurches: Point[]`. Renderer class `.parish-church`.

- [ ] **Step 1: Failing test** — `src/engine/city.test.ts`:

```ts
describe("parish churches", () => {
  it("scatters 1+size churches across non-civic wards, all inside the walls", () => {
    const l = generateCityLayout({ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const eligible = l.wards.filter((w) => !["cathedral", "castle", "plaza", "harbor"].includes(w.type)).length;
    expect(l.parishChurches.length).toBe(Math.min(1 + 3, eligible));
    for (const p of l.parishChurches) expect(pointInPolygon(p, l.boundary)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — FAIL (`parishChurches` undefined).

- [ ] **Step 3: Implement**

`city.ts` — add to the `CityLayout` interface: `parishChurches: Point[];`

In the tail block, immediately after the `const gallows: Point | null = …` line (currently line 377) and before the `generateCountryside` call, add (FIRST in the fixed order):

```ts
  // parish churches: a steeple in a few non-civic wards (skyline). Uses zoned wards, no overlap
  // (distinct Voronoi cells) so the count is exactly min(1+size, eligible).
  const parishChurches: Point[] = [];
  {
    const pool = zoned.filter((z) => !(["cathedral", "castle", "plaza", "harbor"] as WardType[]).includes(z.type));
    const want = Math.min(1 + ctx.size, pool.length);
    for (let k = 0; k < want; k++) {
      const idx = Math.floor(rng() * pool.length);
      parishChurches.push(centroid(pool.splice(idx, 1)[0].polygon));
    }
  }
```

Add `parishChurches` to the returned object.

`svgCityRenderer.ts` — after the castle block (after line 219, before `root.appendChild(clipped)` at 220):

```ts
  for (const [cx, cy] of layout.parishChurches) {
    clipped.appendChild(svgEl("path", { class: "parish-church", d: `M${cx.toFixed(1)},${(cy - 3).toFixed(1)}v6 M${(cx - 2).toFixed(1)},${(cy - 1).toFixed(1)}h4`, stroke: "#7a6a86", "stroke-width": 1.2, fill: "none", "stroke-linecap": "round" }));
  }
```

- [ ] **Step 4: Renderer test** — `src/ui/svgCityRenderer.test.ts`:

```ts
  it("renders a parish-church steeple per parishChurches entry", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".parish-church").length).toBe(layout.parishChurches.length);
  });
```

Run `npx vitest run src/engine/city.test.ts src/ui/svgCityRenderer.test.ts` PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 교구 교회 스카이라인 — 성 안 구역에 1+size개 첨탑"`

---

### Task 3: Market cross + well (intramural) + inns (extramural)

**Files:**
- Modify: `src/engine/city.ts` (interface, tail block, return)
- Modify: `src/ui/svgCityRenderer.ts` (clipped + env groups)
- Test: `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `zoned`, `suburbRoads` (`Polyline[]`), `occupied` (`Point[]`, mutable), `boundary`, `water`, `mountains`, `inWater`, `inMountains`, `pointInPolygon` — all in scope.
- Produces: `CityLayout.marketCross: Point | null`, `well: Point | null`, `inns: Point[]`. Renderer classes `.market-cross-base`, `.market-cross`, `.well`, `.inn`, `.inn-sign`.

- [ ] **Step 1: Failing test** — `src/engine/city.test.ts`:

```ts
describe("market square + inns", () => {
  it("puts the market cross on the plaza and inns outside the gate", () => {
    const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 2);
    const plaza = l.wards.find((w) => w.type === "plaza");
    expect(l.marketCross).not.toBeNull();
    if (plaza) { const c = centroid(plaza.polygon); expect(Math.hypot(l.marketCross![0] - c[0], l.marketCross![1] - c[1])).toBeLessThan(0.01); }
    expect(l.well).not.toBeNull();
    expect(l.inns.length).toBeGreaterThanOrEqual(1);
    for (const p of l.inns) expect(pointInPolygon(p, l.boundary)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`city.ts` interface: `marketCross: Point | null; well: Point | null; inns: Point[];`

In the tail block, AFTER the parish-churches block (order: market cross → well → inns):

```ts
  // market square furniture: a market cross + public well on the open plaza (no rng)
  const plazaWard = zoned.find((z) => z.type === "plaza") ?? null;
  const marketCross: Point | null = plazaWard ? centroid(plazaWard.polygon) : null;
  const well: Point | null = marketCross ? [marketCross[0] + 4, marketCross[1] + 3] : null;
  // inns cluster just outside the busiest gates (travelers). Into occupied so countryside avoids them.
  const inns: Point[] = [];
  {
    const want = Math.min(1 + Math.floor(ctx.size / 3), suburbRoads.length);
    for (let k = 0; k < want; k++) {
      const road = suburbRoads[k];
      if (road.length < 2) continue;
      const a = road[0], b = road[1];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const p: Point = [a[0] + ux * 12 + nx * 5, a[1] + uy * 12 + ny * 5];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p)) continue;
      inns.push(p); occupied.push(p);
    }
  }
```

Add `marketCross, well, inns` to the return object.

`svgCityRenderer.ts` — intramural, in `clipped` after the parish-church loop (before line 220):

```ts
  if (layout.marketCross) {
    const [cx, cy] = layout.marketCross;
    clipped.appendChild(svgEl("rect", { class: "market-cross-base", x: cx - 1.5, y: cy - 1.5, width: 3, height: 3, fill: "#d8d2c4", stroke: "#7a6f56", "stroke-width": 0.4 }));
    clipped.appendChild(svgEl("path", { class: "market-cross", d: `M${cx.toFixed(1)},${cy.toFixed(1)}v-4 M${(cx - 1.5).toFixed(1)},${(cy - 2.6).toFixed(1)}h3`, stroke: "#5a4a34", "stroke-width": 0.9, fill: "none", "stroke-linecap": "round" }));
  }
  if (layout.well) {
    const [wx, wy] = layout.well;
    clipped.appendChild(svgEl("circle", { class: "well", cx: wx, cy: wy, r: 1.3, fill: "#b9c4cc", stroke: "#5a5346", "stroke-width": 0.5 }));
  }
```

extramural, in `env` after the gallows block (before `root.appendChild(env)` at line 183):

```ts
  for (const [ix, iy] of layout.inns) {
    env.appendChild(svgEl("rect", { class: "inn", x: ix - 3, y: iy - 2.4, width: 6, height: 4.8, fill: "#d8c49a", stroke: "#7a5a3a", "stroke-width": 0.5 }));
    env.appendChild(svgEl("path", { class: "inn-sign", d: `M${(ix + 3).toFixed(1)},${(iy - 2).toFixed(1)}h2 M${(ix + 5).toFixed(1)},${(iy - 2).toFixed(1)}v2`, stroke: "#5a4a34", "stroke-width": 0.5, fill: "none" }));
    env.appendChild(svgEl("rect", { class: "inn-sign", x: ix + 4.2, y: iy, width: 1.6, height: 1.4, fill: "#b98a4a", stroke: "#5a4a34", "stroke-width": 0.3 }));
  }
```

- [ ] **Step 4: Renderer test** — `src/ui/svgCityRenderer.test.ts`:

```ts
  it("renders market cross, well and inns", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 2);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".market-cross").length).toBe(layout.marketCross ? 1 : 0);
    expect(svg.querySelectorAll(".well").length).toBe(layout.well ? 1 : 0);
    expect(svg.querySelectorAll(".inn").length).toBe(layout.inns.length);
  });
```

Run focused tests PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 시장 십자탑·우물(광장) + 성문 앞 여관"`

---

### Task 4: Barbican — extramural gate-work

**Files:**
- Modify: `src/engine/city.ts` (interface, tail block, return)
- Modify: `src/ui/svgCityRenderer.ts` (env group)
- Test: `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `suburbRoads`, `water`, `mountains`, `boundary`, `occupied`, `inWater`, `inMountains`, `pointInPolygon`.
- Produces: `CityLayout.barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[]`. Renderer classes `.barbican`, `.barbican-wall`.

- [ ] **Step 1: Failing test** — `src/engine/city.test.ts`:

```ts
describe("barbican", () => {
  it("builds a forward gate-work at the principal (non-water) gate, outside the wall", () => {
    const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(l.barbicans.length).toBeGreaterThanOrEqual(1);
    for (const b of l.barbicans) {
      expect(pointInPolygon(b.at, l.boundary)).toBe(false);
      expect(inWater(l.water, b.at)).toBe(false);
      expect(b.towers.length).toBe(2);
      expect(b.walls.length).toBe(2);
    }
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`city.ts` interface: `barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[];`

In the tail block, AFTER the inns block (order: … inns → barbicans):

```ts
  // barbican: a forward gate-work at the principal gate(s) — the longest gate-road is the main
  // approach (ties by index). Skip water/mountain-facing gates. Into occupied.
  const barbicans: { at: Point; towers: [Point, Point]; walls: [Polyline, Polyline] }[] = [];
  {
    const ranked = suburbRoads
      .map((r) => { let len = 0; for (let i = 0; i < r.length - 1; i++) len += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); return { r, len }; })
      .sort((a, b) => b.len - a.len);
    const wantB = ctx.size >= 4 ? 2 : 1;
    for (const { r } of ranked) {
      if (barbicans.length >= wantB) break;
      if (r.length < 2) continue;
      const gate = r[0];
      const dx = r[1][0] - gate[0], dy = r[1][1] - gate[1], L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const front: Point = [gate[0] + ux * 12, gate[1] + uy * 12];
      if (pointInPolygon(front, boundary) || inWater(water, front) || inMountains(mountains, front)) continue;
      const t1: Point = [gate[0] + ux * 11 + nx * 4, gate[1] + uy * 11 + ny * 4];
      const t2: Point = [gate[0] + ux * 11 - nx * 4, gate[1] + uy * 11 - ny * 4];
      const wallA: Polyline = [[gate[0] + nx * 3, gate[1] + ny * 3], t1];
      const wallB: Polyline = [[gate[0] - nx * 3, gate[1] - ny * 3], t2];
      barbicans.push({ at: front, towers: [t1, t2], walls: [wallA, wallB] });
      occupied.push(front, t1, t2);
    }
  }
```

Add `barbicans` to the return object.

`svgCityRenderer.ts` — in `env` after the inns loop (before line 183):

```ts
  for (const bb of layout.barbicans) {
    for (const w of bb.walls) env.appendChild(svgEl("polyline", { class: "barbican-wall", points: pts(w), fill: "none", stroke: "#43392d", "stroke-width": 2.4, "stroke-linecap": "round" }));
    for (const t of bb.towers) env.appendChild(svgEl("circle", { class: "barbican", cx: t[0], cy: t[1], r: 2.2, fill: "#8a7858", stroke: "#43392d", "stroke-width": 0.8 }));
  }
```

- [ ] **Step 4: Renderer test** — `src/ui/svgCityRenderer.test.ts`:

```ts
  it("renders barbican towers and walls", () => {
    const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".barbican").length).toBe(layout.barbicans.length * 2);
    expect(svg.querySelectorAll(".barbican-wall").length).toBe(layout.barbicans.length * 2);
  });
```

Run focused tests PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 성문 옹성(barbican) — 주 성문 앞 방어 전방 보루"`

---

### Task 5: Waterside trades — river/sea/lake cities only

**Files:**
- Modify: `src/engine/city.ts` (interface, tail block, return)
- Modify: `src/ui/svgCityRenderer.ts` (env group)
- Test: `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `water` (`Water { bodies: Polygon[] }`), `bounds`, `boundary`, `mountains`, `occupied`, `inWater`, `inMountains`, `pointInPolygon`, `rng`.
- Produces: `CityLayout.riversideTrades: { at: Point; kind: "tanner" | "dyer" }[]`. Renderer classes `.riverside-trade`, `.dye-rack`.

- [ ] **Step 1: Failing test** — `src/engine/city.test.ts`:

```ts
describe("waterside trades", () => {
  it("puts tanners/dyers by the water outside the walls, none inland-dry", () => {
    const nearWater = (w: ReturnType<typeof generateCityLayout>["water"], p: [number, number]) =>
      inWater(w, [p[0] + 5, p[1]]) || inWater(w, [p[0] - 5, p[1]]) || inWater(w, [p[0], p[1] + 5]) || inWater(w, [p[0], p[1] - 5]);
    let coastalHit = false;
    for (let s = 1; s <= 20 && !coastalHit; s++) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      if (l.riversideTrades.length) {
        coastalHit = true;
        for (const t of l.riversideTrades) {
          expect(pointInPolygon(t.at, l.boundary)).toBe(false);
          expect(nearWater(l.water, t.at)).toBe(true);
        }
      }
    }
    expect(coastalHit).toBe(true);
    // inland dry (elevation<0.7, non-coastal, no water archetype) → empty
    const dry = generateCityLayout({ id: 7, name: "T", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 9);
    if (!dry.water.bodies.length) expect(dry.riversideTrades.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`city.ts` interface: `riversideTrades: { at: Point; kind: "tanner" | "dyer" }[];`

In the tail block, AFTER the barbicans block (last before `generateCountryside`):

```ts
  // waterside trades: tanners/dyers pushed to the water's edge outside the walls (stench/effluent).
  // Honest approximation of "by the water" — no flow data for true downstream. Into occupied.
  const riversideTrades: { at: Point; kind: "tanner" | "dyer" }[] = [];
  if (water.bodies.length) {
    const nearW = (p: Point) => inWater(water, [p[0] + 4, p[1]]) || inWater(water, [p[0] - 4, p[1]]) || inWater(water, [p[0], p[1] + 4]) || inWater(water, [p[0], p[1] - 4]);
    const want = 2 + (ctx.size >= 4 ? 1 : 0);
    for (let tries = 0; tries < 140 && riversideTrades.length < want; tries++) {
      const p: Point = [4 + rng() * (bounds.w - 8), 4 + rng() * (bounds.h - 8)];
      if (pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p)) continue;
      if (!nearW(p)) continue;
      if (occupied.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 8)) continue;
      const kind: "tanner" | "dyer" = rng() < 0.5 ? "tanner" : "dyer";
      riversideTrades.push({ at: p, kind }); occupied.push(p);
    }
  }
```

Add `riversideTrades` to the return object.

`svgCityRenderer.ts` — in `env` after the barbican loop (before line 183):

```ts
  for (const tr of layout.riversideTrades) {
    const [x, y] = tr.at;
    env.appendChild(svgEl("rect", { class: "riverside-trade", x: x - 2, y: y - 1.6, width: 4, height: 3.2, fill: "#6b5a44", stroke: "#3c2f1c", "stroke-width": 0.4 }));
    if (tr.kind === "dyer") env.appendChild(svgEl("path", { class: "dye-rack", d: `M${(x - 2).toFixed(1)},${(y + 2.4).toFixed(1)}h4 M${(x - 1).toFixed(1)},${(y + 1.8).toFixed(1)}v1.2 M${(x + 1).toFixed(1)},${(y + 1.8).toFixed(1)}v1.2`, stroke: "#7a5a3a", "stroke-width": 0.4, fill: "none" }));
  }
```

- [ ] **Step 4: Renderer test** — `src/ui/svgCityRenderer.test.ts`:

```ts
  it("renders a workshop per riverside trade", () => {
    let layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    for (let s = 2; s <= 20 && !layout.riversideTrades.length; s++) layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
    const svg = renderCity(layout, "en");
    expect(svg.querySelectorAll(".riverside-trade").length).toBe(layout.riversideTrades.length);
  });
```

Run focused tests PASS; `npm test` full green; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 물가 악취 업종 — 무두장이·염색공을 성 밖 물가에"`

---

### Task 6: Integration verify + deploy

**Files:** none new (fixes only if verification finds issues)

- [ ] **Step 1: Full suite + build** — `npm test` all green; `npm run build` clean.
- [ ] **Step 2: Live DOM verify** — dev server (launch config `worldmaker`), `preview_resize({width:1280,height:800})` first (screenshot times out — use eval/inspect). Open `map.html`, sweep cities via `preview_eval`: assert `.castle-turret` = 4 and `.castle-keep-inner` present on cities with a castle; `.parish-church` count > 0; `.barbican` present on a plains city; `.market-cross` + `.well` present; `.inn` present; `.riverside-trade` present on a coastal city and absent on an inland-dry one.
- [ ] **Step 3: No-overlap spot check** — reuse the overlap eval from the prior session: confirm barbican/inn/riverside-trade points don't sit inside a countryside patch (they were added to `occupied`), and none of the new intramural glyphs fall outside the boundary.
- [ ] **Step 4: Merge + deploy** — merge branch to `main` in the parent repo (`git -C /c/projects/WorldMaker merge --no-ff …`), push (Pages auto-deploys; if deploy-pages fails "try again later", wait ~5 min and push an empty commit — known Pages throttle). Verify the live JS bundle contains `castle-turret`, `parish-church`, `barbican`, `riverside-trade`.
- [ ] **Step 5: Ask the user to eyeball** the deployed site (castle prominence, church/steeple density, glyph sizes — subjective).

---

## Self-Review Notes

- Spec coverage: §1→Task 1, §2→Task 2, §3(barbican)→Task 4, §4(cross/well/inns)→Task 3, §5(trades)→Task 5, generation-order + `occupied` wiring honored across Tasks 3–5, verify/deploy→Task 6. All `CityLayout` additions from the spec's summary block are delivered (parishChurches, barbicans, marketCross, well, inns, riversideTrades).
- Determinism: fixed tail order parish→cross→well→inns→barbicans→trades→countryside; extramural structures pushed into `occupied` before the countryside call; world/history untouched (separate stream) so golden hashes hold.
- Type consistency: `barbicans` element shape `{ at, towers: [Point,Point], walls: [Polyline,Polyline] }` identical in engine + test + renderer; `riversideTrades` element `{ at, kind }` identical; renderer class names match the test assertions in each task.
- Castle change is renderer-only (Task 1) — the `Castle` interface is untouched, so no engine test churn.
