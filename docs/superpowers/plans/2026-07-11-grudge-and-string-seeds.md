# Grudge Memory + String Seeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neighbors remember who attacked whom (bilateral, decaying — Civ VI Grievances) and feed it into the attitude chips; typing "Narnia" makes (and shares) that world (Minecraft seed culture).

**Architecture:** Grudge: two play-gated `SimState` Maps recorded at three sites (stepSim contests, `applyIntervention` attack, hegemon battle), consumed read-only by `neighborAttitudes` (+2 tooltip lines). String seeds: one pure `parseSeedValue` in urlState.ts used by playMain, plus a name input on the landing chooser routing to play (string hash) or map (numeric blob — Version A format unchanged). Specs: `docs/superpowers/specs/2026-07-11-grudge-memory-design.md`, `.../2026-07-11-string-seeds-design.md`.

**Tech Stack:** TypeScript, vitest (jsdom). No new dependencies.

## Global Constraints

- Goldens byte-identical. The grudge maps are NEVER touched on the pure path — the land-contest hook needs an EXPLICIT `s.playerPolity >= 0` gate because on the pure path `playerPolity === -1` and unclaimed cells have `o === -1`, making `o === s.playerPolity` true (the spec's load-bearing trap).
- Hostile stays honest: `attackedMeAgo` (they took player cells within `GRUDGE_TICKS = 5`) may flip attitude to hostile (proven contest superiority); `iAttackedAgo` is DISPLAY-ONLY. Truce still overrides everything.
- String seeds: positive-integer values keep today's meaning (back-compat); any other non-empty text hashes via the existing `hashStringToSeed`; `URLSearchParams` already percent-decodes — never decode twice. Version A's params-blob format unchanged.
- Every user-facing string KO+EN. `npm run build` = tsc with noUnusedLocals. Run vitest from the worktree root. Baseline: 452 tests green at `5eda303`.
- STRICT GIT: no reset/rebase/checkout/restore/clean (`git show` for history); add only named files; verify branch + expected HEAD before each commit.

---

### Task 1: `parseSeedValue` + playMain string-seed boot

**Files:**
- Modify: `src/ui/urlState.ts`, `src/playMain.ts`
- Test: Create `src/ui/urlState.test.ts`

**Interfaces:**
- Consumes: `hashStringToSeed` from `../engine/rng` (implemented+tested, currently unused).
- Produces (Task 2 relies on): `export function parseSeedValue(raw: string | null): number | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/urlState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSeedValue } from "./urlState";
import { hashStringToSeed } from "../engine/rng";

describe("parseSeedValue", () => {
  it("keeps positive integers as-is (back-compat with every existing share URL)", () => {
    expect(parseSeedValue("731")).toBe(731);
    expect(parseSeedValue(" 42 ")).toBe(42);
  });
  it("hashes any other non-empty text, deterministically — same name, same world", () => {
    expect(parseSeedValue("Narnia")).toBe(hashStringToSeed("Narnia"));
    expect(parseSeedValue("Narnia")).toBe(parseSeedValue("Narnia"));
    expect(parseSeedValue("나니아")).toBe(hashStringToSeed("나니아")); // UTF-16 names work
    expect(parseSeedValue("Narnia")).not.toBe(parseSeedValue("narnia")); // case-sensitive, like Minecraft
  });
  it("treats '0' and '-3' as text (only positive integers take the numeric path)", () => {
    expect(parseSeedValue("0")).toBe(hashStringToSeed("0"));
    expect(parseSeedValue("-3")).toBe(hashStringToSeed("-3"));
  });
  it("null/empty/whitespace → null (caller falls back to a random seed)", () => {
    expect(parseSeedValue(null)).toBeNull();
    expect(parseSeedValue("")).toBeNull();
    expect(parseSeedValue("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/urlState.test.ts`
Expected: FAIL — `parseSeedValue` is not exported.

- [ ] **Step 3: Implement**

In `src/ui/urlState.ts`, add `import { hashStringToSeed } from "../engine/rng";` and:

```ts
// A seed URL value: "731" stays numeric (back-compat), any other non-empty text becomes a
// world via hashStringToSeed ("Narnia" → the same world for everyone — the Minecraft pact).
// URLSearchParams has already percent-decoded the value; never decode twice.
export function parseSeedValue(raw: string | null): number | null {
  if (raw === null) return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return hashStringToSeed(t);
}
```

In `src/playMain.ts`, replace the two seed lines with:

```ts
import { parseSeedValue, randomSeed } from "./ui/urlState";
```

(merging with the existing urlState import) and:

```ts
const seed = parseSeedValue(new URLSearchParams(location.hash.slice(1)).get("seed")) ?? randomSeed();
```

(the old `hashSeed`/`Number.isFinite` lines are removed).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/ui/urlState.test.ts` → PASS (4). `npx vitest run` → all green (playMain's existing test still passes — the numeric path is unchanged). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/urlState.ts src/playMain.ts src/ui/urlState.test.ts
git commit -m "feat(play): string seeds — play.html#seed=Narnia boots the Narnia world (numeric URLs unchanged)"
```

---

### Task 2: Landing name input — [▶ Play] / [🗺 Map] from a world name

**Files:**
- Modify: `src/landing.ts`, `src/theme.css`
- Test: `src/landing.test.ts` (append)

**Interfaces:**
- Consumes: `parseSeedValue`-adjacent pieces — `hashStringToSeed` from `./engine/rng`, `encodeParams` from `./ui/urlState`, `DEFAULT_PARAMS` from `./types/world` (landing.ts sits at src root; note the `./` paths).
- Produces: `export function nameTargets(name: string): { play: string; map: string } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/landing.test.ts`:

```ts
import { nameTargets } from "./landing";
import { hashStringToSeed } from "./engine/rng";
import { decodeParams } from "./ui/urlState";

describe("nameTargets", () => {
  it("routes a name to play (string hash, URL-encoded) and map (numeric blob, same world)", () => {
    const t = nameTargets("Narnia")!;
    expect(t.play).toBe("play.html#seed=Narnia");
    expect(decodeParams(t.map.replace(/^map\.html/, "")).seed).toBe(hashStringToSeed("Narnia"));
    const ko = nameTargets("나니아")!;
    expect(ko.play).toBe("play.html#seed=" + encodeURIComponent("나니아"));
  });
  it("empty/whitespace names route nowhere", () => {
    expect(nameTargets("")).toBeNull();
    expect(nameTargets("   ")).toBeNull();
  });
});

describe("renderChooser name input", () => {
  it("renders the name input and both start buttons", () => {
    const root = document.createElement("div");
    renderChooser(root);
    expect(root.querySelector(".name-seed")).not.toBeNull();
    expect(root.querySelector(".name-play")).not.toBeNull();
    expect(root.querySelector(".name-map")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/landing.test.ts`
Expected: new tests FAIL (`nameTargets` not exported, no `.name-seed`); existing 4 PASS.

- [ ] **Step 3: Implement**

In `src/landing.ts` add imports:

```ts
import { hashStringToSeed } from "./engine/rng";
import { encodeParams } from "./ui/urlState";
import { DEFAULT_PARAMS } from "./types/world";
```

Add the pure helper:

```ts
// "Narnia" → shareable targets: play keeps the NAME in the URL; map converts to the numeric
// params blob Version A already understands (same hashStringToSeed world either way).
export function nameTargets(name: string): { play: string; map: string } | null {
  const t = name.trim();
  if (t.length === 0) return null;
  return {
    play: "play.html#seed=" + encodeURIComponent(t),
    map: "map.html" + encodeParams({ ...DEFAULT_PARAMS, seed: hashStringToSeed(t) }),
  };
}
```

In `renderChooser`, add inside the template, after the closing `</div>` of `.landing`:

```html
    <div class="landing-name">
      <input class="name-seed" maxlength="40" placeholder="세계의 이름으로 시작 · start from a name (e.g. Narnia)" />
      <button class="name-play">▶ Play</button>
      <button class="name-map">🗺 Map</button>
    </div>
```

and after the `root.innerHTML = ...` statement:

```ts
  const input = root.querySelector(".name-seed") as HTMLInputElement;
  const go = (kind: "play" | "map") => {
    const t = nameTargets(input.value);
    if (t) location.assign(t[kind]);
  };
  (root.querySelector(".name-play") as HTMLButtonElement).addEventListener("click", () => go("play"));
  (root.querySelector(".name-map") as HTMLButtonElement).addEventListener("click", () => go("map"));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go("play"); });
```

Append to `src/theme.css`:

```css
/* landing: start-from-a-name row */
.landing-name { display: flex; gap: 8px; justify-content: center; margin: 18px auto 0; max-width: 560px; }
.landing-name .name-seed { flex: 1; padding: 7px 12px; border: 1px solid #c9bb96; border-radius: 6px; background: #f7f1e1; font-size: 14px; }
```

(The landing page has no lang toggle — the bilingual placeholder literal matches its existing bilingual-card style.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/landing.test.ts` → PASS. Full suite + `npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/landing.ts src/theme.css src/landing.test.ts
git commit -m "feat(landing): start a world from its name — routes to play (named URL) or map (numeric blob)"
```

---

### Task 3: Grudge ledger — SimState fields + three recording sites

**Files:**
- Modify: `src/engine/historySim.ts` (SimState interface + initSim + the two contest loops in stepSim), `src/engine/intervention.ts` (attack success), `src/engine/dilemma.ts` (hegemon3)
- Test: `src/engine/intervention.test.ts` (append; it has full-size play fixtures) and `src/engine/dilemma.test.ts` (append one test inside the existing hegemon describe)

**Interfaces:**
- Consumes: existing stepSim/applyIntervention/resolveDilemma structure.
- Produces (Task 4 relies on): `SimState.attacksOnPlayer: Map<number, number>` and `SimState.attacksByPlayer: Map<number, number>` (polityId → last tick), initialized empty, written only in play mode.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/intervention.test.ts` (reuse its existing full-size player-state fixture — read the file first; if its helper differs from this shape, adapt the SETUP lines only, keep the assertions):

```ts
describe("grudge ledger", () => {
  it("stays EMPTY on the pure-history path (the o === -1 === playerPolity trap)", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
    const s = initSim(world, 5); // playerPolity -1
    for (let i = 0; i < 10; i++) stepSim(s);
    expect(s.attacksOnPlayer.size).toBe(0);
    expect(s.attacksByPlayer.size).toBe(0);
  });

  it("records rivals taking player cells, and player attacks, with the current tick", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
    const s = initSim(world, 5);
    const counts = new Map<number, number>();
    for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    s.playerPolity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // weaken the player so borders bleed: rivals will take cells within a few ticks
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === s.playerPolity ? 0.15 : 0.9;
    for (let i = 0; i < 10 && s.attacksOnPlayer.size === 0; i++) stepSim(s);
    expect(s.attacksOnPlayer.size).toBeGreaterThan(0);
    for (const [p, t] of s.attacksOnPlayer) {
      expect(p).not.toBe(s.playerPolity);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(s.tick);
    }
    // player attack records the defender
    const target = borderTargets(s).find((x) => x.capturable);
    if (target) {
      const r = applyIntervention(s, { type: "attack", cell: target.cell });
      if (r.ok) expect(s.attacksByPlayer.get(target.owner)).toBe(s.tick);
    }
  });
});
```

Append to `src/engine/dilemma.test.ts` inside the `describe("hegemon crisis arc", ...)` block (reusing its `hegemonState` helper):

```ts
  it("the reckoning writes the grudge ledger in the right direction", () => {
    const s = hegemonState(4);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    if (d1?.code !== "hegemon1") return; // this seed didn't open the arc — soft-skip, same style as the defector guard above
    const foe = Number(d1.data.polity);
    resolveDilemma(s, d1, "b");
    const d2 = offerDilemma(s)!;
    resolveDilemma(s, d2, "b");
    const d3 = offerDilemma(s)!;
    const rng = s.rng;
    s.rng = () => 0; // force victory
    resolveDilemma(s, d3, "a");
    s.rng = rng;
    expect(s.attacksByPlayer.get(foe)).toBe(s.tick);
    expect(s.attacksOnPlayer.has(foe)).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/intervention.test.ts src/engine/dilemma.test.ts`
Expected: FAIL — `attacksOnPlayer` undefined.

- [ ] **Step 3: Implement**

(a) `src/engine/historySim.ts` — in the `SimState` interface after `dilemmaFlags`:

```ts
  attacksOnPlayer: Map<number, number>; // polityId -> last tick it took player cells; play only
  attacksByPlayer: Map<number, number>; // polityId -> last tick the player took its cells; play only
```

and in the `initSim` return object: `attacksOnPlayer: new Map(), attacksByPlayer: new Map(),` beside `dilemmaFlags`.

(b) stepSim LAND contest loop — replace `if (atk > def * CONTEST_THRESH) nextOwner[c] = best;` with:

```ts
    if (atk > def * CONTEST_THRESH) {
      nextOwner[c] = best;
      // grudge ledger (play only). The explicit gate is LOAD-BEARING: on the pure path
      // playerPolity is -1 and unclaimed cells have o === -1, so o === playerPolity is true.
      if (s.playerPolity >= 0) {
        if (o === s.playerPolity) s.attacksOnPlayer.set(best, s.tick);
        else if (best === s.playerPolity && o >= 0) s.attacksByPlayer.set(o, s.tick);
      }
    }
```

(c) stepSim STRAIT contest loop (already inside a `playerPolity >= 0` block) — replace its `if (atk > def * CONTEST_THRESH) nextOwner[c] = best;` with:

```ts
      if (atk > def * CONTEST_THRESH) {
        nextOwner[c] = best;
        if (o === s.playerPolity) s.attacksOnPlayer.set(best, s.tick);
        else if (best === s.playerPolity && o >= 0) s.attacksByPlayer.set(o, s.tick);
      }
```

(d) `src/engine/intervention.ts` — in `applyIntervention`'s attack branch, directly after `const captured = resolveCapture(...).length;` add:

```ts
      s.attacksByPlayer.set(def, s.tick); // grudge ledger: the player struck this polity
```

(e) `src/engine/dilemma.ts` — in the `hegemon3` branch: in the victory path (after the spoils flip loop) add `s.attacksByPlayer.set(foe, s.tick);`; in the rout path (after the lost-cells flip loop) add `s.attacksOnPlayer.set(foe, s.tick);`.

- [ ] **Step 4: Run the suites + FULL suite (golden guard — initSim changed)**

Run: `npx vitest run src/engine/intervention.test.ts src/engine/dilemma.test.ts` → PASS.
Run: `npx vitest run` → ALL PASS incl. the world/history golden tests. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/historySim.ts src/engine/intervention.ts src/engine/dilemma.ts src/engine/intervention.test.ts src/engine/dilemma.test.ts
git commit -m "feat(play): grudge ledger — bilateral attack history (stepSim contests, player attacks, hegemon battle)"
```

---

### Task 4: Grudges in attitudes — decay window, hostile flip, tooltip lines

**Files:**
- Modify: `src/engine/standing.ts` (`neighborAttitudes` + `GRUDGE_TICKS`), `src/ui/playApp.ts` (chip tooltip `lines`), `src/ui/i18n.ts` (4 keys ×2 langs)
- Test: `src/engine/standing.test.ts` (append), `src/ui/playApp.test.ts` (append)

**Interfaces:**
- Consumes: Task 3's maps.
- Produces: `export const GRUDGE_TICKS = 5;` and `NeighborAttitude` gains `attackedMeAgo: number | null; iAttackedAgo: number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/standing.test.ts` inside the `neighborAttitudes` describe (its `playerState` helper is in scope):

```ts
  it("a fresh attack makes even a weaker neighbor hostile; the grudge decays; truce still wins", () => {
    const s = playerState(1);
    const weaker = neighborAttitudes(s).find((a) => a.att === "wary");
    expect(weaker).toBeDefined();
    if (!weaker) return;
    s.attacksOnPlayer.set(weaker.id, s.tick);
    let a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.attackedMeAgo).toBe(0);
    expect(a.att).toBe("hostile"); // proven contest superiority beats a small ratio
    // decay: GRUDGE_TICKS later it is forgotten
    s.tick += GRUDGE_TICKS;
    a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.attackedMeAgo).toBeNull();
    expect(a.att).toBe("wary");
    // truce overrides a fresh grudge (the engine literally blocks their attacks)
    s.attacksOnPlayer.set(weaker.id, s.tick);
    s.truces.set(weaker.id, s.tick + 2);
    a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.att).toBe("friendly");
    // my own attacks display but never flip attitude
    s.truces.delete(weaker.id);
    s.attacksOnPlayer.delete(weaker.id);
    s.attacksByPlayer.set(weaker.id, s.tick);
    a = neighborAttitudes(s).find((x) => x.id === weaker.id)!;
    expect(a.iAttackedAgo).toBe(0);
    expect(a.att).toBe("wary");
  });
```

Append to `src/ui/playApp.test.ts`:

```ts
it("attacking a neighbor leaves a grudge line in its tooltip next turn", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
  const targetName = (target.querySelector("title")?.textContent || "").replace(/^⛵ /, "").replace(/ [✓✗].*$/, "");
  target.dispatchEvent(new MouseEvent("click"));
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const chip = [...root.querySelectorAll(".neighbor-chip")].find((c) => (c.textContent || "").includes(targetName)) as HTMLElement | undefined;
  if (chip) expect(chip.title).toMatch(/attacked them|내가 침공/); // still bordering ⇒ the grudge line shows
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: FAIL — `GRUDGE_TICKS`/`attackedMeAgo` missing.

- [ ] **Step 3: Implement**

(a) `src/engine/standing.ts`:

```ts
export const GRUDGE_TICKS = 5; // 50y — grudges decay (the Civ VI grievances lesson)
```

`NeighborAttitude` gains:

```ts
  attackedMeAgo: number | null; // ticks since it last took player cells, null if never/expired
  iAttackedAgo: number | null;  // ticks since the player last took its cells (display-only)
```

In `neighborAttitudes`, inside the loop before `att` is computed:

```ts
    const ago = (m: Map<number, number>): number | null => {
      const t = m.get(h.id);
      return t !== undefined && s.tick - t < GRUDGE_TICKS ? s.tick - t : null;
    };
    const attackedMeAgo = ago(s.attacksOnPlayer);
    const iAttackedAgo = ago(s.attacksByPlayer);
```

`att` becomes:

```ts
    const att: Attitude = truceLeft > 0 ? "friendly"
      : ratio >= ATT_HOSTILE_RATIO || hegemon || attackedMeAgo !== null ? "hostile" : "wary";
```

and the pushed object gains `attackedMeAgo, iAttackedAgo`.

(b) i18n — `PLAY_UI.en`:

```ts
factAttackedMe: "⚔ attacked you {n} turns ago", factAttackedMeNow: "⚔ attacked you this turn",
factIAttacked: "you attacked them {n} turns ago · grudge", factIAttackedNow: "you attacked them this turn · grudge",
```

`PLAY_UI.ko`:

```ts
factAttackedMe: "⚔ 최근 나를 침공 ({n}턴 전)", factAttackedMeNow: "⚔ 이번 턴에 나를 침공",
factIAttacked: "내가 침공했음 ({n}턴 전) · 원한", factIAttackedNow: "이번 턴에 내가 침공 · 원한",
```

(c) `src/ui/playApp.ts` — in the chip-tooltip `lines` construction (renderPanel), after the truce line and BEFORE the hegemon line:

```ts
    if (a.attackedMeAgo !== null) lines.push(a.attackedMeAgo === 0
      ? playT(lang, "factAttackedMeNow")
      : playT(lang, "factAttackedMe").replace("{n}", String(a.attackedMeAgo)));
    if (a.iAttackedAgo !== null) lines.push(a.iAttackedAgo === 0
      ? playT(lang, "factIAttackedNow")
      : playT(lang, "factIAttacked").replace("{n}", String(a.iAttackedAgo)));
```

- [ ] **Step 4: Run the suites**

Run: `npx vitest run src/engine/standing.test.ts src/ui/playApp.test.ts` → PASS. Full suite + `npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/ui/i18n.ts src/ui/playApp.ts src/engine/standing.test.ts src/ui/playApp.test.ts
git commit -m "feat(play): grudges reach the attitude chips — decaying bilateral history, honest hostile flip"
```

---

### Task 5: Full verification (controller-run)

- [ ] **Step 1:** `npx vitest run` from the worktree root (~460 expected, trust actual) + `npm run build` clean.
- [ ] **Step 2:** Live via dev server: `play.html#seed=Narnia` boots and shows the SAME world name as `#seed=<hashStringToSeed("Narnia")>`; landing input routes both buttons; in a game, attack a neighbor → next turn its chip tooltip carries the grudge line; getting attacked shows ⚔ 최근 나를 침공 (find via a weakened realm); KO/EN toggle on the lines; zero console errors.
- [ ] **Step 3:** Whole-branch final review (most capable model, read-only git) → fix wave if needed → merge per finishing-a-development-branch; push awaits "push해"; visual look = user's eyes.
