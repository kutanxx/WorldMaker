# Player Interventions Phase 2 (foundCity + peace + attack breakthrough) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 2 of the player-interventions spec (`docs/superpowers/specs/2026-07-06-player-interventions-design.md`): add the `foundCity` and `peace` actions, and fix the "single-cell attack feels marginal" gap with a follow-on breakthrough capture.

**Architecture:** All player mechanics stay gated on `playerPolity >= 0` (plus non-empty `truces`/`foundedCities`) so the pure history path (`simulateHistory` golden hashes in `history.test.ts`) is byte-identical. Engine logic lives in `src/engine/intervention.ts` (actions + enumerators) and `src/engine/historySim.ts` (SimState fields + gated stepSim hooks + constants); `src/engine/playSim.ts` gains scorecard fields; UI in `src/ui/playApp.ts` + i18n in `src/ui/i18n.ts`.

**Tech Stack:** TypeScript + Vite, vitest (jsdom for UI tests).

## Global Constraints

- `history.test.ts` golden hashes MUST stay green (pure path byte-identical) — every new mechanic no-ops when `playerPolity < 0` / collections empty.
- `initSim` returns `truces: new Map()`, `foundedCities: new Set()` (defaults = no-player values).
- New constants (exported from historySim.ts unless noted): `CITY_SOL_FLOOR = 0.55`, `CITY_POWER_BONUS = 0.08`, `CITY_MIN_GAP = 60`, `PEACE_TICKS = 3`; from intervention.ts: `ATTACK_FOLLOW_MAX = 3`.
- Event text convention: KO strings like the sim's (`` `${year}년, …` ``); UI localises via `code`+`data` on `InterventionResult`.
- Run tests from THIS worktree root (running from the main repo globs worktree copies).
- Commit after each task; commit messages `feat(play): …` style, ending with the Claude co-author line.

---

### Task 1: Attack breakthrough (follow-on capture)

**Files:**
- Modify: `src/engine/intervention.ts` (attack branch of `applyIntervention`)
- Modify: `src/ui/i18n.ts` (`playLog` captured/landed lines gain a count)
- Test: `src/engine/intervention.test.ts`

**Interfaces:**
- Produces: `ATTACK_FOLLOW_MAX = 3` exported from intervention.ts; successful attack result `data` becomes `{ name, n }` where `n` = total cells captured (1 + follow-ons).

- [ ] **Step 1: Write the failing tests** (append to `intervention.test.ts`)

```ts
describe("attack breakthrough (follow-on capture)", () => {
  it("an overwhelming attack also captures weak same-owner neighbours, capped at 1+ATTACK_FOLLOW_MAX", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
      else if (s.owner[c] >= 0) s.solidarity[c] = 0; // defenceless enemies
    }
    const target = borderTargets(s).find((t) => t.capturable && !t.sea)!;
    const def = s.owner[target.cell];
    const before = new Set<number>();
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) before.add(c);
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    expect(r.ok).toBe(true);
    let gained = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity && !before.has(c)) gained++;
    expect(gained).toBe(Number(r.data!.n));
    expect(gained).toBeGreaterThanOrEqual(1);
    expect(gained).toBeLessThanOrEqual(1 + ATTACK_FOLLOW_MAX);
    // follow-ons only ever come from the SAME defender, adjacent to the target
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity && !before.has(c) && c !== target.cell) {
        expect(s.grid.neighbors[target.cell]).toContain(c);
        expect(s.solidarity[c]).toBeCloseTo(CONQUEST_SOL, 6);
        void def; // captured FROM def by construction (owner flipped)
      }
    }
  });

  it("a marginal attack captures only the picked cell (no free ride)", () => {
    const s = biggestPlayerState(1);
    // uniform solidarity: atk ≈ def, so follow-ons (which face the same math) don't cascade
    const target = borderTargets(s).find((t) => t.capturable && !t.sea);
    if (!target) return; // seed-dependent; the overwhelming test above is the real guard
    const r = applyIntervention(s, { type: "attack", cell: target.cell });
    if (r.ok) expect(Number(r.data!.n)).toBeGreaterThanOrEqual(1);
  });
});
```

Also import `ATTACK_FOLLOW_MAX` in the test file's intervention import.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/engine/intervention.test.ts` → FAIL (`ATTACK_FOLLOW_MAX` not exported; `data.n` undefined).

- [ ] **Step 3: Implement.** In `intervention.ts`:

```ts
export const ATTACK_FOLLOW_MAX = 3; // max extra cells a breakthrough can carry beyond the picked cell
```

In the attack success branch (after `s.owner[target] = …; s.solidarity[target] = CONQUEST_SOL;`):

```ts
// breakthrough: the assault carries into adjacent cells of the SAME defender that also lose
// the same contest (honest low-agency: only cells the player could take anyway) — this is what
// makes a well-picked attack feel like a real offensive instead of a single-cell nibble.
let captured = 1;
for (const nb of s.grid.neighbors[target]) {
  if (captured >= 1 + ATTACK_FOLLOW_MAX) break;
  if (s.terrain[nb] === OCEAN || s.owner[nb] !== def) continue;
  const fAtk = contestStrength(s, agg, s.playerPolity, nb, target) * (amphib ? AMPHIB_MULT : 1);
  const fDef = contestStrength(s, agg, def, nb, nb);
  if (fAtk * ATTACK_EDGE >= fDef) {
    s.owner[nb] = s.playerPolity;
    s.solidarity[nb] = CONQUEST_SOL;
    captured++;
  }
}
return { ok: true, message: `${how} ${captured > 1 ? captured + " cells" : "a cell"} from ${name}.`,
  code: amphib ? "landed" : "captured", data: { name, n: captured } };
```

In `i18n.ts` `playLog`, captured/landed use the count (`const n = Number(data.n ?? 0)` already exists — beware `n ?? 0`; use `const cnt = Math.max(1, Number(data.n ?? 1))`):

- KO: `captured`: `` cnt > 1 ? `${name}에게서 셀 ${cnt}개를 빼앗았습니다.` : `${name}에게서 셀을 빼앗았습니다.` ``; `landed`: `` cnt > 1 ? `${name}에 상륙하여 셀 ${cnt}개를 점령했습니다.` : `${name}에 상륙하여 셀을 점령했습니다.` ``
- EN: `captured`: `` cnt > 1 ? `Captured ${cnt} cells from ${name}.` : `Captured a cell from ${name}.` ``; `landed`: analogous.

- [ ] **Step 4: Run tests** — `npx vitest run src/engine/intervention.test.ts src/ui` → PASS (existing single-capture test still passes: it asserts the target flips, not exclusivity).

- [ ] **Step 5: Commit** — `git add src/engine/intervention.ts src/engine/intervention.test.ts src/ui/i18n.ts && git commit -m "feat(play): attack breakthrough — follow-on capture of weak adjacent cells"`

---

### Task 2: foundCity action + anchor

**Files:**
- Modify: `src/engine/historySim.ts` (SimState.foundedCities, constants, contest bonus, solidarity floor)
- Modify: `src/engine/intervention.ts` (`foundCityTargets`, foundCity branch)
- Modify: `src/ui/i18n.ts` (`playLog` codes `founded`, `badSite`)
- Test: `src/engine/intervention.test.ts`, `src/engine/historySim.test.ts` (or wherever initSim defaults are asserted — `src/engine/history.test.ts` has the golden; add the defaults test next to the existing playerPolity default test if present, else in intervention.test.ts)

**Interfaces:**
- Produces (historySim.ts): `SimState.foundedCities: Set<number>`; exports `CITY_SOL_FLOOR = 0.55`, `CITY_POWER_BONUS = 0.08`, `CITY_MIN_GAP = 60`.
- Produces (intervention.ts): `Action` union gains `{ type: "foundCity"; cell: number }`; `foundCityTargets(s): { cell: number; sol: number }[]` (player-owned land cells ≥ CITY_MIN_GAP from every existing/founded city, sorted by sol desc).
- Result codes: `founded` (data `{ name }`), `badSite` (owned/gap violation).

- [ ] **Step 1: Failing tests** (append to `intervention.test.ts`):

```ts
import { CITY_MIN_GAP, CITY_SOL_FLOOR, CITY_POWER_BONUS, stepSim, aggregate, contestStrength } from "./historySim";
import { foundCityTargets } from "./intervention";

describe("foundCity", () => {
  const cellDist = (s: ReturnType<typeof playerState>, a: number, b: number) =>
    Math.hypot(s.grid.points[a * 2] - s.grid.points[b * 2], s.grid.points[a * 2 + 1] - s.grid.points[b * 2 + 1]);

  it("initSim defaults: empty foundedCities and truces (golden guard)", () => {
    const s = playerState(1);
    expect(s.foundedCities.size).toBe(0);
  });

  it("targets are player-owned and respect CITY_MIN_GAP from existing cities", () => {
    const s = biggestPlayerState(1);
    const ts = foundCityTargets(s);
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) {
      expect(s.owner[t.cell]).toBe(s.playerPolity);
      for (const c of s.cityCells) expect(cellDist(s, t.cell, c.cell)).toBeGreaterThanOrEqual(CITY_MIN_GAP);
    }
  });

  it("founding adds an anchor + a newCity event; too-close site is rejected", () => {
    const s = biggestPlayerState(1);
    const t = foundCityTargets(s)[0];
    const before = s.events.length;
    const r = applyIntervention(s, { type: "foundCity", cell: t.cell });
    expect(r.ok).toBe(true);
    expect(r.code).toBe("founded");
    expect(String(r.data!.name).length).toBeGreaterThan(0);
    expect(s.foundedCities.has(t.cell)).toBe(true);
    expect(s.events.length).toBe(before + 1);
    expect(s.events[before].type).toBe("newCity");
    // second founding on the SAME cell: now too close to the new city
    expect(applyIntervention(s, { type: "foundCity", cell: t.cell }).ok).toBe(false);
  });

  it("anchor floors the cell's solidarity while owned, and stops when captured", () => {
    const s = biggestPlayerState(1);
    const t = foundCityTargets(s)[0];
    applyIntervention(s, { type: "foundCity", cell: t.cell });
    s.solidarity[t.cell] = 0.1;
    stepSim(s);
    if (s.owner[t.cell] === s.playerPolity) expect(s.solidarity[t.cell]).toBeGreaterThanOrEqual(CITY_SOL_FLOOR);
    // captured anchor goes inert (no floor for the captor)
    const s2 = biggestPlayerState(1);
    const t2 = foundCityTargets(s2)[0];
    applyIntervention(s2, { type: "foundCity", cell: t2.cell });
    const other = s2.polities.find((p) => p.id !== s2.playerPolity && s2.alive[p.id])!;
    s2.owner[t2.cell] = other.id;
    s2.solidarity[t2.cell] = 0.1;
    stepSim(s2);
    expect(s2.foundedCities.has(t2.cell)).toBe(true); // stays in the set (city exists)
  });

  it("anchor adds CITY_POWER_BONUS to the player's contest strength at the cell", () => {
    const s = biggestPlayerState(1);
    const t = foundCityTargets(s)[0];
    const agg = aggregate(s);
    const before = contestStrength(s, agg, s.playerPolity, t.cell, t.cell);
    applyIntervention(s, { type: "foundCity", cell: t.cell });
    const after = contestStrength(s, agg, s.playerPolity, t.cell, t.cell);
    expect(after).toBeCloseTo(before + CITY_POWER_BONUS, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/engine/intervention.test.ts` → FAIL (no `foundedCities`, no `foundCityTargets`).

- [ ] **Step 3: Implement.**

historySim.ts — constants next to the stance block:

```ts
// --- foundCity anchors (Phase 2): a founded city is a PERMANENT but SMALL anchor — effects apply
// only while the player still owns the cell (honest low-agency: no nation-wide escape hatch) ---
export const CITY_SOL_FLOOR = 0.55;   // founded-city cell solidarity floor per tick (while owned)
export const CITY_POWER_BONUS = 0.08; // contest bonus at the founded cell + its neighbours (while owned)
export const CITY_MIN_GAP = 60;       // min map-distance from any existing city to found a new one
```

SimState: add `truces: Map<number, number>; foundedCities: Set<number>;` (truces here now to avoid touching the interface twice; Task 3 uses it). initSim return adds `truces: new Map(), foundedCities: new Set()`.

`contestStrength` gains a gated founded-city bonus (after `zoneBonus`):

```ts
function cityAnchorBonus(s: SimState, polity: number, distCell: number): number {
  if (polity !== s.playerPolity || s.foundedCities.size === 0) return 0;
  for (const fc of s.foundedCities) {
    if (s.owner[fc] !== s.playerPolity) continue; // captured anchor is inert
    if (fc === distCell || s.grid.neighbors[fc].includes(distCell)) return CITY_POWER_BONUS;
  }
  return 0;
}
```

…and `contestStrength` adds `+ cityAnchorBonus(s, polity, distCell)`. (When `playerPolity === -1`, `polity !== -1` for every real polity ⇒ always 0 ⇒ golden safe.)

stepSim solidarity loop, right after the stance nudge line:

```ts
if (s.playerPolity >= 0 && o === s.playerPolity && s.foundedCities.has(c) && sv < CITY_SOL_FLOOR) sv = CITY_SOL_FLOOR;
```

intervention.ts:

```ts
export interface FoundTarget { cell: number; sol: number }

// player-owned land cells far enough from every existing city (world cities + already-founded),
// best (most cohesive) first — the UI shows the head of this list.
export function foundCityTargets(s: SimState): FoundTarget[] {
  if (s.playerPolity < 0) return [];
  const px = (i: number) => s.grid.points[i * 2], py = (i: number) => s.grid.points[i * 2 + 1];
  const sites = [...s.cityCells.map((c) => c.cell), ...s.foundedCities];
  const out: FoundTarget[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== s.playerPolity) continue;
    let ok = true;
    for (const sc of sites) {
      if (Math.hypot(px(c) - px(sc), py(c) - py(sc)) < CITY_MIN_GAP) { ok = false; break; }
    }
    if (ok) out.push({ cell: c, sol: s.solidarity[c] });
  }
  return out.sort((a, b) => b.sol - a.sol);
}
```

Action union: `| { type: "foundCity"; cell: number }`. Branch in `applyIntervention`:

```ts
if (action.type === "foundCity") {
  const cell = action.cell;
  if (!foundCityTargets(s).some((t) => t.cell === cell))
    return { ok: false, message: "Not a viable city site.", code: "badSite" };
  const name = s.nameGen.place();
  s.foundedCities.add(cell);
  const year = s.tick * YEARS_PER_TICK;
  s.events.push({ year, type: "newCity", text: `${year}년, ${s.polities[s.playerPolity].name}이(가) ${name} 건설`, polityId: s.playerPolity, cell });
  return { ok: true, message: `Founded the city of ${name}.`, code: "founded", data: { name } };
}
```

(import `YEARS_PER_TICK`, `CITY_MIN_GAP` from historySim.)

i18n `playLog`: `founded`: KO `` `${name}을(를) 건설했습니다.` `` / EN `` `Founded the city of ${name}.` ``; `badSite`: KO `도시를 세울 수 없는 곳입니다.` / EN `Not a viable city site.`

- [ ] **Step 4: Run** — `npx vitest run src/engine` → PASS including `history.test.ts` goldens.

- [ ] **Step 5: Commit** — `git add -- src/engine/historySim.ts src/engine/intervention.ts src/engine/intervention.test.ts src/ui/i18n.ts && git commit -m "feat(play): foundCity action — permanent small anchor (sol floor + contest bonus while owned)"`

---

### Task 3: peace action + truce gate

**Files:**
- Modify: `src/engine/historySim.ts` (PEACE_TICKS, truce skip in both contest loops)
- Modify: `src/engine/intervention.ts` (`hostileNeighbors`, peace branch, attack breaks truce)
- Modify: `src/ui/i18n.ts` (codes `peaceMade`, `notHostile`)
- Test: `src/engine/intervention.test.ts`, `src/engine/playSim.test.ts`

**Interfaces:**
- Produces (historySim.ts): `PEACE_TICKS = 3` exported; truce semantics: `truces.get(p) > s.tick` ⇒ p cannot take player cells this tick.
- Produces (intervention.ts): `Action` gains `{ type: "peace"; polity: number }`; `hostileNeighbors(s): { id: number; name: string; trucedUntil: number }[]` (adjacent non-free enemy polities over land or strait; `trucedUntil` = truce expiry tick or 0).

- [ ] **Step 1: Failing tests** (append to `intervention.test.ts`):

```ts
import { PEACE_TICKS } from "./historySim";
import { hostileNeighbors } from "./intervention";

describe("peace", () => {
  it("hostileNeighbors lists adjacent non-free enemy polities", () => {
    const s = biggestPlayerState(1);
    const hs = hostileNeighbors(s);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) {
      expect(h.id).not.toBe(s.playerPolity);
      expect(s.polities[h.id].free).toBe(false);
    }
  });

  it("suing for peace records a truce until tick + PEACE_TICKS", () => {
    const s = biggestPlayerState(1);
    const h = hostileNeighbors(s)[0];
    const r = applyIntervention(s, { type: "peace", polity: h.id });
    expect(r.ok).toBe(true);
    expect(r.code).toBe("peaceMade");
    expect(s.truces.get(h.id)).toBe(s.tick + PEACE_TICKS);
    // a non-neighbour is rejected
    expect(applyIntervention(s, { type: "peace", polity: 9999 }).ok).toBe(false);
  });

  it("a truced polity cannot take player cells in stepSim; the truce expires", () => {
    const s = biggestPlayerState(1);
    const h = hostileNeighbors(s)[0];
    applyIntervention(s, { type: "peace", polity: h.id });
    // make the enemy overwhelming so WITHOUT the truce it would take border cells
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === h.id) s.solidarity[c] = 1;
      else if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0;
    }
    const mine = new Set<number>();
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) mine.add(c);
    stepSim(s);
    for (const c of mine) expect(s.owner[c] === h.id).toBe(false); // truce held
  });

  it("attacking a truced polity breaks the truce", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
    const t = borderTargets(s).find((x) => x.capturable && !x.sea)!;
    applyIntervention(s, { type: "peace", polity: t.owner });
    expect(s.truces.has(t.owner)).toBe(true);
    applyIntervention(s, { type: "attack", cell: t.cell });
    expect(s.truces.has(t.owner)).toBe(false);
  });
});
```

- [ ] **Step 2: Verify failure** — `npx vitest run src/engine/intervention.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

historySim.ts: `export const PEACE_TICKS = 3; // a truce lasts 3 ticks = 30 years`. In stepSim's LAND contest candidate loop (inside `for (const nb of neighbors[c])`), after the free-polity skip:

```ts
if (s.playerPolity >= 0 && o === s.playerPolity && s.truces.size > 0 && (s.truces.get(p) ?? 0) > s.tick) continue;
```

Same line in the amphibious strait loop's candidate scan (`o === owner[c]` there; variable names match that loop).

intervention.ts:

```ts
export interface HostileNeighbor { id: number; name: string; trucedUntil: number }

// adjacent non-free enemy polities (over land or strait) — the "sue for peace" list
export function hostileNeighbors(s: SimState): HostileNeighbor[] {
  if (s.playerPolity < 0) return [];
  const ids = new Set<number>();
  for (const t of borderTargets(s)) ids.add(t.owner);
  const out: HostileNeighbor[] = [];
  for (const id of ids) {
    if (s.polities[id].free) continue; // free cities never attack — peace is meaningless
    out.push({ id, name: s.polities[id].name, trucedUntil: s.truces.get(id) ?? 0 });
  }
  return out.sort((a, b) => a.id - b.id);
}
```

Action union: `| { type: "peace"; polity: number }`. Branch:

```ts
if (action.type === "peace") {
  const p = action.polity;
  if (!hostileNeighbors(s).some((h) => h.id === p))
    return { ok: false, message: "Not a hostile neighbour.", code: "notHostile" };
  s.truces.set(p, s.tick + PEACE_TICKS);
  const name = s.polities[p].name;
  const years = PEACE_TICKS * YEARS_PER_TICK;
  return { ok: true, message: `Made peace with ${name} for ${years} years.`, code: "peaceMade", data: { name, years } };
}
```

Attack branch, right after resolving `def` (before strength math): `if (s.truces.has(def)) s.truces.delete(def); // aggression voids the truce`.

i18n `playLog`: `peaceMade`: KO `` `${name}과(와) ${data.years}년 강화를 맺었습니다.` `` / EN `` `Made peace with ${name} for ${data.years} years.` ``; `notHostile`: KO `접경한 적국이 아닙니다.` / EN `Not a hostile neighbour.`

- [ ] **Step 4: Run** — `npx vitest run src/engine` → PASS (goldens intact — the truce skip is doubly gated on `playerPolity >= 0 && truces.size`).

- [ ] **Step 5: Commit** — `git add -- src/engine/historySim.ts src/engine/intervention.ts src/engine/intervention.test.ts src/ui/i18n.ts && git commit -m "feat(play): peace action — 30-year truce gate in stepSim, broken by player aggression"`

---

### Task 4: Scorecard cities + playSim wiring

**Files:**
- Modify: `src/engine/playSim.ts` (`Scorecard` gains `citiesFounded`/`citiesHeld`)
- Modify: `src/ui/i18n.ts` (`playStats` gains a cities part)
- Test: `src/engine/playSim.test.ts`

**Interfaces:**
- Produces: `Scorecard { …existing…; citiesFounded: number; citiesHeld: number }`; `playStats(lang, peak, final, rank, cities?)` — cities shown only when > 0 (backward-compatible optional param, default 0).

- [ ] **Step 1: Failing test** (append to `playSim.test.ts`, matching its existing helpers):

```ts
it("scorecard counts founded cities, held vs lost", () => {
  const { world } = generateWorld({ ...small, seed: 1 });
  const s = initPlaySim(world, 1, biggestPolity(world), "internal");
  const t = foundCityTargets(s)[0];
  applyIntervention(s, { type: "foundCity", cell: t.cell });
  let sc = scorecard(s);
  expect(sc.citiesFounded).toBe(1);
  expect(sc.citiesHeld).toBe(1);
  const other = s.polities.find((p) => p.id !== s.playerPolity)!;
  s.owner[t.cell] = other.id; // captured
  sc = scorecard(s);
  expect(sc.citiesFounded).toBe(1);
  expect(sc.citiesHeld).toBe(0);
});
```

(Reuse/adjust to the file's existing world-building helpers; add a local `biggestPolity` if none exists.)

- [ ] **Step 2: Verify failure**, **Step 3: Implement:**

```ts
let citiesHeld = 0;
for (const fc of s.foundedCities) if (s.owner[fc] === s.playerPolity) citiesHeld++;
return { …, citiesFounded: s.foundedCities.size, citiesHeld, … };
```

`playStats(lang, peak, final, rank, cities = 0)`: append KO `` cities ? ` · 도시 ${cities}` : "" `` / EN `` cities ? ` · ${cities} cities founded` : "" `` before the final period.

- [ ] **Step 4: Run** — `npx vitest run src/engine/playSim.test.ts src/ui` → PASS.
- [ ] **Step 5: Commit** — `git add -- src/engine/playSim.ts src/engine/playSim.test.ts src/ui/i18n.ts && git commit -m "feat(play): scorecard counts founded cities (held vs lost)"`

---

### Task 5: UI — foundCity + peace selects, founded-city map markers

**Files:**
- Modify: `src/ui/playApp.ts`
- Modify: `src/ui/i18n.ts` (PLAY_UI keys)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `foundCityTargets`, `hostileNeighbors` from intervention.ts; `Scorecard.citiesFounded`.
- Produces: `.found-select`, `.peace-select` (one action/turn shared with attack/invest — picking any clears the other three); gold `★` `.founded-city` text marker on the map at owned founded cells (dimmed `☆` when captured); banner passes `citiesFounded` to `playStats`.

- [ ] **Step 1: Failing tests** (append to `playApp.test.ts`):

```ts
it("offers found-city and peace selects, one action shared across all four", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const found = root.querySelector(".found-select") as HTMLSelectElement;
  const peace = root.querySelector(".peace-select") as HTMLSelectElement;
  const attack = root.querySelector(".attack-select") as HTMLSelectElement;
  expect(found).not.toBeNull();
  expect(peace).not.toBeNull();
  expect(found.options.length).toBeGreaterThan(1);
  // picking attack then foundCity clears the attack pick
  attack.value = attack.options[1].value;
  attack.dispatchEvent(new Event("change"));
  found.value = found.options[1].value;
  found.dispatchEvent(new Event("change"));
  expect(attack.value).toBe("");
  expect((root.querySelector(".btn-attack") as HTMLButtonElement).textContent).toContain("Found");
});

it("founding a city logs it and draws a ★ marker on the map", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const found = root.querySelector(".found-select") as HTMLSelectElement;
  found.value = found.options[1].value;
  found.dispatchEvent(new Event("change"));
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
  expect(rows.some((t) => /Founded the city of/.test(t))).toBe(true);
  expect(root.querySelector(".founded-city")).not.toBeNull();
});

it("suing for peace logs the truce", () => {
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const peace = root.querySelector(".peace-select") as HTMLSelectElement;
  peace.value = peace.options[1].value;
  peace.dispatchEvent(new Event("change"));
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
  expect(rows.some((t) => /Made peace with/.test(t))).toBe(true);
});
```

- [ ] **Step 2: Verify failure**, **Step 3: Implement** in playApp.ts:

- Import `foundCityTargets, hostileNeighbors` from intervention.
- `renderActions()`: two new selects after `inv`:
  - `.found-select`: placeholder `playT(lang, "foundPlaceholder")`; options = `foundCityTargets(s).slice(0, 20)` with label `` `cell ${t.cell} · ${(t.sol * 100) | 0}%` ``, value = cell.
  - `.peace-select`: placeholder `playT(lang, "peacePlaceholder")`; options = `hostileNeighbors(s)` with label `` h.trucedUntil > s.tick ? `${h.name} ✓` : h.name `` value = id.
  - Each `change` handler sets `pendingAction` (`{type:"foundCity",cell}` / `{type:"peace",polity}`), clears the OTHER THREE selects' values, updates the status label. Extend the existing two handlers to also clear the two new selects.
  - Status `label()` adds cases: foundCity → `playT(lang,"foundChosen")`, peace → `playT(lang,"peaceChosen")`.
- `renderMap()`: after the ⛵ loop, for each `fc of s.foundedCities` add a text marker at the cell centre: `textContent = s.owner[fc] === s.playerPolity ? "★" : "☆"`, class `founded-city`, `font-size 9`, `fill "#a8842c"`, `text-anchor middle`, `pointer-events none`.
- `renderBanner()`: `playStats(lang, sc.peakCells, sc.cells, rankText, sc.citiesFounded)`.
- i18n PLAY_UI new keys — en: `foundChosen: "Found city: chosen ✓"`, `peaceChosen: "Peace: chosen ✓"`, `foundPlaceholder: "— found a city —"`, `peacePlaceholder: "— sue for peace —"`; ko: `foundChosen: "도시 건설 지정됨 ✓"`, `peaceChosen: "강화 지정됨 ✓"`, `foundPlaceholder: "— 도시 건설 —"`, `peacePlaceholder: "— 강화 요청 —"`.

- [ ] **Step 4: Run** — `npx vitest run src/ui` → PASS. Then full suite `npx vitest run` + `npm run build` → clean.
- [ ] **Step 5: Commit** — `git add -- src/ui/playApp.ts src/ui/playApp.test.ts src/ui/i18n.ts && git commit -m "feat(play): foundCity + peace UI — selects, ★ city markers, scorecard cities"`

---

### Task 6: Live verification + merge

- [ ] Start the dev server (preview_start) and drive play.html via preview_eval: pick a nation, found a city (★ appears), sue for peace (log line), attack (breakthrough log shows multi-cell captures sometimes), advance ~10 turns, check no console errors.
- [ ] KO toggle spot-check: founded/peaceMade/captured-count lines in Korean.
- [ ] Full suite from the worktree + `npm run build`.
- [ ] Merge the worktree branch into local `main` (ff or merge commit per repo convention), re-run tests on main FROM main repo root scoped to `src/`, push `origin main`.
- [ ] Update memory files (backlog: Phase 2 remainder → DONE; status: session log; fix stale "not pushed" note).

## Self-review notes

- Spec coverage: foundCity (anchor semantics incl. inert-when-captured, spacing, nameGen, newCity event, scorecard tally) ✓; peace (truce map, stepSim skip, attack breaks truce, PEACE_TICKS) ✓; deferred mechanics gap (b) → Task 1 breakthrough ✓; richer observability → founded-city markers + counts (panel already shows cohesion/risk/threats from the legibility bundle) ✓. NOT built (still out of scope per spec): save/load, AI diplomacy, map-click targeting.
- Golden safety: every stepSim/contestStrength change is behind `playerPolity >= 0` and/or empty-collection checks; initSim adds only empty defaults. history.test.ts goldens are the guard.
- Type consistency: `InterventionResult.data` stays `Record<string, string | number>`; new codes routed through `playLog` like existing ones.
