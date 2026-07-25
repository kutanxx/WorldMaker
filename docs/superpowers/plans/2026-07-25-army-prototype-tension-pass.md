# Army prototype — tension pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the army prototype the tension its play-test showed it lacked — battles become a real gamble (odds, not certainties), defending costs blood so turtling bleeds, and the player picks which nation to be.

**Architecture:** Three additive changes inside the existing prototype. `armySim.ts` gains a deterministic hash-based roll (keyed by turn/target/attacker, so replays stay identical), a probability-based verdict with closeness-scaled losses, and defender losses on a repelled attack. `armyApp.ts` gains a nation picker before the game and quotes odds instead of promising outcomes. The deployed province game is untouched.

**Tech Stack:** TypeScript, Vitest (node + jsdom), existing `mulberry32`/`deriveSeed` from `src/engine/rng.ts`.

## Global Constraints

- PROTOTYPE iteration. NO changes to `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, or any pre-existing test/golden.
- **Determinism is non-negotiable:** no `Math.random()`, no `Date.now()` in the engine. The battle roll is a pure hash of `(world seed, turn, target province, attacker nation)`. Same seed + same commands → byte-identical game.
- New constants, exact values: `ODDS_K = 3`, `DEF_LOSS_MULT = 0.35`. Existing constants keep their values; `WIN_LOSS_MULT` (0.6) is retained and now multiplied by `closeness`.
- Odds: `p = atk^ODDS_K / (atk^ODDS_K + def^ODDS_K)`; attacker wins iff `roll < p`. `def = 0` → `p = 1`.
- Winner's losses: `round(loserStrength × WIN_LOSS_MULT × closeness)` where `closeness = min(atk,def) / max(atk,def)`.
- Defender's losses on a REPELLED attack: `round(atk × DEF_LOSS_MULT)`, taken from the defending army first, remainder from the province's population, floored at 0.
- `previewMove` and `moveArmy` must keep sharing one `resolve` so the quoted odds are exactly what the engine rolls against; `previewMove` must stay non-mutating.
- UI strings are plain Korean. Still no victory condition.
- `tsc --noEmit` must stay clean (repo build is `tsc --noEmit && vite build`). Do not leave unused imports.
- Run tests from the worktree root: `npx vitest run <file>`.

---

### Task 1: Deterministic battle roll + odds

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `ArmyState`, `BattleResult`, existing `resolve`; `mulberry32`, `deriveSeed` from `./rng`.
- Produces:
  - `export const ODDS_K = 3`
  - `export function battleRoll(s: ArmyState, target: number, attacker: number): number` — deterministic value in [0,1).
  - `export function winChance(atk: number, def: number): number` — the probability, in [0,1].
  - `BattleResult` gains `p: number` (the win probability the verdict was rolled against).

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts` (add `battleRoll`, `winChance`, `ODDS_K` to the existing `./armySim` import line):

```typescript
describe("winChance (odds from the strength ratio)", () => {
  it("is a coin flip at parity and rises with advantage", () => {
    expect(winChance(100, 100)).toBeCloseTo(0.5, 6);
    expect(winChance(200, 100)).toBeCloseTo(8 / 9, 6);      // 2:1 with ODDS_K=3 -> 8/9
    expect(winChance(150, 100)).toBeGreaterThan(0.75);
    expect(winChance(50, 100)).toBeLessThan(0.15);
    expect(winChance(120, 100)).toBeGreaterThan(winChance(110, 100)); // monotone
  });
  it("is certain against no defence and hopeless with no attackers", () => {
    expect(winChance(50, 0)).toBe(1);
    expect(winChance(0, 50)).toBe(0);
  });
  it("always returns a probability", () => {
    for (const [a, d] of [[1, 1], [1, 1000], [1000, 1], [7, 13]]) {
      const p = winChance(a, d);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("battleRoll (uncertainty WITHOUT losing determinism)", () => {
  it("is stable for the same battle identity and in [0,1)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const a = battleRoll(s, 5, 2), b = battleRoll(s, 5, 2);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
  it("differs across target, attacker and turn", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const base = battleRoll(s, 5, 2);
    expect(battleRoll(s, 6, 2)).not.toBe(base);   // different target
    expect(battleRoll(s, 5, 3)).not.toBe(base);   // different attacker
    s.turn = 1;
    expect(battleRoll(s, 5, 2)).not.toBe(base);   // different turn
  });
  it("does not depend on Math.random", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
    const s1 = initArmySim(world), s2 = initArmySim(world);
    expect(battleRoll(s1, 9, 1)).toBe(battleRoll(s2, 9, 1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "winChance"`
Expected: FAIL — `winChance is not defined`.

- [ ] **Step 3: Write minimal implementation**

In `src/engine/armySim.ts`, add the import (merge into the existing import block at the top):

```typescript
import { mulberry32, deriveSeed } from "./rng";
```

Add next to the other constants:

```typescript
export const ODDS_K = 3;          // sharpness of the odds curve: 2:1 ~ 89%, 1:1 = 50%
```

Add above `resolve`:

```typescript
// Win probability from the strength ratio, sharpened by ODDS_K so overwhelming force is nearly safe
// while an even fight is a coin flip. That gamble is the decision the deterministic version lacked.
export function winChance(atk: number, def: number): number {
  if (atk <= 0) return 0;
  if (def <= 0) return 1;
  const a = Math.pow(atk, ODDS_K), d = Math.pow(def, ODDS_K);
  return a / (a + d);
}

// The battle's die. NOT Math.random: a pure hash of (world seed, turn, target, attacker), so the game
// stays perfectly replayable — the same seed and the same commands reproduce every outcome — while the
// player cannot predict any single result.
export function battleRoll(s: ArmyState, target: number, attacker: number): number {
  const seed = deriveSeed(deriveSeed(deriveSeed(s.world.params.seed, s.turn + 1), target + 1), attacker + 1);
  return mulberry32(seed)();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/armySim.test.ts -t "winChance"` then `-t "battleRoll"`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): deterministic battle roll and odds curve"
```

---

### Task 2: Probabilistic verdict + closeness-scaled losses

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: `winChance`, `battleRoll` (Task 1).
- Produces: `BattleResult` now carries `p: number`; `resolve` decides by `roll < p` instead of `atk > def`; the winner's losses scale with closeness.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts`:

```typescript
describe("battle verdict is now a roll against the quoted odds", () => {
  it("reports the same p that the verdict was decided by, and preview matches the real move", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    s.armies.push({ prov, nation, men: 500, movedOn: -1 });
    const pre = previewMove(s, prov, nation, target)!;
    expect(pre.p).toBeCloseTo(winChance(pre.atk, pre.def), 9);
    const real = moveArmy(s, prov, nation, target)!;
    expect(real.won).toBe(pre.won);      // preview cannot disagree with the outcome
    expect(real.p).toBeCloseTo(pre.p, 9);
  });

  it("CAN lose a battle it outnumbers — the point of the change", () => {
    // sweep turns so the roll changes; with atk only slightly above def, some turn must roll a loss
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    let sawLoss = false;
    for (let turn = 0; turn < 40 && !sawLoss; turn++) {
      const s = initArmySim(world);
      s.turn = turn;
      const prov = [...Array(world.provinces.length).keys()]
        .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
      const nation = s.owner[prov];
      const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
      const def = defenceOf(s, target, nation);
      s.armies.push({ prov, nation, men: Math.ceil(def) + 1, movedOn: -1 }); // barely ahead => ~50%
      const r = moveArmy(s, prov, nation, target)!;
      if (!r.won) sawLoss = true;
    }
    expect(sawLoss).toBe(true);
  });

  it("an even fight costs the winner more than a rout does", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const mk = (men: number) => {
      const s = initArmySim(world);
      const prov = [...Array(world.provinces.length).keys()]
        .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
      const nation = s.owner[prov];
      const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
      s.armies.push({ prov, nation, men, movedOn: -1 });
      return previewMove(s, prov, nation, target)!;
    };
    const close = mk(Math.ceil(mk(1).def) + 2);   // barely enough
    const rout = mk(100000);                       // overwhelming
    expect(rout.attackerLosses).toBeLessThan(close.attackerLosses);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "battle verdict is now"`
Expected: FAIL — `p` is undefined on `BattleResult`.

- [ ] **Step 3: Write the implementation**

In `src/engine/armySim.ts`, extend the interface:

```typescript
export interface BattleResult { won: boolean; atk: number; def: number; p: number; attackerLosses: number; captured: boolean }
```

Replace the verdict and loss lines inside `resolve` (keep everything else — the army/adjacency guards, the own-land march early return — exactly as it is). The own-land march return must also carry a `p`:

```typescript
  if (s.owner[target] === nation) return { won: true, atk: army.men, def: 0, p: 1, attackerLosses: 0, captured: false };
  const atk = army.men;
  const def = defenceOf(s, target, nation);
  const p = winChance(atk, def);
  const won = battleRoll(s, target, nation) < p;
  // a near-run fight is ruinous, a rout is cheap: scale the winner's losses by how close it was.
  const closeness = Math.max(atk, def) > 0 ? Math.min(atk, def) / Math.max(atk, def) : 0;
  // Math.min guards a future WIN_LOSS_MULT >= 1 from producing negative men.
  const attackerLosses = won ? Math.min(atk, Math.round(def * WIN_LOSS_MULT * closeness)) : atk;
  return { won, atk, def, p, attackerLosses, captured: won };
```

- [ ] **Step 4: Run the whole engine suite**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS. Older tests that assumed `atk > def` guarantees a win may need their army sizes raised so the odds are overwhelming (e.g. the "wins, captures and bleeds" test should use a far larger force). Adjust ONLY the input magnitudes of those tests, never their assertions' meaning; if a test's intent no longer holds under odds (e.g. it pinned the exact old loss formula), update it to the new formula and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): battles are rolled against quoted odds, losses scale with closeness"
```

---

### Task 3: Defending costs blood

**Files:**
- Modify: `src/engine/armySim.ts`
- Test: `src/engine/armySim.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `export const DEF_LOSS_MULT = 0.35`; `moveArmy`'s failed-attack branch now also reduces the defending army and, if that is exhausted, the province's population.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/armySim.test.ts`:

```typescript
describe("a repelled attack still bleeds the defender (turtling is not free)", () => {
  it("takes losses from the defending army first", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const defender = s.owner[target];
    s.armies.push({ prov, nation, men: 10, movedOn: -1 });            // hopeless attack
    s.armies.push({ prov: target, nation: defender, men: 5000, movedOn: -1 }); // huge garrison
    const r = moveArmy(s, prov, nation, target)!;
    expect(r.won).toBe(false);
    expect(armyAt(s, target, defender)!.men).toBe(5000 - Math.round(10 * DEF_LOSS_MULT));
  });

  it("spills into the population once the garrison is gone, floored at 0", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initArmySim(world);
    const prov = [...Array(world.provinces.length).keys()]
      .find((p) => s.owner[p] >= 0 && s.adj[p].some((q) => s.owner[q] >= 0 && s.owner[q] !== s.owner[p]))!;
    const nation = s.owner[prov];
    const target = s.adj[prov].find((q) => s.owner[q] >= 0 && s.owner[q] !== nation)!;
    const defender = s.owner[target];
    s.pop[target] = 1000;
    s.armies.push({ prov: target, nation: defender, men: 2, movedOn: -1 });
    s.armies.push({ prov, nation, men: 100, movedOn: -1 });
    const popBefore = s.pop[target];
    const r = moveArmy(s, prov, nation, target)!;
    if (!r.won) {
      const total = Math.round(100 * DEF_LOSS_MULT);
      expect(armyAt(s, target, defender)).toBeUndefined();          // 2-man garrison wiped
      expect(s.pop[target]).toBeCloseTo(popBefore - (total - 2), 9); // remainder off the population
      expect(s.pop[target]).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/armySim.test.ts -t "repelled attack"`
Expected: FAIL — `DEF_LOSS_MULT is not defined`.

- [ ] **Step 3: Write the implementation**

Add next to the other constants in `src/engine/armySim.ts`:

```typescript
export const DEF_LOSS_MULT = 0.35; // a repelled attack still bleeds the defender — holding is not free
```

In `moveArmy`, replace the failed-attack branch (currently it only removes the attacking army):

```typescript
  if (!r.won) {                                   // wiped out — but the defender bleeds too
    s.armies = s.armies.filter((a) => a !== army);
    let toll = Math.round(r.atk * DEF_LOSS_MULT);
    for (const d of s.armies) {                   // garrison first
      if (d.prov !== target || toll <= 0) continue;
      const hit = Math.min(d.men, toll);
      d.men -= hit; toll -= hit;
    }
    s.armies = s.armies.filter((a) => a.men > 0);
    if (toll > 0) s.pop[target] = Math.max(0, s.pop[target] - toll); // the militia that died
    return r;
  }
```

- [ ] **Step 4: Run the engine suite**

Run: `npx vitest run src/engine/armySim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/armySim.ts src/engine/armySim.test.ts
git commit -m "feat(armySim): repelled attacks bleed the defender so turtling costs blood"
```

---

### Task 4: UI — quote odds, and let the player pick a nation

**Files:**
- Modify: `src/ui/armyApp.ts`, `src/ui/armyApp.test.ts`
- Modify: `src/theme.css`

**Interfaces:**
- Consumes: `BattleResult.p` (Task 2), all existing engine API.
- Produces (DOM contract): picker mode renders `.army-pick` (a legend/prompt) and clickable `.army-prov[data-prov]`; each nation's seat carries `.army-pick-label[data-polity]` showing `<name> · 영토 N · 인구 M`. Once a nation is chosen the existing play DOM (`.army-hud`, `.army-sel`, `button.army-end`, …) renders as before.

- [ ] **Step 1: Write the failing jsdom tests**

Append to `src/ui/armyApp.test.ts`:

```typescript
describe("nation picker", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("starts in picker mode with a label per nation, and no game HUD yet", () => {
    mountArmyApp(root, { seed: 1 });
    expect(root.querySelector(".army-pick")).toBeTruthy();
    const labels = [...root.querySelectorAll(".army-pick-label")];
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[0].textContent).toMatch(/영토 \d+/);
    expect(labels[0].textContent).toMatch(/인구 \d+/);
    expect(root.querySelector("button.army-end")).toBeNull();
  });

  it("starts the game as the nation you click", () => {
    mountArmyApp(root, { seed: 1 });
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    const name = label.textContent!.split(" · ")[0];
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-pick")).toBeNull();
    expect(root.querySelector(".army-hud")!.textContent).toContain(name);
    expect(root.querySelector("button.army-end")).toBeTruthy();
  });
});

describe("odds are quoted, not promised", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows a percentage on hostile move rows instead of a guaranteed verdict", () => {
    mountArmyApp(root, { seed: 1 });
    (root.querySelector(".army-prov[data-polity]") as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // levy everywhere until some province offers a hostile move row
    let row: Element | null = null;
    for (const el of [...root.querySelectorAll('.army-prov[data-mine="1"]')]) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 4; i++) {
        const b = root.querySelector("button.army-levy") as HTMLButtonElement | null;
        if (b && !b.disabled) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      row = [...root.querySelectorAll("button.army-move")].find((b) => /공격/.test(b.textContent || "")) ?? null;
      if (row) break;
    }
    expect(row).toBeTruthy();
    expect(row!.textContent).toMatch(/\d+%/);          // odds are shown
    expect(row!.textContent).not.toContain("승리 예상"); // no promise
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/armyApp.test.ts -t "nation picker"`
Expected: FAIL — no `.army-pick` (the app starts a game immediately).

- [ ] **Step 3: Implement the picker**

In `src/ui/armyApp.ts`:

1. Replace the automatic player choice (the block computing `counts`/`bestN`/`player`) with a nullable selection:

```typescript
  let player: number | null = null;   // null = picker mode
```

2. In `buildMap()`, tag each province hit area with its owner so the picker can be clicked by nation, and in picker mode make every province clickable:

Add `"data-polity": String(s.owner[p])` to the attributes of the `.army-prov` path, and make its click handler:

```typescript
      hit.addEventListener("click", () => { if (player === null) startGame(s.owner[p]); else onProvClick(p); });
```

`data-mine` stays `"1"` only when `player !== null && s.owner[p] === player`.

3. Add the nation labels (picker mode only), after the province loop inside `buildMap()`:

```typescript
    if (player === null) {
      const stat = new Map<number, { prov: number; pop: number }>();
      for (let p = 0; p < s.n; p++) {
        const o = s.owner[p];
        if (o < 0) continue;
        const v = stat.get(o) ?? { prov: 0, pop: 0 };
        v.prov++; v.pop += s.pop[p];
        stat.set(o, v);
      }
      for (const [id, v] of [...stat].sort((a, b) => a[0] - b[0])) {
        const cap = world.polities[id]?.capital;
        if (cap === undefined) continue;
        const label = svgEl("text", {
          class: "army-pick-label", "data-polity": String(id), "pointer-events": "none",
          x: String(world.grid.points[cap * 2]), y: String(world.grid.points[cap * 2 + 1]), "text-anchor": "middle",
        });
        label.textContent = `${world.polities[id]?.name ?? id} · 영토 ${v.prov} · 인구 ${Math.round(v.pop)}`;
        svg.appendChild(label);
      }
    }
```

4. Add `startGame` and make `render()` branch on picker mode:

```typescript
  function startGame(nation: number): void { if (nation >= 0) { player = nation; sel = null; render(); } }
```

In `render()`, when `player === null`, render only a prompt plus the map and return:

```typescript
    if (player === null) {
      const pick = document.createElement("div");
      pick.className = "army-pick";
      pick.textContent = "지도에서 나라를 클릭해 고르세요 — 작은 나라는 어렵고, 큰 나라는 지킬 게 많습니다.";
      root.appendChild(pick);
      root.appendChild(buildMap());
      return;
    }
```

Everything after that point keeps using `player` — narrow it once at the top of the play branch (`const me = player;`) or use `player!` at the existing call sites so `tsc` stays clean.

- [ ] **Step 4: Quote the odds in the panel and the log**

In the panel's move-row construction, replace the verdict text with the probability (keep `Math.ceil` on defence):

```typescript
        row.textContent = s.owner[q] === player
          ? `→ ${world.provinces[q].name} (행군)`
          : `→ ${world.provinces[q].name} · 공격 ${r.atk} vs 방어 ${Math.ceil(r.def)} · ${Math.round(r.p * 100)}%`;
```

And in the attack log line, record what the odds were so a loss reads as a gamble that failed rather than a bug:

```typescript
          say(r.captured ? `점령 ${world.provinces[p].name} (손실 ${r.attackerLosses}, ${Math.round(r.p * 100)}%)`
            : r.won ? `이동 ${world.provinces[p].name}`
            : `패배 ${world.provinces[p].name} — 전멸 (${Math.round(r.p * 100)}% 였음)`);
```

- [ ] **Step 5: Add CSS**

Append to `src/theme.css`:

```css
.army-pick { font-size: 14px; padding: 8px 2px; color: #5c4626; text-align: center; }
.army-pick-label { font-size: 10px; fill: #2b2113; paint-order: stroke; stroke: #f6ecd2; stroke-width: 3px; }
```

- [ ] **Step 6: Run the UI tests, the full suite and tsc**

Run: `npx vitest run src/ui/armyApp.test.ts`
Expected: PASS. Pre-existing armyApp tests that assumed the game starts immediately must now click a nation first — update those tests' setup only, not their assertions.

Run: `npx vitest run` — full suite green.
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/armyApp.ts src/ui/armyApp.test.ts src/theme.css
git commit -m "feat(playArmy): nation picker and odds-quoting battle previews"
```

---

### Task 5: Play it and report what changed

**Files:** none (verification only)

- [ ] **Step 1: Full suite + type-check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 2: Play several games in the browser**

Start the preview, open `/playArmy.html?seed=11` and `?seed=23` (the two worlds the previous play-test used, so the numbers are comparable).

For each: pick a nation from the picker, then play ~25 turns attacking only where the odds look good, and record:
- start → end province count (is it still a monotone runaway?)
- how many battles were fought and **how many were lost** (the previous run had 0 losses in 68 battles)
- whether a turtle strategy still freezes the map (levy but never attack for 25 turns)
- console errors (expect none)

- [ ] **Step 3: Write the verdict**

Record in the backlog memory and report to the user: did odds restore tension, did costly defence stop the turtle freeze, and does the nation picker make a small start playable? Name anything that now feels worse.

---

## Self-Review notes

- **Spec coverage:** deterministic hash roll (T1) ✓; odds curve + `p` on `BattleResult` (T1, T2) ✓; verdict by roll (T2) ✓; closeness-scaled winner losses (T2) ✓; defender bleeds on a repelled attack, army-then-population, floored (T3) ✓; nation picker with province/population per nation (T4) ✓; odds quoted instead of promised, in panel and log (T4) ✓; preview still shares `resolve` and stays pure (T2 asserts preview matches the real move) ✓; constants `ODDS_K = 3`, `DEF_LOSS_MULT = 0.35` (T1, T3) ✓; determinism end to end (T1 tests + existing suite) ✓; play-test verdict (T5) ✓.
- **Type consistency:** `BattleResult` gains `p` in T2 and is consumed as `r.p` in T4; `battleRoll(s, target, attacker)` and `winChance(atk, def)` keep the same signatures throughout; `player` becomes `number | null` in T4 and every existing use is narrowed.
- **Known consequence to watch (not a defect):** existing engine tests written when `atk > def` guaranteed a win may need larger attacking forces so the odds are overwhelming; T2 Step 4 calls this out explicitly and forbids weakening assertions.
