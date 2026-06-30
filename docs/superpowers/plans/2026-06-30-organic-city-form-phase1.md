# 유기적 도시 형태 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거리망 도시를 지형 순응 **불규칙 외곽** + **구불구불 해안** + 진짜 **휘는 도로** + **자연 방어(물)를 활용하는 열린 성벽**(물쪽 열림·해자 부분)으로 바꾼다. 오목 외곽은 SVG `clipPath`로 처리.

**Architecture:** `cityBoundary`가 원형별 불규칙 경계 폴리곤을 만들고(물에서 빼냄), `walls.wallFromDefenses`가 물에 인접하지 않은 경계 변에만 성벽 세그먼트를 만든다(물쪽엔 바다문). `city.ts`는 원판 대신 경계를 쓰고, `fieldsFor`에 오프셋 보조장을 더해 도로가 실제로 휘게 한다. 렌더러는 경계 `clipPath`로 구역·건물을 잘라내고 성벽을 폴리라인으로 그린다.

**Tech Stack:** TypeScript(strict), Vitest(+jsdom), 기존 `d3-delaunay`·`simplex-noise`. 신규 런타임 의존성 없음.

## Global Constraints

- TypeScript `strict: true`(`noUnusedLocals`). 신규 런타임 의존성 금지(`d3-delaunay`,`simplex-noise`만).
- 모든 무작위성은 `src/engine/rng.ts` 시드 PRNG만(`Math.random()` 금지). 도시 상세는 `deriveSeed(worldSeed, cityId)` 파생, 결정적.
- 엔진(`src/engine/**`)은 DOM 비의존. 렌더는 `src/ui/**`.
- 공개 시그니처 유지: `cityContext(marker):CityContext`, `generateCityLayout(ctx,worldSeed):CityLayout`, `renderCity(layout):SVGSVGElement`. `src/ui/app.ts` 변경 금지.
- 도시 캔버스 `bounds.w=bounds.h=300`(viewBox 0 0 300 300), 중심 (150,150).
- 밝은 테마 유지(바탕 `#f3efe4`, 물 `#9fc1d6`/얕은물 `#bfd8e4`, 도로지도 도로색은 기존 유지). 성벽 `#43392d`.

---

## File Structure

```
src/engine/city/cityBoundary.ts  지형 순응 불규칙 경계 (신규)
src/engine/city/water.ts          바다 육지쪽 가장자리 노이즈 (수정)
src/engine/city/walls.ts          wallFromDefenses 추가 (수정, 추가적)
src/engine/city.ts                경계·유동성벽·휘는필드 통합 (재작성)
src/ui/svgCityRenderer.ts         경계 clipPath, 성벽=폴리라인 (재작성)
```

재사용(변경 없음): `geometry.ts`, `tensorField.ts`, `streets.ts`, `wards.ts`, `zoning.ts`, `buildings.ts`, `archetypes.ts`, `rng.ts`.

---

### Task 1: 지형 순응 불규칙 경계 (cityBoundary)

**Files:**
- Create: `src/engine/city/cityBoundary.ts`, `src/engine/city/cityBoundary.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `createNoise2D` (simplex-noise); `Point`, `Polygon`, `bbox` (geometry); `Archetype` (archetypes); `Water`, `inWater` (water)
- Produces: `makeBoundary(rng:Rng, archetype:Archetype, size:number, center:Point, water:Water):Polygon`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/cityBoundary.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { bbox, pointInPolygon } from "../geometry";
import type { Point } from "../geometry";
import { buildWater } from "./water";
import { makeBoundary } from "./cityBoundary";
import type { Archetype } from "./archetypes";

const C: Point = [150, 150];
const arch = (over: Partial<Archetype>): Archetype => ({
  id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "none", ...over,
});

describe("cityBoundary", () => {
  it("is a closed irregular ring (radius varies, not a circle)", () => {
    const b = makeBoundary(mulberry32(1), arch({}), 4, C, buildWater(mulberry32(1), "none", { w: 300, h: 300 }));
    expect(b.length).toBeGreaterThanOrEqual(16);
    const rs = b.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
    expect(Math.max(...rs) / Math.min(...rs)).toBeGreaterThan(1.25);
  });
  it("keeps all vertices out of the water (coastal D-shape)", () => {
    const water = buildWater(mulberry32(2), "sea", { w: 300, h: 300 });
    const b = makeBoundary(mulberry32(2), arch({ id: "coastalPort", streetField: "organic", water: "sea" }), 4, C, water);
    for (const p of b) {
      for (const body of water.bodies) expect(pointInPolygon(p, body)).toBe(false);
    }
  });
  it("elongates a linear archetype along one axis", () => {
    const b = makeBoundary(mulberry32(3), arch({ id: "ridgeLinear", streetField: "linear" }), 4, C, buildWater(mulberry32(3), "none", { w: 300, h: 300 }));
    const bb = bbox(b);
    const ratio = (bb.maxX - bb.minX) / (bb.maxY - bb.minY);
    expect(ratio < 0.75 || ratio > 1.33).toBe(true);
  });
  it("is deterministic", () => {
    const w = buildWater(mulberry32(5), "none", { w: 300, h: 300 });
    expect(JSON.stringify(makeBoundary(mulberry32(5), arch({}), 3, C, w)))
      .toBe(JSON.stringify(makeBoundary(mulberry32(5), arch({}), 3, C, w)));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- cityBoundary`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/cityBoundary.ts`

```ts
import { createNoise2D } from "simplex-noise";
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import type { Archetype } from "./archetypes";
import type { Water } from "./water";
import { inWater } from "./water";

export function makeBoundary(
  rng: Rng, archetype: Archetype, size: number, center: Point, water: Water
): Polygon {
  const noise = createNoise2D(rng);
  const base = 58 + size * 12;
  const N = 22;
  const axis = rng() * Math.PI;
  const poly: Polygon = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = base * (0.8 + 0.34 * (noise(Math.cos(a) * 1.5, Math.sin(a) * 1.5) * 0.5 + 0.5));
    if (archetype.streetField === "linear") r *= 1 + 0.55 * Math.abs(Math.cos(a - axis));
    else if (archetype.wallShape === "contour") r *= 0.82;
    let p: Point = [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
    let guard = 0;
    while (inWater(water, p) && guard < 30) {
      p = [p[0] + (center[0] - p[0]) * 0.12, p[1] + (center[1] - p[1]) * 0.12];
      guard++;
    }
    poly.push(p);
  }
  return poly;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- cityBoundary`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/cityBoundary.ts src/engine/city/cityBoundary.test.ts
git commit -m "feat: terrain-conforming irregular city boundary"
```

---

### Task 2: 구불구불 해안선 (water 수정)

**Files:**
- Modify: `src/engine/city/water.ts`
- Modify: `src/engine/city/water.test.ts`

**Interfaces:**
- Consumes: `createNoise2D` (simplex-noise) — water.ts에 추가
- Produces: `buildWater`의 `"sea"`가 **육지쪽 가장자리를 노이즈로 물결치게** 만든다(시그니처 불변).

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/city/water.test.ts`의 `describe("water", ...)`에 추가

```ts
it("sea has a wavy (non-straight) land-facing edge", () => {
  // try several seeds; the land edge must deviate from a straight line
  let wavy = false;
  for (let s = 0; s < 8; s++) {
    const w = buildWater(mulberry32(s), "sea", { w: 300, h: 300 });
    const poly = w.bodies[0];
    // land-facing edge = the vertices NOT on the canvas border (x in (0,300), y in (0,300))
    const inner = poly.filter((p) => p[0] > 1 && p[0] < 299 && p[1] > 1 && p[1] < 299);
    if (inner.length >= 3) {
      const xs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]);
      const spreadX = Math.max(...xs) - Math.min(...xs);
      const spreadY = Math.max(...ys) - Math.min(...ys);
      // a straight side band has ~0 spread on the depth axis; waviness gives > 6
      if (Math.min(spreadX, spreadY) > 6) wavy = true;
    }
  }
  expect(wavy).toBe(true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- "city/water"`
Expected: FAIL (현재 사각형 직선 가장자리)

- [ ] **Step 3: 구현** — `src/engine/city/water.ts`의 `"sea"` 분기 교체

파일 상단 import에 추가:
```ts
import { createNoise2D } from "simplex-noise";
```
`buildWater` 안의 `if (kind === "sea") { ... }` 블록 전체를 아래로 교체:
```ts
  if (kind === "sea") {
    const side = randInt(rng, 0, 3); // 0 right, 1 bottom, 2 left, 3 top
    const noise = createNoise2D(rng);
    const depth = (0.24 + rng() * 0.1) * (side % 2 === 0 ? w : h);
    const K = 12, amp = 13;
    const edge: Point[] = [];
    for (let i = 0; i <= K; i++) {
      const t = i / K;
      const n = noise(t * 3.2, side * 1.7) * amp;
      if (side === 0) edge.push([w - depth + n, t * h]);
      else if (side === 1) edge.push([t * w, h - depth + n]);
      else if (side === 2) edge.push([depth + n, t * h]);
      else edge.push([t * w, depth + n]);
    }
    let polygon: Polygon;
    if (side === 0) polygon = [...edge, [w, h], [w, 0]];
    else if (side === 1) polygon = [...edge, [w, h], [0, h]];
    else if (side === 2) polygon = [...edge, [0, h], [0, 0]];
    else polygon = [...edge, [w, 0], [0, 0]];
    return { kind, bodies: [polygon], bridges: [] };
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- "city/water"`
Expected: PASS (기존 6개 + 새 1개)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/water.ts src/engine/city/water.test.ts
git commit -m "feat: wavy sea coastline"
```

---

### Task 3: 자연 방어 기반 성벽 (walls.wallFromDefenses)

**Files:**
- Modify: `src/engine/city/walls.ts`
- Modify: `src/engine/city/walls.test.ts`

**Interfaces:**
- Consumes: `Point`, `Polygon`, `Polyline`, `centroid` (geometry); `Water`, `inWater` (water)
- Produces (추가, 기존 `buildWall`/`buildMoat`/`Wall`은 유지): `interface DefenseWall { segments:Polyline[]; towers:Point[]; gates:Point[]; seaGates:Point[] }`; `wallFromDefenses(boundary:Polygon, water:Water, gateCount:number):DefenseWall`

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/city/walls.test.ts`에 append

```ts
import { wallFromDefenses } from "./walls";
import type { Polygon } from "../geometry";
import type { Water } from "./water";

const ring: Polygon = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  ring.push([150 + Math.cos(a) * 60, 150 + Math.sin(a) * 60]);
}
const noWater: Water = { kind: "none", bodies: [], bridges: [] };
const rightSea: Water = { kind: "sea", bodies: [[[185, 0], [300, 0], [300, 300], [185, 300]]], bridges: [] };

describe("wallFromDefenses", () => {
  it("a landlocked city walls the whole boundary (one closed ring, no sea gates)", () => {
    const wall = wallFromDefenses(ring, noWater, 3);
    expect(wall.segments.length).toBe(1);
    expect(wall.seaGates.length).toBe(0);
    expect(wall.gates.length).toBe(3);
    expect(wall.towers.length).toBeGreaterThanOrEqual(ring.length);
  });
  it("leaves the water-facing side open with sea gates", () => {
    const wall = wallFromDefenses(ring, rightSea, 3);
    expect(wall.seaGates.length).toBeGreaterThan(0);
    const totalVerts = wall.segments.reduce((n, s) => n + s.length, 0);
    expect(totalVerts).toBeLessThan(ring.length + 1); // less than the full closed ring
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- walls`
Expected: FAIL (함수 없음)

- [ ] **Step 3: 구현** — `src/engine/city/walls.ts`에 append

```ts
import type { Polyline } from "../geometry";
import { centroid } from "../geometry";
import type { Water } from "./water";
import { inWater } from "./water";

export interface DefenseWall {
  segments: Polyline[];
  towers: Point[];
  gates: Point[];
  seaGates: Point[];
}

export function wallFromDefenses(boundary: Polygon, water: Water, gateCount: number): DefenseWall {
  const n = boundary.length;
  const c = centroid(boundary);
  const isWall: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const m: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out: Point = [m[0] + (m[0] - c[0]) * 0.06, m[1] + (m[1] - c[1]) * 0.06];
    isWall.push(!inWater(water, out));
  }
  const segments: Polyline[] = [];
  const seaGates: Point[] = [];
  const allWall = isWall.every((w) => w);
  if (allWall) {
    const ring: Polyline = boundary.map((p) => [p[0], p[1]]);
    ring.push([boundary[0][0], boundary[0][1]]);
    segments.push(ring);
  } else {
    let start = 0;
    while (isWall[start]) start = (start + 1) % n;        // a non-wall edge
    let cur: Polyline | null = null;
    for (let k = 0; k < n; k++) {
      const e = (start + k) % n;
      if (isWall[e]) {
        if (!cur) cur = [boundary[e]];
        cur.push(boundary[(e + 1) % n]);
      } else if (cur) {
        seaGates.push(cur[0], cur[cur.length - 1]);
        segments.push(cur);
        cur = null;
      }
    }
    if (cur) { seaGates.push(cur[0], cur[cur.length - 1]); segments.push(cur); }
  }
  const towers: Point[] = [];
  for (const s of segments) for (const p of s) towers.push(p);
  const gates: Point[] = [];
  const flat: Point[] = segments.flat();
  const want = Math.max(1, Math.min(gateCount, Math.max(1, flat.length - 1)));
  for (let g = 0; g < want; g++) {
    const idx = Math.floor(((g + 0.5) / want) * flat.length) % flat.length;
    gates.push(flat[idx]);
  }
  return { segments, towers, gates, seaGates };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- walls` 그리고 `npm run build`
Expected: PASS(기존 walls 테스트 + 새 wallFromDefenses 2개), 빌드 클린

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/walls.ts src/engine/city/walls.test.ts
git commit -m "feat: wall only on undefended boundary edges"
```

---

### Task 4: 오케스트레이터 + 렌더러 (경계·휘는필드·유동성벽·clipPath) — 묶음

**Files:**
- Modify (재작성): `src/engine/city.ts`, `src/engine/city.test.ts`
- Modify (재작성): `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: 모든 city 모듈 + `makeBoundary` (cityBoundary), `wallFromDefenses`/`DefenseWall` (walls)
- Produces (PUBLIC 시그니처 유지): `CityLayout`에 `boundary:Polygon` 추가; `wall:DefenseWall|null`(링→세그먼트), `moat:Polyline[]|null`(세그먼트). `cityContext`/`generateCityLayout`/`renderCity` 불변.

본 태스크는 공유 타입(`CityLayout.wall`이 세그먼트형으로 변경)이 city.ts↔렌더러를 함께 깨므로 **한 묶음**으로 구현해 한 커밋으로 초록을 만든다.

- [ ] **Step 1: city 실패 테스트 작성 (전체 교체)** — `src/engine/city.test.ts`

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

function curvaturePct(road: [number, number][]): number {
  if (road.length < 3) return 0;
  const a = road[0], b = road[road.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let m = 0;
  for (const p of road) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > m) m = d;
  }
  return (m / len) * 100;
}

describe("city organic", () => {
  it("is deterministic", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 9))).toBe(JSON.stringify(generateCityLayout(ctx, 9)));
  });
  it("exposes an irregular boundary polygon (radius varies)", () => {
    const l = generateCityLayout(cityContext(base), 5);
    const rs = l.boundary.map((p) => Math.hypot(p[0] - 150, p[1] - 150));
    expect(l.boundary.length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...rs) / Math.min(...rs)).toBeGreaterThan(1.2);
  });
  it("has at least one genuinely curved main road across seeds", () => {
    let curved = false;
    for (let s = 1; s <= 6; s++) {
      const l = generateCityLayout(cityContext({ ...base, coastal: false }), s);
      if (l.mainRoads.some((r) => curvaturePct(r) > 12)) curved = true;
    }
    expect(curved).toBe(true);
  });
  it("a coastal city leaves the seaward wall open (sea gates present)", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(l.wall).not.toBeNull();
    expect(l.wall!.seaGates.length).toBeGreaterThan(0);
  });
  it("keeps roads and building centroids inside the boundary and out of water", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const r of [...l.mainRoads, ...l.minorRoads]) for (const p of r) {
      expect(inWater(l.water, p)).toBe(false);
    }
    for (const w of l.wards) for (const b of w.buildings) {
      expect(pointInPolygon(centroid(b), l.boundary)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- "engine/city"`
Expected: FAIL

- [ ] **Step 3: city.ts 구현 (전체 교체)** — `src/engine/city.ts`

```ts
import { mulberry32, deriveSeed } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid, pointInPolygon } from "./geometry";
import { selectArchetype } from "./city/archetypes";
import type { Archetype } from "./city/archetypes";
import { makeTensorField } from "./city/tensorField";
import type { BasisField, Vec } from "./city/tensorField";
import { generateStreets } from "./city/streets";
import { buildWater, inWater, waterBridges } from "./city/water";
import type { Water } from "./city/water";
import { makeBoundary } from "./city/cityBoundary";
import { wallFromDefenses } from "./city/walls";
import type { DefenseWall } from "./city/walls";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
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
  boundary: Polygon;
  water: Water;
  wall: DefenseWall | null;
  moat: Polyline[] | null;
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

function fieldsFor(arch: Archetype, center: Vec, radius: number, rng: Rng): BasisField[] {
  const fields: BasisField[] = [];
  if (arch.streetField === "radial") fields.push({ kind: "radial", center, size: radius * 3, decay: 1, theta: 0 });
  else fields.push({ kind: "grid", center, size: radius * 4, decay: 1, theta: rng() * Math.PI });
  // offset secondary centres bend the field so streamlines genuinely curve
  for (let i = 0; i < 2; i++) {
    const a = rng() * Math.PI * 2;
    const oc: Vec = [center[0] + Math.cos(a) * radius * 0.7, center[1] + Math.sin(a) * radius * 0.7];
    fields.push({ kind: i === 0 ? "radial" : "grid", center: oc, size: radius * 1.4, decay: 0.6, theta: rng() * Math.PI });
  }
  return fields;
}

function offsetSegment(seg: Polyline, c: Point, d: number): Polyline {
  return seg.map((p) => {
    const dx = p[0] - c[0], dy = p[1] - c[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * d, p[1] + (dy / len) * d] as Point;
  });
}

const NO_BUILDINGS: WardType[] = ["plaza", "park", "field"];
const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170, patriciate: 240, suburb: 200, military: 260,
};
const MOAT_ARCHETYPES = new Set(["coastalPort", "bridgeTown", "plainsMarket"]);

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 300, h: 300 };
  const center: Vec = [150, 150];
  const radius = 60 + ctx.size * 12;
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size }, rng);

  const water = buildWater(rng, archetype.water, bounds);
  const boundary = makeBoundary(rng, archetype, ctx.size, center, water);

  const noiseAmp = archetype.streetField === "grid" || archetype.streetField === "linear" ? 0.2 : 0.26;
  const field = makeTensorField(rng, fieldsFor(archetype, center, radius, rng), noiseAmp);
  const insideRegion = (p: Point) => pointInPolygon(p, boundary) && !inWater(water, p);
  const stop = (p: Vec) => !insideRegion(p);

  const seedCandidates: Vec[] = [center];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    seedCandidates.push([center[0] + Math.cos(a) * radius * 0.45, center[1] + Math.sin(a) * radius * 0.45]);
  }
  const drySeeds = seedCandidates.filter((p) => insideRegion(p));
  const seeds: Vec[] = drySeeds.length > 0 ? drySeeds : [center];

  const mainRoads = generateStreets(field, { dsep: 34, dtest: 17, step: 3, maxLength: 240, bounds, useMinor: false }, stop, seeds);
  const minorRoads = generateStreets(field, { dsep: 15, dtest: 7, step: 3, maxLength: 180, bounds, useMinor: true }, stop, seeds);
  water.bridges = waterBridges([...mainRoads, ...minorRoads], water);

  const wall = wallFromDefenses(boundary, water, 2 + (ctx.size >= 3 ? 1 : 0) + (ctx.isCapital ? 1 : 0));
  const moat = MOAT_ARCHETYPES.has(archetype.id) ? wall.segments.map((s) => offsetSegment(s, center, 6)) : null;

  const allRoads = [...mainRoads, ...minorRoads];
  const nearRoad = (p: Point) => {
    for (const r of allRoads) for (const q of r) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3.5) return true;
    return false;
  };

  let cells = generateWards(rng, center[0], center[1], radius * 1.15, 8 + ctx.size * 3);
  cells = cells.filter((c) => pointInPolygon(c.site, boundary) && !inWater(water, c.site));
  const zoned = assignZones(rng, cells, [center[0], center[1]], radius, { hasCastle: ctx.isCapital || ctx.size >= 4, coastal: ctx.coastal });

  const parks: Polygon[] = [];
  const wards: Ward[] = zoned.map((z) => {
    if (z.type === "park") { parks.push(z.polygon); return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner }; }
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: DENSITY[z.type] ?? 130, margin: 1.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        return pointInPolygon(c, boundary) && !inWater(water, c) && !nearRoad(c);
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
    archetype, bounds, boundary, water, wall, moat, mainRoads, minorRoads, wards, parks, labels,
  };
}
```

- [ ] **Step 4: city 통과 확인 (렌더러는 아직 red 가능)**

Run: `npm test -- "engine/city"`
Expected: PASS (렌더러/렌더러 테스트는 이 시점에 깨질 수 있음 — 다음 스텝에서 고침)

- [ ] **Step 5: 렌더러 실패 테스트 작성 (전체 교체)** — `src/ui/svgCityRenderer.test.ts`

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

describe("renderCity organic", () => {
  it("clips content to the boundary and draws wall segments + roads + buildings", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll("clipPath").length).toBe(1);
    expect(svg.querySelectorAll(".boundary").length).toBe(1);
    expect(svg.querySelectorAll(".wall-seg").length).toBe(layout.wall ? layout.wall.segments.length : 0);
    expect(svg.querySelectorAll(".road-main").length).toBe(layout.mainRoads.length);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: 렌더러 구현 (전체 교체)** — `src/ui/svgCityRenderer.ts`

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

  const clipId = "cityclip";
  const defs = svgEl("defs", {});
  const clip = svgEl("clipPath", { id: clipId });
  clip.appendChild(svgEl("polygon", { points: pts(layout.boundary) }));
  defs.appendChild(clip);
  root.appendChild(defs);

  for (const body of layout.water.bodies) {
    root.appendChild(svgEl("polygon", { class: "water-shallow", points: pts(body), fill: "#bfd8e4" }));
    root.appendChild(svgEl("polygon", { class: "water", points: pts(body), fill: "#9fc1d6", transform: "scale(0.985)", "transform-origin": "150 150" }));
  }

  const clipped = svgEl("g", { "clip-path": `url(#${clipId})` });
  clipped.appendChild(svgEl("polygon", { class: "ground", points: pts(layout.boundary), fill: "#efe7d2" }));
  for (const park of layout.parks) clipped.appendChild(svgEl("polygon", { class: "park", points: pts(park), fill: "#cfe0b8" }));
  for (const ward of layout.wards) {
    const tint = TINT[ward.type];
    if (tint) clipped.appendChild(svgEl("polygon", { class: "ward", points: pts(ward.polygon), fill: tint, "fill-opacity": 0.6 }));
  }

  const road = (cls: string, r: Polyline, stroke: string, wd: number) =>
    svgEl("polyline", { class: cls, points: pts(r), fill: "none", stroke, "stroke-width": wd, "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const r of layout.minorRoads) clipped.appendChild(road("road-minor-casing", r, "#c4b594", 2.6));
  for (const r of layout.mainRoads) clipped.appendChild(road("road-main-casing", r, "#a07c3e", 4.6));
  for (const r of layout.minorRoads) clipped.appendChild(road("road-minor", r, "#f8f3e6", 1.4));
  for (const r of layout.mainRoads) clipped.appendChild(road("road-main", r, "#d8b65e", 3));

  for (const ward of layout.wards) {
    const fill = ward.type === "castle" ? "#cfcabe" : ward.type === "cathedral" ? "#ddd2e0" : "#e6dcc8";
    for (const b of ward.buildings) clipped.appendChild(svgEl("polygon", { class: "building", points: pts(b), fill, stroke: "#9a8a70", "stroke-width": 0.4 }));
  }
  root.appendChild(clipped);

  for (const [a, b] of layout.water.bridges) {
    root.appendChild(svgEl("line", { class: "bridge", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#7a6a52", "stroke-width": 4, "stroke-linecap": "round" }));
  }

  if (layout.moat) for (const s of layout.moat) {
    root.appendChild(svgEl("polyline", { class: "moat", points: pts(s), fill: "none", stroke: "#bcd6e0", "stroke-width": 5, "stroke-opacity": 0.85 }));
  }

  if (layout.wall) {
    for (const s of layout.wall.segments) {
      root.appendChild(svgEl("polyline", { class: "wall-seg", points: pts(s), fill: "none", stroke: "#43392d", "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      root.appendChild(svgEl("polyline", { class: "wall-seg-inner", points: pts(s), fill: "none", stroke: "#8a7a60", "stroke-width": 1, "stroke-linejoin": "round" }));
    }
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
  const items: [string, string][] = [["#9fc1d6", "Water"], ["#cfe0b8", "Park"], ["#d8b65e", "Main road"], ["#e6dcc8", "Buildings"]];
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

- [ ] **Step 7: 전체 통과 + 빌드**

Run: `npm test` 그리고 `npm run build`
Expected: 모든 테스트 PASS, 빌드 클린

- [ ] **Step 8: 커밋(한 묶음)**

```bash
git add src/engine/city.ts src/engine/city.test.ts src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: organic boundary, curving fields, flexible wall, clipPath render"
```

---

### Task 5: 통합 검증 + 빌드 + 마감

**Files:** (변경 없음 예상)

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `npm test` → 모든 PASS. `npm run build` → 성공.

- [ ] **Step 2: 앱 호출부 점검**

`src/ui/app.ts`가 `cityContext`/`generateCityLayout`/`renderCity`로 연결되는지 확인(시그니처 유지 → 변경 불필요). 변경 필요 시 최소 수정 후 `npm test -- app`.

- [ ] **Step 3: 수동/DOM 검증**

`npm run dev` 후 월드→도시 클릭. 또는 DOM 지표로: 경계 반경 변동(원 아님), 도로 곡률(직선편차%), 해안 직선 아님, 해안 도시 성벽 seaGates>0. (스크린샷 도구가 막혀 있으면 DOM eval로 확인.)

- [ ] **Step 4: 커밋(변경 있을 때만)**

```bash
git add -A
git commit -m "chore: organic city form integration verified"
```

---

## Self-Review

**Spec coverage:** 불규칙 경계 → Task 1. 구불 해안 → Task 2. 비방어 성벽 → Task 3. 휘는 도로(fieldsFor)·경계 통합·CityLayout(boundary/wall=세그먼트)·clipPath → Task 4. 검증 → Task 5. ✅ (Phase 2 산·Phase 3 항만은 범위 밖.)

**Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드. ✅

**Type consistency:** `makeBoundary`(cityBoundary)→city. `DefenseWall`/`wallFromDefenses`(walls)→city/renderer. `CityLayout`에 `boundary`·`wall:DefenseWall`·`moat:Polyline[]` 추가 → renderer 소비 일치. `fieldsFor`가 `radius` 인자를 받도록 정의→호출 일치. `inWater`/`Water`(water)→cityBoundary/city. ✅

**Note:** Task 4는 `CityLayout.wall` 타입 변경(링→세그먼트)이 city.ts·렌더러를 함께 깨므로 한 커밋으로 묶었다(중간 스텝에서 city 먼저 green, 렌더러 후 전체 green). 기존 `buildWall`/`buildMoat`(walls.ts)는 더 이상 city.ts에서 안 쓰이지만 제거는 본 Phase 범위 밖(walls.test의 기존 테스트 유지) — 최종 리뷰에서 죽은 코드 여부 triage.
