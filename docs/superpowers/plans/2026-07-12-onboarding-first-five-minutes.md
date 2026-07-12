# Onboarding First-Five-Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the five first-session frictions found in the self-feedback pass: language resets every visit, blind nation choice, cryptic goals line, wall-of-text how-to, and an unexplained daily button.

**Architecture:** All UI-layer. A new pure `src/ui/lang.ts` bootstraps language for both apps (localStorage → navigator.language → en). The nation picker reuses the already-computed `initPlaySim` owner array plus `politicalLayer`'s existing `playerPolity` highlight option for a hover minimap. Goals become labeled tooltip chips; the how-to becomes a 4-step stepper (full card via "?"); the daily button gains one framing sub-line and the picker badge a tooltip.

**Tech Stack:** TypeScript, Vite MPA, vitest (+jsdom). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-onboarding-first-five-minutes-design.md`

## Global Constraints

- Run all test commands from the WORKTREE root (the main repo root globs worktree copies and inflates counts).
- `npm run build` = `tsc --noEmit && vite build` with **noUnusedLocals on** — an unused import fails the build.
- Pure-history path (Version A) stays byte-identical: no `src/engine` changes, golden FNV hash tests untouched. Everything here is UI-layer.
- The `playApp.ts` "verbatim advance handler" guarded region (marker comment) must not be edited. None of these tasks are near it.
- Every user-facing play string gets BOTH `PLAY_UI.en` and `PLAY_UI.ko` entries in `src/ui/i18n.ts`. The landing stays bilingual-inline (both languages printed, no i18n framework).
- jsdom's `navigator.language` is `"en-US"`, so all EXISTING tests keep their EN default with zero fixture edits — a hard requirement. Any test that writes `localStorage["wm:lang"]` must clean it up in try/finally (jsdom storage persists across tests in a file; a leaked "ko" flips later EN assertions).
- Baseline before Task 1: 488 tests passing (`npx vitest run`).
- Commit after every task; message style `feat(ux): …`.

---

### Task 1: Language auto-detect + persistence

**Files:**
- Create: `src/ui/lang.ts`
- Create: `src/ui/lang.test.ts`
- Modify: `src/ui/app.ts` (line 43 init + toggle handler at lines 81-84)
- Modify: `src/ui/playApp.ts` (line 34 init + `langButton` helper at lines 42-48)
- Test: `src/ui/playApp.test.ts` (one wiring test)

**Interfaces:**
- Consumes: `Lang` type from `src/ui/i18n.ts` (`"en" | "ko"`).
- Produces: `detectLang(navLang?: string, storage?: StorageLike | null): Lang` and `saveLang(lang: Lang, storage?: StorageLike | null): void` from `src/ui/lang.ts`. Storage key `"wm:lang"`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/lang.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectLang, saveLang } from "./lang";

function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe("detectLang", () => {
  it("a saved choice wins over the browser language", () => {
    expect(detectLang("en-US", mem({ "wm:lang": "ko" }))).toBe("ko");
    expect(detectLang("ko-KR", mem({ "wm:lang": "en" }))).toBe("en");
  });
  it("falls back to the browser language: ko* → ko, anything else → en", () => {
    expect(detectLang("ko-KR", mem())).toBe("ko");
    expect(detectLang("ko", mem())).toBe("ko");
    expect(detectLang("en-US", mem())).toBe("en");
    expect(detectLang("de-DE", mem())).toBe("en");
    expect(detectLang(undefined, mem())).toBe("en"); // jsdom navigator.language is en-US
  });
  it("ignores a corrupt saved value", () => {
    expect(detectLang("ko-KR", mem({ "wm:lang": "de" }))).toBe("ko");
  });
  it("never throws on a hostile storage", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(detectLang("ko-KR", bad)).toBe("ko");
    expect(() => saveLang("ko", bad)).not.toThrow();
  });
  it("saveLang round-trips through detectLang", () => {
    const st = mem();
    saveLang("ko", st);
    expect(detectLang("en-US", st)).toBe("ko");
  });
});
```

Append to `src/ui/playApp.test.ts`:

```ts
  it("the language toggle persists the choice for the next visit", () => {
    localStorage.removeItem("wm:lang");
    try {
      const root = document.createElement("div");
      createPlayApp(root, 1);
      (root.querySelector(".lang-toggle") as HTMLButtonElement).click(); // en → ko
      expect(localStorage.getItem("wm:lang")).toBe("ko");
    } finally {
      localStorage.removeItem("wm:lang"); // a leaked "ko" would flip later EN assertions
    }
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/lang.test.ts src/ui/playApp.test.ts`
Expected: lang.test fails to resolve `./lang`; the persistence test FAILS (`getItem` returns null).

- [ ] **Step 3: Implement**

Create `src/ui/lang.ts`:

```ts
// Language bootstrap — remember the player's choice, else follow the browser (the "stop
// clicking 한국어 every visit" fix). Storage failures must never break app startup.
import type { Lang } from "./i18n";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const KEY = "wm:lang";

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export function detectLang(navLang?: string, storage: StorageLike | null = defaultStorage()): Lang {
  try {
    const saved = storage?.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch { /* fall through to detection */ }
  const nav = navLang ?? (typeof navigator !== "undefined" ? navigator.language : "");
  return nav.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function saveLang(lang: Lang, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(KEY, lang); } catch { /* privacy mode — ignore */ }
}
```

(If `Lang` is not exported from `src/ui/i18n.ts`, export it there — check first; `app.ts`/`playApp.ts` already import it, so it is.)

`src/ui/app.ts` line 43: `let lang: Lang = "en";` → `let lang: Lang = detectLang();` and in the toggle handler (lines 81-84) add `saveLang(lang);` right after `lang = lang === "en" ? "ko" : "en";`. Import `{ detectLang, saveLang } from "./lang";`.

`src/ui/playApp.ts` line 34: same init change. In the `langButton` helper (lines 42-48) add `saveLang(lang);` right after the flip, before `onToggle()`. Same import.

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 488 + 7 = 495 passing (6 lang + 1 wiring); tsc clean. Existing tests stay green because jsdom reports `en-US` and no test leaves `wm:lang` behind.

- [ ] **Step 5: Commit**

```bash
git add src/ui/lang.ts src/ui/lang.test.ts src/ui/app.ts src/ui/playApp.ts src/ui/playApp.test.ts
git commit -m "feat(ux): language auto-detect + persistence (wm:lang), both apps"
```

---

### Task 2: Nation picker minimap with hover highlight

**Files:**
- Modify: `src/ui/playApp.ts` (the `agg0` IIFE at lines 33-36 and `renderPicker` at lines 51-96)
- Modify: `src/theme.css`
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `renderWorld(world, "political", econCells, lang)` (already imported), `politicalLayer(grid, owner, polities, opts)` (already imported), `PLAYER_COLOR` from `./nationPalette` (already imported).
- Produces: DOM contract — `.picker-row` wraps the nation list (`.landing`) and `.picker-map`; the minimap's `.political-slot` repaints on card `mouseenter`/`focus` with the hovered polity in `PLAYER_COLOR`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts` (add `PLAYER_COLOR` to the imports from `./nationPalette` — check whether the test file already imports it; if not, add `import { PLAYER_COLOR } from "./nationPalette";`):

```ts
  it("the nation picker shows a minimap; hovering a card highlights that nation", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const mapBox = root.querySelector(".picker-map");
    expect(mapBox).not.toBeNull();
    const slot = mapBox!.querySelector(".political-slot")!;
    expect(slot.children.length).toBeGreaterThan(0); // fills painted
    const magenta = () => mapBox!.querySelectorAll(`[fill="${PLAYER_COLOR}"]`).length;
    const before = magenta();
    const card = root.querySelector(".nation-choice") as HTMLButtonElement;
    card.dispatchEvent(new Event("mouseenter"));
    expect(magenta()).toBeGreaterThan(before);
    card.dispatchEvent(new Event("mouseleave"));
    expect(magenta()).toBe(before);
  });
```

(If `politicalLayer` paints fills via a different attribute than `fill` — verify in `src/ui/politicalLayer.ts` — adjust the selector to whatever attribute carries `PLAYER_COLOR`; the assertion's substance is "hover adds player-colored cells, leave removes them".)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — no `.picker-map`.

- [ ] **Step 3: Implement in `src/ui/playApp.ts`**

3a. Widen the startup IIFE (lines 33-36) to keep the initial political state:

```ts
  const { agg0, owner0, polities0 } = (() => {
    const s = initPlaySim(world, seed, 0, "internal");
    return { agg0: aggregate(s), owner0: s.owner, polities0: s.polities };
  })();
```

(`nationsByCells` keeps using `agg0` unchanged.)

3b. In `renderPicker`, build the minimap and wrap the layout. Replace `root.append(title, langButton(renderPicker), picker);` with:

```ts
    const mapBox = document.createElement("div");
    mapBox.className = "picker-map";
    const mapSvg = renderWorld(world, "political", [], lang);
    const mapSlot = mapSvg.querySelector(".political-slot") as SVGGElement;
    // hover highlight = the political layer's existing player override, nothing new
    const paintMini = (hoverId: number) => {
      mapSlot.replaceChildren(politicalLayer(world.grid, owner0, polities0, {
        fills: true, labels: false, legend: false,
        ...(hoverId >= 0 ? { playerPolity: hoverId, playerColor: PLAYER_COLOR } : {}),
      }));
    };
    paintMini(-1);
    mapBox.appendChild(mapSvg);
    const row = document.createElement("div");
    row.className = "picker-row";
    row.append(picker, mapBox);
    root.append(title, langButton(renderPicker), row);
```

3c. In the nation-card loop (after the existing `b.addEventListener("click", …)`), add:

```ts
      b.addEventListener("mouseenter", () => paintMini(p.id));
      b.addEventListener("mouseleave", () => paintMini(-1));
      b.addEventListener("focus", () => paintMini(p.id));
      b.addEventListener("blur", () => paintMini(-1));
```

3d. `src/theme.css`:

```css
.picker-row { display: flex; gap: 18px; align-items: flex-start; justify-content: center; flex-wrap: wrap; }
.picker-row .landing { flex: 1 1 340px; }
.picker-map { flex: 0 1 380px; max-width: 380px; position: sticky; top: 12px; pointer-events: none; }
.picker-map svg { width: 100%; height: auto; display: block; }
@media (max-width: 900px) {
  .picker-row { flex-direction: column-reverse; align-items: stretch; }
  .picker-map { position: static; max-width: 100%; margin: 0 auto; }
}
```

(`column-reverse` puts the map — the second child — above the list on narrow screens, per spec.)

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 495 + 1 = 496; tsc clean. If the daily-badge or legacy-panel picker tests fail on structure, they query `root` globally and should be unaffected — investigate before touching them.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(ux): nation picker minimap — hover highlights the candidate realm"
```

---

### Task 3: Goals line → labeled tooltip chips

**Files:**
- Modify: `src/ui/playApp.ts` (`renderGoals` at lines 602-612)
- Modify: `src/ui/i18n.ts` (6 new keys × 2 languages)
- Modify: `src/theme.css`
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `victoryProgress(s)` fields `rivalsLeft`, `cities`, `cohesionOk`, `year`; constants `PROSPER_CITIES`, `PROSPER_STREAK`; closure `prosperStreak` (all already in scope).
- Produces: DOM contract — `.goals` contains a `.goals-label` and three `.goal-chip` spans, each with a non-empty `title`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/playApp.test.ts`:

```ts
  it("goals render as three labeled chips with explanatory tooltips", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const chips = [...root.querySelectorAll(".goal-chip")] as HTMLElement[];
    expect(chips.length).toBe(3);
    for (const c of chips) expect(c.title.length).toBeGreaterThan(0);
    const txt = (root.querySelector(".goals") as HTMLElement).textContent || "";
    expect(txt).toMatch(/⚔/); expect(txt).toMatch(/🏘/); expect(txt).toMatch(/500/);
  });
```

(The existing test at playApp.test.ts:413 asserts ⚔/🏘/500 in `.goals` textContent — the chips keep all three, so it must stay green untouched.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: FAIL — no `.goal-chip`.

- [ ] **Step 3: Implement**

3a. Replace `renderGoals` (playApp.ts:602-612) with:

```ts
    function renderGoals(): void {
      goals.innerHTML = "";
      if (over || !s.alive[s.playerPolity]) return;
      const vp = victoryProgress(s);
      const label = document.createElement("span");
      label.className = "goals-label";
      label.textContent = `${playT(lang, "goals")}:`;
      goals.appendChild(label);
      const chip = (icon: string, text: string, tip: string) => {
        const el = document.createElement("span");
        el.className = "goal-chip";
        el.title = tip;
        el.textContent = `${icon} ${text}`;
        goals.appendChild(el);
      };
      chip("⚔", playT(lang, "goalConquest").replace("{n}", String(vp.rivalsLeft)), playT(lang, "tipGoalConquest"));
      chip("🏘", playT(lang, "goalProsper")
        .replace("{c}", String(vp.cities)).replace("{max}", String(PROSPER_CITIES))
        .replace("{ok}", vp.cohesionOk ? "✓" : "✗")
        .replace("{s}", String(prosperStreak)).replace("{need}", String(PROSPER_STREAK)),
        playT(lang, "tipGoalProsper"));
      chip("👑", playT(lang, "goalEndure").replace("{y}", String(vp.year)), playT(lang, "tipGoalEndure"));
      if (pendingAction?.type === "foundCity") {
        chip("🏘", playT(lang, "fxCityNext").replace("{n}", String(vp.cities + 1)), "");
      }
    }
```

3b. `src/ui/i18n.ts` — add to `PLAY_UI.en` (near `goals: "Goals"`):

```ts
    goalConquest: "Conquest — {n} rivals left", tipGoalConquest: "Defeat every rival realm for a conquest victory.",
    goalProsper: "Prosperity — cities {c}/{max} · cohesion {ok} · streak {s}/{need}", tipGoalProsper: "Hold 6 cities with healthy cohesion for 3 consecutive turns.",
    goalEndure: "Endure — year {y}/500", tipGoalEndure: "Keep your capital until year 500.",
```

and to `PLAY_UI.ko`:

```ts
    goalConquest: "정복 — 라이벌 {n}국", tipGoalConquest: "모든 라이벌 국가를 무너뜨리면 정복 승리입니다.",
    goalProsper: "번영 — 도시 {c}/{max} · 결속 {ok} · 연속 {s}/{need}", tipGoalProsper: "도시 6개를 보유하고 결속을 유지한 채 3턴 연속 버티면 번영 승리입니다.",
    goalEndure: "존속 — {y}/500년", tipGoalEndure: "500년까지 수도를 지키면 존속 승리입니다.",
```

3c. `src/theme.css`:

```css
.goals { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.goal-chip { border: 1px solid rgba(42, 33, 24, 0.25); border-radius: 10px; padding: 2px 8px; white-space: nowrap; cursor: help; }
```

(Check for an existing `.goals` rule in theme.css first — merge rather than duplicate the selector.)

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 496 + 1 = 497; tsc clean; test at :413 still green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(ux): goals as labeled tooltip chips — no more icon soup"
```

---

### Task 4: How-to stepper card

**Files:**
- Modify: `src/ui/playApp.ts` (state near line 115; `renderHowto` at lines 354-368; `helpBtn` handler at line 583)
- Modify: `src/ui/i18n.ts` (1 key × 2 languages)
- Modify: `src/ui/playApp.test.ts` (amend the existing test at lines 141-152 + add the stepper test)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: existing keys `howto1..4`, `howtoTitle`, `howtoStart`, `help`; closure `showHelp`.
- Produces: DOM contract — first open shows exactly one `.howto-line` and a `.howto-next` button; step 4 shows `.howto-start`; "?" reopen (`.help-btn`) shows all four `.howto-line`s.

- [ ] **Step 1: Write/adjust the failing tests**

Add to `src/ui/playApp.test.ts`:

```ts
  it("the how-to opens as a stepper: one line per step, Start on the last, '?' shows the full card", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const lines = () => root.querySelectorAll(".howto-line").length;
    expect(lines()).toBe(1); // step 1 of 4, not the wall of text
    for (let step = 0; step < 3; step++) {
      const next = root.querySelector(".howto-next") as HTMLButtonElement;
      expect(next).not.toBeNull();
      next.click();
      expect(lines()).toBe(1);
    }
    expect(root.querySelector(".howto-next")).toBeNull(); // last step: Start replaces Next
    (root.querySelector(".howto-start") as HTMLButtonElement).click();
    expect(root.querySelector(".howto")).toBeNull();
    (root.querySelector(".help-btn") as HTMLButtonElement).click(); // reopen = reference mode
    expect(lines()).toBe(4);
  });
```

AMEND the existing test at lines 141-152 ("opens with a how-to-rule card that dismisses…"): it clicks `.howto-start` on first open, which no longer exists there. Change its dismissal to walk the stepper — replace the single `.howto-start` click with:

```ts
    for (let step = 0; step < 3; step++) (root.querySelector(".howto-next") as HTMLButtonElement).click();
    (root.querySelector(".howto-start") as HTMLButtonElement).click();
```

(Its `/500/` assertion stays valid: step 1 renders `howto1`, which states the 500-year goal.)

- [ ] **Step 2: Run to verify the new test fails**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: new test FAILS (`lines()` is 4 on first open); the amended test PASSES only after implementation — both red now is fine.

- [ ] **Step 3: Implement**

3a. State — next to `let showHelp = true;` (playApp.ts:115):

```ts
    let howtoMode: "steps" | "full" = "steps"; // first open walks one line at a time; "?" shows all
    let howtoStep = 0;
```

3b. Replace the body of `renderHowto` (lines 354-368) with:

```ts
    function renderHowto(): void {
      howtoBox.innerHTML = "";
      if (!showHelp || over) return;
      const card = document.createElement("div");
      card.className = "howto controls";
      const keys = ["howto1", "howto2", "howto3", "howto4"];
      const shown = howtoMode === "full" ? keys : [keys[howtoStep]];
      const lines = shown.map((k) => `<div class="howto-line">${playT(lang, k)}</div>`).join("");
      card.innerHTML = `<b>${playT(lang, "howtoTitle")}</b>${lines}`;
      if (howtoMode === "steps" && howtoStep < keys.length - 1) {
        const next = document.createElement("button");
        next.className = "howto-next";
        next.textContent = playT(lang, "howtoNext")
          .replace("{i}", String(howtoStep + 1)).replace("{n}", String(keys.length));
        next.addEventListener("click", () => { howtoStep++; renderHowto(); });
        card.appendChild(next);
      } else {
        const start = document.createElement("button");
        start.className = "howto-start";
        start.textContent = playT(lang, "howtoStart");
        start.addEventListener("click", () => { showHelp = false; renderHowto(); });
        card.appendChild(start);
      }
      howtoBox.appendChild(card);
    }
```

3c. `helpBtn` handler (line 583): `() => { showHelp = true; renderHowto(); }` → `() => { showHelp = true; howtoMode = "full"; renderHowto(); }`.

3d. i18n — `PLAY_UI.en`: `howtoNext: "Next ({i}/{n})",` · `PLAY_UI.ko`: `howtoNext: "다음 ({i}/{n})",` (place next to `howtoStart`).

- [ ] **Step 4: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 497 + 1 = 498; tsc clean; the amended test at :141 green again.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/ui/playApp.test.ts
git commit -m "feat(ux): how-to becomes a 4-step stepper; '?' shows the full card"
```

---

### Task 5: Daily framing copy

**Files:**
- Modify: `src/landing.ts` (renderChooser template)
- Modify: `src/ui/playApp.ts` (daily badge in `renderPicker`)
- Modify: `src/ui/i18n.ts` (1 key × 2 languages)
- Modify: `src/theme.css`
- Test: `src/landing.test.ts`, `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: existing `.landing-daily` block in `landing.ts`; existing `.daily-badge` creation in `renderPicker` (playApp.ts, guarded by `seed === hashStringToSeed(dailyName(new Date()))`).
- Produces: DOM contract — `.landing-daily-sub` paragraph on the landing; `.daily-badge` has a non-empty `title`.

- [ ] **Step 1: Write the failing tests**

Append to `src/landing.test.ts`:

```ts
describe("daily framing copy", () => {
  it("explains the shared-world promise under the daily button", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const sub = root.querySelector(".landing-daily-sub");
    expect(sub).not.toBeNull();
    expect(sub!.textContent).toContain("UTC");
  });
});
```

In `src/ui/playApp.test.ts`, EXTEND the existing daily-badge test ("the picker shows the daily badge exactly when the seed is today's daily") — after the `expect(root.querySelector(".app-title .daily-badge")).not.toBeNull();` line add:

```ts
    expect((root.querySelector(".daily-badge") as HTMLElement).title.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/landing.test.ts src/ui/playApp.test.ts`
Expected: both FAIL (no `.landing-daily-sub`; empty badge title).

- [ ] **Step 3: Implement**

3a. `src/landing.ts` — inside the `.landing-daily` div in the template, after the button line:

```html
      <p class="landing-daily-sub">매일 자정(UTC) 새로운 세계 — 모두가 오늘 같은 세계에 도전합니다 · One shared world each day</p>
```

3b. `src/ui/playApp.ts` — in `renderPicker`'s daily-badge block, after `tag.textContent = playT(lang, "dailyBadge");` add:

```ts
      tag.title = playT(lang, "dailyTip");
```

3c. i18n — `PLAY_UI.en`: `dailyTip: "Everyone shares this world today — its annals are today's hall of fame.",` · `PLAY_UI.ko`: `dailyTip: "오늘 하루 모두에게 같은 세계 — 이 세계의 연대기가 오늘의 명예의 전당입니다.",` (place next to `dailyBadge`).

3d. `src/theme.css`:

```css
.landing-daily-sub { margin: 6px 0 0; font-size: 0.85em; opacity: 0.75; }
```

- [ ] **Step 4: Full suite + typecheck + build**

Run: `npx vitest run` then `npm run build`
Expected: 498 + 1 = 499 (the badge-title assertion extends an existing test, no new count; the landing test adds 1); build clean.

- [ ] **Step 5: Commit**

```bash
git add src/landing.ts src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/landing.test.ts src/ui/playApp.test.ts
git commit -m "feat(ux): daily-world framing copy — landing sub-line + badge tooltip"
```

---

## Post-plan verification (session lead, not a task)

- Full suite + `npm run build` from the worktree root.
- Live check (browser tools; screenshots broken in this harness — DOM via JS eval): landing sub-line; picker minimap paints and hover flips a nation to magenta; goals chips with tooltips; stepper walks 1→4; `wm:lang` persists a toggle across a reload; daily badge tooltip. Layout/legibility (minimap size, chip wrap) needs the user's eyes at localhost:5173.
- Whole-branch review before merge (cross-task seams: Tasks 2/3/4 all edit `playApp.ts`; Task 1's lang init vs every test's EN assumption).
