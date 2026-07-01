# 성 밖 교외(Faubourg) Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 성벽 밖에 교외(faubourg)를 추가한다 — 성문에서 뻗은 진입로를 따라 늘어선 집(리본) + 소수 구조물(물레방아/풍차)을, 기존 캔버스 여백 안에 기회주의적으로.

**Architecture:** `city.ts`가 성벽·성문·성내 건물을 모두 계산한 뒤(고정 rng 지점), `wall.gates`에서 바깥으로 진입로를 연장하고 그 길을 따라 `boundary` 밖·물 밖·캔버스 안에 작은 건물을 배치하며, 물레방아/풍차 구조물을 하나 놓는다. 렌더러는 이를 `boundary` clip 밖의 별도 `.environs` 그룹으로 그린다.

**Tech Stack:** TypeScript(strict), Vitest(+jsdom). 기존 라이브러리만, 신규 의존성·모듈 없음.

## Global Constraints

- TypeScript `strict`(`noUnusedLocals`). 신규 런타임 의존성 금지.
- 모든 무작위성은 시드 `rng`만(`Math.random()` 금지). 교외 rng는 **성내 생성이 모두 끝난 뒤** 소비 → 성내 레이아웃 불변(결정성).
- 엔진(`src/engine/**`) DOM 비의존. 렌더는 `src/ui/**`.
- 공개 시그니처 유지: `cityContext`/`generateCityLayout`/`renderCity` → `app.ts` 무변경.
- viewBox `0 0 300 300` 유지. 도시·바다 로직 불변. 교외는 기존 boundary→가장자리 여백 안에만.
- 교외는 boundary clip 밖 별도 그룹으로 렌더(성 밖에 보이게).

---

## File Structure

```
src/engine/city.ts             교외 생성 + CityLayout 3필드 (수정)
src/ui/svgCityRenderer.ts       비클립 .environs 그룹 렌더 (수정)
```

재사용: `bbox`·`pointInPolygon`·`centroid`(geometry), `inWater`(water), `wall.gates`. 새 모듈 없음.

---

### Task 1: 교외 생성 (진입로·리본·구조물)

**Files:**
- Modify: `src/engine/city.ts`, `src/engine/city.test.ts`

**Interfaces:**
- Consumes: `wall.gates:Point[]`, `boundary:Polygon`, `water`, `centroid`/`pointInPolygon`/`bbox`(이미 import), `inWater`(이미 import).
- Produces: `interface Outwork { type:"watermill"|"windmill"; at:Point; angle:number }`; `CityLayout`에 `suburbRoads:Polyline[]`, `suburbs:Polygon[]`, `outworks:Outwork[]`.

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/city.test.ts`의 `describe("city organic", ...)` 안에 추가

```ts
  it("builds extramural suburbs (houses + road) outside the wall for a roomy city", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    expect(l.suburbs.length).toBeGreaterThan(0);
    expect(l.suburbRoads.length).toBeGreaterThan(0);
    for (const b of l.suburbs) {
      const c = centroid(b);
      expect(pointInPolygon(c, l.boundary)).toBe(false); // extramural
      expect(inWater(l.water, c)).toBe(false);
      expect(c[0]).toBeGreaterThan(0); expect(c[0]).toBeLessThan(300);
      expect(c[1]).toBeGreaterThan(0); expect(c[1]).toBeLessThan(300);
    }
  });
  it("places an outwork (mill) outside the boundary", () => {
    const l = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    for (const o of l.outworks) {
      expect(["watermill", "windmill"]).toContain(o.type);
      expect(pointInPolygon(o.at, l.boundary)).toBe(false);
    }
  });
```
주: 이 테스트는 seed 7·size 4·초원(plainsMarket)이 여백이 있어 교외가 생긴다고 가정한다. **만약 seed 7에서 `suburbs.length===0`이면**(여백 부족) 구현자는 교외가 실제로 생기는 시드(예: 3, 5, 11, 13, 2)로 두 테스트의 시드를 함께 바꾼다. `suburbs>0`을 약화하지 말 것 — 성 밖 집이 생김을 증명해야 한다.

- [ ] **Step 2: 실패 확인** — Run: `npm test -- "engine/city"` → FAIL (`suburbs`/`suburbRoads`/`outworks` 없음)

- [ ] **Step 3: 구현** — `src/engine/city.ts`

`Ward` 인터페이스 근처(예: `CityFeatures` 위나 아래)에 `Outwork` 인터페이스 추가:
```ts
export interface Outwork { type: "watermill" | "windmill"; at: Point; angle: number; }
```
`CityLayout` 인터페이스에 `features: CityFeatures;` 다음(또는 `labels` 근처)에 3필드 추가:
```ts
  suburbRoads: Polyline[];
  suburbs: Polygon[];
  outworks: Outwork[];
```
`generateCityLayout`의 `const features: CityFeatures = {...};` **다음**(return 직전)에 교외 생성 삽입:
```ts
  // ---- extramural suburbs (faubourg) + outworks: OUTSIDE the wall, in the canvas margin ----
  const inCanvas = (p: Point) => p[0] > 3 && p[0] < bounds.w - 3 && p[1] > 3 && p[1] < bounds.h - 3;
  const suburbRoads: Polyline[] = [];
  const suburbs: Polygon[] = [];
  const gateBudget = 1 + Math.floor(ctx.size / 2);
  let gatesUsed = 0;
  for (const g of wall.gates) {
    if (gatesUsed >= gateBudget) break;
    const dx = g[0] - center[0], dy = g[1] - center[1];
    const gl = Math.hypot(dx, dy) || 1;
    const ux = dx / gl, uy = dy / gl;        // outward unit
    const nx = -uy, ny = ux;                  // perpendicular unit
    const start: Point = [g[0] + ux * 8, g[1] + uy * 8]; // clear wall + moat
    const distX = ux > 0.001 ? (bounds.w - 3 - start[0]) / ux : ux < -0.001 ? (3 - start[0]) / ux : Infinity;
    const distY = uy > 0.001 ? (bounds.h - 3 - start[1]) / uy : uy < -0.001 ? (3 - start[1]) / uy : Infinity;
    const room = Math.min(distX, distY);
    if (room < 14 || inWater(water, start) || !inCanvas(start)) continue;
    const L = Math.min(38, room - 4);
    const end: Point = [start[0] + ux * L, start[1] + uy * L];
    suburbRoads.push([[g[0], g[1]], end]);
    gatesUsed++;
    for (let d = 6; d < L; d += 9) {
      const prob = 0.9 - (d / L) * 0.5;
      for (const side of [-1, 1]) {
        if (rng() > prob) continue;
        const off = 4 + rng() * 4;
        const cx = start[0] + ux * d + nx * side * off;
        const cy = start[1] + uy * d + ny * side * off;
        if (pointInPolygon([cx, cy], boundary) || inWater(water, [cx, cy]) || !inCanvas([cx, cy])) continue;
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
  const outworks: Outwork[] = [];
  const nearWater = (p: Point) =>
    inWater(water, [p[0] + 4, p[1]]) || inWater(water, [p[0] - 4, p[1]]) ||
    inWater(water, [p[0], p[1] + 4]) || inWater(water, [p[0], p[1] - 4]);
  for (let tries = 0; tries < 80 && outworks.length === 0; tries++) {
    const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
    if (pointInPolygon(p, boundary) || inWater(water, p) || !inCanvas(p)) continue;
    if (nearWater(p)) outworks.push({ type: "watermill", at: p, angle: rng() * Math.PI * 2 });
  }
  for (let tries = 0; tries < 80 && outworks.length === 0; tries++) {
    const p: Point = [3 + rng() * (bounds.w - 6), 3 + rng() * (bounds.h - 6)];
    if (pointInPolygon(p, boundary) || inWater(water, p) || !inCanvas(p)) continue;
    if (suburbs.some((b) => { const c = centroid(b); return Math.hypot(c[0] - p[0], c[1] - p[1]) < 10; })) continue;
    outworks.push({ type: "windmill", at: p, angle: rng() * Math.PI * 2 });
  }
```
`return` 객체 끝에 `features,` 다음 3필드 추가:
```ts
    archetype, bounds, boundary, water, wall, moat, gateBridges, mainRoads, minorRoads, wards, parks, labels, features, suburbRoads, suburbs, outworks,
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- "engine/city"`. `suburbs.length>0`이면 PASS. 0이면 위 주석대로 시드 교체 후 재확인. 그 뒤 `npm test`(전체) + `npm run build` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts
git commit -m "feat: extramural suburbs (faubourg ribbon + mill) generation"
```

---

### Task 2: 교외 렌더 (비클립 .environs 그룹)

**Files:**
- Modify: `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `layout.suburbRoads`, `layout.suburbs`, `layout.outworks`(Task 1); `svgEl`, `pts`.
- Produces: `.environs` 그룹(비클립)에 `.suburb-road`/`.suburb`/`.outwork`.

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/svgCityRenderer.test.ts`에 추가

```ts
  it("draws extramural suburbs outside the boundary clip", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 4, size: 4 }), 7);
    const svg = renderCity(layout);
    const env = svg.querySelector(".environs");
    expect(env).not.toBeNull();
    expect(env!.closest("[clip-path]")).toBeNull(); // NOT inside the boundary clip
    expect(svg.querySelectorAll(".environs .suburb").length).toBe(layout.suburbs.length);
    expect(svg.querySelectorAll(".environs .suburb-road").length).toBe(layout.suburbRoads.length);
    expect(svg.querySelectorAll(".environs .outwork").length).toBe(layout.outworks.length);
  });
```
주: Task 1과 같은 시드를 쓴다(교외가 실제로 생기는 시드). Task 1에서 시드를 바꿨다면 여기도 맞춘다. `marker`에 `size:4`가 없으면 spread로 지정(위처럼).

- [ ] **Step 2: 실패 확인** — Run: `npm test -- svgWorldRenderer` 아님 → `npm test -- svgCityRenderer` → FAIL (`.environs` 없음)

- [ ] **Step 3: 구현** — `src/ui/svgCityRenderer.ts`

물 바디 렌더 루프(`for (const body of layout.water.bodies) { ... }`) **다음**, 성내 `clipped` 그룹을 만들기 전에 비클립 교외 그룹 삽입:
```ts
  const env = svgEl("g", { class: "environs" });
  for (const r of layout.suburbRoads) {
    env.appendChild(svgEl("polyline", { class: "suburb-road", points: pts(r), fill: "none", stroke: "#c9bb96", "stroke-width": 1.6, "stroke-linecap": "round" }));
  }
  for (const b of layout.suburbs) {
    env.appendChild(svgEl("polygon", { class: "suburb", points: pts(b), fill: "#e0d6c0", stroke: "#9a8a70", "stroke-width": 0.4 }));
  }
  for (const o of layout.outworks) {
    const [x, y] = o.at;
    if (o.type === "windmill") {
      env.appendChild(svgEl("circle", { class: "outwork", cx: x, cy: y, r: 1.6, fill: "#8a7858" }));
      const c = Math.cos(o.angle), s = Math.sin(o.angle), r = 4;
      env.appendChild(svgEl("path", { class: "outwork-sails", d: `M${(x - c * r).toFixed(1)} ${(y - s * r).toFixed(1)} L${(x + c * r).toFixed(1)} ${(y + s * r).toFixed(1)} M${(x + s * r).toFixed(1)} ${(y - c * r).toFixed(1)} L${(x - s * r).toFixed(1)} ${(y + c * r).toFixed(1)}`, stroke: "#6b5a44", "stroke-width": 0.8, fill: "none" }));
    } else {
      env.appendChild(svgEl("rect", { class: "outwork", x: x - 2.5, y: y - 2, width: 5, height: 4, fill: "#c9a86a", stroke: "#8a6a44", "stroke-width": 0.5 }));
      env.appendChild(svgEl("circle", { class: "outwork-wheel", cx: x + 3, cy: y + 1, r: 2, fill: "none", stroke: "#6b5a44", "stroke-width": 0.7 }));
    }
  }
  root.appendChild(env);
```
(주: 이 `env` 그룹은 clip-path를 안 붙인다 — 성 밖에 보여야 함. viewBox가 캔버스 밖을 자동으로 자른다. `pts` 헬퍼는 파일 상단에 이미 존재.)

- [ ] **Step 4: 통과 + 빌드** — Run: `npm test` → 전부 PASS. `npm run build` → 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: render extramural suburbs and mills outside the wall"
```

---

### Task 3: 통합 검증 + 육안 튜닝

**Files:** (변경은 튜닝 시에만)

- [ ] **Step 1: 전체 + 빌드** — Run: `npm test` → PASS. `npm run build` → 성공.

- [ ] **Step 2: 교외 분포 점검** — 임시 테스트로 여러 크기·바이오미·시드에서 `suburbs`/`suburbRoads`/`outworks` 개수를 로그로 확인 후 삭제(작은 도시는 0, 중형은 >0인지):

```bash
cat > src/engine/__sub.test.ts <<'EOF'
import { it } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import type { CityMarker } from "../types/world";
const mk = (o: Partial<CityMarker>): CityMarker => ({ id:2,cell:0,x:0,y:0,name:"T",polityId:0,isCapital:true,size:4,coastal:false,elevation:0.5,biome:4,...o });
it("suburb summary", () => {
  for (const [lbl,o] of [["plains s2",{size:2}],["plains s4",{size:4}],["plains s6",{size:6}],["forest s4",{biome:3}],["coast s4",{coastal:true}]] as [string,Partial<CityMarker>][])
    for (const s of [3,7,11]) {
      const l = generateCityLayout(cityContext(mk(o)), s);
      console.log(`${lbl} seed${s}: roads=${l.suburbRoads.length} houses=${l.suburbs.length} outworks=${l.outworks.map(x=>x.type).join("/")||"-"}`);
    }
});
EOF
npx vitest run __sub 2>&1 | grep "seed" ; rm -f src/engine/__sub.test.ts
```

- [ ] **Step 3: localhost 육안** — preview reload 후 도시 클릭. `preview_eval`로 `.environs .suburb`/`.suburb-road`/`.outwork` 개수와 성벽 밖 위치를 확인. 여러 도시를 열어 성 밖 집·물레방아/풍차가 보이는지, 성내와 겹치지 않는지 확인.

- [ ] **Step 4: 필요 시 튜닝** — 리본 밀도(`prob`, 간격 9)·집 크기(`hw/hh`)·연장 길이(38)·구조물 글리프가 어색하면 해당 상수만 조정, 테스트 재확인 후 커밋:

```bash
git add -A && git commit -m "tune: extramural suburb density/visuals from review"
```

---

## Self-Review

**Spec coverage:** 진입로 연장(성문별 기회주의·여백 스킵)·리본 건물(문 근처 밀집·밖으로 희박·물/캔버스/boundary/겹침 회피)→T1. 구조물(물레방아 near-water else 풍차)→T1. `CityLayout` 3필드→T1. 비클립 `.environs` 렌더(진입로·집·구조물 글리프)→T2. 검증·튜닝→T3. viewBox 300 유지·성내 rng 불변(교외는 끝에서 소비)·공개 시그니처 유지→전 태스크. ✅

**Placeholder scan:** TBD/TODO 없음. 각 코드 스텝에 실제 코드. 시드 의존은 T1 주석에 명시적 대체 절차. ✅

**Type consistency:** `Outwork{type,at,angle}`(T1 정의→렌더 소비). `CityLayout` 3필드(T1→T2). `inCanvas`/`nearWater`는 city.ts 지역. `Point`/`Polygon`/`Polyline` from geometry(이미 import). `bbox`는 이 태스크에서 미사용이면 추가 안 함(scatterTrees가 이미 씀). ✅

**Notes:** (1) 교외 rng는 `features`(scatterTrees 포함) 다음 = 성내 생성 이후라 성내 레이아웃 불변. (2) 큰·선형 도시는 여백이 좁아 교외가 성기거나 0 — 스펙 §2의 인정된 한계(견고하게 빈 배열). (3) T1/T2는 교외가 실제로 생기는 시드를 공유해야 함(T1이 시드를 바꾸면 T2도 동일 시드로).
