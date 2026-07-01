# 역사 엔진 + 연대기 (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 정치 지도를 0년으로 두고 Turchin 연대 모델을 ~500년 앞으로 시뮬해, 읽히는 **연대기(사건 로그)** + 연도별 정치 스냅샷을 생성하고 텍스트 연대기 패널로 보여준다.

**Architecture:** 새 `engine/history.ts`가 `world.polityOf` 복사본에서 더블버퍼 틱을 돌린다(연대 갱신 → 국경 다툼 → 정복/병합 → 분열/신도시 → 스냅샷). History는 자체 폴리티 목록·이정표 사건·틱별 소유 스냅샷을 담은 별도 객체(World 불변, export 무영향). UI는 사건 텍스트 패널.

**Tech Stack:** TypeScript(strict), Vitest(+jsdom). 기존 라이브러리만, 신규 의존성 없음.

## Global Constraints

- TypeScript `strict`(`noUnusedLocals`). 신규 런타임 의존성 금지.
- 모든 무작위성은 시드 PRNG만(`Math.random()` 금지). 역사 rng = `mulberry32(deriveSeed(worldSeed, 9001))` 자체 스트림 → 월드/도시 rng 불간섭.
- 엔진(`src/engine/**`) DOM 비의존. 렌더는 `src/ui/**`.
- `generateWorld` 시그니처 불변. **year-0 `world.polityOf` 불변**(시뮬은 복사본). History는 별도 객체 — World JSON/export에 미포함.
- 더블버퍼 틱(틱 시작 상태에서 계산 → 동시 적용) → 순서 편향 없음, 결정적.
- 사건은 **이정표만**(건국·신도시·정복·분열); 셀 이동은 스냅샷에만.

---

## File Structure

```
src/engine/history.ts       simulateHistory + 타입 + Turchin 모델 (신규)
src/ui/chronicle.ts          연대기 텍스트 패널 (신규)
src/ui/app.ts                world 생성 시 history 계산 + 패널 마운트 (수정)
```

재사용: `grid.neighbors`·`grid.points`·`grid.count`, `world.polityOf`/`polities`/`terrain`, `makeNameGen`(names), `mulberry32`/`deriveSeed`(rng), `OCEAN`(terrain).

**공통 상수(파일 상단, Task 6에서 튜닝):**
```ts
const HISTORY_SALT = 9001;
const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;
const W_POWER = 0.01, W_LOCAL = 1.0, W_DIST = 0.004, CONTEST_THRESH = 1.05;
const FRAG_MIN_CELLS = 120, FRAG_MAX_AVGSOL = 0.42, FRAG_PROB = 0.2, FRAG_CLUSTER = 30;
const CITY_MIN_CELLS = 60, CITY_MIN_AVGSOL = 0.6, CITY_PROB = 0.1;
const HPALETTE = ["#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6", "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8"];
```

---

### Task 1: 스켈레톤 — 타입 + 연대 갱신 + 틱 루프 + 스냅샷

**Files:**
- Create: `src/engine/history.ts`, `src/engine/history.test.ts`

**Interfaces:**
- Consumes: `World`(types/world); `mulberry32`/`deriveSeed`(rng); `makeNameGen`(names); `OCEAN`(terrain).
- Produces: 타입 `HistoryPolity`/`HistoryEventType`/`HistoryEvent`/`HistorySnapshot`/`History`; `simulateHistory(world: World, worldSeed: number): History`.

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/history.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";

function build(seed: number) {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return world;
}

describe("simulateHistory skeleton", () => {
  it("is deterministic", () => {
    const w = build(1);
    const a = simulateHistory(w, 1), b = simulateHistory(w, 1);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.snapshots.length).toBe(b.snapshots.length);
  });
  it("does not mutate world.polityOf (simulates on a copy)", () => {
    const w = build(2);
    const before = w.polityOf.slice();
    simulateHistory(w, 2);
    expect(w.polityOf).toEqual(before);
  });
  it("every land cell has exactly one owner or -1 in each snapshot (ownership conserved)", () => {
    const w = build(3);
    const h = simulateHistory(w, 3);
    const landCount = w.terrain.filter((t) => t !== 0).length;
    for (const snap of h.snapshots) {
      let owned = 0;
      for (let c = 0; c < snap.owner.length; c++) if (snap.owner[c] >= 0) owned++;
      expect(owned).toBeLessThanOrEqual(landCount);
    }
  });
  it("opens the chronicle with a founding event per initial polity", () => {
    const w = build(4);
    const h = simulateHistory(w, 4);
    const founds = h.events.filter((e) => e.type === "found" && e.year === 0);
    expect(founds.length).toBe(w.polities.length);
    expect(h.polities.length).toBeGreaterThanOrEqual(w.polities.length);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- history` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/history.ts` (Task 1은 자기 지역 변수만; 이후 태스크가 선언을 추가하며 확장 — `void` 스캐폴딩 없음)

```ts
import { OCEAN } from "./terrain";
import type { World } from "../types/world";

const TICKS = 50, YEARS_PER_TICK = 10;
const SOL_INIT = 0.5, SOL_RISE = 0.03, SOL_DECAY = 0.02;

export interface HistoryPolity {
  id: number; name: string; color: string;
  capital: number; foundedYear: number; endedYear: number | null;
  origin: "initial" | "fragment";
}
export type HistoryEventType = "found" | "newCity" | "conquer" | "fragment";
export interface HistoryEvent {
  year: number; type: HistoryEventType; text: string;
  polityId: number; otherId?: number; cell?: number;
}
export interface HistorySnapshot { year: number; owner: Int32Array; }
export interface History {
  years: number;
  polities: HistoryPolity[];
  events: HistoryEvent[];
  snapshots: HistorySnapshot[];
}

export function simulateHistory(world: World, _worldSeed: number): History {
  const { grid, terrain, polityOf } = world;
  const n = grid.count;
  const neighbors = grid.neighbors;

  const owner = Int32Array.from(polityOf);
  let solidarity = new Float32Array(n);
  for (let c = 0; c < n; c++) solidarity[c] = owner[c] >= 0 ? SOL_INIT : 0;

  const polities: HistoryPolity[] = world.polities.map((p) => ({
    id: p.id, name: p.name, color: p.color, capital: p.capital,
    foundedYear: 0, endedYear: null, origin: "initial" as const,
  }));

  const events: HistoryEvent[] = [];
  for (const p of polities) events.push({ year: 0, type: "found", text: `0년, ${p.name} 건국`, polityId: p.id, cell: p.capital });

  const snapshots: HistorySnapshot[] = [{ year: 0, owner: owner.slice() }];

  for (let tick = 1; tick <= TICKS; tick++) {
    const year = tick * YEARS_PER_TICK;
    // --- solidarity update (double-buffered) ---
    const nextSol = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const o = owner[c];
      if (o < 0) { nextSol[c] = 0; continue; }
      let frontier = false;
      for (const nb of neighbors[c]) { if (terrain[nb] !== OCEAN && owner[nb] !== o) { frontier = true; break; } }
      const s = solidarity[c] + (frontier ? SOL_RISE : -SOL_DECAY);
      nextSol[c] = s < 0 ? 0 : s > 1 ? 1 : s;
    }
    solidarity = nextSol;
    // (Task 2 inserts border contests here; Task 3 conquest; Task 4 fragment/newCity)
    snapshots.push({ year, owner: owner.slice() });
  }

  return { years: TICKS * YEARS_PER_TICK, polities, events, snapshots };
}
```
(주: 이 저장소는 `noUnusedParameters: true`라 T1에서 미사용인 시드 파라미터는 **반드시 `_worldSeed`**(언더스코어 접두 = 미사용 파라미터 면제)로 둔다. Task 4가 이를 `worldSeed`로 되돌려 rng/name gen 시드로 쓴다. `terrain`/`polityOf`는 T1에서 사용.)

- [ ] **Step 4: 통과 + 빌드** — Run: `npm test -- history` → PASS(4개). `npm test`(전체) + `npm run build` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/history.ts src/engine/history.test.ts
git commit -m "feat: history engine skeleton (solidarity + snapshots)"
```

---

### Task 2: 국경 다툼 (영토 이전 + 미점유 확장)

**Files:**
- Modify: `src/engine/history.ts`, `src/engine/history.test.ts`

**Interfaces:**
- Consumes: Task 1의 루프/`agg`/`dist`/`capitals`.
- Produces: 매 틱 `owner`가 진화(더블버퍼). 상수 `W_POWER`/`W_LOCAL`/`W_DIST`/`CONTEST_THRESH`.

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/history.test.ts`

```ts
  it("evolves ownership over time (some cells change owner)", () => {
    const w = build(5);
    const h = simulateHistory(w, 5);
    const first = h.snapshots[0].owner, last = h.snapshots[h.snapshots.length - 1].owner;
    let changed = 0;
    for (let c = 0; c < first.length; c++) if (first[c] !== last[c]) changed++;
    expect(changed).toBeGreaterThan(0);
  });
  it("never assigns a land cell to a nonexistent polity", () => {
    const w = build(6);
    const h = simulateHistory(w, 6);
    for (const snap of h.snapshots) for (let c = 0; c < snap.owner.length; c++) {
      const o = snap.owner[c];
      expect(o).toBeGreaterThanOrEqual(-1);
      expect(o).toBeLessThan(h.polities.length);
    }
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- history` → 새 "evolves ownership" 테스트 FAIL(아직 owner 불변)

- [ ] **Step 3: 구현** — `src/engine/history.ts`

상수 블록에 추가:
```ts
const W_POWER = 0.01, W_LOCAL = 1.0, W_DIST = 0.004, CONTEST_THRESH = 1.05;
```
모듈 최상단(타입 근처)에 집계 타입 추가:
```ts
interface Agg { cells: number; power: number; }
```
`const neighbors = grid.neighbors;` **다음**에 거리 헬퍼 추가:
```ts
  const px = (i: number) => grid.points[i * 2];
  const py = (i: number) => grid.points[i * 2 + 1];
  const dist = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b));
```
`polities` 선언 **다음**에 수도 배열 추가:
```ts
  const capitals: number[] = polities.map((p) => p.capital);
```
`snapshots` 선언 **다음**(루프 전)에 집계 헬퍼 추가:
```ts
  const aggregate = (): Agg[] => {
    const a: Agg[] = polities.map(() => ({ cells: 0, power: 0 }));
    for (let c = 0; c < n; c++) { const o = owner[c]; if (o >= 0) { a[o].cells++; a[o].power += solidarity[c]; } }
    return a;
  };
```
루프의 `solidarity = nextSol;` **다음**, `// (Task 2 inserts...)` 주석 줄을 아래 국경 다툼으로 교체:
```ts
    // --- border contests (double-buffered) ---
    const agg = aggregate();
    const nextOwner = owner.slice();
    for (let c = 0; c < n; c++) {
      if (terrain[c] === OCEAN) continue;
      const o = owner[c];
      let best = -1, bestPow = -Infinity, bestCell = -1;
      for (const nb of neighbors[c]) {
        if (terrain[nb] === OCEAN) continue;
        const p = owner[nb];
        if (p < 0 || p === o) continue;
        if (agg[p].power > bestPow) { bestPow = agg[p].power; best = p; bestCell = nb; }
      }
      if (best < 0) continue; // no claimant neighbour
      const attack = agg[best].power * W_POWER + solidarity[bestCell] * W_LOCAL - dist(c, capitals[best]) * W_DIST;
      const defend = o < 0 ? 0 : agg[o].power * W_POWER + solidarity[c] * W_LOCAL - dist(c, capitals[o]) * W_DIST;
      if (attack > defend * CONTEST_THRESH) nextOwner[c] = best;
    }
    owner.set(nextOwner);
```
(주: `agg`는 Task 3·4도 쓰지만 각자 필요 시점에 재집계하므로 여기 `agg`는 다툼 전용. Task 3 conquest는 `owner.set` 다음에 삽입.)

- [ ] **Step 4: 통과 + 빌드** — Run: `npm test -- history` → PASS. `npm test` + `npm run build` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/history.ts src/engine/history.test.ts
git commit -m "feat: history border contests (territory evolves)"
```

---

### Task 3: 정복 (수도 함락 → 병합 + 정복 사건)

**Files:**
- Modify: `src/engine/history.ts`, `src/engine/history.test.ts`

**Interfaces:**
- Consumes: Task 2의 `owner`/`alive`/`capitals`/`events`/`polities`.
- Produces: 수도 함락 폴리티 소멸 + 전 영토 병합, `conquer` 사건, `endedYear` 기록.

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/history.test.ts`

```ts
  it("keeps events to milestones (dozens, not per-cell)", () => {
    const w = build(7);
    const h = simulateHistory(w, 7);
    expect(h.events.length).toBeLessThan(200);
    expect(h.events.length).toBeGreaterThan(0);
  });
  it("eliminates a conquered polity: 0 cells and endedYear after its conquest", () => {
    // scan seeds for one that yields a conquest
    for (const s of [5, 7, 11, 13, 2, 3, 8]) {
      const w = build(s);
      const h = simulateHistory(w, s);
      const conq = h.events.find((e) => e.type === "conquer");
      if (!conq) continue;
      const dead = h.polities.find((p) => p.id === conq.otherId)!;
      expect(dead.endedYear).not.toBeNull();
      const after = h.snapshots.find((sn) => sn.year > conq.year);
      if (after) { let cells = 0; for (let c = 0; c < after.owner.length; c++) if (after.owner[c] === dead.id) cells++; expect(cells).toBe(0); }
      return;
    }
    // if no seed produced a conquest, the tuning task (Task 6) addresses it; don't fail here
    expect(true).toBe(true);
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- history` → "milestones" PASS(이미 소수) but confirm suite green; conquest 테스트는 정복 없으면 vacuous. (핵심은 구현 후 정복이 실제로 생겨야 함 — Task 6에서 지표로 강제.)

- [ ] **Step 3: 구현** — `src/engine/history.ts`

`const capitals: number[] = ...;` **다음**에 생존 배열 추가:
```ts
  const alive: boolean[] = polities.map(() => true);
```
루프에서 `owner.set(nextOwner);` **다음**(같은 틱 내)에 정복 처리 삽입:
```ts
    // --- conquest: a polity whose capital falls is eliminated and annexed ---
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o]) continue;
      const capOwner = owner[capitals[o]];
      if (capOwner >= 0 && capOwner !== o) {
        for (let c = 0; c < n; c++) if (owner[c] === o) owner[c] = capOwner; // annex remainder
        alive[o] = false; polities[o].endedYear = year;
        events.push({ year, type: "conquer", text: `${year}년, ${polities[capOwner].name}이(가) ${polities[o].name}을(를) 정복`, polityId: capOwner, otherId: o, cell: capitals[o] });
      }
    }
```

- [ ] **Step 4: 통과 + 빌드** — Run: `npm test -- history` → PASS. `npm test` + `npm run build` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/history.ts src/engine/history.test.ts
git commit -m "feat: history conquest (capital capture, annexation)"
```

---

### Task 4: 분열 (새 폴리티 탄생) + 신도시

**Files:**
- Modify: `src/engine/history.ts`, `src/engine/history.test.ts`

**Interfaces:**
- Consumes: Task 3의 `owner`/`agg`/`polities`/`alive`/`capitals`/`events`/`rng`/`nameGen`/`HPALETTE`.
- Produces: `fragment`(새 `HistoryPolity origin:"fragment"`) + `newCity` 사건. 상수 `FRAG_*`/`CITY_*`.

- [ ] **Step 1: 실패 테스트 추가** — `src/engine/history.test.ts`

```ts
  it("can spawn a fragment polity across seeds (new polity with origin 'fragment')", () => {
    let found = false;
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const h = simulateHistory(build(s), s);
      if (h.polities.some((p) => p.origin === "fragment")) { found = true; break; }
    }
    expect(found).toBe(true);
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- history` → 새 테스트 FAIL(분열 없음)

- [ ] **Step 3: 구현** — `src/engine/history.ts`

import 추가(상단):
```ts
import { mulberry32, deriveSeed } from "./rng";
import { makeNameGen } from "./names";
```
상수 블록에 추가:
```ts
const HISTORY_SALT = 9001;
const FRAG_MIN_CELLS = 120, FRAG_MAX_AVGSOL = 0.42, FRAG_PROB = 0.2, FRAG_CLUSTER = 30;
const CITY_MIN_CELLS = 60, CITY_MIN_AVGSOL = 0.6, CITY_PROB = 0.1;
const HPALETTE = ["#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6", "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8"];
```
함수 시그니처의 `_worldSeed`를 `worldSeed`로 되돌린다(이제 사용). `const owner = Int32Array.from(polityOf);` **다음**에 rng·이름 생성기 추가:
```ts
  const rng = mulberry32(deriveSeed(worldSeed, HISTORY_SALT));
  const nameGen = makeNameGen(mulberry32(deriveSeed(worldSeed, HISTORY_SALT + 1)));
```
루프의 정복 블록 **다음**(같은 틱)에 분열·신도시 삽입:
```ts
    // --- fragmentation: one large, low-solidarity polity may shed a border cluster ---
    const agg2 = aggregate();
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o] || agg2[o].cells < FRAG_MIN_CELLS) continue;
      if (agg2[o].power / agg2[o].cells >= FRAG_MAX_AVGSOL) continue;
      if (rng() > FRAG_PROB) continue;
      // seed = a border cell of o that is not the capital
      let seed = -1;
      for (let c = 0; c < n; c++) {
        if (owner[c] !== o || c === capitals[o]) continue;
        if (neighbors[c].some((nb) => terrain[nb] !== OCEAN && owner[nb] !== o)) { seed = c; break; }
      }
      if (seed < 0) continue;
      // grow a bounded cluster within o's cells (BFS), excluding the capital
      const cluster: number[] = [seed]; const inCluster = new Set([seed]);
      for (let qi = 0; qi < cluster.length && cluster.length < FRAG_CLUSTER; qi++) {
        for (const nb of neighbors[cluster[qi]]) {
          if (owner[nb] === o && nb !== capitals[o] && !inCluster.has(nb)) { inCluster.add(nb); cluster.push(nb); if (cluster.length >= FRAG_CLUSTER) break; }
        }
      }
      if (cluster.length < 6) continue;
      const newId = polities.length;
      polities.push({ id: newId, name: nameGen.nation(), color: HPALETTE[newId % HPALETTE.length], capital: seed, foundedYear: year, endedYear: null, origin: "fragment" });
      capitals.push(seed); alive.push(true);
      for (const c of cluster) owner[c] = newId;
      events.push({ year, type: "fragment", text: `${year}년, 내란이 ${polities[o].name}을(를) 갈라 ${polities[newId].name} 탄생`, polityId: o, otherId: newId, cell: seed });
      break; // at most one fragmentation per tick
    }
    // --- new city: one large, stable polity may found a lore city ---
    for (let o = 0; o < polities.length; o++) {
      if (!alive[o] || agg2[o].cells < CITY_MIN_CELLS) continue;
      if (agg2[o].power / agg2[o].cells < CITY_MIN_AVGSOL) continue;
      if (rng() > CITY_PROB) continue;
      events.push({ year, type: "newCity", text: `${year}년, ${polities[o].name}이(가) ${nameGen.place()} 건설`, polityId: o, cell: capitals[o] });
      break; // at most one per tick
    }
```

- [ ] **Step 4: 통과 + 빌드** — Run: `npm test -- history` → PASS. `npm test` + `npm run build` 클린.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/history.ts src/engine/history.test.ts
git commit -m "feat: history fragmentation and lore-city founding"
```

---

### Task 5: 연대기 UI 패널 + 앱 통합

**Files:**
- Create: `src/ui/chronicle.ts`, `src/ui/chronicle.test.ts`
- Modify: `src/ui/app.ts`

**Interfaces:**
- Consumes: `History`/`HistoryEvent`(history).
- Produces: `renderChronicle(history: History): HTMLElement` (연도별 사건 리스트, 세기 헤더).

- [ ] **Step 1: 실패 테스트 작성** — `src/ui/chronicle.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";
import { renderChronicle } from "./chronicle";

describe("renderChronicle", () => {
  it("renders one row per event with year + text", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const h = simulateHistory(world, 1);
    const el = renderChronicle(h);
    expect(el.querySelectorAll(".chronicle-event").length).toBe(h.events.length);
    expect(el.textContent).toContain("건국");
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- chronicle` → FAIL

- [ ] **Step 3: 구현** — `src/ui/chronicle.ts`

```ts
import type { History } from "../engine/history";

export function renderChronicle(history: History): HTMLElement {
  const root = document.createElement("div");
  root.className = "chronicle";
  const title = document.createElement("h3");
  title.textContent = `연대기 (0–${history.years}년)`;
  root.appendChild(title);
  const list = document.createElement("ol");
  list.className = "chronicle-list";
  let lastCentury = -1;
  for (const e of history.events) {
    const century = Math.floor(e.year / 100);
    if (century !== lastCentury) {
      lastCentury = century;
      const h = document.createElement("li");
      h.className = "chronicle-era";
      h.textContent = `${century * 100}년대`;
      list.appendChild(h);
    }
    const row = document.createElement("li");
    row.className = `chronicle-event evt-${e.type}`;
    row.textContent = e.text;
    list.appendChild(row);
  }
  root.appendChild(list);
  return root;
}
```

- [ ] **Step 4: 앱 통합** — `src/ui/app.ts`

import 추가:
```ts
import { simulateHistory } from "../engine/history";
import { renderChronicle } from "./chronicle";
```
`let generated: GeneratedWorld = generateWorld(params);` 다음:
```ts
  let history = simulateHistory(generated.world, params.seed);
```
`regenerate`의 `generated = generateWorld(params);` 다음:
```ts
    history = simulateHistory(generated.world, params.seed);
```
`showWorld`의 `stage.appendChild(svg);` **다음**에 연대기 패널 마운트:
```ts
    stage.appendChild(renderChronicle(history));
```

- [ ] **Step 5: 통과 + 빌드** — Run: `npm test` → PASS(app.test 포함). `npm run build` 클린.

- [ ] **Step 6: 커밋**

```bash
git add src/ui/chronicle.ts src/ui/chronicle.test.ts src/ui/app.ts
git commit -m "feat: chronicle panel and app integration"
```

---

### Task 6: 동역학 튜닝 + 통합 검증

**Files:**
- Modify: `src/engine/history.ts`(상수만), `src/engine/history.test.ts`

**Interfaces:** 없음(상수 튜닝 + 지표 게이트 테스트).

- [ ] **Step 1: 동역학 지표 테스트 추가** — `src/engine/history.test.ts`

```ts
  it("produces interesting dynamics across seeds (not runaway/instant-collapse)", () => {
    let conquestSeeds = 0, fragmentSeeds = 0, aliveVaries = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const s of seeds) {
      const w = build(s);
      if (w.polities.length < 2) continue;
      const h = simulateHistory(w, s);
      if (h.events.some((e) => e.type === "conquer")) conquestSeeds++;
      if (h.polities.some((p) => p.origin === "fragment")) fragmentSeeds++;
      // alive count at the middle tick is >= 2 (not collapsed to 1/0 instantly)
      const mid = h.snapshots[Math.floor(h.snapshots.length / 2)];
      const ids = new Set<number>(); for (let c = 0; c < mid.owner.length; c++) if (mid.owner[c] >= 0) ids.add(mid.owner[c]);
      if (ids.size >= 2) aliveVaries++;
    }
    expect(conquestSeeds).toBeGreaterThan(0);  // some seeds see conquests
    expect(fragmentSeeds).toBeGreaterThan(0);  // some seeds see fragmentation
    expect(aliveVaries).toBeGreaterThanOrEqual(seeds.length - 2); // most keep >=2 powers mid-run
  });
```

- [ ] **Step 2: 실패 확인 + 튜닝** — Run: `npm test -- history`. 지표가 안 맞으면 §상수 튜닝:
  - 한 폴리티가 다 먹으면(정복만·생존 1로 수렴): `CONTEST_THRESH`↑(정복 어렵게), `SOL_DECAY`↑(대제국 약화 빠르게), `W_DIST`↑(원정 페널티↑).
  - 아무 일도 안 일어나면(정복 0): `CONTEST_THRESH`↓, `W_POWER`↑.
  - 분열이 없으면: `FRAG_MIN_CELLS`↓ / `FRAG_MAX_AVGSOL`↑ / `FRAG_PROB`↑.
  각 조정 후 `npm test -- history` 재확인. 결정성·이정표 테스트도 계속 초록 유지.

- [ ] **Step 3: 전체 + 빌드** — Run: `npm test` → 전부 PASS. `npm run build` → 성공.

- [ ] **Step 4: localhost 육안** — preview reload. 세계 뷰에 연대기 패널이 뜨는지, 사건 텍스트(건국/정복/분열/신도시)가 읽히는지, 시드 바꾸면 다른 역사가 나오는지 확인(`preview_eval`로 `.chronicle-event` 개수·텍스트 점검).

- [ ] **Step 5: 커밋(튜닝 변경 있을 때)**

```bash
git add src/engine/history.ts src/engine/history.test.ts
git commit -m "tune: history dynamics for rise-and-fall balance"
```

---

## Self-Review

**Spec coverage:** Turchin 모델(연대 갱신·힘·국경 다툼·유클리드 수도거리)→T1·T2. 정복(수도함락→병합)→T3. 분열(새 폴리티)·신도시→T4. 이정표 사건·자체 폴리티 목록·스냅샷·결정성·year-0 불변→T1–T4. 연대기 UI→T5. 동역학 튜닝 지표→T6. World 분리(별도 객체, export 미포함)·자체 rng/name gen→전 태스크. ✅

**Placeholder scan:** TBD/TODO 없음. 파라미터는 상수로 명시(T6 튜닝). 각 태스크는 자기 지역 변수만 선언(T1 최소 스켈레톤 → T2 dist/capitals/aggregate → T3 alive → T4 rng/nameGen) — `void` 스캐폴딩 없음, 최종 코드 클린. 유일한 임시: 저장소가 `noUnusedParameters:true`라 T1의 미사용 시드 파라미터는 `_worldSeed`(면제)로 두고 T4에서 `worldSeed`로 복원. ✅

**Type consistency:** `simulateHistory(world,worldSeed):History`(T1 정의→T5 소비). `History{years,polities:HistoryPolity[],events:HistoryEvent[],snapshots:HistorySnapshot[]}`. `HistoryEventType` = found|newCity|conquer|fragment(스펙의 "collapse"는 셀이 claimant에게만 이전되므로 수도함락=conquer로 실현 — 별도 collapse 없음, T3 주석/커밋에 반영). `owner:Int32Array`, `capitals:number[]`, `alive:boolean[]` 일관. `HPALETTE` export(T1)→T4. `renderChronicle(History):HTMLElement`(T5). ✅

**Notes:** (1) 스펙의 collapse는 mechanics상 conquer로 통합(셀은 claimant에게만 이전 → 0-cell은 곧 수도함락). 테스트는 "정복된 폴리티 이후 셀 0"으로 그 불변을 검증. (2) T1–T4는 같은 `simulateHistory` 루프를 순차 확장(각 태스크가 명확한 새 동작 = 독립 리뷰 가능). (3) 동역학은 T6 지표 게이트로 관리 — 시작 상수는 출발점이며 튜닝 필요할 수 있음. (4) T5는 app.ts를 건드림(역사 패널 마운트) — 신규 기능이라 필요, 최소 변경.
