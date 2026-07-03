# App Separation (Version A / Version B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single-page app into a Vite multi-page layout — a landing chooser at `/`, Version A (map tool) at `map.html` (moved verbatim), and a Version B stub at `play.html` — with the engine shared and A's seed-share URLs preserved.

**Architecture:** Vite MPA with three HTML entries (`index.html` landing, `map.html` for A, `play.html` for B stub). A shared `src/theme.css` holds the parchment theme. `src/main.ts`/`app.ts`/engine are untouched except a single CSS import in `main.ts`. The landing forwards legacy `/#<blob>` seed URLs to `map.html#<blob>`.

**Tech Stack:** TypeScript, Vite (multi-page), Vitest (jsdom).

## Global Constraints

- **Version A stays visually and behaviorally identical** — only its host HTML moves to `map.html`, and `src/main.ts` gains one line (`import "./theme.css";`). `src/ui/app.ts`, `src/ui/urlState.ts`, and everything under `src/engine/**` are untouched.
- **Seed-URL preservation:** new shares on `map.html` are `map.html#<blob>` automatically (`app.ts` mutates only `location.hash`). Legacy `/#<blob>` links must be forwarded to `map.html#<blob>` by the landing.
- **Redirect decision must be a pure, unit-testable helper** (`redirectTarget(hash): string | null`) separate from the `location` side-effect.
- The shared theme is imported via `import "./theme.css";` in each TS entry (`main.ts`, `landing.ts`, `playMain.ts`) — not duplicated inline.
- Build must emit `dist/index.html`, `dist/map.html`, `dist/play.html`.
- Run tests with `npm test`. Build with `npm run build`.

---

### Task 1: Shared theme + MPA config + move Version A to `map.html`

Extract the inline styles to `src/theme.css`, register the three MPA entries in Vite, create `map.html` with A's body, and make `index.html` a temporary redirect-to-map placeholder (the real chooser lands in Task 2). After this task, A works at `/map.html` and the build emits all three pages.

**Files:**
- Create: `src/theme.css`, `map.html`, `play.html` (minimal placeholder body so the build input resolves)
- Modify: `index.html` (body → temporary redirect placeholder), `src/main.ts` (add theme import), `vite.config.ts` (MPA inputs)
- Test: none new this task (verified by build + existing suite)

**Interfaces:**
- Produces: `src/theme.css` (all app styles), `map.html` (hosts `src/main.ts`), `play.html` (placeholder, replaced in Task 3), Vite MPA inputs `main`/`map`/`play`.

- [ ] **Step 1: Create `src/theme.css` from the current inline styles**

Create `src/theme.css` with the exact contents of the current `<style>` block in `index.html` (the CSS rules only, without the `<style>` tags). Copy every rule verbatim: `body`, `.app-title`, `#app`, `.controls`, `button, input`, `button:hover`, `input[type=number]`, `.stage`, `.stage svg`, `.stage svg.city`, `.timeline`, `.timeline-slider`, `.timeline-year`, `.political .territory`, `.nation-label`, `.city-label`, `.region-label`, `.world-name-text`, `.chronicle`, `.chronicle h3`, `.chronicle-list`, `.chronicle-era`, `.chronicle-event`, `.chronicle-event.future`, `.chronicle-event.evt-conquer`, `.chronicle-event.evt-civilwar`, `.chronicle-event.evt-independence`, `.chronicle-event.evt-goldenage`, `.chronicle-event.evt-staple`, `.view-toggle`, `.view-toggle button`, `.view-toggle button:first-child`, `.view-toggle button:last-child`, `.view-toggle button:not(:first-child)`, `.culture-label`, `.view-toggle button.active`.

Then append the landing/stub styles (used by Tasks 2–3):

```css
.landing {
  max-width: 720px; margin: 0 auto; padding: 24px 16px 40px;
  display: flex; gap: 20px; flex-wrap: wrap; justify-content: center;
}
.choice-card {
  display: block; flex: 1 1 260px; max-width: 320px; text-decoration: none;
  background: #f6efdd; border: 1px solid #cbb784; border-radius: 8px;
  padding: 22px 20px; color: #2a2118; box-shadow: 0 1px 4px rgba(60,47,28,.15);
  transition: background .12s, box-shadow .12s;
}
.choice-card:hover { background: #efe6cf; box-shadow: 0 2px 8px rgba(60,47,28,.22); }
.choice-title { font-family: 'Cinzel', serif; font-weight: 600; font-size: 20px; margin: 0 0 8px; color: #3c2f1c; }
.choice-desc { font-size: 14px; line-height: 1.5; margin: 0; }
.stub { max-width: 720px; margin: 0 auto; padding: 40px 16px; text-align: center; }
.stub p { font-size: 15px; }
.home-link { display: inline-block; margin-top: 16px; color: #7a5a2f; }
```

- [ ] **Step 2: Create `map.html` with Version A's body**

Create `map.html` — the same `<head>` as the current `index.html` (fonts + title) but with the styles now coming from the JS import, and A's body verbatim:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>WorldMaker — 세계 지도</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <h1 class="app-title">WorldMaker</h1>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Add the theme import to `src/main.ts`**

Modify `src/main.ts` to import the shared stylesheet (first line):

```ts
import "./theme.css";
import { createApp } from "./ui/app";
import { initialParams } from "./ui/urlState";

const root = document.getElementById("app");
if (root) createApp(root, initialParams(location.hash));
```

- [ ] **Step 4: Create a minimal `play.html` placeholder**

Create `play.html` (Task 3 fills the real stub UI; this makes the Vite input resolve now):

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>WorldMaker — 제국</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="play"></div>
    <script type="module" src="/src/playMain.ts"></script>
  </body>
</html>
```

Create a minimal `src/playMain.ts` so the script resolves (Task 3 replaces its body):

```ts
import "./theme.css";

const root = document.getElementById("play");
if (root) root.innerHTML = `<div class="stub"><p>제국 시뮬레이션 (준비 중)</p></div>`;
```

- [ ] **Step 5: Replace `index.html` body with a temporary redirect placeholder**

Overwrite `index.html` (Task 2 replaces this with the real chooser). For now it forwards to the map so the app still works end-to-end after Task 1:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>WorldMaker</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="landing"></div>
    <script type="module" src="/src/landing.ts"></script>
  </body>
</html>
```

Create a minimal `src/landing.ts` so the script resolves (Task 2 replaces its body):

```ts
import "./theme.css";

const root = document.getElementById("landing");
if (root) location.replace("map.html" + location.hash);
```

- [ ] **Step 6: Register the three MPA entries in `vite.config.ts`**

Overwrite `vite.config.ts`. Use root-relative paths for the inputs (the project's
`package.json` is `"type": "module"`, so `__dirname` is undefined in this ESM config —
avoid it; Rollup resolves these strings relative to `root`):

```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        map: "map.html",
        play: "play.html",
      },
    },
  },
});
```

- [ ] **Step 7: Build and run the suite**

Run: `npm run build`
Expected: build succeeds; `dist/index.html`, `dist/map.html`, `dist/play.html` all emitted.

Run: `npm test`
Expected: the existing suite passes unchanged (A logic + engine untouched).

Verify the emitted pages:

Run: `ls dist/*.html`
Expected: lists `dist/index.html`, `dist/map.html`, `dist/play.html`.

- [ ] **Step 8: Commit**

```bash
git add src/theme.css map.html play.html index.html src/main.ts src/playMain.ts src/landing.ts vite.config.ts
git commit -m "refactor: Vite MPA — extract theme.css, move Version A to map.html, add play.html stub"
```

---

### Task 2: Landing chooser + legacy seed-URL redirect

Replace the temporary `landing.ts` with the real chooser: forward param-shaped hashes to the map, otherwise render two choice cards. The redirect decision is a pure helper so it can be unit-tested.

**Files:**
- Modify: `src/landing.ts` (real implementation)
- Test: `src/landing.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks (self-contained; validates the hash inline).
- Produces: `redirectTarget(hash: string): string | null` (pure), `renderChooser(root: HTMLElement): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/landing.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { redirectTarget, renderChooser } from "./landing";

describe("redirectTarget", () => {
  it("forwards a param-shaped seed hash to map.html", () => {
    const blob = "#" + btoa(JSON.stringify({
      seed: 42, width: 1000, height: 700, cellCount: 4000,
      seaLevel: 0.3, mountainLevel: 0.55, polityCount: 8, townCount: 20,
    }));
    expect(redirectTarget(blob)).toBe("map.html" + blob);
  });
  it("returns null for an empty hash (show the chooser)", () => {
    expect(redirectTarget("")).toBeNull();
    expect(redirectTarget("#")).toBeNull();
  });
  it("returns null for a non-param hash", () => {
    expect(redirectTarget("#not-a-seed")).toBeNull();
  });
});

describe("renderChooser", () => {
  it("renders two choice cards linking to map.html and play.html", () => {
    const root = document.createElement("div");
    renderChooser(root);
    const hrefs = Array.from(root.querySelectorAll("a.choice-card")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("map.html");
    expect(hrefs).toContain("play.html");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- landing`
Expected: FAIL (`redirectTarget`/`renderChooser` are not exported).

- [ ] **Step 3: Implement `src/landing.ts`**

Overwrite `src/landing.ts`:

```ts
import "./theme.css";

// A share URL is a hash whose base64 payload is JSON carrying a finite numeric `seed`
// (the shape `urlState.encodeParams` produces). Anything else (empty, non-base64, or JSON
// without a seed) is not a seed link → show the chooser instead of forwarding.
export function redirectTarget(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  if (raw.length === 0) return null;
  try {
    const parsed = JSON.parse(atob(raw)) as { seed?: unknown };
    if (parsed && typeof parsed.seed === "number" && Number.isFinite(parsed.seed)) {
      return "map.html#" + raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function renderChooser(root: HTMLElement): void {
  root.innerHTML = `
    <h1 class="app-title">WorldMaker</h1>
    <div class="landing">
      <a class="choice-card" href="map.html">
        <div class="choice-title">🗺 세계 지도 만들기</div>
        <p class="choice-desc">랜덤 판타지 세계를 생성하고 지도·도시·역사·가제티어를 탐험합니다.</p>
      </a>
      <a class="choice-card" href="play.html">
        <div class="choice-title">🏛 제국 플레이</div>
        <p class="choice-desc">한 나라의 군주가 되어 연도를 진행하며 제국의 운명을 이끕니다.</p>
      </a>
    </div>`;
}

const root = document.getElementById("landing");
if (root) {
  const target = redirectTarget(location.hash);
  if (target) location.replace(target);
  else renderChooser(root);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- landing`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: all pass, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/landing.ts src/landing.test.ts
git commit -m "feat: landing chooser (Version A / Version B) with legacy seed-URL redirect"
```

---

### Task 3: Version B stub page

Flesh out the `play.html` stub into a proper themed placeholder with a home link, and add a mount test. This is the seam Version B sub-projects 2–3 build on.

**Files:**
- Modify: `src/playMain.ts` (real stub render)
- Test: `src/playMain.test.ts` (new)

**Interfaces:**
- Produces: `renderStub(root: HTMLElement): void`.

- [ ] **Step 1: Write the failing test**

Create `src/playMain.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderStub } from "./playMain";

describe("renderStub", () => {
  it("renders the coming-soon placeholder and a home link", () => {
    const root = document.createElement("div");
    renderStub(root);
    expect(root.textContent).toContain("제국");
    const home = root.querySelector("a.home-link");
    expect(home?.getAttribute("href")).toBe("index.html");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- playMain`
Expected: FAIL (`renderStub` is not exported).

- [ ] **Step 3: Implement `src/playMain.ts`**

Overwrite `src/playMain.ts`:

```ts
import "./theme.css";

export function renderStub(root: HTMLElement): void {
  root.innerHTML = `
    <h1 class="app-title">제국 시뮬레이션</h1>
    <div class="stub">
      <p>준비 중입니다 — 한 나라의 군주가 되어 연도를 진행하고 제국을 이끄는 모드입니다.</p>
      <a class="home-link" href="index.html">← 홈으로</a>
    </div>`;
}

const root = document.getElementById("play");
if (root) renderStub(root);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- playMain`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: all pass; `dist/index.html`, `dist/map.html`, `dist/play.html` emitted.

- [ ] **Step 6: Commit**

```bash
git add src/playMain.ts src/playMain.test.ts
git commit -m "feat: Version B stub page (play.html) with home link"
```

---

## Verification (after all tasks)

- `npm test` — full suite green (existing + landing + playMain tests).
- `npm run build` — clean; `dist/` has `index.html`, `map.html`, `play.html`.
- Manual (dev server): `/` shows the two-card chooser; `/#<blob>` forwards to `map.html#<blob>`;
  `map.html` is the full Version A app (seed share still works, producing `map.html#<blob>`);
  `play.html` shows the B stub with a working home link. (Screenshot tool times out — DOM/
  build verification substitutes; final look needs the user's eyes at localhost.)
- Update `worldmaker-status.md` after merge: A/B separated (MPA); B stub is the seam for
  Version B sub-projects 2 (interventions) and 3 (play UI).
