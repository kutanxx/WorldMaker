# 도시맵 고급화 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2 중세 도시를 유지하면서, 지형 기반 도시 원형(archetype) + 텐서필드 유기적 거리망 + 물 다양화(바다·강·호수·곡류 + 다리) + 밝은 깔끔 렌더를 더해 "성벽 안의 우아한 중세 거리 도시"를 만든다(Phase 1: 거리·물·리스타일, 건물은 기존 구역 분할 유지하되 거리 겹침 제거).

**Architecture:** 월드 맥락(해안·고도·규모·시드)으로 `archetype`을 고르고, 그것이 텐서필드 편향·물 종류·성벽 형태·구역 배치를 결정한다. 텐서필드(`tensorField`)를 RK4 스트림라인(`streets`)으로 추적해 2단계(간선·이면) 도로망을 만들고, `water`가 바다/강/호수/곡류를 생성한다. `city.ts`가 이를 v2 모듈(wards/zoning/walls/buildings/geometry)과 묶어 새 `CityLayout`을 만들고, `svgCityRenderer`가 밝은 테마로 그린다.

**Tech Stack:** TypeScript(strict), Vitest(+jsdom), 기존 `d3-delaunay`·`simplex-noise`. 신규 런타임 의존성 없음.

## Global Constraints

- TypeScript `strict: true`. 신규 런타임 의존성 추가 금지(`d3-delaunay`, `simplex-noise`만).
- 모든 무작위성은 `src/engine/rng.ts` 시드 PRNG만(`Math.random()` 금지). 도시 상세는 `deriveSeed(worldSeed, cityId)` 파생, 결정적.
- 엔진(`src/engine/**`)은 DOM 비의존. 렌더는 `src/ui/**`.
- 공개 시그니처 유지: `cityContext(marker): CityContext`, `generateCityLayout(ctx, worldSeed): CityLayout`, `renderCity(layout): SVGSVGElement`. `src/ui/app.ts` 변경 금지.
- 도시 캔버스 `bounds.w = bounds.h = 300`(viewBox 0 0 300 300), 중심 (150,150).
- 밝은 테마: 바탕 `#f3efe4`(크림), 물 `#9fc1d6`/얕은물 `#bfd8e4`, 공원 `#cfe0b8`, 간선도로 `#6b5b45`, 이면도로 `#b8a98f`, 건물 `#e6dcc8`(테두리 `#9a8a70`).

---

## File Structure

```
src/types/world.ts            CityMarker.elevation 추가
src/engine/world.ts           city.elevation = heights[cell] 채움 (수정)
src/engine/city/archetypes.ts 원형 데이터 + selectArchetype (신규)
src/engine/city/tensorField.ts 텐서필드 (신규)
src/engine/city/streets.ts    RK4 스트림라인 도로망 (신규)
src/engine/city/water.ts      재작성: 바다/강/호수/곡류 + 다리
src/engine/city.ts            재작성: 원형 주도 오케스트레이션 → CityLayout v3
src/ui/svgCityRenderer.ts     재작성: 밝은 테마
```

재사용(변경 없음): `geometry.ts`, `city/wards.ts`, `city/zoning.ts`, `city/walls.ts`, `city/buildings.ts`, `rng.ts`.

---

### Task 1: CityMarker.elevation 추가

**Files:**
- Modify: `src/types/world.ts`
- Modify: `src/engine/world.ts`
- Modify: `src/engine/world.test.ts`

**Interfaces:**
- Consumes: 기존 `World`, `heights`, `cities`
- Produces: `CityMarker.elevation: number`(0..1); `world.ts`가 각 도시 `elevation = heights[cell]`로 채움

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/world.test.ts`의 `describe("world", ...)`에 추가

```ts
it("gives each city the elevation of its cell", () => {
  const { world } = generateWorld(small);
  for (const c of world.cities) {
    expect(c.elevation).toBeCloseTo(world.heights[c.cell], 5);
    expect(c.elevation).toBeGreaterThanOrEqual(0);
    expect(c.elevation).toBeLessThanOrEqual(1);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- world`
Expected: FAIL (`elevation` 없음)

- [ ] **Step 3: 타입에 필드 추가** — `src/types/world.ts`의 `CityMarker`에 `elevation` 추가

`CityMarker` 인터페이스에서 `coastal: boolean;` 다음 줄에 추가:
```ts
  elevation: number;
```

- [ ] **Step 4: world.ts에서 채우기** — `src/engine/world.ts`

수도 마커와 타운 마커를 `cities.push({...})` 하는 두 곳 모두에서 `coastal: isCoastal(...)` 다음에 한 줄 추가한다. 수도 쪽:
```ts
      coastal: isCoastal(p.capital),
      elevation: heights[p.capital],
```
타운 쪽:
```ts
      coastal: isCoastal(cell),
      elevation: heights[cell],
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- world` 그리고 `npm run build`
Expected: PASS, 빌드 클린

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: add elevation to city markers"
```

---

### Task 2: 도시 원형 (city/archetypes)

**Files:**
- Create: `src/engine/city/archetypes.ts`, `src/engine/city/archetypes.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng)
- Produces: `type ArchetypeId = "coastalPort"|"bridgeTown"|"hilltopFortress"|"meanderDefense"|"plainsMarket"|"ridgeLinear"`; `type StreetField = "radial"|"grid"|"linear"|"organic"`; `type WaterKind = "sea"|"river"|"lake"|"meander"|"none"`; `type WallShape = "hull"|"rect"|"contour"|"riverbank"`; `interface Archetype { id:ArchetypeId; streetField:StreetField; wallShape:WallShape; water:WaterKind }`; `selectArchetype(opts:{coastal:boolean; elevation:number; size:number}, rng:Rng): Archetype`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/archetypes.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { selectArchetype } from "./archetypes";

describe("archetypes", () => {
  it("picks coastalPort for a coastal low city", () => {
    const a = selectArchetype({ coastal: true, elevation: 0.35, size: 4 }, mulberry32(1));
    expect(a.id).toBe("coastalPort");
    expect(a.water).toBe("sea");
  });
  it("picks hilltopFortress for a high inland city", () => {
    const a = selectArchetype({ coastal: false, elevation: 0.78, size: 4 }, mulberry32(1));
    expect(a.id).toBe("hilltopFortress");
    expect(a.wallShape).toBe("contour");
  });
  it("is deterministic", () => {
    const o = { coastal: false, elevation: 0.5, size: 3 };
    expect(selectArchetype(o, mulberry32(9))).toEqual(selectArchetype(o, mulberry32(9)));
  });
  it("inland mid cities vary by seed across river/plains/ridge types", () => {
    const ids = new Set<string>();
    for (let s = 0; s < 30; s++) {
      ids.add(selectArchetype({ coastal: false, elevation: 0.5, size: 3 }, mulberry32(s)).id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- archetypes`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/archetypes.ts`

```ts
import type { Rng } from "../rng";
import { pick } from "../rng";

export type ArchetypeId =
  | "coastalPort" | "bridgeTown" | "hilltopFortress"
  | "meanderDefense" | "plainsMarket" | "ridgeLinear";
export type StreetField = "radial" | "grid" | "linear" | "organic";
export type WaterKind = "sea" | "river" | "lake" | "meander" | "none";
export type WallShape = "hull" | "rect" | "contour" | "riverbank";

export interface Archetype {
  id: ArchetypeId;
  streetField: StreetField;
  wallShape: WallShape;
  water: WaterKind;
}

const TABLE: Record<ArchetypeId, Archetype> = {
  coastalPort: { id: "coastalPort", streetField: "organic", wallShape: "hull", water: "sea" },
  bridgeTown: { id: "bridgeTown", streetField: "linear", wallShape: "riverbank", water: "river" },
  hilltopFortress: { id: "hilltopFortress", streetField: "radial", wallShape: "contour", water: "none" },
  meanderDefense: { id: "meanderDefense", streetField: "organic", wallShape: "riverbank", water: "meander" },
  plainsMarket: { id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "lake" },
  ridgeLinear: { id: "ridgeLinear", streetField: "linear", wallShape: "rect", water: "none" },
};

const INLAND: ArchetypeId[] = ["bridgeTown", "meanderDefense", "plainsMarket", "ridgeLinear"];

export function selectArchetype(
  opts: { coastal: boolean; elevation: number; size: number },
  rng: Rng
): Archetype {
  if (opts.coastal) return TABLE.coastalPort;
  if (opts.elevation >= 0.7) return TABLE.hilltopFortress;
  return TABLE[pick(rng, INLAND)];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- archetypes`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/archetypes.ts src/engine/city/archetypes.test.ts
git commit -m "feat: terrain-driven city archetypes"
```

---

### Task 3: 텐서 필드 (city/tensorField)

**Files:**
- Create: `src/engine/city/tensorField.ts`, `src/engine/city/tensorField.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `createNoise2D` (simplex-noise)
- Produces: `type Vec = [number, number]`; `interface BasisField { kind:"grid"|"radial"; center:Vec; size:number; decay:number; theta:number }`; `interface TensorField { sample(p:Vec):{a:number;b:number}; major(p:Vec):Vec; minor(p:Vec):Vec }`; `makeTensorField(rng:Rng, fields:BasisField[], noiseAmp?:number):TensorField`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/tensorField.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeTensorField } from "./tensorField";
import type { BasisField, Vec } from "./tensorField";

const grid: BasisField[] = [{ kind: "grid", center: [150, 150], size: 400, decay: 1, theta: 0 }];

describe("tensorField", () => {
  it("a grid field at theta=0 yields a near-horizontal major direction", () => {
    const tf = makeTensorField(mulberry32(1), grid, 0);
    const m = tf.major([150, 150]);
    expect(Math.abs(m[1])).toBeLessThan(0.2);
    expect(Math.abs(m[0])).toBeGreaterThan(0.8);
  });
  it("minor is perpendicular to major", () => {
    const tf = makeTensorField(mulberry32(1), grid, 0);
    const m = tf.major([120, 140]);
    const n = tf.minor([120, 140]);
    expect(Math.abs(m[0] * n[0] + m[1] * n[1])).toBeLessThan(1e-6);
  });
  it("direction is continuous between nearby points", () => {
    const tf = makeTensorField(mulberry32(2), [{ kind: "radial", center: [150, 150], size: 200, decay: 1, theta: 0 }], 0);
    const m1 = tf.major([100, 150]);
    const m2 = tf.major([103, 150]);
    expect(Math.abs(m1[0] * m2[0] + m1[1] * m2[1])).toBeGreaterThan(0.9);
  });
  it("is deterministic", () => {
    const a = makeTensorField(mulberry32(5), grid).major([130, 160]);
    const b = makeTensorField(mulberry32(5), grid).major([130, 160]);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- tensorField`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/tensorField.ts`

```ts
import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";

export type Vec = [number, number];

export interface BasisField {
  kind: "grid" | "radial";
  center: Vec;
  size: number;
  decay: number;
  theta: number;
}

export interface TensorField {
  sample(p: Vec): { a: number; b: number };
  major(p: Vec): Vec;
  minor(p: Vec): Vec;
}

function decayWeight(p: Vec, c: Vec, size: number): number {
  const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  return Math.exp(-(d * d) / (2 * size * size));
}

export function makeTensorField(rng: Rng, fields: BasisField[], noiseAmp = 0.15): TensorField {
  const noise = createNoise2D(rng);
  const sample = (p: Vec) => {
    let a = 0, b = 0;
    for (const f of fields) {
      const w = decayWeight(p, f.center, f.size) * f.decay;
      let ta: number, tb: number;
      if (f.kind === "grid") {
        ta = Math.cos(2 * f.theta);
        tb = Math.sin(2 * f.theta);
      } else {
        const x = p[0] - f.center[0], y = p[1] - f.center[1];
        const m = Math.hypot(x, y) || 1;
        ta = (y * y - x * x) / (m * m);
        tb = (-2 * x * y) / (m * m);
      }
      a += ta * w;
      b += tb * w;
    }
    let ang = 0.5 * Math.atan2(b, a) + noise(p[0] * 0.01, p[1] * 0.01) * noiseAmp;
    const r = Math.hypot(a, b) || 1;
    return { a: r * Math.cos(2 * ang), b: r * Math.sin(2 * ang) };
  };
  return {
    sample,
    major(p) {
      const t = sample(p);
      const ang = 0.5 * Math.atan2(t.b, t.a);
      return [Math.cos(ang), Math.sin(ang)];
    },
    minor(p) {
      const m = this.major(p);
      return [-m[1], m[0]];
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- tensorField`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/tensorField.ts src/engine/city/tensorField.test.ts
git commit -m "feat: tensor field for street directions"
```

---

### Task 4: 스트림라인 도로망 (city/streets)

**Files:**
- Create: `src/engine/city/streets.ts`, `src/engine/city/streets.test.ts`

**Interfaces:**
- Consumes: `Vec`, `TensorField` (tensorField); `Polyline` (geometry)
- Produces: `interface StreetOpts { dsep:number; dtest:number; step:number; maxLength:number; bounds:{w:number;h:number}; useMinor:boolean }`; `generateStreets(field:TensorField, opts:StreetOpts, stop:(p:Vec)=>boolean, seeds:Vec[]):Polyline[]`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/streets.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeTensorField } from "./tensorField";
import type { BasisField, Vec } from "./tensorField";
import { generateStreets } from "./streets";

const field = () =>
  makeTensorField(mulberry32(1), [{ kind: "radial", center: [150, 150], size: 200, decay: 1, theta: 0 }], 0.1);
const opts = (dsep: number, useMinor: boolean) => ({
  dsep, dtest: dsep * 0.5, step: 3, maxLength: 200, bounds: { w: 300, h: 300 }, useMinor,
});
const noStop = () => false;

describe("streets", () => {
  it("produces multiple streamlines within bounds", () => {
    const roads = generateStreets(field(), opts(40, false), noStop, [[150, 150]]);
    expect(roads.length).toBeGreaterThan(2);
    for (const r of roads) for (const p of r) {
      expect(p[0]).toBeGreaterThanOrEqual(-1);
      expect(p[0]).toBeLessThanOrEqual(301);
    }
  });
  it("smaller dsep yields a denser network (more streets)", () => {
    const sparse = generateStreets(field(), opts(60, false), noStop, [[150, 150]]);
    const dense = generateStreets(field(), opts(25, true), noStop, [[150, 150]]);
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
  it("stops streamlines inside the stop region (e.g. water)", () => {
    const inWater = (p: Vec) => p[0] > 220;
    const roads = generateStreets(field(), opts(30, false), inWater, [[150, 150]]);
    for (const r of roads) for (const p of r) expect(p[0]).toBeLessThanOrEqual(221);
  });
  it("is deterministic", () => {
    const a = generateStreets(field(), opts(40, false), noStop, [[150, 150]]);
    const b = generateStreets(field(), opts(40, false), noStop, [[150, 150]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- streets`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/streets.ts`

```ts
import type { Vec, TensorField } from "./tensorField";
import type { Polyline } from "../geometry";

export interface StreetOpts {
  dsep: number;
  dtest: number;
  step: number;
  maxLength: number;
  bounds: { w: number; h: number };
  useMinor: boolean;
}

class SpatialIndex {
  private cell: number;
  private map = new Map<string, Vec[]>();
  constructor(cell: number) { this.cell = cell; }
  private key(x: number, y: number) { return Math.floor(x / this.cell) + "," + Math.floor(y / this.cell); }
  add(p: Vec) {
    const k = this.key(p[0], p[1]);
    const a = this.map.get(k);
    if (a) a.push(p); else this.map.set(k, [p]);
  }
  near(p: Vec, d: number): boolean {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const a = this.map.get((cx + dx) + "," + (cy + dy));
      if (!a) continue;
      for (const q of a) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < d) return true;
    }
    return false;
  }
}

function rk4(field: TensorField, p: Vec, useMinor: boolean, step: number, prev: Vec | null): Vec {
  const dir = (q: Vec): Vec => {
    let v = useMinor ? field.minor(q) : field.major(q);
    if (prev && v[0] * prev[0] + v[1] * prev[1] < 0) v = [-v[0], -v[1]];
    return v;
  };
  const k1 = dir(p);
  const k2 = dir([p[0] + (k1[0] * step) / 2, p[1] + (k1[1] * step) / 2]);
  const k3 = dir([p[0] + (k2[0] * step) / 2, p[1] + (k2[1] * step) / 2]);
  const k4 = dir([p[0] + k3[0] * step, p[1] + k3[1] * step]);
  const vx = (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
  const vy = (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
  const m = Math.hypot(vx, vy) || 1;
  return [vx / m, vy / m];
}

function traceDir(
  field: TensorField, start: Vec, opts: StreetOpts, stop: (p: Vec) => boolean,
  index: SpatialIndex, sign: number
): Vec[] {
  const pts: Vec[] = [];
  let p: Vec = [start[0], start[1]];
  let prev: Vec | null = null;
  for (let i = 0; i < opts.maxLength; i++) {
    if (p[0] < 0 || p[1] < 0 || p[0] > opts.bounds.w || p[1] > opts.bounds.h) break;
    if (stop(p)) break;
    if (pts.length > 2 && index.near(p, opts.dtest)) break;
    pts.push([p[0], p[1]]);
    let d = rk4(field, p, opts.useMinor, opts.step, prev);
    d = [d[0] * sign, d[1] * sign];
    prev = d;
    p = [p[0] + d[0] * opts.step, p[1] + d[1] * opts.step];
  }
  return pts;
}

function traceStreamline(
  field: TensorField, seed: Vec, opts: StreetOpts, stop: (p: Vec) => boolean, index: SpatialIndex
): Polyline {
  const fwd = traceDir(field, seed, opts, stop, index, 1);
  const bwd = traceDir(field, seed, opts, stop, index, -1);
  bwd.reverse();
  return bwd.slice(0, -1).concat(fwd);
}

export function generateStreets(
  field: TensorField, opts: StreetOpts, stop: (p: Vec) => boolean, seeds: Vec[]
): Polyline[] {
  const index = new SpatialIndex(opts.dsep);
  const streets: Polyline[] = [];
  const queue: Vec[] = seeds.map((s) => [s[0], s[1]] as Vec);
  let guard = 0;
  const seedStride = Math.max(1, Math.round(opts.dsep / opts.step));
  while (queue.length > 0 && guard < 4000) {
    guard++;
    const seed = queue.shift()!;
    if (seed[0] < 0 || seed[1] < 0 || seed[0] > opts.bounds.w || seed[1] > opts.bounds.h) continue;
    if (stop(seed) || index.near(seed, opts.dsep)) continue;
    const line = traceStreamline(field, seed, opts, stop, index);
    if (line.length < 3) continue;
    for (const p of line) index.add(p);
    streets.push(line);
    for (let i = 0; i < line.length; i += seedStride) {
      const p = line[i];
      const perp = opts.useMinor ? field.major(p) : field.minor(p);
      queue.push([p[0] + perp[0] * opts.dsep, p[1] + perp[1] * opts.dsep]);
      queue.push([p[0] - perp[0] * opts.dsep, p[1] - perp[1] * opts.dsep]);
    }
  }
  return streets;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- streets`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/streets.ts src/engine/city/streets.test.ts
git commit -m "feat: evenly-spaced streamline street network"
```

---

### Task 5: 물 재작성 — 바다·강·호수·곡류 (city/water)

**Files:**
- Modify (replace contents): `src/engine/city/water.ts`
- Modify (replace contents): `src/engine/city/water.test.ts`

**Interfaces:**
- Consumes: `Rng`, `randInt` (rng); `Point`, `Polygon`, `Polyline`, `pointInPolygon` (geometry); `WaterKind` (archetypes)
- Produces: `interface Water { kind:WaterKind; bodies:Polygon[]; bridges:[Point,Point][] }`; `buildWater(rng:Rng, kind:WaterKind, bounds:{w:number;h:number}):Water`; `inWater(water:Water, p:Point):boolean`; `waterBridges(roads:Polyline[], water:Water):[Point,Point][]`
- 참고: v2의 `buildWater(rng, bounds)`/`waterBridges(roads, polygon)`를 이 시그니처로 교체한다. `Water.bodies`는 폴리곤 배열(바다 1개, 강은 굵은 폴리곤, 호수 1개, 곡류는 강이 도시를 감싸는 폴리곤).

- [ ] **Step 1: 실패 테스트 작성 (전체 교체)** — `src/engine/city/water.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, pointInPolygon } from "../geometry";
import type { Polyline } from "../geometry";
import { buildWater, inWater, waterBridges } from "./water";

const B = { w: 300, h: 300 };

describe("water", () => {
  it("sea produces a band on one side", () => {
    const w = buildWater(mulberry32(1), "sea", B);
    expect(w.kind).toBe("sea");
    expect(w.bodies.length).toBe(1);
    expect(area(w.bodies[0])).toBeGreaterThan(0);
  });
  it("river crosses the map (spans top to bottom or side to side)", () => {
    const w = buildWater(mulberry32(2), "river", B);
    const poly = w.bodies[0];
    const ys = poly.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(150);
  });
  it("lake is an enclosed inland body not touching the border", () => {
    const w = buildWater(mulberry32(3), "lake", B);
    const xs = w.bodies[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(300);
  });
  it("none produces no bodies", () => {
    expect(buildWater(mulberry32(1), "none", B).bodies.length).toBe(0);
  });
  it("inWater is true inside a body and false at the centre for a side sea", () => {
    const w = buildWater(mulberry32(1), "sea", B);
    const inside = w.bodies[0][0];
    expect(inWater(w, inside)).toBe(true);
  });
  it("waterBridges marks a bridge where a road crosses a river", () => {
    const w = buildWater(mulberry32(2), "river", B);
    const road: Polyline = [[0, 150], [300, 150]];
    expect(waterBridges([road], w).length).toBeGreaterThanOrEqual(1);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildWater(mulberry32(7), "meander", B)))
      .toBe(JSON.stringify(buildWater(mulberry32(7), "meander", B)));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- "city/water"`
Expected: FAIL

- [ ] **Step 3: 구현 (전체 교체)** — `src/engine/city/water.ts`

```ts
import type { Rng } from "../rng";
import { randInt } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon } from "../geometry";
import type { WaterKind } from "./archetypes";

export interface Water {
  kind: WaterKind;
  bodies: Polygon[];
  bridges: [Point, Point][];
}

function ribbon(center: Polyline, halfWidth: number): Polygon {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(center.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m, ny = dx / m;
    left.push([center[i][0] + nx * halfWidth, center[i][1] + ny * halfWidth]);
    right.push([center[i][0] - nx * halfWidth, center[i][1] - ny * halfWidth]);
  }
  return left.concat(right.reverse());
}

export function buildWater(rng: Rng, kind: WaterKind, bounds: { w: number; h: number }): Water {
  const { w, h } = bounds;
  if (kind === "none") return { kind, bodies: [], bridges: [] };

  if (kind === "sea") {
    const side = randInt(rng, 0, 3);
    const depth = (0.24 + rng() * 0.1) * (side % 2 === 0 ? w : h);
    let poly: Polygon;
    if (side === 0) poly = [[w - depth, 0], [w, 0], [w, h], [w - depth, h]];
    else if (side === 1) poly = [[0, h - depth], [w, h - depth], [w, h], [0, h]];
    else if (side === 2) poly = [[0, 0], [depth, 0], [depth, h], [0, h]];
    else poly = [[0, 0], [w, 0], [w, depth], [0, depth]];
    return { kind, bodies: [poly], bridges: [] };
  }

  if (kind === "lake") {
    const cx = w * (0.35 + rng() * 0.3), cy = h * (0.35 + rng() * 0.3);
    const r = 28 + rng() * 22;
    const poly: Polygon = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.4);
      poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return { kind, bodies: [poly], bridges: [] };
  }

  // river / meander: a winding centre line crossing the map, turned into a ribbon
  const vertical = kind === "river" ? rng() < 0.5 : true;
  const center: Polyline = [];
  const steps = 12;
  const amp = kind === "meander" ? 70 : 40;
  const base = vertical ? w * (0.4 + rng() * 0.2) : h * (0.4 + rng() * 0.2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = Math.sin(t * Math.PI * (kind === "meander" ? 3 : 2) + rng() * 0.0) * amp;
    if (vertical) center.push([base + off, t * h]);
    else center.push([t * w, base + off]);
  }
  const poly = ribbon(center, kind === "meander" ? 16 : 11);
  return { kind, bodies: [poly], bridges: [] };
}

export function inWater(water: Water, p: Point): boolean {
  for (const body of water.bodies) if (pointInPolygon(p, body)) return true;
  return false;
}

export function waterBridges(roads: Polyline[], water: Water): [Point, Point][] {
  const bridges: [Point, Point][] = [];
  for (const r of roads) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      if (inWater(water, a) !== inWater(water, b)) {
        bridges.push([a, b]);
        break;
      }
    }
  }
  return bridges;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- "city/water"`
Expected: PASS (참고: v2 water 테스트는 이 파일로 교체되어 사라진다)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/water.ts src/engine/city/water.test.ts
git commit -m "feat: sea/river/lake/meander water with ribbons"
```

---

### Task 6: 오케스트레이터 재작성 (city.ts)

**Files:**
- Modify (replace contents): `src/engine/city.ts`
- Modify (replace contents): `src/engine/city.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `deriveSeed`, `randInt` (rng); `Point`, `Polygon`, `Polyline`, `centroid`, `pointInPolygon`, `area` (geometry); `selectArchetype`, `Archetype` (archetypes); `makeTensorField`, `BasisField` (tensorField); `generateStreets` (streets); `buildWater`, `inWater`, `waterBridges`, `Water` (water); `generateWards`, `WardCell` (city/wards); `assignZones`, `WardType` (city/zoning); `subdivide` (city/buildings); `buildWall`, `buildMoat`, `Wall` (city/walls); `CityMarker` (types/world)
- Produces (PUBLIC — 시그니처 유지): `interface Ward { polygon:Polygon; type:WardType; buildings:Polygon[]; inner:boolean }`; `interface CityLayout { name:string; size:number; coastal:boolean; isCapital:boolean; archetype:Archetype; bounds:{w:number;h:number}; water:Water; wall:Wall|null; moat:Polygon|null; mainRoads:Polyline[]; minorRoads:Polyline[]; wards:Ward[]; parks:Polygon[]; labels:{x:number;y:number;text:string}[] }`; `interface CityContext { id:number; name:string; size:number; coastal:boolean; isCapital:boolean; elevation:number }`; `cityContext(c:CityMarker):CityContext`; `generateCityLayout(ctx:CityContext, worldSeed:number):CityLayout`

- [ ] **Step 1: 실패 테스트 작성 (전체 교체)** — `src/engine/city.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { centroid, pointInPolygon } from "./geometry";
import { inWater } from "./city/water";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false, elevation: 0.5,
};

describe("city v3", () => {
  it("is deterministic for the same world seed and id", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 99))).toBe(JSON.stringify(generateCityLayout(ctx, 99)));
  });
  it("changes with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1))).not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("builds a street network (main + minor roads)", () => {
    const layout = generateCityLayout(cityContext(base), 5);
    expect(layout.mainRoads.length).toBeGreaterThan(0);
    expect(layout.minorRoads.length).toBeGreaterThan(layout.mainRoads.length);
  });
  it("a coastal city is a coastalPort with sea water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(layout.archetype.id).toBe("coastalPort");
    expect(layout.water.kind).toBe("sea");
  });
  it("a high inland city is a hilltopFortress", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.8 }), 5);
    expect(layout.archetype.id).toBe("hilltopFortress");
  });
  it("never routes a road point through water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const r of [...layout.mainRoads, ...layout.minorRoads]) {
      for (const p of r) expect(inWater(layout.water, p)).toBe(false);
    }
  });
  it("never places a building centroid in water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const w of layout.wards) for (const b of w.buildings) {
      expect(inWater(layout.water, centroid(b))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- "engine/city"`
Expected: FAIL

- [ ] **Step 3: 구현 (전체 교체)** — `src/engine/city.ts`

```ts
import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid } from "./geometry";
import { selectArchetype } from "./city/archetypes";
import type { Archetype } from "./city/archetypes";
import { makeTensorField } from "./city/tensorField";
import type { BasisField, Vec } from "./city/tensorField";
import { generateStreets } from "./city/streets";
import { buildWater, inWater, waterBridges } from "./city/water";
import type { Water } from "./city/water";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
import { buildWall, buildMoat } from "./city/walls";
import type { Wall } from "./city/walls";
import type { CityMarker } from "../types/world";

export interface Ward {
  polygon: Polygon;
  type: WardType;
  buildings: Polygon[];
  inner: boolean;
}

export interface CityLayout {
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  archetype: Archetype;
  bounds: { w: number; h: number };
  water: Water;
  wall: Wall | null;
  moat: Polygon | null;
  mainRoads: Polyline[];
  minorRoads: Polyline[];
  wards: Ward[];
  parks: Polygon[];
  labels: { x: number; y: number; text: string }[];
}

export interface CityContext {
  id: number;
  name: string;
  size: number;
  coastal: boolean;
  isCapital: boolean;
  elevation: number;
}

export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital, elevation: c.elevation };
}

function fieldsFor(arch: Archetype, center: Vec, rng: Rng): BasisField[] {
  const fields: BasisField[] = [];
  if (arch.streetField === "radial") {
    fields.push({ kind: "radial", center, size: 260, decay: 1, theta: 0 });
  } else if (arch.streetField === "grid") {
    fields.push({ kind: "grid", center, size: 400, decay: 1, theta: rng() * Math.PI });
  } else if (arch.streetField === "linear") {
    fields.push({ kind: "grid", center, size: 400, decay: 1, theta: rng() < 0.5 ? 0 : Math.PI / 2 });
  } else {
    fields.push({ kind: "grid", center, size: 220, decay: 1, theta: rng() * Math.PI });
    fields.push({ kind: "radial", center, size: 160, decay: 0.7, theta: 0 });
  }
  return fields;
}

const NO_BUILDINGS: WardType[] = ["plaza", "park", "field"];
const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 240, suburb: 200, military: 260,
};

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 300, h: 300 };
  const center: Vec = [150, 150];
  const radius = 60 + ctx.size * 12;
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size }, rng);

  const water = buildWater(rng, archetype.water, bounds);
  const noiseAmp = archetype.streetField === "grid" || archetype.streetField === "linear" ? 0.08 : 0.22;
  const field = makeTensorField(rng, fieldsFor(archetype, center, rng), noiseAmp);
  const insideRegion = (p: Point) =>
    Math.hypot(p[0] - center[0], p[1] - center[1]) <= radius && !inWater(water, p);
  const stop = (p: Vec) => !insideRegion(p);

  const seedCandidates: Vec[] = [center];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    seedCandidates.push([center[0] + Math.cos(a) * radius * 0.45, center[1] + Math.sin(a) * radius * 0.45]);
  }
  const drySeeds = seedCandidates.filter((p) => insideRegion(p));
  const seeds: Vec[] = drySeeds.length > 0 ? drySeeds : [center];

  const mainRoads = generateStreets(field, { dsep: 34, dtest: 17, step: 3, maxLength: 220, bounds, useMinor: false }, stop, seeds);
  const minorRoads = generateStreets(field, { dsep: 15, dtest: 7, step: 3, maxLength: 160, bounds, useMinor: true }, stop, seeds);
  water.bridges = waterBridges([...mainRoads, ...minorRoads], water);

  const allRoads = [...mainRoads, ...minorRoads];
  const nearRoad = (p: Point) => {
    for (const r of allRoads) for (const q of r) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3.5) return true;
    return false;
  };

  let cells = generateWards(rng, center[0], center[1], radius, 8 + ctx.size * 3);
  cells = cells.filter((c) => !inWater(water, c.site));
  const zoned = assignZones(rng, cells, center, radius, { hasCastle: ctx.isCapital || ctx.size >= 4, coastal: ctx.coastal });

  const innerWards = zoned.filter((w) => w.inner);
  const wall = innerWards.length >= 3 ? buildWall(innerWards, 2 + (ctx.size >= 3 ? 1 : 0) + (ctx.isCapital ? 1 : 0)) : null;
  const moat = wall ? buildMoat(wall.ring, 6) : null;

  const parks: Polygon[] = [];
  const wards: Ward[] = zoned.map((z) => {
    if (z.type === "park") { parks.push(z.polygon); return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner }; }
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: DENSITY[z.type] ?? 130, margin: 1.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        return !inWater(water, c) && !nearRoad(c);
      });
    }
    return { polygon: z.polygon, type: z.type, buildings, inner: z.inner };
  });

  const labels: { x: number; y: number; text: string }[] = [];
  const LABEL: Partial<Record<WardType, string>> = { plaza: "Market", castle: "Keep", cathedral: "Cathedral", guildhall: "Guildhall", harbor: "Harbor" };
  for (const z of zoned) {
    const t = LABEL[z.type];
    if (t) { const c = centroid(z.polygon); labels.push({ x: c[0], y: c[1], text: t }); }
  }

  return {
    name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital,
    archetype, bounds, water, wall, moat, mainRoads, minorRoads, wards, parks, labels,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- "engine/city"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts
git commit -m "feat: archetype-driven city orchestration with streets"
```

---

### Task 7: 밝은 테마 렌더러 (svgCityRenderer)

**Files:**
- Modify (replace contents): `src/ui/svgCityRenderer.ts`
- Modify (replace contents): `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `svgEl` (ui/renderer); `CityLayout` (engine/city); `WardType` (engine/city/zoning); `Polygon`, `Polyline` (engine/geometry)
- Produces: `renderCity(layout:CityLayout):SVGSVGElement` — 밝은 테마: water/parks/wards-tint/minorRoads/mainRoads/buildings/wall+towers+gates/labels(후광)/legend

- [ ] **Step 1: 실패 테스트 작성 (전체 교체)** — `src/ui/svgCityRenderer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 5, coastal: true, elevation: 0.4,
};

describe("renderCity v3", () => {
  it("draws water, main and minor roads, buildings, and a legend", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".water").length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll(".road-main").length).toBe(layout.mainRoads.length);
    expect(svg.querySelectorAll(".road-minor").length).toBe(layout.minorRoads.length);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".legend-item").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- svgCityRenderer`
Expected: FAIL

- [ ] **Step 3: 구현 (전체 교체)** — `src/ui/svgCityRenderer.ts`

```ts
import { svgEl } from "./renderer";
import type { CityLayout } from "../engine/city";
import type { WardType } from "../engine/city/zoning";
import type { Polygon, Polyline } from "../engine/geometry";

const TINT: Partial<Record<WardType, string>> = {
  plaza: "#ece2c6", castle: "#ddd8cb", cathedral: "#e3dbe6", guildhall: "#dfe2d2",
  harbor: "#cfdde2", slum: "#e6dcc6", market: "#ece1c4",
};

function pts(poly: Polygon | Polyline): string {
  return poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
function avg(poly: Polygon): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

export function renderCity(layout: CityLayout): SVGSVGElement {
  const { w, h } = layout.bounds;
  const root = svgEl("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#f3efe4" }));

  for (const body of layout.water.bodies) {
    root.appendChild(svgEl("polygon", { class: "water-shallow", points: pts(body), fill: "#bfd8e4" }));
    root.appendChild(svgEl("polygon", { class: "water", points: pts(body), fill: "#9fc1d6", transform: "scale(0.985)", "transform-origin": "150 150" }));
  }
  for (const park of layout.parks) {
    root.appendChild(svgEl("polygon", { class: "park", points: pts(park), fill: "#cfe0b8" }));
  }

  const wardsG = svgEl("g", { class: "wards" });
  for (const ward of layout.wards) {
    const tint = TINT[ward.type];
    if (tint) wardsG.appendChild(svgEl("polygon", { class: "ward", points: pts(ward.polygon), fill: tint, "fill-opacity": 0.6 }));
  }
  root.appendChild(wardsG);

  if (layout.moat) root.appendChild(svgEl("polygon", { class: "moat", points: pts(layout.moat), fill: "none", stroke: "#9fc1d6", "stroke-width": 3 }));

  const minorG = svgEl("g", { class: "roads-minor" });
  for (const r of layout.minorRoads) {
    minorG.appendChild(svgEl("polyline", { class: "road-minor", points: pts(r), fill: "none", stroke: "#c2b39a", "stroke-width": 1.4, "stroke-linecap": "round" }));
  }
  root.appendChild(minorG);

  const mainG = svgEl("g", { class: "roads-main" });
  for (const r of layout.mainRoads) {
    mainG.appendChild(svgEl("polyline", { class: "road-main", points: pts(r), fill: "none", stroke: "#7a6a52", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  root.appendChild(mainG);

  const buildG = svgEl("g", { class: "buildings" });
  for (const ward of layout.wards) {
    const fill = ward.type === "castle" ? "#cfcabe" : ward.type === "cathedral" ? "#ddd2e0" : "#e6dcc8";
    for (const b of ward.buildings) {
      buildG.appendChild(svgEl("polygon", { class: "building", points: pts(b), fill, stroke: "#9a8a70", "stroke-width": 0.4 }));
    }
  }
  root.appendChild(buildG);

  for (const [a, b] of layout.water.bridges) {
    root.appendChild(svgEl("line", { class: "bridge", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#7a6a52", "stroke-width": 4, "stroke-linecap": "round" }));
  }

  if (layout.wall) {
    root.appendChild(svgEl("polygon", { class: "wall", points: pts(layout.wall.ring), fill: "none", stroke: "#6b5b45", "stroke-width": 2.5 }));
    const tg = svgEl("g", { class: "towers" });
    for (const t of layout.wall.towers) tg.appendChild(svgEl("circle", { class: "tower", cx: t[0], cy: t[1], r: 2.6, fill: "#8a7858", stroke: "#5a4a36", "stroke-width": 0.8 }));
    root.appendChild(tg);
    const gg = svgEl("g", { class: "gates" });
    for (const ga of layout.wall.gates) gg.appendChild(svgEl("rect", { class: "gate", x: ga[0] - 2.5, y: ga[1] - 2.5, width: 5, height: 5, fill: "#5a4a36" }));
    root.appendChild(gg);
  }

  for (const ward of layout.wards) {
    if (ward.type === "cathedral") {
      const c = avg(ward.polygon);
      root.appendChild(svgEl("path", { class: "landmark", d: `M${c[0]} ${c[1] - 7} v14 M${c[0] - 4} ${c[1] - 2} h8`, stroke: "#7a5a86", "stroke-width": 2, fill: "none" }));
    }
  }

  const labelsG = svgEl("g", { class: "labels" });
  for (const l of layout.labels) {
    const halo = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#f3efe4", stroke: "#f3efe4", "stroke-width": 2.5, "text-anchor": "middle" });
    halo.textContent = l.text;
    labelsG.appendChild(halo);
    const t = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#4a3f2c", "text-anchor": "middle" });
    t.textContent = l.text;
    labelsG.appendChild(t);
  }
  root.appendChild(labelsG);

  const title = svgEl("text", { x: w / 2, y: 14, "font-size": 13, fill: "#3a2f1c", "text-anchor": "middle" });
  title.textContent = layout.name;
  root.appendChild(title);

  const legend = svgEl("g", { class: "legend" });
  const items: [string, string][] = [["#9fc1d6", "Water"], ["#cfe0b8", "Park"], ["#7a6a52", "Main road"], ["#e6dcc8", "Buildings"]];
  const x0 = 6, y0 = h - 8 - items.length * 11;
  legend.appendChild(svgEl("rect", { x: x0 - 4, y: y0 - 8, width: 86, height: items.length * 11 + 12, rx: 3, fill: "#f7f2e6", stroke: "#cbb784", "stroke-width": 0.5 }));
  items.forEach(([color, label], i) => {
    const y = y0 + i * 11;
    legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 6, width: 8, height: 8, fill: color, stroke: "#9a8a70", "stroke-width": 0.4 }));
    const txt = svgEl("text", { x: x0 + 12, y, "font-size": 7, fill: "#4a3f2c" });
    txt.textContent = label;
    legend.appendChild(txt);
  });
  root.appendChild(legend);

  return root;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- svgCityRenderer`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: light-theme street-city renderer"
```

---

### Task 8: 통합 검증 + 빌드 + 마감

**Files:**
- 변경 없음 예상(필요 시 `src/ui/app.ts` 호출부 점검만).

**Interfaces:**
- Consumes: 전체
- Produces: 동작하는 거리망 도시 v3

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `npm test`
Expected: 모든 테스트 PASS (archetypes/tensorField/streets/water/city v3/renderer v3 포함)

Run: `npm run build`
Expected: 빌드 성공(tsc --noEmit + vite build)

- [ ] **Step 2: 앱 호출부 점검**

`src/ui/app.ts`가 `cityContext(marker)` → `generateCityLayout(ctx, params.seed)` → `renderCity(layout)`로 연결되는지 확인. 시그니처(특히 `CityContext`에 `elevation` 추가됨, `cityContext`가 `CityMarker.elevation`을 읽음)가 유지되어 변경 불필요. 변경이 필요하면 최소 수정 후 `npm test -- app`로 확인.

- [ ] **Step 3: 수동 검증 (개발 서버)**

Run: `npm run dev`
브라우저에서 월드 → 도시 클릭 → v3 도시맵 확인:
- 밝은 깔끔 톤, 위계 도로망(간선 굵게·이면 가늘게), 성벽+탑+성문, 건물, 라벨 후광, 범례.
- 해안 도시: 바다+얕은물. 일부 내륙: 강+다리 또는 호수.
- 같은 시드 → 같은 도시. Back to world 복귀.

- [ ] **Step 4: 커밋(변경 있을 때만)**

```bash
git add -A
git commit -m "chore: city v3 integration verified"
```

---

## Self-Review

**Spec coverage:**
- 지형 원형 + 선택기 → Task 2. `CityMarker.elevation` → Task 1. 텐서필드 → Task 3. 거리망(2단계 스트림라인) → Task 4. 물(바다·강·호수·곡류 + 다리 + 클리핑) → Task 5. 원형 주도 오케스트레이션 + 거리 겹침 건물 제거 → Task 6. 밝은 테마 렌더(도로 위계·물 음영·라벨 후광·범례) → Task 7. 통합·빌드·수동검증 → Task 8. ✅
- 결정성/시그니처 유지(`cityContext`/`generateCityLayout`/`renderCity`) → Task 6–8. ✅
- 단계화: 거리-블록 면 추출은 Phase 2(범위 밖). ✅

**Placeholder scan:** TBD/TODO 없음, 모든 코드 스텝에 실제 코드. ✅

**Type consistency:** `Vec`/`BasisField`/`TensorField`(tensorField) → streets/city 소비. `StreetOpts`/`generateStreets`(streets) → city. `Water`/`WaterKind`/`buildWater`/`inWater`/`waterBridges`(water) → city/renderer. `Archetype`(archetypes) → city. `CityLayout`(mainRoads/minorRoads/water/parks/archetype) → renderer. `CityContext`에 `elevation` 추가 → `cityContext`가 `CityMarker.elevation` 사용(Task 1에서 필드 추가). ✅

**Note:** v2의 `wards`/`zoning`/`walls`/`buildings`/`geometry`는 변경 없이 재사용. v2 `city/water.ts`·`city.test.ts`·`svgCityRenderer.ts`는 본 계획에서 교체된다. `assignZones`는 `park` 타입을 반환할 수 있으며(zoning의 OUTER 후보), city.ts가 이를 `parks`로 분리한다.
