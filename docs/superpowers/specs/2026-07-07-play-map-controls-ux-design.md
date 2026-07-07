# Play-mode Map & Controls UX Pass (Version B)

**Date:** 2026-07-07
**Status:** Design approved (post self-critique), ready for plan
**Scope:** Version B play-mode only (`src/ui/playApp.ts`, `src/theme.css`, `src/ui/i18n.ts`, and the play map overlay). Play-UI + layout/rendering only — no engine change, golden hashes byte-identical.

## Problem (user feedback after playing)

1. **"내 국가가 어떤 국가인지 지도에서 안 보인다."** The map paints every polity in its own colour but nothing tells the player which colour/blob is theirs.
2. **The action-control block (4 stacked dropdowns + Pass + Advance) is hard to read** and the user wants it folded into the map's own affordances / removed.
3. **The map is too small** — clicking cells and reading labels is uncomfortable.

## Research grounding

- **Own-territory legibility (4X):** clear borders + a distinct treatment for *your* nation; the player should know their realm at a glance without hunting. ([Old Light dev log](https://www.indiedb.com/games/old-light/news/old-light-dev-log-borders-messaging-and-smarter-npcs))
- **Action placement:** a **centralized fixed command bar + context-sensitive (click) options** minimizes cognitive load; "you should be able to do almost any command via the visible UI," and minimizing map↔panel travel matters. Floating on-map menus were rejected — they add load and would occlude the map, which is itself the click surface. ([UI Dos & Don'ts](https://www.gamedeveloper.com/design/ui-strategy-game-design-dos-and-don-ts), [Wayward Strategy](https://waywardstrategy.com/2015/05/04/lets-talk-rts-user-interface-part-1-interview-with-dave-pottinger/))

## Self-critique that shaped this design

A pass over the first draft found: (1) trimming the sidebar 350→300px is cosmetic and does **not** fix "map too small" — the map must get *dominant width*, so the layout goes to a vertical stack with a near-full-width map; (2) a bold outline around the player's territory would **collide** with the existing green/red front-line overlay and political borders on the same edges, adding clutter — the missing information is only "which colour is me," so lead with a **nation chip + capital crown** (+ a very light own-territory tint), not another border stroke; (3) "invest/peace as small buttons" was hand-waving that risked re-creating the unreadable-dropdown problem — invest and peace need concrete, legible controls, and attack/found need a visible status affordance beyond bare map-clicking. This design reflects those corrections.

## Design

### ① Map gets dominant width (vertical stack)

Replace the 2-column `.play-grid` (map | 350px sidebar) with a single centred column, capped at a readable `max-width` (~1100px) so the map is near-full-width on a ~980px window (~600px → ~950px) and still sensible on large screens. Order:

1. **Standing strip** (`.play-topbar`) — the nation chip (②) + the standing panel laid out **horizontally** (momentum headline + 국력/결속 meters + threat inline), a thin bar rather than a tall sidebar. Stance segmented control + help + language live here.
2. **Map** (`.play-main`) — full column width. Existing zoom/pan (⊕) unchanged for detail.
3. **Command bar** (`.play-commandbar`, ③) — slim, directly under the map, same width.
4. **Chronicle log** — below, capped height with scroll.

The `@media (max-width: 960px)` single-column rule becomes the default; no 2-column state remains.

### ② Show which nation is yours

- **Nation chip:** a persistent `당신의 국가: [name] ▮` chip with a colour swatch using `nationColor(playerPolity)`, in the standing strip. This is the primary, cheapest fix (tells the player their colour).
- **Capital crown:** a ♛ glyph drawn at the player's capital cell (`s.capitals[playerPolity]`), visually distinct from the ★/☆ founded-city glyphs and the free-city dots.
- **Own-territory tint:** a single low-opacity light overlay (`~0.12`) over the player's cells so the realm reads slightly brighter than neighbours. Kept subtle to avoid fighting the front-line/border lines; `pointer-events:none` so it never blocks clicks.

The previously-drawn **in-map nation-colour legend overlay is suppressed in play mode** (the chip replaces its purpose and it clutters the map's bottom-right).

### ③ Slim command bar with concrete, legible controls

Remove the four stacked dropdowns. The bar under the map holds:

- **Action status text** — the current pending action in words (`공격: [region] ×N` / `건설: …` / `행동 없음 (패스)`), so map-clicks have a visible confirmation and the bar always states what Advance will do.
- **Attack & Found-city:** performed by **clicking the map** (enemy region = attack, own gold site = found) — already implemented and kept; the status text + existing advice ("녹색 지역 클릭") are the affordance.
- **Invest:** a **2-segment control `[전국 | 국경]`** (like the stance segments), not a dropdown; selecting a segment sets the invest scope and paints the existing map preview.
- **Peace:** a single **clearly-labelled** control (`🕊 강화 ▾`) listing hostile neighbours — the only remaining select, styled for legibility (not one of four tiny ones).
- **[패스]** clears the pending action; **[다음 해 ▶]** advances — the primary button, visually prominent.

Stance (aggressive/defensive/internal) stays in the standing strip as a per-turn lever, separate from the one action/turn.

## Architecture

All changes live in the play UI:

- `src/ui/playApp.ts`:
  - Restructure `startGame`'s DOM assembly from `.play-grid`(main|side) to the vertical stack (`.play-topbar`, `.play-main`, `.play-commandbar`, log).
  - `renderPanel` (standing) → render into `.play-topbar` horizontally, prefixed by the nation chip.
  - `renderActions` → rebuild as the slim command bar: status text, invest segment, peace select, pass, advance (drop attack/found/invest selects).
  - `renderMap` → add the capital ♛ and the own-territory tint overlay; pass an option to suppress the in-map nation legend.
  - Reuse existing `frontEdges`, `borderTargets`, `predictCapture`, `foundCityTargets`, `investEffect`, `hostileNeighbors`, map-click handlers, and preview paints.
- `src/ui/svgWorldRenderer.ts` / `politicalLayer.ts`: allow play mode to request `legend:false` (the political view currently forces `legend:true`); the map-click path already calls `politicalLayer` directly in `renderMap`, so suppression is a `politicalOpts` argument, not a renderer rewrite.
- `src/theme.css`: new `.play-topbar` (horizontal standing strip), `.play-commandbar`, `.nation-chip` + swatch, capped-width map container, invest-segment styling; remove/retire the 2-column `.play-grid` rules.
- `src/ui/i18n.ts`: new KO/EN keys (`yourNation`, action-status phrasings, `investBorder`/`investRealm` segment labels if not already present, `peaceMenu`).

## Data flow

Unchanged game loop. `renderAll` still calls renderMap / standing / command bar / log; only their DOM targets and internal markup change. The nation chip and capital crown read `s.playerPolity` / `s.capitals`; the tint reads `s.owner`.

## Error / edge handling

- **Fallen player:** standing strip already shows the fallen banner; the command bar hides (no actions). Capital crown/tint skip when the player owns no cells.
- **No hostile neighbours:** the peace control shows its empty placeholder (existing behaviour).
- **Capital cell captured:** if `s.capitals[player]` is no longer owned by the player, **skip** the crown (drawing a "your capital" marker on land you no longer hold reads wrong).

## Testing

- `src/ui/playApp.test.ts`:
  - nation chip renders the player's nation name and a swatch coloured `nationColor(playerPolity)`.
  - command bar renders the invest `[전국|국경]` segments, the peace control, and the Advance button, and does **not** render the old attack/found/invest `<select>` dropdowns.
  - capital ♛ marker is present on the map for a live player.
  - action status text reflects a pending attack after a target-cell click.
  - fallen player: command bar absent, banner present.
- **Visual/layout (map size, strip alignment, tint subtlety):** cannot be asserted in jsdom and the harness screenshot is broken → the user eyeballs localhost. The plan sequences the three parts (layout / nation-emphasis / command bar) so each is independently viewable and approvable.
- **Golden regression:** engine/world/history/playSim golden-hash tests stay byte-identical (play-UI only).

## Out of scope (YAGNI)

Reworking the world map renderer beyond the `legend:false` option; on-map floating action menus (rejected in research); touch/mobile gestures; changing zoom/pan; the deferred standing preview-extension (separate spec).
