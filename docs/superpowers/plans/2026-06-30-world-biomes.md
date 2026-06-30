# 월드맵 바이오미 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월드맵을 정치 단색 채움에서 **기후 기반 바이오미 바탕 + 국경선(선)**으로 바꾸고, `CityMarker.biome`를 노출한다(다음 단계 토대).

**Architecture:** 새 `biome.ts`가 위도(육지 y범위 정규화)+습도 노이즈로 셀별 바이오미를 분류한다(메인 rng와 분리된 시드 스트림). 새 `borders.ts`가 인접·폴리티 상이 변(국경선)과 육지-바다 변(해안선)을 공유 모서리로 추출한다. `world.ts`가 이를 통합하고, `svgWorldRenderer.ts`가 바이오미 색으로 채운 뒤 해안선·국경선을 한 path씩 얹는다.

**Tech Stack:** TypeScript(strict), Vitest(+jsdom), 기존 `d3-delaunay`·`simplex-noise`. 신규 런타임 의존성 없음.

## Global Constraints

- TypeScript `strict: true`(`noUnusedLocals`). 신규 런타임 의존성 금지(`d3-delaunay`,`simplex-noise`만).
- 모든 무작위성은 `src/engine/rng.ts` 시드 PRNG만(`Math.random()` 금지). 바이오미 노이즈는 `deriveSeed(params.seed, SALT)` 파생 스트림 → 메인 `rng` 소비 순서 불변.
- 엔진(`src/engine/**`)은 DOM 비의존. 렌더는 `src/ui/**`.
- 공개 시그니처 유지: `generateWorld(params): GeneratedWorld`. 반환 `World`가 `biome` 필드만큼 커질 뿐.
- 바이오미 상수: `OCEAN=0, TUNDRA=1, TAIGA=2, TEMPERATE_FOREST=3, GRASSLAND=4, DESERT=5, TROPICAL=6, WETLAND=7, ALPINE=8`.
- 기존 시드 불변(공유 URL 보존): seed=1에서 `polityOf` FNV해시 `1350115163`, 도시 `cell` FNV해시 `4294534188`, 도시 28개.

---

## File Structure

```
src/engine/biome.ts            바이오미 상수·색·이름 + classifyBiomes (신규)
src/engine/borders.ts          sharedEdge + politicalBorders + coastline (신규)
src/types/world.ts             World.biome, CityMarker.biome (수정)
src/engine/world.ts            classifyBiomes 호출 + 도시 biome 주입 (수정)
src/ui/svgWorldRenderer.ts     바이오미 채움 + 해안선·국경선 + 범례 (재작성)
```

재사용(변경 없음): `grid.ts`(polygons·neighbors), `terrain.ts`(상수), `heightmap.ts`, `rng.ts`(`mulberry32`,`deriveSeed`).

---

### Task 1: 바이오미 분류 (biome.ts)

**Files:**
- Create: `src/engine/biome.ts`, `src/engine/biome.test.ts`

**Interfaces:**
- Consumes: `createNoise2D`(simplex-noise); `mulberry32`,`deriveSeed`(rng); `Grid`(grid); `WorldParams`(types/world); `OCEAN`,`MOUNTAIN`(terrain).
- Produces: 바이오미 상수(위 Global) + `BIOME_COLORS: Record<number,string>` + `BIOME_NAMES: Record<number,string>` + `classifyBiomes(grid: Grid, heights: number[]|Float32Array, terrain: number[]|Uint8Array, params: WorldParams): Uint8Array`.

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/biome.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";
import { classifyTerrain, OCEAN as T_OCEAN, MOUNTAIN as T_MOUNTAIN } from "./terrain";
import { classifyBiomes, OCEAN, ALPINE, TUNDRA, TAIGA, DESERT, TROPICAL, WETLAND } from "./biome";
import { DEFAULT_PARAMS } from "../types/world";

function build(seed: number) {
  const rng = mulberry32(seed);
  const grid = generateGrid(rng, 1000, 700, 1500);
  const heights = assignHeights(rng, grid);
  const terrain = classifyTerrain(heights, 0.3, 0.55);
  return { grid, heights, terrain };
}

describe("classifyBiomes", () => {
  it("keeps ocean as OCEAN and makes mountains ALPINE", () => {
    const { grid, heights, terrain } = build(1);
    const b = classifyBiomes(grid, heights, terrain, { ...DEFAULT_PARAMS, seed: 1 });
    for (let i = 0; i < grid.count; i++) {
      if (terrain[i] === T_OCEAN) expect(b[i]).toBe(OCEAN);
      if (terrain[i] === T_MOUNTAIN) expect(b[i]).toBe(ALPINE);
    }
  });
  it("places cold biomes north (smaller y) of hot biomes on average", () => {
    let coldY = 0, coldN = 0, hotY = 0, hotN = 0;
    for (const s of [1, 2, 3]) {
      const { grid, heights, terrain } = build(s);
      const b = classifyBiomes(grid, heights, terrain, { ...DEFAULT_PARAMS, seed: s });
      for (let i = 0; i < grid.count; i++) {
        const y = grid.points[i * 2 + 1];
        if (b[i] === TUNDRA || b[i] === TAIGA) { coldY += y; coldN++; }
        if (b[i] === DESERT || b[i] === TROPICAL) { hotY += y; hotN++; }
      }
    }
    expect(coldN).toBeGreaterThan(0);
    expect(hotN).toBeGreaterThan(0);
    expect(coldY / coldN).toBeLessThan(hotY / hotN);
  });
  it("only assigns WETLAND on low-lying land", () => {
    const { grid, heights, terrain } = build(2);
    const b = classifyBiomes(grid, heights, terrain, { ...DEFAULT_PARAMS, seed: 2 });
    for (let i = 0; i < grid.count; i++) {
      if (b[i] === WETLAND) expect(heights[i]).toBeLessThan(0.3 + 0.05);
    }
  });
  it("is deterministic", () => {
    const { grid, heights, terrain } = build(7);
    const p = { ...DEFAULT_PARAMS, seed: 7 };
    expect(Array.from(classifyBiomes(grid, heights, terrain, p)))
      .toEqual(Array.from(classifyBiomes(grid, heights, terrain, p)));
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- biome` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/biome.ts`

```ts
import { createNoise2D } from "simplex-noise";
import { mulberry32, deriveSeed } from "./rng";
import type { Grid } from "./grid";
import type { WorldParams } from "../types/world";
import { OCEAN as T_OCEAN, MOUNTAIN as T_MOUNTAIN } from "./terrain";

export const OCEAN = 0;
export const TUNDRA = 1;
export const TAIGA = 2;
export const TEMPERATE_FOREST = 3;
export const GRASSLAND = 4;
export const DESERT = 5;
export const TROPICAL = 6;
export const WETLAND = 7;
export const ALPINE = 8;

export const BIOME_COLORS: Record<number, string> = {
  [OCEAN]: "#a9c7e0",
  [TUNDRA]: "#cdccc0",
  [TAIGA]: "#5f7d63",
  [TEMPERATE_FOREST]: "#86a85e",
  [GRASSLAND]: "#cdbf7a",
  [DESERT]: "#e3cd92",
  [TROPICAL]: "#3f8f57",
  [WETLAND]: "#7fae96",
  [ALPINE]: "#b9b2a6",
};

export const BIOME_NAMES: Record<number, string> = {
  [TUNDRA]: "Tundra",
  [TAIGA]: "Taiga",
  [TEMPERATE_FOREST]: "Forest",
  [GRASSLAND]: "Grassland",
  [DESERT]: "Desert",
  [TROPICAL]: "Tropical",
  [WETLAND]: "Wetland",
  [ALPINE]: "Alpine",
};

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function classifyBiomes(
  grid: Grid,
  heights: number[] | Float32Array,
  terrain: number[] | Uint8Array,
  params: WorldParams
): Uint8Array {
  const n = grid.count;
  const tNoise = createNoise2D(mulberry32(deriveSeed(params.seed, 7001)));
  const mNoise = createNoise2D(mulberry32(deriveSeed(params.seed, 7002)));
  const F = 0.006;
  // land y-extent: temperature is normalised over the continent, not the whole map
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (terrain[i] === T_OCEAN) continue;
    const y = grid.points[i * 2 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1, maxY - minY);
  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (terrain[i] === T_OCEAN) { biome[i] = OCEAN; continue; }
    if (terrain[i] === T_MOUNTAIN) { biome[i] = ALPINE; continue; }
    const x = grid.points[i * 2], y = grid.points[i * 2 + 1];
    const h = heights[i];
    const latNorm = (y - minY) / span;
    const temp = clamp01(latNorm + tNoise(x * F, y * F) * 0.12 - Math.max(0, h - params.seaLevel) * 0.8);
    const coastal = grid.neighbors[i].some((j) => terrain[j] === T_OCEAN);
    const moist = clamp01((mNoise(x * F, y * F) * 0.5 + 0.5) + (coastal ? 0.12 : 0));
    if (h < params.seaLevel + 0.05 && moist > 0.6) { biome[i] = WETLAND; continue; }
    if (temp < 0.35) biome[i] = moist < 0.45 ? TUNDRA : TAIGA;
    else if (temp < 0.70) biome[i] = moist < 0.40 ? GRASSLAND : TEMPERATE_FOREST;
    else biome[i] = moist < 0.40 ? DESERT : TROPICAL;
  }
  return biome;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- biome` → PASS (4개). 그리고 `npm run build` → tsc 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/biome.ts src/engine/biome.test.ts
git commit -m "feat: climate-based biome classification"
```

---

### Task 2: 국경선·해안선 추출 (borders.ts)

**Files:**
- Create: `src/engine/borders.ts`, `src/engine/borders.test.ts`

**Interfaces:**
- Consumes: `Grid`(grid); `OCEAN`(terrain).
- Produces: `type Point=[number,number]`, `type Segment=[Point,Point]`; `sharedEdge(a:number[][], b:number[][]): Segment|null`; `politicalBorders(grid:Grid, polityOf:number[]): Segment[]`; `coastline(grid:Grid, terrain:number[]|Uint8Array): Segment[]`.

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/borders.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { Grid } from "./grid";
import { sharedEdge, politicalBorders, coastline } from "./borders";

// three cells in a row; cell0|cell1 share x=2 edge, cell1|cell2 share x=4 edge
const grid = {
  width: 10, height: 10, count: 3,
  points: [1, 1, 3, 1, 5, 1],
  polygons: [
    [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    [[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]],
    [[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]],
  ],
  neighbors: [[1], [0, 2], [1]],
  find: () => 0,
} as unknown as Grid;

describe("borders", () => {
  it("sharedEdge finds the two common vertices", () => {
    const e = sharedEdge(grid.polygons[0], grid.polygons[1]);
    expect(e).not.toBeNull();
    const xs = e!.map((p) => p[0]);
    expect(xs.every((x) => x === 2)).toBe(true);
  });
  it("sharedEdge returns null when only a corner touches", () => {
    const a = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    const c = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    expect(sharedEdge(a, c)).toBeNull();
  });
  it("politicalBorders only between differing polities", () => {
    expect(politicalBorders(grid, [0, 1, 1]).length).toBe(1);
    expect(politicalBorders(grid, [0, 0, 0]).length).toBe(0);
  });
  it("coastline only on land-ocean edges", () => {
    expect(coastline(grid, [1, 1, 0]).length).toBe(1); // cell1 touches ocean cell2
    expect(coastline(grid, [1, 1, 1]).length).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- borders` → FAIL

- [ ] **Step 3: 구현** — `src/engine/borders.ts`

```ts
import type { Grid } from "./grid";
import { OCEAN } from "./terrain";

export type Point = [number, number];
export type Segment = [Point, Point];

const EPS = 0.01;

export function sharedEdge(a: number[][], b: number[][]): Segment | null {
  const shared: Point[] = [];
  for (const pa of a) {
    let match = false;
    for (const pb of b) {
      if (Math.abs(pa[0] - pb[0]) < EPS && Math.abs(pa[1] - pb[1]) < EPS) { match = true; break; }
    }
    if (!match) continue;
    if (shared.some((s) => Math.abs(s[0] - pa[0]) < EPS && Math.abs(s[1] - pa[1]) < EPS)) continue; // dedup closing vertex
    shared.push([pa[0], pa[1]]);
    if (shared.length === 2) break;
  }
  return shared.length === 2 ? [shared[0], shared[1]] : null;
}

export function politicalBorders(grid: Grid, polityOf: number[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (polityOf[i] < 0) continue;
    for (const j of grid.neighbors[i]) {
      if (j <= i) continue;
      if (polityOf[j] >= 0 && polityOf[j] !== polityOf[i]) {
        const e = sharedEdge(grid.polygons[i], grid.polygons[j]);
        if (e) segs.push(e);
      }
    }
  }
  return segs;
}

export function coastline(grid: Grid, terrain: number[] | Uint8Array): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (terrain[i] === OCEAN) continue;
    for (const j of grid.neighbors[i]) {
      if (terrain[j] === OCEAN) {
        const e = sharedEdge(grid.polygons[i], grid.polygons[j]);
        if (e) segs.push(e);
      }
    }
  }
  return segs;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- borders` → PASS (4개). `npm run build` → 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/borders.ts src/engine/borders.test.ts
git commit -m "feat: political border and coastline edge extraction"
```

---

### Task 3: 타입 + world 통합 + 골든 회귀 (필수 필드 리플)

**Files:**
- Modify: `src/types/world.ts`, `src/engine/world.ts`, `src/engine/world.test.ts`
- Modify (리플): `src/engine/city.test.ts`, `src/ui/svgCityRenderer.test.ts` (+ tsc가 추가로 가리키는 모든 리터럴)

**Interfaces:**
- Consumes: `classifyBiomes`(biome).
- Produces: `World.biome: number[]`; `CityMarker.biome: number`. `generateWorld` 시그니처 불변.

필수 필드 추가가 여러 CityMarker 리터럴을 깨므로(타입 에러), 타입·world 통합·리터럴 수정·골든 회귀를 **한 묶음**으로 처리해 한 커밋으로 초록을 만든다.

- [ ] **Step 1: 타입에 필드 추가** — `src/types/world.ts`

`CityMarker`에 `elevation: number;` 아래 한 줄 추가:
```ts
  biome: number;
```
`World`의 `terrain: number[];` 아래 한 줄 추가:
```ts
  biome: number[];
```

- [ ] **Step 2: world.ts 통합** — `src/engine/world.ts`

import 추가(상단, terrain import 아래):
```ts
import { classifyBiomes } from "./biome";
```
`const terrain = classifyTerrain(...)` 다음 줄에 추가:
```ts
  const biome = classifyBiomes(grid, heights, terrain, params);
```
수도 도시 push의 객체에 `elevation: heights[p.capital],` 다음 줄 추가:
```ts
      biome: biome[p.capital],
```
일반 도시 push의 객체에 `elevation: heights[cell],` 다음 줄 추가:
```ts
      biome: biome[cell],
```
`world` 객체 리터럴의 `terrain: Array.from(terrain),` 다음 줄 추가:
```ts
    biome: Array.from(biome),
```

- [ ] **Step 3: 골든 회귀 + 통합 테스트 작성** — `src/engine/world.test.ts`에 추가

```ts
import { DEFAULT_PARAMS } from "../types/world";

describe("biome integration", () => {
  it("does not shift existing seeds (biome uses a separate rng stream)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    let h = 2166136261 >>> 0;
    for (const p of world.polityOf) { h ^= (p + 1); h = Math.imul(h, 16777619) >>> 0; }
    let ch = 2166136261 >>> 0;
    for (const c of world.cities) { ch ^= c.cell; ch = Math.imul(ch, 16777619) >>> 0; }
    expect(h >>> 0).toBe(1350115163);
    expect(ch >>> 0).toBe(4294534188);
    expect(world.cities.length).toBe(28);
  });
  it("exposes a biome per cell and per city", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    expect(world.biome.length).toBe(world.grid.count);
    for (const c of world.cities) expect(world.biome[c.cell]).toBe(c.biome);
  });
});
```
(주: `generateWorld`/`expect`/`describe`/`it`는 world.test.ts에 이미 import돼 있다. `DEFAULT_PARAMS` import만 없으면 추가.)

- [ ] **Step 4: 깨진 리터럴 수정** — Run: `npm run build`로 타입 에러 목록 확보.

`src/engine/city.test.ts`의 `base: CityMarker` 리터럴에 `elevation: 0.5,` 다음 줄 `biome: 4,` 추가.
`src/ui/svgCityRenderer.test.ts`의 `marker: CityMarker` 리터럴에도 `biome: 4,` 추가.
tsc가 가리키는 **그 외 모든 CityMarker/World 리터럴**에 `biome`(셀: `biome: 4`, 월드: `biome: []`) 추가. `npm run build`가 클린해질 때까지 반복.

- [ ] **Step 5: 통과 확인** — Run: `npm test` → 전부 PASS(골든 회귀 포함). `npm run build` → 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/types/world.ts src/engine/world.ts src/engine/world.test.ts src/engine/city.test.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: integrate biomes into world, expose CityMarker.biome (seeds unchanged)"
```

---

### Task 4: 월드 렌더러 재작성 (바이오미 + 해안선·국경선 + 범례)

**Files:**
- Modify (재작성): `src/ui/svgWorldRenderer.ts`
- Modify (재작성): `src/ui/svgWorldRenderer.test.ts`

**Interfaces:**
- Consumes: `World`(types); `svgEl`(renderer); `OCEAN`,`BIOME_COLORS`,`BIOME_NAMES`(biome); `politicalBorders`,`coastline`,`Segment`(borders).
- Produces: `renderWorld(world: World): SVGSVGElement` (시그니처 불변). 셀을 바이오미별 그룹 path로 채우고, 해안선·국경선을 카테고리별 한 path로, 존재 바이오미만 범례. 산 오버레이 제거.

- [ ] **Step 1: 렌더 테스트 재작성** — `src/ui/svgWorldRenderer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { renderWorld } from "./svgWorldRenderer";

describe("renderWorld biomes", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const svg = renderWorld(world);
  it("fills cells by biome (several biome paths, no political region fills)", () => {
    expect(svg.querySelectorAll(".biomes path.biome").length).toBeGreaterThan(1);
    expect(svg.querySelectorAll(".regions").length).toBe(0);
    expect(svg.querySelectorAll(".mountains").length).toBe(0);
  });
  it("draws coastline and borders as one path each", () => {
    expect(svg.querySelectorAll("path.coastline").length).toBe(1);
    expect(svg.querySelectorAll("path.border").length).toBe(1);
  });
  it("keeps a marker per city and shows a biome legend", () => {
    expect(svg.querySelectorAll(".markers circle").length).toBe(world.cities.length);
    expect(svg.querySelectorAll(".legend .legend-item").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- svgWorldRenderer` → FAIL (현재 `.regions`/`.mountains` 구조)

- [ ] **Step 3: 렌더러 재작성** — `src/ui/svgWorldRenderer.ts`

```ts
import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { OCEAN, BIOME_COLORS, BIOME_NAMES } from "../engine/biome";
import { politicalBorders, coastline } from "../engine/borders";
import type { Segment } from "../engine/borders";

function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  return "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

function segPath(segs: Segment[]): string {
  return segs.map(([a, b]) => `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`).join("");
}

export function renderWorld(world: World): SVGSVGElement {
  const { grid } = world;
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: "world",
  }) as SVGSVGElement;

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: BIOME_COLORS[OCEAN] }));

  // biome fills (ocean is the background rect, so skip OCEAN cells)
  const byBiome = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const bm = world.biome[i];
    if (bm === OCEAN) continue;
    byBiome.set(bm, (byBiome.get(bm) ?? "") + cellPath(grid.polygons[i]));
  }
  const biomes = svgEl("g", { class: "biomes" });
  for (const [bm, d] of byBiome) {
    biomes.appendChild(svgEl("path", { class: "biome", "data-biome": bm, d, fill: BIOME_COLORS[bm] }));
  }
  root.appendChild(biomes);

  root.appendChild(svgEl("path", {
    class: "coastline", d: segPath(coastline(grid, world.terrain)),
    fill: "none", stroke: "#5f7888", "stroke-width": 0.6,
  }));
  root.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, world.polityOf)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 0.8, "stroke-linejoin": "round",
  }));

  const markers = svgEl("g", { class: "markers" });
  for (const c of world.cities) {
    markers.appendChild(svgEl("circle", {
      cx: c.x, cy: c.y, r: c.isCapital ? 4 : 2.5,
      fill: "#222", stroke: "#fff", "stroke-width": 1,
      "data-city": c.id, style: "cursor:pointer",
    }));
    const label = svgEl("text", { x: c.x + 5, y: c.y + 3, "font-size": 9, fill: "#222" });
    label.textContent = c.name;
    markers.appendChild(label);
  }
  root.appendChild(markers);

  // legend: only biomes present on this map
  const present = [...byBiome.keys()].sort((a, b) => a - b);
  const legend = svgEl("g", { class: "legend" });
  const x0 = 8, y0 = grid.height - 10 - present.length * 14;
  legend.appendChild(svgEl("rect", {
    x: x0 - 5, y: y0 - 10, width: 104, height: present.length * 14 + 14, rx: 3,
    fill: "#f7f2e6", "fill-opacity": 0.92, stroke: "#cbb784", "stroke-width": 0.5,
  }));
  present.forEach((bm, i) => {
    const y = y0 + i * 14;
    legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 8, width: 10, height: 10, fill: BIOME_COLORS[bm], stroke: "#9a8a70", "stroke-width": 0.4 }));
    const t = svgEl("text", { x: x0 + 16, y: y, "font-size": 9, fill: "#4a3f2c" });
    t.textContent = BIOME_NAMES[bm] ?? "";
    legend.appendChild(t);
  });
  root.appendChild(legend);

  return root;
}
```

- [ ] **Step 4: 통과 + 빌드** — Run: `npm test` → 전부 PASS. `npm run build` → 클린(`MOUNTAIN` import 제거됨, 미사용 없음).

- [ ] **Step 5: 커밋**

```bash
git add src/ui/svgWorldRenderer.ts src/ui/svgWorldRenderer.test.ts
git commit -m "feat: render world as biome map with coastline and borders"
```

---

### Task 5: 통합 검증 + 육안 튜닝 패스

**Files:** (변경은 튜닝 시에만 — `biome.ts` 임계값/팔레트)

- [ ] **Step 1: 전체 테스트 + 빌드** — Run: `npm test` → 전부 PASS. `npm run build` → 성공.

- [ ] **Step 2: 분포 점검(DOM 지표)** — 임시 스크립트로 seed 몇 개의 바이오미 분포를 확인: 각 바이오미 셀 수, 늪지/알파인이 0이 아닌지, 한대/열대가 양쪽에 존재하는지. (스크린샷 도구가 막혀 있으므로 수치+localhost.)

```bash
cat > src/engine/__bdist.test.ts <<'EOF'
import { it } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { BIOME_NAMES } from "./biome";
it("biome distribution", () => {
  for (const s of [1,2,3]) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: s });
    const c: Record<number,number> = {};
    for (const b of world.biome) c[b] = (c[b]||0)+1;
    console.log("seed"+s, Object.entries(c).map(([k,v])=>`${BIOME_NAMES[+k]??(k==="0"?"Ocean":k)}:${v}`).join(" "));
  }
});
EOF
npx vitest run __bdist 2>&1 | grep "seed" ; rm -f src/engine/__bdist.test.ts
```

- [ ] **Step 3: localhost 육안 확인** — preview 서버 reload 후 월드맵에서 바이오미 색·해안선·국경선·범례를 확인(`preview_eval`로 `.biome`/`.coastline`/`.border`/`.legend` 요소 수와 색 점검). 도시 클릭→도시 드릴다운이 여전히 동작하는지(공개 API 불변) 확인.

- [ ] **Step 4: 필요 시 튜닝** — 색 구분이 약하거나(특히 4가지 녹색) 분포가 치우치면 `biome.ts`의 `BIOME_COLORS`/임계값(0.35·0.70·0.40·0.45·0.05·0.6)만 조정하고 테스트 재확인 후 커밋:

```bash
git add src/engine/biome.ts
git commit -m "tune: biome palette/thresholds from visual review"
```

---

## Self-Review

**Spec coverage:** 기후 모델(육지 y 정규화·습도·별도 시드)→Task1. 바이오미 분류 규칙/상수/팔레트→Task1. 국경선·해안선(`sharedEdge`/`politicalBorders`/`coastline`)→Task2. 타입·world 통합·`CityMarker.biome`·골든 회귀·리터럴 리플→Task3. 렌더(바이오미 채움·OCEAN 스킵·해안선/국경선 한 path·존재 바이오미 범례·산 오버레이 제거)→Task4. 검증·튜닝→Task5. ✅

**Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드·정확한 골든값(1350115163 / 4294534188 / 28). ✅

**Type consistency:** `classifyBiomes(grid,heights,terrain,params):Uint8Array` (Task1 정의 → Task3 호출 일치). `BIOME_COLORS`/`BIOME_NAMES`/`OCEAN`(Task1 → Task4 소비). `Segment`/`politicalBorders`/`coastline`(Task2 → Task4). `World.biome:number[]`/`CityMarker.biome:number`(Task3 → Task4 `world.biome`). 바이오미 상수 0–8 일관. ✅

**Note:** Task3는 필수 필드 추가가 city.test/svgCityRenderer.test의 CityMarker 리터럴을 깨므로 한 커밋으로 묶었고, tsc로 그 외 리터럴까지 잡아 수정한다. 골든값은 변경 전 main에서 캡처한 실측치다.
