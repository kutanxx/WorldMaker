# 바이오미별 도시 형태 Phase 1 (숲·늪·사막) — 설계

작성일: 2026-07-01
상태: 설계 확정 (구현 계획 작성 전)
대상: 도시 드릴다운(유기적 형태, 이미 merged)을 바이오미에 순응하게 확장. 월드 바이오미(`CityMarker.biome`, merged)를 소비.

## 1. 목표 / 범위

월드 바이오미를 만든 목적 — "도시가 자기 지역과 어울리게" — 를 실현한다. 지금 도시는 지형 archetype(coastal/elevation/size)만 보고 바이오미는 무시해, 사막이든 초원이든 내륙 평지면 모두 같은 `plainsMarket`(격자)로 나온다.

**Phase 1 = 숲·늪·사막 3개 바이오미 도시**(가장 차별적, 팔레세이드·고상·오아시스 세 서명 기능 커버). 초원은 기존 `plainsMarket` 베이스라인, 한대·열대·(카라반세라이·초원 전용화)는 다음 배치. 알파인=산 도시(Phase 2), 해안=항만(Phase 3)이 이미 분리돼 있어 **바이오미 도시는 내륙·비산악 도시에 적용**한다.

사용자 선택: 깊이=풀 바이오미 archetype(고유 형태 + 서명 기능 + 전용 렌더). 첫 배치=숲·늪·사막("너 추천대로").

## 2. archetype 선택 (biome 반영)

`CityContext`에 `biome:number` 추가, `cityContext(marker)`가 `marker.biome` 전달. `selectArchetype`에 `biome` 인자 추가.

**우선순위(위→아래 먼저 매칭):**
1. `coastal` → `coastalPort` (항만 Phase 3에서 확장)
2. `elevation >= 0.7` → `hilltopFortress` (산 Phase 2)
3. 그 외 내륙은 **biome으로 결정**:
   - `WETLAND(7)` → `marshStilt`
   - `DESERT(5)` → `desertOasis`
   - `TEMPERATE_FOREST(3)` · `TAIGA(2)` · `TROPICAL(6)` → `forestGrove` (Phase 1에선 셋 다 동일한 "목책+수목 숲도시"; 세분화는 다음 배치)
   - `GRASSLAND(4)` · `TUNDRA(1)` · 그 외 → `plainsMarket` (기존)

바이오미 상수는 `src/engine/biome.ts`에서 재사용(중복 정의 금지).

## 3. 신규 archetype 3종 + 특징

`Archetype`에 특징 필드를 더한다: `wallMaterial: "stone" | "timber"`, `vegetation: "trees" | "none"`, `onStilts: boolean`, `oasis: boolean`, `groundColor: string`. 기존 6개 archetype은 기본값(stone/none/false/false/크림 `#efe7d2`)을 갖는다.

| archetype | streetField | wallShape | water | wallMaterial | vegetation | onStilts | oasis | groundColor |
|---|---|---|---|---|---|---|---|---|
| **forestGrove** | organic | hull | none | timber | trees | false | false | `#e3e7d0`(연녹) |
| **marshStilt** | organic | riverbank | meander | timber | none | true | false | `#dfe4dc`(진흙 회녹) |
| **desertOasis** | organic | hull | none | stone | none | false | true | `#ece0c2`(모래) |

- **forestGrove:** 돌벽 대신 목재 팔레세이드, park + 빈 땅 산포로 수목 글리프. water none(가끔 없음).
- **marshStilt:** `water: "meander"`(도시를 관통하는 채널 — 전면 덮기 아님). 물 위 건물 허용(§5), 말뚝·판자 둑길 렌더. 유동 성벽이 물 인접 변을 자동으로 열어 **부분 목책+수문**이 됨(기존 기계 재사용).
- **desertOasis:** 오아시스는 별도 기능이 아니라 **중앙에 작은 원형 물체를 `water.bodies`에 추가**(건물·도로 회피가 기존 `inWater` 필터로 공짜). 내륙이라 성벽은 온전한 링. park(녹지) 없음. 렌더만 야자수로 특별 처리.

## 4. 데이터 모델 — `CityLayout.features` (항상 존재)

```ts
export interface CityFeatures {
  wallMaterial: "stone" | "timber";
  trees: Point[];                                    // forest: 수목 글리프 위치 (park + 빈 땅 산포)
  onStilts: boolean;                                 // marsh: 건물 밑 말뚝 + 물 위 도로는 둑길
  oasis: { center: Point; radius: number } | null;   // desert
  groundColor: string;                               // 바이오미 바탕색
}
```
모든 도시가 `features`를 가진다(비-바이오미 archetype은 stone·[]·false·null·`#efe7d2`). null 분기 없음.

## 5. city.ts 통합 (결정성 유지)

`generateCityLayout`에서 고정 순서로:
1. `selectArchetype({coastal,elevation,size,biome}, rng)`.
2. desertOasis면 `water.bodies`에 중앙 작은 원형 오아시스(반경 ≈ radius*0.12) 추가.
3. **건물 필터**: 기본은 기존대로 `!inWater && pointInPolygon(boundary) && !nearRoad`. **단 `archetype.onStilts`면 물 위 건물을 버리지 않음**(얕은 물 위 고상가옥) — `inWater` 조건을 스킵.
4. 건물 생성 후, `rng`로 `features` 계산(결정적 고정 지점):
   - `trees`: `vegetation==="trees"`면 park 폴리곤 + 빈 땅 산포(건물·도로·물·경계밖 회피), 아니면 `[]`.
   - `oasis`: `archetype.oasis`면 `{center, radius*0.12}`, 아니면 null.
   - `onStilts = archetype.onStilts`; `wallMaterial = archetype.wallMaterial`; `groundColor = archetype.groundColor`.
5. `CityLayout`에 `features` 추가.

공개 시그니처(`cityContext`/`generateCityLayout`/`renderCity`) 유지 → `app.ts` 무변경. (내륙 도시 archetype이 랜덤 pick에서 biome 결정으로 바뀌어 그 도시들의 드릴다운 레이아웃은 달라진다 — 도시 레이아웃은 스냅샷 대상이 아니므로 허용.)

## 6. 렌더 (svgCityRenderer 분기)

- 바탕: `ground` 폴리곤 fill을 `features.groundColor`로.
- **목재 벽**(`wallMaterial==="timber"`): 어두운 돌벽(`#43392d`) 대신 목책 — 갈색(`#6b4f34`) + 말뚝 틱(짧은 수직선). 탑·성문은 유지.
- **수목**(`trees`): 각 위치에 작은 나무 글리프(짙은 녹색 원/삼각, `.tree`). park는 수목 클러스터로.
- **늪**(`onStilts`): 건물 밑 말뚝 다리(짧은 수직선 `.stilt`), 물 위 도로 구간은 판자 둑길 스타일. (도로-물 교차는 기존 `waterBridges` 재사용.)
- **사막 오아시스**(`oasis`): 파란 못(`.oasis`) + 야자 글리프. park 없음.

## 7. 아키텍처

| 모듈 | 작업 |
|---|---|
| `city/archetypes.ts` | 3 archetype + 특징 필드 + `selectArchetype`에 biome |
| `city.ts` | biome 전달, 오아시스 물체 추가, onStilts 건물 필터 완화, `features` 계산, `CityLayout.features` |
| `ui/svgCityRenderer.ts` | 바탕색·목책·수목·말뚝·오아시스 렌더 분기 |
| (재사용) | boundary·walls(유동 성벽)·water·wards·zoning·buildings·geometry, `engine/biome.ts` 상수 |

`Point`, `Polygon`은 `engine/geometry.ts`. `CityFeatures`는 `city.ts`가 export.

## 8. 테스트 (스크린샷 막힘 → DOM 지표)

- `selectArchetype`: 늪→marshStilt, 사막→desertOasis, 숲(3 biome)→forestGrove, 초원·툰드라→plainsMarket; 우선순위(해안·elevation이 biome보다 먼저). biome 인자 추가.
- `features`: 숲=`trees.length>0` & `wallMaterial="timber"`; 사막=`oasis!==null` & parks 0 & 오아시스가 `water.bodies`에 반영(중심 근처 건물 없음); 늪=`onStilts` & 물 위 건물 존재(필터 완화 확인).
- 결정성: 같은 (ctx,seed) 동일 레이아웃.
- 수목 회피: 모든 tree가 건물/물과 안 겹침(경계 안).
- 렌더 jsdom 스모크: `.tree`/`.stilt`/`.oasis` 존재(해당 바이오미), 목책 벽 색, groundColor 반영.
- 리플: `archetypes.test`(selectArchetype 새 인자), `city.test`(biome 라우팅 후 구조 단언 유지) 갱신.

## 9. 위험 / 단계화

- **늪이 셋 중 가장 위험**(채널 물 + 물 위 건물 허용 + 말뚝·둑길 렌더 = 신규 기계 최다). 숲·사막은 기존 재사용이 커 낮음. → 구현은 **숲 → 사막 → 늪** 순(늪을 마지막 태스크로 리스크 격리).
- 시각 튜닝(팔레세이드·수목·오아시스 밀도·바탕색)은 스크린샷 막힘 → DOM 요소 검증 + localhost 육안.
- 결정성: features의 rng 산포를 고정 지점에서.

## 10. 범위 밖 (다음)

카라반세라이, 사막 압축 boundary, 초원 전용화, 한대·열대 도시 배치; 그리고 산 도시(Phase 2)·항만(Phase 3)·역사 시뮬.
