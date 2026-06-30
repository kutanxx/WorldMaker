# 유기적 도시 형태 + 물 도시 특화 — 설계

작성일: 2026-06-30
상태: 설계 확정 (Phase 1 구현 계획 작성 전)
대상: 도시 드릴다운(거리망 도시, 이미 merged)을 확장. 역사 시뮬과는 독립.

## 1. 정체성 / 목표

사용자 피드백(직접 렌더 보고): 현재 도시는 (a) 도로가 "구불구불한 직선"이지 진짜 곡선이 아니고, (b) 바다/땅 경계가 직선이며, (c) 도시 외곽이 원/사각뿐 — 실제 중세 도시는 지형 따라 불규칙했다. 또 (d) 물을 낀 도시는 항구 같은 해양 이점 요소가 있어야 한다.

**목표: "지형에 순응하는 유기적 형태"의 중세 거리 도시 + 물 도시의 해양 특화 요소.**

## 2. 유기적 도시 형태 (Phase 1)

### 2.1 지형 순응 불규칙 외곽
도시를 원판(disc)으로 자르지 않고 **불규칙 경계 폴리곤(boundary)**을 만든다.
- 기본 반경(size 기반) + 각도별 simplex 노이즈로 반경 변형 → 들쭉날쭉 윤곽(꼭짓점 16–24개).
- **원형별 변형:** 해안항구→바다쪽이 잘린 D자; 다리마을·능선선형→한 축으로 길쭉(강/능선 방향); 언덕요새→작고 둥글게 압축; 곡류방어→강 곡류 안쪽으로 오목; 평원시장→넓게 퍼짐.
- **물에서 빼냄:** 경계 꼭짓점이 물 안이면 중심 방향으로 당겨 해안에 맞춤.
- `insideRegion(p) = pointInPolygon(p, boundary) && !inWater(water, p)`.

### 2.2 성벽이 외곽을 따라감
볼록껍질 대신 **경계 폴리곤을 성벽**으로(오목 가능, 살짝 inset). 탑은 경계 꼭짓점에, 성문은 주도로 교차점에.

### 2.3 구불구불 해안선
바다의 육지쪽 가장자리(현재 사각형 직선)를 노이즈로 물결치게: 가장자리를 잘게 나눠 각 점을 법선 방향으로 노이즈 변위. 강둑도 약간.

### 2.4 진짜 휘는 도로
텐서필드에 **방사 중심 + 오프셋 보조장 1–2개**를 더해 필드 방향이 도시 전역에서 매끄럽게 휘게(ProbableTrain식). 격자 도시도 부드럽게 곡선. `fieldsFor`를 원형별로 (방사+오프셋 그리드/노이즈) 조합하도록 재설계.

### 2.5 핵심 기술 결정 — 오목 경계 처리
불규칙 경계는 **오목**이라 기존 볼록 클리퍼(`clipToConvex`)로는 못 자른다. 해결:
- 구역 점은 경계 안에만 배치, 건물은 중심이 경계 안인 것만 유지.
- **렌더러에서 경계 SVG `clipPath`** 로 구역 색·건물을 불규칙 외곽으로 잘라낸다(`clipPath`는 오목 폴리곤 네이티브 처리 → 별도 기하 클리퍼 불필요).

## 3. 물 도시 특화 요소 (Phase 2)

물(바다·강)을 낀 도시에 해양 인프라를 추가. 대부분 렌더 + 항구 구역 배치.
근거: 중세 항구도시는 방파제로 감싼 항만 분지, 부두·잔교, 창고, 조선소, 등대, 세관, 바다문을 갖췄고 내륙과 레이아웃이 달랐다. 강 도시는 물레방아·잔교·어시장.

### 3.1 항만 (해안 도시)
- **방파제(breakwater) + 보호 분지:** 해안에서 곡선 몰(mole)이 뻗어 잔잔한 항만 분지를 감쌈.
- **부두·잔교(quay/pier):** 항구 구역 물가에서 분지로 뻗는 잔교 여러 개.
- **정박한 배:** 분지 안 작은 배 글리프 몇 척(각도 포함).
- **등대(lighthouse):** 방파제 끝.
- **바다문(sea gate):** 성벽이 물과 만나는 곳의 요새 문.

### 3.2 창고·조선소 구역
- 항구 인접 구역에 **창고**(큰 직사각 건물) + **조선소**(건조 중인 배 글리프).

### 3.3 강 도시
- **물레방아(watermill):** 강변에 방아 건물 + 물레바퀴 + 잔교.
- **어시장(fish market):** 강·항구 근처 라벨 구역.

### 3.4 데이터
`CityLayout`에 `harbor`(선택) 추가: `{ basin?:Polygon; breakwater?:Polyline; piers:Polyline[]; boats:{x:number;y:number;angle:number}[]; lighthouse?:Point; seaGate?:Point; warehouses:Polygon[]; mills:Point[] }`. city.ts가 물/항구 구역에서 결정적으로 계산, 렌더러가 그림.

## 4. 아키텍처

| 모듈 | Phase | 작업 |
|---|---|---|
| `city/cityBoundary.ts` ⭐신규 | 1 | `makeBoundary(rng, archetype, size, center, water):Polygon` — 지형 순응 불규칙 경계(물에서 빼냄) |
| `city/walls.ts` | 1 | `wallFromBoundary(boundary, gateCount):Wall` — 경계 따라가는 성벽+탑+성문 |
| `city/water.ts` | 1 | 바다 육지쪽 가장자리 노이즈(구불 해안), 강둑 약간 |
| `city/harbor.ts` ⭐신규 | 2 | 방파제·분지·잔교·배·등대·바다문·창고·물레방아 계산 |
| `city.ts` | 1·2 | 원판→경계, `fieldsFor` 휘는 필드, `CityLayout`에 `boundary`(P1)·`harbor`(P2) |
| `svgCityRenderer.ts` | 1·2 | 경계 clipPath, 성벽=경계(P1); 항만 요소 렌더(P2) |

재사용: geometry·tensorField·streets·wards·zoning·buildings·archetypes.

## 5. 단계화
- **Phase 1 — 유기적 형태:** 불규칙 경계 + 구불 해안 + 휘는 도로 + 경계 따라가는 성벽 + 렌더러 clipPath. (본 스펙의 구현 계획)
- **Phase 2 — 물 특화 요소:** 항만(방파제·분지·잔교·배·등대·바다문) + 창고/조선소 + 강 물레방아·어시장. (Phase 1 완료 후 별도 계획)

## 6. 결정성 / 시그니처 / 테스트
모두 `deriveSeed(worldSeed, cityId)` 결정적, `Math.random` 금지. 공개 시그니처(`cityContext`/`generateCityLayout`/`renderCity`) 유지 → `app.ts` 무변경.
테스트(Phase 1): 경계가 닫힌 불규칙 폴리곤(반경 변동 > 임계)·물에서 빠짐·원형별 형태(해안=한쪽 잘림, 강/능선=한 축 길쭉, 언덕=둥글게 압축); 도로가 경계서 정지 + 실제 곡률(직선편차 > 임계, 격자 도시 포함); 해안선이 직선 아님; 결정성 해시; 렌더러 jsdom 스모크(clipPath 존재, 성벽=경계).

## 7. 위험
경계↔물 상호작용(D자 만들기)과 휘는 필드 튜닝이 까다롭다. 스크린샷 도구가 막혀 있어 구현 중 시각 확인은 DOM 지표(곡률·경계 반경 변동·해안선 직선편차)로 검증한다. Phase 2 항만 기하(방파제 곡선·잔교 배치)도 까다로워 분리.

## 8. 기존 코드와의 관계
- `city.ts`/`svgCityRenderer.ts`: 경계 기반으로 수정, `CityLayout`에 `boundary` 추가. `fieldsFor` 재작성(휘는 필드).
- `walls.ts`: `buildWall`(hull)은 유지하되 city.ts는 `wallFromBoundary`를 사용.
- `water.ts`: 바다 가장자리 노이즈 추가.
- `wards.ts`/`zoning.ts`/`buildings.ts`/`tensorField.ts`/`streets.ts`/`geometry.ts`/`archetypes.ts`: 재사용.
- 공개 시그니처 불변.
