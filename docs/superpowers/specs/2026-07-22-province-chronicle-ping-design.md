# Province chronicle → map ping (design)

Date: 2026-07-22
Scope: `playProvince.html` (province game). UI-only.

## Problem

The province game's play map draws no province name labels — names appear only in
per-province `<title>` tooltips (hover). Yet the game names provinces in **text** in
three places where the player did not choose the province themselves:

1. **Risk panel** — `⚠ the Hollow Taiga — defects in 3 · isolated`
2. **Chronicle log** — `took / lost / defected / joined you <name>`
3. **Dilemma card** — `🔥 A restless conquest — <name>`

The player is told *which land* to act on but has no way to find it short of hovering
provinces one at a time. On a phone there is no hover at all, so there is no way at all.

The risk panel is the sharpest case: it prints a remedy ("consolidate it, or take the
province pressing it") for a province the player cannot locate, which makes the advice
useless.

This is not the cell game's ping (sightseeing distant events). Here it is **action
information**.

## Non-goals

- **Battle preview rows** (`✓ <name> — ⚔66 vs 🛡50`) stay non-pingable: the player just
  clicked that province on the map, so its location is already known.
- **Province name labels on the play map** — considered and rejected: 100 provinces would
  clutter the map, and culling could hide exactly the name that matters.
- No engine change. Golden hashes untouched.

## Design

### `pingProvince(u, provId)`

Appends an ephemeral `<path class="prov-ping">` to the **current** map svg, using
`provinceOutlinePath(u, provId)` (the existing clean province boundary helper, already used
by the armed-target and fortify rings). It removes itself on `animationend`, with a
`setTimeout` fallback because jsdom fires no animation events.

No state, no re-render — the same pattern as `pingMap` in `playApp.ts`. A later `render()`
rebuilds the svg and the ping is gone; that is by design.

Outline flash rather than a centroid sonar ring: the question being answered is "which
*shape* of land is this name?", and the game already teaches gold outline = the province
you are attending to (armed target ring).

### CSS `.prov-ping`

Gold (`#e8b53a`) **thick solid** stroke, flashing twice over ~0.9s, then gone.
`pointer-events: none` so it can never block target clicks.

Distinct from the defection risk ring, which is amber **dashed** and persistent.

### Affordance

Pingable elements get `cursor: pointer`, a dotted underline on hover, and a `title`
tooltip ("지도에서 위치 보기" / "show on map"), mirroring `.chronicle-event.pingable`
in the cell game. Without this the rows do not read as clickable.

### Wiring

- **Risk panel rows** — already per-row elements; add class + click listener.
- **Dilemma card title** — only when `d.prov >= 0` (the `muster` dilemma names no province).
- **Chronicle log** — `log: string[]` becomes `log: { text: string; prov?: number }[]`.
  The rendered look stays exactly as today: one centred italic line, entries joined by
  ` · `. Each entry is wrapped in `<span class="prov-log-item">` and the separators stay
  plain text, so `.prov-log` textContent is unchanged. Converting the log to a row list
  would be a layout change this feature does not need.
  The three duplicated log-rendering blocks (game over / dilemma / normal turn) collapse
  into one `logEl()` helper.

Log entries carry a province where one exists: conquests, losses, defections, defector-
dilemma grants. Eliminations name a polity, not a province, and stay non-pingable.

## Files

- `src/ui/provinceApp.ts`
- `src/theme.css`

## Tests

1. `pingProvince` appends a node whose `d` equals `provinceOutlinePath` for that province,
   and the fallback timer removes it.
2. Clicking a risk-panel row produces a `.prov-ping` in the map svg.
3. Log entries with a province are `pingable`; an elimination entry is not.
4. Clicking a dilemma title pings; a `muster` dilemma title is not pingable.
5. Regression: `.prov-log` text content is unchanged by the span wrapping.

## Verification limits

jsdom loads no CSS and does no layout, so a passing synthetic `dispatchEvent` does **not**
prove the rows are really clickable (cf. the 07-15 picker `pointer-events` incident).
Real-browser check with `document.elementFromPoint` is required.

Whether the flash actually reads as visible is a look question — screenshots are
harness-blocked, so final acceptance needs the user's eyes.
