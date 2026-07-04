# Extramural Countryside + Urban Castle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the ring outside the city wall with a research-grounded medieval countryside (strip fields, pastures+animals, farmsteads+barns, orchards, kitchen gardens, woodland fringe) on an enlarged 460×460 canvas, remove the intramural "field/suburb" wards, and give every city a lord's castle with an inner wall, keep, and postern.

**Architecture:** Canvas grows at generation time (everything already derives from `bounds`). A new pure module `src/engine/city/countryside.ts` generates countryside geometry from the extended gate roads; a new `src/engine/city/castle.ts` builds the castle struct from the castle ward polygon. `city.ts` wires both into `CityLayout`; `svgCityRenderer.ts` draws them (countryside in the unclipped `.environs` group, castle in a clipped `.castle` group).

**Tech Stack:** TypeScript, Vitest, SVG via `svgEl` helper. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-extramural-countryside-castle-design.md`

## Global Constraints

- Engine code (`src/engine/**`) is pure and DOM-free; rng-first args; `mulberry32`/`deriveSeed` only.
- Determinism: same rng + inputs → identical output. Byte-compat with PREVIOUS layouts is waived this round (approved), but each task's own output must be deterministic.
- All SVG colors as inline attributes (export parity), parchment palette.
- Field strip #d9cc9a / furrow #c4b581 (desert pair: #e0cf9a / #c9b47a), pasture #ccd6a8 / fence #8a6a44, garden #c9d0a0, barn #7a5a3a, house #e0d6c0, animals: sheep #f4f1e4 / cattle #8a6a44.
- Tests: Vitest, colocated `*.test.ts`. Run a single file: `npx vitest run src/engine/city/countryside.test.ts`. Full: `npm test`. Build: `npm run build`.
- Commit after each task (Korean feat/fix/chore style, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` footer).
- CityContext for tests: `{ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }` (import biome constants from `src/engine/biome.ts`).

---

### Task 1: Canvas 460 + renderer un-hardcode + CSS width

**Files:**
- Modify: `src/engine/city.ts:116-118` (bounds/center)
- Modify: `src/ui/svgCityRenderer.ts:48` (water transform-origin), `:89` (hachure center)
- Modify: `src/theme.css:33-35` (svg.city max-width)
- Test: `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: existing `generateCityLayout(ctx, worldSeed)`.
- Produces: `layout.bounds === { w: 460, h: 460 }`, city center at (230,230). Later tasks assume this.

- [ ] **Step 1: Write the failing test** — in `src/engine/city.test.ts` add:

```ts
describe("canvas 460", () => {
  it("uses a 460x460 canvas with the city centred", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.bounds).toEqual({ w: 460, h: 460 });
    // boundary stays a centred island: every vertex well inside the canvas
    for (const [x, y] of layout.boundary) {
      expect(x).toBeGreaterThan(60); expect(x).toBeLessThan(400);
      expect(y).toBeGreaterThan(60); expect(y).toBeLessThan(400);
    }
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/engine/city.test.ts` → the new test FAILS (bounds 300).

- [ ] **Step 3: Implement**

`src/engine/city.ts` — in `generateCityLayout`:

```ts
  const bounds = { w: 460, h: 460 };
  const center: Vec = [230, 230];
```

`src/ui/svgCityRenderer.ts` line 48 — replace the hardcoded origin with the canvas center:

```ts
    root.appendChild(svgEl("polygon", { class: "water", points: pts(body), fill: "#9fc1d6", transform: "scale(0.985)", "transform-origin": `${w / 2} ${h / 2}` }));
```

line 89 (hachure downhill direction) — replace `150` with the center:

```ts
        const dx = p[0] - w / 2, dy = p[1] - h / 2, L = Math.hypot(dx, dy) || 1;
```

`src/theme.css` — widen the display cap proportionally (568-unit viewBox; keeps the intramural city ≈ its current on-screen size):

```css
/* 1008 ≈ (460+108)/408 * 762 rounded to the #app content width: the viewBox gained the
   countryside ring + legend strip, so widen the cap to keep the walled city the same size */
.stage svg.city { max-width: 1008px; margin: 0 auto; }
```

- [ ] **Step 4: Fix fallout** — run `npx vitest run src/engine/city.test.ts src/ui/svgCityRenderer.test.ts src/ui/app.test.ts` and update any assertion that assumed 300/150 (e.g. coordinate range checks `<300`, viewBox `0 0 408 300` → `0 0 568 460`). Grep first: `rg -n "300|150|408" src/engine/city.test.ts src/ui/svgCityRenderer.test.ts` and judge each hit. Then `npm test` → all green. `npm run build` → clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: 도시 캔버스 460 확장 — 성 밖 시골 링 확보 + 렌더러 중심 하드코딩 제거 + 표시폭 보정"`

---

### Task 2: Remove intramural field/suburb wards (§6)

**Files:**
- Modify: `src/engine/city/zoning.ts:5-9` (WardType), `:88` (rim mix)
- Modify: `src/engine/city.ts:108-111` (NO_BUILDINGS/DENSITY — delete `suburb` key; `field` is in NO_BUILDINGS)
- Test: `src/engine/city/zoning.test.ts`

**Interfaces:**
- Produces: `WardType` union WITHOUT `"suburb" | "field"`. Rim wards (f>0.85) are now slum/craftsmen/park. Later tasks (castle) rely on `assignZones` otherwise unchanged.

- [ ] **Step 1: Failing test** — in `src/engine/city/zoning.test.ts`:

```ts
it("never assigns intramural field or suburb wards (farming lives outside the walls)", () => {
  const rng = mulberry32(5);
  const cells = generateWards(rng, 230, 230, 110, 24);
  const zoned = assignZones(rng, cells, [230, 230], 100, { hasCastle: true, coastal: false });
  for (const z of zoned) expect(["suburb", "field"]).not.toContain(z.type);
  // the outermost ring is still urban: slum/craftsmen/park only
  for (const z of zoned.filter((z) => z.dist / 100 > 0.85)) {
    expect(["slum", "craftsmen", "park", "castle", "harbor"]).toContain(z.type);
  }
});
```

- [ ] **Step 2: Run** — `npx vitest run src/engine/city/zoning.test.ts` → FAILS (suburb/field assigned).

- [ ] **Step 3: Implement**

`zoning.ts` — WardType loses the last line:

```ts
export type WardType =
  | "plaza" | "castle" | "cathedral" | "guildhall"
  | "market" | "merchant" | "patriciate" | "craftsmen"
  | "gate" | "slum" | "harbor" | "military" | "park";
```

line 88 — replace the rim branch:

```ts
    if (f > 0.85) { const r = rng(); w.type = r < 0.5 ? "slum" : r < 0.8 ? "craftsmen" : "park"; continue; } // urban to the wall
```

`city.ts` — `NO_BUILDINGS` drops `"field"`; `DENSITY` drops the `suburb: 200` entry:

```ts
const NO_BUILDINGS: WardType[] = ["plaza", "park"];
const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 240, military: 260,
};
```

(`TINT` in svgCityRenderer.ts and `WARD_NAME` in i18n.ts never had suburb/field entries — verify with `rg -n "suburb|field" src/ui/svgCityRenderer.ts src/ui/i18n.ts`; only `.suburb-road`/`.suburb` CSS-class strings for faubourg houses should remain, they are unrelated to WardType.)

- [ ] **Step 4: Run** — `npx vitest run src/engine/city/zoning.test.ts` PASS, then `npm test` (tsc via `npm run build` too — union-narrowing may flag stale references; fix any).

- [ ] **Step 5: Commit** — `git commit -am "feat: 성 안 밭/교외 구역 제거 — 성벽까지 시가지 (농경은 성 밖으로)"`

---

### Task 3: Gate roads to the canvas edge + denser faubourg

**Files:**
- Modify: `src/engine/city.ts:250-290` (suburb section)
- Test: `src/engine/city.test.ts`

**Interfaces:**
- Produces: `layout.suburbRoads: Polyline[]` — one 3-point polyline per usable gate, from the gate to ~3px of the canvas edge, with a gentle mid bend. ALL gates with room are used (no gateBudget). Ribbon houses flank the first 55px. Task 4/5 consume these as countryside spines via `opts.roads`.

- [ ] **Step 1: Failing test**

```ts
describe("gate roads reach the countryside", () => {
  it("extends every usable gate road to the canvas edge", () => {
    const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.suburbRoads.length).toBeGreaterThanOrEqual(2);
    for (const road of layout.suburbRoads) {
      const [ex, ey] = road[road.length - 1];
      const nearEdge = ex < 12 || ex > 448 || ey < 12 || ey > 448;
      expect(nearEdge).toBe(true);
      expect(road.length).toBeGreaterThanOrEqual(3); // gate, bend, edge
    }
    expect(layout.suburbs.length).toBeGreaterThanOrEqual(8); // denser faubourg
  });
});
```

- [ ] **Step 2: Run** — FAILS (roads stop at 38px, budgeted gates).

- [ ] **Step 3: Implement** — replace the suburb block in `city.ts` (keep `inCanvas`; remove `gateBudget`/`gatesUsed`):

```ts
  const suburbRoads: Polyline[] = [];
  const suburbs: Polygon[] = [];
  for (const g of wall.gates) {
    const dx = g[0] - center[0], dy = g[1] - center[1];
    const gl = Math.hypot(dx, dy) || 1;
    const ux = dx / gl, uy = dy / gl;        // outward unit
    const nx = -uy, ny = ux;                  // perpendicular unit
    const start: Point = [g[0] + ux * 8, g[1] + uy * 8]; // clear wall + moat
    const distX = ux > 0.001 ? (bounds.w - 3 - start[0]) / ux : ux < -0.001 ? (3 - start[0]) / ux : Infinity;
    const distY = uy > 0.001 ? (bounds.h - 3 - start[1]) / uy : uy < -0.001 ? (3 - start[1]) / uy : Infinity;
    const room = Math.min(distX, distY);
    if (room < 14 || inWater(water, start) || inMountains(mountains, start) || !inCanvas(start)) continue;
    const L = room - 1;                       // run all the way to the canvas edge
    const end: Point = [start[0] + ux * L, start[1] + uy * L];
    if (inWater(water, end)) continue; // don't run a highway into the sea
    // gentle bend at the midpoint so the highway reads hand-drawn, not ruled
    const bendOff = (rng() - 0.5) * 12;
    const mid: Point = [start[0] + ux * L * 0.5 + nx * bendOff, start[1] + uy * L * 0.5 + ny * bendOff];
    suburbRoads.push([[g[0], g[1]], inWater(water, mid) || inMountains(mountains, mid) ? [start[0] + ux * L * 0.5, start[1] + uy * L * 0.5] : mid, end]);
    // faubourg ribbon: houses flank the first stretch out of the gate, thinning with distance
    const ribbon = Math.min(55, L);
    for (let d = 6; d < ribbon; d += 8) {
      const prob = 0.9 - (d / ribbon) * 0.5;
      for (const side of [-1, 1]) {
        if (rng() > prob) continue;
        const off = 4 + rng() * 4;
        const cx = start[0] + ux * d + nx * side * off;
        const cy = start[1] + uy * d + ny * side * off;
        if (pointInPolygon([cx, cy], boundary) || inWater(water, [cx, cy]) || inMountains(mountains, [cx, cy]) || !inCanvas([cx, cy])) continue;
        if (suburbs.some((b) => { const c = centroid(b); return Math.hypot(c[0] - cx, c[1] - cy) < 6; })) continue;
        const hw = 2.5, hh = 2;
        suburbs.push([
          [cx - ux * hw - nx * hh, cy - uy * hw - ny * hh],
          [cx + ux * hw - nx * hh, cy + uy * hw - ny * hh],
          [cx + ux * hw + nx * hh, cy + uy * hw + ny * hh],
          [cx - ux * hw + nx * hh, cy - uy * hw + ny * hh],
        ]);
      }
    }
  }
```

- [ ] **Step 4: Run** — new test PASS; `npm test` green (the old "roads 2-4/houses 4-24" style assertions may need bumping — update them to the new expectations, not the other way around).

- [ ] **Step 5: Commit** — `git commit -am "feat: 성문 가도를 캔버스 끝까지 연장 + 교외 리본 증량"`

---

### Task 4: countryside.ts — gardens, orchards, strip fields

**Files:**
- Create: `src/engine/city/countryside.ts`
- Test: `src/engine/city/countryside.test.ts`

**Interfaces:**
- Consumes: geometry helpers (`pointInPolygon`, `centroid`, `bbox`), `inWater` from water.ts, `inMountains` from mountain.ts.
- Produces (Task 5 extends, Task 6 consumes):

```ts
export interface FieldPatch { polygon: Polygon; strips: Polyline[] }
export interface Pasture { fence: Polygon; animals: Point[]; kind: "sheep" | "cattle" }
export interface Farmstead { house: Polygon; barn: Polygon; yard: Polygon | null }
export interface Orchard { polygon: Polygon; trees: Point[] }
export interface Countryside {
  gardens: Polygon[];
  fields: FieldPatch[];
  pastures: Pasture[];
  farmsteads: Farmstead[];
  orchards: Orchard[];
  woods: Point[];
}
export interface CountrysideOpts {
  bounds: { w: number; h: number };
  boundary: Polygon;
  water: Water;
  mountains: MountainMass[];
  roads: Polyline[];      // extended gate roads (spines)
  obstacles: Point[];     // suburb/outwork/landmark centres to keep clear of
  size: number;
  biome: number;          // biome constants from ../biome
  oasis: boolean;
}
export function generateCountryside(rng: Rng, opts: CountrysideOpts): Countryside
```

In this task `pastures`, `farmsteads`, `woods` are returned EMPTY (Task 5 fills them); the interface ships complete now so Task 6 can compile against it.

- [ ] **Step 1: Failing tests** — `src/engine/city/countryside.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { generateCountryside } from "./countryside";
import { pointInPolygon, centroid } from "../geometry";
import { GRASSLAND } from "../biome";
import type { CountrysideOpts } from "./countryside";

function plainOpts(): CountrysideOpts {
  const boundary = [] as [number, number][];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; boundary.push([230 + Math.cos(a) * 100, 230 + Math.sin(a) * 100]); }
  return {
    bounds: { w: 460, h: 460 }, boundary,
    water: { kind: "none", bodies: [], banks: [], bridges: [] } as never,
    mountains: [],
    roads: [[[330, 230], [395, 232], [457, 230]], [[230, 330], [232, 395], [230, 457]]],
    obstacles: [], size: 3, biome: GRASSLAND, oasis: false,
  };
}

describe("generateCountryside — fields/gardens/orchards", () => {
  it("is deterministic", () => {
    const a = generateCountryside(mulberry32(9), plainOpts());
    const b = generateCountryside(mulberry32(9), plainOpts());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("plains city gets strip fields grouped near roads, all outside the boundary", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.fields.length).toBeGreaterThanOrEqual(3);
    for (const f of c.fields) {
      const ctr = centroid(f.polygon);
      expect(pointInPolygon(ctr, o.boundary)).toBe(false);
      expect(ctr[0]).toBeGreaterThan(3); expect(ctr[0]).toBeLessThan(457);
      expect(f.strips.length).toBeGreaterThanOrEqual(3); // ridge-and-furrow lines
      for (const s of f.strips) for (const p of s) expect(pointInPolygon(p, f.polygon)).toBe(true);
    }
  });
  it("kitchen gardens hug the wall; orchards carry trees inside their plot", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.gardens.length).toBeGreaterThanOrEqual(2);
    for (const g of c.gardens) {
      const ctr = centroid(g);
      const d = Math.hypot(ctr[0] - 230, ctr[1] - 230);
      expect(d).toBeGreaterThan(100); expect(d).toBeLessThan(125); // fringe ring just outside r=100
    }
    expect(c.orchards.length).toBeGreaterThanOrEqual(1);
    for (const or of c.orchards) {
      expect(or.trees.length).toBeGreaterThanOrEqual(4);
      for (const t of or.trees) expect(pointInPolygon(t, or.polygon)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/engine/city/countryside.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/engine/city/countryside.ts`. Core helpers + ring-1/ring-2 generation:

```ts
// Extramural countryside (open-field system). Research: 2-3 great common fields of
// furlong strips around the town; kitchen gardens/orchards right under the walls;
// farmhouses at field edges (spec 2026-07-05-extramural-countryside-castle-design.md).
import type { Rng } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon, centroid } from "../geometry";
import { inWater } from "./water";
import type { Water } from "./water";
import { inMountains } from "./mountain";
import type { MountainMass } from "./mountain";
import { DESERT, WETLAND, TAIGA, TEMPERATE_FOREST, TROPICAL, TUNDRA, ALPINE } from "../biome";

/* interfaces exactly as in the task header */

interface Profile { fields: number; pastures: number; orchards: number; woods: number; dry: boolean; animal: "sheep" | "cattle" }
export function countrysideProfile(biome: number, size: number): Profile {
  const base: Profile = { fields: 3 + size, pastures: 2 + Math.floor(size / 2), orchards: 2, woods: 40, dry: false, animal: "sheep" };
  if (biome === DESERT) return { ...base, fields: 2, pastures: 0, orchards: 1, woods: 0, dry: true };
  if (biome === WETLAND) return { ...base, fields: 2, pastures: base.pastures + 2, orchards: 0, woods: 15, animal: "cattle" };
  if (biome === TAIGA || biome === TEMPERATE_FOREST || biome === TROPICAL) return { ...base, fields: Math.max(2, base.fields - 2), pastures: Math.max(1, base.pastures - 1), orchards: 3, woods: 90 };
  if (biome === TUNDRA || biome === ALPINE) return { ...base, fields: 1, pastures: base.pastures + 1, orchards: 0, woods: 10 };
  return base; // plains/grassland default
}

// rectangle centred at c, long axis along unit (ux,uy), half-length hl, half-width hw
function orientedRect(c: Point, ux: number, uy: number, hl: number, hw: number): Polygon {
  const nx = -uy, ny = ux;
  return [
    [c[0] - ux * hl - nx * hw, c[1] - uy * hl - ny * hw],
    [c[0] + ux * hl - nx * hw, c[1] + uy * hl - ny * hw],
    [c[0] + ux * hl + nx * hw, c[1] + uy * hl + ny * hw],
    [c[0] - ux * hl + nx * hw, c[1] - uy * hl + ny * hw],
  ];
}

export function generateCountryside(rng: Rng, opts: CountrysideOpts): Countryside {
  const { bounds, boundary, water, mountains, roads, size, biome } = opts;
  const prof = countrysideProfile(biome, size);
  const bc = centroid(boundary);
  const obstacles: Point[] = [...opts.obstacles];
  const inCanvas = (p: Point) => p[0] > 3 && p[0] < bounds.w - 3 && p[1] > 3 && p[1] < bounds.h - 3;
  const blocked = (p: Point) => pointInPolygon(p, boundary) || inWater(water, p) || inMountains(mountains, p) || !inCanvas(p);
  const polyOk = (poly: Polygon, gap: number) => {
    const c = centroid(poly);
    if (poly.some(blocked) || blocked(c)) return false;
    if (obstacles.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < gap)) return false;
    return true;
  };
  const claim = (poly: Polygon) => obstacles.push(centroid(poly));

  // ring 1: kitchen gardens + orchards against the wall, between the gate roads
  const gardens: Polygon[] = [];
  const orchards: Orchard[] = [];
  const wallR = (() => { let s = 0; for (const p of boundary) s += Math.hypot(p[0] - bc[0], p[1] - bc[1]); return s / boundary.length; })();
  for (let tries = 0; tries < 90 && gardens.length < 3 + size; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 8 + rng() * 8;
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const ux = -Math.sin(a), uy = Math.cos(a); // long side parallel to the wall
    const plot = orientedRect(c, ux, uy, 5 + rng() * 3, 3);
    if (!polyOk(plot, 8)) continue;
    gardens.push(plot); claim(plot);
  }
  for (let tries = 0; tries < 90 && orchards.length < prof.orchards; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 12 + rng() * 14;
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const ux = -Math.sin(a), uy = Math.cos(a);
    const hl = 8 + rng() * 4, hw = 6 + rng() * 3;
    const plot = orientedRect(c, ux, uy, hl, hw);
    if (!polyOk(plot, 12)) continue;
    const trees: Point[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t: Point = [c[0] + ux * i * hl * 0.6 + -uy * j * hw * 0.6, c[1] + uy * i * hl * 0.6 + ux * j * hw * 0.6];
      if (pointInPolygon(t, plot)) trees.push(t);
    }
    orchards.push({ polygon: plot, trees }); claim(plot);
  }

  // ring 2: great fields — 2-3 sectors anchored to road spines, furlong blocks of strips
  const fields: FieldPatch[] = [];
  const sectors = roads.length >= 2 ? Math.min(3, roads.length) : roads.length || 0;
  for (let sIdx = 0; sIdx < sectors; sIdx++) {
    const road = roads[sIdx % roads.length];
    for (let tries = 0; tries < 120 && fields.length < Math.ceil((prof.fields * (sIdx + 1)) / Math.max(1, sectors)); tries++) {
      const t = 0.25 + rng() * 0.65;                    // along the road, clear of the gate
      const i = Math.min(road.length - 2, Math.floor(t * (road.length - 1)));
      const frac = t * (road.length - 1) - i;
      const ax = road[i][0] + (road[i + 1][0] - road[i][0]) * frac;
      const ay = road[i][1] + (road[i + 1][1] - road[i][1]) * frac;
      let ux = road[i + 1][0] - road[i][0], uy = road[i + 1][1] - road[i][1];
      const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      const side = rng() < 0.5 ? -1 : 1;
      const off = 8 + rng() * 16;
      const c: Point = [ax + -uy * side * off, ay + ux * side * off];
      const hl = 11 + rng() * 7, hw = 6 + rng() * 4;   // furlong block, long axis along the road
      const plot = orientedRect(c, ux, uy, hl, hw);
      if (!polyOk(plot, 14)) continue;
      // ridge-and-furrow: strips run along the LONG axis, spaced across the width
      const nStrips = 4 + Math.floor(rng() * 4);
      const strips: Polyline[] = [];
      for (let k = 1; k < nStrips; k++) {
        const w = -hw + (2 * hw * k) / nStrips;
        strips.push([
          [c[0] - ux * (hl - 1.2) + -uy * w, c[1] - uy * (hl - 1.2) + ux * w],
          [c[0] + ux * (hl - 1.2) + -uy * w, c[1] + uy * (hl - 1.2) + ux * w],
        ]);
      }
      fields.push({ polygon: plot, strips }); claim(plot);
    }
  }
  // desert: keep only fields near water/oasis (irrigation)
  const keptFields = prof.dry
    ? fields.filter((f) => { const c = centroid(f.polygon); return water.bodies.some((b) => { const wc = centroid(b); return Math.hypot(wc[0] - c[0], wc[1] - c[1]) < 90; }); })
    : fields;

  return { gardens, fields: keptFields, pastures: [], farmsteads: [], orchards, woods: [] };
}
```

(Adjust the `plainOpts` fake `water` cast if `Water`'s actual shape differs — check `src/engine/city/water.ts` and construct a real "none" water via `buildWater(mulberry32(1), "none", {w:460,h:460})` if simpler.)

- [ ] **Step 4: Run** — countryside tests PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: countryside 모듈 1 — 성벽밑 텃밭·과수원 + 가도변 스트립 대경지"`

---

### Task 5: countryside.ts — pastures, farmsteads, woodland fringe

**Files:**
- Modify: `src/engine/city/countryside.ts`
- Test: `src/engine/city/countryside.test.ts`

**Interfaces:**
- Produces: `pastures`/`farmsteads`/`woods` now populated per the Task 4 interface. `countrysideProfile` drives biome differences (desert: 0 pastures; wetland: cattle; forest: dense woods).

- [ ] **Step 1: Failing tests**

```ts
describe("generateCountryside — pastures/farmsteads/woods", () => {
  it("plains city gets fenced pastures with animals inside, farmsteads with barns", () => {
    const o = plainOpts();
    const c = generateCountryside(mulberry32(9), o);
    expect(c.pastures.length).toBeGreaterThanOrEqual(2);
    for (const p of c.pastures) {
      expect(p.animals.length).toBeGreaterThanOrEqual(2);
      for (const a of p.animals) expect(pointInPolygon(a, p.fence)).toBe(true);
    }
    expect(c.farmsteads.length).toBeGreaterThanOrEqual(1);
    for (const f of c.farmsteads) {
      expect(pointInPolygon(centroid(f.barn), o.boundary)).toBe(false);
      // barn is the bigger footprint (research: barns dwarf the farmhouse)
      const area = (poly: Polygon) => Math.abs(poly.reduce((s, [x, y], i, arr) => { const [nx2, ny2] = arr[(i + 1) % arr.length]; return s + x * ny2 - nx2 * y; }, 0) / 2);
      expect(area(f.barn)).toBeGreaterThan(area(f.house));
    }
    expect(c.woods.length).toBeGreaterThanOrEqual(10);
    for (const t of c.woods) {
      const nearEdge = t[0] < 40 || t[0] > 420 || t[1] < 40 || t[1] > 420;
      expect(nearEdge).toBe(true);
    }
  });
  it("desert city has no pastures and no woods", () => {
    const o = { ...plainOpts(), biome: DESERT };
    const c = generateCountryside(mulberry32(9), o);
    expect(c.pastures.length).toBe(0);
    expect(c.woods.length).toBe(0);
  });
});
```

(add `DESERT` to the biome import in the test file)

- [ ] **Step 2: Run** — FAIL (arrays empty).

- [ ] **Step 3: Implement** — in `generateCountryside`, after the fields block:

```ts
  // pastures: fenced irregular paddocks in the gaps between field sectors; meadows prefer water
  const pastures: Pasture[] = [];
  for (let tries = 0; tries < 140 && pastures.length < prof.pastures; tries++) {
    const a = rng() * Math.PI * 2;
    const r = wallR + 24 + rng() * (Math.min(bounds.w, bounds.h) / 2 - wallR - 40);
    const c: Point = [bc[0] + Math.cos(a) * r, bc[1] + Math.sin(a) * r];
    const verts = 7 + Math.floor(rng() * 3);
    const R = 9 + rng() * 6;
    const fence: Polygon = [];
    for (let k = 0; k < verts; k++) {
      const va = (k / verts) * Math.PI * 2;
      const vr = R * (0.7 + rng() * 0.5);              // noise-deformed blob
      fence.push([c[0] + Math.cos(va) * vr, c[1] + Math.sin(va) * vr]);
    }
    if (!polyOk(fence, 14)) continue;
    const animals: Point[] = [];
    const nA = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < nA * 6 && animals.length < nA; k++) {
      const p: Point = [c[0] + (rng() - 0.5) * R, c[1] + (rng() - 0.5) * R];
      if (pointInPolygon(p, fence)) animals.push(p);
    }
    pastures.push({ fence, animals, kind: prof.animal }); claim(fence);
  }

  // farmsteads: at a field-block corner beside a road — never mid-field (Watabou lesson)
  const farmsteads: Farmstead[] = [];
  const wantF = 1 + Math.floor(size / 3);
  for (let tries = 0; tries < 100 && farmsteads.length < wantF && keptFields.length > 0; tries++) {
    const f = keptFields[Math.floor(rng() * keptFields.length)];
    const corner = f.polygon[Math.floor(rng() * f.polygon.length)];
    const away = 4 + rng() * 3;
    const dxc = corner[0] - centroid(f.polygon)[0], dyc = corner[1] - centroid(f.polygon)[1];
    const dl = Math.hypot(dxc, dyc) || 1;
    const hc: Point = [corner[0] + (dxc / dl) * away, corner[1] + (dyc / dl) * away];
    const theta = rng() * Math.PI;
    const hux = Math.cos(theta), huy = Math.sin(theta);
    const house = orientedRect(hc, hux, huy, 2.2, 1.7);
    const barn = orientedRect([hc[0] + hux * 6, hc[1] + huy * 6], hux, huy, 3.4, 2.4);
    if (!polyOk(house, 9) || !polyOk(barn, 0)) continue;
    const yard = rng() < 0.6 ? orientedRect([hc[0] + hux * 3, hc[1] + huy * 3], hux, huy, 7.5, 5) : null;
    farmsteads.push({ house, barn, yard }); claim(house); claim(barn);
  }

  // woodland fringe: tree points along the outer margin (the world continues into forest)
  const woods: Point[] = [];
  for (let tries = 0; tries < prof.woods * 8 && woods.length < prof.woods; tries++) {
    const edge = Math.floor(rng() * 4);
    const t = rng() * bounds.w;
    const depth = 4 + rng() * 30;
    const p: Point = edge === 0 ? [t, depth] : edge === 1 ? [t, bounds.h - depth] : edge === 2 ? [depth, t] : [bounds.w - depth, t];
    if (blocked(p)) continue;
    if (obstacles.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 7)) continue;
    if (woods.some((w2) => Math.hypot(w2[0] - p[0], w2[1] - p[1]) < 5)) continue;
    woods.push(p);
  }

  return { gardens, fields: keptFields, pastures, farmsteads, orchards, woods };
```

- [ ] **Step 4: Run** — `npx vitest run src/engine/city/countryside.test.ts` all PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat: countryside 모듈 2 — 방목지·가축, 농가·헛간, 숲 가장자리 (바이옴 프로필)"`

---

### Task 6: Wire countryside into city.ts + render it

**Files:**
- Modify: `src/engine/city.ts` (import, `CityLayout.countryside`, generation call LAST)
- Modify: `src/ui/svgCityRenderer.ts` (draw in `.environs`)
- Test: `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `generateCountryside(rng, opts)` from Tasks 4-5.
- Produces: `CityLayout.countryside: Countryside` (always present). Renderer classes `.garden .field .furrow .pasture .animal .farm-house .farm-barn .farm-yard .orchard .orchard-tree .wood-tree`.

- [ ] **Step 1: Failing tests**

city.test.ts:

```ts
it("attaches a countryside outside the walls", () => {
  const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
  const cs = layout.countryside;
  expect(cs.fields.length).toBeGreaterThanOrEqual(2);
  expect(cs.pastures.length).toBeGreaterThanOrEqual(1);
  for (const f of cs.fields) expect(pointInPolygon(centroid(f.polygon), layout.boundary)).toBe(false);
  for (const p of cs.pastures) expect(pointInPolygon(centroid(p.fence), layout.boundary)).toBe(false);
});
```

svgCityRenderer.test.ts:

```ts
it("renders the countryside in the unclipped environs layer", () => {
  const layout = generateCityLayout({ id: 7, name: "Test", size: 3, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
  const svg = renderCity(layout, "en");
  const env = svg.querySelector(".environs")!;
  expect(env.getAttribute("clip-path")).toBeNull();
  expect(env.querySelectorAll(".field").length).toBe(layout.countryside.fields.length);
  expect(env.querySelectorAll(".pasture").length).toBe(layout.countryside.pastures.length);
  expect(env.querySelectorAll(".farm-barn").length).toBe(layout.countryside.farmsteads.length);
  expect(env.querySelectorAll(".wood-tree").length).toBe(layout.countryside.woods.length);
});
```

- [ ] **Step 2: Run** — FAIL (`countryside` undefined).

- [ ] **Step 3: Implement**

`city.ts` — imports + type + call placed AFTER the gallows block (rng-stream tail, per convention):

```ts
import { generateCountryside } from "./city/countryside";
import type { Countryside } from "./city/countryside";
// CityLayout gains:  countryside: Countryside;
```

```ts
  const countryside = generateCountryside(rng, {
    bounds, boundary, water, mountains,
    roads: suburbRoads,
    obstacles: [
      ...occupied,                       // suburbs/outworks/abbey/cemetery/gallows already pushed here
    ],
    size: ctx.size, biome: ctx.biome, oasis: archetype.oasis,
  });
```

and add `countryside` to the returned object.

`svgCityRenderer.ts` — inside the `env` group, BEFORE the suburb-road loop (fields under roads under houses; landmarks stay last/on top):

```ts
  const cs = layout.countryside;
  for (const g2 of cs.gardens) env.appendChild(svgEl("polygon", { class: "garden", points: pts(g2), fill: "#c9d0a0", stroke: "#8a8a5f", "stroke-width": 0.3 }));
  const dry = layout.features.groundColor === "#ece0c2"; // desert palette pair
  for (const f of cs.fields) {
    env.appendChild(svgEl("polygon", { class: "field", points: pts(f.polygon), fill: dry ? "#e0cf9a" : "#d9cc9a", stroke: "#b3a26e", "stroke-width": 0.4 }));
    for (const s of f.strips) env.appendChild(svgEl("polyline", { class: "furrow", points: pts(s), fill: "none", stroke: dry ? "#c9b47a" : "#c4b581", "stroke-width": 0.35 }));
  }
  for (const p of cs.pastures) {
    env.appendChild(svgEl("polygon", { class: "pasture", points: pts(p.fence), fill: "#ccd6a8", "fill-opacity": 0.7, stroke: "#8a6a44", "stroke-width": 0.5, "stroke-dasharray": "1.6 1.1" }));
    for (const a of p.animals) env.appendChild(svgEl("circle", { class: "animal", cx: a[0], cy: a[1], r: 0.8, fill: p.kind === "sheep" ? "#f4f1e4" : "#8a6a44", stroke: "#5c4a33", "stroke-width": 0.25 }));
  }
  for (const or of cs.orchards) {
    env.appendChild(svgEl("polygon", { class: "orchard", points: pts(or.polygon), fill: "#cfd8ac", "fill-opacity": 0.5, stroke: "#8a8a5f", "stroke-width": 0.3 }));
    for (const t2 of or.trees) {
      env.appendChild(svgEl("circle", { class: "orchard-tree", cx: t2[0], cy: t2[1], r: 1.4, fill: "#8fae6e", stroke: "#5d7a45", "stroke-width": 0.3 }));
    }
  }
  for (const t2 of cs.woods) {
    env.appendChild(svgEl("circle", { class: "wood-tree", cx: t2[0], cy: t2[1], r: 1.6 + ((t2[0] * 7 + t2[1] * 13) % 10) / 12, fill: "#7d9b62", stroke: "#55703f", "stroke-width": 0.3 }));
  }
```

and AFTER the suburb house loop (farm buildings above their fields):

```ts
  for (const fm of cs.farmsteads) {
    if (fm.yard) env.appendChild(svgEl("polygon", { class: "farm-yard", points: pts(fm.yard), fill: "none", stroke: "#8a6a44", "stroke-width": 0.4, "stroke-dasharray": "1.2 1" }));
    env.appendChild(svgEl("polygon", { class: "farm-barn", points: pts(fm.barn), fill: "#7a5a3a", stroke: "#4d3620", "stroke-width": 0.4 }));
    env.appendChild(svgEl("polygon", { class: "farm-house", points: pts(fm.house), fill: "#e0d6c0", stroke: "#9a8a70", "stroke-width": 0.4 }));
  }
```

- [ ] **Step 4: Run** — both new tests PASS; `npm test` green; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 성 밖 시골 풍경 연결 + 렌더링 — 밭·방목지·농가·과수원·숲"`

---

### Task 7: Lord's castle — every city, inner wall, keep, postern (§7)

**Files:**
- Create: `src/engine/city/castle.ts`
- Modify: `src/engine/city.ts` (hasCastle always; wall-anchor for non-mountain; build + expose `CityLayout.castle`; skip generic buildings in the castle ward)
- Modify: `src/ui/svgCityRenderer.ts` (`.castle-inner` group in the clipped section)
- Test: `src/engine/city/castle.test.ts`, `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `insetPolygon(poly, d)` from geometry.ts; the zoned castle ward polygon.
- Produces:

```ts
export interface Castle {
  innerWall: Polygon;      // inset of the ward polygon
  towers: Point[];         // innerWall vertices
  gate: Point;             // innerWall edge midpoint nearest the town center
  postern: Point | null;   // innerWall edge midpoint nearest the town wall, if the ward touches it
  keep: Polygon;           // big donjon at the ward interior
  annexes: Polygon[];      // hall/chapel, size>=3 only
}
export function makeCastle(rng: Rng, ward: Polygon, townCenter: Point, boundary: Polygon, size: number): Castle | null
```

- [ ] **Step 1: Failing tests** — `src/engine/city/castle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeCastle } from "./castle";
import { pointInPolygon, centroid } from "../geometry";
import type { Polygon, Point } from "../geometry";

const ward: Polygon = [[300, 180], [340, 200], [345, 250], [310, 275], [275, 240], [278, 200]];
const boundary: Polygon = (() => { const b: Polygon = []; for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; b.push([230 + Math.cos(a) * 115, 230 + Math.sin(a) * 115]); } return b; })();

describe("makeCastle", () => {
  it("builds an inner wall inside the ward with towers, a gate toward town, and a keep", () => {
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 4)!;
    expect(c).not.toBeNull();
    for (const p of c.innerWall) expect(pointInPolygon(p, ward)).toBe(true);
    expect(c.towers.length).toBe(c.innerWall.length);
    expect(pointInPolygon(centroid(c.keep), c.innerWall)).toBe(true);
    // the gate faces the town: nearer the town center than the ward centroid is
    const wc = centroid(ward);
    expect(Math.hypot(c.gate[0] - 230, c.gate[1] - 230)).toBeLessThan(Math.hypot(wc[0] - 230, wc[1] - 230));
    expect(c.annexes.length).toBeGreaterThanOrEqual(1); // size 4: hall/chapel
  });
  it("small towns get a fortified manor: keep but no annexes", () => {
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 1)!;
    expect(c.annexes.length).toBe(0);
  });
  it("emits a postern when the ward touches the town wall", () => {
    // this ward reaches the boundary circle (r=115 from 230,230): vertex [345,250] is ~117 out
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 4)!;
    expect(c.postern).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/engine/city/castle.ts`:

```ts
// The lord's urban castle: integrated at the town wall with its own inner enceinte,
// a gate to the town and a postern to the countryside (research: Wikipedia "Urban castle").
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { insetPolygon, centroid, pointInPolygon } from "../geometry";

/* Castle interface as in the task header */

const TOUCH = 14; // ward counts as "at the wall" if a vertex is this close to the boundary ring

function nearestEdgeMid(poly: Polygon, target: Point): Point {
  let best: Point = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = Math.hypot(m[0] - target[0], m[1] - target[1]);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

export function makeCastle(rng: Rng, ward: Polygon, townCenter: Point, boundary: Polygon, size: number): Castle | null {
  const inner = insetPolygon(ward, size >= 3 ? 3 : 4);
  if (inner.length < 3) return null;
  const wc = centroid(inner);
  if (!pointInPolygon(wc, ward)) return null;      // degenerate inset (concave ward)
  const gate = nearestEdgeMid(inner, townCenter);
  // postern: only if the ward actually touches the town wall ring
  let postern: Point | null = null;
  let minToWall = Infinity; let wallPt: Point = boundary[0];
  for (const v of ward) for (const b of boundary) {
    const d = Math.hypot(v[0] - b[0], v[1] - b[1]);
    if (d < minToWall) { minToWall = d; wallPt = b; }
  }
  if (minToWall < TOUCH) postern = nearestEdgeMid(inner, wallPt);
  // keep: a stout rect at the point of the inner ward farthest from the gate (deepest refuge)
  let far: Point = wc, fd = -1;
  for (const v of inner) { const d = Math.hypot(v[0] - gate[0], v[1] - gate[1]); if (d > fd) { fd = d; far = v; } }
  const kc: Point = [wc[0] + (far[0] - wc[0]) * 0.45, wc[1] + (far[1] - wc[1]) * 0.45];
  const kr = size >= 3 ? 4.2 : 3;
  const theta = rng() * Math.PI;
  const kux = Math.cos(theta), kuy = Math.sin(theta);
  const keep: Polygon = [
    [kc[0] - kux * kr - -kuy * kr, kc[1] - kuy * kr - kux * kr],
    [kc[0] + kux * kr - -kuy * kr, kc[1] + kuy * kr - kux * kr],
    [kc[0] + kux * kr + -kuy * kr, kc[1] + kuy * kr + kux * kr],
    [kc[0] - kux * kr + -kuy * kr, kc[1] - kuy * kr + kux * kr],
  ];
  const annexes: Polygon[] = [];
  if (size >= 3) {
    const n = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const ac: Point = [wc[0] + Math.cos(a) * kr * 2.2, wc[1] + Math.sin(a) * kr * 2.2];
      if (!pointInPolygon(ac, inner)) continue;
      annexes.push([
        [ac[0] - 3, ac[1] - 2], [ac[0] + 3, ac[1] - 2], [ac[0] + 3, ac[1] + 2], [ac[0] - 3, ac[1] + 2],
      ]);
    }
  }
  return { innerWall: inner, towers: [...inner], gate, postern, keep, annexes };
}
```

`city.ts` changes:

1. hasCastle always + wall-anchor for non-mountain cities (replace the `assignZones` opts):

```ts
  // the lord's castle sits AT the town wall (research: urban castle) unless a mountain
  // anchor already claims the high ground. Bias the wall pick away from the sea side.
  if (!castleAnchor) {
    let v: Point;
    if (seaAnchor) {
      // coastal: put the castle on the wall run farthest from the harbor side
      let bi = 0, bd = -Infinity;
      for (let i = 0; i < boundary.length; i++) {
        const d = Math.hypot(boundary[i][0] - seaAnchor[0], boundary[i][1] - seaAnchor[1]);
        if (d > bd) { bd = d; bi = i; }
      }
      v = boundary[bi];
    } else {
      v = boundary[Math.floor(rng() * boundary.length)]; // inland: any stretch of wall
    }
    castleAnchor = [center[0] + (v[0] - center[0]) * 0.85, center[1] + (v[1] - center[1]) * 0.85];
  }
  const zoned = assignZones(rng, cells, [center[0], center[1]], radius, { hasCastle: true, coastal: ctx.coastal, castleAnchor, seaAnchor });
```

2. Castle ward: skip generic subdivision (add `"castle"` to `NO_BUILDINGS`) — the keep/annexes ARE its buildings.

3. After `zoned` → find the castle ward and build (place the call right after the wards/labels block, before features — document draw-order in a comment):

```ts
  const castleWard = zoned.find((z) => z.type === "castle") ?? null;
  const castle = castleWard ? makeCastle(rng, castleWard.polygon, [center[0], center[1]], boundary, ctx.size) : null;
```

4. `CityLayout` gains `castle: Castle | null`; return it. Imports: `makeCastle`, `type Castle` from `./city/castle`.

`svgCityRenderer.ts` — in the CLIPPED group, after wards/buildings are drawn:

```ts
  if (layout.castle) {
    const ca = layout.castle;
    const cg = svgEl("g", { class: "castle-inner" });
    for (const an of ca.annexes) cg.appendChild(svgEl("polygon", { class: "castle-annex", points: pts(an), fill: "#cfd4dd", stroke: "#5a6272", "stroke-width": 0.4 }));
    cg.appendChild(svgEl("polygon", { class: "castle-wall", points: pts(ca.innerWall), fill: "none", stroke: "#5a5346", "stroke-width": 1.3, "stroke-linejoin": "round" }));
    for (const t2 of ca.towers) cg.appendChild(svgEl("circle", { class: "castle-tower", cx: t2[0], cy: t2[1], r: 1.3, fill: "#8a8272", stroke: "#4c463c", "stroke-width": 0.4 }));
    cg.appendChild(svgEl("circle", { class: "castle-gate", cx: ca.gate[0], cy: ca.gate[1], r: 1.1, fill: "#e8dfc9", stroke: "#4c463c", "stroke-width": 0.5 }));
    if (ca.postern) cg.appendChild(svgEl("circle", { class: "castle-postern", cx: ca.postern[0], cy: ca.postern[1], r: 0.9, fill: "#e8dfc9", stroke: "#7a2f2f", "stroke-width": 0.5 }));
    cg.appendChild(svgEl("polygon", { class: "castle-keep", points: pts(ca.keep), fill: "#6e7686", stroke: "#3a4050", "stroke-width": 0.6 }));
    clipped.appendChild(cg);
  }
```

city.test.ts addition:

```ts
it("every city has a lord's castle with an inner wall and keep", () => {
  for (const size of [1, 3, 5]) {
    const layout = generateCityLayout({ id: 7, name: "T", size, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
    expect(layout.castle).not.toBeNull();
    expect(layout.wards.some((w2) => w2.type === "castle")).toBe(true);
  }
});
```

renderer test addition:

```ts
it("draws the castle inner wall, towers and keep", () => {
  const layout = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, 1);
  const svg = renderCity(layout, "en");
  expect(svg.querySelector(".castle-wall")).not.toBeNull();
  expect(svg.querySelector(".castle-keep")).not.toBeNull();
  expect(svg.querySelectorAll(".castle-tower").length).toBe(layout.castle!.towers.length);
});
```

- [ ] **Step 4: Run** — castle/city/renderer tests PASS. NOTE: adding `hasCastle: true` + the new anchor rng draw shifts downstream layouts — expected (byte-compat waived); update any layout-count assertions that break. `npm test` green, `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: 영주의 성 — 모든 도시에 내성벽·탑·아성·뒷문 (성벽 부착형)"`

---

### Task 8: Integration verify + deploy

**Files:** none new (fixes only if verification finds issues)

- [ ] **Step 1: Full suite** — `npm test` → all green; `npm run build` → clean.
- [ ] **Step 2: Live DOM verify** — start the dev server (launch config `worldmaker`), `preview_resize({width:1280,height:800})` first (see memory: raster screenshot times out; use eval/inspect). Open `map.html`, click a city marker, assert via eval: `.environs .field` count > 0, `.castle-keep` exists, svg viewBox `0 0 568 460`, computed svg width ≈ 1008. Check 4+ cities across biomes (plains/forest/desert/coastal) and one mountain city: desert → no `.pasture`; coastal → harbor intact; mountain → castle present, no countryside inside mountain masses.
- [ ] **Step 3: Sweep** — 10 seeds via eval loop: no `.field`/`.pasture`/`.farm-barn` centroid inside the boundary polygon (reuse the pointInPolygon check in page context via the exported layout if handy, or trust engine tests and spot-check visually with the user).
- [ ] **Step 4: Merge + deploy** — merge branch to main in the parent repo, push (Pages auto-deploys; if deploy-pages fails "try again later", wait 5-10 min and push an empty commit — known Pages throttle).
- [ ] **Step 5: Ask the user to eyeball** the deployed site (field colors, animal dot size, castle prominence — subjective calls flagged in the spec).

---

## Self-Review Notes

- Spec coverage: §1→Task 1, §2→Tasks 3-6, §3→Tasks 4-5 (`countrysideProfile`), §4→Task 6, §5→Tasks 4-7 test steps, §6→Task 2, §7→Task 7. Spec's `Countryside.roads`/`hamlets` are DELIVERED via the extended `suburbRoads`/`suburbs` (Task 3) instead of duplicate fields — intent (gate roads to the edge with bends; more houses) preserved, no double-drawn roads.
- Postern exit road (spec §7 "adds a short exit road outside") is NOT built: the postern opens onto the countryside ring where Task 3 roads already pass nearby; a dedicated stub road adds clutter at this scale. Deviation documented here — flag to the user at review.
- Type consistency: `Countryside`/`CountrysideOpts` identical in Tasks 4/5/6; `Castle` identical in Task 7's module/city/renderer references; `orientedRect` defined in Task 4, reused in Task 5.
- The Task 4 `plainOpts` water stub is the one leap of faith — Step 3 tells the implementer to build a real `buildWater(..., "none", ...)` if the cast fights the type.
