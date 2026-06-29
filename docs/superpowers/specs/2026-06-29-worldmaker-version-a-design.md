# WorldMaker — 버전 A 설계 (MVP)

작성일: 2026-06-29
상태: 설계 확정 (구현 계획 작성 전)

## 1. 정체성 / 포지셔닝

WorldMaker는 **게임이 아니라 세계관 제작자(소설가·TRPG GM·월드빌더)를 위한 도구**다.
산출물은 *아름답고, 탐험 가능하고, 공유되는 지도* + *읽을거리로서의 시뮬된 역사*다.

경쟁 사례(WorldBox, Ages of Conflict, Dwarf Fortress 레전드)는 모두 "줌아웃된 시뮬레이션 게임"이다.
WorldMaker는 그들이 못 채우는 빈틈 — **카토그래피급 탐험 + 일관된 도시 드릴다운 + 읽히는 역사 + 공유** — 을 노린다.

### 3대 차별점
1. **카토그래피 + 일관된 도시 드릴다운** — 도시맵이 월드 맥락(해안·강·고도·규모·세력·건국기)에서 *파생*된다. 일회용 도시가 아니라 "진짜 세계에 실재하는 도시".
2. **읽히는 역사(lore)** — 시뮬된 흥망을 타임라인 + 사건 로그로 *읽는다.* (전쟁 구경이 아니라 세계관 재료)
3. **시드 공유 / 리믹스** — URL로 세계를 공유하고 변형한다.

역사 시뮬은 차별점 그 자체가 아니라 **lore를 만드는 재료**다.

## 2. 기술 스택

- **TypeScript + Vite** — 빠른 개발, 나중에 Electron 포장 용이
- **렌더링: SVG 우선** + **렌더러 인터페이스로 추상화** (나중에 Canvas/WebGL 음영·텍스처 레이어를 재작성 없이 끼울 수 있게)
- **라이브러리 최소화:** `d3-delaunay`(Voronoi + Lloyd 완화 + `find(x,y)` 클릭판정), `simplex-noise`(높이맵), 소형 시드 PRNG(`mulberry32`)
- **백엔드 없음** — 100% 클라이언트. 상태는 메모리, 입출력은 JSON/PNG/SVG

### 렌더링 결정 근거
- 선택한 아트 스타일이 **정치 지도(평면 색면 + 국경 + 라벨)** → SVG의 홈그라운드
- 벡터라 해상도 독립 → 어떤 줌에서도 안 깨짐(조잡함 방지)
- 벡터/인쇄급 PNG·SVG 내보내기 → 제작자 포지셔닝의 실질 기능
- 클릭 판정이 공짜(세력·도시가 DOM 요소)
- "SVG는 셀 수천 개면 무겁다"는 우려는 **같은 세력 셀을 한 path로 디졸브**하고 **해안선은 대륙당 한 path**로 합쳐 노드 수를 줄여 해소
- 참고: Azgaar도 SVG 메인 + 대형 맵일 때만 WebGL 옵션. 동일 전략.
- **미루는 것:** 힐셰이딩·텍스처(평면 정치지도엔 불필요), 양피지 스킨

## 3. 아키텍처 — 엔진(순수)/UI 분리

나중의 버전 B 전환·데스크톱 포장을 위해 **DOM을 모르는 순수 생성 엔진**과 렌더/UI를 분리한다.

### 생성 엔진 (`src/engine/`, 순수 함수, DOM 의존 없음)

| 모듈 | 역할 | 의존 |
|---|---|---|
| `rng` | 시드 기반 결정적 난수 (mulberry32) | — |
| `grid` | 지터 포인트 + Lloyd 완화로 Voronoi 셀 그래프(셀·이웃·꼭짓점) | rng, d3-delaunay |
| `heightmap` | 셀별 고도 (simplex 노이즈 + 섬/대륙 셰이핑) | rng, grid, simplex-noise |
| `terrain` | 셀 분류: 바다 / 육지 / 산 (고도 임계값) | heightmap |
| `polities` | 초기 소국 시딩 (수도 도시 + 인접 셀 몇 개) | rng, terrain |
| `history` ⭐ | **역사 시뮬레이션 엔진** — Turchin 연대(solidarity) 모델. 결정적. (Phase 2) | rng, polities |
| `timeline` ⭐ | 셀별 `(연도, 소유자)` 변화 이력 + 상위 사건 로그. 연도 T의 정치 상태 질의 | history |
| `names` | 음절 기반 도시·국가 이름 생성 | rng |
| `world` | 위를 순서대로 묶어 **World 데이터 객체**(직렬화 가능) 산출 | 전부 |
| `city` | 도시 1개의 컨텍스트로 **구역 블록 레이아웃** 생성 | rng, names |

### 렌더/UI (`src/ui/`, DOM)

| 모듈 | 역할 |
|---|---|
| `renderer` (인터페이스) | `renderWorld(world, year)`, `renderCity(layout)` 추상 계약 |
| `svgWorldRenderer` | World → SVG (바다, 해안선 path, 세력 색면+국경, 산 표시, 수도★/도시●) |
| `svgCityRenderer` | 도시 레이아웃 → SVG (성벽, 강, 구역 블록) |
| `app` | 시드/파라미터 패널·재생성·내보내기·월드뷰↔도시뷰 전환·클릭 처리·타임라인 슬라이더(Phase 2)·사건 로그(Phase 2)·URL 인코딩 |

## 4. 데이터 흐름

```
시드/파라미터 입력
  → world.generate()
      → grid → heightmap → terrain → polities
      → (Phase 2) history 시뮬 → timeline
  → World 객체 (지리 + 타임라인)
  → svgWorldRenderer(World, year=현재)  // 연도 T 정치 스냅샷
  → [도시 클릭] → d3-delaunay.find → 마커 판정
      → city.generate(도시컨텍스트, 파생시드)   // 파생시드 = hash(월드시드, 도시ID)
      → svgCityRenderer(layout)
  → [뒤로] → 월드뷰 복귀
```

- **결정성:** 모든 단계가 시드에서 결정적. 같은 시드 → 같은 세계. 도시 시드는 월드시드+도시ID에서 파생 → 같은 도시는 항상 같은 도시맵.
- **타임라인 저장:** 셀마다 `(연도, 소유자)` 변화 리스트만 저장 → 연도 T 렌더링은 T 이하 마지막 소유자를 찾으면 끝. 가볍고 임의 연도 조회 빠름.

## 5. 역사 시뮬레이션 — Turchin 연대 모델 (Phase 2)

- 각 셀에 **연대(solidarity) 점수.**
- 매 틱: 셀의 "제국 내 인접 이웃 수"가 연대 증감 확률을 결정(외부 압력↑, 내부 압력↓).
- **제국 힘 = 영토 전 셀 연대 점수 합.**
- 영토 다툼: 국경에서 **지역 연대 + 총 힘 + 수도로부터의 거리**로 셀 획득/상실 결정.
- 가끔: 신도시 건설, 너무 크거나 불안정하면 분열.
- MVP는 **단순·결정적·재현 가능**이면 충분. 경제·외교는 범위 밖.
- 출처: Turchin 모델 (Hackaday "Simulating Empires With Procedurally Generated History").

## 6. MVP 범위 (YAGNI) — 2단계

각 단계가 독립적으로 동작한다.

### Phase 1 — 정적 세계 (바로 쓰는 앱)
- Voronoi 지형(grid) + 대륙형 높이맵(heightmap) + 바다/육지/산(terrain)
- 정치 세력 색면 + 국경(polities, 0년 스냅샷)
- 수도★·도시● + 이름(names)
- 도시 클릭 → 구역 블록 도시맵(city: 성벽·강·구역)
- 시드 입력·재생성, PNG·SVG·JSON 내보내기
- 시드/파라미터 URL 인코딩(공유/리믹스)

### Phase 2 — 역사 (시그니처 차별점)
- Turchin 역사 시뮬레이션(history) + 타임라인(timeline)
- 타임라인 슬라이더 + ▶재생 → 연도 스크럽 시 정치 스냅샷 즉시 재렌더
- 사건 로그 패널 ("142년 건국 · 305년 X에 정복 · 410년 분열")

### 범위 밖 (나중)
월드 강·세부 바이옴·문화/종교, 편집툴, 양피지 스킨, 거리단위 도시맵, **버전 B(인터랙티브 시뮬 게임)**, Claude API 기반 서사 생성, Canvas/WebGL 음영 레이어.

## 7. 테스트 전략

엔진이 순수 함수라 **Vitest 단위 테스트** 중심:
- **결정성:** 같은 시드 → 같은 출력(World 직렬화 해시 비교)
- **불변식:**
  - 모든 육지 셀이 정확히 한 세력에 속함 (0년 기준; 무소속 허용 시 명시)
  - 도시 수가 파라미터 범위 내
  - 타임라인: 셀 소유권 변화가 시간순 정렬·연속적, 임의 연도 질의가 유효한 소유자 반환
  - 도시 레이아웃: 구역 수·성벽 폐곡선 등 기하 불변식
- 렌더러: 가벼운 DOM/SVG 스모크 테스트("에러 없이 노드 생성") + 수동 시각 확인

## 8. 디렉터리 (초안)

```
src/
  engine/   rng, grid, heightmap, terrain, polities, history, timeline, names, world, city
  ui/       renderer(iface), svgWorldRenderer, svgCityRenderer, app
  types/    World, Polity, Timeline, CityLayout 등 공유 타입
test/       engine 단위 테스트
docs/superpowers/specs/
```

## 9. 향후 (버전 B 다리)

버전 B(하츠 오브 아이언식 인터랙티브 시뮬)는 **같은 `history` 엔진을 인터랙티브 모드**로 노출하는 것이다.
플레이어가 영토를 지정/국경을 그리고 제국을 형성 → 같은 Turchin 규칙으로 시뮬.
그래서 엔진을 처음부터 순수·결정적·UI 비의존으로 짠다. "꽤 괜찮은 결과물이 나오면" 착수.
