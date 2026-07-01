# 바이오미별 도시 형태 Phase 1 (숲·늪·사막) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내륙 도시가 바이오미(숲·늪·사막)에 순응하도록 — forestGrove(목책+수목)·marshStilt(고상+둑길)·desertOasis(중앙 오아시스) archetype과 전용 렌더를 추가한다.

**Architecture:** `CityContext.biome`를 흘려보내 `selectArchetype`가 바이오미로 내륙 archetype을 고른다. 각 archetype이 특징(벽 재질·식생·고상·오아시스·바탕색)을 지니고, `city.ts`가 이를 `CityLayout.features`로 계산(오아시스는 중앙 물체로 water에 추가, 늪은 물 위 건물 허용), 렌더러가 목책·수목·오아시스·말뚝으로 분기한다.

**Tech Stack:** TypeScript(strict), Vitest(+jsdom), 기존 라이브러리만. 신규 의존성 없음.

## Global Constraints

- TypeScript `strict`(`noUnusedLocals`). 신규 런타임 의존성 금지.
- 모든 무작위성은 시드 `rng`만(`Math.random()` 금지). 도시 상세는 `deriveSeed(worldSeed, cityId)` 결정적.
- 엔진(`src/engine/**`) DOM 비의존. 렌더는 `src/ui/**`.
- 공개 시그니처 유지: `cityContext(marker)`, `generateCityLayout(ctx,worldSeed)`, `renderCity(layout)` → `app.ts` 무변경.
- 바이오미 상수는 `src/engine/biome.ts`에서 재사용(재정의 금지): `TAIGA=2, TEMPERATE_FOREST=3, DESERT=5, TROPICAL=6, WETLAND=7`.
- 바이오미 도시는 내륙·비산악에만: 우선순위 coastal→coastalPort, elevation≥0.7→hilltopFortress, 그 외 biome.
- 도시 캔버스 300×300, 중심 (150,150), `radius = 60 + size*12`.

---

## File Structure

```
src/engine/city/archetypes.ts   3 archetype + 특징 필드 + biome 선택 (수정)
src/engine/city.ts               biome 전달·features 계산·오아시스·onStilts 필터 (수정)
src/ui/svgCityRenderer.ts        바탕색·목책·수목·오아시스·말뚝 렌더 (수정)
```

재사용(변경 없음): boundary·walls·water·wards·zoning·buildings·geometry, `engine/biome.ts` 상수.

---

### Task 1: 뼈대 — archetype 특징 + biome 선택 + CityContext.biome

**Files:**
- Modify: `src/engine/city/archetypes.ts`, `src/engine/city/archetypes.test.ts`
- Modify: `src/engine/city.ts` (CityContext·cityContext·selectArchetype 호출)

**Interfaces:**
- Consumes: `TAIGA`,`TEMPERATE_FOREST`,`DESERT`,`TROPICAL`,`WETLAND`(biome).
- Produces: `Archetype`에 `wallMaterial:"stone"|"timber"`,`vegetation:"trees"|"none"`,`onStilts:boolean`,`oasis:boolean`,`groundColor:string`; archetype id에 `forestGrove`/`marshStilt`/`desertOasis`; `selectArchetype(opts:{coastal,elevation,size,biome}):Archetype` (rng 인자 없음); `CityContext.biome:number`.

- [ ] **Step 1: 실패 테스트 작성 (전체 교체)** — `src/engine/city/archetypes.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { selectArchetype } from "./archetypes";
import { TAIGA, TEMPERATE_FOREST, TROPICAL, DESERT, WETLAND, GRASSLAND, TUNDRA } from "../biome";

const inland = { coastal: false, elevation: 0.5, size: 4 };

describe("selectArchetype", () => {
  it("coastal wins over biome", () => {
    expect(selectArchetype({ ...inland, coastal: true, biome: DESERT }).id).toBe("coastalPort");
  });
  it("high elevation wins over biome", () => {
    expect(selectArchetype({ ...inland, elevation: 0.8, biome: WETLAND }).id).toBe("hilltopFortress");
  });
  it("maps inland biomes to biome archetypes", () => {
    expect(selectArchetype({ ...inland, biome: WETLAND }).id).toBe("marshStilt");
    expect(selectArchetype({ ...inland, biome: DESERT }).id).toBe("desertOasis");
    for (const b of [TEMPERATE_FOREST, TAIGA, TROPICAL]) {
      expect(selectArchetype({ ...inland, biome: b }).id).toBe("forestGrove");
    }
    expect(selectArchetype({ ...inland, biome: GRASSLAND }).id).toBe("plainsMarket");
    expect(selectArchetype({ ...inland, biome: TUNDRA }).id).toBe("plainsMarket");
  });
  it("gives the new archetypes their signature traits", () => {
    const forest = selectArchetype({ ...inland, biome: TEMPERATE_FOREST });
    expect(forest.wallMaterial).toBe("timber");
    expect(forest.vegetation).toBe("trees");
    const marsh = selectArchetype({ ...inland, biome: WETLAND });
    expect(marsh.onStilts).toBe(true);
    const desert = selectArchetype({ ...inland, biome: DESERT });
    expect(desert.oasis).toBe(true);
    expect(desert.groundColor).toBe("#ece0c2");
  });
  it("existing archetypes keep stone defaults", () => {
    const plains = selectArchetype({ ...inland, biome: GRASSLAND });
    expect(plains.wallMaterial).toBe("stone");
    expect(plains.vegetation).toBe("none");
    expect(plains.onStilts).toBe(false);
    expect(plains.oasis).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- archetypes` → FAIL (biome 인자/새 archetype 없음)

- [ ] **Step 3: 구현 (전체 교체)** — `src/engine/city/archetypes.ts`

```ts
import { TAIGA, TEMPERATE_FOREST, TROPICAL, DESERT, WETLAND } from "../biome";

export type ArchetypeId =
  | "coastalPort" | "bridgeTown" | "hilltopFortress"
  | "meanderDefense" | "plainsMarket" | "ridgeLinear"
  | "forestGrove" | "marshStilt" | "desertOasis";
export type StreetField = "radial" | "grid" | "linear" | "organic";
export type WaterKind = "sea" | "river" | "lake" | "meander" | "none";
export type WallShape = "hull" | "rect" | "contour" | "riverbank";

export interface Archetype {
  id: ArchetypeId;
  streetField: StreetField;
  wallShape: WallShape;
  water: WaterKind;
  wallMaterial: "stone" | "timber";
  vegetation: "trees" | "none";
  onStilts: boolean;
  oasis: boolean;
  groundColor: string;
}

type Traits = Pick<Archetype, "wallMaterial" | "vegetation" | "onStilts" | "oasis" | "groundColor">;
const BASE: Traits = { wallMaterial: "stone", vegetation: "none", onStilts: false, oasis: false, groundColor: "#efe7d2" };

const TABLE: Record<ArchetypeId, Archetype> = {
  coastalPort: { id: "coastalPort", streetField: "organic", wallShape: "hull", water: "sea", ...BASE },
  bridgeTown: { id: "bridgeTown", streetField: "linear", wallShape: "riverbank", water: "river", ...BASE },
  hilltopFortress: { id: "hilltopFortress", streetField: "radial", wallShape: "contour", water: "none", ...BASE },
  meanderDefense: { id: "meanderDefense", streetField: "organic", wallShape: "riverbank", water: "meander", ...BASE },
  plainsMarket: { id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "lake", ...BASE },
  ridgeLinear: { id: "ridgeLinear", streetField: "linear", wallShape: "rect", water: "none", ...BASE },
  forestGrove: { id: "forestGrove", streetField: "organic", wallShape: "hull", water: "none", ...BASE, wallMaterial: "timber", vegetation: "trees", groundColor: "#e3e7d0" },
  marshStilt: { id: "marshStilt", streetField: "organic", wallShape: "riverbank", water: "meander", ...BASE, wallMaterial: "timber", onStilts: true, groundColor: "#dfe4dc" },
  desertOasis: { id: "desertOasis", streetField: "organic", wallShape: "hull", water: "none", ...BASE, oasis: true, groundColor: "#ece0c2" },
};

export function selectArchetype(
  opts: { coastal: boolean; elevation: number; size: number; biome: number }
): Archetype {
  if (opts.coastal) return TABLE.coastalPort;
  if (opts.elevation >= 0.7) return TABLE.hilltopFortress;
  switch (opts.biome) {
    case WETLAND: return TABLE.marshStilt;
    case DESERT: return TABLE.desertOasis;
    case TEMPERATE_FOREST:
    case TAIGA:
    case TROPICAL: return TABLE.forestGrove;
    default: return TABLE.plainsMarket;
  }
}
```

- [ ] **Step 4: city.ts 배선** — `src/engine/city.ts`

`CityContext` 인터페이스에 `elevation: number;` 다음 줄 추가:
```ts
  biome: number;
```
`cityContext` 반환 객체에 `elevation: c.elevation,` 다음에 `biome: c.biome,` 추가:
```ts
export function cityContext(c: CityMarker): CityContext {
  return { id: c.id, name: c.name, size: c.size, coastal: c.coastal, isCapital: c.isCapital, elevation: c.elevation, biome: c.biome };
}
```
`selectArchetype` 호출을 교체:
```ts
  const archetype = selectArchetype({ coastal: ctx.coastal, elevation: ctx.elevation, size: ctx.size, biome: ctx.biome });
```

- [ ] **Step 5: 통과 + 빌드** — Run: `npm test` → 전부 PASS(archetypes 새 테스트 포함; city.test의 `base`는 이미 `biome:4`라 통과). `npm run build` → tsc 클린(구 `pick`/`INLAND`/`Rng` import 제거됨, 미사용 없음).

- [ ] **Step 6: 커밋**

```bash
git add src/engine/city/archetypes.ts src/engine/city/archetypes.test.ts src/engine/city.ts
git commit -m "feat: biome-driven city archetype selection (forest/marsh/desert)"
```

---

### Task 2: CityFeatures 데이터 + 바탕색 + 목책 벽

**Files:**
- Modify: `src/engine/city.ts`, `src/engine/city.test.ts`
- Modify: `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `Archetype`의 특징 필드(Task 1).
- Produces: `CityFeatures { wallMaterial:"stone"|"timber"; trees:Point[]; onStilts:boolean; oasis:{center:Point;radius:number}|null; groundColor:string }` (city.ts export); `CityLayout.features:CityFeatures`.

`CityLayout`에 필드 추가 → 렌더러가 소비하므로 city.ts↔렌더러를 한 묶음(한 커밋).

- [ ] **Step 1: city.ts에 features 추가** — `src/engine/city.ts`

`CityLayout` 인터페이스에 `labels: ...;` 위(아무 곳)에 필드 추가:
```ts
  features: CityFeatures;
```
`Ward` 인터페이스 아래에 새 인터페이스:
```ts
export interface CityFeatures {
  wallMaterial: "stone" | "timber";
  trees: Point[];
  onStilts: boolean;
  oasis: { center: Point; radius: number } | null;
  groundColor: string;
}
```
`generateCityLayout`의 `return` 직전에 features 계산:
```ts
  const features: CityFeatures = {
    wallMaterial: archetype.wallMaterial,
    trees: [],
    onStilts: archetype.onStilts,
    oasis: null,
    groundColor: archetype.groundColor,
  };
```
`return` 객체에 `labels,` 다음 `features,` 추가(마지막 필드로):
```ts
    archetype, bounds, boundary, water, wall, moat, gateBridges, mainRoads, minorRoads, wards, parks, labels, features,
```

- [ ] **Step 2: city 테스트 추가** — `src/engine/city.test.ts`에 `describe("city organic", ...)` 안에 추가

```ts
  it("always exposes features with archetype-derived defaults", () => {
    const plains = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4 }), 5);
    expect(plains.features.wallMaterial).toBe("stone");
    expect(plains.features.groundColor).toBe("#efe7d2");
    expect(plains.features.trees).toEqual([]);
    const forest = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 3 }), 5);
    expect(forest.features.wallMaterial).toBe("timber");
    expect(forest.features.groundColor).toBe("#e3e7d0");
  });
```

- [ ] **Step 3: 렌더러 — 바탕색 + 목책** — `src/ui/svgCityRenderer.ts`

`boundary` ground 채움 색을 features로:
```ts
  clipped.appendChild(svgEl("polygon", { class: "boundary", points: pts(layout.boundary), fill: layout.features.groundColor }));
```
성벽 스트로크를 재질별로 — `if (layout.wall) {` 바로 다음에:
```ts
    const wallStroke = layout.features.wallMaterial === "timber" ? "#6b4f34" : "#43392d";
    const wallInner = layout.features.wallMaterial === "timber" ? "#8a6a44" : "#8a7a60";
```
그리고 wall-seg 두 줄의 `stroke: "#43392d"` → `stroke: wallStroke`, `stroke: "#8a7a60"` → `stroke: wallInner`로 교체.

- [ ] **Step 4: 렌더 테스트 추가** — `src/ui/svgCityRenderer.test.ts`

```ts
  it("tints the ground and uses timber walls for a forest city", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 3 }), 7);
    const svg = renderCity(layout);
    expect(svg.querySelector(".boundary")?.getAttribute("fill")).toBe("#e3e7d0");
    expect(svg.querySelector(".wall-seg")?.getAttribute("stroke")).toBe("#6b4f34");
  });
```
(주: `marker`는 이미 이 파일에 정의된 `CityMarker`. `biome`은 Task 3(world-biomes)에서 추가됐고 `marker`에 `biome:4`가 이미 있음 — spread override로 3 지정.)

- [ ] **Step 5: 통과 + 빌드** — Run: `npm test` → PASS. `npm run build` → 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: CityFeatures with biome ground tint and timber walls"
```

---

### Task 3: 숲 — 수목 (빈 땅 산포)

**Files:**
- Modify: `src/engine/city.ts`, `src/engine/city.test.ts`
- Modify: `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `bbox`(geometry), `features.trees`.
- Produces: `features.trees:Point[]` (forest에서 빈 땅 산포; 건물·도로·물·경계밖 회피); `.tree` 렌더.

- [ ] **Step 1: city.ts — 수목 산포** — `src/engine/city.ts`

import에 `bbox` 추가: `import { centroid, pointInPolygon, bbox } from "./geometry";`
`generateCityLayout` 안, features 계산 **직전**에 헬퍼 인라인 + 산포:
```ts
  const allBuildings = wards.flatMap((w) => w.buildings);
  const scatterTrees = (n: number): Point[] => {
    const out: Point[] = [];
    const bb = bbox(boundary);
    let tries = 0;
    while (out.length < n && tries < n * 10) {
      tries++;
      const p: Point = [bb.minX + rng() * (bb.maxX - bb.minX), bb.minY + rng() * (bb.maxY - bb.minY)];
      if (!pointInPolygon(p, boundary) || inWater(water, p) || nearRoad(p)) continue;
      if (allBuildings.some((b) => pointInPolygon(p, b))) continue;
      if (out.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < 6)) continue;
      out.push(p);
    }
    return out;
  };
```
features의 `trees: []` 를 교체:
```ts
    trees: archetype.vegetation === "trees" ? scatterTrees(18 + ctx.size * 4) : [],
```
(scatterTrees는 features 리터럴 위에서 정의 → features에서 호출. rng 소비는 이 고정 지점에서만 → 결정적.)

- [ ] **Step 2: city 테스트 추가** — `src/engine/city.test.ts`

```ts
  it("scatters trees on open ground for a forest city (none for plains)", () => {
    const forest = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 3 }), 7);
    expect(forest.features.trees.length).toBeGreaterThan(0);
    for (const t of forest.features.trees) {
      expect(pointInPolygon(t, forest.boundary)).toBe(true);
      expect(inWater(forest.water, t)).toBe(false);
    }
    const plains = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 4 }), 7);
    expect(plains.features.trees).toEqual([]);
  });
```

- [ ] **Step 3: 렌더러 — 수목 글리프** — `src/ui/svgCityRenderer.ts`

`root.appendChild(clipped);` **다음 줄**에 삽입(건물 위 캐노피, 경계로 클립):
```ts
  if (layout.features.trees.length) {
    const treesG = svgEl("g", { class: "trees", "clip-path": `url(#${clipId})` });
    for (const [x, y] of layout.features.trees) {
      treesG.appendChild(svgEl("circle", { class: "tree", cx: x, cy: y, r: 2.2, fill: "#6f9457", stroke: "#4c6b3c", "stroke-width": 0.4 }));
    }
    root.appendChild(treesG);
  }
```

- [ ] **Step 4: 렌더 테스트 추가** — `src/ui/svgCityRenderer.test.ts`

```ts
  it("draws a tree glyph per forest tree", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 3 }), 7);
    const svg = renderCity(layout);
    expect(svg.querySelectorAll(".tree").length).toBe(layout.features.trees.length);
    expect(svg.querySelectorAll(".tree").length).toBeGreaterThan(0);
  });
```

- [ ] **Step 5: 통과 + 빌드** — Run: `npm test` → PASS. `npm run build` → 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: forest city tree cover"
```

---

### Task 4: 사막 — 중앙 오아시스 (물체) + 녹지 제거

**Files:**
- Modify: `src/engine/city.ts`, `src/engine/city.test.ts`
- Modify: `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `archetype.oasis`, `features.oasis`.
- Produces: 사막 도시의 중앙 오아시스가 `water.bodies`에 추가(건물·도로 회피 공짜) + `features.oasis` 설정 + park 녹지 제거; `.palm` 렌더.

- [ ] **Step 1: city.ts — 오아시스 물체 + park 제거** — `src/engine/city.ts`

`const water = buildWater(rng, archetype.water, bounds);` **다음 줄**에 오아시스 추가:
```ts
  if (archetype.oasis) {
    const or = radius * 0.12;
    const oasisPoly: Polygon = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; oasisPoly.push([center[0] + Math.cos(a) * or, center[1] + Math.sin(a) * or]); }
    water.bodies.push(oasisPoly);
  }
```
park 처리에서 사막은 녹지 없음 — wards map의 park 분기 교체:
```ts
    if (z.type === "park") {
      if (!archetype.oasis) parks.push(z.polygon); // desert: no green parks
      return { polygon: z.polygon, type: z.type, buildings: [], inner: z.inner };
    }
```
features의 `oasis: null` 교체:
```ts
    oasis: archetype.oasis ? { center: [center[0], center[1]], radius: radius * 0.12 } : null,
```

- [ ] **Step 2: city 테스트 추가** — `src/engine/city.test.ts`

```ts
  it("gives a desert city a central oasis (water body) and no green parks", () => {
    const desert = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 5 }), 7);
    expect(desert.features.oasis).not.toBeNull();
    expect(desert.parks.length).toBe(0);
    // the oasis was added to the water bodies (so buildings/roads avoid it via the water filter)
    const o = desert.features.oasis!;
    const hasOasisBody = desert.water.bodies.some((body) => {
      const c = centroid(body);
      return Math.hypot(c[0] - o.center[0], c[1] - o.center[1]) < 3;
    });
    expect(hasOasisBody).toBe(true);
    // buildings never sit in water (oasis included)
    for (const w of desert.wards) for (const b of w.buildings) {
      expect(inWater(desert.water, centroid(b))).toBe(false);
    }
  });
```

- [ ] **Step 3: 렌더러 — 야자 글리프** — `src/ui/svgCityRenderer.ts`

오아시스 못 자체는 `water.bodies`로 이미 파랗게 그려지므로, 야자수만 추가. 수목 렌더 블록(Task 3) **다음**에 삽입:
```ts
  if (layout.features.oasis) {
    const { center: oc, radius: orr } = layout.features.oasis;
    const og = svgEl("g", { class: "oasis-palms", "clip-path": `url(#${clipId})` });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const px = oc[0] + Math.cos(a) * orr * 1.15, py = oc[1] + Math.sin(a) * orr * 1.15;
      og.appendChild(svgEl("path", { class: "palm", d: `M${px} ${py} l -2.5 -4 M${px} ${py} l 2.5 -4 M${px} ${py} l 0 -5`, stroke: "#5c8a4a", "stroke-width": 1, fill: "none", "stroke-linecap": "round" }));
    }
    root.appendChild(og);
  }
```

- [ ] **Step 4: 렌더 테스트 추가** — `src/ui/svgCityRenderer.test.ts`

```ts
  it("draws palms around a desert oasis", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 5 }), 7);
    const svg = renderCity(layout);
    expect(layout.features.oasis).not.toBeNull();
    expect(svg.querySelectorAll(".palm").length).toBeGreaterThan(0);
  });
```

- [ ] **Step 5: 통과 + 빌드** — Run: `npm test` → PASS. `npm run build` → 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: desert city central oasis, no green parks"
```

---

### Task 5: 늪 — 물 위 고상가옥 + 말뚝 (가장 위험, 마지막)

**Files:**
- Modify: `src/engine/city.ts`, `src/engine/city.test.ts`
- Modify: `src/ui/svgCityRenderer.ts`, `src/ui/svgCityRenderer.test.ts`

**Interfaces:**
- Consumes: `archetype.onStilts`, `features.onStilts`.
- Produces: onStilts 도시는 얕은 물 위 건물 허용(필터에서 `inWater` 스킵); `.stilt` 렌더.

- [ ] **Step 1: city.ts — 물 위 건물 허용** — `src/engine/city.ts`

건물 필터를 교체(물 조건을 onStilts일 때 완화):
```ts
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        const dryOk = archetype.onStilts || !inWater(water, c);
        return pointInPolygon(c, boundary) && dryOk && !nearRoad(c);
      });
```

- [ ] **Step 2: city 테스트 추가** — `src/engine/city.test.ts`

```ts
  it("lets a marsh city keep buildings over water (stilts)", () => {
    const marsh = generateCityLayout(cityContext({ ...base, coastal: false, elevation: 0.5, biome: 7 }), 7);
    expect(marsh.features.onStilts).toBe(true);
    const overWater = marsh.wards.flatMap((w) => w.buildings).filter((b) => inWater(marsh.water, centroid(b)));
    expect(overWater.length).toBeGreaterThan(0);
  });
```
(주: seed/biome 조합상 물이 도시를 관통해야 물 위 건물이 생긴다. marshStilt는 `water:"meander"`라 관통 물줄기가 있음. 만약 이 시드에서 0이면 시드를 바꿔 관통이 생기는 값으로 테스트를 맞춘다 — 구현자가 2~3개 시드 시도.)

- [ ] **Step 3: 렌더러 — 말뚝** — `src/ui/svgCityRenderer.ts`

수목/오아시스 렌더 블록 다음에 삽입(건물 밑 짧은 다리, 경계 클립):
```ts
  if (layout.features.onStilts) {
    const sg = svgEl("g", { class: "stilts", "clip-path": `url(#${clipId})` });
    for (const ward of layout.wards) for (const b of ward.buildings) {
      const c = avg(b);
      sg.appendChild(svgEl("line", { class: "stilt", x1: c[0], y1: c[1] + 1, x2: c[0], y2: c[1] + 4.5, stroke: "#6b5a44", "stroke-width": 0.8, "stroke-linecap": "round" }));
    }
    root.appendChild(sg);
  }
```

- [ ] **Step 4: 렌더 테스트 추가** — `src/ui/svgCityRenderer.test.ts`

```ts
  it("draws stilts under marsh buildings", () => {
    const layout = generateCityLayout(cityContext({ ...marker, coastal: false, elevation: 0.5, biome: 7 }), 7);
    const svg = renderCity(layout);
    expect(layout.features.onStilts).toBe(true);
    expect(svg.querySelectorAll(".stilt").length).toBeGreaterThan(0);
  });
```

- [ ] **Step 5: 통과 + 빌드** — Run: `npm test` → PASS. `npm run build` → 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/city.ts src/engine/city.test.ts src/ui/svgCityRenderer.ts src/ui/svgCityRenderer.test.ts
git commit -m "feat: marsh city stilt houses over water"
```

---

### Task 6: 통합 검증 + 육안 튜닝

**Files:** (변경은 튜닝 시에만)

- [ ] **Step 1: 전체 + 빌드** — Run: `npm test` → 전부 PASS. `npm run build` → 성공.

- [ ] **Step 2: 바이오미별 도시 지표 점검** — 임시 테스트로 seed 몇 개에서 각 바이오미(3=숲,5=사막,7=늪,4=초원) 도시의 archetype·features(trees 수·oasis·onStilts·물위건물 수)·건물 수를 로그로 확인 후 삭제:

```bash
cat > src/engine/__bc.test.ts <<'EOF'
import { it } from "vitest";
import { generateCityLayout, cityContext } from "./city";
import { inWater } from "./city/water";
import { centroid } from "./geometry";
import type { CityMarker } from "../types/world";
const mk = (b: number): CityMarker => ({ id:2,cell:0,x:0,y:0,name:"T",polityId:0,isCapital:true,size:4,coastal:false,elevation:0.5,biome:b });
it("biome city summary", () => {
  for (const [lbl,b] of [["forest",3],["desert",5],["marsh",7],["plains",4]] as [string,number][]) {
    const l = generateCityLayout(cityContext(mk(b)), 7);
    const blds = l.wards.reduce((n,w)=>n+w.buildings.length,0);
    const overW = l.wards.flatMap(w=>w.buildings).filter(x=>inWater(l.water,centroid(x))).length;
    console.log(`${lbl}: arch=${l.archetype.id} trees=${l.features.trees.length} oasis=${!!l.features.oasis} stilts=${l.features.onStilts} overWater=${overW} bldgs=${blds}`);
  }
});
EOF
npx vitest run __bc 2>&1 | grep -E "forest:|desert:|marsh:|plains:" ; rm -f src/engine/__bc.test.ts
```

- [ ] **Step 3: localhost 육안** — preview reload 후 도시 클릭. `preview_eval`로 `.tree`/`.palm`/`.stilt`/`.boundary`(fill)·목책 벽 색을 바이오미별로 확인. 서로 다른 바이오미의 도시를 몇 개 열어 형태 차이 확인.

- [ ] **Step 4: 필요 시 튜닝** — 수목/야자/말뚝 밀도·색, 바탕색이 어색하면 해당 상수만 조정 후 테스트 재확인·커밋:

```bash
git add -A && git commit -m "tune: biome city visuals from review"
```

---

## Self-Review

**Spec coverage:** biome 선택(우선순위+매핑)→T1. 3 archetype+특징→T1. features 모델+바탕색+목책→T2. 숲 수목(회피 산포)→T3. 사막 오아시스(물체)+녹지제거→T4. 늪 물위건물+말뚝→T5. 검증·튜닝→T6. 공개 시그니처 유지·`app.ts` 무변경→전 태스크. ✅

**Placeholder scan:** TBD/TODO 없음. 각 코드 스텝에 실제 코드. ✅

**Type consistency:** `selectArchetype(opts:{coastal,elevation,size,biome}):Archetype`(T1 정의→city.ts 호출 일치, rng 제거). `Archetype` 특징 필드(T1→T2 features→렌더). `CityFeatures`(T2 정의→T3 trees·T4 oasis·T5 onStilts 채움→렌더 소비). 바이오미 상수 biome.ts에서만. `CityContext.biome`(T1→cityContext). ✅

**Notes:** (1) T1이 `selectArchetype`에서 rng 인자·`pick`/`INLAND`를 제거 → 내륙 도시가 랜덤 pick 1 draw를 잃어 그 도시들의 드릴다운 레이아웃이 바뀐다(도시 레이아웃은 스냅샷 대상 아님 — 허용). (2) T2·T3·T4·T5는 각각 city.ts+렌더러를 함께 건드리지만 관심사가 달라(바탕·수목·오아시스·말뚝) 독립 리뷰 가능, 각기 한 커밋. (3) 늪(T5)은 물 관통 시드 의존 — 구현자가 2~3 시드로 물위건물>0을 확인.
