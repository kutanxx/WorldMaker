# Mobile Touch Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WorldMaker playable on a phone: honor device width (viewport meta), give touch users 44px-class tap targets, and surface the 11+ hover-only tooltips through a tap-activated bottom strip.

**Architecture:** Three independent layers. (1) One `<meta name="viewport">` line per HTML entry unlocks the existing <1100px stack on phones — measured today, phones lay out at 981px and shrink everything to ~38%. (2) A `@media (pointer: coarse)` CSS block bumps interactive controls; desktop (fine-pointer) rules untouched. (3) A new `src/ui/tipStrip.ts` installs ONE delegated click listener that shows any tapped element's `title` in a fixed bottom strip on coarse-pointer devices.

**Tech Stack:** TypeScript, Vite MPA, vitest (+jsdom for tipStrip, node env for file-based sanity tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-mobile-touch-pass-design.md`

## Global Constraints

- Run all test commands from the WORKTREE root. Baseline before Task 1: 498 passing.
- `npm run build` = `tsc --noEmit && vite build`, noUnusedLocals on.
- Pure-history path (Version A) byte-identical: no `src/engine` changes. The viewport meta touches `map.html` markup only — no Version A code.
- `playApp.ts` "verbatim advance handler" guarded region untouched (Task 3 adds one import + one call in `createPlayApp` setup, far from it).
- Desktop rendering must be pixel-identical: every new CSS rule lives inside `@media (pointer: coarse)` except `.tip-strip` itself (which only ever becomes visible on coarse devices because only then is it installed).
- jsdom quirk: `matchMedia` is absent/non-matching in jsdom — `installTipStrip`'s default must resolve `coarse: false` there so existing playApp tests never see a strip; tests force `coarse: true` explicitly.
- Commit after every task; message style `feat(mobile): …`.

---

### Task 1: Viewport meta in all three HTML entries

**Files:**
- Modify: `index.html`, `play.html`, `map.html` (one line each, in `<head>` after `<meta charset…>`)
- Create: `src/mobile.test.ts`

**Interfaces:**
- Produces: the exact meta line Task 2's media queries depend on to fire on phones:
  `<meta name="viewport" content="width=device-width, initial-scale=1" />`

- [ ] **Step 1: Write the failing test**

Create `src/mobile.test.ts` (node environment — no jsdom banner; it reads files, not DOM):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Phones without this meta lay the page out at ~980px and scale it down — every
// control shrinks to ~38% (measured: a 32px advance button ≈ 12pt on a 375pt phone).
describe("mobile viewport meta", () => {
  for (const f of ["index.html", "play.html", "map.html"]) {
    it(`${f} declares a device-width viewport`, () => {
      expect(read(f)).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/mobile.test.ts`
Expected: 3 FAIL (no viewport meta in any file).

- [ ] **Step 3: Implement**

In each of `index.html`, `play.html`, `map.html`, add inside `<head>` (right after the charset meta):

```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
```

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 498 + 3 = 501 passing; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add index.html play.html map.html src/mobile.test.ts
git commit -m "feat(mobile): device-width viewport meta — phones stop rendering at 981px"
```

---

### Task 2: Coarse-pointer touch targets + gesture hygiene

**Files:**
- Modify: `src/theme.css` (one new media block at the end)
- Modify: `src/mobile.test.ts` (one guard test)

**Interfaces:**
- Consumes: real class names verified in the codebase: play root is `#play`, landing root is `#landing`; neighbor chips are `<span class="neighbor-chip …">` (NOT buttons — they need their own rule); replay bar controls are `.timeline-play` (button) / `.timeline-slider` (range input); goal chips are `<span class="goal-chip">`.
- Produces: the `@media (pointer: coarse)` block Task 3's live check exercises.

- [ ] **Step 1: Write the failing guard test**

Append to `src/mobile.test.ts`:

```ts
describe("coarse-pointer ergonomics", () => {
  it("theme.css carries the touch-target block", () => {
    const css = read("src/theme.css");
    expect(css).toContain("@media (pointer: coarse)");
    expect(css).toContain(".neighbor-chip"); // the worst offender (19px tall) is covered
  });
});
```

(The second assertion passes only if `.neighbor-chip` appears anywhere — it already does in the base rules — so the meaningful red/green is the media-query line; the chip assertion documents intent.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/mobile.test.ts`
Expected: the new test FAILS on the `@media (pointer: coarse)` assertion.

- [ ] **Step 3: Implement**

Append to `src/theme.css`:

```css
/* touch ergonomics: devices whose PRIMARY pointer is coarse (phones/tablets) get 44px-class
   targets and no double-tap-zoom delay. Fine-pointer desktops — including touch-screen
   laptops with a trackpad — are untouched. Measured pre-fix: advance 32px, chip 19px tall. */
@media (pointer: coarse) {
  #play button, #landing button { min-height: 44px; touch-action: manipulation; }
  .neighbor-chip { min-height: 40px; display: inline-flex; align-items: center; padding: 6px 10px; touch-action: manipulation; }
  .goal-chip { padding: 6px 10px; }
  .play-actions .timeline-play { min-width: 44px; }
  .play-actions .timeline-slider { height: 32px; }
}
```

- [ ] **Step 4: Full suite**

Run: `npx vitest run`
Expected: 501 + 1 = 502 passing. (CSS itself is unexercisable in jsdom — the file-based guard plus the session lead's live/device check carry acceptance.)

- [ ] **Step 5: Commit**

```bash
git add src/theme.css src/mobile.test.ts
git commit -m "feat(mobile): coarse-pointer touch targets — 44px controls, tappable chips, no double-tap zoom"
```

---

### Task 3: Tap-strip tooltips (`src/ui/tipStrip.ts`)

**Files:**
- Create: `src/ui/tipStrip.ts`
- Create: `src/ui/tipStrip.test.ts`
- Modify: `src/ui/playApp.ts` (one import + one call in `createPlayApp` setup)
- Modify: `src/theme.css` (`.tip-strip` rules)

**Interfaces:**
- Produces: `installTipStrip(root: HTMLElement, coarse?: boolean): () => void` and `TIP_MS = 4000`. Default `coarse` = `matchMedia("(pointer: coarse)").matches` in try/catch (false in jsdom). When `coarse` is false: no-op, returns a no-op disposer, creates NO DOM.
- Consumes: nothing from other tasks (independent; Task 2's CSS block and this task's `.tip-strip` rules are separate additions to theme.css).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/tipStrip.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installTipStrip, TIP_MS } from "./tipStrip";

describe("installTipStrip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  function setup(coarse = true) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = installTipStrip(root, coarse);
    return { root, dispose };
  }
  const strip = () => document.querySelector(".tip-strip") as HTMLElement | null;

  it("tapping a titled element shows its title in the strip", () => {
    const { root } = setup();
    const btn = document.createElement("button");
    btn.title = "공격 ×1.35 · 방어 ×0.8";
    root.appendChild(btn);
    btn.click();
    expect(strip()!.textContent).toBe("공격 ×1.35 · 방어 ×0.8");
    expect(strip()!.classList.contains("show")).toBe(true);
  });

  it("auto-hides after TIP_MS; a new tap resets the timer", () => {
    const { root } = setup();
    const btn = document.createElement("button");
    btn.title = "tip";
    root.appendChild(btn);
    btn.click();
    vi.advanceTimersByTime(TIP_MS - 100);
    expect(strip()!.classList.contains("show")).toBe(true);
    btn.click(); // reset
    vi.advanceTimersByTime(TIP_MS - 100);
    expect(strip()!.classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(200);
    expect(strip()!.classList.contains("show")).toBe(false);
  });

  it("untitled and empty-title taps do nothing (and don't hide an active tip)", () => {
    const { root } = setup();
    const titled = document.createElement("button");
    titled.title = "keep me";
    const plain = document.createElement("button");
    const empty = document.createElement("button");
    empty.setAttribute("title", "");
    root.append(titled, plain, empty);
    titled.click();
    plain.click();
    empty.click();
    expect(strip()!.textContent).toBe("keep me");
    expect(strip()!.classList.contains("show")).toBe(true);
  });

  it("a tap on a child bubbles to the titled ancestor", () => {
    const { root } = setup();
    const chip = document.createElement("span");
    chip.title = "국경 3칸 접촉";
    const inner = document.createElement("b");
    inner.textContent = "👁";
    chip.appendChild(inner);
    root.appendChild(chip);
    inner.click();
    expect(strip()!.textContent).toBe("국경 3칸 접촉");
  });

  it("coarse=false installs nothing", () => {
    setup(false);
    expect(strip()).toBeNull();
  });

  it("dispose removes the strip and stops listening", () => {
    const { root, dispose } = setup();
    dispose();
    expect(strip()).toBeNull();
    const btn = document.createElement("button");
    btn.title = "tip";
    root.appendChild(btn);
    btn.click();
    expect(strip()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/tipStrip.test.ts`
Expected: module resolution failure (file doesn't exist).

- [ ] **Step 3: Implement**

Create `src/ui/tipStrip.ts`:

```ts
// Tap-strip tooltips — touch devices can't hover, so the title-attribute explanations
// (stance multipliers, chip factors, goal conditions, meter help…) surface in a fixed
// bottom strip on tap. ONE delegated listener covers every present and future [title]
// element; buttons still fire their own actions — the strip is additive, never blocking.
export const TIP_MS = 4000;

function prefersCoarse(): boolean {
  try { return typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches; }
  catch { return false; } // jsdom / ancient browsers: behave like desktop
}

export function installTipStrip(root: HTMLElement, coarse: boolean = prefersCoarse()): () => void {
  if (!coarse) return () => {};
  const strip = document.createElement("div");
  strip.className = "tip-strip";
  document.body.appendChild(strip);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => { strip.classList.remove("show"); };
  const onClick = (e: Event) => {
    const el = (e.target as Element).closest?.("[title]");
    const tip = el?.getAttribute("title") ?? "";
    if (!tip) return; // untitled or empty: leave any active tip alone
    strip.textContent = tip;
    strip.classList.add("show");
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(hide, TIP_MS);
  };
  root.addEventListener("click", onClick);
  return () => {
    root.removeEventListener("click", onClick);
    if (timer !== null) clearTimeout(timer);
    strip.remove();
  };
}
```

Wire into `src/ui/playApp.ts` — import at top with the other `./` imports:

```ts
import { installTipStrip } from "./tipStrip";
```

and in `createPlayApp`, right after the `let lang: Lang = detectLang();` line:

```ts
  installTipStrip(root); // no-op on fine-pointer devices; covers picker AND game screens
```

Add to `src/theme.css` (base rules — visibility is gated by installation, not by media query):

```css
/* tap-strip: the touch replacement for hover tooltips; installed only on coarse pointers */
.tip-strip { position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 60; background: rgba(42, 33, 24, 0.92); color: #f2e8d5; padding: 10px 14px; border-radius: 10px; font-size: 14px; pointer-events: none; opacity: 0; transition: opacity 0.15s; }
.tip-strip.show { opacity: 1; }
```

- [ ] **Step 4: Full suite + typecheck + build**

Run: `npx vitest run` then `npm run build`
Expected: 502 + 6 = 508 passing; build clean. Existing playApp tests unaffected (jsdom resolves `coarse: false` → the wiring call is a no-op there).

- [ ] **Step 5: Commit**

```bash
git add src/ui/tipStrip.ts src/ui/tipStrip.test.ts src/ui/playApp.ts src/theme.css
git commit -m "feat(mobile): tap-strip tooltips — delegated [title] surfacing for touch"
```

---

## Post-plan verification (session lead, not a task)

- Full suite + `npm run build` from the worktree root.
- Live (browser pane at 375×812): reload play.html → `window.innerWidth` flips **981 → 375** (the meta now governs the pane's phone emulation — this is the live proof), `document.documentElement.scrollWidth === 375` (no horizontal overflow), narrow stack order intact (panel → goals → map → …), console clean. Landing + map.html load sanely at 375.
- The pane cannot emulate `(pointer: coarse)` — the CSS bumps and tap strip need the user's REAL PHONE after deploy (kutanxx.github.io/WorldMaker). State this explicitly in the wrap-up.
- Whole-branch review before merge.
