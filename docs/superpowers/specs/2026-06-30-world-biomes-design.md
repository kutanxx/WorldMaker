# 월드맵 바이오미 — 설계

작성일: 2026-06-30
상태: 설계 확정 (구현 계획 작성 전)
대상: 월드맵(정치 지도, 이미 merged)에 기후 기반 바이오미 레이어를 더하고 국경선을 선으로 얹는다. 도시 드릴다운·역사 시뮬과는 독립.

## 1. 목표 / 정체성

사용자는 "월드맵에 바이오미를 먼저" 원했다 — 도시가 자기 지역과 어울리도록(숲 도시/사막 도시 등) 만들기 위한 토대이자, 월드맵 자체를 물리 지형으로 풍부하게 보이게.

**A안 채택(목업 비교 후 사용자 선택): 물리 바탕 + 국경선.** 대륙을 바이오미 색으로 칠하고 폴리티 경계는 "선"으로 오버레이 → 한 지도에서 바이오미와 국가를 동시에. 모드 토글 UI 없음.

**이번 범위:** 월드 바이오미 분류 + 렌더 + `CityMarker.biome` 노출까지. **새 도시 형태(바이오미별 archetype)는 다음 단계**로 분리한다(YAGNI).

## 2. 자가 피드백 반영 사항 (확정)

브레인스토밍 자가 검토에서 나온 6개를 설계에 반영한다:
1. **별도 rng 스트림:** 바이오미 노이즈는 `deriveSeed(params.seed, SALT)`에서 만든 PRNG로 샘플 → 메인 `rng` 소비 순서 불변 → **기존 시드/공유 URL의 판도·도시 결과가 안 바뀜.**
2. **해안선 스트로크:** 육지-바다 경계 변을 얇은 선으로 그려 물 경계를 또렷하게.
3. **산 = 알파인 바이오미:** MOUNTAIN 셀은 알파인 색으로 직접 칠하고 별도 산 오버레이는 제거(이중 칠 방지).
4. **습도 약한 지리 보정 + 시드 변동:** 습도는 노이즈 + 해안 셀 소폭 가산. 기온 띠에 저주파 노이즈를 더해 시드마다 띠가 물결치고 위치가 달라지게(반복성 완화). 비그늘은 과하므로 제외(YAGNI).
5. **6 육지 바이오미 + 늪지 + 알파인:** 가독성 위해 6종으로 시작. 국경선은 **폴리티가 다른 육지 변에만**(해안·미점유 제외)으로 한정.
6. **시각 튜닝 리스크:** 스크린샷 도구가 막혀 있어 구현 중 DOM 색상 카운트로만 검증. 구현 후 localhost 육안 튜닝 한 패스를 계획에 포함.

## 3. 기후 모델 (결정적, Math.random 금지)

두 별도 노이즈를 시드 파생으로 생성: `tNoise = createNoise2D(mulberry32(deriveSeed(seed, 7001)))`, `mNoise = createNoise2D(mulberry32(deriveSeed(seed, 7002)))`. 샘플 주파수 `F = 0.006`.

**기온은 육지의 실제 y 범위로 정규화한다**(중요): 하이트맵이 섬형이라 대륙이 지도 중앙에 몰려 `y/height`로는 거의 다 온대가 된다. 먼저 육지(terrain≠OCEAN) 셀의 `landMinY, landMaxY`를 한 번 구하고, `latNorm = (y − landMinY) / max(1, landMaxY − landMinY)`로 0(북/추움)~1(남/더움)을 대륙 전체에 펼친다.

셀 i(중심 x,y, 높이 h)에 대해:
- **기온** `temp = clamp01( latNorm + tNoise(x*F, y*F)*0.12 − max(0, h − seaLevel)*0.8 )` — 위=추움, 아래=더움; 고도 높을수록 추움; 노이즈로 띠가 물결침. (고도 보정은 보조 — 산 셀은 어차피 ALPINE으로 분기.)
- **습도** `moist = clamp01( (mNoise(x*F, y*F)*0.5 + 0.5) + (coastal ? 0.12 : 0) )` — coastal = 해양 이웃 보유.

`clamp01(v)=max(0,min(1,v))`. `latNorm`·노이즈·`params`만 쓰고 메인 `rng`는 건드리지 않는다.

## 4. 바이오미 분류

상수(숫자): `OCEAN=0, TUNDRA=1, TAIGA=2, TEMPERATE_FOREST=3, GRASSLAND=4, DESERT=5, TROPICAL=6, WETLAND=7, ALPINE=8`.

셀별 규칙(우선순위 순):
1. `terrain==OCEAN` → `OCEAN`
2. `terrain==MOUNTAIN` → `ALPINE`
3. 늪지 오버라이드: `h < seaLevel + 0.05 && moist > 0.6` → `WETLAND`
4. 그 외(육지) Whittaker:
   - `temp < 0.35`(한대): `moist < 0.45` → `TUNDRA`, else → `TAIGA`
   - `temp < 0.70`(온대): `moist < 0.40` → `GRASSLAND`, else → `TEMPERATE_FOREST`
   - `temp ≥ 0.70`(열대): `moist < 0.40` → `DESERT`, else → `TROPICAL`

임계값(0.35/0.70/0.40·0.45/0.05·0.6)은 하이트맵 기본값처럼 튜닝 대상 — 구현 후 육안 조정.

## 5. 팔레트 (양피지 톤, 머스티드 — 튜닝 가능)

`BIOME_COLORS[biome]`:
- OCEAN `#a9c7e0`(기존 바다, 배경과 동일)
- TUNDRA `#cdccc0`
- TAIGA `#5f7d63`
- TEMPERATE_FOREST `#86a85e`
- GRASSLAND `#cdbf7a`
- DESERT `#e3cd92`
- TROPICAL `#3f8f57`
- WETLAND `#7fae96`
- ALPINE `#b9b2a6`

해안선 스트로크 `#5f7888`(width 0.6), 국경선 `#3c2f1c`(width 0.8). 도시 마커·라벨은 기존 유지.

## 6. 모듈 / 아키텍처

| 모듈 | 작업 |
|---|---|
| `engine/biome.ts` ⭐신규 | 바이오미 상수 + `BIOME_COLORS` + `classifyBiomes(grid, heights, terrain, params): Uint8Array` (별도 시드 노이즈) |
| `engine/borders.ts` ⭐신규 | `sharedEdge(polyA, polyB): [Point,Point] \| null` 헬퍼; `politicalBorders(grid, polityOf): Segment[]`(인접·폴리티 상이 육지 변); `coastline(grid, terrain): Segment[]`(육지-바다 변) |
| `types/world.ts` | `World.biome: number[]` 추가, `CityMarker.biome: number` 추가 (필수 필드) |
| `engine/world.ts` | terrain 직후 `classifyBiomes` 호출(메인 rng 불변), world·cities에 biome 주입 |
| `ui/svgWorldRenderer.ts` | OCEAN 외 셀을 바이오미별 그룹 path로 채움(바다는 배경 rect); 해안선·국경선 선; 산 오버레이 제거(알파인 색이 대신); 그 지도에 존재하는 바이오미만 범례에 표시 |

`Segment = [Point, Point]`, `Point = [number, number]`. 재사용: grid(polygons·neighbors), terrain 상수.

**필수 필드 추가 리플(계획이 반드시 처리):** `CityMarker.biome`/`World.biome`를 필수로 추가하면 이들을 직접 생성하는 모든 리터럴이 tsc(`noUnusedLocals`/타입)에서 깨진다 — 최소 `src/engine/city.test.ts`(`base: CityMarker`), `src/engine/world.test.ts`, `src/ui/svgWorldRenderer.test.ts`, `src/ui/app.test.ts`, `src/ui/export.test.ts`, `src/ui/svgCityRenderer.test.ts`의 World/CityMarker 리터럴에 `biome` 추가 필요. 산 오버레이 제거 시 `.mountains` 그룹을 단언하던 렌더 테스트도 갱신. `export.ts`는 World를 직렬화하므로 JSON에 biome 배열만큼 커진다(허용).

## 7. 데이터 흐름

`generateWorld`: grid → heights → terrain → **biome = classifyBiomes(...)** → polities → names → cities(각 도시에 `biome: biome[cell]` 주입). 반환 `World`에 `biome` 추가. 공개 시그니처 `generateWorld(params)` 유지. 렌더러는 `world.biome` + `politicalBorders(grid, polityOf)` + `coastline(grid, terrain)`로 그림. `CityMarker.biome`는 이번엔 노출만(도시 archetype에 미사용 — 다음 단계 토대, `landmasses`/`hashStringToSeed`처럼 선반영).

## 8. 국경선/해안선 추출 (핵심 난도)

`sharedEdge(a,b)`: 두 셀 폴리곤에서 좌표가 ε(=0.01) 이내로 일치하는 정점 2개를 찾아 그 선분 반환; 2개 미만(모서리만 접함/클립됨)이면 null.
`politicalBorders`: 각 셀 i(폴리티≥0), 이웃 j(중복 방지 `j>i`)에서 `polityOf[j]≥0 && polityOf[j]≠polityOf[i]`면 `sharedEdge`로 선분 수집.
`coastline`: 각 육지 셀 i, 이웃 j가 OCEAN이면 `sharedEdge` 선분 수집.
성능: 4000셀 × ~6이웃 × 정점 — 충분히 빠름. **렌더는 선분 수백~수천이 될 수 있으므로 카테고리별로 한 `<path>`(`M x,y L x,y` 연결)로 그려 DOM 요소 수를 줄인다**(`<line>` N개 금지).

## 9. 테스트

- 바이오미 결정적 분기(노이즈 무관)는 정확히 단언: 바다→OCEAN, 산(terrain MOUNTAIN)→ALPINE. 기후 띠는 노이즈(±0.12)로 경계가 흔들리므로 **통계적 속성**으로 검증: 생성된 월드에서 한대 바이오미(TUNDRA·TAIGA) 셀들의 **평균 셀 중심 y** < 열대 바이오미(DESERT·TROPICAL)의 평균 y(latNorm은 y에 단조 비례하므로 y로 직접 검증; 고도 보정이 가끔 남쪽 고지대를 한대로 만들 수 있어 **여러 시드 평균**으로 견고하게). 늪지 오버라이드·결정성(같은 시드 동일 배열)은 별도 단언.
- **기존 시드 불변 회귀(골든 스냅샷):** 변경 전 main에서 seed=1의 `polityOf` 합/해시와 도시 `cell` 목록을 캡처해 고정값으로 둔다(계획 첫 태스크가 캡처). 변경 후 `generateWorld({seed:1,...})`의 `polityOf`·도시 `cell`이 그 고정값과 동일해야 함 → 바이오미 분류가 메인 rng를 안 건드림을 입증. (도시 객체에 `biome` 필드가 추가되므로 "도시 객체 전체 동일"이 아니라 `cell`만 비교.)
- borders: 같은 폴리티 변 제외, 폴리티 다른 변만; coastline은 육지-바다만; `sharedEdge` 정점 2개 매칭.
- 렌더 jsdom 스모크: 바이오미 그룹 path 존재(여러 색), 국경선·해안선 선 존재, 범례 존재.

## 10. 위험

기후 임계값·팔레트 튜닝(스크린샷 막힘 → DOM 검증 + localhost 육안), `sharedEdge` 정점 매칭의 부동소수 견고성, 색 10개(특히 4가지 녹색: 타이가·온대림·열대림·늪지)의 가독성/조화가 까다롭다. 늪지/알파인이 드물게만 나올 수 있어(저지대+고습, 산) 분포 확인 필요. 산이 평평한 알파인 색이 되어 입체감을 잃음 — **산 글리프/해칭은 후속 범위**(이번엔 색까지).

## 11. 다음 단계(범위 밖)

`CityMarker.biome`를 도시 archetype 선택에 연결 → 숲/늪/사막/오아시스/섬/교차로 등 바이오미별 도시 형태(별도 스펙). 이후 산 도시(Phase 2)·항만(Phase 3)·역사 시뮬.
