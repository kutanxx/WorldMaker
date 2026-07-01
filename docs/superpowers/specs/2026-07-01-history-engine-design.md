# 역사 엔진 + 연대기 (A) — 설계

작성일: 2026-07-01
상태: 설계 확정 (구현 계획 작성 전)
대상: WorldMaker의 시그니처 차별점 — "읽히는 역사(lore)". 정적 세계(월드 바이오미·도시, 이미 merged) 위에 시간 축을 더한다. 역사 서브프로젝트 A(엔진 + 연대기); B(타임라인 스크러버 UI)는 다음.

## 1. 목표 / 정체성

경쟁 사례(WorldBox 등)가 못 채우는 빈틈 = **읽히는 역사**. 전쟁 구경이 아니라 **세계관 재료(lore)**. 소설가·TRPG GM이 생성된 연대기를 읽고 이야기 훅을 얻는다.

**서브프로젝트 A = 역사 엔진 + 연대기(사건 로그).** Turchin 연대(solidarity/asabiyya) 모델을 현재 지도(0년)에서 앞으로 시뮬해 **이정표 사건 로그** + 연도별 정치 스냅샷을 생성하고, 텍스트 연대기 패널로 보여준다. **타임라인 슬라이더·지도 연도 스크럽 재렌더는 B**(다음).

**프레이밍(사용자 선택):** 현재 정치 지도 = **여명(0년)**. 앞으로 ~500년 시뮬. 기존 year-0 지도·시드 **불변**.

## 2. 자가 피드백 반영 (확정)

1. **더블 버퍼 틱:** 틱 시작 상태에서 모든 연대·다툼을 계산해 동시에 적용(in-place 순서 편향 제거, 결정적).
2. **동역학은 튜닝 대상 + 지표 검증:** 흥망 균형(룬어웨이/즉시붕괴 방지)은 파라미터 튜닝. 스크린샷 무관(데이터) → 지표로 검증(생존 폴리티 수 변동, 사건 수십 개, 정복·분열 둘 다 발생).
3. **History가 자체 폴리티 목록 보유:** 분열 생성·붕괴 소멸로 id가 원래 `world.polities`와 달라짐 → `History.polities`(초기+생성, 이름·색·수도·건국년·멸망년).
4. **사건 정의 못박음(이정표만):** 건국·신도시·정복(수도함락→병합)·분열·붕괴. 셀 이동은 스냅샷에만.
5. **World와 분리:** History는 별도 객체(World JSON에 안 넣음 → export 무영향). 수도 거리 페널티는 유클리드 중심거리(BFS 아님). 자체 파생 시드 rng + name gen.
6. **축퇴 견고:** 폴리티 0/1개·초소형 월드 → 빈/소박 연대기, 크래시 없이 빈 배열.

## 3. Turchin 연대 모델

상태(내부, 작업 배열):
- `owner: Int32Array`(land 셀별 소유 폴리티 id, 초기 = `world.polityOf` 복사; -1=바다/미점유).
- `solidarity: Float32Array`(셀별 연대, 초기 0.5).
- 폴리티별 집계: 힘(연대 합), 셀 수, 수도 셀, 생존 여부.

매 틱(더블 버퍼: `owner`/`solidarity` 읽기 → `nextOwner`/`nextSol` 쓰기):
- **연대 갱신:** 셀의 "같은 소유자 인접 수"로 프런티어/내부 판정. **프런티어(같은-소유 이웃 적음)=연대↑, 내부(이웃 다 같은 소유)=연대↓.** clamp [0,1].
- **제국 힘** = 소유 셀 연대 합.
- **국경 다툼:** 각 프런티어 셀(다른 소유자와 인접)에 대해, 인접한 최강 이웃 제국이 도전: `공격점수 = 이웃제국 힘*w1 + 그 이웃 셀 연대*w2 − dist(cell, 공격제국 수도)*w3`, `수비점수 = 방어제국 힘*w1 + cell 연대*w2 − dist(cell, 방어제국 수도)*w3`. 공격점수 > 수비점수*문턱이면 셀 소유권 이전(nextOwner).
- **이벤트(가끔, 조건부):**
  - **신도시:** 크고(셀 수 임계 이상) 안정된(평균 연대 높음) 폴리티가 낮은 확률로 새 도시 건설(내부 셀에).
  - **분열:** 크지만 평균 연대 낮은 폴리티의 국경 클러스터가 이탈 → **새 폴리티**(id·색·이름·수도=이탈 클러스터 중심).
  - **정복:** 어떤 폴리티의 **수도 셀이 함락**되면 그 폴리티 소멸 + 남은 전 영토를 함락자에게 병합.
  - **붕괴:** 셀 수 0이 된 폴리티 소멸(생존=false, 멸망년 기록).
- `year = tick * yearsPerTick`(예: 50틱 × 10년 = 500년). 파라미터·가중치(w1..w3, 임계, 문턱)는 튜닝 대상(§6).

**결정성:** rng는 `mulberry32(deriveSeed(worldSeed, HISTORY_SALT))` 자체 스트림 → 월드/도시 rng 불간섭. 고정 반복 순서 + 더블버퍼 → 재현 가능. year-0 `world.polityOf` 불변(복사본에서 시뮬).

## 4. 데이터 모델

```ts
interface HistoryPolity {
  id: number; name: string; color: string;
  capital: number;            // 현재/최종 수도 셀
  foundedYear: number;        // 0 = 초기, 이후 = 분열 탄생
  endedYear: number | null;   // 소멸년(정복/붕괴), 생존이면 null
  origin: "initial" | "fragment";
}
type HistoryEventType = "found" | "newCity" | "conquer" | "fragment" | "collapse";
interface HistoryEvent {
  year: number; type: HistoryEventType; text: string;
  polityId: number; otherId?: number; cell?: number;
}
interface HistorySnapshot { year: number; owner: Int32Array; }
interface History {
  years: number;
  polities: HistoryPolity[];      // 초기 + 생성(모두, 멸망 포함)
  events: HistoryEvent[];         // 이정표만, 연도순
  snapshots: HistorySnapshot[];   // 틱별 owner(후속 B의 스크럽용)
}
export function simulateHistory(world: World, worldSeed: number): History;
```

연대기 텍스트는 `event.text`에 완성형("142년, X 왕국 건국" / "305년, X가 Y를 정복" / "410년, 내란이 X를 갈라 Z 탄생" / "466년, X 소멸"). 폴리티 이름은 `world.polities`(초기) + 자체 name gen(신규). 신도시 이름도 자체 name gen.

## 5. 아키텍처 / 통합

| 모듈 | 작업 |
|---|---|
| `engine/history.ts` ⭐신규 | `simulateHistory(world, worldSeed): History` + 타입. 순수·DOM 비의존. 재사용: `grid.neighbors`, `world.polityOf`/`polities`/`cities`, `makeNameGen`, `mulberry32`/`deriveSeed`. |
| `types/world.ts` | `History`/`HistoryPolity`/`HistoryEvent`/`HistorySnapshot` 타입(또는 history.ts에서 export). |
| `ui` (연대기 패널) | 연도별 사건 텍스트 리스트(시대 구분 헤더). `simulateHistory` 결과를 렌더. 스크러버 없음. |

`generateWorld`는 **불변**. History는 별도 객체로, 앱이 `simulateHistory(world, seed)` 호출해 패널 렌더. **World JSON/export에 History 미포함**(직렬화 폭증 방지).

## 6. 테스트 (스크린샷 무관, 지금 검증 가능)

- **결정성:** 같은 (world, seed)에서 `events`/`snapshots` 동일(해시).
- **year-0 불변:** 시뮬 후 `world.polityOf` 원본과 동일(복사본 시뮬 증명).
- **이정표만:** `events.length`가 수십 규모(예: 3~120), 셀당 이벤트 아님.
- **소유 보존:** 각 스냅샷에서 land 셀 소유 합 = land 셀 수(모든 land 셀이 정확히 한 소유자/-1).
- **정복/붕괴 일관:** `endedYear≠null` 폴리티는 그 이후 스냅샷에서 소유 셀 0; 정복 이벤트의 피정복 폴리티는 소멸.
- **분열:** 분열 이벤트 발생 시 새 `HistoryPolity(origin:"fragment")`가 목록에 존재.
- **동역학 지표(튜닝 게이트):** 여러 시드에서 (a) 초기>1 폴리티면 시뮬 중 생존 폴리티 수가 **즉시 1/0으로 안 감**(중간 틱에 2개 이상 유지), (b) 정복·분열 이벤트가 **둘 다** 다수 시드에서 발생, (c) 사건 0 아님. 실패 시 §3 가중치 튜닝.
- **축퇴 견고:** 폴리티 0/1개 → 크래시 없이 빈/소박 결과.
- **UI 스모크(jsdom):** 사건 리스트가 연도·텍스트로 렌더.

## 7. 위험 / 범위 밖

- **동역학 튜닝**이 최대 리스크(흥망 균형). 지표 테스트(§6)로 관리 + 전용 튜닝 태스크.
- 스냅샷 메모리(~0.8MB) OK, 단 World에 안 넣어 export 무영향.
- **범위 밖(B/다음):** 타임라인 슬라이더+▶재생, 지도 연도 스크럽 재렌더, 경제·외교·문화/종교, 골든에이지/위기 세부 모델, 국경선 애니메이션.
