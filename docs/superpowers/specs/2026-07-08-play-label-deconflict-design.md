# Play Map Label Legibility: de-confliction + visible player label (Version B)

**Date:** 2026-07-08
**Status:** Design approved (post self-critique), ready for plan
**Scope:** `src/ui/deconflict.ts` (new, extracted), `src/ui/app.ts` (import instead of local def), `src/ui/politicalLayer.ts` (player label colour), `src/ui/playApp.ts` (call de-conflict on the play map). Pure DOM (render-time, not seeded) → determinism + engine goldens unaffected.

## Problem

Two play-map label issues:
1. **Overlap:** labels overlap and become unreadable. The map carries ~54 labels — nation names (7 + the player's), capital-city names (8), town names (20), region labels (13), river labels (5) — with no de-confliction, so nation names collide with city/region names. Version A (`map.html`) already solves this with a `deconflictLabels` helper, but that helper lives privately inside `app.ts` and the play screen never calls it.
2. **Player label not visible enough:** the player's nation label is drawn in the same near-black (`#2a2118`) as every other nation, so it doesn't stand out — the user can't quickly spot their own realm's name.

## Design

Reuse Version A's proven solution: **extract `deconflictLabels` into a shared module and call it on the play map after each render.**

- **Extract** `deconflictLabels(svg)` from `app.ts` into `src/ui/deconflict.ts` and export it. Version A imports it (behavior unchanged). It hides any label whose bounding box overlaps a higher-priority one, by tier.
- **Player label is top priority.** Today all nation labels share tier 5, so two overlapping nation labels resolve arbitrarily — the player's own (magenta-emphasized) label could be the one hidden, which contradicts the just-added "which realm is mine" work. Add `.nation-label.player` as a new **top tier (6)** and scope the ordinary nation tier to `.nation-label:not(.player)`, so each element matches exactly one selector and the player's label is placed first and never culled. New tier list:
  `.nation-label.player (6) > .nation-label:not(.player) (5) > .city-capital (4) > .region-label (3) > .river-label (2) > .city-town (1)`.
- **Call it on the play map.** In `playApp.ts` `renderMap`, after the SVG is appended to the (in-document) map frame, call `deconflictLabels(svg)`. It needs real layout (`getBBox`), so it runs post-mount; in jsdom `getBBox` is unavailable so it is a safe no-op there (same as Version A).
- **Visible player label colour.** In `politicalLayer.ts`, the player's nation label (`isPlayer`) renders in `opts.playerColor` (the reserved magenta `#c0247a`) instead of the near-black `#2a2118`, so it visibly reads as "yours" and differs from every black AI label. The existing cream (`#f3ead2`) stroke halo + `paint-order:stroke` stays, keeping the magenta text legible over the (lighter, dusty-pink) player territory fill. Falls back to `#2a2118` if no `playerColor` was passed. The exact readability is eyeball-tunable (darken toward a deeper magenta if contrast is weak in practice).

## Self-critique carried in

- **Player-label self-collision bug avoided:** a naive "add `.nation-label.player` at tier 6" would double-match the element (it is also `.nation-label`), and the second (tier-5) pass would hide it against its own kept box. Scoping the ordinary tier to `:not(.player)` makes the match one-to-one. (This is baked into the tier list above.)
- **Zoom limitation (accepted):** de-confliction runs per `renderMap`, not on zoom/pan, so a label hidden at default zoom stays hidden when the user zooms in and space opens up. Version A has the identical limitation; the reported problem is at default zoom, so this is out of scope.
- **Culling, not repositioning:** hiding lower-priority overlaps (the established pattern) is chosen over nudging labels apart (far more complex, and inconsistent with Version A).

## Architecture

- `src/ui/deconflict.ts` (new): `export function deconflictLabels(svg: SVGSVGElement): void` — the current `app.ts` body, with the tier list updated to include the player tier. Wrapped in the existing `try/catch` so an environment without `getBBox` skips culling.
- `src/ui/app.ts`: delete the local `deconflictLabels` definition; `import { deconflictLabels } from "./deconflict";`. Its call site (`deconflictLabels(svg)` after each year render) is unchanged.
- `src/ui/politicalLayer.ts`: in the labels loop, the player's label `fill` becomes `opts.playerColor ?? "#2a2118"` (was `#2a2118` for all). Everything else (stroke halo, ♛ prefix, `player` class) unchanged.
- `src/ui/playApp.ts`: `import { deconflictLabels } from "./deconflict";`; at the end of `renderMap`, after `mapFrame.appendChild(svg)`, call `deconflictLabels(svg)`.

## Data flow

Unchanged rendering. After the play map's SVG is in the DOM, `deconflictLabels` walks the label tiers, measures each with `getBBox`, and hides lower-priority overlaps. Re-runs every turn (cheap: ~54 labels, O(n²) box checks ≈ a few thousand comparisons).

## Error / edge handling

- No `getBBox` (jsdom / headless): the `try/catch` returns early, keeping all labels visible — no crash.
- Each pass resets `visibility` before measuring, so a label hidden last turn can reappear if the overlap is gone this turn.

## Testing

- `src/ui/deconflict.test.ts` (new): construct an SVG, append `text` elements with the relevant classes and **stubbed `getBBox`** returning controlled rects (jsdom otherwise lacks `getBBox`), then assert: a lower-priority label overlapping a higher-priority one is `visibility:hidden` while a non-overlapping one stays visible; and the `.nation-label.player` label is **never** hidden even when it overlaps another nation label (the other yields instead). This gives the helper its first real coverage.
- `src/ui/politicalLayer.test.ts`: extend the existing player-label test to assert the player label's `fill` equals `playerColor` (and a non-player label's `fill` stays `#2a2118`).
- `src/ui/app.test.ts` / `src/ui/playApp.test.ts`: existing tests keep passing (in jsdom `deconflictLabels` is a no-op, so no label is hidden — the calls are inert in tests).
- **Golden regression:** pure DOM, not seeded → engine/world/history goldens unaffected.
- The actual visual de-confliction is browser-only (getBBox) → the user eyeballs localhost.

## Out of scope (YAGNI)

Re-running de-confliction on zoom/pan; repositioning/leader-lining labels instead of hiding; changing which labels the map draws; de-confliction for the city-drilldown view.
