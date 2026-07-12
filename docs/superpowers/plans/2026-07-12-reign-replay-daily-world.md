# Reign Replay + Daily World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Game-over gains a scrub-able territory replay of the whole reign on the main play map, and the landing page gains a one-click UTC daily seed whose per-seed legacy annals double as today's hall of fame.

**Architecture:** Replay is a read-only assembly of parts that already exist — `stepSim` records `s.snapshots` every tick (play mode never read it), `createTimeline` is Version A's ▶/slider control, `politicalLayer` paints any owner array. Play mode keeps a `replayIndex` (null = live) and feeds `s.snapshots[replayIndex].owner` to the political layer; the timeline mounts in the bottom command bar that `end()` empties. Daily world is a pure `daily-YYYY-MM-DD` (UTC) string seed routed through the existing `parseSeedValue`/`hashStringToSeed` path.

**Tech Stack:** TypeScript, Vite MPA, vitest (+jsdom for UI tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-reign-replay-daily-world-design.md`

## Global Constraints

- Run all test commands from the WORKTREE root (the main repo root globs worktree copies and inflates counts).
- `npm run build` runs `tsc --noEmit` with **noUnusedLocals on** — an unused import is a build failure.
- The pure-history path (Version A) must stay byte-identical: golden FNV hash tests in `world.test.ts` / `history.test.ts` must pass untouched. Replay reads existing state only; daily is only a seed string. Touch NO rng draws.
- The "verbatim advance handler" guard in `playApp.ts` (marker comment) must not be edited. `end()` and `renderMap()` are outside the guarded region and are fair game.
- Every user-facing string gets BOTH `ko` and `en` entries in `PLAY_UI` (src/ui/i18n.ts). Landing copy is bilingual-inline (no i18n framework there).
- Baseline before Task 1: 477 tests passing (`npx vitest run`).
- Commit after every task; message style `feat(play): …` matching git log.

---

### Task 1: Timeline accepts any snapshots source + injectable year formatter

`createTimeline` currently demands Version A's `History` and hard-codes `` `${year}년` ``. Loosen the parameter to a structural type so play mode's `SimState` passes directly, and inject the year formatter so EN reigns don't read `년`. Version A call sites compile and behave unchanged.

**Files:**
- Modify: `src/ui/timeline.ts`
- Test: `src/ui/timeline.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 relies on these exact signatures):
  - `export interface TimelineSource { snapshots: { year: number }[] }`
  - `export function createTimeline(history: TimelineSource, onIndex: (i: number) => void, formatYear?: (y: number) => string): Timeline` — `formatYear` defaults to `` (y) => `${y}년` ``.
  - `Timeline` (already exported): `{ element: HTMLElement; setIndex(i: number): void; destroy(): void }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/timeline.test.ts` (inside the existing `describe("createTimeline", …)` block, which already sets up fake timers):

```ts
  it("formats the year through the injected formatter", () => {
    const t = createTimeline(fakeHistory(3), () => {}, (y) => `Year ${y}`);
    const slider = t.element.querySelector("input") as HTMLInputElement;
    slider.value = "2";
    slider.dispatchEvent(new Event("input"));
    expect((t.element.querySelector(".timeline-year") as HTMLElement).textContent).toBe("Year 20");
  });

  it("accepts a bare snapshots object (the SimState shape)", () => {
    const t = createTimeline({ snapshots: [{ year: 0 }, { year: 10 }] }, () => {});
    expect((t.element.querySelector(".timeline-year") as HTMLElement).textContent).toBe("0년");
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/ui/timeline.test.ts`
Expected: the formatter test FAILS (extra argument / `Year 20` vs `20년`); the bare-object test fails to typecheck at runtime only if TS blocks — vitest transpiles loosely, so it may pass; the formatter test is the true red.

- [ ] **Step 3: Implement**

In `src/ui/timeline.ts`:

Replace line 1 (`import type { History } from "../engine/history";` — now unused, noUnusedLocals would fail the build) and the signature/readout:

```ts
// Structural source type: Version A's History and play mode's SimState both satisfy it.
export interface TimelineSource {
  snapshots: { year: number }[];
}
```

```ts
export function createTimeline(
  history: TimelineSource,
  onIndex: (i: number) => void,
  formatYear: (y: number) => string = (y) => `${y}년`,
): Timeline {
```

```ts
  const readout = (i: number) => { year.textContent = formatYear(history.snapshots[i].year); };
```

Everything else in the file is unchanged.

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 477 + 2 = 479 passing; tsc clean (Version A's `createTimeline(history, …)` call in `src/ui/app.ts` still typechecks — `History` is structurally a `TimelineSource`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/timeline.ts src/ui/timeline.test.ts
git commit -m "feat(play): timeline takes any snapshots source + injectable year formatter"
```

---

### Task 2: Reign replay — game-over territory timeline on the main map

When the reign ends, the bottom command bar (emptied today by `end()`) hosts a replay bar (label + ▶ + slider + year). Scrubbing repaints the big map from `s.snapshots[i].owner`. The game-over map becomes a clean "historical atlas": ALL live overlays (front lines, sea lanes, ⛵/⚓ targets, clickable attack/city cells, founded-city stars, capital crown) are skipped once `over` is true — they read the live `s` and would be anachronistic and clickable on historical frames.

**Files:**
- Modify: `src/ui/playApp.ts` (state near line 105, `renderMap` at ~184, `renderBanner`/`end`/`rerender` at ~736–803)
- Modify: `src/ui/i18n.ts` (two `PLAY_UI` entries)
- Modify: `src/theme.css` (replay-bar layout)
- Test: `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes (from Task 1): `createTimeline(source, onIndex, formatYear)` and `type Timeline` from `./timeline`.
- Produces: DOM contract for tests — `.play-actions .replay-bar` (the timeline element, containing `.replay-title`, `button.timeline-play`, `input.timeline-slider`, `.timeline-year`); after game over `.attack-targets` and `.front` are absent.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/playApp.test.ts` (top-level `describe` style matches the file; reuse the existing "advance until banner" loop pattern; add `vi` to the vitest import if absent, plus `hashStringToSeed`/`dailyName` are NOT needed here — that's Task 3):

```ts
  function runToGameOver(root: HTMLElement): void {
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break; // end() replaced the command bar
      adv.click();
    }
  }

  it("game over mounts a replay bar; frame 0 differs from the present, the last frame IS the present", () => {
    const root = document.createElement("div");
    runToGameOver(root);
    const bar = root.querySelector(".play-actions .replay-bar");
    expect(bar).not.toBeNull();
    const slot = () => (root.querySelector(".political-slot") as SVGGElement).innerHTML;
    const live = slot();
    const slider = bar!.querySelector("input.timeline-slider") as HTMLInputElement;
    const max = Number(slider.max);
    expect(max).toBeGreaterThan(0); // one snapshot per tick, so a real reign has many frames
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(slot()).not.toBe(live); // territory moved over the reign
    slider.value = String(max);
    slider.dispatchEvent(new Event("input"));
    expect(slot()).toBe(live); // scrubbing to the end lands on the present
  });

  it("the game-over map is a clean atlas: live overlays are gone", () => {
    const root = document.createElement("div");
    runToGameOver(root);
    expect(root.querySelector(".attack-targets")).toBeNull();
    expect(root.querySelector(".front")).toBeNull();
  });

  it("play-again mid-replay stops the replay timer", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      runToGameOver(root);
      (root.querySelector(".replay-bar .timeline-play") as HTMLButtonElement).click(); // ▶
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      (root.querySelector(".btn-play-again") as HTMLButtonElement).click();
      expect(vi.getTimerCount()).toBe(0); // destroy() ran; nothing paints the dead DOM
      expect(root.querySelector(".nation-choice")).not.toBeNull(); // picker is back
    } finally {
      vi.useRealTimers();
    }
  });
```

Note for the implementer: `vi.getTimerCount()` assumes playApp itself schedules no other timers — it doesn't today. If that assertion flakes, capture the count before ▶ and assert it returns to that baseline.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: all three FAIL (no `.replay-bar`; `.attack-targets` still present after game over).

- [ ] **Step 3: Implement in `src/ui/playApp.ts`**

3a. Import (top of file, alongside the other `./` imports):

```ts
import { createTimeline, type Timeline } from "./timeline";
```

3b. State — in `startGame`, next to `let over = false;` (~line 103):

```ts
let replayIndex: number | null = null; // non-null: the map shows s.snapshots[replayIndex]
let replayBar: Timeline | null = null;
```

3c. `renderMap` — two changes. First, paint from the selected frame:

```ts
      const owner = replayIndex !== null ? s.snapshots[replayIndex].owner : s.owner;
      slot.replaceChildren(politicalLayer(world.grid, owner, s.polities, { fills: true, labels: true, legend: false, playerPolity: s.playerPolity, playerColor: PLAYER_COLOR }));
```

(Old snapshots may name since-dead polities; `s.polities` never shrinks, so color/name lookups stay valid.)

Second, wrap the ENTIRE overlay block — from `const NS = …`/`const g = document.createElementNS(NS, "g")` down through `slot.parentNode!.insertBefore(g, slot.nextSibling);` (front lines, sea lanes, ⛵ targets, `.attack-targets` group, found-city sites, invest/peace previews, founded-city stars, capital crown) — in:

```ts
      if (!over) {
        // …existing overlay code, unchanged…
      }
```

The trailing `mapFrame.appendChild(svg); deconflictLabels(svg);` stay outside the guard.

3d. Replay bar — add this function next to `renderBanner`:

```ts
    // DF-legends payoff: scrub the reign's territorial history on the big map. Lives in the
    // command bar that end() vacates; rebuilt (not patched) on language toggle.
    function renderReplayBar(): void {
      replayBar?.destroy();
      actions.innerHTML = "";
      const bar = createTimeline(
        { snapshots: s.snapshots },
        (i) => { replayIndex = i; renderMap(); },
        (y) => playYear(lang, y),
      );
      bar.element.classList.add("replay-bar");
      const label = document.createElement("span");
      label.className = "replay-title";
      label.textContent = playT(lang, "replayTitle");
      bar.element.prepend(label);
      actions.appendChild(bar.element);
      replayBar = bar;
      if (replayIndex !== null) bar.setIndex(replayIndex); // language toggle keeps the frame
    }
```

3e. `end()` — replace `actions.innerHTML = "";` with:

```ts
      renderMap(); // drop the live overlays: the war is over, the atlas remains
      renderReplayBar();
```

(`renderReplayBar` clears `actions` itself. `end()` is outside the verbatim-advance-handler guard.)

3f. Teardown — in `renderBanner`, the two restart buttons:

```ts
      again.addEventListener("click", () => { replayBar?.destroy(); renderPicker(); });
```

and inside the new-world handler, before `location.hash = …`:

```ts
        replayBar?.destroy();
```

3g. Language toggle — `rerender()` becomes:

```ts
    function rerender(): void {
      if (over) { renderMap(); renderPanel(); renderBanner(); renderReplayBar(); } else renderAll();
    }
```

3h. i18n — add to `PLAY_UI.en`: `replayTitle: "⏪ Reign replay",` and to `PLAY_UI.ko`: `replayTitle: "⏪ 치세 리플레이",` (near `reignExport`/`playAgain` in each table).

3i. CSS — in `src/theme.css`, near the existing `.play-actions` rules:

```css
.play-actions .replay-bar { display: flex; align-items: center; gap: 10px; width: 100%; }
.play-actions .replay-bar .timeline-slider { flex: 1; min-width: 0; }
.replay-title { font-weight: 600; white-space: nowrap; }
```

(The base `.timeline` styles from Version A already exist; verify the bar reads fine inside the dark command bar and adjust colors only if illegible.)

- [ ] **Step 4: Run the suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: 479 + 3 = 482 passing, tsc clean. If any EXISTING test fails, read it before touching it — the only sanctioned behavior change is "no live overlays after game over"; a test asserting overlays post-game-over would need its intent re-checked (none is known to exist).

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): reign replay — game-over territory timeline on the main map"
```

---

### Task 3: Daily world — shared UTC seed from the landing + picker badge

One button on the landing routes to `play.html#seed=daily-YYYY-MM-DD` (UTC). `parseSeedValue` already hashes string seeds, and `wm:legacy:<seed>` already keys annals per seed — so the daily hall of fame costs zero extra code. The nation picker shows a 🗓 badge exactly when the current seed IS today's daily.

**Files:**
- Create: `src/ui/daily.ts`
- Create: `src/ui/daily.test.ts`
- Modify: `src/landing.ts` (chooser HTML + one listener)
- Modify: `src/ui/playApp.ts` (`renderPicker`, ~line 51)
- Modify: `src/ui/i18n.ts` (two `PLAY_UI` entries)
- Modify: `src/theme.css`
- Test: `src/landing.test.ts`, `src/ui/playApp.test.ts`

**Interfaces:**
- Consumes: `hashStringToSeed(s: string): number` from `src/engine/rng` (existing); `playT` (existing).
- Produces:
  - `export function dailyName(d: Date): string` → `"daily-2026-07-12"` (UTC date).
  - `export function dailyTarget(d: Date): string` → `"play.html#seed=daily-2026-07-12"`.
  - DOM: landing `button.name-daily`; picker `span.daily-badge` inside the `h1.app-title`.

`daily.ts` is a NEW shared module (not in `landing.ts`) because `landing.ts` runs DOM side effects at module scope — playApp must not import that.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/daily.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dailyName, dailyTarget } from "./daily";

describe("dailyName", () => {
  it("keys on the UTC date — the same instant is one world everywhere", () => {
    expect(dailyName(new Date(Date.UTC(2026, 6, 12, 23, 30)))).toBe("daily-2026-07-12");
    expect(dailyName(new Date(Date.UTC(2026, 6, 13, 0, 30)))).toBe("daily-2026-07-13");
  });
});

describe("dailyTarget", () => {
  it("routes to play with the readable daily name in the URL", () => {
    expect(dailyTarget(new Date(Date.UTC(2026, 6, 12)))).toBe("play.html#seed=daily-2026-07-12");
  });
});
```

Append to `src/landing.test.ts`:

```ts
describe("renderChooser daily button", () => {
  it("renders the daily button carrying today's UTC date", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const btn = root.querySelector(".name-daily") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain(new Date().toISOString().slice(0, 10));
  });
});
```

Append to `src/ui/playApp.test.ts` (imports needed: `hashStringToSeed` from `../engine/rng`, `dailyName` from `./daily`):

```ts
  it("the picker shows the daily badge exactly when the seed is today's daily", () => {
    const root = document.createElement("div");
    createPlayApp(root, hashStringToSeed(dailyName(new Date())));
    expect(root.querySelector(".app-title .daily-badge")).not.toBeNull();
    const other = document.createElement("div");
    createPlayApp(other, 1);
    expect(other.querySelector(".daily-badge")).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/daily.test.ts src/landing.test.ts src/ui/playApp.test.ts`
Expected: daily.test fails to resolve the module; landing test FAILS (no `.name-daily`); playApp test FAILS (no badge).

- [ ] **Step 3: Implement**

3a. Create `src/ui/daily.ts`:

```ts
// The daily world — one shared seed per UTC day (the Spelunky Daily pact). Everyone who clicks
// today gets the same world, so the per-seed legacy annals double as today's hall of fame.
export function dailyName(d: Date): string {
  return `daily-${d.toISOString().slice(0, 10)}`;
}

export function dailyTarget(d: Date): string {
  return `play.html#seed=${dailyName(d)}`;
}
```

3b. `src/landing.ts` — import at top:

```ts
import { dailyName, dailyTarget } from "./ui/daily";
```

In `renderChooser`, insert after the closing `</div>` of `.landing-name` (still inside the template literal):

```html
    <div class="landing-daily">
      <button class="name-daily">🗓 오늘의 세계 · Daily World — ${dailyName(new Date()).slice(6)}</button>
    </div>
```

(`slice(6)` strips the `daily-` prefix → the bare date.) And with the other listeners:

```ts
  (root.querySelector(".name-daily") as HTMLButtonElement).addEventListener("click", () => location.assign(dailyTarget(new Date())));
```

3c. `src/ui/playApp.ts` — imports:

```ts
import { hashStringToSeed } from "../engine/rng";
import { dailyName } from "./daily";
```

In `renderPicker`, right after `title.textContent = playT(lang, "chooseRealm");`:

```ts
    if (seed === hashStringToSeed(dailyName(new Date()))) {
      const tag = document.createElement("span");
      tag.className = "daily-badge";
      tag.textContent = playT(lang, "dailyBadge");
      title.appendChild(tag);
    }
```

(Yesterday's daily URL opened today shows no badge — correct: it is no longer *the* daily.)

3d. i18n — `PLAY_UI.en`: `dailyBadge: "🗓 Daily World",` · `PLAY_UI.ko`: `dailyBadge: "🗓 오늘의 세계",`.

3e. `src/theme.css`:

```css
.landing-daily { margin-top: 10px; text-align: center; }
.name-daily { padding: 8px 18px; cursor: pointer; }
.daily-badge { font-size: 0.5em; vertical-align: middle; margin-left: 10px; padding: 3px 8px; border-radius: 10px; background: rgba(168, 132, 44, 0.18); white-space: nowrap; }
```

(Match the neighboring `.name-play`/`.landing-name` button styling — copy their font/border/background declarations if the bare rules above look out of place.)

- [ ] **Step 4: Run the suite + typecheck + build**

Run: `npx vitest run` then `npm run build`
Expected: 482 + 4 = 486 passing; build clean (this task adds a module — build catches unused-import slips across all three touched files).

- [ ] **Step 5: Commit**

```bash
git add src/ui/daily.ts src/ui/daily.test.ts src/landing.ts src/landing.test.ts src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): daily world — shared UTC daily seed from the landing, picker badge"
```

---

## Post-plan verification (session lead, not a task)

- Full suite from the worktree root + `npm run build`.
- Live check via dev server (browser tools; screenshots are broken in this harness — verify DOM/computed styles via JS eval): game over → replay bar present, scrub repaints, ▶ animates, language toggle keeps the frame; landing shows the daily button with today's UTC date; daily URL's picker shows the 🗓 badge. Layout/legibility of the replay bar inside the command bar needs the user's eyes at localhost:5173.
- Whole-branch review before merge (cross-task seams: Task 2's `renderMap` guard vs Task 3's picker edit both touch `playApp.ts`).
