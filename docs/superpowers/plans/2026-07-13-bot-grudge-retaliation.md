# Bot Grudge Retaliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bots the player attacked hit back harder for the grudge window (REVENGE_MULT at every contest site), and the neighbor-attitude chip honestly shows them as hostile — completing the grievances loop the UI has promised since 07-11c.

**Architecture:** One engine helper (`revengeMult`) multiplies the ATTACK side of a contest when the attacker holds a fresh grudge (`attacksByPlayer` within `GRUDGE_TICKS`) and the defender is the player. Applied at the three existing contest sites (land / strait / sea-lane), all already inside play-only gates. `GRUDGE_TICKS` moves from `standing.ts` to `historySim.ts` (standing imports FROM historySim — verified, the reverse would cycle) with a re-export so UI/test import sites stay valid. `standing.ts` then promotes fresh `iAttacked` to hostile.

**Tech Stack:** TypeScript, vitest (node env for engine tests). No new dependencies, no UI changes.

**Spec:** `docs/superpowers/specs/2026-07-13-bot-grudge-retaliation-design.md`

## Global Constraints

- Run all test commands from the WORKTREE root. Baseline before Task 1: 515 passing.
- **Pure path byte-identical:** golden FNV hash tests in `world.test.ts`/`history.test.ts` and all `initSim` behavior untouched. The multiplier must only execute inside existing `playerPolity >= 0` gates — the `o === -1 === playerPolity` pure-path trap (documented at historySim.ts:312-313) is LOAD-BEARING.
- rng discipline: `revengeMult` must not draw from `s.rng` and must not reorder any existing draw.
- The verbatim advance handler in playApp.ts is untouched (no UI files change at all).
- `REVENGE_MULT = 1.2` initial; pre-authorized levers 1.15 / 1.3 if the Task 1 sweep says invisible/dominant.
- Commit style `feat(play): …`.

---

### Task 1: REVENGE_MULT at all three contest sites (+ GRUDGE_TICKS relocation + sweep)

**Files:**
- Modify: `src/engine/historySim.ts` (consts near the top; contest sites at ~lines 306-309, ~339-340, ~359-360)
- Modify: `src/engine/standing.ts` (line 60: const → re-export)
- Test: `src/engine/historySim.test.ts`

**Interfaces:**
- Consumes: `s.attacksByPlayer: Map<number, number>` (polityId → last tick the player took its cells; already recorded at all sites and by `intervention.ts`/`dilemma.ts`).
- Produces (Task 2 and the UI rely on these):
  - `export const GRUDGE_TICKS = 5;` now lives in `src/engine/historySim.ts`; `src/engine/standing.ts` re-exports it (`export { GRUDGE_TICKS } from "./historySim";`) so `standing.test.ts` and any UI imports compile unchanged.
  - `export const REVENGE_MULT = 1.2;` in `historySim.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/historySim.test.ts` (inside its existing describe; it already imports `generateWorld`, `DEFAULT_PARAMS`, `initSim`, `initPlaySim`, `playTurn`, `OCEAN` — add `GRUDGE_TICKS` and `REVENGE_MULT` to the imports from `./historySim`):

```ts
  // ROBUST staging (contest margins are seed-sensitive): the FOE owns everything except the
  // player's single cell t; t's solidarity is tuned into the sandwich window where the foe's
  // attack holds WITHOUT a grudge but flips WITH one — that sandwich IS the proof of the mult.
  function stageRevenge(seed: number, playerSol: number) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const s = initPlaySim(world, seed, 0, "internal");
    const player = 0, foe = 1;
    // find a player-owned cell with at least one land neighbor to become the lone holdout
    let t = -1;
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] < 0 || s.terrain[c] === OCEAN) continue;
      if (s.grid.neighbors[c].some((nb) => s.terrain[nb] !== OCEAN)) { t = c; break; }
    }
    for (let c = 0; c < s.n; c++) if (s.owner[c] >= 0) s.owner[c] = foe;
    s.owner[t] = player;
    // foe's capital on a neighbor: kills the admin-distance penalty for the attack
    const nb = s.grid.neighbors[t].find((x) => s.terrain[x] !== OCEAN)!;
    s.capitals[foe] = nb;
    s.capitals[player] = t;
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === foe ? 0.5 : playerSol;
    return { s, t, foe, player };
  }

  it("a fresh grudge flips a contest the foe would otherwise lose (REVENGE_MULT bites)", () => {
    // sandwich: same staging, only the grudge differs
    const clean = stageRevenge(3, 0.6);
    playTurn(clean.s, null);
    const held = clean.s.owner[clean.t] === clean.player;

    const grudged = stageRevenge(3, 0.6);
    grudged.s.attacksByPlayer.set(grudged.foe, grudged.s.tick); // the player struck them this tick
    playTurn(grudged.s, null);
    const fell = grudged.s.owner[grudged.t] === grudged.foe;

    expect(held).toBe(true);  // without a grudge the internal-stance defense holds
    expect(fell).toBe(true);  // with one, REVENGE_MULT (1.2) tips the same contest
  });

  it("the grudge expires after GRUDGE_TICKS — the same contest holds again", () => {
    const stale = stageRevenge(3, 0.6);
    stale.s.tick = GRUDGE_TICKS; // age the ledger entry set at tick 0 to exactly-expired
    stale.s.attacksByPlayer.set(stale.foe, 0);
    playTurn(stale.s, null);
    expect(stale.s.owner[stale.t]).toBe(stale.player);
  });
```

**Tuning note for the implementer:** `playerSol: 0.6` targets the sandwich window computed from the contest model (foe atk ≈ 0.90 with sol 0.5, player def ≈ 1.575·P under internal's ×1.05; window ≈ P ∈ (0.56, 0.66)). stepSim's pre-contest solidarity update shifts both sides ~equally, but if the sandwich doesn't hold at 0.6 on seed 3, bisect `playerSol` in ±0.02 steps (and only if no value works, try seed 4/5) until BOTH assertions of the first test pass — then the expiry test uses the same value. Do not weaken the assertions.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/engine/historySim.test.ts`
Expected: FAIL — `REVENGE_MULT`/`GRUDGE_TICKS` not exported from `./historySim` (import error), or once imports are stubbed, the grudge case does NOT flip.

- [ ] **Step 3: Implement**

3a. `src/engine/historySim.ts` — near the other exported tuning consts add:

```ts
export const GRUDGE_TICKS = 5;  // 50y — grudges decay (Civ VI grievances); moved from standing.ts (import direction)
export const REVENGE_MULT = 1.2; // a grudge-holding polity strikes PLAYER cells this much harder while fresh
```

and above `stepSim`:

```ts
// revenge (play only): a polity the player struck within the grudge window hits back harder
// at PLAYER cells. Callers sit inside playerPolity>=0 gates — the o===-1===playerPolity
// pure-path trap never reaches this, and no rng is drawn.
function revengeMult(s: SimState, attacker: number): number {
  const t = s.attacksByPlayer.get(attacker);
  return t !== undefined && s.tick - t < GRUDGE_TICKS ? REVENGE_MULT : 1;
}
```

3b. Land site (~306-309) — the player-defending branch gains the multiplier:

```ts
    if (s.playerPolity >= 0) {
      if (best === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];   // player attacking
      if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, best); } // player defending; grudges bite
    }
```

3c. Strait site (~339-340), already inside the `playerPolity >= 0 && straitLinks` gate:

```ts
      if (best === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];
      if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, best); }
```

3d. Sea-lane site (~359-360), inside the `playerPolity >= 0 && seaLanes` gate:

```ts
        if (p === s.playerPolity) atk *= STANCE_ATK_MULT[s.stance];
        if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, p); }
```

3e. `src/engine/standing.ts` line 60 — replace `export const GRUDGE_TICKS = 5; // 50y — grudges decay (the Civ VI grievances lesson)` with:

```ts
export { GRUDGE_TICKS } from "./historySim"; // single source with the sim — the chip stops saying 원한 exactly when the sim stops acting on it
```

(Keep `ATT_HOSTILE_RATIO` where it is. Verify `standing.test.ts` still compiles — it imports `GRUDGE_TICKS` from `./standing`, which the re-export preserves.)

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 515 + 2 = 517 passing — including every golden-hash test (pure path untouched); tsc clean.

- [ ] **Step 5: Calibration sweep (throwaway — numbers into the report, code NOT committed)**

Write a TEMPORARY test (e.g. `historySim.sweep.test.ts`, deleted before commit) that, for seeds 1..10: builds `initPlaySim(world, seed, 0, "internal")`, picks the player's largest bordering polity as foe, runs 10 `playTurn(s, null)` twice from fresh sims — once clean, once with `s.attacksByPlayer.set(foe, 0)` pre-seeded — and records the player's cell count after each run. Report per-seed (clean − grudged) player-cell deltas and the median. Expected shape: median uplift ≥ 1 cell (revenge is real) and no seed where the player collapses outright (aggression stays viable). If median is 0 → note that 1.3 is the pre-authorized lever; if the player loses >30% more cells than clean on most seeds → 1.15. DO NOT change REVENGE_MULT yourself — report the numbers and leave the decision to the session lead. Delete the sweep file, verify `git status` shows only the intended files.

- [ ] **Step 6: Commit**

```bash
git add src/engine/historySim.ts src/engine/standing.ts src/engine/historySim.test.ts
git commit -m "feat(play): bot grudge retaliation — REVENGE_MULT at land/strait/lane contests"
```

---

### Task 2: Honest hostile flip for iAttacked

**Files:**
- Modify: `src/engine/standing.ts` (attitude computation at ~lines 95-96; comments at ~55-57 and ~70)
- Test: `src/engine/standing.test.ts`

**Interfaces:**
- Consumes: `GRUDGE_TICKS` (re-exported from `./historySim` via Task 1 — import unchanged), existing `iAttackedAgo` computation.
- Produces: `neighborAttitudes` returns `att: "hostile"` while `iAttackedAgo !== null` (truce still wins as friendly).

- [ ] **Step 1: Write/adjust the failing tests**

In `src/engine/standing.test.ts`, find the existing block around lines 169-176 that sets `s.attacksByPlayer.set(weaker.id, s.tick)` — it currently asserts the pre-flip behavior (wary + `iAttackedAgo` populated). AMEND its attitude expectation to `"hostile"` (the spec mandates the flip; keep its `iAttackedAgo` assertions), and ADD an expiry case:

```ts
  it("a fresh grudge the player caused now reads hostile — and relaxes when it decays", () => {
    // reuse the file's existing fixture idiom around line 159 (weaker neighbor, no truce)
    s.attacksByPlayer.set(weaker.id, s.tick);
    let att = neighborAttitudes(s).find((a) => a.id === weaker.id)!;
    expect(att.att).toBe("hostile");
    expect(att.iAttackedAgo).toBe(0);
    s.tick += GRUDGE_TICKS; // decayed
    att = neighborAttitudes(s).find((a) => a.id === weaker.id)!;
    expect(att.att).not.toBe("hostile"); // wary (or friendly if a truce fixture applies)
    expect(att.iAttackedAgo).toBeNull();
  });
```

(Adapt the fixture setup lines to the file's local helpers — the surrounding tests at lines 155-176 show the exact idiom; `weaker` must remain non-truced and below `ATT_HOSTILE_RATIO` so the grudge is the only hostile cause.)

- [ ] **Step 2: Run to verify the new/amended tests fail**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: FAIL — attitude is `"wary"` where `"hostile"` is now expected.

- [ ] **Step 3: Implement in `src/engine/standing.ts`**

The attitude line (~95-96) gains the iAttacked cause:

```ts
    const att: Attitude = truceLeft > 0 ? "friendly"
      : ratio >= ATT_HOSTILE_RATIO || hegemon || attackedMeAgo !== null || iAttackedAgo !== null ? "hostile" : "wary";
```

Update the two now-stale comments:
- The behavioral-guarantee comment (~55-57): extend "hostile = they win border contests (bigger) or are the flagged crisis foe" with "or hold a fresh grudge the player caused (stepSim retaliates at REVENGE_MULT)".
- The `iAttackedAgo` field doc (~line 70): `// ticks since the player last took its cells (display-only)` → `// ticks since the player last took its cells (backed by REVENGE_MULT retaliation)`.

- [ ] **Step 4: Full suite + typecheck + build**

Run: `npx vitest run` then `npm run build`
Expected: 517 + 1 = 518 passing (one amended + one new); build clean. If any playApp test asserted a wary chip in an iAttacked scenario, read it before touching — the flip is the sanctioned change.

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/engine/standing.test.ts
git commit -m "feat(play): iAttacked grudge now reads hostile — the chip matches the sim"
```

---

## Post-plan verification (session lead, not a task)

- Full suite + `npm run build` from the worktree root; confirm golden hashes untouched (they run in the suite).
- Review the Task 1 sweep numbers; adjudicate REVENGE_MULT (keep 1.2 / lever to 1.15 or 1.3) BEFORE the final review.
- Live check (dev server): attack a neighbor, confirm its chip flips hostile with the 원한 factor line, and watch the next few turns take player border cells more aggressively than a no-attack control run of the same seed; confirm a truce still silences it.
- Whole-branch review before merge (seams: pure-path byte-identity, GRUDGE_TICKS re-export sites, stance-mult interaction order).
