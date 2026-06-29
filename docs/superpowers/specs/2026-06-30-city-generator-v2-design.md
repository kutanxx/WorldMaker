# 도시 생성기 v2 (Watabou급 중세 도시) — 설계

작성일: 2026-06-30
상태: 설계 확정 (구현 계획 작성 전)
대상: Version A의 도시 드릴다운 교체. Phase 2(역사 시뮬)와는 독립.

## 1. 목표 / 배경

MVP 도시맵은 "성벽 + 네모 9개"로, 사용자 피드백상 (a) 건물이 뭔지 불분명, (b) 성 밖이 텅 빔, (c) 전반적으로 허접했다. 이를 **절차적 중세 도시 생성기**로 교체한다: Voronoi 구역을 재귀 분할해 수십~수백 채의 개별 건물, 유기적 골목, 탑·성문·해자 있는 성벽, 성채·성당·길드홀·시장 광장, 타입별 구역(상인·귀족·장인·성문가·빈민·항구·병영·공원), 성 밖 마을+밭, 강·해안+다리, 범례·라벨.

결정적: `deriveSeed(worldSeed, cityId)`로 같은 도시는 항상 같은 모습. **월드 맥락에서 파생**: 해안 도시→강·부두·다리, 수도/대도시→성채+구역 多, 규모→건물 수·반경.

근거 자료: 중세 도시는 성벽+성문+탑+해자, 시장·성당 광장에서 성문으로 방사하는 유기적 거리, 광장 둘레의 성당·길드홀·시장, 빽빽한 내성 주거 + 성 밖 농지. Watabou는 "block-centric"(구역→블록→골목→건물 재귀 분할) 방식과 역사 고증 구역 타입(Gate·Craftsmen·Market·Merchant·Patriciate·Slum 등)을 사용.

## 2. 생성 접근 (확정: A)

도시 디스크에 작은 Voronoi(`d3-delaunay` 재사용)로 **구역(ward)**을 나누고, 각 구역 폴리곤을 **재귀 분할**해 건물 필지를 만든다. 구역 경계 = 골목. 필지는 inset해 삼각형 건물 quirk를 피한다.

## 3. 아키텍처 — 엔진(순수)/UI 분리 유지

도시 엔진이 커지므로 폴더로 분리한다.

### 엔진 (`src/engine/`, 순수, DOM 비의존)
| 모듈 | 역할 |
|---|---|
| `geometry.ts` ⭐ | 폴리곤 기본기: 넓이, 중심, bbox, 점-포함, **안쪽 오프셋(inset)**, **직선으로 분할(split)**, 둘레. 도시 생성의 기하 핵심. 순수·집중 테스트 |
| `city/wards.ts` | 디스크에 Voronoi → 구역 폴리곤(디스크로 클립), 구역 간 인접 그래프 |
| `city/zoning.ts` | 구역에 타입 배정(광장 중앙, 성당·길드홀·성채 인접, 부유/장인/상인 중간, 빈민/성문가 외곽, 항구 물가) + 내성/성밖 구분 |
| `city/buildings.ts` | 구역 폴리곤 재귀 분할 → 건물 필지(타입별 밀도·크기), inset |
| `city/walls.ts` | 내성 구역 외곽 = 성벽 링 + 탑(꼭짓점) + 성문(주도로 교차) + **해자 링** |
| `city/roads.ts` | 시장·성당 광장 → 성문 방사 주도로 + 측면 연결로 |
| `city/water.ts` | 해안/강 밴드 + 다리 + 부두(해안 도시) |
| `city.ts` | 오케스트레이터 → 리치 `CityLayout` |

### UI (`src/ui/`, DOM)
| 모듈 | 역할 |
|---|---|
| `svgCityRenderer.ts` v2 | 물·다리 → 해자 → 구역 색조 → 도로 → 건물(타입별 지붕색) → 광장 스톨 → 랜드마크(성채 크레늘레이션+탑 / 성당 십자 / 길드홀) → 성벽+탑+성문 → 성밖 건물+밭 → 라벨 → 범례 |

## 4. 생성 파이프라인

1. **규모**: ctx(size 1–6, isCapital, coastal) → 구역 수, 디스크 반경, 성문 수, 성채 유무(수도/대도시), 항구 유무(해안).
2. **구역**: 디스크 내 지터 점 + Voronoi → 구역 폴리곤(디스크로 클립).
3. **물**: coastal이면 한쪽을 해안/강으로 잘라 물 구역 제거 + 물가 구역을 harbor 후보로.
4. **랜드마크**: 중앙 구역=plaza(열린 시장광장), 인접 큰 구역=castle(조건부)·cathedral·guildhall.
5. **타입 배정**(`zoning`): 광장 근처→merchant/market, 중간→craftsmen/patriciate, 외곽→slum/gate, 물가→harbor, 일부→park.
6. **내성/성밖**: 핵심 구역=내성, 외곽 일부=성밖(suburb)+farm.
7. **성벽**: 내성 구역 합집합 외곽(inset) = 링, 꼭짓점에 탑, 주도로 교차점에 성문, 바깥에 해자.
8. **도로**: 광장↔성문 주도로 + 측면 연결로.
9. **건물**(`buildings`): 각 빌드 구역을 재귀 분할→필지(타입별 밀도/크기), inset. plaza는 열어두고 스톨 몇 개. castle은 큰 keep+탑.
10. **성밖**: suburb 구역에 도로변 집 클러스터, farm 구역에 밭 필지.
11. **라벨/범례**: 주요 구역 라벨(시장·성채·성당·길드홀·항구) + 색→타입 범례.

## 5. 데이터 (`CityLayout` v2)

```
CityLayout {
  name, size, coastal, isCapital,
  bounds: { w, h },
  water: { polygon: Point[], bridges: Segment[] } | null,
  moat: Point[] | null,
  wall: { ring: Point[], towers: Point[], gates: Point[] } | null,
  roads: Polyline[],
  wards: Ward[],
  labels: { x, y, text }[]
}
Ward {
  polygon: Point[],
  type: WardType,
  buildings: Polygon[],   // 개별 건물 필지 (plaza/park/field는 비거나 특수)
  inner: boolean,         // 성벽 안쪽 여부
}
WardType =
  | "plaza" | "castle" | "cathedral" | "guildhall"
  | "market" | "merchant" | "patriciate" | "craftsmen"
  | "gate" | "slum" | "harbor" | "military" | "park"
  | "suburb" | "field"
```

타입별 건물 스타일(렌더러 + buildings 밀도):
- patriciate: 크고 듬성한 저택 / merchant: 중대형 상점+집 / craftsmen: 중밀도 작업장 / gate: 여관·선술집(중) / slum: 작고 매우 빽빽 / market: 광장 둘레 스톨 / harbor: 물가 창고+부두 / military: 큰 막사 블록 / park: 녹지+소수 / suburb: 도로변 듬성 / field: 밭 필지(건물 없음).

## 6. MVP 범위 (YAGNI)

포함: §4–5 전부 — Voronoi 구역, 타입 배정, 재귀 건물, 성벽+탑+성문+해자, 성채·성당·길드홀·광장, market/merchant/patriciate/craftsmen/gate/slum/harbor/military/park, 성밖 suburb+farm, 강/해안+다리, 라벨+범례.
제외(나중): 거리 이름, 개별 나무 묘사, 인구·상점 데이터 패널, 양피지 텍스처 고급화, 도시 내 줌/패닝.

## 7. 테스트 전략

- `geometry`(순수)가 핵심: 넓이(알려진 도형), 중심, **inset이 안쪽으로 작아짐**, **split이 두 폴리곤으로 면적 보존**, 점-포함 경계. 결정성.
- 도시: 결정성(같은 (worldSeed,cityId) → 같은 레이아웃 직렬화 해시), 불변식 —
  - 모든 건물이 자기 구역 폴리곤 안.
  - 성벽 링이 폐곡선이고 탑 수 = 링 꼭짓점 수, 성문 ≥ 1.
  - 구역 수가 규모에 비례(작은<큰), 수도→castle 존재, 해안→water+harbor 존재.
  - 물 위에 건물 없음. 내성 구역은 성벽 안.
- 렌더러: jsdom 스모크(물/해자/성벽/도로/건물 그룹 존재, 건물 수>임계, 범례 존재, 랜드마크 클래스 존재).

## 8. 규모 / 진행

기하 위주의 Phase 1급 작업(약 12–16 태스크). superpowers 서브에이전트 주도 개발로 진행. 완료 후 기존 `engine/city.ts`·`ui/svgCityRenderer.ts`(MVP 버전)를 v2로 교체하고 앱 드릴다운은 그대로 연결(같은 `CityLayout` 소비 지점, 인터페이스 확장).

## 9. 기존 코드와의 관계

- `engine/city.ts`: MVP의 `District`/단순 `CityLayout`을 위 리치 `CityLayout`으로 교체. `generateCityLayout(ctx, worldSeed)`/`cityContext(marker)` 시그니처는 유지(앱 호출부 불변).
- `ui/svgCityRenderer.ts`: `renderCity(layout)` 시그니처 유지, 내부 전면 교체.
- `geometry.ts`는 신규. `d3-delaunay`는 이미 의존성(추가 의존성 없음).
- 앱(`ui/app.ts`)·월드 렌더러·엔진 나머지는 변경 없음.
