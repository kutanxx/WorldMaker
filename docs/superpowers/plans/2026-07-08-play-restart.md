# Play-mode Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add "Play again (same world)" and "New world" buttons to the game-over banner.

**Architecture:** One task in the play UI. `renderBanner` appends two buttons; Play-again calls the existing `renderPicker()`, New-world sets a fresh seed hash and reloads. New i18n keys + a CSS row. No engine change → golden hashes byte-identical.

**Tech Stack:** TypeScript, Vite MPA, Vitest (jsdom).

## Global Constraints

- **Play-UI only.** No engine file edited (`historySim.ts`, `intervention.ts`, `world.ts`, `dilemma.ts`, `standing.ts`, `playSim.ts`); no golden-hash impact.
- **All user-facing strings via `playT(lang, key)`** with BOTH `en` and `ko`. Glyphs (▶ 🌍) may be literal.
- Run tests from THIS worktree with `npm test`. Baseline: **404 tests**.

---

### Task 1: Restart buttons on the end banner

**Files:**
- Modify: `src/ui/playApp.ts` (import `randomSeed`; append buttons in `renderBanner`)
- Modify: `src/ui/i18n.ts` (add `playAgain`, `newWorld` to both `en` and `ko`)
- Modify: `src/theme.css` (add `.restart-row`)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: existing `renderPicker()` (createPlayApp scope), `randomSeed()` from `./urlState`.
- Produces: `.restart-row` with `.btn-play-again` (→ `renderPicker()`) and `.btn-new-world` (→ fresh seed + reload) in the banner.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts` inside `describe("playApp", ...)`:

```ts
  it("offers restart options when the reign ends, and Play again returns to the picker", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    // every reign ends by turn 50 (500 years); advance until the game-over banner appears
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break; // end() clears the command bar
      adv.click();
    }
    expect(root.querySelector(".stub")).not.toBeNull();          // banner shown
    expect(root.querySelector(".btn-play-again")).not.toBeNull();
    expect(root.querySelector(".btn-new-world")).not.toBeNull();
    (root.querySelector(".btn-play-again") as HTMLButtonElement).click();
    expect(root.querySelector(".nation-choice")).not.toBeNull(); // back to the picker
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playApp`
Expected: FAIL — `.btn-play-again` is null.

- [ ] **Step 3: Add i18n keys**

In `src/ui/i18n.ts`, add to the **`en`** play block: `playAgain: "▶ Play again", newWorld: "🌍 New world",`
Add to the **`ko`** play block: `playAgain: "▶ 다시 통치", newWorld: "🌍 새 세계",`

- [ ] **Step 4: Import `randomSeed` and append the buttons**

In `src/ui/playApp.ts`, add the import near the other `./` UI imports:

```ts
import { randomSeed } from "./urlState";
```

In `renderBanner`, after `banner.appendChild(exp);` (the reign-export button) and before `col.insertBefore(banner, log);`, insert:

```ts
      const restart = document.createElement("div");
      restart.className = "restart-row";
      const again = document.createElement("button");
      again.className = "btn-play-again";
      again.textContent = playT(lang, "playAgain");
      again.addEventListener("click", renderPicker); // same world, choose a nation again
      const fresh = document.createElement("button");
      fresh.className = "btn-new-world";
      fresh.textContent = playT(lang, "newWorld");
      fresh.addEventListener("click", () => {
        location.hash = `seed=${randomSeed()}`; // a fresh seed, so the reload builds a new world
        location.reload();
      });
      restart.append(again, fresh);
      banner.appendChild(restart);
```

- [ ] **Step 5: Add CSS**

In `src/theme.css`, near the `.stub` rules, add:

```css
.restart-row { display: flex; gap: 10px; justify-content: center; margin-top: 14px; }
.restart-row .btn-play-again { font-weight: 700; }
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npm test -- playApp` → PASS (new test + existing green).
Run: `npm test` → all pass (**405 tests** = 404 + 1), no golden regressions.
Run: `npx tsc --noEmit` → clean. Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): game-over restart — play again (same world) + new world buttons"
```

Manual check (user): finish a reign → the banner shows Play again / New world; Play again returns to the nation picker; New world loads a fresh map.

---

## Self-Review

**1. Spec coverage:** Play-again (same world → `renderPicker`) + New-world (fresh seed + reload) on the banner → Step 4. i18n → Step 3. CSS → Step 5. Play-UI only / goldens intact → Global Constraints. ✓

**2. Placeholder scan:** No TBD/TODO; all code complete.

**3. Type consistency:** `renderPicker` is a zero-arg function used directly as the click handler; `randomSeed(): number` interpolated into the hash. i18n keys `playAgain`/`newWorld` match the `playT` calls. Classes `.restart-row`/`.btn-play-again`/`.btn-new-world`/`.stub`/`.btn-advance`/`.nation-choice` match the test queries.
