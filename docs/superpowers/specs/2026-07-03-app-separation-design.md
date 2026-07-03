# App Separation: Version A (map tool) vs Version B (empire sim) — Design

Date: 2026-07-03

## Context

Everything so far is one single-page app (`index.html` → `src/main.ts` → `createApp`).
The user wants to separate the product into two:

- **Version A** — the random fantasy world-map generator (the mature, shipping tool: map
  generation, biomes, cities/drilldown, named geography/culture, rivers, read-only history
  chronicle + timeline, gazetteer export, shareable seed URLs).
- **Version B** — the interactive empire sim (HOI-lite, ruler of one nation), currently only a
  shared engine with no UI (Version B sub-projects 2–3 will build it).

Chosen separation level: **same repo, separate entry points** — the engine (`src/engine`) is
shared; A and B are distinct app entry points, with a start-screen chooser.

## Goal

Restructure the app into a Vite **multi-page** layout: a landing chooser at `/`, Version A at
`map.html` (moved verbatim, behavior unchanged), and a Version B stub at `play.html` (a
placeholder that sub-projects 2–3 will fill). Preserve A's shareable seed URLs.

## Non-goals

- Building Version B's actual sim UI (that is Version B sub-projects 2 and 3).
- Any change to `src/engine` or Version A's behavior/appearance (A must stay byte-identical,
  just served from a different HTML page).

## Architecture — Vite multi-page (MPA)

Three HTML entry points, one shared `src/engine`, one shared theme stylesheet.

### `index.html` — landing chooser

- A parchment-themed page (shared theme) with the app title and two choice cards:
  - **🗺 세계 지도 만들기 (Version A)** → navigates to `map.html`
  - **🏛 제국 플레이 (Version B)** → navigates to `play.html`
- Loads `src/landing.ts`.
- **Legacy seed-URL redirect shim:** on load, if `location.hash` decodes to valid world
  params (i.e. `decodeParams` yields params that round-trip — a seed-shaped hash), immediately
  `location.replace("map.html" + location.hash)`. This keeps old shared links (`/#<blob>`)
  landing on the map. If the hash is empty or not param-shaped, show the chooser.

### `map.html` — Version A (moved verbatim)

- The current `index.html` `<body>` content: `<h1 class="app-title">`, `<div id="app">`,
  and `<script type="module" src="/src/main.ts">`. Body unchanged.
- `src/main.ts` gains exactly one line — `import "./theme.css";` (so the extracted shared
  styles load; A's rendered result is identical). `src/ui/app.ts` and `src/ui/urlState.ts`
  are **unchanged**. Because `app.ts` sets `location.hash = …` (hash only, path preserved),
  new share URLs are automatically `map.html#<blob>`. No sharing-logic change needed.

### `play.html` + `src/playMain.ts` — Version B stub

- A minimal placeholder page (shared theme): title "제국 시뮬레이션", a "준비 중 (Version B —
  coming soon)" message, and a "← 홈" link back to `/`. `src/playMain.ts` mounts it into a
  `#play` root.
- This is the seam Version B sub-projects 2–3 build on (they replace the stub body with the
  real play-mode UI, reusing `initSim`/`stepSim` from `historySim.ts`).

### `src/theme.css` — shared parchment theme

- Extract the current `<style>` block (and the `body`/`.app-title`/`#app` base rules) from
  `index.html` into `src/theme.css`, imported by each TS entry (`import "./theme.css";` in
  `main.ts`, `landing.ts`, `playMain.ts`). All A-specific selectors (`.controls`, `.stage`,
  `.timeline`, `.chronicle`, `.view-toggle`, etc.) stay in the shared file — harmless to B,
  and keeps A visually identical. Add a small `.landing`/`.choice-card` block for the chooser.

### `vite.config.ts`

- Declare the three entries:
  ```ts
  import { defineConfig } from "vite";
  import { resolve } from "path";
  export default defineConfig({
    root: ".",
    build: {
      outDir: "dist",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          map: resolve(__dirname, "map.html"),
          play: resolve(__dirname, "play.html"),
        },
      },
    },
  });
  ```

## Seed-URL preservation (the one subtlety)

- **New shares** (generated on `map.html`) are `map.html#<blob>` automatically — `app.ts` only
  mutates the hash, so the path stays `map.html`. No change to `urlState.ts`/`app.ts`.
- **Legacy shares** (`/#<blob>`) are forwarded to `map.html#<blob>` by the landing redirect
  shim, so old links still open the map on the shared world.
- The chooser only shows when the hash is empty or not param-shaped.

## Testing

- `src/landing.test.ts` (jsdom): given a container and a param-shaped hash, `landing`'s
  redirect decision returns/redirects to `map.html#<blob>`; given an empty/garbage hash, it
  renders two choices (links to `map.html` and `play.html`). Split the redirect *decision*
  into a pure helper (e.g. `redirectTarget(hash): string | null`) so it is unit-testable
  without touching `location`.
- `src/playMain.test.ts` (jsdom): mounting the stub renders the placeholder + a home link.
- Existing suite: unchanged and green (A untouched; engine untouched).
- `npm run build`: succeeds and emits `dist/index.html`, `dist/map.html`, `dist/play.html`.

## File structure

- `index.html` — landing (was the A page; body replaced with the chooser markup).
- `map.html` — new: the old A body verbatim.
- `play.html` — new: B stub body.
- `src/landing.ts` — new: chooser render + `redirectTarget` helper + redirect side-effect.
- `src/playMain.ts` — new: B stub mount.
- `src/theme.css` — new: extracted shared styles.
- `src/main.ts` — one-line change (`import "./theme.css";`); still A's entry, now loaded by `map.html`.
- `vite.config.ts` — add MPA inputs.
- `src/landing.test.ts`, `src/playMain.test.ts` — new tests.
- No change to `src/engine/**`, `src/ui/app.ts`, `src/ui/urlState.ts`.
