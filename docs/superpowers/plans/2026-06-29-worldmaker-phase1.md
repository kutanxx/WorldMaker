# WorldMaker Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시드 기반으로 판타지 대륙을 절차 생성해 정치 지도(SVG)로 그리고, 도시를 클릭하면 구역 블록 도시맵으로 드릴다운하며, PNG/SVG/JSON 내보내기와 시드 URL 공유를 지원하는 브라우저 앱(Phase 1, 역사 시뮬 제외).

**Architecture:** DOM을 모르는 순수 생성 엔진(`src/engine/`)과 SVG 렌더/UI(`src/ui/`)를 분리한다. 엔진은 시드에서 완전히 결정적인 `World` 데이터 객체를 만들고, 렌더러는 `Renderer` 인터페이스 뒤에서 SVG를 생성한다. 도시 상세 지도는 `deriveSeed(월드시드, 도시ID)`로 파생돼 항상 재현된다.

**Tech Stack:** TypeScript(strict), Vite, Vitest(+jsdom), d3-delaunay, simplex-noise. 백엔드 없음.

## Global Constraints

- TypeScript `strict: true`. Node 18+.
- 런타임 의존성은 `d3-delaunay`, `simplex-noise` 두 개만. 그 외는 추가 금지(YAGNI).
- 모든 무작위성은 `src/engine/rng.ts`의 시드 PRNG만 사용한다. `Math.random()` 직접 호출 금지(결정성).
- 렌더링은 SVG 우선, 항상 `Renderer` 인터페이스를 거친다(나중 Canvas/WebGL 교체 대비).
- UI 카피는 sentence case.
- 파일은 단일 책임으로 작게 유지한다.
- 기본 파라미터: `width=1000, height=700, cellCount=4000, seaLevel=0.4, mountainLevel=0.8, polityCount=8, townCount=20`.
- 엔진 테스트는 기본 node 환경, UI(렌더러/앱) 테스트 파일은 상단에 `// @vitest-environment jsdom` 주석을 둔다.

---

## File Structure

```
src/
  types/world.ts            공유 데이터 타입 (WorldParams, World, CityMarker, ...)
  engine/rng.ts             시드 PRNG + 헬퍼 (mulberry32, randInt, pick, hashStringToSeed, deriveSeed)
  engine/grid.ts            Voronoi 셀 그래프 + Lloyd 완화 + find(x,y)
  engine/heightmap.ts       셀별 고도 (simplex 노이즈 + 섬 셰이핑)
  engine/terrain.ts         바다/육지/산 분류 + 대륙(연결요소)
  engine/names.ts           음절 기반 이름 생성
  engine/polities.ts        초기 소국 시딩 + 플러드필
  engine/world.ts           오케스트레이션 → GeneratedWorld { world, find }
  engine/city.ts            도시 구역 블록 레이아웃 생성
  ui/renderer.ts            Renderer 인터페이스 + SVG 헬퍼
  ui/svgWorldRenderer.ts    World → SVG
  ui/svgCityRenderer.ts     CityLayout → SVG
  ui/export.ts              JSON/SVG 문자열, PNG 다운로드
  ui/urlState.ts            파라미터 ↔ URL 해시 인코딩
  ui/app.ts                 컨트롤·뷰 전환·클릭·내보내기 배선
  main.ts                   진입점
index.html
test/                       (테스트는 각 소스 옆 *.test.ts 로 배치)
```

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/sanity.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: 동작하는 `npm run dev`, `npm test` 환경

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "worldmaker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "d3-delaunay": "^6.0.4",
    "simplex-noise": "^4.0.3"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0",
    "jsdom": "^24.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: vite.config.ts / vitest.config.ts / index.html / main.ts 작성**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
export default defineConfig({ root: ".", build: { outDir: "dist" } });
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: true, environment: "node" } });
```

`index.html`:
```html
<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><title>WorldMaker</title></head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:
```ts
const app = document.getElementById("app");
if (app) app.textContent = "WorldMaker";
```

- [ ] **Step 4: 새너티 테스트 작성** — `src/sanity.test.ts`

```ts
import { describe, it, expect } from "vitest";
describe("sanity", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 5: 설치 후 테스트 실행**

Run: `npm install && npm test`
Expected: 1 passed

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "chore: scaffold Vite + TS + Vitest"
```

---

### Task 2: 공유 타입 정의

**Files:**
- Create: `src/types/world.ts`, `src/types/world.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `WorldParams`, `CityMarker`, `Polity`, `World`, `GeneratedWorld`, `DEFAULT_PARAMS`

- [ ] **Step 1: 타입 작성** — `src/types/world.ts`

```ts
export interface WorldParams {
  seed: number;
  width: number;
  height: number;
  cellCount: number;
  seaLevel: number;
  mountainLevel: number;
  polityCount: number;
  townCount: number;
}

export interface CityMarker {
  id: number;
  cell: number;
  x: number;
  y: number;
  name: string;
  polityId: number;
  isCapital: boolean;
  size: number;
  coastal: boolean;
}

export interface Polity {
  id: number;
  capital: number;
  color: string;
  name: string;
}

export interface World {
  params: WorldParams;
  grid: {
    width: number;
    height: number;
    count: number;
    points: number[];
    polygons: number[][][];
    neighbors: number[][];
  };
  heights: number[];
  terrain: number[];
  polityOf: number[];
  polities: Polity[];
  cities: CityMarker[];
}

export interface GeneratedWorld {
  world: World;
  find(x: number, y: number): number;
}

export const DEFAULT_PARAMS: WorldParams = {
  seed: 1,
  width: 1000,
  height: 700,
  cellCount: 4000,
  seaLevel: 0.4,
  mountainLevel: 0.8,
  polityCount: 8,
  townCount: 20,
};
```

- [ ] **Step 2: 타입 형태 테스트 작성** — `src/types/world.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "./world";

describe("DEFAULT_PARAMS", () => {
  it("has sane defaults", () => {
    expect(DEFAULT_PARAMS.cellCount).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.seaLevel).toBeLessThan(DEFAULT_PARAMS.mountainLevel);
  });
});
```

- [ ] **Step 3: 테스트 실행**

Run: `npm test`
Expected: all passed

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: shared world types"
```

---

### Task 3: 시드 PRNG (rng)

**Files:**
- Create: `src/engine/rng.ts`, `src/engine/rng.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `type Rng = () => number`; `mulberry32(seed:number): Rng`; `randInt(rng:Rng,min:number,max:number):number`; `pick<T>(rng:Rng,arr:readonly T[]):T`; `hashStringToSeed(s:string):number`; `deriveSeed(parent:number,id:number):number`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/rng.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32, randInt, pick, hashStringToSeed, deriveSeed } from "./rng";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("randInt stays in range", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = randInt(r, 3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
  it("pick returns an element", () => {
    expect(["x", "y"]).toContain(pick(mulberry32(5), ["x", "y"]));
  });
  it("hashStringToSeed and deriveSeed are deterministic", () => {
    expect(hashStringToSeed("abc")).toBe(hashStringToSeed("abc"));
    expect(deriveSeed(10, 3)).toBe(deriveSeed(10, 3));
    expect(deriveSeed(10, 3)).not.toBe(deriveSeed(10, 4));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- rng`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/rng.ts`

```ts
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deriveSeed(parent: number, id: number): number {
  let h = (parent ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ id, 16777619);
  return h >>> 0;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- rng`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: seeded PRNG and helpers"
```

---

### Task 4: Voronoi 셀 그래프 (grid)

**Files:**
- Create: `src/engine/grid.ts`, `src/engine/grid.test.ts`

**Interfaces:**
- Consumes: `Rng` (from rng)
- Produces: `interface Grid { width:number; height:number; count:number; points:number[]; polygons:number[][][]; neighbors:number[][]; find(x:number,y:number):number }`; `generateGrid(rng:Rng,width:number,height:number,count:number,relaxations?:number):Grid`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/grid.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateGrid } from "./grid";

describe("grid", () => {
  it("produces the requested cell count", () => {
    const g = generateGrid(mulberry32(1), 200, 200, 50, 1);
    expect(g.count).toBe(50);
    expect(g.points.length).toBe(100);
    expect(g.polygons.length).toBe(50);
    expect(g.neighbors.length).toBe(50);
  });
  it("has symmetric adjacency", () => {
    const g = generateGrid(mulberry32(2), 200, 200, 60, 1);
    for (let i = 0; i < g.count; i++) {
      for (const n of g.neighbors[i]) {
        expect(g.neighbors[n]).toContain(i);
      }
    }
  });
  it("find returns nearest cell index", () => {
    const g = generateGrid(mulberry32(3), 200, 200, 40, 1);
    const i = 7;
    const idx = g.find(g.points[i * 2], g.points[i * 2 + 1]);
    expect(idx).toBe(i);
  });
  it("is deterministic", () => {
    const a = generateGrid(mulberry32(9), 200, 200, 30, 2);
    const b = generateGrid(mulberry32(9), 200, 200, 30, 2);
    expect(a.points).toEqual(b.points);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- grid`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/grid.ts`

```ts
import { Delaunay } from "d3-delaunay";
import type { Rng } from "./rng";

export interface Grid {
  width: number;
  height: number;
  count: number;
  points: number[];
  polygons: number[][][];
  neighbors: number[][];
  find(x: number, y: number): number;
}

function buildDelaunay(pts: Float64Array, count: number) {
  const coords: [number, number][] = [];
  for (let i = 0; i < count; i++) coords.push([pts[i * 2], pts[i * 2 + 1]]);
  return Delaunay.from(coords);
}

export function generateGrid(
  rng: Rng,
  width: number,
  height: number,
  count: number,
  relaxations = 2
): Grid {
  const pts = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    pts[i * 2] = rng() * width;
    pts[i * 2 + 1] = rng() * height;
  }
  let delaunay = buildDelaunay(pts, count);
  let voronoi = delaunay.voronoi([0, 0, width, height]);
  for (let r = 0; r < relaxations; r++) {
    for (let i = 0; i < count; i++) {
      const poly = voronoi.cellPolygon(i);
      if (!poly) continue;
      let cx = 0, cy = 0;
      for (const [x, y] of poly) { cx += x; cy += y; }
      pts[i * 2] = cx / poly.length;
      pts[i * 2 + 1] = cy / poly.length;
    }
    delaunay = buildDelaunay(pts, count);
    voronoi = delaunay.voronoi([0, 0, width, height]);
  }
  const polygons: number[][][] = [];
  const neighbors: number[][] = [];
  for (let i = 0; i < count; i++) {
    const poly = voronoi.cellPolygon(i);
    polygons.push(poly ? poly.map(([x, y]) => [x, y]) : []);
    neighbors.push([...voronoi.neighbors(i)]);
  }
  return {
    width,
    height,
    count,
    points: Array.from(pts),
    polygons,
    neighbors,
    find: (x, y) => delaunay.find(x, y),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- grid`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: voronoi grid with lloyd relaxation"
```

---

### Task 5: 높이맵 (heightmap)

**Files:**
- Create: `src/engine/heightmap.ts`, `src/engine/heightmap.test.ts`

**Interfaces:**
- Consumes: `Rng`, `Grid`
- Produces: `assignHeights(rng:Rng, grid:Grid, opts?:{scale?:number;octaves?:number;falloff?:number}): Float32Array` (값 0..1)

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/heightmap.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";

describe("heightmap", () => {
  it("stays within 0..1 and is per-cell", () => {
    const g = generateGrid(mulberry32(1), 300, 300, 200, 1);
    const h = assignHeights(mulberry32(1), g);
    expect(h.length).toBe(g.count);
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("is deterministic", () => {
    const g = generateGrid(mulberry32(2), 300, 300, 200, 1);
    const a = assignHeights(mulberry32(5), g);
    const b = assignHeights(mulberry32(5), g);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it("island shaping makes edges lower than center on average", () => {
    const g = generateGrid(mulberry32(3), 300, 300, 400, 1);
    const h = assignHeights(mulberry32(3), g);
    let centerSum = 0, centerN = 0, edgeSum = 0, edgeN = 0;
    for (let i = 0; i < g.count; i++) {
      const x = g.points[i * 2], y = g.points[i * 2 + 1];
      const d = Math.hypot(x - 150, y - 150);
      if (d < 60) { centerSum += h[i]; centerN++; }
      else if (d > 130) { edgeSum += h[i]; edgeN++; }
    }
    expect(centerSum / centerN).toBeGreaterThan(edgeSum / edgeN);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- heightmap`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/heightmap.ts`

```ts
import { createNoise2D } from "simplex-noise";
import type { Rng } from "./rng";
import type { Grid } from "./grid";

export function assignHeights(
  rng: Rng,
  grid: Grid,
  opts?: { scale?: number; octaves?: number; falloff?: number }
): Float32Array {
  const scale = opts?.scale ?? 2.5;
  const octaves = opts?.octaves ?? 4;
  const falloff = opts?.falloff ?? 0.85;
  const noise = createNoise2D(rng);
  const h = new Float32Array(grid.count);
  const cx = grid.width / 2, cy = grid.height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let i = 0; i < grid.count; i++) {
    const px = grid.points[i * 2], py = grid.points[i * 2 + 1];
    const nx = px / grid.width, ny = py / grid.height;
    let amp = 1, freq = scale, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(nx * freq, ny * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    let v = (sum / norm + 1) / 2;
    const d = Math.hypot(px - cx, py - cy) / maxD;
    v -= d * falloff;
    h[i] = Math.max(0, Math.min(1, v));
  }
  return h;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- heightmap`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: island heightmap from simplex noise"
```

---

### Task 6: 지형 분류 + 대륙 (terrain)

**Files:**
- Create: `src/engine/terrain.ts`, `src/engine/terrain.test.ts`

**Interfaces:**
- Consumes: `Grid`
- Produces: 상수 `OCEAN=0, LAND=1, MOUNTAIN=2`; `classifyTerrain(heights:Float32Array, seaLevel:number, mountainLevel:number): Uint8Array`; `landmasses(grid:Grid, terrain:Uint8Array): Int32Array` (육지 셀의 연결요소 id, 바다는 -1)

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/terrain.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { OCEAN, LAND, MOUNTAIN, classifyTerrain, landmasses } from "./terrain";
import type { Grid } from "./grid";

describe("terrain", () => {
  it("classifies by thresholds", () => {
    const h = new Float32Array([0.1, 0.5, 0.9]);
    const t = classifyTerrain(h, 0.4, 0.8);
    expect(Array.from(t)).toEqual([OCEAN, LAND, MOUNTAIN]);
  });
  it("groups contiguous land into one landmass", () => {
    // 4 cells in a line: land land ocean land
    const grid = {
      count: 4,
      neighbors: [[1], [0, 2], [1, 3], [2]],
    } as unknown as Grid;
    const t = new Uint8Array([LAND, LAND, OCEAN, LAND]);
    const comp = landmasses(grid, t);
    expect(comp[0]).toBe(comp[1]);
    expect(comp[2]).toBe(-1);
    expect(comp[3]).not.toBe(comp[0]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- terrain`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/terrain.ts`

```ts
import type { Grid } from "./grid";

export const OCEAN = 0;
export const LAND = 1;
export const MOUNTAIN = 2;

export function classifyTerrain(
  heights: Float32Array,
  seaLevel: number,
  mountainLevel: number
): Uint8Array {
  const t = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    t[i] = heights[i] < seaLevel ? OCEAN : heights[i] > mountainLevel ? MOUNTAIN : LAND;
  }
  return t;
}

export function landmasses(grid: Grid, terrain: Uint8Array): Int32Array {
  const comp = new Int32Array(terrain.length).fill(-1);
  let id = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === OCEAN || comp[i] !== -1) continue;
    comp[i] = id;
    const stack = [i];
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of grid.neighbors[c]) {
        if (terrain[n] !== OCEAN && comp[n] === -1) {
          comp[n] = id;
          stack.push(n);
        }
      }
    }
    id++;
  }
  return comp;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- terrain`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: terrain classification and landmasses"
```

---

### Task 7: 이름 생성 (names)

**Files:**
- Create: `src/engine/names.ts`, `src/engine/names.test.ts`

**Interfaces:**
- Consumes: `Rng`
- Produces: `interface NameGen { place():string; nation():string }`; `makeNameGen(rng:Rng): NameGen`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/names.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { makeNameGen } from "./names";

describe("names", () => {
  it("produces non-empty capitalized names", () => {
    const g = makeNameGen(mulberry32(1));
    const n = g.place();
    expect(n.length).toBeGreaterThan(1);
    expect(n[0]).toBe(n[0].toUpperCase());
  });
  it("is deterministic", () => {
    const a = makeNameGen(mulberry32(2));
    const b = makeNameGen(mulberry32(2));
    expect([a.place(), a.nation()]).toEqual([b.place(), b.nation()]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- names`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/names.ts`

```ts
import type { Rng } from "./rng";
import { pick } from "./rng";

const ONSET = ["br", "th", "k", "v", "d", "m", "s", "tr", "gl", "r", "n", "f", "l", "st"];
const VOWEL = ["a", "e", "i", "o", "u", "ae", "ia", "ou"];
const CODA = ["n", "r", "th", "l", "s", "m", "nd", "rk", ""];

export interface NameGen {
  place(): string;
  nation(): string;
}

export function makeNameGen(rng: Rng): NameGen {
  const syl = () => pick(rng, ONSET) + pick(rng, VOWEL) + pick(rng, CODA);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    place: () => cap(syl() + (rng() < 0.5 ? syl() : "")),
    nation: () => cap(syl() + syl()),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- names`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: syllable-based name generator"
```

---

### Task 8: 초기 소국 + 플러드필 (polities)

**Files:**
- Create: `src/engine/polities.ts`, `src/engine/polities.test.ts`

**Interfaces:**
- Consumes: `Rng`, `Grid`, terrain 상수
- Produces: `interface PolitySeed { id:number; capital:number; color:string }`; `interface PolityMap { polityOf:Int32Array; seeds:PolitySeed[] }`; `assignPolities(rng:Rng, grid:Grid, terrain:Uint8Array, count:number): PolityMap` (polityOf: 셀→소국id 또는 -1)

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/polities.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { LAND, OCEAN } from "./terrain";
import { assignPolities } from "./polities";
import type { Grid } from "./grid";

function ringGrid(n: number): Grid {
  // n land cells in a connected chain
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ns: number[] = [];
    if (i > 0) ns.push(i - 1);
    if (i < n - 1) ns.push(i + 1);
    neighbors.push(ns);
  }
  return { count: n, neighbors } as unknown as Grid;
}

describe("polities", () => {
  it("claims every connected land cell exactly one polity", () => {
    const grid = ringGrid(20);
    const terrain = new Uint8Array(20).fill(LAND);
    const { polityOf } = assignPolities(mulberry32(1), grid, terrain, 3);
    for (let i = 0; i < 20; i++) {
      expect(polityOf[i]).toBeGreaterThanOrEqual(0);
      expect(polityOf[i]).toBeLessThan(3);
    }
  });
  it("never claims ocean cells", () => {
    const grid = ringGrid(10);
    const terrain = new Uint8Array([LAND, LAND, OCEAN, LAND, LAND, LAND, LAND, OCEAN, LAND, LAND]);
    const { polityOf } = assignPolities(mulberry32(2), grid, terrain, 2);
    expect(polityOf[2]).toBe(-1);
    expect(polityOf[7]).toBe(-1);
  });
  it("places capitals on land and is deterministic", () => {
    const grid = ringGrid(20);
    const terrain = new Uint8Array(20).fill(LAND);
    const a = assignPolities(mulberry32(3), grid, terrain, 3);
    const b = assignPolities(mulberry32(3), grid, terrain, 3);
    expect(Array.from(a.polityOf)).toEqual(Array.from(b.polityOf));
    for (const s of a.seeds) expect(terrain[s.capital]).not.toBe(OCEAN);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- polities`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/polities.ts`

```ts
import type { Rng } from "./rng";
import { randInt } from "./rng";
import type { Grid } from "./grid";
import { OCEAN } from "./terrain";

export interface PolitySeed {
  id: number;
  capital: number;
  color: string;
}

export interface PolityMap {
  polityOf: Int32Array;
  seeds: PolitySeed[];
}

const PALETTE = [
  "#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6",
  "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8",
];

export function assignPolities(
  rng: Rng,
  grid: Grid,
  terrain: Uint8Array,
  count: number
): PolityMap {
  const land: number[] = [];
  for (let i = 0; i < terrain.length; i++) if (terrain[i] !== OCEAN) land.push(i);

  const polityOf = new Int32Array(terrain.length).fill(-1);
  const seeds: PolitySeed[] = [];
  let attempts = 0;
  while (seeds.length < count && land.length > 0 && attempts < count * 50) {
    attempts++;
    const cell = land[randInt(rng, 0, land.length - 1)];
    if (polityOf[cell] !== -1) continue;
    const id = seeds.length;
    polityOf[cell] = id;
    seeds.push({ id, capital: cell, color: PALETTE[id % PALETTE.length] });
  }

  let frontier = seeds.map((s) => s.capital);
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const n of grid.neighbors[c]) {
        if (terrain[n] !== OCEAN && polityOf[n] === -1) {
          polityOf[n] = polityOf[c];
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return { polityOf, seeds };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- polities`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: polity seeding and flood-fill"
```

---

### Task 9: 월드 오케스트레이션 (world)

**Files:**
- Create: `src/engine/world.ts`, `src/engine/world.test.ts`

**Interfaces:**
- Consumes: `WorldParams`, `World`, `GeneratedWorld`, `CityMarker`, `Polity` (types/world); `mulberry32` (rng); `generateGrid`; `assignHeights`; `classifyTerrain`, `OCEAN`; `makeNameGen`; `assignPolities`
- Produces: `generateWorld(params: WorldParams): GeneratedWorld`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/world.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "./world";
import { OCEAN } from "./terrain";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 600, townCount: 8 };

describe("world", () => {
  it("is deterministic for the same params", () => {
    const a = generateWorld(small).world;
    const b = generateWorld(small).world;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("places capitals plus towns and never on ocean", () => {
    const { world } = generateWorld(small);
    const capitals = world.cities.filter((c) => c.isCapital).length;
    expect(capitals).toBe(world.polities.length);
    expect(world.cities.length).toBeGreaterThan(capitals);
    for (const c of world.cities) expect(world.terrain[c.cell]).not.toBe(OCEAN);
  });
  it("assigns every city x/y from its cell point", () => {
    const { world } = generateWorld(small);
    for (const c of world.cities) {
      expect(c.x).toBeCloseTo(world.grid.points[c.cell * 2], 5);
      expect(c.y).toBeCloseTo(world.grid.points[c.cell * 2 + 1], 5);
    }
  });
  it("find locates a city's own cell", () => {
    const { world, find } = generateWorld(small);
    const c = world.cities[0];
    expect(find(c.x, c.y)).toBe(c.cell);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- world`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/world.ts`

```ts
import type { WorldParams, World, GeneratedWorld, CityMarker, Polity } from "../types/world";
import { mulberry32, randInt } from "./rng";
import { generateGrid } from "./grid";
import { assignHeights } from "./heightmap";
import { classifyTerrain, OCEAN } from "./terrain";
import { makeNameGen } from "./names";
import { assignPolities } from "./polities";

export function generateWorld(params: WorldParams): GeneratedWorld {
  const rng = mulberry32(params.seed);
  const grid = generateGrid(rng, params.width, params.height, params.cellCount);
  const heights = assignHeights(rng, grid);
  const terrain = classifyTerrain(heights, params.seaLevel, params.mountainLevel);
  const { polityOf, seeds } = assignPolities(rng, grid, terrain, params.polityCount);
  const names = makeNameGen(rng);

  const isCoastal = (cell: number) =>
    grid.neighbors[cell].some((n) => terrain[n] === OCEAN);

  const polities: Polity[] = seeds.map((s) => ({
    id: s.id,
    capital: s.capital,
    color: s.color,
    name: names.nation(),
  }));

  const cities: CityMarker[] = [];
  let cityId = 0;
  for (const p of polities) {
    cities.push({
      id: cityId++,
      cell: p.capital,
      x: grid.points[p.capital * 2],
      y: grid.points[p.capital * 2 + 1],
      name: names.place(),
      polityId: p.id,
      isCapital: true,
      size: randInt(rng, 3, 6),
      coastal: isCoastal(p.capital),
    });
  }

  const claimedLand: number[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (polityOf[i] >= 0 && i !== polities[polityOf[i]].capital) claimedLand.push(i);
  }
  for (let t = 0; t < params.townCount && claimedLand.length > 0; t++) {
    const cell = claimedLand[randInt(rng, 0, claimedLand.length - 1)];
    cities.push({
      id: cityId++,
      cell,
      x: grid.points[cell * 2],
      y: grid.points[cell * 2 + 1],
      name: names.place(),
      polityId: polityOf[cell],
      isCapital: false,
      size: randInt(rng, 1, 3),
      coastal: isCoastal(cell),
    });
  }

  const world: World = {
    params,
    grid: {
      width: grid.width,
      height: grid.height,
      count: grid.count,
      points: grid.points,
      polygons: grid.polygons,
      neighbors: grid.neighbors,
    },
    heights: Array.from(heights),
    terrain: Array.from(terrain),
    polityOf: Array.from(polityOf),
    polities,
    cities,
  };
  return { world, find: grid.find };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- world`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: world generation orchestration"
```

---

### Task 10: 도시 레이아웃 (city)

**Files:**
- Create: `src/engine/city.ts`, `src/engine/city.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `deriveSeed` (rng); `CityMarker` (types/world)
- Produces: `interface District { x:number; y:number; w:number; h:number; kind:"market"|"residential"|"keep" }`; `interface CityLayout { cityId:number; name:string; wall:[number,number][]; river:[number,number][]|null; districts:District[] }`; `interface CityContext { id:number; name:string; size:number; coastal:boolean; isCapital:boolean }`; `cityContext(c:CityMarker): CityContext`; `generateCityLayout(ctx:CityContext, worldSeed:number): CityLayout`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: false, size: 3, coastal: false,
};

describe("city", () => {
  it("is deterministic for the same world seed and id", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 99)))
      .toBe(JSON.stringify(generateCityLayout(ctx, 99)));
  });
  it("changes with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1)))
      .not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("has a closed wall and districts scaling with size", () => {
    const small = generateCityLayout(cityContext({ ...base, size: 1 }), 5);
    const big = generateCityLayout(cityContext({ ...base, size: 6 }), 5);
    expect(small.wall.length).toBeGreaterThan(2);
    expect(big.districts.length).toBeGreaterThan(small.districts.length);
  });
  it("adds a river only when coastal", () => {
    expect(generateCityLayout(cityContext({ ...base, coastal: false }), 5).river).toBeNull();
    expect(generateCityLayout(cityContext({ ...base, coastal: true }), 5).river).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- city`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city.ts`

```ts
import { mulberry32, deriveSeed } from "./rng";
import type { CityMarker } from "../types/world";

export interface District {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "market" | "residential" | "keep";
}

export interface CityLayout {
  cityId: number;
  name: string;
  wall: [number, number][];
  river: [number, number][] | null;
  districts: District[];
}

export interface CityContext {
  id: number;
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital };
}

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const cx = 150, cy = 150;
  const R = 50 + ctx.size * 8;

  const sides = 10 + (ctx.isCapital ? 4 : 0);
  const wall: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = R * (0.85 + rng() * 0.3);
    wall.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }

  const river: [number, number][] | null = ctx.coastal
    ? [
        [cx - R * 1.5, cy + 25],
        [cx, cy + 8],
        [cx + R * 1.5, cy - 12],
      ]
    : null;

  const districts: District[] = [];
  const blocks = 4 + ctx.size;
  for (let i = 0; i < blocks; i++) {
    const a = rng() * Math.PI * 2;
    const rr = rng() * R * 0.7;
    const w = 14 + rng() * 16;
    const h = 14 + rng() * 16;
    const kind: District["kind"] =
      i === 0 && ctx.isCapital ? "keep" : rng() < 0.3 ? "market" : "residential";
    districts.push({ x: cx + Math.cos(a) * rr - w / 2, y: cy + Math.sin(a) * rr - h / 2, w, h, kind });
  }

  return { cityId: ctx.id, name: ctx.name, wall, river, districts };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- city`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: district-block city layout"
```

---

### Task 11: 렌더러 인터페이스 + SVG 헬퍼

**Files:**
- Create: `src/ui/renderer.ts`, `src/ui/renderer.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `const SVG_NS`; `svgEl(tag:string, attrs?:Record<string,string|number>): SVGElement`; `interface Renderer { renderWorld(world:World): SVGSVGElement; renderCity(layout:CityLayout): SVGSVGElement }` (타입만; 구현은 Task 12)

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/renderer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { svgEl } from "./renderer";

describe("svgEl", () => {
  it("creates namespaced elements with attributes", () => {
    const r = svgEl("rect", { x: 1, y: 2, fill: "#abc" });
    expect(r.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(r.getAttribute("x")).toBe("1");
    expect(r.getAttribute("fill")).toBe("#abc");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- renderer`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/ui/renderer.ts`

```ts
import type { World } from "../types/world";
import type { CityLayout } from "../engine/city";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

export interface Renderer {
  renderWorld(world: World): SVGSVGElement;
  renderCity(layout: CityLayout): SVGSVGElement;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- renderer`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: renderer interface and svg helper"
```

---

### Task 12: SVG 월드 렌더러

**Files:**
- Create: `src/ui/svgWorldRenderer.ts`, `src/ui/svgWorldRenderer.test.ts`

**Interfaces:**
- Consumes: `svgEl`, `SVG_NS` (renderer); `World` (types/world); `MOUNTAIN` (terrain)
- Produces: `renderWorld(world: World): SVGSVGElement` — 세력당 `<path class="region">` 하나(셀 폴리곤 합성), 산 표시, 도시 마커 `<circle data-city="id">` + 라벨

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/svgWorldRenderer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld } from "./svgWorldRenderer";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 600, townCount: 8 };

describe("renderWorld", () => {
  it("creates one region path per polity that owns cells", () => {
    const { world } = generateWorld(small);
    const svg = renderWorld(world);
    const paths = svg.querySelectorAll(".regions path");
    expect(paths.length).toBe(world.polities.length);
  });
  it("renders a marker per city with a data-city id", () => {
    const { world } = generateWorld(small);
    const svg = renderWorld(world);
    expect(svg.querySelectorAll(".markers circle").length).toBe(world.cities.length);
    expect(svg.querySelector(".markers circle")?.getAttribute("data-city")).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- svgWorldRenderer`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/ui/svgWorldRenderer.ts`

```ts
import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { MOUNTAIN } from "../engine/terrain";

function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  return "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

export function renderWorld(world: World): SVGSVGElement {
  const { grid } = world;
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: "world",
  }) as SVGSVGElement;

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: "#a9c7e0" }));

  const byPolity = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const p = world.polityOf[i];
    if (p < 0) continue;
    byPolity.set(p, (byPolity.get(p) ?? "") + cellPath(grid.polygons[i]));
  }
  const regions = svgEl("g", { class: "regions" });
  for (const pol of world.polities) {
    const d = byPolity.get(pol.id);
    if (d) regions.appendChild(svgEl("path", { d, fill: pol.color, stroke: "#5a5a5a", "stroke-width": 0.3 }));
  }
  root.appendChild(regions);

  const mtns = svgEl("g", { class: "mountains" });
  for (let i = 0; i < grid.count; i++) {
    if (world.terrain[i] !== MOUNTAIN) continue;
    const d = cellPath(grid.polygons[i]);
    if (d) mtns.appendChild(svgEl("path", { d, fill: "#9a8d7a", "fill-opacity": 0.6 }));
  }
  root.appendChild(mtns);

  const markers = svgEl("g", { class: "markers" });
  for (const c of world.cities) {
    markers.appendChild(
      svgEl("circle", {
        cx: c.x, cy: c.y, r: c.isCapital ? 4 : 2.5,
        fill: "#222", stroke: "#fff", "stroke-width": 1,
        "data-city": c.id, style: "cursor:pointer",
      })
    );
    const label = svgEl("text", { x: c.x + 5, y: c.y + 3, "font-size": 9, fill: "#222" });
    label.textContent = c.name;
    markers.appendChild(label);
  }
  root.appendChild(markers);

  return root;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- svgWorldRenderer`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: svg world renderer"
```

---

### Task 13: SVG 도시 렌더러

**Files:**
- Create: `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `svgEl` (renderer); `CityLayout`, `generateCityLayout`, `cityContext` (city); `CityMarker` (types/world)
- Produces: `renderCity(layout: CityLayout): SVGSVGElement` — 성벽 `<polygon class="wall">`, 강 `<polyline class="river">`(있으면), 구역 `<rect class="district">`

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/svgCityRenderer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: true,
};

describe("renderCity", () => {
  it("draws wall, river, and districts", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".wall").length).toBe(1);
    expect(svg.querySelectorAll(".river").length).toBe(1);
    expect(svg.querySelectorAll(".district").length).toBe(layout.districts.length);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- svgCityRenderer`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/ui/svgCityRenderer.ts`

```ts
import type { CityLayout } from "../engine/city";
import { svgEl } from "./renderer";

const FILL: Record<string, string> = {
  keep: "#b9a07a",
  market: "#d8b86a",
  residential: "#cdbb96",
};

export function renderCity(layout: CityLayout): SVGSVGElement {
  const root = svgEl("svg", { width: "100%", viewBox: "0 0 300 300", class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: 300, height: 300, fill: "#efe7d2" }));

  if (layout.river) {
    root.appendChild(
      svgEl("polyline", {
        class: "river",
        points: layout.river.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
        fill: "none", stroke: "#7d9bb0", "stroke-width": 6, "stroke-linecap": "round",
      })
    );
  }

  root.appendChild(
    svgEl("polygon", {
      class: "wall",
      points: layout.wall.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      fill: "#f5efdd", stroke: "#6b4f2a", "stroke-width": 3,
    })
  );

  for (const d of layout.districts) {
    root.appendChild(
      svgEl("rect", {
        class: "district",
        x: d.x.toFixed(1), y: d.y.toFixed(1), width: d.w.toFixed(1), height: d.h.toFixed(1),
        fill: FILL[d.kind], stroke: "#6b4f2a", "stroke-width": 0.8,
      })
    );
  }

  const label = svgEl("text", { x: 150, y: 20, "font-size": 14, fill: "#3a2a14", "text-anchor": "middle" });
  label.textContent = layout.name;
  root.appendChild(label);

  return root;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- svgCityRenderer`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: svg city renderer"
```

---

### Task 14: 내보내기 + URL 상태

**Files:**
- Create: `src/ui/export.ts`, `src/ui/urlState.ts`, `src/ui/export.test.ts`, `src/ui/urlState.test.ts`

**Interfaces:**
- Consumes: `World`, `WorldParams`, `DEFAULT_PARAMS` (types/world)
- Produces:
  - export: `worldToJSON(world:World):string`; `svgToString(svg:SVGSVGElement):string`; `downloadBlob(name:string, blob:Blob):void`; `svgToPngBlob(svg:SVGSVGElement, width:number, height:number): Promise<Blob>`
  - urlState: `encodeParams(p:WorldParams):string`; `decodeParams(hash:string):WorldParams` (잘못된 입력이면 `DEFAULT_PARAMS` 반환)

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/urlState.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { encodeParams, decodeParams } from "./urlState";

describe("urlState", () => {
  it("round-trips params", () => {
    const p = { ...DEFAULT_PARAMS, seed: 1234, polityCount: 5 };
    expect(decodeParams(encodeParams(p))).toEqual(p);
  });
  it("falls back to defaults on garbage", () => {
    expect(decodeParams("#not-valid")).toEqual(DEFAULT_PARAMS);
    expect(decodeParams("")).toEqual(DEFAULT_PARAMS);
  });
});
```

- [ ] **Step 2: export 테스트 작성** — `src/ui/export.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { worldToJSON } from "./export";

describe("export", () => {
  it("serializes a world to parseable JSON", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, cellCount: 200, width: 200, height: 200 });
    const parsed = JSON.parse(worldToJSON(world));
    expect(parsed.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(parsed.cities.length).toBe(world.cities.length);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- urlState export`
Expected: FAIL

- [ ] **Step 4: 구현** — `src/ui/urlState.ts`

```ts
import type { WorldParams } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";

const KEYS: (keyof WorldParams)[] = [
  "seed", "width", "height", "cellCount", "seaLevel", "mountainLevel", "polityCount", "townCount",
];

export function encodeParams(p: WorldParams): string {
  return "#" + btoa(JSON.stringify(p));
}

export function decodeParams(hash: string): WorldParams {
  try {
    const json = JSON.parse(atob(hash.replace(/^#/, "")));
    const out = { ...DEFAULT_PARAMS };
    for (const k of KEYS) {
      if (typeof json[k] === "number" && Number.isFinite(json[k])) {
        (out[k] as number) = json[k];
      } else {
        return DEFAULT_PARAMS;
      }
    }
    return out;
  } catch {
    return DEFAULT_PARAMS;
  }
}
```

- [ ] **Step 5: 구현** — `src/ui/export.ts`

```ts
import type { World } from "../types/world";

export function worldToJSON(world: World): string {
  return JSON.stringify(world);
}

export function svgToString(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function svgToPngBlob(svg: SVGSVGElement, width: number, height: number): Promise<Blob> {
  const data = svgToString(svg);
  const svgBlob = new Blob([data], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("svg image load failed"));
    img.src = url;
  });
}
```

- [ ] **Step 6: 통과 확인**

Run: `npm test -- urlState export`
Expected: PASS (참고: `svgToPngBlob`은 jsdom의 canvas 미지원으로 단위 테스트 생략, 앱에서 수동 확인)

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: json/svg/png export and url state"
```

---

### Task 15: 앱 배선 (컨트롤·뷰 전환·클릭)

**Files:**
- Create: `src/ui/app.ts`, `src/ui/app.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `generateWorld` (world); `renderWorld` (svgWorldRenderer); `renderCity` (svgCityRenderer); `generateCityLayout`, `cityContext` (city); `encodeParams`, `decodeParams` (urlState); `worldToJSON`, `svgToString`, `svgToPngBlob`, `downloadBlob` (export); `WorldParams`, `DEFAULT_PARAMS` (types/world)
- Produces: `createApp(root: HTMLElement, initial?: WorldParams): { regenerate(p:WorldParams):void; openCity(cityId:number):void; showWorld():void }`

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/app.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { createApp } from "./app";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

describe("createApp", () => {
  it("renders a world svg on init", () => {
    const root = document.createElement("div");
    createApp(root, small);
    expect(root.querySelector("svg.world")).not.toBeNull();
  });
  it("opens a city view when a marker is clicked", () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    expect(root.querySelector("svg.city")).not.toBeNull();
  });
  it("returns to the world view", () => {
    const root = document.createElement("div");
    const app = createApp(root, small);
    app.openCity(0);
    app.showWorld();
    expect(root.querySelector("svg.world")).not.toBeNull();
    expect(root.querySelector("svg.city")).toBeNull();
  });
  it("clicking a marker circle opens that city", () => {
    const root = document.createElement("div");
    createApp(root, small);
    const circle = root.querySelector(".markers circle") as SVGElement;
    circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("svg.city")).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- app`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/ui/app.ts`

```ts
import type { WorldParams, GeneratedWorld } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateWorld } from "../engine/world";
import { renderWorld } from "./svgWorldRenderer";
import { renderCity } from "./svgCityRenderer";
import { generateCityLayout, cityContext } from "../engine/city";
import { encodeParams } from "./urlState";
import { worldToJSON, svgToString, svgToPngBlob, downloadBlob } from "./export";

export interface App {
  regenerate(p: WorldParams): void;
  openCity(cityId: number): void;
  showWorld(): void;
}

export function createApp(root: HTMLElement, initial: WorldParams = DEFAULT_PARAMS): App {
  root.innerHTML = "";

  const controls = document.createElement("div");
  controls.className = "controls";
  const stage = document.createElement("div");
  stage.className = "stage";
  root.append(controls, stage);

  let params: WorldParams = { ...initial };
  let generated: GeneratedWorld = generateWorld(params);

  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(params.seed);
  const regenBtn = document.createElement("button");
  regenBtn.textContent = "Generate";
  const jsonBtn = document.createElement("button");
  jsonBtn.textContent = "Export JSON";
  const pngBtn = document.createElement("button");
  pngBtn.textContent = "Export PNG";
  controls.append(seedInput, regenBtn, jsonBtn, pngBtn);

  function showWorld(): void {
    stage.innerHTML = "";
    const svg = renderWorld(generated.world);
    svg.addEventListener("click", (e) => {
      const target = e.target as Element;
      const id = target.getAttribute?.("data-city");
      if (id !== null && id !== undefined) openCity(Number(id));
    });
    stage.appendChild(svg);
    location.hash = encodeParams(params).slice(1);
  }

  function openCity(cityId: number): void {
    const marker = generated.world.cities.find((c) => c.id === cityId);
    if (!marker) return;
    stage.innerHTML = "";
    const back = document.createElement("button");
    back.textContent = "Back to world";
    back.addEventListener("click", showWorld);
    const layout = generateCityLayout(cityContext(marker), params.seed);
    stage.append(back, renderCity(layout));
  }

  function regenerate(p: WorldParams): void {
    params = { ...p };
    generated = generateWorld(params);
    showWorld();
  }

  regenBtn.addEventListener("click", () => regenerate({ ...params, seed: Number(seedInput.value) }));
  jsonBtn.addEventListener("click", () =>
    downloadBlob("world.json", new Blob([worldToJSON(generated.world)], { type: "application/json" }))
  );
  pngBtn.addEventListener("click", async () => {
    const svg = renderWorld(generated.world);
    const blob = await svgToPngBlob(svg, params.width, params.height);
    downloadBlob("world.png", blob);
  });

  void svgToString;
  showWorld();
  return { regenerate, openCity, showWorld };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- app`
Expected: PASS

- [ ] **Step 5: main.ts 배선** — `src/main.ts`

```ts
import { createApp } from "./ui/app";
import { decodeParams } from "./ui/urlState";

const root = document.getElementById("app");
if (root) createApp(root, decodeParams(location.hash));
```

- [ ] **Step 6: 빌드·전체 테스트 확인**

Run: `npm run build && npm test`
Expected: 빌드 성공, 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: app shell with view switching and export"
```

---

### Task 16: 수동 검증 + 마감

**Files:**
- Modify: `index.html` (간단한 레이아웃 스타일 추가)

**Interfaces:**
- Consumes: 전체 앱
- Produces: 수동 검증 통과한 동작 앱

- [ ] **Step 1: 최소 스타일 추가** — `index.html`의 `<head>`에 추가

```html
<style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  .controls { display: flex; gap: 8px; padding: 8px; align-items: center; }
  .stage svg { display: block; width: 100%; height: auto; }
  button, input { padding: 4px 8px; }
</style>
```

- [ ] **Step 2: 개발 서버로 수동 검증**

Run: `npm run dev`
브라우저에서 확인:
- 지도가 그려진다(바다/육지/세력 색면/도시 점).
- 시드 값을 바꾸고 Generate → 지형·판도가 완전히 바뀐다.
- 같은 시드로 다시 Generate → 동일한 지도.
- 도시 점을 클릭 → 도시맵(성벽·구역, 해안 도시면 강)으로 전환된다.
- Back to world → 월드 복귀.
- Export JSON / Export PNG → 파일 다운로드.
- URL 해시가 갱신되고, 그 URL을 새로 열면 같은 세계가 뜬다.

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "chore: minimal app styling and manual verification"
```

---

## Self-Review

**Spec coverage:**
- 엔진/UI 분리 → Task 3–10(엔진), 11–15(UI). ✅
- SVG 우선 + Renderer 인터페이스 → Task 11(인터페이스), 12–13(SVG 구현). ✅
- Voronoi+Lloyd → Task 4. 높이맵 → Task 5. 바다/육지/산 → Task 6. 정치 세력 색면 → Task 8, 12. 수도★/도시● + 이름 → Task 7, 9, 12. ✅
- 도시 드릴다운(맥락 파생, 구역 블록) → Task 10, 13, 15. ✅
- 결정성(시드/파생시드) → Task 3, 9, 10 테스트. ✅
- 시드 입력·재생성 → Task 15. PNG/SVG/JSON 내보내기 → Task 14. URL 공유/리믹스 → Task 14, 15. ✅
- 테스트 전략(결정성 해시, 불변식, 렌더러 스모크) → 각 Task의 테스트. ✅
- Phase 2(역사 시뮬·타임라인) → 의도적으로 별도 계획으로 분리. 본 계획 범위 밖. ✅

**Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함. ✅

**Type consistency:** `Grid`, `World`, `GeneratedWorld`, `CityLayout`, `CityContext`, `Renderer`, `PolityMap` 등의 시그니처가 정의 Task와 소비 Task 간 일치. 렌더러는 `svgEl`/`SVG_NS`를 Task 11에서 정의하고 12–13에서 소비. `find`는 Task 9에서 `GeneratedWorld.find`로 제공되어 Task 15에서 사용. ✅

**Note:** `svgToPngBlob`는 jsdom canvas 미지원으로 단위 테스트 대신 Task 16 수동 검증으로 커버(계획에 명시).
