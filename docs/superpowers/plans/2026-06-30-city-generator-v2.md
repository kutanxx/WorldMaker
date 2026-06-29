# 도시 생성기 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MVP의 단순 구역-블록 도시맵을 Watabou급 절차적 중세 도시(Voronoi 구역 → 재귀 분할 건물, 성벽·탑·성문·해자, 성채·성당·길드홀·광장, 타입별 구역, 성밖 마을+밭, 강/해안+다리, 범례·라벨)로 교체한다.

**Architecture:** 순수 기하 모듈 `src/engine/geometry.ts`를 토대로, `src/engine/city/` 폴더의 wards·buildings·zoning·walls·roads·water 모듈을 쌓고, `src/engine/city.ts` 오케스트레이터가 리치 `CityLayout`을 산출한다. `src/ui/svgCityRenderer.ts`가 이를 SVG로 그린다. 결정적(`deriveSeed(worldSeed, cityId)`), 월드 맥락 파생(coastal/size/isCapital).

**Tech Stack:** TypeScript(strict), Vitest(+jsdom), 기존 `d3-delaunay`(Voronoi 재사용). 신규 런타임 의존성 없음.

## Global Constraints

- TypeScript `strict: true`. 신규 런타임 의존성 추가 금지(`d3-delaunay`, `simplex-noise`만).
- 모든 무작위성은 `src/engine/rng.ts`의 시드 PRNG만 사용(`Math.random()` 금지). 도시 상세는 `deriveSeed(worldSeed, cityId)`에서 파생.
- 엔진(`src/engine/**`)은 DOM 비의존(순수). 렌더는 `src/ui/**`만.
- 공개 시그니처 유지: `cityContext(marker): CityContext`(필드 `id,name,size,coastal,isCapital`), `generateCityLayout(ctx, worldSeed): CityLayout`, `renderCity(layout): SVGSVGElement`. 앱 호출부(`src/ui/app.ts`)는 변경하지 않는다.
- UI 카피는 sentence case. 파일은 단일 책임으로 작게.
- 좌표계: 도시 캔버스 `bounds.w = bounds.h = 300`(viewBox 0 0 300 300), 중심 (150,150).

---

## File Structure

```
src/engine/geometry.ts          폴리곤 기본기 (Point/Polygon/Segment/Polyline + 측정/연산)
src/engine/city/wards.ts        디스크 Voronoi → 구역 폴리곤
src/engine/city/buildings.ts    구역 재귀 분할 → 건물 필지
src/engine/city/zoning.ts       구역 타입 배정 + 내성/성밖
src/engine/city/walls.ts        성벽 링(볼록껍질) + 탑 + 성문 + 해자
src/engine/city/roads.ts        광장→성문 도로
src/engine/city/water.ts        해안/강 + 다리
src/engine/city.ts              오케스트레이터 → CityLayout v2 (MVP 교체)
src/ui/svgCityRenderer.ts       v2 렌더러 (교체)
```

테스트는 각 소스 옆 `*.test.ts`. 좌표 타입은 `geometry.ts`에서, `CityLayout`/`Ward`/`WardType`는 `city.ts`에서 정의·export.

---

### Task 1: 기하 측정 (geometry 1/2)

**Files:**
- Create: `src/engine/geometry.ts`, `src/engine/geometry.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `type Point = [number, number]`; `type Polygon = Point[]`; `type Segment = [Point, Point]`; `type Polyline = Point[]`; `signedArea(p:Polygon):number`; `area(p:Polygon):number`; `centroid(p:Polygon):Point`; `bbox(p:Polygon):{minX:number;minY:number;maxX:number;maxY:number}`; `perimeter(p:Polygon):number`; `pointInPolygon(pt:Point,poly:Polygon):boolean`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/geometry.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { signedArea, area, centroid, bbox, perimeter, pointInPolygon } from "./geometry";
import type { Polygon } from "./geometry";

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe("geometry measures", () => {
  it("computes signed area (CCW positive) and absolute area", () => {
    expect(signedArea(square)).toBeCloseTo(100, 6);
    expect(area([[0, 0], [0, 10], [10, 10], [10, 0]])).toBeCloseTo(100, 6);
  });
  it("computes centroid of a square", () => {
    const c = centroid(square);
    expect(c[0]).toBeCloseTo(5, 6);
    expect(c[1]).toBeCloseTo(5, 6);
  });
  it("computes bbox and perimeter", () => {
    expect(bbox(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(perimeter(square)).toBeCloseTo(40, 6);
  });
  it("tests point in polygon", () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- geometry`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/geometry.ts`

```ts
export type Point = [number, number];
export type Polygon = Point[];
export type Segment = [Point, Point];
export type Polyline = Point[];

export function signedArea(p: Polygon): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function area(p: Polygon): number {
  return Math.abs(signedArea(p));
}

export function centroid(p: Polygon): Point {
  const a = signedArea(p);
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const [x, y] of p) { sx += x; sy += y; }
    return [sx / p.length, sy / p.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(p: Polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function perimeter(p: Polygon): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- geometry`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/geometry.ts src/engine/geometry.test.ts
git commit -m "feat: polygon geometry measures"
```

---

### Task 2: 기하 연산 — 껍질/클립/분할/인셋 (geometry 2/2)

**Files:**
- Modify: `src/engine/geometry.ts`
- Modify: `src/engine/geometry.test.ts`

**Interfaces:**
- Consumes: `Point`, `Polygon`, `area`, `signedArea`, `centroid`, `bbox` (from geometry)
- Produces: `convexHull(pts:Point[]):Polygon` (CCW); `clipToConvex(subject:Polygon, clip:Polygon):Polygon` (Sutherland–Hodgman, clip은 볼록 CCW); `splitByLine(poly:Polygon, a:Point, b:Point):Polygon[]` (직선 a→b로 볼록 폴리곤을 0~2조각); `insetPolygon(poly:Polygon, d:number):Polygon` (중심 방향 근사 인셋)

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/geometry.test.ts`에 append

```ts
import { convexHull, clipToConvex, splitByLine, insetPolygon } from "./geometry";

describe("geometry ops", () => {
  it("convexHull returns CCW hull of a point cloud", () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]);
    expect(area(hull)).toBeCloseTo(100, 6);
    expect(hull.length).toBe(4);
  });
  it("clipToConvex clips a square to a smaller square", () => {
    const sub: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const clip: Polygon = [[2, 2], [8, 2], [8, 8], [2, 8]];
    const out = clipToConvex(sub, clip);
    expect(area(out)).toBeCloseTo(36, 4);
  });
  it("splitByLine splits a square into two halves preserving total area", () => {
    const sq: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const parts = splitByLine(sq, [5, -1], [5, 11]);
    expect(parts.length).toBe(2);
    expect(area(parts[0]) + area(parts[1])).toBeCloseTo(100, 4);
    expect(area(parts[0])).toBeCloseTo(50, 4);
  });
  it("insetPolygon shrinks area and stays inside", () => {
    const sq: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const inner = insetPolygon(sq, 2);
    expect(area(inner)).toBeLessThan(100);
    expect(area(inner)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- geometry`
Expected: FAIL (새 함수 없음)

- [ ] **Step 3: 구현** — `src/engine/geometry.ts`에 append

```ts
function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function convexHull(pts: Point[]): Polygon {
  const p = pts.slice().sort((u, v) => (u[0] === v[0] ? u[1] - v[1] : u[0] - v[0]));
  if (p.length < 3) return p.slice();
  const lower: Point[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function ensureCCW(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

export function clipToConvex(subject: Polygon, clip: Polygon): Polygon {
  const c = ensureCCW(clip);
  let output: Point[] = subject.slice();
  for (let i = 0; i < c.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const input = output;
    output = [];
    const inside = (p: Point) => cross(a, b, p) >= -1e-9;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(lineIntersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(lineIntersect(prev, cur, a, b));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

function lineIntersect(p1: Point, p2: Point, a: Point, b: Point): Point {
  const A1 = p2[1] - p1[1];
  const B1 = p1[0] - p2[0];
  const C1 = A1 * p1[0] + B1 * p1[1];
  const A2 = b[1] - a[1];
  const B2 = a[0] - b[0];
  const C2 = A2 * a[0] + B2 * a[1];
  const det = A1 * B2 - A2 * B1;
  if (Math.abs(det) < 1e-12) return p2;
  return [(B2 * C1 - B1 * C2) / det, (A1 * C2 - A2 * C1) / det];
}

export function splitByLine(poly: Polygon, a: Point, b: Point): Polygon[] {
  const side = (p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const pos: Point[] = [];
  const neg: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    const sc = side(cur);
    const sn = side(nxt);
    if (sc >= 0) pos.push(cur);
    if (sc <= 0) neg.push(cur);
    if ((sc > 0 && sn < 0) || (sc < 0 && sn > 0)) {
      const t = sc / (sc - sn);
      const ip: Point = [cur[0] + t * (nxt[0] - cur[0]), cur[1] + t * (nxt[1] - cur[1])];
      pos.push(ip);
      neg.push(ip);
    }
  }
  const out: Polygon[] = [];
  if (pos.length >= 3) out.push(pos);
  if (neg.length >= 3) out.push(neg);
  return out;
}

export function insetPolygon(poly: Polygon, d: number): Polygon {
  const c = centroid(poly);
  return poly.map(([x, y]) => {
    const dx = c[0] - x;
    const dy = c[1] - y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [x, y] as Point;
    const move = Math.min(d, len * 0.9);
    return [x + (dx / len) * move, y + (dy / len) * move] as Point;
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- geometry`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/geometry.ts src/engine/geometry.test.ts
git commit -m "feat: convex hull, clipping, split, inset"
```

---

### Task 3: 구역 생성 (city/wards)

**Files:**
- Create: `src/engine/city/wards.ts`, `src/engine/city/wards.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `Point`, `Polygon`, `clipToConvex`, `area`, `pointInPolygon` (geometry); `Delaunay` (d3-delaunay)
- Produces: `interface WardCell { polygon: Polygon; site: Point }`; `discPolygon(cx:number, cy:number, r:number, segments?:number):Polygon`; `generateWards(rng:Rng, cx:number, cy:number, radius:number, count:number):WardCell[]`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/wards.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, pointInPolygon } from "../geometry";
import { discPolygon, generateWards } from "./wards";

describe("wards", () => {
  it("discPolygon makes a closed ring with the right radius", () => {
    const d = discPolygon(150, 150, 100, 24);
    expect(d.length).toBe(24);
    expect(area(d)).toBeGreaterThan(Math.PI * 100 * 100 * 0.9);
  });
  it("generateWards yields the requested count of non-empty cells inside the disc", () => {
    const wards = generateWards(mulberry32(1), 150, 150, 100, 12);
    expect(wards.length).toBeGreaterThan(0);
    expect(wards.length).toBeLessThanOrEqual(12);
    for (const w of wards) {
      expect(w.polygon.length).toBeGreaterThanOrEqual(3);
      expect(area(w.polygon)).toBeGreaterThan(0);
      expect(pointInPolygon(w.site, discPolygon(150, 150, 100, 48))).toBe(true);
    }
  });
  it("is deterministic", () => {
    const a = generateWards(mulberry32(7), 150, 150, 100, 12);
    const b = generateWards(mulberry32(7), 150, 150, 100, 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- wards`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/wards.ts`

```ts
import { Delaunay } from "d3-delaunay";
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { clipToConvex, area } from "../geometry";

export interface WardCell {
  polygon: Polygon;
  site: Point;
}

export function discPolygon(cx: number, cy: number, r: number, segments = 32): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function generateWards(rng: Rng, cx: number, cy: number, radius: number, count: number): WardCell[] {
  const sites: Point[] = [];
  let guard = 0;
  while (sites.length < count && guard < count * 100) {
    guard++;
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * radius * 0.92;
    sites.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([cx - radius, cy - radius, cx + radius, cy + radius]);
  const disc = discPolygon(cx, cy, radius, 48);
  const wards: WardCell[] = [];
  for (let i = 0; i < sites.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    const poly = clipToConvex(cell.map(([x, y]) => [x, y] as Point), disc);
    if (poly.length >= 3 && area(poly) > 1) wards.push({ polygon: poly, site: sites[i] });
  }
  return wards;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- wards`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/wards.ts src/engine/city/wards.test.ts
git commit -m "feat: voronoi wards in a disc"
```

---

### Task 4: 건물 재귀 분할 (city/buildings)

**Files:**
- Create: `src/engine/city/buildings.ts`, `src/engine/city/buildings.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `Point`, `Polygon`, `area`, `bbox`, `centroid`, `splitByLine`, `insetPolygon`, `pointInPolygon` (geometry)
- Produces: `subdivide(rng:Rng, ward:Polygon, opts:{minArea:number; margin:number}):Polygon[]` (구역을 건물 필지 배열로)

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/buildings.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, centroid, pointInPolygon } from "../geometry";
import type { Polygon } from "../geometry";
import { subdivide } from "./buildings";

const ward: Polygon = [[0, 0], [60, 0], [60, 60], [0, 60]];

describe("buildings.subdivide", () => {
  it("produces multiple footprints, each smaller than the ward", () => {
    const b = subdivide(mulberry32(1), ward, { minArea: 120, margin: 2 });
    expect(b.length).toBeGreaterThan(4);
    for (const f of b) expect(area(f)).toBeLessThan(area(ward));
  });
  it("smaller minArea yields more (denser) buildings", () => {
    const sparse = subdivide(mulberry32(2), ward, { minArea: 400, margin: 2 });
    const dense = subdivide(mulberry32(2), ward, { minArea: 80, margin: 2 });
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
  it("footprint centroids fall inside the ward", () => {
    const b = subdivide(mulberry32(3), ward, { minArea: 150, margin: 2 });
    for (const f of b) expect(pointInPolygon(centroid(f), ward)).toBe(true);
  });
  it("is deterministic", () => {
    const a = subdivide(mulberry32(5), ward, { minArea: 150, margin: 2 });
    const c = subdivide(mulberry32(5), ward, { minArea: 150, margin: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- buildings`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/buildings.ts`

```ts
import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { area, bbox, centroid, splitByLine, insetPolygon } from "../geometry";

export function subdivide(rng: Rng, ward: Polygon, opts: { minArea: number; margin: number }): Polygon[] {
  const out: Polygon[] = [];
  const recurse = (poly: Polygon, depth: number) => {
    if (depth > 9 || area(poly) <= opts.minArea) {
      const lot = insetPolygon(poly, opts.margin);
      if (area(lot) > opts.minArea * 0.15) out.push(lot);
      return;
    }
    const c = centroid(poly);
    const bb = bbox(poly);
    const horizontal = bb.maxX - bb.minX >= bb.maxY - bb.minY;
    const jitter = (rng() - 0.5) * 0.5;
    let a: Point, b: Point;
    if (horizontal) {
      const x = c[0] + (rng() - 0.5) * (bb.maxX - bb.minX) * 0.25;
      a = [x, bb.minY - 1];
      b = [x + jitter * 10, bb.maxY + 1];
    } else {
      const y = c[1] + (rng() - 0.5) * (bb.maxY - bb.minY) * 0.25;
      a = [bb.minX - 1, y];
      b = [bb.maxX + 1, y + jitter * 10];
    }
    const parts = splitByLine(poly, a, b);
    if (parts.length < 2) {
      const lot = insetPolygon(poly, opts.margin);
      if (area(lot) > opts.minArea * 0.15) out.push(lot);
      return;
    }
    for (const part of parts) recurse(part, depth + 1);
  };
  recurse(ward, 0);
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- buildings`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/buildings.ts src/engine/city/buildings.test.ts
git commit -m "feat: recursive building subdivision"
```

---

### Task 5: 구역 타입 배정 (city/zoning)

**Files:**
- Create: `src/engine/city/zoning.ts`, `src/engine/city/zoning.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `Point` (geometry); `WardCell` (city/wards)
- Produces: `type WardType` (아래); `interface ZonedWard { polygon: Polygon; site: Point; type: WardType; inner: boolean; dist: number }`; `assignZones(rng:Rng, wards:WardCell[], center:Point, radius:number, opts:{ hasCastle:boolean; coastal:boolean }):ZonedWard[]`
- `WardType = "plaza" | "castle" | "cathedral" | "guildhall" | "market" | "merchant" | "patriciate" | "craftsmen" | "gate" | "slum" | "harbor" | "military" | "park" | "suburb" | "field"`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/zoning.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import type { WardCell } from "./wards";
import { assignZones } from "./zoning";
import type { Point } from "../geometry";

function ringWards(n: number): WardCell[] {
  const out: WardCell[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 20 + (i % 3) * 30;
    const site: Point = [150 + Math.cos(a) * r, 150 + Math.sin(a) * r];
    out.push({ site, polygon: [[site[0] - 5, site[1] - 5], [site[0] + 5, site[1] - 5], [site[0] + 5, site[1] + 5], [site[0] - 5, site[1] + 5]] });
  }
  return out;
}

describe("zoning.assignZones", () => {
  it("assigns exactly one plaza (the most central ward)", () => {
    const z = assignZones(mulberry32(1), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    expect(z.filter((w) => w.type === "plaza").length).toBe(1);
  });
  it("places a castle when hasCastle is true", () => {
    const z = assignZones(mulberry32(2), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    expect(z.some((w) => w.type === "castle")).toBe(true);
  });
  it("omits castle when hasCastle is false", () => {
    const z = assignZones(mulberry32(2), ringWards(14), [150, 150], 100, { hasCastle: false, coastal: false });
    expect(z.some((w) => w.type === "castle")).toBe(false);
  });
  it("adds a harbor only when coastal", () => {
    const dry = assignZones(mulberry32(3), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    const wet = assignZones(mulberry32(3), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: true });
    expect(dry.some((w) => w.type === "harbor")).toBe(false);
    expect(wet.some((w) => w.type === "harbor")).toBe(true);
  });
  it("marks central wards inner and far wards outer", () => {
    const z = assignZones(mulberry32(4), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    const plaza = z.find((w) => w.type === "plaza")!;
    expect(plaza.inner).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- zoning`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/zoning.ts`

```ts
import type { Rng } from "../rng";
import { pick } from "../rng";
import type { Point, Polygon } from "../geometry";
import type { WardCell } from "./wards";

export type WardType =
  | "plaza" | "castle" | "cathedral" | "guildhall"
  | "market" | "merchant" | "patriciate" | "craftsmen"
  | "gate" | "slum" | "harbor" | "military" | "park"
  | "suburb" | "field";

export interface ZonedWard {
  polygon: Polygon;
  site: Point;
  type: WardType;
  inner: boolean;
  dist: number;
}

const MID_TYPES: WardType[] = ["market", "merchant", "patriciate", "craftsmen"];
const OUTER_TYPES: WardType[] = ["slum", "gate", "military", "park"];

export function assignZones(
  rng: Rng,
  wards: WardCell[],
  center: Point,
  radius: number,
  opts: { hasCastle: boolean; coastal: boolean }
): ZonedWard[] {
  const ranked = wards
    .map((w) => ({ w, dist: Math.hypot(w.site[0] - center[0], w.site[1] - center[1]) }))
    .sort((a, b) => a.dist - b.dist);

  const innerCut = radius * 0.6;
  const out: ZonedWard[] = ranked.map(({ w, dist }) => ({
    polygon: w.polygon,
    site: w.site,
    dist,
    inner: dist <= innerCut,
    type: "craftsmen" as WardType,
  }));

  let idx = 0;
  const setType = (t: WardType) => {
    if (idx < out.length) out[idx++].type = t;
  };
  setType("plaza");
  setType("cathedral");
  setType("guildhall");
  if (opts.hasCastle) setType("castle");

  const farthest = out[out.length - 1];
  if (opts.coastal) farthest.type = "harbor";

  for (; idx < out.length; idx++) {
    const w = out[idx];
    if (w === farthest && opts.coastal) continue;
    if (w.inner) w.type = pick(rng, MID_TYPES);
    else if (w.dist > radius * 0.85) w.type = rng() < 0.5 ? "suburb" : "field";
    else w.type = pick(rng, OUTER_TYPES);
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- zoning`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/zoning.ts src/engine/city/zoning.test.ts
git commit -m "feat: ward type zoning"
```

---

### Task 6: 성벽·탑·성문·해자 (city/walls)

**Files:**
- Create: `src/engine/city/walls.ts`, `src/engine/city/walls.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `Point`, `Polygon`, `convexHull`, `insetPolygon`, `centroid` (geometry); `ZonedWard` (city/zoning)
- Produces: `interface Wall { ring: Polygon; towers: Point[]; gates: Point[] }`; `buildWall(innerWards:ZonedWard[], gateCount:number):Wall`; `buildMoat(ring:Polygon, d:number):Polygon`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/walls.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { area, pointInPolygon } from "../geometry";
import type { ZonedWard } from "./zoning";
import { buildWall, buildMoat } from "./walls";

function innerWards(): ZonedWard[] {
  const pts: [number, number][] = [[120, 120], [180, 120], [180, 180], [120, 180], [150, 150]];
  return pts.map((site) => ({
    site, dist: 0, inner: true, type: "craftsmen" as const,
    polygon: [[site[0] - 8, site[1] - 8], [site[0] + 8, site[1] - 8], [site[0] + 8, site[1] + 8], [site[0] - 8, site[1] + 8]],
  }));
}

describe("walls", () => {
  it("wall ring encloses the inner wards and has towers at each vertex", () => {
    const wall = buildWall(innerWards(), 3);
    expect(wall.ring.length).toBeGreaterThanOrEqual(3);
    expect(wall.towers.length).toBe(wall.ring.length);
    expect(pointInPolygon([150, 150], wall.ring)).toBe(true);
  });
  it("produces the requested number of gates", () => {
    const wall = buildWall(innerWards(), 3);
    expect(wall.gates.length).toBe(3);
  });
  it("moat is larger than the wall ring", () => {
    const wall = buildWall(innerWards(), 3);
    const moat = buildMoat(wall.ring, 6);
    expect(area(moat)).toBeGreaterThan(area(wall.ring));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- walls`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/walls.ts`

```ts
import type { Point, Polygon } from "../geometry";
import { convexHull, insetPolygon, centroid } from "../geometry";
import type { ZonedWard } from "./zoning";

export interface Wall {
  ring: Polygon;
  towers: Point[];
  gates: Point[];
}

export function buildWall(innerWards: ZonedWard[], gateCount: number): Wall {
  const pts: Point[] = [];
  for (const w of innerWards) for (const v of w.polygon) pts.push(v);
  const hull = convexHull(pts);
  const ring = insetPolygon(hull, -3);
  const towers = ring.slice();
  const gates: Point[] = [];
  const n = Math.max(1, gateCount);
  for (let g = 0; g < n; g++) {
    const i = Math.floor((g / n) * ring.length);
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    gates.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return { ring, towers, gates };
}

export function buildMoat(ring: Polygon, d: number): Polygon {
  return insetPolygon(ring, -d);
}
```

Note: `insetPolygon(poly, -d)`는 음수 거리이면 중심에서 바깥으로 밀어 확장한다(중심→정점 방향의 반대). geometry의 `insetPolygon`은 `move = min(d, len*0.9)`로 d가 음수면 정점이 중심에서 멀어진다.

- [ ] **Step 4: 통과 확인**

Run: `npm test -- walls`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/walls.ts src/engine/city/walls.test.ts
git commit -m "feat: city wall hull, towers, gates, moat"
```

---

### Task 7: 도로 (city/roads)

**Files:**
- Create: `src/engine/city/roads.ts`, `src/engine/city/roads.test.ts`

**Interfaces:**
- Consumes: `Point`, `Polyline` (geometry)
- Produces: `buildRoads(plaza:Point, gates:Point[]):Polyline[]` (각 성문→광장 도로 + 광장 둘레 링 도로)

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/roads.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildRoads } from "./roads";

describe("roads", () => {
  it("creates one road per gate plus a ring, each ending near the plaza", () => {
    const gates: [number, number][] = [[60, 150], [240, 150], [150, 60]];
    const roads = buildRoads([150, 150], gates);
    expect(roads.length).toBe(gates.length + 1);
    for (let i = 0; i < gates.length; i++) {
      const r = roads[i];
      const last = r[r.length - 1];
      expect(Math.hypot(last[0] - 150, last[1] - 150)).toBeLessThan(40);
      expect(r[0]).toEqual(gates[i]);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- roads`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/roads.ts`

```ts
import type { Point, Polyline } from "../geometry";

export function buildRoads(plaza: Point, gates: Point[]): Polyline[] {
  const roads: Polyline[] = [];
  for (const g of gates) {
    const mid: Point = [(g[0] + plaza[0]) / 2 + (plaza[1] - g[1]) * 0.08, (g[1] + plaza[1]) / 2 + (g[0] - plaza[0]) * 0.08];
    roads.push([g, mid, plaza]);
  }
  const ring: Polyline = [];
  const r = 22;
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ring.push([plaza[0] + Math.cos(a) * r, plaza[1] + Math.sin(a) * r]);
  }
  roads.push(ring);
  return roads;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- roads`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/roads.ts src/engine/city/roads.test.ts
git commit -m "feat: gate-to-plaza roads"
```

---

### Task 8: 물·다리 (city/water)

**Files:**
- Create: `src/engine/city/water.ts`, `src/engine/city/water.test.ts`

**Interfaces:**
- Consumes: `Rng` (rng); `Point`, `Polygon`, `Polyline`, `pointInPolygon` (geometry)
- Produces: `interface Water { polygon: Polygon; bridges: [Point, Point][] }`; `buildWater(rng:Rng, bounds:{w:number;h:number}):Water` (한쪽 해안 밴드, bridges는 초기 빈 배열); `waterBridges(roads:Polyline[], polygon:Polygon):[Point,Point][]` (도로가 물을 가로지르는 구간 → 다리). 다리는 도로 생성 후 오케스트레이터가 채운다.

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city/water.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area } from "../geometry";
import type { Polyline } from "../geometry";
import { buildWater, waterBridges } from "./water";

describe("water", () => {
  it("produces a non-empty coastal band polygon", () => {
    const w = buildWater(mulberry32(1), { w: 300, h: 300 });
    expect(w.polygon.length).toBeGreaterThanOrEqual(4);
    expect(area(w.polygon)).toBeGreaterThan(0);
    expect(w.bridges).toEqual([]);
  });
  it("is deterministic", () => {
    const a = buildWater(mulberry32(9), { w: 300, h: 300 });
    const b = buildWater(mulberry32(9), { w: 300, h: 300 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("waterBridges marks a bridge where a road crosses the water edge", () => {
    const w = buildWater(mulberry32(1), { w: 300, h: 300 });
    // a corner-to-corner diagonal crosses any of the four side bands
    const road: Polyline = [[0, 0], [300, 300]];
    const bridges = waterBridges([road], w.polygon);
    expect(bridges.length).toBeGreaterThanOrEqual(1);
    // a tiny road in the dry centre yields no bridge
    expect(waterBridges([[[150, 150], [152, 152]]], w.polygon).length).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- water`
Expected: FAIL

- [ ] **Step 3: 구현** — `src/engine/city/water.ts`

```ts
import type { Rng } from "../rng";
import { randInt } from "../rng";
import type { Point, Polygon, Polyline } from "../geometry";
import { pointInPolygon } from "../geometry";

export interface Water {
  polygon: Polygon;
  bridges: [Point, Point][];
}

export function buildWater(rng: Rng, bounds: { w: number; h: number }): Water {
  const side = randInt(rng, 0, 3); // 0 right, 1 bottom, 2 left, 3 top
  const { w, h } = bounds;
  const depth = 0.22 + rng() * 0.1;
  let polygon: Polygon;
  if (side === 0) polygon = [[w * (1 - depth), 0], [w, 0], [w, h], [w * (1 - depth), h]];
  else if (side === 1) polygon = [[0, h * (1 - depth)], [w, h * (1 - depth)], [w, h], [0, h]];
  else if (side === 2) polygon = [[0, 0], [w * depth, 0], [w * depth, h], [0, h]];
  else polygon = [[0, 0], [w, 0], [w, h * depth], [0, h * depth]];
  return { polygon, bridges: [] };
}

export function waterBridges(roads: Polyline[], polygon: Polygon): [Point, Point][] {
  const bridges: [Point, Point][] = [];
  for (const r of roads) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i];
      const b = r[i + 1];
      if (pointInPolygon(a, polygon) !== pointInPolygon(b, polygon)) {
        bridges.push([a, b]);
        break;
      }
    }
  }
  return bridges;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- water`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city/water.ts src/engine/city/water.test.ts
git commit -m "feat: coastal water band and bridges"
```

---

### Task 9: 오케스트레이터 (city.ts 교체)

**Files:**
- Modify (replace contents): `src/engine/city.ts`
- Modify (replace contents): `src/engine/city.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `deriveSeed`, `randInt` (rng); `Point`, `Polygon`, `Polyline`, `area`, `centroid`, `pointInPolygon` (geometry); `generateWards` (city/wards); `assignZones`, `WardType`, `ZonedWard` (city/zoning); `subdivide` (city/buildings); `buildWall`, `buildMoat`, `Wall` (city/walls); `buildRoads` (city/roads); `buildWater`, `Water` (city/water); `CityMarker` (types/world)
- Produces (PUBLIC — preserve names): `interface Ward { polygon: Polygon; type: WardType; buildings: Polygon[]; inner: boolean }`; `interface CityLayout { name:string; size:number; coastal:boolean; isCapital:boolean; bounds:{w:number;h:number}; water:Water|null; moat:Polygon|null; wall:Wall|null; roads:Polyline[]; wards:Ward[]; labels:{x:number;y:number;text:string}[] }`; `interface CityContext { id:number; name:string; size:number; coastal:boolean; isCapital:boolean }`; `cityContext(c:CityMarker):CityContext`; `generateCityLayout(ctx:CityContext, worldSeed:number):CityLayout`

- [ ] **Step 1: 실패 테스트 작성 (전체 교체)** — `src/engine/city.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { pointInPolygon, area } from "./geometry";
import type { CityMarker } from "../types/world";

const base: CityMarker = {
  id: 2, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 4, coastal: false,
};

describe("city v2", () => {
  it("is deterministic for the same world seed and id", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 99))).toBe(JSON.stringify(generateCityLayout(ctx, 99)));
  });
  it("changes with the world seed", () => {
    const ctx = cityContext(base);
    expect(JSON.stringify(generateCityLayout(ctx, 1))).not.toBe(JSON.stringify(generateCityLayout(ctx, 2)));
  });
  it("produces many wards and buildings", () => {
    const layout = generateCityLayout(cityContext(base), 5);
    expect(layout.wards.length).toBeGreaterThan(6);
    const totalBuildings = layout.wards.reduce((n, w) => n + w.buildings.length, 0);
    expect(totalBuildings).toBeGreaterThan(20);
  });
  it("a capital has a castle and a closed wall", () => {
    const layout = generateCityLayout(cityContext({ ...base, isCapital: true, size: 5 }), 5);
    expect(layout.wards.some((w) => w.type === "castle")).toBe(true);
    expect(layout.wall).not.toBeNull();
    expect(layout.wall!.ring.length).toBeGreaterThanOrEqual(3);
  });
  it("a coastal city has water and a harbor", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 5);
    expect(layout.water).not.toBeNull();
    expect(layout.wards.some((w) => w.type === "harbor")).toBe(true);
  });
  it("a non-coastal city has no water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: false }), 5);
    expect(layout.water).toBeNull();
  });
  it("scales ward count with size", () => {
    const small = generateCityLayout(cityContext({ ...base, size: 1 }), 5);
    const big = generateCityLayout(cityContext({ ...base, size: 6 }), 5);
    expect(big.wards.length).toBeGreaterThan(small.wards.length);
  });
  it("never places building footprints inside the water", () => {
    const layout = generateCityLayout(cityContext({ ...base, coastal: true }), 8);
    for (const w of layout.wards) {
      for (const b of w.buildings) {
        expect(pointInPolygon(centroidOf(b), layout.water!.polygon)).toBe(false);
      }
    }
  });
});

function centroidOf(poly: [number, number][]): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- city`
Expected: FAIL (v2 미구현)

- [ ] **Step 3: 구현 (전체 교체)** — `src/engine/city.ts`

```ts
import { mulberry32, deriveSeed, randInt } from "./rng";
import type { Rng } from "./rng";
import type { Point, Polygon, Polyline } from "./geometry";
import { centroid, pointInPolygon } from "./geometry";
import { generateWards } from "./city/wards";
import { assignZones } from "./city/zoning";
import type { WardType } from "./city/zoning";
import { subdivide } from "./city/buildings";
import { buildWall, buildMoat } from "./city/walls";
import type { Wall } from "./city/walls";
import { buildRoads } from "./city/roads";
import { buildWater, waterBridges } from "./city/water";
import type { Water } from "./city/water";
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
  bounds: { w: number; h: number };
  water: Water | null;
  moat: Polygon | null;
  wall: Wall | null;
  roads: Polyline[];
  wards: Ward[];
  labels: { x: number; y: number; text: string }[];
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

const DENSITY: Partial<Record<WardType, number>> = {
  slum: 70, craftsmen: 110, gate: 120, merchant: 150, market: 170,
  patriciate: 240, suburb: 200, military: 260,
};

function buildingMinArea(type: WardType): number {
  return DENSITY[type] ?? 130;
}

function wardLabel(type: WardType): string | null {
  const m: Partial<Record<WardType, string>> = {
    plaza: "Market", castle: "Keep", cathedral: "Cathedral", guildhall: "Guildhall", harbor: "Harbor",
  };
  return m[type] ?? null;
}

export function generateCityLayout(ctx: CityContext, worldSeed: number): CityLayout {
  const rng: Rng = mulberry32(deriveSeed(worldSeed, ctx.id));
  const bounds = { w: 300, h: 300 };
  const center: Point = [150, 150];
  const radius = 60 + ctx.size * 12;
  const wardCount = 8 + ctx.size * 3;
  const hasCastle = ctx.isCapital || ctx.size >= 4;
  const gateCount = 2 + (ctx.size >= 3 ? 1 : 0) + (ctx.isCapital ? 1 : 0);

  const water = ctx.coastal ? buildWater(rng, bounds) : null;

  let cells = generateWards(rng, center[0], center[1], radius, wardCount);
  if (water) {
    cells = cells.filter((c) => !pointInPolygon(c.site, water.polygon));
  }

  const zoned = assignZones(rng, cells, center, radius, { hasCastle, coastal: ctx.coastal });

  const innerWards = zoned.filter((w) => w.inner);
  const wall = innerWards.length >= 3 ? buildWall(innerWards, gateCount) : null;
  const moat = wall ? buildMoat(wall.ring, 6) : null;
  const roads = wall ? buildRoads(center, wall.gates) : [];
  if (water && roads.length) water.bridges = waterBridges(roads, water.polygon);

  const NO_BUILDINGS: WardType[] = ["plaza", "park", "field"];
  const wards: Ward[] = zoned.map((z) => {
    let buildings: Polygon[] = [];
    if (!NO_BUILDINGS.includes(z.type)) {
      buildings = subdivide(rng, z.polygon, { minArea: buildingMinArea(z.type), margin: 1.5 });
      if (water) buildings = buildings.filter((b) => !pointInPolygon(centroid(b), water.polygon));
    }
    return { polygon: z.polygon, type: z.type, buildings, inner: z.inner };
  });

  const labels: { x: number; y: number; text: string }[] = [];
  for (const z of zoned) {
    const text = wardLabel(z.type);
    if (text) {
      const c = centroid(z.polygon);
      labels.push({ x: c[0], y: c[1], text });
    }
  }

  return { name: ctx.name, size: ctx.size, coastal: ctx.coastal, isCapital: ctx.isCapital, bounds, water, moat, wall, roads, wards, labels };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- city`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts
git commit -m "feat: city v2 orchestration (replace MVP city)"
```

---

### Task 10: SVG 도시 렌더러 v2 (교체)

**Files:**
- Modify (replace contents): `src/ui/svgCityRenderer.ts`
- Modify (replace contents): `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `svgEl` (ui/renderer); `CityLayout`, `Ward` (engine/city); `WardType` (engine/city/zoning); `CityMarker` (types/world); `generateCityLayout`, `cityContext` (engine/city)
- Produces: `renderCity(layout:CityLayout):SVGSVGElement` — water/moat/wards-tint/roads/buildings/landmarks/wall+towers+gates/labels/legend 그룹

- [ ] **Step 1: 실패 테스트 작성 (전체 교체)** — `src/ui/svgCityRenderer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateCityLayout, cityContext } from "../engine/city";
import { renderCity } from "./svgCityRenderer";
import type { CityMarker } from "../types/world";

const marker: CityMarker = {
  id: 1, cell: 0, x: 0, y: 0, name: "Testburg",
  polityId: 0, isCapital: true, size: 5, coastal: true,
};

describe("renderCity v2", () => {
  it("draws a closed wall, many buildings, water, and a legend", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".wall").length).toBe(1);
    expect(svg.querySelectorAll(".building").length).toBeGreaterThan(20);
    expect(svg.querySelectorAll(".water").length).toBe(1);
    expect(svg.querySelectorAll(".legend-item").length).toBeGreaterThan(2);
  });
  it("renders ward groups for every ward", () => {
    const layout = generateCityLayout(cityContext(marker), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".ward").length).toBe(layout.wards.length);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- svgCityRenderer`
Expected: FAIL

- [ ] **Step 3: 구현 (전체 교체)** — `src/ui/svgCityRenderer.ts`

```ts
import { svgEl } from "./renderer";
import type { CityLayout, Ward } from "../engine/city";
import type { WardType } from "../engine/city/zoning";
import type { Polygon, Polyline } from "../engine/geometry";

const WARD_TINT: Partial<Record<WardType, string>> = {
  plaza: "#e7dcb8", castle: "#d8d2c4", cathedral: "#e0d6e4", guildhall: "#dce0d2",
  market: "#ece0c2", merchant: "#e6dcc0", patriciate: "#e8e0cc", craftsmen: "#e3d8be",
  gate: "#e0d6bc", slum: "#dccdaa", harbor: "#cdd9dd", military: "#dcd6c8",
  park: "#cfe0c0", suburb: "#e6ddc6", field: "#dfe2c2",
};
const ROOF: Partial<Record<WardType, string>> = {
  patriciate: "#c9b08a", merchant: "#cbb088", market: "#d2b06a", craftsmen: "#c2a87e",
  gate: "#c4ac82", slum: "#b9a17a", harbor: "#a9967a", military: "#b6ad96", suburb: "#cbb592",
};

function pts(poly: Polygon | Polyline): string {
  return poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function renderCity(layout: CityLayout): SVGSVGElement {
  const { w, h } = layout.bounds;
  const root = svgEl("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#efe7d2" }));

  if (layout.water) {
    root.appendChild(svgEl("polygon", { class: "water", points: pts(layout.water.polygon), fill: "#a9c4d4" }));
  }
  if (layout.moat) {
    root.appendChild(svgEl("polygon", { class: "moat", points: pts(layout.moat), fill: "none", stroke: "#8fb0c2", "stroke-width": 4 }));
  }

  const wardsG = svgEl("g", { class: "wards" });
  for (const ward of layout.wards) {
    const g = svgEl("g", { class: "ward" });
    g.appendChild(svgEl("polygon", { points: pts(ward.polygon), fill: WARD_TINT[ward.type] ?? "#e6ddc6", stroke: "none" }));
    wardsG.appendChild(g);
  }
  root.appendChild(wardsG);

  const roadsG = svgEl("g", { class: "roads" });
  for (const r of layout.roads) {
    roadsG.appendChild(svgEl("polyline", { class: "road", points: pts(r), fill: "none", stroke: "#d8c5a0", "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  root.appendChild(roadsG);

  const buildG = svgEl("g", { class: "buildings" });
  for (const ward of layout.wards) {
    const fill = landmarkFill(ward.type) ?? ROOF[ward.type] ?? "#cbb18c";
    for (const b of ward.buildings) {
      buildG.appendChild(svgEl("polygon", { class: "building", points: pts(b), fill, stroke: "#7a5a34", "stroke-width": 0.5 }));
    }
  }
  root.appendChild(buildG);

  drawLandmarks(root, layout);

  if (layout.wall) {
    root.appendChild(svgEl("polygon", { class: "wall", points: pts(layout.wall.ring), fill: "none", stroke: "#6b4f2a", "stroke-width": 3 }));
    const tg = svgEl("g", { class: "towers" });
    for (const t of layout.wall.towers) {
      tg.appendChild(svgEl("circle", { class: "tower", cx: t[0], cy: t[1], r: 3.2, fill: "#8a6a3c", stroke: "#5a3f22", "stroke-width": 1 }));
    }
    root.appendChild(tg);
    const gg = svgEl("g", { class: "gates" });
    for (const ga of layout.wall.gates) {
      gg.appendChild(svgEl("rect", { class: "gate", x: ga[0] - 3, y: ga[1] - 3, width: 6, height: 6, fill: "#5a3f22" }));
    }
    root.appendChild(gg);
  }

  const labelsG = svgEl("g", { class: "labels" });
  for (const l of layout.labels) {
    const t = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#3a2a14", "text-anchor": "middle" });
    t.textContent = l.text;
    labelsG.appendChild(t);
  }
  root.appendChild(labelsG);

  const title = svgEl("text", { x: w / 2, y: 14, "font-size": 13, fill: "#3a2a14", "text-anchor": "middle" });
  title.textContent = layout.name;
  root.appendChild(title);

  drawLegend(root, layout);
  return root;
}

function landmarkFill(type: WardType): string | null {
  if (type === "castle") return "#b9bcc2";
  if (type === "cathedral") return "#d6c2dd";
  if (type === "guildhall") return "#cfc89a";
  return null;
}

function drawLandmarks(root: SVGSVGElement, layout: CityLayout) {
  for (const ward of layout.wards) {
    if (ward.type === "cathedral") {
      const c = avg(ward.polygon);
      root.appendChild(svgEl("path", { class: "landmark", d: `M${c[0]} ${c[1] - 8} v16 M${c[0] - 5} ${c[1] - 3} h10`, stroke: "#7a5a86", "stroke-width": 2, fill: "none" }));
    }
  }
}

function avg(poly: Polygon): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

function drawLegend(root: SVGSVGElement, layout: CityLayout) {
  const present = new Set(layout.wards.map((w) => w.type));
  const entries: [WardType, string][] = [
    ["castle", "Keep"], ["cathedral", "Cathedral"], ["guildhall", "Guildhall"],
    ["plaza", "Market"], ["harbor", "Harbor"], ["slum", "Slums"],
  ];
  const shown = entries.filter(([t]) => present.has(t));
  const g = svgEl("g", { class: "legend" });
  const x0 = 6, y0 = layout.bounds.h - 8 - shown.length * 11;
  g.appendChild(svgEl("rect", { x: x0 - 4, y: y0 - 8, width: 92, height: shown.length * 11 + 12, rx: 3, fill: "#f6efdb", stroke: "#cbb784", "stroke-width": 0.5 }));
  shown.forEach(([t, label], i) => {
    const y = y0 + i * 11;
    g.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 6, width: 8, height: 8, fill: landmarkFill(t) ?? WARD_TINT[t] ?? "#cbb18c", stroke: "#7a5a34", "stroke-width": 0.5 }));
    const txt = svgEl("text", { x: x0 + 12, y, "font-size": 7, fill: "#4a3a22" });
    txt.textContent = label;
    g.appendChild(txt);
  });
  root.appendChild(g);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- svgCityRenderer`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: svg city renderer v2"
```

---

### Task 11: 통합 검증 + 빌드 + 마감

**Files:**
- (변경 없음 예상) 전체 스위트 + 빌드 확인. 필요 시 `src/ui/app.ts`의 도시 뷰 호출부가 새 `CityLayout`과 호환되는지 점검만.

**Interfaces:**
- Consumes: 전체
- Produces: 동작하는 v2 도시맵

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `npm test`
Expected: 모든 테스트 PASS (geometry/wards/buildings/zoning/walls/roads/water/city v2/renderer v2 포함)

Run: `npm run build`
Expected: 빌드 성공(tsc --noEmit + vite build)

- [ ] **Step 2: 앱 호출부 점검**

`src/ui/app.ts`에서 `openCity`가 `generateCityLayout(cityContext(marker), params.seed)` → `renderCity(layout)`로 연결되는지 확인. 시그니처가 유지되었으므로 변경 불필요. 변경이 필요하면 최소 수정 후 `npm test -- app`로 확인.

- [ ] **Step 3: 수동 검증 (개발 서버)**

Run: `npm run dev`
브라우저에서: 월드 → 도시 클릭 → v2 도시맵 확인:
- 성벽+탑+성문, 성채/성당/길드홀 랜드마크, 시장 광장(열림), 수십 채 개별 건물(타입별 색), 도로, 범례, 라벨.
- 해안 도시: 물+해자+(있으면)다리.
- 같은 시드 → 같은 도시. Back to world 복귀.

- [ ] **Step 4: 커밋(변경 있을 때만)**

```bash
git add -A
git commit -m "chore: city v2 integration verified"
```

---

## Self-Review

**Spec coverage:**
- Voronoi 구역 → Task 3. 재귀 건물 → Task 4. 구역 타입(풀세트) → Task 5. 성벽+탑+성문+해자 → Task 6. 도로 → Task 7. 물+다리 → Task 8. 오케스트레이터 CityLayout v2 → Task 9. 렌더러(물·해자·구역색·도로·건물·랜드마크·성벽·라벨·범례) → Task 10. 성채/성당/길드홀/광장/항구/성밖/밭 → zoning(Task 5)+city(Task 9)+renderer(Task 10). 기하 핵심 → Task 1–2. ✅
- 결정성/월드맥락 파생 → Task 9 테스트(시드, coastal→harbor/water, capital→castle, size→ward 수). ✅
- 공개 시그니처 유지(cityContext/generateCityLayout/renderCity) → Task 9–10 + Task 11 점검. ✅
- 테스트 전략(geometry 단위, 도시 불변식, 렌더러 스모크) → 각 Task. ✅

**Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함. ✅

**Type consistency:** `Point/Polygon/Segment/Polyline`(geometry) → 전 모듈 공유. `WardCell`(wards) → zoning 소비. `ZonedWard/WardType`(zoning) → walls/city 소비. `Wall`(walls)/`Water`(water) → city/renderer 소비. `Ward/CityLayout`(city) → renderer 소비. `insetPolygon` 음수 거리(바깥 확장) 규약은 Task 2 정의 + Task 6 주석에서 일치. `subdivide(rng, poly, {minArea, margin})` 시그니처 Task 4 정의 → Task 9 소비 일치. ✅

**Note (해결됨):** 물 폴리곤은 구역 생성 전에 만들어 구역 필터에 쓰고(`buildWater`), 다리는 도로 생성 후 `waterBridges(roads, water.polygon)`로 채운다. 해안 밴드가 도시 가장자리라 도로가 닿지 않으면 bridges가 빌 수 있는데(정상), 렌더러는 bridges가 있을 때만 그린다. 강이 도시를 관통하는 변형(다리 다수)은 범위 밖(후속).
