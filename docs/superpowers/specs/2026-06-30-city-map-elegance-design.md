# 도시맵 고급화 — 하이브리드 중세 거리 도시 + 지형 원형 (설계)

작성일: 2026-06-30
상태: 설계 확정 (Phase 1 구현 계획 작성 전)
대상: City Generator v2(이미 merged)를 확장. Phase 2(역사 시뮬)와는 독립.

## 1. 정체성 / 목표

사용자 피드백: 도시맵을 더 고급스럽게, 그리고 강·호수·해양 등 물이 분명하게. 레퍼런스는 ProbableTrain의 City Generator(maps.probabletrain.com)의 *우아함*(깔끔한 거리망·선명한 물·세련된 선). 단, 우리 세계는 중세 판타지이므로 성벽·구역·랜드마크 같은 중세 요소는 유지한다.

**정체성: "성벽 안의 우아한 중세 거리 도시." 깔끔한 밝은 지도 톤.**
v2의 중세 구조(성벽·탑·성문·해자·구역타입·랜드마크)를 유지하면서, (1) 유기적 중세 거리망, (2) 물 다양화·선명화(강·호수·바다), (3) 세련된 밝은 렌더, (4) **지형 기반 도시 원형**으로 도시 형태를 사실적으로 결정한다.

근거 자료(중세 도시 형태론): 세 기본 가로 패턴 — 유기형(성당·시장·언덕요새 둘레 굽잇길), 격자형(평탄지 계획 신도시/바스티드), 선형(능선·강둑·도하점). 지형→형태: 방어입지(언덕·섬·강 합류/곡류)=불규칙 압축 성곽도시, 평탄지=격자 시장도시, 능선/강둑=선형, 언덕=정상에 성+아래로 압축, 도하점=다리마을, 합류점=교역도시, 해안=항구에서 내륙 성장.

## 2. 지형 기반 도시 원형 (핵심 차별점)

월드 맥락(해안 여부·고도·규모·시드)으로 **원형(archetype)**을 선택하고, 그 원형이 생성 파라미터(가로 패턴·성벽 형태·물 종류·구역 배치)를 한꺼번에 결정한다. 휴리스틱 대신 "지형→고증 형태" 논리.

### 원형 표 (`city/archetypes.ts` 데이터)
| 원형 | 지형 조건 | 가로 패턴 | 성벽 형태 | 물 | 구역 배치 |
|---|---|---|---|---|---|
| `coastalPort` | 해안·저지 | 유기→격자 | 해안 따라 | 바다+부두 | 시장·창고 항구 옆, 내륙 성장 |
| `bridgeTown` | 강 도하점 | 강 직교 선형 | 양안 | 강 관통+다리 | 시장 다리목, 방앗간 강가 |
| `hilltopFortress` | 고지 | 동심 유기 | 등고선 따라 | (샘/없음) | 성채 정상, 아래로 주거 |
| `meanderDefense` | 강 곡류/반도 | 압축 유기 | 강이 해자 | 강 3면 | 빽빽, 빈민가 하류 |
| `plainsMarket` | 평탄·저중지 | 격자/방사 | 직사각 | (호수 가능) | 중앙 광장, 방사 도로 |
| `ridgeLinear` | 능선·계곡 | 선형 | 양끝 성문 | — | 한 줄기 큰길 |

각 원형 레코드: `{ id, streetField: "radial"|"grid"|"linear"|"organic", wallShape: "hull"|"rect"|"contour"|"riverbank", water: "sea"|"river"|"lake"|"none"|"meander", districtRules }`.

### 선택기 (`selectArchetype(ctx, rng)`)
- 입력: `ctx`(coastal, size, isCapital) + `elevation`(0..1, world 셀 고도 — `CityMarker`에 추가) + `rng`.
- 규칙(가중): 해안→coastalPort; 고도 높음→hilltopFortress; 그 외 시드 확률로 bridgeTown/meanderDefense/plainsMarket/ridgeLinear.
- **한계(명시):** 월드맵은 현재 도시별 강·합류점 정보가 없다. 강 기반 원형(bridgeTown/meanderDefense)은 *시드 확률 + 도시 자체 강 생성*으로 부여한다. 월드맵에 강이 추가되면 더 정확해진다(향후 별도 작업).
- **필요 변경:** `CityMarker`에 `elevation:number`(0..1) 추가 — `world.ts`가 도시 셀의 `heights[cell]`을 채운다. (앱 호출부 무변경; 추가 필드일 뿐.)

## 3. 생성 알고리즘 (하이브리드)

원형이 아래 파이프라인을 파라미터화한다.

1. **원형 선택** (`archetypes`) → 가로 패턴·성벽 형태·물 종류·구역 규칙.
2. **물** (`water` 재작성) — 원형 물 종류에 따라 바다(노이즈 해안·얕은물·부두) / 강 관통(굽이치는 띠, 둑 노이즈, 다리) / 호수(블롭) / 곡류(강이 도시를 감쌈) / 없음. 시드 결정적.
3. **거리망** (`streets` 신규) — **텐서 필드**(원형별 편향: radial=광장/성문 방사, grid=격자, linear=한 축, organic=노이즈)를 RK4 스트림라인으로 추적. 2단계(간선·이면). 성벽 안·물 밖으로 클리핑. *격자 도시가 아니라 중세 유기 톤.*
4. **성벽** (`walls` 재사용/확장) — 원형 형태(hull/rect/contour/riverbank). 탑·성문·해자 유지.
5. **구역·타입** (`wards`+`zoning` 재사용) — 원형의 districtRules로 배치(예: bridgeTown은 시장을 다리목에).
6. **건물** — Phase 1: 기존 구역 분할 유지하되 **거리와 겹치는 필지 제거**. Phase 2: 거리-블록 면 추출 후 블록 내 정렬.
7. **공원** — 일부 구역/블록 공원(초록).
8. **랜드마크** — 성채·성당·길드홀·광장(원형별 위치, 예: hilltopFortress는 성채를 정상에).

## 4. 아키텍처 — 엔진(순수)/UI 분리 유지

**재사용(v2):** `geometry.ts`(폴리곤 연산·subdivide), `rng.ts`, `wards.ts`, `zoning.ts`, `walls.ts`, `buildings.ts`, 앱 드릴다운.
**신규/교체:**
| 모듈 | 작업 |
|---|---|
| `city/archetypes.ts` ⭐신규 | 원형 데이터 표 + `selectArchetype(ctx, elevation, rng)` |
| `city/tensorField.ts` ⭐신규 | 격자·방사·선형 기저장 합성, 점별 주/부 방향 |
| `city/streets.ts` ⭐신규 | RK4 스트림라인 추적(2단계) + 클리핑 |
| `city/water.ts` 재작성 | 바다·강·호수·곡류 + 다리 + 클리핑 |
| `city/zoning.ts` 확장 | 원형 districtRules 반영 |
| `city/walls.ts` 확장 | 원형 wallShape(hull/rect/contour/riverbank) |
| `city.ts` 재작성 | 원형 주도 오케스트레이션 → 새 `CityLayout`(원형·도로 2단계·구역·건물·물·공원·성벽·랜드마크·라벨) |
| `types/world.ts` | `CityMarker.elevation:number` 추가; `world.ts`가 채움 |
| `ui/svgCityRenderer.ts` 재작성 | **밝은 깔끔 테마**: 크림 바탕·위계 도로선·옅은 건물·파란 물(해안 음영)·초록 공원·라벨 후광 |

**시그니처 유지:** `cityContext`/`generateCityLayout`/`renderCity` → `app.ts` 무변경.

## 5. 단계화 (위험 관리)

가장 위험: 텐서 스트림라인 균등 간격, (Phase 2) 도로-블록 면 추출.
- **Phase 1** — 원형 선택 + 원형별 거리망(2단계) + 물 다양화(강·호수·바다·곡류+다리) + 원형별 성벽/구역 + 밝은 깔끔 렌더. 건물은 기존 구역 분할 유지(거리 겹침 제거). → *원형마다 다른 형태의, 거리+물이 선명한 우아한 중세 지도.* 면 추출 같은 고위험 없음.
- **Phase 2 (선택)** — 거리-블록 면 추출 후 블록 내 건물 정렬(밀도 최대) + 공원 정교화.

본 스펙의 구현 계획은 **Phase 1**을 다룬다.

## 6. MVP(Phase 1) 범위 / YAGNI

포함: 원형 6종 + 선택기, `CityMarker.elevation`, 텐서필드(radial/grid/linear/organic), 2단계 스트림라인 거리망, 물(바다·강·호수·곡류 + 다리 + 클리핑), 원형별 성벽/구역, 거리 겹침 건물 정리, 공원, 밝은 깔끔 렌더(도로 위계·물 음영·라벨 후광).
제외(나중): 거리-블록 면 추출(Phase 2), 다크 테마, 월드맵 강 연동, 거리 이름, 3D/줌.

## 7. 결정성 / 테스트

모두 `deriveSeed(worldSeed, cityId)`에서 결정적. 스트림라인 시딩 순서 고정, `Math.random` 금지.
테스트:
- `archetypes`: 같은 입력→같은 원형; 해안→coastalPort, 고지→hilltopFortress 규칙; 결정성.
- `tensorField`: 방향 연속성(인접 점 각도 차 작음), radial/grid/linear 편향이 기대 방향.
- `streets`: 스트림라인이 물·성벽 경계서 정지, 같은 시드→같은 도로 해시, 2단계 밀도 차(이면 > 간선 수).
- `water`: 강이 도시를 가로지름, 다리=강×도로 교차, 종류 선택 결정성.
- `city`: 결정성(레이아웃 해시), 원형 반영(해안→sea+harbor, 고지→hilltop wall), 거리 위 건물 없음.
- 렌더러: jsdom 스모크(도로·물·공원·성벽·라벨 그룹, 도로 위계 클래스).

## 8. 규모

도시 v2보다 큼(텐서필드·스트림라인 신규). Phase 1만으로도 다태스크. superpowers 서브에이전트 주도 개발로 진행.

## 9. 기존 코드와의 관계

- `city.ts`/`svgCityRenderer.ts`: v2 내용을 원형 주도 + 거리망 + 밝은 테마로 재작성. `CityLayout`은 도로(2단계)·원형·공원 필드 추가.
- `wards.ts`/`zoning.ts`/`walls.ts`/`buildings.ts`/`geometry.ts`: 재사용, `zoning`/`walls`는 원형 파라미터 수용하도록 확장.
- `types/world.ts`: `CityMarker.elevation` 추가(추가 필드, 앱 무변경). `world.ts`가 `heights[cell]`로 채움 → 결정성 테스트 갱신 필요.
- 공개 시그니처(`cityContext`/`generateCityLayout`/`renderCity`) 불변.
